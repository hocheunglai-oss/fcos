-- Derived proof of a fresh, signed FCUNO bearer bound to a verified Supabase
-- session. No provider token, refresh token or credential material is stored.
create table if not exists public.fcos_external_identity_sessions (
  session_id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  identity_link_id uuid not null references public.fcos_external_identity_links(id) on delete cascade,
  issuer text not null,
  subject text not null,
  authenticated_at timestamptz not null,
  credential_revision bigint not null check (credential_revision >= 1),
  identity_revision bigint not null check (identity_revision >= 1),
  provider_issued_at timestamptz not null,
  provider_token_hash text not null unique check (provider_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (authenticated_at <= provider_issued_at + interval '60 seconds'),
  check (provider_issued_at <= created_at + interval '60 seconds')
);
alter table public.fcos_external_identity_sessions enable row level security;
revoke all on table public.fcos_external_identity_sessions from public, anon, authenticated, service_role;
grant select, insert on table public.fcos_external_identity_sessions to service_role;

create or replace function public.fcos_reject_identity_session_update()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'FCUNO session proofs are immutable.';
end;
$$;
drop trigger if exists fcos_external_identity_sessions_immutable on public.fcos_external_identity_sessions;
create trigger fcos_external_identity_sessions_immutable
before update on public.fcos_external_identity_sessions
for each row execute function public.fcos_reject_identity_session_update();
revoke all on function public.fcos_reject_identity_session_update() from public, anon, authenticated;
grant execute on function public.fcos_reject_identity_session_update() to service_role;

-- Hold the identity row lock through profile projection, audit and terminal
-- transaction status. Equal-revision retries read the current stored fields;
-- they cannot overwrite a concurrently synchronized newer identity.
create or replace function public.fcos_finalize_identity_sync(
  p_transaction_id uuid, p_identity_link_id uuid, p_revision bigint
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare
  v_link public.fcos_external_identity_links%rowtype;
  v_transaction public.fcos_external_identity_sync_transactions%rowtype;
  v_permitted boolean;
  v_projected boolean := false;
  v_ignored boolean;
begin
  select * into v_link from public.fcos_external_identity_links where id = p_identity_link_id for update;
  if not found then raise exception 'FCUNO_IDENTITY_LINK_REQUIRED'; end if;
  select * into v_transaction from public.fcos_external_identity_sync_transactions where id = p_transaction_id for update;
  if not found or v_transaction.provider <> v_link.provider or v_transaction.issuer <> v_link.issuer
    or v_transaction.subject <> v_link.subject or v_transaction.revision <> p_revision then
    raise exception 'FCUNO_IDENTITY_EVENT_CONFLICT';
  end if;
  if v_transaction.status in ('applied', 'ignored') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'eventId', v_transaction.event_id, 'revision', p_revision);
  end if;
  if v_link.revision < p_revision then raise exception 'FCUNO_IDENTITY_REVISION_CONFLICT'; end if;
  v_ignored := v_link.revision > p_revision;
  v_permitted := v_link.source_active and v_link.use_fcos;
  if not v_ignored and v_link.auth_user_id is not null and coalesce(v_link.email, '') <> '' then
    update public.user_profiles set email = v_link.email, full_name = coalesce(v_link.full_name, ''), updated_at = now()
    where id = v_link.auth_user_id;
    v_projected := found;
  end if;
  insert into public.fcos_external_identity_audit(identity_link_id, provider, issuer, subject, transaction_id, action, revision, metadata)
  values (v_link.id, v_link.provider, v_link.issuer, v_link.subject, v_transaction.id,
    case when v_ignored then 'sync_ignored_stale_revision' when v_permitted then 'sync_access_projected' else 'sync_access_revoked' end,
    p_revision,
    case when v_ignored then jsonb_build_object('current_revision', v_link.revision)
      else jsonb_build_object('source_active', v_link.source_active, 'use_fcos', v_link.use_fcos,
        'use_spc', v_link.use_spc, 'credential_revision', v_link.credential_revision, 'profile_projected', v_projected) end);
  update public.fcos_external_identity_sync_transactions
  set status = case when v_ignored then 'ignored' else 'applied' end, error_code = null, completed_at = now()
  where id = v_transaction.id;
  if v_ignored then return jsonb_build_object('ok', true, 'ignored', true, 'eventId', v_transaction.event_id, 'revision', p_revision); end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'eventId', v_transaction.event_id,
    'revision', p_revision, 'access', case when v_permitted then 'active' else 'revoked' end);
end;
$$;
revoke all on function public.fcos_finalize_identity_sync(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.fcos_finalize_identity_sync(uuid, uuid, bigint) to service_role;
