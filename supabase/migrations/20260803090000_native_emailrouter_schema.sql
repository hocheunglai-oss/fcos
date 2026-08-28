begin;

-- Native FCOS EmailRouter is metadata-only. Microsoft 365 remains the
-- authority for message content, addressing, and files.
create extension if not exists pgcrypto;
create schema if not exists emailrouter;

-- The native API uses PostgREST with service_role against this private schema.
-- Exposure makes the schema routable; the grants and RLS below still deny both
-- browser roles completely.
alter role authenticator set pgrst.db_schemas = 'public, storage, graphql_public, emailrouter';
notify pgrst, 'reload config';

revoke all on schema emailrouter from public, anon, authenticated;
grant usage on schema emailrouter to service_role;

do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Native EmailRouter requires public.user_profiles';
  end if;
  if to_regclass('public.email_sender_mailboxes') is null
     or to_regclass('public.email_sender_purposes') is null
     or to_regclass('public.email_sender_routes') is null then
    raise exception 'Native EmailRouter requires the FCOS Graph mailbox registry';
  end if;
end;
$$;

insert into public.email_sender_purposes (
  purpose_key,
  label,
  description,
  module_id,
  enabled,
  sort_order
)
values (
  'email_router_mailbox',
  'Email Router shared mailbox',
  'The Microsoft 365 mailbox read and operated by the native Email Router tool.',
  null,
  true,
  80
)
on conflict (purpose_key) do update set
  label = excluded.label,
  description = excluded.description,
  module_id = excluded.module_id,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Mailbox assignment is intentionally blank until the standalone router's
-- mailbox is registered and selected in FCOS. Inheriting another workflow's
-- sender would give the native tool access to the wrong mailbox.
insert into public.email_sender_routes (purpose_key)
values ('email_router_mailbox')
on conflict (purpose_key) do nothing;

create table if not exists emailrouter.mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  sender_mailbox_id uuid not null references public.email_sender_mailboxes(id) on delete restrict,
  provider text not null default 'microsoft_graph' check (provider in ('microsoft_graph')),
  provider_mailbox_id text,
  state text not null default 'active'
    check (state in ('active', 'reauthorization_required', 'disabled', 'failed')),
  connected_by uuid references public.user_profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  disabled_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sender_mailbox_id),
  unique (provider, provider_mailbox_id),
  check (
    (state = 'disabled') = (disabled_at is not null)
  ),
  check (provider_mailbox_id is null or char_length(btrim(provider_mailbox_id)) between 1 and 512)
);

create table if not exists emailrouter.messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references emailrouter.mailbox_connections(id) on delete restrict,
  provider_message_id text not null,
  provider_thread_id text,
  folder_key text not null,
  message_kind text not null default 'message'
    check (message_kind in ('message', 'meeting', 'protected', 'unknown')),
  received_at timestamptz,
  sent_at timestamptz,
  handled_at timestamptz,
  provider_modified_at timestamptz,
  has_attachments boolean not null default false,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  is_read boolean not null default false,
  importance text check (importance is null or importance in ('low', 'normal', 'high')),
  state text not null default 'received'
    check (state in ('received', 'processing', 'routed', 'archived', 'failed')),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_.-]{1,120}$'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, provider_message_id),
  check (not has_attachments or attachment_count > 0),
  check (handled_at is null or received_at is null or handled_at >= received_at)
);

create table if not exists emailrouter.message_attachment_metadata (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references emailrouter.messages(id) on delete cascade,
  provider_attachment_id text not null,
  content_type text,
  byte_size bigint not null check (byte_size >= 0),
  attachment_kind text not null default 'file'
    check (attachment_kind in ('file', 'item', 'reference', 'unknown')),
  is_inline boolean not null default false,
  created_at timestamptz not null default now(),
  unique (message_id, provider_attachment_id)
);

create table if not exists emailrouter.destinations (
  id uuid primary key default gen_random_uuid(),
  destination_kind text not null check (destination_kind in ('fcos_profile', 'provider_directory')),
  user_profile_id uuid references public.user_profiles(id) on delete restrict,
  provider_directory_id text,
  display_name text,
  email_address text,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (destination_kind = 'fcos_profile' and user_profile_id is not null and provider_directory_id is null and email_address is null)
    or
    (destination_kind = 'provider_directory' and user_profile_id is null and provider_directory_id is not null and email_address is not null)
  ),
  check (provider_directory_id is null or char_length(btrim(provider_directory_id)) between 1 and 512),
  check (display_name is null or char_length(btrim(display_name)) between 1 and 255),
  check (email_address is null or (
    email_address = lower(btrim(email_address))
    and email_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ))
);
create unique index if not exists emailrouter_destinations_profile_key
  on emailrouter.destinations (user_profile_id)
  where user_profile_id is not null;
create unique index if not exists emailrouter_destinations_directory_key
  on emailrouter.destinations (provider_directory_id)
  where provider_directory_id is not null;
create unique index if not exists emailrouter_destinations_external_email_key
  on emailrouter.destinations (email_address)
  where email_address is not null;

create table if not exists emailrouter.destination_groups (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  display_name text not null,
  provider_group_id text,
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_key),
  unique (provider_group_id),
  check (group_key ~ '^[a-z0-9][a-z0-9_.-]{0,119}$'),
  check (char_length(btrim(display_name)) between 1 and 255),
  check (provider_group_id is null or char_length(btrim(provider_group_id)) between 1 and 512)
);

create table if not exists emailrouter.destination_group_members (
  group_id uuid not null references emailrouter.destination_groups(id) on delete cascade,
  destination_id uuid not null references emailrouter.destinations(id) on delete restrict,
  added_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, destination_id)
);

create table if not exists emailrouter.routing_presets (
  id uuid primary key default gen_random_uuid(),
  preset_key text not null,
  display_name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preset_key),
  check (preset_key ~ '^[a-z0-9][a-z0-9_.-]{0,119}$'),
  check (char_length(btrim(display_name)) between 1 and 255),
  check (char_length(description) <= 1000)
);

create table if not exists emailrouter.routing_preset_destinations (
  preset_id uuid not null references emailrouter.routing_presets(id) on delete cascade,
  destination_id uuid references emailrouter.destinations(id) on delete restrict,
  group_id uuid references emailrouter.destination_groups(id) on delete restrict,
  recipient_kind text not null default 'to' check (recipient_kind in ('to', 'cc', 'bcc')),
  position smallint not null check (position > 0),
  created_at timestamptz not null default now(),
  primary key (preset_id, recipient_kind, position),
  check ((destination_id is null) <> (group_id is null))
);
create unique index if not exists emailrouter_preset_destinations_destination_key
  on emailrouter.routing_preset_destinations (preset_id, recipient_kind, destination_id)
  where destination_id is not null;
create unique index if not exists emailrouter_preset_destinations_group_key
  on emailrouter.routing_preset_destinations (preset_id, recipient_kind, group_id)
  where group_id is not null;

create table if not exists emailrouter.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (key in ('directory.allowed_domains', 'advisor.enabled', 'advisor.model')),
  check (jsonb_typeof(value) = 'object')
);

insert into emailrouter.settings (key, value)
values
  ('advisor.enabled', '{"enabled": true}'::jsonb),
  ('advisor.model', '{"modelId": "gpt-5-mini-2025-08-07"}'::jsonb)
on conflict (key) do nothing;

create table if not exists emailrouter.migration_runs (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  metadata_sync_fingerprint text check (metadata_sync_fingerprint is null or metadata_sync_fingerprint ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now(),
  unique (contract_version, source_fingerprint)
);

create table if not exists emailrouter.mail_actions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references emailrouter.messages(id) on delete restrict,
  preset_id uuid references emailrouter.routing_presets(id) on delete set null,
  action_type text not null check (action_type in ('redirect', 'reply', 'forward', 'archive', 'move', 'delete', 'undo', 'mark_read')),
  state text not null default 'reserved'
    check (state in ('reserved', 'draft_created', 'submitted', 'confirmed', 'failed', 'uncertain')),
  requested_by uuid references public.user_profiles(id) on delete set null,
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_operation_id text,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_.-]{1,120}$'),
  reserved_at timestamptz not null default now(),
  draft_created_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  uncertain_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key),
  check (char_length(btrim(idempotency_key)) between 16 and 200),
  check (state <> 'draft_created' or draft_created_at is not null),
  check (state <> 'submitted' or submitted_at is not null),
  check (state <> 'confirmed' or confirmed_at is not null),
  check (state <> 'failed' or failed_at is not null),
  check (state <> 'uncertain' or uncertain_at is not null)
);
create index if not exists emailrouter_mail_actions_message_created_idx
  on emailrouter.mail_actions (message_id, created_at desc);
create index if not exists emailrouter_mail_actions_state_created_idx
  on emailrouter.mail_actions (state, created_at)
  where state in ('reserved', 'draft_created', 'submitted', 'uncertain');

create table if not exists emailrouter.mail_action_destinations (
  mail_action_id uuid not null references emailrouter.mail_actions(id) on delete cascade,
  destination_id uuid references emailrouter.destinations(id) on delete restrict,
  group_id uuid references emailrouter.destination_groups(id) on delete restrict,
  recipient_kind text not null default 'to' check (recipient_kind in ('to', 'cc', 'bcc')),
  position smallint not null check (position > 0),
  created_at timestamptz not null default now(),
  primary key (mail_action_id, recipient_kind, position),
  check ((destination_id is null) <> (group_id is null))
);

create table if not exists emailrouter.mail_action_outbox (
  id uuid primary key default gen_random_uuid(),
  mail_action_id uuid not null unique references emailrouter.mail_actions(id) on delete cascade,
  state text not null default 'reserved'
    check (state in ('reserved', 'draft_created', 'submitted', 'confirmed', 'failed', 'uncertain')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  reconcile_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  provider_operation_id text,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_.-]{1,120}$'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state in ('confirmed', 'failed') and completed_at is not null)
    or (state not in ('confirmed', 'failed') and completed_at is null)
  )
);
create index if not exists emailrouter_mail_action_outbox_claim_idx
  on emailrouter.mail_action_outbox (next_attempt_at, created_at)
  where state in ('reserved', 'draft_created');
create index if not exists emailrouter_mail_action_outbox_reconcile_idx
  on emailrouter.mail_action_outbox (reconcile_after, created_at)
  where state in ('submitted', 'uncertain');

create table if not exists emailrouter.mailbox_subscriptions (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references emailrouter.mailbox_connections(id) on delete cascade,
  resource_key text not null,
  provider_subscription_id text not null,
  state text not null default 'active'
    check (state in ('active', 'reauthorization_required', 'removed', 'failed')),
  expires_at timestamptz,
  lifecycle_event text check (
    lifecycle_event is null
    or lifecycle_event in ('missed', 'subscription_removed', 'reauthorization_required')
  ),
  lifecycle_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, resource_key),
  unique (provider_subscription_id),
  check (char_length(btrim(resource_key)) between 1 and 512)
);
create index if not exists emailrouter_mailbox_subscriptions_renewal_idx
  on emailrouter.mailbox_subscriptions (expires_at)
  where state = 'active' and expires_at is not null;

create table if not exists emailrouter.mailbox_delta_state (
  mailbox_id uuid not null references emailrouter.mailbox_connections(id) on delete cascade,
  folder_key text not null,
  cursor_reference text not null,
  sync_state text not null default 'ready'
    check (sync_state in ('ready', 'syncing', 'resync_required', 'failed')),
  last_synced_at timestamptz,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_.-]{1,120}$'),
  updated_at timestamptz not null default now(),
  primary key (mailbox_id, folder_key),
  check (char_length(btrim(cursor_reference)) between 1 and 512)
);

create table if not exists emailrouter.alerts (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references emailrouter.mailbox_connections(id) on delete cascade,
  message_id uuid references emailrouter.messages(id) on delete cascade,
  mail_action_id uuid references emailrouter.mail_actions(id) on delete cascade,
  alert_code text not null check (alert_code ~ '^[a-z0-9_.-]{1,120}$'),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  state text not null default 'open' check (state in ('open', 'acknowledged', 'resolved')),
  dedupe_key text not null,
  acknowledged_by uuid references public.user_profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references public.user_profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dedupe_key),
  check (char_length(btrim(dedupe_key)) between 16 and 200),
  check ((acknowledged_by is null) = (acknowledged_at is null)),
  check ((resolved_by is null) = (resolved_at is null))
);
create index if not exists emailrouter_alerts_open_idx
  on emailrouter.alerts (severity, created_at desc)
  where state in ('open', 'acknowledged');

create table if not exists emailrouter.alert_notification_states (
  alert_id uuid not null references emailrouter.alerts(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  read_at timestamptz,
  handled_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create table if not exists emailrouter.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references emailrouter.messages(id) on delete set null,
  mail_action_id uuid references emailrouter.mail_actions(id) on delete set null,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  model_id text not null,
  provider_request_id text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  cost_usd numeric(18, 12) not null default 0 check (cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  outcome text not null check (outcome in ('success', 'error')),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_.-]{1,120}$'),
  created_at timestamptz not null default now(),
  check (cached_input_tokens <= input_tokens),
  check (reasoning_tokens <= output_tokens)
);
create index if not exists emailrouter_ai_usage_model_created_idx
  on emailrouter.ai_usage_events (model_id, created_at desc);

create table if not exists emailrouter.performance_events (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references emailrouter.mailbox_connections(id) on delete set null,
  message_id uuid references emailrouter.messages(id) on delete set null,
  mail_action_id uuid references emailrouter.mail_actions(id) on delete set null,
  metric text not null check (
    metric in ('mailbox_sync', 'message_index', 'action_draft', 'action_submit', 'action_confirm', 'ai_recommendation')
  ),
  duration_ms integer not null check (duration_ms >= 0 and duration_ms <= 300000),
  outcome text not null check (outcome in ('success', 'error')),
  region text not null default 'unknown' check (region ~ '^[a-z0-9-]{2,32}$'),
  created_at timestamptz not null default now()
);
create index if not exists emailrouter_performance_metric_created_idx
  on emailrouter.performance_events (metric, created_at desc);

create table if not exists emailrouter.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z0-9_.-]{1,120}$'),
  entity_type text not null check (entity_type in ('mailbox', 'message', 'destination', 'group', 'preset', 'setting', 'mail_action', 'subscription', 'alert', 'ai_usage')),
  entity_id uuid not null,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  correlation_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (idempotency_key),
  check (char_length(btrim(idempotency_key)) between 16 and 200)
);
create index if not exists emailrouter_events_entity_created_idx
  on emailrouter.events (entity_type, entity_id, created_at desc);

create or replace function emailrouter.prevent_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'emailrouter.events is append-only' using errcode = '55000';
end;
$$;

drop trigger if exists emailrouter_events_append_only on emailrouter.events;
create trigger emailrouter_events_append_only
before update or delete on emailrouter.events
for each row execute function emailrouter.prevent_event_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'mailbox_connections',
    'messages',
    'message_attachment_metadata',
    'destinations',
    'destination_groups',
    'destination_group_members',
    'routing_presets',
    'routing_preset_destinations',
    'settings',
    'migration_runs',
    'mail_actions',
    'mail_action_destinations',
    'mail_action_outbox',
    'mailbox_subscriptions',
    'mailbox_delta_state',
    'alerts',
    'alert_notification_states',
    'ai_usage_events',
    'performance_events',
    'events'
  ] loop
    execute format('alter table emailrouter.%I enable row level security', table_name);
    execute format('revoke all on table emailrouter.%I from public, anon, authenticated', table_name);
    execute format('grant all on table emailrouter.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on function emailrouter.prevent_event_mutation()
from public, anon, authenticated;
grant execute on function emailrouter.prevent_event_mutation() to service_role;

create or replace function public.apply_emailrouter_operational_config(p_payload jsonb, p_fingerprint text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  contact jsonb;
  preset jsonb;
  member jsonb;
  group_row_json jsonb;
  setting_row jsonb;
  destination_row emailrouter.destinations%rowtype;
  group_row emailrouter.destination_groups%rowtype;
  preset_row emailrouter.routing_presets%rowtype;
  contact_count integer := 0;
  fcos_profile_count integer := 0;
  provider_directory_count integer := 0;
  group_count integer := 0;
  group_member_count integer := 0;
  preset_count integer := 0;
  member_count integer := 0;
  existing_counts jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'contractVersion' <> 'emailrouter-fcos-operational-migration/v1' then
    raise exception 'Invalid Email Router migration contract';
  end if;
  if p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid Email Router migration fingerprint';
  end if;
  select counts into existing_counts
  from emailrouter.migration_runs
  where contract_version = p_payload->>'contractVersion'
    and source_fingerprint = p_fingerprint;
  if existing_counts is not null then
    return existing_counts || jsonb_build_object('alreadyApplied', true);
  end if;
  if jsonb_typeof(coalesce(p_payload->'providerDirectoryDestinations', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'fcosProfileDestinations', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'destinationGroups', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'destinationGroupMembers', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'routingPresets', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'routingPresetMembers', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'settings', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid Email Router migration payload';
  end if;

  if not exists (
    select 1
    from public.email_sender_routes route
    join public.email_sender_mailboxes mailbox on mailbox.id = route.mailbox_id
    where route.purpose_key = p_payload#>>'{mailboxConnection,purpose_key}'
      and route.mailbox_id = (p_payload#>>'{mailboxConnection,mailbox_id}')::uuid
      and mailbox.active = true
  ) then
    raise exception 'Email Router migration mailbox assignment is unavailable';
  end if;
  insert into emailrouter.mailbox_connections (sender_mailbox_id, provider_mailbox_id)
  values (
    (p_payload#>>'{mailboxConnection,mailbox_id}')::uuid,
    (select email_address from public.email_sender_mailboxes where id = (p_payload#>>'{mailboxConnection,mailbox_id}')::uuid)
  )
  on conflict (sender_mailbox_id) do update set
    state = 'active',
    disabled_at = null,
    revision = emailrouter.mailbox_connections.revision + 1,
    updated_at = now();

  for contact in select value from jsonb_array_elements(coalesce(p_payload->'fcosProfileDestinations', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.user_profiles
      where id = (contact->>'user_profile_id')::uuid and active = true
    ) then
      raise exception 'Email Router migration contains an inactive or unknown FCOS user';
    end if;
    insert into emailrouter.destinations (
      destination_kind, user_profile_id, display_name, active, sort_order
    ) values (
      'fcos_profile',
      (contact->>'user_profile_id')::uuid,
      nullif(btrim(contact->>'display_name'), ''),
      true,
      0
    )
    on conflict (user_profile_id) where user_profile_id is not null do update set
      display_name = excluded.display_name,
      active = true,
      revision = emailrouter.destinations.revision + 1,
      updated_at = now();
    contact_count := contact_count + 1;
    fcos_profile_count := fcos_profile_count + 1;
  end loop;

  for contact in select value from jsonb_array_elements(coalesce(p_payload->'providerDirectoryDestinations', '[]'::jsonb)) loop
    insert into emailrouter.destinations (
      destination_kind, provider_directory_id, display_name, email_address, active, sort_order
    ) values (
      'provider_directory',
      contact->>'source_key',
      contact->>'display_name',
      lower(btrim(contact->>'email_address')),
      true,
      greatest(coalesce((contact->>'sort_order')::integer, 0), 0)
    )
    on conflict (provider_directory_id) where provider_directory_id is not null do update set
      display_name = excluded.display_name,
      email_address = excluded.email_address,
      active = true,
      sort_order = excluded.sort_order,
      revision = emailrouter.destinations.revision + 1,
      updated_at = now();
    contact_count := contact_count + 1;
    provider_directory_count := provider_directory_count + 1;
  end loop;

  for group_row_json in select value from jsonb_array_elements(coalesce(p_payload->'destinationGroups', '[]'::jsonb)) loop
    insert into emailrouter.destination_groups (
      group_key, display_name, provider_group_id, active
    ) values (
      group_row_json->>'groupKey',
      group_row_json->>'displayName',
      group_row_json->>'sourceKey',
      coalesce((group_row_json->>'active')::boolean, true)
    )
    on conflict (provider_group_id) do update set
      group_key = excluded.group_key,
      display_name = excluded.display_name,
      active = excluded.active,
      revision = emailrouter.destination_groups.revision + 1,
      updated_at = now()
    returning * into group_row;
    delete from emailrouter.destination_group_members where group_id = group_row.id;
    group_count := group_count + 1;
  end loop;

  for member in select value from jsonb_array_elements(coalesce(p_payload->'destinationGroupMembers', '[]'::jsonb)) loop
    select * into group_row
    from emailrouter.destination_groups
    where provider_group_id = member->>'groupSourceKey';
    select * into destination_row
    from emailrouter.destinations
    where provider_directory_id = member->>'destinationSourceKey'
       or user_profile_id = (
         select (destination_value->>'user_profile_id')::uuid
         from jsonb_array_elements(coalesce(p_payload->'fcosProfileDestinations', '[]'::jsonb)) destination_value
         where destination_value->>'source_key' = member->>'destinationSourceKey'
         limit 1
       );
    if group_row.id is null or destination_row.id is null then
      raise exception 'Email Router migration contains an unknown group member';
    end if;
    insert into emailrouter.destination_group_members (group_id, destination_id)
    values (group_row.id, destination_row.id)
    on conflict do nothing;
    group_member_count := group_member_count + 1;
  end loop;

  for preset in select value from jsonb_array_elements(coalesce(p_payload->'routingPresets', '[]'::jsonb)) loop
    insert into emailrouter.routing_presets (
      preset_key, display_name, description, active, sort_order
    ) values (
      preset->>'sourceKey',
      preset->>'name',
      coalesce(preset->>'description', ''),
      coalesce((preset->>'active')::boolean, true),
      greatest(coalesce((preset->>'sortOrder')::integer, 0), 0)
    )
    on conflict (preset_key) do update set
      display_name = excluded.display_name,
      description = excluded.description,
      active = excluded.active,
      sort_order = excluded.sort_order,
      revision = emailrouter.routing_presets.revision + 1,
      updated_at = now()
    returning * into preset_row;
    delete from emailrouter.routing_preset_destinations where preset_id = preset_row.id;
    preset_count := preset_count + 1;
  end loop;

  for member in select value from jsonb_array_elements(coalesce(p_payload->'routingPresetMembers', '[]'::jsonb)) loop
    select * into preset_row
    from emailrouter.routing_presets
    where preset_key = member->>'routingPresetSourceKey';
    select * into destination_row
    from emailrouter.destinations
    where provider_directory_id = member->>'destinationSourceKey'
       or user_profile_id = (
         select (destination_value->>'user_profile_id')::uuid
         from jsonb_array_elements(coalesce(p_payload->'fcosProfileDestinations', '[]'::jsonb)) destination_value
         where destination_value->>'source_key' = member->>'destinationSourceKey'
         limit 1
       );
    if preset_row.id is null or destination_row.id is null then
      raise exception 'Email Router migration contains an unknown preset member';
    end if;
    insert into emailrouter.routing_preset_destinations (
      preset_id, destination_id, recipient_kind, position
    ) values (
      preset_row.id,
      destination_row.id,
      member->>'recipientKind',
      greatest(coalesce((member->>'position')::integer, 1), 1)
    );
    member_count := member_count + 1;
  end loop;

  for setting_row in select value from jsonb_array_elements(coalesce(p_payload->'settings', '[]'::jsonb)) loop
    if setting_row->>'key' <> 'directory.allowed_domains' then
      raise exception 'Unsupported Email Router setting';
    end if;
    insert into emailrouter.settings (key, value)
    values (setting_row->>'key', setting_row->'value')
    on conflict (key) do update set
      value = excluded.value,
      revision = emailrouter.settings.revision + 1,
      updated_at = now();
  end loop;

  insert into emailrouter.migration_runs (contract_version, source_fingerprint, counts)
  values (
    p_payload->>'contractVersion',
    p_fingerprint,
    jsonb_build_object(
      'providerDirectoryDestinations', provider_directory_count,
      'fcosProfileDestinations', fcos_profile_count,
      'destinationGroups', group_count,
      'destinationGroupMembers', group_member_count,
      'routingPresets', preset_count,
      'routingPresetMembers', member_count,
      'settings', jsonb_array_length(coalesce(p_payload->'settings', '[]'::jsonb))
    )
  )
  on conflict (contract_version, source_fingerprint) do update set
    counts = excluded.counts,
    applied_at = now();

  return jsonb_build_object(
    'contacts', contact_count,
    'destinationGroups', group_count,
    'destinationGroupMembers', group_member_count,
    'routingPresets', preset_count,
    'routingPresetMembers', member_count
  );
end;
$$;

revoke all on function public.apply_emailrouter_operational_config(jsonb, text)
from public, anon, authenticated;
grant execute on function public.apply_emailrouter_operational_config(jsonb, text)
to service_role;

create or replace function public.reconcile_emailrouter_operational_config(p_expected jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  latest emailrouter.migration_runs%rowtype;
begin
  if p_expected->>'contractVersion' <> 'emailrouter-fcos-operational-reconciliation/v1' then
    raise exception 'Invalid Email Router reconciliation contract';
  end if;
  select * into latest
  from emailrouter.migration_runs
  order by applied_at desc
  limit 1;
  if latest.id is null then
    raise exception 'Email Router migration has not been applied';
  end if;
  return jsonb_build_object(
    'counts', latest.counts,
    'fingerprint', latest.source_fingerprint,
    'metadataSync', jsonb_build_object('fingerprint', latest.metadata_sync_fingerprint)
  );
end;
$$;

revoke all on function public.reconcile_emailrouter_operational_config(jsonb)
from public, anon, authenticated;
grant execute on function public.reconcile_emailrouter_operational_config(jsonb)
to service_role;

create or replace function public.sync_emailrouter_fcos_destinations(p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  inserted_count integer := 0;
  updated_count integer := 0;
begin
  if not exists (
    select 1 from public.user_profiles
    where id = p_actor and active = true
  ) then
    raise exception 'Active FCOS user required';
  end if;

  insert into emailrouter.destinations (
    destination_kind, user_profile_id, active, created_by
  )
  select 'fcos_profile', profile.id, true, p_actor
  from public.user_profiles profile
  where profile.active = true
  on conflict (user_profile_id) where user_profile_id is not null do update set
    active = true,
    revision = emailrouter.destinations.revision + 1,
    updated_at = now()
  where emailrouter.destinations.active = false;
  get diagnostics inserted_count = row_count;

  update emailrouter.destinations destination
  set active = false,
      revision = destination.revision + 1,
      updated_at = now()
  where destination.destination_kind = 'fcos_profile'
    and destination.active = true
    and not exists (
      select 1 from public.user_profiles profile
      where profile.id = destination.user_profile_id and profile.active = true
    );
  get diagnostics updated_count = row_count;

  return jsonb_build_object('activeProfilesSynchronized', inserted_count, 'inactiveProfilesDisabled', updated_count);
end;
$$;

revoke all on function public.sync_emailrouter_fcos_destinations(uuid)
from public, anon, authenticated;
grant execute on function public.sync_emailrouter_fcos_destinations(uuid)
to service_role;

create or replace function public.save_emailrouter_configuration(p_operation jsonb, p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  operation_type text := p_operation->>'type';
  entity_id uuid;
  expected_revision bigint;
  destination_row emailrouter.destinations%rowtype;
  group_row emailrouter.destination_groups%rowtype;
  preset_row emailrouter.routing_presets%rowtype;
  setting_row emailrouter.settings%rowtype;
  selection jsonb;
  selection_count integer;
  entity_type_value text;
begin
  if not exists (
    select 1 from public.user_profiles
    where id = p_actor
      and active = true
      and user_type in ('administrator', 'general_manager')
  ) then
    raise exception 'Email Router configuration authority required';
  end if;
  if jsonb_typeof(p_operation) <> 'object' then
    raise exception 'Invalid Email Router configuration operation';
  end if;
  entity_id := nullif(p_operation->>'id', '')::uuid;
  expected_revision := nullif(p_operation->>'expectedRevision', '')::bigint;

  if operation_type = 'destination_save' then
    if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
       or lower(btrim(coalesce(p_operation->>'emailAddress', ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'A valid destination name and email address are required';
    end if;
    if entity_id is null then
      insert into emailrouter.destinations (
        destination_kind, provider_directory_id, display_name, email_address,
        active, sort_order, created_by
      ) values (
        'provider_directory', 'manual:' || gen_random_uuid()::text,
        btrim(p_operation->>'displayName'), lower(btrim(p_operation->>'emailAddress')),
        coalesce((p_operation->>'active')::boolean, true),
        greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0), p_actor
      ) returning * into destination_row;
    else
      update emailrouter.destinations destination set
        display_name = btrim(p_operation->>'displayName'),
        email_address = lower(btrim(p_operation->>'emailAddress')),
        active = coalesce((p_operation->>'active')::boolean, true),
        sort_order = greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0),
        revision = destination.revision + 1,
        updated_at = now()
      where destination.id = entity_id
        and destination.destination_kind = 'provider_directory'
        and destination.revision = expected_revision
      returning * into destination_row;
      if destination_row.id is null then raise exception 'Email Router destination revision conflict'; end if;
    end if;
    entity_id := destination_row.id;
    entity_type_value := 'destination';

  elsif operation_type = 'group_save' then
    if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
       or btrim(coalesce(p_operation->>'groupKey', '')) !~ '^[a-z0-9][a-z0-9_.-]{0,119}$'
       or jsonb_typeof(coalesce(p_operation->'destinationIds', '[]'::jsonb)) <> 'array' then
      raise exception 'A valid group name, key, and destination list are required';
    end if;
    select count(*) into selection_count
    from emailrouter.destinations
    where id in (
      select value::text::uuid from jsonb_array_elements_text(coalesce(p_operation->'destinationIds', '[]'::jsonb))
    ) and active = true;
    if selection_count <> jsonb_array_length(coalesce(p_operation->'destinationIds', '[]'::jsonb)) then
      raise exception 'Email Router group contains an unavailable destination';
    end if;
    if entity_id is null then
      insert into emailrouter.destination_groups (group_key, display_name, active, created_by)
      values (p_operation->>'groupKey', btrim(p_operation->>'displayName'), coalesce((p_operation->>'active')::boolean, true), p_actor)
      returning * into group_row;
    else
      update emailrouter.destination_groups destination_group set
        group_key = p_operation->>'groupKey',
        display_name = btrim(p_operation->>'displayName'),
        active = coalesce((p_operation->>'active')::boolean, true),
        revision = destination_group.revision + 1,
        updated_at = now()
      where destination_group.id = entity_id and destination_group.revision = expected_revision
      returning * into group_row;
      if group_row.id is null then raise exception 'Email Router group revision conflict'; end if;
    end if;
    delete from emailrouter.destination_group_members where group_id = group_row.id;
    insert into emailrouter.destination_group_members (group_id, destination_id, added_by)
    select group_row.id, value::text::uuid, p_actor
    from jsonb_array_elements_text(coalesce(p_operation->'destinationIds', '[]'::jsonb));
    entity_id := group_row.id;
    entity_type_value := 'group';

  elsif operation_type = 'preset_save' then
    if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
       or btrim(coalesce(p_operation->>'presetKey', '')) !~ '^[a-z0-9][a-z0-9_.-]{0,119}$'
       or char_length(coalesce(p_operation->>'description', '')) > 1000
       or jsonb_typeof(coalesce(p_operation->'destinations', '[]'::jsonb)) <> 'array' then
      raise exception 'A valid preset name, key, and destination list are required';
    end if;
    if entity_id is null then
      insert into emailrouter.routing_presets (
        preset_key, display_name, description, active, sort_order, created_by, updated_by
      ) values (
        p_operation->>'presetKey', btrim(p_operation->>'displayName'), coalesce(p_operation->>'description', ''),
        coalesce((p_operation->>'active')::boolean, true), greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0), p_actor, p_actor
      ) returning * into preset_row;
    else
      update emailrouter.routing_presets preset set
        preset_key = p_operation->>'presetKey',
        display_name = btrim(p_operation->>'displayName'),
        description = coalesce(p_operation->>'description', ''),
        active = coalesce((p_operation->>'active')::boolean, true),
        sort_order = greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0),
        revision = preset.revision + 1,
        updated_by = p_actor,
        updated_at = now()
      where preset.id = entity_id and preset.revision = expected_revision
      returning * into preset_row;
      if preset_row.id is null then raise exception 'Email Router preset revision conflict'; end if;
    end if;
    delete from emailrouter.routing_preset_destinations where preset_id = preset_row.id;
    for selection in select value from jsonb_array_elements(coalesce(p_operation->'destinations', '[]'::jsonb)) loop
      if selection->>'recipientKind' not in ('to', 'cc', 'bcc')
         or greatest(coalesce((selection->>'position')::integer, 0), 0) < 1
         or ((nullif(selection->>'destinationId', '') is null) = (nullif(selection->>'groupId', '') is null)) then
        raise exception 'Email Router preset contains an invalid destination';
      end if;
      if selection ? 'destinationId' and not exists (
        select 1 from emailrouter.destinations where id = (selection->>'destinationId')::uuid and active = true
      ) then raise exception 'Email Router preset contains an unavailable destination'; end if;
      if selection ? 'groupId' and not exists (
        select 1 from emailrouter.destination_groups where id = (selection->>'groupId')::uuid and active = true
      ) then raise exception 'Email Router preset contains an unavailable group'; end if;
      insert into emailrouter.routing_preset_destinations (
        preset_id, destination_id, group_id, recipient_kind, position
      ) values (
        preset_row.id,
        nullif(selection->>'destinationId', '')::uuid,
        nullif(selection->>'groupId', '')::uuid,
        selection->>'recipientKind',
        (selection->>'position')::smallint
      );
    end loop;
    entity_id := preset_row.id;
    entity_type_value := 'preset';

  elsif operation_type = 'setting_save' then
    if p_operation->>'key' not in ('directory.allowed_domains', 'advisor.enabled', 'advisor.model')
       or jsonb_typeof(p_operation->'value') <> 'object' then
      raise exception 'Unsupported Email Router setting';
    end if;
    update emailrouter.settings setting set
      value = p_operation->'value',
      revision = setting.revision + 1,
      updated_by = p_actor,
      updated_at = now()
    where setting.key = p_operation->>'key' and setting.revision = expected_revision
    returning * into setting_row;
    if setting_row.key is null then raise exception 'Email Router setting revision conflict'; end if;
    entity_id := md5(setting_row.key)::uuid;
    entity_type_value := 'setting';
  else
    raise exception 'Unsupported Email Router configuration operation';
  end if;

  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    'configuration.' || operation_type,
    entity_type_value,
    entity_id,
    p_actor,
    gen_random_uuid()::text
  );

  return jsonb_build_object(
    'id', entity_id,
    'type', operation_type,
    'revision', coalesce(destination_row.revision, group_row.revision, preset_row.revision, setting_row.revision)
  );
end;
$$;

revoke all on function public.save_emailrouter_configuration(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_configuration(jsonb, uuid)
to service_role;

-- Retire the former signed-handoff application without removing portal access
-- history. Existing grants are retained as inactive records and queued work is
-- terminally deactivated so it cannot be delivered after native cutover.
do $$
begin
  if to_regclass('public.portal_applications') is not null then
    alter table public.portal_applications
      drop constraint if exists portal_applications_application_kind_check,
      drop constraint if exists portal_applications_protocol_check,
      drop constraint if exists portal_applications_status_check,
      drop constraint if exists portal_applications_internal_contract;

    alter table public.portal_applications
      add constraint portal_applications_application_kind_check
        check (application_kind in ('internal', 'external', 'native')),
      add constraint portal_applications_protocol_check
        check (protocol in ('internal', 'signed_handoff', 'native')),
      add constraint portal_applications_status_check
        check (status in ('active', 'maintenance', 'disabled', 'retired')),
      add constraint portal_applications_internal_contract check (
        (application_kind = 'internal'
          and protocol = 'internal'
          and launch_path is not null
          and target_base_url is null)
        or (application_kind = 'external'
          and protocol = 'signed_handoff'
          and launch_path is null
          and target_base_url ~ '^https://')
        or (application_kind = 'native'
          and protocol = 'native'
          and launch_path is null
          and target_base_url is null)
      );

    update public.portal_applications
    set
      description = 'Native FCOS EmailRouter schema retired the standalone portal application.',
      application_kind = 'native',
      protocol = 'native',
      launch_path = null,
      target_base_url = null,
      status = 'retired',
      status_message = 'Retired after native FCOS EmailRouter cutover.',
      updated_at = now()
    where id = 'emailrouter';
  end if;

  if to_regclass('public.portal_user_app_entitlements') is not null then
    update public.portal_user_app_entitlements
    set
      explicit_active = false,
      explicit_role_id = null,
      effective_active = false,
      effective_role_id = null,
      effective_source = null,
      revision = revision + 1,
      sync_status = 'not_required',
      last_sync_error = 'EmailRouter portal application retired for native FCOS cutover.',
      updated_at = now()
    where application_id = 'emailrouter'
      and (
        explicit_active
        or effective_active
        or sync_status <> 'not_required'
      );
  end if;

  if to_regclass('public.portal_entitlement_outbox') is not null then
    update public.portal_entitlement_outbox
    set
      status = 'dead',
      locked_at = null,
      completed_at = coalesce(completed_at, now()),
      last_error = 'EmailRouter portal application retired before dispatch.',
      updated_at = now()
    where application_id = 'emailrouter'
      and status in ('pending', 'processing', 'failed');
  end if;

  if to_regclass('public.portal_access_events') is not null
     and to_regclass('public.portal_applications') is not null then
    insert into public.portal_access_events (
      application_id,
      action,
      outcome,
      request_id,
      metadata
    )
    select
      'emailrouter',
      'native_retirement',
      'succeeded',
      '20260803090000-native-emailrouter-schema',
      jsonb_build_object('retired', true, 'native_schema', 'emailrouter')
    where exists (
      select 1 from public.portal_applications where id = 'emailrouter'
    )
      and not exists (
        select 1
        from public.portal_access_events
        where request_id = '20260803090000-native-emailrouter-schema'
      );
  end if;
end;
$$;

commit;
