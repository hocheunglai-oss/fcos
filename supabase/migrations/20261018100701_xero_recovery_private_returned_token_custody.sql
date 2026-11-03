begin;

-- Private credential custody only. This migration neither performs OAuth nor
-- authorizes an executor. Prepare must commit BEFORE the single OAuth POST.
-- The narrowly approved tokenRenewAndCapture action then performs that POST
-- once and immediately captures its response before any later guard/outcome.
-- OAuth and PostgreSQL are NOT atomic: a prepared row with no capture remains
-- an unknown, non-replayable outcome, even when the POST may not have started.
-- No retry, cleanup, scheduled finalization or automatic expiry is installed.
create table public.xero_recovery_token_custody (
 operation_id text primary key check(operation_id ~ '^[a-f0-9]{64}$'),
 owner_thread_id uuid not null,
 tenant_id text not null check(tenant_id ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'),
 expected_version integer not null check(expected_version > 0 and expected_version < 2147483647),
 refresh_lease_id uuid not null unique,
 approval_sha256 text not null unique check(approval_sha256 ~ '^[a-f0-9]{64}$'),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 binding_sha256 text not null check(binding_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'prepared' check(state in ('prepared','captured','finished')),
 prepared_at timestamptz not null default clock_timestamp(),
 captured_at timestamptz,
 finished_at timestamptz,
 finished_version integer,
 returned_access_token text,
 returned_refresh_token text,
 returned_expires_at timestamptz,
 returned_scope text,
 check (
  (state='prepared' and captured_at is null and finished_at is null and finished_version is null
   and returned_access_token is null and returned_refresh_token is null and returned_expires_at is null and returned_scope is null)
  or (state='captured' and captured_at is not null and finished_at is null and finished_version is null
   and returned_access_token is not null and length(returned_access_token) between 1 and 16384 and returned_access_token !~ '[[:cntrl:][:space:]]'
   and returned_refresh_token is not null and length(returned_refresh_token) between 1 and 16384 and returned_refresh_token !~ '[[:cntrl:][:space:]]'
   and returned_expires_at is not null and returned_scope is not null and length(returned_scope)<=16384)
  or (state='finished' and captured_at is not null and finished_at is not null and finished_version is not null and finished_version=expected_version+1
   and returned_access_token is null and returned_refresh_token is null and returned_expires_at is null and returned_scope is null)
 )
);
alter table public.xero_recovery_token_custody enable row level security;
alter table public.xero_recovery_token_custody force row level security;
revoke all on public.xero_recovery_token_custody from public,anon,authenticated,service_role;
-- Invoker RPCs require these grants. This is the existing trusted service-role
-- credential boundary, not isolation against possession of that credential.
-- There is deliberately no DELETE/TRUNCATE privilege or browser-role policy.
grant select,insert,update on public.xero_recovery_token_custody to service_role;

-- Preserve bindings and captured credentials even through direct service DML.
-- Captured secrets may only be cleared after the same exact returned connection
-- is already in primary custody with the original refresh lease completed.
create function public.xero_recovery_custody_transition() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.state<>'prepared' then raise exception 'XERO_CUSTODY_TRANSITION_INVALID' using errcode='55000'; end if;
  new.prepared_at:=clock_timestamp();
  return new;
 end if;
 if row(new.operation_id,new.owner_thread_id,new.tenant_id,new.expected_version,new.refresh_lease_id,new.approval_sha256,new.source_sha256,new.binding_sha256,new.prepared_at)
  is distinct from row(old.operation_id,old.owner_thread_id,old.tenant_id,old.expected_version,old.refresh_lease_id,old.approval_sha256,old.source_sha256,old.binding_sha256,old.prepared_at)
 then raise exception 'XERO_CUSTODY_BINDING_CHANGED' using errcode='55000'; end if;
 if old.state='prepared' and new.state='captured' then
  new.captured_at:=clock_timestamp();
 elsif old.state='captured' and new.state='finished' then
  if new.captured_at is distinct from old.captured_at
   or not exists(select 1 from public.xero_contact_sync_connections c
    join public.xero_token_refresh_leases l on l.connection_id=c.id
    where c.id='primary' and c.tenant_id=old.tenant_id and c.token_version=old.expected_version+1
     and c.access_token=old.returned_access_token and c.refresh_token=old.returned_refresh_token
     and c.expires_at=old.returned_expires_at and c.scope=old.returned_scope
     and l.lease_id=old.refresh_lease_id and l.expected_version=old.expected_version and l.tenant_id=old.tenant_id and l.state='complete')
   then raise exception 'XERO_CUSTODY_FINISH_NOT_CONFIRMED' using errcode='55000'; end if;
  new.finished_at:=clock_timestamp();
 else
  raise exception 'XERO_CUSTODY_TRANSITION_INVALID' using errcode='55000';
 end if;
 return new;
end $$;
create trigger xero_recovery_custody_transition before insert or update on public.xero_recovery_token_custody
for each row execute function public.xero_recovery_custody_transition();

create function public.xero_recovery_custody_prepare(
 p_operation_id text,p_owner_thread_id uuid,p_tenant_id text,p_expected_version integer,p_refresh_lease_id uuid,
 p_approval_sha256 text,p_source_sha256 text,p_binding_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ver integer; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.connection.primary',0));
 ver:=public.xero_shared_assert_tenant(p_tenant_id);
 if ver is distinct from p_expected_version
 then raise exception 'XERO_CUSTODY_PREPARE_REFUSED' using errcode='40001'; end if;
 -- Prepare precedes refreshClaim (and exists even on the no-renew branch).
 -- The planned refresh lease is bound now, not claimed or asserted by this RPC.
 -- No ON CONFLICT: an existing operation OR approval is never replay authority.
 insert into public.xero_recovery_token_custody(operation_id,owner_thread_id,tenant_id,expected_version,refresh_lease_id,approval_sha256,source_sha256,binding_sha256)
 values(p_operation_id,p_owner_thread_id,p_tenant_id,p_expected_version,p_refresh_lease_id,p_approval_sha256,p_source_sha256,p_binding_sha256);
 return jsonb_build_object('operationId',p_operation_id,'state','prepared','scopeConsumed',true,'tokenPostReplayAllowed',false,'executionAuthorityGranted',false);
end $$;

create function public.xero_recovery_custody_capture(
 p_operation_id text,p_owner_thread_id uuid,p_tenant_id text,p_expected_version integer,p_refresh_lease_id uuid,
 p_approval_sha256 text,p_source_sha256 text,p_binding_sha256 text,p_connection jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.xero_recovery_token_custody%rowtype; expires timestamptz; begin
 select * into r from public.xero_recovery_token_custody where operation_id=p_operation_id for update;
 if not found or row(r.owner_thread_id,r.tenant_id,r.expected_version,r.refresh_lease_id,r.approval_sha256,r.source_sha256,r.binding_sha256)
  is distinct from row(p_owner_thread_id,p_tenant_id,p_expected_version,p_refresh_lease_id,p_approval_sha256,p_source_sha256,p_binding_sha256)
  or r.state<>'prepared' then raise exception 'XERO_CUSTODY_CAPTURE_REFUSED' using errcode='40001'; end if;
 if jsonb_typeof(p_connection) is distinct from 'object'
  or not (p_connection ?& array['tenantId','accessToken','refreshToken','expiresAt','scope'])
  or (select count(*) from jsonb_object_keys(p_connection))<>5
  or exists(select 1 from jsonb_each(p_connection) e where jsonb_typeof(e.value) is distinct from 'string')
  or p_connection->>'tenantId' is distinct from p_tenant_id
  or length(p_connection->>'accessToken') not between 1 and 16384 or (p_connection->>'accessToken') ~ '[[:cntrl:][:space:]]'
  or length(p_connection->>'refreshToken') not between 1 and 16384 or (p_connection->>'refreshToken') ~ '[[:cntrl:][:space:]]'
  or length(p_connection->>'scope')>16384
 then raise exception 'XERO_CUSTODY_RESPONSE_INVALID' using errcode='22023'; end if;
 begin
  expires:=(p_connection->>'expiresAt')::timestamptz;
  if not isfinite(expires) then raise exception 'invalid expiry'; end if;
 exception when others then raise exception 'XERO_CUSTODY_RESPONSE_INVALID' using errcode='22023'; end;
 -- Capture deliberately does not re-check current primary/lease or require an
 -- unexpired returned access token. Preserve an already returned rotation even
 -- after a concurrent identity change or delay; finish eligibility is separate.
 update public.xero_recovery_token_custody set state='captured',returned_access_token=p_connection->>'accessToken',
  returned_refresh_token=p_connection->>'refreshToken',returned_expires_at=expires,returned_scope=p_connection->>'scope'
 where operation_id=p_operation_id;
 return jsonb_build_object('operationId',p_operation_id,'state','captured','scopeConsumed',true,'tokenPostReplayAllowed',false,'finishEligibilityAccepted',false,'executionAuthorityGranted',false);
exception when others then
 -- Do not let a constraint/type exception echo its credential-bearing row.
 raise exception 'XERO_CUSTODY_CAPTURE_REFUSED' using errcode='40001';
end $$;

create function public.xero_recovery_custody_readback(
 p_operation_id text,p_owner_thread_id uuid,p_tenant_id text,p_expected_version integer,p_refresh_lease_id uuid,
 p_approval_sha256 text,p_source_sha256 text,p_binding_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.xero_recovery_token_custody%rowtype; begin
 select * into r from public.xero_recovery_token_custody where operation_id=p_operation_id;
 if not found or row(r.owner_thread_id,r.tenant_id,r.expected_version,r.refresh_lease_id,r.approval_sha256,r.source_sha256,r.binding_sha256)
  is distinct from row(p_owner_thread_id,p_tenant_id,p_expected_version,p_refresh_lease_id,p_approval_sha256,p_source_sha256,p_binding_sha256)
 then raise exception 'XERO_CUSTODY_READBACK_REFUSED' using errcode='40001'; end if;
 return jsonb_build_object('operationId',r.operation_id,'state',r.state,'preparedAt',r.prepared_at,'capturedAt',r.captured_at,
  'finishedAt',r.finished_at,'finishedVersion',r.finished_version,'privateCapturePresent',r.state='captured',
  'tokenPostOutcome',case when r.state='prepared' then 'not_recorded_do_not_replay' else 'response_captured' end,
  'scopeConsumed',true,'tokenPostReplayAllowed',false,'finishEligibilityAccepted',false,'executionAuthorityGranted',false);
end $$;

create function public.xero_recovery_custody_finish(
 p_operation_id text,p_owner_thread_id uuid,p_tenant_id text,p_expected_version integer,p_refresh_lease_id uuid,
 p_approval_sha256 text,p_source_sha256 text,p_binding_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.xero_recovery_token_custody%rowtype; result jsonb; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.connection.primary',0));
 select * into r from public.xero_recovery_token_custody where operation_id=p_operation_id for update;
 if not found or row(r.owner_thread_id,r.tenant_id,r.expected_version,r.refresh_lease_id,r.approval_sha256,r.source_sha256,r.binding_sha256)
  is distinct from row(p_owner_thread_id,p_tenant_id,p_expected_version,p_refresh_lease_id,p_approval_sha256,p_source_sha256,p_binding_sha256)
  or r.state<>'captured' then raise exception 'XERO_CUSTODY_FINISH_REFUSED' using errcode='40001'; end if;
 -- Same transaction: the existing primary CAS/refresh-lease rules remain the
 -- authority for credential publication. Any failure rolls back both writes.
 result:=public.xero_refresh_finish(p_tenant_id,p_expected_version,p_refresh_lease_id,
  jsonb_build_object('tenantId',r.tenant_id,'accessToken',r.returned_access_token,'refreshToken',r.returned_refresh_token,
   'expiresAt',r.returned_expires_at,'scope',r.returned_scope));
 if result is distinct from jsonb_build_object('tokenVersion',p_expected_version+1)
 then raise exception 'XERO_CUSTODY_FINISH_NOT_CONFIRMED' using errcode='55000'; end if;
 update public.xero_recovery_token_custody set state='finished',finished_version=p_expected_version+1,
  returned_access_token=null,returned_refresh_token=null,returned_expires_at=null,returned_scope=null where operation_id=p_operation_id;
 return jsonb_build_object('operationId',p_operation_id,'state','finished','tokenVersion',p_expected_version+1,
  'duplicateSecretsCleared',true,'scopeConsumed',true,'tokenPostReplayAllowed',false,'executionAuthorityGranted',false);
exception when others then
 raise exception 'XERO_CUSTODY_FINISH_REFUSED' using errcode='40001';
end $$;

revoke all on function public.xero_recovery_custody_transition() from public,anon,authenticated,service_role;
grant execute on function public.xero_recovery_custody_transition() to service_role;
revoke all on function public.xero_recovery_custody_prepare(text,uuid,text,integer,uuid,text,text,text),
 public.xero_recovery_custody_capture(text,uuid,text,integer,uuid,text,text,text,jsonb),
 public.xero_recovery_custody_readback(text,uuid,text,integer,uuid,text,text,text),
 public.xero_recovery_custody_finish(text,uuid,text,integer,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.xero_recovery_custody_prepare(text,uuid,text,integer,uuid,text,text,text),
 public.xero_recovery_custody_capture(text,uuid,text,integer,uuid,text,text,text,jsonb),
 public.xero_recovery_custody_readback(text,uuid,text,integer,uuid,text,text,text),
 public.xero_recovery_custody_finish(text,uuid,text,integer,uuid,text,text,text) to service_role;

commit;
