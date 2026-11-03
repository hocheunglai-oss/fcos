begin;
-- Same coordinator/epoch only. These tables contain public authority bindings,
-- never credentials or provider authority. Imports require privileged review.
alter table fcos_release_coordination.registrations drop constraint registrations_scope_check;
alter table fcos_release_coordination.registrations add constraint registrations_scope_check check(scope in ('qualification','release','financial','auth_maintenance'));
create table fcos_release_coordination.auth_maintenance_authorities(
 authority_id text primary key, authority jsonb not null, authority_sha256 text not null unique, imported_at timestamptz not null default clock_timestamp());
create unique index auth_maintenance_one_human_authority on fcos_release_coordination.auth_maintenance_authorities ((authority->>'humanAuthorityEvidenceSha256'));
create table fcos_release_coordination.auth_maintenance_revocations(
 authority_id text primary key references fcos_release_coordination.auth_maintenance_authorities, evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'), revoked_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.auth_maintenance_occurrences(
 occurrence_id uuid primary key, authority_id text not null references fcos_release_coordination.auth_maintenance_authorities,
 operation_id text not null unique, release_id text not null unique references fcos_release_coordination.registrations,
 phase text not null, manifest jsonb not null, allocated_at timestamptz not null default clock_timestamp());
-- No epoch FK: unresolved original-era intent survives install/cutover.
create table fcos_release_coordination.auth_maintenance_fences(
 operation_id text primary key, tenant_id uuid not null, client_sha256 text not null,
 evidence jsonb not null, created_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.auth_maintenance_resolutions(
 operation_id text primary key references fcos_release_coordination.auth_maintenance_fences,
 evidence jsonb not null, resolved_at timestamptz not null default clock_timestamp());
create table fcos_release_coordination.auth_maintenance_saved_rotations(
 operation_id text primary key references fcos_release_coordination.auth_maintenance_fences,
 authority_id text not null references fcos_release_coordination.auth_maintenance_authorities,
 readback_sha256 text not null, custody_sha256 text not null, expected_version integer not null check(expected_version between 1 and 2147483646), refresh_lease_id uuid not null, imported_at timestamptz not null default clock_timestamp());
create function fcos_release_coordination.auth_maintenance_canonical(v jsonb) returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(v)='object' then return '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||fcos_release_coordination.auth_maintenance_canonical(value),',' order by key collate "C") from jsonb_each(v)),'')||'}';
 elsif jsonb_typeof(v)='array' then return '['||coalesce((select string_agg(fcos_release_coordination.auth_maintenance_canonical(value),',' order by ord) from jsonb_array_elements(v) with ordinality x(value,ord)),'')||']';
 else return v::text; end if;
end $$;
create function fcos_release_coordination.auth_maintenance_hash(v jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(fcos_release_coordination.auth_maintenance_canonical(v),'UTF8')),'hex') $$;
create function fcos_release_coordination.auth_maintenance_object(v jsonb,keys text[]) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='object' and v ?& keys and (select count(*) from jsonb_object_keys(v))=cardinality(keys),false) $$;
create function fcos_release_coordination.import_auth_maintenance_authority(a jsonb,legacy_fences jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare k text; phase text; f jsonb; aid text; begin
 perform 1 from control where singleton for update;
 foreach k in array array['epoch','issuedAt','notAfter','maximumOccurrenceWindowMs'] loop
  if jsonb_typeof(a->k) is distinct from 'number' or coalesce(a->>k,'') !~ '^[0-9]+$' or (a->>k)::numeric>9007199254740991 then raise exception 'COORDINATION_MAINTENANCE_AUTHORITY_INVALID'; end if;
 end loop;
 if not auth_maintenance_object(a,array['schemaVersion','authorityId','epoch','currentOwnerId','historicalOwnerThreadId','humanTransferEvidenceSha256','humanAuthorityEvidenceSha256','actorId','tenantId','clientSha256','grantLineageSha256','sourceSha256','executorSha256','controllerSha256','destinationsSha256','legacyFenceProofSha256','fenceInventorySha256','phases','caps','issuedAt','notAfter','maximumOccurrenceWindowMs','coordinationOnly','providerAuthorityGranted'])
  or a->'schemaVersion' is distinct from '1'::jsonb or a->'coordinationOnly' is distinct from 'true'::jsonb or a->'providerAuthorityGranted' is distinct from 'false'::jsonb
  or a->>'currentOwnerId' is distinct from '01a0f08b-7fcb-7870-9edc-343e16052b62' or a->>'historicalOwnerThreadId' is distinct from '01a0b0e2-b1af-7bf0-963d-3138c42648e3'
  or (a->>'epoch')::bigint<1 or (a->>'issuedAt')::bigint<1 or (a->>'notAfter')::bigint<=(a->>'issuedAt')::bigint
  or (a->>'maximumOccurrenceWindowMs')::bigint not between 1 and 900000
  or a->'phases' is distinct from '["auth_maintenance.renew_existing_grant","auth_maintenance.read_connections","auth_maintenance.read_organisations","auth_maintenance.finish_saved_rotation"]'::jsonb
  or not auth_maintenance_object(a->'caps',array['auth_maintenance.renew_existing_grant','auth_maintenance.read_connections','auth_maintenance.read_organisations','auth_maintenance.finish_saved_rotation'])
  or jsonb_typeof(legacy_fences) is distinct from 'array' or jsonb_array_length(legacy_fences)>1000
  or a->>'fenceInventorySha256' is distinct from auth_maintenance_hash(legacy_fences)
 then raise exception 'COORDINATION_MAINTENANCE_AUTHORITY_INVALID'; end if;
 foreach k in array array['authorityId','humanTransferEvidenceSha256','humanAuthorityEvidenceSha256','clientSha256','grantLineageSha256','sourceSha256','executorSha256','controllerSha256','destinationsSha256','legacyFenceProofSha256','fenceInventorySha256'] loop
  if jsonb_typeof(a->k) is distinct from 'string' or a->>k !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_MAINTENANCE_AUTHORITY_INVALID'; end if;
 end loop;
 foreach k in array array['actorId','tenantId'] loop
  if jsonb_typeof(a->k) is distinct from 'string' or coalesce(a->>k,'') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'COORDINATION_MAINTENANCE_AUTHORITY_INVALID'; end if;
 end loop;
 for phase in select jsonb_array_elements_text(a->'phases') loop
  if jsonb_typeof(a->'caps'->phase) is distinct from 'number' or a->'caps'->>phase !~ '^[0-9]+$' or (a->'caps'->>phase)::numeric>2147483647 then raise exception 'COORDINATION_MAINTENANCE_CAP_REQUIRED'; end if;
 end loop;
 aid:=a->>'authorityId';
 insert into auth_maintenance_authorities values(aid,a,auth_maintenance_hash(a),clock_timestamp());
 for f in select value from jsonb_array_elements(legacy_fences) loop
  if not auth_maintenance_object(f,array['operationId','evidenceSha256']) or coalesce(f->>'operationId','') !~ '^[A-Za-z0-9._:-]{1,200}$' or coalesce(f->>'evidenceSha256','') !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_MAINTENANCE_FENCE_INVALID'; end if;
  insert into auth_maintenance_fences(operation_id,tenant_id,client_sha256,evidence) values(f->>'operationId',(a->>'tenantId')::uuid,a->>'clientSha256',f);
 end loop;
 return jsonb_build_object('authorityId',aid,'authoritySha256',auth_maintenance_hash(a),'coordinationOnly',true,'providerAuthorityGranted',false);
end $$;
create function fcos_release_coordination.revoke_auth_maintenance_authority(aid text,proof_hash text) returns void
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
begin
 perform 1 from control where singleton for update;
 insert into auth_maintenance_revocations(authority_id,evidence_sha256) values(aid,proof_hash);
 -- Revocation neither resolves unknowns, refunds calls nor releases the lock.
end $$;
-- A distinct privileged admission is necessary for one definitely captured rotation.
create function fcos_release_coordination.admit_auth_maintenance_saved_rotation(aid text,original_id text,readback_hash text,custody_hash text,original_version integer,original_lease uuid) returns void
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare a jsonb; f auth_maintenance_fences%rowtype; begin
 perform 1 from control where singleton for update;
 select authority into a from auth_maintenance_authorities where authority_id=aid;
 select * into f from auth_maintenance_fences where operation_id=original_id;
 if a is null or f.operation_id is null or f.tenant_id::text<>a->>'tenantId' or f.client_sha256<>a->>'clientSha256'
  or exists(select 1 from auth_maintenance_resolutions where operation_id=original_id)
  or original_version is null or original_version not between 1 and 2147483646 or original_lease is null
  or readback_hash !~ '^[a-f0-9]{64}$' or custody_hash !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_MAINTENANCE_RECOVERY_INVALID'; end if;
 insert into auth_maintenance_saved_rotations values(original_id,aid,readback_hash,custody_hash,original_version,original_lease,clock_timestamp());
end $$;
create function fcos_release_coordination.resolve_auth_maintenance_fence(original_id text,proof jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; recovery auth_maintenance_occurrences%rowtype; begin
 select * into c from control where singleton for update;
 if not auth_maintenance_object(proof,array['outcome','independentReadbackSha256','nativeAcknowledgementSha256','recoveryOperationId'])
  or coalesce(proof->>'outcome','') not in ('applied','not_applied') or coalesce(proof->>'independentReadbackSha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(proof->>'nativeAcknowledgementSha256','') !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_MAINTENANCE_RESOLUTION_INVALID'; end if;
 if proof->'recoveryOperationId'<>'null'::jsonb then
  select * into recovery from auth_maintenance_occurrences where operation_id=proof->>'recoveryOperationId' and manifest->>'recoveryOf'=original_id;
  if not found or not exists(select 1 from auth_maintenance_resolutions where operation_id=recovery.operation_id) then raise exception 'COORDINATION_MAINTENANCE_RESOLUTION_INVALID'; end if;
 end if;
 insert into auth_maintenance_resolutions values(original_id,proof,clock_timestamp());
 -- Explicit reviewed resolution only; no budget refund or historical row rewrite.
 if c.operation_id=original_id then
  insert into operation_events(operation_id,state,evidence,evidence_hash,actor) values(original_id,'complete',proof,auth_maintenance_hash(proof),jsonb_build_object('kind','privileged_maintenance_readback'));
  update control set operation_id=null where singleton;
 end if;
end $$;
-- Preserve the applied implementation byte-for-byte, delegate all other scopes.
alter function fcos_release_coordination.dispatch(text,jsonb,jsonb) rename to dispatch_without_auth_maintenance;
revoke all on function fcos_release_coordination.dispatch_without_auth_maintenance(text,jsonb,jsonb) from public,fcos_coordinator_runtime;
create function fcos_release_coordination.dispatch(action text,p jsonb,principal jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; r registrations%rowtype; o operations%rowtype; ev operation_events%rowtype; a jsonb; m jsonb; g auth_maintenance_occurrences%rowtype; f auth_maintenance_fences%rowtype; result jsonb; used bigint; phase text; recovery boolean; begin
 select * into c from control where singleton for update;
 select * into r from registrations where release_id=p->>'releaseId';
 if r.scope is distinct from 'auth_maintenance' and coalesce(p->'manifest'->>'executionMode','')<>'auth_maintenance' then
  if action in ('begin','claim') and c.mode='qualification' and r.scope='financial' then raise exception 'COORDINATION_QUALIFICATION_ONLY'; end if;
  if action in ('begin','claim') and exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null) then return jsonb_build_object('disposition','busy','lock',c.operation_id,'maintenanceUnresolved',true); end if;
  return dispatch_without_auth_maintenance(action,p,principal);
 end if;
 if c.epoch is null or p->>'epoch' is distinct from c.epoch::text then raise exception 'COORDINATION_STALE_EPOCH'; end if;
 if principal->>'kind' is distinct from 'financial' or principal->>'coordinationOnly' is distinct from 'true' or principal->>'providerAuthorityGranted' is distinct from 'false'
  or principal->'qualificationOnly'='true'::jsonb or p->'owner'->>'kind' is distinct from 'financial' or p->'owner'->>'id' is distinct from principal->>'ownerId'
 then raise exception 'COORDINATION_OWNER_MISMATCH'; end if;
 if action not in ('register','snapshot','begin','claim','complete','uncertain','readback') then raise exception 'COORDINATION_PHASE_FORBIDDEN'; end if;
 m:=case when action='register' then p->'manifest' else r.manifest end;
 select authority into a from auth_maintenance_authorities where authority_id=m->>'authorityId' and authority_sha256=m->>'authoritySha256';
 if a is null or a->>'epoch'<>c.epoch::text or m->>'epoch'<>c.epoch::text or a->>'currentOwnerId' is distinct from principal->>'ownerId'
  or m->>'currentOwnerId' is distinct from a->>'currentOwnerId' or m->>'historicalOwnerThreadId' is distinct from a->>'historicalOwnerThreadId'
  or m->>'humanTransferEvidenceSha256' is distinct from a->>'humanTransferEvidenceSha256' then raise exception 'COORDINATION_MAINTENANCE_PARENT_REQUIRED'; end if;
 foreach phase in array array['actorId','tenantId','clientSha256','grantLineageSha256','sourceSha256','executorSha256','controllerSha256','destinationsSha256'] loop
  if m->>phase is distinct from a->>phase then raise exception 'COORDINATION_MAINTENANCE_BINDING_CHANGED'; end if;
 end loop;
 if (select activation_evidence->'legacyFence'->>'proofHash' from epochs where epoch=c.epoch) is distinct from a->>'legacyFenceProofSha256' then raise exception 'COORDINATION_MAINTENANCE_FENCE_REQUIRED'; end if;
 if c.mode not in ('qualification','active') then raise exception 'COORDINATION_INACTIVE'; end if;
 if action in ('register','begin','claim','complete') and exists(select 1 from auth_maintenance_revocations where authority_id=a->>'authorityId') then raise exception 'COORDINATION_MAINTENANCE_REVOKED'; end if;
 if action='register' then
  foreach phase in array array['epoch','issuedAt','notAfter','expectedVersion'] loop
   if jsonb_typeof(m->phase) is distinct from 'number' or coalesce(m->>phase,'') !~ '^[0-9]+$' or (m->>phase)::numeric>9007199254740991 then raise exception 'COORDINATION_MAINTENANCE_MANIFEST_INVALID'; end if;
  end loop;
  if not auth_maintenance_object(m,array['schemaVersion','epoch','executionMode','authorityId','authoritySha256','currentOwnerId','historicalOwnerThreadId','humanTransferEvidenceSha256','actorId','tenantId','clientSha256','grantLineageSha256','sourceSha256','executorSha256','controllerSha256','destinationsSha256','phase','operationId','occurrenceId','requestFingerprint','expectedVersion','refreshLeaseId','requestId','issuedAt','notAfter','recoveryOf','recoveryReadbackSha256','custodySha256','coordinationOnly','providerAuthorityGranted'])
   or m->'schemaVersion' is distinct from '1'::jsonb or m->'coordinationOnly' is distinct from 'true'::jsonb or m->'providerAuthorityGranted' is distinct from 'false'::jsonb
   or m->>'executionMode'<>'auth_maintenance' or p->>'manifestHash' is distinct from auth_maintenance_hash(m)
   or not(a->'phases' ? coalesce(m->>'phase','')) or m->>'occurrenceId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or m->>'refreshLeaseId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or m->>'requestId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or coalesce(m->>'operationId','') !~ '^[A-Za-z0-9._:-]{1,200}$' or coalesce(m->>'requestFingerprint','') !~ '^[a-f0-9]{64}$'
   or (m->>'expectedVersion')::bigint not between 1 and 2147483646 then raise exception 'COORDINATION_MAINTENANCE_MANIFEST_INVALID'; end if;
  if r.release_id is not null then
   if r.manifest<>m or r.manifest_hash<>p->>'manifestHash' or r.owner<>p->'owner' then raise exception 'COORDINATION_MANIFEST_CONFLICT'; end if;
   return jsonb_build_object('registered',true,'allocationReused',true,'manifestHash',r.manifest_hash);
  end if;
  if clock_timestamp()<to_timestamp((a->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((a->>'notAfter')::numeric/1000)
   or (m->>'issuedAt')::bigint<(a->>'issuedAt')::bigint or (m->>'notAfter')::bigint>(a->>'notAfter')::bigint
   or (m->>'notAfter')::bigint-(m->>'issuedAt')::bigint not between 1 and (a->>'maximumOccurrenceWindowMs')::bigint
   or clock_timestamp()<to_timestamp((m->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((m->>'notAfter')::numeric/1000) then raise exception 'COORDINATION_MAINTENANCE_EXPIRED'; end if;
  recovery:=m->>'phase'='auth_maintenance.finish_saved_rotation';
  if recovery then
   if not exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where x.operation_id=m->>'recoveryOf' and z.operation_id is null)
    or not exists(select 1 from auth_maintenance_saved_rotations s where s.operation_id=m->>'recoveryOf' and s.authority_id=a->>'authorityId' and s.readback_sha256=m->>'recoveryReadbackSha256' and s.custody_sha256=m->>'custodySha256' and s.expected_version=(m->>'expectedVersion')::integer and s.refresh_lease_id=(m->>'refreshLeaseId')::uuid)
    or exists(select 1 from auth_maintenance_occurrences x where x.manifest->>'recoveryOf'=m->>'recoveryOf') then raise exception 'COORDINATION_MAINTENANCE_RECOVERY_REQUIRED'; end if;
  elsif m->'recoveryOf'<>'null'::jsonb or m->'recoveryReadbackSha256'<>'null'::jsonb or m->'custodySha256'<>'null'::jsonb then raise exception 'COORDINATION_MAINTENANCE_RECOVERY_REQUIRED'; end if;
  if exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id)
    where z.operation_id is null and x.tenant_id::text=a->>'tenantId' and x.client_sha256=a->>'clientSha256' and (not recovery or x.operation_id<>m->>'recoveryOf')) then raise exception 'COORDINATION_MAINTENANCE_UNRESOLVED'; end if;
  select count(*) into used from auth_maintenance_occurrences x where x.authority_id=a->>'authorityId' and x.phase=m->>'phase';
  if used>=(a->'caps'->>(m->>'phase'))::bigint then raise exception 'COORDINATION_MAINTENANCE_CAP_EXHAUSTED'; end if;
  insert into registrations(release_id,epoch,owner,manifest,manifest_hash,scope,registration_actor) values(p->>'releaseId',c.epoch,p->'owner',m,p->>'manifestHash','auth_maintenance',principal);
  insert into auth_maintenance_occurrences(occurrence_id,authority_id,operation_id,release_id,phase,manifest) values((m->>'occurrenceId')::uuid,a->>'authorityId',m->>'operationId',p->>'releaseId',m->>'phase',m);
  return jsonb_build_object('registered',true,'allocated',true,'occurrenceId',m->>'occurrenceId','authorityId',a->>'authorityId','providerAuthorityGranted',false);
 end if;
 if r.release_id is null or r.owner<>p->'owner' or r.manifest_hash is distinct from p->>'manifestHash' then raise exception 'COORDINATION_SCOPE_MISMATCH'; end if;
 select * into g from auth_maintenance_occurrences where release_id=r.release_id;
 if action='snapshot' then
  return jsonb_build_object('epoch',c.epoch,'mode',c.mode,'registration',to_jsonb(r),'occurrence',to_jsonb(g),'lock',c.operation_id,
   'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.event_id) from operation_events e where operation_id=g.operation_id),'[]'::jsonb),'providerAuthorityGranted',false);
 end if;
 if p->>'operationId' is distinct from g.operation_id or p->>'phase' is distinct from g.phase then raise exception 'COORDINATION_PHASE_FORBIDDEN'; end if;
 select * into o from operations where operation_id=g.operation_id;
 select * into ev from operation_events where operation_id=g.operation_id order by event_id desc limit 1;
 if action in ('begin','claim') then
  if p->>'requestHash' is distinct from m->>'requestFingerprint' then raise exception 'COORDINATION_MAINTENANCE_BINDING_CHANGED'; end if;
  if o.operation_id is not null then return jsonb_build_object('disposition',case when ev.state='complete' then 'complete' else 'readback' end,'operation',to_jsonb(o),'evidence',ev.evidence); end if;
  if clock_timestamp()<to_timestamp((m->>'issuedAt')::numeric/1000) or clock_timestamp()<to_timestamp((a->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((m->>'notAfter')::numeric/1000) or clock_timestamp()>=to_timestamp((a->>'notAfter')::numeric/1000) then raise exception 'COORDINATION_MAINTENANCE_EXPIRED'; end if;
  recovery:=m->>'phase'='auth_maintenance.finish_saved_rotation';
  if recovery and not exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where x.operation_id=m->>'recoveryOf' and z.operation_id is null) then raise exception 'COORDINATION_MAINTENANCE_RECOVERY_REQUIRED'; end if;
  if c.operation_id is not null and (not recovery or c.operation_id is distinct from m->>'recoveryOf') then return jsonb_build_object('disposition','busy','lock',c.operation_id); end if;
  if exists(select 1 from imported_uncertainty u left join import_resolutions z using(import_id) where z.import_id is null) then return jsonb_build_object('disposition','busy','lock',c.operation_id); end if;
  if exists(select 1 from auth_maintenance_fences x left join auth_maintenance_resolutions z using(operation_id) where z.operation_id is null and x.tenant_id::text=a->>'tenantId' and x.client_sha256=a->>'clientSha256' and (not recovery or x.operation_id<>m->>'recoveryOf')) then return jsonb_build_object('disposition','busy','maintenanceUnresolved',true); end if;
  insert into operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor) values(g.operation_id,r.release_id,c.epoch,g.phase,m->>'requestFingerprint',r.manifest_hash,principal) returning * into o;
  insert into operation_events(operation_id,state,evidence,evidence_hash,actor) values(g.operation_id,'intent','{}',m->>'requestFingerprint',principal);
  insert into auth_maintenance_fences(operation_id,tenant_id,client_sha256,evidence) values(g.operation_id,(a->>'tenantId')::uuid,a->>'clientSha256',jsonb_build_object('authorityId',a->>'authorityId','occurrenceId',g.occurrence_id));
  update control set operation_id=g.operation_id where singleton;
  return jsonb_build_object('disposition','execute','operation',to_jsonb(o),'providerAuthorityGranted',false);
 end if;
 if o.operation_id is null or coalesce(p->>'evidenceHash','') !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_EVIDENCE_REQUIRED'; end if;
 if action='uncertain' or action='readback' and p->'evidence'->>'outcome'='unknown' then
  if c.operation_id is distinct from o.operation_id then raise exception 'COORDINATION_LOCK_MISMATCH'; end if;
  if not auth_maintenance_object(p->'evidence',array['outcome']) or p->'evidence'->>'outcome' is distinct from 'unknown' then raise exception 'COORDINATION_EVIDENCE_REQUIRED'; end if;
  insert into operation_events(operation_id,state,evidence,evidence_hash,actor) values(o.operation_id,'uncertain',jsonb_build_object('outcome','unknown'),p->>'evidenceHash',principal);
  return jsonb_build_object('disposition','readback','providerAuthorityGranted',false);
 end if;
 if ev.state='complete' then
  if ev.evidence is distinct from p->'evidence' then raise exception 'COORDINATION_TERMINAL_CONFLICT'; end if;
  return jsonb_build_object('disposition','complete','evidence',ev.evidence);
 end if;
 if clock_timestamp()>=to_timestamp((m->>'notAfter')::numeric/1000) or clock_timestamp()>=to_timestamp((a->>'notAfter')::numeric/1000) then raise exception 'COORDINATION_MAINTENANCE_EXPIRED'; end if;
 if action<>'complete' or ev.state<>'intent' or c.operation_id is distinct from o.operation_id
  or not auth_maintenance_object(p->'evidence',array['outcome','nativeAcknowledgementSha256','independentReadbackSha256'])
  or p->'evidence'->>'outcome' not in ('applied','not_applied') or coalesce(p->'evidence'->>'nativeAcknowledgementSha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p->'evidence'->>'independentReadbackSha256','') !~ '^[a-f0-9]{64}$' then raise exception 'COORDINATION_MAINTENANCE_DEFINITIVE_READBACK_REQUIRED'; end if;
 insert into operation_events(operation_id,state,evidence,evidence_hash,actor) values(o.operation_id,'complete',p->'evidence',p->>'evidenceHash',principal);
 insert into auth_maintenance_resolutions values(o.operation_id,p->'evidence',clock_timestamp());
 update control set operation_id=null where singleton;
 return jsonb_build_object('disposition','complete','providerAuthorityGranted',false);
end $$;
do $$ declare t text; f record; begin
 foreach t in array array['auth_maintenance_authorities','auth_maintenance_revocations','auth_maintenance_occurrences','auth_maintenance_fences','auth_maintenance_resolutions','auth_maintenance_saved_rotations'] loop
  execute format('alter table fcos_release_coordination.%I enable row level security',t);
  execute format('create trigger append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fcos_release_coordination' and (p.proname like '%auth_maintenance%' or p.proname='dispatch') loop
  execute format('alter function %s owner to fcos_coordinator_owner',f.signature);execute format('revoke all on function %s from public,fcos_coordinator_runtime',f.signature);
 end loop;
end $$;
revoke all on all tables in schema fcos_release_coordination from public,fcos_coordinator_runtime;
grant execute on function fcos_release_coordination.dispatch(text,jsonb,jsonb) to fcos_coordinator_runtime;
grant execute on function fcos_release_coordination.import_auth_maintenance_authority(jsonb,jsonb),fcos_release_coordination.revoke_auth_maintenance_authority(text,text),fcos_release_coordination.admit_auth_maintenance_saved_rotation(text,text,text,text,integer,uuid),fcos_release_coordination.resolve_auth_maintenance_fence(text,jsonb) to postgres;
commit;
