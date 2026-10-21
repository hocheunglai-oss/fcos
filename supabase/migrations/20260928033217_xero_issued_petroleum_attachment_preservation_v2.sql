-- Additive preserve-only policy. The existing v1 RPC and receipts are unchanged.
-- Current native bytes and complete link scope are verified by the server collector;
-- this boundary independently validates and binds the entire immutable manifest.
create or replace function public.xero_issued_petroleum_attachment_manifest_v2(p_manifest jsonb, p_file jsonb)
returns boolean language plpgsql immutable security invoker
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
  v_link text;
  v_document text;
  v_version text;
  v_previous text := '';
  v_links text[] := '{}';
  v_documents text[] := '{}';
  v_versions text[] := '{}';
  v_selected integer := 0;
  v_size numeric;
  v_key text;
begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or jsonb_typeof(p_file) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_manifest)) <> 4
    or not (p_manifest ?& array['complete','selectedDocumentId','selectedVersionId','entries'])
    or p_manifest->'complete' is distinct from 'true'::jsonb
    or jsonb_typeof(p_manifest->'selectedDocumentId') is distinct from 'string'
    or jsonb_typeof(p_manifest->'selectedVersionId') is distinct from 'string'
    or public.xero_grouped_salesforce_id_v1(p_manifest->>'selectedDocumentId') is null
    or public.xero_grouped_salesforce_id_v1(p_manifest->>'selectedVersionId') is null
    or public.xero_grouped_salesforce_id_v1(p_manifest->>'selectedDocumentId') is distinct from public.xero_grouped_salesforce_id_v1(p_file->>'documentId')
    or public.xero_grouped_salesforce_id_v1(p_manifest->>'selectedVersionId') is distinct from public.xero_grouped_salesforce_id_v1(p_file->>'versionId')
    or jsonb_typeof(p_manifest->'entries') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_manifest->'entries') not between 1 and 20 then return false; end if;
  for v_entry in select value from jsonb_array_elements(p_manifest->'entries') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(v_entry)) <> 10
      or not (v_entry ?& array['linkId','documentId','versionId','sha256','checksum','contentSize','fileType','fileExtension','role','reviewRecordHash'])
      then return false; end if;
    foreach v_key in array array['linkId','documentId','versionId','sha256','checksum','fileType','fileExtension','role','reviewRecordHash'] loop
      if jsonb_typeof(v_entry->v_key) is distinct from 'string' then return false; end if;
    end loop;
    v_link := public.xero_grouped_salesforce_id_v1(v_entry->>'linkId');
    v_document := public.xero_grouped_salesforce_id_v1(v_entry->>'documentId');
    v_version := public.xero_grouped_salesforce_id_v1(v_entry->>'versionId');
    if coalesce(v_link,'') !~ '^06A[A-Za-z0-9]{12}$'
      or coalesce(v_document,'') !~ '^069[A-Za-z0-9]{12}$'
      or coalesce(v_version,'') !~ '^068[A-Za-z0-9]{12}$'
      or v_link collate "C" <= v_previous collate "C"
      or v_link = any(v_links) or v_document = any(v_documents) or v_version = any(v_versions)
      or v_entry->>'sha256' !~ '^[a-f0-9]{64}$'
      or v_entry->>'checksum' !~ '^[a-f0-9]{32}$'
      or v_entry->>'reviewRecordHash' !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(v_entry->'contentSize') is distinct from 'number'
      or v_entry->>'fileType' is distinct from 'PDF' or v_entry->>'fileExtension' is distinct from 'pdf'
      or v_entry->>'role' not in ('issued_invoice','duplicate_selected_invoice','delivery_receipt','order_confirmation','terms')
      then return false; end if;
    v_size := (v_entry->>'contentSize')::numeric;
    if v_size <> trunc(v_size) or v_size not between 5 and 5000000 then return false; end if;
    v_previous := v_link;
    v_links := array_append(v_links,v_link); v_documents := array_append(v_documents,v_document); v_versions := array_append(v_versions,v_version);
    if v_entry->>'role' = 'issued_invoice' then
      v_selected := v_selected + 1;
      if v_link is distinct from public.xero_grouped_salesforce_id_v1(p_file->'link'->>'id')
        or v_document is distinct from public.xero_grouped_salesforce_id_v1(p_file->>'documentId')
        or v_version is distinct from public.xero_grouped_salesforce_id_v1(p_file->>'versionId')
        or v_entry->'sha256' is distinct from p_file->'sha256'
        or v_entry->'checksum' is distinct from p_file->'checksum'
        or v_entry->'contentSize' is distinct from p_file->'contentSize'
        or v_entry->'reviewRecordHash' is distinct from p_file->'review'->'reviewRecordHash' then return false; end if;
    elsif v_document = public.xero_grouped_salesforce_id_v1(p_file->>'documentId')
      or v_version = public.xero_grouped_salesforce_id_v1(p_file->>'versionId') then return false;
    end if;
    if v_entry->>'role' = 'duplicate_selected_invoice' and (
      v_entry->'sha256' is distinct from p_file->'sha256' or v_entry->'checksum' is distinct from p_file->'checksum'
      or v_entry->'contentSize' is distinct from p_file->'contentSize') then return false; end if;
  end loop;
  return v_selected = 1;
end;
$$;
revoke all on function public.xero_issued_petroleum_attachment_manifest_v2(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.xero_issued_petroleum_attachment_manifest_v2(jsonb,jsonb) to service_role;
comment on function public.xero_issued_petroleum_attachment_manifest_v2(jsonb,jsonb) is
  'Service-only strict validation of the complete bounded v2 native attachment manifest and selected invoice binding.';

-- Same atomic actor, ownership, settlement, locking, replay and immutable audit
-- boundary as the latest v1 RPC. Only the explicit policy, documentary dates,
-- metric unit notation and required attachment proof differ.
create or replace function public.link_xero_issued_petroleum_document_v2(
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
  v_file jsonb;
  v_delivery jsonb;
  v_paper_line jsonb;
  v_line jsonb;
  v_scope jsonb;
  v_contact_identity jsonb;
  v_ownership jsonb;
  v_owner_contact jsonb;
  v_owner jsonb;
  v_selected_owner jsonb;
  v_owner_ids jsonb := '[]'::jsonb;
  v_queried_ids jsonb := '[]'::jsonb;
  v_id_entry jsonb;
  v_previous_id text;
  v_owner_name text;
  v_owner_key text;
  v_contact_name text;
  v_selected_key text;
  v_claim text;
  v_owner_canonical text := '';
  v_literal jsonb;
  v_space constant text := U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+';
  v_ownership_canonical text;
  v_ownership_policy constant text := 'document_specific_inactive_source_owners_v1';
  v_decimal constant text := '^(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$';
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
  v_policy constant text := 'issued_petroleum_preserve_v2';
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
  v_delivery := v_accounting->'deliveryIdentity';
  v_scope := v_accounting->'identityScope';
  v_contact_identity := v_accounting->'contactIdentity';
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
    raise exception 'Complete bounded issued petroleum preservation proof is required' using errcode = '22023';
  end if;
  -- The server uses stable JSON serialization; PostgreSQL jsonb text has different
  -- whitespace. Hash the supplied serialization AND verify its parsed contents.
  if (p_review->>'accountingCanonical')::jsonb is distinct from
      jsonb_build_object('policyVersion',v_policy,'accounting',v_accounting)
    or (p_review->>'evidenceCanonical')::jsonb is distinct from v_proof
    or encode(sha256(convert_to(p_review->>'accountingCanonical','UTF8')),'hex') is distinct from p_review->>'fingerprint'
    or encode(sha256(convert_to(p_review->>'evidenceCanonical','UTF8')),'hex') is distinct from p_review->>'evidenceFingerprint' then
    raise exception 'Issued petroleum preservation proof fingerprint differs' using errcode = '40001';
  end if;

  -- Lock the run before its item consistently with the existing authorise path.
  select * into v_run from public.xero_financial_sync_runs where id = p_run_id for update;
  select * into v_item from public.xero_financial_sync_items where id = p_item_id and run_id = p_run_id for update;
  if v_run.id is null or v_item.id is null then
    raise exception 'Reviewed issued petroleum item no longer exists' using errcode = '40001';
  end if;
  -- Only a dedicated preservation preview reviewed by this authenticated human
  -- may accept links. Keep this check before replay as well as before writes.
  if v_run.mode is distinct from 'preview'
    or v_run.control_totals->>'preservationPolicy' is distinct from v_policy
    or v_run.reviewed_by is distinct from p_actor_id
    or lower(btrim(v_run.reviewed_by_email)) is distinct from lower(btrim(p_actor_email))
    or v_run.reviewed_at is null then
    raise exception 'Issued petroleum run policy or reviewed actor changed' using errcode = '40001';
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
    or nullif(btrim(v_source->>'documentNumber'),'') is null
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
    raise exception 'Issued petroleum item or saved review changed' using errcode = '40001';
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
    or coalesce(v_source->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(v_xero->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or v_accounting->'source'->>'invoiceDate' is distinct from v_source->>'invoiceDate'
    or v_accounting->'source'->>'dueDate' is distinct from v_source->>'dueDate'
    or v_accounting->'xero'->>'date' is distinct from v_delivery->>'deliveryDate'
    or v_xero->>'date' is distinct from v_delivery->>'deliveryDate'
    or v_accounting->'xero'->>'dueDate' is distinct from v_xero->>'dueDate'
    or v_accounting->'xero'->>'reference' is distinct from v_xero->>'reference'
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
    raise exception 'Issued petroleum proof does not identify the reviewed document' using errcode = '40001';
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
    or (
      (v_file->'review'->>'numberRule' = 'exact' and v_file->'review'->>'printedNumber' = v_source->>'documentNumber')
      or (v_file->'review'->>'numberRule' = 'reviewed_ascii_hyphens'
        and coalesce(v_file->'review'->>'printedNumber','') ~ '^[A-Za-z0-9-]+$'
        and coalesce(v_source->>'documentNumber','') ~ '^[A-Za-z0-9]+$'
        and position('-' in v_file->'review'->>'printedNumber') > 0
        and replace(v_file->'review'->>'printedNumber','-','') = v_source->>'documentNumber')
    ) is not true
    or not (v_file->'review' ? 'invoiceDate')
    or not (v_file->'review' ? 'dueDate')
    or (v_file->'review'->'invoiceDate' is distinct from 'null'::jsonb
      and (jsonb_typeof(v_file->'review'->'invoiceDate') is distinct from 'string'
        or v_file->'review'->>'invoiceDate' is distinct from v_source->>'invoiceDate'))
    or (v_file->'review'->'dueDate' is distinct from 'null'::jsonb
      and (jsonb_typeof(v_file->'review'->'dueDate') is distinct from 'string'
        or v_file->'review'->>'dueDate' is distinct from v_source->>'dueDate'))
    or public.xero_issued_petroleum_attachment_manifest_v2(v_file->'attachmentManifest',v_file) is not true
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
    or v_accounting->>'matchBasis' is distinct from 'issued_petroleum_vessel_delivery_amount'
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
    raise exception 'Issued petroleum proof is outside preservation policy' using errcode = '40001';
  end if;
  if jsonb_array_length(v_accounting->'source'->'lines') <> 1
    or jsonb_array_length(v_accounting->'xero'->'lines') <> 1
    or (v_accounting->'source'->>'totalCents')::numeric <> v_item.source_total * 100
    or exists (
      select 1 from jsonb_array_elements((v_accounting->'source'->'lines') || (v_accounting->'xero'->'lines')) line
      where line->>'accountCode' is distinct from '51100'
        or line->>'taxType' is distinct from 'NONE'
        or line->>'taxAmount' is distinct from '0'
        or line->>'discountRate' is distinct from '0'
        or line->>'discountAmount' is distinct from '0'
        or line->'tracking' is distinct from '[]'::jsonb
        or line->>'itemCode' is distinct from ''
        or line->>'lineAmountCents' is distinct from v_accounting->'source'->>'totalCents'
    ) then
    raise exception 'Issued petroleum accounting lines changed' using errcode = '40001';
  end if;

  -- The paper-to-delivery bridge is intentionally separate from the trustee
  -- same-invoice-date rule. Every association is to this exact saved source.
  if jsonb_typeof(v_delivery) is distinct from 'object'
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'parentId') is distinct from v_canonical_source
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'supplierId') is distinct from v_canonical_account
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'stemId') is null
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'stemId') is distinct from public.xero_grouped_salesforce_id_v1(v_source->>'stemId')
    or v_accounting->'source'->>'stemId' is distinct from public.xero_grouped_salesforce_id_v1(v_delivery->>'stemId')
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'vesselId') is null
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'childId') is null
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'childId') is distinct from v_accounting->'source'->'lines'->0->>'id'
    or public.xero_grouped_salesforce_id_v1(v_delivery->>'productId') is distinct from v_accounting->'source'->'lines'->0->>'productId'
    or coalesce(v_delivery->>'productId','') !~ '^01t[A-Za-z0-9]{12}$'
    or v_delivery->>'productRecordType' is distinct from 'Petroleum_Product'
    or nullif(btrim(v_delivery->>'productName'),'') is null
    or coalesce(v_delivery->>'stemKey','') !~ '^HK[0-9]+[A-Z]$'
    or v_delivery->>'stemKey' is distinct from v_source->>'stemKey'
    or coalesce(v_delivery->>'sourceFactsFingerprint','') !~ v_hash
    or coalesce(v_delivery->>'deliveryDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or v_delivery->>'deliveryDate' is distinct from v_source->>'deliveryDate'
    or nullif(btrim(v_delivery->>'vessel'),'') is null
    or v_accounting->'source'->>'vessel' is distinct from v_delivery->>'vessel'
    or regexp_replace(btrim(v_file->'review'->>'vessel'),'\s+',' ','g') is distinct from v_delivery->>'vessel'
    or coalesce(v_xero->>'invoiceNumber','') !~ '^[0-9]+P-.+$'
    or regexp_replace(btrim(regexp_replace(v_xero->>'invoiceNumber','^[0-9]+P-','')),'\s+',' ','g') is distinct from v_delivery->>'vessel'
    or (v_file->'review'->'deliveryDate' is distinct from 'null'::jsonb
      and v_file->'review'->>'deliveryDate' is distinct from v_delivery->>'deliveryDate')
    or exists (select 1 from regexp_matches(coalesce(v_xero->>'reference',''),'\mHK[0-9]+[A-Z]\M','gi') claim
      where upper(claim[1]) is distinct from v_delivery->>'stemKey')
    or jsonb_typeof(v_source->'blockers') is distinct from 'array'
    or jsonb_typeof(v_source->'readiness'->'blockers') is distinct from 'array'
    or jsonb_typeof(v_source->'readiness'->'linkedChildren') is distinct from 'array'
    or jsonb_typeof(v_file->'review'->'lines') is distinct from 'array'
    or jsonb_typeof(v_accounting->'xero'->'rawLineItems') is distinct from 'array'
    or v_accounting->'xero'->'rawLineItems' is distinct from coalesce(v_xero->'lineItems',v_xero->'rawLineItems')
    or jsonb_typeof(v_accounting->'xero'->'unowned') is distinct from 'object'
    or v_accounting->'xero'->'unowned' is distinct from v_xero->'unowned' then
    raise exception 'Petroleum delivery, vessel or native-line bridge changed' using errcode = '40001';
  end if;
  if jsonb_array_length(v_source->'readiness'->'linkedChildren') <> 1
    or public.xero_grouped_salesforce_id_v1(v_source->'readiness'->'linkedChildren'->>0) is distinct from v_delivery->>'childId'
    or jsonb_array_length(v_file->'review'->'lines') <> 1
    or jsonb_array_length(v_accounting->'xero'->'rawLineItems') <> 1
    or exists (select 1 from jsonb_array_elements((v_source->'blockers') || (v_source->'readiness'->'blockers')) blocker
      where blocker is distinct from '"Supplier invoice has no verified issued source file."'::jsonb) then
    raise exception 'Petroleum preservation requires one exact issued obligation and line' using errcode = '40001';
  end if;
  v_paper_line := v_file->'review'->'lines'->0;
  if v_delivery->>'unit' is distinct from 'MT' or coalesce(v_paper_line->>'unit','') not in ('MT','MTS','METRIC TON','METRIC TONS','METRIC TONNE','METRIC TONNES')
    or public.xero_grouped_salesforce_id_v1(v_paper_line->>'sourceProductId') is distinct from v_delivery->>'productId'
    or v_paper_line->>'sourceProductName' is distinct from v_delivery->>'productName'
    or nullif(btrim(v_paper_line->>'productEvidence'),'') is null
    or nullif(btrim(v_paper_line->>'description'),'') is null
    or coalesce(v_paper_line->>'quantity','') !~ v_decimal
    or coalesce(v_paper_line->>'unitPrice','') !~ v_decimal
    or coalesce(v_paper_line->>'amount','') !~ v_decimal
    or coalesce(v_file->'review'->>'total','') !~ v_decimal
    or v_delivery->>'quantity' is distinct from v_accounting->'source'->'lines'->0->>'quantity'
    or v_delivery->>'unitAmount' is distinct from v_accounting->'source'->'lines'->0->>'unitAmount'
    or v_delivery->>'lineAmountCents' is distinct from v_accounting->'source'->>'totalCents'
    or coalesce(v_file->'review'->>'taxEvidence','') not in ('no_tax_line_or_increment_observed','explicit_zero_tax')
    or (v_file->'review'->>'taxEvidence' = 'no_tax_line_or_increment_observed' and v_file->'review'->'totalTax' is distinct from 'null'::jsonb)
    or (v_file->'review'->>'taxEvidence' = 'explicit_zero_tax' and coalesce(v_file->'review'->>'totalTax','') !~ '^0([.]0{1,8})?$') then
    raise exception 'Petroleum issued physical quantity, product or tax evidence changed' using errcode = '40001';
  end if;
  for v_line in select value from jsonb_array_elements((v_accounting->'source'->'lines') || (v_accounting->'xero'->'lines')) loop
    if coalesce(v_line->>'quantity','') !~ v_decimal or coalesce(v_line->>'unitAmount','') !~ v_decimal then
      raise exception 'Petroleum line decimals are invalid' using errcode = '40001';
    end if;
    if (v_line->>'quantity')::numeric <= 0 or (v_line->>'unitAmount')::numeric <= 0
      or round((v_line->>'quantity')::numeric * (v_line->>'unitAmount')::numeric * 100,0)
        <> (v_accounting->'source'->>'totalCents')::numeric then
      raise exception 'Petroleum physical line arithmetic differs from authoritative cents' using errcode = '40001';
    end if;
  end loop;
  if (v_paper_line->>'quantity')::numeric <> (v_delivery->>'quantity')::numeric
    or (v_paper_line->>'unitPrice')::numeric <> (v_delivery->>'unitAmount')::numeric
    or (v_paper_line->>'amount')::numeric * 100 <> (v_accounting->'source'->>'totalCents')::numeric
    or (v_file->'review'->>'total')::numeric * 100 <> (v_accounting->'source'->>'totalCents')::numeric then
    raise exception 'Petroleum paper and source economics differ' using errcode = '40001';
  end if;
  -- Bind normalized proof to the complete retained provider line and the saved
  -- settlement/header snapshot. Exact decimals avoid binary half-cent drift.
  v_line := v_accounting->'xero'->'rawLineItems'->0;
  if lower(v_line->>'LineItemID') is distinct from v_accounting->'xero'->'lines'->0->>'id'
    or coalesce(lower(v_line->>'LineItemID'),'') !~ v_uuid
    or coalesce(v_line->>'Quantity','') !~ v_decimal
    or coalesce(v_line->>'UnitAmount','') !~ v_decimal
    or coalesce(v_line->>'LineAmount','') !~ v_decimal
    or v_line->>'AccountCode' is distinct from '51100' or v_line->>'TaxType' is distinct from 'NONE'
    or coalesce(v_line->>'TaxAmount','') !~ '^0([.]0{1,8})?$'
    or coalesce(v_line->>'DiscountRate','0') !~ '^0([.]0{1,8})?$'
    or coalesce(v_line->>'DiscountAmount','0') !~ '^0([.]0{1,8})?$'
    or coalesce(v_line->'Tracking','[]'::jsonb) is distinct from '[]'::jsonb
    or coalesce(v_line->>'ItemCode','') <> ''
    or coalesce(v_source->>'total','') !~ v_decimal
    or coalesce(v_xero->>'total','') !~ v_decimal
    or coalesce(v_xero->>'amountDue','') !~ v_decimal
    or coalesce(v_xero->>'amountPaid','') !~ '^0([.]0{1,8})?$'
    or coalesce(v_xero->>'amountCredited','') !~ '^0([.]0{1,8})?$'
    or v_accounting->'xero'->'settlementEvidence'->>'basis' is distinct from 'complete_invoice_zero_balances_optional_collections_v1'
    or exists (select 1 from unnest(array['Payments','CreditNotes','Prepayments','Overpayments']) key
      where jsonb_typeof(v_accounting->'xero'->'settlementEvidence'->'collections'->key->'present') is distinct from 'boolean'
        or v_accounting->'xero'->'settlementEvidence'->'collections'->key->'rows' is distinct from '[]'::jsonb)
    or v_item.source_total is null then
    raise exception 'Petroleum retained raw line or settlement snapshot is invalid' using errcode = '40001';
  end if;
  if (v_line->>'Quantity')::numeric <> (v_accounting->'xero'->'lines'->0->>'quantity')::numeric
    or (v_line->>'UnitAmount')::numeric <> (v_accounting->'xero'->'lines'->0->>'unitAmount')::numeric
    or (v_line->>'LineAmount')::numeric * 100 <> (v_accounting->'xero'->>'totalCents')::numeric
    or (v_source->>'total')::numeric is distinct from v_item.source_total
    or (v_xero->>'total')::numeric is distinct from v_item.source_total
    or (v_xero->>'amountDue')::numeric is distinct from v_item.source_total then
    raise exception 'Petroleum retained raw line or unpaid amount differs' using errcode = '40001';
  end if;

  if jsonb_typeof(v_scope) is distinct from 'object'
    or coalesce(v_scope->>'coverageFingerprint','') !~ v_hash
    or jsonb_typeof(v_scope->'sourceIds') is distinct from 'array'
    or jsonb_typeof(v_scope->'targetIds') is distinct from 'array'
    or jsonb_typeof(v_scope->'sourceNumberIds') is distinct from 'array'
    or jsonb_typeof(v_scope->'targetNumberIds') is distinct from 'array'
    or v_contact_identity->>'salesforceAccountId' is distinct from v_canonical_account
    or v_contact_identity->>'xeroContactId' is distinct from v_contact
    or v_contact_identity->>'status' is distinct from 'ACTIVE'
    or coalesce(v_contact_identity->>'matchBasis','') not in ('account_name','company_key')
    or nullif(btrim(v_contact_identity->>'sourceMatchValue'),'') is null
    or v_contact_identity->>'sourceMatchValue' is distinct from v_contact_identity->>'xeroMatchValue'
    or coalesce(v_contact_identity->>'evidenceFingerprint','') !~ v_hash then
    raise exception 'Petroleum complete document or Contact identity scope is invalid' using errcode = '40001';
  end if;
  if jsonb_array_length(v_scope->'sourceIds') <> 1 or jsonb_array_length(v_scope->'targetIds') <> 1
    or jsonb_array_length(v_scope->'sourceNumberIds') <> 1 or jsonb_array_length(v_scope->'targetNumberIds') > 1
    or public.xero_grouped_salesforce_id_v1(v_scope->'sourceIds'->>0) is distinct from v_canonical_source
    or public.xero_grouped_salesforce_id_v1(v_scope->'sourceNumberIds'->>0) is distinct from v_canonical_source
    or lower(v_scope->'targetIds'->>0) is distinct from v_target
    or (jsonb_array_length(v_scope->'targetNumberIds') = 1 and lower(v_scope->'targetNumberIds'->>0) is distinct from v_target) then
    raise exception 'Petroleum document identity is not unique in the reviewed scope' using errcode = '40001';
  end if;
  -- Presence dispatch is deliberate: old singleton receipts have neither key.
  -- A null, partial or unknown marker cannot inherit singleton semantics.
  if (v_accounting ? 'identityOwnershipPolicy') or (v_accounting ? 'identityOwnership') then
    v_ownership := v_accounting->'identityOwnership';
    if jsonb_typeof(v_accounting->'identityOwnershipPolicy') is distinct from 'string'
      or v_accounting->>'identityOwnershipPolicy' is distinct from v_ownership_policy
      or jsonb_typeof(v_ownership) is distinct from 'object' then
      raise exception 'Petroleum ownership discriminator is invalid' using errcode = '40001';
    end if;
    if v_ownership - array['selectedAccountId','contactId','owners','contact','sourceAccountIds',
        'queriedSourceAccountIds','accountContactFingerprint','allYearsCoverageFingerprint'] <> '{}'::jsonb
      or jsonb_typeof(v_ownership->'selectedAccountId') is distinct from 'string'
      or jsonb_typeof(v_ownership->'contactId') is distinct from 'string'
      or jsonb_typeof(v_ownership->'accountContactFingerprint') is distinct from 'string'
      or jsonb_typeof(v_ownership->'allYearsCoverageFingerprint') is distinct from 'string'
      or v_ownership->>'selectedAccountId' is distinct from v_canonical_account
      or v_ownership->>'contactId' is distinct from v_contact
      or coalesce(v_ownership->>'accountContactFingerprint','') !~ v_hash
      or v_ownership->>'allYearsCoverageFingerprint' is distinct from v_scope->>'coverageFingerprint'
      or jsonb_typeof(v_ownership->'owners') is distinct from 'array'
      or jsonb_typeof(v_ownership->'sourceAccountIds') is distinct from 'array'
      or jsonb_typeof(v_ownership->'queriedSourceAccountIds') is distinct from 'array'
      or jsonb_typeof(v_ownership->'contact') is distinct from 'object' then
      raise exception 'Petroleum ownership proof is incomplete or unbound' using errcode = '40001';
    end if;
    if jsonb_array_length(v_ownership->'owners') not between 2 and 25
      or jsonb_array_length(v_ownership->'queriedSourceAccountIds') not between 2 and 625 then
      raise exception 'Petroleum ownership proof exceeds its bounded scope' using errcode = '40001';
    end if;
    v_owner_contact := v_ownership->'contact';
    if v_owner_contact - array['id','name','status','contactNumber','accountNumber'] <> '{}'::jsonb
      or v_owner_contact->>'id' is distinct from v_contact
      or v_owner_contact->>'status' is distinct from 'ACTIVE'
      or jsonb_typeof(v_owner_contact->'name') is distinct from 'string'
      or jsonb_typeof(v_owner_contact->'contactNumber') is distinct from 'string'
      or jsonb_typeof(v_owner_contact->'accountNumber') is distinct from 'string'
      or nullif(btrim(v_owner_contact->>'name'),'') is null then
      raise exception 'Petroleum ownership Contact identity is invalid' using errcode = '40001';
    end if;
    for v_literal in select value from jsonb_each(v_owner_contact) loop
      if jsonb_typeof(v_literal) is distinct from 'string' or length(v_literal#>>'{}') > 1000
        or (v_literal#>>'{}') ~ '[[:cntrl:]]' then
        raise exception 'Petroleum ownership Contact literals are invalid' using errcode = '40001';
      end if;
    end loop;
    v_contact_name := upper(btrim(regexp_replace(v_owner_contact->>'name',v_space,' ','g')));
    if v_contact_name = '' then
      raise exception 'Petroleum ownership Contact name is blank' using errcode = '40001';
    end if;
    v_previous_id := null;
    for v_owner in select value from jsonb_array_elements(v_ownership->'owners') loop
      if jsonb_typeof(v_owner) is distinct from 'object' then
        raise exception 'Petroleum ownership Account row is invalid' using errcode = '40001';
      end if;
      if v_owner - array['id','name','companyCode','recordType','inactiveSuspended'] <> '{}'::jsonb
        or jsonb_typeof(v_owner->'id') is distinct from 'string'
        or coalesce(v_owner->>'id','') !~ '^001[A-Za-z0-9]{12}$'
        or public.xero_grouped_salesforce_id_v1(v_owner->>'id') is distinct from v_owner->>'id'
        or jsonb_typeof(v_owner->'name') is distinct from 'string'
        or nullif(btrim(v_owner->>'name'),'') is null
        or jsonb_typeof(v_owner->'companyCode') is distinct from 'string'
        or jsonb_typeof(v_owner->'recordType') is distinct from 'string'
        or jsonb_typeof(v_owner->'inactiveSuspended') is distinct from 'boolean'
        or (v_previous_id is not null and v_previous_id collate "C" >= (v_owner->>'id') collate "C") then
        raise exception 'Petroleum ownership Accounts must be canonical, ordered and explicit' using errcode = '40001';
      end if;
      for v_literal in select value from jsonb_each(v_owner - 'inactiveSuspended') loop
        if jsonb_typeof(v_literal) is distinct from 'string' or length(v_literal#>>'{}') > 1000
          or (v_literal#>>'{}') ~ '[[:cntrl:]]' then
          raise exception 'Petroleum ownership Account literals are invalid' using errcode = '40001';
        end if;
      end loop;
      v_owner_name := upper(btrim(regexp_replace(v_owner->>'name',v_space,' ','g')));
      v_owner_key := upper(btrim(regexp_replace(v_owner->>'companyCode',v_space,' ','g')));
      v_owner_key := case when left(v_owner_key,2) = 'HK' then btrim(substr(v_owner_key,3)) else '' end;
      if v_owner_name = '' or (v_owner_name <> v_contact_name and (v_owner_key = '' or v_owner_key <> v_contact_name)) then
        raise exception 'Petroleum retained Account is not an exact potential Contact owner' using errcode = '40001';
      end if;
      v_previous_id := v_owner->>'id';
      if v_owner->>'id' = v_canonical_account then
        if v_owner->'inactiveSuspended' is distinct from 'false'::jsonb
          or v_owner->>'name' is distinct from v_source->>'accountName'
          or v_owner->>'companyCode' is distinct from v_source->>'companyCode' then
          raise exception 'Petroleum selected owner differs from the active source' using errcode = '40001';
        end if;
        if v_owner_key = '' then
          raise exception 'Petroleum selected owner has no own HK key' using errcode = '40001';
        end if;
        v_selected_owner := v_owner;
        v_selected_key := upper(btrim(regexp_replace(v_owner->>'companyCode',v_space,' ','g')));
      elsif v_owner->'inactiveSuspended' is distinct from 'true'::jsonb then
        raise exception 'Petroleum alternate owner is not explicitly inactive' using errcode = '40001';
      end if;
      v_owner_ids := v_owner_ids || jsonb_build_array(v_owner->'id');
      v_owner_canonical := v_owner_canonical || case when v_owner_canonical = '' then '' else ',' end
        || '{"companyCode":' || (v_owner->'companyCode')::text || ',"id":' || (v_owner->'id')::text
        || ',"inactiveSuspended":' || (v_owner->'inactiveSuspended')::text
        || ',"name":' || (v_owner->'name')::text || ',"recordType":' || (v_owner->'recordType')::text || '}';
    end loop;
    if v_selected_owner is null or v_ownership->'sourceAccountIds' is distinct from v_owner_ids then
      raise exception 'Petroleum ownership coverage omits or changes an Account' using errcode = '40001';
    end if;
    v_previous_id := null;
    for v_id_entry in select value from jsonb_array_elements(v_ownership->'queriedSourceAccountIds') loop
      if jsonb_typeof(v_id_entry) is distinct from 'string'
        or coalesce(v_id_entry#>>'{}','') !~ '^001[A-Za-z0-9]{12}$'
        or public.xero_grouped_salesforce_id_v1(v_id_entry#>>'{}') is distinct from v_id_entry#>>'{}'
        or (v_previous_id is not null and v_previous_id collate "C" >= (v_id_entry#>>'{}') collate "C") then
        raise exception 'Petroleum queried ownership scope is not canonical and unique' using errcode = '40001';
      end if;
      v_previous_id := v_id_entry#>>'{}';
      v_queried_ids := v_queried_ids || jsonb_build_array(v_id_entry);
    end loop;
    if v_queried_ids is distinct from v_owner_ids then
      raise exception 'Petroleum all-years query excludes a retained owner' using errcode = '40001';
    end if;

    if (select count(*) from jsonb_array_elements(v_ownership->'owners') r
        where upper(btrim(regexp_replace(r->>'companyCode',v_space,' ','g'))) = v_selected_key) <> 1
      or v_contact_identity->>'xeroMatchValue' is distinct from v_contact_name
      or (v_contact_identity->>'matchBasis' = 'account_name' and v_contact_identity->>'sourceMatchValue' is distinct from
        upper(btrim(regexp_replace(v_selected_owner->>'name',v_space,' ','g'))))
      or (v_contact_identity->>'matchBasis' = 'company_key' and v_contact_identity->>'sourceMatchValue' is distinct from
        btrim(substr(v_selected_key,3))) then
      raise exception 'Petroleum selected owner key or Contact match proof differs' using errcode = '40001';
    end if;
    for v_claim in select value from jsonb_array_elements_text(jsonb_build_array(
        v_owner_contact->'contactNumber',v_owner_contact->'accountNumber')) loop
      -- Unknown historical strings stay literal. Salesforce-shaped claims and
      -- exact known foreign full CL keys are stronger identity assertions.
      if (btrim(regexp_replace(v_claim,v_space,' ','g')) ~* '^001'
          and public.xero_grouped_salesforce_id_v1(v_claim) is distinct from v_canonical_account)
        or exists (select 1 from jsonb_array_elements(v_ownership->'owners') r
          where r->>'id' <> v_canonical_account and r->>'companyCode' <> ''
          and upper(btrim(regexp_replace(r->>'companyCode',v_space,' ','g'))) = upper(btrim(regexp_replace(v_claim,v_space,' ','g')))) then
        raise exception 'Petroleum target carries a stronger conflicting Account claim' using errcode = '40001';
      end if;
    end loop;

    -- Rebuild this fixed-schema canonical JSON independently of caller strings.
    -- All values here have already been checked as strings or exact booleans.
    v_ownership_canonical := '{"contact":{"accountNumber":' || (v_owner_contact->'accountNumber')::text
      || ',"contactNumber":' || (v_owner_contact->'contactNumber')::text || ',"id":' || (v_owner_contact->'id')::text
      || ',"name":' || (v_owner_contact->'name')::text || ',"status":' || (v_owner_contact->'status')::text
      || '},"contactId":' || (v_ownership->'contactId')::text || ',"owners":[' || v_owner_canonical
      || '],"policyVersion":' || to_jsonb(v_ownership_policy)::text
      || ',"selectedAccountId":' || (v_ownership->'selectedAccountId')::text
      || ',"tenantId":' || (v_accounting->'tenantId')::text || '}';
    if encode(sha256(convert_to(v_ownership_canonical,'UTF8')),'hex') is distinct from v_ownership->>'accountContactFingerprint' then
      raise exception 'Petroleum ownership canonical fingerprint differs' using errcode = '40001';
    end if;
  end if;

  if public.xero_grouped_salesforce_id_v1(v_file->'review'->'counterparties'->>'accountId') is distinct from v_canonical_account
    or lower(v_file->'review'->'counterparties'->>'contactId') is distinct from v_contact
    or lower(v_file->'review'->'counterparties'->>'tenantId') is distinct from p_tenant_id::text
    or v_file->'review'->'counterparties'->>'basis' is distinct from 'independently_reviewed_literal_pair'
    or v_file->'review'->'counterparties'->>'sourceName' is distinct from v_source->>'accountName'
    or nullif(btrim(v_file->'review'->'counterparties'->>'sourceName'),'') is null
    or v_file->'review'->'counterparties'->>'companyCode' is distinct from v_source->>'companyCode'
    or nullif(btrim(v_file->'review'->>'sellerName'),'') is null
    or nullif(btrim(v_file->'review'->>'buyerName'),'') is null
    or v_file->'review'->'counterparties'->>'printedSeller' is distinct from v_file->'review'->>'sellerName'
    or v_file->'review'->'counterparties'->>'printedBuyer' is distinct from v_file->'review'->>'buyerName'
    or coalesce(lower(v_accounting->'accountTax'->'account'->>'AccountID'),'') !~ v_uuid
    or lower(v_accounting->'accountTax'->'account'->>'AccountID') = '00000000-0000-0000-0000-000000000000'
    or v_accounting->'accountTax'->'account'->>'Code' is distinct from '51100'
    or v_accounting->'accountTax'->'account'->>'Type' is distinct from 'DIRECTCOSTS'
    or v_accounting->'accountTax'->'account'->>'Status' is distinct from 'ACTIVE'
    or v_accounting->'accountTax'->'tax'->>'TaxType' is distinct from 'NONE'
    or v_accounting->'accountTax'->'tax'->>'Status' is distinct from 'ACTIVE'
    or coalesce(v_accounting->'accountTax'->'tax'->>'DisplayTaxRate','') !~ '^0([.]0{1,8})?$'
    or coalesce(v_accounting->'accountTax'->'tax'->>'EffectiveRate','') !~ '^0([.]0{1,8})?$'
    or v_accounting->'accountTax'->'tax'->'CanApplyToExpenses' is distinct from 'true'::jsonb then
    raise exception 'Petroleum factual counterparties or active account and tax evidence changed' using errcode = '40001';
  end if;

  if (v_source->>'invoiceDate')::date < v_run.cutoff_date
    or (v_delivery->>'deliveryDate')::date < v_run.cutoff_date
    or to_char((v_source->>'invoiceDate')::date,'YYYY-MM-DD') is distinct from v_source->>'invoiceDate'
    or to_char((v_delivery->>'deliveryDate')::date,'YYYY-MM-DD') is distinct from v_delivery->>'deliveryDate'
    or to_char((v_source->>'dueDate')::date,'YYYY-MM-DD') is distinct from v_source->>'dueDate'
    or to_char((v_xero->>'dueDate')::date,'YYYY-MM-DD') is distinct from v_xero->>'dueDate' then
    raise exception 'Issued petroleum invoice is outside the reviewed accounting-date scope' using errcode = '40001';
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
    raise exception 'Issued petroleum line has a different product mapping' using errcode = '40001';
  end if;
  for v_product_proof in select value from jsonb_array_elements(v_accounting->'productMappings') order by value->>'id' loop
    v_count := 0;
    for v_product in select * from public.xero_financial_product_mappings
      where direction = 'supplier'
        and left(salesforce_product_id,15) = v_product_proof->>'salesforceProductId' order by id for share loop
      v_count := v_count + 1;
      if (v_product_proof - 'approvedAt') is distinct from jsonb_build_object('id',v_product.id,'direction',v_product.direction,
        'salesforceProductId',public.xero_grouped_salesforce_id_v1(v_product.salesforce_product_id),
        'xeroAccountCode',v_product.xero_account_code,'xeroTaxType',v_product.xero_tax_type,
        'enabled',v_product.enabled,'revision',v_product.revision,'approvedBy',v_product.approved_by,'approvedByEmail',v_product.approved_by_email)
        or coalesce(v_product_proof->>'approvedAt','') !~ '^\d{4}-\d{2}-\d{2}T'
        or not v_product.enabled or v_product.xero_account_code <> '51100' or v_product.xero_tax_type <> 'NONE'
        or v_product.approved_by is null or v_product.approved_by = '00000000-0000-0000-0000-000000000000'::uuid
        or nullif(btrim(v_product.approved_by_email),'') is null or v_product.approved_at is null then
        raise exception 'Approved product mapping changed after review' using errcode = '40001';
      end if;
      if (v_product_proof->>'approvedAt')::timestamptz is distinct from v_product.approved_at then
        raise exception 'Approved product mapping review timestamp changed' using errcode = '40001';
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
        and event_type = 'issued_petroleum_document_preservation_linked' and outcome = 'success'
        and record_counts = '{"linked":1,"applied":0,"financialWrites":0}'::jsonb
        and actor_id = p_actor_id and actor_email = lower(btrim(p_actor_email))
        and fingerprints = jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,
          'mappingId',v_mapping.id,'issuedSupplierPreservation',v_retained->'issuedSupplierPreservation')
    ) then
      raise exception 'Completed issued petroleum link cannot be confirmed as the identical acceptance' using errcode = '40001';
    end if;
    return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',true);
  end if;
  if v_run.status <> 'processing' or v_run.revision <> p_expected_run_revision
    or v_run.reviewed_by is null or v_run.reviewed_at is null
    or v_item.status <> 'selected' or v_item.updated_at is distinct from p_expected_item_updated_at
    or v_item.applied_at is not null or v_mapping_count <> 0 then
    raise exception 'Issued petroleum run or item revision changed after review' using errcode = '40001';
  end if;

  insert into public.xero_financial_document_mappings (
    salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,
    xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,
    retained_differences,last_reconciled_at,created_at,updated_at
  ) values (v_item.source_object,v_source->>'salesforceId',v_source->>'documentNumber',v_source->>'documentKind',
    v_source->>'xeroType',v_target,v_xero->>'invoiceNumber',v_contact,'AUTHORISED',v_source->>'sourceFingerprint',
    v_source->>'financialFingerprint',true,v_retained,v_now,v_now,v_now) returning * into v_mapping;
  insert into public.xero_financial_audit_events (run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
  values (p_run_id,'issued_petroleum_document_preservation_linked','success',p_actor_id,lower(btrim(p_actor_email)),
    '{"linked":1,"applied":0,"financialWrites":0}',jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,
      'mappingId',v_mapping.id,'issuedSupplierPreservation',v_retained->'issuedSupplierPreservation'));
  update public.xero_financial_sync_items set status = 'linked', applied_at = v_now, updated_at = v_now
    where id = p_item_id;
  return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',false);
end;
$$;

revoke all on function public.link_xero_issued_petroleum_document_v2(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.link_xero_issued_petroleum_document_v2(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) to service_role;
comment on function public.link_xero_issued_petroleum_document_v2(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) is
  'Service-only insert of reviewed issued petroleum preservation, immutable proof, actor audit and selected item outcome in one transaction; no provider writes.';
