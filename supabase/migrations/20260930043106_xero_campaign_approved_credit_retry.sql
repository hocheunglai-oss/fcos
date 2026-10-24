-- Retry authority is the original immutable approval. Claim held credits directly;
-- never reset their outcomes or replay a confirmed case to make it executable.
alter table public.xero_reconciliation_batches add column retry_authority jsonb;

create function public.xero_campaign_retry_claim_v1(
 p_actor uuid,p_campaign uuid,p_batch uuid,p_revision integer,p_fingerprint text,p_case_ids text[])
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare b public.xero_reconciliation_batches; c public.xero_reconciliation_campaigns;
 original public.xero_reconciliation_batches; current_evidence jsonb; cases jsonb; previous_outcomes jsonb;
begin
 perform public.xero_document_correction_lock_v1();
 select * into b from public.xero_reconciliation_batches where id=p_batch for update;
 select * into c from public.xero_reconciliation_campaigns where id=b.campaign_id for update;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if b.id is null or c.id is distinct from p_campaign or c.owner_id is distinct from p_actor
  or b.category<>'link_only' or b.status<>'completed' or b.revision is distinct from p_revision
  or b.evidence_fingerprint is distinct from p_fingerprint or b.approved_at is null
  or b.approved_by is distinct from p_actor then
  raise exception 'An unchanged completed original approval owned by this operator is required' using errcode='40001'; end if;
 if p_case_ids is null or cardinality(p_case_ids) not between 1 and 25
  or array_ndims(p_case_ids)<>1 or exists(select 1 from unnest(p_case_ids) id where id is null or btrim(id)='')
  or (select count(distinct id) from unnest(p_case_ids) id)<>cardinality(p_case_ids) then
  raise exception 'Choose 1–25 unique exact held credit cases' using errcode='22023'; end if;
 if public.xero_document_correction_active_v1() or exists(select 1 from public.xero_financial_sync_runs where status='processing'
  or(mode='payment_apply' and control_totals->'paymentPosting'->>'state' in ('intent','uncertain')))
  or exists(select 1 from public.xero_shared_requests where method<>'GET' and (state='inflight' or outcome_unknown))
  or exists(select 1 from public.xero_reconciliation_batches where status='running') then
  raise exception 'Another unresolved financial operation must finish first' using errcode='40001'; end if;
 -- Lock and compare every original approved case, including confirmed cases.
 perform 1 from public.xero_reconciliation_cases where campaign_id=c.id and id=any(b.case_ids) for update;
 select jsonb_agg(jsonb_build_object('id',id,'fingerprint',evidence_fingerprint) order by id) into current_evidence
 from public.xero_reconciliation_cases where campaign_id=c.id and id=any(b.case_ids);
 if current_evidence is distinct from b.evidence or jsonb_array_length(current_evidence)<>cardinality(b.case_ids)
  or not exists(select 1 from public.xero_reconciliation_events e where e.campaign_id=c.id and e.batch_id=b.id
   and e.event_type='batch_approved' and e.actor_id=b.approved_by and e.evidence->>'fingerprint'=b.evidence_fingerprint
   and e.evidence->'cases'=b.evidence and e.created_at=b.approved_at) then
  raise exception 'Original approval evidence or immutable authority changed' using errcode='40001'; end if;
 select jsonb_agg(x.evidence||jsonb_build_object('status',x.status,'evidenceFingerprint',x.evidence_fingerprint) order by x.id),jsonb_agg(jsonb_build_object('caseId',x.id,'status',x.status,
  'evidenceFingerprint',x.evidence_fingerprint,'outcome',x.outcome) order by x.id) into cases,previous_outcomes
 from public.xero_reconciliation_cases x where x.campaign_id=c.id and x.id=any(p_case_ids) and x.id=any(b.case_ids)
  and x.category='link_only' and x.status in ('needs_decision','waiting_dependency')
  and x.evidence->>'sourceObject' in ('Invoice__c','Supplier_Invoice__c')
  and split_part(x.evidence->>'sampleKey',':',2) in ('ACCRECCREDIT','ACCPAYCREDIT')
  and coalesce(x.evidence->>'xeroCollection','CreditNotes')='CreditNotes';
 if coalesce(jsonb_array_length(cases),0)<>cardinality(p_case_ids) then
  raise exception 'Selected cases must remain unchanged approved held CreditNotes; confirmed cases cannot replay' using errcode='40001'; end if;
 original:=b;
 update public.xero_reconciliation_batches set status='running',claim_id=gen_random_uuid(),claim_case_ids=p_case_ids,
  revision=revision+1,updated_at=now() where id=b.id returning * into b;
 update public.xero_reconciliation_batches set retry_authority=jsonb_build_object(
  'category','link_only','claimId',b.claim_id,'caseIds',p_case_ids,'fingerprint',original.evidence_fingerprint,
  'cases',(select jsonb_agg(e order by e->>'id') from jsonb_array_elements(original.evidence) e where e->>'id'=any(p_case_ids)),
  'approvedBy',original.approved_by,'approvedAt',original.approved_at) where id=b.id returning * into b;
 insert into public.xero_reconciliation_events(campaign_id,batch_id,actor_id,event_type,evidence)
 values(c.id,b.id,p_actor,'batch_retry_claimed',jsonb_build_object(
  'claimId',b.claim_id,'caseIds',p_case_ids,'revision',b.revision,'previousRevision',original.revision,
  'previousClaimId',original.claim_id,'previousOutcomes',previous_outcomes,'previousVerifiedCount',original.verified_count,
  'approvedBy',original.approved_by,'approvedAt',original.approved_at,'fingerprint',original.evidence_fingerprint,'cases',original.evidence));
 return jsonb_build_object('batch',to_jsonb(b),'cases',cases,'recovering',false);
end $$;
revoke all on function public.xero_campaign_retry_claim_v1(uuid,uuid,uuid,integer,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.xero_campaign_retry_claim_v1(uuid,uuid,uuid,integer,text,text[]) to service_role;

-- Running retries recover the persisted exact claim and held case status.
create or replace function public.xero_campaign_claim_v1(p_actor uuid,p_batch uuid,p_revision integer)
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
  if b.retry_authority is not null and (c.owner_id is distinct from p_actor or b.approved_by is distinct from p_actor) then
   raise exception 'Current original approval owner required for retry recovery' using errcode='42501'; end if;
  select jsonb_agg(case when b.retry_authority->>'claimId'=b.claim_id::text then
   evidence||jsonb_build_object('status',status,'evidenceFingerprint',evidence_fingerprint) else evidence end) into cases from public.xero_reconciliation_cases where campaign_id=c.id and id=any(b.claim_case_ids);
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
