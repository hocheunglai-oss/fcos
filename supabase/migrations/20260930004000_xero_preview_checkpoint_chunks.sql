-- Bounded, immutable captured reads. No checkpoint is accounting or approval authority.
alter table public.xero_financial_preview_checkpoints
  add column storage_version integer not null default 1 check (storage_version in (1,2));

create table public.xero_financial_preview_checkpoint_chunks (
  checkpoint_id uuid not null references public.xero_financial_preview_checkpoints(id),
  ordinal integer not null check (ordinal >= 0 and ordinal < 8192),
  payload_text text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  bytes integer generated always as (octet_length(payload_text)) stored,
  primary key (checkpoint_id,ordinal),
  check (bytes > 0 and bytes <= 262144)
);
alter table public.xero_financial_preview_checkpoint_chunks enable row level security;
alter table public.xero_financial_preview_checkpoint_chunks force row level security;
revoke all on public.xero_financial_preview_checkpoint_chunks from public,anon,authenticated,service_role;
comment on table public.xero_financial_preview_checkpoint_chunks is
  'Immutable bounded JSON evidence parts. Service RPC only; complete manifests and exact scope/run hashes are mandatory.';

create function public.xero_preview_checkpoint_chunk_immutable_v2()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001';
end $$;
create trigger xero_preview_checkpoint_chunk_immutable before update or delete
  on public.xero_financial_preview_checkpoint_chunks for each row
  execute function public.xero_preview_checkpoint_chunk_immutable_v2();

create function public.xero_preview_checkpoint_metadata_v2(p_row public.xero_financial_preview_checkpoints,p_with_payload boolean default false)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('id',p_row.id,'actor_id',p_row.actor_id,'tenant_id',p_row.tenant_id,
    'salesforce_org_id',p_row.salesforce_org_id,'reconciliation_version',p_row.reconciliation_version,
    'input_options',p_row.input_options,'input_evidence_hash',p_row.input_evidence_hash,
    'token_version',p_row.token_version,'state',p_row.state,'revision',p_row.revision,
    'payload_hash',p_row.payload_hash,'storage_hash',p_row.storage_hash,'published_run_id',p_row.published_run_id,
    'created_at',p_row.created_at,'captured_at',p_row.captured_at,'expires_at',p_row.expires_at,
    'published_at',p_row.published_at,'storage_version',p_row.storage_version)
    || case when p_with_payload then jsonb_build_object('payload',p_row.payload) else '{}'::jsonb end;
$$;

-- Resolve only the requested logical path. A leaf is at most 256 KiB; structural
-- containers return an empty value of their type, never an assembled inventory.
create function public.xero_preview_checkpoint_extract_v2(p_id uuid,p_node jsonb,p_path text[])
returns jsonb language plpgsql stable set search_path='' as $$
declare v_value jsonb; v_entry jsonb; v_index integer; v_offset integer; v_count integer;
begin
  if p_node->>'type'='value' then
    select payload_text::jsonb into v_value from public.xero_financial_preview_checkpoint_chunks
      where checkpoint_id=p_id and ordinal=(p_node->>'ordinal')::integer;
    return case when cardinality(p_path)=0 then v_value else v_value #> p_path end;
  elsif p_node->>'type'='object' then
    if cardinality(p_path)=0 then return '{}'::jsonb; end if;
    for v_entry in select value from jsonb_array_elements(p_node->'entries') loop
      if v_entry->>0=p_path[1] then
        return public.xero_preview_checkpoint_extract_v2(p_id,v_entry->1,p_path[2:]);
      end if;
    end loop;
    return null;
  elsif p_node->>'type'='array' then
    if cardinality(p_path)=0 then return '[]'::jsonb; end if;
    if not coalesce(p_path[1] ~ '^(0|[1-9][0-9]{0,8})$',false) then return null; end if;
    v_index := p_path[1]::integer;
    for v_entry in select value from jsonb_array_elements(p_node->'entries') loop
      v_offset := (v_entry->>'offset')::integer; v_count := (v_entry->>'count')::integer;
      if v_index >= v_offset and v_index < v_offset+v_count then
        if v_entry ? 'node' then
          return public.xero_preview_checkpoint_extract_v2(p_id,v_entry->'node',p_path[2:]);
        end if;
        select payload_text::jsonb into v_value from public.xero_financial_preview_checkpoint_chunks
          where checkpoint_id=p_id and ordinal=(v_entry->>'ordinal')::integer;
        v_value := v_value->(v_index-v_offset);
        return case when cardinality(p_path)=1 then v_value else v_value #> p_path[2:] end;
      end if;
    end loop;
  end if;
  return null;
end $$;

-- Validate the complete descriptor tree and return references, without loading
-- all parts or reconstructing a large JSONB value. Arrays must cover each offset.
create function public.xero_preview_checkpoint_manifest_refs_v2(p_id uuid,p_node jsonb,p_depth integer default 0)
returns integer[] language plpgsql stable set search_path='' as $$
declare v_kind text; v_entry jsonb; v_key text; v_value jsonb; v_refs integer[] := '{}';
  v_ordinal integer; v_offset integer := 0; v_count integer; v_length integer; v_fields integer;
begin
  if p_depth > 64 or jsonb_typeof(p_node) is distinct from 'object' then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  v_kind := p_node->>'type';
  select count(*) into v_fields from jsonb_object_keys(p_node);
  if v_kind='value' then
    if v_fields<>2 or not coalesce(p_node->>'ordinal' ~ '^(0|[1-9][0-9]{0,3})$',false)
      or jsonb_typeof(p_node->'ordinal') is distinct from 'number' then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    v_ordinal := (p_node->>'ordinal')::integer;
    if v_ordinal >= 8192 or not exists (select 1 from public.xero_financial_preview_checkpoint_chunks
      where checkpoint_id=p_id and ordinal=v_ordinal) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INCOMPLETE' using errcode='40001'; end if;
    return array[v_ordinal];
  elsif v_kind='object' then
    if v_fields<>2 or jsonb_typeof(p_node->'entries') is distinct from 'array' then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    if exists (select 1 from jsonb_array_elements(p_node->'entries') e(value)
      group by value->>0 having count(*)>1) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    for v_entry in select value from jsonb_array_elements(p_node->'entries') loop
      if jsonb_typeof(v_entry) is distinct from 'array' or jsonb_array_length(v_entry)<>2
        or jsonb_typeof(v_entry->0) is distinct from 'string' then
        raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
      v_key := v_entry->>0;
      if regexp_replace(lower(v_key),'[^a-z0-9]','','g') in
        ('accesstoken','refreshtoken','idtoken','authorization','password','clientsecret','apikey','secretkey',
         'servicerolekey','sessiontoken','cookie','setcookie','bearertoken','privatekey','connection','env','client','actorauth') then
        raise exception 'XERO_PREVIEW_CHECKPOINT_SECRET' using errcode='22023'; end if;
      v_refs := v_refs || public.xero_preview_checkpoint_manifest_refs_v2(p_id,v_entry->1,p_depth+1);
    end loop;
    return v_refs;
  elsif v_kind='array' then
    if v_fields<>3 or jsonb_typeof(p_node->'entries') is distinct from 'array'
      or jsonb_typeof(p_node->'length') is distinct from 'number'
      or not coalesce(p_node->>'length' ~ '^(0|[1-9][0-9]{0,8})$',false) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    v_length := (p_node->>'length')::integer;
    for v_entry in select value from jsonb_array_elements(p_node->'entries') loop
      if jsonb_typeof(v_entry) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(v_entry))<>3
        or jsonb_typeof(v_entry->'offset') is distinct from 'number'
        or not coalesce(v_entry->>'offset' ~ '^(0|[1-9][0-9]{0,8})$',false)
        or jsonb_typeof(v_entry->'count') is distinct from 'number'
        or not coalesce(v_entry->>'count' ~ '^[1-9][0-9]{0,8}$',false) then
        raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
      v_count := (v_entry->>'count')::integer;
      if (v_entry->>'offset')::integer<>v_offset or v_offset::bigint+v_count>v_length then
        raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
      if v_entry ? 'ordinal' then
        if jsonb_typeof(v_entry->'ordinal') is distinct from 'number'
          or not coalesce(v_entry->>'ordinal' ~ '^(0|[1-9][0-9]{0,3})$',false)
          or (v_entry->>'ordinal')::integer>=8192 then
          raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
        v_ordinal := (v_entry->>'ordinal')::integer;
        select payload_text::jsonb into v_value from public.xero_financial_preview_checkpoint_chunks
          where checkpoint_id=p_id and ordinal=v_ordinal;
        if not found then raise exception 'XERO_PREVIEW_CHECKPOINT_INCOMPLETE' using errcode='40001'; end if;
        if jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value)<>v_count then
          raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
        v_refs := array_append(v_refs,v_ordinal);
      elsif v_entry ? 'node' and v_count=1 then
        v_refs := v_refs || public.xero_preview_checkpoint_manifest_refs_v2(p_id,v_entry->'node',p_depth+1);
      else raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
      v_offset := v_offset+v_count;
    end loop;
    if v_offset<>v_length then raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    return v_refs;
  end if;
  raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
end $$;

create function public.xero_preview_checkpoint_publication_matches_v2(p_row public.xero_financial_preview_checkpoints,p_run_id uuid)
returns boolean language plpgsql stable set search_path='' as $$
declare v_run public.xero_financial_sync_runs; v_snapshot jsonb; v_ref jsonb; v_revision integer;
begin
  select * into v_run from public.xero_financial_sync_runs where id=p_run_id;
  if not found then return false; end if;
  v_snapshot := v_run.control_totals->'workflowSnapshot'; v_ref := v_snapshot->'inventoryReference';
  v_revision := case when p_row.state='published' then p_row.revision-1 else p_row.revision end;
  if p_row.storage_version<>2 or jsonb_typeof(v_ref) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v_ref))<>13
    or v_run.mode <> 'preview' or v_run.status in ('building','cancelled')
    or v_run.created_by is distinct from p_row.actor_id
    or v_snapshot->'complete' is distinct from 'true'::jsonb
    or v_snapshot->>'tenantId' is distinct from p_row.tenant_id::text
    or v_snapshot->>'salesforceOrgId' is distinct from p_row.salesforce_org_id
    or v_snapshot->>'reconciliationVersion' is distinct from p_row.reconciliation_version::text
    or v_snapshot->'linkFirst' is distinct from p_row.input_options->'linkFirst'
    or v_snapshot->'includePayments' is distinct from p_row.input_options->'includePayments'
    or v_snapshot->'recordExactMatches' is distinct from p_row.input_options->'recordExactMatches'
    or coalesce(v_snapshot->'campaignId','null'::jsonb) is distinct from p_row.input_options->'campaignId'
    or v_run.control_totals->>'postingMode' is distinct from p_row.input_options->>'postingMode'
    or v_run.cutoff_date::text is distinct from p_row.input_options->>'cutoffDate'
    or v_snapshot->>'previewCheckpointInputEvidenceHash' is distinct from p_row.input_evidence_hash
    or v_snapshot->>'previewCheckpointPayloadHash' is distinct from p_row.payload_hash
    or v_ref->>'checkpointId' is distinct from p_row.id::text
    or v_ref->'revision' is distinct from to_jsonb(v_revision)
    or v_ref->>'actorId' is distinct from p_row.actor_id::text
    or v_ref->>'tenantId' is distinct from p_row.tenant_id::text
    or v_ref->>'salesforceOrgId' is distinct from p_row.salesforce_org_id
    or v_ref->'reconciliationVersion' is distinct from to_jsonb(p_row.reconciliation_version)
    or v_ref->'inputOptions' is distinct from p_row.input_options
    or v_ref->>'inputEvidenceHash' is distinct from p_row.input_evidence_hash
    or v_ref->>'payloadHash' is distinct from p_row.payload_hash
    or v_ref->>'storageHash' is distinct from p_row.storage_hash
    or v_ref->'tokenVersion' is distinct from to_jsonb(p_row.token_version)
    or v_ref->'storageVersion' is distinct from '2'::jsonb
    or (v_ref->>'capturedAt')::timestamptz is distinct from p_row.captured_at then return false; end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

-- The original identity/state trigger remains authoritative. This additional
-- guard prevents a retained v1 RPC from capturing/publishing a v2 row improperly.
create function public.xero_preview_checkpoint_parent_guard_v2()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.storage_version is distinct from old.storage_version then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  if new.storage_version=2 then
    if jsonb_typeof(new.payload) is distinct from 'object'
      or new.payload->'storageVersion' is distinct from '2'::jsonb
      or (select count(*) from jsonb_object_keys(new.payload))<>3
      or jsonb_typeof(new.payload->'manifest') is distinct from 'object'
      or jsonb_typeof(new.payload->'summary') is distinct from 'object'
      or octet_length(new.payload::text)>524288 then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    if new.state='published' and not public.xero_preview_checkpoint_publication_matches_v2(new,new.published_run_id) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_PUBLICATION_INVALID' using errcode='40001'; end if;
  end if;
  return new;
end $$;
create trigger xero_preview_checkpoint_parent_guard_v2 before update
  on public.xero_financial_preview_checkpoints for each row
  execute function public.xero_preview_checkpoint_parent_guard_v2();

create function public.xero_preview_checkpoint_require_v2(p_id uuid,p_scope jsonb,p_run_id uuid default null,p_write boolean default false)
returns public.xero_financial_preview_checkpoints language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints;
begin
  perform public.xero_preview_checkpoint_guard_v1(p_scope);
  if p_write then select * into v_row from public.xero_financial_preview_checkpoints where id=p_id for update;
  else select * into v_row from public.xero_financial_preview_checkpoints where id=p_id for share; end if;
  if not found or v_row.storage_version<>2 or not public.xero_preview_checkpoint_matches_v1(v_row,p_scope) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_MISMATCH' using errcode='42501'; end if;
  if p_run_id is not null then
    perform 1 from public.xero_financial_sync_runs where id=p_run_id for share;
    if not found or p_write or v_row.state<>'published' or v_row.published_run_id is distinct from p_run_id
      or not public.xero_preview_checkpoint_publication_matches_v2(v_row,p_run_id) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_PUBLICATION_INVALID' using errcode='40001'; end if;
  elsif v_row.expires_at<=clock_timestamp() then
    raise exception 'XERO_PREVIEW_CHECKPOINT_EXPIRED' using errcode='40001'; end if;
  return v_row;
end $$;

create function public.xero_preview_checkpoint_create_v2(p_id uuid,p_scope jsonb,p_ttl_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_token integer; v_now timestamptz := clock_timestamp();
begin
  v_token := public.xero_preview_checkpoint_guard_v1(p_scope);
  if p_id is null or p_ttl_seconds is null or p_ttl_seconds<1 or p_ttl_seconds>3600 then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  insert into public.xero_financial_preview_checkpoints
    (id,actor_id,tenant_id,salesforce_org_id,reconciliation_version,input_options,input_evidence_hash,token_version,created_at,expires_at,storage_version)
    values(p_id,(p_scope->>'actorId')::uuid,(p_scope->>'tenantId')::uuid,p_scope->>'salesforceOrgId',
      (p_scope->>'reconciliationVersion')::integer,p_scope->'inputOptions',p_scope->>'inputEvidenceHash',v_token,
      v_now,v_now+make_interval(secs=>p_ttl_seconds),2) on conflict(id) do nothing;
  v_row := public.xero_preview_checkpoint_require_v2(p_id,p_scope,null,true);
  return public.xero_preview_checkpoint_metadata_v2(v_row);
end $$;

create function public.xero_preview_checkpoint_save_chunks_v2(p_id uuid,p_expected_revision integer,p_scope jsonb,p_chunks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_chunk jsonb; v_value jsonb; v_text text; v_hash text;
  v_ordinal integer; v_total bigint; v_batch_bytes integer := 0; v_existing public.xero_financial_preview_checkpoint_chunks; v_retry boolean;
begin
  v_row := public.xero_preview_checkpoint_require_v2(p_id,p_scope,null,true);
  v_retry := coalesce(v_row.state='captured' and v_row.revision=p_expected_revision+1,false);
  if not v_retry and (v_row.state<>'capturing' or v_row.revision is distinct from p_expected_revision) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks)<1
    or jsonb_array_length(p_chunks)>8192 then
    raise exception 'XERO_PREVIEW_CHECKPOINT_TOO_LARGE' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_chunks) c(value) group by value->>'ordinal' having count(*)>1) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  select coalesce(sum(bytes),0) into v_total from public.xero_financial_preview_checkpoint_chunks where checkpoint_id=p_id;
  for v_chunk in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(v_chunk) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_chunk))<>3
      or jsonb_typeof(v_chunk->'ordinal') is distinct from 'number'
      or not coalesce(v_chunk->>'ordinal' ~ '^(0|[1-9][0-9]{0,3})$',false)
      or (v_chunk->>'ordinal')::integer>=8192 or jsonb_typeof(v_chunk->'payloadText') is distinct from 'string'
      or jsonb_typeof(v_chunk->'payloadHash') is distinct from 'string' then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    v_ordinal := (v_chunk->>'ordinal')::integer; v_text := v_chunk->>'payloadText'; v_hash := v_chunk->>'payloadHash';
    v_batch_bytes := v_batch_bytes+octet_length(v_text);
    if octet_length(v_text)<1 or octet_length(v_text)>262144 or v_batch_bytes>524288 then
      raise exception 'XERO_PREVIEW_CHECKPOINT_TOO_LARGE' using errcode='22023'; end if;
    if not coalesce(v_hash ~ '^[0-9a-f]{64}$',false) or encode(sha256(convert_to(v_text,'UTF8')),'hex')<>v_hash then
      raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='22023'; end if;
    begin v_value := v_text::jsonb;
      exception when invalid_text_representation then raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
    end;
    if not public.xero_preview_checkpoint_safe_v1(v_value) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_SECRET' using errcode='22023'; end if;
    select * into v_existing from public.xero_financial_preview_checkpoint_chunks where checkpoint_id=p_id and ordinal=v_ordinal;
    if found then
      if v_existing.payload_hash is distinct from v_hash or v_existing.payload_text is distinct from v_text then
        raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
    else
      if v_retry then raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
      v_total := v_total+octet_length(v_text);
      if v_total>104857600 then raise exception 'XERO_PREVIEW_CHECKPOINT_TOO_LARGE' using errcode='22023'; end if;
      insert into public.xero_financial_preview_checkpoint_chunks(checkpoint_id,ordinal,payload_text,payload_hash)
        values(p_id,v_ordinal,v_text,v_hash);
    end if;
  end loop;
  return public.xero_preview_checkpoint_metadata_v2(v_row);
end $$;

create function public.xero_preview_checkpoint_finalize_v2(p_id uuid,p_expected_revision integer,p_scope jsonb,p_manifest jsonb,p_summary jsonb,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_payload jsonb; v_refs integer[]; v_count integer;
  v_min integer; v_max integer; v_total bigint; v_keys text[]; v_provider jsonb; v_snapshot jsonb; v_chunk record; v_token integer;
begin
  v_row := public.xero_preview_checkpoint_require_v2(p_id,p_scope,null,true);
  if jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->>'type' is distinct from 'object'
    or jsonb_typeof(p_summary) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_summary))<>5
    or not coalesce(p_payload_hash ~ '^[0-9a-f]{64}$',false) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  v_payload := jsonb_build_object('storageVersion',2,'manifest',p_manifest,'summary',p_summary);
  if octet_length(v_payload::text)>524288 then raise exception 'XERO_PREVIEW_CHECKPOINT_TOO_LARGE' using errcode='22023'; end if;
  if not public.xero_preview_checkpoint_safe_v1(p_summary) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_SECRET' using errcode='22023'; end if;
  -- Every stored part must be referenced exactly once, with contiguous ordinals.
  v_refs := public.xero_preview_checkpoint_manifest_refs_v2(p_id,p_manifest);
  select count(*),min(ordinal),max(ordinal),coalesce(sum(bytes),0) into v_count,v_min,v_max,v_total
    from public.xero_financial_preview_checkpoint_chunks where checkpoint_id=p_id;
  if v_count=0 or v_min<>0 or v_max<>v_count-1 or v_total>104857600 or cardinality(v_refs)<>v_count
    or (select count(distinct ordinal) from unnest(v_refs) ordinal)<>v_count then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INCOMPLETE' using errcode='40001'; end if;
  -- Recheck stored digests one bounded value at a time, with no large aggregate.
  for v_chunk in select ordinal,payload_hash,bytes from public.xero_financial_preview_checkpoint_chunks where checkpoint_id=p_id loop
    if not exists (select 1 from public.xero_financial_preview_checkpoint_chunks c
      where c.checkpoint_id=p_id and c.ordinal=v_chunk.ordinal
        and c.bytes=octet_length(c.payload_text) and c.payload_hash=encode(sha256(convert_to(c.payload_text,'UTF8')),'hex')) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
  end loop;
  select array_agg(value->>0 order by value->>0) into v_keys from jsonb_array_elements(p_manifest->'entries');
  if v_keys is distinct from array['automaticMappingPolicy','callForecast','complete','provider','rate','snapshotStartedAt'] then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  if public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['complete']) is distinct from 'true'::jsonb
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['automaticMappingPolicy'])) is distinct from 'object'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['callForecast'])) is distinct from 'object'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['rate'])) is distinct from 'object'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider'])) is distinct from 'object'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','xero'])) is distinct from 'object'
    or public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','xero','tenantId']) #>> '{}' is distinct from p_scope->>'tenantId'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','accountResponse'])) is distinct from 'object'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','taxResponse'])) is distinct from 'object'
    or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','allMappings'])) is distinct from 'object'
    or public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','payments']) is null
    or (p_scope->'inputOptions'->'includePayments'='true'::jsonb and
      (jsonb_typeof(public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','payments'])) is distinct from 'object'
        or public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['provider','payments','tenantId']) #>> '{}' is distinct from p_scope->>'tenantId')) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  select value->1 into v_provider from jsonb_array_elements(p_manifest->'entries') where value->>0='provider';
  if v_provider->>'type'='value' then
    select payload_text::jsonb into v_provider from public.xero_financial_preview_checkpoint_chunks
      where checkpoint_id=p_id and ordinal=(v_provider->>'ordinal')::integer;
    select array_agg(key order by key) into v_keys from jsonb_object_keys(v_provider) key;
  else
    select array_agg(value->>0 order by value->>0) into v_keys from jsonb_array_elements(v_provider->'entries');
  end if;
  if v_keys is distinct from array['accountResponse','allMappings','payments','taxResponse','xero'] then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  v_snapshot := public.xero_preview_checkpoint_extract_v2(p_id,p_manifest,array['snapshotStartedAt']);
  if jsonb_typeof(v_snapshot) is distinct from 'string' then raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  begin
    if not isfinite((v_snapshot #>> '{}')::timestamptz) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
  end;
  if p_summary->'complete' is distinct from 'true'::jsonb or p_summary->>'tenantId' is distinct from p_scope->>'tenantId'
    or p_summary->'includePayments' is distinct from p_scope->'inputOptions'->'includePayments'
    or p_summary->'snapshotStartedAt' is distinct from v_snapshot
    or p_summary->'providerKeys' is distinct from '["accountResponse","allMappings","payments","taxResponse","xero"]'::jsonb then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  -- Exact lost-response retries retain the original TTL and token provenance.
  if v_row.state='captured' and v_row.revision=p_expected_revision+1 and v_row.payload=v_payload
    and v_row.payload_hash=p_payload_hash and v_row.storage_hash=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex') then
    return public.xero_preview_checkpoint_metadata_v2(v_row,true); end if;
  if v_row.state<>'capturing' or v_row.revision is distinct from p_expected_revision then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  v_token := public.xero_preview_checkpoint_guard_v1(p_scope);
  update public.xero_financial_preview_checkpoints set state='captured',revision=revision+1,payload=v_payload,
    payload_hash=p_payload_hash,storage_hash=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),
    captured_at=clock_timestamp(),token_version=v_token where id=p_id returning * into v_row;
  return public.xero_preview_checkpoint_metadata_v2(v_row,true);
end $$;

create function public.xero_preview_checkpoint_load_v2(p_scope jsonb,p_id uuid default null,p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_id uuid;
begin
  perform public.xero_preview_checkpoint_guard_v1(p_scope);
  if p_id is null then
    if p_run_id is not null then raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
    select id into v_id from public.xero_financial_preview_checkpoints c where c.storage_version=2
      and c.state='captured' and c.expires_at>clock_timestamp() and public.xero_preview_checkpoint_matches_v1(c,p_scope)
      order by c.created_at desc,c.id limit 1;
    if not found then return null; end if;
  else v_id := p_id; end if;
  v_row := public.xero_preview_checkpoint_require_v2(v_id,p_scope,p_run_id,false);
  if v_row.state<>'captured' and p_run_id is null then return null; end if;
  if v_row.storage_hash is distinct from encode(sha256(convert_to(v_row.payload::text,'UTF8')),'hex')
    or v_row.payload->'storageVersion' is distinct from '2'::jsonb then
    raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
  return public.xero_preview_checkpoint_metadata_v2(v_row,true);
end $$;

create function public.xero_preview_checkpoint_read_chunks_v2(p_id uuid,p_scope jsonb,p_after_ordinal integer default -1,p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_chunks jsonb := '[]'; v_chunk record; v_last integer := p_after_ordinal;
begin
  v_row := public.xero_preview_checkpoint_require_v2(p_id,p_scope,p_run_id,false);
  if v_row.state<>'captured' and not (v_row.state='published' and p_run_id is not null) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  if p_after_ordinal is null or p_after_ordinal < -1 or p_after_ordinal>=8192 then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  for v_chunk in select ordinal,payload_text,payload_hash from public.xero_financial_preview_checkpoint_chunks
    where checkpoint_id=p_id and ordinal>p_after_ordinal order by ordinal limit 2 loop
    if encode(sha256(convert_to(v_chunk.payload_text,'UTF8')),'hex')<>v_chunk.payload_hash then
      raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
    v_chunks := v_chunks || jsonb_build_array(jsonb_build_object('ordinal',v_chunk.ordinal,'payloadText',v_chunk.payload_text,'payloadHash',v_chunk.payload_hash));
    v_last := v_chunk.ordinal;
  end loop;
  return jsonb_build_object('chunks',v_chunks,'hasMore',exists(select 1 from public.xero_financial_preview_checkpoint_chunks
    where checkpoint_id=p_id and ordinal>v_last));
end $$;

create function public.xero_preview_checkpoint_publish_v2(p_id uuid,p_expected_revision integer,p_scope jsonb,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints;
begin
  v_row := public.xero_preview_checkpoint_require_v2(p_id,p_scope,null,true);
  if v_row.state not in ('captured','published')
    or v_row.storage_hash is distinct from encode(sha256(convert_to(v_row.payload::text,'UTF8')),'hex') then
    raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
  -- Lock the exact run so its authority cannot change during publication.
  perform 1 from public.xero_financial_sync_runs where id=p_run_id for share;
  if not found or not public.xero_preview_checkpoint_publication_matches_v2(v_row,p_run_id) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_PUBLICATION_INVALID' using errcode='40001'; end if;
  if v_row.state='published' and v_row.revision=p_expected_revision+1 and v_row.published_run_id=p_run_id then
    return public.xero_preview_checkpoint_metadata_v2(v_row); end if;
  if v_row.state<>'captured' or v_row.revision is distinct from p_expected_revision then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  update public.xero_financial_preview_checkpoints set state='published',revision=revision+1,
    published_run_id=p_run_id,published_at=clock_timestamp() where id=p_id returning * into v_row;
  return public.xero_preview_checkpoint_metadata_v2(v_row);
end $$;

revoke all on function public.xero_preview_checkpoint_chunk_immutable_v2(),
  public.xero_preview_checkpoint_metadata_v2(public.xero_financial_preview_checkpoints,boolean),
  public.xero_preview_checkpoint_extract_v2(uuid,jsonb,text[]),
  public.xero_preview_checkpoint_manifest_refs_v2(uuid,jsonb,integer),
  public.xero_preview_checkpoint_publication_matches_v2(public.xero_financial_preview_checkpoints,uuid),
  public.xero_preview_checkpoint_parent_guard_v2(),
  public.xero_preview_checkpoint_require_v2(uuid,jsonb,uuid,boolean),
  public.xero_preview_checkpoint_create_v2(uuid,jsonb,integer),
  public.xero_preview_checkpoint_save_chunks_v2(uuid,integer,jsonb,jsonb),
  public.xero_preview_checkpoint_finalize_v2(uuid,integer,jsonb,jsonb,jsonb,text),
  public.xero_preview_checkpoint_load_v2(jsonb,uuid,uuid),
  public.xero_preview_checkpoint_read_chunks_v2(uuid,jsonb,integer,uuid),
  public.xero_preview_checkpoint_publish_v2(uuid,integer,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.xero_preview_checkpoint_create_v2(uuid,jsonb,integer),
  public.xero_preview_checkpoint_save_chunks_v2(uuid,integer,jsonb,jsonb),
  public.xero_preview_checkpoint_finalize_v2(uuid,integer,jsonb,jsonb,jsonb,text),
  public.xero_preview_checkpoint_load_v2(jsonb,uuid,uuid),
  public.xero_preview_checkpoint_read_chunks_v2(uuid,jsonb,integer,uuid),
  public.xero_preview_checkpoint_publish_v2(uuid,integer,jsonb,uuid) to service_role;
