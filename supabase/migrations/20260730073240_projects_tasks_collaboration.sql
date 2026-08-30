create extension if not exists pgcrypto;

create table if not exists public.collaboration_roles (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  role text not null check (role in ('general_manager')),
  active boolean not null default true,
  granted_by uuid null references public.user_profiles(id) on delete set null,
  granted_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.collaboration_roles (user_id, role, active, granted_by_email)
select id, 'general_manager', true, 'system'
from public.user_profiles
where lower(email) = 'vincent@cosulich.com.hk'
on conflict (user_id) do update set
  role = excluded.role,
  active = true,
  updated_at = now();

create table if not exists public.collaboration_items (
  id uuid primary key default gen_random_uuid(),
  sequence_no bigint generated always as identity unique,
  item_key text not null unique,
  item_type text not null check (item_type in ('project', 'task', 'subtask')),
  project_id uuid null references public.collaboration_items(id) on delete restrict,
  parent_id uuid null references public.collaboration_items(id) on delete restrict,
  title text not null check (btrim(title) <> '' and char_length(title) <= 255),
  description text not null default '' check (char_length(description) <= 20000),
  status text not null default 'To Do'
    check (status in ('Backlog', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Done', 'Cancelled')),
  priority text not null default 'Medium'
    check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  start_date date null,
  due_date date null,
  owner_user_id uuid null references public.user_profiles(id) on delete set null,
  owner_name text not null,
  owner_email text not null,
  assignee_user_id uuid null references public.user_profiles(id) on delete set null,
  assignee_name text null,
  assignee_email text null,
  revision bigint not null default 1 check (revision > 0),
  archived_at timestamptz null,
  archived_by uuid null references public.user_profiles(id) on delete set null,
  archived_by_email text null,
  archive_batch_id uuid null,
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text not null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date is null or due_date is null or start_date <= due_date),
  check (
    (item_type = 'project' and project_id is null and parent_id is null)
    or (item_type = 'task' and parent_id is null)
    or (item_type = 'subtask' and parent_id is not null)
  ),
  check (project_id is null or project_id <> id),
  check (parent_id is null or parent_id <> id)
);

create table if not exists public.collaboration_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.collaboration_items(id) on delete cascade,
  body text not null check (btrim(body) <> '' and char_length(body) <= 10000),
  revision bigint not null default 1 check (revision > 0),
  author_user_id uuid null references public.user_profiles(id) on delete set null,
  author_name text not null,
  author_email text not null,
  edited_at timestamptz null,
  deleted_at timestamptz null,
  deleted_by uuid null references public.user_profiles(id) on delete set null,
  deleted_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collaboration_comment_mentions (
  comment_id uuid not null references public.collaboration_comments(id) on delete cascade,
  mentioned_user_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, mentioned_user_id)
);

create table if not exists public.collaboration_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.collaboration_items(id) on delete cascade,
  comment_id uuid null references public.collaboration_comments(id) on delete set null,
  attachment_id uuid null,
  event_type text not null,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_name text null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create table if not exists public.collaboration_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.collaboration_items(id) on delete cascade,
  comment_id uuid null references public.collaboration_comments(id) on delete set null,
  storage_bucket text not null default 'collaboration-files',
  storage_path text not null unique,
  original_filename text not null check (btrim(original_filename) <> '' and char_length(original_filename) <= 255),
  display_filename text not null check (btrim(display_filename) <> '' and char_length(display_filename) <= 255),
  content_type text not null,
  file_extension text not null,
  content_size bigint not null check (content_size > 0 and content_size <= 20971520),
  upload_status text not null default 'pending'
    check (upload_status in ('pending', 'complete', 'failed', 'deleted')),
  upload_expires_at timestamptz null,
  uploaded_by uuid null references public.user_profiles(id) on delete set null,
  uploaded_by_name text not null,
  uploaded_by_email text not null,
  completed_at timestamptz null,
  deleted_at timestamptz null,
  storage_removed_at timestamptz null,
  deleted_by uuid null references public.user_profiles(id) on delete set null,
  deleted_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collaboration_events
  add constraint collaboration_events_attachment_id_fkey
  foreign key (attachment_id)
  references public.collaboration_attachments(id)
  on delete set null;

create table if not exists public.collaboration_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  item_id uuid not null references public.collaboration_items(id) on delete cascade,
  event_id uuid null references public.collaboration_events(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('assignment', 'mention', 'comment', 'status', 'due_today', 'overdue')),
  title text not null,
  message text not null default '',
  dedupe_key text not null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists collaboration_items_type_idx
on public.collaboration_items(item_type, archived_at, updated_at desc);
create index if not exists collaboration_items_project_idx
on public.collaboration_items(project_id, archived_at, updated_at desc);
create index if not exists collaboration_items_parent_idx
on public.collaboration_items(parent_id, archived_at, updated_at desc);
create index if not exists collaboration_items_owner_idx
on public.collaboration_items(owner_user_id, archived_at, updated_at desc);
create index if not exists collaboration_items_assignee_idx
on public.collaboration_items(assignee_user_id, archived_at, updated_at desc);
create index if not exists collaboration_items_status_idx
on public.collaboration_items(status, archived_at, due_date);
create index if not exists collaboration_items_due_idx
on public.collaboration_items(due_date, archived_at)
where due_date is not null;
create index if not exists collaboration_comments_item_idx
on public.collaboration_comments(item_id, created_at);
create index if not exists collaboration_attachments_item_idx
on public.collaboration_attachments(item_id, upload_status, created_at desc);
create unique index if not exists collaboration_attachments_active_name_idx
on public.collaboration_attachments(item_id, lower(display_filename))
where upload_status in ('pending', 'complete');
create index if not exists collaboration_events_item_idx
on public.collaboration_events(item_id, created_at desc);
create index if not exists collaboration_events_created_idx
on public.collaboration_events(created_at desc);
create index if not exists collaboration_notifications_user_idx
on public.collaboration_notifications(user_id, read_at, created_at desc);

alter table public.collaboration_roles enable row level security;
alter table public.collaboration_items enable row level security;
alter table public.collaboration_comments enable row level security;
alter table public.collaboration_comment_mentions enable row level security;
alter table public.collaboration_attachments enable row level security;
alter table public.collaboration_events enable row level security;
alter table public.collaboration_notifications enable row level security;

revoke all on table public.collaboration_roles from public, anon, authenticated;
revoke all on table public.collaboration_items from public, anon, authenticated;
revoke all on table public.collaboration_comments from public, anon, authenticated;
revoke all on table public.collaboration_comment_mentions from public, anon, authenticated;
revoke all on table public.collaboration_attachments from public, anon, authenticated;
revoke all on table public.collaboration_events from public, anon, authenticated;
revoke all on table public.collaboration_notifications from public, anon, authenticated;

grant all on table public.collaboration_roles to service_role;
grant all on table public.collaboration_items to service_role;
grant all on table public.collaboration_comments to service_role;
grant all on table public.collaboration_comment_mentions to service_role;
grant all on table public.collaboration_attachments to service_role;
grant all on table public.collaboration_events to service_role;
grant all on table public.collaboration_notifications to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'collaboration-files',
  'collaboration-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'text/plain',
    'text/csv',
    'application/csv',
    'text/markdown',
    'message/rfc822',
    'application/vnd.ms-outlook'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

create or replace function public.collaboration_actor(
  p_actor_user_id uuid
)
returns public.user_profiles
language sql
security invoker
set search_path = public
as $$
  select profile
  from public.user_profiles profile
  where profile.id = p_actor_user_id
    and profile.active = true
  limit 1;
$$;

create or replace function public.collaboration_is_general_manager(
  p_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.collaboration_roles role_row
    join public.user_profiles profile on profile.id = role_row.user_id
    where role_row.user_id = p_user_id
      and role_row.role = 'general_manager'
      and role_row.active = true
      and profile.active = true
  );
$$;

create or replace function public.collaboration_notify(
  p_user_id uuid,
  p_item_id uuid,
  p_event_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_dedupe_key text,
  p_actor_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null or p_user_id = p_actor_user_id then
    return;
  end if;
  if not exists (
    select 1 from public.user_profiles
    where id = p_user_id and active = true
  ) then
    return;
  end if;

  insert into public.collaboration_notifications (
    user_id,
    item_id,
    event_id,
    notification_type,
    title,
    message,
    dedupe_key
  ) values (
    p_user_id,
    p_item_id,
    p_event_id,
    p_notification_type,
    left(coalesce(p_title, ''), 255),
    left(coalesce(p_message, ''), 1000),
    left(coalesce(p_dedupe_key, ''), 255)
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

create or replace function public.collaboration_item_key()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.item_key := (
    case new.item_type
      when 'project' then 'PRJ'
      when 'task' then 'TSK'
      else 'SUB'
    end
  ) || '-' || lpad(new.sequence_no::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists collaboration_item_key_trigger on public.collaboration_items;
create trigger collaboration_item_key_trigger
before insert on public.collaboration_items
for each row execute function public.collaboration_item_key();

create or replace function public.create_collaboration_item(
  p_values jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_assignee public.user_profiles%rowtype;
  v_project public.collaboration_items%rowtype;
  v_parent public.collaboration_items%rowtype;
  v_item public.collaboration_items%rowtype;
  v_event public.collaboration_events%rowtype;
  v_item_type text := lower(btrim(coalesce(p_values->>'item_type', 'task')));
  v_title text := btrim(coalesce(p_values->>'title', ''));
  v_description text := coalesce(p_values->>'description', '');
  v_status text := coalesce(nullif(p_values->>'status', ''), 'To Do');
  v_priority text := coalesce(nullif(p_values->>'priority', ''), 'Medium');
  v_project_id uuid := nullif(p_values->>'project_id', '')::uuid;
  v_parent_id uuid := nullif(p_values->>'parent_id', '')::uuid;
  v_assignee_id uuid := nullif(p_values->>'assignee_user_id', '')::uuid;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  if v_item_type not in ('project', 'task', 'subtask') then
    raise exception 'Item type must be Project, Task, or Subtask.';
  end if;
  if v_title = '' or char_length(v_title) > 255 then
    raise exception 'Title is required and must be 255 characters or fewer.';
  end if;
  if char_length(v_description) > 20000 then
    raise exception 'Description must be 20,000 characters or fewer.';
  end if;
  if v_status not in ('Backlog', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Done', 'Cancelled') then
    raise exception 'Select a valid status.';
  end if;
  if v_priority not in ('Low', 'Medium', 'High', 'Urgent') then
    raise exception 'Select a valid priority.';
  end if;
  if nullif(p_values->>'start_date', '') is not null
     and nullif(p_values->>'due_date', '') is not null
     and (p_values->>'start_date')::date > (p_values->>'due_date')::date then
    raise exception 'Start date cannot be after due date.';
  end if;

  if v_assignee_id is not null then
    select * into v_assignee
    from public.user_profiles
    where id = v_assignee_id and active = true;
    if not found then raise exception 'The selected assignee is no longer active.'; end if;
  end if;

  if v_item_type = 'project' then
    if v_project_id is not null or v_parent_id is not null then
      raise exception 'A Project cannot belong to another item.';
    end if;
  elsif v_item_type = 'task' then
    if v_parent_id is not null then raise exception 'A Task cannot have a parent Task.'; end if;
    if v_project_id is not null then
      select * into v_project
      from public.collaboration_items
      where id = v_project_id and item_type = 'project' and archived_at is null;
      if not found then raise exception 'The selected Project is unavailable.'; end if;
    end if;
  else
    if v_parent_id is null then raise exception 'A Subtask requires a parent Task.'; end if;
    select * into v_parent
    from public.collaboration_items
    where id = v_parent_id and item_type = 'task' and archived_at is null;
    if not found then raise exception 'A Subtask can only belong to an active Task.'; end if;
    v_project_id := v_parent.project_id;
  end if;

  insert into public.collaboration_items (
    item_key,
    item_type,
    project_id,
    parent_id,
    title,
    description,
    status,
    priority,
    start_date,
    due_date,
    owner_user_id,
    owner_name,
    owner_email,
    assignee_user_id,
    assignee_name,
    assignee_email,
    created_by,
    created_by_email,
    updated_by,
    updated_by_email
  ) values (
    'PENDING',
    v_item_type,
    v_project_id,
    v_parent_id,
    v_title,
    v_description,
    v_status,
    v_priority,
    nullif(p_values->>'start_date', '')::date,
    nullif(p_values->>'due_date', '')::date,
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email,
    v_assignee.id,
    case when v_assignee.id is null then null else coalesce(nullif(v_assignee.full_name, ''), v_assignee.email) end,
    v_assignee.email,
    v_actor.id,
    v_actor.email,
    v_actor.id,
    v_actor.email
  )
  returning * into v_item;

  insert into public.collaboration_events (
    item_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    v_item.id,
    'item_created',
    v_item.item_key || ' created',
    jsonb_build_object(
      'itemType', v_item.item_type,
      'status', v_item.status,
      'priority', v_item.priority,
      'assigneeUserId', v_item.assignee_user_id
    ),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  if v_item.assignee_user_id is not null then
    perform public.collaboration_notify(
      v_item.assignee_user_id,
      v_item.id,
      v_event.id,
      'assignment',
      v_item.item_key || ' assigned to you',
      v_item.title,
      'assignment:' || v_event.id,
      v_actor.id
    );
  end if;

  return jsonb_build_object('item', to_jsonb(v_item), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.save_collaboration_item(
  p_item_id uuid,
  p_values jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_current public.collaboration_items%rowtype;
  v_item public.collaboration_items%rowtype;
  v_assignee public.user_profiles%rowtype;
  v_project public.collaboration_items%rowtype;
  v_parent public.collaboration_items%rowtype;
  v_event public.collaboration_events%rowtype;
  v_is_gm boolean := false;
  v_can_edit boolean := false;
  v_can_manage boolean := false;
  v_assignee_id uuid;
  v_project_id uuid;
  v_parent_id uuid;
  v_status text;
  v_event_type text := 'item_updated';
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;

  select * into v_current
  from public.collaboration_items
  where id = p_item_id
  for update;
  if not found then raise exception 'The selected work item was not found.'; end if;
  if p_expected_revision is null or p_expected_revision <> v_current.revision then
    raise exception 'This work item changed after it was opened. Refresh and review the latest update.';
  end if;

  v_is_gm := public.collaboration_is_general_manager(v_actor.id);
  v_can_manage := v_current.owner_user_id = v_actor.id or v_is_gm;
  v_can_edit := v_can_manage or v_current.assignee_user_id = v_actor.id;
  if not v_can_edit then
    raise exception 'Only the owner, assignee, or General Manager can edit this work item.';
  end if;
  if v_current.archived_at is not null then
    raise exception 'Restore this work item before editing it.';
  end if;
  if (p_values ? 'assignee_user_id' or p_values ? 'project_id' or p_values ? 'parent_id') and not v_can_manage then
    raise exception 'Only the owner or General Manager can assign or move this work item.';
  end if;
  if p_values ? 'item_type' and lower(p_values->>'item_type') <> v_current.item_type then
    raise exception 'Work item type cannot be changed.';
  end if;

  v_assignee_id := case
    when p_values ? 'assignee_user_id' then nullif(p_values->>'assignee_user_id', '')::uuid
    else v_current.assignee_user_id
  end;
  if v_assignee_id is not null then
    select * into v_assignee
    from public.user_profiles
    where id = v_assignee_id and active = true;
    if not found then raise exception 'The selected assignee is no longer active.'; end if;
  end if;

  v_project_id := case
    when p_values ? 'project_id' then nullif(p_values->>'project_id', '')::uuid
    else v_current.project_id
  end;
  v_parent_id := case
    when p_values ? 'parent_id' then nullif(p_values->>'parent_id', '')::uuid
    else v_current.parent_id
  end;

  if v_current.item_type = 'project' then
    if v_project_id is not null or v_parent_id is not null then
      raise exception 'A Project cannot belong to another item.';
    end if;
  elsif v_current.item_type = 'task' then
    if v_parent_id is not null then raise exception 'A Task cannot have a parent Task.'; end if;
    if v_project_id is not null then
      select * into v_project
      from public.collaboration_items
      where id = v_project_id and item_type = 'project' and archived_at is null;
      if not found then raise exception 'The selected Project is unavailable.'; end if;
    end if;
  else
    if v_parent_id is null then raise exception 'A Subtask requires a parent Task.'; end if;
    select * into v_parent
    from public.collaboration_items
    where id = v_parent_id and item_type = 'task' and archived_at is null;
    if not found then raise exception 'A Subtask can only belong to an active Task.'; end if;
    v_project_id := v_parent.project_id;
  end if;

  v_status := case when p_values ? 'status' then p_values->>'status' else v_current.status end;
  if v_status not in ('Backlog', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Done', 'Cancelled') then
    raise exception 'Select a valid status.';
  end if;
  if v_status = 'Done' and exists (
    select 1
    from public.collaboration_items child
    where child.archived_at is null
      and child.status not in ('Done', 'Cancelled')
      and (
        (
          v_current.item_type = 'project'
          and child.item_type = 'task'
          and child.project_id = v_current.id
        )
        or (
          v_current.item_type = 'task'
          and child.item_type = 'subtask'
          and child.parent_id = v_current.id
        )
      )
  ) then
    raise exception 'Complete or cancel every active child before marking this item Done.';
  end if;
  if p_values ? 'priority'
     and p_values->>'priority' not in ('Low', 'Medium', 'High', 'Urgent') then
    raise exception 'Select a valid priority.';
  end if;
  if char_length(coalesce(p_values->>'description', v_current.description)) > 20000 then
    raise exception 'Description must be 20,000 characters or fewer.';
  end if;
  if btrim(coalesce(p_values->>'title', v_current.title)) = ''
     or char_length(btrim(coalesce(p_values->>'title', v_current.title))) > 255 then
    raise exception 'Title is required and must be 255 characters or fewer.';
  end if;
  if coalesce(nullif(p_values->>'start_date', '')::date, v_current.start_date)
     > coalesce(nullif(p_values->>'due_date', '')::date, v_current.due_date) then
    raise exception 'Start date cannot be after due date.';
  end if;

  if v_assignee_id is distinct from v_current.assignee_user_id then
    v_event_type := 'assignment_changed';
  elsif v_status is distinct from v_current.status then
    v_event_type := 'status_changed';
  elsif v_project_id is distinct from v_current.project_id
     or v_parent_id is distinct from v_current.parent_id then
    v_event_type := 'item_moved';
  end if;

  update public.collaboration_items set
    project_id = v_project_id,
    parent_id = v_parent_id,
    title = case when p_values ? 'title' then btrim(p_values->>'title') else title end,
    description = case when p_values ? 'description' then coalesce(p_values->>'description', '') else description end,
    status = v_status,
    priority = case when p_values ? 'priority' then p_values->>'priority' else priority end,
    start_date = case when p_values ? 'start_date' then nullif(p_values->>'start_date', '')::date else start_date end,
    due_date = case when p_values ? 'due_date' then nullif(p_values->>'due_date', '')::date else due_date end,
    assignee_user_id = v_assignee_id,
    assignee_name = case when v_assignee_id is null then null else coalesce(nullif(v_assignee.full_name, ''), v_assignee.email) end,
    assignee_email = case when v_assignee_id is null then null else v_assignee.email end,
    revision = revision + 1,
    updated_by = v_actor.id,
    updated_by_email = v_actor.email,
    updated_at = clock_timestamp()
  where id = v_current.id
  returning * into v_item;

  if v_current.item_type = 'task'
     and v_project_id is distinct from v_current.project_id then
    update public.collaboration_items set
      project_id = v_project_id,
      revision = revision + 1,
      updated_by = v_actor.id,
      updated_by_email = v_actor.email,
      updated_at = clock_timestamp()
    where parent_id = v_current.id
      and item_type = 'subtask';
  end if;

  insert into public.collaboration_events (
    item_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    v_item.id,
    v_event_type,
    case v_event_type
      when 'assignment_changed' then v_item.item_key || ' assignment changed'
      when 'status_changed' then v_item.item_key || ' moved to ' || v_item.status
      when 'item_moved' then v_item.item_key || ' moved'
      else v_item.item_key || ' updated'
    end,
    jsonb_build_object(
      'previousStatus', v_current.status,
      'status', v_item.status,
      'previousAssigneeUserId', v_current.assignee_user_id,
      'assigneeUserId', v_item.assignee_user_id,
      'previousProjectId', v_current.project_id,
      'projectId', v_item.project_id,
      'previousParentId', v_current.parent_id,
      'parentId', v_item.parent_id,
      'revision', v_item.revision
    ),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  if v_event_type = 'assignment_changed' and v_item.assignee_user_id is not null then
    perform public.collaboration_notify(
      v_item.assignee_user_id,
      v_item.id,
      v_event.id,
      'assignment',
      v_item.item_key || ' assigned to you',
      v_item.title,
      'assignment:' || v_event.id,
      v_actor.id
    );
  elsif v_event_type = 'status_changed' then
    perform public.collaboration_notify(
      v_item.owner_user_id,
      v_item.id,
      v_event.id,
      'status',
      v_item.item_key || ' status changed',
      v_item.status || ' · ' || v_item.title,
      'status:' || v_event.id,
      v_actor.id
    );
    perform public.collaboration_notify(
      v_item.assignee_user_id,
      v_item.id,
      v_event.id,
      'status',
      v_item.item_key || ' status changed',
      v_item.status || ' · ' || v_item.title,
      'status:' || v_event.id,
      v_actor.id
    );
  end if;

  return jsonb_build_object('item', to_jsonb(v_item), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.save_collaboration_comment(
  p_item_id uuid,
  p_comment_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[],
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_item public.collaboration_items%rowtype;
  v_current public.collaboration_comments%rowtype;
  v_comment public.collaboration_comments%rowtype;
  v_event public.collaboration_events%rowtype;
  v_mentioned_user_ids uuid[] := coalesce(p_mentioned_user_ids, '{}'::uuid[]);
  v_is_gm boolean := false;
  v_event_type text;
  v_mentioned_user_id uuid;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_item
  from public.collaboration_items
  where id = p_item_id and archived_at is null;
  if not found then raise exception 'The selected work item is unavailable.'; end if;
  if btrim(coalesce(p_body, '')) = '' or char_length(p_body) > 10000 then
    raise exception 'Comment is required and must be 10,000 characters or fewer.';
  end if;
  if cardinality(v_mentioned_user_ids) <> (
    select count(distinct mentioned_user_id)
    from unnest(v_mentioned_user_ids) mentioned_user_id
  ) then
    raise exception 'The same user cannot be mentioned more than once.';
  end if;
  if exists (
    select 1
    from unnest(v_mentioned_user_ids) mentioned_user_id
    left join public.user_profiles profile
      on profile.id = mentioned_user_id and profile.active = true
    where profile.id is null
  ) then
    raise exception 'Every mentioned user must be active.';
  end if;

  if p_comment_id is null then
    insert into public.collaboration_comments (
      item_id,
      body,
      author_user_id,
      author_name,
      author_email
    ) values (
      v_item.id,
      btrim(p_body),
      v_actor.id,
      coalesce(nullif(v_actor.full_name, ''), v_actor.email),
      v_actor.email
    )
    returning * into v_comment;
    v_event_type := 'comment_added';
  else
    select * into v_current
    from public.collaboration_comments
    where id = p_comment_id and item_id = v_item.id
    for update;
    if not found or v_current.deleted_at is not null then
      raise exception 'The selected comment is unavailable.';
    end if;
    v_is_gm := public.collaboration_is_general_manager(v_actor.id);
    if v_current.author_user_id is distinct from v_actor.id and not v_is_gm then
      raise exception 'Only the comment author or General Manager can edit this comment.';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_current.revision then
      raise exception 'This comment changed after it was opened. Refresh and review the latest update.';
    end if;
    update public.collaboration_comments set
      body = btrim(p_body),
      revision = revision + 1,
      edited_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where id = v_current.id
    returning * into v_comment;
    delete from public.collaboration_comment_mentions
    where comment_id = v_comment.id;
    v_event_type := 'comment_edited';
  end if;

  insert into public.collaboration_comment_mentions (comment_id, mentioned_user_id)
  select v_comment.id, mentioned_user_id
  from unnest(v_mentioned_user_ids) mentioned_user_id
  on conflict do nothing;

  insert into public.collaboration_events (
    item_id,
    comment_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    v_item.id,
    v_comment.id,
    v_event_type,
    case when v_event_type = 'comment_added'
      then v_actor.email || ' added a comment'
      else v_actor.email || ' edited a comment'
    end,
    jsonb_build_object(
      'commentId', v_comment.id,
      'mentionedUserIds', to_jsonb(v_mentioned_user_ids),
      'revision', v_comment.revision
    ),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  if v_event_type = 'comment_added' then
    perform public.collaboration_notify(
      v_item.owner_user_id,
      v_item.id,
      v_event.id,
      'comment',
      'New comment on ' || v_item.item_key,
      left(v_comment.body, 240),
      'comment:' || v_event.id,
      v_actor.id
    );
    perform public.collaboration_notify(
      v_item.assignee_user_id,
      v_item.id,
      v_event.id,
      'comment',
      'New comment on ' || v_item.item_key,
      left(v_comment.body, 240),
      'comment:' || v_event.id,
      v_actor.id
    );
  end if;

  foreach v_mentioned_user_id in array v_mentioned_user_ids loop
    perform public.collaboration_notify(
      v_mentioned_user_id,
      v_item.id,
      v_event.id,
      'mention',
      'You were mentioned on ' || v_item.item_key,
      left(v_comment.body, 240),
      'mention:' || v_event.id,
      v_actor.id
    );
  end loop;

  return jsonb_build_object('comment', to_jsonb(v_comment), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.delete_collaboration_comment(
  p_item_id uuid,
  p_comment_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_comment public.collaboration_comments%rowtype;
  v_event public.collaboration_events%rowtype;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_comment
  from public.collaboration_comments
  where id = p_comment_id and item_id = p_item_id
  for update;
  if not found or v_comment.deleted_at is not null then
    raise exception 'The selected comment is unavailable.';
  end if;
  if v_comment.author_user_id is distinct from v_actor.id
     and not public.collaboration_is_general_manager(v_actor.id) then
    raise exception 'Only the comment author or General Manager can remove this comment.';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_comment.revision then
    raise exception 'This comment changed after it was opened. Refresh and review the latest update.';
  end if;

  update public.collaboration_comments set
    deleted_at = clock_timestamp(),
    deleted_by = v_actor.id,
    deleted_by_email = v_actor.email,
    revision = revision + 1,
    updated_at = clock_timestamp()
  where id = v_comment.id
  returning * into v_comment;

  insert into public.collaboration_events (
    item_id,
    comment_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    p_item_id,
    v_comment.id,
    'comment_deleted',
    v_actor.email || ' removed a comment',
    jsonb_build_object('commentId', v_comment.id, 'revision', v_comment.revision),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  return jsonb_build_object('comment', to_jsonb(v_comment), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.set_collaboration_item_archived(
  p_item_id uuid,
  p_archived boolean,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_current public.collaboration_items%rowtype;
  v_root public.collaboration_items%rowtype;
  v_event public.collaboration_events%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_count integer := 0;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_current
  from public.collaboration_items
  where id = p_item_id
  for update;
  if not found then raise exception 'The selected work item was not found.'; end if;
  if p_expected_revision is null or p_expected_revision <> v_current.revision then
    raise exception 'This work item changed after it was opened. Refresh and review the latest update.';
  end if;
  if v_current.owner_user_id is distinct from v_actor.id
     and not public.collaboration_is_general_manager(v_actor.id) then
    raise exception 'Only the owner or General Manager can archive or restore this work item.';
  end if;
  if p_archived and v_current.archived_at is not null then
    raise exception 'This work item is already archived.';
  end if;
  if not p_archived and v_current.archived_at is null then
    raise exception 'This work item is not archived.';
  end if;
  if not p_archived and v_current.item_type = 'task' and v_current.project_id is not null
     and exists (
       select 1 from public.collaboration_items project
       where project.id = v_current.project_id and project.archived_at is not null
     ) then
    raise exception 'Restore the parent Project before restoring this Task.';
  end if;
  if not p_archived and v_current.item_type = 'subtask'
     and exists (
       select 1 from public.collaboration_items parent
       where parent.id = v_current.parent_id and parent.archived_at is not null
     ) then
    raise exception 'Restore the parent Task before restoring this Subtask.';
  end if;

  with recursive descendants as (
    select id
    from public.collaboration_items
    where id = v_current.id
    union
    select child.id
    from public.collaboration_items child
    join descendants parent_row
      on child.parent_id = parent_row.id
      or child.project_id = parent_row.id
    where child.id <> v_current.id
  )
  update public.collaboration_items item set
    archived_at = case when p_archived then clock_timestamp() else null end,
    archived_by = case when p_archived then v_actor.id else null end,
    archived_by_email = case when p_archived then v_actor.email else null end,
    archive_batch_id = case when p_archived then v_batch_id else null end,
    revision = revision + 1,
    updated_by = v_actor.id,
    updated_by_email = v_actor.email,
    updated_at = clock_timestamp()
  where item.id in (select id from descendants)
    and (
      (p_archived and item.archived_at is null)
      or (not p_archived and (
        item.id = v_current.id
        or item.archive_batch_id = v_current.archive_batch_id
      ))
    );
  get diagnostics v_count = row_count;

  select * into v_root from public.collaboration_items where id = v_current.id;

  insert into public.collaboration_events (
    item_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    v_root.id,
    case when p_archived then 'item_archived' else 'item_restored' end,
    v_root.item_key || case when p_archived then ' archived' else ' restored' end,
    jsonb_build_object('affectedItems', v_count, 'archiveBatchId', v_batch_id),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  return jsonb_build_object(
    'item', to_jsonb(v_root),
    'event', to_jsonb(v_event),
    'affectedItems', v_count
  );
end;
$$;

create or replace function public.prepare_collaboration_attachment(
  p_item_id uuid,
  p_comment_id uuid,
  p_original_filename text,
  p_content_type text,
  p_file_extension text,
  p_content_size bigint,
  p_storage_path text,
  p_actor_user_id uuid,
  p_actor_email text
)
returns public.collaboration_attachments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_attachment public.collaboration_attachments%rowtype;
  v_base_name text;
  v_extension text := lower(btrim(coalesce(p_file_extension, '')));
  v_candidate text;
  v_suffix integer := 0;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  if not exists (
    select 1 from public.collaboration_items
    where id = p_item_id and archived_at is null
  ) then
    raise exception 'The selected work item is unavailable.';
  end if;
  if p_comment_id is not null and not exists (
    select 1 from public.collaboration_comments
    where id = p_comment_id and item_id = p_item_id and deleted_at is null
  ) then
    raise exception 'The selected comment is unavailable.';
  end if;
  if p_content_size <= 0 or p_content_size > 20971520 then
    raise exception 'File must be between 1 byte and 20 MB.';
  end if;
  if btrim(coalesce(p_original_filename, '')) = ''
     or char_length(p_original_filename) > 255 then
    raise exception 'A filename of 255 characters or fewer is required.';
  end if;
  if v_extension = '' or v_extension !~ '^[a-z0-9]{1,10}$' then
    raise exception 'A valid file extension is required.';
  end if;
  if btrim(coalesce(p_storage_path, '')) = '' then
    raise exception 'A private storage path is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text, 0));

  v_base_name := regexp_replace(
    btrim(p_original_filename),
    '\.' || regexp_replace(v_extension, '([\\.^$|()\\[\\]{}*+?])', '\\\1', 'g') || '$',
    '',
    'i'
  );
  if v_base_name = '' then v_base_name := 'Attachment'; end if;

  loop
    v_candidate := left(v_base_name, greatest(1, 250 - char_length(v_extension) - case when v_suffix = 0 then 0 else char_length(v_suffix::text) + 1 end))
      || case when v_suffix = 0 then '' else '-' || v_suffix::text end
      || '.' || v_extension;
    exit when not exists (
      select 1
      from public.collaboration_attachments
      where item_id = p_item_id
        and lower(display_filename) = lower(v_candidate)
        and upload_status in ('pending', 'complete')
    );
    v_suffix := v_suffix + 1;
    if v_suffix > 9999 then
      raise exception 'A unique filename could not be reserved.';
    end if;
  end loop;

  insert into public.collaboration_attachments (
    item_id,
    comment_id,
    storage_path,
    original_filename,
    display_filename,
    content_type,
    file_extension,
    content_size,
    upload_status,
    upload_expires_at,
    uploaded_by,
    uploaded_by_name,
    uploaded_by_email
  ) values (
    p_item_id,
    p_comment_id,
    p_storage_path,
    p_original_filename,
    v_candidate,
    p_content_type,
    v_extension,
    p_content_size,
    'pending',
    now() + interval '2 hours',
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_attachment;

  return v_attachment;
end;
$$;

create or replace function public.complete_collaboration_attachment(
  p_attachment_id uuid,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_attachment public.collaboration_attachments%rowtype;
  v_item public.collaboration_items%rowtype;
  v_event public.collaboration_events%rowtype;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_attachment
  from public.collaboration_attachments
  where id = p_attachment_id
  for update;
  if not found or v_attachment.upload_status <> 'pending' then
    raise exception 'The pending attachment was not found.';
  end if;
  if v_attachment.uploaded_by is distinct from v_actor.id then
    raise exception 'Only the uploader can complete this attachment.';
  end if;
  if v_attachment.upload_expires_at < now() then
    raise exception 'The signed upload has expired. Upload the file again.';
  end if;

  select * into v_item from public.collaboration_items where id = v_attachment.item_id;
  if not found or v_item.archived_at is not null then
    raise exception 'The selected work item is unavailable.';
  end if;

  update public.collaboration_attachments set
    upload_status = 'complete',
    upload_expires_at = null,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = v_attachment.id
  returning * into v_attachment;

  insert into public.collaboration_events (
    item_id,
    comment_id,
    attachment_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    v_attachment.item_id,
    v_attachment.comment_id,
    v_attachment.id,
    'file_uploaded',
    v_attachment.display_filename || ' uploaded',
    jsonb_build_object(
      'attachmentId', v_attachment.id,
      'displayFilename', v_attachment.display_filename,
      'contentType', v_attachment.content_type,
      'contentSize', v_attachment.content_size
    ),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  return jsonb_build_object('attachment', to_jsonb(v_attachment), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.delete_collaboration_attachment(
  p_attachment_id uuid,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_attachment public.collaboration_attachments%rowtype;
  v_item public.collaboration_items%rowtype;
  v_event public.collaboration_events%rowtype;
begin
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active = true;
  if not found then raise exception 'An active FCOS user is required.'; end if;
  if lower(coalesce(v_actor.email, '')) <> lower(coalesce(p_actor_email, '')) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_attachment
  from public.collaboration_attachments
  where id = p_attachment_id and upload_status = 'complete'
  for update;
  if not found then raise exception 'The selected attachment is unavailable.'; end if;
  select * into v_item from public.collaboration_items where id = v_attachment.item_id;
  if not found then raise exception 'The selected work item is unavailable.'; end if;
  if v_attachment.uploaded_by is distinct from v_actor.id
     and v_item.owner_user_id is distinct from v_actor.id
     and not public.collaboration_is_general_manager(v_actor.id) then
    raise exception 'Only the uploader, owner, or General Manager can remove this file.';
  end if;

  update public.collaboration_attachments set
    upload_status = 'deleted',
    deleted_at = clock_timestamp(),
    deleted_by = v_actor.id,
    deleted_by_email = v_actor.email,
    updated_at = clock_timestamp()
  where id = v_attachment.id
  returning * into v_attachment;

  insert into public.collaboration_events (
    item_id,
    comment_id,
    attachment_id,
    event_type,
    summary,
    metadata,
    actor_user_id,
    actor_name,
    actor_email
  ) values (
    v_attachment.item_id,
    v_attachment.comment_id,
    v_attachment.id,
    'file_deleted',
    v_attachment.display_filename || ' removed',
    jsonb_build_object(
      'attachmentId', v_attachment.id,
      'displayFilename', v_attachment.display_filename
    ),
    v_actor.id,
    coalesce(nullif(v_actor.full_name, ''), v_actor.email),
    v_actor.email
  )
  returning * into v_event;

  return jsonb_build_object('attachment', to_jsonb(v_attachment), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.create_collaboration_due_notifications(
  p_today date
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with recipients as (
    select
      item.id as item_id,
      item.item_key,
      item.title,
      item.due_date,
      recipient.user_id,
      case when item.due_date = p_today then 'due_today' else 'overdue' end as notification_type
    from public.collaboration_items item
    cross join lateral (
      select distinct user_id
      from unnest(array[item.owner_user_id, item.assignee_user_id]) user_id
      where user_id is not null
    ) recipient
    join public.user_profiles profile
      on profile.id = recipient.user_id and profile.active = true
    where item.archived_at is null
      and item.status not in ('Done', 'Cancelled')
      and item.due_date is not null
      and (
        item.due_date = p_today
        or item.due_date = p_today - 1
      )
  )
  insert into public.collaboration_notifications (
    user_id,
    item_id,
    notification_type,
    title,
    message,
    dedupe_key
  )
  select
    recipient.user_id,
    recipient.item_id,
    recipient.notification_type,
    recipient.item_key || case when recipient.notification_type = 'due_today' then ' is due today' else ' is overdue' end,
    recipient.title,
    recipient.notification_type || ':' || recipient.item_id || ':' || recipient.due_date
  from recipients recipient
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.collaboration_actor(uuid) from public, anon, authenticated;
revoke all on function public.collaboration_is_general_manager(uuid) from public, anon, authenticated;
revoke all on function public.collaboration_notify(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_collaboration_item(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.save_collaboration_item(uuid, jsonb, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.save_collaboration_comment(uuid, uuid, text, uuid[], uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.delete_collaboration_comment(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.set_collaboration_item_archived(uuid, boolean, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.prepare_collaboration_attachment(uuid, uuid, text, text, text, bigint, text, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_collaboration_attachment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_collaboration_attachment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_collaboration_due_notifications(date) from public, anon, authenticated;

grant execute on function public.collaboration_actor(uuid) to service_role;
grant execute on function public.collaboration_is_general_manager(uuid) to service_role;
grant execute on function public.collaboration_notify(uuid, uuid, uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.create_collaboration_item(jsonb, uuid, text) to service_role;
grant execute on function public.save_collaboration_item(uuid, jsonb, uuid, text, bigint) to service_role;
grant execute on function public.save_collaboration_comment(uuid, uuid, text, uuid[], uuid, text, bigint) to service_role;
grant execute on function public.delete_collaboration_comment(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.set_collaboration_item_archived(uuid, boolean, uuid, text, bigint) to service_role;
grant execute on function public.prepare_collaboration_attachment(uuid, uuid, text, text, text, bigint, text, uuid, text) to service_role;
grant execute on function public.complete_collaboration_attachment(uuid, uuid, text) to service_role;
grant execute on function public.delete_collaboration_attachment(uuid, uuid, text) to service_role;
grant execute on function public.create_collaboration_due_notifications(date) to service_role;
