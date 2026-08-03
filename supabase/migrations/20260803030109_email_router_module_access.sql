begin;

insert into public.app_modules (id, label, path, sort_order)
values ('email_router', 'Email Router', '/email-router', 89)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'email_router', true
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = true,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'email_router', true
from public.user_profiles
where use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = true,
  updated_at = now();

commit;
