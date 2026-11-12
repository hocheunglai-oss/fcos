-- One durable, explicit Finance-reviewed allocation of a full credit to its original.
create table public.xero_financial_credit_allocations (
  operation_id uuid primary key,
  tenant_id uuid not null,
  credit_mapping_id uuid not null references public.xero_financial_document_mappings(id),
  invoice_mapping_id uuid not null references public.xero_financial_document_mappings(id),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_evidence jsonb not null check (jsonb_typeof(request_evidence) = 'object'),
  currency text not null check (currency in ('USD','HKD')),
  native_amount numeric(18,2) not null check (native_amount > 0),
  accounting_usd numeric(18,2) not null check (accounting_usd >= 0),
  status text not null check (status in ('processing','applied','unknown','exception','cancelled_before_send')),
  send_started_at timestamptz,
  xero_allocation_id uuid,
  response_evidence jsonb,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id,xero_allocation_id),
  check (credit_mapping_id <> invoice_mapping_id),
  check ((status = 'applied') = (xero_allocation_id is not null)),
  check (status not in ('applied','unknown','exception') or send_started_at is not null),
  check (status <> 'cancelled_before_send' or send_started_at is null),
  check (status = 'processing' or (jsonb_typeof(response_evidence) = 'object' and response_evidence <> '{}'::jsonb and response_evidence is not null))
);
create unique index xero_credit_allocation_active_credit
  on public.xero_financial_credit_allocations(tenant_id,credit_mapping_id) where status <> 'cancelled_before_send';
create unique index xero_credit_allocation_busy_invoice
  on public.xero_financial_credit_allocations(tenant_id,invoice_mapping_id) where status in ('processing','unknown','exception');

create table public.xero_financial_credit_allocation_audit (
  audit_id bigint generated always as identity primary key,
  operation_id uuid not null references public.xero_financial_credit_allocations(operation_id),
  tenant_id uuid not null,
  actor_id uuid not null,
  status text not null,
  send_started_at timestamptz,
  xero_allocation_id uuid,
  changed_at timestamptz not null default now()
);

alter table public.xero_financial_credit_allocations enable row level security;
alter table public.xero_financial_credit_allocations force row level security;
alter table public.xero_financial_credit_allocation_audit enable row level security;
alter table public.xero_financial_credit_allocation_audit force row level security;
revoke all on public.xero_financial_credit_allocations, public.xero_financial_credit_allocation_audit from public,anon,authenticated,service_role;
revoke all on sequence public.xero_financial_credit_allocation_audit_audit_id_seq from public,anon,authenticated,service_role;
grant select on public.xero_financial_credit_allocations, public.xero_financial_credit_allocation_audit to service_role;
create policy service_credit_allocations on public.xero_financial_credit_allocations for select to service_role using (true);
create policy service_credit_allocation_audit on public.xero_financial_credit_allocation_audit for select to service_role using (true);

create function public.append_xero_credit_allocation_audit_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.xero_financial_credit_allocation_audit(
    operation_id,tenant_id,actor_id,status,send_started_at,xero_allocation_id
  ) values (new.operation_id,new.tenant_id,new.reviewed_by,new.status,new.send_started_at,new.xero_allocation_id);
  return null;
end $$;
create trigger append_xero_credit_allocation_audit
  after insert or update on public.xero_financial_credit_allocations
  for each row execute function public.append_xero_credit_allocation_audit_v1();

create function public.claim_xero_credit_allocation_v1(
  p_operation_id uuid,p_tenant_id uuid,p_credit_mapping_id uuid,p_invoice_mapping_id uuid,
  p_request_hash text,p_request_evidence jsonb,p_currency text,p_native_amount numeric,p_accounting_usd numeric,p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  saved public.xero_financial_credit_allocations;
  credit public.xero_financial_document_mappings;
  invoice public.xero_financial_document_mappings;
begin
  perform public.xero_shared_assert_tenant(p_tenant_id::text);
  perform pg_advisory_xact_lock(hashtextextended('xero.settlement.invoice:' || p_tenant_id::text || ':' || p_invoice_mapping_id::text,0));
  select * into saved from public.xero_financial_credit_allocations where operation_id=p_operation_id for update;
  if found then
    if (saved.tenant_id,saved.credit_mapping_id,saved.invoice_mapping_id,saved.request_hash,saved.request_evidence,
        saved.currency,saved.native_amount,saved.accounting_usd,saved.reviewed_by)
      is distinct from (p_tenant_id,p_credit_mapping_id,p_invoice_mapping_id,p_request_hash,p_request_evidence,
        p_currency,p_native_amount,p_accounting_usd,p_actor_id) then
      raise exception 'The original credit allocation request changed' using errcode='40001';
    end if;
    return jsonb_build_object('claimed',false,'operation',to_jsonb(saved));
  end if;

  if p_native_amount is null or p_native_amount <= 0 or p_native_amount <> trunc(p_native_amount,2)
    or p_accounting_usd is null or p_accounting_usd < 0 or p_accounting_usd <> trunc(p_accounting_usd,2)
    or p_request_evidence->>'status' is distinct from 'eligible'
    or p_request_evidence->>'action' is distinct from 'credit_allocate'
    or p_request_evidence->>'currency' is distinct from p_currency
    or p_request_evidence->'amount' is distinct from to_jsonb(p_native_amount)
    or p_request_evidence->'accountingUsd' is distinct from to_jsonb(p_accounting_usd)
    or p_request_evidence->>'creditMappingId' is distinct from p_credit_mapping_id::text
    or p_request_evidence->>'invoiceMappingId' is distinct from p_invoice_mapping_id::text then
    raise exception 'Exact reviewed credit allocation evidence is required' using errcode='22023';
  end if;

  select * into credit from public.xero_financial_document_mappings where id=p_credit_mapping_id;
  select * into invoice from public.xero_financial_document_mappings where id=p_invoice_mapping_id;
  if credit.id is null or invoice.id is null or credit.salesforce_object <> invoice.salesforce_object
    or (credit.xero_document_type, invoice.xero_document_type) not in (('ACCRECCREDIT','ACCREC'),('ACCPAYCREDIT','ACCPAY'))
    or credit.xero_document_id is distinct from p_request_evidence->>'xeroCreditId'
    or invoice.xero_document_id is distinct from p_request_evidence->>'xeroInvoiceId'
    or credit.source_fingerprint is distinct from p_request_evidence#>>'{evidence,sourceCredit}'
    or invoice.source_fingerprint is distinct from p_request_evidence#>>'{evidence,sourceOriginal}' then
    raise exception 'The current credit or invoice mapping changed' using errcode='40001';
  end if;
  insert into public.xero_financial_credit_allocations(
    operation_id,tenant_id,credit_mapping_id,invoice_mapping_id,request_hash,request_evidence,
    currency,native_amount,accounting_usd,status,reviewed_by
  ) values (p_operation_id,p_tenant_id,p_credit_mapping_id,p_invoice_mapping_id,p_request_hash,p_request_evidence,
    p_currency,p_native_amount,p_accounting_usd,'processing',p_actor_id)
  returning * into saved;
  return jsonb_build_object('claimed',true,'operation',to_jsonb(saved));
exception when unique_violation then
  raise exception 'The credit or invoice already has a conflicting allocation operation' using errcode='40001';
end $$;

create function public.transition_xero_credit_allocation_v1(
  p_operation_id uuid,p_tenant_id uuid,p_request_hash text,p_actor_id uuid,p_transition text,
  p_xero_allocation_id uuid default null,p_response_evidence jsonb default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare saved public.xero_financial_credit_allocations;
begin
  perform public.xero_shared_assert_tenant(p_tenant_id::text);
  select * into saved from public.xero_financial_credit_allocations
    where operation_id=p_operation_id and tenant_id=p_tenant_id for update;
  if not found or saved.request_hash is distinct from p_request_hash or saved.reviewed_by is distinct from p_actor_id then
    raise exception 'Original credit allocation actor or evidence changed' using errcode='40001';
  end if;

  if p_transition = 'mark_sent' then
    if p_xero_allocation_id is not null or p_response_evidence is not null or saved.status <> 'processing' then
      raise exception 'Only a processing credit allocation can be marked for send' using errcode='40001';
    end if;
    if saved.send_started_at is not null then return jsonb_build_object('changed',false,'operation',to_jsonb(saved)); end if;
    update public.xero_financial_credit_allocations set send_started_at=clock_timestamp(),updated_at=clock_timestamp()
      where operation_id=p_operation_id returning * into saved;
    return jsonb_build_object('changed',true,'operation',to_jsonb(saved));
  end if;

  if p_transition is null or p_transition not in ('applied','unknown','exception','cancelled_before_send')
    or jsonb_typeof(p_response_evidence) is distinct from 'object' or p_response_evidence = '{}'::jsonb
    or ((p_transition = 'applied') <> (p_xero_allocation_id is not null))
    or (p_transition = 'applied' and (
      p_response_evidence->>'allocationId' is distinct from p_xero_allocation_id::text
      or p_response_evidence#>>'{credit,CreditNoteID}' is distinct from saved.request_evidence->>'xeroCreditId'
      or p_response_evidence#>>'{invoice,InvoiceID}' is distinct from saved.request_evidence->>'xeroInvoiceId'
      or p_response_evidence#>>'{allocation,Invoice,InvoiceID}' is distinct from saved.request_evidence->>'xeroInvoiceId'
      or p_response_evidence#>'{allocation,Amount}' is distinct from to_jsonb(saved.native_amount)
    )) then
    raise exception 'Exact credit allocation outcome evidence is required' using errcode='22023';
  end if;
  if (saved.status,saved.xero_allocation_id,saved.response_evidence)
    is not distinct from (p_transition,p_xero_allocation_id,p_response_evidence) then
    return jsonb_build_object('changed',false,'operation',to_jsonb(saved));
  end if;
  if saved.status in ('applied','cancelled_before_send')
    or (p_transition = 'cancelled_before_send' and (saved.status <> 'processing' or saved.send_started_at is not null))
    or (p_transition <> 'cancelled_before_send' and saved.send_started_at is null) then
    raise exception 'Credit allocation outcome cannot cross the original send boundary' using errcode='40001';
  end if;
  update public.xero_financial_credit_allocations set status=p_transition,xero_allocation_id=p_xero_allocation_id,
    response_evidence=p_response_evidence,updated_at=clock_timestamp()
    where operation_id=p_operation_id returning * into saved;
  return jsonb_build_object('changed',true,'operation',to_jsonb(saved));
end $$;

revoke all on function public.append_xero_credit_allocation_audit_v1() from public,anon,authenticated,service_role;
revoke all on function public.claim_xero_credit_allocation_v1(uuid,uuid,uuid,uuid,text,jsonb,text,numeric,numeric,uuid) from public,anon,authenticated;
revoke all on function public.transition_xero_credit_allocation_v1(uuid,uuid,text,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_xero_credit_allocation_v1(uuid,uuid,uuid,uuid,text,jsonb,text,numeric,numeric,uuid) to service_role;
grant execute on function public.transition_xero_credit_allocation_v1(uuid,uuid,text,uuid,text,uuid,jsonb) to service_role;
