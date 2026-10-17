-- Private coordination only. No provider authority, credentials, public RPC, or TTL leases.
create schema if not exists fcos_release_coordination;
revoke all on schema fcos_release_coordination from public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='fcos_coordinator_owner') then
    create role fcos_coordinator_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname='fcos_coordinator_runtime') then
    create role fcos_coordinator_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
-- Supabase postgres is CREATEROLE, not superuser; PG17 grants the creator ADMIN
-- without SET. Only the existing migration administrator receives owner membership.
grant fcos_coordinator_owner to postgres;
alter schema fcos_release_coordination owner to fcos_coordinator_owner;
grant usage on schema fcos_release_coordination to fcos_coordinator_runtime;

create table fcos_release_coordination.epochs (
  epoch bigint primary key check (epoch > 0),
  activation_evidence jsonb not null,
  activated_at timestamptz not null default clock_timestamp()
);
create unique index coordination_notification_challenge_unique on fcos_release_coordination.epochs ((activation_evidence->'notificationChallenge'->>'challenge'));
create table fcos_release_coordination.control (
  singleton boolean primary key default true check (singleton),
  epoch bigint references fcos_release_coordination.epochs(epoch),
  operation_id text,
  mode text not null default 'frozen' check(mode in ('frozen','qualification','active'))
);
insert into fcos_release_coordination.control(singleton) values(true);
create table fcos_release_coordination.registrations (
  release_id text primary key,
  epoch bigint not null references fcos_release_coordination.epochs(epoch),
  owner jsonb not null,
  manifest jsonb not null,
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  scope text not null check (scope in ('qualification','release','financial')),
  registration_actor jsonb not null,
  registered_at timestamptz not null default clock_timestamp()
);
create table fcos_release_coordination.registration_runs (
  release_id text not null references fcos_release_coordination.registrations(release_id),
  run_id text not null,
  run_attempt text not null check(run_attempt='1'),
  actor jsonb not null,
  registered_at timestamptz not null default clock_timestamp(),
  primary key(release_id,run_id,run_attempt)
);
create table fcos_release_coordination.resume_admissions (
  release_id text not null references fcos_release_coordination.registrations(release_id),
  run_id text not null,
  authorization_event_id bigint not null,
  receipt jsonb not null,
  admitted_at timestamptz not null default clock_timestamp(),
  primary key(release_id,run_id,authorization_event_id)
);
create table fcos_release_coordination.operations (
  operation_id text primary key,
  release_id text not null references fcos_release_coordination.registrations(release_id),
  epoch bigint not null references fcos_release_coordination.epochs(epoch),
  phase text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null,
  actor jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(release_id, phase)
);
alter table fcos_release_coordination.control add constraint coordination_current_operation
  foreign key(operation_id) references fcos_release_coordination.operations(operation_id);
create table fcos_release_coordination.operation_events (
  event_id bigint generated always as identity primary key,
  operation_id text not null references fcos_release_coordination.operations(operation_id),
  state text not null check (state in ('intent','uncertain','complete')),
  evidence jsonb not null,
  evidence_hash text not null,
  actor jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index coordination_operation_event_order on fcos_release_coordination.operation_events(operation_id,event_id desc);
create table fcos_release_coordination.evidence (
  evidence_id text primary key,
  evidence_event_id bigint generated always as identity unique not null,
  release_id text not null references fcos_release_coordination.registrations(release_id),
  evidence jsonb not null,
  evidence_hash text not null,
  actor jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table fcos_release_coordination.activations (
  epoch bigint primary key references fcos_release_coordination.epochs(epoch),
  proof jsonb not null,
  activated_at timestamptz not null default clock_timestamp()
);
create table fcos_release_coordination.approval_admissions (
  release_id text not null references fcos_release_coordination.registrations(release_id),
  run_id text not null,
  run_attempt text not null check(run_attempt='1'),
  actor jsonb not null,
  observed_at timestamptz not null default clock_timestamp(),
  primary key(release_id,run_id,run_attempt)
);
-- Explicit human renewals append a session; no prior admission or expiry is updated.
create table fcos_release_coordination.authorizations (
  authorization_event_id bigint generated always as identity primary key,
  release_id text not null references fcos_release_coordination.registrations(release_id),
  run_id text not null,
  run_attempt text not null check(run_attempt='1'),
  approved_job_id bigint not null unique,
  manifest_hash text not null,
  epoch bigint not null,
  receipt jsonb not null,
  admitted_at timestamptz not null,
  expires_at timestamptz not null,
  unique(release_id,run_id,run_attempt),
  check(expires_at=admitted_at+interval '24 hours')
);
create index coordination_authorization_session_order on fcos_release_coordination.authorizations(release_id,authorization_event_id desc);
alter table fcos_release_coordination.resume_admissions add constraint coordination_resume_authorization
  foreign key(authorization_event_id) references fcos_release_coordination.authorizations(authorization_event_id);
create table fcos_release_coordination.finishes (
  release_id text primary key references fcos_release_coordination.registrations(release_id),
  evidence jsonb not null,
  evidence_hash text not null,
  actor jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table fcos_release_coordination.imported_uncertainty (
  import_id text primary key,
  epoch bigint not null references fcos_release_coordination.epochs(epoch),
  evidence jsonb not null
);
create table fcos_release_coordination.import_resolutions (
  import_id text primary key references fcos_release_coordination.imported_uncertainty(import_id),
  evidence jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create function fcos_release_coordination.reject_mutation() returns trigger language plpgsql
set search_path = pg_catalog as $$ begin raise exception 'COORDINATION_APPEND_ONLY'; end $$;
do $$ declare t text; begin
  foreach t in array array['epochs','registrations','registration_runs','resume_admissions','operations','operation_events','evidence','activations','approval_admissions','authorizations','finishes','imported_uncertainty','import_resolutions'] loop
    execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
  end loop;
end $$;

-- Only a migration operator can activate. Runtime credentials cannot fence or clear legacy uncertainty.
create function fcos_release_coordination.install_epoch(next_epoch bigint, activation jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, fcos_release_coordination as $$
declare c fcos_release_coordination.control%rowtype; item jsonb; challenge jsonb; issued_at timestamptz;
begin
  select * into c from fcos_release_coordination.control where singleton for update;
  if next_epoch <= coalesce(c.epoch,0) or c.operation_id is not null then raise exception 'COORDINATION_EPOCH_CONFLICT'; end if;
  if activation->>'inventoryComplete' is distinct from 'true'
     or jsonb_typeof(activation->'uncertainties') is distinct from 'array'
     or jsonb_typeof(activation->'writers') is distinct from 'array'
     or jsonb_array_length(activation->'writers')=0
     or coalesce(activation->>'inventoryHash','') !~ '^[0-9a-f]{64}$'
     or activation->'legacyFence'->>'kind' is distinct from 'permanent_legacy_sentinel'
     or coalesce(activation->'legacyFence'->>'snapshotHash','') !~ '^[0-9a-f]{64}$'
     or coalesce(activation->'legacyFence'->>'proofHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_ACTIVATION_EVIDENCE_REQUIRED'; end if;
  challenge:=activation->'notificationChallenge';
  if jsonb_typeof(challenge) is distinct from 'object'
    or coalesce(challenge->>'challenge','') !~ '^[0-9a-f]{64}$'
    or coalesce(challenge->>'repository','') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    or coalesce(challenge->>'operator','') !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
    or jsonb_typeof(challenge->'issuedAt') is distinct from 'string' then raise exception 'COORDINATION_NOTIFICATION_CHALLENGE_REQUIRED'; end if;
  begin issued_at:=(challenge->>'issuedAt')::timestamptz;
    if not isfinite(issued_at) or issued_at>clock_timestamp()+interval '30 seconds' then raise exception 'COORDINATION_NOTIFICATION_CHALLENGE_REQUIRED'; end if;
  exception when others then raise exception 'COORDINATION_NOTIFICATION_CHALLENGE_REQUIRED'; end;
  if exists(select 1 from fcos_release_coordination.epochs e where e.activation_evidence->'notificationChallenge'->>'challenge'=challenge->>'challenge') then raise exception 'COORDINATION_NOTIFICATION_CHALLENGE_REUSED'; end if;
  for item in select value from jsonb_array_elements(activation->'writers') loop
    if coalesce(item->>'id','')='' or item->>'disabled' is distinct from 'true'
       or coalesce(item->>'proofHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_OLD_WRITER_NOT_FENCED'; end if;
  end loop;
  if exists(select 1 from fcos_release_coordination.imported_uncertainty u left join fcos_release_coordination.import_resolutions r using(import_id) where r.import_id is null) then
    raise exception 'COORDINATION_IMPORTED_UNCERTAINTY_UNRESOLVED';
  end if;
  insert into fcos_release_coordination.epochs(epoch,activation_evidence) values(next_epoch,activation);
  for item in select value from jsonb_array_elements(activation->'uncertainties') loop
    if coalesce(item->>'operationId','')='' or coalesce(item->>'evidenceHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_IMPORT_INVALID'; end if;
    insert into fcos_release_coordination.imported_uncertainty(import_id,epoch,evidence) values(item->>'operationId',next_epoch,item);
  end loop;
  update fcos_release_coordination.control set epoch=next_epoch,mode='qualification' where singleton;
  return jsonb_build_object('epoch',next_epoch,'mode','qualification','imported',jsonb_array_length(activation->'uncertainties'));
end $$;
-- Activation never fences an old writer itself. It checks the imported permanent sentinel
-- and durable successful hosted qualification in the SAME epoch, then records admin admission.
create function fcos_release_coordination.activate(expected_epoch bigint, qualification jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, fcos_release_coordination as $$
declare c fcos_release_coordination.control%rowtype; installed jsonb; writer jsonb; qid text; qualification_actor jsonb;
  challenge jsonb; receipt jsonb; receipt_text text; received_at timestamptz; issued_at timestamptz;
begin
  select * into c from fcos_release_coordination.control where singleton for update;
  if c.epoch is distinct from expected_epoch or c.mode<>'qualification' or c.operation_id is not null then raise exception 'COORDINATION_ACTIVATION_STATE_INVALID'; end if;
  select activation_evidence into installed from fcos_release_coordination.epochs where epoch=c.epoch;
  if qualification->>'oldWriterFenceHash' is distinct from installed->'legacyFence'->>'proofHash'
    or qualification->>'allWritersAdmitted' is distinct from 'true'
    or jsonb_typeof(qualification->'writerAdmissions') is distinct from 'array'
    or coalesce(qualification->>'manifestHash','') !~ '^[0-9a-f]{64}$'
    or coalesce(qualification->>'evidenceHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_QUALIFICATION_REQUIRED'; end if;
  for writer in select value from jsonb_array_elements(installed->'writers') loop
    if not exists(select 1 from jsonb_array_elements(qualification->'writerAdmissions') a
      where a->>'id'=writer->>'id' and a->>'admitted'='true' and coalesce(a->>'proofHash','') ~ '^[0-9a-f]{64}$') then
      raise exception 'COORDINATION_WRITER_NOT_ADMITTED';
    end if;
  end loop;
  if exists(select 1 from fcos_release_coordination.imported_uncertainty u left join fcos_release_coordination.import_resolutions r using(import_id) where r.import_id is null) then raise exception 'COORDINATION_IMPORTED_UNCERTAINTY_UNRESOLVED'; end if;
  select release_id,registration_actor into qid,qualification_actor from fcos_release_coordination.registrations
    where epoch=c.epoch and manifest_hash=qualification->>'manifestHash' and scope='qualification';
  if qid is null or not exists(select 1 from fcos_release_coordination.operations o cross join lateral
    (select e.state,e.evidence from fcos_release_coordination.operation_events e where e.operation_id=o.operation_id order by e.event_id desc limit 1) last_ev
    where o.release_id=qid and o.phase='preview.create' and last_ev.state='complete'
      and last_ev.evidence->>'outcome'='applied' and last_ev.evidence->'result'->>'id' ~ '^dpl_[A-Za-z0-9]+$')
    or not exists(select 1 from fcos_release_coordination.evidence e where e.release_id=qid
      and e.evidence->>'key'='hosted.qualification' and e.evidence->>'status'='passed'
      and e.evidence->>'actualGithubArtifactValidated'='true'
      and e.evidence_hash=qualification->>'evidenceHash') then raise exception 'COORDINATION_HOSTED_QUALIFICATION_REQUIRED'; end if;
  if (select count(*) from fcos_release_coordination.operations o cross join lateral
    (select e.state,e.evidence from fcos_release_coordination.operation_events e where e.operation_id=o.operation_id order by e.event_id desc limit 1) last_ev
    where o.release_id=qid and o.phase in ('qualification.stage','qualification.promote','qualification.rollback')
      and last_ev.state='complete' and last_ev.evidence->>'outcome'='applied' and last_ev.evidence->'result'->>'simulated'='true')<>3 then raise exception 'COORDINATION_QUALIFICATION_SIMULATIONS_REQUIRED'; end if;
  -- The receipt comes only from this privileged setup transaction. Runtime
  -- evidence or a release-caller boolean cannot install the one-time attestation.
  challenge:=installed->'notificationChallenge';
  receipt_text:=qualification->'notificationDelivery'->>'receiptJson';
  if jsonb_typeof(qualification->'notificationDelivery'->'receiptJson') is distinct from 'string'
    or octet_length(receipt_text)>8192
    or coalesce(qualification->'notificationDelivery'->>'receiptSha256','') !~ '^[0-9a-f]{64}$'
    or encode(sha256(convert_to(receipt_text,'UTF8')),'hex') is distinct from qualification->'notificationDelivery'->>'receiptSha256'
    or challenge->>'repository' is distinct from split_part(qualification_actor->>'workflowRef','/.github/',1)
    then raise exception 'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED'; end if;
  begin receipt:=receipt_text::jsonb; received_at:=(receipt->>'receivedAt')::timestamptz; issued_at:=(challenge->>'issuedAt')::timestamptz;
    if jsonb_typeof(receipt) is distinct from 'object'
      or receipt->>'challenge' is distinct from challenge->>'challenge'
      or receipt->>'repository' is distinct from challenge->>'repository'
      or receipt->>'operator' is distinct from challenge->>'operator'
      or receipt->>'device' is distinct from 'iphone'
      or receipt->'confirmedByHuman' is distinct from 'true'::jsonb
      or received_at is null or not isfinite(received_at) or received_at<issued_at or received_at>clock_timestamp()+interval '30 seconds'
      then raise exception 'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED'; end if;
  exception when others then raise exception 'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED'; end;
  insert into fcos_release_coordination.activations(epoch,proof) values(c.epoch,qualification);
  update fcos_release_coordination.control set mode='active' where singleton;
  return jsonb_build_object('epoch',c.epoch,'mode','active','notificationReceiptSha256',qualification->'notificationDelivery'->>'receiptSha256');
end $$;
create function fcos_release_coordination.resolve_import(import_operation_id text, readback jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, fcos_release_coordination as $$
begin
  perform 1 from fcos_release_coordination.control where singleton for update;
  if coalesce(readback->>'outcome','') not in ('applied','not_applied') or coalesce(readback->>'evidenceHash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'COORDINATION_DEFINITIVE_READBACK_REQUIRED';
  end if;
  insert into fcos_release_coordination.import_resolutions(import_id,evidence) values(import_operation_id,readback);
end $$;

-- All requests are a single short transaction. A logical global lock outlives the transaction/runner.
create function fcos_release_coordination.dispatch(action text, p jsonb, principal jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, fcos_release_coordination as $$
declare c fcos_release_coordination.control%rowtype;
  r fcos_release_coordination.registrations%rowtype;
  o fcos_release_coordination.operations%rowtype;
  ev fcos_release_coordination.operation_events%rowtype;
  auth fcos_release_coordination.authorizations%rowtype;
  prior_auth fcos_release_coordination.authorizations%rowtype;
  existing jsonb; state_value text; result jsonb; is_production boolean; qualification_manifest jsonb;
begin
  select * into c from fcos_release_coordination.control where singleton for update;
  if c.epoch is null then raise exception 'COORDINATION_INACTIVE'; end if;
  if p->>'epoch' is distinct from c.epoch::text then raise exception 'COORDINATION_STALE_EPOCH'; end if;
  if jsonb_typeof(p->'owner') is distinct from 'object' or coalesce(p->'owner'->>'id','')=''
    or (principal->>'kind'='github' and p->'owner'->>'kind' is distinct from 'release')
    or (principal->>'kind'='financial' and (p->'owner'->>'kind' is distinct from 'financial' or p->'owner'->>'id' is distinct from principal->>'ownerId'))
    or coalesce(principal->>'kind','') not in ('github','financial') then raise exception 'COORDINATION_OWNER_MISMATCH'; end if;
  if principal->'qualificationOnly'='true'::jsonb then
    if c.mode<>'qualification' or principal->>'kind'<>'github' or action in ('admitApproval','approve','resume')
      or (action in ('begin','claim','complete','uncertain','readback') and coalesce(p->>'phase','') not in
        ('preview.create','qualification.stage','qualification.promote','qualification.rollback')) then raise exception 'COORDINATION_QUALIFICATION_ONLY'; end if;
    if action='register' then qualification_manifest:=p->'manifest';
    else select manifest into qualification_manifest from fcos_release_coordination.registrations where release_id=p->>'releaseId'; end if;
    if coalesce(principal->'qualificationAdmission'->>'setupSha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(principal->'qualificationAdmission'->>'candidateSha','') !~ '^[a-f0-9]{40}$'
      or coalesce(principal->'qualificationAdmission'->>'jobWorkflowSha','') !~ '^[a-f0-9]{40}$'
      or qualification_manifest->>'stage' is distinct from 'qualification' or qualification_manifest->>'executionMode' is distinct from 'qualification'
      or qualification_manifest->>'setupSha256' is distinct from principal->'qualificationAdmission'->>'setupSha256'
      or qualification_manifest->'candidate'->>'sha' is distinct from principal->'qualificationAdmission'->>'candidateSha'
      or qualification_manifest->'controller'->>'sha' is distinct from principal->'qualificationAdmission'->>'jobWorkflowSha'
      or qualification_manifest->'controller'->>'workflow' is distinct from '.github/workflows/hosted-release-controller.yml'
      or qualification_manifest->'qualificationSource' is distinct from jsonb_build_object(
        'ref',principal->'qualificationAdmission'->>'ref','bootstrapSha',principal->'qualificationAdmission'->>'bootstrapSha',
        'callerWorkflowRef',principal->'qualificationAdmission'->>'callerWorkflowRef','controllerSha',principal->'qualificationAdmission'->>'jobWorkflowSha',
        'candidateSha',principal->'qualificationAdmission'->>'candidateSha') then raise exception 'COORDINATION_QUALIFICATION_SCOPE_INVALID'; end if;
  end if;
  if action='register' then
    if coalesce(p->>'releaseId','')='' or coalesce(p->>'manifestHash','') !~ '^[0-9a-f]{64}$'
      or p->'manifest'->>'epoch' is distinct from c.epoch::text
      or p->'manifest'->>'executionMode' not in ('qualification','release','financial')
      or (p->'manifest'->>'stage'='qualification' and p->'manifest'->>'executionMode'<>'qualification')
      or ((p->'manifest'->>'executionMode'='financial') <> (principal->>'kind'='financial')) then raise exception 'COORDINATION_MANIFEST_INVALID'; end if;
    select * into r from fcos_release_coordination.registrations where release_id=p->>'releaseId';
    if found then
      if r.epoch<>c.epoch or r.manifest_hash<>p->>'manifestHash' or r.manifest<>p->'manifest' or r.owner<>p->'owner' then raise exception 'COORDINATION_MANIFEST_CONFLICT'; end if;
    else
      insert into fcos_release_coordination.registrations(release_id,epoch,owner,manifest,manifest_hash,scope,registration_actor)
      values(p->>'releaseId',c.epoch,p->'owner',p->'manifest',p->>'manifestHash',p->'manifest'->>'executionMode',principal) returning * into r;
    end if;
    if principal->>'kind'='github' then
      if coalesce(principal->>'runId','') !~ '^[1-9][0-9]*$' or principal->>'runAttempt' is distinct from '1' then raise exception 'COORDINATION_REGISTRATION_RUN_INVALID'; end if;
      insert into fcos_release_coordination.registration_runs(release_id,run_id,run_attempt,actor)
      values(r.release_id,principal->>'runId',principal->>'runAttempt',principal) on conflict do nothing;
      if not exists(select 1 from fcos_release_coordination.registration_runs rr where rr.release_id=r.release_id
        and rr.run_id=principal->>'runId' and rr.run_attempt=principal->>'runAttempt'
        and rr.actor->>'sha'=principal->>'sha' and rr.actor->>'workflowSha'=principal->>'workflowSha'
        and rr.actor->>'jobWorkflowRef'=principal->>'jobWorkflowRef' and rr.actor->>'jobWorkflowSha'=principal->>'jobWorkflowSha') then raise exception 'COORDINATION_REGISTRATION_RUN_CONFLICT'; end if;
    end if;
    return jsonb_build_object('registered',true,'manifestHash',r.manifest_hash,'registration',to_jsonb(r));
  end if;
  select * into r from fcos_release_coordination.registrations where release_id=p->>'releaseId';
  if not found then raise exception 'COORDINATION_RELEASE_UNKNOWN'; end if;
  if r.epoch<>c.epoch or r.owner<>p->'owner' or r.manifest_hash is distinct from p->>'manifestHash' then raise exception 'COORDINATION_SCOPE_MISMATCH'; end if;
  if action='snapshot' then
    select coalesce(jsonb_object_agg(x.phase,x.value),'{}'::jsonb) into existing from (
      select op.phase,to_jsonb(op)||jsonb_build_object('operationId',op.operation_id,'requestHash',op.request_hash,'state',last_ev.state,'evidence',last_ev.evidence) as value
      from fcos_release_coordination.operations op cross join lateral
      (select * from fcos_release_coordination.operation_events e where e.operation_id=op.operation_id order by event_id desc limit 1) last_ev
      where op.release_id=r.release_id) x;
    select to_jsonb(a) into result from fcos_release_coordination.authorizations a where a.release_id=r.release_id order by a.authorization_event_id desc limit 1;
    return jsonb_build_object('epoch',c.epoch,'mode',c.mode,'registration',to_jsonb(r),'registrationRun',(select to_jsonb(rr) from fcos_release_coordination.registration_runs rr where rr.release_id=r.release_id and rr.run_id=principal->>'runId' and rr.run_attempt=principal->>'runAttempt'),'operations',existing,'approval',result,
      'approvalHistory',coalesce((select jsonb_agg(to_jsonb(a) order by a.authorization_event_id) from fcos_release_coordination.authorizations a where a.release_id=r.release_id),'[]'::jsonb),
      'lock',c.operation_id,'status',(select f.evidence->>'status' from fcos_release_coordination.finishes f where f.release_id=r.release_id),'finished',exists(select 1 from fcos_release_coordination.finishes f where f.release_id=r.release_id),
      'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.evidence_id) from fcos_release_coordination.evidence e where e.release_id=r.release_id),'[]'::jsonb),
      'checks',coalesce((select jsonb_object_agg(e.evidence->>'key',e.evidence order by e.evidence_event_id) from fcos_release_coordination.evidence e where e.release_id=r.release_id and e.evidence ? 'key'),'{}'::jsonb),
      'importedUncertainty',coalesce((select jsonb_agg(u.evidence) from fcos_release_coordination.imported_uncertainty u left join fcos_release_coordination.import_resolutions ir using(import_id) where ir.import_id is null),'[]'::jsonb));
  end if;
  if exists(select 1 from fcos_release_coordination.finishes f where f.release_id=r.release_id) then
    if action='finish' then return jsonb_build_object('finished',true); end if;
    raise exception 'COORDINATION_RELEASE_FINISHED';
  end if;
  if action='admitApproval' then
    if principal->>'kind'<>'github' or r.scope<>'release' or principal->>'environment' is distinct from 'fcos-production-release' then raise exception 'COORDINATION_APPROVAL_INVALID'; end if;
    select * into auth from fcos_release_coordination.authorizations where release_id=r.release_id order by authorization_event_id desc limit 1;
    if found and auth.expires_at>clock_timestamp() then return jsonb_build_object('admitted',true); end if;
    if exists(select 1 from fcos_release_coordination.authorizations a where a.release_id=r.release_id and a.run_id=principal->>'runId') then raise exception 'COORDINATION_RENEWAL_NEW_RUN_REQUIRED'; end if;
    if not exists(select 1 from fcos_release_coordination.registration_runs rr where rr.release_id=r.release_id and rr.run_id=principal->>'runId' and rr.run_attempt=principal->>'runAttempt') then raise exception 'COORDINATION_REGISTRATION_RUN_REQUIRED'; end if;
    insert into fcos_release_coordination.approval_admissions(release_id,run_id,run_attempt,actor)
      values(r.release_id,principal->>'runId',principal->>'runAttempt',principal) on conflict do nothing;
    return jsonb_build_object('admitted',true);
  end if;
  if action='approve' then
    if principal->>'kind'<>'github' or r.scope<>'release' or principal->>'environment' is distinct from 'fcos-production-release' then raise exception 'COORDINATION_APPROVAL_INVALID'; end if;
    select * into auth from fcos_release_coordination.authorizations where release_id=r.release_id order by authorization_event_id desc limit 1;
    if not found or auth.expires_at<=clock_timestamp() then
      prior_auth:=auth;
      if exists(select 1 from fcos_release_coordination.authorizations a where a.release_id=r.release_id and a.run_id=principal->>'runId') then raise exception 'COORDINATION_RENEWAL_NEW_RUN_REQUIRED'; end if;
      if not exists(select 1 from fcos_release_coordination.registration_runs rr where rr.release_id=r.release_id and rr.run_id=principal->>'runId' and rr.run_attempt=principal->>'runAttempt')
        or coalesce(p->'approvalReceipt'->>'manifestHash','')<>r.manifest_hash
        or p->'approvalReceipt'->>'runId' is distinct from principal->>'runId'
        or p->'approvalReceipt'->>'runAttempt' is distinct from principal->>'runAttempt'
        or p->'approvalReceipt'->>'epoch' is distinct from c.epoch::text
        or coalesce(p->'approvalReceipt'->>'approvedJobId','') !~ '^[1-9][0-9]*$'
        or (prior_auth.authorization_event_id is not null and
          (p->'approvalReceipt'->>'protectedJobStartedAt' is null or (p->'approvalReceipt'->>'protectedJobStartedAt')::timestamptz<=prior_auth.expires_at))
        then raise exception 'COORDINATION_APPROVAL_INVALID'; end if;
      insert into fcos_release_coordination.authorizations(release_id,run_id,run_attempt,approved_job_id,manifest_hash,epoch,receipt,admitted_at,expires_at)
      select r.release_id,principal->>'runId',principal->>'runAttempt',(p->'approvalReceipt'->>'approvedJobId')::bigint,r.manifest_hash,c.epoch,p->'approvalReceipt',a.observed_at,a.observed_at+interval '24 hours'
      from fcos_release_coordination.approval_admissions a where a.release_id=r.release_id and a.run_id=principal->>'runId' and a.run_attempt=principal->>'runAttempt' returning * into auth;
      if not found then raise exception 'COORDINATION_APPROVAL_ADMISSION_REQUIRED'; end if;
    end if;
    if auth.expires_at<=clock_timestamp() then raise exception 'COORDINATION_APPROVAL_EXPIRED'; end if;
    return jsonb_build_object('approval',to_jsonb(auth));
  end if;
  if action='resume' then
    select * into auth from fcos_release_coordination.authorizations where release_id=r.release_id order by authorization_event_id desc limit 1;
    if principal->>'kind'<>'github' or principal->>'environment' is distinct from 'fcos-hosted-production-resume'
      or r.scope<>'release' or not found or auth.expires_at<=clock_timestamp()
      or p->'resumeReceipt'->>'manifestHash' is distinct from r.manifest_hash
      or p->'resumeReceipt'->>'runId' is distinct from principal->>'runId'
      or p->'resumeReceipt'->>'authorizationEventId' is distinct from auth.authorization_event_id::text
      or not exists(select 1 from fcos_release_coordination.registration_runs rr where rr.release_id=r.release_id and rr.run_id=principal->>'runId' and rr.run_attempt=principal->>'runAttempt') then raise exception 'COORDINATION_RESUME_FORBIDDEN'; end if;
    insert into fcos_release_coordination.resume_admissions(release_id,run_id,authorization_event_id,receipt)
      values(r.release_id,principal->>'runId',auth.authorization_event_id,p->'resumeReceipt') on conflict do nothing;
    return jsonb_build_object('approval',to_jsonb(auth),'resumed',true);
  end if;
  if action in ('begin','claim') then
    if coalesce(p->>'operationId','')='' or coalesce(p->>'phase','')='' or coalesce(p->>'requestHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_OPERATION_INVALID'; end if;
    select * into o from fcos_release_coordination.operations where release_id=r.release_id and phase=p->>'phase';
    if found then
      if o.operation_id<>p->>'operationId' or o.request_hash<>p->>'requestHash' then raise exception 'COORDINATION_OPERATION_CONFLICT'; end if;
      select * into ev from fcos_release_coordination.operation_events where operation_id=o.operation_id order by event_id desc limit 1;
      return jsonb_build_object('disposition',case when ev.state='complete' then 'complete' else 'readback' end,'operation',to_jsonb(o),'evidence',ev.evidence);
    end if;
    is_production := p->>'phase' in ('production.stage','production.promote','production.rollback');
    if principal->>'kind'='github' and p->>'phase' not in ('preview.create','production.stage','production.promote','production.rollback','qualification.stage','qualification.promote','qualification.rollback')
       or principal->>'kind'='financial' and p->>'phase' not like 'financial.%' then raise exception 'COORDINATION_PHASE_FORBIDDEN'; end if;
    if p->>'phase' like 'qualification.%' and (r.scope<>'qualification' or principal->>'environment' in ('fcos-production-release','fcos-hosted-production-resume')) then raise exception 'COORDINATION_QUALIFICATION_SIMULATION_ONLY'; end if;
    if c.mode='qualification' and (r.scope<>'qualification' or p->>'phase' not in ('preview.create','qualification.stage','qualification.promote','qualification.rollback')) then raise exception 'COORDINATION_QUALIFICATION_ONLY'; end if;
    if c.mode<>'active' and c.mode<>'qualification' then raise exception 'COORDINATION_INACTIVE'; end if;
    if is_production then
      select * into auth from fcos_release_coordination.authorizations where release_id=r.release_id order by authorization_event_id desc limit 1;
      if r.scope<>'release' or coalesce(principal->>'environment','') not in ('fcos-production-release','fcos-hosted-production-resume') or not found or auth.expires_at<=clock_timestamp()
        or not exists(select 1 from fcos_release_coordination.registration_runs rr where rr.release_id=r.release_id and rr.run_id=principal->>'runId' and rr.run_attempt=principal->>'runAttempt')
        or (principal->>'environment'='fcos-production-release' and auth.run_id is distinct from principal->>'runId')
        or (principal->>'environment'='fcos-hosted-production-resume' and not exists(select 1 from fcos_release_coordination.resume_admissions ra where ra.release_id=r.release_id and ra.run_id=principal->>'runId' and ra.authorization_event_id=auth.authorization_event_id))
        or not (r.manifest->'authorization'->'actions' ? (p->>'phase')) then raise exception 'COORDINATION_PRODUCTION_APPROVAL_REQUIRED'; end if;
    end if;
    if c.operation_id is not null or exists(select 1 from fcos_release_coordination.imported_uncertainty u left join fcos_release_coordination.import_resolutions ir using(import_id) where ir.import_id is null) then
      return jsonb_build_object('disposition','busy','lock',c.operation_id);
    end if;
    insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor)
    values(p->>'operationId',r.release_id,c.epoch,p->>'phase',p->>'requestHash',r.manifest_hash,principal) returning * into o;
    insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor)
    values(o.operation_id,'intent','{}',p->>'requestHash',principal);
    update fcos_release_coordination.control set operation_id=o.operation_id where singleton;
    return jsonb_build_object('disposition','execute','operation',to_jsonb(o));
  end if;
  if action in ('complete','uncertain','readback') then
    select * into o from fcos_release_coordination.operations where operation_id=p->>'operationId' and release_id=r.release_id and phase=p->>'phase';
    if not found then raise exception 'COORDINATION_OPERATION_UNKNOWN'; end if;
    select * into ev from fcos_release_coordination.operation_events where operation_id=o.operation_id order by event_id desc limit 1;
    if jsonb_typeof(p->'evidence') is distinct from 'object' or coalesce(p->>'evidenceHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_EVIDENCE_REQUIRED'; end if;
    if ev.state='complete' then
      if ev.evidence<>p->'evidence' then raise exception 'COORDINATION_TERMINAL_CONFLICT'; end if;
      return jsonb_build_object('disposition','complete','operation',to_jsonb(o),'evidence',ev.evidence);
    end if;
    if c.operation_id is distinct from o.operation_id then raise exception 'COORDINATION_LOCK_MISMATCH'; end if;
    if action='uncertain' then state_value:='uncertain';
    elsif p->'evidence'->>'outcome' in ('applied','not_applied') then state_value:='complete';
    elsif action='readback' and p->'evidence'->>'outcome'='unknown' then state_value:='uncertain';
    else raise exception 'COORDINATION_DEFINITIVE_READBACK_REQUIRED'; end if;
    if ev.state<>state_value or ev.evidence<>p->'evidence' then
      insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor)
      values(o.operation_id,state_value,p->'evidence',p->>'evidenceHash',principal);
    end if;
    if state_value='complete' then update fcos_release_coordination.control set operation_id=null where singleton; end if;
    return jsonb_build_object('disposition',case when state_value='complete' then 'complete' else 'readback' end,'operation',to_jsonb(o),'evidence',p->'evidence');
  end if;
  if action='appendEvidence' then
    if coalesce(p->>'evidenceId','')='' or jsonb_typeof(p->'evidence') is distinct from 'object' or coalesce(p->>'evidenceHash','') !~ '^[0-9a-f]{64}$' then raise exception 'COORDINATION_EVIDENCE_REQUIRED'; end if;
    select to_jsonb(e) into existing from fcos_release_coordination.evidence e where e.evidence_id=p->>'evidenceId';
    if existing is not null then
      if existing->>'release_id'<>r.release_id or existing->'evidence'<>p->'evidence' or existing->>'evidence_hash'<>p->>'evidenceHash' then raise exception 'COORDINATION_EVIDENCE_CONFLICT'; end if;
    else
      insert into fcos_release_coordination.evidence(evidence_id,release_id,evidence,evidence_hash,actor)
      values(p->>'evidenceId',r.release_id,p->'evidence',p->>'evidenceHash',principal);
    end if;
    return jsonb_build_object('appended',true);
  end if;
  if action='finish' then
    if exists(select 1 from fcos_release_coordination.operations op cross join lateral
      (select e.state from fcos_release_coordination.operation_events e where e.operation_id=op.operation_id order by event_id desc limit 1) last_ev
      where op.release_id=r.release_id and last_ev.state<>'complete') then raise exception 'COORDINATION_UNRESOLVED_OPERATION'; end if;
    if jsonb_typeof(p->'evidence') is distinct from 'object' then raise exception 'COORDINATION_EVIDENCE_REQUIRED'; end if;
    insert into fcos_release_coordination.finishes(release_id,evidence,evidence_hash,actor) values(r.release_id,p->'evidence',p->>'evidenceHash',principal);
    return jsonb_build_object('finished',true);
  end if;
  raise exception 'COORDINATION_ACTION_UNKNOWN';
end $$;

-- Dedicated definer owns only this private schema. The runtime can execute one RPC and nothing else.
do $$ declare t text; f record; begin
  foreach t in array array['epochs','control','registrations','registration_runs','resume_admissions','operations','operation_events','evidence','activations','approval_admissions','authorizations','finishes','imported_uncertainty','import_resolutions'] loop
    execute format('alter table fcos_release_coordination.%I enable row level security',t);
    execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  end loop;
  for f in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fcos_release_coordination' loop
    execute format('alter function %s owner to fcos_coordinator_owner',f.name);
    execute format('revoke all on function %s from public',f.name);
  end loop;
end $$;
revoke all on all tables in schema fcos_release_coordination from public, fcos_coordinator_runtime;
revoke all on all sequences in schema fcos_release_coordination from public, fcos_coordinator_runtime;
grant execute on function fcos_release_coordination.dispatch(text,jsonb,jsonb) to fcos_coordinator_runtime;
grant execute on function fcos_release_coordination.install_epoch(bigint,jsonb), fcos_release_coordination.activate(bigint,jsonb), fcos_release_coordination.resolve_import(text,jsonb) to postgres;
alter default privileges for role fcos_coordinator_owner in schema fcos_release_coordination revoke all on tables from public;
alter default privileges for role fcos_coordinator_owner in schema fcos_release_coordination revoke execute on functions from public;
