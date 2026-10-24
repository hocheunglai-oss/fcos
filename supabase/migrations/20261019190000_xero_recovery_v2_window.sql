begin;

-- Future independently admitted v2 plans may use a 30-minute total envelope.
-- V1 remains capped at 15 minutes. No existing plan, timestamp, approval key,
-- attempt, acknowledgement, unknown outcome, grant or provider cap is rewritten.
-- Only the input validator changes; claim/complete deadline rechecks, locking,
-- approval uniqueness, service-role ACL and SECURITY INVOKER remain unchanged.
-- This is preparation runway, not a delayed or renewable execution clock.
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
   or (p->'schemaVersion'='2'::jsonb and p->>'kind'='fcos_xero_recovery_step_plan_v2')) is distinct from true
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
  or (b->>'notAfter')::bigint-(b->>'issuedAt')::bigint not between 1 and (case when p->'schemaVersion'='2'::jsonb then 1800000 else 900000 end)
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

commit;
