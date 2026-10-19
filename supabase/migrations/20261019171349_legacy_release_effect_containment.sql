begin;
-- Release-only confinement is NOT a definitive provider outcome, replay grant,
-- financial authority, or resolution of the original imported unknown. Empty
-- admission tables leave all existing unknown stops in force.
create table fcos_release_coordination.legacy_release_containments (
 epoch bigint not null references fcos_release_coordination.epochs,
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
 import_id text not null references fcos_release_coordination.imported_uncertainty,
 release_id text not null references fcos_release_coordination.registrations,
 kind text not null,
 effect_sha256 text not null check(effect_sha256 ~ '^[a-f0-9]{64}$'),
 imported_evidence_sha256 text not null check(imported_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 controller_sha text not null check(controller_sha ~ '^[a-f0-9]{40}$'),
 setup_sha256 text not null check(setup_sha256 ~ '^[a-f0-9]{64}$'),
 policy_sha256 text not null check(policy_sha256 ~ '^[a-f0-9]{64}$'),
 proof jsonb not null,
 admitted_at timestamptz not null default clock_timestamp(),
 primary key(epoch,manifest_hash,import_id),
 check((import_id='exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29' and kind='legacy_preview_env_row')
    or (import_id='production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0' and kind='production_resume_environment_policy'))
);
create table fcos_release_coordination.legacy_release_containment_revocations (
 epoch bigint not null, manifest_hash text not null, import_id text not null,
 proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),
 revoked_at timestamptz not null default clock_timestamp(),
 primary key(epoch,manifest_hash,import_id),
 foreign key(epoch,manifest_hash,import_id) references fcos_release_coordination.legacy_release_containments
);

-- A manifest must opt in to this one fixed pair, with no extensible unknown list.
-- Existing canonical JSON hashing is shared with the trusted coordinator.
create function fcos_release_coordination.legacy_release_registration_valid(r fcos_release_coordination.registrations) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare policy jsonb:=r.manifest->'legacyReleaseContainment'; item jsonb; a jsonb:=r.registration_actor; repo text;
begin
 if r.scope is null or r.scope not in ('qualification','release') or r.owner->>'kind' is distinct from 'release'
  or coalesce(r.owner->>'id','')='' or r.manifest->>'releaseId' is distinct from r.release_id
  or r.manifest->>'epoch' is distinct from r.epoch::text
  or r.manifest->>'executionMode' is distinct from r.scope
  or r.manifest_hash is distinct from auth_maintenance_hash(r.manifest)
  or jsonb_typeof(r.manifest->'setupSha256') is distinct from 'string' or coalesce(r.manifest->>'setupSha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(r.manifest->'controller'->'sha') is distinct from 'string' or coalesce(r.manifest->'controller'->>'sha','') !~ '^[a-f0-9]{40}$'
  or r.manifest->'controller'->>'workflow' is distinct from '.github/workflows/hosted-release-controller.yml'
  or a->>'kind' is distinct from 'github' or a->>'runAttempt' is distinct from '1'
  or coalesce(a->>'runId','') !~ '^[1-9][0-9]*$' or coalesce(a->>'repositoryId','') !~ '^[1-9][0-9]*$'
  or coalesce(a->>'sha','') !~ '^[a-f0-9]{40}$' or coalesce(a->>'workflowSha','') !~ '^[a-f0-9]{40}$'
  or coalesce(a->>'actorId','') !~ '^[1-9][0-9]*$' or coalesce(a->>'actor','') !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
  or a->>'jobWorkflowSha' is distinct from r.manifest->'controller'->>'sha'
 then return false; end if;
 repo:=split_part(a->>'workflowRef','/.github/',1);
 if coalesce(repo,'') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  or a->>'jobWorkflowRef' is distinct from repo||'/.github/workflows/hosted-release-controller.yml@'||(r.manifest->'controller'->>'sha')
  or not auth_maintenance_object(policy,array['schemaVersion','policy','selection','effects'])
  or policy->'schemaVersion' is distinct from '1'::jsonb
  or policy->>'policy' is distinct from 'legacy_control_plane_effects_v1'
  or policy->>'selection' is distinct from 'detached_node24_before_candidate_v1'
  or jsonb_typeof(policy->'effects') is distinct from 'array'
 then return false; end if;
 if jsonb_array_length(policy->'effects')<>2 then return false; end if;
 for item in select value from jsonb_array_elements(policy->'effects') loop
  if not auth_maintenance_object(item,array['importId','kind','effectSha256'])
   or jsonb_typeof(item->'effectSha256') is distinct from 'string' or coalesce(item->>'effectSha256','') !~ '^[a-f0-9]{64}$'
   or ((item->>'importId'='exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29' and item->>'kind'='legacy_preview_env_row')
        or (item->>'importId'='production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0' and item->>'kind'='production_resume_environment_policy')) is distinct from true
  then return false; end if;
 end loop;
 return (select count(distinct value->>'importId')=2 from jsonb_array_elements(policy->'effects'));
end $$;

-- Only postgres has EXECUTE. The privileged operator authenticates original
-- evidence and both reviews; hashes provide binding, never provider attestation.
-- originalIntentSha256/source refer to the reviewed original external evidence,
-- not imported evidence.evidenceHash (which may identify an unknown-state closure).
create function fcos_release_coordination.admit_legacy_release_containment(release_id text,proof jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare r registrations%rowtype; u imported_uncertainty%rowtype; c control%rowtype; item jsonb; k text;
begin
 select * into c from control where singleton for update;
 select * into r from registrations x where x.release_id=admit_legacy_release_containment.release_id;
 if not legacy_release_registration_valid(r) or r.epoch is distinct from c.epoch
  or c.mode not in ('qualification','active')
  or not auth_maintenance_object(proof,array['schemaVersion','importId','kind','effectSha256','importedEvidenceSha256','originalIntentSha256','originalSourceSha256','confinementEvidenceSha256','controllerPolicySha256','rootReviewSha256','independentReviewSha256','originalOutcome','replayAllowed','financialAuthorityGranted'])
  or proof->'schemaVersion' is distinct from '1'::jsonb or proof->'originalOutcome' is distinct from '"unknown"'::jsonb
  or proof->'replayAllowed' is distinct from 'false'::jsonb or proof->'financialAuthorityGranted' is distinct from 'false'::jsonb
 then raise exception 'COORDINATION_LEGACY_CONTAINMENT_INVALID'; end if;
 foreach k in array array['effectSha256','importedEvidenceSha256','originalIntentSha256','originalSourceSha256','confinementEvidenceSha256','controllerPolicySha256','rootReviewSha256','independentReviewSha256'] loop
  if jsonb_typeof(proof->k) is distinct from 'string' or coalesce(proof->>k,'') !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_LEGACY_CONTAINMENT_INVALID'; end if;
 end loop;
 select value into item from jsonb_array_elements(r.manifest->'legacyReleaseContainment'->'effects') where value->>'importId'=proof->>'importId';
 select * into u from imported_uncertainty where import_id=proof->>'importId';
 if item is null or u.import_id is null or u.epoch is distinct from r.epoch or u.evidence->>'operationId' is distinct from u.import_id
  or item->>'kind' is distinct from proof->>'kind' or item->>'effectSha256' is distinct from proof->>'effectSha256'
  or proof->>'controllerPolicySha256' is distinct from auth_maintenance_hash(r.manifest->'legacyReleaseContainment')
  or proof->>'importedEvidenceSha256' is distinct from auth_maintenance_hash(u.evidence)
  or exists(select 1 from import_resolutions z where z.import_id=u.import_id)
 then raise exception 'COORDINATION_LEGACY_CONTAINMENT_BINDING_CHANGED'; end if;
 insert into legacy_release_containments(epoch,manifest_hash,import_id,release_id,kind,effect_sha256,imported_evidence_sha256,controller_sha,setup_sha256,policy_sha256,proof)
 values(r.epoch,r.manifest_hash,u.import_id,r.release_id,proof->>'kind',proof->>'effectSha256',proof->>'importedEvidenceSha256',r.manifest->'controller'->>'sha',r.manifest->>'setupSha256',proof->>'controllerPolicySha256',proof);
 return jsonb_build_object('contained',true,'releaseId',r.release_id,'importId',u.import_id,'originalOutcome','unknown','replayAllowed',false,'financialAuthorityGranted',false);
end $$;
create function fcos_release_coordination.revoke_legacy_release_containment(release_id text,import_id text,proof_hash text) returns void
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare r registrations%rowtype;
begin
 perform 1 from control where singleton for update;
 select * into r from registrations x where x.release_id=revoke_legacy_release_containment.release_id;
 if r.release_id is null or proof_hash is null or proof_hash !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_LEGACY_CONTAINMENT_INVALID'; end if;
 if not exists(select 1 from legacy_release_containments a where a.epoch=r.epoch and a.manifest_hash=r.manifest_hash
   and a.release_id=r.release_id and a.import_id=revoke_legacy_release_containment.import_id) then raise exception 'COORDINATION_LEGACY_CONTAINMENT_UNKNOWN'; end if;
 insert into legacy_release_containment_revocations values(r.epoch,r.manifest_hash,import_id,proof_hash,clock_timestamp());
end $$;

create function fcos_release_coordination.legacy_release_unknowns_contained(r fcos_release_coordination.registrations,principal jsonb,activation boolean default false) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare u imported_uncertainty%rowtype; a legacy_release_containments%rowtype; item jsonb; boundary jsonb:=principal->'legacyContainmentBoundary'; policy_hash text;
begin
 if not exists(select 1 from imported_uncertainty u left join import_resolutions z using(import_id) where z.import_id is null) then return true; end if;
 if not legacy_release_registration_valid(r) or principal->>'kind' is distinct from 'github'
  or principal->>'jobWorkflowSha' is distinct from r.manifest->'controller'->>'sha'
  or principal->>'jobWorkflowRef' is distinct from r.registration_actor->>'jobWorkflowRef'
  or principal->>'repositoryId' is distinct from r.registration_actor->>'repositoryId'
  or principal->>'actorId' is distinct from r.registration_actor->>'actorId'
  or principal->>'actor' is distinct from r.registration_actor->>'actor'
 then return false; end if;
 policy_hash:=auth_maintenance_hash(r.manifest->'legacyReleaseContainment');
 if activation is distinct from true and (not auth_maintenance_object(boundary,array['validatedBy','manifestHash','controllerSha','setupSha256','policySha256'])
  or boundary->>'validatedBy' is distinct from 'trusted_coordinator' or boundary->>'manifestHash' is distinct from r.manifest_hash
  or boundary->>'controllerSha' is distinct from r.manifest->'controller'->>'sha'
  or boundary->>'setupSha256' is distinct from r.manifest->>'setupSha256' or boundary->>'policySha256' is distinct from policy_hash)
 then return false; end if;
 for u in select x.* from imported_uncertainty x left join import_resolutions z using(import_id) where z.import_id is null loop
  select value into item from jsonb_array_elements(r.manifest->'legacyReleaseContainment'->'effects') where value->>'importId'=u.import_id;
  select * into a from legacy_release_containments x where x.epoch=r.epoch and x.manifest_hash=r.manifest_hash and x.import_id=u.import_id and x.release_id=r.release_id;
  if item is null or a.import_id is null or u.epoch is distinct from r.epoch
   or u.evidence->>'operationId' is distinct from u.import_id
   or a.kind is distinct from item->>'kind' or a.effect_sha256 is distinct from item->>'effectSha256'
   or a.imported_evidence_sha256 is distinct from auth_maintenance_hash(u.evidence)
   or a.controller_sha is distinct from r.manifest->'controller'->>'sha' or a.setup_sha256 is distinct from r.manifest->>'setupSha256'
   or a.policy_sha256 is distinct from policy_hash
   or exists(select 1 from legacy_release_containment_revocations z where z.epoch=a.epoch and z.manifest_hash=a.manifest_hash and z.import_id=a.import_id)
  then return false; end if;
 end loop;
 return true;
end $$;

-- Patch only the two reviewed predicates, never an unrecognised live body. The
-- immutable install_epoch and auth-maintenance wrapper are checked, not replaced.
do $$
declare old_predicate text:='exists(select 1 from fcos_release_coordination.imported_uncertainty u left join fcos_release_coordination.import_resolutions ir using(import_id) where ir.import_id is null)';
 activation_stop text:='  if exists(select 1 from fcos_release_coordination.imported_uncertainty u left join fcos_release_coordination.import_resolutions r using(import_id) where r.import_id is null) then raise exception ''COORDINATION_IMPORTED_UNCERTAINTY_UNRESOLVED''; end if;';
 registration_select text:='  select release_id,registration_actor into qid,qualification_actor from fcos_release_coordination.registrations
    where epoch=c.epoch and manifest_hash=qualification->>''manifestHash'' and scope=''qualification'';';
 body text; definition text;
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='fcos_release_coordination.dispatch_without_auth_maintenance(text,jsonb,jsonb)'::regprocedure) is distinct from 'e39a5e3636ef7cf84234c0c3f0ac8c062b4a33245c5165a1444550a68d385b60'
  or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='fcos_release_coordination.activate(bigint,jsonb)'::regprocedure) is distinct from 'be470204ae3682b4efa11e916ba4f99aea2804c40f220f75cdea19df0c4fa79e'
  or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='fcos_release_coordination.install_epoch(bigint,jsonb)'::regprocedure) is distinct from '16bba565d5cc2916f6762e113ff6cd0efb9380a09c2ef490e4cb18b303c454a3'
  or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure) is distinct from '27cd7b9a340cf0a13d8f2592b167f226db2836ca08f8f156ade6c43cdbfaa8e2'
 then raise exception 'COORDINATION_LEGACY_CONTAINMENT_SOURCE_DRIFT'; end if;
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid='fcos_release_coordination.dispatch_without_auth_maintenance(text,jsonb,jsonb)'::regprocedure;
 if (length(body)-length(replace(body,old_predicate,'')))/length(old_predicate)<>1 then raise exception 'COORDINATION_LEGACY_CONTAINMENT_SOURCE_DRIFT'; end if;
 execute replace(definition,old_predicate,'not fcos_release_coordination.legacy_release_unknowns_contained(r,principal)');
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid='fcos_release_coordination.activate(bigint,jsonb)'::regprocedure;
 if (length(body)-length(replace(body,activation_stop,'')))/length(activation_stop)<>1
  or (length(body)-length(replace(body,registration_select,'')))/length(registration_select)<>1 then raise exception 'COORDINATION_LEGACY_CONTAINMENT_SOURCE_DRIFT'; end if;
 definition:=replace(definition,activation_stop,'');
 execute replace(definition,registration_select,registration_select||E'\n  if not fcos_release_coordination.legacy_release_unknowns_contained((select r0 from fcos_release_coordination.registrations r0 where r0.release_id=qid),qualification_actor,true) then raise exception ''COORDINATION_IMPORTED_UNCERTAINTY_UNRESOLVED''; end if;');
end $$;

do $$ declare t text; f record; role_name text; begin
 foreach t in array array['legacy_release_containments','legacy_release_containment_revocations'] loop
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('revoke all on table fcos_release_coordination.%I from public,fcos_coordinator_runtime',t);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fcos_release_coordination' and p.proname in ('legacy_release_registration_valid','admit_legacy_release_containment','revoke_legacy_release_containment','legacy_release_unknowns_contained') loop
  execute format('alter function %s owner to fcos_coordinator_owner',f.signature);
  execute format('revoke all on function %s from public,fcos_coordinator_runtime',f.signature);
 end loop;
 -- Do not depend on environment-specific Supabase default ACLs.
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   foreach t in array array['legacy_release_containments','legacy_release_containment_revocations'] loop
    execute format('revoke all on table fcos_release_coordination.%I from %I',t,role_name);
   end loop;
   for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fcos_release_coordination' and p.proname in ('legacy_release_registration_valid','admit_legacy_release_containment','revoke_legacy_release_containment','legacy_release_unknowns_contained') loop
    execute format('revoke all on function %s from %I',f.signature,role_name);
   end loop;
  end if;
 end loop;
end $$;
grant execute on function fcos_release_coordination.admit_legacy_release_containment(text,jsonb),fcos_release_coordination.revoke_legacy_release_containment(text,text,text) to postgres;
commit;
