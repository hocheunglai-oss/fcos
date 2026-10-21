-- Publish complete financial previews atomically and reuse only pristine reviews.
-- This does not authorise, post, reset, delete, or expire financial work.
-- Each check keeps a small receipt instead of another complete document copy.
-- Historical audits have no request marker and require no backfill.
create unique index if not exists xero_financial_preview_request_receipt_uidx
  on public.xero_financial_audit_events ((fingerprints->>'previewRequestId'))
  where event_type in ('preview_completed', 'preview_reused')
    and fingerprints->>'previewRequestId' is not null;

create or replace function public.persist_xero_financial_preview_v1(
  p_run jsonb,
  p_items jsonb,
  p_review_identity text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_requested public.xero_financial_sync_runs;
  v_saved public.xero_financial_sync_runs;
  v_receipt public.xero_financial_audit_events;
  v_snapshot jsonb;
  v_payload_run jsonb;
  v_payload_items jsonb;
  v_saved_items jsonb;
  v_payload_hash text;
  v_saved_hash text;
  v_expected integer;
  v_reused boolean := false;
begin
  if jsonb_typeof(p_run) is distinct from 'object'
    or jsonb_typeof(p_items) is distinct from 'array'
    or p_review_identity is null or p_review_identity !~ '^[0-9a-f]{64}$' then
    raise exception 'A complete financial preview payload is required' using errcode = '22023';
  end if;
  v_snapshot := p_run #> '{control_totals,workflowSnapshot}';
  if jsonb_typeof(v_snapshot) is distinct from 'object'
    or v_snapshot->'persistenceVersion' is distinct from '1'::jsonb
    or v_snapshot->'complete' is distinct from 'true'::jsonb
    or v_snapshot->>'reviewIdentity' is distinct from p_review_identity
    or coalesce(v_snapshot->>'tenantId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_snapshot->>'salesforceOrgId', '') !~ '^00D[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$'
    or coalesce(v_snapshot->>'inputEvidenceHash', '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_snapshot->'includePayments') is distinct from 'boolean'
    or v_snapshot->'recordExactMatches' is distinct from 'false'::jsonb
    or coalesce(v_snapshot->>'reconciliationVersion', '') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(v_snapshot->'reconciliationVersion') is distinct from 'number'
    or coalesce(v_snapshot->>'expectedItemCount', '') !~ '^(0|[1-9][0-9]*)$'
    or jsonb_typeof(v_snapshot->'expectedItemCount') is distinct from 'number'
    or v_snapshot ? 'persistencePayloadHash' then
    raise exception 'Financial preview completeness and scope markers are invalid' using errcode = '22023';
  end if;
  v_expected := (v_snapshot->>'expectedItemCount')::integer;
  if jsonb_array_length(p_items) <> v_expected
    or p_run #> '{classification_summary,total}' is distinct from to_jsonb(v_expected)
    or (v_snapshot->'includePayments' = 'true'::jsonb and (
      jsonb_typeof(v_snapshot->'payments') is distinct from 'object'
      or jsonb_typeof(v_snapshot #> '{payments,rows}') is distinct from 'array'
      or v_snapshot #>> '{payments,tenantId}' is distinct from v_snapshot->>'tenantId'))
    or (v_snapshot->'includePayments' = 'false'::jsonb
      and coalesce(v_snapshot->'payments', 'null'::jsonb) <> 'null'::jsonb) then
    raise exception 'Financial preview item count or payment scope is incomplete' using errcode = '22023';
  end if;

  v_requested := jsonb_populate_record(null::public.xero_financial_sync_runs, p_run);
  if v_requested.id is null
    or v_requested.idempotency_key is distinct from 'preview:' || v_requested.id::text
    or v_requested.mode is distinct from 'preview'
    or v_requested.status is distinct from 'building'
    or v_requested.revision is distinct from 1
    or v_requested.cutoff_date is null
    or v_requested.source_snapshot_at is null or v_requested.xero_snapshot_at is null
    or nullif(v_requested.source_fingerprint, '') is null or nullif(v_requested.xero_fingerprint, '') is null
    or jsonb_typeof(v_requested.control_totals) is distinct from 'object'
    or coalesce(v_requested.control_totals->>'postingMode', '') not in ('draft', 'authorised')
    or jsonb_typeof(v_requested.classification_summary) is distinct from 'object'
    or jsonb_typeof(v_requested.rate_limit_snapshot) is distinct from 'object'
    or v_requested.created_at is null or v_requested.updated_at is null
    or v_requested.reviewed_at is not null or v_requested.reviewed_by is not null
    or v_requested.reviewed_by_email is not null or v_requested.completed_at is not null
    or v_requested.error_code is not null or v_requested.error_message is not null then
    raise exception 'Only a new unreviewed financial preview may be published' using errcode = '22023';
  end if;
  -- Fill database defaults before hashing so absent optional fields and their
  -- stored representation agree. Material nulls inside evidence are preserved.
  select coalesce(jsonb_agg(to_jsonb(i) order by i.row_index), '[]'::jsonb)
    into v_payload_items
  from jsonb_populate_recordset(null::public.xero_financial_sync_items,
    (select coalesce(jsonb_agg(jsonb_build_object('selected', false, 'mutation_attempts', 0) || item), '[]'::jsonb)
     from jsonb_array_elements(p_items) item)) i;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.xero_financial_sync_items, v_payload_items) i
    where i.id is null or i.run_id is distinct from v_requested.id
      or i.row_index is null or i.row_index < 0 or i.row_index >= v_expected
      or i.source_object is null or i.source_object not in ('Invoice__c', 'Supplier_Invoice__c')
      or nullif(i.source_id, '') is null
      or i.row_key is distinct from i.source_object || ':' || i.source_id
      or i.idempotency_key is distinct from v_requested.id::text || ':' || i.row_key
      or i.source_type is null or i.source_type not in ('buyer_invoice', 'buyer_credit', 'supplier_bill', 'supplier_credit')
      or i.currency is null
      or i.proposed_action is null or i.proposed_action not in ('link', 'safe_update', 'create_draft', 'protected_legacy', 'blocked')
      or i.status is null or i.status not in ('eligible', 'blocked', 'protected')
      or i.selected is distinct from false or i.mutation_attempts is distinct from 0
      or i.error_code is not null or i.error_message is not null or i.applied_at is not null
      or i.created_at is null or i.updated_at is null
      or jsonb_typeof(i.blockers) is distinct from 'array'
      or jsonb_typeof(i.warnings) is distinct from 'array'
      or jsonb_typeof(i.differences) is distinct from 'array'
      or jsonb_typeof(i.source_payload) is distinct from 'object'
      or jsonb_typeof(i.xero_payload) is distinct from 'object'
      or jsonb_typeof(i.proposed_payload) is distinct from 'object'
      or i.source_payload->>'salesforceObject' is distinct from i.source_object
      or i.source_payload->>'salesforceId' is distinct from i.source_id
      or i.source_payload->>'postingMode' is distinct from v_requested.control_totals->>'postingMode'
      or (i.status = 'eligible' and i.blockers <> '[]'::jsonb)
  ) or exists (select 1 from jsonb_array_elements(p_items) with ordinality as supplied(item, ord)
      where item->>'row_index' is distinct from (ord - 1)::text)
    or (select count(distinct item->>'id') from jsonb_array_elements(v_payload_items) item) <> v_expected
    or (select count(distinct item->>'row_key') from jsonb_array_elements(v_payload_items) item) <> v_expected
    or (select count(distinct item->>'row_index') from jsonb_array_elements(v_payload_items) item) <> v_expected then
    raise exception 'Financial preview items are incomplete or contain noninitial state' using errcode = '22023';
  end if;

  -- These exclusions are deliberately narrow and mirrored by the API's review
  -- identity. This separate database hash also rejects a reused caller UUID or
  -- claimed identity carrying different accounting/review evidence.
  v_payload_run := to_jsonb(v_requested) - array['id', 'idempotency_key', 'created_by', 'created_by_email',
    'created_at', 'updated_at', 'source_snapshot_at', 'xero_snapshot_at', 'rate_limit_snapshot'];
  v_snapshot := v_snapshot - array['checkedAt', 'reviewIdentity', 'persistencePayloadHash'];
  if jsonb_typeof(v_snapshot->'payments') = 'object' then
    v_snapshot := jsonb_set(v_snapshot, '{payments}', (v_snapshot->'payments') - array['actor', 'rateLimit']);
  end if;
  v_payload_run := jsonb_set(v_payload_run, '{control_totals,workflowSnapshot}', v_snapshot);
  select coalesce(jsonb_agg((case when jsonb_typeof(item #> '{source_payload,sourceFileDiscovery}') = 'object'
      then jsonb_set(item, '{source_payload,sourceFileDiscovery}',
        (item #> '{source_payload,sourceFileDiscovery}') - 'capturedAt') else item end)
      - array['id', 'run_id', 'idempotency_key', 'created_at', 'updated_at'] order by ord), '[]'::jsonb)
    into v_saved_items from jsonb_array_elements(v_payload_items) with ordinality as items(item, ord);
  v_payload_hash := encode(sha256(convert_to(jsonb_build_object('run', v_payload_run, 'items', v_saved_items)::text, 'UTF8')), 'hex');

  -- Lock the retry UUID before the identity. The identity lock serializes new
  -- requests; a row lock below also serializes against the existing authorise
  -- RPC, which takes the run lock before touching any item.
  perform pg_advisory_xact_lock(hashtextextended('xero-preview-run:' || v_requested.id::text, 0));
  select * into v_receipt from public.xero_financial_audit_events
    where event_type in ('preview_completed', 'preview_reused')
      and fingerprints->>'previewRequestId' = v_requested.id::text;
  if v_receipt.id is not null then
    select * into v_saved from public.xero_financial_sync_runs where id = v_receipt.run_id for update;
    if v_saved.id is null or v_saved.mode <> 'preview' or v_receipt.outcome <> 'success'
      or v_receipt.fingerprints->>'reviewIdentity' is distinct from p_review_identity
      or v_receipt.fingerprints->>'persistencePayloadHash' is distinct from v_payload_hash
      or v_saved.control_totals #>> '{workflowSnapshot,reviewIdentity}' is distinct from p_review_identity
      or v_saved.control_totals #>> '{workflowSnapshot,persistencePayloadHash}' is distinct from v_payload_hash
      or v_saved.control_totals #> '{workflowSnapshot,complete}' is distinct from 'true'::jsonb
      or v_saved.control_totals #> '{workflowSnapshot,persistenceVersion}' is distinct from '1'::jsonb
      or v_saved.status = 'building'
      or (select count(*) from public.xero_financial_sync_items where run_id = v_saved.id) <> v_expected
      or not exists (select 1 from public.xero_financial_audit_events a
        where a.run_id = v_saved.id and a.event_type = 'preview_completed' and a.outcome = 'success'
          and a.fingerprints->>'reviewIdentity' = p_review_identity
          and a.fingerprints->>'persistencePayloadHash' = v_payload_hash) then
      raise exception 'The financial preview request UUID already belongs to a different payload' using errcode = '22023';
    end if;
    -- An exact transport retry can observe a subsequently reviewed/completed
    -- run. Return its real state, never restore initial state or approvals.
    v_reused := true;
  else
    perform 1 from public.xero_financial_sync_runs where id = v_requested.id for update;
    if found then
      raise exception 'The financial preview request UUID already belongs to another run' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('xero-preview-identity:' || p_review_identity, 0));
    select * into v_saved from public.xero_financial_sync_runs r
    where r.mode = 'preview' and r.status = 'ready_for_review' and r.revision = 1
      and r.reviewed_at is null and r.reviewed_by is null and r.reviewed_by_email is null
      and r.completed_at is null and r.error_code is null and r.error_message is null
      and r.control_totals #>> '{workflowSnapshot,reviewIdentity}' = p_review_identity
      and r.control_totals #> '{workflowSnapshot,persistenceVersion}' = '1'::jsonb
      and r.control_totals #> '{workflowSnapshot,complete}' = 'true'::jsonb
      and not exists (select 1 from public.xero_financial_sync_items i where i.run_id = r.id
        and (i.selected or i.mutation_attempts <> 0 or i.applied_at is not null
          or i.error_code is not null or i.error_message is not null
          or i.status not in ('eligible', 'blocked', 'protected')))
      and exists (select 1 from public.xero_financial_audit_events a
        where a.run_id = r.id and a.event_type = 'preview_completed' and a.outcome = 'success'
          and a.record_counts = r.classification_summary
          and a.fingerprints->>'source' = r.source_fingerprint
          and a.fingerprints->>'xero' = r.xero_fingerprint
          and a.fingerprints->>'reviewIdentity' = p_review_identity
          and a.fingerprints->>'persistencePayloadHash' = r.control_totals #>> '{workflowSnapshot,persistencePayloadHash}')
    order by r.created_at desc, r.id limit 1 for update;
    if v_saved.id is not null then
      perform 1 from public.xero_financial_sync_items where run_id = v_saved.id for update;
      if v_saved.control_totals #>> '{workflowSnapshot,persistencePayloadHash}' is distinct from v_payload_hash
        or v_saved.control_totals #> '{workflowSnapshot,expectedItemCount}' is distinct from to_jsonb(v_expected)
        or v_saved.control_totals #>> '{workflowSnapshot,tenantId}' is distinct from v_snapshot->>'tenantId' then
        raise exception 'The financial preview identity carries different review evidence' using errcode = '22023';
      end if;
      if (select count(*) from public.xero_financial_sync_items where run_id = v_saved.id) <> v_expected
        or exists (select 1 from public.xero_financial_sync_items i where i.run_id = v_saved.id
          and (i.selected or i.mutation_attempts <> 0 or i.applied_at is not null
            or i.error_code is not null or i.error_message is not null
            or i.status not in ('eligible', 'blocked', 'protected'))) then
        raise exception 'The saved financial preview is incomplete or no longer pristine' using errcode = '40001';
      end if;
      -- Detect corruption/drift of the persisted evidence as well as marker
      -- equality. A checksum alone must not hide modified item payloads.
      v_payload_run := (to_jsonb(v_saved) || '{"status":"building"}'::jsonb) - array['id', 'idempotency_key',
        'created_by', 'created_by_email', 'created_at', 'updated_at', 'source_snapshot_at', 'xero_snapshot_at', 'rate_limit_snapshot'];
      v_snapshot := (v_saved.control_totals->'workflowSnapshot') - array['checkedAt', 'reviewIdentity', 'persistencePayloadHash'];
      if jsonb_typeof(v_snapshot->'payments') = 'object' then
        v_snapshot := jsonb_set(v_snapshot, '{payments}', (v_snapshot->'payments') - array['actor', 'rateLimit']);
      end if;
      v_payload_run := jsonb_set(v_payload_run, '{control_totals,workflowSnapshot}', v_snapshot);
      select coalesce(jsonb_agg((case when jsonb_typeof(i.source_payload->'sourceFileDiscovery') = 'object'
          then jsonb_set(to_jsonb(i), '{source_payload,sourceFileDiscovery}',
            (i.source_payload->'sourceFileDiscovery') - 'capturedAt') else to_jsonb(i) end)
          - array['id', 'run_id', 'idempotency_key', 'created_at', 'updated_at'] order by i.row_index), '[]'::jsonb)
        into v_saved_items from public.xero_financial_sync_items i where i.run_id = v_saved.id;
      v_saved_hash := encode(sha256(convert_to(jsonb_build_object('run', v_payload_run, 'items', v_saved_items)::text, 'UTF8')), 'hex');
      if v_saved_hash <> v_payload_hash then
        raise exception 'The saved financial preview evidence changed after publication' using errcode = '40001';
      end if;
      v_reused := true;
      insert into public.xero_financial_audit_events
        (run_id, event_type, outcome, actor_id, actor_email, record_counts, fingerprints)
      values (v_saved.id, 'preview_reused', 'success', v_requested.created_by, v_requested.created_by_email,
        jsonb_build_object('total', v_expected),
        jsonb_build_object('previewRequestId', v_requested.id::text, 'reviewIdentity', p_review_identity,
          'persistencePayloadHash', v_payload_hash));
    else
      v_requested.status := 'ready_for_review';
      v_requested.control_totals := jsonb_set(v_requested.control_totals,
        '{workflowSnapshot,persistencePayloadHash}', to_jsonb(v_payload_hash));
      insert into public.xero_financial_sync_runs select (v_requested).* returning * into v_saved;
      insert into public.xero_financial_sync_items
        select * from jsonb_populate_recordset(null::public.xero_financial_sync_items, v_payload_items);
      insert into public.xero_financial_audit_events
        (run_id, event_type, outcome, actor_id, actor_email, record_counts, fingerprints, rate_limit_snapshot)
      values (v_saved.id, 'preview_completed', 'success', v_saved.created_by, v_saved.created_by_email,
        v_saved.classification_summary,
        jsonb_build_object('source', v_saved.source_fingerprint, 'xero', v_saved.xero_fingerprint,
          'previewRequestId', v_requested.id::text, 'reviewIdentity', p_review_identity,
          'persistencePayloadHash', v_payload_hash), v_saved.rate_limit_snapshot);
    end if;
  end if;
  return jsonb_build_object('run', to_jsonb(v_saved), 'reused', v_reused, 'items',
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'row_key', row_key, 'row_index', row_index) order by row_index), '[]'::jsonb)
     from public.xero_financial_sync_items where run_id = v_saved.id));
end;
$$;

revoke all on function public.persist_xero_financial_preview_v1(jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.persist_xero_financial_preview_v1(jsonb,jsonb,text) to service_role;
