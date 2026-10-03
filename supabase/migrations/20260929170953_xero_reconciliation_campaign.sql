-- A fixed, service-only reconciliation backlog. Approvals are exact evidence
-- snapshots; local links never edit Xero accounting records.
create table public.xero_reconciliation_campaigns (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 run_id uuid not null unique references public.xero_financial_sync_runs(id),
 review_run_id uuid references public.xero_financial_sync_runs(id),
 baseline_at timestamptz not null, inventory jsonb, revision integer not null default 1,
 status text not null default 'open' check(status in ('open','completed')),
 owner_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.xero_reconciliation_cases (
 campaign_id uuid not null references public.xero_reconciliation_campaigns(id), id text not null, case_key text not null,
 category text not null check(category in ('link_only','contact','draft','decision','correction_deferred','legacy_excluded','future_activity')),
 status text not null check(status in ('ready','needs_decision','waiting_dependency','reconciled','legacy_excluded','future_activity')),
 evidence jsonb not null, evidence_fingerprint text not null check(evidence_fingerprint ~ '^[0-9a-f]{64}$'),
 outcome jsonb, updated_at timestamptz not null default now(), primary key(campaign_id,id), unique(campaign_id,case_key)
);
create table public.xero_reconciliation_batches (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.xero_reconciliation_campaigns(id),
 category text not null check(category in ('link_only','contact','draft')), case_ids text[] not null,
 evidence_fingerprint text not null, revision integer not null default 1,
 status text not null default 'preview' check(status in ('preview','approved','running','partial','completed')),
 forecast jsonb not null, evidence jsonb not null,
 approved_by uuid, approved_at timestamptz, claim_id uuid, claim_case_ids text[],
 verified_count integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index xero_reconciliation_one_running on public.xero_reconciliation_batches((true)) where status='running';
create table public.xero_reconciliation_events (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.xero_reconciliation_campaigns(id),
 batch_id uuid references public.xero_reconciliation_batches(id), actor_id uuid not null,
 event_type text not null, evidence jsonb not null, created_at timestamptz not null default now()
);
alter table public.xero_reconciliation_campaigns enable row level security;
alter table public.xero_reconciliation_cases enable row level security;
alter table public.xero_reconciliation_batches enable row level security;
alter table public.xero_reconciliation_events enable row level security;
revoke all on public.xero_reconciliation_campaigns,public.xero_reconciliation_cases,public.xero_reconciliation_batches,public.xero_reconciliation_events from public,anon,authenticated,service_role;
grant select on public.xero_reconciliation_campaigns,public.xero_reconciliation_cases,public.xero_reconciliation_batches,public.xero_reconciliation_events to service_role;

create function public.xero_campaign_actor_v1(p_actor uuid,p_tenant uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.fcos_has_access(p_actor,'xero_portal'),false)
  or not coalesce(public.fcos_has_access(p_actor,'xero_portal_manage'),false) then
  raise exception 'Current Xero management access required' using errcode='42501'; end if;
 -- Keep the checked tenant stable through every checked campaign transaction.
 -- Reconnection uses a row update and must wait until claim/finish commits.
 perform 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=p_tenant::text for share;
 if not found then
  raise exception 'Reconciliation tenant changed' using errcode='40001'; end if;
end $$;

create function public.xero_campaign_create_v1(p_actor uuid,p_tenant uuid,p_run uuid,p_run_revision integer,p_cases jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.xero_financial_sync_runs; c public.xero_reconciliation_campaigns; item jsonb; snapshot jsonb;
begin
 perform public.xero_campaign_actor_v1(p_actor,p_tenant);
 select * into r from public.xero_financial_sync_runs where id=p_run for update;
 snapshot:=r.control_totals->'workflowSnapshot';
 if r.id is null or r.revision<>p_run_revision or r.mode<>'preview' or r.status<>'ready_for_review'
  or snapshot->>'complete' is distinct from 'true' or snapshot->>'linkFirst' is distinct from 'true'
  or snapshot->>'includePayments' is distinct from 'true' or snapshot->>'tenantId' is distinct from p_tenant::text
  or jsonb_typeof(p_cases) is distinct from 'array'
  or (snapshot->>'expectedItemCount')::integer is distinct from (select count(*)::integer from public.xero_financial_sync_items where run_id=p_run)
  or jsonb_typeof(snapshot->'payments'->'rows') is distinct from 'array'
  or snapshot->'payments'->>'tenantId' is distinct from p_tenant::text
  or jsonb_array_length(p_cases) is distinct from ((snapshot->>'expectedItemCount')::integer+jsonb_array_length(snapshot->'payments'->'rows')+jsonb_array_length(coalesce(snapshot->'contactCases','[]'::jsonb)))
  then raise exception 'A complete unchanged link-first preview is required' using errcode='40001'; end if;
 select * into c from public.xero_reconciliation_campaigns where run_id=p_run;
 if c.id is not null then return to_jsonb(c); end if;
 insert into public.xero_reconciliation_campaigns(tenant_id,run_id,review_run_id,baseline_at,owner_id,inventory)values(p_tenant,p_run,p_run,r.created_at,p_actor,snapshot->'inventory') returning * into c;
 for item in select value from jsonb_array_elements(p_cases) loop
  if item->>'caseKey' not like p_tenant::text||':%' or item->>'id' is distinct from item->>'caseKey'
   or item->>'ownerId' is distinct from p_actor::text then raise exception 'Invalid campaign case ownership' using errcode='22023'; end if;
  if item->>'caseKey' is distinct from p_tenant::text||':'||(item->>'sourceObject')||':'||(item->>'sourceId')
   or (item->>'sourceObject'='Payment__c' and not exists(select 1 from jsonb_array_elements(snapshot->'payments'->'rows') p where p->>'salesforcePaymentId'=item->>'sourceId'))
   or (item->>'sourceObject'='Account' and not exists(select 1 from jsonb_array_elements(coalesce(snapshot->'contactCases','[]'::jsonb)) x where x=item))
   or (item->>'sourceObject' not in ('Payment__c','Account') and not exists(select 1 from public.xero_financial_sync_items i where i.run_id=p_run and i.source_object=item->>'sourceObject' and i.source_id=item->>'sourceId'))
   then raise exception 'Campaign cases must cover the saved source identities' using errcode='22023'; end if;
  insert into public.xero_reconciliation_cases(campaign_id,id,case_key,category,status,evidence,evidence_fingerprint)
   values(c.id,item->>'id',item->>'caseKey',item->>'category',item->>'status',item,item->>'evidenceFingerprint');
 end loop;
 insert into public.xero_reconciliation_events(campaign_id,actor_id,event_type,evidence)
 values(c.id,p_actor,'baseline_captured',jsonb_build_object('runId',p_run,'caseCount',jsonb_array_length(p_cases),'baselineAt',c.baseline_at));
 return to_jsonb(c);
end $$;

-- Refresh current evidence while retaining the fixed baseline and all outcomes.
create function public.xero_campaign_refresh_v1(p_actor uuid,p_campaign uuid,p_revision integer,p_run uuid,p_run_revision integer,p_cases jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.xero_reconciliation_campaigns; r public.xero_financial_sync_runs; snapshot jsonb; item jsonb; k public.xero_reconciliation_cases; n integer;
begin
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_reconciliation_campaigns where id=p_campaign for update;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if c.id is null or c.owner_id is distinct from p_actor or c.revision is distinct from p_revision
  or exists(select 1 from public.xero_reconciliation_batches where status='running') then raise exception 'Campaign changed or an operation is awaiting verification' using errcode='40001'; end if;
 select * into r from public.xero_financial_sync_runs where id=p_run for share;
 snapshot:=r.control_totals->'workflowSnapshot';
 if r.id is null or r.revision is distinct from p_run_revision or r.mode<>'preview' or r.status<>'ready_for_review'
  or snapshot->>'complete' is distinct from 'true' or snapshot->>'linkFirst' is distinct from 'true'
  or snapshot->>'includePayments' is distinct from 'true' or snapshot->>'tenantId' is distinct from c.tenant_id::text
  or jsonb_typeof(p_cases) is distinct from 'array' or jsonb_typeof(snapshot->'payments'->'rows') is distinct from 'array'
  or (snapshot->>'expectedItemCount')::integer is distinct from (select count(*)::integer from public.xero_financial_sync_items where run_id=p_run)
  or jsonb_array_length(p_cases) is distinct from ((snapshot->>'expectedItemCount')::integer+jsonb_array_length(snapshot->'payments'->'rows')+jsonb_array_length(coalesce(snapshot->'contactCases','[]'::jsonb)))
  or (select count(distinct value->>'caseKey') from jsonb_array_elements(p_cases)) is distinct from jsonb_array_length(p_cases)
 then raise exception 'Complete current link-first evidence is required' using errcode='40001'; end if;
 for item in select value from jsonb_array_elements(p_cases) loop
  if item->>'id' is distinct from item->>'caseKey' or item->>'ownerId' is distinct from p_actor::text
   or item->>'caseKey' is distinct from c.tenant_id::text||':'||(item->>'sourceObject')||':'||(item->>'sourceId')
   or (item->>'sourceObject'='Payment__c' and not exists(select 1 from jsonb_array_elements(snapshot->'payments'->'rows') x where x->>'salesforcePaymentId'=item->>'sourceId'))
   or (item->>'sourceObject'='Account' and not exists(select 1 from jsonb_array_elements(coalesce(snapshot->'contactCases','[]'::jsonb)) x where x=item))
   or (item->>'sourceObject' not in ('Payment__c','Account') and not exists(select 1 from public.xero_financial_sync_items x where x.run_id=p_run and x.source_object=item->>'sourceObject' and x.source_id=item->>'sourceId'))
  then raise exception 'Fresh cases must match exact saved source identities' using errcode='22023'; end if;
  select * into k from public.xero_reconciliation_cases where campaign_id=c.id and id=item->>'id' for update;
  if k.id is null then
   item:=item||jsonb_build_object('category','future_activity','status','future_activity','reason','New activity after the fixed baseline; review separately.','baselineAt',c.baseline_at);
   insert into public.xero_reconciliation_cases(campaign_id,id,case_key,category,status,evidence,evidence_fingerprint)
   values(c.id,item->>'id',item->>'caseKey','future_activity','future_activity',item,item->>'evidenceFingerprint');
  else
   -- Preserve a verified Contact operation when the refreshed complete snapshot
   -- no longer requires a Contact case. Other refreshed facts remain reviewable.
   item:=item||jsonb_build_object('baselineAt',c.baseline_at);
   if k.status='future_activity' then item:=item||jsonb_build_object('category','future_activity','status','future_activity'); end if;
   if k.evidence_fingerprint is distinct from item->>'evidenceFingerprint' or k.status is distinct from item->>'status' then
    insert into public.xero_reconciliation_events(campaign_id,actor_id,event_type,evidence)values(c.id,p_actor,'case_evidence_refreshed',
     jsonb_build_object('caseId',k.id,'previousEvidence',k.evidence,'previousStatus',k.status,'previousOutcome',k.outcome,'newEvidence',item));
   end if;
   update public.xero_reconciliation_cases set category=item->>'category',status=item->>'status',evidence=item,evidence_fingerprint=item->>'evidenceFingerprint',
    outcome=case when k.evidence_fingerprint=item->>'evidenceFingerprint' and k.status=item->>'status' then k.outcome else null end,
    updated_at=now() where campaign_id=c.id and id=k.id;
  end if;
 end loop;
 for k in select * from public.xero_reconciliation_cases x where x.campaign_id=c.id and x.status<>'future_activity'
   and not exists(select 1 from jsonb_array_elements(p_cases) i where i->>'id'=x.id) loop
  if k.evidence->>'sourceObject'='Account' and k.status='reconciled' then continue; end if;
  insert into public.xero_reconciliation_events(campaign_id,actor_id,event_type,evidence)values(c.id,p_actor,'case_missing_from_refresh',jsonb_build_object('caseId',k.id,'previousEvidence',k.evidence,'previousOutcome',k.outcome));
  update public.xero_reconciliation_cases set status='needs_decision',outcome=jsonb_build_object('reason','This baseline source is absent from the complete current check. Review its source removal or scope change.'),updated_at=now() where campaign_id=c.id and id=k.id;
 end loop;
 update public.xero_reconciliation_campaigns set review_run_id=r.id,inventory=snapshot->'inventory',revision=revision+1,status='open',updated_at=now() where id=c.id returning * into c;
 select count(*) into n from public.xero_reconciliation_cases where campaign_id=c.id and status='future_activity';
 insert into public.xero_reconciliation_events(campaign_id,actor_id,event_type,evidence)values(c.id,p_actor,'campaign_evidence_refreshed',jsonb_build_object('baselineRunId',c.run_id,'reviewRunId',r.id,'futureActivity',n,'revision',c.revision));
 return to_jsonb(c);
end $$;

create function public.xero_campaign_inventory_v1(p_actor uuid,p_campaign uuid,p_claim uuid,p_inventory jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.xero_reconciliation_campaigns;
begin
 select * into c from public.xero_reconciliation_campaigns where id=p_campaign for update;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if not exists(select 1 from public.xero_reconciliation_batches where campaign_id=c.id and claim_id=p_claim and status='running')
  or p_inventory->>'tenantId' is distinct from c.tenant_id::text or p_inventory->>'complete' is distinct from 'true'
  or jsonb_typeof(p_inventory->'documents') is distinct from 'array' or jsonb_typeof(p_inventory->'contacts') is distinct from 'array'
  or p_inventory->>'observedSince' is null then raise exception 'A complete verified inventory and current claim are required' using errcode='40001'; end if;
 perform (p_inventory->>'observedSince')::timestamptz;
 update public.xero_reconciliation_campaigns set inventory=p_inventory,updated_at=now() where id=c.id;
 insert into public.xero_reconciliation_events(campaign_id,actor_id,event_type,evidence)values(c.id,p_actor,'inventory_refreshed',
  jsonb_build_object('claimId',p_claim,'observedSince',p_inventory->>'observedSince','calls',p_inventory->'callCount',
   'fingerprint',encode(sha256(convert_to(p_inventory::text,'UTF8')),'hex')));
 return jsonb_build_object('complete',true,'observedSince',p_inventory->>'observedSince');
end $$;

create function public.xero_campaign_prepare_v1(p_actor uuid,p_campaign uuid,p_revision integer,p_category text,p_case_ids text[],p_forecast jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.xero_reconciliation_campaigns; b public.xero_reconciliation_batches; e jsonb; n integer;
begin
 select * into c from public.xero_reconciliation_campaigns where id=p_campaign for update;
 if c.id is null then raise exception 'Campaign not found' using errcode='22023'; end if;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if c.revision<>p_revision or c.status<>'open' then raise exception 'Campaign changed; refresh' using errcode='40001'; end if;
 if p_category not in ('link_only','contact','draft') or cardinality(p_case_ids) not between 1 and 5000
  or (select count(distinct id) from unnest(p_case_ids) id)<>cardinality(p_case_ids) then raise exception 'Select exact distinct cases in one category' using errcode='22023'; end if;
 select count(*),jsonb_agg(jsonb_build_object('id',id,'fingerprint',evidence_fingerprint) order by id) into n,e
 from public.xero_reconciliation_cases where campaign_id=c.id and id=any(p_case_ids) and category=p_category and status='ready';
 if n<>cardinality(p_case_ids) then raise exception 'Selected cases are no longer ready' using errcode='40001'; end if;
 insert into public.xero_reconciliation_batches(campaign_id,category,case_ids,evidence_fingerprint,evidence,forecast)
 values(c.id,p_category,p_case_ids,encode(sha256(convert_to(e::text,'UTF8')),'hex'),e,p_forecast) returning * into b;
 insert into public.xero_reconciliation_events(campaign_id,batch_id,actor_id,event_type,evidence)
 values(c.id,b.id,p_actor,'batch_prepared',jsonb_build_object('cases',e,'forecast',p_forecast));
 return to_jsonb(b);
end $$;

create function public.xero_campaign_approve_v1(p_actor uuid,p_batch uuid,p_revision integer,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.xero_reconciliation_batches; c public.xero_reconciliation_campaigns; e jsonb;
begin
 select * into b from public.xero_reconciliation_batches where id=p_batch for update;
 select * into c from public.xero_reconciliation_campaigns where id=b.campaign_id;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if b.id is null or b.status<>'preview' or b.revision<>p_revision or b.evidence_fingerprint is distinct from p_fingerprint then
  raise exception 'Approval revision or fingerprint changed' using errcode='40001'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'fingerprint',evidence_fingerprint) order by id) into e
 from public.xero_reconciliation_cases where campaign_id=c.id and id=any(b.case_ids) and status='ready' and category=b.category;
 if e is distinct from b.evidence then raise exception 'Approval evidence changed' using errcode='40001'; end if;
 update public.xero_reconciliation_batches set status='approved',approved_by=p_actor,approved_at=now(),revision=revision+1,updated_at=now() where id=b.id returning * into b;
 insert into public.xero_reconciliation_events(campaign_id,batch_id,actor_id,event_type,evidence)
 values(c.id,b.id,p_actor,'batch_approved',jsonb_build_object('fingerprint',p_fingerprint,'cases',e,'revision',b.revision));
 return to_jsonb(b);
end $$;

create function public.xero_campaign_claim_v1(p_actor uuid,p_batch uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.xero_reconciliation_batches; c public.xero_reconciliation_campaigns; ids text[]; cases jsonb; capacity integer;
begin
 perform public.xero_document_correction_lock_v1();
 select * into b from public.xero_reconciliation_batches where id=p_batch for update;
 select * into c from public.xero_reconciliation_campaigns where id=b.campaign_id;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if b.id is null or b.revision<>p_revision or b.status not in ('approved','partial','running') or b.approved_at is null then
  raise exception 'An unchanged approved batch is required' using errcode='40001'; end if;
 if b.status='running' then
  select jsonb_agg(evidence) into cases from public.xero_reconciliation_cases where campaign_id=c.id and id=any(b.claim_case_ids);
  return jsonb_build_object('batch',to_jsonb(b),'cases',cases,'recovering',true);
 end if;
 if public.xero_document_correction_active_v1() or exists(select 1 from public.xero_financial_sync_runs where status='processing'
  or(mode='payment_apply' and control_totals->'paymentPosting'->>'state' in ('intent','uncertain')))
  or exists(select 1 from public.xero_shared_requests where method<>'GET' and (state='inflight' or outcome_unknown))
  or exists(select 1 from public.xero_reconciliation_batches where status='running') then
  raise exception 'Another unresolved financial operation must finish first' using errcode='40001'; end if;
 capacity:=case when b.verified_count<least(5,cardinality(b.case_ids)) then least(5,cardinality(b.case_ids))-b.verified_count else 25 end;
 select array_agg(id),jsonb_agg(evidence) into ids,cases from (
  select ranked.id,ranked.evidence from (
   select x.id,x.evidence,row_number() over(partition by coalesce(x.evidence->>'sampleKey',x.evidence->>'sourceObject') order by x.id) sample_rank
   from public.xero_reconciliation_cases x where x.campaign_id=c.id and x.id=any(b.case_ids) and x.status='ready'
    and exists(select 1 from jsonb_array_elements(b.evidence) e where e->>'id'=x.id and e->>'fingerprint'=x.evidence_fingerprint)
  ) ranked order by case when b.verified_count<least(5,cardinality(b.case_ids)) then ranked.sample_rank else 0 end,ranked.id limit capacity) chosen;
 if coalesce(cardinality(ids),0)=0 then raise exception 'No unchanged approved cases remain' using errcode='40001'; end if;
 update public.xero_reconciliation_batches set status='running',claim_id=gen_random_uuid(),claim_case_ids=ids,revision=revision+1,updated_at=now()
 where id=b.id returning * into b;
 insert into public.xero_reconciliation_events(campaign_id,batch_id,actor_id,event_type,evidence)
 values(c.id,b.id,p_actor,'batch_claimed',jsonb_build_object('claimId',b.claim_id,'caseIds',ids,'revision',b.revision));
 return jsonb_build_object('batch',to_jsonb(b),'cases',cases,'recovering',false);
end $$;

-- All previous financial writers share this barrier. The campaign executor
-- commits its local links only inside its own service-only transaction.
create function public.xero_campaign_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.xero_document_correction_lock_v1();
 if tg_table_name='xero_financial_sync_runs' then
  if tg_op<>'DELETE' then
   if new.mode<>'payment_apply' and new.status<>'processing' then return new; end if;
  end if;
 end if;
 if exists(select 1 from public.xero_reconciliation_batches where status='running'
  and claim_id::text is distinct from current_setting('fcos.campaign_claim',true)) then
  raise exception 'A reconciliation batch is awaiting verification' using errcode='40001'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger campaign_document_guard before insert or update or delete on public.xero_financial_document_mappings for each row execute function public.xero_campaign_guard_v1();
create trigger campaign_payment_guard before insert or update or delete on public.xero_financial_payment_mappings for each row execute function public.xero_campaign_guard_v1();
create trigger campaign_run_guard before insert or update or delete on public.xero_financial_sync_runs for each row execute function public.xero_campaign_guard_v1();
create trigger campaign_correction_guard before insert on public.xero_document_field_correction_claims for each row execute function public.xero_campaign_guard_v1();
create trigger campaign_product_guard before insert or update or delete on public.xero_financial_product_mappings for each row execute function public.xero_campaign_guard_v1();
create trigger campaign_bank_guard before insert or update or delete on public.xero_financial_bank_mappings for each row execute function public.xero_campaign_guard_v1();

create function public.xero_campaign_provider_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.method='GET' then return new; end if;
 perform public.xero_document_correction_lock_v1();
 if exists(select 1 from public.xero_reconciliation_batches b where b.status='running' and not exists(
   select 1 from public.xero_shared_budgets q where q.id=new.budget_id
   and q.owner_key='campaign:'||b.campaign_id::text||':'||b.id::text||':'||b.claim_id::text)) then
  raise exception 'A reconciliation batch holds the accounting writer barrier' using errcode='40001'; end if;
 return new;
end $$;
create trigger campaign_provider_guard before insert on public.xero_shared_requests for each row execute function public.xero_campaign_provider_guard_v1();

create function public.xero_campaign_finish_v1(p_actor uuid,p_batch uuid,p_claim uuid,p_outcomes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.xero_reconciliation_batches; c public.xero_reconciliation_campaigns; o jsonb; k public.xero_reconciliation_cases;
 m public.xero_financial_document_mappings; item public.xero_financial_sync_items; mapping jsonb; verified integer:=0;
 pm public.xero_financial_payment_mappings; pay jsonb; receipt jsonb; actor_email text; journal public.xero_financial_audit_events; intent public.xero_financial_audit_events;
 post public.xero_shared_requests;
begin
 perform public.xero_document_correction_lock_v1();
 select * into b from public.xero_reconciliation_batches where id=p_batch for update;
 select * into c from public.xero_reconciliation_campaigns where id=b.campaign_id;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if b.id is null or b.status<>'running' or b.claim_id is distinct from p_claim then raise exception 'Claim changed; read back the outcome' using errcode='40001'; end if;
 if jsonb_typeof(p_outcomes) is distinct from 'array' or jsonb_array_length(p_outcomes)<>cardinality(b.claim_case_ids)
  or (select count(distinct value->>'caseId') from jsonb_array_elements(p_outcomes))<>cardinality(b.claim_case_ids) then
  raise exception 'Every claimed case requires exactly one verified outcome' using errcode='22023'; end if;
 perform set_config('fcos.campaign_claim',p_claim::text,true);
 for o in select value from jsonb_array_elements(p_outcomes) loop
  select * into k from public.xero_reconciliation_cases where campaign_id=c.id and id=o->>'caseId' for update;
  if k.id is null or not(k.id=any(b.claim_case_ids)) or o->>'evidenceFingerprint' is distinct from k.evidence_fingerprint
    or o->>'status' not in ('reconciled','needs_decision','waiting_dependency') then raise exception 'Invalid case outcome' using errcode='22023'; end if;
  if o->>'status'='reconciled' then
   if o->>'verificationFingerprint' !~ '^[0-9a-f]{64}$' or o->>'verificationFingerprint' is null then raise exception 'Verified evidence required' using errcode='22023'; end if;
   if b.category='link_only' and k.evidence->>'sourceObject'<>'Payment__c' then
    select * into item from public.xero_financial_sync_items where run_id=coalesce(c.review_run_id,c.run_id) and source_object=k.evidence->>'sourceObject' and source_id=k.evidence->>'sourceId';
    if item.id is null or item.proposed_action not in ('link','protected_legacy') or item.blockers<>'[]'::jsonb then raise exception 'Document link authority changed' using errcode='40001'; end if;
    mapping:=o->'mapping';
    if mapping->>'salesforce_object' is distinct from item.source_object or mapping->>'salesforce_id' is distinct from item.source_id
     or mapping->>'xero_document_id' is distinct from item.xero_document_id or mapping->>'xero_contact_id' is distinct from item.source_payload->>'contactId'
     or mapping->>'xero_document_type' is distinct from item.source_payload->>'xeroType'
     or mapping->>'source_fingerprint' is distinct from item.source_payload->>'sourceFingerprint'
     or mapping->>'financial_fingerprint' is distinct from item.source_payload->>'financialFingerprint'
     or mapping->>'protected_legacy' is distinct from 'true' then raise exception 'Link proof does not match approved source and target' using errcode='40001'; end if;
    select * into m from public.xero_financial_document_mappings where salesforce_object=item.source_object and salesforce_id=item.source_id for update;
    if m.id is not null then
     if m.xero_document_id is distinct from item.xero_document_id or m.xero_contact_id is distinct from item.source_payload->>'contactId'
      or m.xero_document_type is distinct from item.source_payload->>'xeroType'
      or m.source_fingerprint is distinct from item.source_payload->>'sourceFingerprint'
      or m.financial_fingerprint is distinct from item.source_payload->>'financialFingerprint' then raise exception 'Existing link changed' using errcode='40001'; end if;
     -- Retain original receipts and all mapping fields byte-for-byte.
    else
     if item.source_payload ? 'groupedPreservation' or item.source_payload ? 'issuedSupplierPreservation' then
      raise exception 'Grouped and issued preservation require their original proof transaction' using errcode='40001'; end if;
     insert into public.xero_financial_document_mappings(salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,
       xero_document_id,xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences)
     values(item.source_object,item.source_id,item.source_document_number,item.source_type,mapping->>'xero_document_type',item.xero_document_id,
       mapping->>'xero_document_number',mapping->>'xero_contact_id',mapping->>'xero_status',mapping->>'source_fingerprint',mapping->>'financial_fingerprint',true,mapping->'retained_differences') returning * into m;
    end if;
    o:=o||jsonb_build_object('mappingId',m.id);
    update public.xero_financial_sync_items set status='linked',applied_at=now(),updated_at=now() where id=item.id;
   elsif b.category='link_only' and k.evidence->>'sourceObject'='Payment__c' then
    select p into pay from public.xero_financial_sync_runs r cross join lateral jsonb_array_elements(r.control_totals->'workflowSnapshot'->'payments'->'rows') p
     where r.id=coalesce(c.review_run_id,c.run_id) and p->>'salesforcePaymentId'=k.evidence->>'sourceId';
    if pay is null or pay->>'action' not in ('payment_link','payment_reference_link') or pay->'blockers' is distinct from '[]'::jsonb
     or o->'paymentEvidence'->>'sourceFingerprint' is distinct from pay->>'sourceFingerprint'
     or o->'paymentEvidence'->>'reviewFingerprint' is distinct from pay->>'reviewFingerprint'
     or o->'paymentEvidence'->>'xeroPaymentId' is distinct from pay->>'xeroPaymentId' then
     raise exception 'Payment evidence changed after approval' using errcode='40001'; end if;
    if o ? 'paymentReferenceRow' or o ? 'groupPaymentRow' then
     mapping:=coalesce(o->'paymentReferenceRow',o->'groupPaymentRow');
     if (select jsonb_object_agg(key,value) from jsonb_each(mapping) where key=any(array[
       'salesforcePaymentId','salesforcePaymentName','documentMappingId','xeroPaymentId','bankAccountId','amount','currency','paymentDate','sourceFingerprint']))
      is distinct from (select jsonb_object_agg(key,value) from jsonb_each(pay) where key=any(array[
       'salesforcePaymentId','salesforcePaymentName','documentMappingId','xeroPaymentId','bankAccountId','amount','currency','paymentDate','sourceFingerprint']))
      or (o ? 'paymentReferenceRow' and (mapping->'referenceReviewFingerprint' is distinct from pay->'referenceReviewFingerprint'
        or mapping->'retainedReferenceEvidence' is distinct from pay->'retainedReferenceEvidence'))
      or ((o ? 'groupPaymentRow' or pay ? 'bankSourceEvidence') and (mapping->'bankSourceEvidence' is distinct from pay->'bankSourceEvidence'
        or mapping->'documentMappingSnapshot' is distinct from pay->'documentMappingSnapshot'
        or mapping->'bankMappingSnapshot' is distinct from pay->'bankMappingSnapshot')) then
      raise exception 'Original payment proof must cover the exact approved source, target and financial evidence' using errcode='40001'; end if;
     select email into actor_email from public.user_profiles where id=p_actor;
     if o ? 'paymentReferenceRow' then
      if o->'paymentReferenceRow' ? 'bankSourceEvidence' then
       receipt:=public.link_xero_payment_references_v2(c.tenant_id,jsonb_build_array(o->'paymentReferenceRow'),p_actor,actor_email);
      else receipt:=public.link_xero_payment_references_v1(c.tenant_id,jsonb_build_array(o->'paymentReferenceRow'),p_actor,actor_email); end if;
     else receipt:=public.link_xero_group_payments_v1(c.tenant_id,jsonb_build_array(o->'groupPaymentRow'),p_actor,actor_email); end if;
     if receipt->'outcomes'->0->>'status' is distinct from 'linked' then raise exception 'Original payment receipt not verified' using errcode='40001'; end if;
     o:=o||jsonb_build_object('receiptId',receipt->'outcomes'->0->>'mappingId','originalReceipt',receipt);
    else
     mapping:=o->'paymentMapping';
     if mapping->>'salesforce_payment_id' is distinct from pay->>'salesforcePaymentId'
      or mapping->>'document_mapping_id' is distinct from pay->>'documentMappingId'
      or mapping->>'xero_payment_id' is distinct from pay->>'xeroPaymentId'
      or mapping->>'xero_bank_account_id' is distinct from pay->>'bankAccountId'
      or mapping->>'source_fingerprint' is distinct from pay->>'sourceFingerprint'
      or mapping->>'currency' is distinct from pay->>'currency'
      or (mapping->>'amount')::numeric is distinct from coalesce((pay->'confirmedPayment'->>'amount')::numeric,(pay->>'amount')::numeric)
      or mapping->>'payment_date' is distinct from coalesce(pay->'confirmedPayment'->>'payment_date',pay->>'paymentDate')
      or mapping->>'status' is distinct from 'linked'
      or pay ? 'bankSourceEvidence' or pay->>'action'='payment_reference_link' then
      raise exception 'Payment mapping does not match exact approved evidence' using errcode='40001'; end if;
     select * into m from public.xero_financial_document_mappings where id=(mapping->>'document_mapping_id')::uuid for share;
     if m.id is null or m.xero_document_id is distinct from pay->>'xeroDocumentId'
      or not exists(select 1 from public.xero_financial_bank_mappings where enabled and xero_bank_account_id=mapping->>'xero_bank_account_id') then
      raise exception 'Current document or bank ownership changed' using errcode='40001'; end if;
     select * into pm from public.xero_financial_payment_mappings where left(salesforce_payment_id,15)=left(mapping->>'salesforce_payment_id',15) for update;
     if pm.id is not null then
      if pm.document_mapping_id is distinct from m.id or lower(pm.xero_payment_id) is distinct from lower(mapping->>'xero_payment_id')
       or pm.xero_bank_account_id is distinct from mapping->>'xero_bank_account_id' or pm.source_fingerprint is distinct from mapping->>'source_fingerprint'
       or pm.amount is distinct from (mapping->>'amount')::numeric or pm.currency is distinct from mapping->>'currency' or pm.payment_date is distinct from (mapping->>'payment_date')::date then
       raise exception 'An existing payment link must retain its original financial evidence' using errcode='40001'; end if;
     else
      insert into public.xero_financial_payment_mappings(salesforce_payment_id,salesforce_payment_name,document_mapping_id,xero_payment_id,xero_bank_account_id,
       source_fingerprint,amount,currency,payment_date,status)
      values(mapping->>'salesforce_payment_id',mapping->>'salesforce_payment_name',m.id,mapping->>'xero_payment_id',mapping->>'xero_bank_account_id',
       mapping->>'source_fingerprint',(mapping->>'amount')::numeric,mapping->>'currency',(mapping->>'payment_date')::date,'linked') returning * into pm;
     end if;
     o:=o||jsonb_build_object('receiptId',pm.id);
    end if;
   elsif b.category in ('contact','draft') then
    select * into journal from public.xero_financial_audit_events where id=(o->>'receiptId')::bigint;
    if journal.id is null or journal.actor_id is distinct from p_actor or journal.outcome is distinct from 'verified'
     or journal.event_type is distinct from (case when b.category='contact' then 'campaign_contact_verified' else 'campaign_document_verified' end)
     or journal.fingerprints->>'campaignId' is distinct from c.id::text or journal.fingerprints->>'batchId' is distinct from b.id::text
     or journal.fingerprints->>'claimId' is distinct from p_claim::text or journal.fingerprints->>'caseId' is distinct from k.id
     or journal.fingerprints->>'tenantId' is distinct from c.tenant_id::text
     or journal.fingerprints->>'evidenceFingerprint' is distinct from k.evidence_fingerprint
     or journal.fingerprints->>'verificationFingerprint' is distinct from o->>'verificationFingerprint' then
     raise exception 'Original verified operation journal is required' using errcode='40001'; end if;
    select * into intent from public.xero_financial_audit_events where id=coalesce(journal.fingerprints->>'originalIntentId',journal.fingerprints->>'intentId')::bigint;
    if intent.id is null or intent.actor_id is distinct from p_actor or intent.outcome is distinct from 'intent'
     or intent.event_type is distinct from (case when b.category='contact' then 'campaign_contact_intent' else 'campaign_document_intent' end)
     or intent.fingerprints->>'campaignId' is distinct from c.id::text or intent.fingerprints->>'batchId' is distinct from b.id::text
     or intent.fingerprints->>'claimId' is distinct from p_claim::text or intent.fingerprints->>'caseId' is distinct from k.id
     or intent.fingerprints->>'tenantId' is distinct from c.tenant_id::text
     or intent.fingerprints->>'evidenceFingerprint' is distinct from k.evidence_fingerprint
     or not exists(select 1 from public.xero_shared_requests v join public.xero_shared_budgets q on q.id=v.budget_id
       where v.id=(journal.fingerprints->>'verificationRequestId')::uuid and v.tenant_id=c.tenant_id::text and q.tenant_id=c.tenant_id::text
       and v.method='GET' and v.state='complete' and v.phase='verification' and v.response_status between 200 and 299
       and v.admitted_at>=intent.created_at and v.resource_key=(case when b.category='contact' then 'Contacts' else (select i.source_payload->>'xeroCollection' from public.xero_financial_sync_items i where i.id=(intent.fingerprints->>'itemId')::uuid) end)
       and q.owner_key='campaign:'||c.id::text||':'||b.id::text||':'||p_claim::text) then
     raise exception 'Durable intent and exact claim readback are required' using errcode='40001'; end if;
    -- Admission identity is committed in the intent before provider dispatch.
    -- A verified GET cannot substitute for a missing, rejected or unrelated POST.
    if not coalesce(intent.fingerprints->>'postRequestId' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)
     or not coalesce(intent.fingerprints->>'postBudgetId' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)
     or jsonb_typeof(intent.fingerprints->'postTokenVersion') is distinct from 'number'
     or not coalesce(intent.fingerprints->>'postTokenVersion' ~ '^[1-9][0-9]*$',false)
     or lower(journal.fingerprints->>'postRequestId') is distinct from lower(intent.fingerprints->>'postRequestId') then
     raise exception 'Exact original POST admission is required' using errcode='40001'; end if;
    select r.* into post from public.xero_shared_requests r join public.xero_shared_budgets q on q.id=r.budget_id
     where r.id=(intent.fingerprints->>'postRequestId')::uuid and r.budget_id=(intent.fingerprints->>'postBudgetId')::uuid
      and r.tenant_id=c.tenant_id::text and q.tenant_id=c.tenant_id::text
      and r.token_version::text=intent.fingerprints->>'postTokenVersion' and r.method='POST' and r.phase='operation'
      and r.resource_key=(case when b.category='contact' then 'Contacts' else (select i.source_payload->>'xeroCollection' from public.xero_financial_sync_items i where i.id=(intent.fingerprints->>'itemId')::uuid) end)
      and r.admitted_at>=intent.created_at and q.owner_key='campaign:'||c.id::text||':'||b.id::text||':'||p_claim::text;
    if post.id is null or post.state<>'complete' or post.outcome_unknown
     or not exists(select 1 from public.xero_shared_requests v where v.id=(journal.fingerprints->>'verificationRequestId')::uuid
       and v.admitted_at>post.admitted_at and v.admitted_at>=post.completed_at)
     or not (coalesce(post.response_status between 200 and 299 and post.resolution_request_id is null,false) or exists(
      select 1 from public.xero_shared_requests v join public.xero_shared_budgets q on q.id=v.budget_id
       join public.xero_financial_audit_events j on post.resolution_evidence='xero_financial_audit_events:'||j.id::text
      where v.id=post.resolution_request_id and v.tenant_id=c.tenant_id::text and v.method='GET' and v.state='complete'
       and v.phase='verification' and v.response_status between 200 and 299 and v.resource_key=post.resource_key
       and v.admitted_at>post.admitted_at and v.admitted_at>=post.completed_at and q.tenant_id=c.tenant_id::text
       and q.owner_key='campaign:'||c.id::text||':'||b.id::text||':'||p_claim::text
       and j.actor_id=p_actor and j.outcome='verified' and j.event_type=journal.event_type
       and j.fingerprints->>'campaignId'=c.id::text and j.fingerprints->>'batchId'=b.id::text and j.fingerprints->>'claimId'=p_claim::text
       and j.fingerprints->>'tenantId'=c.tenant_id::text and j.fingerprints->>'caseId'=k.id and j.fingerprints->>'evidenceFingerprint'=k.evidence_fingerprint
       and j.fingerprints->>'verificationFingerprint' ~ '^[0-9a-f]{64}$'
       and coalesce(j.fingerprints->>'originalIntentId',j.fingerprints->>'intentId')=intent.id::text
       and lower(j.fingerprints->>'postRequestId')=post.id::text and j.fingerprints->>'verificationRequestId'=v.id::text
       and (case when b.category='contact' then j.fingerprints->>'xeroContactId' is not distinct from journal.fingerprints->>'xeroContactId'
        else j.fingerprints->>'targetId' is not distinct from journal.fingerprints->>'targetId' end))) then
     raise exception 'Verified original POST receipt is required' using errcode='40001'; end if;
    if b.category='contact' then
     if k.evidence->>'sourceObject' is distinct from 'Account' or intent.fingerprints->'proposal' is distinct from k.evidence->'contactProposal'
      or journal.fingerprints->>'sourceFingerprint' is distinct from k.evidence->'contactEvidence'->>'sourceFingerprint'
      or journal.fingerprints->>'xeroContactId' is distinct from o->>'xeroContactId'
      or journal.fingerprints->'verifiedContact'->>'ContactStatus' is distinct from 'ACTIVE'
      or lower(journal.fingerprints->'verifiedContact'->>'ContactID') is distinct from lower(o->>'xeroContactId')
      or upper(regexp_replace(btrim(journal.fingerprints->'verifiedContact'->>'Name'),'\s+',' ','g')) is distinct from upper(regexp_replace(btrim(k.evidence->'contactProposal'->>'Name'),'\s+',' ','g'))
      or (k.evidence->'contactProposal'->>'action'='restore' and lower(o->>'xeroContactId') is distinct from lower(k.evidence->>'targetId')) then
      raise exception 'Contact proof does not match the approved family operation' using errcode='40001'; end if;
    else
     select * into item from public.xero_financial_sync_items where run_id=coalesce(c.review_run_id,c.run_id) and source_object=k.evidence->>'sourceObject' and source_id=k.evidence->>'sourceId';
     mapping:=o->'mapping';
     if item.id is null or item.proposed_action is distinct from 'create_draft' or item.blockers is distinct from '[]'::jsonb
      or item.xero_document_id is not null or item.source_payload->>'postingMode' is distinct from 'draft'
      or intent.fingerprints->>'itemId' is distinct from item.id::text or intent.fingerprints->'proposedPayload' is distinct from item.proposed_payload
      or journal.fingerprints->'mapping' is distinct from mapping or journal.fingerprints->>'targetId' is distinct from o->>'targetId'
      or mapping->>'salesforce_object' is distinct from item.source_object or mapping->>'salesforce_id' is distinct from item.source_id
      or mapping->>'xero_document_id' is distinct from o->>'targetId' or mapping->>'xero_contact_id' is distinct from item.source_payload->>'contactId'
      or mapping->>'xero_document_type' is distinct from item.source_payload->>'xeroType' or mapping->>'xero_status' is distinct from 'DRAFT'
      or mapping->>'source_fingerprint' is distinct from item.source_payload->>'sourceFingerprint'
      or mapping->>'financial_fingerprint' is distinct from item.source_payload->>'financialFingerprint'
      or mapping->>'protected_legacy' is distinct from 'false' then
      raise exception 'Draft proof differs from exact approved financial authority' using errcode='40001'; end if;
     select * into m from public.xero_financial_document_mappings where salesforce_object=item.source_object and salesforce_id=item.source_id for update;
     if m.id is not null and (m.xero_document_id is distinct from o->>'targetId' or m.source_fingerprint is distinct from mapping->>'source_fingerprint'
       or m.financial_fingerprint is distinct from mapping->>'financial_fingerprint') then raise exception 'An existing document link changed' using errcode='40001'; end if;
     if m.id is null then
      insert into public.xero_financial_document_mappings(salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,
       xero_document_id,xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences)
      values(item.source_object,item.source_id,item.source_document_number,item.source_type,mapping->>'xero_document_type',mapping->>'xero_document_id',
       mapping->>'xero_document_number',mapping->>'xero_contact_id','DRAFT',mapping->>'source_fingerprint',mapping->>'financial_fingerprint',false,mapping->'retained_differences') returning * into m;
     end if;
     update public.xero_financial_sync_items set xero_document_id=m.xero_document_id,xero_document_status='DRAFT',status='created',applied_at=now(),updated_at=now() where id=item.id;
     o:=o||jsonb_build_object('mappingId',m.id);
    end if;
   else raise exception 'A verified original operation receipt is required' using errcode='22023'; end if;
   verified:=verified+1;
  end if;
  update public.xero_reconciliation_cases set status=o->>'status',outcome=o,updated_at=now() where campaign_id=c.id and id=k.id;
  insert into public.xero_reconciliation_events(campaign_id,batch_id,actor_id,event_type,evidence)values(c.id,b.id,p_actor,'case_outcome',o);
 end loop;
 update public.xero_reconciliation_batches set status=case when exists(select 1 from public.xero_reconciliation_cases where campaign_id=c.id and id=any(b.case_ids) and status='ready') then 'partial' else 'completed' end,
  verified_count=verified_count+verified,revision=revision+1,updated_at=now() where id=b.id returning * into b;
 update public.xero_reconciliation_campaigns set revision=revision+1,updated_at=now(),status=case when exists(select 1 from public.xero_reconciliation_cases where campaign_id=c.id and status not in ('reconciled','legacy_excluded','future_activity')) then 'open' else 'completed' end where id=c.id;
 return to_jsonb(b);
end $$;

-- Prevent inherited default grants from exposing tables or mutable audit rows.
create trigger campaign_event_immutable before update or delete on public.xero_reconciliation_events for each row execute function public.xero_document_correction_immutable_v1();
do $$ declare fn regprocedure; begin
 for fn in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'xero_campaign_%_v1' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
