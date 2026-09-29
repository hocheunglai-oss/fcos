begin;

-- Production defaults may grant ALL to service_role on new public tables.
-- Reset inherited table ACLs before granting the intended operation set.
revoke all on table
  public.permission_groups,
  public.user_permission_groups,
  public.permission_access_events,
  public.permission_access_migration_snapshots,
  public.permission_access_catalog
from service_role;

grant select, insert, update, delete on table
  public.permission_groups, public.user_permission_groups
to service_role;
grant select, insert on table public.permission_access_events to service_role;
grant select on table
  public.permission_access_migration_snapshots, public.permission_access_catalog
to service_role;

commit;
