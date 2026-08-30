create table if not exists public.system_error_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 128),
  handler text not null check (length(handler) between 1 and 120),
  http_status integer not null check (http_status between 500 and 599),
  title text not null check (length(btrim(title)) between 1 and 255),
  message text not null default '' check (length(message) <= 1000),
  link text not null default '/' check (length(link) between 1 and 500),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_request_id text null check (last_request_id is null or length(last_request_id) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at)
);

create table if not exists public.system_error_notification_states (
  event_id uuid not null references public.system_error_events(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  read_at timestamptz null,
  handled_at timestamptz null,
  snoozed_until timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists system_error_events_last_seen_idx
on public.system_error_events(last_seen_at desc);

create index if not exists system_error_notification_states_user_idx
on public.system_error_notification_states(user_id, handled_at, snoozed_until, read_at, updated_at desc);

alter table public.system_error_events enable row level security;
alter table public.system_error_notification_states enable row level security;

revoke all on table public.system_error_events from public, anon, authenticated;
revoke all on table public.system_error_notification_states from public, anon, authenticated;
grant all on table public.system_error_events to service_role;
grant all on table public.system_error_notification_states to service_role;

create or replace function public.record_system_error_event(
  p_dedupe_key text,
  p_handler text,
  p_http_status integer,
  p_title text,
  p_message text,
  p_link text,
  p_request_id text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
begin
  if length(btrim(coalesce(p_dedupe_key, ''))) not between 1 and 128 then
    raise exception 'A valid system error dedupe key is required.';
  end if;
  if length(btrim(coalesce(p_handler, ''))) not between 1 and 120 then
    raise exception 'A valid system error handler is required.';
  end if;
  if p_http_status not between 500 and 599 then
    raise exception 'Only unexpected server errors may create system notifications.';
  end if;

  insert into public.system_error_events (
    dedupe_key,
    handler,
    http_status,
    title,
    message,
    link,
    first_seen_at,
    last_seen_at,
    last_request_id
  ) values (
    btrim(p_dedupe_key),
    btrim(p_handler),
    p_http_status,
    left(btrim(p_title), 255),
    left(coalesce(p_message, ''), 1000),
    left(coalesce(nullif(btrim(p_link), ''), '/'), 500),
    v_occurred_at,
    v_occurred_at,
    nullif(left(btrim(coalesce(p_request_id, '')), 128), '')
  )
  on conflict (dedupe_key) do update
  set occurrence_count = public.system_error_events.occurrence_count + 1,
      last_seen_at = greatest(public.system_error_events.last_seen_at, excluded.last_seen_at),
      last_request_id = excluded.last_request_id,
      updated_at = now()
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_system_error_event(text, text, integer, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_system_error_event(text, text, integer, text, text, text, text, timestamptz) to service_role;

insert into public.system_error_events (
  dedupe_key,
  handler,
  http_status,
  title,
  message,
  link,
  occurrence_count,
  first_seen_at,
  last_seen_at
)
select
  'bootstrap:outstanding-buyer-invoices:last-error',
  'outstandingBuyerInvoicesEmailReport',
  500,
  'Outstanding buyer invoices report failed',
  'The most recent internal outstanding buyer invoices report failed. The cause has been corrected; review the report before retrying.',
  '/payment-collections?tab=collections',
  1,
  coalesce(settings.updated_at, now()),
  coalesce(settings.updated_at, now())
from public.buyer_invoice_email_settings settings
where settings.id = 'default'
  and nullif(btrim(settings.last_error), '') is not null
on conflict (dedupe_key) do nothing;
