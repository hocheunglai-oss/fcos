-- Exact diagnostic-only160 child from completed59f. No history/row changes,
-- provider/caller capability, Production authority or old UNKNOWN resolution.
begin;
set local lock_timeout='5s';
do $install$
declare c fcos_release_coordination.control%rowtype;t record;n bigint;pristine boolean;
begin
 if session_user<>'postgres' then raise exception 'COORDINATION_DIAGNOSTIC_OPERATOR';end if;
 select * into c from fcos_release_coordination.control where singleton for update;
 -- Lock the existing finite private journal inventory before observing emptiness
 -- or quiescence. The control lock serializes all supported writer entrypoints.
 for t in select relname from pg_class where relnamespace='fcos_release_coordination'::regnamespace and relkind in ('r','p') order by relname::text collate "C" loop
  execute format('lock table fcos_release_coordination.%I in share row exclusive mode',t.relname);
 end loop;
 pristine:=c.epoch is null and c.mode is not distinct from 'frozen';
 if pristine then
  for t in select relname from pg_class where relnamespace='fcos_release_coordination'::regnamespace and relkind in ('r','p') and relname<>'control' loop
   execute format('select count(*) from fcos_release_coordination.%I',t.relname) into n;
   if n<>0 then pristine:=false;exit;end if;
  end loop;
 end if;
 if c.singleton is distinct from true or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or c.plan_completion_id is not null or c.source_upgrade_id is not null
  or not (pristine or (c.epoch is not distinct from 1 and c.mode is not distinct from 'qualification'
   and fcos_release_coordination.qualification_source_upgrade_quiescent()
   and not fcos_release_coordination.exact_preview_admin_open() and not fcos_release_coordination.qualification_source_upgrade_guard_open()
   and not exists(select 1 from fcos_release_coordination.qualification_source_upgrades u where not exists(select 1 from fcos_release_coordination.qualification_source_upgrade_milestones m where m.operation_id=u.operation_id and m.milestone='dispatch_recorded'))))
 then raise exception 'COORDINATION_DIAGNOSTIC_IN_USE';end if;
end $install$;

-- Integrity projection only. Actual completed parent, registration/containments,
-- reviews, source publication and unchanged provider observations remain required
-- by the existing validator/operator; this function grants no authority.
create function fcos_release_coordination.qualification_source_upgrade_diagnostic_transition(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare old jsonb:=p->'previous'; r jsonb:=p->'setup'->'firstRuntimeBaseline'; prior jsonb:=old->'setup'->'firstRuntimeBaseline';
 v jsonb; ov jsonb; review jsonb; oldreview jsonb; scope jsonb; candidate jsonb; previous jsonb;
begin
 if p->'parent' is distinct from '{"kind":"source_upgrade","operationId":"qualification-source-upgrade-epoch1-archive-f0bb486474d3-ec69968da3c3-v1","proofSha256":"59f5197e182e471363f6a33a28f2f7398a3aa626b337a1bb17fb5a0595ba7b23","releaseId":"fcos-qualification-f0bb486474d3-2ef733d1-archive","manifestHash":"748af73c92e40459fc5d46e2cb65edd7676b3593e8d2b53b3bdf010be788a908"}'::jsonb
  or auth_maintenance_hash(old->'setup') is distinct from 'e7da38e499cf8b12ec8d5f3d9a381cc2a18938558308c2877a83763a15a53cf9'
  or auth_maintenance_hash(old->'plan') is distinct from '625f711a7b6de8d973b8d233910ec352d74463752eaf3181c5b5a9f8e6a2286c'
  or auth_maintenance_hash(old->'manifest') is distinct from '748af73c92e40459fc5d46e2cb65edd7676b3593e8d2b53b3bdf010be788a908'
  or auth_maintenance_hash(p->'previousPolicy') is distinct from 'acaebd6b75b28103a09ed8b52b95445801b5ee578664f7148e9710b92c17e2f1'
  or auth_maintenance_hash(p->'previousCheckerManifest') is distinct from '12a0e17a8f1b36616f2b16668f42d70bda5741655fe163b2a17d0fd8bec40172'
  or p->'checkerManifest' is distinct from p->'previousCheckerManifest'
  or p->'setup'->'qualificationSource'->>'candidateSha' is distinct from '160edcccc3347596ac18bb5c9dcb34ecc26df02b'
  or p->'plan'->>'sourceProfile' is distinct from 'compat_source_diagnostics_20261023'
  or p->'plan'->>'branch' is distinct from 'codex/hosted-release-consolidation-20261017'
  or p->'manifest'->'controller'->>'checkManifestSha256' is distinct from '08a078ad2ccf8a93322d5f54a3099113f57291f9066bbd0719f1f7a24446fa1c'
  or not auth_maintenance_object(r,array['json','sha256','acceptance']) or not auth_maintenance_object(r->'acceptance',array['json','sha256'])
  or jsonb_typeof(r->'json') is distinct from 'string' or octet_length(r->>'json')>49152
  or jsonb_typeof(r->'acceptance'->'json') is distinct from 'string' or octet_length(r->'acceptance'->>'json')>8192
  or encode(sha256(convert_to(r->>'json','UTF8')),'hex') is distinct from r->>'sha256'
  or encode(sha256(convert_to(r->'acceptance'->>'json','UTF8')),'hex') is distinct from r->'acceptance'->>'sha256'
 then return false;end if;
 v:=(r->>'json')::jsonb;ov:=(prior->>'json')::jsonb;review:=(r->'acceptance'->>'json')::jsonb;oldreview:=(prior->'acceptance'->>'json')::jsonb;
 scope:=jsonb_build_object('kind','previous-runtime-endpoint-absent-typed-v2','candidateSha','160edcccc3347596ac18bb5c9dcb34ecc26df02b','sourceProfile','compat_source_diagnostics_20261023','previous',ov->'previous','desiredRuntimeSha256',auth_maintenance_hash(ov->'desiredRuntime'),'existingUi',false,'handoffs','[]'::jsonb,'rollbackEligible',false);
 candidate:=(old->'manifest'->'candidate')||'{"sha":"160edcccc3347596ac18bb5c9dcb34ecc26df02b","sourceProfile":"compat_source_diagnostics_20261023","sourceSha256":"9f8b01198784d1e222f96f726207ef9c980f9ab5d2536e7a156ca97b2f307912","sourceInputsSha256":"a6bc646c45bdc92232cebb0f85fbb6a5104222aaf0493fba8ec03ebf79c73c0c","branch":"codex/hosted-release-consolidation-20261017"}'::jsonb;
 previous:=jsonb_set(old->'manifest'->'previousProduction','{firstRuntime}',(old->'manifest'->'previousProduction'->'firstRuntime')||jsonb_build_object('candidateSha','160edcccc3347596ac18bb5c9dcb34ecc26df02b','baselineSha256',r->>'sha256'));
 return coalesce(ov->'schemaVersion'='2'::jsonb and ov->>'kind'='fcos_first_runtime_baseline_v2'
  and ov->>'candidateSha'='2ef733d17dd12314c72971c2220b2b09903a6bf0' and ov->>'candidateSourceProfile'='compat_source_config_20261020'
  and v=ov||'{"candidateSha":"160edcccc3347596ac18bb5c9dcb34ecc26df02b","candidateSourceProfile":"compat_source_diagnostics_20261023"}'::jsonb
  and review->>'kind'='fcos_root_accepted_first_runtime_baseline_v2' and review->'accepted'='true'::jsonb and review->>'reviewerId'='/root'
  and jsonb_typeof(review->'reviewedAt')='string' and isfinite((review->>'reviewedAt')::timestamptz)
  and (review->>'reviewedAt')::timestamptz<=statement_timestamp() and (review->>'reviewedAt')::timestamptz>=(oldreview->>'reviewedAt')::timestamptz
  and review-'reviewedAt'=(oldreview-'reviewedAt')||jsonb_build_object('baselineSha256',r->>'sha256','firstCutoverException',(oldreview->'firstCutoverException')||jsonb_build_object('scopeSha256',auth_maintenance_hash(scope)))
  and old->'manifest'->'candidate'->>'sha'='2ef733d17dd12314c72971c2220b2b09903a6bf0'
  and candidate->>'lockSha256'='9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378'
  and candidate->>'configurationSha256'='331e9f360dd8fa0f9e1e2cafb8f0d5f50ecf26e2ac76323972e9bb7ff742a866'
  and candidate->>'salesforceSourceSha256'='4c2594c9986269e492487448d402334f43db35b06cb9c409377e728482739c64'
  and p->'manifest'->'candidate'=candidate and p->'manifest'->'previousProduction'=previous,false);
exception when others then return false;
end $$;
alter function fcos_release_coordination.qualification_source_upgrade_diagnostic_transition(jsonb) owner to fcos_coordinator_owner;
revoke all on function fcos_release_coordination.qualification_source_upgrade_diagnostic_transition(jsonb) from public,anon,authenticated,service_role,fcos_coordinator_runtime;
grant execute on function fcos_release_coordination.qualification_source_upgrade_diagnostic_transition(jsonb) to postgres;
do $patch$
declare target regprocedure:='fcos_release_coordination.qualification_source_upgrade_actions(jsonb)'::regprocedure;definition text;identity_before jsonb;identity_after jsonb;p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=target;
 if encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from 'add56c334d97ac2b1cf6c5c71b8e8aa894ce4dd0ea2d56f14918de6ce5dd229f'
  or p.proowner<>'fcos_coordinator_owner'::regrole or p.prosecdef
  or p.proconfig is distinct from array['search_path=pg_catalog, fcos_release_coordination']
  or p.proacl is distinct from '{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}'::aclitem[]
 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'namespace',pronamespace,'name',proname,'arguments',proargtypes::text,'returns',prorettype,'language',prolang,'volatility',provolatile,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof) into identity_before from pg_proc where oid=target;
 definition:=pg_get_functiondef(target);
 if array_length(string_to_array(definition,$needle$'candidate_sha','2ef733d17dd12314c72971c2220b2b09903a6bf0'$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$'candidate_sha','2ef733d17dd12314c72971c2220b2b09903a6bf0'$needle$,$replacement$'candidate_sha',p->'setup'->'qualificationSource'->>'candidateSha'$replacement$);
 execute definition;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'namespace',pronamespace,'name',proname,'arguments',proargtypes::text,'returns',prorettype,'language',prolang,'volatility',provolatile,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof) into identity_after from pg_proc where oid=target;
 if identity_after is distinct from identity_before or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target) is distinct from 'ea3e3b3ad53e2f6d3382279dd4c74b4b2ee2e90df523b8af67a339f21390f765'
 then raise exception 'COORDINATION_DIAGNOSTIC_IDENTITY_DRIFT';end if;
end $patch$;
do $patch$
declare target regprocedure:='fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure;definition text;identity_before jsonb;identity_after jsonb;p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=target;
 if encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from '8de7a701a9d12396749d1c9d13e73d9c11bcea7eb1fa5aab9b80619e0f73d84c'
  or p.proowner<>'fcos_coordinator_owner'::regrole or p.prosecdef
  or p.proconfig is distinct from array['search_path=pg_catalog, fcos_release_coordination']
  or p.proacl is distinct from '{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}'::aclitem[]
 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'namespace',pronamespace,'name',proname,'arguments',proargtypes::text,'returns',prorettype,'language',prolang,'volatility',provolatile,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof) into identity_before from pg_proc where oid=target;
 definition:=pg_get_functiondef(target);
 if array_length(string_to_array(definition,$needle$bytes bytea;$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$bytes bytea;$needle$,$replacement$bytes bytea; diagnostic boolean:=qualification_source_upgrade_diagnostic_transition(p);$replacement$);
 if array_length(string_to_array(definition,$needle$q->>'candidateSha' is distinct from '2ef733d17dd12314c72971c2220b2b09903a6bf0'$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$q->>'candidateSha' is distinct from '2ef733d17dd12314c72971c2220b2b09903a6bf0'$needle$,$replacement$q->>'candidateSha' is distinct from (case when diagnostic then '160edcccc3347596ac18bb5c9dcb34ecc26df02b' else '2ef733d17dd12314c72971c2220b2b09903a6bf0' end)$replacement$);
 if array_length(string_to_array(definition,$needle$case when exact_preview_quarantine_transport_change(p) then jsonb_set(p->'setup'$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$case when exact_preview_quarantine_transport_change(p) then jsonb_set(p->'setup'$needle$,$replacement$case when diagnostic then jsonb_set(p->'setup','{firstRuntimeBaseline}',old->'setup'->'firstRuntimeBaseline') when exact_preview_quarantine_transport_change(p) then jsonb_set(p->'setup'$replacement$);
 if array_length(string_to_array(definition,$needle$((p->'plan')-'releaseId')$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$((p->'plan')-'releaseId')$needle$,$replacement$((case when diagnostic then (p->'plan')||jsonb_build_object('sourceProfile',old->'plan'->'sourceProfile','branch',old->'plan'->'branch') else p->'plan' end)-'releaseId')$replacement$);
 if array_length(string_to_array(definition,$needle$((p->'manifest'->'controller')-'sha')$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$((p->'manifest'->'controller')-'sha')$needle$,$replacement$((case when diagnostic then (p->'manifest'->'controller')||jsonb_build_object('checkManifestSha256',old->'manifest'->'controller'->'checkManifestSha256') else p->'manifest'->'controller' end)-'sha')$replacement$);
 if array_length(string_to_array(definition,$needle$case when exact_preview_quarantine_transport_change(p) then jsonb_set(p->'manifest'$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$case when exact_preview_quarantine_transport_change(p) then jsonb_set(p->'manifest'$needle$,$replacement$case when diagnostic then (p->'manifest')||jsonb_build_object('candidate',old->'manifest'->'candidate','previousProduction',old->'manifest'->'previousProduction') when exact_preview_quarantine_transport_change(p) then jsonb_set(p->'manifest'$replacement$);
 if array_length(string_to_array(definition,$needle$ if p->'policy' is distinct from$needle$),1)<>2 then raise exception 'COORDINATION_DIAGNOSTIC_SOURCE_DRIFT';end if;
 definition:=replace(definition,$needle$ if p->'policy' is distinct from$needle$,$replacement$ if diagnostic then a:=a||jsonb_build_object('candidateSha',q->>'candidateSha');end if;
 if p->'policy' is distinct from$replacement$);
 execute definition;
 select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'namespace',pronamespace,'name',proname,'arguments',proargtypes::text,'returns',prorettype,'language',prolang,'volatility',provolatile,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof) into identity_after from pg_proc where oid=target;
 if identity_after is distinct from identity_before or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target) is distinct from 'daff7572e47dc8ad6d4874d05160a70a651aa7c6c893a9f463e1a504e5b8fe50'
 then raise exception 'COORDINATION_DIAGNOSTIC_IDENTITY_DRIFT';end if;
end $patch$;
commit;
