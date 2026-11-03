-- Preserve the installed source-upgrade migration; correct only its unused
-- policy request builder to the documented, previously observed PATCH route.
-- https://vercel.com/docs/rest-api/projects/edit-an-environment-variable
begin;
set local lock_timeout = '5s';
do $$
declare
 c fcos_release_coordination.control%rowtype;
 target regprocedure := 'fcos_release_coordination.qualification_source_upgrade_actions(jsonb)'::regprocedure;
 definition text;
 before_identity jsonb;
 after_identity jsonb;
begin
 select * into c from fcos_release_coordination.control where singleton for update;
 if c.singleton is distinct from true or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or c.plan_completion_id is not null or c.source_upgrade_id is not null
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrades)
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrade_intents)
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrade_events)
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrade_milestones)
  or exists(select 1 from fcos_release_coordination.operations o where
   (select state from fcos_release_coordination.operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete')
 then raise exception 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_IN_USE';end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target)
  is distinct from '38b957806955cfe6b191d61169c9ffd2a5cd118ff2f96570cd53cad1d3963ec2'
 then raise exception 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_SOURCE_DRIFT';end if;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef)
  into before_identity from pg_proc where oid=target;
 definition:=pg_get_functiondef(target);
 if array_length(string_to_array(definition,'/v10/projects/'),1)<>2
 then raise exception 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_SOURCE_DRIFT';end if;
 execute replace(definition,'/v10/projects/','/v9/projects/');
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target)
  is distinct from 'add56c334d97ac2b1cf6c5c71b8e8aa894ce4dd0ea2d56f14918de6ce5dd229f'
 then raise exception 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_SOURCE_DRIFT';end if;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef)
  into after_identity from pg_proc where oid=target;
 if after_identity is distinct from before_identity
 then raise exception 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_IDENTITY_CHANGED';end if;
end $$;
commit;
