-- Trigger helpers do not need to be callable through the Data API. PostgreSQL
-- grants function execution to PUBLIC by default, so revoke that implicit
-- browser-facing access explicitly while retaining service-role diagnostics.

revoke all on function public.ship_agent_charge_case_before_update() from public, anon, authenticated;
revoke all on function public.ship_agent_charge_confirmation_immutable() from public, anon, authenticated;
revoke all on function public.ship_agent_charge_event_protect() from public, anon, authenticated;
revoke all on function public.ship_agent_charge_operation_before_update() from public, anon, authenticated;
revoke all on function public.ship_agent_charge_notification_before_update() from public, anon, authenticated;

grant execute on function public.ship_agent_charge_case_before_update() to service_role;
grant execute on function public.ship_agent_charge_confirmation_immutable() to service_role;
grant execute on function public.ship_agent_charge_event_protect() to service_role;
grant execute on function public.ship_agent_charge_operation_before_update() to service_role;
grant execute on function public.ship_agent_charge_notification_before_update() to service_role;
