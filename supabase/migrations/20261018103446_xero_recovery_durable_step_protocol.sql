begin;

-- Evidence store for ONE independently admitted original-owner recovery plan.
-- This is not a lease/coordinator, actor authenticator, executor, retry queue or
-- authority grant. The real lease and each fresh admission remain on the Mac.
-- Claim commits submitted_unknown BEFORE the external action. OAuth/provider
-- actions and these transactions are not atomic. Missing acknowledgement never
-- authorizes replay, timeout takeover, cleanup, expiry resolution or a new POST.
create table public.xero_recovery_step_operations (
 operation_id text primary key check(operation_id ~ '^[a-f0-9]{64}$'),
 approval_sha256 text not null unique check(approval_sha256 ~ '^[a-f0-9]{64}$'),
 plan_json text not null,
 plan_sha256 text not null check(plan_sha256=encode(sha256(convert_to(plan_json,'UTF8')),'hex')),
 created_at timestamptz not null default clock_timestamp()
);
create table public.xero_recovery_step_attempts (
 submission_id uuid primary key,
 operation_id text not null references public.xero_recovery_step_operations(operation_id),
 ordinal integer not null check(ordinal between 0 and 10),
 step text not null check(step in ('preflight','custodyPrepare','refreshClaim','tokenRenewAndCapture','refreshFinish','sessionVerify','probeGrant','probeAdmission','organisationsGet','probeObservation','finalRead')),
 request_json text not null,
 request_sha256 text not null unique check(request_sha256=encode(sha256(convert_to(request_json,'UTF8')),'hex')),
 previous_result_sha256 text check(previous_result_sha256 ~ '^[a-f0-9]{64}$'),
 claimed_at timestamptz not null default clock_timestamp(),
 unique(operation_id,ordinal), unique(operation_id,step)
);
create table public.xero_recovery_step_acknowledgements (
 submission_id uuid primary key references public.xero_recovery_step_attempts(submission_id),
 result_json text not null,
 result_sha256 text not null check(result_sha256=encode(sha256(convert_to(result_json,'UTF8')),'hex')),
 completed_at timestamptz not null default clock_timestamp()
);
alter table public.xero_recovery_step_operations enable row level security;
alter table public.xero_recovery_step_operations force row level security;
alter table public.xero_recovery_step_attempts enable row level security;
alter table public.xero_recovery_step_attempts force row level security;
alter table public.xero_recovery_step_acknowledgements enable row level security;
alter table public.xero_recovery_step_acknowledgements force row level security;
revoke all on public.xero_recovery_step_operations,public.xero_recovery_step_attempts,public.xero_recovery_step_acknowledgements from public,anon,authenticated,service_role;
-- Invoker RPCs share the existing trusted service credential boundary. A holder
-- of that credential is not isolated from service DML; no public role has access.
grant select,insert on public.xero_recovery_step_operations,public.xero_recovery_step_attempts,public.xero_recovery_step_acknowledgements to service_role;

create function public.xero_recovery_step_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'XERO_STEP_IMMUTABLE' using errcode='55000'; end $$;
create trigger xero_recovery_step_immutable before update or delete on public.xero_recovery_step_operations for each row execute function public.xero_recovery_step_immutable();
create trigger xero_recovery_step_immutable before update or delete on public.xero_recovery_step_attempts for each row execute function public.xero_recovery_step_immutable();
create trigger xero_recovery_step_immutable before update or delete on public.xero_recovery_step_acknowledgements for each row execute function public.xero_recovery_step_immutable();

create function public.xero_recovery_step_object(v jsonb,keys text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(v)='object' and v ?& keys and (select count(*) from jsonb_object_keys(v))=cardinality(keys),false)
$$;
create function public.xero_recovery_step_uint(v jsonb,maximum numeric default 9007199254740991) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(v)='number' and (v::text)::numeric between 0 and maximum and (v::text)::numeric=trunc((v::text)::numeric),false)
$$;
create function public.xero_recovery_step_json_clean(v json) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare e record; begin
 if json_typeof(v)='object' then
  if (select count(*)<>count(distinct key) from json_each(v)) then return false; end if;
  for e in select value from json_each(v) loop if not public.xero_recovery_step_json_clean(e.value) then return false; end if; end loop;
 elsif json_typeof(v)='array' then
  for e in select value from json_array_elements(v) loop if not public.xero_recovery_step_json_clean(e.value) then return false; end if; end loop;
 end if;
 return true;
end $$;
create function public.xero_recovery_step_canonical(v jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(v)='object' then
  return '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||public.xero_recovery_step_canonical(value),',' order by key collate "C") from jsonb_each(v)),'')||'}';
 elsif jsonb_typeof(v)='number' then return ((v::text)::numeric)::bigint::text;
 end if;
 return v::text;
end $$;
create function public.xero_recovery_step_iso(v jsonb,nullable boolean default false) returns timestamptz
language plpgsql immutable security invoker set search_path='' as $$
declare at timestamptz; begin
 if v='null'::jsonb and nullable then return null; end if;
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
 then raise exception 'XERO_STEP_DATE_INVALID'; end if;
 at:=(v#>>'{}')::timestamptz;
 if not isfinite(at) then raise exception 'XERO_STEP_DATE_INVALID'; end if;
 return at;
end $$;

create function public.xero_recovery_step_input(p_plan_json text,p_plan_sha256 text,p_request_json text,p_request_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p jsonb; b jsonb; q jsonb; key text; begin
 if p_plan_json is null or octet_length(p_plan_json)>16384 or p_request_json is null or octet_length(p_request_json)>4096
  or p_plan_sha256 is distinct from encode(sha256(convert_to(p_plan_json,'UTF8')),'hex')
  or p_request_sha256 is distinct from encode(sha256(convert_to(p_request_json,'UTF8')),'hex')
  or not public.xero_recovery_step_json_clean(p_plan_json::json) or not public.xero_recovery_step_json_clean(p_request_json::json)
 then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 p:=p_plan_json::jsonb; b:=p->'binding'; q:=p_request_json::jsonb;
 if not public.xero_recovery_step_object(p,array['schemaVersion','kind','binding']) or p->'schemaVersion'<>'1'::jsonb
  or p->>'kind' is distinct from 'fcos_xero_recovery_step_plan_v1'
  or not public.xero_recovery_step_object(b,array['operationId','ownerThreadId','tenantId','actorId','expectedVersion','refreshLeaseId','probeId','requestId','approvalSha256','sourceSha256','bindingSha256','organisationIdentitySha256','issuedAt','notAfter','credentialPreservationCompositeApproved'])
 then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 foreach key in array array['operationId','approvalSha256','sourceSha256','bindingSha256'] loop
  if jsonb_typeof(b->key) is distinct from 'string' or b->>key !~ '^[a-f0-9]{64}$' then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 end loop;
 foreach key in array array['ownerThreadId','tenantId','actorId','refreshLeaseId','probeId','requestId'] loop
  if jsonb_typeof(b->key) is distinct from 'string' or b->>key !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 end loop;
 if not public.xero_recovery_step_uint(b->'expectedVersion',2147483646) or (b->>'expectedVersion')::integer<1
  or not public.xero_recovery_step_uint(b->'issuedAt') or not public.xero_recovery_step_uint(b->'notAfter')
  or (b->>'notAfter')::bigint-(b->>'issuedAt')::bigint not between 1 and 900000
  or b->'credentialPreservationCompositeApproved'<>'true'::jsonb
  or not (b->'organisationIdentitySha256'='null'::jsonb or (jsonb_typeof(b->'organisationIdentitySha256')='string' and b->>'organisationIdentitySha256' ~ '^[a-f0-9]{64}$'))
  or p_plan_json is distinct from public.xero_recovery_step_canonical(p)
  or not public.xero_recovery_step_object(q,array['schemaVersion','operationId','planSha256','step','submissionId','previousResultSha256'])
  or q->'schemaVersion'<>'1'::jsonb or q->>'operationId' is distinct from b->>'operationId' or q->>'planSha256' is distinct from p_plan_sha256
  or jsonb_typeof(q->'step') is distinct from 'string'
  or q->>'step' not in ('preflight','custodyPrepare','refreshClaim','tokenRenewAndCapture','refreshFinish','sessionVerify','probeGrant','probeAdmission','organisationsGet','probeObservation','finalRead')
  or jsonb_typeof(q->'submissionId') is distinct from 'string' or q->>'submissionId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or not (q->'previousResultSha256'='null'::jsonb or (jsonb_typeof(q->'previousResultSha256')='string' and q->>'previousResultSha256' ~ '^[a-f0-9]{64}$'))
  or p_request_json is distinct from public.xero_recovery_step_canonical(q)
 then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 return jsonb_build_object('binding',b,'request',q);
end $$;

-- Derived state uses only append-only attempts and acknowledged domain results.
-- An attempt without an acknowledgement is permanently submitted_unknown.
create function public.xero_recovery_step_state(p_operation_id text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare o public.xero_recovery_step_operations%rowtype; a public.xero_recovery_step_attempts%rowtype;
 checkpoint jsonb; last_sha text; acknowledged integer; pending boolean; steps text[]; state text; next_step text; begin
 select * into o from public.xero_recovery_step_operations where operation_id=p_operation_id;
 if not found then raise exception 'XERO_STEP_READBACK_REFUSED'; end if;
 select coalesce(jsonb_object_agg(t.step,k.result_json::jsonb),'{}'::jsonb),count(*) into checkpoint,acknowledged
  from public.xero_recovery_step_attempts t join public.xero_recovery_step_acknowledgements k using(submission_id) where t.operation_id=p_operation_id;
 select k.result_sha256 into last_sha from public.xero_recovery_step_attempts t join public.xero_recovery_step_acknowledgements k using(submission_id)
  where t.operation_id=p_operation_id order by t.ordinal desc limit 1;
 select * into a from public.xero_recovery_step_attempts where operation_id=p_operation_id order by ordinal desc limit 1;
 pending:=a.submission_id is not null and not exists(select 1 from public.xero_recovery_step_acknowledgements where submission_id=a.submission_id);
 if checkpoint#>>'{preflight,renewalRequired}'='true' then
  steps:=array['preflight','custodyPrepare','refreshClaim','tokenRenewAndCapture','refreshFinish','sessionVerify','probeGrant','probeAdmission','organisationsGet','probeObservation','finalRead'];
 else steps:=array['preflight','custodyPrepare','sessionVerify','probeGrant','probeAdmission','organisationsGet','probeObservation','finalRead']; end if;
 state:=case when pending then 'submitted_unknown' when acknowledged=cardinality(steps) then 'complete' else 'ready' end;
 next_step:=case when state='ready' then steps[acknowledged+1] else null end;
 return jsonb_build_object('operationId',o.operation_id,'planSha256',o.plan_sha256,'state',state,'nextStep',next_step,
  'currentStep',a.step,'submissionId',a.submission_id,'lastResultSha256',last_sha,'checkpoint',checkpoint,'executionAuthorityGranted',false);
end $$;

create function public.xero_recovery_step_result(p_step text,p_result_json text,b jsonb,p_claimed_at timestamptz,p_checkpoint jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb; s jsonb; key text; at timestamptz; expiry timestamptz; ver integer; begin
 if p_result_json is null or octet_length(p_result_json)>16384 or not public.xero_recovery_step_json_clean(p_result_json::json)
 then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 r:=p_result_json::jsonb; ver:=(b->>'expectedVersion')::integer;
 case p_step
 when 'preflight' then
  if not public.xero_recovery_step_object(r,array['renewalRequired','tokenVersion','expiresAt','observedAt'])
   or jsonb_typeof(r->'renewalRequired') is distinct from 'boolean' or r->'tokenVersion'<>to_jsonb(ver)
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  expiry:=public.xero_recovery_step_iso(r->'expiresAt'); at:=public.xero_recovery_step_iso(r->'observedAt');
  if at<p_claimed_at-interval '30 seconds' or at<clock_timestamp()-interval '30 seconds' or at>clock_timestamp()+interval '30 seconds'
   or (r->>'renewalRequired')::boolean is distinct from (expiry<=at+interval '60 seconds')
   or not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=b->>'tenantId' and token_version=ver and expires_at=expiry)
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'custodyPrepare','refreshClaim','tokenRenewAndCapture' then
  if not public.xero_recovery_step_object(r,array['state']) or r->>'state' is distinct from
   (case p_step when 'custodyPrepare' then 'prepared' when 'refreshClaim' then 'claimed' else 'captured' end)
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'refreshFinish' then
  if not public.xero_recovery_step_object(r,array['state','tokenVersion']) or r->>'state' is distinct from 'finished' or r->'tokenVersion'<>to_jsonb(ver+1)
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'sessionVerify' then
  if p_checkpoint#>>'{preflight,renewalRequired}'='true' then ver:=ver+1; end if;
  if not public.xero_recovery_step_object(r,array['tokenVersion','expiresAt']) or r->'tokenVersion'<>to_jsonb(ver)
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  expiry:=public.xero_recovery_step_iso(r->'expiresAt');
  if expiry<=clock_timestamp() or not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=b->>'tenantId' and token_version=ver and expires_at=expiry)
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'probeGrant' then
  if not public.xero_recovery_step_object(r,array['notBefore','expiresAt']) then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  at:=public.xero_recovery_step_iso(r->'notBefore'); expiry:=public.xero_recovery_step_iso(r->'expiresAt');
  if expiry<=at or expiry<=clock_timestamp() then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'probeAdmission' then
  if not public.xero_recovery_step_object(r,array['deadlineAt']) or public.xero_recovery_step_iso(r->'deadlineAt')<=clock_timestamp()
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'organisationsGet' then
  if not public.xero_recovery_step_object(r,array['status','snapshot','organisationIdentitySha256','storedTenantNameMatches'])
   or not public.xero_recovery_step_uint(r->'status',299) or (r->>'status')::integer<200
   or jsonb_typeof(r->'organisationIdentitySha256') is distinct from 'string' or r->>'organisationIdentitySha256' !~ '^[a-f0-9]{64}$'
   or (b->'organisationIdentitySha256'<>'null'::jsonb and r->'organisationIdentitySha256'<>b->'organisationIdentitySha256')
   or jsonb_typeof(r->'storedTenantNameMatches') not in ('boolean','null')
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  s:=r->'snapshot';
  if jsonb_typeof(s) is distinct from 'object' or not(s ?& array['rateLimitProblem','retryAfterSeconds','retryAt','dayResetAt','observedAt'])
   or exists(select 1 from jsonb_object_keys(s) k where k not in ('minuteRemaining','dayRemaining','appMinuteRemaining','appDayRemaining','rateLimitProblem','retryAfterSeconds','retryAt','dayResetAt','observedAt'))
   or not(s->'rateLimitProblem'='null'::jsonb or s->>'rateLimitProblem' in ('day','daily','minute','app-day','app-minute','unknown'))
   or not(s->'retryAfterSeconds'='null'::jsonb or public.xero_recovery_step_uint(s->'retryAfterSeconds'))
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  foreach key in array array['minuteRemaining','dayRemaining','appMinuteRemaining','appDayRemaining'] loop
   if s ? key and not public.xero_recovery_step_uint(s->key) then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  end loop;
  perform public.xero_recovery_step_iso(s->'retryAt',true); perform public.xero_recovery_step_iso(s->'dayResetAt',true); perform public.xero_recovery_step_iso(s->'observedAt');
 when 'probeObservation' then
  if not public.xero_recovery_step_object(r,array['recorded']) or r->'recorded'<>'true'::jsonb then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
 when 'finalRead' then
  if not public.xero_recovery_step_object(r,array['allowanceKnown','availableCalls','spendableCalls','reserve','retryAt','observedAt'])
   or jsonb_typeof(r->'allowanceKnown') is distinct from 'boolean' or r->'reserve'<>'200'::jsonb
   or not(r->'availableCalls'='null'::jsonb or public.xero_recovery_step_uint(r->'availableCalls'))
   or not(r->'spendableCalls'='null'::jsonb or public.xero_recovery_step_uint(r->'spendableCalls'))
  then raise exception 'XERO_STEP_RESULT_INVALID'; end if;
  perform public.xero_recovery_step_iso(r->'retryAt',true); perform public.xero_recovery_step_iso(r->'observedAt',true);
 else raise exception 'XERO_STEP_RESULT_INVALID'; end case;
 return r;
end $$;

create function public.xero_recovery_step_claim(p_plan_json text,p_plan_sha256 text,p_request_json text,p_request_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare parsed jsonb; b jsonb; q jsonb; o public.xero_recovery_step_operations%rowtype; s jsonb; ordinal integer; begin
 parsed:=public.xero_recovery_step_input(p_plan_json,p_plan_sha256,p_request_json,p_request_sha256); b:=parsed->'binding'; q:=parsed->'request';
 if clock_timestamp()<to_timestamp((b->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000)
 then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('xero.recovery.step.'||(b->>'operationId'),0));
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 select * into o from public.xero_recovery_step_operations where operation_id=b->>'operationId';
 if found then
  if o.plan_json is distinct from p_plan_json or o.plan_sha256 is distinct from p_plan_sha256 then raise exception 'XERO_STEP_PLAN_CHANGED'; end if;
 else
  if q->>'step'<>'preflight' or q->'previousResultSha256'<>'null'::jsonb then raise exception 'XERO_STEP_SEQUENCE_REFUSED'; end if;
  insert into public.xero_recovery_step_operations(operation_id,approval_sha256,plan_json,plan_sha256) values(b->>'operationId',b->>'approvalSha256',p_plan_json,p_plan_sha256);
 end if;
 s:=public.xero_recovery_step_state(b->>'operationId');
 if s->>'state'<>'ready' or s->>'nextStep' is distinct from q->>'step' or s->'lastResultSha256' is distinct from q->'previousResultSha256'
 then raise exception 'XERO_STEP_SEQUENCE_REFUSED'; end if;
 if q->>'step' in ('probeGrant','probeAdmission','organisationsGet') and public.xero_recovery_step_iso(s#>'{checkpoint,sessionVerify,expiresAt}')<=clock_timestamp()
 then raise exception 'XERO_STEP_SESSION_EXPIRED'; end if;
 if q->>'step'='probeAdmission' and (public.xero_recovery_step_iso(s#>'{checkpoint,probeGrant,notBefore}')>clock_timestamp() or public.xero_recovery_step_iso(s#>'{checkpoint,probeGrant,expiresAt}')<=clock_timestamp())
 then raise exception 'XERO_STEP_GRANT_EXPIRED'; end if;
 if q->>'step'='organisationsGet' and public.xero_recovery_step_iso(s#>'{checkpoint,probeAdmission,deadlineAt}')<=clock_timestamp()
 then raise exception 'XERO_STEP_ADMISSION_EXPIRED'; end if;
 select count(*) into ordinal from public.xero_recovery_step_attempts where operation_id=b->>'operationId';
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 insert into public.xero_recovery_step_attempts(submission_id,operation_id,ordinal,step,request_json,request_sha256,previous_result_sha256)
 values((q->>'submissionId')::uuid,b->>'operationId',ordinal,q->>'step',p_request_json,p_request_sha256,q->>'previousResultSha256');
 -- A global UUID/request uniqueness check may itself have waited on a different
 -- uncommitted operation. No execute receipt may escape after that wait expires.
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 return jsonb_build_object('operationId',b->>'operationId','planSha256',p_plan_sha256,'requestSha256',p_request_sha256,'step',q->>'step',
  'submissionId',q->>'submissionId','decision','execute','state','submitted_unknown','nextStep',null,'lastResultSha256',s->'lastResultSha256','checkpoint',s->'checkpoint');
exception when others then raise exception 'XERO_STEP_CLAIM_REFUSED' using errcode='40001';
end $$;

create function public.xero_recovery_step_complete(p_plan_json text,p_plan_sha256 text,p_request_json text,p_request_sha256 text,p_result_json text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare parsed jsonb; b jsonb; q jsonb; o public.xero_recovery_step_operations%rowtype; a public.xero_recovery_step_attempts%rowtype; s jsonb; result_sha text; begin
 parsed:=public.xero_recovery_step_input(p_plan_json,p_plan_sha256,p_request_json,p_request_sha256); b:=parsed->'binding'; q:=parsed->'request';
 if clock_timestamp()<to_timestamp((b->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000)
 then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('xero.recovery.step.'||(b->>'operationId'),0));
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 select * into o from public.xero_recovery_step_operations where operation_id=b->>'operationId';
 if not found or o.plan_json is distinct from p_plan_json or o.plan_sha256 is distinct from p_plan_sha256 then raise exception 'XERO_STEP_PLAN_CHANGED'; end if;
 s:=public.xero_recovery_step_state(b->>'operationId');
 select * into a from public.xero_recovery_step_attempts where operation_id=b->>'operationId' and submission_id=(q->>'submissionId')::uuid;
 if not found or s->>'state'<>'submitted_unknown' or s->>'submissionId' is distinct from q->>'submissionId'
  or a.request_json is distinct from p_request_json or a.request_sha256 is distinct from p_request_sha256
 then raise exception 'XERO_STEP_COMPLETION_REFUSED'; end if;
 perform public.xero_recovery_step_result(a.step,p_result_json,b,a.claimed_at,s->'checkpoint');
 result_sha:=encode(sha256(convert_to(p_result_json,'UTF8')),'hex');
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 insert into public.xero_recovery_step_acknowledgements(submission_id,result_json,result_sha256) values(a.submission_id,p_result_json,result_sha);
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 s:=public.xero_recovery_step_state(b->>'operationId');
 return jsonb_build_object('operationId',b->>'operationId','planSha256',p_plan_sha256,'requestSha256',p_request_sha256,'step',a.step,
  'submissionId',a.submission_id,'state',s->'state','resultSha256',result_sha,'nextStep',s->'nextStep','lastResultSha256',s->'lastResultSha256','checkpoint',s->'checkpoint');
exception when others then raise exception 'XERO_STEP_COMPLETE_REFUSED' using errcode='40001';
end $$;

create function public.xero_recovery_step_readback(p_operation_id text,p_plan_sha256 text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.xero_recovery_step_operations where operation_id=p_operation_id and plan_sha256=p_plan_sha256)
 then raise exception 'XERO_STEP_READBACK_REFUSED' using errcode='40001'; end if;
 return public.xero_recovery_step_state(p_operation_id);
end $$;

-- Revoke PostgreSQL's default PUBLIC EXECUTE on every new helper and RPC.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'xero_recovery_step_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
