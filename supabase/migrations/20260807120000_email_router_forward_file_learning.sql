begin;

create table if not exists emailrouter.routing_folders (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references emailrouter.mailbox_connections(id) on delete cascade,
  provider_folder_id text not null,
  parent_provider_folder_id text,
  display_name text not null,
  folder_path text not null,
  approved boolean not null default false,
  active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  last_seen_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, provider_folder_id),
  check (char_length(btrim(provider_folder_id)) between 1 and 512),
  check (char_length(btrim(display_name)) between 1 and 255),
  check (char_length(btrim(folder_path)) between 1 and 1000)
);

create index if not exists emailrouter_routing_folders_available_idx
  on emailrouter.routing_folders (mailbox_id, approved, active, sort_order, folder_path);

alter table emailrouter.mail_actions
  add column if not exists post_action_mode text,
  add column if not exists post_action_folder_id uuid references emailrouter.routing_folders(id) on delete set null,
  add column if not exists post_action_folder_provider_id_snapshot text,
  add column if not exists post_action_folder_path_snapshot text,
  add column if not exists post_action_state text,
  add column if not exists post_action_attempt_count integer not null default 0,
  add column if not exists post_action_failure_code text,
  add column if not exists post_action_confirmed_at timestamptz,
  add column if not exists learning_state text,
  add column if not exists learning_recipients_complete boolean,
  add column if not exists advisor_recommendation_id uuid;

alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_post_action_mode_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_post_action_mode_check
  check (post_action_mode is null or post_action_mode in ('keep_current', 'move'));
alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_post_action_state_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_post_action_state_check
  check (post_action_state is null or post_action_state in ('not_required', 'pending', 'confirmed', 'failed', 'uncertain'));
alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_post_action_attempt_count_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_post_action_attempt_count_check
  check (post_action_attempt_count >= 0);
alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_post_action_failure_code_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_post_action_failure_code_check
  check (post_action_failure_code is null or post_action_failure_code ~ '^[a-z0-9_.-]{1,120}$');
alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_learning_state_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_learning_state_check
  check (learning_state is null or learning_state in ('pending', 'completed', 'failed', 'skipped'));

create table if not exists emailrouter.advisor_recommendations (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references emailrouter.mailbox_connections(id) on delete cascade,
  message_id uuid not null references emailrouter.messages(id) on delete cascade,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  routing_category text not null,
  suggested_action text check (suggested_action is null or suggested_action in ('redirect', 'forward')),
  suggested_post_action_mode text not null check (suggested_post_action_mode in ('keep_current', 'move')),
  suggested_folder_key text check (suggested_folder_key is null or suggested_folder_key = 'archive'),
  suggested_folder_id uuid references emailrouter.routing_folders(id) on delete set null,
  action_confidence numeric(5,4) not null default 0 check (action_confidence between 0 and 1),
  recipient_confidence numeric(5,4) not null default 0 check (recipient_confidence between 0 and 1),
  folder_confidence numeric(5,4) not null default 0 check (folder_confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  selection_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(selection_snapshot) = 'array'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    (suggested_post_action_mode = 'keep_current' and suggested_folder_key is null and suggested_folder_id is null)
    or (suggested_post_action_mode = 'move' and ((suggested_folder_key = 'archive') <> (suggested_folder_id is not null)))
  )
);
create index if not exists emailrouter_advisor_recommendations_message_idx
  on emailrouter.advisor_recommendations (message_id, created_at desc);

alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_advisor_recommendation_id_fkey;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_advisor_recommendation_id_fkey
  foreign key (advisor_recommendation_id) references emailrouter.advisor_recommendations(id) on delete set null;

create table if not exists emailrouter.advisor_learning_outcomes (
  id uuid primary key default gen_random_uuid(),
  mail_action_id uuid not null unique references emailrouter.mail_actions(id) on delete cascade,
  mailbox_id uuid not null references emailrouter.mailbox_connections(id) on delete cascade,
  routing_category text not null,
  sender_fingerprint text,
  sender_domain_fingerprint text,
  subject_token_fingerprints jsonb not null default '[]'::jsonb,
  attachment_profile text not null default 'none',
  action_type text not null check (action_type in ('redirect', 'forward')),
  post_action_mode text not null check (post_action_mode in ('keep_current', 'move')),
  post_action_folder_id uuid references emailrouter.routing_folders(id) on delete set null,
  recipients_complete boolean not null default true,
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  disabled_reason text,
  disabled_by uuid references public.user_profiles(id) on delete set null,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_fingerprint is null or sender_fingerprint ~ '^[0-9a-f]{64}$'),
  check (sender_domain_fingerprint is null or sender_domain_fingerprint ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(subject_token_fingerprints) = 'array'),
  check (char_length(attachment_profile) between 1 and 120),
  check ((active = true and disabled_at is null) or (active = false and disabled_at is not null)),
  check (disabled_reason is null or char_length(btrim(disabled_reason)) between 3 and 500)
);
create index if not exists emailrouter_advisor_learning_match_idx
  on emailrouter.advisor_learning_outcomes (mailbox_id, routing_category, active, created_at desc);

create table if not exists emailrouter.advisor_learning_outcome_destinations (
  outcome_id uuid not null references emailrouter.advisor_learning_outcomes(id) on delete cascade,
  destination_id uuid references emailrouter.destinations(id) on delete restrict,
  group_id uuid references emailrouter.destination_groups(id) on delete restrict,
  recipient_kind text not null check (recipient_kind in ('to', 'cc', 'bcc')),
  position smallint not null check (position > 0),
  primary key (outcome_id, recipient_kind, position),
  check ((destination_id is null) <> (group_id is null))
);

create table if not exists emailrouter.advisor_learning_jobs (
  id uuid primary key default gen_random_uuid(),
  mail_action_id uuid not null unique references emailrouter.mail_actions(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_.-]{1,120}$'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists emailrouter_advisor_learning_jobs_pending_idx
  on emailrouter.advisor_learning_jobs (next_attempt_at, created_at)
  where state in ('pending', 'failed');

create table if not exists emailrouter.advisor_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid references emailrouter.advisor_recommendations(id) on delete set null,
  mail_action_id uuid references emailrouter.mail_actions(id) on delete set null,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  feedback_type text not null check (feedback_type in ('applied', 'modified', 'dismissed', 'forgotten')),
  created_at timestamptz not null default now()
);
create unique index if not exists emailrouter_advisor_feedback_action_key
  on emailrouter.advisor_feedback (mail_action_id)
  where mail_action_id is not null;

alter table emailrouter.settings
  drop constraint if exists settings_key_check;
alter table emailrouter.settings
  add constraint settings_key_check
  check (key in ('directory.allowed_domains', 'advisor.enabled', 'advisor.model', 'advisor.learning_enabled'));
insert into emailrouter.settings (key, value)
values ('advisor.learning_enabled', '{"enabled":true}'::jsonb)
on conflict (key) do nothing;

alter table emailrouter.events
  drop constraint if exists events_entity_type_check;
alter table emailrouter.events
  add constraint events_entity_type_check
  check (entity_type in (
    'mailbox', 'message', 'destination', 'group', 'preset', 'preset_version',
    'preset_override', 'routing_leave', 'setting', 'mail_action', 'subscription',
    'alert', 'ai_usage', 'routing_directory', 'routing_folder',
    'learning_outcome', 'advisor_feedback'
  ));

create or replace function public.save_emailrouter_routing_folders(
  p_items jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  item jsonb;
  current_row emailrouter.routing_folders%rowtype;
  expected_revision bigint;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 250 then
    raise exception 'Routing folders must be supplied as a list of at most 250 items';
  end if;
  for item in select value from jsonb_array_elements(p_items)
  loop
    select * into current_row
    from emailrouter.routing_folders
    where id = (item->>'id')::uuid
    for update;
    if not found then raise exception 'Routing folder was not found'; end if;
    expected_revision := nullif(item->>'expectedRevision', '')::bigint;
    if expected_revision is null or current_row.revision <> expected_revision then
      raise exception 'Routing folder revision conflict';
    end if;
    if current_row.is_system and coalesce((item->>'approved')::boolean, false) is false then
      raise exception 'System routing folders cannot be disabled';
    end if;
    update emailrouter.routing_folders set
      approved = coalesce((item->>'approved')::boolean, false),
      sort_order = greatest(0, coalesce((item->>'sortOrder')::integer, current_row.sort_order)),
      revision = revision + 1,
      updated_by = p_actor,
      updated_at = now()
    where id = current_row.id;
  end loop;
  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    'configuration.routing_folders_saved', 'routing_folder',
    (p_items->0->>'id')::uuid, p_actor, gen_random_uuid()::text
  );
  return jsonb_build_object('saved', jsonb_array_length(p_items));
end;
$$;

create or replace function public.forget_emailrouter_learning_outcome(
  p_outcome_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  current_row emailrouter.advisor_learning_outcomes%rowtype;
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Enter a reason between 3 and 500 characters';
  end if;
  select * into current_row
  from emailrouter.advisor_learning_outcomes
  where id = p_outcome_id
  for update;
  if not found then raise exception 'Learned route was not found'; end if;
  if current_row.revision <> p_expected_revision then raise exception 'Learned route revision conflict'; end if;
  update emailrouter.advisor_learning_outcomes set
    active = false,
    revision = revision + 1,
    disabled_reason = btrim(p_reason),
    disabled_by = p_actor,
    disabled_at = now(),
    updated_at = now()
  where id = p_outcome_id;
  insert into emailrouter.advisor_feedback (mail_action_id, actor_user_id, feedback_type)
  values (current_row.mail_action_id, p_actor, 'forgotten')
  on conflict (mail_action_id) where mail_action_id is not null do update
    set actor_user_id = excluded.actor_user_id,
        feedback_type = excluded.feedback_type,
        created_at = now();
  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    'advisor.learning_forgotten', 'learning_outcome', p_outcome_id, p_actor, gen_random_uuid()::text
  );
  return jsonb_build_object('id', p_outcome_id, 'revision', current_row.revision + 1);
end;
$$;

create or replace function public.forget_emailrouter_learning_pattern(
  p_items jsonb,
  p_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  item jsonb;
  current_row emailrouter.advisor_learning_outcomes%rowtype;
  changed integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 250 then
    raise exception 'Learned routing outcomes must be supplied as a list';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Enter a reason between 3 and 500 characters';
  end if;
  for item in select value from jsonb_array_elements(p_items)
  loop
    select * into current_row
    from emailrouter.advisor_learning_outcomes
    where id = (item->>'id')::uuid
    for update;
    if not found then raise exception 'Learned route was not found'; end if;
    if current_row.revision <> nullif(item->>'expectedRevision', '')::bigint then
      raise exception 'Learned route revision conflict';
    end if;
    if current_row.active then
      update emailrouter.advisor_learning_outcomes set
        active = false,
        revision = revision + 1,
        disabled_reason = btrim(p_reason),
        disabled_by = p_actor,
        disabled_at = now(),
        updated_at = now()
      where id = current_row.id;
      insert into emailrouter.advisor_feedback (mail_action_id, actor_user_id, feedback_type)
      values (current_row.mail_action_id, p_actor, 'forgotten')
      on conflict (mail_action_id) where mail_action_id is not null do update
        set actor_user_id = excluded.actor_user_id,
            feedback_type = excluded.feedback_type,
            created_at = now();
      changed := changed + 1;
    end if;
  end loop;
  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    'advisor.learning_pattern_forgotten', 'learning_outcome',
    (p_items->0->>'id')::uuid, p_actor, gen_random_uuid()::text
  );
  return jsonb_build_object('forgotten', changed);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'routing_folders', 'advisor_recommendations', 'advisor_learning_outcomes',
    'advisor_learning_outcome_destinations', 'advisor_learning_jobs', 'advisor_feedback'
  ]
  loop
    execute format('alter table emailrouter.%I enable row level security', table_name);
    execute format('revoke all on table emailrouter.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table emailrouter.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on function public.save_emailrouter_routing_folders(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_folders(jsonb, uuid) to service_role;
revoke all on function public.forget_emailrouter_learning_outcome(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.forget_emailrouter_learning_outcome(uuid, bigint, text, uuid) to service_role;
revoke all on function public.forget_emailrouter_learning_pattern(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.forget_emailrouter_learning_pattern(jsonb, text, uuid) to service_role;

comment on table emailrouter.routing_folders is
  'Graph-discovered mailbox folders approved for post-send filing; no message content is stored.';
comment on table emailrouter.advisor_learning_outcomes is
  'Redacted company-wide routing outcomes containing only protected fingerprints and routing references.';

notify pgrst, 'reload schema';

commit;
