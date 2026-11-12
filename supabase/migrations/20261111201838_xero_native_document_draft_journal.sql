begin;

create table public.xero_native_document_draft_operations (
  operation_id uuid primary key,
  tenant_id uuid not null,
  source_object text not null check (source_object in ('Invoice__c','Supplier_Invoice__c')),
  source_id text not null check (source_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  document_type text not null check (document_type in ('ACCREC','ACCPAY','ACCRECCREDIT','ACCPAYCREDIT')),
  document_number text not null check (length(document_number) between 1 and 255),
  review_fingerprint text not null check (review_fingerprint ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  request_evidence jsonb not null check (jsonb_typeof(request_evidence) = 'object'),
  actor_id uuid not null,
  status text not null default 'intent' check (status in ('intent','sent','unknown','confirmed','cancelled_before_send')),
  send_started_at timestamptz,
  observed_xero_id uuid check (observed_xero_id <> '00000000-0000-0000-0000-000000000000'),
  mapping_id uuid references public.xero_financial_document_mappings(id),
  response_evidence jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status in ('sent','unknown','confirmed')) = (send_started_at is not null)),
  check (observed_xero_id is null or send_started_at is not null),
  check ((status = 'confirmed') = (mapping_id is not null)),
  check (status <> 'confirmed' or (observed_xero_id is not null and jsonb_typeof(response_evidence) = 'object'))
);
create unique index xero_native_document_active_source
  on public.xero_native_document_draft_operations(tenant_id,source_object,left(source_id,15))
  where status <> 'cancelled_before_send';
create unique index xero_native_document_active_number
  on public.xero_native_document_draft_operations(tenant_id,document_type,lower(document_number))
  where status <> 'cancelled_before_send';
create unique index xero_native_document_observed_target
  on public.xero_native_document_draft_operations(tenant_id,observed_xero_id)
  where observed_xero_id is not null;

create table public.xero_native_document_draft_audit (
  id bigint generated always as identity primary key,
  operation_id uuid not null references public.xero_native_document_draft_operations(operation_id),
  status text not null,
  observed_xero_id uuid,
  mapping_id uuid,
  recorded_at timestamptz not null default clock_timestamp()
);
create index xero_native_document_audit_operation
  on public.xero_native_document_draft_audit(operation_id,id);

alter table public.xero_native_document_draft_operations enable row level security;
alter table public.xero_native_document_draft_operations force row level security;
alter table public.xero_native_document_draft_audit enable row level security;
alter table public.xero_native_document_draft_audit force row level security;
revoke all on public.xero_native_document_draft_operations,public.xero_native_document_draft_audit
  from public,anon,authenticated,service_role;
revoke all on sequence public.xero_native_document_draft_audit_id_seq from public,anon,authenticated,service_role;
grant select on public.xero_native_document_draft_operations,public.xero_native_document_draft_audit to service_role;
create policy xero_native_document_operation_read on public.xero_native_document_draft_operations
  for select to service_role using (true);
create policy xero_native_document_audit_read on public.xero_native_document_draft_audit
  for select to service_role using (true);

create function public.claim_xero_native_document_draft_v1(
  p_operation_id uuid,p_tenant_id uuid,p_actor_id uuid,p_request_hash text,p_review jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  saved public.xero_native_document_draft_operations;
  source_object text := p_review->>'sourceObject';
  source_id text := p_review->>'sourceId';
  payload jsonb := p_review#>'{draft,payload}';
  document_type text := payload->>'Type';
  document_number text := coalesce(payload->>'InvoiceNumber',payload->>'CreditNoteNumber');
begin
  perform public.xero_shared_assert_tenant(p_tenant_id::text);
  if p_operation_id is null or p_actor_id is null or p_review->>'tenantId' is distinct from p_tenant_id::text
      or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$'
      or coalesce(p_review->>'sourceFingerprint','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_review#>>'{draft,reviewFingerprint}','') !~ '^[a-f0-9]{64}$'
      or coalesce(source_id,'') !~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'
      or source_object is null or source_object not in ('Invoice__c','Supplier_Invoice__c')
      or document_type is null
      or (source_object,document_type) not in (('Invoice__c','ACCREC'),('Invoice__c','ACCRECCREDIT'),
        ('Supplier_Invoice__c','ACCPAY'),('Supplier_Invoice__c','ACCPAYCREDIT'))
      or nullif(trim(document_number),'') is null or length(document_number) > 255
      or payload->>'Status' is distinct from 'DRAFT'
      or coalesce(payload->>'CurrencyCode','') not in ('USD','HKD')
      or coalesce(payload#>>'{Contact,ContactID}','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      or coalesce(payload->>'Date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(payload->'LineItems') is distinct from 'array'
      or jsonb_array_length(payload->'LineItems') = 0
      or jsonb_typeof(p_review->'accountingUsd') is distinct from 'number'
      or jsonb_typeof(p_review->'nativeTotal') is distinct from 'number'
      or (p_review->>'nativeTotal')::numeric <= 0
      or p_review#>>'{draft,xeroCollection}' is distinct from
        (case when document_type in ('ACCRECCREDIT','ACCPAYCREDIT') then 'CreditNotes' else 'Invoices' end)
      or p_review#>>'{draft,status}' is distinct from 'draft_preview'
      or payload ?| array['InvoiceID','CreditNoteID','SentToContact'] then
    raise exception 'Exact native draft review evidence is required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xero.native.draft:'||p_tenant_id::text||':'||source_object||':'||left(source_id,15),0));
  select * into saved from public.xero_native_document_draft_operations where operation_id=p_operation_id for update;
  if found then
    if (saved.tenant_id,saved.actor_id,saved.request_hash,saved.request_evidence)
        is distinct from (p_tenant_id,p_actor_id,p_request_hash,p_review) then
      raise exception 'The original native document request changed' using errcode='40001';
    end if;
    return jsonb_build_object('claimed',false,'operation',to_jsonb(saved));
  end if;
  if exists (select 1 from public.xero_financial_document_mappings m
      where m.salesforce_object=source_object and m.salesforce_id like left(source_id,15)||'%') then
    raise exception 'The native source already has a document mapping' using errcode='40001';
  end if;
  insert into public.xero_native_document_draft_operations
    (operation_id,tenant_id,actor_id,source_object,source_id,document_type,document_number,review_fingerprint,request_hash,request_evidence)
  values (p_operation_id,p_tenant_id,p_actor_id,source_object,source_id,document_type,document_number,
    p_review#>>'{draft,reviewFingerprint}',p_request_hash,p_review)
  returning * into saved;
  insert into public.xero_native_document_draft_audit(operation_id,status) values(saved.operation_id,saved.status);
  return jsonb_build_object('claimed',true,'operation',to_jsonb(saved));
exception when unique_violation then
  raise exception 'The source or number already has an original native draft operation' using errcode='40001';
end $$;

create function public.transition_xero_native_document_draft_v1(
  p_operation_id uuid,p_tenant_id uuid,p_actor_id uuid,p_request_hash text,p_transition text,
  p_xero_id uuid default null,p_mapping jsonb default null,p_observed jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  saved public.xero_native_document_draft_operations;
  mapping public.xero_financial_document_mappings;
  expected jsonb;
  saved_mapping_id uuid;
  credit boolean;
begin
  perform public.xero_shared_assert_tenant(p_tenant_id::text);
  select * into saved from public.xero_native_document_draft_operations
    where operation_id=p_operation_id and tenant_id=p_tenant_id for update;
  if not found or saved.actor_id is distinct from p_actor_id or saved.request_hash is distinct from p_request_hash then
    raise exception 'The original native document operation could not be verified' using errcode='40001';
  end if;
  if p_transition = 'mark_sent' and saved.status = 'intent' then
    if exists (select 1 from public.xero_financial_document_mappings m
      where m.salesforce_object=saved.source_object and m.salesforce_id like left(saved.source_id,15)||'%') then
      raise exception 'The native source acquired a document mapping before send' using errcode='40001';
    end if;
    update public.xero_native_document_draft_operations set status='sent',send_started_at=clock_timestamp(),updated_at=clock_timestamp()
      where operation_id=p_operation_id returning * into saved;
  elsif p_transition = 'mark_sent' then
    return jsonb_build_object('changed',false,'operation',to_jsonb(saved));
  elsif p_transition = 'cancelled_before_send' and saved.status = 'intent' then
    update public.xero_native_document_draft_operations set status='cancelled_before_send',updated_at=clock_timestamp()
      where operation_id=p_operation_id returning * into saved;
  elsif p_transition = 'unknown' and saved.status = 'sent' then
    update public.xero_native_document_draft_operations set status='unknown',updated_at=clock_timestamp()
      where operation_id=p_operation_id returning * into saved;
  elsif p_transition = 'observe_id' and saved.status in ('sent','unknown') and saved.observed_xero_id is null and p_xero_id is not null then
    update public.xero_native_document_draft_operations set observed_xero_id=p_xero_id,updated_at=clock_timestamp()
      where operation_id=p_operation_id returning * into saved;
  elsif p_transition = 'confirmed' and saved.status in ('sent','unknown')
      and saved.observed_xero_id is not null and saved.observed_xero_id=p_xero_id then
    expected := saved.request_evidence#>'{draft,payload}';
    credit := saved.document_type in ('ACCRECCREDIT','ACCPAYCREDIT');
    if jsonb_typeof(p_mapping) is distinct from 'object' or jsonb_typeof(p_observed) is distinct from 'object'
        or p_observed->>(case when credit then 'CreditNoteID' else 'InvoiceID' end) is distinct from p_xero_id::text
        or p_observed->>(case when credit then 'CreditNoteNumber' else 'InvoiceNumber' end) is distinct from saved.document_number
        or p_observed->>'Status' is distinct from 'DRAFT' or p_observed->'SentToContact' = 'true'::jsonb
        or p_observed->>'Type' is distinct from saved.document_type
        or p_observed#>>'{Contact,ContactID}' is distinct from expected#>>'{Contact,ContactID}'
        or p_observed->>'CurrencyCode' is distinct from expected->>'CurrencyCode'
        or p_observed->'CurrencyRate' is distinct from coalesce(expected->'CurrencyRate','1'::jsonb)
        or p_observed->'Total' is distinct from saved.request_evidence->'nativeTotal'
        or p_observed->'SubTotal' is distinct from p_observed->'Total'
        or p_observed->'TotalTax' is distinct from '0'::jsonb
        or p_observed->>'LineAmountTypes' is distinct from 'NoTax'
        or jsonb_typeof(p_observed->'LineItems') is distinct from 'array' then
      raise exception 'The exact native Xero draft confirmation is incomplete' using errcode='22023';
    end if;
    if exists (
      (select value->'Quantity',value->'UnitAmount',value->'AccountCode',value->'TaxType'
       from jsonb_array_elements(p_observed->'LineItems')
       except all
       select value->'Quantity',value->'UnitAmount',value->'AccountCode',value->'TaxType'
       from jsonb_array_elements(expected->'LineItems'))
      union all
      (select value->'Quantity',value->'UnitAmount',value->'AccountCode',value->'TaxType'
       from jsonb_array_elements(expected->'LineItems')
       except all
       select value->'Quantity',value->'UnitAmount',value->'AccountCode',value->'TaxType'
       from jsonb_array_elements(p_observed->'LineItems'))
    ) then
      raise exception 'The observed Xero accounting lines differ from the native draft' using errcode='22023';
    end if;
    mapping := jsonb_populate_record(null::public.xero_financial_document_mappings,p_mapping);
    if mapping.salesforce_object is distinct from saved.source_object or mapping.salesforce_id is distinct from saved.source_id
        or mapping.salesforce_document_number is distinct from saved.document_number
        or mapping.xero_document_id is distinct from p_xero_id::text or mapping.xero_document_number is distinct from saved.document_number
        or mapping.document_kind is distinct from (case saved.document_type when 'ACCREC' then 'buyer_invoice'
          when 'ACCPAY' then 'supplier_bill' when 'ACCRECCREDIT' then 'buyer_credit' else 'supplier_credit' end)
        or mapping.xero_document_type is distinct from saved.document_type or mapping.xero_status is distinct from 'DRAFT'
        or mapping.xero_contact_id is distinct from expected#>>'{Contact,ContactID}'
        or mapping.source_fingerprint is distinct from saved.request_evidence->>'sourceFingerprint'
        or mapping.retained_differences->>'reviewFingerprint' is distinct from saved.review_fingerprint
        or mapping.currency is distinct from expected->>'CurrencyCode' or mapping.protected_legacy is distinct from false
        or mapping.xero_currency_rate is distinct from (p_observed->>'CurrencyRate')::numeric
        or jsonb_typeof(mapping.currency_evidence->'originalLines') is distinct from 'array'
        or jsonb_array_length(mapping.currency_evidence->'originalLines') = 0
        or mapping.currency_evidence->'nativeAmount' is distinct from p_observed->'Total'
        or mapping.accounting_usd is distinct from (saved.request_evidence->>'accountingUsd')::numeric then
      raise exception 'The proposed mapping differs from the original native draft evidence' using errcode='22023';
    end if;
    if exists (select 1 from public.xero_financial_document_mappings m where m.xero_document_id=p_xero_id::text
        or (m.salesforce_object=saved.source_object and m.salesforce_id like left(saved.source_id,15)||'%')) then
      raise exception 'The Salesforce source or Xero draft already has another mapping' using errcode='40001';
    end if;
    insert into public.xero_financial_document_mappings
      (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,
       xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,
       retained_differences,currency,accounting_usd,company_fx_rate,company_fx_revision,currency_evidence,xero_currency_rate)
    values (mapping.salesforce_object,mapping.salesforce_id,mapping.salesforce_document_number,mapping.document_kind,
      mapping.xero_document_type,mapping.xero_document_id,mapping.xero_document_number,mapping.xero_contact_id,mapping.xero_status,
      mapping.source_fingerprint,mapping.financial_fingerprint,false,mapping.retained_differences,mapping.currency,
      mapping.accounting_usd,mapping.company_fx_rate,mapping.company_fx_revision,mapping.currency_evidence,mapping.xero_currency_rate)
    returning id into saved_mapping_id;
    update public.xero_native_document_draft_operations
      set status='confirmed',mapping_id=saved_mapping_id,response_evidence=p_observed,updated_at=clock_timestamp()
      where operation_id=p_operation_id returning * into saved;
  elsif (p_transition='confirmed' and saved.status='confirmed' and saved.observed_xero_id=p_xero_id
      and saved.response_evidence=p_observed and exists (
        select 1 from public.xero_financial_document_mappings m where m.id=saved.mapping_id and to_jsonb(m) @> p_mapping))
      or (p_transition='observe_id' and saved.observed_xero_id=p_xero_id and p_xero_id is not null)
      or (p_transition=saved.status and saved.status in ('unknown','cancelled_before_send')) then
    return jsonb_build_object('changed',false,'operation',to_jsonb(saved));
  else
    raise exception 'The native draft transition conflicts with the original operation' using errcode='40001';
  end if;
  insert into public.xero_native_document_draft_audit(operation_id,status,observed_xero_id,mapping_id)
    values(saved.operation_id,saved.status,saved.observed_xero_id,saved.mapping_id);
  return jsonb_build_object('changed',true,'operation',to_jsonb(saved));
exception when unique_violation then
  raise exception 'The native document identity or mapping already has another owner' using errcode='40001';
end $$;

revoke all on function public.claim_xero_native_document_draft_v1(uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_xero_native_document_draft_v1(uuid,uuid,uuid,text,text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_xero_native_document_draft_v1(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.transition_xero_native_document_draft_v1(uuid,uuid,uuid,text,text,uuid,jsonb,jsonb) to service_role;

commit;
