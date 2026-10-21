-- Service-only durable preview uploads. Staging is never financial/approval authority.
-- No incomplete run is inserted into the financial run table.
create table public.xero_financial_preview_builds (
  request_id uuid primary key,
  review_identity text not null check (review_identity ~ '^[0-9a-f]{64}$'),
  checkpoint_id uuid not null references public.xero_financial_preview_checkpoints(id),
  run_payload jsonb not null check (jsonb_typeof(run_payload) = 'object'),
  run_storage_hash text not null check (run_storage_hash ~ '^[0-9a-f]{64}$'),
  run_material_hash text not null check (run_material_hash ~ '^[0-9a-f]{64}$'),
  expected_item_count integer not null check (expected_item_count >= 0),
  received_item_count integer not null default 0 check (received_item_count >= 0 and received_item_count <= expected_item_count),
  staged_bytes bigint not null check (staged_bytes between 0 and 104857600),
  state text not null default 'building' check (state in ('building','published')),
  persistence_hash text check (persistence_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((state='building' and persistence_hash is null and published_at is null)
    or (state='published' and persistence_hash is not null and published_at is not null and received_item_count=expected_item_count))
);
create table public.xero_financial_preview_build_items (
  request_id uuid not null references public.xero_financial_preview_builds(request_id),
  row_index integer not null check (row_index >= 0),
  item_id uuid not null,
  row_key text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  storage_hash text not null check (storage_hash ~ '^[0-9a-f]{64}$'),
  material_hash text not null check (material_hash ~ '^[0-9a-f]{64}$'),
  payload_bytes integer not null check (payload_bytes between 1 and 262144),
  primary key(request_id,row_index),
  unique(request_id,item_id), unique(request_id,row_key)
);
alter table public.xero_financial_preview_builds enable row level security;
alter table public.xero_financial_preview_builds force row level security;
alter table public.xero_financial_preview_build_items enable row level security;
alter table public.xero_financial_preview_build_items force row level security;
revoke all on public.xero_financial_preview_builds,public.xero_financial_preview_build_items from public,anon,authenticated,service_role;
grant select on public.xero_financial_preview_builds,public.xero_financial_preview_build_items to service_role;

-- Only forward progress is mutable; initial evidence cannot be replaced.
create function public.xero_preview_build_immutable_v2()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or tg_table_name='xero_financial_preview_build_items' then
    raise exception 'XERO_PREVIEW_STAGED_IMMUTABLE' using errcode='40001'; end if;
  if row(new.request_id,new.review_identity,new.checkpoint_id,new.run_payload,new.run_storage_hash,
      new.run_material_hash,new.expected_item_count,new.created_at)
    is distinct from row(old.request_id,old.review_identity,old.checkpoint_id,old.run_payload,old.run_storage_hash,
      old.run_material_hash,old.expected_item_count,old.created_at)
    or old.state='published' or new.received_item_count<old.received_item_count or new.staged_bytes<old.staged_bytes
    or new.state not in ('building','published') then
    raise exception 'XERO_PREVIEW_STAGED_IMMUTABLE' using errcode='40001'; end if;
  return new;
end $$;
create trigger xero_preview_build_immutable before update or delete on public.xero_financial_preview_builds
  for each row execute function public.xero_preview_build_immutable_v2();
create trigger xero_preview_build_item_immutable before update or delete on public.xero_financial_preview_build_items
  for each row execute function public.xero_preview_build_immutable_v2();

-- Match v1's narrow evidence exclusions. Hash one normalized row at a time.
create function public.xero_preview_run_material_v2(p_run jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare s jsonb; r jsonb;
begin
  r := p_run - array['id','idempotency_key','created_by','created_by_email','created_at','updated_at',
    'source_snapshot_at','xero_snapshot_at','rate_limit_snapshot'];
  s := r #> '{control_totals,workflowSnapshot}';
  s := s - array['checkedAt','reviewIdentity','persistencePayloadHash'];
  if jsonb_typeof(s->'payments')='object' then s := jsonb_set(s,'{payments}',(s->'payments')-array['actor','rateLimit']); end if;
  return jsonb_set(r,'{control_totals,workflowSnapshot}',s);
end $$;
create function public.xero_preview_item_material_v2(p_item jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_item #> '{source_payload,sourceFileDiscovery}')='object' then
    p_item := jsonb_set(p_item,'{source_payload,sourceFileDiscovery}',(p_item #> '{source_payload,sourceFileDiscovery}')-'capturedAt');
  end if;
  return p_item-array['id','run_id','idempotency_key','created_at','updated_at'];
end $$;
create function public.xero_preview_jsonb_hash_v2(p_value jsonb)
returns text language sql immutable strict set search_path='' as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;

-- Private callers derive the scope from immutable checkpoint metadata. This
-- rechecks live permission and tenant even for a same-UUID readback.
create function public.xero_preview_build_scope_v2(p_run jsonb,p_committed boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; ref jsonb; c public.xero_financial_preview_checkpoints; scope jsonb;
begin
  s := p_run #> '{control_totals,workflowSnapshot}'; ref := s->'inventoryReference';
  if jsonb_typeof(ref) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(ref)) <> 13
    or ref->'storageVersion' is distinct from '2'::jsonb
    or not coalesce(ref->>'checkpointId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or s ? 'inventory' then raise exception 'XERO_PREVIEW_STAGED_REFERENCE_INVALID' using errcode='22023'; end if;
  select * into c from public.xero_financial_preview_checkpoints where id=(ref->>'checkpointId')::uuid for share;
  if not found then raise exception 'XERO_PREVIEW_STAGED_REFERENCE_INVALID' using errcode='22023'; end if;
  scope := jsonb_build_object('actorId',c.actor_id,'tenantId',c.tenant_id,'salesforceOrgId',c.salesforce_org_id,
    'reconciliationVersion',c.reconciliation_version,'inputOptions',c.input_options,'inputEvidenceHash',c.input_evidence_hash);
  perform public.xero_preview_checkpoint_guard_v1(scope);
  if (ref-'capturedAt') is distinct from (jsonb_build_object('checkpointId',c.id,'revision',case when c.state='published' then c.revision-1 else c.revision end,
      'actorId',c.actor_id,'tenantId',c.tenant_id,'salesforceOrgId',c.salesforce_org_id,
      'reconciliationVersion',c.reconciliation_version,'inputOptions',c.input_options,'inputEvidenceHash',c.input_evidence_hash,
      'payloadHash',c.payload_hash,'storageHash',c.storage_hash,'tokenVersion',c.token_version,'capturedAt',c.captured_at,'storageVersion',2)-'capturedAt')
    or (ref->>'capturedAt')::timestamptz is distinct from c.captured_at
    or p_run->>'created_by' is distinct from c.actor_id::text
    or s->>'tenantId' is distinct from c.tenant_id::text
    or s->>'salesforceOrgId' is distinct from c.salesforce_org_id
    or s->'reconciliationVersion' is distinct from to_jsonb(c.reconciliation_version)
    or s->'linkFirst' is distinct from c.input_options->'linkFirst'
    or s->'includePayments' is distinct from c.input_options->'includePayments'
    or s->'recordExactMatches' is distinct from c.input_options->'recordExactMatches'
    or coalesce(s->'campaignId','null'::jsonb) is distinct from c.input_options->'campaignId'
    or p_run #>> '{control_totals,postingMode}' is distinct from c.input_options->>'postingMode'
    or p_run->>'cutoff_date' is distinct from c.input_options->>'cutoffDate'
    or s->>'previewCheckpointInputEvidenceHash' is distinct from c.input_evidence_hash
    or s->>'previewCheckpointPayloadHash' is distinct from c.payload_hash
    or c.storage_version <> 2
    or c.storage_hash is distinct from public.xero_preview_jsonb_hash_v2(c.payload)
    or c.state not in ('captured','published')
    or (not p_committed and (c.state <> 'captured' or c.expires_at <= clock_timestamp()))
    or (p_committed and c.state='published' and c.published_run_id is distinct from (p_run->>'id')::uuid)
    then raise exception 'XERO_PREVIEW_STAGED_SCOPE_CHANGED' using errcode='40001'; end if;
end $$;

create function public.begin_xero_financial_preview_v2(p_run jsonb,p_expected_item_count integer,p_review_identity text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r public.xero_financial_sync_runs; b public.xero_financial_preview_builds; s jsonb; payload jsonb; bytes integer;
begin
  if jsonb_typeof(p_run) is distinct from 'object' or octet_length(p_run::text)>8388608
    or p_expected_item_count is null or p_expected_item_count < 0
    or not coalesce(p_review_identity ~ '^[0-9a-f]{64}$',false) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  s := p_run #> '{control_totals,workflowSnapshot}';
  if jsonb_typeof(s) is distinct from 'object' or s->'persistenceVersion' is distinct from '2'::jsonb
    or s->'complete' is distinct from 'true'::jsonb or s->>'reviewIdentity' is distinct from p_review_identity
    or not coalesce(s->>'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or not coalesce(s->>'salesforceOrgId' ~ '^00D[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$',false)
    or not coalesce(s->>'inputEvidenceHash' ~ '^[0-9a-f]{64}$',false)
    or jsonb_typeof(s->'includePayments') is distinct from 'boolean'
    or s->'recordExactMatches' is distinct from 'false'::jsonb
    or not coalesce(s->>'reconciliationVersion' ~ '^[1-9][0-9]*$',false)
    or jsonb_typeof(s->'reconciliationVersion') is distinct from 'number'
    or s->'expectedItemCount' is distinct from to_jsonb(p_expected_item_count)
    or p_run #> '{classification_summary,total}' is distinct from to_jsonb(p_expected_item_count)
    or s ? 'persistencePayloadHash'
    or (s->'includePayments'='true'::jsonb and (jsonb_typeof(s->'payments') is distinct from 'object'
      or jsonb_typeof(s #> '{payments,rows}') is distinct from 'array' or s #>> '{payments,tenantId}' is distinct from s->>'tenantId'))
    or (s->'includePayments'='false'::jsonb and coalesce(s->'payments','null'::jsonb)<>'null'::jsonb) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  r := jsonb_populate_record(null::public.xero_financial_sync_runs,p_run);
  if r.id is null or r.idempotency_key is distinct from 'preview:'||r.id::text or r.mode is distinct from 'preview'
    or r.status is distinct from 'building' or r.revision is distinct from 1 or r.cutoff_date is null
    or r.source_snapshot_at is null or r.xero_snapshot_at is null or nullif(r.source_fingerprint,'') is null
    or nullif(r.xero_fingerprint,'') is null or jsonb_typeof(r.control_totals) is distinct from 'object'
    or coalesce(r.control_totals->>'postingMode','') not in ('draft','authorised')
    or jsonb_typeof(r.classification_summary) is distinct from 'object' or jsonb_typeof(r.rate_limit_snapshot) is distinct from 'object'
    or r.created_at is null or r.updated_at is null or r.reviewed_at is not null or r.reviewed_by is not null
    or r.reviewed_by_email is not null or r.completed_at is not null or r.error_code is not null or r.error_message is not null then
    raise exception 'XERO_PREVIEW_STAGED_NONINITIAL' using errcode='22023'; end if;
  payload := to_jsonb(r); bytes := octet_length(payload::text);
  if exists(select 1 from jsonb_object_keys(p_run) key where not payload ? key) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  if bytes>8388608 then raise exception 'XERO_PREVIEW_STAGED_TOO_LARGE' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xero-preview-run:'||r.id::text,0));
  select * into b from public.xero_financial_preview_builds where request_id=r.id for update;
  if found then
    if b.run_storage_hash is distinct from public.xero_preview_jsonb_hash_v2(b.run_payload)
      or b.run_material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(b.run_payload)) then
      raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
    -- A new HTTP resume can regenerate only v1's enumerated metadata. Keep
    -- the first durable payload, and compare independently normalized evidence.
    if b.review_identity is distinct from p_review_identity or b.expected_item_count is distinct from p_expected_item_count
      or b.run_material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(payload)) then
      raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
    perform public.xero_preview_build_scope_v2(payload,b.state='published');
    -- Recovery of a committed UUID must verify persisted material evidence too.
    if b.state='published' then return public.finalize_xero_financial_preview_v2(r.id,p_review_identity); end if;
  else
    if exists(select 1 from public.xero_financial_sync_runs where id=r.id) then
      raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
    perform public.xero_preview_build_scope_v2(payload,false);
    insert into public.xero_financial_preview_builds(request_id,review_identity,checkpoint_id,run_payload,
      run_storage_hash,run_material_hash,expected_item_count,staged_bytes)
    values(r.id,p_review_identity,(s->'inventoryReference'->>'checkpointId')::uuid,payload,
      public.xero_preview_jsonb_hash_v2(payload),public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(payload)),
      p_expected_item_count,bytes) returning * into b;
  end if;
  return jsonb_build_object('runId',b.request_id,'state',b.state,'reviewIdentity',b.review_identity,
    'expectedItemCount',b.expected_item_count,'receivedItemCount',b.received_item_count,'reused',false);
end $$;

create function public.append_xero_financial_preview_v2(p_run_id uuid,p_review_identity text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare b public.xero_financial_preview_builds; r public.xero_financial_sync_runs; i public.xero_financial_sync_items;
  old public.xero_financial_preview_build_items; entry jsonb; payload jsonb; bytes integer; prev integer; total bigint; count_new integer:=0;
begin
  if p_run_id is null or not coalesce(p_review_identity ~ '^[0-9a-f]{64}$',false)
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 or octet_length(p_items::text)>524288 then
    raise exception 'XERO_PREVIEW_STAGED_CHUNK_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xero-preview-run:'||p_run_id::text,0));
  select * into b from public.xero_financial_preview_builds where request_id=p_run_id for update;
  if not found or b.review_identity is distinct from p_review_identity then
    raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
  perform public.xero_preview_build_scope_v2(b.run_payload,b.state='published');
  r := jsonb_populate_record(null::public.xero_financial_sync_runs,b.run_payload); total:=b.staged_bytes;
  for entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(entry) is distinct from 'object' or octet_length(entry::text)>262144 then
      raise exception 'XERO_PREVIEW_STAGED_ITEM_TOO_LARGE' using errcode='22023'; end if;
    i := jsonb_populate_record(null::public.xero_financial_sync_items,jsonb_build_object('selected',false,'mutation_attempts',0)||entry);
    if i.id is null or i.run_id is distinct from p_run_id or i.row_index is null or i.row_index<0 or i.row_index>=b.expected_item_count
      or (prev is not null and i.row_index<>prev+1)
      or i.source_object is null or i.source_object not in ('Invoice__c','Supplier_Invoice__c') or nullif(i.source_id,'') is null
      or i.row_key is distinct from i.source_object||':'||i.source_id or i.idempotency_key is distinct from p_run_id::text||':'||i.row_key
      or i.source_type is null or i.source_type not in ('buyer_invoice','buyer_credit','supplier_bill','supplier_credit')
      or i.currency is null or i.proposed_action is null or i.proposed_action not in ('link','safe_update','create_draft','protected_legacy','blocked')
      or i.status is null or i.status not in ('eligible','blocked','protected') or i.selected is distinct from false or i.mutation_attempts is distinct from 0
      or i.error_code is not null or i.error_message is not null or i.applied_at is not null or i.created_at is null or i.updated_at is null
      or jsonb_typeof(i.blockers) is distinct from 'array' or jsonb_typeof(i.warnings) is distinct from 'array'
      or jsonb_typeof(i.differences) is distinct from 'array' or jsonb_typeof(i.source_payload) is distinct from 'object'
      or jsonb_typeof(i.xero_payload) is distinct from 'object' or jsonb_typeof(i.proposed_payload) is distinct from 'object'
      or i.source_payload->>'salesforceObject' is distinct from i.source_object or i.source_payload->>'salesforceId' is distinct from i.source_id
      or i.source_payload->>'postingMode' is distinct from r.control_totals->>'postingMode' or (i.status='eligible' and i.blockers<>'[]'::jsonb) then
      raise exception 'XERO_PREVIEW_STAGED_ITEMS_NONINITIAL' using errcode='22023'; end if;
    prev:=i.row_index; payload:=to_jsonb(i); bytes:=octet_length(payload::text);
    if exists(select 1 from jsonb_object_keys(entry) key where not payload ? key) then
      raise exception 'XERO_PREVIEW_STAGED_ITEMS_NONINITIAL' using errcode='22023'; end if;
    if bytes>262144 then raise exception 'XERO_PREVIEW_STAGED_ITEM_TOO_LARGE' using errcode='22023'; end if;
    select * into old from public.xero_financial_preview_build_items where request_id=p_run_id and row_index=i.row_index;
    if found then
      if old.storage_hash is distinct from public.xero_preview_jsonb_hash_v2(old.payload)
        or old.material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_item_material_v2(old.payload)) then
        raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
      if old.item_id is distinct from i.id or old.row_key is distinct from i.row_key
        or old.payload->>'run_id' is distinct from i.run_id::text
        or old.payload->'row_index' is distinct from to_jsonb(i.row_index)
        or old.payload->>'idempotency_key' is distinct from i.idempotency_key
        or old.material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_item_material_v2(payload)) then
        raise exception 'XERO_PREVIEW_STAGED_ITEM_CONFLICT' using errcode='22023'; end if;
    else
      if b.state <> 'building' or i.row_index<>b.received_item_count+count_new then
        raise exception 'XERO_PREVIEW_STAGED_ITEMS_INCOMPLETE' using errcode='22023'; end if;
      if exists(select 1 from public.xero_financial_preview_build_items where request_id=p_run_id and (item_id=i.id or row_key=i.row_key)) then
        raise exception 'XERO_PREVIEW_STAGED_ITEM_CONFLICT' using errcode='22023'; end if;
      total:=total+bytes;
      if total>104857600 then raise exception 'XERO_PREVIEW_STAGED_TOO_LARGE' using errcode='22023'; end if;
      insert into public.xero_financial_preview_build_items values(p_run_id,i.row_index,i.id,i.row_key,payload,
        public.xero_preview_jsonb_hash_v2(payload),public.xero_preview_jsonb_hash_v2(public.xero_preview_item_material_v2(payload)),bytes);
      count_new:=count_new+1;
    end if;
  end loop;
  if count_new>0 then update public.xero_financial_preview_builds set received_item_count=received_item_count+count_new,staged_bytes=total where request_id=p_run_id; end if;
  if b.state='published' then return public.finalize_xero_financial_preview_v2(p_run_id,p_review_identity); end if;
  return jsonb_build_object('runId',p_run_id,'state',b.state,'reviewIdentity',b.review_identity,
    'expectedItemCount',b.expected_item_count,'receivedItemCount',b.received_item_count+count_new,'reused',false);
end $$;

create function public.finalize_xero_financial_preview_v2(p_run_id uuid,p_review_identity text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare b public.xero_financial_preview_builds; r public.xero_financial_sync_runs; live public.xero_financial_sync_runs;
  i public.xero_financial_sync_items; row public.xero_financial_preview_build_items; material jsonb; chain text; n integer:=0; bytes bigint;
begin
  if p_run_id is null or not coalesce(p_review_identity ~ '^[0-9a-f]{64}$',false) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xero-preview-run:'||p_run_id::text,0));
  select * into b from public.xero_financial_preview_builds where request_id=p_run_id for update;
  if not found or b.review_identity is distinct from p_review_identity then
    raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
  perform public.xero_preview_build_scope_v2(b.run_payload,b.state='published');
  r:=jsonb_populate_record(null::public.xero_financial_sync_runs,b.run_payload);
  chain:=public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(b.run_payload)); bytes:=octet_length(b.run_payload::text);
  if b.run_storage_hash is distinct from public.xero_preview_jsonb_hash_v2(b.run_payload) or b.run_material_hash is distinct from chain then
    raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
  select * into live from public.xero_financial_sync_runs where id=p_run_id for update;
  if b.state='published' then
    if live.id is null or live.idempotency_key is distinct from r.idempotency_key or live.mode<>'preview' or live.status in ('building','cancelled')
      or live.control_totals #>> '{workflowSnapshot,persistencePayloadHash}' is distinct from b.persistence_hash
      or live.control_totals #>> '{workflowSnapshot,reviewIdentity}' is distinct from b.review_identity
      or live.control_totals #> '{workflowSnapshot,complete}' is distinct from 'true'::jsonb
      or live.control_totals #> '{workflowSnapshot,persistenceVersion}' is distinct from '2'::jsonb
      or (select count(*) from public.xero_financial_sync_items where run_id=p_run_id)<>b.expected_item_count
      or not exists(select 1 from public.xero_financial_audit_events where run_id=p_run_id and event_type='preview_completed'
        and outcome='success' and fingerprints->>'previewRequestId'=p_run_id::text
        and fingerprints->>'reviewIdentity'=b.review_identity and fingerprints->>'persistencePayloadHash'=b.persistence_hash
        and record_counts=r.classification_summary and fingerprints->>'source'=r.source_fingerprint and fingerprints->>'xero'=r.xero_fingerprint) then
      raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
    -- Approval/execution fields may legitimately advance after publication.
    -- Restore only those fields from the immutable initial manifest for the
    -- evidence check; never write them back or reset the reviewed state.
    material:=to_jsonb(live)||jsonb_build_object('status',r.status,'revision',r.revision,'reviewed_at',r.reviewed_at,
      'reviewed_by',r.reviewed_by,'reviewed_by_email',r.reviewed_by_email,'completed_at',r.completed_at,
      'error_code',r.error_code,'error_message',r.error_message);
    if public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(material)) is distinct from b.run_material_hash then
      raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
  elsif live.id is not null then raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
  for row in select * from public.xero_financial_preview_build_items where request_id=p_run_id order by row_index for share loop
    if row.row_index<>n or row.storage_hash is distinct from public.xero_preview_jsonb_hash_v2(row.payload)
      or row.material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_item_material_v2(row.payload))
      or row.payload_bytes is distinct from octet_length(row.payload::text) then
      raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
    if b.state='published' then
      select * into i from public.xero_financial_sync_items where id=row.item_id and run_id=p_run_id for share;
      if not found or i.row_index<>row.row_index or i.row_key<>row.row_key
        or i.idempotency_key is distinct from row.payload->>'idempotency_key' then
        raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
      material:=to_jsonb(i)||jsonb_build_object('status',row.payload->'status','selected',row.payload->'selected',
        'mutation_attempts',row.payload->'mutation_attempts','error_code',row.payload->'error_code',
        'error_message',row.payload->'error_message','applied_at',row.payload->'applied_at');
      if public.xero_preview_jsonb_hash_v2(public.xero_preview_item_material_v2(material)) is distinct from row.material_hash then
        raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
    end if;
    chain:=encode(sha256(convert_to(chain||':'||n::text||':'||row.material_hash,'UTF8')),'hex');
    bytes:=bytes+row.payload_bytes; n:=n+1;
  end loop;
  if n<>b.expected_item_count or n<>b.received_item_count or bytes<>b.staged_bytes or bytes>104857600 then
    raise exception 'XERO_PREVIEW_STAGED_ITEMS_INCOMPLETE' using errcode='22023'; end if;
  if b.state='published' then
    if b.persistence_hash is distinct from chain then raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
  else
    -- Reject a claimed identity with different material. Reuse is intentionally
    -- fail-closed here; this bounded protocol never needs a whole-item aggregate.
    perform pg_advisory_xact_lock(hashtextextended('xero-preview-identity:'||p_review_identity,0));
    if exists(select 1 from public.xero_financial_sync_runs where mode='preview'
      and control_totals #>> '{workflowSnapshot,reviewIdentity}'=p_review_identity) then
      raise exception 'XERO_PREVIEW_STAGED_IDENTITY_CONFLICT' using errcode='22023'; end if;
    r.status:='ready_for_review';
    r.control_totals:=jsonb_set(r.control_totals,'{workflowSnapshot,persistencePayloadHash}',to_jsonb(chain));
    insert into public.xero_financial_sync_runs select (r).* returning * into live;
    insert into public.xero_financial_sync_items
      select (jsonb_populate_record(null::public.xero_financial_sync_items,payload)).*
      from public.xero_financial_preview_build_items where request_id=p_run_id order by row_index;
    insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints,rate_limit_snapshot)
      values(p_run_id,'preview_completed','success',r.created_by,r.created_by_email,r.classification_summary,
        jsonb_build_object('source',r.source_fingerprint,'xero',r.xero_fingerprint,'previewRequestId',p_run_id,
          'reviewIdentity',p_review_identity,'persistencePayloadHash',chain),r.rate_limit_snapshot);
    update public.xero_financial_preview_builds set state='published',persistence_hash=chain,published_at=clock_timestamp() where request_id=p_run_id;
  end if;
  return jsonb_build_object('runId',live.id,'state','published','reviewIdentity',b.review_identity,
    'expectedItemCount',b.expected_item_count,'receivedItemCount',n,'reused',b.state='published',
    'run',jsonb_build_object('id',live.id,'status',live.status,'revision',live.revision),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'row_key',row_key,'row_index',row_index) order by row_index),'[]'::jsonb)
      from public.xero_financial_sync_items where run_id=p_run_id));
end $$;

revoke all on function public.xero_preview_build_immutable_v2(),public.xero_preview_run_material_v2(jsonb),public.xero_preview_item_material_v2(jsonb),
  public.xero_preview_jsonb_hash_v2(jsonb),public.xero_preview_build_scope_v2(jsonb,boolean),
  public.begin_xero_financial_preview_v2(jsonb,integer,text),public.append_xero_financial_preview_v2(uuid,text,jsonb),
  public.finalize_xero_financial_preview_v2(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_xero_financial_preview_v2(jsonb,integer,text),
  public.append_xero_financial_preview_v2(uuid,text,jsonb),public.finalize_xero_financial_preview_v2(uuid,text) to service_role;
