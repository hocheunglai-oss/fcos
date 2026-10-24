-- Private coordination only for the exact active-quarantine successor's six
-- admitted source-upgrade actions. No provider/business authority, expiry,
-- takeover, replay, historical backfill, or legacy writer reactivation.
begin;
set local lock_timeout='5s';
do $source$
declare s text;h text;p pg_proc%rowtype;public_rpc boolean;
begin
 if session_user<>'postgres' then raise exception 'COORDINATION_SOURCE_GUARD_OPERATOR';end if;
 for s,h,public_rpc in values
 ('admit_qualification_source_upgrade(jsonb)','674bcf81f4ac74574e7ee0a29e571f9a21db2b49a72b68f3b62daf39d2a33aa8',true),
 ('qualification_source_upgrade_intent(text,text,text,jsonb)','7521f9394a0f8aef2193008f85ac790c72fb93d47eaeedfe81c92011f63ab7c2',true),
 ('qualification_source_upgrade_snapshot(text,text)','def5c4cb7daf7c739b72be689d27ee8d24a47ed7d411225fd8432b7ae1af7001',true),
 ('qualification_source_upgrade_quiescent()','44502a1caa03aaecdce779a75ce7122de03161770dd450e5915c841bf8cba115',false),
 ('qualification_source_upgrade_proof_valid(jsonb)','8de7a701a9d12396749d1c9d13e73d9c11bcea7eb1fa5aab9b80619e0f73d84c',false),
 ('qualification_source_upgrade_ready_valid(jsonb,jsonb,text,boolean)','6788602bb208b78103f9925c6bedcb2df43f3628d1df0143e72bc57315cab667',false),
 ('record_qualification_source_upgrade(text,text,text,jsonb)','37f8512112bc8c7d3241fb5f9b6af55dc6954ceb1451bf6ed4f4ec370223bb6a',true),
 ('exact_preview_quarantined(text)','7fc6b7c1c79be02cfbd2c180e3d7de2ec12ca2e60fc7688d464e70b448a8a7a1',false),
 ('exact_preview_admin_open()','afea46157e85c63822ce82c90cd5cec3b0dd11775f065ff1d954edccca85f980',false)
 loop
  select * into p from pg_proc where oid=to_regprocedure('fcos_release_coordination.'||s);
  if p.oid is null or encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>h
   or p.proowner<>'fcos_coordinator_owner'::regrole or p.proconfig is distinct from array['search_path=pg_catalog, fcos_release_coordination']
   or p.prosecdef is distinct from public_rpc
   or (p.proacl is distinct from (case when public_rpc or s in ('qualification_source_upgrade_quiescent()','qualification_source_upgrade_proof_valid(jsonb)') then '{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}' else '{fcos_coordinator_owner=X/fcos_coordinator_owner}' end)::aclitem[] and not (s='qualification_source_upgrade_ready_valid(jsonb,jsonb,text,boolean)' and p.proacl='{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}'::aclitem[]))
  then raise exception 'COORDINATION_SOURCE_GUARD_DEPENDENCY_DRIFT: %',s;end if;
 end loop;
end $source$;

create table fcos_release_coordination.qualification_source_upgrade_guards(
 source_upgrade_id text not null,action_id text not null,
 lease_id uuid not null unique default gen_random_uuid(),
 binding jsonb not null,binding_sha256 text not null,
 execute_intent jsonb not null,database_session_user text not null default session_user,
 created_at timestamptz not null default clock_timestamp(),
 primary key(source_upgrade_id,action_id),
 foreign key(source_upgrade_id,action_id) references fcos_release_coordination.qualification_source_upgrade_intents(operation_id,action_id),
 check(binding_sha256=fcos_release_coordination.auth_maintenance_hash(binding)),
 check(database_session_user='postgres'),
 check(binding->>'sourceUpgradeId'=source_upgrade_id and binding->>'actionId'=action_id
  and execute_intent->>'operationId'=source_upgrade_id and execute_intent->>'actionId'=action_id
  and execute_intent->>'disposition'='execute' and execute_intent->'epoch'='1'::jsonb
  and execute_intent->>'proofSha256'=binding->>'proofSha256'
  and execute_intent->>'requestSha256'=binding->>'requestSha256'
  and execute_intent->>'requestSha256'=fcos_release_coordination.auth_maintenance_hash(execute_intent->'request'))
);
create table fcos_release_coordination.qualification_source_upgrade_guard_events(
 event_id bigint generated always as identity primary key,
 source_upgrade_id text not null,action_id text not null,
 state text not null check(state in ('claimed','prepared','submitting','submitted','uncertain')),
 reason text not null,database_session_user text not null default session_user check(database_session_user='postgres'),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(source_upgrade_id,action_id) references fcos_release_coordination.qualification_source_upgrade_guards);
create index qualification_source_guard_event_order on fcos_release_coordination.qualification_source_upgrade_guard_events(source_upgrade_id,action_id,event_id desc);

create function fcos_release_coordination.qualification_source_upgrade_guard_lease(a fcos_release_coordination.qualification_source_upgrade_guards) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('epoch','fcos-hosted-source-upgrade-epoch1','objective','production',
  'ownerThreadId','01a0f08b-7fcb-7870-9edc-343e16052b62','operationId',a.source_upgrade_id||':'||a.action_id,
  'bindingSha256',a.binding_sha256,'leaseId',a.lease_id,'coordinationOnly',true,'providerAuthorityGranted',false,'uncertainOutcomeRequiresReadback',true)
$$;
create function fcos_release_coordination.qualification_source_upgrade_guard_scope(b jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrades%rowtype;q exact_preview_uncertainty_quarantines%rowtype;s jsonb;
begin
 if not auth_maintenance_object(b,array['kind','sourceUpgradeId','proofSha256','actionId','requestSha256','previewQuarantineProofSha256'])
  or b->>'kind' is distinct from 'fcos_fresh_source_upgrade_action_binding_v1'
  or b->>'actionId' not in ('policy_patch','checker_deploy','url_patch','setup_patch','setup_hash_patch','dispatch')
  or coalesce(b->>'requestSha256','') !~ '^[a-f0-9]{64}$'
 then return false;end if;
 select * into a from qualification_source_upgrades where operation_id=b->>'sourceUpgradeId' and proof_sha256=b->>'proofSha256';
 select * into q from exact_preview_uncertainty_quarantines where proof_sha256=b->>'previewQuarantineProofSha256';s:=q.proof->'successor';
 return coalesce(a.operation_id is not null and q.operation_id='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'
  and exact_preview_quarantined(q.operation_id) and qualification_source_upgrade_proof_valid(a.proof)
  and a.epoch=1 and a.proof_sha256=auth_maintenance_hash(a.proof)
  and a.operation_id=s->>'sourceUpgradeId' and a.release_id=s->>'releaseId'
  and a.proof->'setup'->>'controllerSha'=s->>'controllerSha'
  and a.proof->'setup'->'qualificationSource'->>'bootstrapSha'=s->>'callerSha'
  and a.proof->'setup'->'qualificationSource'->>'ref'=s->>'ref'
  and a.proof->'setup'->'qualificationSource'->>'candidateSha'=s->>'candidateSha'
  and a.proof->>'setupSha256'=s->>'setupSha256'
  and auth_maintenance_hash(a.proof->'checkerManifest')=s->>'checkerManifestSha256'
  and a.proof->'plan'->>'stage'='qualification' and a.proof->'plan'->>'executionMode'='qualification'
  and a.proof->'plan'->'scope'->'financialAuthority'='false'::jsonb,false);
exception when others then return false;
end $$;
create function fcos_release_coordination.qualification_source_upgrade_guard_open() returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select exists(select 1 from qualification_source_upgrade_guards a where
  (select state from qualification_source_upgrade_guard_events e where e.source_upgrade_id=a.source_upgrade_id and e.action_id=a.action_id order by event_id desc limit 1) is distinct from 'submitted')
$$;
-- Validate the actual held prefix, not a caller's assertion of an execute result.
create function fcos_release_coordination.qualification_source_upgrade_guard_held(a fcos_release_coordination.qualification_source_upgrade_guards) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype;i qualification_source_upgrade_intents%rowtype;
begin
 select * into c from control where singleton;
 select * into i from qualification_source_upgrade_intents where operation_id=a.source_upgrade_id and action_id=a.action_id;
 return coalesce(session_user='postgres' and a.database_session_user=session_user and qualification_source_upgrade_guard_scope(a.binding)
  and qualification_source_upgrade_quiescent() and not exact_preview_admin_open()
  and i.operation_id is not null and i.request_sha256=a.binding->>'requestSha256'
  and a.execute_intent=jsonb_build_object('disposition','execute','operationId',i.operation_id,'actionId',i.action_id,
   'proofSha256',a.binding->>'proofSha256','request',i.request,'requestSha256',i.request_sha256,'epoch',1)
  and (select count(*) from qualification_source_upgrade_intents where operation_id=a.source_upgrade_id)=i.ordinal
  and (select count(*) from qualification_source_upgrade_events where operation_id=a.source_upgrade_id)=i.ordinal-1
  and not exists(select 1 from qualification_source_upgrade_events where operation_id=a.source_upgrade_id and action_id=a.action_id)
  and (i.ordinal<=5 and c.source_upgrade_id=a.source_upgrade_id
   or i.ordinal=6 and c.source_upgrade_id is null and exists(select 1 from qualification_source_upgrade_milestones where operation_id=a.source_upgrade_id and milestone='configuration_ready'))
  and not exists(select 1 from qualification_source_upgrade_guards g where (g.source_upgrade_id,g.action_id)<>(a.source_upgrade_id,a.action_id)
   and (select state from qualification_source_upgrade_guard_events e where e.source_upgrade_id=g.source_upgrade_id and e.action_id=g.action_id order by event_id desc limit 1) is distinct from 'submitted'),false);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_guard_claim(b jsonb,ready jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrade_guards%rowtype;r jsonb;
begin
 perform 1 from control where singleton for update;
 if session_user<>'postgres' or not qualification_source_upgrade_guard_scope(b) then raise exception 'COORDINATION_SOURCE_GUARD_SCOPE';end if;
 if exists(select 1 from qualification_source_upgrade_guards where source_upgrade_id=b->>'sourceUpgradeId' and action_id=b->>'actionId')
  or exists(select 1 from qualification_source_upgrade_intents where operation_id=b->>'sourceUpgradeId' and action_id=b->>'actionId')
 then raise exception 'COORDINATION_SOURCE_GUARD_CONSUMED';end if;
 if qualification_source_upgrade_guard_open() or exact_preview_admin_open() then raise exception 'COORDINATION_SOURCE_GUARD_BUSY';end if;
 r:=qualification_source_upgrade_intent(b->>'sourceUpgradeId',b->>'actionId',b->>'proofSha256',ready);
 if r->>'disposition' is distinct from 'execute' or r->>'requestSha256' is distinct from b->>'requestSha256'
 then raise exception 'COORDINATION_SOURCE_GUARD_EXECUTE_REQUIRED';end if;
 insert into qualification_source_upgrade_guards(source_upgrade_id,action_id,binding,binding_sha256,execute_intent)
  values(b->>'sourceUpgradeId',b->>'actionId',b,auth_maintenance_hash(b),r) returning * into a;
 if not qualification_source_upgrade_guard_held(a) then raise exception 'COORDINATION_SOURCE_GUARD_NOT_HELD';end if;
 insert into qualification_source_upgrade_guard_events(source_upgrade_id,action_id,state,reason) values(a.source_upgrade_id,a.action_id,'claimed','actual_postgres_source_upgrade_claim');
 return qualification_source_upgrade_guard_lease(a);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_guard_assert(l jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrade_guards%rowtype;st text;
begin
 perform 1 from control where singleton for update;
 select * into a from qualification_source_upgrade_guards where source_upgrade_id||':'||action_id=l->>'operationId';
 select state into st from qualification_source_upgrade_guard_events where source_upgrade_id=a.source_upgrade_id and action_id=a.action_id order by event_id desc limit 1;
 if a.lease_id is null or l is distinct from qualification_source_upgrade_guard_lease(a) or coalesce(st,'missing') not in ('claimed','prepared','submitting')
  or not qualification_source_upgrade_guard_held(a) then raise exception 'COORDINATION_SOURCE_GUARD_LEASE';end if;
 return qualification_source_upgrade_guard_lease(a);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_guard_record(l jsonb,new_state text,new_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrade_guards%rowtype;st text;
begin
 perform 1 from control where singleton for update;
 select * into a from qualification_source_upgrade_guards where source_upgrade_id||':'||action_id=l->>'operationId';
 select state into st from qualification_source_upgrade_guard_events where source_upgrade_id=a.source_upgrade_id and action_id=a.action_id order by event_id desc limit 1;
 if session_user<>'postgres' or a.lease_id is null or a.database_session_user<>session_user
  or l is distinct from qualification_source_upgrade_guard_lease(a)
  or not ((st='claimed' and new_state='prepared' and new_reason='durable_prepared')
   or (st='prepared' and new_state='submitting' and new_reason='durable_submitting')
   or (st='submitting' and new_state='submitted' and new_reason='provider_acknowledged')
   or (st='submitting' and new_state='uncertain' and new_reason in ('provider_exception','provider_result_unconfirmed')))
 then raise exception 'COORDINATION_SOURCE_GUARD_TRANSITION';end if;
 if new_state in ('prepared','submitting') then perform qualification_source_upgrade_guard_assert(l);end if;
 -- Terminal recording must survive the newly dispatched runner claiming its
 -- own operation. It records this guard only, never an applied source event.
 insert into qualification_source_upgrade_guard_events(source_upgrade_id,action_id,state,reason) values(a.source_upgrade_id,a.action_id,new_state,new_reason);
 return jsonb_build_object('lease',qualification_source_upgrade_guard_lease(a),'state',new_state,'durable',true);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_guard_snapshot(l jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrade_guards%rowtype;st text;
begin
 select * into a from qualification_source_upgrade_guards where source_upgrade_id||':'||action_id=l->>'operationId';
 select state into st from qualification_source_upgrade_guard_events where source_upgrade_id=a.source_upgrade_id and action_id=a.action_id order by event_id desc limit 1;
 if session_user<>'postgres' or a.lease_id is null or st is null or a.database_session_user<>session_user
  or l is distinct from qualification_source_upgrade_guard_lease(a) then raise exception 'COORDINATION_SOURCE_GUARD_LEASE';end if;
 return jsonb_build_object('lease',qualification_source_upgrade_guard_lease(a),'state',st,'binding',a.binding,'intent',a.execute_intent,
  'sourceUpgradeSnapshot',jsonb_build_object('kind','fcos_source_upgrade_snapshot_projection_v1','observedAt',clock_timestamp(),
   'snapshot',qualification_source_upgrade_snapshot(a.source_upgrade_id,a.binding->>'proofSha256')#-'{upgrade,proof}',
   'proofCanonicalSha256',(select auth_maintenance_hash(proof) from qualification_source_upgrades where operation_id=a.source_upgrade_id)),'replayAllowed',false);
end $$;
create function fcos_release_coordination.qualification_source_upgrade_guard_lookup(b jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a qualification_source_upgrade_guards%rowtype;
begin
 select * into a from qualification_source_upgrade_guards where binding=b and binding_sha256=auth_maintenance_hash(b);
 if session_user<>'postgres' or a.lease_id is null or a.database_session_user<>session_user then raise exception 'COORDINATION_SOURCE_GUARD_LEASE';end if;
 return qualification_source_upgrade_guard_snapshot(qualification_source_upgrade_guard_lease(a));
end $$;
do $permissions$ declare t text;f regprocedure;begin
 foreach t in array array['qualification_source_upgrade_guards','qualification_source_upgrade_guard_events'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime,postgres',t);
  execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and proname like 'qualification_source_upgrade_guard_%' loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime,postgres',f);
 end loop;
end $permissions$;
grant execute on function fcos_release_coordination.qualification_source_upgrade_guard_claim(jsonb,jsonb),fcos_release_coordination.qualification_source_upgrade_guard_assert(jsonb),fcos_release_coordination.qualification_source_upgrade_guard_record(jsonb,text,text),fcos_release_coordination.qualification_source_upgrade_guard_snapshot(jsonb),fcos_release_coordination.qualification_source_upgrade_guard_lookup(jsonb) to postgres;
commit;
