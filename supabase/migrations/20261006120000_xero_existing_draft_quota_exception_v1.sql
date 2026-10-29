begin;

-- This owner-imported grant changes request capacity only. It grants no document
-- eligibility, human review, payment, allocation, sending or retry authority.
create table public.xero_existing_draft_quota_grants_v1 (
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null references public.user_profiles(id),
 actor_email text not null check(actor_email=lower(btrim(actor_email)) and length(actor_email) between 1 and 320),
 human_approval_sha256 text not null check(human_approval_sha256='f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004'),
 reserve_intent_sha256 text not null check(reserve_intent_sha256='7d2008f645eeb9219e3af1480c4088cc1d81dec8253f27b3c7fbdae9e419e9ed'),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create table public.xero_existing_draft_quota_scopes_v1 (
 budget_id uuid primary key references public.xero_shared_budgets(id),tenant_id uuid not null,
 actor_id uuid not null,actor_email text not null,grant_id uuid references public.xero_existing_draft_quota_grants_v1(id),
 reserve_floor integer not null check(reserve_floor in(0,200)),mode text not null check(mode in('preview','apply','recovery','escrow')),
 target_ids uuid[] not null check(cardinality(target_ids) between 1 and 25),run_id uuid references public.xero_financial_sync_runs(id),
 claim_id uuid references public.xero_existing_draft_authorisation_claims(id),parent_budget_id uuid references public.xero_shared_budgets(id),
 operation_calls integer not null check(operation_calls>=0),verification_calls integer not null check(verification_calls>=0),
 ttl_seconds integer not null check(ttl_seconds in(600,0)),created_at timestamptz not null default clock_timestamp(),
 check((reserve_floor=0)=(grant_id is not null)),
 check((mode in('recovery','escrow'))=(claim_id is not null)),check((mode='preview')=(run_id is null)),
 check((mode='escrow')=(ttl_seconds=0)),check(mode not in('recovery','escrow') or cardinality(target_ids)=1)
);
create table public.xero_existing_draft_quota_requests_v1 (
 request_id uuid primary key,budget_id uuid not null references public.xero_existing_draft_quota_scopes_v1(budget_id),
 resource_path text not null,method text not null,phase text not null,payload_json jsonb,
 claim_id uuid references public.xero_existing_draft_authorisation_claims(id),
 transaction_id bigint not null default txid_current(),created_at timestamptz not null default clock_timestamp()
);
create index xero_existing_draft_quota_request_budget on public.xero_existing_draft_quota_requests_v1(budget_id,resource_path,phase);
create table public.xero_existing_draft_quota_events_v1 (
 id uuid primary key default gen_random_uuid(),budget_id uuid not null references public.xero_shared_budgets(id),
 event_type text not null check(event_type in('reserved','released','escrowed','transferred')),
 details jsonb not null,transaction_id bigint not null default txid_current(),created_at timestamptz not null default clock_timestamp()
);
do $$declare tab text;begin
 foreach tab in array array['grants','scopes','requests','events'] loop
  execute format('alter table public.xero_existing_draft_quota_%s_v1 enable row level security',tab);
  execute format('alter table public.xero_existing_draft_quota_%s_v1 force row level security',tab);
  execute format('revoke all on public.xero_existing_draft_quota_%s_v1 from public,anon,authenticated,service_role',tab);
  execute format('grant select on public.xero_existing_draft_quota_%s_v1 to service_role',tab);
  execute format('create trigger quota_immutable before update or delete on public.xero_existing_draft_quota_%s_v1 for each row execute function public.xero_document_correction_immutable_v1()',tab);
 end loop;
end $$;

create function public.xero_existing_draft_quota_lock_v1(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.xero_document_correction_lock_v1();
 if p_tenant_id is null or not pg_try_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id::text,0)) then raise exception 'Active tenant admission; status held without side effects' using errcode='55P03';end if;
end $$;
create function public.xero_existing_draft_quota_grant_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||new.tenant_id::text,0));
 if exists(select 1 from public.xero_existing_draft_quota_grants_v1 g where g.tenant_id=new.tenant_id and g.actor_id=new.actor_id and g.reserve_intent_sha256=new.reserve_intent_sha256 and new.created_at<g.expires_at and g.created_at<new.expires_at) then raise exception 'XERO_DRAFT_QUOTA_GRANT_OVERLAP' using errcode='40001';end if;
 return new;
end $$;
create trigger existing_draft_quota_grant_guard before insert on public.xero_existing_draft_quota_grants_v1 for each row execute function public.xero_existing_draft_quota_grant_guard_v1();

create function public.xero_existing_draft_quota_actor_v1(p_tenant_id uuid,p_actor_id uuid,p_actor_email text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor_id is null or p_actor_email is null or p_actor_email<>lower(btrim(p_actor_email))
  or not exists(select 1 from public.user_profiles p where p.id=p_actor_id and p.active and p.email=p_actor_email) then
  raise exception 'XERO_DRAFT_QUOTA_ACTOR_INVALID' using errcode='42501';end if;
 perform public.xero_campaign_actor_v1(p_actor_id,p_tenant_id);
end $$;
create function public.xero_existing_draft_quota_targets_v1(p_tenant_id uuid,p_target_ids uuid[])
returns uuid[] language plpgsql security definer set search_path='' as $$
declare ids uuid[];begin
 if p_target_ids is null or cardinality(p_target_ids) not between 1 and 54 or array_position(p_target_ids,null) is not null then raise exception 'XERO_DRAFT_QUOTA_SCOPE_INVALID' using errcode='22023';end if;
 select array_agg(t order by t) into ids from(select distinct unnest(p_target_ids) t)x;
 if (select count(*) from public.xero_existing_draft_authorisation_approved_records a where a.tenant_id=p_tenant_id and a.selection->>'humanApprovalSha256'='f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004')<>54 or cardinality(ids)<>cardinality(p_target_ids) or (select count(*) from public.xero_existing_draft_authorisation_approved_records a where a.tenant_id=p_tenant_id and a.target_id=any(ids) and a.selection->>'humanApprovalSha256'='f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004')<>cardinality(ids) then raise exception 'XERO_DRAFT_QUOTA_SCOPE_INVALID' using errcode='42501';end if;
 return ids;
end $$;
create function public.xero_existing_draft_quota_policy_v1(p_tenant_id uuid,p_actor_id uuid,p_actor_email text,p_target_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.xero_existing_draft_quota_grants_v1;stale record;begin
 perform public.xero_existing_draft_quota_lock_v1(p_tenant_id);
 perform public.xero_existing_draft_quota_actor_v1(p_tenant_id,p_actor_id,p_actor_email);
 perform public.xero_existing_draft_quota_targets_v1(p_tenant_id,p_target_ids);
 for stale in select s.budget_id from public.xero_existing_draft_quota_scopes_v1 s join public.xero_shared_budgets b on b.id=s.budget_id where s.tenant_id=p_tenant_id and s.actor_id=p_actor_id and s.actor_email=p_actor_email and s.reserve_floor=0 and b.state='active' and ((s.mode in('apply','recovery') and s.created_at+make_interval(secs=>s.ttl_seconds)<=clock_timestamp()) or (s.mode='escrow' and exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=s.claim_id and e.status in('confirmed','rejected')))) order by s.created_at loop
  perform public.xero_existing_draft_quota_release_v1(p_tenant_id,stale.budget_id,p_actor_id,p_actor_email,'Expired scoped execution; retain claim recovery');
 end loop;
 select * into g from public.xero_existing_draft_quota_grants_v1 where tenant_id=p_tenant_id and actor_id=p_actor_id and actor_email=p_actor_email and created_at<=clock_timestamp() and expires_at>clock_timestamp() order by created_at desc,id limit 1;
 return jsonb_build_object('reserveFloor',case when g.id is null then 200 else 0 end,'grantId',g.id,'grantExpiresAt',g.expires_at);
end $$;
-- Expiry is checked at new operation/POST authority, never at claim recovery.
create function public.xero_existing_draft_quota_floor_v1(p_budget_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.xero_existing_draft_quota_scopes_v1;g public.xero_existing_draft_quota_grants_v1;begin
 select * into s from public.xero_existing_draft_quota_scopes_v1 where budget_id=p_budget_id;
 if s.budget_id is null then return 200;end if;
 if s.reserve_floor=200 then return 200;end if;
 select * into g from public.xero_existing_draft_quota_grants_v1 where id=s.grant_id;
 if g.id is null or g.tenant_id<>s.tenant_id or g.actor_id<>s.actor_id or g.actor_email<>s.actor_email or s.created_at<g.created_at
  or (s.mode in('preview','apply') and s.created_at>=g.expires_at) then raise exception 'XERO_DRAFT_QUOTA_BINDING_INVALID' using errcode='42501';end if;
 return 0;
end $$;
create function public.xero_existing_draft_quota_budget_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.xero_existing_draft_quota_scopes_v1;begin
 select * into s from public.xero_existing_draft_quota_scopes_v1 where budget_id=old.id;
 if s.budget_id is null then if tg_op='DELETE' then return old;end if;return new;end if;
 if tg_op='DELETE' or (to_jsonb(new)-'operation_remaining'-'verification_remaining'-'state'-'released_at'-'release_reason') is distinct from (to_jsonb(old)-'operation_remaining'-'verification_remaining'-'state'-'released_at'-'release_reason') then raise exception 'XERO_DRAFT_QUOTA_BUDGET_IMMUTABLE' using errcode='42501';end if;
 if old.state='active' and new.state='active' and new.released_at is not distinct from old.released_at and new.release_reason is not distinct from old.release_reason
  and exists(select 1 from public.xero_existing_draft_quota_requests_v1 q where q.budget_id=old.id and q.transaction_id=txid_current() and not exists(select 1 from public.xero_shared_requests r where r.id=q.request_id)
   and new.operation_remaining=old.operation_remaining-case when q.phase='operation' then 1 else 0 end and new.verification_remaining=old.verification_remaining-case when q.phase='verification' then 1 else 0 end) then return new;end if;
 if old.state='active' and new.state='released' and new.operation_remaining=old.operation_remaining and new.verification_remaining=old.verification_remaining
  and exists(select 1 from public.xero_existing_draft_quota_events_v1 e where e.budget_id=old.id and e.transaction_id=txid_current() and e.event_type in('released','transferred')) then return new;end if;
 raise exception 'XERO_DRAFT_QUOTA_BUDGET_IMMUTABLE' using errcode='42501';
end $$;
create trigger existing_draft_quota_budget_guard before update or delete on public.xero_shared_budgets for each row execute function public.xero_existing_draft_quota_budget_guard_v1();
create function public.xero_existing_draft_quota_receipt_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if exists(select 1 from public.xero_existing_draft_quota_scopes_v1 s where s.budget_id in(old.budget_id,new.budget_id))
   and (to_jsonb(new)-'state'-'completed_at'-'response_status'-'rate_snapshot'-'outcome_unknown'-'resolution_evidence'-'resolution_request_id') is distinct from (to_jsonb(old)-'state'-'completed_at'-'response_status'-'rate_snapshot'-'outcome_unknown'-'resolution_evidence'-'resolution_request_id') then raise exception 'XERO_DRAFT_QUOTA_REQUEST_IMMUTABLE' using errcode='42501';end if;
 elsif exists(select 1 from public.xero_existing_draft_quota_scopes_v1 s where s.budget_id=new.budget_id)
  and not exists(select 1 from public.xero_existing_draft_quota_requests_v1 q where q.request_id=new.id and q.budget_id=new.budget_id and q.method=new.method and q.phase=new.phase and q.transaction_id=txid_current() and substring(q.resource_path from '^/([A-Za-z]+)')=new.resource_key) then raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;
 return new;
end $$;
create trigger existing_draft_quota_receipt_guard before insert or update on public.xero_shared_requests for each row execute function public.xero_existing_draft_quota_receipt_guard_v1();

create function public.xero_existing_draft_quota_release_v1(p_tenant_id uuid,p_id uuid,p_actor_id uuid,p_actor_email text,p_reason text default 'Completed')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.xero_existing_draft_quota_scopes_v1;b public.xero_shared_budgets;c public.xero_existing_draft_authorisation_claims;remaining integer;child uuid;begin
 perform public.xero_existing_draft_quota_lock_v1(p_tenant_id);
 perform public.xero_existing_draft_quota_actor_v1(p_tenant_id,p_actor_id,p_actor_email);
 select * into s from public.xero_existing_draft_quota_scopes_v1 where budget_id=p_id;
 select * into b from public.xero_shared_budgets where id=p_id for update;
 if s.budget_id is null or s.tenant_id<>p_tenant_id or s.actor_id<>p_actor_id or s.actor_email<>p_actor_email or b.id is null or (s.mode='escrow' and not exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=s.claim_id and e.status in('confirmed','rejected'))) then raise exception 'XERO_DRAFT_QUOTA_BINDING_INVALID' using errcode='42501';end if;
 if b.state='released' then return public.xero_shared_status(p_tenant_id::text);end if;
 if s.reserve_floor=0 and s.mode in('apply','recovery') then
  for c in select claim_row.* from public.xero_existing_draft_authorisation_claims claim_row where claim_row.run_id=s.run_id and claim_row.actor_id=s.actor_id and claim_row.actor_email=s.actor_email and claim_row.target_id=any(s.target_ids)
   and (s.claim_id is null or claim_row.id=s.claim_id) and not exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=claim_row.id and e.status in('confirmed','rejected'))
   and (s.mode='recovery' or exists(select 1 from public.xero_existing_draft_authorisation_requests r where r.claim_id=claim_row.id and r.budget_id=s.budget_id)
    or (not exists(select 1 from public.xero_existing_draft_authorisation_requests r where r.claim_id=claim_row.id) and claim_row.created_at>=s.created_at and claim_row.created_at<=s.created_at+make_interval(secs=>s.ttl_seconds))) order by claim_row.id loop
   select (case when s.mode='apply' then 2 else s.verification_calls end)-count(*)::integer into remaining from public.xero_existing_draft_quota_requests_v1 q where q.budget_id=p_id and q.phase='verification' and q.claim_id=c.id;
   if remaining<0 or remaining>b.verification_remaining then raise exception 'XERO_DRAFT_QUOTA_ESCROW_INVALID' using errcode='40001';end if;
   if remaining>0 then
    child:=gen_random_uuid();
    insert into public.xero_shared_budgets(id,tenant_id,owner_key,operation_remaining,verification_remaining,verification_reserved,expires_at) values(child,p_tenant_id::text,'draft-status-escrow:'||c.id::text||':'||child::text,0,remaining,remaining,'infinity');
    insert into public.xero_existing_draft_quota_scopes_v1(budget_id,tenant_id,actor_id,actor_email,grant_id,reserve_floor,mode,target_ids,run_id,claim_id,parent_budget_id,operation_calls,verification_calls,ttl_seconds)
     values(child,p_tenant_id,p_actor_id,p_actor_email,s.grant_id,0,'escrow',array[c.target_id],c.run_id,c.id,p_id,0,remaining,0);
    insert into public.xero_existing_draft_quota_events_v1(budget_id,event_type,details) values(child,'escrowed',jsonb_build_object('parentBudgetId',p_id,'claimId',c.id,'verificationCalls',remaining));
   end if;
  end loop;
 end if;
 insert into public.xero_existing_draft_quota_events_v1(budget_id,event_type,details) values(p_id,'released',jsonb_build_object('reason',left(coalesce(p_reason,'Completed'),1000)));
 update public.xero_shared_budgets set state='released',released_at=clock_timestamp(),release_reason=left(coalesce(p_reason,'Completed'),1000) where id=p_id;
 return public.xero_shared_status(p_tenant_id::text);
end $$;
create function public.xero_existing_draft_quota_reserve_v1(p_tenant_id uuid,p_id uuid,p_actor_id uuid,p_actor_email text,p_target_ids uuid[],p_mode text,p_run_id uuid default null,p_claim_id uuid default null,p_ttl_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];policy jsonb;s public.xero_existing_draft_quota_scopes_v1;b public.xero_shared_budgets;control public.xero_shared_tenant_control;
 c public.xero_existing_draft_authorisation_claims;esc public.xero_existing_draft_quota_scopes_v1;parent public.xero_existing_draft_quota_scopes_v1;
 ops integer;ver integer;floor integer;reserved integer;grant_id uuid;begin
 perform public.xero_existing_draft_quota_lock_v1(p_tenant_id);
 perform public.xero_existing_draft_quota_actor_v1(p_tenant_id,p_actor_id,p_actor_email);ids:=public.xero_existing_draft_quota_targets_v1(p_tenant_id,p_target_ids);
 if p_id is null or cardinality(ids)>25 or p_mode not in('preview','apply','recovery') or p_mode is null or p_ttl_seconds is distinct from 600 or (p_mode='preview') is distinct from (p_run_id is null) or (p_mode='recovery') is distinct from (p_claim_id is not null) then raise exception 'XERO_DRAFT_QUOTA_SCOPE_INVALID' using errcode='22023';end if;
 if p_mode<>'preview' and not exists(select 1 from public.xero_financial_sync_runs r where r.id=p_run_id and r.created_by=p_actor_id and r.created_by_email=p_actor_email and r.mode='preview' and r.control_totals->>'preservationPolicy'='authorise_existing_xero_drafts_v1' and r.control_totals#>>'{workflowSnapshot,tenantId}'=p_tenant_id::text and r.status in('ready_for_review','authorised','processing')) then raise exception 'XERO_DRAFT_QUOTA_RUN_INVALID' using errcode='42501';end if;
 if p_mode='apply' and (select count(*) from public.xero_financial_sync_items i where i.run_id=p_run_id and i.xero_document_id=any(array(select unnest(ids)::text)) and i.proposed_action='protected_legacy' and i.proposed_payload='null'::jsonb and i.status in('eligible','selected') and i.blockers='[]'::jsonb)<>cardinality(ids) then raise exception 'XERO_DRAFT_QUOTA_RUN_INVALID' using errcode='42501';end if;
 select * into s from public.xero_existing_draft_quota_scopes_v1 where budget_id=p_id;select * into b from public.xero_shared_budgets where id=p_id for update;
 if b.id is not null then
  if s.budget_id is null or s.tenant_id<>p_tenant_id or s.actor_id<>p_actor_id or s.actor_email<>p_actor_email or s.target_ids<>ids or s.mode<>p_mode or s.run_id is distinct from p_run_id or s.claim_id is distinct from p_claim_id or s.ttl_seconds<>p_ttl_seconds or b.state<>'active' or b.expires_at<=clock_timestamp() or s.created_at+make_interval(secs=>s.ttl_seconds)<=clock_timestamp()
   or (p_mode in('preview','apply') and (s.operation_calls<>25+cardinality(ids)*(case when p_mode='apply' then 4 else 1 end) or s.verification_calls<>(case when p_mode='apply' then cardinality(ids)*2 else 0 end))) then raise exception 'XERO_DRAFT_QUOTA_REPLAY_MISMATCH' using errcode='40001';end if;
  if s.reserve_floor=0 and p_mode in('preview','apply') and not exists(select 1 from public.xero_existing_draft_quota_grants_v1 g where g.id=s.grant_id and g.expires_at>clock_timestamp()) then raise exception 'XERO_DRAFT_QUOTA_GRANT_EXPIRED' using errcode='42501';end if;
  return to_jsonb(b)||jsonb_build_object('reserveFloor',s.reserve_floor,'operationCalls',s.operation_calls,'verificationCalls',s.verification_calls,'grantId',s.grant_id);
 end if;
 policy:=public.xero_existing_draft_quota_policy_v1(p_tenant_id,p_actor_id,p_actor_email,ids);floor:=(policy->>'reserveFloor')::integer;grant_id:=(policy->>'grantId')::uuid;
 ops:=25+cardinality(ids)*(case when p_mode='apply' then 4 else 1 end);ver:=case when p_mode='apply' then cardinality(ids)*2 else 0 end;
 if p_mode='recovery' then
  select * into c from public.xero_existing_draft_authorisation_claims where id=p_claim_id and tenant_id=p_tenant_id and actor_id=p_actor_id and actor_email=p_actor_email and run_id=p_run_id and array[target_id]=ids;
  if c.id is null or exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=c.id and e.status in('confirmed','rejected')) then raise exception 'XERO_DRAFT_QUOTA_CLAIM_INVALID' using errcode='42501';end if;
  select scope_row.* into parent from public.xero_existing_draft_quota_scopes_v1 scope_row join public.xero_shared_budgets budget_row on budget_row.id=scope_row.budget_id where scope_row.mode in('apply','recovery') and scope_row.run_id=c.run_id and c.target_id=any(scope_row.target_ids) and scope_row.actor_id=c.actor_id and scope_row.actor_email=c.actor_email and scope_row.reserve_floor=0 and budget_row.state='active' order by scope_row.created_at desc limit 1;
  if parent.budget_id is not null then perform public.xero_existing_draft_quota_release_v1(p_tenant_id,parent.budget_id,p_actor_id,p_actor_email,'Transfer interrupted claim to recovery');end if;
  select scope_row.* into esc from public.xero_existing_draft_quota_scopes_v1 scope_row join public.xero_shared_budgets budget_row on budget_row.id=scope_row.budget_id where scope_row.mode='escrow' and scope_row.claim_id=c.id and budget_row.state='active' order by scope_row.created_at desc limit 1;
  if esc.budget_id is not null then
   select * into b from public.xero_shared_budgets where id=esc.budget_id for update;ops:=0;ver:=b.verification_remaining;floor:=0;grant_id:=esc.grant_id;
   insert into public.xero_existing_draft_quota_events_v1(budget_id,event_type,details) values(esc.budget_id,'transferred',jsonb_build_object('toBudgetId',p_id,'claimId',c.id));
   update public.xero_shared_budgets set state='released',released_at=clock_timestamp(),release_reason='Transferred to exact claim recovery' where id=esc.budget_id;
  else
   if exists(select 1 from public.xero_existing_draft_quota_scopes_v1 scope_row where scope_row.run_id=c.run_id and c.target_id=any(scope_row.target_ids) and scope_row.reserve_floor=0) then raise exception 'XERO_DRAFT_QUOTA_ESCROW_EXHAUSTED' using errcode='55000';end if;
   ops:=1;ver:=2;floor:=200;grant_id:=null;
  end if;
 else
  if public.xero_document_correction_active_v1() or exists(select 1 from public.xero_existing_draft_quota_scopes_v1 scope_row join public.xero_shared_budgets budget_row on budget_row.id=scope_row.budget_id where scope_row.actor_id=p_actor_id and scope_row.tenant_id=p_tenant_id and scope_row.mode in('preview','apply') and budget_row.state='active' and budget_row.expires_at>clock_timestamp()) then raise exception 'XERO_DRAFT_QUOTA_OPERATION_HELD' using errcode='40001';end if;
 end if;
 insert into public.xero_shared_tenant_control(tenant_id) values(p_tenant_id::text) on conflict do nothing;
 select * into control from public.xero_shared_tenant_control where tenant_id=p_tenant_id::text for update;
 if control.allowance_known is distinct from true or control.daily_hold then raise exception 'XERO_ALLOWANCE_UNKNOWN' using errcode='55000';end if;
 if control.retry_at>clock_timestamp() then raise exception 'XERO_RETRY_DEADLINE' using errcode='55000';end if;
 select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=p_tenant_id::text and state='active' and expires_at>clock_timestamp();
 if coalesce(control.available_calls,0)-floor-reserved<ops+ver+(case when p_mode='preview' then 25+cardinality(ids)*6 else 0 end) then raise exception 'XERO_RESERVE_PROTECTED' using errcode='55000';end if;
 insert into public.xero_shared_budgets(id,tenant_id,owner_key,operation_remaining,verification_remaining,verification_reserved,expires_at)
  values(p_id,p_tenant_id::text,case when p_mode='preview' then 'draft-status-preview:'||p_id::text else 'draft-status:'||p_run_id::text end,ops,ver,ver,case when floor=0 and p_mode in('apply','recovery') then 'infinity'::timestamptz else clock_timestamp()+interval '600 seconds' end) returning * into b;
 insert into public.xero_existing_draft_quota_scopes_v1(budget_id,tenant_id,actor_id,actor_email,grant_id,reserve_floor,mode,target_ids,run_id,claim_id,parent_budget_id,operation_calls,verification_calls,ttl_seconds)
  values(p_id,p_tenant_id,p_actor_id,p_actor_email,grant_id,floor,p_mode,ids,p_run_id,p_claim_id,esc.budget_id,ops,ver,p_ttl_seconds);
 insert into public.xero_existing_draft_quota_events_v1(budget_id,event_type,details) values(p_id,'reserved',jsonb_build_object('reserveFloor',floor,'operationCalls',ops,'verificationCalls',ver,'grantId',grant_id,'mode',p_mode));
 return to_jsonb(b)||jsonb_build_object('reserveFloor',floor,'operationCalls',ops,'verificationCalls',ver,'grantId',grant_id);
end $$;

create function public.xero_shared_admit_scoped_v1(p_tenant_id text,p_id uuid,p_token_version integer,p_method text,p_resource_key text,p_budget_id uuid default null,p_phase text default 'operation',p_probe_id uuid default null,p_resource_path text default null,p_payload_json jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope public.xero_existing_draft_quota_scopes_v1;s public.xero_shared_tenant_control;b public.xero_shared_budgets;
 c public.xero_existing_draft_authorisation_claims;planned public.xero_existing_draft_authorisation_requests;floor integer;reserved integer;ver integer;target uuid;cap integer;begin
 select * into scope from public.xero_existing_draft_quota_scopes_v1 where budget_id=p_budget_id;
 if scope.budget_id is null then return public.xero_shared_admit(p_tenant_id,p_id,p_token_version,p_method,p_resource_key,p_budget_id,p_phase,p_probe_id);end if;
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id,0));ver:=public.xero_shared_assert_tenant(p_tenant_id);
 if ver is distinct from p_token_version then raise exception 'XERO_CONNECTION_CHANGED' using errcode='40001';end if;
 perform public.xero_existing_draft_quota_actor_v1(scope.tenant_id,scope.actor_id,scope.actor_email);floor:=public.xero_existing_draft_quota_floor_v1(p_budget_id);
 if scope.tenant_id::text is distinct from p_tenant_id or p_id is null or p_phase is null or p_phase not in('operation','verification') or p_probe_id is not null or scope.mode='escrow' or p_resource_path is null or p_method is null or p_resource_key is distinct from substring(p_resource_path from '^/([A-Za-z]+)') then raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;
 if exists(select 1 from public.xero_shared_requests where id=p_id) or exists(select 1 from public.xero_existing_draft_quota_requests_v1 where request_id=p_id) then raise exception 'XERO_REQUEST_ALREADY_ADMITTED' using errcode='40001';end if;
 if p_resource_path~'^/Invoices/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}[?]unitdp=4$' then target:=substring(p_resource_path from '^/Invoices/([^?]+)')::uuid;end if;
 if p_method='POST' then
  if scope.mode<>'apply' or p_phase<>'operation' or target is null or not(target=any(scope.target_ids)) then raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;
  select * into planned from public.xero_existing_draft_authorisation_requests where request_id=p_id;
  select * into c from public.xero_existing_draft_authorisation_claims where id=planned.claim_id;
  if planned.claim_id is null or planned.budget_id is distinct from p_budget_id or planned.token_version is distinct from p_token_version or planned.resource_path is distinct from p_resource_path or planned.payload is distinct from p_payload_json or c.target_id is distinct from target or c.run_id is distinct from scope.run_id or c.actor_id is distinct from scope.actor_id or c.actor_email is distinct from scope.actor_email
   or p_payload_json is distinct from jsonb_build_object('Invoices',jsonb_build_array(jsonb_build_object('InvoiceID',target,'Status','AUTHORISED'))) or exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=c.id and e.status in('confirmed','rejected')) then raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;cap:=1;
 elsif p_method='GET' and p_payload_json is null then
  if target is not null and target=any(scope.target_ids) then
   cap:=case when scope.mode='preview' and p_phase='operation' then 1 when scope.mode='apply' then 2 when scope.mode='recovery' and p_phase='verification' then scope.verification_calls else 0 end;
   if p_phase='verification' or scope.mode='recovery' then
    select * into c from public.xero_existing_draft_authorisation_claims where run_id=scope.run_id and target_id=target and actor_id=scope.actor_id and actor_email=scope.actor_email and (scope.claim_id is null or id=scope.claim_id) and not exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=xero_existing_draft_authorisation_claims.id and e.status in('confirmed','rejected')) order by created_at desc limit 1;
    if c.id is null or (scope.mode='apply' and not exists(select 1 from public.xero_existing_draft_authorisation_requests r where r.claim_id=c.id and r.budget_id=scope.budget_id)) then raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;
   end if;
  elsif scope.mode in('preview','apply') and p_phase='operation' then
   if p_resource_path in('/Accounts','/TaxRates') then cap:=1;
   elsif p_resource_path='/Organisations' then cap:=2+case when scope.mode='apply' then cardinality(scope.target_ids) else 0 end;
   elsif p_resource_path~'^/Invoices[?]page=([1-9]|10|11)&pageSize=1000&order=InvoiceID[+]ASC&includeArchived=true&unitdp=4&summaryOnly=false$'
    or p_resource_path~'^/Contacts[?]includeArchived=true&order=ContactID[+]ASC&page=[1-4]&pageSize=1000$'
    or p_resource_path~'^/CreditNotes[?]page=[1-6]&pageSize=1000&order=CreditNoteID[+]ASC&includeArchived=true&unitdp=4$' then cap:=1;
   end if;
  end if;
 else raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;
 if coalesce(cap,0)<1 or (select count(*) from public.xero_existing_draft_quota_requests_v1 q where q.budget_id=p_budget_id and q.resource_path=p_resource_path and q.method=p_method and q.phase=p_phase)>=cap then raise exception 'XERO_DRAFT_QUOTA_REQUEST_INVALID' using errcode='42501';end if;
 if floor=0 and scope.mode in('preview','apply') and not(p_method='GET' and p_phase='verification' and c.id is not null)
  and not exists(select 1 from public.xero_existing_draft_quota_grants_v1 g where g.id=scope.grant_id and g.expires_at>clock_timestamp()) then raise exception 'XERO_DRAFT_QUOTA_GRANT_EXPIRED' using errcode='42501';end if;
 insert into public.xero_shared_tenant_control(tenant_id) values(p_tenant_id) on conflict do nothing;select * into s from public.xero_shared_tenant_control where tenant_id=p_tenant_id for update;
 update public.xero_shared_requests set state='unknown',outcome_unknown=(method<>'GET'),completed_at=clock_timestamp() where tenant_id=p_tenant_id and state='inflight' and deadline_at<=clock_timestamp();
 if (select count(*) from public.xero_shared_requests where tenant_id=p_tenant_id and state='inflight')>=2 or exists(select 1 from public.xero_shared_requests where tenant_id=p_tenant_id and state='inflight' and probe_id is not null) then raise exception 'XERO_INFLIGHT_LIMIT' using errcode='55000';end if;
 if (select count(*) from public.xero_shared_requests where tenant_id=p_tenant_id and admitted_at>clock_timestamp()-interval '60 seconds')>=45 then raise exception 'XERO_MINUTE_LIMIT' using errcode='55000';end if;
 if s.retry_at>clock_timestamp() then raise exception 'XERO_RETRY_DEADLINE' using errcode='55000';end if;
 if s.allowance_known is distinct from true or s.daily_hold then raise exception 'XERO_ALLOWANCE_UNKNOWN' using errcode='55000';end if;
 if p_method<>'GET' and exists(select 1 from public.xero_shared_requests where tenant_id=p_tenant_id and outcome_unknown) then raise exception 'XERO_WRITE_OUTCOME_UNRESOLVED' using errcode='55000';end if;
 select * into b from public.xero_shared_budgets where id=p_budget_id and tenant_id=p_tenant_id and state='active' and expires_at>clock_timestamp() for update;
 if b.id is null or scope.created_at+make_interval(secs=>scope.ttl_seconds)<=clock_timestamp() or (p_phase='operation' and b.operation_remaining<1) or (p_phase='verification' and b.verification_remaining<1) then raise exception 'XERO_BUDGET_EXHAUSTED' using errcode='55000';end if;
 if p_method<>'GET' and b.verification_remaining<1 then raise exception 'XERO_VERIFICATION_BUDGET_REQUIRED' using errcode='55000';end if;
 select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=p_tenant_id and state='active' and expires_at>clock_timestamp();
 if coalesce(s.available_calls,0)-floor<reserved then raise exception 'XERO_RESERVE_PROTECTED' using errcode='55000';end if;
 insert into public.xero_existing_draft_quota_requests_v1(request_id,budget_id,resource_path,method,phase,payload_json,claim_id) values(p_id,p_budget_id,p_resource_path,p_method,p_phase,p_payload_json,c.id);
 update public.xero_shared_budgets set operation_remaining=operation_remaining-case when p_phase='operation' then 1 else 0 end,verification_remaining=verification_remaining-case when p_phase='verification' then 1 else 0 end where id=p_budget_id;
 update public.xero_shared_tenant_control set available_calls=greatest(0,available_calls-1),revision=revision+1,updated_at=clock_timestamp() where tenant_id=p_tenant_id;
 insert into public.xero_shared_requests(id,tenant_id,token_version,method,resource_key,budget_id,phase,probe_id,deadline_at) values(p_id,p_tenant_id,p_token_version,p_method,p_resource_key,p_budget_id,p_phase,null,clock_timestamp()+interval '120 seconds');
 return jsonb_build_object('requestId',p_id,'tenantId',p_tenant_id,'deadlineAt',clock_timestamp()+interval '120 seconds');
end $$;

-- Replace only the old budget predicate; keep the existing business guard intact.
create or replace function public.xero_existing_draft_request_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare c public.xero_existing_draft_authorisation_claims;b public.xero_shared_budgets;s public.xero_shared_tenant_control;r public.xero_shared_requests;
 scope public.xero_existing_draft_quota_scopes_v1;ver integer;reserved integer;floor integer;recovery boolean:=false;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform public.xero_document_correction_lock_v1();select * into c from public.xero_existing_draft_authorisation_claims where id=new.claim_id;
 if c.id is null or c.actor_id is distinct from new.actor_id or c.actor_email is distinct from new.actor_email or exists(select 1 from public.xero_existing_draft_authorisation_events where claim_id=c.id and status in('confirmed','rejected')) then raise exception 'Status request claim/actor changed' using errcode='40001';end if;
 perform public.xero_existing_draft_tenant_lock_v1(c.tenant_id);ver:=public.xero_shared_assert_tenant(c.tenant_id::text);
 select * into b from public.xero_shared_budgets where id=new.budget_id for update;select * into s from public.xero_shared_tenant_control where tenant_id=c.tenant_id::text for update;
 select * into scope from public.xero_existing_draft_quota_scopes_v1 where budget_id=new.budget_id;
 floor:=public.xero_existing_draft_quota_floor_v1(new.budget_id);
 if scope.budget_id is not null then
  perform public.xero_existing_draft_quota_actor_v1(c.tenant_id,c.actor_id,c.actor_email);recovery:=scope.mode='recovery' and scope.claim_id=c.id;
  if scope.run_id is distinct from c.run_id or scope.actor_id is distinct from c.actor_id or scope.actor_email is distinct from c.actor_email or not(c.target_id=any(scope.target_ids)) or scope.mode not in('apply','recovery') or scope.created_at+make_interval(secs=>scope.ttl_seconds)<=clock_timestamp() then raise exception 'XERO_DRAFT_QUOTA_BINDING_INVALID' using errcode='42501';end if;
  if floor=0 and not recovery and not exists(select 1 from public.xero_existing_draft_quota_grants_v1 g where g.id=scope.grant_id and g.expires_at>clock_timestamp()) then raise exception 'XERO_DRAFT_QUOTA_GRANT_EXPIRED' using errcode='42501';end if;
 end if;
 select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=c.tenant_id::text and state='active' and expires_at>clock_timestamp();select * into r from public.xero_shared_requests where id=new.request_id;
 if new.request_id is null or new.token_version is distinct from ver or b.id is null or b.tenant_id is distinct from c.tenant_id::text or b.owner_key is distinct from 'draft-status:'||c.run_id::text or b.state is distinct from 'active' or b.expires_at<=clock_timestamp()
  or b.verification_remaining<1 or b.verification_reserved<1 or (r.id is null and not recovery and b.operation_remaining<1)
  or s.allowance_known is distinct from true or s.daily_hold or s.retry_at>clock_timestamp() or coalesce(s.available_calls,0)-floor<reserved
  or (r.id is not null and (r.tenant_id is distinct from c.tenant_id::text or r.method is distinct from 'POST' or r.resource_key is distinct from 'Invoices' or r.phase is distinct from 'operation' or r.budget_id is distinct from new.budget_id or r.token_version is distinct from new.token_version or r.admitted_at<c.created_at))
  or exists(select 1 from public.xero_shared_requests where method<>'GET' and id<>new.request_id and (state='inflight' or outcome_unknown)) then raise exception 'Exact active reserved status request authority held' using errcode='40001';end if;
 new.resource_path:='/Invoices/'||c.target_id::text||'?unitdp=4';new.payload:=jsonb_build_object('Invoices',jsonb_build_array(jsonb_build_object('InvoiceID',c.target_id,'Status','AUTHORISED')));return new;
end $$;
create function public.xero_existing_draft_quota_claim_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.xero_existing_draft_quota_scopes_v1 s join public.xero_shared_budgets b on b.id=s.budget_id join public.xero_existing_draft_quota_grants_v1 g on g.id=s.grant_id where s.mode='apply' and s.run_id=new.run_id and s.actor_id=new.actor_id and s.actor_email=new.actor_email and new.target_id=any(s.target_ids) and b.state='active' and s.reserve_floor=0 and (g.expires_at<=clock_timestamp() or b.expires_at<=clock_timestamp() or s.created_at+make_interval(secs=>s.ttl_seconds)<=clock_timestamp())) then raise exception 'XERO_DRAFT_QUOTA_GRANT_EXPIRED' using errcode='42501';end if;
 return new;
end $$;
create trigger existing_draft_quota_claim_guard before insert on public.xero_existing_draft_authorisation_claims for each row execute function public.xero_existing_draft_quota_claim_guard_v1();

do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'xero_existing_draft_quota_%' or p.proname='xero_shared_admit_scoped_v1') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
 end loop;
end $$;
grant execute on function public.xero_existing_draft_quota_policy_v1(uuid,uuid,text,uuid[]),public.xero_existing_draft_quota_reserve_v1(uuid,uuid,uuid,text,uuid[],text,uuid,uuid,integer),public.xero_existing_draft_quota_release_v1(uuid,uuid,uuid,text,text),public.xero_shared_admit_scoped_v1(text,uuid,integer,text,text,uuid,text,uuid,text,jsonb),public.xero_existing_draft_quota_floor_v1(uuid),public.xero_existing_draft_quota_actor_v1(uuid,uuid,text) to service_role;
commit;
