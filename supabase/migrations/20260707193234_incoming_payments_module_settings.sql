insert into public.app_modules (id, label, path, sort_order) values
  ('incoming_payments', 'Incoming Payment', '/incoming-payments', 45)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order;

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'incoming_payments', true
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table if not exists public.incoming_payment_settings (
  id text primary key default 'default',
  fully_paid_threshold numeric(18, 2) not null default 50,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

insert into public.incoming_payment_settings (id, fully_paid_threshold)
values ('default', 50)
on conflict (id) do nothing;

alter table public.incoming_payment_settings enable row level security;

revoke all on table public.incoming_payment_settings from anon, authenticated;
grant all on table public.incoming_payment_settings to service_role;
