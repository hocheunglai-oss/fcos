-- Captured reads only. These rows are never accounting or approval authority.
create table public.xero_financial_preview_checkpoints (
  id uuid primary key, actor_id uuid not null, tenant_id uuid not null,
  salesforce_org_id text not null, reconciliation_version integer not null check(reconciliation_version > 0),
  input_options jsonb not null check(jsonb_typeof(input_options) = 'object'),
  input_evidence_hash text not null check(input_evidence_hash ~ '^[0-9a-f]{64}$'),
  token_version integer not null check(token_version > 0),
  state text not null default 'capturing' check(state in ('capturing','captured','published')),
  revision integer not null default 1 check(revision > 0), payload jsonb, payload_hash text, storage_hash text,
  published_run_id uuid references public.xero_financial_sync_runs(id),
  created_at timestamptz not null default clock_timestamp(), captured_at timestamptz,
  expires_at timestamptz not null, published_at timestamptz,
  check(expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  check((state = 'capturing' and payload is null and payload_hash is null and storage_hash is null and captured_at is null)
    or (state in ('captured','published') and payload is not null and payload_hash is not null and storage_hash is not null
      and jsonb_typeof(payload) = 'object' and payload_hash ~ '^[0-9a-f]{64}$'
      and storage_hash ~ '^[0-9a-f]{64}$' and captured_at is not null)),
  check((state = 'published' and published_run_id is not null and published_at is not null)
    or (state <> 'published' and published_run_id is null and published_at is null))
);
create index xero_financial_preview_checkpoint_lookup on public.xero_financial_preview_checkpoints
  (actor_id,tenant_id,salesforce_org_id,reconciliation_version,input_evidence_hash,created_at desc)
  where state = 'captured';
alter table public.xero_financial_preview_checkpoints enable row level security;
alter table public.xero_financial_preview_checkpoints force row level security;
revoke all on public.xero_financial_preview_checkpoints from public,anon,authenticated,service_role;
grant select on public.xero_financial_preview_checkpoints to service_role;
comment on table public.xero_financial_preview_checkpoints is
  'Service-only immutable complete read captures, valid for at most one hour. Never authorize, link or apply from a checkpoint.';

create function public.xero_preview_checkpoint_safe_v1(p_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_key text; v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for v_key,v_child in select key,value from jsonb_each(p_value) loop
      if regexp_replace(lower(v_key),'[^a-z0-9]','','g') in
        ('accesstoken','refreshtoken','idtoken','authorization','password','clientsecret','apikey','secretkey',
         'servicerolekey','sessiontoken','cookie','setcookie','bearertoken','privatekey','connection','env','client','actorauth')
        or not public.xero_preview_checkpoint_safe_v1(v_child) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      if not public.xero_preview_checkpoint_safe_v1(v_child) then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create function public.xero_preview_checkpoint_guard_v1(p_scope jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_tenant uuid; v_options jsonb; v_token integer;
begin
  if jsonb_typeof(p_scope) is distinct from 'object'
    or not coalesce(p_scope->>'actorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or not coalesce(p_scope->>'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or not coalesce(p_scope->>'reconciliationVersion' ~ '^[1-9][0-9]{0,8}$',false)
    or not coalesce(p_scope->>'inputEvidenceHash' ~ '^[0-9a-f]{64}$',false)
    or coalesce(trim(p_scope->>'salesforceOrgId'),'') = '' then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
  end if;
  v_options := p_scope->'inputOptions';
  if jsonb_typeof(v_options) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v_options)) <> 6
    or v_options->'linkFirst' is distinct from 'true'::jsonb
    or v_options->'recordExactMatches' is distinct from 'false'::jsonb
    or jsonb_typeof(v_options->'includePayments') is distinct from 'boolean'
    or not coalesce(v_options->>'postingMode' in ('draft','authorised'),false)
    or not coalesce(v_options->>'cutoffDate' ~ '^\d{4}-\d{2}-\d{2}$',false)
    or not (v_options ? 'campaignId')
    or (v_options->'campaignId' <> 'null'::jsonb and not coalesce(v_options->>'campaignId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
  end if;
  begin perform (v_options->>'cutoffDate')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
  end;
  v_actor := (p_scope->>'actorId')::uuid; v_tenant := (p_scope->>'tenantId')::uuid;
  if not coalesce(public.fcos_has_access(v_actor,'xero_portal'),false) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_ACCESS_REQUIRED' using errcode='42501';
  end if;
  -- Renewal is provenance only; a tenant replacement must wait for this capture transaction.
  select token_version into v_token from public.xero_contact_sync_connections
    where id='primary' and tenant_id=v_tenant::text for share;
  if not found then raise exception 'XERO_PREVIEW_CHECKPOINT_CONNECTION_CHANGED' using errcode='40001'; end if;
  return v_token;
end $$;

create function public.xero_preview_checkpoint_matches_v1(p_row public.xero_financial_preview_checkpoints,p_scope jsonb)
returns boolean language sql immutable set search_path='' as $$
  select p_row.actor_id = (p_scope->>'actorId')::uuid and p_row.tenant_id = (p_scope->>'tenantId')::uuid
    and p_row.salesforce_org_id = p_scope->>'salesforceOrgId'
    and p_row.reconciliation_version = (p_scope->>'reconciliationVersion')::integer
    and p_row.input_options = p_scope->'inputOptions' and p_row.input_evidence_hash = p_scope->>'inputEvidenceHash';
$$;

create function public.xero_preview_checkpoint_immutable_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.actor_id,new.tenant_id,new.salesforce_org_id,new.reconciliation_version,new.input_options,
      new.input_evidence_hash,new.created_at,new.expires_at)
    is distinct from row(old.id,old.actor_id,old.tenant_id,old.salesforce_org_id,old.reconciliation_version,old.input_options,
      old.input_evidence_hash,old.created_at,old.expires_at)
    or new.revision <> old.revision + 1
    or not ((old.state='capturing' and new.state='captured') or (old.state='captured' and new.state='published'))
    or (old.state <> 'capturing' and row(new.payload,new.payload_hash,new.storage_hash,new.captured_at,new.token_version)
      is distinct from row(old.payload,old.payload_hash,old.storage_hash,old.captured_at,old.token_version)) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001';
  end if;
  return new;
end $$;
create trigger xero_preview_checkpoint_immutable before update on public.xero_financial_preview_checkpoints
  for each row execute function public.xero_preview_checkpoint_immutable_v1();

create function public.xero_preview_checkpoint_create_v1(p_id uuid,p_scope jsonb,p_ttl_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_token integer; v_now timestamptz := clock_timestamp();
begin
  v_token := public.xero_preview_checkpoint_guard_v1(p_scope);
  if p_id is null or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  insert into public.xero_financial_preview_checkpoints
    (id,actor_id,tenant_id,salesforce_org_id,reconciliation_version,input_options,input_evidence_hash,token_version,created_at,expires_at)
    values(p_id,(p_scope->>'actorId')::uuid,(p_scope->>'tenantId')::uuid,p_scope->>'salesforceOrgId',
      (p_scope->>'reconciliationVersion')::integer,p_scope->'inputOptions',p_scope->>'inputEvidenceHash',v_token,
      v_now,v_now+make_interval(secs=>p_ttl_seconds)) on conflict(id) do nothing;
  select * into v_row from public.xero_financial_preview_checkpoints where id=p_id for update;
  if not public.xero_preview_checkpoint_matches_v1(v_row,p_scope) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_MISMATCH' using errcode='42501'; end if;
  if v_row.expires_at <= clock_timestamp() then raise exception 'XERO_PREVIEW_CHECKPOINT_EXPIRED' using errcode='40001'; end if;
  return to_jsonb(v_row);
end $$;

create function public.xero_preview_checkpoint_save_v1(p_id uuid,p_expected_revision integer,p_scope jsonb,p_payload text,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_payload jsonb; v_token integer;
begin
  v_token := public.xero_preview_checkpoint_guard_v1(p_scope);
  select * into v_row from public.xero_financial_preview_checkpoints where id=p_id for update;
  if not found or not public.xero_preview_checkpoint_matches_v1(v_row,p_scope) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_MISMATCH' using errcode='42501'; end if;
  if v_row.expires_at <= clock_timestamp() then raise exception 'XERO_PREVIEW_CHECKPOINT_EXPIRED' using errcode='40001'; end if;
  if p_payload is null or octet_length(p_payload) > 104857600 then
    raise exception 'XERO_PREVIEW_CHECKPOINT_TOO_LARGE' using errcode='22023'; end if;
  if p_payload_hash is null or encode(sha256(convert_to(p_payload,'UTF8')),'hex') <> p_payload_hash then
    raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='22023'; end if;
  v_payload := p_payload::jsonb;
  if jsonb_typeof(v_payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_payload)) <> 6
    or v_payload->'complete' is distinct from 'true'::jsonb
    or jsonb_typeof(v_payload->'provider') is distinct from 'object'
    or jsonb_typeof(v_payload->'automaticMappingPolicy') is distinct from 'object'
    or jsonb_typeof(v_payload->'callForecast') is distinct from 'object'
    or jsonb_typeof(v_payload->'rate') is distinct from 'object'
    or jsonb_typeof(v_payload->'provider'->'xero') is distinct from 'object'
    or v_payload->'provider'->'xero'->>'tenantId' is distinct from p_scope->>'tenantId'
    or jsonb_typeof(v_payload->'provider'->'accountResponse') is distinct from 'object'
    or jsonb_typeof(v_payload->'provider'->'taxResponse') is distinct from 'object'
    or jsonb_typeof(v_payload->'provider'->'allMappings') is distinct from 'object'
    or not (v_payload->'provider' ? 'payments') or jsonb_typeof(v_payload->'snapshotStartedAt') is distinct from 'string'
    or (p_scope->'inputOptions'->'includePayments'='true'::jsonb
      and (jsonb_typeof(v_payload->'provider'->'payments') is distinct from 'object'
        or v_payload->'provider'->'payments'->>'tenantId' is distinct from p_scope->>'tenantId')) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  begin perform (v_payload->>'snapshotStartedAt')::timestamptz;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
  end;
  if not public.xero_preview_checkpoint_safe_v1(v_payload) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_SECRET' using errcode='22023'; end if;
  -- Exact lost-response retries are allowed; no new payload can replace a capture.
  if v_row.state='captured' and v_row.revision=p_expected_revision+1 and v_row.payload=v_payload
    and v_row.payload_hash=p_payload_hash and v_row.storage_hash=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex') then
    return to_jsonb(v_row);
  end if;
  if v_row.state <> 'capturing' or v_row.revision is distinct from p_expected_revision then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  update public.xero_financial_preview_checkpoints set state='captured',revision=revision+1,payload=v_payload,
    payload_hash=p_payload_hash,storage_hash=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),
    captured_at=clock_timestamp(),token_version=v_token where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end $$;

create function public.xero_preview_checkpoint_load_v1(p_scope jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints;
begin
  perform public.xero_preview_checkpoint_guard_v1(p_scope);
  if p_id is not null then
    select * into v_row from public.xero_financial_preview_checkpoints where id=p_id;
    if not found or not public.xero_preview_checkpoint_matches_v1(v_row,p_scope) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_MISMATCH' using errcode='42501'; end if;
    if v_row.expires_at <= clock_timestamp() then raise exception 'XERO_PREVIEW_CHECKPOINT_EXPIRED' using errcode='40001'; end if;
    if v_row.state <> 'captured' then return null; end if;
  else
    select * into v_row from public.xero_financial_preview_checkpoints c
      where c.state='captured' and c.expires_at > clock_timestamp()
        and public.xero_preview_checkpoint_matches_v1(c,p_scope) order by c.created_at desc,c.id limit 1;
    if not found then return null; end if;
  end if;
  if v_row.storage_hash <> encode(sha256(convert_to(v_row.payload::text,'UTF8')),'hex')
    or not public.xero_preview_checkpoint_safe_v1(v_row.payload) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
  return to_jsonb(v_row);
end $$;

create function public.xero_preview_checkpoint_publish_v1(p_id uuid,p_expected_revision integer,p_scope jsonb,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.xero_financial_preview_checkpoints; v_run public.xero_financial_sync_runs; v_snapshot jsonb;
begin
  perform public.xero_preview_checkpoint_guard_v1(p_scope);
  select * into v_row from public.xero_financial_preview_checkpoints where id=p_id for update;
  if not found or not public.xero_preview_checkpoint_matches_v1(v_row,p_scope) then
    raise exception 'XERO_PREVIEW_CHECKPOINT_MISMATCH' using errcode='42501'; end if;
  if v_row.expires_at <= clock_timestamp() then raise exception 'XERO_PREVIEW_CHECKPOINT_EXPIRED' using errcode='40001'; end if;
  if v_row.state not in ('captured','published') or v_row.storage_hash <> encode(sha256(convert_to(v_row.payload::text,'UTF8')),'hex') then
    raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
  select * into v_run from public.xero_financial_sync_runs where id=p_run_id for share;
  v_snapshot := v_run.control_totals->'workflowSnapshot';
  if not found or v_run.mode <> 'preview' or v_run.status in ('building','cancelled')
    or v_run.created_by is distinct from v_row.actor_id
    or v_snapshot->'complete' is distinct from 'true'::jsonb
    or v_snapshot->>'tenantId' is distinct from v_row.tenant_id::text
    or v_snapshot->>'salesforceOrgId' is distinct from v_row.salesforce_org_id
    or v_snapshot->>'reconciliationVersion' is distinct from v_row.reconciliation_version::text
    or v_snapshot->'linkFirst' is distinct from v_row.input_options->'linkFirst'
    or v_snapshot->'includePayments' is distinct from v_row.input_options->'includePayments'
    or v_snapshot->'recordExactMatches' is distinct from v_row.input_options->'recordExactMatches'
    or coalesce(v_snapshot->'campaignId','null'::jsonb) is distinct from v_row.input_options->'campaignId'
    or v_run.control_totals->>'postingMode' is distinct from v_row.input_options->>'postingMode'
    or v_run.cutoff_date::text is distinct from v_row.input_options->>'cutoffDate'
    or v_snapshot->>'previewCheckpointInputEvidenceHash' is distinct from v_row.input_evidence_hash
    or v_snapshot->>'previewCheckpointPayloadHash' is distinct from v_row.payload_hash then
    raise exception 'XERO_PREVIEW_CHECKPOINT_PUBLICATION_INVALID' using errcode='40001'; end if;
  if v_row.state='published' and v_row.revision=p_expected_revision+1 and v_row.published_run_id=p_run_id then return to_jsonb(v_row); end if;
  if v_row.state <> 'captured' or v_row.revision is distinct from p_expected_revision then
    raise exception 'XERO_PREVIEW_CHECKPOINT_STALE' using errcode='40001'; end if;
  update public.xero_financial_preview_checkpoints set state='published',revision=revision+1,
    published_run_id=p_run_id,published_at=clock_timestamp() where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end $$;

revoke all on function public.xero_preview_checkpoint_safe_v1(jsonb),
  public.xero_preview_checkpoint_guard_v1(jsonb),
  public.xero_preview_checkpoint_matches_v1(public.xero_financial_preview_checkpoints,jsonb),
  public.xero_preview_checkpoint_immutable_v1(),
  public.xero_preview_checkpoint_create_v1(uuid,jsonb,integer),
  public.xero_preview_checkpoint_save_v1(uuid,integer,jsonb,text,text),
  public.xero_preview_checkpoint_load_v1(jsonb,uuid),
  public.xero_preview_checkpoint_publish_v1(uuid,integer,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.xero_preview_checkpoint_create_v1(uuid,jsonb,integer),
  public.xero_preview_checkpoint_save_v1(uuid,integer,jsonb,text,text),
  public.xero_preview_checkpoint_load_v1(jsonb,uuid),
  public.xero_preview_checkpoint_publish_v1(uuid,integer,jsonb,uuid) to service_role;
