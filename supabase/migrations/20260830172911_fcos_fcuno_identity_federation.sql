-- FCUNO is the authority for whether a person may use FCOS. These are
-- service-only records: browser roles must never read or mutate identities,
-- synchronization envelopes, or identity audit evidence.
create table if not exists public.fcos_external_identity_links (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'fcuno' check (provider = 'fcuno'),
  issuer text not null,
  subject text not null,
  auth_user_id uuid null references auth.users(id) on delete set null,
  source_active boolean not null default false,
  use_fcos boolean not null default false,
  use_spc boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  credential_revision bigint not null default 1 check (credential_revision >= 1),
  email text null,
  email_verified boolean not null default false,
  username text null,
  full_name text null,
  source_updated_at timestamptz null,
  revoked_before timestamptz null,
  last_synced_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, issuer, subject)
);

create unique index if not exists fcos_external_identity_links_auth_user_provider_idx
  on public.fcos_external_identity_links (auth_user_id, provider)
  where auth_user_id is not null;

create index if not exists fcos_external_identity_links_lookup_idx
  on public.fcos_external_identity_links (provider, issuer, subject);

create or replace function public.fcos_protect_external_identity_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.revision < old.revision then
    raise exception 'FCUNO identity revision cannot move backwards.';
  end if;
  if new.credential_revision < old.credential_revision then
    raise exception 'FCUNO credential revision cannot move backwards.';
  end if;
  if old.auth_user_id is not null and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'A linked FCOS authentication identity cannot be rebound.';
  end if;
  if new.revision = old.revision and row(
    new.source_active, new.use_fcos, new.use_spc, new.credential_revision,
    new.email, new.email_verified, new.username, new.full_name,
    new.source_updated_at, new.revoked_before
  ) is distinct from row(
    old.source_active, old.use_fcos, old.use_spc, old.credential_revision,
    old.email, old.email_verified, old.username, old.full_name,
    old.source_updated_at, old.revoked_before
  ) then
    raise exception 'A synchronized FCUNO identity revision is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists fcos_protect_external_identity_revision
  on public.fcos_external_identity_links;
create trigger fcos_protect_external_identity_revision
before update on public.fcos_external_identity_links
for each row execute function public.fcos_protect_external_identity_revision();

create table if not exists public.fcos_external_identity_sync_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'fcuno' check (provider = 'fcuno'),
  issuer text not null,
  event_id text not null,
  subject text not null,
  revision bigint not null check (revision >= 0),
  status text not null check (status in ('received', 'applied', 'ignored', 'failed')),
  request_jti text null,
  request_hash text not null,
  error_code text null,
  received_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (provider, issuer, event_id)
);

create index if not exists fcos_external_identity_sync_transactions_subject_idx
  on public.fcos_external_identity_sync_transactions (provider, issuer, subject, received_at desc);

create table if not exists public.fcos_external_identity_audit (
  id uuid primary key default gen_random_uuid(),
  identity_link_id uuid null references public.fcos_external_identity_links(id) on delete set null,
  provider text not null default 'fcuno' check (provider = 'fcuno'),
  issuer text not null,
  subject text not null,
  transaction_id uuid null references public.fcos_external_identity_sync_transactions(id) on delete set null,
  action text not null,
  revision bigint null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fcos_external_identity_audit_subject_idx
  on public.fcos_external_identity_audit (provider, issuer, subject, created_at desc);

create or replace function public.fcos_reject_external_identity_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'FCOS external identity audit records are append-only.';
end;
$$;

drop trigger if exists fcos_external_identity_audit_append_only
  on public.fcos_external_identity_audit;
create trigger fcos_external_identity_audit_append_only
before update or delete on public.fcos_external_identity_audit
for each row execute function public.fcos_reject_external_identity_audit_mutation();

alter table public.fcos_external_identity_links enable row level security;
alter table public.fcos_external_identity_sync_transactions enable row level security;
alter table public.fcos_external_identity_audit enable row level security;

revoke all on table public.fcos_external_identity_links from public, anon, authenticated, service_role;
revoke all on table public.fcos_external_identity_sync_transactions from public, anon, authenticated, service_role;
revoke all on table public.fcos_external_identity_audit from public, anon, authenticated, service_role;

grant select, insert, update on table public.fcos_external_identity_links to service_role;
grant select, insert, update on table public.fcos_external_identity_sync_transactions to service_role;
grant select, insert on table public.fcos_external_identity_audit to service_role;

revoke all on function public.fcos_reject_external_identity_audit_mutation()
  from public, anon, authenticated;
grant execute on function public.fcos_reject_external_identity_audit_mutation()
  to service_role;
revoke all on function public.fcos_protect_external_identity_revision()
  from public, anon, authenticated;
grant execute on function public.fcos_protect_external_identity_revision()
  to service_role;

comment on table public.fcos_external_identity_links is
  'Service-only FCUNO identity projection. Browser roles have no table privileges.';
comment on table public.fcos_external_identity_sync_transactions is
  'Service-only idempotency and revision record for signed FCUNO identity synchronization.';
comment on table public.fcos_external_identity_audit is
  'Service-only immutable-style identity synchronization audit evidence.';
