insert into public.user_types (id, label, description, is_system, sort_order) values
  ('interoffice', 'Interoffice', 'Finance-style access with FRATELLI COSULICH buyer-group STEMs excluded from Salesforce data.', true, 45)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  is_system = excluded.is_system,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view) values
  ('interoffice', 'dashboard', true),
  ('interoffice', 'review', true),
  ('interoffice', 'disputes', true),
  ('interoffice', 'buyer_invoices', true),
  ('interoffice', 'incoming_payments', true),
  ('interoffice', 'cashflow_forecast', true),
  ('interoffice', 'pnl', true),
  ('interoffice', 'brokers', true),
  ('interoffice', 'report_archive', false),
  ('interoffice', 'settings', false),
  ('interoffice', 'admin', false)
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view) values
  ('interoffice', 'report_archive_manage', false)
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();
