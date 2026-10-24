-- PREPARED policy change. Installing definitions grants no admission. Actual
-- exact human approval, stopped-writer and maximum-effect evidence are required.
-- UNKNOWN is preserved: this is neither negative readback nor a retry grant.
begin;
set local lock_timeout='5s';

create table fcos_release_coordination.exact_preview_uncertainty_quarantines (
 operation_id text primary key references fcos_release_coordination.operations
  check(operation_id='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'),
 epoch bigint not null check(epoch=1) references fcos_release_coordination.epochs,
 proof jsonb not null,proof_sha256 text not null check(proof_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp()
);
create table fcos_release_coordination.exact_preview_uncertainty_quarantine_revocations (
 operation_id text primary key references fcos_release_coordination.exact_preview_uncertainty_quarantines,
 proof_sha256 text not null check(proof_sha256 ~ '^[a-f0-9]{64}$'),
 root_review_sha256 text not null check(root_review_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp()
);

create function fcos_release_coordination.exact_preview_quarantine_original_actor() returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select '{"ref":"refs/heads/codex/hosted-qualification-6a3fbd8f-20261022","sha":"300a46365fbb8b159100b6bdd66523d757cfa4ec","kind":"github","actor":"hocheunglai-oss","runId":"39811703824","actorId":"265701760","subject":"repo:hocheunglai-oss/fcos:environment:fcos-hosted-preview","runAttempt":"1","environment":"fcos-hosted-preview","workflowRef":"hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@refs/heads/codex/hosted-qualification-6a3fbd8f-20261022","workflowSha":"300a46365fbb8b159100b6bdd66523d757cfa4ec","repositoryId":"1278654816","jobWorkflowRef":"hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@6a3fbd8fd05a76c052e7e380d618aedf43e5b72e","jobWorkflowSha":"6a3fbd8fd05a76c052e7e380d618aedf43e5b72e","qualificationOnly":true,"qualificationAdmission":{"ref":"refs/heads/codex/hosted-qualification-6a3fbd8f-20261022","repository":"hocheunglai-oss/fcos","setupSha256":"98d8a3dc58a0a274b0579128c36a9d224b18b1e93a03e27b61c3b451d73c5782","bootstrapSha":"300a46365fbb8b159100b6bdd66523d757cfa4ec","candidateSha":"2ef733d17dd12314c72971c2220b2b09903a6bf0","repositoryId":"1278654816","jobWorkflowRef":"hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@6a3fbd8fd05a76c052e7e380d618aedf43e5b72e","jobWorkflowSha":"6a3fbd8fd05a76c052e7e380d618aedf43e5b72e","callerWorkflowRef":"hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@refs/heads/codex/hosted-qualification-6a3fbd8f-20261022","callerWorkflowSha":"300a46365fbb8b159100b6bdd66523d757cfa4ec"},"legacyContainmentBoundary":{"setupSha256":"98d8a3dc58a0a274b0579128c36a9d224b18b1e93a03e27b61c3b451d73c5782","validatedBy":"trusted_coordinator","manifestHash":"62389788e43dd99e081989f974f7df51e0967120e9aff30b9e72c3ffa1a29583","policySha256":"8b0b1b5cf351921429e22ab1fc87e7cea374b42d498b015c04bd3b73f5aa7191","controllerSha":"6a3fbd8fd05a76c052e7e380d618aedf43e5b72e"}}'::jsonb
$$;

create function fcos_release_coordination.exact_preview_quarantine_original_bound() returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select exists(select 1 from operations o join registrations r using(release_id)
  join operation_events e on e.operation_id=o.operation_id and e.event_id=2
  where o.operation_id='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'
   and o.phase='preview.create' and o.epoch=1 and r.epoch=1
   and o.request_hash='7be15bf07ccfccbb2532c0e439fe296591a78f1d64ca689ab09a14bbc569d466'
   and o.manifest_hash='62389788e43dd99e081989f974f7df51e0967120e9aff30b9e72c3ffa1a29583'
   and r.manifest_hash=o.manifest_hash and auth_maintenance_hash(r.manifest)=r.manifest_hash
   and r.release_id='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022'
   and r.scope='qualification' and r.owner='{"kind":"release","id":"features"}'::jsonb
   and o.actor=exact_preview_quarantine_original_actor()
   and r.registration_actor->>'runId'='39789525210' and o.actor->>'runId'='39811703824'
   and (r.registration_actor-'runId'-'environment'-'subject'-'legacyContainmentBoundary')=(o.actor-'runId'-'environment'-'subject'-'legacyContainmentBoundary')
   and e.state='uncertain' and e.evidence='{"reason":"PROVIDER_RESPONSE_LOST","outcome":"unknown"}'::jsonb
   and e.evidence_hash=auth_maintenance_hash(e.evidence)
   and (e.actor-'legacyContainmentBoundary')=(o.actor-'legacyContainmentBoundary'))
$$;

-- Integrity is necessary but cannot authenticate a human or external provider.
-- Only the migration administrator may attest the independently reviewed bytes.
create function fcos_release_coordination.exact_preview_quarantine_proof_valid(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare o operations%rowtype;r registrations%rowtype;e operation_events%rowtype;
 s jsonb:=p->'successor';w jsonb:=p->'terminalWriter';m jsonb:=p->'maximumEffect';h jsonb:=p->'humanDecision';v jsonb;k text;
 subject_hash text;review_hash text;completed timestamptz;observed timestamptz;approved timestamptz;
begin
 if not auth_maintenance_object(p,array['schemaVersion','kind','epoch','operationId','originalOperationSha256','originalRegistrationSha256','originalEventSha256','originalOutcome','replayAllowed','financialAuthorityGranted','productionAuthorityGranted','terminalWriter','maximumEffect','recoveryAdmission','successor','humanDecision','rootReview','independentReview'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'kind' is distinct from 'fcos_exact_preview_uncertainty_quarantine_v1'
  or p->'epoch' is distinct from '1'::jsonb
  or p->>'operationId' is distinct from 'fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'
  or p->>'originalOutcome' is distinct from 'unknown' or p->'replayAllowed' is distinct from 'false'::jsonb
  or p->'financialAuthorityGranted' is distinct from 'false'::jsonb or p->'productionAuthorityGranted' is distinct from 'false'::jsonb
  or not exact_preview_quarantine_original_bound() then return false;end if;
 select * into o from operations where operation_id=p->>'operationId';
 select * into r from registrations where release_id=o.release_id;
 select * into e from operation_events where operation_id=o.operation_id and event_id=2;
 if p->>'originalOperationSha256' is distinct from auth_maintenance_hash(to_jsonb(o))
  or p->>'originalRegistrationSha256' is distinct from auth_maintenance_hash(to_jsonb(r))
  or p->>'originalEventSha256' is distinct from auth_maintenance_hash(to_jsonb(e)) then return false;end if;
 if not auth_maintenance_object(w,array['kind','repository','repositoryId','runId','runAttempt','jobId','jobName','status','conclusion','completedAt','observedAt','readbackSha256','originalSourceProvenanceSha256','writerStopped','credentialJobOnly'])
  or w->>'kind' is distinct from 'fcos_exact_preview_terminal_writer_v1'
  or w->>'repository' is distinct from 'hocheunglai-oss/fcos' or w->>'repositoryId' is distinct from '1278654816'
  or w->>'runId' is distinct from '39811703824' or w->'runAttempt' is distinct from '1'::jsonb
  or w->>'jobId' is distinct from '119940662178' or w->>'jobName' is distinct from 'release / preview'
  or w->>'status' is distinct from 'completed' or w->>'conclusion' is distinct from 'failure'
  or w->'writerStopped' is distinct from 'true'::jsonb or w->'credentialJobOnly' is distinct from 'true'::jsonb
  or not auth_maintenance_object(m,array['kind','argumentsSha256','controllerSha','candidateSha','sourceSha256','teamId','projectId','ordinaryPreviewOnly','readOnlyCi','productionAliasesCanChange','financialActionsPossible','lateEffectPossible','sourceEvidenceSha256','transportSemanticsSha256','runtimeConfinementSha256'])
  or m->>'kind' is distinct from 'fcos_exact_preview_maximum_effect_v1'
  or m->>'argumentsSha256' is distinct from '8d85327f894543f31757758c3ca4bfb51095ecf39d4af1074f77047090a3ee8e'
  or m->>'controllerSha' is distinct from '6a3fbd8fd05a76c052e7e380d618aedf43e5b72e'
  or m->>'candidateSha' is distinct from '2ef733d17dd12314c72971c2220b2b09903a6bf0'
  or m->>'sourceSha256' is distinct from r.manifest->'candidate'->>'sourceSha256'
  or m->>'teamId' is distinct from r.manifest->'targets'->>'vercelTeam'
  or m->>'projectId' is distinct from r.manifest->'targets'->>'vercelProject'
  or m->'ordinaryPreviewOnly' is distinct from 'true'::jsonb or m->'readOnlyCi' is distinct from 'true'::jsonb
  or m->'productionAliasesCanChange' is distinct from 'false'::jsonb or m->'financialActionsPossible' is distinct from 'false'::jsonb
  or m->'lateEffectPossible' is distinct from 'true'::jsonb then return false;end if;
 if jsonb_typeof(w->'completedAt') is distinct from 'string' or jsonb_typeof(w->'observedAt') is distinct from 'string' then return false;end if;
 completed:=(w->>'completedAt')::timestamptz;observed:=(w->>'observedAt')::timestamptz;
 if isfinite(completed) is distinct from true or isfinite(observed) is distinct from true or completed<e.created_at or observed<completed or observed>statement_timestamp()+interval '30 seconds' then return false;end if;
 foreach k in array array['readbackSha256','originalSourceProvenanceSha256'] loop
  if jsonb_typeof(w->k) is distinct from 'string' or w->>k !~ '^[a-f0-9]{64}$' then return false;end if;
 end loop;
 foreach k in array array['sourceEvidenceSha256','transportSemanticsSha256','runtimeConfinementSha256'] loop
  if jsonb_typeof(m->k) is distinct from 'string' or m->>k !~ '^[a-f0-9]{64}$' then return false;end if;
 end loop;
 if not auth_maintenance_object(p->'recoveryAdmission',array['kind','accepted','sameCoordinator','authenticatedReadbackProofSha256','nativeDatabaseProofSha256','coordinatorIdentitySha256'])
  or p->'recoveryAdmission'->>'kind' is distinct from 'fcos_exact_preview_recovery_retention_acceptance_v1'
  or p->'recoveryAdmission'->'accepted' is distinct from 'true'::jsonb or p->'recoveryAdmission'->'sameCoordinator' is distinct from 'true'::jsonb
 then return false;end if;
 foreach k in array array['authenticatedReadbackProofSha256','nativeDatabaseProofSha256','coordinatorIdentitySha256'] loop
  if jsonb_typeof(p->'recoveryAdmission'->k) is distinct from 'string' or p->'recoveryAdmission'->>k !~ '^[a-f0-9]{64}$' then return false;end if;
 end loop;
 if not auth_maintenance_object(s,array['releaseId','sourceUpgradeId','controllerSha','callerSha','candidateSha','setupSha256','checkerManifestSha256','ref','repositoryId','actorId','actor'])
  or coalesce(s->>'releaseId','') !~ '^[a-z0-9][a-z0-9-]{7,95}$' or s->>'releaseId'=r.release_id
  or coalesce(s->>'sourceUpgradeId','') !~ '^[A-Za-z0-9._:-]{1,200}$' or s->>'sourceUpgradeId'=p->>'operationId'
  or coalesce(s->>'controllerSha','') !~ '^[a-f0-9]{40}$' or s->>'controllerSha'=m->>'controllerSha'
  or coalesce(s->>'callerSha','') !~ '^[a-f0-9]{40}$' or s->>'callerSha'=o.actor->>'sha'
  or s->>'candidateSha' is distinct from m->>'candidateSha' or coalesce(s->>'setupSha256','') !~ '^[a-f0-9]{64}$'
  or s->>'setupSha256'=r.manifest->>'setupSha256' or coalesce(s->>'checkerManifestSha256','') !~ '^[a-f0-9]{64}$'
  or s->>'repositoryId' is distinct from '1278654816'
  or s->>'actorId' is distinct from '265701760' or s->>'actor' is distinct from 'hocheunglai-oss'
  or coalesce(s->>'ref','') !~ '^refs/heads/codex/[A-Za-z0-9][A-Za-z0-9._/-]{0,170}$'
  or s->>'ref' ~ '\.\.|//|/$|\.lock$' or s->>'ref'=o.actor->>'ref' then return false;end if;
 subject_hash:=auth_maintenance_hash(p-'humanDecision'-'rootReview'-'independentReview');
 if not auth_maintenance_object(h,array['kind','operator','source','replyReference','replySha256','scopeSha256','approved','approvedAt','acknowledgesUnknown','allowsExactQuarantine','replayForbidden','productionGatesPreserved'])
  or h->>'kind' is distinct from 'fcos_exact_preview_quarantine_human_decision_v1'
  or h->>'operator' is distinct from 'hocheunglai-oss' or h->>'source' is distinct from 'actual_direct_human_reply'
  or jsonb_typeof(h->'replyReference') is distinct from 'string' or length(h->>'replyReference') not between 1 and 512
  or coalesce(h->>'replySha256','') !~ '^[a-f0-9]{64}$' or h->>'scopeSha256' is distinct from subject_hash
  or h->'approved' is distinct from 'true'::jsonb or h->'acknowledgesUnknown' is distinct from 'true'::jsonb
  or h->'allowsExactQuarantine' is distinct from 'true'::jsonb or h->'replayForbidden' is distinct from 'true'::jsonb
  or h->'productionGatesPreserved' is distinct from 'true'::jsonb then return false;end if;
 if jsonb_typeof(h->'approvedAt') is distinct from 'string' then return false;end if;
 approved:=(h->>'approvedAt')::timestamptz;
 if isfinite(approved) is distinct from true or approved<completed or approved>statement_timestamp()+interval '30 seconds' then return false;end if;
 review_hash:=auth_maintenance_hash(p-'rootReview'-'independentReview');
 foreach k in array array['rootReview','independentReview'] loop
  v:=p->k;
  if not auth_maintenance_object(v,array['kind','role','reviewerId','accepted','scopeSha256','evidenceSha256','reviewedAt'])
   or v->>'kind' is distinct from 'fcos_exact_preview_quarantine_review_v1' or v->'accepted' is distinct from 'true'::jsonb
   or v->>'scopeSha256' is distinct from review_hash or coalesce(v->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
   or v->>'role' is distinct from (case when k='rootReview' then 'root' else 'independent' end)
   or (k='rootReview' and v->>'reviewerId' is distinct from '/root')
   or (k='independentReview' and coalesce(v->>'reviewerId','') !~ '^/root/[a-z0-9_]+(/[a-z0-9_]+)*$')
   or jsonb_typeof(v->'reviewedAt') is distinct from 'string' or isfinite((v->>'reviewedAt')::timestamptz) is distinct from true or (v->>'reviewedAt')::timestamptz<approved
   or (v->>'reviewedAt')::timestamptz>statement_timestamp()+interval '30 seconds' then return false;end if;
 end loop;
 return p->'rootReview'->>'evidenceSha256'<>p->'independentReview'->>'evidenceSha256';
exception when others then return false;
end $$;

alter table fcos_release_coordination.exact_preview_uncertainty_quarantines add constraint exact_preview_quarantine_proof
 check(proof_sha256=fcos_release_coordination.auth_maintenance_hash(proof) and fcos_release_coordination.exact_preview_quarantine_proof_valid(proof));

create function fcos_release_coordination.exact_preview_quarantined(id text) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select id='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create' and exists(
  select 1 from exact_preview_uncertainty_quarantines q join control c on c.singleton
  where q.operation_id=id and q.epoch=c.epoch and q.proof_sha256=auth_maintenance_hash(q.proof)
   and exact_preview_quarantine_proof_valid(q.proof)
   and not exists(select 1 from exact_preview_uncertainty_quarantine_revocations z where z.operation_id=q.operation_id))
$$;

create function fcos_release_coordination.admit_exact_preview_uncertainty_quarantine(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;q exact_preview_uncertainty_quarantines%rowtype;e operation_events%rowtype;
begin
 select * into c from control where singleton for update;
 select * into q from exact_preview_uncertainty_quarantines where operation_id=p->>'operationId';
 if q.operation_id is not null then
  if q.proof is distinct from p then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_CONFLICT';end if;
  return jsonb_build_object('disposition','readback','proofSha256',q.proof_sha256,'originalOutcome','unknown','replayAllowed',false);
 end if;
 if not exact_preview_quarantine_proof_valid(p) then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_INVALID';end if;
 select * into e from operation_events where operation_id=p->>'operationId' order by event_id desc limit 1;
 if c.epoch is distinct from 1 or c.mode is distinct from 'qualification' or c.operation_id is distinct from p->>'operationId'
  or c.bootstrap_id is not null or c.recovery_id is not null or c.plan_completion_id is not null or c.source_upgrade_id is not null
  or e.event_id is distinct from 2 or e.state is distinct from 'uncertain' or auth_maintenance_hash(to_jsonb(e)) is distinct from p->>'originalEventSha256'
  or (p->'terminalWriter'->>'observedAt')::timestamptz<clock_timestamp()-interval '10 minutes'
  or exists(select 1 from operations o where o.operation_id<>p->>'operationId' and (select state from operation_events x where x.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete')
  or exists(select 1 from auth_maintenance_fences f left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null)
  or exists(select 1 from registrations where release_id=p->'successor'->>'releaseId')
  or exists(select 1 from qualification_source_upgrades where operation_id=p->'successor'->>'sourceUpgradeId')
 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_STATE_CHANGED';end if;
 insert into exact_preview_uncertainty_quarantines values(p->>'operationId',1,p,auth_maintenance_hash(p),clock_timestamp());
 -- Release the serializer for this contained effect, not its consumed outcome.
 update control set operation_id=null where singleton and operation_id=p->>'operationId';
 return jsonb_build_object('disposition','quarantined','proofSha256',auth_maintenance_hash(p),'originalOutcome','unknown','replayAllowed',false,'productionAuthorityGranted',false,'financialAuthorityGranted',false);
end $$;

create function fcos_release_coordination.revoke_exact_preview_uncertainty_quarantine(id text,proof_hash text,review_hash text) returns void
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
begin
 perform 1 from control where singleton for update;
 if coalesce(review_hash,'') !~ '^[a-f0-9]{64}$' or not exists(select 1 from exact_preview_uncertainty_quarantines q where q.operation_id=id and q.proof_sha256=proof_hash)
 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_INVALID';end if;
 insert into exact_preview_uncertainty_quarantine_revocations values(id,proof_hash,review_hash,clock_timestamp()) on conflict do nothing;
end $$;

create function fcos_release_coordination.exact_preview_quarantine_owner(p jsonb,a jsonb) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select coalesce(p->'epoch'='1'::jsonb and p->'owner'='{"kind":"release","id":"features"}'::jsonb
  and p->>'releaseId'='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022'
  and p->>'manifestHash'='62389788e43dd99e081989f974f7df51e0967120e9aff30b9e72c3ffa1a29583'
  and a->>'runId' ~ '^[1-9][0-9]*$'
  and (not (a ? 'retainedPreviewReadbackOnly') or a->'retainedPreviewReadbackOnly'='true'::jsonb)
  and (a-'runId'-'environment'-'subject'-'legacyContainmentBoundary'-'retainedPreviewReadbackOnly')=(exact_preview_quarantine_original_actor()-'runId'-'environment'-'subject'-'legacyContainmentBoundary')
  and a->>'environment' in ('fcos-hosted-preview','fcos-hosted-verification')
  and a->>'subject'='repo:hocheunglai-oss/fcos:environment:'||(a->>'environment')
  and exact_preview_quarantine_original_bound(),false)
$$;

-- This is the sole additional checker-file allowance. It cannot validate a
-- replacement by itself: the existing proof validator still checks all17 files,
-- exact requests, immutable parent, actual source and independent reviews.
create function fcos_release_coordination.exact_preview_quarantine_checker_change(p jsonb) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select exists(select 1 from exact_preview_uncertainty_quarantines q where exact_preview_quarantined(q.operation_id)
  and p->>'operationId'=q.proof->'successor'->>'sourceUpgradeId'
  and p->'parent'->>'releaseId'='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022'
  and p->'plan'->>'releaseId'=q.proof->'successor'->>'releaseId'
  and p->'setup'->>'controllerSha'=q.proof->'successor'->>'controllerSha'
  and p->'setup'->'qualificationSource'->>'bootstrapSha'=q.proof->'successor'->>'callerSha'
  and p->'setup'->'qualificationSource'->>'ref'=q.proof->'successor'->>'ref'
  and p->>'setupSha256'=q.proof->'successor'->>'setupSha256'
  and auth_maintenance_hash(p->'checkerManifest')=q.proof->'successor'->>'checkerManifestSha256')
$$;

create function fcos_release_coordination.exact_preview_quarantine_transport_change(p jsonb) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select coalesce(exact_preview_quarantine_checker_change(p)
  and jsonb_typeof(p->'setup'->'verification')='object'
  and jsonb_typeof(p->'manifest'->'verification')='object'
  and jsonb_typeof(p->'previous'->'setup'->'verification')='object'
  and jsonb_typeof(p->'previous'->'manifest'->'verification')='object'
  and p->'setup'->'verification'->>'vercelSourceTransport'='fcos_source_api_archive_v1'
  and p->'manifest'->'verification'->>'vercelSourceTransport'='fcos_source_api_archive_v1'
  and not (p->'previous'->'setup'->'verification' ? 'vercelSourceTransport')
  and not (p->'previous'->'manifest'->'verification' ? 'vercelSourceTransport'),false)
$$;

create function fcos_release_coordination.exact_preview_quarantine_successor(r fcos_release_coordination.registrations,a jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare q exact_preview_uncertainty_quarantines%rowtype;s jsonb;u qualification_source_upgrades%rowtype;
begin
 select * into q from exact_preview_uncertainty_quarantines; s:=q.proof->'successor';
 select * into u from qualification_source_upgrades where operation_id=s->>'sourceUpgradeId';
 return coalesce(exact_preview_quarantined(q.operation_id) and r.epoch=1 and r.scope='qualification'
  and r.owner='{"kind":"release","id":"features"}'::jsonb and r.release_id=s->>'releaseId'
  and r.manifest->'controller'->>'sha'=s->>'controllerSha' and r.manifest->'candidate'->>'sha'=s->>'candidateSha'
  and r.manifest->>'setupSha256'=s->>'setupSha256'
  and r.manifest->'qualificationSource'->>'ref'=s->>'ref' and r.manifest->'qualificationSource'->>'bootstrapSha'=s->>'callerSha'
  and a->>'repositoryId'=s->>'repositoryId' and a->>'actorId'=s->>'actorId' and a->>'actor'=s->>'actor'
  and qualification_source_upgrade_principal(u.proof,a) and qualification_source_upgrade_proof_valid(u.proof)
  and u.admitted_at>=q.recorded_at and u.release_id=r.release_id and u.manifest_hash=r.manifest_hash
  and u.proof->'parent'->>'releaseId'='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022'
  and qualification_source_upgrade_started(u.operation_id),false);
end $$;

create function fcos_release_coordination.exact_preview_quarantine_new_write(p jsonb,a jsonb) returns void
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;r registrations%rowtype;q exact_preview_uncertainty_quarantines%rowtype;
begin
 if not exists(select 1 from exact_preview_uncertainty_quarantines) then return;end if;
 if exists(select 1 from operations o where (select state from operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete' and not exact_preview_quarantined(o.operation_id))
 then raise exception 'COORDINATION_UNRESOLVED_OPERATION';end if;
 select * into q from exact_preview_uncertainty_quarantines;
 if (select state from operation_events where operation_id=q.operation_id order by event_id desc limit 1)='complete' then return;end if;
 select * into c from control where singleton;select * into r from registrations where release_id=p->>'releaseId';
 if not exact_preview_quarantined(q.operation_id) or a->>'kind' is distinct from 'github' or r.owner is distinct from '{"kind":"release","id":"features"}'::jsonb
  or (c.mode='qualification' and not exact_preview_quarantine_successor(r,a))
  or (c.mode='active' and r.scope is distinct from 'release')
 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SUCCESSOR_REQUIRED';end if;
end $$;

-- Change only recognized source bodies, retaining OIDs/security/search paths/ACLs.
do $patch$
declare sig text;expected text;definition text;needle text;replacement text;before jsonb;after jsonb;
begin
 select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) into before from pg_proc
 where oid=any(array['fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.dispatch_without_auth_maintenance(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.qualification_source_upgrade_quiescent()'::regprocedure,'fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure,'fcos_release_coordination.activate(bigint,jsonb)'::regprocedure]::oid[]);
 for sig,expected in select * from (values
 ('dispatch(text,jsonb,jsonb)','1ef9bf33502bccf4425b5cdef25980eba46d80e334e3952e697492bc7898c573'),
 ('dispatch_without_auth_maintenance(text,jsonb,jsonb)','c6301be9e321c6e35ab6cc5797a88bb7f2ad55bdddd1bbcbc7a02ac0fa948b53'),
 ('qualification_source_upgrade_quiescent()','cfa3897635b3d5bd05ef1d4ce083005da06409e9b10369169af42fb5c15c60a1'),
 ('qualification_source_upgrade_proof_valid(jsonb)','49a99f98998859e8c62665ced11a09698830a3e9eec6d1239af7dd1911f45bda'),
 ('activate(bigint,jsonb)','0de88251228e3e4d6cbb55c3984808a9b42113e52dd65095e49ff306ebb352d2')) v loop
  if not exists(select 1 from pg_proc where oid=('fcos_release_coordination.'||sig)::regprocedure
   and encode(sha256(convert_to(prosrc,'UTF8')),'hex')=expected and proowner='fcos_coordinator_owner'::regrole
   and proconfig=array['search_path=pg_catalog, fcos_release_coordination']::text[]
   and prosecdef=(sig not in ('qualification_source_upgrade_quiescent()','qualification_source_upgrade_proof_valid(jsonb)'))
   and proacl::text=(case when sig='dispatch(text,jsonb,jsonb)' then '{fcos_coordinator_owner=X/fcos_coordinator_owner,fcos_coordinator_runtime=X/fcos_coordinator_owner}'
    when sig='dispatch_without_auth_maintenance(text,jsonb,jsonb)' then '{fcos_coordinator_owner=X/fcos_coordinator_owner}'
    else '{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}' end))
  then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 end loop;
 definition:=pg_get_functiondef('fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure);
 needle:='(a->>''path''<>''supabase/functions/release-coordinator/approval.mjs'' and a is distinct from b)';
 replacement:='(a->>''path''<>''supabase/functions/release-coordinator/approval.mjs'' and a is distinct from b and not (a->>''path'' in (''supabase/functions/release-coordinator/auth.mjs'',''supabase/functions/release-coordinator/core.mjs'') and exact_preview_quarantine_checker_change(p)))';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 definition:=replace(definition,needle,replacement);
 needle:='((p->''setup'')-''controllerSha''-''qualificationSource'') is distinct from ((old->''setup'')-''controllerSha''-''qualificationSource'')';
 replacement:='((case when exact_preview_quarantine_transport_change(p) then jsonb_set(p->''setup'',''{verification}'',(p->''setup''->''verification'')-''vercelSourceTransport'') else p->''setup'' end)-''controllerSha''-''qualificationSource'') is distinct from ((old->''setup'')-''controllerSha''-''qualificationSource'')';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 definition:=replace(definition,needle,replacement);
 needle:='((p->''manifest'')-''releaseId''-''setupSha256''-''qualificationSource''-''controller'') is distinct from ((old->''manifest'')-''releaseId''-''setupSha256''-''qualificationSource''-''controller'')';
 replacement:='((case when exact_preview_quarantine_transport_change(p) then jsonb_set(p->''manifest'',''{verification}'',(p->''manifest''->''verification'')-''vercelSourceTransport'') else p->''manifest'' end)-''releaseId''-''setupSha256''-''qualificationSource''-''controller'') is distinct from ((old->''manifest'')-''releaseId''-''setupSha256''-''qualificationSource''-''controller'')';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('fcos_release_coordination.qualification_source_upgrade_quiescent()'::regprocedure);
 needle:='is distinct from ''complete'')';replacement:='is distinct from ''complete'' and not exact_preview_quarantined(o.operation_id))';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure);
 needle:=' select * into c from control where singleton for update;';
 replacement:=needle||E'\n if action in (''begin'',''claim'') and not exists(select 1 from operations x where x.release_id=p->>''releaseId'' and x.phase=p->>''phase'') then perform exact_preview_quarantine_new_write(p,principal);end if;';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('fcos_release_coordination.dispatch_without_auth_maintenance(text,jsonb,jsonb)'::regprocedure);
 needle:='  if principal->''qualificationOnly''=''true''::jsonb then';
 replacement:=E'  if exists(select 1 from exact_preview_uncertainty_quarantines) and p->>''releaseId''=''fcos-qualification-6a3fbd8f-2ef733d1-source-20261022'' and action in (''snapshot'',''readback'') and not exact_preview_quarantine_owner(p,principal) then raise exception ''COORDINATION_EXACT_PREVIEW_QUARANTINE_OWNER_INVALID'';end if;\n'||needle;
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 definition:=replace(definition,needle,replacement);
 needle:='if c.mode<>''qualification'' or principal->>''kind''<>''github'' or action in';
 replacement:='if (c.mode<>''qualification'' and not (action in (''snapshot'',''readback'') and exists(select 1 from exact_preview_uncertainty_quarantines) and exact_preview_quarantine_owner(p,principal))) or principal->>''kind''<>''github'' or action in';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 definition:=replace(definition,needle,replacement);
 needle:='if c.operation_id is distinct from o.operation_id then raise exception ''COORDINATION_LOCK_MISMATCH''; end if;';
 replacement:='if c.operation_id is distinct from o.operation_id and not (action=''readback'' and o.phase=''preview.create'' and exists(select 1 from exact_preview_uncertainty_quarantines q where q.operation_id=o.operation_id) and exact_preview_quarantine_owner(p,principal)) then raise exception ''COORDINATION_LOCK_MISMATCH''; end if;';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 definition:=replace(definition,needle,replacement);
 needle:='if state_value=''complete'' then update fcos_release_coordination.control set operation_id=null where singleton; end if;';
 replacement:='if state_value=''complete'' then update fcos_release_coordination.control set operation_id=null where singleton and operation_id=o.operation_id; end if;';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('fcos_release_coordination.activate(bigint,jsonb)'::regprocedure);
 needle:='  select * into c from fcos_release_coordination.control where singleton for update;';
 replacement:=needle||E'\n  if exists(select 1 from exact_preview_uncertainty_quarantines q where (select state from operation_events e where e.operation_id=q.operation_id order by event_id desc limit 1) is distinct from ''complete'' and (not exact_preview_quarantined(q.operation_id) or qualification->>''previewUncertaintyQuarantineSha256'' is distinct from q.proof_sha256 or not exists(select 1 from registrations rr where rr.manifest_hash=qualification->>''manifestHash'' and exact_preview_quarantine_successor(rr,rr.registration_actor)))) then raise exception ''COORDINATION_EXACT_PREVIEW_QUARANTINE_ACTIVATION_REQUIRED'';end if;\n  if exists(select 1 from operations o where (select state from operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from ''complete'' and not exact_preview_quarantined(o.operation_id)) then raise exception ''COORDINATION_UNRESOLVED_OPERATION'';end if;';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) into after from pg_proc
 where oid=any(array['fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.dispatch_without_auth_maintenance(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.qualification_source_upgrade_quiescent()'::regprocedure,'fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure,'fcos_release_coordination.activate(bigint,jsonb)'::regprocedure]::oid[]);
 if before is distinct from after then raise exception 'COORDINATION_EXACT_PREVIEW_QUARANTINE_IDENTITY_CHANGED';end if;
end $patch$;

-- Authenticated database metadata access preserves the original journal even
-- when no fresh job can produce the historical GitHub workflow identity. This
-- read is not provider-outcome recovery and grants no original writer lease.
create function fcos_release_coordination.read_exact_preview_uncertainty() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare id constant text:='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create';result jsonb;
begin
 if not exact_preview_quarantine_original_bound() then raise exception 'COORDINATION_EXACT_PREVIEW_HISTORY_NOT_BOUND';end if;
 select jsonb_build_object('schemaVersion',1,'kind','fcos_exact_preview_uncertainty_metadata_history_v1',
  'registration',(select to_jsonb(r) from registrations r join operations o using(release_id) where o.operation_id=id),
  'operation',(select to_jsonb(o) from operations o where o.operation_id=id),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.event_id),'[]'::jsonb) from operation_events e where e.operation_id=id),
  'originalOutcome','unknown','replayAllowed',false,
  'observedBy',jsonb_build_object('databaseSessionUser',session_user::text)) into result;
 return result;
end $$;

do $$ declare t text;f regprocedure;begin
 foreach t in array array['exact_preview_uncertainty_quarantines','exact_preview_uncertainty_quarantine_revocations'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime',t);
  execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and proname like '%exact_preview%' loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f);
 end loop;
end $$;
grant execute on function fcos_release_coordination.admit_exact_preview_uncertainty_quarantine(jsonb),fcos_release_coordination.revoke_exact_preview_uncertainty_quarantine(text,text,text),fcos_release_coordination.read_exact_preview_uncertainty() to postgres;
commit;
