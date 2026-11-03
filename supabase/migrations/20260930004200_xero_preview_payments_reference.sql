-- Add one exact payment reference form to complete staged preview manifests.
-- The reference resolves only to provider.payments in the same immutable v2
-- checkpoint used for inventory. Inline legacy manifests retain their form.
-- No byte cap, capture lifetime, review authority, or provider permission changes.

create or replace function public.xero_preview_build_scope_v2(p_run jsonb,p_committed boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; ref jsonb; c public.xero_financial_preview_checkpoints; scope jsonb;
begin
  s := p_run #> '{control_totals,workflowSnapshot}'; ref := s->'inventoryReference';
  if jsonb_typeof(ref) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(ref)) <> 13
    or ref->'storageVersion' is distinct from '2'::jsonb
    or not coalesce(ref->>'checkpointId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or s ? 'inventory' then raise exception 'XERO_PREVIEW_STAGED_REFERENCE_INVALID' using errcode='22023'; end if;
  select * into c from public.xero_financial_preview_checkpoints where id=(ref->>'checkpointId')::uuid for share;
  if not found then raise exception 'XERO_PREVIEW_STAGED_REFERENCE_INVALID' using errcode='22023'; end if;
  scope := jsonb_build_object('actorId',c.actor_id,'tenantId',c.tenant_id,'salesforceOrgId',c.salesforce_org_id,
    'reconciliationVersion',c.reconciliation_version,'inputOptions',c.input_options,'inputEvidenceHash',c.input_evidence_hash);
  perform public.xero_preview_checkpoint_guard_v1(scope);
  if (ref-'capturedAt') is distinct from (jsonb_build_object('checkpointId',c.id,'revision',case when c.state='published' then c.revision-1 else c.revision end,
      'actorId',c.actor_id,'tenantId',c.tenant_id,'salesforceOrgId',c.salesforce_org_id,
      'reconciliationVersion',c.reconciliation_version,'inputOptions',c.input_options,'inputEvidenceHash',c.input_evidence_hash,
      'payloadHash',c.payload_hash,'storageHash',c.storage_hash,'tokenVersion',c.token_version,'capturedAt',c.captured_at,'storageVersion',2)-'capturedAt')
    or (ref->>'capturedAt')::timestamptz is distinct from c.captured_at
    or p_run->>'created_by' is distinct from c.actor_id::text
    or s->>'tenantId' is distinct from c.tenant_id::text
    or s->>'salesforceOrgId' is distinct from c.salesforce_org_id
    or s->'reconciliationVersion' is distinct from to_jsonb(c.reconciliation_version)
    or s->'linkFirst' is distinct from c.input_options->'linkFirst'
    or s->'includePayments' is distinct from c.input_options->'includePayments'
    or s->'recordExactMatches' is distinct from c.input_options->'recordExactMatches'
    or coalesce(s->'campaignId','null'::jsonb) is distinct from c.input_options->'campaignId'
    or p_run #>> '{control_totals,postingMode}' is distinct from c.input_options->>'postingMode'
    or p_run->>'cutoff_date' is distinct from c.input_options->>'cutoffDate'
    or s->>'previewCheckpointInputEvidenceHash' is distinct from c.input_evidence_hash
    or s->>'previewCheckpointPayloadHash' is distinct from c.payload_hash
    or c.storage_version <> 2
    or c.storage_hash is distinct from public.xero_preview_jsonb_hash_v2(c.payload)
    or c.state not in ('captured','published')
    or (not p_committed and (c.state <> 'captured' or c.expires_at <= clock_timestamp()))
    or (p_committed and c.state='published' and c.published_run_id is distinct from (p_run->>'id')::uuid)
    then raise exception 'XERO_PREVIEW_STAGED_SCOPE_CHANGED' using errcode='40001'; end if;
  -- The only indirect payment form is the exact inventory reference. There is
  -- no caller-selected path, row count, or replacement summary. Append and
  -- finalize use this same scope guard, including on committed UUID retries.
  if (s->'includePayments'='true'::jsonb and (
      (s ? 'paymentsReference' and (s ? 'payments'
        or jsonb_typeof(s->'paymentsReference') is distinct from 'object'
        or s->'paymentsReference' is distinct from ref))
      or (not (s ? 'paymentsReference') and (jsonb_typeof(s->'payments') is distinct from 'object'
        or jsonb_typeof(s #> '{payments,rows}') is distinct from 'array'
        or s #>> '{payments,tenantId}' is distinct from s->>'tenantId'))))
    or (s->'includePayments'='false'::jsonb and
      (s ? 'paymentsReference' or coalesce(s->'payments','null'::jsonb)<>'null'::jsonb)) then
    raise exception 'XERO_PREVIEW_STAGED_PAYMENTS_INVALID' using errcode='22023'; end if;
  if s ? 'paymentsReference' then
    -- A captured state already proves complete, hash-checked immutable chunks.
    -- Extract only bounded leaves / structural types; never assemble payments.
    -- Consumers must verify the full checkpoint payload SHA before using rows.
    if c.payload #> '{summary,complete}' is distinct from 'true'::jsonb
      or c.payload #>> '{summary,tenantId}' is distinct from c.tenant_id::text
      or c.payload #> '{summary,includePayments}' is distinct from 'true'::jsonb
      or public.xero_preview_checkpoint_extract_v2(c.id,c.payload->'manifest',array['complete']) is distinct from 'true'::jsonb
      or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(c.id,c.payload->'manifest',array['provider','payments'])) is distinct from 'object'
      or public.xero_preview_checkpoint_extract_v2(c.id,c.payload->'manifest',array['provider','payments','tenantId']) #>> '{}' is distinct from c.tenant_id::text
      or jsonb_typeof(public.xero_preview_checkpoint_extract_v2(c.id,c.payload->'manifest',array['provider','payments','rows'])) is distinct from 'array' then
      raise exception 'XERO_PREVIEW_STAGED_PAYMENTS_INVALID' using errcode='22023'; end if;
  end if;
end $$;

create or replace function public.begin_xero_financial_preview_v2(p_run jsonb,p_expected_item_count integer,p_review_identity text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r public.xero_financial_sync_runs; b public.xero_financial_preview_builds; s jsonb; payload jsonb; bytes integer;
begin
  if jsonb_typeof(p_run) is distinct from 'object' or octet_length(p_run::text)>8388608
    or p_expected_item_count is null or p_expected_item_count < 0
    or not coalesce(p_review_identity ~ '^[0-9a-f]{64}$',false) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  s := p_run #> '{control_totals,workflowSnapshot}';
  if jsonb_typeof(s) is distinct from 'object' or s->'persistenceVersion' is distinct from '2'::jsonb
    or s->'complete' is distinct from 'true'::jsonb or s->>'reviewIdentity' is distinct from p_review_identity
    or not coalesce(s->>'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or not coalesce(s->>'salesforceOrgId' ~ '^00D[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$',false)
    or not coalesce(s->>'inputEvidenceHash' ~ '^[0-9a-f]{64}$',false)
    or jsonb_typeof(s->'includePayments') is distinct from 'boolean'
    or s->'recordExactMatches' is distinct from 'false'::jsonb
    or not coalesce(s->>'reconciliationVersion' ~ '^[1-9][0-9]*$',false)
    or jsonb_typeof(s->'reconciliationVersion') is distinct from 'number'
    or s->'expectedItemCount' is distinct from to_jsonb(p_expected_item_count)
    or p_run #> '{classification_summary,total}' is distinct from to_jsonb(p_expected_item_count)
    or s ? 'persistencePayloadHash'
    or (s->'includePayments'='true'::jsonb and (
      (s ? 'paymentsReference' and (s ? 'payments'
        or jsonb_typeof(s->'paymentsReference') is distinct from 'object'
        or s->'paymentsReference' is distinct from s->'inventoryReference'))
      or (not (s ? 'paymentsReference') and (jsonb_typeof(s->'payments') is distinct from 'object'
        or jsonb_typeof(s #> '{payments,rows}') is distinct from 'array'
        or s #>> '{payments,tenantId}' is distinct from s->>'tenantId'))))
    or (s->'includePayments'='false'::jsonb and
      (s ? 'paymentsReference' or coalesce(s->'payments','null'::jsonb)<>'null'::jsonb)) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  r := jsonb_populate_record(null::public.xero_financial_sync_runs,p_run);
  if r.id is null or r.idempotency_key is distinct from 'preview:'||r.id::text or r.mode is distinct from 'preview'
    or r.status is distinct from 'building' or r.revision is distinct from 1 or r.cutoff_date is null
    or r.source_snapshot_at is null or r.xero_snapshot_at is null or nullif(r.source_fingerprint,'') is null
    or nullif(r.xero_fingerprint,'') is null or jsonb_typeof(r.control_totals) is distinct from 'object'
    or coalesce(r.control_totals->>'postingMode','') not in ('draft','authorised')
    or jsonb_typeof(r.classification_summary) is distinct from 'object' or jsonb_typeof(r.rate_limit_snapshot) is distinct from 'object'
    or r.created_at is null or r.updated_at is null or r.reviewed_at is not null or r.reviewed_by is not null
    or r.reviewed_by_email is not null or r.completed_at is not null or r.error_code is not null or r.error_message is not null then
    raise exception 'XERO_PREVIEW_STAGED_NONINITIAL' using errcode='22023'; end if;
  payload := to_jsonb(r); bytes := octet_length(payload::text);
  if exists(select 1 from jsonb_object_keys(p_run) key where not payload ? key) then
    raise exception 'XERO_PREVIEW_STAGED_INVALID' using errcode='22023'; end if;
  if bytes>8388608 then raise exception 'XERO_PREVIEW_STAGED_TOO_LARGE' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xero-preview-run:'||r.id::text,0));
  select * into b from public.xero_financial_preview_builds where request_id=r.id for update;
  if found then
    if b.run_storage_hash is distinct from public.xero_preview_jsonb_hash_v2(b.run_payload)
      or b.run_material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(b.run_payload)) then
      raise exception 'XERO_PREVIEW_STAGED_CORRUPT' using errcode='40001'; end if;
    -- A new HTTP resume can regenerate only v1's enumerated metadata. Keep
    -- the first durable payload, and compare independently normalized evidence.
    if b.review_identity is distinct from p_review_identity or b.expected_item_count is distinct from p_expected_item_count
      or b.run_material_hash is distinct from public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(payload)) then
      raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
    perform public.xero_preview_build_scope_v2(payload,b.state='published');
    -- Recovery of a committed UUID must verify persisted material evidence too.
    if b.state='published' then return public.finalize_xero_financial_preview_v2(r.id,p_review_identity); end if;
  else
    if exists(select 1 from public.xero_financial_sync_runs where id=r.id) then
      raise exception 'XERO_PREVIEW_STAGED_UUID_CONFLICT' using errcode='22023'; end if;
    perform public.xero_preview_build_scope_v2(payload,false);
    insert into public.xero_financial_preview_builds(request_id,review_identity,checkpoint_id,run_payload,
      run_storage_hash,run_material_hash,expected_item_count,staged_bytes)
    values(r.id,p_review_identity,(s->'inventoryReference'->>'checkpointId')::uuid,payload,
      public.xero_preview_jsonb_hash_v2(payload),public.xero_preview_jsonb_hash_v2(public.xero_preview_run_material_v2(payload)),
      p_expected_item_count,bytes) returning * into b;
  end if;
  return jsonb_build_object('runId',b.request_id,'state',b.state,'reviewIdentity',b.review_identity,
    'expectedItemCount',b.expected_item_count,'receivedItemCount',b.received_item_count,'reused',false);
end $$;

-- CREATE OR REPLACE preserves the existing ACL; make its narrow contract explicit.
revoke all on function public.xero_preview_build_scope_v2(jsonb,boolean),
  public.begin_xero_financial_preview_v2(jsonb,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_xero_financial_preview_v2(jsonb,integer,text) to service_role;

-- Reconstruct only an individual structurally split payment row when its
-- complete evidence is requested. Never assemble provider.payments or inventory.
create function public.xero_preview_checkpoint_node_value_v2(p_id uuid,p_node jsonb,p_depth integer default 0)
returns jsonb language plpgsql stable set search_path='' as $$
declare chunk public.xero_financial_preview_checkpoint_chunks; result jsonb; entry jsonb; part jsonb;
begin
  if p_depth is null or p_depth<0 or p_depth>64 then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023'; end if;
  if p_node->>'type'='value' then
    select * into chunk from public.xero_financial_preview_checkpoint_chunks
      where checkpoint_id=p_id and ordinal=(p_node->>'ordinal')::integer;
    if not found or chunk.payload_hash is distinct from encode(sha256(convert_to(chunk.payload_text,'UTF8')),'hex') then
      raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
    return chunk.payload_text::jsonb;
  elsif p_node->>'type'='object' then
    result:='{}'::jsonb;
    for entry in select value from jsonb_array_elements(p_node->'entries') loop
      result:=result||jsonb_build_object(entry->>0,public.xero_preview_checkpoint_node_value_v2(p_id,entry->1,p_depth+1));
      if octet_length(result::text)>8388608 then
        raise exception 'XERO_PREVIEW_CHECKPOINT_ROW_TOO_LARGE' using errcode='22023'; end if;
    end loop;
    return result;
  elsif p_node->>'type'='array' then
    result:='[]'::jsonb;
    for entry in select value from jsonb_array_elements(p_node->'entries') loop
      if entry ? 'ordinal' then
        part:=public.xero_preview_checkpoint_node_value_v2(p_id,jsonb_build_object('type','value','ordinal',entry->'ordinal'),p_depth+1);
      else part:=jsonb_build_array(public.xero_preview_checkpoint_node_value_v2(p_id,entry->'node',p_depth+1)); end if;
      result:=result||part;
      if octet_length(result::text)>8388608 then
        raise exception 'XERO_PREVIEW_CHECKPOINT_ROW_TOO_LARGE' using errcode='22023'; end if;
    end loop;
    return result;
  end if;
  raise exception 'XERO_PREVIEW_CHECKPOINT_INVALID' using errcode='22023';
end $$;

-- Identity scans return one small identity per payment. Outcome scans return
-- only matching full rows, keeping all existing payment proof checks intact.
create function public.xero_preview_payment_rows_v2(p_run uuid,p_actor uuid,p_tenant uuid,
  p_source_id text default null,p_identity_only boolean default false)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare r public.xero_financial_sync_runs; c public.xero_financial_preview_checkpoints;
  s jsonb; ref jsonb; scope jsonb; node jsonb; entry jsonb; row jsonb; part jsonb; source_id text;
  path text[]:=array['provider','payments','rows']; depth integer; refs integer[]; chunk record; total integer;
begin
  perform public.xero_campaign_actor_v1(p_actor,p_tenant);
  select * into r from public.xero_financial_sync_runs where id=p_run for share;
  s:=r.control_totals->'workflowSnapshot';
  if r.id is null or s->'includePayments' is distinct from 'true'::jsonb or s->>'tenantId' is distinct from p_tenant::text then
    raise exception 'Complete saved payment evidence is required' using errcode='40001'; end if;
  if not (s ? 'paymentsReference') then
    if jsonb_typeof(s->'payments') is distinct from 'object'
      or jsonb_typeof(s #> '{payments,rows}') is distinct from 'array'
      or s #>> '{payments,tenantId}' is distinct from p_tenant::text then
      raise exception 'Complete saved payment evidence is required' using errcode='40001'; end if;
    for row in select value from jsonb_array_elements(s #> '{payments,rows}') loop
      if p_source_id is null or row->>'salesforcePaymentId'=p_source_id then
        return next case when p_identity_only then jsonb_build_object('salesforcePaymentId',row->'salesforcePaymentId') else row end;
      end if;
    end loop;
    return;
  end if;
  ref:=s->'paymentsReference';
  if r.created_by is distinct from p_actor or s ? 'payments' or ref is distinct from s->'inventoryReference' then
    raise exception 'XERO_PREVIEW_STAGED_PAYMENTS_INVALID' using errcode='40001'; end if;
  perform public.xero_preview_build_scope_v2(to_jsonb(r),true);
  scope:=jsonb_build_object('actorId',ref->'actorId','tenantId',ref->'tenantId','salesforceOrgId',ref->'salesforceOrgId',
    'reconciliationVersion',ref->'reconciliationVersion','inputOptions',ref->'inputOptions','inputEvidenceHash',ref->'inputEvidenceHash');
  c:=public.xero_preview_checkpoint_require_v2((ref->>'checkpointId')::uuid,scope,p_run,false);
  -- Recheck complete part coverage and one bounded digest at a time.
  refs:=public.xero_preview_checkpoint_manifest_refs_v2(c.id,c.payload->'manifest');
  select count(*)::integer into total from public.xero_financial_preview_checkpoint_chunks where checkpoint_id=c.id;
  if total=0 or cardinality(refs)<>total or (select count(distinct x) from unnest(refs) x)<>total then
    raise exception 'XERO_PREVIEW_CHECKPOINT_INCOMPLETE' using errcode='40001'; end if;
  for chunk in select ordinal,payload_hash from public.xero_financial_preview_checkpoint_chunks where checkpoint_id=c.id loop
    if not exists(select 1 from public.xero_financial_preview_checkpoint_chunks x where x.checkpoint_id=c.id and x.ordinal=chunk.ordinal
      and x.payload_hash=encode(sha256(convert_to(x.payload_text,'UTF8')),'hex')) then
      raise exception 'XERO_PREVIEW_CHECKPOINT_CORRUPT' using errcode='40001'; end if;
  end loop;
  node:=c.payload->'manifest';
  for depth in 1..cardinality(path) loop
    if node->>'type'='value' then
      part:=public.xero_preview_checkpoint_node_value_v2(c.id,node) #> path[depth:];
      if jsonb_typeof(part) is distinct from 'array' then
        raise exception 'XERO_PREVIEW_STAGED_PAYMENTS_INVALID' using errcode='40001'; end if;
      for row in select value from jsonb_array_elements(part) loop
        if p_source_id is null or row->>'salesforcePaymentId'=p_source_id then
          return next case when p_identity_only then jsonb_build_object('salesforcePaymentId',row->'salesforcePaymentId') else row end;
        end if;
      end loop;
      return;
    end if;
    select value->1 into node from jsonb_array_elements(node->'entries') where value->>0=path[depth];
  end loop;
  if node->>'type'='value' then
    part:=public.xero_preview_checkpoint_node_value_v2(c.id,node);
    for row in select value from jsonb_array_elements(part) loop
      if p_source_id is null or row->>'salesforcePaymentId'=p_source_id then
        return next case when p_identity_only then jsonb_build_object('salesforcePaymentId',row->'salesforcePaymentId') else row end;
      end if;
    end loop;
  elsif node->>'type'='array' then
    for entry in select value from jsonb_array_elements(node->'entries') loop
      if entry ? 'ordinal' then
        part:=public.xero_preview_checkpoint_node_value_v2(c.id,jsonb_build_object('type','value','ordinal',entry->'ordinal'));
        for row in select value from jsonb_array_elements(part) loop
          if p_source_id is null or row->>'salesforcePaymentId'=p_source_id then
            return next case when p_identity_only then jsonb_build_object('salesforcePaymentId',row->'salesforcePaymentId') else row end;
          end if;
        end loop;
      else
        source_id:=public.xero_preview_checkpoint_extract_v2(c.id,entry->'node',array['salesforcePaymentId']) #>> '{}';
        if p_source_id is null or source_id=p_source_id then
          return next case when p_identity_only then jsonb_build_object('salesforcePaymentId',source_id)
            else public.xero_preview_checkpoint_node_value_v2(c.id,entry->'node') end;
        end if;
      end if;
    end loop;
  else raise exception 'XERO_PREVIEW_STAGED_PAYMENTS_INVALID' using errcode='40001'; end if;
end $$;

revoke all on function public.xero_preview_checkpoint_node_value_v2(uuid,jsonb,integer),
  public.xero_preview_payment_rows_v2(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;

-- Campaign RPCs retain their approval, identity and payment proof controls.
create or replace function public.xero_campaign_create_v1(p_actor uuid,p_tenant uuid,p_run uuid,p_run_revision integer,p_cases jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.xero_financial_sync_runs; c public.xero_reconciliation_campaigns; item jsonb; snapshot jsonb; payment_ids text[]; payment_count integer;
begin
 perform public.xero_campaign_actor_v1(p_actor,p_tenant);
 select * into r from public.xero_financial_sync_runs where id=p_run for update;
 snapshot:=r.control_totals->'workflowSnapshot';
 select array_agg(p->>'salesforcePaymentId'),count(*)::integer into payment_ids,payment_count
  from public.xero_preview_payment_rows_v2(r.id,p_actor,p_tenant,null,true) p;
 if payment_count<>(select count(distinct id) from unnest(payment_ids) id)
   or exists(select 1 from unnest(payment_ids) id where nullif(id,'') is null) then
  raise exception 'Complete unique saved payment identities are required' using errcode='40001'; end if;
 if r.id is null or r.revision<>p_run_revision or r.mode<>'preview' or r.status<>'ready_for_review'
  or snapshot->>'complete' is distinct from 'true' or snapshot->>'linkFirst' is distinct from 'true'
  or snapshot->>'includePayments' is distinct from 'true' or snapshot->>'tenantId' is distinct from p_tenant::text
  or jsonb_typeof(p_cases) is distinct from 'array'
  or (snapshot->>'expectedItemCount')::integer is distinct from (select count(*)::integer from public.xero_financial_sync_items where run_id=p_run)
  or jsonb_array_length(p_cases) is distinct from ((snapshot->>'expectedItemCount')::integer+payment_count+jsonb_array_length(coalesce(snapshot->'contactCases','[]'::jsonb)))
  then raise exception 'A complete unchanged link-first preview is required' using errcode='40001'; end if;
 select * into c from public.xero_reconciliation_campaigns where run_id=p_run;
 if c.id is not null then return to_jsonb(c); end if;
 insert into public.xero_reconciliation_campaigns(tenant_id,run_id,review_run_id,baseline_at,owner_id,inventory)values(p_tenant,p_run,p_run,r.created_at,p_actor,snapshot->'inventory') returning * into c;
 for item in select value from jsonb_array_elements(p_cases) loop
  if item->>'caseKey' not like p_tenant::text||':%' or item->>'id' is distinct from item->>'caseKey'
   or item->>'ownerId' is distinct from p_actor::text then raise exception 'Invalid campaign case ownership' using errcode='22023'; end if;
  if item->>'caseKey' is distinct from p_tenant::text||':'||(item->>'sourceObject')||':'||(item->>'sourceId')
   or (item->>'sourceObject'='Payment__c' and not coalesce(item->>'sourceId'=any(payment_ids),false))
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

create or replace function public.xero_campaign_refresh_v1(p_actor uuid,p_campaign uuid,p_revision integer,p_run uuid,p_run_revision integer,p_cases jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.xero_reconciliation_campaigns; r public.xero_financial_sync_runs; snapshot jsonb; item jsonb; k public.xero_reconciliation_cases; n integer; payment_ids text[]; payment_count integer;
begin
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_reconciliation_campaigns where id=p_campaign for update;
 perform public.xero_campaign_actor_v1(p_actor,c.tenant_id);
 if c.id is null or c.owner_id is distinct from p_actor or c.revision is distinct from p_revision
  or exists(select 1 from public.xero_reconciliation_batches where status='running') then raise exception 'Campaign changed or an operation is awaiting verification' using errcode='40001'; end if;
 select * into r from public.xero_financial_sync_runs where id=p_run for share;
 snapshot:=r.control_totals->'workflowSnapshot';
 select array_agg(p->>'salesforcePaymentId'),count(*)::integer into payment_ids,payment_count
  from public.xero_preview_payment_rows_v2(r.id,p_actor,c.tenant_id,null,true) p;
 if payment_count<>(select count(distinct id) from unnest(payment_ids) id)
   or exists(select 1 from unnest(payment_ids) id where nullif(id,'') is null) then
  raise exception 'Complete unique saved payment identities are required' using errcode='40001'; end if;
 if r.id is null or r.revision is distinct from p_run_revision or r.mode<>'preview' or r.status<>'ready_for_review'
  or snapshot->>'complete' is distinct from 'true' or snapshot->>'linkFirst' is distinct from 'true'
  or snapshot->>'includePayments' is distinct from 'true' or snapshot->>'tenantId' is distinct from c.tenant_id::text
  or jsonb_typeof(p_cases) is distinct from 'array'
  or (snapshot->>'expectedItemCount')::integer is distinct from (select count(*)::integer from public.xero_financial_sync_items where run_id=p_run)
  or jsonb_array_length(p_cases) is distinct from ((snapshot->>'expectedItemCount')::integer+payment_count+jsonb_array_length(coalesce(snapshot->'contactCases','[]'::jsonb)))
  or (select count(distinct value->>'caseKey') from jsonb_array_elements(p_cases)) is distinct from jsonb_array_length(p_cases)
 then raise exception 'Complete current link-first evidence is required' using errcode='40001'; end if;
 for item in select value from jsonb_array_elements(p_cases) loop
  if item->>'id' is distinct from item->>'caseKey' or item->>'ownerId' is distinct from p_actor::text
   or item->>'caseKey' is distinct from c.tenant_id::text||':'||(item->>'sourceObject')||':'||(item->>'sourceId')
   or (item->>'sourceObject'='Payment__c' and not coalesce(item->>'sourceId'=any(payment_ids),false))
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

create or replace function public.xero_campaign_finish_v1(p_actor uuid,p_batch uuid,p_claim uuid,p_outcomes jsonb)
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
    select p into pay from public.xero_preview_payment_rows_v2(coalesce(c.review_run_id,c.run_id),p_actor,c.tenant_id,
      k.evidence->>'sourceId',false) p;
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


revoke all on function public.xero_campaign_create_v1(uuid,uuid,uuid,integer,jsonb),
  public.xero_campaign_refresh_v1(uuid,uuid,integer,uuid,integer,jsonb),
  public.xero_campaign_finish_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.xero_campaign_create_v1(uuid,uuid,uuid,integer,jsonb),
  public.xero_campaign_refresh_v1(uuid,uuid,integer,uuid,integer,jsonb),
  public.xero_campaign_finish_v1(uuid,uuid,uuid,jsonb) to service_role;
