insert into public.app_modules (id, label, path, sort_order) values
  ('report_archive_manage', 'Reports Archive Management', '/report-archive', 76)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select
  user_types.id,
  'report_archive_manage',
  coalesce(report_archive_permissions.can_view, false)
from public.user_types
left join public.user_type_module_permissions report_archive_permissions
  on report_archive_permissions.user_type_id = user_types.id
  and report_archive_permissions.module_id = 'report_archive'
on conflict (user_type_id, module_id) do nothing;
