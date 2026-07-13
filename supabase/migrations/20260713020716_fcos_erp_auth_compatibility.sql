create or replace view public.fcos_user_access
with (security_invoker = true)
as
select
  profile.id,
  profile.email,
  profile.display_name as full_name,
  case
    when bool_or(role.role::text = 'administrator') then 'administrator'
    when bool_or(role.role::text = 'trader') then 'manager'
    when bool_or(role.role::text = 'finance') then 'finance'
    when bool_or(role.role::text = 'operations') then 'operations'
    else 'viewer'
  end as user_type,
  profile.active,
  true as use_type_defaults
from erp.user_profiles profile
left join erp.user_office_roles role on role.user_id = profile.id
group by profile.id, profile.email, profile.display_name, profile.active;

revoke all on public.fcos_user_access from public, anon, authenticated;
grant usage on schema erp to service_role;
grant select on erp.user_profiles, erp.user_office_roles to service_role;
grant select on public.fcos_user_access to service_role;

comment on view public.fcos_user_access is
  'Service-role-only compatibility projection from ERP office roles to FCOS module roles.';
