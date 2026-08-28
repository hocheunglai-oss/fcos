create table if not exists public.dashboard_ai_settings (
  id text primary key default 'default'
    check (id = 'default'),
  model_id text not null default 'gpt-5-mini-2025-08-07'
    check (model_id in (
      'gpt-4o-mini-2024-07-18',
      'gpt-5-mini-2025-08-07',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-sol'
    )),
  revision bigint not null default 1
    check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

insert into public.dashboard_ai_settings (id, model_id)
values ('default', 'gpt-5-mini-2025-08-07')
on conflict (id) do nothing;

alter table public.dashboard_ai_settings enable row level security;

revoke all on table public.dashboard_ai_settings from anon, authenticated;
grant all on table public.dashboard_ai_settings to service_role;
