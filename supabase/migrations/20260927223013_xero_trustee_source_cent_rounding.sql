-- Add bounded raw-source decimal rounding proof; legacy exact-cent receipts are unchanged.
create or replace function public.link_xero_issued_supplier_document_v1(
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
  v_round jsonb;
  v_raw_line jsonb;
  v_line jsonb;
  v_target_line jsonb;
  v_paper_line jsonb;
  v_paper_sum numeric := 0;
  v_rounded_cents numeric;
  v_decimal constant text := '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$';
  v_source jsonb;
  v_xero jsonb;
  v_summary jsonb;
  v_proof jsonb;
  v_accounting jsonb;
  v_file jsonb;
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
  v_policy constant text := 'issued_supplier_preserve_v1';
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
  v_file := v_accounting->'issuedFile';
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
    raise exception 'Complete bounded issued supplier preservation proof is required' using errcode = '22023';
  end if;
  -- The server uses stable JSON serialization; PostgreSQL jsonb text has different
  -- whitespace. Hash the supplied serialization AND verify its parsed contents.
  if (p_review->>'accountingCanonical')::jsonb is distinct from
      jsonb_build_object('policyVersion',v_policy,'accounting',v_accounting)
    or (p_review->>'evidenceCanonical')::jsonb is distinct from v_proof
    or encode(sha256(convert_to(p_review->>'accountingCanonical','UTF8')),'hex') is distinct from p_review->>'fingerprint'
    or encode(sha256(convert_to(p_review->>'evidenceCanonical','UTF8')),'hex') is distinct from p_review->>'evidenceFingerprint' then
    raise exception 'Issued supplier preservation proof fingerprint differs' using errcode = '40001';
  end if;

  -- Lock the run before its item consistently with the existing authorise path.
  select * into v_run from public.xero_financial_sync_runs where id = p_run_id for update;
  select * into v_item from public.xero_financial_sync_items where id = p_item_id and run_id = p_run_id for update;
  if v_run.id is null or v_item.id is null then
    raise exception 'Reviewed issued supplier item no longer exists' using errcode = '40001';
  end if;
  -- Only a dedicated preservation preview reviewed by this authenticated human
  -- may accept links. Keep this check before replay as well as before writes.
  if v_run.mode is distinct from 'preview'
    or v_run.control_totals->>'preservationPolicy' is distinct from v_policy
    or v_run.reviewed_by is distinct from p_actor_id
    or lower(btrim(v_run.reviewed_by_email)) is distinct from lower(btrim(p_actor_email))
    or v_run.reviewed_at is null then
    raise exception 'Issued supplier run policy or reviewed actor changed' using errcode = '40001';
  end if;
  v_source := v_item.source_payload;
  v_xero := v_item.xero_payload;
  v_summary := v_source->'issuedSupplierPreservation';
  v_canonical_source := public.xero_grouped_salesforce_id_v1(v_item.source_id);
  v_canonical_account := public.xero_grouped_salesforce_id_v1(v_source->>'accountId');
  v_target := lower(v_item.xero_document_id);
  v_contact := lower(v_xero->>'contactId');
  if v_canonical_source is null or v_canonical_account is null
    or public.xero_grouped_salesforce_id_v1(v_source->>'salesforceId') is distinct from v_canonical_source
    or v_item.source_object is distinct from 'Supplier_Invoice__c'
    or v_source->>'salesforceObject' is distinct from v_item.source_object
    or v_source->>'documentKind' is distinct from 'supplier_bill'
    or v_source->>'xeroType' is distinct from 'ACCPAY'
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
    or v_source->>'issuedSupplierReviewFingerprint' is distinct from p_review->>'reviewFingerprint'
    or v_item.proposed_action <> 'protected_legacy' or not v_item.selected
    or v_item.proposed_payload <> '{}'::jsonb or v_item.blockers <> '[]'::jsonb
    or v_item.mutation_attempts <> 0 or v_item.error_code is not null or v_item.error_message is not null then
    raise exception 'Issued supplier item or saved review changed' using errcode = '40001';
  end if;
  if v_accounting->>'tenantId' is distinct from p_tenant_id::text
    or v_accounting->'source'->>'salesforceObject' is distinct from v_item.source_object
    or v_accounting->'source'->>'salesforceId' is distinct from v_canonical_source
    or v_accounting->'source'->>'accountId' is distinct from v_canonical_account
    or v_accounting->'source'->>'contactId' is distinct from v_contact
    or v_accounting->'source'->>'sourceFingerprint' is distinct from v_source->>'sourceFingerprint'
    or v_accounting->'source'->>'financialFingerprint' is distinct from v_source->>'financialFingerprint'
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
    raise exception 'Issued supplier proof does not identify the reviewed document' using errcode = '40001';
  end if;

  -- Require the full native-document bridge, not a free-standing client flag.
  -- Provider freshness and checksum verification occur in the read-only server
  -- collector; the RPC binds its exact evidence to this source and saved review.
  if jsonb_typeof(v_file) is distinct from 'object'
    or public.xero_grouped_salesforce_id_v1(v_file->>'orgId') is distinct from
      public.xero_grouped_salesforce_id_v1(v_accounting->>'salesforceOrgId')
    or public.xero_grouped_salesforce_id_v1(v_file->>'parentId') is distinct from v_canonical_source
    or public.xero_grouped_salesforce_id_v1(v_file->'link'->>'parentId') is distinct from v_canonical_source
    or coalesce(public.xero_grouped_salesforce_id_v1(v_file->>'documentId'),'') !~ '^069[A-Za-z0-9]{12}$'
    or coalesce(public.xero_grouped_salesforce_id_v1(v_file->>'versionId'),'') !~ '^068[A-Za-z0-9]{12}$'
    or coalesce(public.xero_grouped_salesforce_id_v1(v_file->'link'->>'id'),'') !~ '^06A[A-Za-z0-9]{12}$'
    or public.xero_grouped_salesforce_id_v1(v_file->'link'->>'documentId') is distinct from
      public.xero_grouped_salesforce_id_v1(v_file->>'documentId')
    or public.xero_grouped_salesforce_id_v1(v_file->'version'->>'documentId') is distinct from
      public.xero_grouped_salesforce_id_v1(v_file->>'documentId')
    or public.xero_grouped_salesforce_id_v1(v_file->'version'->>'id') is distinct from
      public.xero_grouped_salesforce_id_v1(v_file->>'versionId')
    or public.xero_grouped_salesforce_id_v1(v_file->'version'->>'latestPublishedVersionId') is distinct from
      public.xero_grouped_salesforce_id_v1(v_file->>'versionId')
    or v_file->'version'->'isLatest' is distinct from 'true'::jsonb
    or coalesce(v_file->>'sha256','') !~ v_hash
    or coalesce(v_file->>'checksum','') !~ '^[a-f0-9]{32}$'
    or v_file->'version'->>'checksum' is distinct from v_file->>'checksum'
    or v_file->'version'->'contentSize' is distinct from v_file->'contentSize'
    or jsonb_typeof(v_file->'contentSize') is distinct from 'number'
    or coalesce(v_file->>'contentSize','') !~ '^[1-9][0-9]{0,6}$'
    or v_file->>'contentType' is distinct from 'application/pdf'
    or coalesce(v_file->'review'->>'reviewRecordHash','') !~ v_hash
    or nullif(btrim(v_file->'review'->>'reviewer'),'') is null
    or coalesce(v_file->'review'->>'reviewedAt','') !~ '^\d{4}-\d{2}-\d{2}T'
    or v_file->'review'->>'sourceNumber' is distinct from v_source->>'documentNumber'
    or coalesce(v_file->'review'->>'printedNumber','') !~ '^M-\d{2}-\d{2}-\d{3}$'
    or replace(v_file->'review'->>'printedNumber','-','') is distinct from v_source->>'documentNumber'
    or v_file->'review'->>'invoiceDate' is distinct from v_source->>'invoiceDate'
    or v_file->'review'->>'dueDate' is distinct from v_source->>'dueDate'
    or v_file->'review'->>'currency' is distinct from 'USD' then
    raise exception 'Issued native document proof does not bind this reviewed source' using errcode = '40001';
  end if;
  if (v_file->>'contentSize')::integer > 8388608 then
    raise exception 'Issued native document exceeds the supported size' using errcode = '40001';
  end if;

  -- The pure server evaluator verifies the native issued PDF, complete candidate
  -- scope and retained fields. Independently enforce this policy's narrow bill
  -- economics here; saved review hashes bind the complete evidence byte content.
  if public.xero_grouped_salesforce_id_v1(v_accounting->>'salesforceOrgId') is null
    or v_accounting->>'matchBasis' is distinct from 'issued_vessel_date_amount'
    or jsonb_typeof(v_accounting->'issuedFile') is distinct from 'object'
    or v_accounting->>'baseCurrency' is distinct from 'USD'
    or v_item.currency is distinct from 'USD'
    or v_source->>'currency' is distinct from 'USD'
    or v_xero->>'currency' is distinct from 'USD'
    or v_accounting->'source'->>'totalTax' is distinct from '0'
    or v_accounting->'xero'->>'totalTax' is distinct from '0'
    or v_accounting->'source'->'isDiscounted' is distinct from 'false'::jsonb
    or v_accounting->'xero'->'isDiscounted' is distinct from 'false'::jsonb
    or v_accounting->'source'->>'lineAmountTypes' is distinct from 'NoTax'
    or coalesce(v_accounting->'xero'->>'lineAmountTypes','') not in ('NoTax','Exclusive')
    or v_accounting->'xero'->>'currencyRate' is distinct from '1'
    or coalesce(v_accounting->'source'->>'totalCents','') !~ '^[1-9][0-9]{0,14}$'
    or v_accounting->'source'->>'subtotalCents' is distinct from v_accounting->'source'->>'totalCents'
    or v_accounting->'source'->>'signedTotalCents' is distinct from v_accounting->'source'->>'totalCents'
    or v_accounting->'xero'->>'subtotalCents' is distinct from v_accounting->'source'->>'totalCents'
    or v_accounting->'xero'->>'totalCents' is distinct from v_accounting->'source'->>'totalCents'
    or v_proof->'observations'->>'amountDueCents' is distinct from v_accounting->'source'->>'totalCents'
    or v_proof->'observations'->>'amountPaidCents' is distinct from '0'
    or v_proof->'observations'->>'amountCreditedCents' is distinct from '0'
    or jsonb_typeof(v_accounting->'source'->'lines') is distinct from 'array'
    or jsonb_typeof(v_accounting->'xero'->'lines') is distinct from 'array' then
    raise exception 'Issued supplier proof is outside preservation policy' using errcode = '40001';
  end if;
  if jsonb_array_length(v_accounting->'source'->'lines') <> 1
    or jsonb_array_length(v_accounting->'xero'->'lines') <> 1
    or (v_accounting->'source'->>'totalCents')::numeric <> v_item.source_total * 100
    or exists (
      select 1 from jsonb_array_elements((v_accounting->'source'->'lines') || (v_accounting->'xero'->'lines')) line
      where line->>'accountCode' is distinct from '51106'
        or line->>'taxType' is distinct from 'NONE'
        or line->>'taxAmount' is distinct from '0'
        or line->>'discountRate' is distinct from '0'
        or line->>'discountAmount' is distinct from '0'
        or line->'tracking' is distinct from '[]'::jsonb
        or line->>'itemCode' is distinct from ''
        or line->>'lineAmountCents' is distinct from v_accounting->'source'->>'totalCents'
    ) then
    raise exception 'Issued supplier accounting lines changed' using errcode = '40001';
  end if;

  -- Normal previews omit groupedAccounting. The dedicated server persists only
  -- these four raw line fields when the evaluator derives the versioned marker.
  -- Both observations are bound by the immutable reviewed fingerprints above.
  v_line := v_accounting->'source'->'lines'->0;
  if v_accounting->'xero'->'lines'->0 ? 'centRounding' then
    raise exception 'Trustee rounding is source-only' using errcode = '40001';
  end if;
  if v_line ? 'centRounding' or v_source ? 'issuedSupplierRoundingSource' then
    v_round := v_line->'centRounding';
    v_raw_line := v_source->'issuedSupplierRoundingSource';
    if jsonb_typeof(v_round) is distinct from 'object'
      or jsonb_typeof(v_raw_line) is distinct from 'object'
      or v_round - array['policy','rawLineAmount','roundedLineAmountCents'] is distinct from '{}'::jsonb
      or v_raw_line - array['id','quantity','unitAmount','lineAmount'] is distinct from '{}'::jsonb
      or v_round->>'policy' is distinct from 'trustee_source_decimal_half_up_v1'
      or coalesce(v_round->>'rawLineAmount','') !~ v_decimal
      or jsonb_typeof(v_round->'rawLineAmount') is distinct from 'string'
      or coalesce(v_round->>'roundedLineAmountCents','') !~ '^[1-9][0-9]{0,13}$'
      or jsonb_typeof(v_round->'roundedLineAmountCents') is distinct from 'string'
      or coalesce(v_raw_line->>'lineAmount','') !~ v_decimal
      or coalesce(v_raw_line->>'quantity','') !~ v_decimal
      or coalesce(v_raw_line->>'unitAmount','') !~ v_decimal
      or coalesce(v_line->>'quantity','') !~ v_decimal
      or coalesce(v_line->>'unitAmount','') !~ v_decimal
      or public.xero_grouped_salesforce_id_v1(v_raw_line->>'id') is null
      or public.xero_grouped_salesforce_id_v1(v_raw_line->>'id') is distinct from v_line->>'id'
      or public.xero_grouped_salesforce_id_v1(v_source->'lines'->0->>'sourceId') is distinct from v_line->>'id' then
      raise exception 'Trustee raw source rounding evidence is incomplete' using errcode = '40001';
    end if;
    v_rounded_cents := round((v_raw_line->>'lineAmount')::numeric,2) * 100;
    if (v_raw_line->>'quantity')::numeric <= 0 or (v_raw_line->>'unitAmount')::numeric <= 0
      or (v_raw_line->>'lineAmount')::numeric <= 0
      or trunc((v_raw_line->>'lineAmount')::numeric * 100) = (v_raw_line->>'lineAmount')::numeric * 100
      or (v_raw_line->>'lineAmount')::numeric is distinct from (v_round->>'rawLineAmount')::numeric
      or (v_raw_line->>'quantity')::numeric is distinct from (v_line->>'quantity')::numeric
      or (v_raw_line->>'unitAmount')::numeric is distinct from (v_line->>'unitAmount')::numeric
      or (v_raw_line->>'lineAmount')::numeric <> (v_raw_line->>'quantity')::numeric * (v_raw_line->>'unitAmount')::numeric
      or v_rounded_cents <> round((v_raw_line->>'quantity')::numeric * (v_raw_line->>'unitAmount')::numeric,2) * 100
      or v_rounded_cents <= 0 or v_rounded_cents > 99999999999999
      or v_round->>'roundedLineAmountCents' is distinct from v_line->>'lineAmountCents'
      or v_rounded_cents <> (v_round->>'roundedLineAmountCents')::numeric then
      raise exception 'Trustee raw source product or cent amount differs' using errcode = '40001';
    end if;
    -- Independently retain exact paper and actual Xero amounts: neither may use
    -- the new source-only rounding rule, even if a forged proof is rehashed.
    if coalesce(v_file->'review'->>'total','') !~ v_decimal
      or coalesce(v_file->'review'->>'totalTax','') !~ v_decimal
      or jsonb_typeof(v_file->'review'->'lines') is distinct from 'array' then
      raise exception 'Trustee printed cent amounts are incomplete' using errcode = '40001';
    end if;
    if jsonb_array_length(v_file->'review'->'lines') < 1 or jsonb_array_length(v_file->'review'->'lines') > 50
      or (v_file->'review'->>'total')::numeric * 100 <> v_rounded_cents
      or (v_file->'review'->>'totalTax')::numeric <> 0 then
      raise exception 'Trustee printed header differs' using errcode = '40001';
    end if;
    for v_paper_line in select value from jsonb_array_elements(v_file->'review'->'lines') loop
      if coalesce(v_paper_line->>'amount','') !~ v_decimal then
        raise exception 'Trustee printed line amount is invalid' using errcode = '40001';
      end if;
      if (v_paper_line->>'amount')::numeric <= 0
        or (v_paper_line->>'amount')::numeric * 100 <> trunc((v_paper_line->>'amount')::numeric * 100) then
        raise exception 'Trustee printed line requires exact cents' using errcode = '40001';
      end if;
      v_paper_sum := v_paper_sum + (v_paper_line->>'amount')::numeric * 100;
    end loop;
    if v_paper_sum <> v_rounded_cents
      or jsonb_typeof(v_xero->'lineItems') is distinct from 'array'
      or v_accounting->'xero'->'rawLineItems' is distinct from v_xero->'lineItems' then
      raise exception 'Trustee printed sum or raw Xero evidence differs' using errcode = '40001';
    end if;
    if jsonb_array_length(v_xero->'lineItems') <> 1 then
      raise exception 'Trustee raw Xero line count changed' using errcode = '40001';
    end if;
    v_target_line := v_xero->'lineItems'->0;
    if coalesce(v_target_line->>'LineAmount','') !~ v_decimal then
      raise exception 'Trustee raw Xero amount is invalid' using errcode = '40001';
    end if;
    if (v_target_line->>'LineAmount')::numeric * 100 <> v_rounded_cents then
      raise exception 'Trustee raw Xero amount requires matching exact cents' using errcode = '40001';
    end if;
  end if;

  if (v_source->>'invoiceDate')::date < v_run.cutoff_date then
    raise exception 'Issued supplier invoice is outside the reviewed accounting-date scope' using errcode = '40001';
  end if;

  -- Bind the proof to the current primary tenant without reading credential fields.
  select tenant_id into v_tenant from public.xero_contact_sync_connections where id = 'primary' for share;
  if lower(v_tenant) is distinct from p_tenant_id::text then
    raise exception 'Xero tenant changed after review' using errcode = '40001';
  end if;
  if jsonb_typeof(v_accounting->'productMappings') is distinct from 'array' then
    raise exception 'Reviewed product mappings are required' using errcode = '22023';
  end if;
  if jsonb_array_length(v_accounting->'productMappings') <> 1
    or (select count(distinct value->>'id') from jsonb_array_elements(v_accounting->'productMappings'))
      <> jsonb_array_length(v_accounting->'productMappings') then
    raise exception 'Reviewed product mapping identities must be unique and bounded' using errcode = '22023';
  end if;
  if v_accounting->'source'->'lines'->0->>'productId' is distinct from
    v_accounting->'productMappings'->0->>'salesforceProductId' then
    raise exception 'Issued supplier line has a different product mapping' using errcode = '40001';
  end if;
  for v_product_proof in select value from jsonb_array_elements(v_accounting->'productMappings') order by value->>'id' loop
    v_count := 0;
    for v_product in select * from public.xero_financial_product_mappings
      where direction = 'supplier'
        and left(salesforce_product_id,15) = v_product_proof->>'salesforceProductId' order by id for share loop
      v_count := v_count + 1;
      if v_product_proof is distinct from jsonb_build_object('id',v_product.id,'direction',v_product.direction,
        'salesforceProductId',public.xero_grouped_salesforce_id_v1(v_product.salesforce_product_id),
        'xeroAccountCode',v_product.xero_account_code,'xeroTaxType',v_product.xero_tax_type,
        'enabled',v_product.enabled,'revision',v_product.revision) or not v_product.enabled or v_product.xero_account_code <> '51106' or v_product.xero_tax_type <> 'NONE' then
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
    'reviewFingerprint',p_review->'legacyReviewFingerprint','issuedSupplierPreservation',
    (p_review - 'accountingCanonical' - 'evidenceCanonical' - 'acceptance') || jsonb_build_object('acceptance',v_acceptance,'reviewedXero',v_xero));
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
        and event_type = 'issued_supplier_document_preservation_linked' and outcome = 'success'
        and record_counts = '{"linked":1,"applied":0,"financialWrites":0}'::jsonb
        and actor_id = p_actor_id and actor_email = lower(btrim(p_actor_email))
        and fingerprints = jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,
          'mappingId',v_mapping.id,'issuedSupplierPreservation',v_retained->'issuedSupplierPreservation')
    ) then
      raise exception 'Completed issued supplier link cannot be confirmed as the identical acceptance' using errcode = '40001';
    end if;
    return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',true);
  end if;
  if v_run.status <> 'processing' or v_run.revision <> p_expected_run_revision
    or v_run.reviewed_by is null or v_run.reviewed_at is null
    or v_item.status <> 'selected' or v_item.updated_at is distinct from p_expected_item_updated_at
    or v_item.applied_at is not null or v_mapping_count <> 0 then
    raise exception 'Issued supplier run or item revision changed after review' using errcode = '40001';
  end if;

  insert into public.xero_financial_document_mappings (
    salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,
    xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,
    retained_differences,last_reconciled_at,created_at,updated_at
  ) values (v_item.source_object,v_source->>'salesforceId',v_source->>'documentNumber',v_source->>'documentKind',
    v_source->>'xeroType',v_target,v_xero->>'invoiceNumber',v_contact,'AUTHORISED',v_source->>'sourceFingerprint',
    v_source->>'financialFingerprint',true,v_retained,v_now,v_now,v_now) returning * into v_mapping;
  insert into public.xero_financial_audit_events (run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
  values (p_run_id,'issued_supplier_document_preservation_linked','success',p_actor_id,lower(btrim(p_actor_email)),
    '{"linked":1,"applied":0,"financialWrites":0}',jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,
      'mappingId',v_mapping.id,'issuedSupplierPreservation',v_retained->'issuedSupplierPreservation'));
  update public.xero_financial_sync_items set status = 'linked', applied_at = v_now, updated_at = v_now
    where id = p_item_id;
  return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',false);
end;
$$;

revoke all on function public.link_xero_issued_supplier_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.link_xero_issued_supplier_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) to service_role;
comment on function public.link_xero_issued_supplier_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) is
  'Service-only insert of reviewed issued supplier preservation, immutable proof, actor audit and selected item outcome in one transaction; no provider writes.';
