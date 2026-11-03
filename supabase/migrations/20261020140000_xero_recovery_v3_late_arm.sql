-- Future-only v3 one-time late arm. V1/v2 source/history and all tables/ACL remain immutable.
-- Generated as a reviewed additive replacement of the actual existing signatures.
begin;

create or replace function public.xero_recovery_step_input(p_plan_json text,p_plan_sha256 text,p_request_json text,p_request_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p jsonb; b jsonb; q jsonb; key text; begin
 if p_plan_json is null or octet_length(p_plan_json)>16384 or p_request_json is null or octet_length(p_request_json)>4096
  or p_plan_sha256 is distinct from encode(sha256(convert_to(p_plan_json,'UTF8')),'hex')
  or p_request_sha256 is distinct from encode(sha256(convert_to(p_request_json,'UTF8')),'hex')
  or not public.xero_recovery_step_json_clean(p_plan_json::json) or not public.xero_recovery_step_json_clean(p_request_json::json)
 then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 p:=p_plan_json::jsonb; b:=p->'binding'; q:=p_request_json::jsonb;
 if not public.xero_recovery_step_object(p,array['schemaVersion','kind','binding']) or ((p->'schemaVersion'='1'::jsonb and p->>'kind'='fcos_xero_recovery_step_plan_v1')
   or (p->'schemaVersion'='2'::jsonb and p->>'kind'='fcos_xero_recovery_step_plan_v2')
   or (p->'schemaVersion'='3'::jsonb and p->>'kind'='fcos_xero_recovery_step_plan_v3')) is distinct from true
  or not public.xero_recovery_step_object(b,array['operationId','ownerThreadId','tenantId','actorId','expectedVersion','refreshLeaseId','probeId','requestId','approvalSha256','sourceSha256','bindingSha256','organisationIdentitySha256','credentialPreservationCompositeApproved'] || case when p->'schemaVersion'='3'::jsonb then array['preparedAt','armBefore','absoluteNotAfter','executionWindowMs'] else array['issuedAt','notAfter'] end)
 then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 foreach key in array array['operationId','approvalSha256','sourceSha256','bindingSha256'] loop
  if jsonb_typeof(b->key) is distinct from 'string' or b->>key !~ '^[a-f0-9]{64}$' then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 end loop;
 foreach key in array array['ownerThreadId','tenantId','actorId','refreshLeaseId','probeId','requestId'] loop
  if jsonb_typeof(b->key) is distinct from 'string' or b->>key !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'XERO_STEP_BINDING_INVALID'; end if;
 end loop;
 if not public.xero_recovery_step_uint(b->'expectedVersion',2147483646) or (b->>'expectedVersion')::integer<1
  or (case when p->'schemaVersion'='3'::jsonb then
    public.xero_recovery_step_uint(b->'preparedAt') and public.xero_recovery_step_uint(b->'armBefore')
    and public.xero_recovery_step_uint(b->'absoluteNotAfter') and public.xero_recovery_step_uint(b->'executionWindowMs')
    and (b->>'preparedAt')::bigint>0 and (b->>'armBefore')::bigint>(b->>'preparedAt')::bigint
    and (b->>'absoluteNotAfter')::bigint>=(b->>'armBefore')::bigint+900000
    and (b->>'absoluteNotAfter')::bigint-(b->>'preparedAt')::bigint<=86400000
    and (b->>'executionWindowMs')::bigint between 900000 and 1800000
   else public.xero_recovery_step_uint(b->'issuedAt') and public.xero_recovery_step_uint(b->'notAfter')
    and (b->>'notAfter')::bigint-(b->>'issuedAt')::bigint between 1 and (case when p->'schemaVersion'='2'::jsonb then 1800000 else 900000 end)
   end) is distinct from true
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

-- One immutable clock: the original ordinal-0 preflight claim, never an ACK
-- or a new request timestamp. No new table, row mutation or activation RPC.
create function public.xero_recovery_step_clock(p_operation_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('firstStartedAt',s.started,'executionDeadlineAt',
  least(s.started+(o.plan_json::jsonb#>>'{binding,executionWindowMs}')::bigint,
    (o.plan_json::jsonb#>>'{binding,absoluteNotAfter}')::bigint))
 from public.xero_recovery_step_operations o
 join public.xero_recovery_step_attempts a on a.operation_id=o.operation_id and a.ordinal=0 and a.step='preflight'
 cross join lateral (select floor(extract(epoch from a.claimed_at)*1000)::bigint as started) s
 where o.operation_id=p_operation_id and o.plan_json::jsonb->'schemaVersion'='3'::jsonb;
$$;
revoke all on function public.xero_recovery_step_clock(text) from public,anon,authenticated,service_role;
grant execute on function public.xero_recovery_step_clock(text) to service_role;

create or replace function public.xero_recovery_step_state(p_operation_id text) returns jsonb
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
  'currentStep',a.step,'submissionId',a.submission_id,'lastResultSha256',last_sha,'checkpoint',checkpoint,'executionAuthorityGranted',false)
  || case when o.plan_json::jsonb->'schemaVersion'='3'::jsonb
    then jsonb_build_object('execution',public.xero_recovery_step_clock(p_operation_id)) else '{}'::jsonb end;
end $$;

create or replace function public.xero_recovery_step_claim(p_plan_json text,p_plan_sha256 text,p_request_json text,p_request_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare parsed jsonb; b jsonb; q jsonb; o public.xero_recovery_step_operations%rowtype; s jsonb; ordinal integer; v3 boolean; execution jsonb; begin
 parsed:=public.xero_recovery_step_input(p_plan_json,p_plan_sha256,p_request_json,p_request_sha256); b:=parsed->'binding'; q:=parsed->'request';
 v3:=p_plan_json::jsonb->'schemaVersion'='3'::jsonb;
 if v3 then
  execution:=public.xero_recovery_step_clock(b->>'operationId');
  b:=b||jsonb_build_object('issuedAt',b->'preparedAt','notAfter',coalesce(execution->'executionDeadlineAt',b->'armBefore'));
 end if;
 if clock_timestamp()<to_timestamp((b->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000)
 then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('xero.recovery.step.'||(b->>'operationId'),0));
 if v3 then execution:=public.xero_recovery_step_clock(b->>'operationId');
  b:=b||jsonb_build_object('notAfter',coalesce(execution->'executionDeadlineAt',b->'armBefore')); end if;
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
 -- The first INSERT is the durable start. Recheck preparation AFTER any
 -- global unique-index wait; a missed arm boundary rolls the transaction back.
 if v3 then
  execution:=public.xero_recovery_step_clock(b->>'operationId');
  if q->>'step'='preflight' and clock_timestamp()>=to_timestamp((b->>'armBefore')::numeric/1000)
   then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
  if (execution->>'executionDeadlineAt')::bigint-(execution->>'firstStartedAt')::bigint<900000
   then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
  b:=b||jsonb_build_object('notAfter',execution->'executionDeadlineAt');
 end if;
 -- A global UUID/request uniqueness check may itself have waited on a different
 -- uncommitted operation. No execute receipt may escape after that wait expires.
 if clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000) then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 return jsonb_build_object('operationId',b->>'operationId','planSha256',p_plan_sha256,'requestSha256',p_request_sha256,'step',q->>'step',
  'submissionId',q->>'submissionId','decision','execute','state','submitted_unknown','nextStep',null,'lastResultSha256',s->'lastResultSha256','checkpoint',s->'checkpoint')||case when v3 then jsonb_build_object('execution',execution) else '{}'::jsonb end;
exception when others then raise exception 'XERO_STEP_CLAIM_REFUSED' using errcode='40001';
end $$;

create or replace function public.xero_recovery_step_complete(p_plan_json text,p_plan_sha256 text,p_request_json text,p_request_sha256 text,p_result_json text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare parsed jsonb; b jsonb; q jsonb; o public.xero_recovery_step_operations%rowtype; a public.xero_recovery_step_attempts%rowtype; s jsonb; result_sha text; v3 boolean; execution jsonb; begin
 parsed:=public.xero_recovery_step_input(p_plan_json,p_plan_sha256,p_request_json,p_request_sha256); b:=parsed->'binding'; q:=parsed->'request';
 v3:=p_plan_json::jsonb->'schemaVersion'='3'::jsonb;
 if v3 then
  execution:=public.xero_recovery_step_clock(b->>'operationId');
  b:=b||jsonb_build_object('issuedAt',b->'preparedAt','notAfter',coalesce(execution->'executionDeadlineAt',b->'armBefore'));
 end if;
 if clock_timestamp()<to_timestamp((b->>'issuedAt')::numeric/1000) or clock_timestamp()>=to_timestamp((b->>'notAfter')::numeric/1000)
 then raise exception 'XERO_STEP_PLAN_EXPIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('xero.recovery.step.'||(b->>'operationId'),0));
 if v3 then execution:=public.xero_recovery_step_clock(b->>'operationId');
  b:=b||jsonb_build_object('notAfter',coalesce(execution->'executionDeadlineAt',b->'armBefore')); end if;
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
  'submissionId',a.submission_id,'state',s->'state','resultSha256',result_sha,'nextStep',s->'nextStep','lastResultSha256',s->'lastResultSha256','checkpoint',s->'checkpoint')||case when v3 then jsonb_build_object('execution',execution) else '{}'::jsonb end;
exception when others then raise exception 'XERO_STEP_COMPLETE_REFUSED' using errcode='40001';
end $$;

commit;
