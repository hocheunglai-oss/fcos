-- Finance-reviewed preservation links only. No provider mutation is performed.
-- Conflicting historical aliases fail deployment; never pick or rewrite an owner.
-- Start is the existing atomic gate BEFORE provider reads and document POSTs.
-- Serialize document runs so no already-classified ordinary writer can race a
-- grouped acceptance. An interrupted processing run stays closed; no expiry.
create unique index if not exists xero_financial_one_processing_document_run_uidx
  on public.xero_financial_sync_runs ((true))
  where status = 'processing' and mode in ('preview','document_apply');

create unique index if not exists xero_financial_documents_canonical_sf_uidx
  on public.xero_financial_document_mappings (salesforce_object, left(salesforce_id, 15))
  where salesforce_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$';
create unique index if not exists xero_financial_documents_canonical_xero_uidx
  on public.xero_financial_document_mappings (lower(xero_document_id))
  where xero_document_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create unique index if not exists xero_financial_products_canonical_sf_uidx
  on public.xero_financial_product_mappings (direction, left(salesforce_product_id, 15))
  where salesforce_product_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$';

-- Validate the case-sensitive Salesforce identity and its optional checksum.
create or replace function public.xero_grouped_salesforce_id_v1(p_id text)
returns text language plpgsql immutable strict security invoker
set search_path = public, pg_temp
as $$
declare
  v_suffix text := '';
  v_mask integer;
  v_chunk integer;
  v_bit integer;
begin
  if p_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' then return null; end if;
  if length(p_id) = 18 then
    for v_chunk in 0..2 loop
      v_mask := 0;
      for v_bit in 0..4 loop
        if substr(p_id, v_chunk * 5 + v_bit + 1, 1) ~ '^[A-Z]$' then
          v_mask := v_mask + (1 << v_bit);
        end if;
      end loop;
      v_suffix := v_suffix || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', v_mask + 1, 1);
    end loop;
    if right(p_id, 3) <> v_suffix then return null; end if;
  end if;
  return left(p_id, 15);
end;
$$;
revoke all on function public.xero_grouped_salesforce_id_v1(text) from public, anon, authenticated;
grant execute on function public.xero_grouped_salesforce_id_v1(text) to service_role;

-- An ordinary mapping upsert must never erase acceptance or turn a preserved
-- document into an update candidate. Ordinary legacy mappings are unaffected.
create or replace function public.protect_xero_grouped_mapping_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
  if old.retained_differences ? 'groupedPreservation' then
    if tg_op = 'DELETE' then
      raise exception 'Accepted grouped document preservation cannot be deleted' using errcode = '40001';
    end if;
    if (to_jsonb(new) - 'last_reconciled_at' - 'updated_at') is distinct from
      (to_jsonb(old) - 'last_reconciled_at' - 'updated_at') then
      raise exception 'Accepted grouped document preservation is immutable' using errcode = '40001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.protect_xero_grouped_mapping_v1() from public, anon, authenticated;
grant execute on function public.protect_xero_grouped_mapping_v1() to service_role;
drop trigger if exists protect_xero_grouped_mapping on public.xero_financial_document_mappings;
create trigger protect_xero_grouped_mapping before update or delete
  on public.xero_financial_document_mappings for each row
  execute function public.protect_xero_grouped_mapping_v1();

create or replace function public.link_xero_grouped_document_v1(
  p_run_id uuid, p_expected_run_revision integer, p_item_id uuid,
  p_expected_item_updated_at timestamptz, p_tenant_id uuid, p_review jsonb,
  p_actor_id uuid, p_actor_email text
)
returns jsonb language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.xero_financial_sync_runs;
  v_item public.xero_financial_sync_items;
  v_mapping public.xero_financial_document_mappings;
  v_product public.xero_financial_product_mappings;
  v_product_proof jsonb;
  v_source jsonb;
  v_xero jsonb;
  v_summary jsonb;
  v_proof jsonb;
  v_accounting jsonb;
  v_retained jsonb;
  v_acceptance jsonb;
  v_expected_mapping jsonb;
  v_tenant text;
  v_canonical_source text;
  v_canonical_account text;
  v_target text;
  v_contact text;
  v_count integer;
  v_mapping_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_hash constant text := '^[0-9a-f]{64}$';
  v_policy constant text := 'positive_many_to_one_v1';
begin
  if p_run_id is null or p_item_id is null or p_expected_run_revision is null or p_expected_run_revision < 1
    or p_expected_item_updated_at is null or p_tenant_id is null
    or p_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_actor_id is null or p_actor_id = '00000000-0000-0000-0000-000000000000'::uuid
    or nullif(btrim(p_actor_email), '') is null or length(p_actor_email) > 320
    or jsonb_typeof(p_review) is distinct from 'object' then
    raise exception 'Verified actor, tenant and reviewed item identity are required' using errcode = '22023';
  end if;
  v_proof := p_review->'evidence';
  v_accounting := v_proof->'accounting';
  if p_review->>'policyVersion' is distinct from v_policy
    or v_proof->>'policyVersion' is distinct from v_policy
    or coalesce(p_review->>'fingerprint', '') !~ v_hash
    or coalesce(p_review->>'evidenceFingerprint', '') !~ v_hash
    or coalesce(p_review->>'reviewFingerprint', '') !~ v_hash
    or coalesce(p_review->>'legacyReviewFingerprint', '') !~ v_hash
    or jsonb_typeof(v_proof) is distinct from 'object'
    or jsonb_typeof(v_accounting) is distinct from 'object'
    or jsonb_typeof(p_review->'accountingCanonical') is distinct from 'string'
    or jsonb_typeof(p_review->'evidenceCanonical') is distinct from 'string'
    or octet_length(p_review::text) > 400000
    or octet_length(p_review->>'accountingCanonical') > 100000
    or octet_length(p_review->>'evidenceCanonical') > 100000 then
    raise exception 'Complete bounded grouped preservation proof is required' using errcode = '22023';
  end if;
  -- The server uses stable JSON serialization; PostgreSQL jsonb text has different
  -- whitespace. Hash the supplied serialization AND verify its parsed contents.
  if (p_review->>'accountingCanonical')::jsonb is distinct from
      jsonb_build_object('policyVersion',v_policy,'accounting',v_accounting)
    or (p_review->>'evidenceCanonical')::jsonb is distinct from v_proof
    or encode(sha256(convert_to(p_review->>'accountingCanonical','UTF8')),'hex') is distinct from p_review->>'fingerprint'
    or encode(sha256(convert_to(p_review->>'evidenceCanonical','UTF8')),'hex') is distinct from p_review->>'evidenceFingerprint' then
    raise exception 'Grouped preservation proof fingerprint differs' using errcode = '40001';
  end if;

  -- Lock the run before its item consistently with the existing authorise path.
  select * into v_run from public.xero_financial_sync_runs where id = p_run_id for update;
  select * into v_item from public.xero_financial_sync_items where id = p_item_id and run_id = p_run_id for update;
  if v_run.id is null or v_item.id is null then
    raise exception 'Reviewed grouped item no longer exists' using errcode = '40001';
  end if;
  v_source := v_item.source_payload;
  v_xero := v_item.xero_payload;
  v_summary := v_source->'groupedPreservation';
  v_canonical_source := public.xero_grouped_salesforce_id_v1(v_item.source_id);
  v_canonical_account := public.xero_grouped_salesforce_id_v1(v_source->>'accountId');
  v_target := lower(v_item.xero_document_id);
  v_contact := lower(v_xero->>'contactId');
  if v_canonical_source is null or v_canonical_account is null
    or public.xero_grouped_salesforce_id_v1(v_source->>'salesforceId') is distinct from v_canonical_source
    or v_item.source_object not in ('Invoice__c','Supplier_Invoice__c')
    or v_source->>'salesforceObject' is distinct from v_item.source_object
    or v_source->>'documentKind' is distinct from (case when v_item.source_object = 'Invoice__c' then 'buyer_invoice' else 'supplier_bill' end)
    or v_source->>'xeroType' is distinct from (case when v_item.source_object = 'Invoice__c' then 'ACCREC' else 'ACCPAY' end)
    or v_source->>'xeroCollection' is distinct from 'Invoices'
    or v_item.source_type is distinct from v_source->>'documentKind'
    or v_item.source_document_number is distinct from v_source->>'documentNumber'
    or coalesce(v_source->>'sourceFingerprint', '') !~ v_hash
    or coalesce(v_source->>'financialFingerprint', '') !~ v_hash
    or coalesce(v_target, '') !~ v_uuid or v_target = '00000000-0000-0000-0000-000000000000'
    or coalesce(v_contact, '') !~ v_uuid or v_contact = '00000000-0000-0000-0000-000000000000'
    or lower(v_xero->>'id') is distinct from v_target
    or lower(v_source->>'contactId') is distinct from v_contact
    or v_xero->>'type' is distinct from v_source->>'xeroType'
    or v_xero->>'status' is distinct from 'AUTHORISED'
    or v_item.xero_document_status is distinct from 'AUTHORISED'
    or v_summary->>'policyVersion' is distinct from v_policy
    or v_summary->'eligible' is distinct from 'true'::jsonb
    or v_summary->'accepted' is distinct from 'false'::jsonb
    or v_summary->'requiresExplicitReview' is distinct from 'true'::jsonb
    or v_summary->>'fingerprint' is distinct from p_review->>'fingerprint'
    or v_summary->>'evidenceFingerprint' is distinct from p_review->>'evidenceFingerprint'
    or v_source->>'groupedReviewFingerprint' is distinct from p_review->>'reviewFingerprint'
    or v_item.proposed_action <> 'protected_legacy' or not v_item.selected
    or v_item.proposed_payload <> '{}'::jsonb or v_item.blockers <> '[]'::jsonb
    or v_item.mutation_attempts <> 0 or v_item.error_code is not null or v_item.error_message is not null then
    raise exception 'Grouped item or saved review changed' using errcode = '40001';
  end if;
  if v_accounting->>'tenantId' is distinct from p_tenant_id::text
    or v_accounting->'source'->>'salesforceObject' is distinct from v_item.source_object
    or v_accounting->'source'->>'salesforceId' is distinct from v_canonical_source
    or v_accounting->'source'->>'accountId' is distinct from v_canonical_account
    or v_accounting->'source'->>'contactId' is distinct from v_contact
    or v_accounting->'source'->>'sourceFingerprint' is distinct from v_source->>'sourceFingerprint'
    or v_accounting->'source'->>'documentNumber' is distinct from v_source->>'documentNumber'
    or coalesce(v_source->>'invoiceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or v_accounting->'source'->>'invoiceDate' is distinct from v_source->>'invoiceDate'
    or v_accounting->'xero'->>'date' is distinct from v_source->>'invoiceDate'
    or v_xero->>'date' is distinct from v_source->>'invoiceDate'
    or v_accounting->'source'->>'type' is distinct from v_source->>'xeroType'
    or v_accounting->'source'->>'collection' is distinct from 'Invoices'
    or v_accounting->'xero'->>'id' is distinct from v_target
    or v_accounting->'xero'->>'contactId' is distinct from v_contact
    or v_accounting->'xero'->>'type' is distinct from v_source->>'xeroType'
    or v_accounting->'xero'->>'collection' is distinct from 'Invoices'
    or v_accounting->'xero'->>'invoiceNumber' is distinct from v_xero->>'invoiceNumber'
    or v_accounting->'source'->>'currency' is distinct from v_item.currency
    or v_accounting->'xero'->>'currency' is distinct from v_item.currency
    or v_proof->'observations'->>'status' is distinct from 'AUTHORISED'
    or v_proof->'observations'->'ownership' is distinct from '{"kind":"unlinked"}'::jsonb then
    raise exception 'Grouped proof does not identify the reviewed document' using errcode = '40001';
  end if;

  if (v_source->>'invoiceDate')::date < v_run.cutoff_date then
    raise exception 'Grouped invoice is outside the reviewed accounting-date scope' using errcode = '40001';
  end if;

  -- Bind the proof to the current primary tenant without reading credential fields.
  select tenant_id into v_tenant from public.xero_contact_sync_connections where id = 'primary' for share;
  if lower(v_tenant) is distinct from p_tenant_id::text then
    raise exception 'Xero tenant changed after review' using errcode = '40001';
  end if;
  if jsonb_typeof(v_accounting->'productMappings') is distinct from 'array' then
    raise exception 'Reviewed product mappings are required' using errcode = '22023';
  end if;
  if jsonb_array_length(v_accounting->'productMappings') not between 1 and 50
    or (select count(distinct value->>'id') from jsonb_array_elements(v_accounting->'productMappings'))
      <> jsonb_array_length(v_accounting->'productMappings') then
    raise exception 'Reviewed product mapping identities must be unique and bounded' using errcode = '22023';
  end if;
  for v_product_proof in select value from jsonb_array_elements(v_accounting->'productMappings') order by value->>'id' loop
    v_count := 0;
    for v_product in select * from public.xero_financial_product_mappings
      where direction = case when v_item.source_object = 'Invoice__c' then 'buyer' else 'supplier' end
        and left(salesforce_product_id,15) = v_product_proof->>'salesforceProductId' order by id for share loop
      v_count := v_count + 1;
      if v_product_proof is distinct from jsonb_build_object('id',v_product.id,'direction',v_product.direction,
        'salesforceProductId',public.xero_grouped_salesforce_id_v1(v_product.salesforce_product_id),
        'xeroAccountCode',v_product.xero_account_code,'xeroTaxType',v_product.xero_tax_type,
        'enabled',v_product.enabled,'revision',v_product.revision) or not v_product.enabled then
        raise exception 'Approved product mapping changed after review' using errcode = '40001';
      end if;
    end loop;
    if v_count <> 1 then
      raise exception 'Approved product mapping ownership is missing or ambiguous' using errcode = '40001';
    end if;
  end loop;

  v_acceptance := jsonb_build_object('runId',p_run_id,'itemId',p_item_id,'runRevision',p_expected_run_revision,
    'itemUpdatedAt',p_expected_item_updated_at,'actorId',p_actor_id,'actorEmail',lower(btrim(p_actor_email)));
  v_retained := jsonb_build_object('differences',v_item.differences,'stemId',v_source->'stemId','accountId',v_source->'accountId',
    'reviewFingerprint',p_review->'legacyReviewFingerprint','groupedPreservation',
    (p_review - 'accountingCanonical' - 'evidenceCanonical' - 'acceptance') || jsonb_build_object('acceptance',v_acceptance));
  v_expected_mapping := jsonb_build_object('salesforce_object',v_item.source_object,'salesforce_id',v_source->>'salesforceId',
    'salesforce_document_number',v_source->>'documentNumber','document_kind',v_source->>'documentKind',
    'xero_document_type',v_source->>'xeroType','xero_document_id',v_target,'xero_document_number',v_xero->>'invoiceNumber',
    'xero_contact_id',v_contact,'xero_status','AUTHORISED','source_fingerprint',v_source->>'sourceFingerprint',
    'financial_fingerprint',v_source->>'financialFingerprint','protected_legacy',true,'retained_differences',v_retained);

  -- Existing ordinary writers do not take advisory locks. The unique indexes
  -- provide the authoritative race barrier; inserts that lose roll back fully.
  for v_mapping in select * from public.xero_financial_document_mappings
    where (salesforce_object = v_item.source_object and left(salesforce_id,15) = v_canonical_source)
      or lower(xero_document_id) = v_target order by id for update loop
    v_mapping_count := v_mapping_count + 1;
    if v_item.status <> 'linked' or
      (to_jsonb(v_mapping) - 'id' - 'last_reconciled_at' - 'created_at' - 'updated_at') is distinct from v_expected_mapping then
      raise exception 'Salesforce or Xero document already has a different owner or acceptance' using errcode = '40001';
    end if;
  end loop;
  if v_item.status = 'linked' then
    if v_mapping_count <> 1 or v_item.applied_at is null or not exists (
      select 1 from public.xero_financial_audit_events where run_id = p_run_id
        and event_type = 'grouped_document_preservation_linked' and outcome = 'success'
        and actor_id = p_actor_id and actor_email = lower(btrim(p_actor_email))
        and fingerprints = jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,
          'mappingId',v_mapping.id,'groupedPreservation',v_retained->'groupedPreservation')
    ) then
      raise exception 'Completed grouped link cannot be confirmed as the identical acceptance' using errcode = '40001';
    end if;
    return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',true);
  end if;
  if v_run.mode not in ('preview','document_apply')
    or v_run.status <> 'processing' or v_run.revision <> p_expected_run_revision
    or v_run.reviewed_by is null or v_run.reviewed_at is null
    or v_item.status <> 'selected' or v_item.updated_at is distinct from p_expected_item_updated_at
    or v_item.applied_at is not null or v_mapping_count <> 0 then
    raise exception 'Grouped run or item revision changed after review' using errcode = '40001';
  end if;

  insert into public.xero_financial_document_mappings (
    salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,
    xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,
    retained_differences,last_reconciled_at,created_at,updated_at
  ) values (v_item.source_object,v_source->>'salesforceId',v_source->>'documentNumber',v_source->>'documentKind',
    v_source->>'xeroType',v_target,v_xero->>'invoiceNumber',v_contact,'AUTHORISED',v_source->>'sourceFingerprint',
    v_source->>'financialFingerprint',true,v_retained,v_now,v_now,v_now) returning * into v_mapping;
  insert into public.xero_financial_audit_events (run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
  values (p_run_id,'grouped_document_preservation_linked','success',p_actor_id,lower(btrim(p_actor_email)),
    '{"linked":1,"applied":0,"financialWrites":0}',jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,
      'mappingId',v_mapping.id,'groupedPreservation',v_retained->'groupedPreservation'));
  update public.xero_financial_sync_items set status = 'linked', applied_at = v_now, updated_at = v_now
    where id = p_item_id;
  return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',false);
end;
$$;

revoke all on function public.link_xero_grouped_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.link_xero_grouped_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) to service_role;
comment on function public.link_xero_grouped_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) is
  'Service-only insert of reviewed grouped preservation, immutable proof, actor audit and selected item outcome in one transaction; no provider writes.';
