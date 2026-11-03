-- One distinct, append-only completion of the accepted qualification plan.
-- No public catalog, previous proof/event, source, setup or authority is reset.
begin;
create table fcos_release_coordination.qualification_plan_completions(
 operation_id text primary key check(operation_id='qualification-plan-completion-epoch1-39672498844-v1'),
 epoch bigint not null unique references fcos_release_coordination.epochs,
 previous_recovery_id text not null unique references fcos_release_coordination.qualification_schema_recoveries,
 proof jsonb not null,proof_sha256 text not null,admitted_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.qualification_plan_completion_intents(
 operation_id text primary key references fcos_release_coordination.qualification_plan_completions,
 request jsonb not null,request_sha256 text not null,intended_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.qualification_plan_completion_events(
 event_id bigint generated always as identity primary key,
 operation_id text not null unique references fcos_release_coordination.qualification_plan_completion_intents,
 state text not null check(state='applied'),evidence jsonb not null,evidence_sha256 text not null,
 recorded_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.qualification_plan_completion_finishes(
 operation_id text primary key references fcos_release_coordination.qualification_plan_completions,
 proof_sha256 text not null,finished_at timestamptz not null default clock_timestamp());
alter table fcos_release_coordination.control add column plan_completion_id text references fcos_release_coordination.qualification_plan_completions;
alter table fcos_release_coordination.control add constraint coordination_plan_completion_one_writer
 check(plan_completion_id is null or operation_id is null and bootstrap_id is null and recovery_id is null);

-- The private authenticated caller inspects actual source/review evidence.
-- Hashes/reviewer labels bind integrity and scope; they do not authenticate it.
create function fcos_release_coordination.qualification_plan_completion_proof_valid(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare r qualification_schema_recoveries%rowtype; old jsonb; f jsonb; m jsonb; review jsonb; k text;
begin
 if not auth_maintenance_object(p,array['schemaVersion','kind','epoch','operationId','previousRecoveryId','previousRecoveryProofSha256',
   'previousPlanSha256','setupSha256','plan','planSha256','terminalFailure','manifestPreflight','ownerReadbackSha256','request','rootReview','independentReview'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'kind' is distinct from 'fcos_qualification_plan_completion_v1'
  or p->'epoch' is distinct from '1'::jsonb or p->>'operationId' is distinct from 'qualification-plan-completion-epoch1-39672498844-v1'
  or p->>'previousRecoveryId' is distinct from 'qualification-schema-recovery-epoch1-39653018028-v1'
 then return false; end if;
 select * into r from qualification_schema_recoveries where recovery_id=p->>'previousRecoveryId';old:=r.proof;
 if r.recovery_id is null or r.epoch<>1 or not qualification_schema_recovery_proof_valid(old)
  or r.proof_sha256 is distinct from auth_maintenance_hash(old) or r.proof_sha256 is distinct from p->>'previousRecoveryProofSha256'
  or not exists(select 1 from qualification_schema_recovery_finishes z where z.recovery_id=r.recovery_id and z.proof_sha256=r.proof_sha256)
  or (select count(*) from qualification_schema_recovery_actions where recovery_id=r.recovery_id)<>3
  or exists(select 1 from qualification_schema_recovery_actions a where a.recovery_id=r.recovery_id and
    (select state from qualification_schema_recovery_events e where e.recovery_id=a.recovery_id and e.action_id=a.action_id order by event_id desc limit 1) is distinct from 'applied')
  or old->>'planSha256' is distinct from p->>'previousPlanSha256' or old->>'setupSha256' is distinct from p->>'setupSha256'
  or old->'plan'->'runtime'->'expectedPreview' is distinct from 'null'::jsonb
  or p->'plan' is distinct from jsonb_set(old->'plan','{runtime,expectedPreview}',p->'plan'->'runtime'->'expectedPreview',false)
  or auth_maintenance_hash(p->'plan') is distinct from p->>'planSha256'
  or auth_maintenance_hash(p->'plan'->'runtime'->'expectedPreview') is distinct from 'ce69bfac777f6886f13326f8a6972ae73d6121f4aa4dda33c26ee313caa0cc59'
  or p->'plan'->>'releaseId' is distinct from 'fcos-qualification-64aa338b-2ef733d1-schema-20261022'
  or p->'plan'->>'stage' is distinct from 'qualification' or p->'plan'->>'executionMode' is distinct from 'qualification'
  or p->'plan'->'scope'->'financialAuthority' is distinct from 'false'::jsonb
  or p->'plan'->'migration'->>'mode' is distinct from 'none'
  or p->'plan'->'migration'->>'expectedSchemaSha256' is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'
  or p->'request' is distinct from (qualification_schema_recovery_actions_for(old->'setup',p->'plan')->2->'request')
  or jsonb_typeof(p->'ownerReadbackSha256') is distinct from 'string' or coalesce(p->>'ownerReadbackSha256','') !~ '^[a-f0-9]{64}$'
 then return false; end if;
 f:=p->'terminalFailure';m:=p->'manifestPreflight';
 if not auth_maintenance_object(f,array['runId','runAttempt','status','conclusion','failedStep','code','beforeRegistration','providerEvidenceSha256','prepareLogSha256'])
  or f->>'runId' is distinct from '39672498844' or f->>'runAttempt' is distinct from '1' or f->>'status' is distinct from 'completed'
  or f->>'conclusion' is distinct from 'failure' or f->>'failedStep' is distinct from 'Prepare actual qualification manifest'
  or f->>'code' is distinct from 'RUNTIME_EXPECTATIONS' or f->'beforeRegistration' is distinct from 'true'::jsonb
  or jsonb_typeof(f->'runId') is distinct from 'string' or jsonb_typeof(f->'runAttempt') is distinct from 'string'
  or f->>'providerEvidenceSha256' is distinct from '8493774013ae81498e1ad0adb1150e65726b1c6b7daff20e7cc44d7eec2070d8'
  or f->>'prepareLogSha256' is distinct from '9b42d50ed8234a0977792410897b11c4a3d5522f6b7b6f6d0e970b7f7884879f'
  or not auth_maintenance_object(m,array['accepted','complete','controllerSha','candidateSha','setupSha256','previousPlanSha256','planSha256','manifestSha256','sourceEvidenceSha256'])
  or m->'accepted' is distinct from 'true'::jsonb or m->'complete' is distinct from 'true'::jsonb
  or m->>'controllerSha' is distinct from '64aa338b04cee7e05bde0ca9bfd10b81ac001a65'
  or m->>'candidateSha' is distinct from '2ef733d17dd12314c72971c2220b2b09903a6bf0'
  or m->>'setupSha256' is distinct from p->>'setupSha256' or m->>'previousPlanSha256' is distinct from p->>'previousPlanSha256'
  or m->>'planSha256' is distinct from p->>'planSha256'
  or m->>'manifestSha256' is distinct from 'e73dcbc3a6e4a75646218d6652dccbc7b422409d3faee7d52268cb67681b8e41'
  or m->>'sourceEvidenceSha256' is distinct from '44431a9c531e75a9b7b1aeef5f36b26f6ffc5ba5eb59a5c4f07a60e5aab946ab'
 then return false; end if;
 foreach k in array array['rootReview','independentReview'] loop
  review:=p->k;
  if not auth_maintenance_object(review,array['kind','role','reviewerId','accepted','subjectSha256','sourceEvidenceSha256','reviewedAt'])
   or review->>'kind' is distinct from 'fcos_qualification_plan_completion_review_v1' or review->'accepted' is distinct from 'true'::jsonb
   or review->>'role' is distinct from (case when k='rootReview' then 'root' else 'independent' end)
   or review->>'reviewerId' is distinct from (case when k='rootReview' then '/root' else '/root/canonical_publication_review' end)
   or review->>'subjectSha256' is distinct from auth_maintenance_hash(p-'rootReview'-'independentReview')
   or jsonb_typeof(review->'sourceEvidenceSha256') is distinct from 'string' or coalesce(review->>'sourceEvidenceSha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(review->'reviewedAt') is distinct from 'string' then return false; end if;
  begin
   if not isfinite((review->>'reviewedAt')::timestamptz) or (review->>'reviewedAt')::timestamptz > statement_timestamp()+interval '30 seconds' then return false; end if;
  exception when others then return false; end;
 end loop;
 return true;
exception when others then return false;
end $$;
alter table fcos_release_coordination.qualification_plan_completions add constraint plan_completion_valid_proof
 check(fcos_release_coordination.qualification_plan_completion_proof_valid(proof) and proof_sha256=fcos_release_coordination.auth_maintenance_hash(proof));


-- Row checks defend the finite body/ACK contract even on direct private inserts.
-- The existing authenticated postgres owner remains the authority boundary.
create function fcos_release_coordination.qualification_plan_completion_intent_valid(id text,r jsonb,h text) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select coalesce((select qualification_plan_completion_proof_valid(a.proof) and r=a.proof->'request' and h=auth_maintenance_hash(r)
 from qualification_plan_completions a where a.operation_id=id),false)
$$;
create function fcos_release_coordination.qualification_plan_completion_ack_valid(id text,e jsonb) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select coalesce((select auth_maintenance_object(e,array['basis','outcome','requestSha256','providerEvidenceSha256','rootReviewSha256','response'])
 and e->>'basis'='native_ack' and e->>'outcome'='applied' and e->>'requestSha256'=i.request_sha256
 and e->>'rootReviewSha256'=auth_maintenance_hash(a.proof->'rootReview')
 and e->'response'='{"completed":true,"status":204,"exitCode":0,"bodyEmpty":true}'::jsonb
 and e->>'providerEvidenceSha256'=auth_maintenance_hash(e->'response')
 from qualification_plan_completions a join qualification_plan_completion_intents i using(operation_id) where a.operation_id=id),false)
$$;
alter table fcos_release_coordination.qualification_plan_completion_intents add constraint plan_completion_valid_request
 check(fcos_release_coordination.qualification_plan_completion_intent_valid(operation_id,request,request_sha256));
alter table fcos_release_coordination.qualification_plan_completion_events add constraint plan_completion_valid_ack
 check(fcos_release_coordination.qualification_plan_completion_ack_valid(operation_id,evidence) and evidence_sha256=fcos_release_coordination.auth_maintenance_hash(evidence));

create function fcos_release_coordination.admit_qualification_plan_completion(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; a qualification_plan_completions%rowtype;
begin
 select * into c from control where singleton for update;
 select * into a from qualification_plan_completions where operation_id=p->>'operationId';
 if a.operation_id is not null then
  if a.proof is distinct from p then raise exception 'COORDINATION_PLAN_COMPLETION_CONFLICT'; end if;
  return jsonb_build_object('disposition','readback','operationId',a.operation_id,'proofSha256',a.proof_sha256);
 end if;
 if qualification_schema_recovery_catalog_digest() is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d' then raise exception 'COORDINATION_PLAN_COMPLETION_LIVE_SCHEMA_CHANGED'; end if;
 if not qualification_plan_completion_proof_valid(p) or c.epoch<>1 or c.mode<>'qualification'
  or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null or c.plan_completion_id is not null
  or exists(select 1 from registrations where epoch=1) or exists(select 1 from operations where epoch=1)
  or exists(select 1 from legacy_release_containments where epoch=1)
  or exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null)
 then raise exception 'COORDINATION_PLAN_COMPLETION_ADMISSION_INVALID'; end if;
 insert into qualification_plan_completions values(p->>'operationId',1,p->>'previousRecoveryId',p,auth_maintenance_hash(p),clock_timestamp());
 update control set plan_completion_id=p->>'operationId' where singleton;
 return jsonb_build_object('disposition','admitted','operationId',p->>'operationId','proofSha256',auth_maintenance_hash(p),'epoch',1,'providerAuthorityGranted',false);
end $$;
create function fcos_release_coordination.qualification_plan_completion_snapshot(id text,proof_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_plan_completions%rowtype;
begin
 select * into a from qualification_plan_completions where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_PLAN_COMPLETION_BINDING_CHANGED'; end if;
 return jsonb_build_object('completion',to_jsonb(a),'control',(select to_jsonb(c) from control c where singleton),
  'intent',(select to_jsonb(i) from qualification_plan_completion_intents i where operation_id=id),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by event_id) from qualification_plan_completion_events e where operation_id=id),'[]'::jsonb),
  'finished',exists(select 1 from qualification_plan_completion_finishes where operation_id=id));
end $$;
create function fcos_release_coordination.qualification_plan_completion_intent(id text,proof_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; a qualification_plan_completions%rowtype; i qualification_plan_completion_intents%rowtype;
begin
 select * into c from control where singleton for update;
 select * into a from qualification_plan_completions where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_PLAN_COMPLETION_BINDING_CHANGED'; end if;
 select * into i from qualification_plan_completion_intents where operation_id=id;
 if i.operation_id is not null then return jsonb_build_object('disposition','readback','operationId',id,'proofSha256',proof_hash,'request',i.request,'requestSha256',i.request_sha256,'epoch',1); end if;
 if qualification_schema_recovery_catalog_digest() is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d' then raise exception 'COORDINATION_PLAN_COMPLETION_LIVE_SCHEMA_CHANGED'; end if;
 if c.epoch<>a.epoch or c.mode<>'qualification' or c.plan_completion_id is distinct from id
  or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or not qualification_plan_completion_proof_valid(a.proof) or exists(select 1 from qualification_plan_completion_finishes where operation_id=id)
  or exists(select 1 from registrations where epoch=1) or exists(select 1 from operations where epoch=1)
 then raise exception 'COORDINATION_PLAN_COMPLETION_NOT_HELD'; end if;
 insert into qualification_plan_completion_intents values(id,a.proof->'request',auth_maintenance_hash(a.proof->'request'),clock_timestamp()) returning * into i;
 return jsonb_build_object('disposition','execute','operationId',id,'proofSha256',proof_hash,'request',i.request,'requestSha256',i.request_sha256,'epoch',1);
end $$;
create function fcos_release_coordination.record_qualification_plan_completion(id text,proof_hash text,evidence jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; a qualification_plan_completions%rowtype; i qualification_plan_completion_intents%rowtype; e qualification_plan_completion_events%rowtype;
begin
 select * into c from control where singleton for update;
 select * into a from qualification_plan_completions where operation_id=id;select * into i from qualification_plan_completion_intents where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash or i.operation_id is null
  or not auth_maintenance_object(evidence,array['basis','outcome','requestSha256','providerEvidenceSha256','rootReviewSha256','response'])
  or evidence->>'basis' is distinct from 'native_ack' or evidence->>'outcome' is distinct from 'applied'
  or evidence->>'requestSha256' is distinct from i.request_sha256 or evidence->>'rootReviewSha256' is distinct from auth_maintenance_hash(a.proof->'rootReview')
  or evidence->'response' is distinct from '{"completed":true,"status":204,"exitCode":0,"bodyEmpty":true}'::jsonb
  or evidence->>'providerEvidenceSha256' is distinct from auth_maintenance_hash(evidence->'response')
 then raise exception 'COORDINATION_PLAN_COMPLETION_KNOWN_ACK_REQUIRED'; end if;
 select * into e from qualification_plan_completion_events where operation_id=id;
 if e.operation_id is not null then
  if e.evidence is distinct from evidence then raise exception 'COORDINATION_PLAN_COMPLETION_TERMINAL'; end if;
  return jsonb_build_object('disposition','readback','state','applied');
 end if;
 if c.epoch<>a.epoch or c.mode<>'qualification' or c.plan_completion_id is distinct from id or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
 then raise exception 'COORDINATION_PLAN_COMPLETION_NOT_HELD'; end if;
 insert into qualification_plan_completion_events(operation_id,state,evidence,evidence_sha256) values(id,'applied',evidence,auth_maintenance_hash(evidence));
 return jsonb_build_object('disposition','recorded','state','applied');
end $$;
create function fcos_release_coordination.finish_qualification_plan_completion(id text,proof_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; a qualification_plan_completions%rowtype;
begin
 select * into c from control where singleton for update;select * into a from qualification_plan_completions where operation_id=id;
 if a.operation_id is null or a.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_PLAN_COMPLETION_BINDING_CHANGED'; end if;
 if exists(select 1 from qualification_plan_completion_finishes where operation_id=id) then return jsonb_build_object('disposition','complete','operationId',id,'epoch',1); end if;
 if c.epoch<>a.epoch or c.mode<>'qualification' or c.plan_completion_id is distinct from id
  or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or not qualification_plan_completion_proof_valid(a.proof) or exists(select 1 from registrations where epoch=1) or exists(select 1 from operations where epoch=1)
  or not exists(select 1 from qualification_plan_completion_events where operation_id=id and state='applied')
 then raise exception 'COORDINATION_PLAN_COMPLETION_UNRESOLVED'; end if;
 insert into qualification_plan_completion_finishes values(id,proof_hash,clock_timestamp());update control set plan_completion_id=null where singleton;
 return jsonb_build_object('disposition','complete','operationId',id,'epoch',1);
end $$;

-- A derived overlay, never an edit to either completed historical proof.
create function fcos_release_coordination.qualification_plan_completion_project(e bigint,base jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_plan_completions%rowtype; projected jsonb;
begin
 select * into a from qualification_plan_completions where epoch=e;
 if a.operation_id is null then return base; end if;
 if not qualification_plan_completion_proof_valid(a.proof) then return null; end if;
 projected:=base||jsonb_build_object('plan',a.proof->'plan','planSha256',a.proof->'planSha256');
 projected:=jsonb_set(projected,'{actions}',jsonb_build_array(base->'actions'->0,jsonb_build_object('id','dispatch_qualification','request',a.proof->'request')));
 if not cutover_bootstrap_proof_valid(projected) then return null; end if;return projected;
end $$;

-- Pin installed6596 bodies before replacing only these six exact definitions.
-- CREATE OR REPLACE via pg_get_functiondef retains OID/ACL/owner/config.
do $$ declare sig text; expected text; definition text; needle text; replacement text; begin
 for sig,expected in select * from (values
  ('qualification_schema_recovery_effective_proof(bigint)','4a52c3109184c4b480f5d56aaaa7ff92b19b6eb82d148d982e13df5bbf320006'),
  ('qualification_schema_recovery_pending(text,jsonb,jsonb)','0ffdbc5ae93b6df2650a8e994974c14112f8bd69f31f230b65369de704d7c96c'),
  ('qualification_schema_recovery_claim_ready(jsonb)','1d1870f31816b2a29822110bf9177194bb9b24693bfd5773439a664ab7d3f14f'),
  ('dispatch(text,jsonb,jsonb)','60d8fc4cb75f3b2bb5e219f0bb2436167ed2b7770a23b41846475ed64e794b0a'),
  ('install_epoch(bigint,jsonb)','4c7302651f2a85911c7446be83d6d1f05b1ccf41c1f7d9dbe7c6678260c71cd7'),
  ('activate(bigint,jsonb)','a2fafa5619f94462f658018a3a820f0e3819f4fe95d148ec0068e64cf0383038')) x loop
  if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=('fcos_release_coordination.'||sig)::regprocedure) is distinct from expected
  then raise exception 'COORDINATION_PLAN_COMPLETION_SOURCE_DRIFT'; end if;
 end loop;
 definition:=pg_get_functiondef('fcos_release_coordination.qualification_schema_recovery_effective_proof(bigint)'::regprocedure);
 needle:='if not cutover_bootstrap_proof_valid(projected) then return null; end if;return projected;';
 replacement:='if not cutover_bootstrap_proof_valid(projected) then return null; end if;return qualification_plan_completion_project(e,projected);';
 if position(needle in definition)=0 then raise exception 'COORDINATION_PLAN_COMPLETION_SOURCE_DRIFT'; end if;execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('fcos_release_coordination.qualification_schema_recovery_pending(text,jsonb,jsonb)'::regprocedure);
 needle:='if c.recovery_id is not null then return action=''register''; end if;';
 if position(needle in definition)=0 then raise exception 'COORDINATION_PLAN_COMPLETION_SOURCE_DRIFT'; end if;
 execute replace(definition,needle,'if c.recovery_id is not null or c.plan_completion_id is not null then return action=''register''; end if;');
 definition:=pg_get_functiondef('fcos_release_coordination.qualification_schema_recovery_claim_ready(jsonb)'::regprocedure);
 needle:=' select * into r from registrations where release_id=p->>''releaseId'';';
 if position(needle in definition)=0 then raise exception 'COORDINATION_PLAN_COMPLETION_SOURCE_DRIFT'; end if;
 execute replace(definition,needle,E' if exists(select 1 from control where singleton and plan_completion_id is not null) then return false; end if;\n'||needle);
 definition:=pg_get_functiondef('fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure);
 needle:=' select * into c from control where singleton for update;';
 if position(needle in definition)=0 then raise exception 'COORDINATION_PLAN_COMPLETION_SOURCE_DRIFT'; end if;
 execute replace(definition,needle,needle||E'\n if c.plan_completion_id is not null and (action=\'register\' or action in (\'begin\',\'claim\') and not exists(select 1 from operations x where x.release_id=p->>\'releaseId\' and x.phase=p->>\'phase\')) then raise exception \'COORDINATION_BOOTSTRAP_BUSY\'; end if;');
 foreach sig in array array['install_epoch(bigint,jsonb)','activate(bigint,jsonb)'] loop
  definition:=pg_get_functiondef(('fcos_release_coordination.'||sig)::regprocedure);
  needle:='  select * into c from fcos_release_coordination.control where singleton for update;';
  if position(needle in definition)=0 then raise exception 'COORDINATION_PLAN_COMPLETION_SOURCE_DRIFT'; end if;
  execute replace(definition,needle,needle||E'\n  if c.plan_completion_id is not null then raise exception \'COORDINATION_BOOTSTRAP_BUSY\'; end if;');
 end loop;
end $$;
do $$ declare t text; f regprocedure; begin
 foreach t in array array['qualification_plan_completions','qualification_plan_completion_intents','qualification_plan_completion_events','qualification_plan_completion_finishes'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime',t);
  execute format('create trigger plan_completion_append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and
  (proname like 'qualification_plan_completion_%' or proname in ('admit_qualification_plan_completion','record_qualification_plan_completion','finish_qualification_plan_completion')) loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f);
  execute format('grant execute on function %s to postgres',f);
 end loop;
end $$;
commit;
