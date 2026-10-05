-- Compare confirmed provider/storage amounts as validated cents, matching the
-- existing Group evidence policy for binary serialization tails. Raw source
-- amounts, complete proof hashes, identities, ownership, actor, locks and audit
-- guards remain exact. Invalid sub-cent values and one-cent changes still fail.

create or replace function public.xero_guard_group_payment_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id text; v_proof jsonb; v_old jsonb; v_reviewed jsonb; v_parent text; v_claim public.xero_financial_sync_runs; v_tenant text; v_incoming_key text;
begin
 if tg_table_name='xero_financial_payment_mappings' then
   if tg_op<>'INSERT' then
     v_old:=old.bank_source_evidence;
     if tg_op='UPDATE' and v_old='{}'::jsonb and new.bank_source_evidence<>'{}'::jsonb then
       raise exception 'A legacy mapping cannot be retrofitted with Group source proof' using errcode='40001'; end if;
     if v_old<>'{}'::jsonb then
       if tg_op='DELETE' then raise exception 'Group bank proof mapping cannot be deleted' using errcode='40001'; end if;
       if (to_jsonb(new)-'last_reconciled_at'-'updated_at') is distinct from (to_jsonb(old)-'last_reconciled_at'-'updated_at') then
         raise exception 'Group bank proof mapping is immutable' using errcode='40001'; end if;
     end if;
   end if;
   if tg_op='DELETE' then return old; end if;
   v_id:=left(new.salesforce_payment_id,15); v_proof:=new.bank_source_evidence;
   select * into v_claim from public.xero_financial_sync_runs where mode='payment_apply'
     and control_totals->'paymentPosting'->>'paymentId'=v_id and control_totals->'paymentPosting'->'reviewed' ? 'bankSourceEvidence' limit 1;
   if v_claim.id is not null then
     v_reviewed:=v_claim.control_totals->'paymentPosting'->'reviewed'; v_tenant:=v_claim.control_totals->'paymentPosting'->>'tenantId';
     if v_proof is distinct from v_reviewed->'bankSourceEvidence' or new.source_fingerprint is distinct from v_reviewed->>'sourceFingerprint'
       or new.document_mapping_id::text is distinct from v_reviewed->>'documentMappingId'
       or new.xero_bank_account_id is distinct from v_reviewed->>'bankAccountId' or public.xero_group_bank_cents_v1(to_jsonb(new.amount)) is null
       or public.xero_group_bank_cents_v1(to_jsonb(new.amount)) is distinct from public.xero_group_bank_cents_v1(v_reviewed->'amount')
       or new.currency is distinct from v_reviewed->>'currency' or new.payment_date::text is distinct from v_reviewed->>'paymentDate'
       or new.salesforce_payment_name is distinct from v_reviewed->>'salesforcePaymentName'
       or (nullif(v_reviewed->>'xeroPaymentId','') is not null and new.xero_payment_id is distinct from v_reviewed->>'xeroPaymentId') then
       raise exception 'A durable Group claim requires its exact unstripped mapping proof' using errcode='40001'; end if;
   elsif v_proof<>'{}'::jsonb then raise exception 'Group mapping requires an atomic durable claim' using errcode='40001'; end if;
 else
   if tg_op<>'INSERT' and old.control_totals->'paymentPosting'->'reviewed' ? 'bankSourceEvidence' then
     if tg_op='DELETE' then raise exception 'Group posting barrier cannot be deleted' using errcode='40001'; end if;
     if new.idempotency_key is distinct from old.idempotency_key or new.mode is distinct from old.mode
       or new.source_fingerprint is distinct from old.source_fingerprint
       or new.control_totals->'paymentPosting'->'reviewed' is distinct from old.control_totals->'paymentPosting'->'reviewed'
       or new.control_totals->'paymentPosting'->>'tenantId' is distinct from old.control_totals->'paymentPosting'->>'tenantId'
       or new.control_totals->'paymentPosting'->>'paymentId' is distinct from old.control_totals->'paymentPosting'->>'paymentId' then
       raise exception 'Group posting identity and proof are immutable' using errcode='40001'; end if;
   end if;
   if tg_op='DELETE' then return old; end if;
   if new.mode<>'payment_apply' then return new; end if;
   v_id:=left(new.control_totals->'paymentPosting'->>'paymentId',15);
   v_tenant:=new.control_totals->'paymentPosting'->>'tenantId'; v_incoming_key:=new.idempotency_key;
   v_reviewed:=new.control_totals->'paymentPosting'->'reviewed';
   v_proof:=coalesce(v_reviewed->'bankSourceEvidence','{}'::jsonb);
   if v_reviewed ? 'bankSourceEvidence' then
     perform public.xero_assert_group_payment_row_v1(v_reviewed);
     if v_id is distinct from public.xero_grouped_salesforce_id_v1(v_reviewed->>'salesforcePaymentId')
       or new.source_fingerprint is distinct from v_reviewed->>'sourceFingerprint'
       or new.idempotency_key is distinct from 'payment-post:'||encode(sha256(convert_to('["'||(new.control_totals->'paymentPosting'->>'tenantId')||'","'||v_id||'"]','UTF8')),'hex') then
       raise exception 'Group posting claim independent identities disagree' using errcode='22023'; end if;
   elsif exists(select 1 from public.xero_financial_payment_mappings where left(salesforce_payment_id,15)=v_id and bank_source_evidence<>'{}'::jsonb) then
     raise exception 'Existing Group mapping bars an unproven claim' using errcode='40001';
   end if;
 end if;
 if v_proof<>'{}'::jsonb then
   perform public.xero_validate_group_bank_evidence_v1(v_proof,v_id); v_parent:=v_proof->>'parentId';
   if exists(select 1 from public.xero_financial_payment_mappings where left(salesforce_payment_id,15)=v_parent)
     or exists(select 1 from public.xero_financial_sync_runs where mode='payment_apply'
       and (left(control_totals->'paymentPosting'->>'paymentId',15)=v_parent
         or left(control_totals->'paymentPosting'->'reviewed'->>'salesforcePaymentId',15)=v_parent
         or idempotency_key='payment-post:'||encode(sha256(convert_to('["'||v_tenant||'","'||v_parent||'"]','UTF8')),'hex'))) then
     raise exception 'Group remittance header already has a mapping or posting claim' using errcode='40001'; end if;
 end if;
 if exists(select 1 from public.xero_financial_payment_mappings where bank_source_evidence->>'parentId'=v_id)
   or exists(select 1 from public.xero_financial_sync_runs where mode='payment_apply'
     and (control_totals->'paymentPosting'->'reviewed'->'bankSourceEvidence'->>'parentId'=v_id
       or v_incoming_key='payment-post:'||encode(sha256(convert_to('["'||(control_totals->'paymentPosting'->>'tenantId')||'","'||(control_totals->'paymentPosting'->'reviewed'->'bankSourceEvidence'->>'parentId')||'"]','UTF8')),'hex'))) then
   raise exception 'A Group allocation already reserves this remittance header' using errcode='40001'; end if;
 return new;
end $$;

create or replace function public.link_xero_group_payments_v1(p_tenant_id uuid,p_rows jsonb,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row jsonb; v_key text; v_id text; v_claim public.xero_financial_sync_runs; v_mapping public.xero_financial_payment_mappings;
 v_journal jsonb; v_outcomes jsonb:='[]'; v_inserted uuid; v_reference jsonb; v_state text;
begin
 if p_tenant_id is null or p_actor_id is null or p_tenant_id='00000000-0000-0000-0000-000000000000'::uuid
   or p_actor_id='00000000-0000-0000-0000-000000000000'::uuid or nullif(btrim(p_actor_email),'') is null
   or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 25 then
   raise exception 'Verified tenant, actor and one to 25 Group links required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(192837465,731);
 if (select count(distinct public.xero_grouped_salesforce_id_v1(value->>'salesforcePaymentId')) from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows)
   or (select count(distinct lower(value->>'xeroPaymentId')) from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
   raise exception 'Duplicate Group source or target payment' using errcode='22023'; end if;
 for v_row in select value from jsonb_array_elements(p_rows) order by value->>'salesforcePaymentId' loop
   perform public.xero_assert_group_payment_row_v1(v_row);
   if coalesce(v_row->>'xeroPaymentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_row->>'xeroPaymentId'='00000000-0000-0000-0000-000000000000' then raise exception 'Exact target payment required' using errcode='22023'; end if;
   v_id:=public.xero_grouped_salesforce_id_v1(v_row->>'salesforcePaymentId');
   v_key:='payment-post:'||encode(sha256(convert_to('["'||p_tenant_id::text||'","'||v_id||'"]','UTF8')),'hex');
   v_state:='group_linked'; v_reference:='{}';
   if v_row ? 'retainedReferenceEvidence' then
     if jsonb_typeof(v_row->'retainedReferenceEvidence') is distinct from 'object'
       or octet_length((v_row->'retainedReferenceEvidence')::text)>65536
       or v_row->'retainedReferenceEvidence'->'bankSourceEvidence' is distinct from v_row->'bankSourceEvidence'
       or v_row->'retainedReferenceEvidence'->'documentMapping' is distinct from v_row->'documentMappingSnapshot'
       or v_row->'retainedReferenceEvidence'->'bankMapping' is distinct from v_row->'bankMappingSnapshot'
       or coalesce(v_row->>'referenceReviewFingerprint','') !~ '^[0-9a-f]{64}$'
       or v_row->>'referenceReviewFingerprint' is distinct from encode(sha256(convert_to(public.xero_group_bank_canonical_v1(v_row->'retainedReferenceEvidence'),'UTF8')),'hex') then raise exception 'Complete bounded Group reference evidence required' using errcode='22023'; end if;
     v_state:='reference_linked';
     v_reference:=jsonb_build_object('version',1,'tenantId',p_tenant_id::text,'sourceFingerprint',v_row->>'sourceFingerprint',
       'referenceReviewFingerprint',v_row->>'referenceReviewFingerprint','evidence',v_row->'retainedReferenceEvidence');
   end if;
   v_journal:=jsonb_build_object('state',v_state,'tenantId',p_tenant_id::text,'paymentId',v_id,'reviewed',v_row,
     'confirmedPaymentId',v_row->>'xeroPaymentId','observedPaymentIds',jsonb_build_array(v_row->>'xeroPaymentId'));
   if v_state='reference_linked' then v_journal:=v_journal||jsonb_build_object('evidence',v_row->'retainedReferenceEvidence'); end if;
   v_inserted:=null;
   insert into public.xero_financial_sync_runs(idempotency_key,mode,status,source_fingerprint,control_totals,classification_summary,
     created_by,created_by_email,reviewed_by,reviewed_by_email,reviewed_at,completed_at)
   values(v_key,'payment_apply','completed',v_row->>'sourceFingerprint',jsonb_build_object('paymentPosting',v_journal),
     '{"linked":1,"failed":0,"applied":0}',p_actor_id,lower(btrim(p_actor_email)),p_actor_id,lower(btrim(p_actor_email)),now(),now())
   on conflict(idempotency_key) do nothing returning id into v_inserted;
   select * into v_claim from public.xero_financial_sync_runs where idempotency_key=v_key for update;
   select * into v_mapping from public.xero_financial_payment_mappings
     where left(salesforce_payment_id,15)=v_id or lower(xero_payment_id)=v_row->>'xeroPaymentId' order by id limit 1 for update;
   if v_inserted is null then
     if v_claim.status<>'completed' or v_claim.error_code is not null or v_claim.error_message is not null
       or v_claim.control_totals->'paymentPosting' is distinct from v_journal or v_mapping.id is null
       or left(v_mapping.salesforce_payment_id,15) is distinct from v_id or v_mapping.salesforce_payment_name is distinct from v_row->>'salesforcePaymentName'
       or v_mapping.document_mapping_id::text is distinct from v_row->>'documentMappingId' or v_mapping.xero_payment_id is distinct from v_row->>'xeroPaymentId'
       or v_mapping.xero_bank_account_id is distinct from v_row->>'bankAccountId' or public.xero_group_bank_cents_v1(to_jsonb(v_mapping.amount)) is null
       or public.xero_group_bank_cents_v1(to_jsonb(v_mapping.amount)) is distinct from public.xero_group_bank_cents_v1(v_row->'amount')
       or v_mapping.currency is distinct from v_row->>'currency' or v_mapping.payment_date::text is distinct from v_row->>'paymentDate'
       or v_mapping.source_fingerprint is distinct from v_row->>'sourceFingerprint' or v_mapping.status<>'linked' or v_mapping.exception_reason is not null
       or v_mapping.retained_reference is distinct from v_reference or v_mapping.bank_source_evidence is distinct from v_row->'bankSourceEvidence' then
       raise exception 'Existing Group payment claim or mapping differs' using errcode='40001'; end if;
   else
     if v_mapping.id is not null then raise exception 'Source or target payment is already owned' using errcode='40001'; end if;
     insert into public.xero_financial_payment_mappings(salesforce_payment_id,salesforce_payment_name,document_mapping_id,xero_payment_id,
       xero_bank_account_id,source_fingerprint,amount,currency,payment_date,status,retained_reference,bank_source_evidence)
     values(v_row->>'salesforcePaymentId',v_row->>'salesforcePaymentName',(v_row->>'documentMappingId')::uuid,v_row->>'xeroPaymentId',
       v_row->>'bankAccountId',v_row->>'sourceFingerprint',(v_row->>'amount')::numeric,v_row->>'currency',(v_row->>'paymentDate')::date,
       'linked',v_reference,v_row->'bankSourceEvidence') returning * into v_mapping;
     insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
     values(v_claim.id,case when v_state='reference_linked' then 'payment_reference_linked' else 'group_payment_linked' end,'success',p_actor_id,lower(btrim(p_actor_email)),
       '{"linked":1,"applied":0,"financialWrites":0}',jsonb_build_object('tenantId',p_tenant_id::text,'paymentId',v_id,
         'source',v_row->>'sourceFingerprint','bankSourceEvidence',v_row->'bankSourceEvidence','retainedReference',v_reference,'idempotencyKey',v_key));
   end if;
   v_outcomes:=v_outcomes||jsonb_build_array(jsonb_build_object('salesforcePaymentId',v_row->>'salesforcePaymentId','xeroPaymentId',v_row->>'xeroPaymentId',
     'status','linked','alreadyLinked',v_inserted is null,'mappingId',v_mapping.id,'paymentPostingClaimId',v_claim.id));
 end loop;
 return jsonb_build_object('outcomes',v_outcomes);
end $$;

create or replace function public.finish_xero_group_payment_v1(p_tenant_id uuid,p_claim_id uuid,p_state text,p_message text,p_observed_ids jsonb,p_confirmed jsonb,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_claim public.xero_financial_sync_runs; v_row jsonb; v_journal jsonb; v_payment_id text;
begin
 if p_tenant_id is null or p_actor_id is null or p_actor_id='00000000-0000-0000-0000-000000000000'::uuid
   or nullif(btrim(p_actor_email),'') is null or p_state is null or p_state not in ('confirmed','uncertain') or jsonb_typeof(p_observed_ids) is distinct from 'array' then
   raise exception 'Complete Group posting result and verified actor required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(192837465,731);
 select * into v_claim from public.xero_financial_sync_runs where id=p_claim_id for update;
 v_journal:=v_claim.control_totals->'paymentPosting'; v_row:=v_journal->'reviewed';
 if v_claim.id is null or v_claim.mode<>'payment_apply' or v_journal->>'tenantId' is distinct from p_tenant_id::text
   or not(v_row ? 'bankSourceEvidence') or v_journal->>'state' not in ('intent','uncertain') then
   raise exception 'The exact unresolved Group posting claim is required' using errcode='40001'; end if;
 perform public.xero_assert_group_payment_row_v1(v_row);
 v_journal:=v_journal||jsonb_build_object('state',p_state,'observedPaymentIds',p_observed_ids);
 if p_state='confirmed' then
   v_payment_id:=p_confirmed->>'xero_payment_id';
   if coalesce(v_payment_id,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_payment_id='00000000-0000-0000-0000-000000000000'
     or p_confirmed->>'xero_bank_account_id' is distinct from v_row->>'bankAccountId'
     or p_confirmed->>'currency' is distinct from v_row->>'currency' or p_confirmed->>'payment_date' is distinct from v_row->>'paymentDate'
     or jsonb_typeof(p_confirmed->'amount') is distinct from 'number' or public.xero_group_bank_cents_v1(p_confirmed->'amount') is null
     or public.xero_group_bank_cents_v1(p_confirmed->'amount') is distinct from public.xero_group_bank_cents_v1(v_row->'amount')
     or p_observed_ids is distinct from jsonb_build_array(v_payment_id) then
     raise exception 'Confirmed Group payment differs from the exact reviewed allocation' using errcode='22023'; end if;
   v_journal:=v_journal||jsonb_build_object('confirmedPaymentId',v_payment_id);
   insert into public.xero_financial_payment_mappings(salesforce_payment_id,salesforce_payment_name,document_mapping_id,source_fingerprint,
     xero_payment_id,xero_bank_account_id,amount,currency,payment_date,status,bank_source_evidence)
   values(v_row->>'salesforcePaymentId',v_row->>'salesforcePaymentName',(v_row->>'documentMappingId')::uuid,v_row->>'sourceFingerprint',
     v_payment_id,p_confirmed->>'xero_bank_account_id',(p_confirmed->>'amount')::numeric,p_confirmed->>'currency',(p_confirmed->>'payment_date')::date,
     'applied',v_row->'bankSourceEvidence');
 end if;
 update public.xero_financial_sync_runs set status=case when p_state='confirmed' then 'completed' else 'failed' end,
   control_totals=jsonb_build_object('paymentPosting',v_journal),error_code=case when p_state='confirmed' then null else 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN' end,
   error_message=case when p_state='confirmed' then null else p_message end,completed_at=now(),updated_at=now()
 where id=p_claim_id returning * into v_claim;
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints,error_code)
 values(v_claim.id,'payment_posting',p_state,p_actor_id,lower(btrim(p_actor_email)),'{"payments":1}',
   jsonb_build_object('tenantId',p_tenant_id::text,'paymentId',v_journal->>'paymentId','source',v_row->>'sourceFingerprint',
     'review',v_row->>'reviewFingerprint','idempotencyKey',v_claim.idempotency_key,'paymentPosting',v_journal),v_claim.error_code);
 return jsonb_build_object('claim',to_jsonb(v_claim));
end $$;
