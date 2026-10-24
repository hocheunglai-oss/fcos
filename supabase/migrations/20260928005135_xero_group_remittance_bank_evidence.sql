-- Additive Group bank-source receipts. Existing empty-proof mappings are untouched.
alter table public.xero_financial_payment_mappings
  add column bank_source_evidence jsonb not null default '{}'::jsonb;

create function public.xero_group_bank_canonical_v1(p_value jsonb)
returns text language plpgsql immutable strict security invoker set search_path=public,pg_temp as $$
declare v_text text;
begin
  case jsonb_typeof(p_value)
    when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.xero_group_bank_canonical_v1(value),',' order by key collate "C"),'')||'}' into v_text from jsonb_each(p_value);
    when 'array' then select '['||coalesce(string_agg(public.xero_group_bank_canonical_v1(value),',' order by ord),'')||']' into v_text from jsonb_array_elements(p_value) with ordinality x(value,ord);
    when 'number' then v_text := (p_value#>>'{}')::numeric::text;
      if position('.' in v_text)>0 then v_text := rtrim(rtrim(v_text,'0'),'.'); end if;
    else v_text := p_value::text;
  end case;
  return v_text;
end $$;
create function public.xero_group_bank_hash_v1(p_component text,p_value jsonb)
returns text language sql immutable strict security invoker set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(public.xero_group_bank_canonical_v1(jsonb_build_object(
 'policyVersion','receivable_group_bank_v1','component',p_component,'value',p_value)),'UTF8')),'hex');
$$;
create function public.xero_group_bank_cents_v1(p_value jsonb)
returns numeric language plpgsql immutable strict security invoker set search_path=public,pg_temp as $$
declare v numeric; v_scaled numeric; v_tolerance numeric;
begin
 if jsonb_typeof(p_value) not in ('string','number') or (p_value#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then return null; end if;
 if jsonb_typeof(p_value)='string' and ((p_value#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' or length(p_value#>>'{}')>30) then return null; end if;
 v := (p_value#>>'{}')::numeric; v_scaled:=v*100;
 v_tolerance:=least(0.000001,16*2.220446049250313e-16*greatest(1,abs(v_scaled)));
 if v<=0 or round(v_scaled)>9007199254740991 or abs(v_scaled-round(v_scaled))>v_tolerance then return null; end if;
 return round(v_scaled);
end $$;
create function public.xero_group_bank_text_v1(p_value jsonb,p_nullable boolean default true)
returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$
 select coalesce((p_nullable and p_value='null'::jsonb) or (jsonb_typeof(p_value)='string' and length(p_value#>>'{}')<=1000
 and (p_value#>>'{}') !~ '[[:cntrl:]]'),false);
$$;
create function public.xero_validate_group_bank_evidence_v1(p_proof jsonb,p_source_id text)
returns jsonb language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare
 v_source jsonb; v_parent jsonb; v_child jsonb; v_selected jsonb; v_account jsonb; v_inventory jsonb; v_invoice jsonb;
 v_count integer; v_sum numeric:=0; v_ids jsonb; v_stems text[]:='{}'; v_invoices text[]:='{}'; v_accounts text[]:='{}';
 v_id text; v_bank text; v_cents numeric; v_keys text[];
begin
 if jsonb_typeof(p_proof) is distinct from 'object' or p_proof->>'policyVersion' is distinct from 'receivable_group_bank_v1'
   or p_proof->>'sourceKind' is distinct from 'Receivable_Remittance' or p_proof->>'authority' is distinct from 'salesforce_recorded_bank'
   or octet_length(public.xero_group_bank_canonical_v1(p_proof))>65536
   or (select count(*) from jsonb_object_keys(p_proof))<>18
   or not p_proof ?& array['policyVersion','sourceKind','authority','parentId','groupAccountId','debtorAccountId','selectedPaymentId',
      'bank','date','currency','totalCents','allocationIds','allocationCount','familyFingerprint','membershipFingerprint','invoiceOwnershipFingerprint','source','fingerprint'] then
   raise exception 'Group bank-source proof is missing, oversized or has an unknown policy' using errcode='22023'; end if;
 v_source:=p_proof->'source'; v_parent:=v_source->'parent';
 if jsonb_typeof(v_source) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_source))<>4
   or not v_source ?& array['parent','allocations','accounts','buyerDocumentInventories']
   or jsonb_typeof(v_source->'allocations') is distinct from 'array' or jsonb_typeof(v_source->'accounts') is distinct from 'array'
   or jsonb_typeof(v_source->'buyerDocumentInventories') is distinct from 'array' then
   raise exception 'Complete Group source arrays are required' using errcode='22023'; end if;
 if p_proof->>'familyFingerprint' is distinct from public.xero_group_bank_hash_v1('family',jsonb_build_object('parent',v_parent,'allocations',v_source->'allocations'))
   or p_proof->>'membershipFingerprint' is distinct from public.xero_group_bank_hash_v1('membership',v_source->'accounts')
   or p_proof->>'invoiceOwnershipFingerprint' is distinct from public.xero_group_bank_hash_v1('invoice_ownership',v_source->'buyerDocumentInventories')
   or p_proof->>'fingerprint' is distinct from public.xero_group_bank_hash_v1('evidence',p_proof-'fingerprint') then
   raise exception 'Group proof component fingerprints changed' using errcode='22023'; end if;
 if p_proof->>'selectedPaymentId' is distinct from public.xero_grouped_salesforce_id_v1(p_source_id)
   or p_proof->>'currency' is distinct from 'USD' or p_proof->>'parentId' is distinct from v_parent->>'Id'
   or p_proof->>'groupAccountId' is distinct from v_parent->>'Account__c'
   or p_proof->>'bank' is distinct from v_parent->>'Bank__c' or nullif(btrim(p_proof->>'bank'),'') is null
   or p_proof->>'date' is distinct from v_parent->>'Date__c'
   or v_parent->'RecordType' is distinct from '{"DeveloperName":"Receivable_Remittance"}'::jsonb
   or v_parent->'Remittance__c' is distinct from 'null'::jsonb then
   raise exception 'Group header or selected source binding changed' using errcode='22023'; end if;
 v_bank:=upper(regexp_replace(btrim(p_proof->>'bank'),'\s+',' ','g'));
 v_count:=jsonb_array_length(v_source->'allocations');
 select jsonb_agg(value->'Id' order by value->>'Id' collate "C") into v_ids from jsonb_array_elements(v_source->'allocations');
 if v_count<1 or p_proof->'allocationCount' is distinct from to_jsonb(v_count) or p_proof->'allocationIds' is distinct from v_ids
   or (select count(distinct value->>'Id') from jsonb_array_elements(v_source->'allocations'))<>v_count then
   raise exception 'Group allocation identities are incomplete or duplicated' using errcode='22023'; end if;
 -- Literal required raw facts, including explicit null/false, remain material.
 for v_child in select value from jsonb_array_elements(jsonb_build_array(v_parent)||(v_source->'allocations')) loop
   v_id:=public.xero_grouped_salesforce_id_v1(v_child->>'Id'); v_cents:=public.xero_group_bank_cents_v1(v_child->'Amount__c');
   if v_id is null or v_id !~ '^a0S' or v_child->>'Id' is distinct from v_id
     or public.xero_grouped_salesforce_id_v1(v_child->>'Account__c') is null or v_child->>'Account__c' !~ '^001'
     or not v_child ?& array['Id','IsDeleted','Name','CreatedDate','RecordType','STEM__c','Account__c','Amount__c','Date__c','Supplier_Invoice__c',
       'Reference__c','Bank__c','Remittance__c','Is_Deposit__c','Commission_Invoice__c','Is_Volume_Discount__c','LastModifiedDate','CurrencyIsoCode','_currency']
     or (select count(*) from jsonb_object_keys(v_child))<>19
     or exists(select 1 from unnest(array['Bank__c','Reference__c','CreatedDate','LastModifiedDate']) k where not public.xero_group_bank_text_v1(v_child->k))
     or not public.xero_group_bank_text_v1(v_child->'Name',false)
     or (v_child->'STEM__c' is distinct from 'null'::jsonb and (public.xero_grouped_salesforce_id_v1(v_child->>'STEM__c') is null or v_child->>'STEM__c' !~ '^a0H[A-Za-z0-9]{12}$'))
     or v_child->>'Account__c' !~ '^001[A-Za-z0-9]{12}$'
     or v_child->'IsDeleted' is distinct from 'false'::jsonb or v_child->'Is_Deposit__c' is distinct from 'false'::jsonb
     or v_child->'Is_Volume_Discount__c' is distinct from 'false'::jsonb or v_child->'Supplier_Invoice__c' is distinct from 'null'::jsonb
     or v_child->'Commission_Invoice__c' is distinct from 'null'::jsonb or v_child->'_currency' is distinct from '{"currency":"USD","blockers":[]}'::jsonb
     or (v_child->'CurrencyIsoCode' is distinct from 'null'::jsonb and v_child->'CurrencyIsoCode' is distinct from '"USD"'::jsonb)
     or v_cents is null or nullif(btrim(v_child->>'Name'),'') is null or v_child->>'Date__c' is distinct from p_proof->>'date'
     or coalesce(v_child->>'Date__c','') !~ '^\d{4}-\d{2}-\d{2}$' or (v_child->>'Date__c')::date::text<>v_child->>'Date__c' then
     raise exception 'Group family contains incomplete or unsupported raw payment facts' using errcode='22023'; end if;
   if v_id<>p_proof->>'parentId' then
     if v_child->'RecordType' is distinct from '{"DeveloperName":"Receivable"}'::jsonb
       or v_child->>'Remittance__c' is distinct from p_proof->>'parentId'
       or public.xero_grouped_salesforce_id_v1(v_child->>'STEM__c') is null or v_child->>'STEM__c' !~ '^a0H'
       or (nullif(btrim(v_child->>'Bank__c'),'') is not null and upper(regexp_replace(btrim(v_child->>'Bank__c'),'\s+',' ','g'))<>v_bank)
       or v_child->>'STEM__c'=any(v_stems) then
       raise exception 'Group allocation relationship, bank or invoice selection conflicts' using errcode='22023'; end if;
     v_sum:=v_sum+v_cents; v_stems:=array_append(v_stems,v_child->>'STEM__c'); v_accounts:=array_append(v_accounts,v_child->>'Account__c');
     if v_id=p_proof->>'selectedPaymentId' then v_selected:=v_child; end if;
   elsif v_child is distinct from v_parent then raise exception 'Nested Group header' using errcode='22023'; end if;
 end loop;
 if v_selected is null or nullif(btrim(v_selected->>'Bank__c'),'') is not null
   or v_selected->>'Account__c' is distinct from p_proof->>'debtorAccountId'
   or v_sum<>public.xero_group_bank_cents_v1(v_parent->'Amount__c') or v_sum::text is distinct from p_proof->>'totalCents'
   or v_sum>9007199254740991 then raise exception 'Selected Group allocation or exact family total changed' using errcode='22023'; end if;
 v_accounts:=array_append(v_accounts,p_proof->>'groupAccountId');
 if jsonb_array_length(v_source->'accounts')<>(select count(distinct x) from unnest(v_accounts) x)
   or (select count(distinct value->>'Id') from jsonb_array_elements(v_source->'accounts'))<>jsonb_array_length(v_source->'accounts') then
   raise exception 'Complete unique Group account scope is required' using errcode='22023'; end if;
 for v_account in select value from jsonb_array_elements(v_source->'accounts') loop
   if not v_account ?& array['Id','IsDeleted','Name','RecordType','ParentId','Company_Code__c','Inactive_Suspended__c','LastModifiedDate']
     or (select count(*) from jsonb_object_keys(v_account))<>8 or v_account->'IsDeleted' is distinct from 'false'::jsonb
     or v_account->'Inactive_Suspended__c' is distinct from 'false'::jsonb or not(v_account->>'Id'=any(v_accounts))
     or not public.xero_group_bank_text_v1(v_account->'Name',false) or nullif(btrim(v_account->>'Name'),'') is null
     or not public.xero_group_bank_text_v1(v_account->'Company_Code__c') or not public.xero_group_bank_text_v1(v_account->'LastModifiedDate')
     or (v_account->'ParentId' is distinct from 'null'::jsonb and (public.xero_grouped_salesforce_id_v1(v_account->>'ParentId') is null or v_account->>'ParentId' !~ '^001[A-Za-z0-9]{12}$')) then raise exception 'Current active Group account facts are required' using errcode='22023'; end if;
   if v_account->>'Id'=p_proof->>'groupAccountId' then
     if v_account->'RecordType' is distinct from '{"DeveloperName":"Group"}'::jsonb then raise exception 'Header Account is not Group' using errcode='22023'; end if;
   elsif (v_account->'RecordType' in ('{"DeveloperName":"Buyer"}'::jsonb,'{"DeveloperName":"Buyer_Supplier"}'::jsonb)) is not true
     or v_account->>'ParentId' is distinct from p_proof->>'groupAccountId' then
     raise exception 'Each debtor must be an exact direct Group member' using errcode='22023'; end if;
 end loop;
 if jsonb_array_length(v_source->'buyerDocumentInventories')<>v_count
   or (select count(distinct value->>'stemId') from jsonb_array_elements(v_source->'buyerDocumentInventories'))<>v_count then
   raise exception 'Complete unique debtor invoice inventories are required' using errcode='22023'; end if;
 for v_inventory in select value from jsonb_array_elements(v_source->'buyerDocumentInventories') loop
   if not v_inventory ?& array['stemId','complete','creditFields','records'] or (select count(*) from jsonb_object_keys(v_inventory))<>4
     or not(v_inventory->>'stemId'=any(v_stems)) or v_inventory->'complete' is distinct from 'true'::jsonb
     or jsonb_typeof(v_inventory->'records') is distinct from 'array' or jsonb_array_length(v_inventory->'records')<1
     or jsonb_typeof(v_inventory->'creditFields') is distinct from 'array'
     or (select count(distinct f) from jsonb_array_elements_text(v_inventory->'creditFields') f)<>jsonb_array_length(v_inventory->'creditFields')
     or v_inventory->'creditFields' is distinct from (select coalesce(jsonb_agg(f order by f collate "C"),'[]'::jsonb) from jsonb_array_elements_text(v_inventory->'creditFields') f)
     or (select count(*) from jsonb_array_elements(v_inventory->'records') where value->'Proforma__c'='false'::jsonb and value->'Deprecated__c'='false'::jsonb)<>1 then
     raise exception 'Each debtor requires exactly one current ordinary invoice' using errcode='22023'; end if;
   select value into v_child from jsonb_array_elements(v_source->'allocations') where value->>'STEM__c'=v_inventory->>'stemId';
   for v_invoice in select value from jsonb_array_elements(v_inventory->'records') loop
     v_id:=public.xero_grouped_salesforce_id_v1(v_invoice->>'Id');
     if not v_invoice ?& array['Id','IsDeleted','Name','STEM__c','STEM__r','Amount__c','Proforma__c','Deprecated__c','CreatedDate','LastModifiedDate','Invoice_Date__c','Invoice_Due_Date__c','CurrencyIsoCode','_currency']
       or exists(select 1 from jsonb_object_keys(v_invoice) k where k<>all(array['Id','IsDeleted','Name','STEM__c','STEM__r','Amount__c','Proforma__c','Deprecated__c','CreatedDate','LastModifiedDate','Invoice_Date__c','Invoice_Due_Date__c','CurrencyIsoCode','_currency','Is_Credit_Note__c','Credit_Note__c','CreditNote__c']))
       or not public.xero_group_bank_text_v1(v_invoice->'Name',false) or nullif(btrim(v_invoice->>'Name'),'') is null
       or exists(select 1 from unnest(array['CreatedDate','LastModifiedDate','Invoice_Date__c','Invoice_Due_Date__c']) k where not public.xero_group_bank_text_v1(v_invoice->k))
       or v_invoice->'STEM__r' is distinct from jsonb_build_object('Account__c',v_child->>'Account__c')
       or (v_invoice->'CurrencyIsoCode' is distinct from 'null'::jsonb and v_invoice->'CurrencyIsoCode' is distinct from '"USD"'::jsonb)
       or v_id is null or v_id !~ '^a0K' or v_invoice->>'Id' is distinct from v_id or v_id=any(v_invoices)
       or v_invoice->>'STEM__c' is distinct from v_child->>'STEM__c' or v_invoice->'STEM__r'->>'Account__c' is distinct from v_child->>'Account__c'
       or v_invoice->'IsDeleted' is distinct from 'false'::jsonb or public.xero_group_bank_cents_v1(v_invoice->'Amount__c') is null
       or jsonb_typeof(v_invoice->'Proforma__c') is distinct from 'boolean' or jsonb_typeof(v_invoice->'Deprecated__c') is distinct from 'boolean'
       or v_invoice->'_currency' is distinct from '{"currency":"USD","blockers":[]}'::jsonb
       or exists(select 1 from jsonb_array_elements_text(v_inventory->'creditFields') f where f not in ('Is_Credit_Note__c','Credit_Note__c','CreditNote__c') or not(v_invoice ? f))
       or exists(select 1 from jsonb_each(v_invoice) x where key in ('Is_Credit_Note__c','Credit_Note__c','CreditNote__c') and value not in ('false'::jsonb,'null'::jsonb))
       or btrim(coalesce(v_invoice->>'Name','')) ~* '(^|-)CN(-|$)' then
       raise exception 'Source invoice owner or credit evidence is ambiguous' using errcode='22023'; end if;
     v_invoices:=array_append(v_invoices,v_id);
   end loop;
 end loop;
 if v_source->'allocations' is distinct from (select jsonb_agg(value order by value->>'Id' collate "C") from jsonb_array_elements(v_source->'allocations'))
   or v_source->'accounts' is distinct from (select jsonb_agg(value order by value->>'Id' collate "C") from jsonb_array_elements(v_source->'accounts'))
   or v_source->'buyerDocumentInventories' is distinct from (select jsonb_agg(value order by value->>'stemId' collate "C") from jsonb_array_elements(v_source->'buyerDocumentInventories'))
   or exists(select 1 from jsonb_array_elements(v_source->'buyerDocumentInventories') i where i.value->'records' is distinct from
     (select jsonb_agg(value order by value->>'Id' collate "C") from jsonb_array_elements(i.value->'records'))) then
   raise exception 'Group receipt arrays are not canonical' using errcode='22023'; end if;
 return v_selected;
end $$;

create function public.xero_assert_group_payment_row_v1(p_row jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_selected jsonb; v_document public.xero_financial_document_mappings; v_bank public.xero_financial_bank_mappings;
 v_invoice jsonb; v_snapshot jsonb; v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 v_selected:=public.xero_validate_group_bank_evidence_v1(p_row->'bankSourceEvidence',p_row->>'salesforcePaymentId');
 if p_row->>'salesforcePaymentName' is distinct from v_selected->>'Name'
   or jsonb_typeof(p_row->'amount') is distinct from 'number' or (p_row->>'amount')::numeric<>(v_selected->>'Amount__c')::numeric
   or p_row->>'paymentDate' is distinct from v_selected->>'Date__c' or p_row->>'currency' is distinct from 'USD'
   or coalesce(p_row->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
   or coalesce(p_row->>'documentMappingId','') !~ v_uuid or coalesce(p_row->>'bankAccountId','') !~ v_uuid
   or coalesce(p_row->'bankMappingSnapshot'->>'id','') !~ v_uuid then
   raise exception 'Group payment row does not bind its raw allocation' using errcode='22023'; end if;
 select * into v_document from public.xero_financial_document_mappings where id=(p_row->>'documentMappingId')::uuid for share;
 v_snapshot:=jsonb_build_object('id',v_document.id,'salesforce_object',v_document.salesforce_object,'salesforce_id',v_document.salesforce_id,
   'xero_document_id',v_document.xero_document_id,'xero_document_type',v_document.xero_document_type,'xero_contact_id',v_document.xero_contact_id,
   'source_fingerprint',v_document.source_fingerprint,'retained_differences',v_document.retained_differences,'protected_legacy',v_document.protected_legacy);
 select r.value into v_invoice from jsonb_array_elements(p_row->'bankSourceEvidence'->'source'->'buyerDocumentInventories') i,
   lateral jsonb_array_elements(i.value->'records') r where i.value->>'stemId'=v_selected->>'STEM__c'
   and r.value->'Proforma__c'='false'::jsonb and r.value->'Deprecated__c'='false'::jsonb;
 if v_document.id is null or p_row->'documentMappingSnapshot' is distinct from v_snapshot
   or coalesce(v_document.xero_document_id,'') !~ v_uuid or coalesce(v_document.xero_contact_id,'') !~ v_uuid
   or v_document.salesforce_object<>'Invoice__c' or v_document.xero_document_type<>'ACCREC'
   or public.xero_grouped_salesforce_id_v1(v_document.salesforce_id) is distinct from v_invoice->>'Id'
   or public.xero_grouped_salesforce_id_v1(v_document.retained_differences->>'accountId') is distinct from v_selected->>'Account__c'
   or public.xero_grouped_salesforce_id_v1(v_document.retained_differences->>'stemId') is distinct from v_selected->>'STEM__c' then
   raise exception 'Reviewed debtor invoice mapping changed' using errcode='40001'; end if;
 select * into v_bank from public.xero_financial_bank_mappings where id=(p_row->'bankMappingSnapshot'->>'id')::uuid for share;
 if v_bank.id is null or not v_bank.enabled or v_bank.xero_bank_account_id is distinct from p_row->>'bankAccountId'
   or upper(regexp_replace(btrim(v_bank.salesforce_bank_name),'\s+',' ','g')) is distinct from upper(regexp_replace(btrim(p_row->'bankSourceEvidence'->>'bank'),'\s+',' ','g'))
   or p_row->'bankMappingSnapshot' is distinct from jsonb_build_object('id',v_bank.id,'salesforce_bank_name',v_bank.salesforce_bank_name,
     'xero_bank_account_id',v_bank.xero_bank_account_id,'revision',v_bank.revision,'enabled',v_bank.enabled) then
   raise exception 'Reviewed approved bank mapping changed' using errcode='40001'; end if;
end $$;

-- A transaction-scoped barrier is acquired by every payment mapping/claim writer,
-- including legacy inserts. Under READ COMMITTED each volatile trigger query after
-- the lock sees the winner. Stronger isolation fails closed rather than using a
-- stale transaction snapshot. No provider request is made while holding this lock.
create function public.xero_group_payment_serialization_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Payment ownership writes require a fresh read-committed snapshot' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(192837465,731);
 return null;
end $$;
create trigger xero_group_payment_mapping_serialize before insert or update or delete on public.xero_financial_payment_mappings
 for each statement execute function public.xero_group_payment_serialization_v1();
-- Statement locking precedes row locks, avoiding the inversion of an UPDATE's
-- tuple lock and another request's mapping/claim lock.
create trigger xero_group_payment_claim_serialize before insert or update or delete on public.xero_financial_sync_runs
 for each statement execute function public.xero_group_payment_serialization_v1();

create function public.xero_guard_group_payment_v1()
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
       or new.xero_bank_account_id is distinct from v_reviewed->>'bankAccountId' or new.amount<>(v_reviewed->>'amount')::numeric
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
create trigger xero_group_payment_mapping_guard before insert or update or delete on public.xero_financial_payment_mappings
 for each row execute function public.xero_guard_group_payment_v1();
create trigger xero_group_payment_claim_guard before insert or update or delete on public.xero_financial_sync_runs
 for each row execute function public.xero_guard_group_payment_v1();

create function public.xero_protect_group_payment_audit_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if old.fingerprints ? 'bankSourceEvidence' or old.fingerprints->'paymentPosting'->'reviewed' ? 'bankSourceEvidence' then
   raise exception 'Group payment evidence audit is immutable' using errcode='40001'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger xero_group_payment_audit_guard before update or delete on public.xero_financial_audit_events
 for each row execute function public.xero_protect_group_payment_audit_v1();

create function public.link_xero_group_payments_v1(p_tenant_id uuid,p_rows jsonb,p_actor_id uuid,p_actor_email text)
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
       or v_mapping.xero_bank_account_id is distinct from v_row->>'bankAccountId' or v_mapping.amount<>(v_row->>'amount')::numeric
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

-- v1 remains byte-for-byte and keeps its original 64KiB evidence limit.
-- A mixed v2 batch is still one transaction, including every legacy sub-call.
create function public.link_xero_payment_references_v2(p_tenant_id uuid,p_rows jsonb,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row jsonb; v_result jsonb; v_outcomes jsonb:='[]';
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 25 then raise exception 'Invalid reference batch' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(192837465,731);
 if (select count(distinct left(value->>'salesforcePaymentId',15)) from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows)
   or (select count(distinct lower(value->>'xeroPaymentId')) from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
   raise exception 'Duplicate reference source or target' using errcode='22023'; end if;
 for v_row in select value from jsonb_array_elements(p_rows) order by left(value->>'salesforcePaymentId',15) loop
   if v_row ? 'bankSourceEvidence' or v_row->'retainedReferenceEvidence' ? 'bankSourceEvidence' then
     v_result:=public.link_xero_group_payments_v1(p_tenant_id,jsonb_build_array(v_row-'idempotencyKey'),p_actor_id,p_actor_email);
   else v_result:=public.link_xero_payment_references_v1(p_tenant_id,jsonb_build_array(v_row),p_actor_id,p_actor_email); end if;
   v_outcomes:=v_outcomes||(v_result->'outcomes');
 end loop;
 return jsonb_build_object('outcomes',v_outcomes);
end $$;

create function public.claim_xero_group_payment_v1(p_tenant_id uuid,p_row jsonb,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id text; v_key text; v_claim public.xero_financial_sync_runs; v_journal jsonb;
begin
 if p_tenant_id is null or p_actor_id is null or p_tenant_id='00000000-0000-0000-0000-000000000000'::uuid
   or p_actor_id='00000000-0000-0000-0000-000000000000'::uuid or nullif(btrim(p_actor_email),'') is null then
   raise exception 'Verified tenant and Finance actor required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(192837465,731);
 perform public.xero_assert_group_payment_row_v1(p_row);
 if p_row->>'action' is distinct from 'payment_apply' or p_row->>'status' is distinct from 'eligible'
   or p_row->'blockers' is distinct from '[]'::jsonb or jsonb_typeof(p_row->'proposedPayment') is distinct from 'object'
   or (select count(*) from jsonb_object_keys(p_row->'proposedPayment'))<>5
   or p_row->'proposedPayment'->'Invoice' is distinct from jsonb_build_object('InvoiceID',p_row->'documentMappingSnapshot'->>'xero_document_id')
   or p_row->'proposedPayment'->'Account' is distinct from jsonb_build_object('AccountID',p_row->>'bankAccountId')
   or p_row->>'type' is distinct from 'Receivable'
   or p_row->'proposedPayment'->'Invoice'->>'InvoiceID' is distinct from p_row->'documentMappingSnapshot'->>'xero_document_id'
   or p_row->'proposedPayment'->'Account'->>'AccountID' is distinct from p_row->>'bankAccountId'
   or p_row->'proposedPayment'->'Amount' is distinct from p_row->'amount'
   or p_row->'proposedPayment'->>'Date' is distinct from p_row->>'paymentDate'
   or coalesce(p_row->>'reviewFingerprint','') !~ '^[0-9a-f]{64}$'
   or p_row->'proposedPayment'->>'Reference' is distinct from coalesce(nullif(
     (select value->>'Reference__c' from jsonb_array_elements(p_row->'bankSourceEvidence'->'source'->'allocations')
      where value->>'Id'=p_row->'bankSourceEvidence'->>'selectedPaymentId'),''),p_row->>'salesforcePaymentName') then
   raise exception 'A freshly eligible payment apply review is required' using errcode='22023'; end if;
 v_id:=public.xero_grouped_salesforce_id_v1(p_row->>'salesforcePaymentId');
 v_key:='payment-post:'||encode(sha256(convert_to('["'||p_tenant_id::text||'","'||v_id||'"]','UTF8')),'hex');
 if exists(select 1 from public.xero_financial_payment_mappings where left(salesforce_payment_id,15)=v_id)
   or exists(select 1 from public.xero_financial_sync_runs where mode='payment_apply' and left(control_totals->'paymentPosting'->>'paymentId',15)=v_id) then
   return jsonb_build_object('alreadyClaimed',true,'claim',null); end if;
 v_journal:=jsonb_build_object('tenantId',p_tenant_id::text,'paymentId',v_id,'reviewed',p_row,'state','intent');
 insert into public.xero_financial_sync_runs(mode,status,idempotency_key,source_fingerprint,control_totals,
   created_by,created_by_email,reviewed_by,reviewed_by_email,reviewed_at)
 values('payment_apply','processing',v_key,p_row->>'sourceFingerprint',jsonb_build_object('paymentPosting',v_journal),
   p_actor_id,lower(btrim(p_actor_email)),p_actor_id,lower(btrim(p_actor_email)),now()) returning * into v_claim;
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
 values(v_claim.id,'payment_posting','intent',p_actor_id,lower(btrim(p_actor_email)),'{"payments":1}',
   jsonb_build_object('tenantId',p_tenant_id::text,'paymentId',v_id,'source',p_row->>'sourceFingerprint',
     'review',p_row->>'reviewFingerprint','idempotencyKey',v_key,'paymentPosting',v_journal));
 return jsonb_build_object('alreadyClaimed',false,'claim',to_jsonb(v_claim));
end $$;

create function public.finish_xero_group_payment_v1(p_tenant_id uuid,p_claim_id uuid,p_state text,p_message text,p_observed_ids jsonb,p_confirmed jsonb,p_actor_id uuid,p_actor_email text)
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
     or jsonb_typeof(p_confirmed->'amount') is distinct from 'number' or (p_confirmed->>'amount')::numeric<>(v_row->>'amount')::numeric
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

-- Service-only, security-invoker code retains all existing table RLS/grants.
revoke all on function public.xero_group_bank_canonical_v1(jsonb),public.xero_group_bank_hash_v1(text,jsonb),public.xero_group_bank_cents_v1(jsonb),
 public.xero_group_bank_text_v1(jsonb,boolean),public.xero_validate_group_bank_evidence_v1(jsonb,text),public.xero_assert_group_payment_row_v1(jsonb),public.xero_group_payment_serialization_v1(),
 public.xero_guard_group_payment_v1(),public.xero_protect_group_payment_audit_v1(),public.link_xero_group_payments_v1(uuid,jsonb,uuid,text),
 public.link_xero_payment_references_v2(uuid,jsonb,uuid,text),public.claim_xero_group_payment_v1(uuid,jsonb,uuid,text),
 public.finish_xero_group_payment_v1(uuid,uuid,text,text,jsonb,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.xero_group_bank_canonical_v1(jsonb),public.xero_group_bank_hash_v1(text,jsonb),public.xero_group_bank_cents_v1(jsonb),
 public.xero_group_bank_text_v1(jsonb,boolean),public.xero_validate_group_bank_evidence_v1(jsonb,text),public.xero_assert_group_payment_row_v1(jsonb),public.xero_group_payment_serialization_v1(),
 public.xero_guard_group_payment_v1(),public.xero_protect_group_payment_audit_v1(),public.link_xero_group_payments_v1(uuid,jsonb,uuid,text),
 public.link_xero_payment_references_v2(uuid,jsonb,uuid,text),public.claim_xero_group_payment_v1(uuid,jsonb,uuid,text),
 public.finish_xero_group_payment_v1(uuid,uuid,text,text,jsonb,jsonb,uuid,text) to service_role;
comment on column public.xero_financial_payment_mappings.bank_source_evidence is
 'Immutable bounded Group remittance source bank receipt; organisational membership is not legal payer identity or settlement.';
