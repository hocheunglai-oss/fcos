-- Durable evidence for Finance-reviewed Xero prepayment operations.
-- Provider writes are deliberately outside this migration. The send marker is the
-- irreversible boundary used by the caller before making any Xero request.
create table public.xero_financial_prepayment_operations (
  operation_id uuid primary key,
  tenant_id uuid not null,
  cash_event_id text not null check (cash_event_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  source_kind text not null check (source_kind in ('cash_event','cash_allocation')),
  source_id text not null check (source_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  action text not null check (action in ('create','allocate','reverse','refund')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  review_hash text not null check (review_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_evidence jsonb not null check (jsonb_typeof(request_evidence) = 'object' and request_evidence <> '{}'::jsonb),
  currency text not null check (currency in ('USD','HKD')),
  native_amount numeric(18,2) not null check (native_amount > 0),
  accounting_usd numeric(18,2) not null check (accounting_usd >= 0),
  invoice_mapping_id uuid references public.xero_financial_document_mappings(id) on delete restrict,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz not null default now(),
  status text not null default 'processing' check (status in ('processing','applied','unknown','exception','cancelled_before_send')),
  send_started_at timestamptz,
  xero_bank_transaction_id uuid,
  xero_prepayment_id uuid,
  xero_allocation_id uuid,
  xero_payment_id uuid,
  response_evidence jsonb,
  updated_at timestamptz not null default now(),

  check (
    (action = 'create' and source_kind = 'cash_event' and source_id = cash_event_id and invoice_mapping_id is null)
    or (action = 'refund' and source_kind = 'cash_event' and invoice_mapping_id is null)
    or (action in ('allocate','reverse') and source_kind = 'cash_allocation' and invoice_mapping_id is not null)
  ),
  check (
    (action = 'create' and xero_allocation_id is null and xero_payment_id is null)
    or (action in ('allocate','reverse') and xero_bank_transaction_id is null and xero_payment_id is null)
    or (action = 'refund' and xero_bank_transaction_id is null and xero_allocation_id is null)
  ),
  check (
    status <> 'applied'
    or (action = 'create' and xero_bank_transaction_id is not null and xero_prepayment_id is not null)
    or (action in ('allocate','reverse') and xero_prepayment_id is not null and xero_allocation_id is not null)
    or (action = 'refund' and xero_prepayment_id is not null and xero_payment_id is not null)
  ),
  check (status not in ('applied','unknown','exception') or send_started_at is not null),
  check (status <> 'cancelled_before_send' or (
    send_started_at is null
    and xero_bank_transaction_id is null
    and xero_prepayment_id is null
    and xero_allocation_id is null
    and xero_payment_id is null
  )),
  check (status not in ('applied','unknown','exception') or (
    jsonb_typeof(response_evidence) = 'object' and response_evidence <> '{}'::jsonb
  )),
  check (response_evidence is null or (
    jsonb_typeof(response_evidence) = 'object' and response_evidence <> '{}'::jsonb
  ))
);

-- Salesforce's first 15 characters identify the record in either ID form.
-- Keep the original IDs intact in immutable requests and audit evidence.
create unique index xero_prepayment_active_source_action
  on public.xero_financial_prepayment_operations(tenant_id,(pg_catalog.left(source_id,15)),action)
  where status <> 'cancelled_before_send';
create unique index xero_prepayment_busy_cash
  on public.xero_financial_prepayment_operations(tenant_id,(pg_catalog.left(cash_event_id,15)))
  where status in ('processing','unknown','exception');
create unique index xero_prepayment_bank_transaction_identity
  on public.xero_financial_prepayment_operations(tenant_id,xero_bank_transaction_id)
  where xero_bank_transaction_id is not null;
create unique index xero_prepayment_identity
  on public.xero_financial_prepayment_operations(tenant_id,xero_prepayment_id)
  where xero_prepayment_id is not null and action = 'create';
create unique index xero_prepayment_allocation_identity
  on public.xero_financial_prepayment_operations(tenant_id,xero_allocation_id,action)
  where xero_allocation_id is not null;
create unique index xero_prepayment_payment_identity
  on public.xero_financial_prepayment_operations(tenant_id,xero_payment_id)
  where xero_payment_id is not null;

create table public.xero_financial_prepayment_operation_audit (
  audit_id bigint generated always as identity primary key,
  operation_id uuid not null,
  tenant_id uuid not null,
  from_status text,
  to_status text not null,
  send_started_at timestamptz,
  xero_bank_transaction_id uuid,
  xero_prepayment_id uuid,
  xero_allocation_id uuid,
  xero_payment_id uuid,
  response_evidence jsonb,
  actor_id uuid not null,
  changed_at timestamptz not null default now()
);

alter table public.xero_financial_prepayment_operations enable row level security;
alter table public.xero_financial_prepayment_operations force row level security;
alter table public.xero_financial_prepayment_operation_audit enable row level security;
alter table public.xero_financial_prepayment_operation_audit force row level security;

revoke all on public.xero_financial_prepayment_operations from public,anon,authenticated,service_role;
revoke all on public.xero_financial_prepayment_operation_audit from public,anon,authenticated,service_role;
revoke all on sequence public.xero_financial_prepayment_operation_audit_audit_id_seq from public,anon,authenticated,service_role;
grant select on public.xero_financial_prepayment_operations to service_role;
grant select on public.xero_financial_prepayment_operation_audit to service_role;

create policy service_prepayment_operations_read
  on public.xero_financial_prepayment_operations for select to service_role using (true);
create policy service_prepayment_operation_audit_read
  on public.xero_financial_prepayment_operation_audit for select to service_role using (true);

create function public.guard_xero_prepayment_operation_v1()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Xero prepayment operation evidence cannot be deleted';
  end if;
  if (new.operation_id,new.tenant_id,new.cash_event_id,new.source_kind,new.source_id,new.action,
      new.source_hash,new.review_hash,new.request_hash,new.request_evidence,new.currency,
      new.native_amount,new.accounting_usd,new.invoice_mapping_id,new.actor_id,new.created_at,new.reviewed_at)
     is distinct from
     (old.operation_id,old.tenant_id,old.cash_event_id,old.source_kind,old.source_id,old.action,
      old.source_hash,old.review_hash,old.request_hash,old.request_evidence,old.currency,
      old.native_amount,old.accounting_usd,old.invoice_mapping_id,old.actor_id,old.created_at,old.reviewed_at)
  then
    raise exception 'Xero prepayment request evidence is immutable';
  end if;
  if old.send_started_at is not null and new.send_started_at is distinct from old.send_started_at then
    raise exception 'Xero prepayment send marker is immutable';
  end if;
  if old.xero_bank_transaction_id is not null and new.xero_bank_transaction_id is distinct from old.xero_bank_transaction_id
     or old.xero_prepayment_id is not null and new.xero_prepayment_id is distinct from old.xero_prepayment_id
     or old.xero_allocation_id is not null and new.xero_allocation_id is distinct from old.xero_allocation_id
     or old.xero_payment_id is not null and new.xero_payment_id is distinct from old.xero_payment_id
  then
    raise exception 'Xero prepayment provider identity is immutable';
  end if;
  if old.status = 'processing' and new.status not in ('processing','applied','unknown','exception','cancelled_before_send')
     or old.status in ('unknown','exception') and new.status not in ('unknown','exception','applied')
     or old.status in ('applied','cancelled_before_send') and new.status <> old.status
  then
    raise exception 'Invalid Xero prepayment operation status transition';
  end if;
  if new.status = 'cancelled_before_send' and (
    old.status <> 'processing' or old.send_started_at is not null
    or old.xero_bank_transaction_id is not null or old.xero_prepayment_id is not null
    or old.xero_allocation_id is not null or old.xero_payment_id is not null
  ) then
    raise exception 'Only a provably unsent Xero prepayment operation may be cancelled';
  end if;
  new.updated_at = pg_catalog.now();
  return new;
end $$;

create trigger guard_xero_prepayment_operation
before update or delete on public.xero_financial_prepayment_operations
for each row execute function public.guard_xero_prepayment_operation_v1();

create function public.append_xero_prepayment_operation_audit_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  insert into public.xero_financial_prepayment_operation_audit(
    operation_id,tenant_id,from_status,to_status,send_started_at,
    xero_bank_transaction_id,xero_prepayment_id,xero_allocation_id,xero_payment_id,
    response_evidence,actor_id
  ) values (
    new.operation_id,new.tenant_id,case when tg_op = 'UPDATE' then old.status end,new.status,new.send_started_at,
    new.xero_bank_transaction_id,new.xero_prepayment_id,new.xero_allocation_id,new.xero_payment_id,
    new.response_evidence,new.actor_id
  );
  return new;
end $$;

create trigger audit_xero_prepayment_operation
after insert or update on public.xero_financial_prepayment_operations
for each row execute function public.append_xero_prepayment_operation_audit_v1();

create function public.guard_xero_prepayment_operation_audit_v1()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog
as $$
begin
  raise exception 'Xero prepayment operation audit is append-only';
end $$;

create trigger guard_xero_prepayment_operation_audit
before update or delete on public.xero_financial_prepayment_operation_audit
for each row execute function public.guard_xero_prepayment_operation_audit_v1();

create function public.claim_xero_prepayment_operation_v1(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_cash_event_id text,
  p_source_kind text,
  p_source_id text,
  p_action text,
  p_source_hash text,
  p_review_hash text,
  p_request_hash text,
  p_request_evidence jsonb,
  p_currency text,
  p_native_amount numeric,
  p_accounting_usd numeric,
  p_invoice_mapping_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  saved public.xero_financial_prepayment_operations;
  active public.xero_financial_prepayment_operations;
  claimed boolean := false;
begin
  if p_native_amount is null or p_native_amount <= 0 or p_native_amount <> trunc(p_native_amount,2)
     or p_accounting_usd is null or p_accounting_usd < 0 or p_accounting_usd <> trunc(p_accounting_usd,2)
  then
    raise exception 'Xero prepayment amounts require exact nonnegative two-decimal evidence';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text || ':' || pg_catalog.left(p_cash_event_id,15),0));
  select * into saved from public.xero_financial_prepayment_operations where operation_id = p_operation_id for update;

  if found then
    if (saved.tenant_id,saved.cash_event_id,saved.source_kind,saved.source_id,saved.action,
        saved.source_hash,saved.review_hash,saved.request_hash,saved.request_evidence,saved.currency,
        saved.native_amount,saved.accounting_usd,saved.invoice_mapping_id,saved.actor_id)
       is distinct from
       (p_tenant_id,p_cash_event_id,p_source_kind,p_source_id,p_action,
        p_source_hash,p_review_hash,p_request_hash,p_request_evidence,p_currency,
        p_native_amount,p_accounting_usd,p_invoice_mapping_id,p_actor_id)
    then
      raise exception using errcode='40001',message='Xero prepayment operation or immutable request evidence changed';
    end if;
    return jsonb_build_object('claimed',false,'operation',to_jsonb(saved));
  end if;

  select * into active
  from public.xero_financial_prepayment_operations
  where tenant_id = p_tenant_id and pg_catalog.left(source_id,15) = pg_catalog.left(p_source_id,15) and action = p_action
    and status <> 'cancelled_before_send'
  for update;
  if found then
    raise exception using errcode='40001',message='Xero prepayment source action is already claimed by another operation';
  end if;

  select * into active
  from public.xero_financial_prepayment_operations
  where tenant_id = p_tenant_id and pg_catalog.left(cash_event_id,15) = pg_catalog.left(p_cash_event_id,15)
    and status in ('processing','unknown','exception')
  for update;
  if found then
    raise exception using errcode='40001',message='Xero prepayment cash event has an unresolved operation';
  end if;

  insert into public.xero_financial_prepayment_operations(
    operation_id,tenant_id,cash_event_id,source_kind,source_id,action,
    source_hash,review_hash,request_hash,request_evidence,currency,native_amount,
    accounting_usd,invoice_mapping_id,actor_id,status
  ) values (
    p_operation_id,p_tenant_id,p_cash_event_id,p_source_kind,p_source_id,p_action,
    p_source_hash,p_review_hash,p_request_hash,p_request_evidence,p_currency,p_native_amount,
    p_accounting_usd,p_invoice_mapping_id,p_actor_id,'processing'
  ) returning * into saved;
  claimed := true;
  return jsonb_build_object('claimed',claimed,'operation',to_jsonb(saved));
exception when unique_violation then
  select * into saved from public.xero_financial_prepayment_operations where operation_id = p_operation_id;
  if found and (saved.tenant_id,saved.cash_event_id,saved.source_kind,saved.source_id,saved.action,
      saved.source_hash,saved.review_hash,saved.request_hash,saved.request_evidence,saved.currency,
      saved.native_amount,saved.accounting_usd,saved.invoice_mapping_id,saved.actor_id)
     is not distinct from
     (p_tenant_id,p_cash_event_id,p_source_kind,p_source_id,p_action,
      p_source_hash,p_review_hash,p_request_hash,p_request_evidence,p_currency,
      p_native_amount,p_accounting_usd,p_invoice_mapping_id,p_actor_id)
  then
    return jsonb_build_object('claimed',false,'operation',to_jsonb(saved));
  end if;
  raise exception using errcode='40001',message='Xero prepayment operation conflicts with existing immutable evidence';
end $$;

create function public.mark_xero_prepayment_sent_v1(p_operation_id uuid,p_tenant_id uuid,p_request_hash text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare saved public.xero_financial_prepayment_operations;
begin
  select * into saved from public.xero_financial_prepayment_operations where operation_id=p_operation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Xero prepayment operation was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(saved.tenant_id::text || ':' || pg_catalog.left(saved.cash_event_id,15),0));
  select * into saved from public.xero_financial_prepayment_operations where operation_id=p_operation_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'Xero prepayment operation was not found'; end if;
  if saved.request_hash is distinct from p_request_hash then raise exception 'Xero prepayment request hash changed'; end if;
  if saved.status <> 'processing' then raise exception 'Only a processing Xero prepayment operation can start a send'; end if;
  if saved.send_started_at is not null then
    return jsonb_build_object('marked',false,'operation',to_jsonb(saved));
  end if;
  update public.xero_financial_prepayment_operations set send_started_at=pg_catalog.now()
    where operation_id=p_operation_id returning * into saved;
  return jsonb_build_object('marked',true,'operation',to_jsonb(saved));
end $$;

create function public.finish_xero_prepayment_operation_v1(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_request_hash text,
  p_status text,
  p_xero_bank_transaction_id uuid,
  p_xero_prepayment_id uuid,
  p_xero_allocation_id uuid,
  p_xero_payment_id uuid,
  p_response_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare saved public.xero_financial_prepayment_operations;
begin
  if p_status not in ('applied','unknown','exception') then raise exception 'Invalid Xero prepayment finish status'; end if;
  if jsonb_typeof(p_response_evidence) <> 'object' or p_response_evidence = '{}'::jsonb then raise exception 'Xero prepayment response evidence is required'; end if;
  select * into saved from public.xero_financial_prepayment_operations where operation_id=p_operation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Xero prepayment operation was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(saved.tenant_id::text || ':' || pg_catalog.left(saved.cash_event_id,15),0));
  select * into saved from public.xero_financial_prepayment_operations where operation_id=p_operation_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'Xero prepayment operation was not found'; end if;
  if saved.request_hash is distinct from p_request_hash then raise exception 'Xero prepayment request hash changed'; end if;
  if saved.send_started_at is null then raise exception 'Xero prepayment send was not durably marked'; end if;
  if saved.status = 'cancelled_before_send' then raise exception 'Cancelled Xero prepayment operations cannot finish'; end if;
  if saved.status = 'applied' then
    if (saved.xero_bank_transaction_id,saved.xero_prepayment_id,saved.xero_allocation_id,saved.xero_payment_id,saved.response_evidence)
       is distinct from
       (p_xero_bank_transaction_id,p_xero_prepayment_id,p_xero_allocation_id,p_xero_payment_id,p_response_evidence)
       or p_status <> 'applied'
    then raise exception 'Applied Xero prepayment operation evidence is immutable'; end if;
    return jsonb_build_object('finished',false,'operation',to_jsonb(saved));
  end if;
  if saved.xero_bank_transaction_id is not null and saved.xero_bank_transaction_id is distinct from p_xero_bank_transaction_id
     or saved.xero_prepayment_id is not null and saved.xero_prepayment_id is distinct from p_xero_prepayment_id
     or saved.xero_allocation_id is not null and saved.xero_allocation_id is distinct from p_xero_allocation_id
     or saved.xero_payment_id is not null and saved.xero_payment_id is distinct from p_xero_payment_id
  then raise exception 'Xero prepayment provider identity changed'; end if;
  update public.xero_financial_prepayment_operations set
    status=p_status,
    xero_bank_transaction_id=coalesce(xero_bank_transaction_id,p_xero_bank_transaction_id),
    xero_prepayment_id=coalesce(xero_prepayment_id,p_xero_prepayment_id),
    xero_allocation_id=coalesce(xero_allocation_id,p_xero_allocation_id),
    xero_payment_id=coalesce(xero_payment_id,p_xero_payment_id),
    response_evidence=p_response_evidence
  where operation_id=p_operation_id returning * into saved;
  return jsonb_build_object('finished',true,'operation',to_jsonb(saved));
end $$;

create function public.cancel_xero_prepayment_operation_v1(p_operation_id uuid,p_tenant_id uuid,p_request_hash text,p_response_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare saved public.xero_financial_prepayment_operations;
begin
  select * into saved from public.xero_financial_prepayment_operations where operation_id=p_operation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Xero prepayment operation was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(saved.tenant_id::text || ':' || pg_catalog.left(saved.cash_event_id,15),0));
  select * into saved from public.xero_financial_prepayment_operations where operation_id=p_operation_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'Xero prepayment operation was not found'; end if;
  if saved.request_hash is distinct from p_request_hash then raise exception 'Xero prepayment request hash changed'; end if;
  if saved.status = 'cancelled_before_send' then
    return jsonb_build_object('cancelled',false,'operation',to_jsonb(saved));
  end if;
  if saved.status <> 'processing' or saved.send_started_at is not null
     or saved.xero_bank_transaction_id is not null or saved.xero_prepayment_id is not null
     or saved.xero_allocation_id is not null or saved.xero_payment_id is not null
  then raise exception 'Only a provably unsent Xero prepayment operation may be cancelled'; end if;
  update public.xero_financial_prepayment_operations set
    status='cancelled_before_send',response_evidence=p_response_evidence
  where operation_id=p_operation_id returning * into saved;
  return jsonb_build_object('cancelled',true,'operation',to_jsonb(saved));
end $$;

revoke all on function public.guard_xero_prepayment_operation_v1() from public,anon,authenticated,service_role;
revoke all on function public.append_xero_prepayment_operation_audit_v1() from public,anon,authenticated,service_role;
revoke all on function public.guard_xero_prepayment_operation_audit_v1() from public,anon,authenticated,service_role;
revoke all on function public.claim_xero_prepayment_operation_v1(uuid,uuid,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,uuid,uuid) from public,anon,authenticated;
revoke all on function public.mark_xero_prepayment_sent_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_xero_prepayment_operation_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.cancel_xero_prepayment_operation_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_xero_prepayment_operation_v1(uuid,uuid,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,uuid,uuid) to service_role;
grant execute on function public.mark_xero_prepayment_sent_v1(uuid,uuid,text) to service_role;
grant execute on function public.finish_xero_prepayment_operation_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.cancel_xero_prepayment_operation_v1(uuid,uuid,text,jsonb) to service_role;


-- Credit and prepayment claims may change the same invoice balance. Serialize
-- admission before checking the other journal, then retain the durable hold
-- until the original operation is reconciled or cancelled before sending.
create unique index xero_prepayment_busy_invoice
  on public.xero_financial_prepayment_operations(tenant_id,invoice_mapping_id)
  where invoice_mapping_id is not null and status in ('processing','unknown','exception');

create function public.guard_xero_invoice_settlement_claim_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.invoice_mapping_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('xero.settlement.invoice:' || new.tenant_id::text || ':' || new.invoice_mapping_id::text,0));
  if tg_table_name = 'xero_financial_credit_allocations' then
    if exists (
      select 1 from public.xero_financial_prepayment_operations
      where tenant_id=new.tenant_id and invoice_mapping_id=new.invoice_mapping_id
        and status in ('processing','unknown','exception')
    ) then
      raise exception 'The invoice has an unresolved prepayment operation' using errcode='40001';
    end if;
  else
    if exists (
      select 1 from public.xero_financial_credit_allocations
      where tenant_id=new.tenant_id and invoice_mapping_id=new.invoice_mapping_id
        and status in ('processing','unknown','exception')
    ) then
      raise exception 'The invoice has an unresolved credit allocation' using errcode='40001';
    end if;
  end if;
  return new;
end $$;

create trigger guard_xero_credit_invoice_settlement_claim
  before insert on public.xero_financial_credit_allocations
  for each row execute function public.guard_xero_invoice_settlement_claim_v1();
create trigger guard_xero_prepayment_invoice_settlement_claim
  before insert on public.xero_financial_prepayment_operations
  for each row execute function public.guard_xero_invoice_settlement_claim_v1();
revoke all on function public.guard_xero_invoice_settlement_claim_v1() from public,anon,authenticated,service_role;
