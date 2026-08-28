create table if not exists public.connection_attestations (
  id uuid primary key default gen_random_uuid(),
  profile text not null check (profile = 'fcos-production'),
  revision bigint not null check (revision > 0),
  schema_version integer not null check (schema_version = 1),
  policy_version integer not null check (policy_version > 0),
  key_id text not null check (key_id ~ '^[0-9a-f]{16}$'),
  verified_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > verified_at),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  providers jsonb not null check (
    jsonb_typeof(providers) = 'object'
    and providers ?& array['github', 'vercel', 'supabase', 'salesforce']
    and (providers - array['github', 'vercel', 'supabase', 'salesforce']) = '{}'::jsonb
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (profile, revision),
  unique (profile, verified_at)
);

create index if not exists connection_attestations_profile_verified_idx
  on public.connection_attestations (profile, verified_at desc);

alter table public.connection_attestations enable row level security;
alter table public.connection_attestations force row level security;

revoke all on table public.connection_attestations from public, anon, authenticated;
grant select, insert on table public.connection_attestations to service_role;

create or replace function public.connection_attestation_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'connection_attestation_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists connection_attestation_immutable_trigger on public.connection_attestations;
create trigger connection_attestation_immutable_trigger
before update or delete on public.connection_attestations
for each row execute function public.connection_attestation_immutable();

create or replace function public.save_connection_attestation(p_attestation jsonb)
returns table (id uuid, revision bigint, verified_at timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile text := p_attestation ->> 'profile';
  v_revision bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'connection_attestation_service_only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_attestation) <> 'object'
     or v_profile <> 'fcos-production'
     or (p_attestation ->> 'schemaVersion')::integer <> 1
     or coalesce((p_attestation ->> 'policyVersion')::integer, 0) < 1
     or coalesce(p_attestation ->> 'keyId', '') !~ '^[0-9a-f]{16}$'
     or jsonb_typeof(p_attestation -> 'providers') <> 'object'
  then
    raise exception 'connection_attestation_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('connection-attestation:' || v_profile, 0));
  select coalesce(max(ca.revision), 0) + 1
    into v_revision
    from public.connection_attestations ca
   where ca.profile = v_profile;

  return query
  insert into public.connection_attestations (
    profile,
    revision,
    schema_version,
    policy_version,
    key_id,
    verified_at,
    expires_at,
    duration_ms,
    providers
  ) values (
    v_profile,
    v_revision,
    (p_attestation ->> 'schemaVersion')::integer,
    (p_attestation ->> 'policyVersion')::integer,
    p_attestation ->> 'keyId',
    (p_attestation ->> 'verifiedAt')::timestamptz,
    (p_attestation ->> 'expiresAt')::timestamptz,
    nullif(p_attestation ->> 'durationMs', '')::integer,
    p_attestation -> 'providers'
  )
  returning connection_attestations.id, connection_attestations.revision, connection_attestations.verified_at;
end;
$$;

revoke all on function public.save_connection_attestation(jsonb) from public, anon, authenticated;
grant execute on function public.save_connection_attestation(jsonb) to service_role;
revoke all on function public.connection_attestation_immutable() from public, anon, authenticated;

comment on table public.connection_attestations is
  'Service-only, non-secret, signed machine verification results for the FCOS connection policy. Financial and credential material is prohibited.';
comment on function public.save_connection_attestation(jsonb) is
  'Atomically appends one schema-validated connection attestation with a monotonic per-profile revision.';
