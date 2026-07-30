create extension if not exists pgcrypto;

create table if not exists public.portal_applications (
  id text primary key
    check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null,
  description text not null default '',
  application_kind text not null
    check (application_kind in ('internal', 'external')),
  protocol text not null
    check (protocol in ('internal', 'signed_handoff')),
  launch_path text,
  target_base_url text,
  icon_key text not null default 'app',
  status text not null default 'active'
    check (status in ('active', 'maintenance', 'disabled')),
  status_message text not null default '',
  administrator_default_role text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_applications_internal_contract check (
    (application_kind = 'internal'
      and protocol = 'internal'
      and launch_path is not null
      and target_base_url is null)
    or
    (application_kind = 'external'
      and protocol = 'signed_handoff'
      and launch_path is null
      and target_base_url ~ '^https://')
  )
);

create table if not exists public.portal_application_roles (
  application_id text not null
    references public.portal_applications(id) on delete cascade,
  id text not null
    check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  description text not null default '',
  is_default boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (application_id, id)
);

create unique index if not exists portal_application_roles_one_default_idx
on public.portal_application_roles(application_id)
where is_default;

create table if not exists public.portal_user_app_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  application_id text not null
    references public.portal_applications(id) on delete cascade,
  explicit_active boolean not null default false,
  explicit_role_id text,
  effective_active boolean not null default false,
  effective_role_id text,
  effective_source text
    check (effective_source in ('explicit', 'administrator_default')),
  revision bigint not null default 1
    check (revision > 0),
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'synced', 'error', 'not_required')),
  target_user_id uuid,
  target_auth_user_id uuid,
  last_synced_at timestamptz,
  last_sync_error text,
  updated_by uuid
    references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, application_id),
  foreign key (application_id, explicit_role_id)
    references public.portal_application_roles(application_id, id)
    on update cascade on delete restrict,
  foreign key (application_id, effective_role_id)
    references public.portal_application_roles(application_id, id)
    on update cascade on delete restrict,
  constraint portal_entitlements_explicit_role check (
    (explicit_active and explicit_role_id is not null)
    or (not explicit_active and explicit_role_id is null)
  ),
  constraint portal_entitlements_effective_role check (
    (effective_active and effective_role_id is not null and effective_source is not null)
    or (not effective_active and effective_role_id is null and effective_source is null)
  )
);

create index if not exists portal_entitlements_user_idx
on public.portal_user_app_entitlements(user_id, effective_active);
create index if not exists portal_entitlements_sync_idx
on public.portal_user_app_entitlements(sync_status, updated_at)
where sync_status in ('pending', 'error');

create table if not exists public.portal_entitlement_outbox (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null
    references public.portal_user_app_entitlements(id) on delete cascade,
  application_id text not null
    references public.portal_applications(id) on delete cascade,
  user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  entitlement_revision bigint not null
    check (entitlement_revision > 0),
  operation text not null
    check (operation in ('sync_access', 'revoke_sessions')),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0
    check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_outbox_pending_idx
on public.portal_entitlement_outbox(next_attempt_at, created_at)
where status in ('pending', 'failed');
create index if not exists portal_outbox_processing_idx
on public.portal_entitlement_outbox(locked_at)
where status = 'processing';

create table if not exists public.portal_access_events (
  id uuid primary key default gen_random_uuid(),
  application_id text
    references public.portal_applications(id) on delete set null,
  target_user_id uuid
    references public.user_profiles(id) on delete set null,
  actor_user_id uuid
    references public.user_profiles(id) on delete set null,
  actor_email text,
  action text not null,
  outcome text not null
    check (outcome in ('requested', 'succeeded', 'failed')),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists portal_access_events_created_idx
on public.portal_access_events(created_at desc);
create index if not exists portal_access_events_user_idx
on public.portal_access_events(target_user_id, created_at desc);

create or replace function public.set_portal_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists portal_applications_set_updated_at
on public.portal_applications;
create trigger portal_applications_set_updated_at
before update on public.portal_applications
for each row execute function public.set_portal_updated_at();

drop trigger if exists portal_application_roles_set_updated_at
on public.portal_application_roles;
create trigger portal_application_roles_set_updated_at
before update on public.portal_application_roles
for each row execute function public.set_portal_updated_at();

drop trigger if exists portal_entitlements_set_updated_at
on public.portal_user_app_entitlements;
create trigger portal_entitlements_set_updated_at
before update on public.portal_user_app_entitlements
for each row execute function public.set_portal_updated_at();

drop trigger if exists portal_outbox_set_updated_at
on public.portal_entitlement_outbox;
create trigger portal_outbox_set_updated_at
before update on public.portal_entitlement_outbox
for each row execute function public.set_portal_updated_at();

create or replace function public.protect_last_active_administrator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  removing_active_administrator boolean;
  remaining_count bigint;
begin
  if tg_op = 'DELETE' then
    removing_active_administrator :=
      old.active and old.user_type = 'administrator';
  else
    removing_active_administrator :=
      old.active
      and old.user_type = 'administrator'
      and (not new.active or new.user_type <> 'administrator');
  end if;

  if not removing_active_administrator then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public:user_profiles:active-administrator', 0)
  );

  select count(*)
  into remaining_count
  from public.user_profiles profile
  where profile.id <> old.id
    and profile.active
    and profile.user_type = 'administrator';

  if remaining_count = 0 then
    raise exception 'At least one active FCOS Administrator is required'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_protect_last_administrator
on public.user_profiles;
create trigger user_profiles_protect_last_administrator
before update of active, user_type or delete
on public.user_profiles
for each row execute function public.protect_last_active_administrator();

insert into public.portal_applications (
  id,
  name,
  description,
  application_kind,
  protocol,
  launch_path,
  target_base_url,
  icon_key,
  status,
  administrator_default_role,
  sort_order
)
values
  (
    'fcos',
    'FCOS',
    'Trading, operations, finance, and management workflows.',
    'internal',
    'internal',
    '/',
    null,
    'fcos',
    'active',
    null,
    10
  ),
  (
    'emailrouter',
    'EmailRouter',
    'Human-controlled Microsoft 365 mailbox triage and routing.',
    'external',
    'signed_handoff',
    null,
    'https://emailrouter.vercel.app',
    'mail',
    'active',
    'owner',
    20
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  application_kind = excluded.application_kind,
  protocol = excluded.protocol,
  launch_path = excluded.launch_path,
  target_base_url = excluded.target_base_url,
  icon_key = excluded.icon_key,
  administrator_default_role = excluded.administrator_default_role,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.portal_application_roles (
  application_id,
  id,
  label,
  description,
  is_default,
  sort_order
)
values
  ('fcos', 'member', 'Member', 'Uses the FCOS modules assigned to the account.', true, 10),
  ('emailrouter', 'operator', 'Operator', 'Uses mailbox folders, routing tools, and the read-only advisor.', true, 10),
  ('emailrouter', 'owner', 'Owner', 'Manages EmailRouter settings and has all mailbox capabilities.', false, 20)
on conflict (application_id, id) do update set
  label = excluded.label,
  description = excluded.description,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.portal_user_app_entitlements (
  user_id,
  application_id,
  explicit_active,
  explicit_role_id,
  effective_active,
  effective_role_id,
  effective_source,
  sync_status
)
select
  profile.id,
  'emailrouter',
  false,
  null,
  true,
  'owner',
  'administrator_default',
  'pending'
from public.user_profiles profile
where profile.active
  and profile.user_type = 'administrator'
on conflict (user_id, application_id) do nothing;

insert into public.portal_entitlement_outbox (
  entitlement_id,
  application_id,
  user_id,
  entitlement_revision,
  operation,
  idempotency_key
)
select
  entitlement.id,
  entitlement.application_id,
  entitlement.user_id,
  entitlement.revision,
  'sync_access',
  concat(
    'portal:',
    entitlement.application_id,
    ':',
    entitlement.user_id,
    ':',
    entitlement.revision,
    ':sync_access'
  )
from public.portal_user_app_entitlements entitlement
where entitlement.sync_status = 'pending'
on conflict (idempotency_key) do nothing;

alter table public.portal_applications enable row level security;
alter table public.portal_application_roles enable row level security;
alter table public.portal_user_app_entitlements enable row level security;
alter table public.portal_entitlement_outbox enable row level security;
alter table public.portal_access_events enable row level security;

revoke all on table public.portal_applications
from public, anon, authenticated;
revoke all on table public.portal_application_roles
from public, anon, authenticated;
revoke all on table public.portal_user_app_entitlements
from public, anon, authenticated;
revoke all on table public.portal_entitlement_outbox
from public, anon, authenticated;
revoke all on table public.portal_access_events
from public, anon, authenticated;

grant all on table public.portal_applications to service_role;
grant all on table public.portal_application_roles to service_role;
grant all on table public.portal_user_app_entitlements to service_role;
grant all on table public.portal_entitlement_outbox to service_role;
grant all on table public.portal_access_events to service_role;

revoke all on function public.set_portal_updated_at()
from public, anon, authenticated;
revoke all on function public.protect_last_active_administrator()
from public, anon, authenticated;
grant execute on function public.set_portal_updated_at() to service_role;
grant execute on function public.protect_last_active_administrator() to service_role;
