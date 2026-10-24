begin;
-- Administrative handoff only. This is the SAME coordinator singleton, not a
-- release registration, provider credential, financial grant or expiring lease.
create table fcos_release_coordination.cutover_bootstraps(
 bootstrap_id text primary key, epoch bigint not null unique references fcos_release_coordination.epochs,
 proof jsonb not null, proof_sha256 text not null, admitted_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.cutover_bootstrap_actions(
 bootstrap_id text not null references fcos_release_coordination.cutover_bootstraps,
 action_id text not null, ordinal integer not null, request jsonb not null, request_sha256 text not null,
 intended_at timestamptz not null default clock_timestamp(), primary key(bootstrap_id,action_id),unique(bootstrap_id,ordinal));
create table fcos_release_coordination.cutover_bootstrap_events(
 event_id bigint generated always as identity primary key,
 bootstrap_id text not null, action_id text not null, state text not null check(state in ('applied','uncertain','not_applied')),
 evidence jsonb not null, evidence_sha256 text not null, recorded_at timestamptz not null default clock_timestamp(),
 foreign key(bootstrap_id,action_id) references fcos_release_coordination.cutover_bootstrap_actions);
create table fcos_release_coordination.cutover_bootstrap_finishes(
 bootstrap_id text primary key references fcos_release_coordination.cutover_bootstraps,
 proof_sha256 text not null, finished_at timestamptz not null default clock_timestamp());
alter table fcos_release_coordination.control add column bootstrap_id text references fcos_release_coordination.cutover_bootstraps;
alter table fcos_release_coordination.control add constraint coordination_one_writer check(operation_id is null or bootstrap_id is null);

create function fcos_release_coordination.cutover_bootstrap_proof_valid(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare a jsonb; s jsonb; q jsonb; cp jsonb; u imported_uncertainty%rowtype; effect jsonb; names text[]:='{}'; dispatches integer:=0;
begin
 if not auth_maintenance_object(p,array['schemaVersion','bootstrapId','epoch','ownerThreadId','repository','repositoryId','operatorId','operatorLogin',
  'controllerSha','bootstrapSha','ref','candidateSha','setup','setupSha256','plan','planSha256','sentinelSha256','inventorySha256',
  'rootReviewSha256','independentReviewSha256','containmentProofs','actions'])
  or p->'schemaVersion' is distinct from '1'::jsonb or coalesce(p->>'bootstrapId','') !~ '^[A-Za-z0-9._:-]{1,200}$'
  or p->>'ownerThreadId' is distinct from '01a0f08b-7fcb-7870-9edc-343e16052b62'
  or p->>'repository' is distinct from 'hocheunglai-oss/fcos' or p->>'repositoryId' is distinct from '1278654816'
  or p->>'operatorId' is distinct from '265701760' or p->>'operatorLogin' is distinct from 'hocheunglai-oss'
  or p->>'controllerSha' is distinct from '64aa338b04cee7e05bde0ca9bfd10b81ac001a65'
  or p->>'bootstrapSha' is distinct from '12bee4edb7fc459162efb6a35571731c8fe5beb5'
  or p->>'ref' is distinct from 'refs/heads/codex/hosted-qualification-dependency-setup-20261020'
  or p->>'candidateSha' is distinct from '2ef733d17dd12314c72971c2220b2b09903a6bf0'
  or jsonb_typeof(p->'epoch') is distinct from 'number' or coalesce(p->>'epoch','') !~ '^[1-9][0-9]*$'
 then return false; end if;
 for a in select to_jsonb(k) from unnest(array['setupSha256','planSha256','sentinelSha256','inventorySha256','rootReviewSha256','independentReviewSha256']) k loop
  if jsonb_typeof(p->(a#>>'{}')) is distinct from 'string' or coalesce(p->>(a#>>'{}'),'') !~ '^[a-f0-9]{64}$' then return false; end if;
 end loop;
 s:=p->'setup';q:=s->'qualificationSource';
 if jsonb_typeof(s) is distinct from 'object' or s->'epoch' is distinct from p->'epoch' or auth_maintenance_hash(s) is distinct from p->>'setupSha256'
  or jsonb_typeof(p->'plan') is distinct from 'object' or auth_maintenance_hash(p->'plan') is distinct from p->>'planSha256'
  or p->'plan'->>'stage' is distinct from 'qualification' or p->'plan'->>'executionMode' is distinct from 'qualification'
  or coalesce(p->'plan'->>'releaseId','') !~ '^[A-Za-z0-9._:-]{1,200}$'
  or not auth_maintenance_object(s->'legacyReleaseContainment',array['schemaVersion','policy','selection','effects'])
  or s->'legacyReleaseContainment'->'schemaVersion' is distinct from '1'::jsonb
  or s->'legacyReleaseContainment'->>'policy' is distinct from 'legacy_control_plane_effects_v1'
  or s->'legacyReleaseContainment'->>'selection' is distinct from 'detached_node24_before_candidate_v1'
  or jsonb_typeof(s->'legacyReleaseContainment'->'effects') is distinct from 'array'
  or jsonb_array_length(s->'legacyReleaseContainment'->'effects')<>2
  or not auth_maintenance_object(q,array['ref','bootstrapSha','callerWorkflowRef','controllerSha','candidateSha'])
  or q->>'ref' is distinct from p->>'ref' or q->>'bootstrapSha' is distinct from p->>'bootstrapSha'
  or q->>'controllerSha' is distinct from p->>'controllerSha' or q->>'candidateSha' is distinct from p->>'candidateSha'
  or q->>'callerWorkflowRef' is distinct from (p->>'repository')||'/.github/workflows/authenticated-release.yml@'||(p->>'ref')
  or jsonb_typeof(p->'actions') is distinct from 'array' or jsonb_array_length(p->'actions')<>2
  or jsonb_typeof(p->'containmentProofs') is distinct from 'array' or jsonb_array_length(p->'containmentProofs')<>2
 then return false; end if;
 -- Only the exact two existing unknowns are eligible for a pending admission.
 if (select count(*) from imported_uncertainty u left join import_resolutions z using(import_id) where z.import_id is null)<>2 then return false; end if;
 for cp in select value from jsonb_array_elements(p->'containmentProofs') loop
  if not auth_maintenance_object(cp,array['schemaVersion','importId','kind','effectSha256','importedEvidenceSha256','originalIntentSha256','originalSourceSha256','confinementEvidenceSha256','controllerPolicySha256','rootReviewSha256','independentReviewSha256','originalOutcome','replayAllowed','financialAuthorityGranted'])
   or cp->'schemaVersion' is distinct from '1'::jsonb or cp->>'originalOutcome' is distinct from 'unknown'
   or cp->'replayAllowed' is distinct from 'false'::jsonb or cp->'financialAuthorityGranted' is distinct from 'false'::jsonb
  then return false; end if;
  for a in select to_jsonb(k) from unnest(array['effectSha256','importedEvidenceSha256','originalIntentSha256','originalSourceSha256','confinementEvidenceSha256','controllerPolicySha256','rootReviewSha256','independentReviewSha256']) k loop
   if jsonb_typeof(cp->(a#>>'{}')) is distinct from 'string' or coalesce(cp->>(a#>>'{}'),'') !~ '^[a-f0-9]{64}$' then return false; end if;
  end loop;
  select * into u from imported_uncertainty where import_id=cp->>'importId';
  select value into effect from jsonb_array_elements(s->'legacyReleaseContainment'->'effects') where value->>'importId'=cp->>'importId';
  if u.import_id is null or u.epoch::text is distinct from p->>'epoch' or u.evidence->>'operationId' is distinct from u.import_id
   or exists(select 1 from import_resolutions z where z.import_id=u.import_id)
   or cp->>'importedEvidenceSha256' is distinct from auth_maintenance_hash(u.evidence)
   or cp->>'controllerPolicySha256' is distinct from auth_maintenance_hash(s->'legacyReleaseContainment')
   or effect is null or effect->>'kind' is distinct from cp->>'kind' or effect->>'effectSha256' is distinct from cp->>'effectSha256'
   or ((cp->>'importId'='exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29' and cp->>'kind'='legacy_preview_env_row')
    or (cp->>'importId'='production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0' and cp->>'kind'='production_resume_environment_policy')) is distinct from true
  then return false; end if;
 end loop;
 if (select count(distinct value->>'importId') from jsonb_array_elements(p->'containmentProofs'))<>2 then return false; end if;
 for a in select value from jsonb_array_elements(p->'actions') loop
  if not auth_maintenance_object(a,array['id','request']) or coalesce(a->>'id','') !~ '^[a-z_]{1,80}$'
   or not auth_maintenance_object(a->'request',array['method','route','body']) then return false; end if;
  if a->'request'->>'method'='PATCH' then
   if not auth_maintenance_object(a->'request'->'body',array['name','value'])
    or jsonb_typeof(a->'request'->'body'->'value') is distinct from 'string'
    or a->'request'->>'route' is distinct from '/repos/hocheunglai-oss/fcos/actions/variables/'||(a->'request'->'body'->>'name')
    or (a->'request'->'body'->>'name')=any(names) or dispatches<>0 then return false; end if;
   names:=array_append(names,a->'request'->'body'->>'name');
   case a->'request'->'body'->>'name'
    when 'FCOS_HOSTED_QUALIFICATION_ADMITTED' then if a->'request'->'body'->>'value' is distinct from 'true' then return false; end if;
    else return false;
   end case;
  elsif a->'request'->>'method'='POST' then
   dispatches:=dispatches+1;
   if a->'request'->>'route' is distinct from '/repos/hocheunglai-oss/fcos/actions/workflows/authenticated-release.yml/dispatches'
    or not auth_maintenance_object(a->'request'->'body',array['ref','inputs'])
    or a->'request'->'body'->>'ref' is distinct from substr(p->>'ref',12)
    or not auth_maintenance_object(a->'request'->'body'->'inputs',array['bootstrap_phase','candidate_sha','plan','xero_recovery_mode'])
    or a->'request'->'body'->'inputs'->>'bootstrap_phase' is distinct from 'qualification'
    or a->'request'->'body'->'inputs'->>'candidate_sha' is distinct from p->>'candidateSha'
    or a->'request'->'body'->'inputs'->>'xero_recovery_mode' is distinct from 'disabled'
   then return false; end if;
   begin if (a->'request'->'body'->'inputs'->>'plan')::jsonb is distinct from p->'plan' then return false; end if; exception when others then return false; end;
  else return false;
  end if;
 end loop;
 return dispatches=1 and cardinality(names)=1 and (select count(distinct value->>'id')=jsonb_array_length(p->'actions') from jsonb_array_elements(p->'actions'));
end $$;

create function fcos_release_coordination.cutover_bootstrap_claim_ready(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare b cutover_bootstraps%rowtype; r registrations%rowtype; cp jsonb; a legacy_release_containments%rowtype;
begin
 select * into r from registrations where release_id=p->>'releaseId';
 select * into b from cutover_bootstraps where epoch=r.epoch;
 if b.bootstrap_id is null then return true; end if;
 if not exists(select 1 from cutover_bootstrap_finishes where bootstrap_id=b.bootstrap_id)
  or not cutover_bootstrap_proof_valid(b.proof) or not legacy_release_registration_valid(r)
  or r.owner is distinct from p->'owner' or r.manifest_hash is distinct from p->>'manifestHash'
  or r.manifest->>'setupSha256' is distinct from b.proof->>'setupSha256'
  or r.manifest->'controller'->>'sha' is distinct from b.proof->>'controllerSha'
  or r.manifest->'candidate'->>'sha' is distinct from b.proof->>'candidateSha'
  or r.manifest->'qualificationSource' is distinct from b.proof->'setup'->'qualificationSource'
  or r.manifest->'legacyReleaseContainment' is distinct from b.proof->'setup'->'legacyReleaseContainment'
  or r.release_id is distinct from b.proof->'plan'->>'releaseId'
  or r.manifest->'scope' is distinct from b.proof->'plan'->'scope'
  or r.manifest->'runtime' is distinct from b.proof->'plan'->'runtime'
  or r.manifest->'migration' is distinct from b.proof->'plan'->'migration'
  or r.manifest->'changes' is distinct from b.proof->'plan'->'changes'
 then return false; end if;
 for cp in select value from jsonb_array_elements(b.proof->'containmentProofs') loop
  select * into a from legacy_release_containments x where x.epoch=r.epoch and x.manifest_hash=r.manifest_hash and x.import_id=cp->>'importId';
  if a.import_id is null or a.proof is distinct from cp or a.release_id is distinct from r.release_id
   or exists(select 1 from legacy_release_containment_revocations z where z.epoch=r.epoch and z.manifest_hash=r.manifest_hash and z.import_id=cp->>'importId') then return false; end if;
 end loop;
 return true;
end $$;

create function fcos_release_coordination.admit_cutover_bootstrap(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; b cutover_bootstraps%rowtype; installed jsonb;
begin
 select * into c from control where singleton for update;
 select * into b from cutover_bootstraps where bootstrap_id=p->>'bootstrapId';
 if b.bootstrap_id is not null then
  if b.proof is distinct from p then raise exception 'COORDINATION_BOOTSTRAP_CONFLICT'; end if;
  return jsonb_build_object('disposition','readback','bootstrapId',b.bootstrap_id,'proofSha256',b.proof_sha256);
 end if;
 select activation_evidence into installed from epochs where epoch=c.epoch;
 if not cutover_bootstrap_proof_valid(p) or c.epoch::text is distinct from p->>'epoch' or c.mode<>'qualification'
  or c.operation_id is not null or c.bootstrap_id is not null or exists(select 1 from cutover_bootstraps where epoch=c.epoch)
  or exists(select 1 from registrations where epoch=c.epoch)
  or exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null)
  or installed->'legacyFence'->>'kind' is distinct from 'permanent_legacy_sentinel'
  or installed->'legacyFence'->>'proofHash' is distinct from p->>'sentinelSha256'
  or installed->>'inventoryHash' is distinct from p->>'inventorySha256'
 then raise exception 'COORDINATION_BOOTSTRAP_ADMISSION_INVALID'; end if;
 insert into cutover_bootstraps values(p->>'bootstrapId',c.epoch,p,auth_maintenance_hash(p),clock_timestamp());
 update control set bootstrap_id=p->>'bootstrapId' where singleton;
 return jsonb_build_object('disposition','admitted','bootstrapId',p->>'bootstrapId','proofSha256',auth_maintenance_hash(p),'epoch',c.epoch,'providerAuthorityGranted',false);
end $$;

create function fcos_release_coordination.cutover_bootstrap_snapshot(id text,proof_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare b cutover_bootstraps%rowtype;
begin
 select * into b from cutover_bootstraps where bootstrap_id=id;
 if b.bootstrap_id is null or b.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_BOOTSTRAP_BINDING_CHANGED'; end if;
 return jsonb_build_object('bootstrap',to_jsonb(b),'control',(select to_jsonb(c) from control c where singleton),
  'actions',coalesce((select jsonb_agg(to_jsonb(a) order by ordinal) from cutover_bootstrap_actions a where bootstrap_id=id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by event_id) from cutover_bootstrap_events e where bootstrap_id=id),'[]'::jsonb),
  'finished',exists(select 1 from cutover_bootstrap_finishes where bootstrap_id=id));
end $$;

create function fcos_release_coordination.cutover_bootstrap_intent(id text,action_id text,proof_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; b cutover_bootstraps%rowtype; a cutover_bootstrap_actions%rowtype; expected jsonb; n integer;
begin
 select * into c from control where singleton for update;
 select * into b from cutover_bootstraps where bootstrap_id=id;
 if b.bootstrap_id is null or b.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_BOOTSTRAP_BINDING_CHANGED'; end if;
 select * into a from cutover_bootstrap_actions x where x.bootstrap_id=id and x.action_id=cutover_bootstrap_intent.action_id;
 if a.action_id is not null then return jsonb_build_object('disposition','readback','request',a.request,'requestSha256',a.request_sha256); end if;
 if c.epoch<>b.epoch or c.mode<>'qualification' or c.bootstrap_id is distinct from id or c.operation_id is not null
  or exists(select 1 from cutover_bootstrap_finishes where bootstrap_id=id) then raise exception 'COORDINATION_BOOTSTRAP_LOCK_REQUIRED'; end if;
 select count(*)+1 into n from cutover_bootstrap_actions where bootstrap_id=id;
 expected:=b.proof->'actions'->(n-1);
 if expected->>'id' is distinct from action_id or exists(select 1 from cutover_bootstrap_actions x where x.bootstrap_id=id and
   (select state from cutover_bootstrap_events e where e.bootstrap_id=x.bootstrap_id and e.action_id=x.action_id order by event_id desc limit 1) is distinct from 'applied')
 then raise exception 'COORDINATION_BOOTSTRAP_PRIOR_ACTION_UNRESOLVED'; end if;
 insert into cutover_bootstrap_actions values(id,action_id,n,expected->'request',auth_maintenance_hash(expected->'request'),clock_timestamp()) returning * into a;
 return jsonb_build_object('disposition','execute','bootstrapId',id,'actionId',action_id,'request',a.request,'requestSha256',a.request_sha256,'epoch',c.epoch);
end $$;

create function fcos_release_coordination.record_cutover_bootstrap(id text,action_id text,proof_hash text,evidence jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; b cutover_bootstraps%rowtype; a cutover_bootstrap_actions%rowtype; last_ev cutover_bootstrap_events%rowtype; state_value text; k text;
begin
 select * into c from control where singleton for update;
 select * into b from cutover_bootstraps where bootstrap_id=id;
 select * into a from cutover_bootstrap_actions x where x.bootstrap_id=id and x.action_id=record_cutover_bootstrap.action_id;
 if b.bootstrap_id is null or b.proof_sha256 is distinct from proof_hash or a.action_id is null
  or not auth_maintenance_object(evidence,array['basis','outcome','requestSha256','providerEvidenceSha256','rootReviewSha256'])
  or evidence->>'requestSha256' is distinct from a.request_sha256
  or coalesce(evidence->>'basis','') not in ('native_ack','owner_readback') or coalesce(evidence->>'outcome','') not in ('applied','not_applied','unknown')
 then raise exception 'COORDINATION_BOOTSTRAP_EVIDENCE_INVALID'; end if;
 foreach k in array array['providerEvidenceSha256','rootReviewSha256'] loop
  if jsonb_typeof(evidence->k) is distinct from 'string' or coalesce(evidence->>k,'') !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_BOOTSTRAP_EVIDENCE_INVALID'; end if;
 end loop;
 select * into last_ev from cutover_bootstrap_events e where e.bootstrap_id=id and e.action_id=record_cutover_bootstrap.action_id order by event_id desc limit 1;
 if last_ev.state in ('applied','not_applied') then
  if last_ev.evidence is distinct from evidence then raise exception 'COORDINATION_BOOTSTRAP_TERMINAL'; end if;
  return jsonb_build_object('disposition','readback','state',last_ev.state);
 end if;
 if c.epoch<>b.epoch or c.mode<>'qualification' or c.bootstrap_id is distinct from id or c.operation_id is not null
  or last_ev.state='uncertain' and evidence->>'basis'<>'owner_readback'
 then raise exception 'COORDINATION_BOOTSTRAP_READBACK_REQUIRED'; end if;
 state_value:=case when evidence->>'outcome'='unknown' then 'uncertain' else evidence->>'outcome' end;
 insert into cutover_bootstrap_events(bootstrap_id,action_id,state,evidence,evidence_sha256) values(id,action_id,state_value,evidence,auth_maintenance_hash(evidence));
 return jsonb_build_object('disposition','recorded','state',state_value);
end $$;

create function fcos_release_coordination.finish_cutover_bootstrap(id text,proof_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; b cutover_bootstraps%rowtype;
begin
 select * into c from control where singleton for update;
 select * into b from cutover_bootstraps where bootstrap_id=id;
 if b.bootstrap_id is null or b.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_BOOTSTRAP_BINDING_CHANGED'; end if;
 if exists(select 1 from cutover_bootstrap_finishes where bootstrap_id=id) then return jsonb_build_object('disposition','complete','bootstrapId',id); end if;
 if c.epoch<>b.epoch or c.mode<>'qualification' or c.bootstrap_id is distinct from id or c.operation_id is not null
  or (select count(*) from cutover_bootstrap_actions where bootstrap_id=id)<>jsonb_array_length(b.proof->'actions')
  or exists(select 1 from cutover_bootstrap_actions x where x.bootstrap_id=id and
   (select state from cutover_bootstrap_events e where e.bootstrap_id=x.bootstrap_id and e.action_id=x.action_id order by event_id desc limit 1) is distinct from 'applied')
 then raise exception 'COORDINATION_BOOTSTRAP_PRIOR_ACTION_UNRESOLVED'; end if;
 insert into cutover_bootstrap_finishes values(id,proof_hash,clock_timestamp());
 update control set bootstrap_id=null where singleton;
 return jsonb_build_object('disposition','complete','bootstrapId',id,'epoch',c.epoch);
end $$;

-- A boolean pending result is NOT an admission. Only the exact pre-reviewed
-- source/setup/import/proof tuple can wait; foreign/revoked/drift stays refusal.
create function fcos_release_coordination.cutover_bootstrap_pending(action text,p jsonb,principal jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; b cutover_bootstraps%rowtype; r registrations%rowtype; m jsonb; cp jsonb; a legacy_release_containments%rowtype; missing boolean:=false;
begin
 select * into c from control where singleton;
 select * into b from cutover_bootstraps where epoch=c.epoch;
 if b.bootstrap_id is null or c.mode<>'qualification' or c.epoch::text is distinct from p->>'epoch'
  or principal->>'kind' is distinct from 'github' or principal->'qualificationOnly' is distinct from 'true'::jsonb
  or p->'owner' is distinct from jsonb_build_object('kind','release','id','features')
  or principal->>'repositoryId' is distinct from b.proof->>'repositoryId' or principal->>'actorId' is distinct from b.proof->>'operatorId'
  or principal->>'actor' is distinct from b.proof->>'operatorLogin' or principal->>'ref' is distinct from b.proof->>'ref'
  or principal->>'sha' is distinct from b.proof->>'bootstrapSha' or principal->>'workflowSha' is distinct from b.proof->>'bootstrapSha'
  or principal->>'workflowRef' is distinct from b.proof->'setup'->'qualificationSource'->>'callerWorkflowRef'
  or principal->>'jobWorkflowSha' is distinct from b.proof->>'controllerSha'
  or principal->>'jobWorkflowRef' is distinct from 'hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@'||(b.proof->>'controllerSha')
  or principal->>'runAttempt' is distinct from '1' or coalesce(principal->>'runId','') !~ '^[1-9][0-9]*$'
 then return false; end if;
 if action='register' then m:=p->'manifest';
 elsif action in ('begin','claim') then
  select * into r from registrations where release_id=p->>'releaseId';
  if r.epoch is distinct from c.epoch or r.owner is distinct from p->'owner' or r.manifest_hash is distinct from p->>'manifestHash'
   or exists(select 1 from operations x where x.release_id=r.release_id and x.phase=p->>'phase') then return false; end if;
  m:=r.manifest;
 else return false; end if;
 if m->>'releaseId' is distinct from p->>'releaseId' or m->>'releaseId' is distinct from b.proof->'plan'->>'releaseId'
  or m->'scope' is distinct from b.proof->'plan'->'scope' or m->'runtime' is distinct from b.proof->'plan'->'runtime'
  or m->'migration' is distinct from b.proof->'plan'->'migration' or m->'changes' is distinct from b.proof->'plan'->'changes'
  or m->'epoch' is distinct from b.proof->'epoch'
  or m->>'setupSha256' is distinct from b.proof->>'setupSha256' or m->'controller'->>'sha' is distinct from b.proof->>'controllerSha'
  or m->'candidate'->>'sha' is distinct from b.proof->>'candidateSha' or m->>'stage' is distinct from 'qualification'
  or m->>'executionMode' is distinct from 'qualification' or m->'qualificationSource' is distinct from b.proof->'setup'->'qualificationSource'
  or m->'legacyReleaseContainment' is distinct from b.proof->'setup'->'legacyReleaseContainment'
  or auth_maintenance_hash(m) is distinct from p->>'manifestHash' or not cutover_bootstrap_proof_valid(b.proof)
 then return false; end if;
 if c.bootstrap_id=b.bootstrap_id then return action='register'; end if;
 if action not in ('begin','claim') or not exists(select 1 from cutover_bootstrap_finishes where bootstrap_id=b.bootstrap_id)
  or not legacy_release_registration_valid(r) or p->>'phase' not in ('preview.create','qualification.stage','qualification.promote','qualification.rollback')
 then return false; end if;
 for cp in select value from jsonb_array_elements(b.proof->'containmentProofs') loop
  if exists(select 1 from legacy_release_containment_revocations z where z.epoch=r.epoch and z.manifest_hash=r.manifest_hash and z.import_id=cp->>'importId') then return false; end if;
  select * into a from legacy_release_containments x where x.epoch=r.epoch and x.manifest_hash=r.manifest_hash and x.import_id=cp->>'importId';
  if a.import_id is null then missing:=true;
  elsif a.proof is distinct from cp or a.release_id is distinct from r.release_id or a.controller_sha is distinct from b.proof->>'controllerSha'
   or a.setup_sha256 is distinct from b.proof->>'setupSha256' then return false; end if;
 end loop;
 return missing;
end $$;

-- Fail on source drift before replacing any function. Body-only edits preserve
-- OIDs/signatures/owners/ACL/search_path. Existing consumed readback stays first.
do $$
declare sig text; expected text; definition text; marker text:=' select * into c from control where singleton for update;';
begin
 for sig,expected in select * from (values
  ('dispatch(text,jsonb,jsonb)','27cd7b9a340cf0a13d8f2592b167f226db2836ca08f8f156ade6c43cdbfaa8e2'),
  ('install_epoch(bigint,jsonb)','16bba565d5cc2916f6762e113ff6cd0efb9380a09c2ef490e4cb18b303c454a3'),
  ('activate(bigint,jsonb)','b25f08b11b946a4c6d49c57050239743ff9103d0ac5be7a9a481ddd01bee4dd3'),
  ('dispatch_without_auth_maintenance(text,jsonb,jsonb)','c6301be9e321c6e35ab6cc5797a88bb7f2ad55bdddd1bbcbc7a02ac0fa948b53')) x loop
  if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=('fcos_release_coordination.'||sig)::regprocedure) is distinct from expected
  then raise exception 'COORDINATION_BOOTSTRAP_SOURCE_DRIFT'; end if;
 end loop;
 definition:=pg_get_functiondef('fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'COORDINATION_BOOTSTRAP_SOURCE_DRIFT'; end if;
 execute replace(definition,marker,marker||E'\n if c.bootstrap_id is not null and (action=\'register\' or action in (\'begin\',\'claim\') and not exists(select 1 from operations x where x.release_id=p->>\'releaseId\' and x.phase=p->>\'phase\')) then raise exception \'COORDINATION_BOOTSTRAP_BUSY\'; end if;\n if action in (\'begin\',\'claim\') and exists(select 1 from registrations x where x.release_id=p->>\'releaseId\' and x.scope=\'qualification\') and not exists(select 1 from operations x where x.release_id=p->>\'releaseId\' and x.phase=p->>\'phase\') and not cutover_bootstrap_claim_ready(p) then return jsonb_build_object(\'disposition\',\'busy\',\'bootstrapContainmentInvalid\',true); end if;');
 foreach sig in array array['install_epoch(bigint,jsonb)','activate(bigint,jsonb)'] loop
  definition:=pg_get_functiondef(('fcos_release_coordination.'||sig)::regprocedure);
  marker:='  select * into c from fcos_release_coordination.control where singleton for update;';
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'COORDINATION_BOOTSTRAP_SOURCE_DRIFT'; end if;
  execute replace(definition,marker,marker||E'\n  if c.bootstrap_id is not null then raise exception \'COORDINATION_BOOTSTRAP_BUSY\'; end if;');
 end loop;
end $$;

do $$ declare t text; f record; begin
 foreach t in array array['cutover_bootstraps','cutover_bootstrap_actions','cutover_bootstrap_events','cutover_bootstrap_finishes'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime',t);
  execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure sig from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and proname in
  ('cutover_bootstrap_proof_valid','cutover_bootstrap_claim_ready','admit_cutover_bootstrap','cutover_bootstrap_intent','record_cutover_bootstrap','finish_cutover_bootstrap','cutover_bootstrap_snapshot','cutover_bootstrap_pending') loop
  execute format('alter function %s owner to fcos_coordinator_owner',f.sig);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f.sig);
  execute format('grant execute on function %s to postgres',f.sig);
 end loop;
 grant execute on function fcos_release_coordination.cutover_bootstrap_pending(text,jsonb,jsonb) to fcos_coordinator_runtime;
end $$;
commit;
