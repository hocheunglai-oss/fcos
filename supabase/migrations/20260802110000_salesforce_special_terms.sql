begin;

insert into public.app_modules (id, label, path, sort_order) values
  ('markets', 'Markets', '/markets', 86),
  ('special_terms', 'Special Terms', '/special-terms', 87),
  ('hedge_desk', 'Hedge Desk', '/hedge-desk', 88),
  ('special_terms_manage', 'Manage Special Terms', '/special-terms', 187)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'special_terms', true
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = true,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'special_terms', true
from public.user_profiles
where use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = true,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'special_terms_manage', id in ('general_manager', 'administrator', 'manager', 'operations')
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select profile.id, 'special_terms_manage', profile.user_type in ('general_manager', 'administrator', 'manager', 'operations')
from public.user_profiles profile
where profile.use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table if not exists public.special_terms_operations (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null unique check (char_length(operation_id) between 1 and 100),
  operation_type text not null check (operation_type in (
    'term_create',
    'term_update',
    'term_delete',
    'rule_create',
    'rule_update',
    'rule_delete'
  )),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  operation_status text not null default 'pending' check (operation_status in ('pending', 'succeeded', 'failed', 'uncertain')),
  salesforce_object text not null check (salesforce_object in ('Special_Term__c', 'Special_Term_Rule__c')),
  salesforce_record_id text null check (salesforce_record_id is null or salesforce_record_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  audit_reason text null check (audit_reason is null or char_length(audit_reason) <= 500),
  result_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(result_snapshot) = 'object'),
  error_code text null,
  error_message text null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists special_terms_operations_status_idx
on public.special_terms_operations(operation_status, updated_at desc);

create index if not exists special_terms_operations_actor_idx
on public.special_terms_operations(actor_user_id, created_at desc);

alter table public.special_terms_operations enable row level security;
revoke all on table public.special_terms_operations from anon, authenticated;
grant all on table public.special_terms_operations to service_role;

commit;
