-- Financial-only supplier link policy. Existing documentary policies remain
-- unchanged. Trusted acquisition completeness/freshness stays with the collector.
-- No provider mutation, source-payment linking, posting or allocation write.
create function public.xero_supplier_financial_cents_v1(p_value jsonb)
returns bigint language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp as $$
declare v text; n numeric;
begin
  if current_user is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  v := p_value #>> '{}';
  if coalesce(jsonb_typeof(p_value), '') not in ('string', 'number')
    or coalesce(v, '') ~ '[^0-9.-]'
    or coalesce(v, '') !~ '^-?(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$' then
    raise exception 'Missing or invalid signed exact cents' using errcode='40001';
  end if;
  n := v::numeric * 100;
  if n <> trunc(n) or (n=0 and left(v,1)='-') then
    raise exception 'Subcent or negative-zero evidence is unsupported' using errcode='40001';
  end if;
  return n::bigint;
end $$;

create function public.xero_supplier_financial_json_bound_v1(p_value jsonb)
returns void language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp as $$
declare node_count integer; max_depth integer;
begin
  if current_user is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object'
    or octet_length(p_value::text)>2000000 then
    raise exception 'Bounded original financial JSON object required' using errcode='40001';
  end if;
  with recursive walk(v,d) as (
    select p_value,0
    union all
    select child.v,walk.d+1 from walk cross join lateral (
      select f.value v from jsonb_each(case when jsonb_typeof(walk.v)='object' then walk.v else '{}'::jsonb end) f
      union all
      select a.value v from jsonb_array_elements(case when jsonb_typeof(walk.v)='array' then walk.v else '[]'::jsonb end) a
    ) child where walk.d<25
  ) select count(*),max(d) into node_count,max_depth
    from (select v,d from walk limit 100001) bounded;
  if node_count>100000 or max_depth>24 then
    raise exception 'Financial JSON node/depth bound exceeded' using errcode='40001';
  end if;
  if octet_length(public.xero_document_correction_canonical_v1(p_value))>1000000 then
    raise exception 'Financial canonical byte bound exceeded' using errcode='40001';
  end if;
end $$;

-- Review repeats the whole original twice as canonical strings. Its independent
-- 4 MB allowance does not enlarge the 1 MB original evidence/scope limits.
create function public.xero_supplier_financial_transport_bound_v1(p_value jsonb)
returns void language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp as $$
declare node_count integer; max_depth integer;
begin
  if current_user is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object'
    or octet_length(p_value::text)>8000000 then
    raise exception 'Bounded financial review transport JSON object required' using errcode='40001';
  end if;
  with recursive walk(v,d) as (
    select p_value,0
    union all
    select child.v,walk.d+1 from walk cross join lateral (
      select f.value v from jsonb_each(case when jsonb_typeof(walk.v)='object' then walk.v else '{}'::jsonb end) f
      union all
      select a.value v from jsonb_array_elements(case when jsonb_typeof(walk.v)='array' then walk.v else '[]'::jsonb end) a
    ) child where walk.d<25
  ) select count(*),max(d) into node_count,max_depth
    from (select v,d from walk limit 100001) bounded;
  if node_count>100000 or max_depth>24 then
    raise exception 'Financial JSON node/depth bound exceeded' using errcode='40001';
  end if;
  if octet_length(public.xero_document_correction_canonical_v1(p_value))>4000000 then
    raise exception 'Financial review transport canonical byte bound exceeded' using errcode='40001';
  end if;
end $$;

revoke all on function public.xero_supplier_financial_transport_bound_v1(jsonb) from public,anon,authenticated;
grant execute on function public.xero_supplier_financial_transport_bound_v1(jsonb) to service_role;

revoke all on function public.xero_supplier_financial_cents_v1(jsonb),
  public.xero_supplier_financial_json_bound_v1(jsonb) from public,anon,authenticated;
grant execute on function public.xero_supplier_financial_cents_v1(jsonb),
  public.xero_supplier_financial_json_bound_v1(jsonb) to service_role;

-- This boundary checks the approved financial/identity projection and originals.
-- Provider acquisition freshness/completeness belongs to the trusted collector.
create function public.xero_supplier_financial_approval_material_v1(p_evidence jsonb,p_scope jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_supplier_financial_json_bound_v1(p_evidence);
 perform public.xero_supplier_financial_json_bound_v1(p_scope);
 return jsonb_build_object('policyVersion','supplier_financial_bucket_preserve_v1','evidence',p_evidence,'localClaimScope',p_scope);
end $$;

create function public.xero_supplier_financial_review_assert_v1(p_review jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare
 e jsonb:=p_review->'evidence'; a jsonb:=e->'accounting'; s jsonb:=a->'source'; p jsonb:=s->'parent'; r jsonb:=a->'target';
 scope jsonb:=p_review->'localClaimScope'; identity jsonb:=a->'identity'; coverage jsonb:=identity->'coverage'; selection jsonb:=identity->'selection';
 dependencies jsonb:=a->'sourceDependencies'; depcoverage jsonb:=dependencies->'coverage'; originaldeps jsonb;
 row jsonb; projected jsonb; grantrow jsonb; basis jsonb; accountrow jsonb; expected jsonb; ids jsonb;
 source_lines jsonb:='[]'; target_lines jsonb:='[]'; source_buckets jsonb; target_buckets jsonb; tracking jsonb:='[]';
 n integer; i integer; q_scale integer; u_scale integer; amount bigint; tax bigint; total bigint; net_sum numeric:=0; tax_sum numeric:=0; q numeric; u numeric;
 k text; source_type text; product_id text; row_id text; previous text:=''; invoice_number text; name_key text;
 policy constant text:='supplier_financial_bucket_preserve_v1'; hashpat constant text:='^[a-f0-9]{64}$';
 uuidpat constant text:='^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$';
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_supplier_financial_transport_bound_v1(p_review);
 perform public.xero_supplier_financial_json_bound_v1(e);
 perform public.xero_supplier_financial_json_bound_v1(scope);
 if (select count(*) from jsonb_object_keys(p_review))<>11 or not(p_review ?& array['policyVersion','fingerprint','evidenceFingerprint','approvalMaterialHash','reviewFingerprint','legacyReviewFingerprint','evidence','accountingCanonical','evidenceCanonical','localClaimScope','localClaimScopeCanonical'])
   or p_review->>'policyVersion' is distinct from policy or jsonb_typeof(e) is distinct from 'object'
   or (select count(*) from jsonb_object_keys(e))<>2 or not(e ?& array['policyVersion','accounting']) or e->>'policyVersion' is distinct from policy
   or jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a))<>29
   or not(a ?& array['contract','tenantId','salesforceOrgId','sourceId','stemId','accountId','contactId','targetId','currency','representation','totalCents','subTotalCents','totalTaxCents','sourceFingerprint','financialFingerprint','source','target','sourceLines','targetLines','sourceBuckets','targetBuckets','productMappings','accountTax','organisation','identity','sourceDependencies','settlement','retainedDifferences','documentVerification'])
   or a->>'contract' is distinct from 'financial_bucket_preservation_v1' or a->>'documentVerification' is distinct from 'UNVERIFIED'
   or a->>'currency' is distinct from 'USD' or a->>'representation' is distinct from 'Exclusive'
   then raise exception 'Exact financial review/evidence contract required' using errcode='40001'; end if;
 foreach k in array array['fingerprint','evidenceFingerprint','approvalMaterialHash','reviewFingerprint','legacyReviewFingerprint'] loop
   if jsonb_typeof(p_review->k) is distinct from 'string' or coalesce(p_review->>k,'') !~ hashpat then raise exception 'Missing financial review hash' using errcode='40001'; end if;
 end loop;
 foreach k in array array['tenantId','targetId','contactId'] loop
   if jsonb_typeof(a->k) is distinct from 'string' or coalesce(a->>k,'') !~ uuidpat or a->>k='00000000-0000-0000-0000-000000000000' then raise exception 'Canonical financial UUID required' using errcode='40001'; end if;
 end loop;
 foreach k in array array['salesforceOrgId','sourceId','stemId','accountId'] loop
   if jsonb_typeof(a->k) is distinct from 'string' or public.xero_grouped_salesforce_id_v1(a->>k) is null or a->>k is distinct from public.xero_grouped_salesforce_id_v1(a->>k) then raise exception 'Canonical financial Salesforce identity required' using errcode='40001'; end if;
 end loop;
 if a->>'salesforceOrgId' is distinct from left('00D2x000000Ei4oEAC',15) or left(a->>'sourceId',3)<>'a06' or left(a->>'accountId',3)<>'001'
   or public.xero_grouped_salesforce_id_v1(s->>'orgId') is distinct from a->>'salesforceOrgId'
   or s->>'salesforceObject' is distinct from 'Supplier_Invoice__c' or public.xero_grouped_salesforce_id_v1(p->>'Id') is distinct from a->>'sourceId'
   or public.xero_grouped_salesforce_id_v1(p->>'STEM__c') is distinct from a->>'stemId' or public.xero_grouped_salesforce_id_v1(p->>'Supplier__c') is distinct from a->>'accountId'
   or lower(r->>'InvoiceID') is distinct from a->>'targetId' or lower(r#>>'{Contact,ContactID}') is distinct from a->>'contactId'
   or r->>'Type' is distinct from 'ACCPAY' or coalesce(r->>'Status','') not in ('AUTHORISED','PAID') or r->>'CurrencyCode' is distinct from 'USD'
   or r->>'LineAmountTypes' is distinct from 'Exclusive' or r->'IsDiscounted' is distinct from 'false'::jsonb
   or public.xero_supplier_financial_cents_v1(r->'CurrencyRate')<>100
   or lower(a#>>'{organisation,OrganisationID}') is distinct from a->>'tenantId' or a#>>'{organisation,BaseCurrency}' is distinct from 'USD'
   or public.xero_aggregate_supplier_calendar_date_v3(r,'Date') is null or public.xero_aggregate_supplier_calendar_date_v3(r,'DueDate') is null
   then raise exception 'Original financial source/target/organisation identity changed' using errcode='40001'; end if;
 foreach k in array array['sourceFingerprint','financialFingerprint'] loop
   if coalesce(a->>k,'') !~ hashpat or a->>k is distinct from s->>k or a->>k is distinct from s#>>array['sourcePayload',k] then raise exception 'Original source fingerprint changed' using errcode='40001'; end if;
 end loop;
 foreach k in array array['children','charges'] loop
   if jsonb_typeof(s->k) is distinct from 'array' or jsonb_array_length(s->k)>100 then raise exception 'Complete bounded financial children required' using errcode='40001'; end if;
 end loop;
 foreach k in array array['sourceLines','targetLines','sourceBuckets','targetBuckets','productMappings'] loop
   if jsonb_typeof(a->k) is distinct from 'array' or jsonb_array_length(a->k)>200 then raise exception 'Bounded financial projections required' using errcode='40001'; end if;
 end loop;
 if jsonb_typeof(r->'LineItems') is distinct from 'array' or jsonb_array_length(r->'LineItems') not between 1 and 100
   or jsonb_typeof(a#>'{accountTax,accounts}') is distinct from 'array' or jsonb_array_length(a#>'{accountTax,accounts}')>100
   or jsonb_typeof(a#>'{accountTax,taxes}') is distinct from 'array' or jsonb_array_length(a#>'{accountTax,taxes}')<>1
   or a#>>'{accountTax,taxes,0,TaxType}' is distinct from 'NONE' or a#>>'{accountTax,taxes,0,Status}' is distinct from 'ACTIVE'
   or a#>'{accountTax,taxes,0,CanApplyToExpenses}' is distinct from 'true'::jsonb
   or public.xero_supplier_financial_cents_v1(a#>'{accountTax,taxes,0,DisplayTaxRate}')<>0
   or public.xero_supplier_financial_cents_v1(a#>'{accountTax,taxes,0,EffectiveRate}')<>0 then raise exception 'Original account/tax metadata incomplete' using errcode='40001'; end if;
 -- Error/refund facts are preserved, never silently deleted from financial raws.
 for row in select value from jsonb_array_elements(jsonb_build_array(p,r,r->'Contact',a->'organisation')||(s->'children')||(s->'charges')||(r->'LineItems')||(a#>'{accountTax,accounts}')||(a#>'{accountTax,taxes}')) loop
   if jsonb_typeof(row) is distinct from 'object' then raise exception 'Complete original financial row required' using errcode='40001'; end if;
   foreach k in array array['HasErrors','HasValidationErrors','IsDeleted'] loop
     if row ? k and row->k is distinct from 'false'::jsonb then raise exception 'Financial error/deletion flag contradicts proof' using errcode='40001'; end if;
   end loop;
   if row ? 'ValidationErrors' and row->'ValidationErrors' is distinct from '[]'::jsonb then raise exception 'Financial validation errors present' using errcode='40001'; end if;
 end loop;
 if exists(with recursive walk(v,d) as (select r,0 union all select c.v,w.d+1 from walk w cross join lateral (
     select value v from jsonb_each(case when jsonb_typeof(w.v)='object' then w.v else '{}'::jsonb end)
     union all select value v from jsonb_array_elements(case when jsonb_typeof(w.v)='array' then w.v else '[]'::jsonb end)) c where w.d<24)
     select 1 from walk where jsonb_typeof(v)='object' and (v ? 'Refunds' or v ? 'AmountRefunded')) then raise exception 'Target refund outside financial contract' using errcode='40001'; end if;
 if p->'IsDeleted' is distinct from 'false'::jsonb or lower(coalesce(p->>'Status__c','')) in ('voided','deleted','cancelled','canceled','superseded') or lower(coalesce(p->>'Invoice_Status__c','')) in ('voided','deleted','cancelled','canceled','superseded') then raise exception 'Active supplier source required' using errcode='40001'; end if;
 total:=public.xero_supplier_financial_cents_v1(p->'Invoice_Amount__c');
 if total<=0 or public.xero_supplier_financial_cents_v1(r->'Total')<>total or public.xero_supplier_financial_cents_v1(r->'SubTotal')<>total
   or public.xero_supplier_financial_cents_v1(r->'TotalTax')<>0 or a->>'totalCents' is distinct from total::text
   or a->>'subTotalCents' is distinct from total::text or a->>'totalTaxCents' is distinct from '0' then raise exception 'Signed document headers differ' using errcode='40001'; end if;
 if jsonb_typeof(s->'sourcePayload') is distinct from 'object' or s#>>'{sourcePayload,salesforceObject}' is distinct from 'Supplier_Invoice__c'
   or public.xero_grouped_salesforce_id_v1(s#>>'{sourcePayload,salesforceId}') is distinct from a->>'sourceId'
   or public.xero_grouped_salesforce_id_v1(s#>>'{sourcePayload,accountId}') is distinct from a->>'accountId'
   or public.xero_grouped_salesforce_id_v1(s#>>'{sourcePayload,stemId}') is distinct from a->>'stemId' or lower(s#>>'{sourcePayload,contactId}') is distinct from a->>'contactId'
   or s#>>'{sourcePayload,xeroType}' is distinct from 'ACCPAY' or s#>>'{sourcePayload,documentKind}' is distinct from 'supplier_bill'
   or s#>>'{sourcePayload,postingMode}' is distinct from 'draft' or s#>>'{sourcePayload,currency}' is distinct from 'USD'
   or public.xero_supplier_financial_cents_v1(s#>'{sourcePayload,total}')<>total or public.xero_supplier_financial_cents_v1(s#>'{sourcePayload,signedTotal}')<>total
   or s#>'{sourcePayload,blockers}' is distinct from '[]'::jsonb then raise exception 'Original ordinary source payload financial identity changed' using errcode='40001'; end if;
 if s#>'{safetyContext,singleCurrency}'='true'::jsonb then
   if s#>>'{safetyContext,corporateCurrency}' is distinct from 'USD' then raise exception 'Source corporate currency not proven' using errcode='40001'; end if;
 else
   if s#>'{safetyContext,singleCurrency}' is distinct from 'false'::jsonb or s#>'{safetyContext,corporateCurrency}' is distinct from 'null'::jsonb
     or p->>'CurrencyIsoCode' is distinct from 'USD' then raise exception 'Source explicit currency not proven' using errcode='40001'; end if;
 end if;
 foreach k in array array['Invoice__c','Supplier_Invoice__c','STEM__c','STEM_Line_Item__c','STEM_Extra_Cost__c','Payment__c'] loop
   if jsonb_typeof(s#>array['safetyContext','fields',k]) is distinct from 'array'
     or (s#>'{safetyContext,singleCurrency}'='true'::jsonb and (s#>array['safetyContext','fields',k]) ? 'CurrencyIsoCode') then raise exception 'Source currency schema incomplete' using errcode='40001'; end if;
 end loop;
 if jsonb_typeof(s#>'{sourcePayload,readiness,blockers}') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(s#>'{sourcePayload,readiness,blockers}') b(value) where value is distinct from to_jsonb('Supplier invoice has no verified issued source file.'::text))
   then raise exception 'Non-documentary source readiness hold' using errcode='40001'; end if;
 -- Reconstruct signed source projections from authoritative originals and grants.
 i:=0;
 for row in select value from jsonb_array_elements((s->'children')||(s->'charges')) loop
   source_type:=case when i<jsonb_array_length(s->'children') then 'STEM_Line_Item__c' else 'STEM_Extra_Cost__c' end;
   row_id:=public.xero_grouped_salesforce_id_v1(row->>'Id');
   product_id:=public.xero_grouped_salesforce_id_v1(case when source_type='STEM_Line_Item__c' then row->>'Product__c' else row->>'Product2Id__c' end);
   amount:=public.xero_supplier_financial_cents_v1(case when source_type='STEM_Line_Item__c' then row->'Total_Cost__c' else row->'Line_Total_Buy__c' end);
   if row_id is null or product_id is null or left(product_id,3)<>'01t' or amount=0 or row->'IsDeleted' is distinct from 'false'::jsonb or row->'Cancelled__c' is distinct from 'false'::jsonb
     or public.xero_grouped_salesforce_id_v1(row->>'Supplier_Invoice__c') is distinct from a->>'sourceId'
     or public.xero_grouped_salesforce_id_v1(row->>'STEM__c') is distinct from a->>'stemId'
     or public.xero_grouped_salesforce_id_v1(case when source_type='STEM_Line_Item__c' then row->>'Original_Supplier__c' else row->>'Supplier__c' end) is distinct from a->>'accountId'
     or (s#>'{safetyContext,singleCurrency}'='false'::jsonb and row->>'CurrencyIsoCode' is distinct from 'USD') then raise exception 'Original source line identity/amount changed' using errcode='40001'; end if;
   select count(*) into n from jsonb_array_elements(a->'productMappings') m(value) where public.xero_grouped_salesforce_id_v1(value->>'salesforce_product_id')=product_id;
   if n<>1 then raise exception 'Exact product grant missing or duplicate' using errcode='40001'; end if;
   select value into grantrow from jsonb_array_elements(a->'productMappings') m(value) where public.xero_grouped_salesforce_id_v1(value->>'salesforce_product_id')=product_id;
   if grantrow->>'direction' is distinct from 'supplier' or grantrow->'enabled' is distinct from 'true'::jsonb
     or coalesce(grantrow->>'id','') !~ uuidpat or grantrow->>'id'='00000000-0000-0000-0000-000000000000' or coalesce(grantrow->>'approved_by','') !~ uuidpat or grantrow->>'approved_by'='00000000-0000-0000-0000-000000000000'
     or coalesce(grantrow->>'approved_by_email','')='' or coalesce(grantrow->>'approved_at','') !~ '^\d{4}-\d{2}-\d{2}T'
     or coalesce(grantrow->>'revision','') !~ '^[1-9][0-9]{0,8}$' or jsonb_typeof(grantrow->'revision') is distinct from 'number'
     or coalesce(grantrow->>'xero_account_code','') !~ '^[A-Za-z0-9._-]{1,30}$' or grantrow->>'xero_tax_type' is distinct from 'NONE' then raise exception 'Finance-approved current product grant required' using errcode='40001'; end if;
   select count(*) into n from jsonb_array_elements(a#>'{accountTax,accounts}') z(value) where value->>'Code'=grantrow->>'xero_account_code' and coalesce(lower(value->>'AccountID'),'') ~ uuidpat
     and value->>'Status'='ACTIVE' and coalesce(value->>'Type','')<>'' and (not(value ? 'CurrencyCode') or value->>'CurrencyCode'='USD');
   if n<>1 then raise exception 'Exact active account metadata required' using errcode='40001'; end if;
   basis:=a#>array['sourceLines',i::text,'calculationBasis'];
   if source_type='STEM_Line_Item__c' then
     q:=public.xero_aggregate_supplier_money_v3(row->'Quantity_Delivered_Per_BDN__c');u:=public.xero_aggregate_supplier_money_v3(row->'Unit_Buy_At__c');
     expected:=jsonb_build_object('contract','explicit_source_unit_arithmetic_v1','quantityField','Quantity_Delivered_Per_BDN__c','quantity',row->'Quantity_Delivered_Per_BDN__c','unitField','Unit_Buy_At__c','unitAmount',row->'Unit_Buy_At__c','totalField','Total_Cost__c','authoritativeTotal',row->'Total_Cost__c');
     if basis->>'contract'='explicit_source_unit_usd_half_up_v1' then
       if q*u*100=amount or round(q*u*100)<>amount then raise exception 'Supplied exact-cent total does not match reviewed USD line formula' using errcode='40001'; end if;
       q_scale:=length(split_part(row->>'Quantity_Delivered_Per_BDN__c','.',2));u_scale:=length(split_part(row->>'Unit_Buy_At__c','.',2));
       expected:=expected||jsonb_build_object('contract','explicit_source_unit_usd_half_up_v1','unroundedProduct',jsonb_build_object('integer',trunc(q*u*power(10::numeric,q_scale+u_scale))::text,'scale',q_scale+u_scale),'calculatedAmountCents',amount::text);
     end if;
   elsif basis->>'contract'='explicit_source_quantity_one_lump_sum_v1' then
     q:=public.xero_aggregate_supplier_money_v3(row->'Quantity__c');u:=public.xero_aggregate_supplier_money_v3(row->'Lumpsum_Cost__c');
     if q<>1 or not(row ? 'Unit_Cost__c') then raise exception 'Original lump-sum quantity/unit placeholder changed' using errcode='40001'; end if;
     if row->'Unit_Cost__c' is distinct from 'null'::jsonb then
       if public.xero_supplier_financial_cents_v1(row->'Unit_Cost__c')<>0 then raise exception 'Original lump-sum unit placeholder changed' using errcode='40001'; end if;
     end if;
     expected:=jsonb_build_object('contract','explicit_source_quantity_one_lump_sum_v1','quantity',row->'Quantity__c','unitCostPlaceholder',row->'Unit_Cost__c','lumpSum',row->'Lumpsum_Cost__c','authoritativeTotal',row->'Line_Total_Buy__c');
   else
     q:=public.xero_aggregate_supplier_money_v3(row->'Quantity__c');u:=public.xero_aggregate_supplier_money_v3(row->'Unit_Cost__c');
     expected:=jsonb_build_object('contract','explicit_source_unit_arithmetic_v1','quantityField','Quantity__c','quantity',row->'Quantity__c','unitField','Unit_Cost__c','unitAmount',row->'Unit_Cost__c','totalField','Line_Total_Buy__c','authoritativeTotal',row->'Line_Total_Buy__c');
   end if;
   if q<=0 or (basis->>'contract'<>'explicit_source_unit_usd_half_up_v1' and q*u*100<>amount) or basis is distinct from expected then raise exception 'Exact original source arithmetic/basis changed' using errcode='40001'; end if;
   projected:=jsonb_build_object('id',row_id,'productId',product_id,'sourceType',source_type,'amountCents',amount::text,'taxAmountCents','0','grossAmountCents',amount::text,'accountCode',grantrow->>'xero_account_code','taxType','NONE','currencyCode','USD','calculationBasis',expected);
   if a#>array['sourceLines',i::text] is distinct from projected then raise exception 'Signed source projection changed' using errcode='40001'; end if;
   source_lines:=source_lines||jsonb_build_array(projected);net_sum:=net_sum+amount;i:=i+1;
 end loop;
 if i=0 or i<>jsonb_array_length(a->'sourceLines') or net_sum<>total
   or (select count(distinct value->>'id') from jsonb_array_elements(source_lines))<>i
   or jsonb_array_length(a->'productMappings')<>(select count(distinct value->>'productId') from jsonb_array_elements(source_lines))
   or (select count(distinct value->>'id') from jsonb_array_elements(a->'productMappings'))<>jsonb_array_length(a->'productMappings')
   or jsonb_array_length(a#>'{accountTax,accounts}')<>(select count(distinct value->>'accountCode') from jsonb_array_elements(source_lines)) then raise exception 'Source lines/grants/header not exhaustive' using errcode='40001'; end if;
 i:=0;net_sum:=0;tax_sum:=0;
 for row in select value from jsonb_array_elements(r->'LineItems') loop
   amount:=public.xero_supplier_financial_cents_v1(row->'LineAmount');tax:=public.xero_supplier_financial_cents_v1(row->'TaxAmount');
   q:=public.xero_aggregate_supplier_money_v3(row->'Quantity');u:=public.xero_aggregate_supplier_money_v3(row->'UnitAmount');
   if coalesce(lower(row->>'LineItemID'),'') !~ uuidpat or lower(row->>'LineItemID')='00000000-0000-0000-0000-000000000000' or q<=0 or q*u*100<>amount or tax<>0 or row->>'TaxType' is distinct from 'NONE'
     or (row ? 'DiscountRate' and public.xero_supplier_financial_cents_v1(row->'DiscountRate')<>0)
     or (row ? 'DiscountAmount' and public.xero_supplier_financial_cents_v1(row->'DiscountAmount')<>0)
     or (row ? 'ItemCode' and row->>'ItemCode' is distinct from '') then raise exception 'Original signed target line arithmetic/component changed' using errcode='40001'; end if;
   select count(*) into n from jsonb_array_elements(a#>'{accountTax,accounts}') z(value) where value->>'Code'=row->>'AccountCode'
     and (not(row ? 'AccountID') or lower(row->>'AccountID')=lower(value->>'AccountID'));
   if n<>1 then raise exception 'Target account identity/bucket changed' using errcode='40001'; end if;
   if jsonb_typeof(row->'Tracking') is distinct from 'array' or jsonb_array_length(row->'Tracking')>2 then raise exception 'Full original target Tracking required' using errcode='40001'; end if;
   if exists(select 1 from jsonb_array_elements(row->'Tracking') z(value) where jsonb_typeof(value) is distinct from 'object' or coalesce(lower(value->>'TrackingCategoryID'),'') !~ uuidpat or coalesce(value->>'Name','')='' or coalesce(value->>'Option','')='') then raise exception 'Target Tracking identity incomplete' using errcode='40001'; end if;
   if jsonb_array_length(row->'Tracking')>0 then tracking:=tracking||jsonb_build_array(jsonb_build_object('lineItemId',lower(row->>'LineItemID'),'originalTracking',row->'Tracking','sourceEquivalenceEstablished',false)); end if;
   projected:=jsonb_build_object('id',lower(row->>'LineItemID'),'amountCents',amount::text,'taxAmountCents',tax::text,'grossAmountCents',(amount+tax)::text,'accountCode',row->>'AccountCode','taxType',row->>'TaxType','currencyCode','USD');
   if a#>array['targetLines',i::text] is distinct from projected then raise exception 'Signed target projection changed' using errcode='40001'; end if;
   target_lines:=target_lines||jsonb_build_array(projected);net_sum:=net_sum+amount;tax_sum:=tax_sum+tax;i:=i+1;
 end loop;
 if i<>jsonb_array_length(a->'targetLines') or (select count(distinct value->>'id') from jsonb_array_elements(target_lines))<>i or net_sum<>total or tax_sum<>0 then raise exception 'Target signed lines/header not exhaustive' using errcode='40001'; end if;
 select jsonb_agg(jsonb_build_object('accountCode',code,'taxType',tt,'currencyCode',cc,'netCents',net::text,'taxCents',taxes::text,'grossCents',gross::text) order by code||'|'||tt||'|'||cc collate "C") into source_buckets from (
   select value->>'accountCode' code,value->>'taxType' tt,value->>'currencyCode' cc,sum((value->>'amountCents')::numeric) net,sum((value->>'taxAmountCents')::numeric) taxes,sum((value->>'grossAmountCents')::numeric) gross from jsonb_array_elements(source_lines) group by 1,2,3) b;
 select jsonb_agg(jsonb_build_object('accountCode',code,'taxType',tt,'currencyCode',cc,'netCents',net::text,'taxCents',taxes::text,'grossCents',gross::text) order by code||'|'||tt||'|'||cc collate "C") into target_buckets from (
   select value->>'accountCode' code,value->>'taxType' tt,value->>'currencyCode' cc,sum((value->>'amountCents')::numeric) net,sum((value->>'taxAmountCents')::numeric) taxes,sum((value->>'grossAmountCents')::numeric) gross from jsonb_array_elements(target_lines) group by 1,2,3) b;
 if source_buckets is distinct from target_buckets or a->'sourceBuckets' is distinct from source_buckets or a->'targetBuckets' is distinct from target_buckets
   or a->'retainedDifferences' is distinct from jsonb_build_object('targetTracking',tracking,'sourceTrackingEquivalenceEstablished',false,'targetHeaderPresentationRetained',true) then raise exception 'Exact signed account/tax/currency bucket or Tracking preservation differs' using errcode='40001'; end if;
 -- Exact reviewed selection is independent of equal money. Global scope truth is
 -- a trusted collector boundary; declared scope must remain internally complete.
 if jsonb_typeof(identity) is distinct from 'object' or jsonb_typeof(selection) is distinct from 'object' or jsonb_typeof(coverage) is distinct from 'object'
   or selection->>'contract' is distinct from 'supplier_financial_selected_identity_v1' then raise exception 'Independent selected identity required' using errcode='40001'; end if;
 foreach k in array array['tenantId','salesforceOrgId','sourceId','stemId','accountId','contactId','targetId','sourceFingerprint','financialFingerprint'] loop
   if selection->>k is distinct from a->>k then raise exception 'Exact independent identity selection changed' using errcode='40001'; end if;
 end loop;
 if coalesce(selection->>'reviewedBy','') !~ uuidpat or selection->>'reviewedBy'='00000000-0000-0000-0000-000000000000' or coalesce(selection->>'reviewedAt','') !~ '^\d{4}-\d{2}-\d{2}T' or coalesce(selection->>'basis','')='' then raise exception 'Independent identity review facts required' using errcode='40001'; end if;
 foreach k in array array['accounts','contacts','sourceClaims','targetClaims','creditClaims','sourceMappings','targetMappings','referenceClaims','postingClaims','disputes'] loop
   if jsonb_typeof(identity->k) is distinct from 'array' or jsonb_array_length(identity->k)>1000 then raise exception 'Bounded complete original identity/claim arrays required' using errcode='40001'; end if;
 end loop;
 foreach k in array array['sourceQueryAll','sourceComplete','targetComplete','targetIncludesArchived','creditComplete','globalAccountsComplete','globalContactsComplete','claimsComplete','mappingsComplete','dependenciesComplete'] loop
   if coverage->k is distinct from 'true'::jsonb then raise exception 'Declared collector identity/claim scope changed' using errcode='40001'; end if;
 end loop;
 foreach k in array array['sourceMappings','targetMappings','referenceClaims','postingClaims','disputes'] loop
   if identity->k is distinct from '[]'::jsonb then raise exception 'Captured ownership/claim conflict' using errcode='40001'; end if;
 end loop;
 foreach k in array array['sourceCount','targetCount','creditCount'] loop
   if jsonb_typeof(coverage->k) is distinct from 'number' or coalesce(coverage->>k,'') !~ '^(0|[1-9][0-9]{0,3})$' then raise exception 'Invalid bounded claim count' using errcode='40001'; end if;
 end loop;
 if identity->>'coverageFingerprint' is distinct from public.xero_document_correction_hash_v1(identity-'coverageFingerprint')
   or (select count(*) from jsonb_array_elements(identity->'sourceClaims') where public.xero_grouped_salesforce_id_v1(value->>'Id')=a->>'sourceId' and value=p)<>1
   or (select count(*) from jsonb_array_elements(identity->'targetClaims') where lower(value->>'InvoiceID')=a->>'targetId' and value=r)<>1
   or jsonb_array_length(identity->'sourceClaims')<>(coverage->>'sourceCount')::integer or jsonb_array_length(identity->'targetClaims')<>(coverage->>'targetCount')::integer
   or jsonb_array_length(identity->'creditClaims')<>(coverage->>'creditCount')::integer then raise exception 'Original selected claims/coverage hash changed' using errcode='40001'; end if;
 if (select count(*) from jsonb_array_elements(identity->'accounts') where value->>'id'=a->>'accountId' and value->>'name'=p#>>'{Supplier__r,Name}' and value->>'companyCode'=p#>>'{Supplier__r,Company_Code__c}' and value->'inactiveSuspended'='false')<>1
   or (select count(*) from jsonb_array_elements(identity->'contacts') where value->>'id'=a->>'contactId' and value->>'name'=r#>>'{Contact,Name}' and value->>'status'='ACTIVE')<>1
   or coverage->'stemIds' is distinct from jsonb_build_array(a->>'stemId') or coverage->'xeroContactIds' is distinct from jsonb_build_array(a->>'contactId')
   or jsonb_typeof(coverage->'sourceAccountIds') is distinct from 'array' or not((coverage->'sourceAccountIds') ? (a->>'accountId')) then raise exception 'Current selected Account/Contact owner identity changed' using errcode='40001'; end if;
 for row in select value from jsonb_array_elements(identity->'accounts') loop
   if coverage->'sourceAccountIds' ? (row->>'id') and row->>'id'<>a->>'accountId' and row->'inactiveSuspended' is distinct from 'true'::jsonb then raise exception 'Competing active source owner' using errcode='40001'; end if;
 end loop;
 invoice_number:=upper(regexp_replace(r->>'InvoiceNumber','[^A-Za-z0-9]','','g'));
 for row in select value from jsonb_array_elements(identity->'sourceClaims') loop
   if public.xero_grouped_salesforce_id_v1(row->>'Id') is null or public.xero_grouped_salesforce_id_v1(row->>'Supplier__c') is null or public.xero_grouped_salesforce_id_v1(row->>'STEM__c') is null
     or jsonb_typeof(row->'IsDeleted') is distinct from 'boolean' or public.xero_supplier_financial_cents_v1(row->'Invoice_Amount__c') is null then raise exception 'Complete original source claim required' using errcode='40001'; end if;
   if public.xero_grouped_salesforce_id_v1(row->>'Id')<>a->>'sourceId' and row->'IsDeleted'='false'::jsonb and lower(coalesce(row->>'Status__c','')) not in ('voided','deleted','cancelled','canceled','superseded') and lower(coalesce(row->>'Invoice_Status__c','')) not in ('voided','deleted','cancelled','canceled','superseded') and (coverage->'sourceAccountIds') ? public.xero_grouped_salesforce_id_v1(row->>'Supplier__c')
     and exists(select 1 from (select row->>'Name' name union all select regexp_split_to_table(coalesce(row->>'Name',''),'[[:space:]]+')) n1 join (select p->>'Name' name union all select r->>'InvoiceNumber' union all select regexp_split_to_table(coalesce(p->>'Name',''),'[[:space:]]+')) n2 on upper(regexp_replace(n1.name,'[^A-Za-z0-9]','','g'))=upper(regexp_replace(n2.name,'[^A-Za-z0-9]','','g')) and upper(regexp_replace(n1.name,'[^A-Za-z0-9]','','g'))<>'')
     then raise exception 'Active exact source number collision' using errcode='40001'; end if;
 end loop;
 for row in select value from jsonb_array_elements(identity->'targetClaims') loop
   if lower(row->>'InvoiceID')<>a->>'targetId' and lower(row#>>'{Contact,ContactID}')=a->>'contactId' and coalesce(row->>'Status','') not in ('DELETED','VOIDED') and row->'IsDeleted' is distinct from 'true'::jsonb
     and exists(select 1 from (select p->>'Name' name union all select r->>'InvoiceNumber' union all select regexp_split_to_table(coalesce(p->>'Name',''),'[[:space:]]+')) n2 where upper(regexp_replace(row->>'InvoiceNumber','[^A-Za-z0-9]','','g'))=upper(regexp_replace(n2.name,'[^A-Za-z0-9]','','g'))) then raise exception 'Active exact target number collision' using errcode='40001'; end if;
 end loop;
 for row in select value from jsonb_array_elements(identity->'creditClaims') loop
   if lower(row#>>'{Contact,ContactID}')=a->>'contactId' and coalesce(row->>'Status','') not in ('DELETED','VOIDED') and row->'IsDeleted' is distinct from 'true'::jsonb and (exists(select 1 from (select p->>'Name' name union all select r->>'InvoiceNumber' union all select regexp_split_to_table(coalesce(p->>'Name',''),'[[:space:]]+')) n2 where upper(regexp_replace(row->>'CreditNoteNumber','[^A-Za-z0-9]','','g'))=upper(regexp_replace(n2.name,'[^A-Za-z0-9]','','g')))
     or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(row->'Allocations')='array' then row->'Allocations' else '[]'::jsonb end) z(value) where lower(value#>>'{Invoice,InvoiceID}')=a->>'targetId')) then raise exception 'Active credit/allocated target claim' using errcode='40001'; end if;
 end loop;
 if jsonb_typeof(dependencies->'payments') is distinct from 'array' or jsonb_typeof(dependencies->'families') is distinct from 'array'
   or jsonb_array_length(dependencies->'payments')>1000 or jsonb_array_length(dependencies->'families')>1000 then raise exception 'Full bounded dependency originals required' using errcode='40001'; end if;
 originaldeps:=jsonb_build_object('payments',dependencies->'payments','families',dependencies->'families');
 select coalesce(jsonb_agg(to_jsonb(id) order by id collate "C"),'[]') into ids from (select distinct public.xero_grouped_salesforce_id_v1(value->>'Id') id from jsonb_array_elements((dependencies->'payments')||(dependencies->'families'))) z;
 if jsonb_typeof(scope) is distinct from 'object' or (select count(*) from jsonb_object_keys(scope))<>10 or not(scope ?& array['contract','tenantId','salesforceOrgId','sourceId','stemId','targetId','sourcePaymentIds','xeroPaymentIds','sourceDependencyHash','coverageFingerprint'])
   or scope->>'contract' is distinct from 'supplier_financial_local_claim_scope_v1' or scope->'sourcePaymentIds' is distinct from ids
   or scope->>'sourceDependencyHash' is distinct from public.xero_document_correction_hash_v1(originaldeps)
   or scope->>'coverageFingerprint' is distinct from identity->>'coverageFingerprint' then raise exception 'Exact full-original financial local claim scope changed' using errcode='40001'; end if;
 foreach k in array array['tenantId','salesforceOrgId','sourceId','stemId','targetId'] loop
   if scope->>k is distinct from a->>k then raise exception 'Local financial claim identity changed' using errcode='40001'; end if;
 end loop;
 foreach k in array array['paymentCount','familyCount'] loop
   if jsonb_typeof(depcoverage->k) is distinct from 'number' or coalesce(depcoverage->>k,'') !~ '^(0|[1-9][0-9]{0,3})$' then raise exception 'Invalid bounded dependency count' using errcode='40001'; end if;
 end loop;
 if depcoverage->>'contract' is distinct from 'complete_supplier_payment_family_scope_v1' or depcoverage->'complete' is distinct from 'true'::jsonb or depcoverage->'queryAll' is distinct from 'true'::jsonb
   or depcoverage->>'sourceId' is distinct from a->>'sourceId' or depcoverage->>'stemId' is distinct from a->>'stemId' or depcoverage->>'accountId' is distinct from a->>'accountId'
   or coalesce(depcoverage->>'queryFingerprint','') !~ hashpat or (depcoverage->>'paymentCount')::integer<>jsonb_array_length(dependencies->'payments') or (depcoverage->>'familyCount')::integer<>jsonb_array_length(dependencies->'families') then raise exception 'Declared full payment-family scope changed' using errcode='40001'; end if;
 for row in select value from jsonb_array_elements((dependencies->'payments')||(dependencies->'families')) loop
   if public.xero_grouped_salesforce_id_v1(row->>'Id') is null or jsonb_typeof(row->'IsDeleted') is distinct from 'boolean' then raise exception 'Full original dependency IDs/deleted states required' using errcode='40001'; end if;
 end loop;
 for row in select value from jsonb_array_elements(dependencies->'payments') loop
   if public.xero_grouped_salesforce_id_v1(row->>'Supplier_Invoice__c') is distinct from a->>'sourceId' or public.xero_grouped_salesforce_id_v1(row->>'STEM__c') is distinct from a->>'stemId'
     or public.xero_grouped_salesforce_id_v1(row->>'Account__c') is distinct from a->>'accountId' or jsonb_typeof(row->'Is_Volume_Discount__c') is distinct from 'boolean'
     or not(row ? 'Remittance__c') or (row->'Remittance__c' is distinct from 'null'::jsonb and public.xero_grouped_salesforce_id_v1(row->>'Remittance__c') is null)
     then raise exception 'Original direct dependency identity changed' using errcode='40001'; end if;
   if row->'Remittance__c' is distinct from 'null'::jsonb and not exists(select 1 from jsonb_array_elements(dependencies->'families') f(value) where public.xero_grouped_salesforce_id_v1(value->>'Id')=public.xero_grouped_salesforce_id_v1(row->>'Remittance__c')) then raise exception 'Original remittance family incomplete' using errcode='40001'; end if;
   if exists(select 1 from jsonb_array_elements(dependencies->'families') f(value) where public.xero_grouped_salesforce_id_v1(value->>'Id')=public.xero_grouped_salesforce_id_v1(row->>'Id') and value is distinct from row) then raise exception 'Conflicting dependency original' using errcode='40001'; end if;
 end loop;
 foreach k in array array['payments','families'] loop
   if (select count(distinct public.xero_grouped_salesforce_id_v1(value->>'Id')) from jsonb_array_elements(dependencies->k))<>jsonb_array_length(dependencies->k) then raise exception 'Duplicate dependency identity' using errcode='40001'; end if;
 end loop;
 for row in select value from jsonb_array_elements(dependencies->'families') loop
   if not exists(select 1 from jsonb_array_elements(dependencies->'payments') p0(value) where public.xero_grouped_salesforce_id_v1(value->>'Remittance__c') is not null and (public.xero_grouped_salesforce_id_v1(row->>'Id')=public.xero_grouped_salesforce_id_v1(value->>'Remittance__c') or public.xero_grouped_salesforce_id_v1(row->>'Remittance__c')=public.xero_grouped_salesforce_id_v1(value->>'Remittance__c'))) then raise exception 'Unassociated family dependency' using errcode='40001'; end if;
 end loop;
 if r->>'Status'='PAID' then
   if a#>>'{settlement,contract}' is distinct from 'existing_xero_ledger_payment_v1' or a#>>'{settlement,status}' is distinct from 'PAID'
     or a#>'{settlement,ledgerPaymentProof,proofValid}' is distinct from 'true'::jsonb or a#>'{settlement,ledgerPaymentProof,evidence,originals,invoice}' is distinct from r
     or a#>'{settlement,ledgerPaymentProof,evidence,originals,organisation}' is distinct from a->'organisation'
     or a#>>'{settlement,ledgerPaymentProof,evidence,originals,tenantId}' is distinct from a->>'tenantId'
     or scope->'xeroPaymentIds' is distinct from jsonb_build_array(lower(r#>>'{Payments,0,PaymentID}')) then raise exception 'Original real PAID ledger proof binding changed' using errcode='40001'; end if;
   perform public.xero_settled_supplier_evidence_assert_v1(a#>'{settlement,ledgerPaymentProof,evidence}',public.xero_document_correction_canonical_v1(a#>'{settlement,ledgerPaymentProof,evidence}'),a#>>'{settlement,ledgerPaymentProof,fingerprint}');
 else
   if a#>>'{settlement,contract}' is distinct from 'authorised_zero_settlement_v1' or a#>>'{settlement,status}' is distinct from 'AUTHORISED'
     or a#>'{settlement,ledgerPaymentProof}' is distinct from 'null'::jsonb or scope->'xeroPaymentIds' is distinct from '[]'::jsonb
     or public.xero_supplier_financial_cents_v1(r->'AmountPaid')<>0 or public.xero_supplier_financial_cents_v1(r->'AmountCredited')<>0
     or public.xero_supplier_financial_cents_v1(r->'AmountDue')<>total or r ? 'FullyPaidOnDate' then raise exception 'Original AUTHORISED zero settlement changed' using errcode='40001'; end if;
   foreach k in array array['Payments','CreditNotes','Prepayments','Overpayments'] loop
     if r->k is distinct from '[]'::jsonb then raise exception 'Complete empty original settlement collections required' using errcode='40001'; end if;
   end loop;
 end if;
 if p_review->>'accountingCanonical' is distinct from public.xero_document_correction_canonical_v1(e)
   or p_review->>'evidenceCanonical' is distinct from public.xero_document_correction_canonical_v1(e)
   or p_review->>'localClaimScopeCanonical' is distinct from public.xero_document_correction_canonical_v1(scope)
   or p_review->>'fingerprint' is distinct from public.xero_document_correction_hash_v1(e) or p_review->>'evidenceFingerprint' is distinct from public.xero_document_correction_hash_v1(e)
   or p_review->>'approvalMaterialHash' is distinct from public.xero_document_correction_hash_v1(public.xero_supplier_financial_approval_material_v1(e,scope)) then raise exception 'Whole-original financial canonical/hash binding differs' using errcode='40001'; end if;
end $$;

create function public.protect_xero_supplier_financial_mapping_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if old.retained_differences ? 'financialBucketPreservation' then
   if tg_op='DELETE' or (to_jsonb(new)-'last_reconciled_at'-'updated_at') is distinct from (to_jsonb(old)-'last_reconciled_at'-'updated_at') then raise exception 'Accepted financial bucket mapping/receipt is immutable' using errcode='40001'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger protect_xero_supplier_financial_mapping before update or delete on public.xero_financial_document_mappings for each row execute function public.protect_xero_supplier_financial_mapping_v1();
create unique index xero_supplier_financial_link_event_unique on public.xero_financial_audit_events(run_id,(fingerprints->>'itemId')) where event_type='supplier_financial_bucket_document_linked';

create function public.link_xero_financial_bucket_document_v1(p_run_id uuid,p_expected_run_revision integer,p_item_id uuid,p_expected_item_updated_at timestamptz,p_tenant_id uuid,p_review jsonb,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare
 v_run public.xero_financial_sync_runs; v_item public.xero_financial_sync_items; v_mapping public.xero_financial_document_mappings; v_product public.xero_financial_product_mappings;
 a jsonb:=p_review#>'{evidence,accounting}'; s jsonb:=a->'source'; p jsonb:=s->'parent'; r jsonb:=a->'target'; scope jsonb:=p_review->'localClaimScope';
 saved jsonb; source jsonb; receipt jsonb; retained jsonb; expected jsonb; audit jsonb; row jsonb; acceptance jsonb; result jsonb;
 n integer:=0; product_count integer; v_now timestamptz:=clock_timestamp(); policy constant text:='supplier_financial_bucket_preserve_v1';
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_run_id is null or p_item_id is null or p_tenant_id is null or p_actor_id is null or p_expected_run_revision is null or p_expected_run_revision<1 or p_expected_item_updated_at is null
   or p_actor_id='00000000-0000-0000-0000-000000000000' or p_tenant_id='00000000-0000-0000-0000-000000000000' or length(btrim(coalesce(p_actor_email,''))) not between 1 and 320 then raise exception 'Exact reviewed financial transaction identity required' using errcode='40001'; end if;
 perform public.xero_supplier_financial_review_assert_v1(p_review);
 perform public.xero_document_correction_lock_v1();
 begin lock table public.dispute_beta_cases in share mode nowait; exception when lock_not_available then raise exception 'Active dispute writer; financial link held with no writes' using errcode='55P03'; end;
 select * into v_run from public.xero_financial_sync_runs where id=p_run_id for update;
 select * into v_item from public.xero_financial_sync_items where id=p_item_id and run_id=p_run_id for update;
 if v_run.id is null or v_item.id is null or v_run.mode is distinct from 'preview' or v_run.control_totals->>'preservationPolicy' is distinct from policy
   or v_run.reviewed_by is distinct from p_actor_id or lower(btrim(v_run.reviewed_by_email)) is distinct from lower(btrim(p_actor_email)) or v_run.reviewed_at is null
   or a->>'tenantId' is distinct from p_tenant_id::text or not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=p_tenant_id::text) then raise exception 'Reviewed financial run/actor/tenant changed' using errcode='40001'; end if;
 source:=v_item.source_payload;saved:=source->'supplierFinancialReview';
 if saved is distinct from p_review or (source-'supplierFinancialReview'-'supplierFinancialPreservation') is distinct from s->'sourcePayload'
   or source->'supplierFinancialPreservation' is distinct from jsonb_build_object('policyVersion',policy,'proofValid',true,'workflowEligible',false,'approvalGranted',false,'accepted',false,'documentVerification','UNVERIFIED') or source#>>'{supplierFinancialPreservation,policyVersion}' is distinct from policy
   or source#>'{supplierFinancialPreservation,proofValid}' is distinct from 'true'::jsonb or source#>'{supplierFinancialPreservation,workflowEligible}' is distinct from 'false'::jsonb
   or source#>'{supplierFinancialPreservation,approvalGranted}' is distinct from 'false'::jsonb or source#>'{supplierFinancialPreservation,accepted}' is distinct from 'false'::jsonb
   or source#>>'{supplierFinancialPreservation,documentVerification}' is distinct from 'UNVERIFIED'
   or v_item.source_object is distinct from 'Supplier_Invoice__c' or v_item.source_type is distinct from 'supplier_bill' or public.xero_grouped_salesforce_id_v1(v_item.source_id) is distinct from a->>'sourceId'
   or source->>'salesforceObject' is distinct from v_item.source_object or public.xero_grouped_salesforce_id_v1(source->>'salesforceId') is distinct from a->>'sourceId'
   or public.xero_grouped_salesforce_id_v1(source->>'accountId') is distinct from a->>'accountId' or public.xero_grouped_salesforce_id_v1(source->>'stemId') is distinct from a->>'stemId'
   or source->>'sourceFingerprint' is distinct from a->>'sourceFingerprint' or source->>'financialFingerprint' is distinct from a->>'financialFingerprint'
   or source->>'documentNumber' is distinct from p->>'Name' or v_item.source_document_number is distinct from p->>'Name'
   or source->>'contactId' is distinct from a->>'contactId' or source->>'currency' is distinct from 'USD' or source->>'xeroType' is distinct from 'ACCPAY'
   or v_item.currency is distinct from 'USD' or v_item.source_total*100 is distinct from (a->>'totalCents')::numeric
   or v_item.xero_payload is distinct from r or lower(v_item.xero_document_id) is distinct from a->>'targetId' or v_item.xero_document_status is distinct from r->>'Status'
   or v_item.proposed_action is distinct from 'protected_legacy' or v_item.selected is distinct from true or v_item.proposed_payload is distinct from 'null'::jsonb
   or v_item.blockers is distinct from '[]'::jsonb or v_item.mutation_attempts<>0 or v_item.error_code is not null or v_item.error_message is not null then raise exception 'Original selected financial item/review/marker changed' using errcode='40001'; end if;
 acceptance:=jsonb_build_object('runId',p_run_id,'itemId',p_item_id,'runRevision',p_expected_run_revision,'itemUpdatedAt',p_expected_item_updated_at,'actorId',p_actor_id,'actorEmail',lower(btrim(p_actor_email)));
 receipt:=jsonb_build_object('policyVersion',policy,'receiptContract','supplier_financial_bucket_link_receipt_v1','fingerprint',p_review->'fingerprint','approvalMaterialHash',p_review->'approvalMaterialHash',
   'previewEvidenceFingerprint',saved->'evidenceFingerprint','executionEvidenceFingerprint',p_review->'evidenceFingerprint','originalReview',p_review-'accountingCanonical'-'evidenceCanonical'-'localClaimScopeCanonical',
   'previewReviewHash',public.xero_document_correction_hash_v1(saved),'executionReviewHash',public.xero_document_correction_hash_v1(p_review),'ledgerPaymentProofFingerprint',a#>'{settlement,ledgerPaymentProof,fingerprint}',
   'documentVerification','UNVERIFIED','financialWrites',0,'acceptance',acceptance);
 perform public.xero_supplier_financial_transport_bound_v1(receipt);
 retained:=jsonb_build_object('differences',v_item.differences,'stemId',source->'stemId','accountId',source->'accountId','reviewFingerprint',p_review->'legacyReviewFingerprint','financialBucketPreservation',receipt);
 expected:=jsonb_build_object('salesforce_object',v_item.source_object,'salesforce_id',source->>'salesforceId','salesforce_document_number',p->>'Name','document_kind','supplier_bill','xero_document_type','ACCPAY','xero_document_id',a->>'targetId','xero_document_number',r->>'InvoiceNumber','xero_contact_id',a->>'contactId','xero_status',r->>'Status','source_fingerprint',a->>'sourceFingerprint','financial_fingerprint',a->>'financialFingerprint','protected_legacy',true,'retained_differences',retained);
 for v_mapping in select * from public.xero_financial_document_mappings where (salesforce_object='Supplier_Invoice__c' and left(salesforce_id,15)=a->>'sourceId') or lower(xero_document_id)=a->>'targetId' order by id for update loop
   n:=n+1;if v_item.status is distinct from 'linked' or (to_jsonb(v_mapping)-'id'-'last_reconciled_at'-'created_at'-'updated_at') is distinct from expected then raise exception 'Financial source/target owned or different receipt' using errcode='40001'; end if;
 end loop;
 result:=jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',a->>'targetId','mappingId',v_mapping.id,'policyVersion',policy,'receiptContract','supplier_financial_bucket_link_receipt_v1','fingerprint',p_review->'fingerprint','approvalMaterialHash',p_review->'approvalMaterialHash','previewEvidenceFingerprint',saved->'evidenceFingerprint','executionEvidenceFingerprint',p_review->'evidenceFingerprint','ledgerPaymentProofFingerprint',a#>'{settlement,ledgerPaymentProof,fingerprint}','documentVerification','UNVERIFIED','financialWrites',0);
 if v_item.status='linked' then
   audit:=jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,'mappingId',v_mapping.id,'financialBucketPreservation',receipt);
   if n<>1 or v_item.applied_at is null or not exists(select 1 from public.xero_financial_audit_events where run_id=p_run_id and event_type='supplier_financial_bucket_document_linked' and outcome='success' and actor_id=p_actor_id and actor_email=lower(btrim(p_actor_email)) and record_counts='{"linked":1,"applied":0,"financialWrites":0}'::jsonb and fingerprints=audit) then raise exception 'Exact durable financial outcome is uncertain' using errcode='40001'; end if;
   return result||jsonb_build_object('alreadyLinked',true);
 end if;
 if v_run.status is distinct from 'processing' or v_run.revision is distinct from p_expected_run_revision or v_item.status is distinct from 'selected' or v_item.updated_at is distinct from p_expected_item_updated_at or v_item.applied_at is not null or n<>0 or public.xero_document_correction_active_v1() then raise exception 'Financial selection/revision/active correction changed' using errcode='40001'; end if;
 if exists(select 1 from public.xero_financial_payment_mappings pm where (scope->'sourcePaymentIds') ? left(pm.salesforce_payment_id,15) or (scope->'xeroPaymentIds') ? lower(pm.xero_payment_id))
   or exists(select 1 from public.xero_financial_sync_runs pr where pr.mode='payment_apply' and ((pr.control_totals#>>'{paymentPosting,tenantId}'=p_tenant_id::text and (scope->'sourcePaymentIds') ? left(pr.control_totals#>>'{paymentPosting,paymentId}',15))
     or pr.idempotency_key in(select 'payment-post:'||public.xero_document_correction_hash_v1(jsonb_build_array(p_tenant_id::text,value#>>'{}')) from jsonb_array_elements(scope->'sourcePaymentIds'))
     or (pr.control_totals#>>'{paymentPosting,tenantId}'=p_tenant_id::text and (lower(pr.control_totals#>>'{paymentPosting,reviewed,xeroDocumentId}')=a->>'targetId' or lower(pr.control_totals#>>'{paymentPosting,reviewed,documentId}')=a->>'targetId'
       or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(pr.control_totals#>'{paymentPosting,observedPaymentIds}')='array' then pr.control_totals#>'{paymentPosting,observedPaymentIds}' else '[]'::jsonb end) z(value) where (scope->'xeroPaymentIds') ? lower(value#>>'{}'))))))
   or exists(select 1 from public.dispute_beta_cases dc where left(dc.stem_id,15)=scope->>'stemId' and coalesce(lower(dc.workflow_status),'') not in ('closed','resolved','cancelled')) then raise exception 'Fresh local payment/reference/posting/dispute claim' using errcode='40001'; end if;
 for row in select value from jsonb_array_elements(a->'productMappings') order by left(value->>'salesforce_product_id',15) collate "C",value->>'id' collate "C" loop
   product_count:=0;
   for v_product in select * from public.xero_financial_product_mappings where direction='supplier' and left(salesforce_product_id,15)=left(row->>'salesforce_product_id',15) order by id for share loop
     product_count:=product_count+1;
     if v_product.id::text is distinct from row->>'id' or not v_product.enabled or v_product.revision is distinct from (row->>'revision')::integer
       or v_product.xero_account_code is distinct from row->>'xero_account_code' or v_product.xero_tax_type is distinct from row->>'xero_tax_type'
       or v_product.approved_by::text is distinct from row->>'approved_by' or lower(btrim(v_product.approved_by_email)) is distinct from lower(btrim(row->>'approved_by_email'))
       or v_product.approved_at is distinct from (row->>'approved_at')::timestamptz then raise exception 'Current product grant changed' using errcode='40001'; end if;
   end loop;
   if product_count<>1 then raise exception 'Current product alias grant missing/ambiguous' using errcode='40001'; end if;
 end loop;
 insert into public.xero_financial_document_mappings(salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences,last_reconciled_at,created_at,updated_at)
 values('Supplier_Invoice__c',source->>'salesforceId',p->>'Name','supplier_bill','ACCPAY',a->>'targetId',r->>'InvoiceNumber',a->>'contactId',r->>'Status',a->>'sourceFingerprint',a->>'financialFingerprint',true,retained,v_now,v_now,v_now) returning * into v_mapping;
 audit:=jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,'mappingId',v_mapping.id,'financialBucketPreservation',receipt);
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints) values(p_run_id,'supplier_financial_bucket_document_linked','success',p_actor_id,lower(btrim(p_actor_email)),'{"linked":1,"applied":0,"financialWrites":0}',audit);
 update public.xero_financial_sync_items set status='linked',applied_at=v_now,updated_at=v_now where id=p_item_id;
 return result||jsonb_build_object('mappingId',v_mapping.id,'alreadyLinked',false);
end $$;

revoke all on function public.xero_supplier_financial_approval_material_v1(jsonb,jsonb),public.xero_supplier_financial_review_assert_v1(jsonb),public.protect_xero_supplier_financial_mapping_v1(),public.link_xero_financial_bucket_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.xero_supplier_financial_approval_material_v1(jsonb,jsonb),public.xero_supplier_financial_review_assert_v1(jsonb),public.protect_xero_supplier_financial_mapping_v1(),public.link_xero_financial_bucket_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) to service_role;

-- Small dedicated publisher: explicit wire-null, no generic posting proposal,
-- no registry/PDF assertions. Only trusted server acquisition may call it.
create function public.persist_xero_supplier_financial_preview_v1(p_run jsonb,p_items jsonb,p_review_identity text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare
 requested public.xero_financial_sync_runs; saved public.xero_financial_sync_runs; item public.xero_financial_sync_items;
 snapshot jsonb:=p_run#>'{control_totals,workflowSnapshot}'; payload_hash text; row jsonb; items jsonb:='[]'; prior jsonb; n integer:=0;
 policy constant text:='supplier_financial_bucket_preserve_v1';
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_supplier_financial_json_bound_v1(p_run);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 25 or octet_length(p_items::text)>8000000
   or coalesce(p_review_identity,'') !~ '^[a-f0-9]{64}$' or p_run#>>'{control_totals,preservationPolicy}' is distinct from policy
   or snapshot->'persistenceVersion' is distinct from '1'::jsonb or snapshot->'complete' is distinct from 'true'::jsonb
   or snapshot->>'reviewIdentity' is distinct from p_review_identity or snapshot->'includePayments' is distinct from 'false'::jsonb
   or snapshot->'recordExactMatches' is distinct from 'false'::jsonb or snapshot ? 'paymentsReference' or snapshot ? 'payments'
   or snapshot->'expectedItemCount' is distinct from to_jsonb(jsonb_array_length(p_items)) or p_run#>'{classification_summary,total}' is distinct from to_jsonb(jsonb_array_length(p_items))
   or coalesce(snapshot->>'tenantId','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or public.xero_grouped_salesforce_id_v1(snapshot->>'salesforceOrgId') is distinct from left('00D2x000000Ei4oEAC',15)
   or coalesce(snapshot->>'inputEvidenceHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Exact complete financial-only preview required' using errcode='40001'; end if;
 perform public.xero_supplier_financial_transport_bound_v1(jsonb_build_object('run',p_run,'items',p_items,'reviewIdentity',p_review_identity));
 requested:=jsonb_populate_record(null::public.xero_financial_sync_runs,p_run);
 if requested.id is null or requested.idempotency_key is distinct from 'preview:'||requested.id::text or requested.mode is distinct from 'preview' or requested.status is distinct from 'building' or requested.revision is distinct from 1
   or requested.created_by is null or length(btrim(coalesce(requested.created_by_email,''))) not between 1 and 320
   or requested.created_at is null or requested.updated_at is null or requested.source_snapshot_at is null or requested.xero_snapshot_at is null
   or requested.reviewed_by is not null or requested.reviewed_at is not null or requested.reviewed_by_email is not null or requested.completed_at is not null or requested.error_code is not null or requested.error_message is not null
   or coalesce(requested.source_fingerprint,'') !~ '^[a-f0-9]{64}$' or coalesce(requested.xero_fingerprint,'') !~ '^[a-f0-9]{64}$'
   or requested.cutoff_date is null or jsonb_typeof(requested.rate_limit_snapshot) is distinct from 'object' then raise exception 'Only unreviewed financial preview may be published' using errcode='40001'; end if;
 for row in select value from jsonb_array_elements(p_items) loop
   perform public.xero_supplier_financial_transport_bound_v1(row);
   item:=jsonb_populate_record(null::public.xero_financial_sync_items,row);
   if item.id is null or item.run_id is distinct from requested.id or item.row_index is distinct from n or coalesce(item.row_key,'')='' or coalesce(item.idempotency_key,'')=''
     or item.source_object is distinct from 'Supplier_Invoice__c' or item.source_type is distinct from 'supplier_bill' or public.xero_grouped_salesforce_id_v1(item.source_id) is null
     or item.currency is distinct from 'USD' or item.source_total is null or item.selected is distinct from false or item.mutation_attempts is distinct from 0
     or not(row ? 'proposed_payload') or row->'proposed_payload' is distinct from 'null'::jsonb
     or item.created_at is null or item.updated_at is null or item.applied_at is not null or item.error_code is not null or item.error_message is not null
     or jsonb_typeof(item.source_payload) is distinct from 'object' or jsonb_typeof(item.xero_payload) is distinct from 'object' or jsonb_typeof(item.blockers) is distinct from 'array'
     or jsonb_typeof(item.warnings) is distinct from 'array' or jsonb_typeof(item.differences) is distinct from 'array'
     or not((item.status='eligible' and item.proposed_action='protected_legacy') or (item.status='blocked' and item.proposed_action='blocked')) then raise exception 'Explicit non-executable financial-only preview item required' using errcode='40001'; end if;
   if item.status='eligible' then
     perform public.xero_supplier_financial_review_assert_v1(item.source_payload->'supplierFinancialReview');
     if item.source_payload#>>'{supplierFinancialReview,evidence,accounting,tenantId}' is distinct from snapshot->>'tenantId'
       or public.xero_grouped_salesforce_id_v1(item.source_id) is distinct from item.source_payload#>>'{supplierFinancialReview,evidence,accounting,sourceId}'
       or (item.source_payload-'supplierFinancialReview'-'supplierFinancialPreservation') is distinct from item.source_payload#>'{supplierFinancialReview,evidence,accounting,source,sourcePayload}'
       or item.source_payload->'supplierFinancialPreservation' is distinct from jsonb_build_object('policyVersion',policy,'proofValid',true,'workflowEligible',false,'approvalGranted',false,'accepted',false,'documentVerification','UNVERIFIED')
       or item.xero_payload is distinct from item.source_payload#>'{supplierFinancialReview,evidence,accounting,target}'
       or item.blockers is distinct from '[]'::jsonb then raise exception 'Financial preview original binding differs' using errcode='40001'; end if;
   end if;
   item.proposed_payload:='null'::jsonb;items:=items||jsonb_build_array(to_jsonb(item));n:=n+1;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(items))<>n or (select count(distinct value->>'row_key') from jsonb_array_elements(items))<>n
   or (select count(distinct public.xero_grouped_salesforce_id_v1(value->>'source_id')) from jsonb_array_elements(items))<>n then raise exception 'Financial preview identities duplicate' using errcode='40001'; end if;
 payload_hash:=public.xero_document_correction_hash_v1(jsonb_build_object('run',p_run,'items',p_items,'reviewIdentity',p_review_identity));
 perform public.xero_document_correction_lock_v1();
 select * into saved from public.xero_financial_sync_runs where id=requested.id or idempotency_key=requested.idempotency_key order by id for update;
 if saved.id is not null then
   if saved.id is distinct from requested.id or saved.control_totals->>'preservationPolicy' is distinct from policy or saved.control_totals#>>'{workflowSnapshot,financialPreviewPayloadHash}' is distinct from payload_hash
     or not exists(select 1 from public.xero_financial_audit_events where run_id=saved.id and event_type='supplier_financial_preview_published' and outcome='success' and actor_id=requested.created_by and fingerprints=jsonb_build_object('payloadHash',payload_hash,'reviewIdentity',p_review_identity)) then raise exception 'Exact financial preview durable outcome uncertain' using errcode='40001'; end if;
   if (select count(*) from public.xero_financial_sync_items where run_id=saved.id)<>n then raise exception 'Exact financial preview item count changed' using errcode='40001'; end if;
   for row in select value from jsonb_array_elements(items) loop
     select to_jsonb(i) into prior from public.xero_financial_sync_items i where id=(row->>'id')::uuid and run_id=saved.id;
     if prior is null or (prior-'status'-'selected'-'updated_at'-'applied_at'-'error_code'-'error_message') is distinct from (row-'status'-'selected'-'updated_at'-'applied_at'-'error_code'-'error_message') then raise exception 'Exact original financial preview item changed' using errcode='40001'; end if;
   end loop;
   return jsonb_build_object('run',to_jsonb(saved),'items',(select jsonb_agg(to_jsonb(i) order by row_index) from public.xero_financial_sync_items i where run_id=saved.id),'reused',true);
 end if;
 requested.status:='ready_for_review';requested.control_totals:=jsonb_set(requested.control_totals,'{workflowSnapshot,financialPreviewPayloadHash}',to_jsonb(payload_hash));
 insert into public.xero_financial_sync_runs select requested.*;
 for row in select value from jsonb_array_elements(items) loop
   item:=jsonb_populate_record(null::public.xero_financial_sync_items,row);item.proposed_payload:='null'::jsonb;
   insert into public.xero_financial_sync_items select item.*;
 end loop;
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints) values(requested.id,'supplier_financial_preview_published','success',requested.created_by,lower(btrim(requested.created_by_email)),jsonb_build_object('items',n),jsonb_build_object('payloadHash',payload_hash,'reviewIdentity',p_review_identity));
 return jsonb_build_object('run',to_jsonb(requested),'items',items,'reused',false);
end $$;
create unique index xero_supplier_financial_preview_event_unique on public.xero_financial_audit_events(run_id) where event_type='supplier_financial_preview_published';
revoke all on function public.persist_xero_supplier_financial_preview_v1(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_xero_supplier_financial_preview_v1(jsonb,jsonb,text) to service_role;
