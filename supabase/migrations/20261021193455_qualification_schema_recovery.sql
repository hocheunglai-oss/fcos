-- One finite, postgres-admitted schema-only recovery on the existing epoch.
-- Historical bootstrap, UNKNOWN imports, sentinel and source remain immutable.
begin;
create table fcos_release_coordination.qualification_schema_recoveries(
 recovery_id text primary key check(recovery_id='qualification-schema-recovery-epoch1-39653018028-v1'),
 epoch bigint not null unique references fcos_release_coordination.epochs,
 original_bootstrap_id text not null unique references fcos_release_coordination.cutover_bootstraps,
 proof jsonb not null,proof_sha256 text not null,admitted_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.qualification_schema_recovery_actions(
 recovery_id text not null references fcos_release_coordination.qualification_schema_recoveries,
 action_id text not null,ordinal integer not null,request jsonb not null,request_sha256 text not null,
 intended_at timestamptz not null default clock_timestamp(),primary key(recovery_id,action_id),unique(recovery_id,ordinal));
create table fcos_release_coordination.qualification_schema_recovery_events(
 event_id bigint generated always as identity primary key,recovery_id text not null,action_id text not null,
 state text not null check(state in ('applied','uncertain','not_applied')),evidence jsonb not null,evidence_sha256 text not null,
 recorded_at timestamptz not null default clock_timestamp(),foreign key(recovery_id,action_id) references fcos_release_coordination.qualification_schema_recovery_actions);
create table fcos_release_coordination.qualification_schema_recovery_finishes(
 recovery_id text primary key references fcos_release_coordination.qualification_schema_recoveries,
 proof_sha256 text not null,finished_at timestamptz not null default clock_timestamp());
alter table fcos_release_coordination.control add column recovery_id text references fcos_release_coordination.qualification_schema_recoveries;
alter table fcos_release_coordination.control add constraint coordination_recovery_one_writer
 check(recovery_id is null or operation_id is null and bootstrap_id is null);

-- Byte-identical immutable 64aa public-catalog query. Owner preparation only;
-- the dedicated hosted observer still has its separate privilege/read-only gate.
create function fcos_release_coordination.qualification_schema_recovery_catalog_digest() returns text
language sql stable set search_path=pg_catalog as $schema_catalog$
 select fcos_release_coordination.auth_maintenance_hash(snapshot) from (
select jsonb_build_object(
 'schema',(select jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',
  (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
    order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
   from aclexplode(case when cardinality(n.nspacl)=0 then null else coalesce(n.nspacl,acldefault('n',n.nspowner)) end) x)) from pg_namespace n where n.nspname='public'),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),
   (select coalesce(jsonb_agg(option order by option),'[]') from unnest(c.reloptions) option),
   (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
     order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
    from aclexplode(case when cardinality(c.relacl)=0 then null else coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner)) end) x),
   case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) else null end) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')),
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attnum,pg_get_expr(d.adbin,d.adrelid),a.attnotnull,format_type(a.atttypid,a.atttypmod),
   (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
     order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
    from aclexplode(case when cardinality(a.attacl)=0 then null else a.attacl end) x)) order by c.relname,a.attnum),'[]')
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) order by c.relname,k.conname),'[]')
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(tablename,indexname,indexdef) order by tablename,indexname),'[]') from pg_indexes where schemaname='public'),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname),'[]') from pg_policies p where schemaname='public'),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,false)) order by c.relname,t.tgname),'[]')
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),
   (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
     order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
    from aclexplode(case when cardinality(p.proacl)=0 then null else coalesce(p.proacl,acldefault('f',p.proowner)) end) x)) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p'))
) as snapshot
 ) observed_catalog
$schema_catalog$;

create function fcos_release_coordination.qualification_schema_recovery_actions_for(s jsonb,plan jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,fcos_release_coordination as $$
 select jsonb_build_array(
  jsonb_build_object('id','replace_setup','request',jsonb_build_object('method','PATCH','route','/repos/hocheunglai-oss/fcos/actions/variables/FCOS_ADMITTED_RELEASE_SETUP',
   'body',jsonb_build_object('name','FCOS_ADMITTED_RELEASE_SETUP','value',auth_maintenance_canonical(s)))),
  jsonb_build_object('id','replace_setup_sha','request',jsonb_build_object('method','PATCH','route','/repos/hocheunglai-oss/fcos/actions/variables/FCOS_ADMITTED_RELEASE_SETUP_SHA256',
   'body',jsonb_build_object('name','FCOS_ADMITTED_RELEASE_SETUP_SHA256','value',auth_maintenance_hash(s)))),
  jsonb_build_object('id','dispatch_qualification','request',jsonb_build_object('method','POST','route','/repos/hocheunglai-oss/fcos/actions/workflows/authenticated-release.yml/dispatches',
   'body',jsonb_build_object('ref','codex/hosted-qualification-dependency-setup-20261020','inputs',jsonb_build_object('bootstrap_phase','qualification',
    'candidate_sha','2ef733d17dd12314c72971c2220b2b09903a6bf0','plan',auth_maintenance_canonical(plan),'xero_recovery_mode','disabled'))))) $$;

-- Review objects bind inspected bytes. The privileged postgres caller authenticates
-- admission; these object strings and digests do not authenticate a reviewer.
create function fcos_release_coordination.qualification_schema_recovery_proof_valid(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare b cutover_bootstraps%rowtype; old jsonb; s jsonb; v jsonb; o jsonb; acceptance jsonb; prior_acceptance jsonb;
 f jsonb; review jsonb; k text; times jsonb; installed jsonb;
begin
 if not auth_maintenance_object(p,array['schemaVersion','kind','epoch','recoveryId','originalBootstrapId','originalBootstrapSha256',
  'setup','setupSha256','plan','planSha256','terminalFailure','actions','rootReview','independentReview'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'kind' is distinct from 'fcos_qualification_schema_recovery_v1'
  or p->'epoch' is distinct from '1'::jsonb or p->>'recoveryId' is distinct from 'qualification-schema-recovery-epoch1-39653018028-v1'
  or p->>'originalBootstrapId' is distinct from 'qualification-bootstrap-epoch1-3527fbf5-v1'
 then return false; end if;
 select * into b from cutover_bootstraps where bootstrap_id=p->>'originalBootstrapId';old:=b.proof;s:=p->'setup';
 if b.bootstrap_id is null or b.epoch<>1 or b.proof_sha256 is distinct from p->>'originalBootstrapSha256'
  or b.proof_sha256 is distinct from auth_maintenance_hash(old) or not cutover_bootstrap_proof_valid(old)
  or not exists(select 1 from cutover_bootstrap_finishes z where z.bootstrap_id=b.bootstrap_id and z.proof_sha256=b.proof_sha256)
  or (select count(*) from cutover_bootstrap_actions where bootstrap_id=b.bootstrap_id)<>2
  or exists(select 1 from cutover_bootstrap_actions a where a.bootstrap_id=b.bootstrap_id and
    (select state from cutover_bootstrap_events e where e.bootstrap_id=a.bootstrap_id and e.action_id=a.action_id order by event_id desc limit 1) is distinct from 'applied')
  or (select count(*) from imported_uncertainty where epoch=1)<>3
  or exists(select 1 from import_resolutions z join imported_uncertainty u using(import_id) where u.epoch=1)
  or not exact_7dc_publication_quarantined('replacement-template-7dc21331fe45',1)
  or jsonb_typeof(s) is distinct from 'object' or s-'firstRuntimeBaseline' is distinct from (old->'setup')-'firstRuntimeBaseline'
  or auth_maintenance_hash(s) is distinct from p->>'setupSha256' or auth_maintenance_hash(p->'plan') is distinct from p->>'planSha256'
 then return false; end if;
 select activation_evidence into installed from epochs where epoch=1;
 if installed->'legacyFence'->>'kind' is distinct from 'permanent_legacy_sentinel'
  or installed->'legacyFence'->>'proofHash' is distinct from old->>'sentinelSha256'
  or installed->>'inventoryHash' is distinct from old->>'inventorySha256'
 then return false; end if;
 begin
  v:=(s->'firstRuntimeBaseline'->>'json')::jsonb;o:=(old->'setup'->'firstRuntimeBaseline'->>'json')::jsonb;
  acceptance:=(s->'firstRuntimeBaseline'->'acceptance'->>'json')::jsonb;
  prior_acceptance:=(old->'setup'->'firstRuntimeBaseline'->'acceptance'->>'json')::jsonb;
 exception when others then return false; end;
 if not auth_maintenance_object(s->'firstRuntimeBaseline',array['json','sha256','acceptance'])
  or not auth_maintenance_object(s->'firstRuntimeBaseline'->'acceptance',array['json','sha256'])
  or encode(sha256(convert_to(s->'firstRuntimeBaseline'->>'json','UTF8')),'hex') is distinct from s->'firstRuntimeBaseline'->>'sha256'
  or encode(sha256(convert_to(s->'firstRuntimeBaseline'->'acceptance'->>'json','UTF8')),'hex') is distinct from s->'firstRuntimeBaseline'->'acceptance'->>'sha256'
  or o->'schemaVersion' is distinct from '2'::jsonb or v->'schemaVersion' is distinct from '2'::jsonb
  or v-'schema'-'nativeEvidence' is distinct from o-'schema'-'nativeEvidence'
  or (v->'nativeEvidence')-'schema' is distinct from (o->'nativeEvidence')-'schema'
  or not auth_maintenance_object(v->'schema',array['projectRef','sha256','capturedAt','readOnly'])
  or jsonb_typeof(v->'schema'->'capturedAt') is distinct from 'string'
  or v->'schema'->>'projectRef' is distinct from 'pjforfvchygdyqfcgpmw' or v->'schema'->'readOnly' is distinct from 'true'::jsonb
  or v->'schema'->>'sha256' is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'
  or v->'schema'->>'sha256' is not distinct from o->'schema'->>'sha256'
  or not auth_maintenance_object(v->'nativeEvidence'->'schema',array['sha256','capturedAt'])
  or jsonb_typeof(v->'nativeEvidence'->'schema'->'sha256') is distinct from 'string'
  or coalesce(v->'nativeEvidence'->'schema'->>'sha256','') !~ '^[a-f0-9]{64}$'
  or v->'nativeEvidence'->'schema'->>'capturedAt' is distinct from v->'schema'->>'capturedAt'
  or acceptance-'baselineSha256'-'evidenceSha256'-'originalObservationTimesSha256'-'reviewedAt'
   is distinct from prior_acceptance-'baselineSha256'-'evidenceSha256'-'originalObservationTimesSha256'-'reviewedAt'
  or acceptance->>'kind' is distinct from 'fcos_root_accepted_first_runtime_baseline_v2' or acceptance->>'reviewerId' is distinct from '/root'
  or acceptance->'accepted' is distinct from 'true'::jsonb or acceptance->'finalManifestApprovalRequired' is distinct from 'true'::jsonb
  or jsonb_typeof(acceptance->'reviewedAt') is distinct from 'string'
  or acceptance->>'baselineSha256' is distinct from s->'firstRuntimeBaseline'->>'sha256'
  or acceptance->>'evidenceSha256' is distinct from auth_maintenance_hash(jsonb_build_object('nativeEvidence',v->'nativeEvidence','publicEvidence',v->'publicEvidence',
    'configurationCopy',v->'configurationCopy','originalOwners',v->'originalOwners'))
  or p->'plan'->>'releaseId' is distinct from 'fcos-qualification-64aa338b-2ef733d1-schema-20261022'
  or p->'plan'->>'releaseId' is not distinct from old->'plan'->>'releaseId'
  or (p->'plan')-'releaseId'-'migration' is distinct from (old->'plan')-'releaseId'-'migration'
  or (p->'plan'->'migration')-'expectedSchemaSha256' is distinct from (old->'plan'->'migration')-'expectedSchemaSha256'
  or p->'plan'->'migration'->>'expectedSchemaSha256' is distinct from v->'schema'->>'sha256'
  or p->'actions' is distinct from qualification_schema_recovery_actions_for(s,p->'plan')
 then return false; end if;
 times:=jsonb_build_object('nativeEvidence',(select jsonb_object_agg(key,value->'capturedAt') from jsonb_each(v->'nativeEvidence')),
  'publicEvidence',(select jsonb_object_agg(key,value->'capturedAt') from jsonb_each(v->'publicEvidence')),
  'configurationCopy',v->'configurationCopy'->'capturedAt','diagnostic',v->'configurationCopy'->'diagnostic'->'observedAt',
  'endpointAbsence',v->'endpointAbsence'->'capturedAt','schema',v->'schema'->'capturedAt','historicalAbsence',v->'runtime'->'capturedAt',
  'originalOwners',(select jsonb_object_agg(key,value->'authority'->'capturedAt') from jsonb_each(v->'originalOwners')));
 if acceptance->>'originalObservationTimesSha256' is distinct from auth_maintenance_hash(times) then return false; end if;
 begin
  if not isfinite((v->'schema'->>'capturedAt')::timestamptz) or (v->'schema'->>'capturedAt')::timestamptz <= (o->'schema'->>'capturedAt')::timestamptz
   or (v->'schema'->>'capturedAt')::timestamptz > statement_timestamp()+interval '30 seconds'
   or not isfinite((acceptance->>'reviewedAt')::timestamptz) or (acceptance->>'reviewedAt')::timestamptz < (v->'schema'->>'capturedAt')::timestamptz
   or (acceptance->>'reviewedAt')::timestamptz > statement_timestamp()+interval '30 seconds' then return false; end if;
 exception when others then return false; end;
 f:=p->'terminalFailure';
 if not auth_maintenance_object(f,array['runId','runAttempt','status','conclusion','failedStep','code','beforeRegistration','providerEvidenceSha256'])
  or f->>'runId' is distinct from '39653018028' or f->>'runAttempt' is distinct from '1' or f->>'status' is distinct from 'completed'
  or f->>'conclusion' is distinct from 'failure' or f->>'failedStep' is distinct from 'Prepare actual qualification manifest'
  or f->>'code' is distinct from 'LIVE_SCHEMA_CHANGED' or f->'beforeRegistration' is distinct from 'true'::jsonb
  or jsonb_typeof(f->'runId') is distinct from 'string' or jsonb_typeof(f->'runAttempt') is distinct from 'string'
  or jsonb_typeof(f->'providerEvidenceSha256') is distinct from 'string'
  or coalesce(f->>'providerEvidenceSha256','') !~ '^[a-f0-9]{64}$' then return false; end if;
 foreach k in array array['rootReview','independentReview'] loop
  review:=p->k;
  if not auth_maintenance_object(review,array['kind','role','reviewerId','accepted','subjectSha256','sourceEvidenceSha256','reviewedAt'])
   or review->>'kind' is distinct from 'fcos_qualification_schema_recovery_review_v1' or review->'accepted' is distinct from 'true'::jsonb
   or review->>'role' is distinct from (case when k='rootReview' then 'root' else 'independent' end)
   or review->>'reviewerId' is distinct from (case when k='rootReview' then '/root' else '/root/canonical_publication_review' end)
   or review->>'subjectSha256' is distinct from auth_maintenance_hash(p-'rootReview'-'independentReview')
   or jsonb_typeof(review->'reviewedAt') is distinct from 'string' or jsonb_typeof(review->'sourceEvidenceSha256') is distinct from 'string'
   or coalesce(review->>'sourceEvidenceSha256','') !~ '^[a-f0-9]{64}$' then return false; end if;
  begin
   if not isfinite((review->>'reviewedAt')::timestamptz) or (review->>'reviewedAt')::timestamptz < (acceptance->>'reviewedAt')::timestamptz
    or (review->>'reviewedAt')::timestamptz > statement_timestamp()+interval '30 seconds' then return false; end if;
  exception when others then return false; end;
 end loop;
 return true;
exception when others then return false;
end $$;

create function fcos_release_coordination.admit_qualification_schema_recovery(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; r qualification_schema_recoveries%rowtype;
begin
 select * into c from control where singleton for update;
 select * into r from qualification_schema_recoveries where recovery_id=p->>'recoveryId';
 if r.recovery_id is not null then
  if r.proof is distinct from p then raise exception 'COORDINATION_SCHEMA_RECOVERY_CONFLICT'; end if;
  return jsonb_build_object('disposition','readback','recoveryId',r.recovery_id,'proofSha256',r.proof_sha256);
 end if;
 if qualification_schema_recovery_catalog_digest() is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d' then raise exception 'COORDINATION_SCHEMA_RECOVERY_LIVE_SCHEMA_CHANGED'; end if;
 if not qualification_schema_recovery_proof_valid(p) or c.epoch<>1 or c.mode<>'qualification'
  or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or exists(select 1 from registrations where epoch=1) or exists(select 1 from operations where epoch=1)
  or exists(select 1 from legacy_release_containments where epoch=1)
  or exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null)
 then raise exception 'COORDINATION_SCHEMA_RECOVERY_ADMISSION_INVALID'; end if;
 insert into qualification_schema_recoveries values(p->>'recoveryId',1,p->>'originalBootstrapId',p,auth_maintenance_hash(p),clock_timestamp());
 update control set recovery_id=p->>'recoveryId' where singleton;
 return jsonb_build_object('disposition','admitted','recoveryId',p->>'recoveryId','proofSha256',auth_maintenance_hash(p),'epoch',1,'providerAuthorityGranted',false);
end $$;

create function fcos_release_coordination.qualification_schema_recovery_snapshot(id text,proof_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare r qualification_schema_recoveries%rowtype;
begin
 select * into r from qualification_schema_recoveries where recovery_id=id;
 if r.recovery_id is null or r.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SCHEMA_RECOVERY_BINDING_CHANGED'; end if;
 return jsonb_build_object('recovery',to_jsonb(r),'control',(select to_jsonb(c) from control c where singleton),
  'actions',coalesce((select jsonb_agg(to_jsonb(a) order by ordinal) from qualification_schema_recovery_actions a where recovery_id=id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by event_id) from qualification_schema_recovery_events e where recovery_id=id),'[]'::jsonb),
  'finished',exists(select 1 from qualification_schema_recovery_finishes where recovery_id=id));
end $$;
create function fcos_release_coordination.qualification_schema_recovery_intent(id text,action_id text,proof_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; r qualification_schema_recoveries%rowtype; a qualification_schema_recovery_actions%rowtype; expected jsonb; n integer;
begin
 select * into c from control where singleton for update;
 select * into r from qualification_schema_recoveries where recovery_id=id;
 if r.recovery_id is null or r.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SCHEMA_RECOVERY_BINDING_CHANGED'; end if;
 select * into a from qualification_schema_recovery_actions x where x.recovery_id=id and x.action_id=qualification_schema_recovery_intent.action_id;
 if a.action_id is not null then return jsonb_build_object('disposition','readback','request',a.request,'requestSha256',a.request_sha256); end if;
 if qualification_schema_recovery_catalog_digest() is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d' then raise exception 'COORDINATION_SCHEMA_RECOVERY_LIVE_SCHEMA_CHANGED'; end if;
 if c.epoch<>r.epoch or c.mode<>'qualification' or c.recovery_id is distinct from id or c.operation_id is not null or c.bootstrap_id is not null
  or not qualification_schema_recovery_proof_valid(r.proof) or exists(select 1 from qualification_schema_recovery_finishes where recovery_id=id)
 then raise exception 'COORDINATION_SCHEMA_RECOVERY_LOCK_REQUIRED'; end if;
 select count(*)+1 into n from qualification_schema_recovery_actions where recovery_id=id;expected:=r.proof->'actions'->(n-1);
 if expected->>'id' is distinct from action_id or exists(select 1 from qualification_schema_recovery_actions x where x.recovery_id=id and
  (select state from qualification_schema_recovery_events e where e.recovery_id=x.recovery_id and e.action_id=x.action_id order by event_id desc limit 1) is distinct from 'applied')
 then raise exception 'COORDINATION_SCHEMA_RECOVERY_PRIOR_ACTION_UNRESOLVED'; end if;
 insert into qualification_schema_recovery_actions values(id,action_id,n,expected->'request',auth_maintenance_hash(expected->'request'),clock_timestamp()) returning * into a;
 return jsonb_build_object('disposition','execute','recoveryId',id,'actionId',action_id,'request',a.request,'requestSha256',a.request_sha256,'epoch',c.epoch);
end $$;
create function fcos_release_coordination.record_qualification_schema_recovery(id text,action_id text,proof_hash text,evidence jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; r qualification_schema_recoveries%rowtype; a qualification_schema_recovery_actions%rowtype; last_ev qualification_schema_recovery_events%rowtype; state_value text;
begin
 select * into c from control where singleton for update;
 select * into r from qualification_schema_recoveries where recovery_id=id;
 select * into a from qualification_schema_recovery_actions x where x.recovery_id=id and x.action_id=record_qualification_schema_recovery.action_id;
 if r.recovery_id is null or r.proof_sha256 is distinct from proof_hash or a.action_id is null
  or not auth_maintenance_object(evidence,array['basis','outcome','requestSha256','providerEvidenceSha256','rootReviewSha256'])
  or evidence->>'requestSha256' is distinct from a.request_sha256 or evidence->>'rootReviewSha256' is distinct from auth_maintenance_hash(r.proof->'rootReview')
  or coalesce(evidence->>'providerEvidenceSha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(evidence->>'basis','') not in ('native_ack','owner_readback') or coalesce(evidence->>'outcome','') not in ('applied','not_applied','unknown')
 then raise exception 'COORDINATION_SCHEMA_RECOVERY_EVIDENCE_INVALID'; end if;
 select * into last_ev from qualification_schema_recovery_events e where e.recovery_id=id and e.action_id=record_qualification_schema_recovery.action_id order by event_id desc limit 1;
 if last_ev.state in ('applied','not_applied') then
  if last_ev.evidence is distinct from evidence then raise exception 'COORDINATION_SCHEMA_RECOVERY_TERMINAL'; end if;
  return jsonb_build_object('disposition','readback','state',last_ev.state);
 end if;
 if c.epoch<>r.epoch or c.mode<>'qualification' or c.recovery_id is distinct from id or c.operation_id is not null or c.bootstrap_id is not null
  or last_ev.state='uncertain' and evidence->>'basis'<>'owner_readback' then raise exception 'COORDINATION_SCHEMA_RECOVERY_READBACK_REQUIRED'; end if;
 state_value:=case when evidence->>'outcome'='unknown' then 'uncertain' else evidence->>'outcome' end;
 insert into qualification_schema_recovery_events(recovery_id,action_id,state,evidence,evidence_sha256) values(id,action_id,state_value,evidence,auth_maintenance_hash(evidence));
 return jsonb_build_object('disposition','recorded','state',state_value);
end $$;
create function fcos_release_coordination.finish_qualification_schema_recovery(id text,proof_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; r qualification_schema_recoveries%rowtype;
begin
 select * into c from control where singleton for update;
 select * into r from qualification_schema_recoveries where recovery_id=id;
 if r.recovery_id is null or r.proof_sha256 is distinct from proof_hash then raise exception 'COORDINATION_SCHEMA_RECOVERY_BINDING_CHANGED'; end if;
 if exists(select 1 from qualification_schema_recovery_finishes where recovery_id=id) then return jsonb_build_object('disposition','complete','recoveryId',id); end if;
 if c.epoch<>r.epoch or c.mode<>'qualification' or c.recovery_id is distinct from id or c.operation_id is not null or c.bootstrap_id is not null
  or not qualification_schema_recovery_proof_valid(r.proof) or exists(select 1 from registrations where epoch=r.epoch)
  or exists(select 1 from operations where epoch=r.epoch) or exists(select 1 from legacy_release_containments where epoch=r.epoch)
  or (select count(*) from qualification_schema_recovery_actions where recovery_id=id)<>3
  or exists(select 1 from qualification_schema_recovery_actions x where x.recovery_id=id and
   (select state from qualification_schema_recovery_events e where e.recovery_id=x.recovery_id and e.action_id=x.action_id order by event_id desc limit 1) is distinct from 'applied')
 then raise exception 'COORDINATION_SCHEMA_RECOVERY_PRIOR_ACTION_UNRESOLVED'; end if;
 insert into qualification_schema_recovery_finishes values(id,proof_hash,clock_timestamp());update control set recovery_id=null where singleton;
 return jsonb_build_object('disposition','complete','recoveryId',id,'epoch',c.epoch);
end $$;

-- Derived admission projection only: no original proof/table is changed.
-- The original validator still checks source, containment and UNKNOWN state.
create function fcos_release_coordination.qualification_schema_recovery_effective_proof(e bigint) returns jsonb
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare r qualification_schema_recoveries%rowtype; b cutover_bootstraps%rowtype; projected jsonb;
begin
 select * into r from qualification_schema_recoveries where epoch=e;
 if r.recovery_id is null or not qualification_schema_recovery_proof_valid(r.proof) then return null; end if;
 select * into b from cutover_bootstraps where bootstrap_id=r.original_bootstrap_id;
 projected:=b.proof||jsonb_build_object('setup',r.proof->'setup','setupSha256',r.proof->'setupSha256','plan',r.proof->'plan','planSha256',r.proof->'planSha256');
 projected:=jsonb_set(projected,'{actions}',jsonb_build_array(b.proof->'actions'->0,r.proof->'actions'->2));
 if not cutover_bootstrap_proof_valid(projected) then return null; end if;return projected;
end $$;

-- Exact body pins are checked before every replacement. Preserve original
-- OIDs/signatures/owners/ACL/search_path and existing consumed readback order.
do $$ declare sig text; expected text; definition text; original text; needle text; replacement text; begin
 for sig,expected in select * from (values
  ('cutover_bootstrap_claim_ready(jsonb)','5d939253484eb2ff53e5070039c6da83db6e0c4649edc164ca55483016841b69'),
  ('cutover_bootstrap_pending(text,jsonb,jsonb)','cba6b108939a3ec8bb9baa930308731a0d96bfae22579f594dea61c6b2698ae4'),
  ('dispatch(text,jsonb,jsonb)','dd5a6894eb7826f7c781772b63730f9fc7879f8d8fbc46812b0a412b12ef587a'),
  ('install_epoch(bigint,jsonb)','ba8075a358ebc924b325cfbf23f202d5162cf453cc249824deb5de2d5272f2d7'),
  ('activate(bigint,jsonb)','005bd7e5b3a0165a71e55ca1026ed08f0a95115b3c903fb746eff5346b841c3a')) x loop
  if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=('fcos_release_coordination.'||sig)::regprocedure) is distinct from expected
  then raise exception 'COORDINATION_SCHEMA_RECOVERY_SOURCE_DRIFT'; end if;
 end loop;
 original:=pg_get_functiondef('fcos_release_coordination.cutover_bootstrap_claim_ready(jsonb)'::regprocedure);
 definition:=replace(original,'cutover_bootstrap_claim_ready','qualification_schema_recovery_claim_ready');
 needle:=' select * into b from cutover_bootstraps where epoch=r.epoch;';
 replacement:=needle||E'\n b.proof:=qualification_schema_recovery_effective_proof(r.epoch);\n if b.proof is null or not exists(select 1 from qualification_schema_recovery_finishes f join qualification_schema_recoveries s using(recovery_id) where s.epoch=r.epoch) then return false; end if;';
 if position(needle in definition)=0 then raise exception 'COORDINATION_SCHEMA_RECOVERY_SOURCE_DRIFT'; end if;execute replace(definition,needle,replacement);
 execute replace(original,needle,needle||E'\n if exists(select 1 from qualification_schema_recoveries where epoch=r.epoch) then return qualification_schema_recovery_claim_ready(p); end if;');
 original:=pg_get_functiondef('fcos_release_coordination.cutover_bootstrap_pending(text,jsonb,jsonb)'::regprocedure);
 definition:=replace(original,'cutover_bootstrap_pending','qualification_schema_recovery_pending');
 needle:=' select * into b from cutover_bootstraps where epoch=c.epoch;';
 definition:=replace(definition,needle,needle||E'\n b.proof:=qualification_schema_recovery_effective_proof(c.epoch);\n if b.proof is null then return false; end if;');
 definition:=replace(definition,'if c.bootstrap_id=b.bootstrap_id then return action=''register''; end if;','if c.recovery_id is not null then return action=''register''; end if;');
 definition:=replace(definition,'exists(select 1 from cutover_bootstrap_finishes where bootstrap_id=b.bootstrap_id)',
  'exists(select 1 from qualification_schema_recovery_finishes f join qualification_schema_recoveries s using(recovery_id) where s.epoch=c.epoch)');
 execute definition;
 execute replace(original,needle,needle||E'\n if exists(select 1 from qualification_schema_recoveries where epoch=c.epoch) then return qualification_schema_recovery_pending(action,p,principal); end if;');
 definition:=pg_get_functiondef('fcos_release_coordination.dispatch(text,jsonb,jsonb)'::regprocedure);
 needle:=' select * into c from control where singleton for update;';
 execute replace(definition,needle,needle||E'\n if c.recovery_id is not null and (action=\'register\' or action in (\'begin\',\'claim\') and not exists(select 1 from operations x where x.release_id=p->>\'releaseId\' and x.phase=p->>\'phase\')) then raise exception \'COORDINATION_BOOTSTRAP_BUSY\'; end if;');
 foreach sig in array array['install_epoch(bigint,jsonb)','activate(bigint,jsonb)'] loop
  definition:=pg_get_functiondef(('fcos_release_coordination.'||sig)::regprocedure);
  needle:='  select * into c from fcos_release_coordination.control where singleton for update;';
  if position(needle in definition)=0 then raise exception 'COORDINATION_SCHEMA_RECOVERY_SOURCE_DRIFT'; end if;
  execute replace(definition,needle,needle||E'\n  if c.recovery_id is not null then raise exception \'COORDINATION_BOOTSTRAP_BUSY\'; end if;');
 end loop;
end $$;
do $$ declare t text; f regprocedure; begin
 foreach t in array array['qualification_schema_recoveries','qualification_schema_recovery_actions','qualification_schema_recovery_events','qualification_schema_recovery_finishes'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('revoke all on fcos_release_coordination.%I from public,anon,authenticated,service_role,fcos_coordinator_runtime',t);
  execute format('create trigger schema_recovery_append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='fcos_release_coordination'::regnamespace and
  (proname like 'qualification_schema_recovery_%' or proname in ('admit_qualification_schema_recovery','record_qualification_schema_recovery','finish_qualification_schema_recovery')) loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f);
  execute format('grant execute on function %s to postgres',f);
 end loop;
end $$;
commit;
