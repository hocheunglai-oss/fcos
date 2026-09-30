begin;

-- Shared state is authoritative for admission. Saved audit observations are not
-- imported as fresh allowance: the first call requires a separately approved probe.
create table public.xero_shared_tenant_control (
 tenant_id text primary key,
 allowance_known boolean not null default false,
 available_calls integer check(available_calls>=0),
 day_remaining integer check(day_remaining>=0),
 app_day_remaining integer check(app_day_remaining>=0),
 observed_at timestamptz, retry_at timestamptz, day_reset_at timestamptz,
 daily_hold boolean not null default false,
 rate_snapshot jsonb not null default '{}', revision bigint not null default 1,
 updated_at timestamptz not null default clock_timestamp()
);
create table public.xero_shared_budgets (
 id uuid primary key, tenant_id text not null references public.xero_shared_tenant_control(tenant_id),
 owner_key text not null check(length(owner_key) between 1 and 200),
 operation_remaining integer not null check(operation_remaining>=0),
 verification_remaining integer not null check(verification_remaining>=0),
 verification_reserved integer not null check(verification_reserved>=0),
 state text not null default 'active' check(state in ('active','released')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 released_at timestamptz, release_reason text
);
create index xero_shared_budgets_tenant_idx on public.xero_shared_budgets(tenant_id,state,expires_at);
create table public.xero_shared_probe_grants (
 id uuid primary key, tenant_id text not null references public.xero_shared_tenant_control(tenant_id),
 actor_id uuid not null references public.user_profiles(id), reason text not null check(length(reason) between 1 and 1000),
 not_before timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create index xero_shared_probes_tenant_idx on public.xero_shared_probe_grants(tenant_id,expires_at);
create table public.xero_shared_requests (
 id uuid primary key, tenant_id text not null references public.xero_shared_tenant_control(tenant_id),
 token_version integer not null, method text not null check(method in ('GET','POST','PUT','DELETE','PATCH')),
 resource_key text not null check(resource_key ~ '^[A-Za-z]+$'),
 budget_id uuid references public.xero_shared_budgets(id), probe_id uuid references public.xero_shared_probe_grants(id),
 phase text not null check(phase in ('operation','verification')),
 state text not null default 'inflight' check(state in ('inflight','complete','unknown')),
 admitted_at timestamptz not null default clock_timestamp(), deadline_at timestamptz not null,
 completed_at timestamptz, response_status integer, rate_snapshot jsonb not null default '{}',
 outcome_unknown boolean not null default false, resolution_evidence text,
 resolution_request_id uuid references public.xero_shared_requests(id)
);
create index xero_shared_requests_tenant_time_idx on public.xero_shared_requests(tenant_id,admitted_at desc);
create index xero_shared_requests_inflight_idx on public.xero_shared_requests(tenant_id,deadline_at) where state='inflight';
create table public.xero_token_refresh_leases (
 connection_id text primary key check(connection_id='primary'), lease_id uuid not null,
 expected_version integer not null, tenant_id text not null,
 state text not null check(state in ('refreshing','uncertain','revoked','complete','superseded')),
 expires_at timestamptz not null, updated_at timestamptz not null default clock_timestamp()
);

alter table public.xero_shared_tenant_control enable row level security;
alter table public.xero_shared_budgets enable row level security;
alter table public.xero_shared_probe_grants enable row level security;
alter table public.xero_shared_requests enable row level security;
alter table public.xero_token_refresh_leases enable row level security;
revoke all on public.xero_shared_tenant_control,public.xero_shared_budgets,public.xero_shared_probe_grants,public.xero_shared_requests,public.xero_token_refresh_leases from public,anon,authenticated,service_role;
grant select,insert,update on public.xero_shared_tenant_control,public.xero_shared_budgets,public.xero_shared_probe_grants,public.xero_shared_requests,public.xero_token_refresh_leases to service_role;

create function public.xero_shared_assert_tenant(p_tenant_id text) returns integer
language plpgsql security invoker set search_path='' as $$
declare ver integer; begin
 if p_tenant_id is null or p_tenant_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'Invalid Xero tenant.' using errcode='22023'; end if;
 -- Keep the checked primary identity stable until this transaction finishes.
 select token_version into ver from public.xero_contact_sync_connections where id='primary' and tenant_id=p_tenant_id for share;
 if not found then raise exception 'The connected Xero organisation changed.' using errcode='42501'; end if;
 return ver;
end $$;

create function public.xero_shared_status(p_tenant_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.xero_shared_tenant_control%rowtype; reserved integer; flights integer; minute_count integer; begin
 perform public.xero_shared_assert_tenant(p_tenant_id);
 select * into s from public.xero_shared_tenant_control where tenant_id=p_tenant_id;
 select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=p_tenant_id and state='active' and expires_at>clock_timestamp();
 select count(*) into flights from public.xero_shared_requests where tenant_id=p_tenant_id and state='inflight' and deadline_at>clock_timestamp();
 select count(*) into minute_count from public.xero_shared_requests where tenant_id=p_tenant_id and admitted_at>clock_timestamp()-interval '60 seconds';
 return jsonb_build_object('tenantId',p_tenant_id,'allowanceKnown',coalesce(s.allowance_known,false),'availableCalls',s.available_calls,
 'reservedCalls',reserved,'spendableCalls',case when s.allowance_known then greatest(0,s.available_calls-200-reserved) else null end,
 'reserve',200,'inFlight',flights,'minuteCalls',minute_count,'minuteLimit',45,'inFlightLimit',2,
 'retryAt',s.retry_at,'dailyHold',coalesce(s.daily_hold,false),'rateLimit',coalesce(s.rate_snapshot,'{}'::jsonb),'revision',s.revision,
 'unresolvedWrites',(select count(*) from public.xero_shared_requests where tenant_id=p_tenant_id and method<>'GET' and (outcome_unknown or (state='inflight' and deadline_at<=clock_timestamp()))));
end $$;

create function public.xero_shared_reserve(p_tenant_id text,p_id uuid,p_owner_key text,p_operation_calls integer,p_verification_calls integer,p_ttl_seconds integer default 600) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.xero_shared_tenant_control%rowtype; b public.xero_shared_budgets%rowtype; reserved integer; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0)); perform public.xero_shared_assert_tenant(p_tenant_id);
 if p_id is null or p_operation_calls is null or p_verification_calls is null or least(p_operation_calls,p_verification_calls)<0 or p_operation_calls+p_verification_calls not between 1 and 10000 or p_ttl_seconds is null or p_ttl_seconds not between 30 and 1800 or length(btrim(coalesce(p_owner_key,''))) not between 1 and 200 then raise exception 'Invalid Xero request budget.' using errcode='22023'; end if;
 select * into b from public.xero_shared_budgets where id=p_id;
 if found then
   if b.tenant_id<>p_tenant_id or b.owner_key<>p_owner_key or b.state<>'active' or b.expires_at<=clock_timestamp() then raise exception 'Xero budget identity was already used.' using errcode='40001'; end if;
   return to_jsonb(b);
 end if;
 insert into public.xero_shared_tenant_control(tenant_id) values(p_tenant_id) on conflict do nothing;
 select * into s from public.xero_shared_tenant_control where tenant_id=p_tenant_id for update;
 if not s.allowance_known or s.daily_hold then raise exception 'XERO_ALLOWANCE_UNKNOWN' using errcode='55000'; end if;
 if s.retry_at>clock_timestamp() then raise exception 'XERO_RETRY_DEADLINE' using errcode='55000'; end if;
 select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=p_tenant_id and state='active' and expires_at>clock_timestamp();
 if s.available_calls-200-reserved<p_operation_calls+p_verification_calls then raise exception 'XERO_RESERVE_PROTECTED' using errcode='55000'; end if;
 insert into public.xero_shared_budgets(id,tenant_id,owner_key,operation_remaining,verification_remaining,verification_reserved,expires_at)
 values(p_id,p_tenant_id,p_owner_key,p_operation_calls,p_verification_calls,p_verification_calls,clock_timestamp()+make_interval(secs=>p_ttl_seconds)) returning * into b;
 return to_jsonb(b);
end $$;
create function public.xero_shared_release(p_tenant_id text,p_id uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.xero_shared_budgets%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0)); perform public.xero_shared_assert_tenant(p_tenant_id);
 update public.xero_shared_budgets set state='released',released_at=clock_timestamp(),release_reason=left(coalesce(p_reason,'Completed'),1000)
 where id=p_id and tenant_id=p_tenant_id and state='active' returning * into b;
 return public.xero_shared_status(p_tenant_id);
end $$;

create function public.xero_shared_authorize_probe(p_tenant_id text,p_id uuid,p_actor_id uuid,p_not_before timestamptz,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.xero_shared_tenant_control%rowtype; g public.xero_shared_probe_grants%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0)); perform public.xero_shared_assert_tenant(p_tenant_id);
 if not exists(select 1 from public.user_profiles where id=p_actor_id and active and user_type in ('administrator','general_manager')) then raise exception 'Administrator authority is required for an allowance probe.' using errcode='42501'; end if;
 if p_not_before is null or p_not_before<clock_timestamp()-interval '60 seconds' or p_not_before>clock_timestamp()+interval '7 days' or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'A specific allowance probe time and reason are required.' using errcode='22023'; end if;
 insert into public.xero_shared_tenant_control(tenant_id) values(p_tenant_id) on conflict do nothing;
 select * into s from public.xero_shared_tenant_control where tenant_id=p_tenant_id;
 if s.retry_at>p_not_before then raise exception 'XERO_RETRY_DEADLINE' using errcode='55000'; end if;
 if exists(select 1 from public.xero_shared_probe_grants where tenant_id=p_tenant_id and consumed_at is null and expires_at>clock_timestamp()) then raise exception 'A quota probe is already authorised.' using errcode='40001'; end if;
 insert into public.xero_shared_probe_grants(id,tenant_id,actor_id,not_before,expires_at,reason) values(p_id,p_tenant_id,p_actor_id,p_not_before,p_not_before+interval '5 minutes',btrim(p_reason)) returning * into g;
 return to_jsonb(g);
end $$;

create function public.xero_shared_admit(p_tenant_id text,p_id uuid,p_token_version integer,p_method text,p_resource_key text,p_budget_id uuid default null,p_phase text default 'operation',p_probe_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.xero_shared_tenant_control%rowtype; b public.xero_shared_budgets%rowtype; g public.xero_shared_probe_grants%rowtype; reserved integer; flights integer; starts integer; ver integer; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0)); ver:=public.xero_shared_assert_tenant(p_tenant_id);
 if ver is distinct from p_token_version then raise exception 'XERO_CONNECTION_CHANGED' using errcode='40001'; end if;
 if p_id is null or p_method is null or p_resource_key is null or p_phase is null or p_method not in ('GET','POST','PUT','PATCH','DELETE') or p_resource_key !~ '^[A-Za-z]+$' or p_phase not in ('operation','verification') then raise exception 'Invalid Xero request admission.' using errcode='22023'; end if;
 if exists(select 1 from public.xero_shared_requests where id=p_id) then raise exception 'XERO_REQUEST_ALREADY_ADMITTED' using errcode='40001'; end if;
 insert into public.xero_shared_tenant_control(tenant_id) values(p_tenant_id) on conflict do nothing;
 select * into s from public.xero_shared_tenant_control where tenant_id=p_tenant_id for update;
 -- A crashed worker never refunds an uncertain call or silently replays its write.
 update public.xero_shared_requests set state='unknown',outcome_unknown=(method<>'GET'),completed_at=clock_timestamp() where tenant_id=p_tenant_id and state='inflight' and deadline_at<=clock_timestamp();
 select count(*) into flights from public.xero_shared_requests where tenant_id=p_tenant_id and state='inflight';
 select count(*) into starts from public.xero_shared_requests where tenant_id=p_tenant_id and admitted_at>clock_timestamp()-interval '60 seconds';
 if flights>=2 or (p_probe_id is not null and flights>0) or exists(select 1 from public.xero_shared_requests where tenant_id=p_tenant_id and state='inflight' and probe_id is not null) then raise exception 'XERO_INFLIGHT_LIMIT' using errcode='55000'; end if;
 if starts>=45 then raise exception 'XERO_MINUTE_LIMIT' using errcode='55000'; end if;
 if s.retry_at>clock_timestamp() then raise exception 'XERO_RETRY_DEADLINE' using errcode='55000'; end if;
 if p_probe_id is not null then
   if p_method<>'GET' or p_resource_key<>'Organisations' or p_budget_id is not null then raise exception 'An allowance probe is one read-only Organisations request.' using errcode='42501'; end if;
   select * into g from public.xero_shared_probe_grants where id=p_probe_id and tenant_id=p_tenant_id for update;
   if not found or g.consumed_at is not null or g.not_before>clock_timestamp() or g.expires_at<=clock_timestamp() then raise exception 'XERO_PROBE_AUTHORITY_INVALID' using errcode='42501'; end if;
   update public.xero_shared_probe_grants set consumed_at=clock_timestamp() where id=p_probe_id;
 else
   if not s.allowance_known or s.daily_hold then raise exception 'XERO_ALLOWANCE_UNKNOWN' using errcode='55000'; end if;
   if p_method<>'GET' and exists(select 1 from public.xero_shared_requests where tenant_id=p_tenant_id and outcome_unknown) then raise exception 'XERO_WRITE_OUTCOME_UNRESOLVED' using errcode='55000'; end if;
   select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=p_tenant_id and state='active' and expires_at>clock_timestamp();
   if p_budget_id is not null then
     select * into b from public.xero_shared_budgets where id=p_budget_id and tenant_id=p_tenant_id and state='active' and expires_at>clock_timestamp() for update;
     if not found or (p_phase='operation' and b.operation_remaining<1) or (p_phase='verification' and (b.verification_remaining<1 or p_method<>'GET')) then raise exception 'XERO_BUDGET_EXHAUSTED' using errcode='55000'; end if;
     if p_method<>'GET' and b.verification_remaining<1 then raise exception 'XERO_VERIFICATION_BUDGET_REQUIRED' using errcode='55000'; end if;
     if s.available_calls-200<reserved then raise exception 'XERO_RESERVE_PROTECTED' using errcode='55000'; end if;
     update public.xero_shared_budgets set operation_remaining=operation_remaining-case when p_phase='operation' then 1 else 0 end,verification_remaining=verification_remaining-case when p_phase='verification' then 1 else 0 end where id=p_budget_id;
   else
     if p_method<>'GET' then raise exception 'XERO_VERIFICATION_BUDGET_REQUIRED' using errcode='55000'; end if;
     if s.available_calls-200-reserved<1 then raise exception 'XERO_RESERVE_PROTECTED' using errcode='55000'; end if;
   end if;
 end if;
 update public.xero_shared_tenant_control set available_calls=case when available_calls is null then null else greatest(0,available_calls-1) end,revision=revision+1,updated_at=clock_timestamp() where tenant_id=p_tenant_id;
 insert into public.xero_shared_requests(id,tenant_id,token_version,method,resource_key,budget_id,phase,probe_id,deadline_at)
 values(p_id,p_tenant_id,p_token_version,p_method,p_resource_key,p_budget_id,p_phase,p_probe_id,clock_timestamp()+interval '120 seconds');
 return jsonb_build_object('requestId',p_id,'tenantId',p_tenant_id,'deadlineAt',clock_timestamp()+interval '120 seconds');
end $$;

create function public.xero_shared_observe(p_tenant_id text,p_request_id uuid,p_status integer,p_snapshot jsonb,p_outcome_unknown boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.xero_shared_tenant_control%rowtype; r public.xero_shared_requests%rowtype; remaining integer; app_remaining integer; v_retry_at timestamptz; v_reset_at timestamptz; daily boolean; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0));
 select * into r from public.xero_shared_requests where id=p_request_id and tenant_id=p_tenant_id for update;
 if not found then raise exception 'Unknown Xero request receipt.' using errcode='22023'; end if;
 -- A completed response or verified resolution is immutable. Duplicate/late
 -- observations must neither replenish quota nor reopen a resolved write.
 if r.state='complete' then return jsonb_build_object('recorded',true); end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'Invalid Xero allowance observation.' using errcode='22023'; end if;
 if p_snapshot ? 'dayRemaining' and p_snapshot->>'dayRemaining' is not null then remaining:=(p_snapshot->>'dayRemaining')::integer; end if;
 if p_snapshot ? 'appDayRemaining' and p_snapshot->>'appDayRemaining' is not null then app_remaining:=(p_snapshot->>'appDayRemaining')::integer; end if;
 if remaining<0 or app_remaining<0 or p_status not between 100 and 599 then raise exception 'Invalid Xero allowance observation.' using errcode='22023'; end if;
 v_retry_at:=nullif(p_snapshot->>'retryAt','')::timestamptz; v_reset_at:=nullif(p_snapshot->>'dayResetAt','')::timestamptz;
 daily:=coalesce(p_status=429 and p_snapshot->>'rateLimitProblem' in ('day','daily'),false);
 select * into s from public.xero_shared_tenant_control where tenant_id=p_tenant_id for update;
 update public.xero_shared_requests set state=case when p_status is null then 'unknown' else 'complete' end,
 response_status=p_status,rate_snapshot=p_snapshot,
 outcome_unknown=method<>'GET' and (r.outcome_unknown or coalesce(p_outcome_unknown,false) or p_status is null or (r.state='inflight' and r.deadline_at<=clock_timestamp())),
 completed_at=coalesce(r.completed_at,clock_timestamp()) where id=p_request_id;
 -- Responses for a superseded connection retain their receipt but cannot seed a
 -- reconnected tenant's quota or release its hold.
 if not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=p_tenant_id and token_version=r.token_version for share) then return jsonb_build_object('recorded',true,'superseded',true); end if;
 update public.xero_shared_tenant_control set
 allowance_known=case when remaining is not null and r.probe_id is not null and p_status between 200 and 299 then true when daily then false else allowance_known end,
 available_calls=case when remaining is not null and r.probe_id is not null and p_status between 200 and 299 then least(remaining,coalesce(app_remaining,remaining))
 when remaining is not null or app_remaining is not null then least(available_calls,remaining,app_remaining) else available_calls end,
 day_remaining=coalesce(remaining,day_remaining),app_day_remaining=coalesce(app_remaining,app_day_remaining),
 observed_at=case when p_status is not null then clock_timestamp() else observed_at end,
 retry_at=case when v_retry_at is not null then greatest(s.retry_at,v_retry_at) when s.retry_at<=clock_timestamp() then null else s.retry_at end,
 day_reset_at=case when v_reset_at is not null then v_reset_at when s.day_reset_at<=clock_timestamp() then null else s.day_reset_at end,
 daily_hold=case when daily then true when r.probe_id is not null and remaining is not null and p_status between 200 and 299 then false else daily_hold end,
 rate_snapshot=case when p_status is not null then p_snapshot else rate_snapshot end,revision=revision+1,updated_at=clock_timestamp()
 where tenant_id=p_tenant_id;
 return jsonb_build_object('recorded',true);
end $$;

-- A write is released from the admission hold only after an independently
-- completed GET receipt exists for this tenant/resource after the uncertain
-- outcome, with a supplied verified business journal reference. A fresh budget
-- may recover an expired/released operation budget. The business journal must
-- verify the exact target identity; this helper grants no business eligibility.
create function public.xero_shared_resolve_unknown(p_tenant_id text,p_request_id uuid,p_verification_request_id uuid,p_evidence_reference text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.xero_shared_requests%rowtype; v public.xero_shared_requests%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0)); perform public.xero_shared_assert_tenant(p_tenant_id);
 select * into r from public.xero_shared_requests where id=p_request_id and tenant_id=p_tenant_id for update;
 select * into v from public.xero_shared_requests where id=p_verification_request_id and tenant_id=p_tenant_id;
 if r.id is null or r.method='GET' or v.id is null or v.method<>'GET' or v.state<>'complete' or v.response_status is null or v.response_status not between 200 and 299
  or v.resource_key<>r.resource_key or v.budget_id is null or v.phase<>'verification'
  or length(btrim(coalesce(p_evidence_reference,''))) not between 1 and 500 then raise exception 'Verified readback evidence is required.' using errcode='42501'; end if;
 if r.state='complete' and not r.outcome_unknown and r.resolution_request_id=p_verification_request_id and r.resolution_evidence=p_evidence_reference then return true; end if;
 if not (r.outcome_unknown or (r.state='inflight' and r.deadline_at<=clock_timestamp()))
  or v.admitted_at<=(case when r.state='inflight' then r.deadline_at else coalesce(r.completed_at,r.deadline_at) end)
  or (v.budget_id is distinct from r.budget_id and exists(select 1 from public.xero_shared_budgets where id=r.budget_id and state='active' and expires_at>clock_timestamp()))
  then raise exception 'Verified readback evidence is required.' using errcode='42501'; end if;
 update public.xero_shared_requests set state='complete',outcome_unknown=false,completed_at=coalesce(completed_at,clock_timestamp()),
 resolution_evidence=p_evidence_reference,resolution_request_id=p_verification_request_id where id=p_request_id and tenant_id=p_tenant_id;
 return found;
end $$;

-- All renewal/reconnection writes use the same lock and token-version CAS. An
-- expired lease is uncertain, never authority to reuse an already rotated token.
create function public.xero_refresh_claim(p_tenant_id text,p_expected_version integer,p_lease_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.xero_token_refresh_leases%rowtype; ver integer; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.connection.primary',0));
 ver:=public.xero_shared_assert_tenant(p_tenant_id);
 if ver is distinct from p_expected_version then return jsonb_build_object('state','changed'); end if;
 if p_lease_id is null then raise exception 'Invalid renewal lease.' using errcode='22023'; end if;
 select * into l from public.xero_token_refresh_leases where connection_id='primary' for update;
 if found and l.expected_version=ver and l.state in ('refreshing','uncertain','revoked') then
   if l.state='refreshing' and l.expires_at>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
   if l.state='revoked' then return jsonb_build_object('state','revoked'); end if;
   update public.xero_token_refresh_leases set state='uncertain',updated_at=clock_timestamp() where connection_id='primary';
   return jsonb_build_object('state','uncertain');
 end if;
 insert into public.xero_token_refresh_leases(connection_id,lease_id,expected_version,tenant_id,state,expires_at)
 values('primary',p_lease_id,ver,p_tenant_id,'refreshing',clock_timestamp()+interval '90 seconds')
 on conflict(connection_id) do update set lease_id=excluded.lease_id,expected_version=excluded.expected_version,tenant_id=excluded.tenant_id,state=excluded.state,expires_at=excluded.expires_at,updated_at=clock_timestamp();
 return jsonb_build_object('state','claimed','leaseId',p_lease_id);
end $$;

create function public.xero_refresh_finish(p_tenant_id text,p_expected_version integer,p_lease_id uuid,p_connection jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ver integer; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.connection.primary',0));
 ver:=public.xero_shared_assert_tenant(p_tenant_id);
 if ver is distinct from p_expected_version or not exists(select 1 from public.xero_token_refresh_leases where connection_id='primary' and lease_id=p_lease_id and expected_version=ver and state in ('refreshing','uncertain')) then raise exception 'XERO_CONNECTION_CHANGED' using errcode='40001'; end if;
 if p_connection->>'tenantId' is distinct from p_tenant_id or length(coalesce(p_connection->>'accessToken',''))=0 or length(coalesce(p_connection->>'refreshToken',''))=0 or nullif(p_connection->>'expiresAt','') is null or (p_connection->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'Invalid renewed connection.' using errcode='22023'; end if;
 update public.xero_contact_sync_connections set access_token=p_connection->>'accessToken',refresh_token=p_connection->>'refreshToken',expires_at=(p_connection->>'expiresAt')::timestamptz,scope=coalesce(p_connection->>'scope',''),token_version=ver+1,updated_at=clock_timestamp() where id='primary' and token_version=ver;
 update public.xero_token_refresh_leases set state='complete',updated_at=clock_timestamp() where connection_id='primary' and lease_id=p_lease_id;
 return jsonb_build_object('tokenVersion',ver+1);
end $$;

create function public.xero_refresh_fail(p_tenant_id text,p_expected_version integer,p_lease_id uuid,p_state text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('xero.connection.primary',0));
 if p_state is null or p_state not in ('uncertain','revoked','superseded') then raise exception 'Invalid renewal outcome.' using errcode='22023'; end if;
 update public.xero_token_refresh_leases set state=p_state,updated_at=clock_timestamp()
 where connection_id='primary' and lease_id=p_lease_id and expected_version=p_expected_version and tenant_id=p_tenant_id and state in ('refreshing','uncertain')
 and exists(select 1 from public.xero_contact_sync_connections where id='primary' and token_version=p_expected_version and tenant_id=p_tenant_id);
 return found;
end $$;

create function public.xero_reconnect_store(p_expected_version integer,p_connection jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ver integer; tenant text; begin
 perform pg_advisory_xact_lock(hashtextextended('xero.connection.primary',0));
 select token_version into ver from public.xero_contact_sync_connections where id='primary' for update;
 ver:=coalesce(ver,0); tenant:=p_connection->>'tenantId';
 if ver is distinct from p_expected_version then raise exception 'XERO_CONNECTION_CHANGED' using errcode='40001'; end if;
 if tenant is null or tenant !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or length(coalesce(p_connection->>'accessToken',''))=0 or length(coalesce(p_connection->>'refreshToken',''))=0 or nullif(p_connection->>'expiresAt','') is null or (p_connection->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'Invalid reconnect evidence.' using errcode='22023'; end if;
 insert into public.xero_contact_sync_connections(id,tenant_id,tenant_name,access_token,refresh_token,expires_at,scope,token_version,updated_at)
 values('primary',tenant,coalesce(p_connection->>'tenantName',''),p_connection->>'accessToken',p_connection->>'refreshToken',(p_connection->>'expiresAt')::timestamptz,coalesce(p_connection->>'scope',''),ver+1,clock_timestamp())
 on conflict(id) do update set tenant_id=excluded.tenant_id,tenant_name=excluded.tenant_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scope=excluded.scope,token_version=excluded.token_version,updated_at=excluded.updated_at;
 update public.xero_token_refresh_leases set state='superseded',updated_at=clock_timestamp() where connection_id='primary';
 -- A new OAuth grant does not establish a new daily allowance.
 insert into public.xero_shared_tenant_control(tenant_id) values(tenant) on conflict do nothing;
 return jsonb_build_object('tokenVersion',ver+1);
end $$;

-- Browser roles cannot inspect credentials/control rows or invoke admission.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'xero_shared_%' or p.proname in ('xero_refresh_claim','xero_refresh_finish','xero_refresh_fail','xero_reconnect_store')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
