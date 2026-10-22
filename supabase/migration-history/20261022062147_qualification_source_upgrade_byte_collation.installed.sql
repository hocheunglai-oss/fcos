-- Forward-only correction for the unused source-upgrade validator.
-- The reviewed17 paths use byte order in JavaScript and immutable manifests.
-- Preserve both installed migrations, proof bytes, journals and function identity.
begin;
set local lock_timeout = '5s';
do $forward$
declare
 c fcos_release_coordination.control%rowtype;
 target regprocedure := 'fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure;
 definition text;
 before_identity jsonb;
 after_identity jsonb;
 needle text := $needle$(p->'checkerManifest'->(i-1)->>'path')>=(a->>'path')$needle$;
 replacement text := $replacement$(p->'checkerManifest'->(i-1)->>'path') collate "C" >= (a->>'path') collate "C"$replacement$;
begin
 select * into c from fcos_release_coordination.control where singleton for update;
 lock table fcos_release_coordination.qualification_source_upgrades,
  fcos_release_coordination.qualification_source_upgrade_intents,
  fcos_release_coordination.qualification_source_upgrade_events,
  fcos_release_coordination.qualification_source_upgrade_milestones in share row exclusive mode;
 if c.singleton is distinct from true or c.epoch is distinct from 1 or c.mode is distinct from 'qualification'
  or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or c.plan_completion_id is not null or c.source_upgrade_id is not null
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrades)
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrade_intents)
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrade_events)
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrade_milestones)
  or exists(select 1 from fcos_release_coordination.operations o where
   (select state from fcos_release_coordination.operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete')
 then raise exception 'COORDINATION_SOURCE_UPGRADE_COLLATION_IN_USE';end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target)
  is distinct from '0f9cd5b2d7b60c84a819c1f25befc11bdaafacf289c8f93acb6585476dd66f6f'
 then raise exception 'COORDINATION_SOURCE_UPGRADE_COLLATION_SOURCE_DRIFT';end if;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,
  'definer',prosecdef,'namespace',pronamespace,'name',proname,'arguments',proargtypes::text,
  'returns',prorettype,'language',prolang,'volatility',provolatile,'strict',proisstrict,
  'parallel',proparallel,'leakproof',proleakproof) into before_identity from pg_proc where oid=target;
 definition:=pg_get_functiondef(target);
 if array_length(string_to_array(definition,needle),1)<>2
 then raise exception 'COORDINATION_SOURCE_UPGRADE_COLLATION_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target)
  is distinct from '49a99f98998859e8c62665ced11a09698830a3e9eec6d1239af7dd1911f45bda'
 then raise exception 'COORDINATION_SOURCE_UPGRADE_COLLATION_SOURCE_DRIFT';end if;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,
  'definer',prosecdef,'namespace',pronamespace,'name',proname,'arguments',proargtypes::text,
  'returns',prorettype,'language',prolang,'volatility',provolatile,'strict',proisstrict,
  'parallel',proparallel,'leakproof',proleakproof) into after_identity from pg_proc where oid=target;
 if after_identity is distinct from before_identity
 then raise exception 'COORDINATION_SOURCE_UPGRADE_COLLATION_IDENTITY_CHANGED';end if;
end $forward$;
commit;
