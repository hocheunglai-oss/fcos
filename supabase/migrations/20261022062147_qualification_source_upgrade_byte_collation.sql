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
 -- The pristine branch must remain inert while all private histories are checked.
 if c.epoch is null and c.mode is not distinct from 'frozen' then
  lock table fcos_release_coordination.activations,
   fcos_release_coordination.approval_admissions,
   fcos_release_coordination.auth_maintenance_authorities,
   fcos_release_coordination.auth_maintenance_fences,
   fcos_release_coordination.auth_maintenance_occurrences,
   fcos_release_coordination.auth_maintenance_resolutions,
   fcos_release_coordination.auth_maintenance_revocations,
   fcos_release_coordination.auth_maintenance_saved_rotations,
   fcos_release_coordination.authorizations,
   fcos_release_coordination.cutover_bootstrap_actions,
   fcos_release_coordination.cutover_bootstrap_events,
   fcos_release_coordination.cutover_bootstrap_finishes,
   fcos_release_coordination.cutover_bootstraps,
   fcos_release_coordination.epochs,
   fcos_release_coordination.evidence,
   fcos_release_coordination.exact_7dc_publication_quarantine_revocations,
   fcos_release_coordination.exact_7dc_publication_quarantines,
   fcos_release_coordination.finishes,
   fcos_release_coordination.import_resolutions,
   fcos_release_coordination.imported_uncertainty,
   fcos_release_coordination.legacy_release_containment_revocations,
   fcos_release_coordination.legacy_release_containments,
   fcos_release_coordination.operation_events,
   fcos_release_coordination.operations,
   fcos_release_coordination.qualification_plan_completion_events,
   fcos_release_coordination.qualification_plan_completion_finishes,
   fcos_release_coordination.qualification_plan_completion_intents,
   fcos_release_coordination.qualification_plan_completions,
   fcos_release_coordination.qualification_schema_recoveries,
   fcos_release_coordination.qualification_schema_recovery_actions,
   fcos_release_coordination.qualification_schema_recovery_events,
   fcos_release_coordination.qualification_schema_recovery_finishes,
   fcos_release_coordination.qualification_source_upgrade_events,
   fcos_release_coordination.qualification_source_upgrade_intents,
   fcos_release_coordination.qualification_source_upgrade_milestones,
   fcos_release_coordination.qualification_source_upgrades,
   fcos_release_coordination.registration_runs,
   fcos_release_coordination.registrations,
   fcos_release_coordination.resume_admissions in share row exclusive mode;
 end if;
 if c.singleton is distinct from true or not (
  (c.epoch is not distinct from 1 and c.mode is not distinct from 'qualification')
  or (c.epoch is null and c.mode is not distinct from 'frozen'
   and (select array_agg(t.relname::text order by t.relname::text collate "C")
    from pg_catalog.pg_class t join pg_catalog.pg_namespace n on n.oid=t.relnamespace
    where n.nspname='fcos_release_coordination' and t.relkind in ('r','p'))
    is not distinct from array['activations','approval_admissions','auth_maintenance_authorities','auth_maintenance_fences','auth_maintenance_occurrences','auth_maintenance_resolutions','auth_maintenance_revocations','auth_maintenance_saved_rotations','authorizations','control','cutover_bootstrap_actions','cutover_bootstrap_events','cutover_bootstrap_finishes','cutover_bootstraps','epochs','evidence','exact_7dc_publication_quarantine_revocations','exact_7dc_publication_quarantines','finishes','import_resolutions','imported_uncertainty','legacy_release_containment_revocations','legacy_release_containments','operation_events','operations','qualification_plan_completion_events','qualification_plan_completion_finishes','qualification_plan_completion_intents','qualification_plan_completions','qualification_schema_recoveries','qualification_schema_recovery_actions','qualification_schema_recovery_events','qualification_schema_recovery_finishes','qualification_source_upgrade_events','qualification_source_upgrade_intents','qualification_source_upgrade_milestones','qualification_source_upgrades','registration_runs','registrations','resume_admissions']::text[]
   and not exists(select 1 from fcos_release_coordination.activations)
   and not exists(select 1 from fcos_release_coordination.approval_admissions)
   and not exists(select 1 from fcos_release_coordination.auth_maintenance_authorities)
   and not exists(select 1 from fcos_release_coordination.auth_maintenance_fences)
   and not exists(select 1 from fcos_release_coordination.auth_maintenance_occurrences)
   and not exists(select 1 from fcos_release_coordination.auth_maintenance_resolutions)
   and not exists(select 1 from fcos_release_coordination.auth_maintenance_revocations)
   and not exists(select 1 from fcos_release_coordination.auth_maintenance_saved_rotations)
   and not exists(select 1 from fcos_release_coordination.authorizations)
   and not exists(select 1 from fcos_release_coordination.cutover_bootstrap_actions)
   and not exists(select 1 from fcos_release_coordination.cutover_bootstrap_events)
   and not exists(select 1 from fcos_release_coordination.cutover_bootstrap_finishes)
   and not exists(select 1 from fcos_release_coordination.cutover_bootstraps)
   and not exists(select 1 from fcos_release_coordination.epochs)
   and not exists(select 1 from fcos_release_coordination.evidence)
   and not exists(select 1 from fcos_release_coordination.exact_7dc_publication_quarantine_revocations)
   and not exists(select 1 from fcos_release_coordination.exact_7dc_publication_quarantines)
   and not exists(select 1 from fcos_release_coordination.finishes)
   and not exists(select 1 from fcos_release_coordination.import_resolutions)
   and not exists(select 1 from fcos_release_coordination.imported_uncertainty)
   and not exists(select 1 from fcos_release_coordination.legacy_release_containment_revocations)
   and not exists(select 1 from fcos_release_coordination.legacy_release_containments)
   and not exists(select 1 from fcos_release_coordination.operation_events)
   and not exists(select 1 from fcos_release_coordination.operations)
   and not exists(select 1 from fcos_release_coordination.qualification_plan_completion_events)
   and not exists(select 1 from fcos_release_coordination.qualification_plan_completion_finishes)
   and not exists(select 1 from fcos_release_coordination.qualification_plan_completion_intents)
   and not exists(select 1 from fcos_release_coordination.qualification_plan_completions)
   and not exists(select 1 from fcos_release_coordination.qualification_schema_recoveries)
   and not exists(select 1 from fcos_release_coordination.qualification_schema_recovery_actions)
   and not exists(select 1 from fcos_release_coordination.qualification_schema_recovery_events)
   and not exists(select 1 from fcos_release_coordination.qualification_schema_recovery_finishes)
   and not exists(select 1 from fcos_release_coordination.qualification_source_upgrade_events)
   and not exists(select 1 from fcos_release_coordination.qualification_source_upgrade_intents)
   and not exists(select 1 from fcos_release_coordination.qualification_source_upgrade_milestones)
   and not exists(select 1 from fcos_release_coordination.qualification_source_upgrades)
   and not exists(select 1 from fcos_release_coordination.registration_runs)
   and not exists(select 1 from fcos_release_coordination.registrations)
   and not exists(select 1 from fcos_release_coordination.resume_admissions)
  )
 )
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
