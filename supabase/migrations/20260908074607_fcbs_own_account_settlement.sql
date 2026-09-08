-- Additive cutover: old documents retain their original counterparty basis.
begin;
alter table public.hedge_invoices
  add column settlement_basis text not null default 'counterparty'
    check (settlement_basis in ('counterparty','fcbs_own_account_venue')),
  add column source_fingerprint text;
create unique index hedge_fcbs_one_active_month on public.hedge_invoices (settlement_month)
  where settlement_basis='fcbs_own_account_venue' and coalesce(status,'Draft') not in ('Cancelled','Voided','Deleted');

create table public.hedge_fcbs_settlement_operations (
  idempotency_key uuid primary key,
  request_hash text not null,
  invoice_id uuid not null references public.hedge_invoices(id) on delete restrict,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  source_fingerprint text not null,
  created_at timestamptz not null default now()
);
alter table public.hedge_fcbs_settlement_operations enable row level security;
revoke all on public.hedge_fcbs_settlement_operations from public,anon,authenticated;
grant select,insert on public.hedge_fcbs_settlement_operations to service_role;

create function public.hedge_fcbs_settlement_month(p_swap public.hedge_swap_hedges)
returns text language sql immutable security invoker set search_path='' as $$
  select case when p_swap.trade_type='SPREAD' then greatest(p_swap.leg1_month,p_swap.leg2_month) else p_swap.swap_month end
$$;

-- One read snapshot supplies all pricing evidence. No licensed messages or notes.
create function public.hedge_fcbs_settlement_evidence(p_month text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_source jsonb; v_swaps jsonb; v_months text[]; v_ids uuid[]; v_invoices jsonb;
begin
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'HEDGE_FCBS_MONTH_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(s)-'notes' order by s.id),'[]'),array_agg(s.id)
    into v_swaps,v_ids from public.hedge_swap_hedges s
    where upper(btrim(s.counterparty))='FCBHK' and upper(btrim(s.venue))='FCBS'
      and public.hedge_fcbs_settlement_month(s)=p_month;
  select array_agg(distinct m) into v_months from (
    select unnest(case when s.trade_type='SPREAD' then array[s.leg1_month,s.leg2_month] else array[s.swap_month] end) m
    from public.hedge_swap_hedges s where s.id=any(v_ids)
  ) months where m is not null;
  v_source:=jsonb_build_object('swaps',v_swaps,
    'mops',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'price_date',price_date,'s380',s380,'s05',s05,'sgo',sgo,'is_estimate',is_estimate) order by id)
      from public.hedge_market_prices where to_char(price_date,'YYYY-MM')=any(v_months)),'[]'::jsonb),
    'verifications',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'contract_month',contract_month,'input_fingerprint',input_fingerprint,'calculated_snapshot',calculated_snapshot,'verified_at',verified_at) order by id)
      from public.hedge_mops_month_verifications where contract_month=any(v_months)),'[]'::jsonb),
    'settings',coalesce((select jsonb_agg(jsonb_build_object('key',key,'revision',revision,'value',case when key='general' then jsonb_build_object('sgo_bbl_per_mt',value->'sgo_bbl_per_mt','invoice_prefix',value->'invoice_prefix') else value end) order by key)
      from public.hedge_settings where key in ('rates','general')),'[]'::jsonb),
    'counterparties',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'short_name',short_name,'full_name',full_name,'settlement_mode',settlement_mode,'address_line1',address_line1,'address_line2',address_line2,'address_line3',address_line3,'attention',attention) order by id)
      from public.hedge_counterparties where upper(btrim(short_name))='FCBS'),'[]'::jsonb));
  select coalesce(jsonb_agg(to_jsonb(i)-'pdf_payload'-'pdf_data_url'-'notes' order by i.id),'[]') into v_invoices
    from public.hedge_invoices i where (i.settlement_basis='fcbs_own_account_venue' and i.settlement_month=p_month)
      or exists(select 1 from public.hedge_invoice_swaps l where l.invoice_id=i.id and l.swap_id=any(v_ids));
  return jsonb_build_object('source',v_source,'source_fingerprint',encode(extensions.digest(v_source::text,'sha256'),'hex'),'invoices',v_invoices);
end $$;

create or replace function public.block_internal_hedge_invoice_link()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_invoice public.hedge_invoices; v_swap public.hedge_swap_hedges;
begin
  select * into v_invoice from public.hedge_invoices where id=new.invoice_id;
  select * into v_swap from public.hedge_swap_hedges where id=new.swap_id;
  if v_invoice.settlement_basis='fcbs_own_account_venue' then
    if upper(btrim(v_invoice.counterparty))<>'FCBS' or upper(btrim(v_swap.counterparty)) is distinct from 'FCBHK'
      or upper(btrim(v_swap.venue)) is distinct from 'FCBS'
      or public.hedge_fcbs_settlement_month(v_swap) is distinct from v_invoice.settlement_month then
      raise exception 'HEDGE_FCBS_SCOPE_INVALID';
    end if;
  elsif public.hedge_counterparty_is_internal(v_swap.counterparty) then
    raise exception 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED';
  end if;
  return new;
end $$;
drop trigger block_internal_hedge_invoice_link on public.hedge_invoice_swaps;
create trigger block_internal_hedge_invoice_link before insert or update of swap_id,invoice_id on public.hedge_invoice_swaps
  for each row execute function public.block_internal_hedge_invoice_link();

create function public.assert_hedge_fcbs_document(v_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare v_invoice public.hedge_invoices; v_count integer; v_sum numeric;
begin
  select * into v_invoice from public.hedge_invoices where id=v_id;
  if not found then return; end if;
  if v_invoice.settlement_basis='counterparty' then
    if exists(select 1 from public.hedge_invoice_swaps l join public.hedge_swap_hedges s on s.id=l.swap_id
      where l.invoice_id=v_id and public.hedge_counterparty_is_internal(s.counterparty)) then
      raise exception 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED';
    end if;
    return;
  end if;
  if upper(btrim(v_invoice.counterparty)) is distinct from 'FCBS'
    or v_invoice.subtotal is null or v_invoice.subtotal=0 or v_invoice.subtotal::text in ('NaN','Infinity','-Infinity')
    or v_invoice.source_fingerprint is null or v_invoice.source_fingerprint !~ '^[a-f0-9]{64}$'
    or v_invoice.pdf_payload->>'settlementBasis' is distinct from 'fcbs_own_account_venue'
    or v_invoice.pdf_payload->>'sourceFingerprint' is distinct from v_invoice.source_fingerprint
    or (v_invoice.pdf_payload->>'netAmount')::numeric is distinct from v_invoice.subtotal
    or v_invoice.invoice_type is distinct from (case when v_invoice.subtotal>0 then 'Debit Note' else 'Credit Note' end)
  then raise exception 'HEDGE_FCBS_DOCUMENT_INVALID'; end if;
  if (select count(*) from public.hedge_counterparties where upper(btrim(short_name))='FCBS'
      and upper(btrim(full_name))='FRATELLI COSULICH BUNKERS (S) PTE LTD' and settlement_mode='external')<>1 then
    raise exception 'HEDGE_FCBS_RECIPIENT_INVALID';
  end if;
  select count(*) into v_count from public.hedge_invoice_swaps where invoice_id=v_id;
  if v_count=0 or exists(select 1 from public.hedge_invoice_swaps l join public.hedge_swap_hedges s on s.id=l.swap_id
    where l.invoice_id=v_id and (upper(btrim(s.counterparty)) is distinct from 'FCBHK' or upper(btrim(s.venue)) is distinct from 'FCBS'
      or public.hedge_fcbs_settlement_month(s) is distinct from v_invoice.settlement_month)) then raise exception 'HEDGE_FCBS_SCOPE_INVALID'; end if;
  if exists(select 1 from public.hedge_invoice_swaps l join public.hedge_invoice_swaps other on other.swap_id=l.swap_id and other.invoice_id<>l.invoice_id
      join public.hedge_invoices i on i.id=other.invoice_id where l.invoice_id=v_id and coalesce(i.status,'Draft') not in ('Cancelled','Voided','Deleted')
      and coalesce(v_invoice.status,'Draft') not in ('Cancelled','Voided','Deleted')) then raise exception 'HEDGE_FCBS_HEDGE_ALREADY_SETTLED'; end if;
  select sum(net_value) into v_sum from public.hedge_invoice_lines where invoice_id=v_id;
  if v_count<>(select count(*) from public.hedge_invoice_lines where invoice_id=v_id) or v_sum is distinct from v_invoice.subtotal then raise exception 'HEDGE_FCBS_LINES_INVALID'; end if;
end $$;
create function public.validate_hedge_fcbs_document()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='hedge_invoices' then perform public.assert_hedge_fcbs_document(coalesce(new.id,old.id));
  else
    if tg_op<>'DELETE' then perform public.assert_hedge_fcbs_document(new.invoice_id); end if;
    if tg_op<>'INSERT' and (tg_op='DELETE' or old.invoice_id is distinct from new.invoice_id) then
      perform public.assert_hedge_fcbs_document(old.invoice_id);
    end if;
  end if;
  return null;
end $$;
create constraint trigger hedge_fcbs_document_valid after insert or update on public.hedge_invoices deferrable initially deferred
  for each row execute function public.validate_hedge_fcbs_document();
create constraint trigger hedge_fcbs_links_valid after insert or update or delete on public.hedge_invoice_swaps deferrable initially deferred
  for each row execute function public.validate_hedge_fcbs_document();
create constraint trigger hedge_fcbs_lines_valid after insert or update or delete on public.hedge_invoice_lines deferrable initially deferred
  for each row execute function public.validate_hedge_fcbs_document();

create function public.protect_hedge_fcbs_issued()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_invoice public.hedge_invoices; v_delivery_busy boolean;
begin
  if tg_table_name='hedge_invoices' then v_invoice:=old;
  else select * into v_invoice from public.hedge_invoices where id=any(array[new.invoice_id,old.invoice_id])
    and settlement_basis='fcbs_own_account_venue' order by (status<>'Draft') desc limit 1; end if;
  select exists(select 1 from public.hedge_integration_operations where operation='hedge_invoice_email'
    and status in ('processing','uncertain') and response->>'invoiceId'=v_invoice.id::text) into v_delivery_busy;
  if v_invoice.settlement_basis='fcbs_own_account_venue' and (v_invoice.status<>'Draft' or v_delivery_busy) then
    if tg_op='DELETE' or tg_table_name<>'hedge_invoices' then raise exception 'HEDGE_FCBS_ISSUED_IMMUTABLE'; end if;
    if (to_jsonb(new)-array['status','updated_date','updated_by_id','revision','email_sent_at','email_sent_to','email_sent_cc','sender_mailbox_snapshot'])
      is distinct from (to_jsonb(old)-array['status','updated_date','updated_by_id','revision','email_sent_at','email_sent_to','email_sent_cc','sender_mailbox_snapshot'])
      or new.status not in ('Sent','Settled') then raise exception 'HEDGE_FCBS_ISSUED_IMMUTABLE'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

-- Status-only changes cannot alter the reviewed financial document.
create function public.set_hedge_fcbs_settlement_status(p_invoice_id uuid,p_expected_revision bigint,p_status text,p_actor_user_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_invoice public.hedge_invoices; v_evidence jsonb;
begin
  if p_actor_user_id is null or p_status not in ('Sent','Settled') then raise exception 'HEDGE_FCBS_STATUS_INVALID'; end if;
  lock table public.hedge_swap_hedges,public.hedge_market_prices,public.hedge_mops_month_verifications,
    public.hedge_settings,public.hedge_counterparties in share mode;
  select * into v_invoice from public.hedge_invoices where id=p_invoice_id for update;
  if not found or v_invoice.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  if v_invoice.settlement_basis<>'fcbs_own_account_venue' or v_invoice.status not in ('Draft','Sent','Settled') then raise exception 'HEDGE_FCBS_STATUS_INVALID'; end if;
  if v_invoice.status='Draft' then
    if p_status<>'Sent' or nullif(v_invoice.pdf_data_url,'') is null then raise exception 'HEDGE_FCBS_SAVED_PDF_REQUIRED'; end if;
    v_evidence:=public.hedge_fcbs_settlement_evidence(v_invoice.settlement_month);
    if v_evidence->>'source_fingerprint' is distinct from v_invoice.source_fingerprint then raise exception 'HEDGE_FCBS_SOURCE_CHANGED'; end if;
  end if;
  if v_invoice.status is distinct from p_status then
    update public.hedge_invoices set status=p_status,updated_by_id=p_actor_user_id where id=p_invoice_id;
    insert into public.hedge_events(event_type,entity_type,entity_id,label,metadata,actor_user_id,actor_email)
      values('fcbs_settlement_status','Invoice',p_invoice_id,'FCBS own-account settlement',
        jsonb_build_object('basis','fcbs_own_account_venue','from_status',v_invoice.status,'to_status',p_status,'outcome','saved'),p_actor_user_id,p_actor_email);
  end if;
  return jsonb_build_object('invoice_id',p_invoice_id);
end $$;
create trigger hedge_fcbs_issued_invoice before update or delete on public.hedge_invoices for each row execute function public.protect_hedge_fcbs_issued();
create trigger hedge_fcbs_issued_lines before insert or update or delete on public.hedge_invoice_lines for each row execute function public.protect_hedge_fcbs_issued();
create trigger hedge_fcbs_issued_links before insert or update or delete on public.hedge_invoice_swaps for each row execute function public.protect_hedge_fcbs_issued();

create function public.protect_hedge_fcbs_link_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.hedge_invoice_swaps l join public.hedge_invoices i on i.id=l.invoice_id
      where l.swap_id=old.id and i.settlement_basis='fcbs_own_account_venue')
    and (upper(btrim(new.counterparty)) is distinct from 'FCBHK' or upper(btrim(new.venue)) is distinct from 'FCBS'
      or public.hedge_fcbs_settlement_month(new) is distinct from public.hedge_fcbs_settlement_month(old)) then raise exception 'HEDGE_FCBS_LINK_IDENTITY_LOCKED'; end if;
  return new;
end $$;
create trigger hedge_fcbs_link_identity before update on public.hedge_swap_hedges for each row execute function public.protect_hedge_fcbs_link_identity();

create function public.save_hedge_fcbs_settlement(p_invoice_id uuid,p_expected_revision bigint,p_idempotency_key uuid,
  p_request_hash text,p_source_fingerprint text,p_invoice jsonb,p_actor_user_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_invoice public.hedge_invoices; v_operation public.hedge_fcbs_settlement_operations;
  v_evidence jsonb; v_id uuid:=coalesce(p_invoice_id,gen_random_uuid()); v_month text:=p_invoice->>'settlement_month';
  v_line jsonb; v_index integer:=0; v_swap record;
begin
  if p_idempotency_key is null or p_actor_user_id is null or p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'HEDGE_FCBS_REVIEW_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hedge-fcbs:'||coalesce(v_month,''),0));
  select * into v_operation from public.hedge_fcbs_settlement_operations where idempotency_key=p_idempotency_key;
  if found then
    if v_operation.request_hash<>p_request_hash or v_operation.actor_user_id is distinct from p_actor_user_id then raise exception 'HEDGE_FCBS_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('invoice_id',v_operation.invoice_id,'replayed',true);
  end if;
  -- Prevent edits AND phantom inserts between source validation and the atomic save.
  lock table public.hedge_swap_hedges,public.hedge_market_prices,public.hedge_mops_month_verifications,
    public.hedge_settings,public.hedge_counterparties in share mode;
  v_evidence:=public.hedge_fcbs_settlement_evidence(v_month);
  if v_evidence->>'source_fingerprint' is distinct from p_source_fingerprint then raise exception 'HEDGE_FCBS_SOURCE_CHANGED'; end if;
  if jsonb_array_length(v_evidence->'source'->'swaps')=0 or jsonb_array_length(p_invoice->'pdf_payload'->'lineItems')<>jsonb_array_length(v_evidence->'source'->'swaps') then raise exception 'HEDGE_FCBS_SCOPE_INVALID'; end if;
  if p_invoice_id is not null then
    select * into v_invoice from public.hedge_invoices where id=p_invoice_id for update;
    if not found or v_invoice.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
    if v_invoice.settlement_basis<>'fcbs_own_account_venue' or v_invoice.settlement_month<>v_month or v_invoice.status<>'Draft' then raise exception 'HEDGE_FCBS_ISSUED_IMMUTABLE'; end if;
    if v_invoice.invoice_number is distinct from p_invoice->>'invoice_number' then raise exception 'HEDGE_FCBS_NUMBER_IMMUTABLE'; end if;
  end if;
  if exists(select 1 from public.hedge_invoices where id<>v_id and invoice_number=p_invoice->>'invoice_number' and coalesce(status,'Draft') not in ('Cancelled','Voided','Deleted')) then raise exception 'HEDGE_FCBS_NUMBER_CONFLICT'; end if;
  if nullif(p_invoice->>'invoice_number','') is null or p_invoice->>'status' is distinct from 'Draft' then raise exception 'HEDGE_FCBS_REVIEW_REQUIRED'; end if;
  if p_invoice_id is null then
    insert into public.hedge_invoices(id,invoice_number,invoice_type,issue_date,settlement_month,counterparty,section,subtotal,status,pdf_payload,settlement_basis,source_fingerprint,created_by,created_by_id,updated_by_id)
      values(v_id,p_invoice->>'invoice_number',p_invoice->>'invoice_type',(p_invoice->>'issue_date')::date,v_month,'FCBS','Trader',(p_invoice->>'subtotal')::numeric,'Draft',p_invoice->'pdf_payload','fcbs_own_account_venue',p_source_fingerprint,p_actor_email,p_actor_user_id,p_actor_user_id);
  else
    update public.hedge_invoices set invoice_type=p_invoice->>'invoice_type',issue_date=(p_invoice->>'issue_date')::date,
      subtotal=(p_invoice->>'subtotal')::numeric,pdf_payload=p_invoice->'pdf_payload',pdf_data_url=null,source_fingerprint=p_source_fingerprint,updated_by_id=p_actor_user_id where id=v_id;
    delete from public.hedge_invoice_lines where invoice_id=v_id;
    delete from public.hedge_invoice_swaps where invoice_id=v_id;
  end if;
  for v_line in select value from jsonb_array_elements(p_invoice->'pdf_payload'->'lineItems') loop
    select s.* into v_swap from jsonb_to_recordset(v_evidence->'source'->'swaps') as s(id uuid) where s.id=(v_line->>'swapId')::uuid;
    if not found then raise exception 'HEDGE_FCBS_SCOPE_INVALID'; end if;
    insert into public.hedge_invoice_swaps(invoice_id,swap_id,link_order) values(v_id,v_swap.id,v_index);
    insert into public.hedge_invoice_lines(invoice_id,line_order,product,direction,quantity,unit,price,mtm_value,handling_fee,net_value,source_snapshot)
      values(v_id,v_index,v_line->>'product',v_line->>'direction',(v_line->>'quantity')::numeric,v_line->>'unit',(v_line->>'price')::numeric,
        (v_line->>'mtmValue')::numeric,(v_line->>'handlingFee')::numeric,(v_line->>'netValue')::numeric,jsonb_build_object('swapId',v_swap.id,'sourceFingerprint',p_source_fingerprint));
    v_index:=v_index+1;
  end loop;
  insert into public.hedge_fcbs_settlement_operations(idempotency_key,request_hash,invoice_id,actor_user_id,source_fingerprint)
    values(p_idempotency_key,p_request_hash,v_id,p_actor_user_id,p_source_fingerprint);
  insert into public.hedge_events(event_type,entity_type,entity_id,label,metadata,actor_user_id,actor_email)
    values(case when p_invoice_id is null then 'fcbs_settlement_created' else 'fcbs_settlement_reviewed' end,'Invoice',v_id,'FCBS own-account settlement',
      jsonb_build_object('basis','fcbs_own_account_venue','hedge_count',v_index,'source_fingerprint',p_source_fingerprint,'outcome','saved'),p_actor_user_id,p_actor_email);
  return jsonb_build_object('invoice_id',v_id,'replayed',false);
end $$;

revoke all on function public.hedge_fcbs_settlement_month(public.hedge_swap_hedges),public.hedge_fcbs_settlement_evidence(text),
  public.validate_hedge_fcbs_document(),public.protect_hedge_fcbs_issued(),public.protect_hedge_fcbs_link_identity(),
  public.assert_hedge_fcbs_document(uuid),public.set_hedge_fcbs_settlement_status(uuid,bigint,text,uuid,text),
  public.save_hedge_fcbs_settlement(uuid,bigint,uuid,text,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.hedge_fcbs_settlement_month(public.hedge_swap_hedges),public.hedge_fcbs_settlement_evidence(text),
  public.validate_hedge_fcbs_document(),public.protect_hedge_fcbs_issued(),public.protect_hedge_fcbs_link_identity(),
  public.assert_hedge_fcbs_document(uuid),public.set_hedge_fcbs_settlement_status(uuid,bigint,text,uuid,text),
  public.save_hedge_fcbs_settlement(uuid,bigint,uuid,text,text,jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
