-- Explicitly reviewed, reference-only links. This RPC never writes to Xero.
alter table public.xero_financial_payment_mappings
  add column if not exists retained_reference jsonb not null default '{}'::jsonb;

-- Salesforce's 15/18-character forms and UUID casing cannot create a second owner.
-- Existing conflicts fail this migration rather than rewriting any accounting identity.
create unique index if not exists xero_financial_payment_mappings_canonical_sf_uidx
  on public.xero_financial_payment_mappings (left(salesforce_payment_id, 15))
  where salesforce_payment_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$';
create unique index if not exists xero_financial_payment_mappings_canonical_xero_uidx
  on public.xero_financial_payment_mappings (lower(xero_payment_id))
  where xero_payment_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create or replace function public.link_xero_payment_references_v1(
  p_tenant_id uuid, p_rows jsonb, p_actor_id uuid, p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_reviewed jsonb;
  v_proof jsonb;
  v_journal jsonb;
  v_canonical text;
  v_key text;
  v_mapping public.xero_financial_payment_mappings;
  v_document public.xero_financial_document_mappings;
  v_bank public.xero_financial_bank_mappings;
  v_claim public.xero_financial_sync_runs;
  v_claim_id uuid;
  v_outcomes jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_tenant_id is null or p_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_actor_id is null or p_actor_id = '00000000-0000-0000-0000-000000000000'::uuid
    or nullif(btrim(p_actor_email), '') is null
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Verified tenant, actor and reviewed payment array are required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 25 then
    raise exception 'Review exactly one to 25 payment links' using errcode = '22023';
  end if;
  if (select count(distinct left(value->>'salesforcePaymentId',15)) from jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows)
    or (select count(distinct lower(value->>'xeroPaymentId')) from jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows) then
    raise exception 'Duplicate payment identity in reviewed batch' using errcode = '22023';
  end if;

  -- Order overlapping batches consistently; the shared unique posting key is the
  -- serialization barrier against both another link and the existing POST path.
  for v_row in select value from jsonb_array_elements(p_rows) order by left(value->>'salesforcePaymentId',15) loop
    if jsonb_typeof(v_row) is distinct from 'object'
      or coalesce(v_row->>'salesforcePaymentId','') !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
      or nullif(btrim(v_row->>'salesforcePaymentName'),'') is null
      or coalesce(v_row->>'documentMappingId','') !~ v_uuid_pattern
      or coalesce(v_row->>'xeroPaymentId','') !~ v_uuid_pattern
      or coalesce(v_row->>'bankAccountId','') !~ v_uuid_pattern
      or coalesce(v_row->>'currency','') !~ '^[A-Z]{3}$'
      or coalesce(v_row->>'paymentDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_row->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
      or coalesce(v_row->>'referenceReviewFingerprint','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(v_row->'amount') is distinct from 'number'
      or jsonb_typeof(v_row->'retainedReferenceEvidence') is distinct from 'object'
      or v_row->'retainedReferenceEvidence' = '{}'::jsonb
      or octet_length((v_row->'retainedReferenceEvidence')::text) > 65536 then
      raise exception 'Incomplete reviewed payment-reference evidence' using errcode = '22023';
    end if;
    if (v_row->>'amount')::numeric <= 0 or (v_row->>'amount')::numeric >= 1e14
      or (v_row->>'amount')::numeric <> round((v_row->>'amount')::numeric,6)
      or (v_row->>'paymentDate')::date::text <> v_row->>'paymentDate'
      or (v_row->>'documentMappingId')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      or (v_row->>'xeroPaymentId')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      or (v_row->>'bankAccountId')::uuid = '00000000-0000-0000-0000-000000000000'::uuid then
      raise exception 'Invalid reviewed payment value or identity' using errcode = '22023';
    end if;
    v_canonical := left(v_row->>'salesforcePaymentId',15);
    -- Byte-equivalent to paymentPostingKey(): JSON.stringify([lower(tenant),canonicalSFID]).
    v_key := 'payment-post:' || encode(sha256(convert_to('["' || p_tenant_id::text || '","' || v_canonical || '"]','UTF8')),'hex');
    if (v_row->>'idempotencyKey') is distinct from v_key then
      raise exception 'Payment claim identity does not match the verified tenant and source' using errcode = '22023';
    end if;
    v_reviewed := v_row - 'idempotencyKey';
    v_proof := jsonb_build_object('version',1,'tenantId',p_tenant_id::text,
      'sourceFingerprint',v_row->>'sourceFingerprint','referenceReviewFingerprint',v_row->>'referenceReviewFingerprint',
      'evidence',v_row->'retainedReferenceEvidence');
    v_journal := jsonb_build_object('state','reference_linked','tenantId',p_tenant_id::text,
      'paymentId',v_canonical,'reviewed',v_reviewed,'confirmedPaymentId',v_row->>'xeroPaymentId',
      'observedPaymentIds',jsonb_build_array(v_row->>'xeroPaymentId'),'evidence',v_row->'retainedReferenceEvidence');

    v_claim_id := null;
    insert into public.xero_financial_sync_runs (idempotency_key,mode,status,source_fingerprint,
      control_totals,classification_summary,created_by,created_by_email,reviewed_by,reviewed_by_email,
      reviewed_at,completed_at,created_at,updated_at)
    values (v_key,'payment_apply','completed',v_row->>'sourceFingerprint',jsonb_build_object('paymentPosting',v_journal),
      '{"linked":1,"failed":0,"applied":0}',p_actor_id,lower(btrim(p_actor_email)),p_actor_id,lower(btrim(p_actor_email)),
      v_now,v_now,v_now,v_now)
    on conflict (idempotency_key) do nothing returning id into v_claim_id;

    select * into v_claim from public.xero_financial_sync_runs where idempotency_key=v_key for update;
    -- Recheck the exact saved document and approved bank snapshots under locks;
    -- a provider re-read alone cannot detect a concurrent local mapping edit.
    select * into v_document from public.xero_financial_document_mappings
      where id=(v_row->>'documentMappingId')::uuid for share;
    if v_document.id is null or (v_row->'retainedReferenceEvidence'->'documentMapping') is distinct from
      jsonb_build_object('id',v_document.id,'salesforce_object',v_document.salesforce_object,
        'salesforce_id',v_document.salesforce_id,'xero_document_id',v_document.xero_document_id,
        'xero_document_type',v_document.xero_document_type,'xero_contact_id',v_document.xero_contact_id,
        'source_fingerprint',v_document.source_fingerprint,'retained_differences',v_document.retained_differences,
        'protected_legacy',v_document.protected_legacy) then
      raise exception 'Reviewed document mapping changed' using errcode='40001';
    end if;
    if coalesce(v_row->'retainedReferenceEvidence'->'bankMapping'->>'id','') !~ v_uuid_pattern then
      raise exception 'Approved bank mapping snapshot is required' using errcode='22023';
    end if;
    select * into v_bank from public.xero_financial_bank_mappings
      where id=(v_row->'retainedReferenceEvidence'->'bankMapping'->>'id')::uuid for share;
    if v_bank.id is null or not v_bank.enabled or v_bank.xero_bank_account_id <> v_row->>'bankAccountId'
      or (v_row->'retainedReferenceEvidence'->'bankMapping') is distinct from
        jsonb_build_object('id',v_bank.id,'salesforce_bank_name',v_bank.salesforce_bank_name,
          'xero_bank_account_id',v_bank.xero_bank_account_id,'revision',v_bank.revision,'enabled',v_bank.enabled) then
      raise exception 'Reviewed bank mapping changed' using errcode='40001';
    end if;

    select * into v_mapping from public.xero_financial_payment_mappings
      where left(salesforce_payment_id,15)=v_canonical or lower(xero_payment_id)=v_row->>'xeroPaymentId'
      order by id limit 1 for update;
    if v_claim_id is null then
      -- Only the identical completed reference-link operation is a retry. A prior
      -- posting intent, uncertain result, other target or changed proof is never replaced.
      if v_claim.id is null or v_claim.mode <> 'payment_apply' or v_claim.status <> 'completed'
        or v_claim.error_code is not null or v_claim.error_message is not null
        or v_claim.source_fingerprint is distinct from v_row->>'sourceFingerprint'
        or ((v_claim.control_totals->'paymentPosting') - 'reviewed') is distinct from (v_journal - 'reviewed')
        or ((v_claim.control_totals->'paymentPosting'->'reviewed') - 'salesforcePaymentId') is distinct from (v_reviewed - 'salesforcePaymentId')
        or left(v_claim.control_totals->'paymentPosting'->'reviewed'->>'salesforcePaymentId',15) is distinct from v_canonical
        or v_mapping.id is null or left(v_mapping.salesforce_payment_id,15) <> v_canonical
        or v_mapping.salesforce_payment_name is distinct from v_row->>'salesforcePaymentName'
        or v_mapping.document_mapping_id <> (v_row->>'documentMappingId')::uuid
        or v_mapping.xero_payment_id <> v_row->>'xeroPaymentId'
        or v_mapping.xero_bank_account_id is distinct from v_row->>'bankAccountId'
        or v_mapping.amount <> (v_row->>'amount')::numeric or v_mapping.currency <> v_row->>'currency'
        or v_mapping.payment_date <> (v_row->>'paymentDate')::date
        or v_mapping.source_fingerprint <> v_row->>'sourceFingerprint'
        or v_mapping.status <> 'linked' or v_mapping.exception_reason is not null
        or v_mapping.retained_reference is distinct from v_proof then
        raise exception 'Existing payment claim or ownership differs from this reviewed link' using errcode='40001';
      end if;
    else
      if v_mapping.id is not null then
        raise exception 'A Salesforce or Xero payment already has an owner' using errcode='40001';
      end if;
      insert into public.xero_financial_payment_mappings (salesforce_payment_id,salesforce_payment_name,document_mapping_id,
        xero_payment_id,xero_bank_account_id,source_fingerprint,amount,currency,payment_date,status,retained_reference,
        last_reconciled_at,created_at,updated_at)
      values (v_row->>'salesforcePaymentId',v_row->>'salesforcePaymentName',(v_row->>'documentMappingId')::uuid,
        v_row->>'xeroPaymentId',v_row->>'bankAccountId',v_row->>'sourceFingerprint',(v_row->>'amount')::numeric,
        v_row->>'currency',(v_row->>'paymentDate')::date,'linked',v_proof,v_now,v_now,v_now)
      returning * into v_mapping;
      insert into public.xero_financial_audit_events (run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
      values (v_claim_id,'payment_reference_linked','success',p_actor_id,lower(btrim(p_actor_email)),
        '{"linked":1,"applied":0,"financialWrites":0}',
        jsonb_build_object('tenantId',p_tenant_id::text,'paymentId',v_canonical,'source',v_row->>'sourceFingerprint',
          'review',v_row->>'referenceReviewFingerprint','retainedReference',v_proof,'idempotencyKey',v_key));
    end if;
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object('salesforcePaymentId',v_row->>'salesforcePaymentId',
      'xeroPaymentId',v_row->>'xeroPaymentId','status','linked','alreadyLinked',v_claim_id is null,
      'mappingId',v_mapping.id,'paymentPostingClaimId',v_claim.id));
  end loop;
  return jsonb_build_object('outcomes',v_outcomes);
end;
$$;

revoke all on function public.link_xero_payment_references_v1(uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.link_xero_payment_references_v1(uuid,jsonb,uuid,text) to service_role;

comment on column public.xero_financial_payment_mappings.retained_reference is
  'Explicit Finance review proof for linking an existing payment while retaining its different Xero reference; never authorizes posting.';
comment on function public.link_xero_payment_references_v1(uuid,jsonb,uuid,text) is
  'Service-only atomic reference-link mapping, posting barrier and actor audit; unchanged retries only, no provider writes.';
