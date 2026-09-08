begin;

-- Browser authentication needs only these existing RLS-filtered catalogue and
-- own-profile reads. Supabase's historical default grants also left TRUNCATE,
-- TRIGGER and REFERENCES, none of which are part of the browser contract.
revoke all on table public.app_modules, public.user_profiles,
  public.user_module_permissions, public.user_types,
  public.user_type_module_permissions, public.admin_audit_logs
from public, anon, authenticated;

grant select on table public.app_modules, public.user_profiles,
  public.user_module_permissions, public.user_types,
  public.user_type_module_permissions to authenticated;

-- These are internal key/trigger helpers, not browser RPC endpoints.
revoke all on function public.collaboration_item_key(),
  public.variable_charge_side_confirmation_immutable(),
  public.variable_charge_side_state_before_update()
from public, anon, authenticated;
grant execute on function public.collaboration_item_key(),
  public.variable_charge_side_confirmation_immutable(),
  public.variable_charge_side_state_before_update() to service_role;

-- Leave all RLS policies, service-role permissions, identities and business
-- records unchanged. No user is activated and no financial data is modified.
commit;
