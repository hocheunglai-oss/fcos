-- Private administrator coordination for the exact old Preview isolation and
-- source-only PR122 publication. No financial/provider authority or TTL takeover.
begin;
set local lock_timeout='5s';
create table fcos_release_coordination.exact_preview_administrator_actions (
 operation_id text primary key, lease_id uuid not null unique default gen_random_uuid(),
 packet jsonb not null, binding_sha256 text not null check(binding_sha256 ~ '^[a-f0-9]{64}$'),
 database_session_user text not null default session_user,
 created_at timestamptz not null default clock_timestamp(),
 check(binding_sha256=fcos_release_coordination.auth_maintenance_hash(packet))
);
create table fcos_release_coordination.exact_preview_administrator_events (
 event_id bigint generated always as identity primary key,
 operation_id text not null references fcos_release_coordination.exact_preview_administrator_actions,
 state text not null check(state in ('claimed','prepared','submitting','submitted','uncertain','not_applied')),
 reason text not null, database_session_user text not null default session_user,
 evidence jsonb not null default '{}'::jsonb,
 evidence_sha256 text not null default fcos_release_coordination.auth_maintenance_hash('{}'::jsonb),
 created_at timestamptz not null default clock_timestamp()
 ,check(evidence_sha256=fcos_release_coordination.auth_maintenance_hash(evidence))
);
create index exact_preview_admin_event_order on fcos_release_coordination.exact_preview_administrator_events(operation_id,event_id desc);

create function fcos_release_coordination.exact_preview_admin_open() returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select exists(select 1 from exact_preview_administrator_actions a where
  coalesce((select state from exact_preview_administrator_events e where e.operation_id=a.operation_id order by event_id desc limit 1),'missing') not in ('submitted','not_applied'))
$$;
create function fcos_release_coordination.exact_preview_admin_lease(a fcos_release_coordination.exact_preview_administrator_actions) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('epoch','fcos-hosted-admin-epoch1','objective','production',
  'ownerThreadId','01a0f08b-7fcb-7870-9edc-343e16052b62','operationId',a.operation_id,'bindingSha256',a.binding_sha256,
  'leaseId',a.lease_id,'coordinationOnly',true,'providerAuthorityGranted',false,'uncertainOutcomeRequiresReadback',true)
$$;

create function fcos_release_coordination.exact_preview_admin_claim(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;a exact_preview_administrator_actions%rowtype;s jsonb:=p->'scope';
begin
 select * into c from control where singleton for update;
 if not auth_maintenance_object(p,array['schemaVersion','kind','epoch','objective','ownerThreadId','operationId','action','scope','humanInstructionSha256','rootAcceptanceSha256','independentAcceptanceSha256'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'kind' is distinct from 'fcos_pr122_administrator_action_v1'
  or p->>'epoch' is distinct from 'fcos-hosted-admin-epoch1' or p->>'objective' is distinct from 'production'
  or p->>'ownerThreadId' is distinct from '01a0f08b-7fcb-7870-9edc-343e16052b62'
  or coalesce(p->>'operationId','') !~ '^pr122-admin-[a-z0-9-]{8,100}$'
  or exists(select 1 from jsonb_each(p) e where e.key in ('humanInstructionSha256','rootAcceptanceSha256','independentAcceptanceSha256')
   and (jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[a-f0-9]{64}$'))
  or p->>'rootAcceptanceSha256'=p->>'independentAcceptanceSha256'
  or c.epoch is distinct from 1 or c.mode is distinct from 'qualification'
  or c.bootstrap_id is not null or c.recovery_id is not null or c.plan_completion_id is not null or c.source_upgrade_id is not null
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
 if exists(select 1 from exact_preview_administrator_actions where operation_id=p->>'operationId')
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_CONSUMED';end if;
 if exact_preview_admin_open() then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_BUSY';end if;
 if p->>'action'='isolate_preview' then
  if c.operation_id is distinct from 'fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'
   or not exact_preview_quarantine_proof_valid(s)
   or exists(select 1 from exact_preview_uncertainty_quarantines)
  then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
 elsif p->>'action'='publish_pr122_source' then
  if c.operation_id is not null or not exact_preview_quarantined('fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create')
   or not auth_maintenance_object(s,array['repository','branch','fromCommit','toCommit','fromIsAncestor','automaticDeploymentDisabled','allowNewPreview','sourcePreflightSha256','headSnapshotSha256'])
   or s->>'repository' is distinct from 'hocheunglai-oss/fcos'
   or s->>'branch' is distinct from 'codex/hosted-release-consolidation-20261017'
   or coalesce(s->>'fromCommit','') !~ '^[a-f0-9]{40}$' or coalesce(s->>'toCommit','') !~ '^[a-f0-9]{40}$'
   or s->>'fromCommit'=s->>'toCommit' or s->'fromIsAncestor' is distinct from 'true'::jsonb
   or s->'automaticDeploymentDisabled' is distinct from 'true'::jsonb or s->'allowNewPreview' is distinct from 'false'::jsonb
   or coalesce(s->>'sourcePreflightSha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'headSnapshotSha256','') !~ '^[a-f0-9]{64}$'
  then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
 elsif p->>'action' in ('publish_qualification_caller','lock_qualification_caller') then
  if c.operation_id is not null or not exact_preview_quarantined('fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create')
   or not exists(select 1 from exact_preview_uncertainty_quarantines q where
    s->>'repository'='hocheunglai-oss/fcos' and s->>'branch'=substring(q.proof->'successor'->>'ref' from 12)
    and s->>'toCommit'=q.proof->'successor'->>'callerSha')
   or s->'automaticDeploymentDisabled' is distinct from 'true'::jsonb or s->'allowNewPreview' is distinct from 'false'::jsonb
   or coalesce(s->>'sourcePreflightSha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'headSnapshotSha256','') !~ '^[a-f0-9]{64}$'
  then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
  if p->>'action'='publish_qualification_caller' then
   if not auth_maintenance_object(s,array['repository','branch','fromCommit','toCommit','fromIsAncestor','expectedRefAbsent','automaticDeploymentDisabled','allowNewPreview','sourcePreflightSha256','headSnapshotSha256'])
    or s->>'fromCommit' is distinct from '300a46365fbb8b159100b6bdd66523d757cfa4ec'
    or s->'fromIsAncestor' is distinct from 'true'::jsonb or s->'expectedRefAbsent' is distinct from 'true'::jsonb
   then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
  else
   if not auth_maintenance_object(s,array['repository','branch','toCommit','protectionSha256','lockBranch','enforceAdmins','allowForcePushes','allowDeletions','automaticDeploymentDisabled','allowNewPreview','sourcePreflightSha256','headSnapshotSha256'])
    or s->>'protectionSha256' is distinct from '0371b73a7ed8f61c241f315b7319a861bd78ccb9934f79233bac8d7c5b08f879'
    or s->'lockBranch' is distinct from 'true'::jsonb or s->'enforceAdmins' is distinct from 'true'::jsonb
    or s->'allowForcePushes' is distinct from 'false'::jsonb or s->'allowDeletions' is distinct from 'false'::jsonb
   then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
  end if;
 else raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
 if exists(select 1 from operations o where (select state from operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete'
  and o.operation_id<>'fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create')
 then raise exception 'COORDINATION_UNRESOLVED_OPERATION';end if;
 insert into exact_preview_administrator_actions(operation_id,packet,binding_sha256) values(p->>'operationId',p,auth_maintenance_hash(p)) returning * into a;
 insert into exact_preview_administrator_events(operation_id,state,reason) values(a.operation_id,'claimed','actual_postgres_administrator_claim');
 return exact_preview_admin_lease(a);
end $$;

create function fcos_release_coordination.exact_preview_admin_assert(l jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a exact_preview_administrator_actions%rowtype;st text;c control%rowtype;
begin
 select * into c from control where singleton for update;
 select * into a from exact_preview_administrator_actions where operation_id=l->>'operationId';
 select state into st from exact_preview_administrator_events where operation_id=a.operation_id order by event_id desc limit 1;
 if a.operation_id is null or l is distinct from exact_preview_admin_lease(a) or coalesce(st,'missing') not in ('claimed','prepared','submitting')
  or c.epoch is distinct from 1 or c.mode is distinct from 'qualification' or c.bootstrap_id is not null or c.recovery_id is not null
  or c.plan_completion_id is not null or c.source_upgrade_id is not null
  or (a.packet->>'action'='isolate_preview' and c.operation_id is distinct from 'fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create')
  or (a.packet->>'action'<>'isolate_preview' and c.operation_id is not null)
  or a.database_session_user is distinct from session_user
  or (a.packet->>'action'='isolate_preview' and not exact_preview_quarantine_proof_valid(a.packet->'scope'))
  or (a.packet->>'action'<>'isolate_preview' and not exact_preview_quarantined('fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'))
  or exists(select 1 from operations o where (select state from operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete'
   and o.operation_id<>'fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create')
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_LEASE';end if;
 return exact_preview_admin_lease(a);
end $$;

create function fcos_release_coordination.exact_preview_admin_record(l jsonb,new_state text,new_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a exact_preview_administrator_actions%rowtype;st text;c control%rowtype;
begin
 select * into c from control where singleton for update;
 select * into a from exact_preview_administrator_actions where operation_id=l->>'operationId';
 select state into st from exact_preview_administrator_events where operation_id=a.operation_id order by event_id desc limit 1;
 if a.operation_id is null or l is distinct from exact_preview_admin_lease(a) or st is null
  or a.database_session_user is distinct from session_user
  or not ((st='claimed' and new_state='prepared' and new_reason='durable_prepared')
   or (st='prepared' and new_state='submitting' and new_reason='durable_submitting')
   or (st='submitting' and new_state='submitted' and new_reason='provider_acknowledged')
   or (st='submitting' and new_state='uncertain' and new_reason in ('provider_exception','provider_result_unconfirmed')))
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_TRANSITION';end if;
 if new_state in ('prepared','submitting') then perform exact_preview_admin_assert(l);end if;
 if new_state='submitted' and a.packet->>'action'='isolate_preview' and not exists(
  select 1 from exact_preview_uncertainty_quarantines q where q.proof=a.packet->'scope' and q.proof_sha256=auth_maintenance_hash(a.packet->'scope'))
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_RESULT_UNPROVEN';end if;
 insert into exact_preview_administrator_events(operation_id,state,reason) values(a.operation_id,new_state,new_reason);
 return jsonb_build_object('lease',exact_preview_admin_lease(a),'state',new_state,'durable',true);
end $$;

create function fcos_release_coordination.exact_preview_admin_snapshot(id text,binding text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a exact_preview_administrator_actions%rowtype;st text;
begin
 select * into a from exact_preview_administrator_actions where operation_id=id and binding_sha256=binding;
 select state into st from exact_preview_administrator_events where operation_id=a.operation_id order by event_id desc limit 1;
 if a.operation_id is null or st is null or a.database_session_user is distinct from session_user
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_LEASE';end if;
 return jsonb_build_object('lease',exact_preview_admin_lease(a),'state',st,'readOnly',true,'replayAllowed',false);
end $$;

create function fcos_release_coordination.exact_preview_admin_isolate(l jsonb,p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a exact_preview_administrator_actions%rowtype;st text;
begin
 perform exact_preview_admin_assert(l);
 select * into a from exact_preview_administrator_actions where operation_id=l->>'operationId';
 select state into st from exact_preview_administrator_events where operation_id=a.operation_id order by event_id desc limit 1;
 if st is distinct from 'submitting' or a.packet->>'action' is distinct from 'isolate_preview' or p is distinct from a.packet->'scope'
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SCOPE';end if;
 return admit_exact_preview_uncertainty_quarantine(p);
end $$;

-- A separate, administrator-admitted readback never invokes/replays a provider.
-- The original uncertainty event is retained. Definitive SQL admission is read
-- from its exact stored proof; Git publication needs authenticated exact-ref
-- evidence independently reviewed by the operator before this private call.
create function fcos_release_coordination.exact_preview_admin_readback(l jsonb,e jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a exact_preview_administrator_actions%rowtype;st text;o jsonb:=e->'observation';next_state text;
begin
 perform 1 from control where singleton for update;
 select * into a from exact_preview_administrator_actions where operation_id=l->>'operationId';
 select state into st from exact_preview_administrator_events where operation_id=a.operation_id order by event_id desc limit 1;
 if a.operation_id is null or l is distinct from exact_preview_admin_lease(a) or st is null or a.database_session_user is distinct from session_user
  or not auth_maintenance_object(e,array['kind','operationId','bindingSha256','providerOutcome','providerCallbackStarted','observation','observationSha256','rootReviewSha256','independentReviewSha256'])
  or e->>'kind' is distinct from 'fcos_pr122_administrator_owner_readback_v1'
  or e->>'operationId' is distinct from a.operation_id or e->>'bindingSha256' is distinct from a.binding_sha256
  or e->>'observationSha256' is distinct from auth_maintenance_hash(o)
  or coalesce(e->>'rootReviewSha256','') !~ '^[a-f0-9]{64}$' or coalesce(e->>'independentReviewSha256','') !~ '^[a-f0-9]{64}$'
  or e->>'rootReviewSha256'=e->>'independentReviewSha256'
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
 if e->>'providerOutcome'='not_applied' then
  if st not in ('claimed','prepared') or e->'providerCallbackStarted' is distinct from 'false'::jsonb
   or exists(select 1 from exact_preview_administrator_events where operation_id=a.operation_id and state in ('submitting','submitted','uncertain'))
   or not auth_maintenance_object(o,array['kind','guardStopSha256']) or o->>'kind' is distinct from 'guard_stopped_before_submit'
   or coalesce(o->>'guardStopSha256','') !~ '^[a-f0-9]{64}$'
   or (a.packet->>'action'='isolate_preview' and exists(select 1 from exact_preview_uncertainty_quarantines q where q.proof=a.packet->'scope'))
  then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
  next_state:='not_applied';
 elsif e->>'providerOutcome'='applied' then
  if st not in ('submitting','uncertain') or e->'providerCallbackStarted' is distinct from 'true'::jsonb
  then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
  if a.packet->>'action'='isolate_preview' then
   if o is distinct from jsonb_build_object('kind','stored_exact_preview_quarantine',
      'operationId','fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create','proofSha256',auth_maintenance_hash(a.packet->'scope'))
    or not exists(select 1 from exact_preview_uncertainty_quarantines q where q.proof=a.packet->'scope' and q.proof_sha256=o->>'proofSha256')
   then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
  elsif a.packet->>'action' in ('publish_pr122_source','publish_qualification_caller') then
   if not auth_maintenance_object(o,array['kind','repository','branch','commit','authenticatedObserverLogin','authenticatedObserverId','readbackSha256','observedAt'])
    or o->>'kind' is distinct from 'authenticated_github_exact_ref_readback'
    or o->>'repository' is distinct from a.packet->'scope'->>'repository' or o->>'branch' is distinct from a.packet->'scope'->>'branch'
    or o->>'commit' is distinct from a.packet->'scope'->>'toCommit'
    or o->>'authenticatedObserverLogin' is distinct from 'hocheunglai-oss' or o->>'authenticatedObserverId' is distinct from '265701760'
    or coalesce(o->>'readbackSha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(o->'observedAt') is distinct from 'string'
    or isfinite((o->>'observedAt')::timestamptz) is distinct from true
    or (o->>'observedAt')::timestamptz<a.created_at or (o->>'observedAt')::timestamptz>clock_timestamp()+interval '30 seconds'
   then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
  elsif a.packet->>'action'='lock_qualification_caller' then
   if not auth_maintenance_object(o,array['kind','repository','branch','commit','protectionSha256','lockBranch','enforceAdmins','allowForcePushes','allowDeletions','authenticatedObserverLogin','authenticatedObserverId','readbackSha256','observedAt'])
    or o->>'kind' is distinct from 'authenticated_github_locked_caller_readback'
    or o->>'repository' is distinct from a.packet->'scope'->>'repository' or o->>'branch' is distinct from a.packet->'scope'->>'branch'
    or o->>'commit' is distinct from a.packet->'scope'->>'toCommit' or o->>'protectionSha256' is distinct from a.packet->'scope'->>'protectionSha256'
    or o->'lockBranch' is distinct from 'true'::jsonb or o->'enforceAdmins' is distinct from 'true'::jsonb
    or o->'allowForcePushes' is distinct from 'false'::jsonb or o->'allowDeletions' is distinct from 'false'::jsonb
    or o->>'authenticatedObserverLogin' is distinct from 'hocheunglai-oss' or o->>'authenticatedObserverId' is distinct from '265701760'
    or coalesce(o->>'readbackSha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(o->'observedAt') is distinct from 'string'
    or isfinite((o->>'observedAt')::timestamptz) is distinct from true
    or (o->>'observedAt')::timestamptz<a.created_at or (o->>'observedAt')::timestamptz>clock_timestamp()+interval '30 seconds'
   then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
  else raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
  next_state:='submitted';
 else raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_READBACK';end if;
 insert into exact_preview_administrator_events(operation_id,state,reason,evidence,evidence_sha256)
 values(a.operation_id,next_state,'separate_actual_owner_readback',e,auth_maintenance_hash(e));
 return jsonb_build_object('disposition','readback_recorded','lease',exact_preview_admin_lease(a),'state',next_state,'durable',true,'replayAllowed',false);
end $$;

-- Same database coordinator, not an alternate provider writer. While an admin
-- write is pending/uncertain, normal new claims and activation stay fenced.
do $patch$
declare d text;n text;rep text;before_oid oid;before_owner oid;before_acl aclitem[];before_config text[];
 sig text;expected_hash text;expected_definer boolean;expected_acl text;before_all jsonb;after_all jsonb;
begin
 for sig,expected_hash,expected_definer,expected_acl in select * from (values
  ('dispatch(text,jsonb,jsonb)','c5e4ac7e55502b0be1a17eab449a68f0114e22c423a4ef9b60a7ca52b0329b42',true,'{fcos_coordinator_owner=X/fcos_coordinator_owner,fcos_coordinator_runtime=X/fcos_coordinator_owner}'),
  ('qualification_source_upgrade_quiescent()','5b0ff443b48c27897d1bc02c7799b91c6dae9a9e58dcd0db8eeea8ee49cf6477',false,'{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}'),
  ('activate(bigint,jsonb)','f637d4fb9239cd810fd979ea3c4ecf0037ee21b5d5b2bdf69f72146fb95ae22f',true,'{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}')) v loop
  if not exists(select 1 from pg_proc where oid=('fcos_release_coordination.'||sig)::regprocedure
   and encode(sha256(convert_to(prosrc,'UTF8')),'hex')=expected_hash and proowner='fcos_coordinator_owner'::regrole
   and prosecdef=expected_definer and proconfig=array['search_path=pg_catalog, fcos_release_coordination']::text[] and proacl::text=expected_acl)
  then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SOURCE_DRIFT';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) into before_all from pg_proc
 where oid=any(array['fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.qualification_source_upgrade_quiescent()'::regprocedure,'fcos_release_coordination.activate(bigint,jsonb)'::regprocedure]::oid[]);
 select oid,proowner,proacl,proconfig into before_oid,before_owner,before_acl,before_config from pg_proc
  where oid='fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure;
 d:=pg_get_functiondef(before_oid);
 if position('exact_preview_quarantine_new_write' in d)=0 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SOURCE_DRIFT';end if;
 n:=' select * into c from control where singleton for update;';
 rep:=n||E'\n if action in (''register'',''begin'',''claim'',''approve'',''resume'') and exact_preview_admin_open() then raise exception ''COORDINATION_EXACT_PREVIEW_ADMIN_BUSY'';end if;';
 if array_length(string_to_array(d,n),1)<>2 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SOURCE_DRIFT';end if;
 execute replace(d,n,rep);
 if not exists(select 1 from pg_proc where oid=before_oid and proowner=before_owner and proacl is not distinct from before_acl and proconfig is not distinct from before_config)
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_IDENTITY_CHANGED';end if;
 d:=pg_get_functiondef('fcos_release_coordination.qualification_source_upgrade_quiescent()'::regprocedure);
 n:=' select coalesce(';rep:=' select not exact_preview_admin_open() and coalesce(';
 if position('exact_preview_quarantined' in d)=0 or array_length(string_to_array(d,n),1)<>2
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SOURCE_DRIFT';end if;
 execute replace(d,n,rep);
 d:=pg_get_functiondef('fcos_release_coordination.activate(bigint,jsonb)'::regprocedure);
 n:='  select * into c from fcos_release_coordination.control where singleton for update;';
 rep:=n||E'\n  if exact_preview_admin_open() then raise exception ''COORDINATION_EXACT_PREVIEW_ADMIN_BUSY'';end if;';
 if position('exact_preview_quarantined' in d)=0 or array_length(string_to_array(d,n),1)<>2
 then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_SOURCE_DRIFT';end if;
 execute replace(d,n,rep);
 select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) into after_all from pg_proc
 where oid=any(array['fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure,'fcos_release_coordination.qualification_source_upgrade_quiescent()'::regprocedure,'fcos_release_coordination.activate(bigint,jsonb)'::regprocedure]::oid[]);
 if before_all is distinct from after_all then raise exception 'COORDINATION_EXACT_PREVIEW_ADMIN_IDENTITY_CHANGED';end if;
end $patch$;
do $$ declare t text;f regprocedure;begin
 foreach t in array array['exact_preview_administrator_actions','exact_preview_administrator_events'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime',t);
  execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and proname like 'exact_preview_admin_%' loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f);
 end loop;
end $$;
grant execute on function fcos_release_coordination.exact_preview_admin_claim(jsonb),fcos_release_coordination.exact_preview_admin_assert(jsonb),
 fcos_release_coordination.exact_preview_admin_record(jsonb,text,text),fcos_release_coordination.exact_preview_admin_isolate(jsonb,jsonb),
 fcos_release_coordination.exact_preview_admin_readback(jsonb,jsonb),fcos_release_coordination.exact_preview_admin_snapshot(text,text) to postgres;
commit;
