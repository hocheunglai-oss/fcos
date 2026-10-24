-- Operator-reviewed, append-only source-only qualification upgrades.
-- This migration never resolves original uncertainty or resets consumed journals.
begin;
create table fcos_release_coordination.qualification_source_upgrades(
 operation_id text primary key check(operation_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
 epoch bigint not null references fcos_release_coordination.epochs,
 release_id text not null unique,manifest_hash text not null unique,
 proof jsonb not null,proof_sha256 text not null,admitted_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.qualification_source_upgrade_intents(
 operation_id text not null references fcos_release_coordination.qualification_source_upgrades,
 action_id text not null,ordinal int not null check(ordinal between 1 and 6),
 request jsonb not null,request_sha256 text not null,ready jsonb,intended_at timestamptz not null default clock_timestamp(),
 primary key(operation_id,action_id),unique(operation_id,ordinal));
create table fcos_release_coordination.qualification_source_upgrade_events(
 event_id bigint generated always as identity primary key,operation_id text not null,action_id text not null,
 evidence jsonb not null,evidence_sha256 text not null,recorded_at timestamptz not null default clock_timestamp(),
 unique(operation_id,action_id),foreign key(operation_id,action_id) references fcos_release_coordination.qualification_source_upgrade_intents);
create table fcos_release_coordination.qualification_source_upgrade_milestones(
 operation_id text not null references fcos_release_coordination.qualification_source_upgrades,
 milestone text not null check(milestone in ('configuration_ready','dispatch_recorded')),
 closure jsonb not null,closure_sha256 text not null,recorded_at timestamptz not null default clock_timestamp(),primary key(operation_id,milestone));
alter table fcos_release_coordination.control add column source_upgrade_id text references fcos_release_coordination.qualification_source_upgrades;
alter table fcos_release_coordination.control add constraint coordination_source_upgrade_one_writer
 check(source_upgrade_id is null or operation_id is null and bootstrap_id is null and recovery_id is null and plan_completion_id is null);

create function fcos_release_coordination.qualification_source_upgrade_actions(p jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,fcos_release_coordination as $$
 select jsonb_build_array(
 jsonb_build_object('id','policy_patch','request',jsonb_build_object('method','PATCH','route','/v10/projects/'||(p->'preservation'->'project'->>'id')||'/env/'||(p->>'policyRowId')||'?teamId='||(p->'preservation'->'team'->>'id'),'body',jsonb_build_object('value',auth_maintenance_canonical(p->'policy')))),
 jsonb_build_object('id','checker_deploy','request',jsonb_build_object('method','POST','route','/v13/deployments?teamId='||(p->'preservation'->'team'->>'id')||'&forceNew=0','body',jsonb_build_object('name',p->'preservation'->'project'->>'name','project',p->'preservation'->'project'->>'id','files',p->'checkerFiles','meta',jsonb_build_object('fcosSourceUpgrade',p->>'operationId','fcosCoordinatorBundle',auth_maintenance_hash(p->'checkerManifest'))))),
 jsonb_build_object('id','url_patch','request',jsonb_build_object('method','PATCH','route','/repos/'||(p->'previousPolicy'->>'repository')||'/actions/variables/FCOS_HOSTED_COORDINATOR_URL','body',jsonb_build_object('name','FCOS_HOSTED_COORDINATOR_URL','value','$OWNED_READY_COORDINATOR_URL'))),
 jsonb_build_object('id','setup_patch','request',jsonb_build_object('method','PATCH','route','/repos/'||(p->'previousPolicy'->>'repository')||'/actions/variables/FCOS_ADMITTED_RELEASE_SETUP','body',jsonb_build_object('name','FCOS_ADMITTED_RELEASE_SETUP','value',auth_maintenance_canonical(p->'setup')))),
 jsonb_build_object('id','setup_hash_patch','request',jsonb_build_object('method','PATCH','route','/repos/'||(p->'previousPolicy'->>'repository')||'/actions/variables/FCOS_ADMITTED_RELEASE_SETUP_SHA256','body',jsonb_build_object('name','FCOS_ADMITTED_RELEASE_SETUP_SHA256','value',p->>'setupSha256'))),
 jsonb_build_object('id','dispatch','request',jsonb_build_object('method','POST','route','/repos/'||(p->'previousPolicy'->>'repository')||'/actions/workflows/authenticated-release.yml/dispatches','body',jsonb_build_object('ref',substr((p->'setup')->'qualificationSource'->>'ref',12),'inputs',jsonb_build_object('bootstrap_phase','qualification','candidate_sha','2ef733d17dd12314c72971c2220b2b09903a6bf0','plan',auth_maintenance_canonical(p->'plan'),'xero_recovery_mode','disabled')))))
$$;

-- The authenticated operator verifies actual review/source/owner observations.
-- Labels and hashes here provide integrity, never human or provider attestation.
create function fcos_release_coordination.qualification_source_upgrade_proof_valid(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare old jsonb:=p->'previous'; q jsonb:=p->'setup'->'qualificationSource'; a jsonb; b jsonb; f jsonb; cp qualification_plan_completions%rowtype; parent qualification_source_upgrades%rowtype; r registrations%rowtype; base cutover_bootstraps%rowtype; item jsonb; k text; i int; bytes bytea;
begin
 if not auth_maintenance_object(p,array['schemaVersion','kind','epoch','operationId','parent','previous','previousRegistrationSha256','previousConfiguration','previousCheckerManifest','previousPolicy','setup','setupSha256','plan','planSha256','manifest','manifestSha256','checkerManifest','checkerFiles','policyRowId','policy','preservation','sourcePreflight','ownerReadbackSha256','actions','rootReview','independentReview'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'kind' is distinct from 'fcos_qualification_source_upgrade_v1' or p->'epoch' is distinct from '1'::jsonb
  or coalesce(p->>'operationId','') !~ '^[A-Za-z0-9._:-]{1,200}$'
  or not auth_maintenance_object(p->'parent',array['kind','operationId','proofSha256','releaseId','manifestHash'])
  or not auth_maintenance_object(old,array['setup','plan','manifest'])
  or auth_maintenance_hash(p->'preservation') is distinct from '65e4ba8e5387183da21216a24d25a28eee552977722c7dd5059b6e0b92221d40'
  or p->>'policyRowId' is distinct from '5Rl6tmYklkODNosl'
  or p->'previousConfiguration'->>'projectId' is distinct from p->'preservation'->'project'->>'id'
  or p->'previousConfiguration'->>'teamId' is distinct from p->'preservation'->'team'->>'id'
  or p->'previousConfiguration'->>'setupSha256' is distinct from auth_maintenance_hash(old->'setup')
  or p->'previousConfiguration'->>'policySha256' is distinct from auth_maintenance_hash(p->'previousPolicy')
 then return false; end if;
 select * into r from registrations where release_id=p->'parent'->>'releaseId';
 if r.release_id is null or r.epoch<>1 or r.manifest is distinct from old->'manifest' or r.manifest_hash is distinct from p->'parent'->>'manifestHash'
  or auth_maintenance_hash(to_jsonb(r)) is distinct from p->>'previousRegistrationSha256' or not legacy_release_registration_valid(r)
  or r.owner is distinct from '{"kind":"release","id":"features"}'::jsonb
  or r.manifest_hash is distinct from auth_maintenance_hash(old->'manifest') or r.release_id is distinct from old->'plan'->>'releaseId'
 then return false; end if;
 if p->'parent'->>'kind'='plan_completion' then
  select * into cp from qualification_plan_completions where operation_id=p->'parent'->>'operationId';
  if cp.operation_id is distinct from 'qualification-plan-completion-epoch1-39672498844-v1'
   or cp.proof_sha256 is distinct from '19f1a84e420bee5c6e4bd5b1b82b3e6524df5365f596db4c0671a0feb7be10ba'
   or cp.proof_sha256 is distinct from p->'parent'->>'proofSha256' or not qualification_plan_completion_proof_valid(cp.proof)
   or not exists(select 1 from qualification_plan_completion_finishes where operation_id=cp.operation_id and proof_sha256=cp.proof_sha256)
   or old->'plan' is distinct from cp.proof->'plan' or old->'setup' is distinct from (select proof->'setup' from qualification_schema_recoveries where recovery_id=cp.previous_recovery_id)
   or r.manifest_hash is distinct from 'e73dcbc3a6e4a75646218d6652dccbc7b422409d3faee7d52268cb67681b8e41'
   or auth_maintenance_hash(p->'previousConfiguration') is distinct from 'f3f95b92a0ec6e512bef2558efd82f4ebca0bfd3d0aeba2c6e2d02e5194dc935'
   or auth_maintenance_hash(p->'previousCheckerManifest') is distinct from '0e16a88f0ee5417c533c6dcf16bca6586b5a80cd5d5c09440eede6c9ca914d4f'
   or auth_maintenance_hash(p->'previousPolicy') is distinct from '5775ea59999f87e2198c415f1827f5816e458debf4aab69a7c6f9a70af9beb2d'
  then return false; end if;
 elsif p->'parent'->>'kind'='source_upgrade' then
  select * into parent from qualification_source_upgrades where operation_id=p->'parent'->>'operationId';
  if parent.operation_id is null or parent.operation_id=p->>'operationId' or parent.proof_sha256 is distinct from p->'parent'->>'proofSha256'
   or parent.release_id is distinct from r.release_id or parent.manifest_hash is distinct from r.manifest_hash
   or old is distinct from jsonb_build_object('setup',parent.proof->'setup','plan',parent.proof->'plan','manifest',parent.proof->'manifest')
   or p->'previousPolicy' is distinct from parent.proof->'policy' or p->'previousCheckerManifest' is distinct from parent.proof->'checkerManifest'
   or not exists(select 1 from qualification_source_upgrade_milestones m where m.operation_id=parent.operation_id and milestone='dispatch_recorded')
   or p->'previousConfiguration' is distinct from (select closure from qualification_source_upgrade_milestones m where m.operation_id=parent.operation_id and milestone='configuration_ready')
   or not qualification_source_upgrade_proof_valid(parent.proof)
  then return false; end if;
 else return false; end if;
 select * into base from cutover_bootstraps where epoch=1;
 if not cutover_bootstrap_proof_valid(base.proof) then return false;end if;
 for item in select value from jsonb_array_elements(base.proof->'containmentProofs') loop
  if not exists(select 1 from legacy_release_containments a where a.epoch=1 and a.release_id=r.release_id and a.manifest_hash=r.manifest_hash and a.import_id=item->>'importId' and a.proof=item and a.controller_sha=r.manifest->'controller'->>'sha' and a.setup_sha256=r.manifest->>'setupSha256')
   or exists(select 1 from legacy_release_containment_revocations v where v.epoch=1 and v.manifest_hash=r.manifest_hash and v.import_id=item->>'importId') then return false;end if;
 end loop;
 if not auth_maintenance_object(q,array['ref','bootstrapSha','callerWorkflowRef','controllerSha','candidateSha'])
  or coalesce(q->>'ref','') !~ '^refs/heads/codex/[A-Za-z0-9][A-Za-z0-9._/-]{0,170}$' or q->>'ref' ~ '\.\.|//|/$|\.lock$'
  or q->>'ref' is not distinct from old->'setup'->'qualificationSource'->>'ref'
  or coalesce(q->>'bootstrapSha','') !~ '^[a-f0-9]{40}$' or coalesce(q->>'controllerSha','') !~ '^[a-f0-9]{40}$'
  or q->>'controllerSha' is not distinct from old->'setup'->>'controllerSha' or q->>'candidateSha' is distinct from '2ef733d17dd12314c72971c2220b2b09903a6bf0'
  or q->>'callerWorkflowRef' is distinct from (p->'previousPolicy'->>'repository')||'/.github/workflows/authenticated-release.yml@'||(q->>'ref')
  or p->'setup'->>'controllerSha' is distinct from q->>'controllerSha' or p->'setup'->'epoch' is distinct from '1'::jsonb
  or p->'setupSha256' is distinct from to_jsonb(auth_maintenance_hash(p->'setup'))
  or ((p->'setup')-'controllerSha'-'qualificationSource') is distinct from ((old->'setup')-'controllerSha'-'qualificationSource')
  or ((p->'plan')-'releaseId') is distinct from ((old->'plan')-'releaseId')
  or p->'plan'->>'releaseId' is not distinct from old->'plan'->>'releaseId' or coalesce((p->'plan')->>'releaseId','') !~ '^[A-Za-z0-9._:-]{1,200}$'
  or auth_maintenance_hash(p->'plan') is distinct from p->>'planSha256'
  or p->'plan'->>'stage' is distinct from 'qualification' or p->'plan'->>'executionMode' is distinct from 'qualification'
  or p->'plan'->'scope'->'financialAuthority' is distinct from 'false'::jsonb or p->'plan'->'migration'->>'mode' is distinct from 'none'
  or p->'plan'->'migration'->>'expectedSchemaSha256' is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'
  or p->>'manifestSha256' is distinct from auth_maintenance_hash(p->'manifest')
  or p->'manifest'->>'releaseId' is distinct from p->'plan'->>'releaseId' or p->'manifest'->>'setupSha256' is distinct from p->>'setupSha256'
  or p->'manifest'->'qualificationSource' is distinct from q or p->'manifest'->'controller'->>'sha' is distinct from q->>'controllerSha'
  or ((p->'manifest'->'controller')-'sha') is distinct from ((old->'manifest'->'controller')-'sha')
  or ((p->'manifest')-'releaseId'-'setupSha256'-'qualificationSource'-'controller') is distinct from ((old->'manifest')-'releaseId'-'setupSha256'-'qualificationSource'-'controller')
 then return false; end if;
 a:=p->'previousPolicy'->'qualificationAdmission'||jsonb_build_object('ref',q->>'ref','bootstrapSha',q->>'bootstrapSha','callerWorkflowSha',q->>'bootstrapSha','callerWorkflowRef',q->>'callerWorkflowRef','jobWorkflowSha',q->>'controllerSha','jobWorkflowRef',(p->'previousPolicy'->>'repository')||'/.github/workflows/hosted-release-controller.yml@'||(q->>'controllerSha'),'setupSha256',p->>'setupSha256');
 if p->'policy' is distinct from (p->'previousPolicy'||jsonb_build_object('qualificationAdmission',a))
  or jsonb_array_length(p->'checkerManifest')<>17 or jsonb_array_length(p->'previousCheckerManifest')<>17 or jsonb_array_length(p->'checkerFiles')<>17 then return false; end if;
 for i in 0..16 loop
  a:=p->'checkerManifest'->i;b:=p->'previousCheckerManifest'->i;f:=p->'checkerFiles'->i;
  if not auth_maintenance_object(a,array['path','sha256','byteLength']) or coalesce(a->>'sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(a->'byteLength') is distinct from 'number' or (a->>'byteLength')::numeric<>trunc((a->>'byteLength')::numeric) or (a->>'byteLength')::numeric<=0
   or a->>'path' is distinct from b->>'path' or (i>0 and (p->'checkerManifest'->(i-1)->>'path')>=(a->>'path'))
   or (a->>'path'<>'supabase/functions/release-coordinator/approval.mjs' and a is distinct from b)
   or not auth_maintenance_object(f,array['file','encoding','data']) or f->>'file' is distinct from a->>'path' or f->>'encoding' is distinct from 'base64'
  then return false; end if;
  bytes:=decode(f->>'data','base64');
  if replace(encode(bytes,'base64'),E'\n','') is distinct from f->>'data' or octet_length(bytes)::text is distinct from a->>'byteLength' or encode(sha256(bytes),'hex') is distinct from a->>'sha256' then return false; end if;
 end loop;
 f:=p->'sourcePreflight';
 if not auth_maintenance_object(f,array['accepted','complete','controllerSha','callerSha','setupSha256','planSha256','manifestSha256','sourceEvidenceSha256'])
  or f->'accepted' is distinct from 'true'::jsonb or f->'complete' is distinct from 'true'::jsonb
  or f->>'controllerSha' is distinct from q->>'controllerSha' or f->>'callerSha' is distinct from q->>'bootstrapSha'
  or f->>'setupSha256' is distinct from p->>'setupSha256' or f->>'planSha256' is distinct from p->>'planSha256' or f->>'manifestSha256' is distinct from p->>'manifestSha256'
  or coalesce(f->>'sourceEvidenceSha256','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'ownerReadbackSha256','') !~ '^[a-f0-9]{64}$'
  or p->'actions' is distinct from qualification_source_upgrade_actions(p) then return false; end if;
 foreach k in array array['rootReview','independentReview'] loop
  f:=p->k;
  if not auth_maintenance_object(f,array['kind','role','reviewerId','accepted','subjectSha256','sourceEvidenceSha256','reviewedAt'])
   or f->>'kind' is distinct from 'fcos_qualification_source_upgrade_review_v1' or f->'accepted' is distinct from 'true'::jsonb
   or f->>'role' is distinct from (case when k='rootReview' then 'root' else 'independent' end)
   or f->>'reviewerId' is distinct from (case when k='rootReview' then '/root' else '/root/coordinator_config_native' end)
   or jsonb_typeof(f->'reviewedAt') is distinct from 'string' or jsonb_typeof(f->'sourceEvidenceSha256') is distinct from 'string'
   or f->>'subjectSha256' is distinct from auth_maintenance_hash(p-'rootReview'-'independentReview') or coalesce(f->>'sourceEvidenceSha256','') !~ '^[a-f0-9]{64}$'
  then return false; end if;
  if not isfinite((f->>'reviewedAt')::timestamptz) or (f->>'reviewedAt')::timestamptz>statement_timestamp()+interval '30 seconds' then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
alter table fcos_release_coordination.qualification_source_upgrades add constraint source_upgrade_proof_valid
 check(epoch=1 and epoch::text=proof->>'epoch' and operation_id=proof->>'operationId' and fcos_release_coordination.qualification_source_upgrade_proof_valid(proof) and proof_sha256=fcos_release_coordination.auth_maintenance_hash(proof) and release_id=proof->'plan'->>'releaseId' and manifest_hash=proof->>'manifestSha256');

create function fcos_release_coordination.qualification_source_upgrade_ready_valid(p jsonb,r jsonb,kind text,fresh boolean default true) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare ack jsonb;
begin
 select evidence->'response' into ack from qualification_source_upgrade_events where operation_id=p->>'operationId' and action_id='checker_deploy';
 return coalesce(auth_maintenance_object(r,array['kind','accepted','operationId','proofSha256','projectId','teamId','deploymentId','coordinatorUrl','policySha256','setupSha256','checkerManifestSha256','preservationSha256','sourceEvidenceSha256','rootReviewSha256','independentReviewSha256','observedAt'])
  and r->>'kind'=kind and r->'accepted'='true'::jsonb and r->>'operationId'=p->>'operationId' and r->>'proofSha256'=auth_maintenance_hash(p)
  and r->>'projectId'=p->'preservation'->'project'->>'id' and r->>'teamId'=p->'preservation'->'team'->>'id'
  and r->>'deploymentId'=ack->>'deploymentId' and r->>'coordinatorUrl'=ack->>'coordinatorUrl'
  and r->>'policySha256'=auth_maintenance_hash(p->'policy') and r->>'setupSha256'=p->>'setupSha256'
  and r->>'checkerManifestSha256'=auth_maintenance_hash(p->'checkerManifest') and r->>'preservationSha256'=auth_maintenance_hash(p->'preservation')
  and r->>'sourceEvidenceSha256' ~ '^[a-f0-9]{64}$' and r->>'rootReviewSha256' ~ '^[a-f0-9]{64}$' and r->>'independentReviewSha256' ~ '^[a-f0-9]{64}$'
  and jsonb_typeof(r->'observedAt')='string' and isfinite((r->>'observedAt')::timestamptz)
  and (r->>'observedAt')::timestamptz<=statement_timestamp()+interval '30 seconds'
  and (not fresh or (r->>'observedAt')::timestamptz>=statement_timestamp()-interval '120 seconds'),false);
exception when others then return false;
end $$;
create function fcos_release_coordination.qualification_source_upgrade_quiescent() returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select coalesce((select epoch=1 and mode='qualification' and operation_id is null and bootstrap_id is null and recovery_id is null and plan_completion_id is null from control where singleton),false)
 and not exists(select 1 from operations o where (select state from operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete')
 and not exists(select 1 from auth_maintenance_fences f left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null)
$$;
create function fcos_release_coordination.admit_qualification_source_upgrade(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;a qualification_source_upgrades%rowtype;
begin
 select * into c from control where singleton for update;
 select * into a from qualification_source_upgrades where operation_id=p->>'operationId';
 if a.operation_id is not null then
  if a.proof is distinct from p then raise exception 'COORDINATION_SOURCE_UPGRADE_CONFLICT';end if;
  return jsonb_build_object('disposition','readback','operationId',a.operation_id,'proofSha256',a.proof_sha256);
 end if;
 if qualification_schema_recovery_catalog_digest() is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d' then raise exception 'COORDINATION_SOURCE_UPGRADE_LIVE_SCHEMA_CHANGED';end if;
 if not qualification_source_upgrade_proof_valid(p) or not qualification_source_upgrade_quiescent() or c.source_upgrade_id is not null
  or exists(select 1 from qualification_source_upgrades x where not exists(select 1 from qualification_source_upgrade_milestones m where m.operation_id=x.operation_id and milestone='dispatch_recorded'))
  or (p->'parent'->>'kind'='plan_completion' and exists(select 1 from qualification_source_upgrades))
  or (p->'parent'->>'kind'='source_upgrade' and p->'parent'->>'operationId' is distinct from (select operation_id from qualification_source_upgrade_milestones where milestone='configuration_ready' order by recorded_at desc,operation_id desc limit 1))
  or exists(select 1 from registrations r where r.epoch=1 and r.release_id<>p->'parent'->>'releaseId' and r.manifest_hash<>'e73dcbc3a6e4a75646218d6652dccbc7b422409d3faee7d52268cb67681b8e41' and not exists(select 1 from qualification_source_upgrades x where x.release_id=r.release_id and x.manifest_hash=r.manifest_hash))
 then raise exception 'COORDINATION_SOURCE_UPGRADE_ADMISSION_INVALID';end if;
 insert into qualification_source_upgrades values(p->>'operationId',1,p->'plan'->>'releaseId',p->>'manifestSha256',p,auth_maintenance_hash(p),clock_timestamp());
 update control set source_upgrade_id=p->>'operationId' where singleton;
 return jsonb_build_object('disposition','admitted','operationId',p->>'operationId','proofSha256',auth_maintenance_hash(p),'epoch',1,'providerAuthorityGranted',false);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_snapshot(id text,proof_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrades%rowtype;
begin
 select * into a from qualification_source_upgrades where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SOURCE_UPGRADE_BINDING_CHANGED';end if;
 return jsonb_build_object('upgrade',to_jsonb(a),'control',(select to_jsonb(c) from control c where singleton),
  'intents',coalesce((select jsonb_agg(to_jsonb(i) order by ordinal) from qualification_source_upgrade_intents i where operation_id=id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by event_id) from qualification_source_upgrade_events e where operation_id=id),'[]'::jsonb),
  'milestones',coalesce((select jsonb_agg(to_jsonb(m) order by recorded_at,milestone) from qualification_source_upgrade_milestones m where operation_id=id),'[]'::jsonb));
end $$;
create function fcos_release_coordination.qualification_source_upgrade_intent_valid(id text,action text,ord int,r jsonb,ready jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrades%rowtype;expected jsonb;
begin
 select * into a from qualification_source_upgrades where operation_id=id;
 expected:=a.proof->'actions'->(ord-1);
 if expected->>'id' is distinct from action or ord not between 1 and 6 or not qualification_source_upgrade_proof_valid(a.proof) then return false;end if;
 if ord=3 then
  if not qualification_source_upgrade_ready_valid(a.proof,ready,'fcos_qualification_source_upgrade_ready_v1',false) then return false;end if;
  -- Freshness is checked when making a NEW intent; append-only row integrity
  -- remains valid after the observation naturally ages.
  expected:=jsonb_set(expected,'{request,body,value}',ready->'coordinatorUrl',false);
 elsif ready is not null then return false;end if;
 return expected->'request'=r;
exception when others then return false;
end $$;
alter table fcos_release_coordination.qualification_source_upgrade_intents add constraint source_upgrade_exact_request
 check(fcos_release_coordination.qualification_source_upgrade_intent_valid(operation_id,action_id,ordinal,request,ready) and request_sha256=fcos_release_coordination.auth_maintenance_hash(request));
create function fcos_release_coordination.qualification_source_upgrade_intent(id text,action_id text,proof_hash text,ready jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;a qualification_source_upgrades%rowtype;i qualification_source_upgrade_intents%rowtype;ord int;r jsonb;
begin
 select * into c from control where singleton for update;select * into a from qualification_source_upgrades where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SOURCE_UPGRADE_BINDING_CHANGED';end if;
 select * into i from qualification_source_upgrade_intents x where x.operation_id=id and x.action_id=qualification_source_upgrade_intent.action_id;
 if i.operation_id is not null then return jsonb_build_object('disposition','readback','operationId',id,'actionId',action_id,'proofSha256',proof_hash,'request',i.request,'requestSha256',i.request_sha256,'epoch',1);end if;
 if qualification_schema_recovery_catalog_digest() is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d' then raise exception 'COORDINATION_SOURCE_UPGRADE_LIVE_SCHEMA_CHANGED';end if;
 select n::int into ord from jsonb_array_elements(a.proof->'actions') with ordinality x(v,n) where v->>'id'=action_id;
 if ord is null or not qualification_source_upgrade_proof_valid(a.proof) or not qualification_source_upgrade_quiescent()
  or (ord<=5 and c.source_upgrade_id is distinct from id) or (ord=6 and (c.source_upgrade_id is not null or not exists(select 1 from qualification_source_upgrade_milestones where operation_id=id and milestone='configuration_ready')))
  or exists(select 1 from qualification_source_upgrade_intents x where x.operation_id=id and x.ordinal>=ord)
  or (select count(*) from qualification_source_upgrade_events e join qualification_source_upgrade_intents x using(operation_id,action_id) where e.operation_id=id and x.ordinal<ord)<>ord-1
 then raise exception 'COORDINATION_SOURCE_UPGRADE_NOT_HELD_OR_UNRESOLVED';end if;
 r:=a.proof->'actions'->(ord-1)->'request';
 if ord=3 then
  if not qualification_source_upgrade_ready_valid(a.proof,ready,'fcos_qualification_source_upgrade_ready_v1') then raise exception 'COORDINATION_SOURCE_UPGRADE_READY_REQUIRED';end if;
  r:=jsonb_set(r,'{body,value}',ready->'coordinatorUrl',false);
 elsif ready is not null then raise exception 'COORDINATION_SOURCE_UPGRADE_READY_UNEXPECTED';end if;
 insert into qualification_source_upgrade_intents values(id,action_id,ord,r,auth_maintenance_hash(r),ready,clock_timestamp()) returning * into i;
 return jsonb_build_object('disposition','execute','operationId',id,'actionId',action_id,'proofSha256',proof_hash,'request',r,'requestSha256',i.request_sha256,'epoch',1);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_ack_valid(id text,action text,e jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrades%rowtype;i qualification_source_upgrade_intents%rowtype;r jsonb;
begin
 select * into a from qualification_source_upgrades where operation_id=id;select * into i from qualification_source_upgrade_intents where operation_id=id and action_id=action;
 if i.operation_id is null or not auth_maintenance_object(e,array['basis','outcome','requestSha256','providerEvidenceSha256','rootReviewSha256','response'])
  or e->>'basis' is distinct from 'native_ack' or e->>'outcome' is distinct from 'applied' or e->>'requestSha256' is distinct from i.request_sha256
  or e->>'rootReviewSha256' is distinct from auth_maintenance_hash(a.proof->'rootReview') or e->>'providerEvidenceSha256' is distinct from auth_maintenance_hash(e->'response') then return false;end if;
 r:=e->'response';
 if action='checker_deploy' then return coalesce(auth_maintenance_object(r,array['completed','status','exitCode','bodyEmpty','deploymentId','coordinatorUrl'])
  and r->'completed'='true'::jsonb and r->'status'='200'::jsonb and r->'exitCode'='0'::jsonb and r->'bodyEmpty'='false'::jsonb
  and r->>'deploymentId' ~ '^dpl_[A-Za-z0-9]{10,80}$' and r->>'coordinatorUrl' ~ '^https://[a-z0-9-]+\.vercel\.app/coordinate$',false);end if;
 return r=jsonb_build_object('completed',true,'status',case when action='policy_patch' then 200 else 204 end,'exitCode',0,'bodyEmpty',action<>'policy_patch');
exception when others then return false;
end $$;
alter table fcos_release_coordination.qualification_source_upgrade_events add constraint source_upgrade_known_ack
 check(fcos_release_coordination.qualification_source_upgrade_ack_valid(operation_id,action_id,evidence) and evidence_sha256=fcos_release_coordination.auth_maintenance_hash(evidence));
create function fcos_release_coordination.record_qualification_source_upgrade(id text,action_id text,proof_hash text,evidence jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;a qualification_source_upgrades%rowtype;e qualification_source_upgrade_events%rowtype;ord int;
begin
 select * into c from control where singleton for update;select * into a from qualification_source_upgrades where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash or not qualification_source_upgrade_ack_valid(id,action_id,evidence) then raise exception 'COORDINATION_SOURCE_UPGRADE_KNOWN_ACK_REQUIRED';end if;
 select * into e from qualification_source_upgrade_events x where x.operation_id=id and x.action_id=record_qualification_source_upgrade.action_id;
 if e.operation_id is not null then
  if e.evidence is distinct from evidence then raise exception 'COORDINATION_SOURCE_UPGRADE_TERMINAL';end if;
  return jsonb_build_object('disposition','readback','state','applied');end if;
 select ordinal into ord from qualification_source_upgrade_intents x where x.operation_id=id and x.action_id=record_qualification_source_upgrade.action_id;
 if c.epoch<>1 or c.mode<>'qualification' or (ord<=5 and (c.source_upgrade_id is distinct from id or not qualification_source_upgrade_quiescent()))
  or (ord=6 and not exists(select 1 from qualification_source_upgrade_milestones where operation_id=id and milestone='configuration_ready'))
 then raise exception 'COORDINATION_SOURCE_UPGRADE_NOT_HELD';end if;
 -- Dispatch ACK recording must remain possible if the authenticated runner
 -- already registered/claimed after the durable dispatch INTENT.
 insert into qualification_source_upgrade_events(operation_id,action_id,evidence,evidence_sha256) values(id,action_id,evidence,auth_maintenance_hash(evidence));
 return jsonb_build_object('disposition','recorded','state','applied');
end $$;
create function fcos_release_coordination.finish_qualification_source_upgrade_configuration(id text,proof_hash text,closure jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;a qualification_source_upgrades%rowtype;prior jsonb;
begin
 select * into c from control where singleton for update;select * into a from qualification_source_upgrades where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SOURCE_UPGRADE_BINDING_CHANGED';end if;
 select m.closure into prior from qualification_source_upgrade_milestones m where operation_id=id and milestone='configuration_ready';
 if prior is not null then
  if prior is distinct from closure then raise exception 'COORDINATION_SOURCE_UPGRADE_TERMINAL';end if;
  return jsonb_build_object('disposition','complete','stage','configuration');end if;
 if c.source_upgrade_id is distinct from id or not qualification_source_upgrade_quiescent() or not qualification_source_upgrade_proof_valid(a.proof)
  or (select count(*) from qualification_source_upgrade_events where operation_id=id)<>5
  or not qualification_source_upgrade_ready_valid(a.proof,closure,'fcos_qualification_source_upgrade_configuration_v1')
  or closure->>'coordinatorUrl' is distinct from (select request->'body'->>'value' from qualification_source_upgrade_intents where operation_id=id and action_id='url_patch')
 then raise exception 'COORDINATION_SOURCE_UPGRADE_CONFIGURATION_UNRESOLVED';end if;
 insert into qualification_source_upgrade_milestones values(id,'configuration_ready',closure,auth_maintenance_hash(closure),clock_timestamp());
 update control set source_upgrade_id=null where singleton;
 return jsonb_build_object('disposition','complete','stage','configuration','operationId',id,'epoch',1);
end $$;
create function fcos_release_coordination.finish_qualification_source_upgrade_dispatch(id text,proof_hash text,closure jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrades%rowtype;prior jsonb;
begin
 perform 1 from control where singleton for update;select * into a from qualification_source_upgrades where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SOURCE_UPGRADE_BINDING_CHANGED';end if;
 select m.closure into prior from qualification_source_upgrade_milestones m where operation_id=id and milestone='dispatch_recorded';
 if prior is not null then
  if prior is distinct from closure then raise exception 'COORDINATION_SOURCE_UPGRADE_TERMINAL';end if;
  return jsonb_build_object('disposition','complete','stage','dispatch');end if;
 if not auth_maintenance_object(closure,array['kind','accepted','operationId','proofSha256','requestSha256','providerEvidenceSha256','sourceEvidenceSha256'])
  or closure->>'kind' is distinct from 'fcos_qualification_source_upgrade_dispatch_v1' or closure->'accepted' is distinct from 'true'::jsonb
  or closure->>'operationId' is distinct from id or closure->>'proofSha256' is distinct from proof_hash or coalesce(closure->>'sourceEvidenceSha256','') !~ '^[a-f0-9]{64}$'
  or not exists(select 1 from qualification_source_upgrade_events e join qualification_source_upgrade_intents i using(operation_id,action_id) where e.operation_id=id and action_id='dispatch' and i.request_sha256=closure->>'requestSha256' and e.evidence->>'providerEvidenceSha256'=closure->>'providerEvidenceSha256')
 then raise exception 'COORDINATION_SOURCE_UPGRADE_DISPATCH_UNRESOLVED';end if;
 insert into qualification_source_upgrade_milestones values(id,'dispatch_recorded',closure,auth_maintenance_hash(closure),clock_timestamp());
 return jsonb_build_object('disposition','complete','stage','dispatch','operationId',id,'epoch',1);
end $$;

create function fcos_release_coordination.qualification_source_upgrade_principal(p jsonb,a jsonb) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select coalesce(a->>'kind'='github' and a->'qualificationOnly'='true'::jsonb and a->>'runAttempt'='1' and a->>'runId' ~ '^[1-9][0-9]*$'
  and a->>'repositoryId'=p->'previousPolicy'->>'repositoryId'
  and a->>'actorId'=(select proof->>'operatorId' from cutover_bootstraps where epoch=1)
  and a->>'actor'=(select proof->>'operatorLogin' from cutover_bootstraps where epoch=1)
  and a->>'ref'=p->'setup'->'qualificationSource'->>'ref'
  and a->>'sha'=p->'setup'->'qualificationSource'->>'bootstrapSha' and a->>'workflowSha'=a->>'sha'
  and a->>'workflowRef'=p->'setup'->'qualificationSource'->>'callerWorkflowRef'
  and a->>'jobWorkflowSha'=p->'setup'->>'controllerSha'
  and a->>'jobWorkflowRef'=(p->'previousPolicy'->>'repository')||'/.github/workflows/hosted-release-controller.yml@'||((p->'setup')->>'controllerSha')
  and a->'qualificationAdmission'=p->'policy'->'qualificationAdmission',false)
$$;
create function fcos_release_coordination.qualification_source_upgrade_started(id text) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select exists(select 1 from qualification_source_upgrade_milestones where operation_id=id and milestone='configuration_ready')
 and exists(select 1 from qualification_source_upgrade_intents where operation_id=id and action_id='dispatch')
 and (select source_upgrade_id is null and bootstrap_id is null and recovery_id is null and plan_completion_id is null and epoch=1 and mode='qualification' from control where singleton)
$$;
create function fcos_release_coordination.qualification_source_upgrade_claim_ready(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare u qualification_source_upgrades%rowtype;r registrations%rowtype;b cutover_bootstraps%rowtype;cp jsonb;a legacy_release_containments%rowtype;
begin
 select * into u from qualification_source_upgrades where release_id=p->>'releaseId' and manifest_hash=p->>'manifestHash';
 select * into r from registrations where release_id=p->>'releaseId';select * into b from cutover_bootstraps where epoch=1;
 if u.operation_id is null or not qualification_source_upgrade_started(u.operation_id) or not qualification_source_upgrade_proof_valid(u.proof)
  or r.manifest is distinct from u.proof->'manifest' or r.manifest_hash is distinct from u.manifest_hash or r.owner is distinct from p->'owner'
  or r.owner is distinct from '{"kind":"release","id":"features"}'::jsonb or r.epoch<>1 or not legacy_release_registration_valid(r)
  or not qualification_source_upgrade_principal(u.proof,r.registration_actor)
  or not cutover_bootstrap_proof_valid(b.proof)
 then return false;end if;
 for cp in select value from jsonb_array_elements(b.proof->'containmentProofs') loop
  select * into a from legacy_release_containments where epoch=1 and manifest_hash=r.manifest_hash and import_id=cp->>'importId';
  if a.import_id is null or a.release_id is distinct from r.release_id or a.proof is distinct from cp
   or a.controller_sha is distinct from u.proof->'setup'->>'controllerSha' or a.setup_sha256 is distinct from u.proof->>'setupSha256'
   or exists(select 1 from legacy_release_containment_revocations v where v.epoch=a.epoch and v.manifest_hash=a.manifest_hash and v.import_id=a.import_id)
  then return false;end if;
 end loop;
 return true;
end $$;
create function fcos_release_coordination.qualification_source_upgrade_pending(action text,p jsonb,principal jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare u qualification_source_upgrades%rowtype;m jsonb;
begin
 select * into u from qualification_source_upgrades where release_id=p->>'releaseId' and manifest_hash=p->>'manifestHash';
 if u.operation_id is null or not qualification_source_upgrade_proof_valid(u.proof) or not qualification_source_upgrade_principal(u.proof,principal)
  or p->'epoch' is distinct from '1'::jsonb or p->'owner' is distinct from '{"kind":"release","id":"features"}'::jsonb then return false;end if;
 if action='register' then m:=p->'manifest';
 elsif action in ('begin','claim') and not exists(select 1 from operations x where x.release_id=p->>'releaseId' and x.phase=p->>'phase') then
  select manifest into m from registrations where release_id=p->>'releaseId';
 else return false;end if;
 if m is distinct from u.proof->'manifest' then return false;end if;
 return not qualification_source_upgrade_started(u.operation_id);
end $$;

-- Called only after genuine generic registration AND registration_runs insertion.
-- Any rejection rolls back that registration and BOTH new containment rows.
create function fcos_release_coordination.qualification_source_upgrade_after_register(p jsonb,principal jsonb) returns void
language plpgsql set search_path=pg_catalog,fcos_release_coordination as $$
declare u qualification_source_upgrades%rowtype;r registrations%rowtype;b cutover_bootstraps%rowtype;cp jsonb;a legacy_release_containments%rowtype;n int;
begin
 select * into u from qualification_source_upgrades where release_id=p->>'releaseId';
 if u.operation_id is null then
  -- Preserve the original controller/manifest path; arbitrary new sources cannot
  -- register via a regex/default branch when no exact admission exists.
  if principal->'qualificationOnly'='true'::jsonb and principal->>'jobWorkflowSha' is distinct from (select proof->>'controllerSha' from cutover_bootstraps where epoch=1)
  then raise exception 'COORDINATION_SOURCE_UPGRADE_NOT_ADMITTED';end if;
  return;
 end if;
 select * into r from registrations where release_id=u.release_id;select * into b from cutover_bootstraps where epoch=1;
 if not qualification_source_upgrade_started(u.operation_id) or not qualification_source_upgrade_proof_valid(u.proof)
  or not qualification_source_upgrade_principal(u.proof,principal) or p->'epoch' is distinct from '1'::jsonb
  or r.owner is distinct from '{"kind":"release","id":"features"}'::jsonb or p->'owner' is distinct from r.owner
  or r.manifest is distinct from u.proof->'manifest' or p->'manifest' is distinct from r.manifest or r.manifest_hash is distinct from u.manifest_hash or p->>'manifestHash' is distinct from u.manifest_hash
  or not legacy_release_registration_valid(r) or not cutover_bootstrap_proof_valid(b.proof)
  or not exists(select 1 from registration_runs x where x.release_id=r.release_id and x.run_id=principal->>'runId' and x.run_attempt='1' and x.actor=principal)
 then raise exception 'COORDINATION_SOURCE_UPGRADE_REGISTRATION_INVALID';end if;
 select count(*) into n from legacy_release_containments where epoch=1 and manifest_hash=r.manifest_hash;
 if n not in (0,2) then raise exception 'COORDINATION_SOURCE_UPGRADE_PARTIAL_CONTAINMENT';end if;
 for cp in select value from jsonb_array_elements(b.proof->'containmentProofs') loop
  if exists(select 1 from legacy_release_containment_revocations where epoch=1 and manifest_hash=r.manifest_hash and import_id=cp->>'importId') then raise exception 'COORDINATION_SOURCE_UPGRADE_CONTAINMENT_REVOKED';end if;
  if n=0 then perform admit_legacy_release_containment(r.release_id,cp);
  else
   select * into a from legacy_release_containments where epoch=1 and manifest_hash=r.manifest_hash and import_id=cp->>'importId';
   if a.import_id is null or a.release_id is distinct from r.release_id or a.proof is distinct from cp
    or a.controller_sha is distinct from u.proof->'setup'->>'controllerSha' or a.setup_sha256 is distinct from u.proof->>'setupSha256'
   then raise exception 'COORDINATION_SOURCE_UPGRADE_CONTAINMENT_CONFLICT';end if;
  end if;
 end loop;
 if not qualification_source_upgrade_claim_ready(p) then raise exception 'COORDINATION_SOURCE_UPGRADE_CONTAINMENT_INVALID';end if;
end $$;

-- Direct operator inserts must satisfy the same static evidence boundary.
-- Freshness is evaluated at the transition, never as an expiring historical row.
create function fcos_release_coordination.qualification_source_upgrade_milestone_valid(id text,stage text,c jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrades%rowtype;
begin
 select * into a from qualification_source_upgrades where operation_id=id;
 if a.operation_id is null or not qualification_source_upgrade_proof_valid(a.proof) then return false;end if;
 if stage='configuration_ready' then return qualification_source_upgrade_ready_valid(a.proof,c,'fcos_qualification_source_upgrade_configuration_v1',false)
  and (select count(*) from qualification_source_upgrade_events e join qualification_source_upgrade_intents i using(operation_id,action_id) where e.operation_id=id and i.ordinal<=5)=5
  and c->>'coordinatorUrl'=(select request->'body'->>'value' from qualification_source_upgrade_intents where operation_id=id and action_id='url_patch');end if;
 if stage='dispatch_recorded' then return coalesce(auth_maintenance_object(c,array['kind','accepted','operationId','proofSha256','requestSha256','providerEvidenceSha256','sourceEvidenceSha256'])
  and c->>'kind'='fcos_qualification_source_upgrade_dispatch_v1' and c->'accepted'='true'::jsonb and c->>'operationId'=id and c->>'proofSha256'=a.proof_sha256
  and c->>'sourceEvidenceSha256' ~ '^[a-f0-9]{64}$'
  and exists(select 1 from qualification_source_upgrade_milestones m where m.operation_id=id and milestone='configuration_ready')
  and exists(select 1 from qualification_source_upgrade_events e join qualification_source_upgrade_intents i using(operation_id,action_id) where e.operation_id=id and action_id='dispatch' and i.request_sha256=c->>'requestSha256' and e.evidence->>'providerEvidenceSha256'=c->>'providerEvidenceSha256'),false);end if;
 return false;
exception when others then return false;
end $$;
alter table fcos_release_coordination.qualification_source_upgrade_milestones add constraint source_upgrade_milestone_integrity
 check(fcos_release_coordination.qualification_source_upgrade_milestone_valid(operation_id,milestone,closure) and closure_sha256=fcos_release_coordination.auth_maintenance_hash(closure));

-- All five current installed bodies must match before ANY replacement. Capture
-- catalog identity/ACL/owner/security/search_path and assert retention afterward.
do $$ declare sig text;expected text;definition text;needle text;before jsonb;after jsonb;
begin
 select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) into before from pg_proc
 where oid=any(array['fcos_release_coordination.cutover_bootstrap_claim_ready(jsonb)'::regprocedure,'fcos_release_coordination.cutover_bootstrap_pending(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.install_epoch(bigint,jsonb)'::regprocedure,'fcos_release_coordination.activate(bigint,jsonb)'::regprocedure]::oid[]);
 for sig,expected in select * from (values
 ('cutover_bootstrap_claim_ready(jsonb)','01fdeea7a65920c17c0d0d6134756b4fc2e3cc10f2f5a4c927b48ce18d61493b'),
 ('cutover_bootstrap_pending(text,jsonb,jsonb)','8c29e825d41fe57df776b03998de15c63021908cc0a7aeb47f6951b8591b5d64'),
 ('dispatch(text,jsonb,jsonb)','2ee63f174ec5eb0661554a2d03755ccfee182585761da827232333bacba039f3'),
 ('install_epoch(bigint,jsonb)','faea2b7acc0f8ff90cb2157f2a88fe47504e10a572e646efc5d71eb3f40982c5'),
 ('activate(bigint,jsonb)','bb315f3ed0bd4f94e6f305ba88386a3ba887f67e16ed6b9d57376298807fe53e')) x loop
  if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=('fcos_release_coordination.'||sig)::regprocedure) is distinct from expected then raise exception 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT';end if;
 end loop;
 definition:=pg_get_functiondef('fcos_release_coordination.cutover_bootstrap_claim_ready(jsonb)'::regprocedure);
 needle:=' select * into r from registrations where release_id=p->>''releaseId'';';
 if position(needle in definition)=0 then raise exception 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,needle||E'\n if exists(select 1 from qualification_source_upgrades x where x.release_id=p->>\'releaseId\') then return qualification_source_upgrade_claim_ready(p);end if;');
 definition:=pg_get_functiondef('fcos_release_coordination.cutover_bootstrap_pending(text,jsonb,jsonb)'::regprocedure);
 needle:=' select * into c from control where singleton;';
 if position(needle in definition)=0 then raise exception 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,needle||E'\n if exists(select 1 from qualification_source_upgrades x where x.release_id=p->>\'releaseId\') then return qualification_source_upgrade_pending(action,p,principal);end if;');
 definition:=pg_get_functiondef('fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure);
 needle:=' select * into c from control where singleton for update;';
 if position(needle in definition)=0 then raise exception 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT';end if;
 definition:=replace(definition,needle,needle||E'\n if c.source_upgrade_id is not null and (action=\'register\' or action in (\'begin\',\'claim\') and not exists(select 1 from operations x where x.release_id=p->>\'releaseId\' and x.phase=p->>\'phase\')) then raise exception \'COORDINATION_BOOTSTRAP_BUSY\';end if;');
 needle:='  return dispatch_without_auth_maintenance(action,p,principal);';
 if position(needle in definition)=0 then raise exception 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,E'  result:=dispatch_without_auth_maintenance(action,p,principal);\n  if action=\'register\' then perform qualification_source_upgrade_after_register(p,principal);end if;\n  return result;');
 foreach sig in array array['install_epoch(bigint,jsonb)','activate(bigint,jsonb)'] loop
  definition:=pg_get_functiondef(('fcos_release_coordination.'||sig)::regprocedure);
  needle:='  select * into c from fcos_release_coordination.control where singleton for update;';
  if position(needle in definition)=0 then raise exception 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT';end if;
  execute replace(definition,needle,needle||E'\n  if c.source_upgrade_id is not null then raise exception \'COORDINATION_BOOTSTRAP_BUSY\';end if;');
 end loop;
 select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) into after from pg_proc
 where oid=any(array['fcos_release_coordination.cutover_bootstrap_claim_ready(jsonb)'::regprocedure,'fcos_release_coordination.cutover_bootstrap_pending(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.install_epoch(bigint,jsonb)'::regprocedure,'fcos_release_coordination.activate(bigint,jsonb)'::regprocedure]::oid[]);
 if before is distinct from after then raise exception 'COORDINATION_SOURCE_UPGRADE_IDENTITY_CHANGED';end if;
end $$;
do $$ declare t text;f regprocedure;begin
 foreach t in array array['qualification_source_upgrades','qualification_source_upgrade_intents','qualification_source_upgrade_events','qualification_source_upgrade_milestones'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on table fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime',t);
  execute format('create trigger source_upgrade_append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and
 (proname like 'qualification_source_upgrade_%' or proname in ('admit_qualification_source_upgrade','record_qualification_source_upgrade','finish_qualification_source_upgrade_configuration','finish_qualification_source_upgrade_dispatch')) loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f);
  execute format('grant execute on function %s to postgres',f);
 end loop;
end $$;
commit;
