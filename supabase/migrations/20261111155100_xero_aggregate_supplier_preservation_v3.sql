-- Dedicated service-only aggregate supplier v3 identity persistence.
-- Additive functions only: existing policies, indexes, correction serialization,
-- immutable mapping marker and payment history are unchanged. No provider call.
create function public.xero_aggregate_supplier_approval_material_v3(p_evidence jsonb)
returns jsonb language sql immutable strict security invoker set search_path=public,pg_temp as $$
 select p_evidence #- '{observations,registeredReview,at}' #- '{observations,currentObservation,at}';
$$;

create function public.xero_aggregate_supplier_money_v3(p_value jsonb)
returns numeric language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare v text:=p_value#>>'{}'; n numeric;
begin
 if coalesce(jsonb_typeof(p_value),'') not in ('string','number') or coalesce(v,'') ~ '[[:space:]]' or coalesce(v,'') !~ '^-?(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$' then raise exception 'Missing or invalid exact decimal' using errcode='40001'; end if;
 n:=v::numeric; return n;
end $$;

-- Mirror the additive raw provider date projection. Keep raw Date/DateString
-- fields unchanged in canonical evidence; neither source nor buyer is fallback.
create function public.xero_aggregate_supplier_calendar_date_v3(p_row jsonb,p_field text)
returns text language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare v text:=p_row->>p_field; parts text[]; ms numeric; day date; result text;
begin
 if p_field not in ('Date','DueDate') or jsonb_typeof(p_row->p_field) is distinct from 'string' then return null; end if;
 if public.xero_document_correction_date_v1(v) then result:=v;
 else
   parts:=regexp_match(v,'^/Date[(](-?(0|[1-9][0-9]{0,15}))([+-]0000)?[)]/$');
   -- The opening parenthesis in Microsoft format is literal, not a capture.
   if parts is null or v is distinct from '/Date('||parts[1]||coalesce(parts[3],'')||')/' then return null; end if;
   ms:=parts[1]::numeric;
   if abs(ms)>9007199254740991 then return null; end if;
   day:=date '1970-01-01'+floor(ms/86400000)::integer;
   if day<date '0001-01-01' or day>date '9999-12-31' then return null; end if;
   result:=to_char(day,'YYYY-MM-DD');
 end if;
 if p_row ? (p_field||'String') and (jsonb_typeof(p_row->(p_field||'String')) is distinct from 'string'
   or p_row->>(p_field||'String') is distinct from result||'T00:00:00') then return null; end if;
 return result;
exception when others then return null;
end $$;

create function public.xero_aggregate_supplier_assert_v3(p_evidence jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 a jsonb:=p_evidence->'accounting'; s jsonb:=a->'source'; p jsonb:=s->'parent'; r jsonb:=a->'target'; f jsonb:=a->'issuedFile';
 scope jsonb:=a->'identityScope'; rev jsonb:=f->'review'; reg jsonb:=p_evidence#>'{observations,registeredReview}'; obs jsonb:=p_evidence#>'{observations,currentObservation}';
 b jsonb:=obs->'binding'; d jsonb; expected jsonb; settlement jsonb; collections jsonb:='{}'; row jsonb; child jsonb; product jsonb; comp jsonb; line jsonb; edge jsonb; e jsonb; fuel jsonb; proof jsonb;
 money numeric; qty numeric; price numeric; amount numeric; total numeric; sum_source numeric:=0; sum_paper numeric:=0; sum_component numeric; actual numeric; count_fuel integer:=0; count_charge integer:=0; n integer; object_name text; k text;
 children jsonb; active_rows jsonb:='[]'; selected_buyers jsonb:='[]'; linked jsonb; delivery text; invoice_date text; itemkey text; ids jsonb; linked_ids jsonb;
 policy constant text:='issued_petroleum_preserve_v3'; contract constant text:='authorised_zero_settlement_v1'; hashpat constant text:='^[a-f0-9]{64}$';
begin
 if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->>'policyVersion' is distinct from policy
   or jsonb_typeof(a) is distinct from 'object' or a->>'settlementContract' is distinct from contract
   or s->>'salesforceObject' is distinct from 'Supplier_Invoice__c' or s->>'orgId' is distinct from '00D2x000000Ei4oEAC'
   or p->'IsDeleted' is distinct from 'false'::jsonb or r->>'Type' is distinct from 'ACCPAY' or r->>'Status' is distinct from 'AUTHORISED'
   or r->>'CurrencyCode' is distinct from 'USD'
   or public.xero_aggregate_supplier_calendar_date_v3(r,'Date') is null or public.xero_aggregate_supplier_calendar_date_v3(r,'DueDate') is null
   or coalesce(s->>'sourceFingerprint','') !~ hashpat or coalesce(s->>'financialFingerprint','') !~ hashpat
   or jsonb_typeof(s->'children') is distinct from 'array' or jsonb_typeof(s->'charges') is distinct from 'array'
   or jsonb_typeof(s->'products') is distinct from 'array' or jsonb_typeof(s->'buyers') is distinct from 'array'
   or jsonb_typeof(scope->'sourceClaims') is distinct from 'array' or jsonb_typeof(scope->'targetClaims') is distinct from 'array'
   or jsonb_typeof(scope->'creditClaims') is distinct from 'array' then raise exception 'Incomplete raw aggregate source/target contract' using errcode='40001'; end if;
 total:=public.xero_aggregate_supplier_money_v3(p->'Invoice_Amount__c');
 if total<=0 or total*100<>round(total*100) or public.xero_aggregate_supplier_money_v3(r->'Total')<>total
   or public.xero_aggregate_supplier_money_v3(r->'SubTotal')<>total or public.xero_aggregate_supplier_money_v3(r->'TotalTax')<>0
   or public.xero_aggregate_supplier_money_v3(r->'AmountPaid')<>0 or public.xero_aggregate_supplier_money_v3(r->'AmountCredited')<>0
   or public.xero_aggregate_supplier_money_v3(r->'AmountDue')<>total or r ? 'Refunds' or r ? 'AmountRefunded'
   or r->'IsDiscounted' is distinct from 'false'::jsonb or coalesce(r->>'LineAmountTypes','') not in ('Exclusive','NoTax')
   or public.xero_aggregate_supplier_money_v3(r->'CurrencyRate')<>1 then raise exception 'Only exact unpaid AUTHORISED USD zero settlement is admitted' using errcode='40001'; end if;
 foreach k in array array['Payments','CreditNotes','Prepayments','Overpayments'] loop
   if r ? k and r->k is distinct from '[]'::jsonb then raise exception 'Partial, credited, null or unknown settlement evidence' using errcode='40001'; end if;
   collections:=collections||jsonb_build_object(k,case when r ? k then jsonb_build_object('present',true,'rows','[]'::jsonb) else jsonb_build_object('present',false) end);
 end loop;
 settlement:=jsonb_build_object('contract',contract,'status','AUTHORISED','totalCents',(total*100)::bigint::text,'amountDueCents',(total*100)::bigint::text,'amountPaidCents','0','amountCreditedCents','0','collections',collections);
 if p_evidence#>'{observations,settlement}' is distinct from settlement then raise exception 'Settlement presence distinctions changed' using errcode='40001'; end if;
 if jsonb_typeof(r->'LineItems') is distinct from 'array' or jsonb_array_length(r->'LineItems')<>1 then raise exception 'Original raw single target line is required' using errcode='40001'; end if;
 row:=r#>'{LineItems,0}';
 if coalesce(row->>'LineItemID','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or public.xero_aggregate_supplier_money_v3(row->'Quantity')<>1
   or public.xero_aggregate_supplier_money_v3(row->'UnitAmount')<>total or public.xero_aggregate_supplier_money_v3(row->'LineAmount')<>total
   or row->>'AccountCode' is distinct from '51100' or row->>'TaxType' is distinct from 'NONE' or public.xero_aggregate_supplier_money_v3(row->'TaxAmount')<>0
   or row->'Tracking' is distinct from '[]'::jsonb
   or (row ? 'DiscountRate' and public.xero_aggregate_supplier_money_v3(row->'DiscountRate')<>0)
   or (row ? 'DiscountAmount' and public.xero_aggregate_supplier_money_v3(row->'DiscountAmount')<>0)
   or (row ? 'ItemCode' and row->>'ItemCode' is distinct from '') then raise exception 'Protected target line financial data changed' using errcode='40001'; end if;
 if a#>>'{accountTax,account,Code}' is distinct from '51100' or a#>>'{accountTax,account,Type}' is distinct from 'DIRECTCOSTS'
   or a#>>'{accountTax,account,Status}' is distinct from 'ACTIVE' or a#>>'{accountTax,tax,TaxType}' is distinct from 'NONE'
   or a#>>'{accountTax,tax,Status}' is distinct from 'ACTIVE' or a#>'{accountTax,tax,CanApplyToExpenses}' is distinct from 'true'::jsonb
   or public.xero_aggregate_supplier_money_v3(a#>'{accountTax,tax,DisplayTaxRate}')<>0
   or public.xero_aggregate_supplier_money_v3(a#>'{accountTax,tax,EffectiveRate}')<>0 then raise exception 'Current exact ledger/tax evidence differs' using errcode='40001'; end if;
 -- Current schema/getUserInfo context, never a synthesized source currency.
 if jsonb_typeof(s#>'{safetyContext,fields}') is distinct from 'object' or jsonb_typeof(s#>'{safetyContext,singleCurrency}') is distinct from 'boolean' then raise exception 'Authoritative currency schema is absent' using errcode='40001'; end if;
 foreach object_name in array array['Invoice__c','Supplier_Invoice__c','STEM__c','STEM_Line_Item__c','STEM_Extra_Cost__c','Payment__c'] loop
   if jsonb_typeof(s#>array['safetyContext','fields',object_name]) is distinct from 'array'
     or (s#>'{safetyContext,singleCurrency}'='true'::jsonb and (s#>array['safetyContext','fields',object_name]) ? 'CurrencyIsoCode') then raise exception 'Contradictory source currency context' using errcode='40001'; end if;
 end loop;
 if s#>'{safetyContext,singleCurrency}'='true'::jsonb and s#>>'{safetyContext,corporateCurrency}' is distinct from 'USD' then raise exception 'Corporate currency is not authoritative USD' using errcode='40001'; end if;
 children:=(s->'children')||(s->'charges');
 for child in select value from jsonb_array_elements(children) loop
   if jsonb_typeof(child->'IsDeleted') is distinct from 'boolean' or jsonb_typeof(child->'Cancelled__c') is distinct from 'boolean'
     or child->>'Supplier_Invoice__c' is distinct from p->>'Id' or child->>'STEM__c' is distinct from p->>'STEM__c'
     or not(child ? 'Buyer_Invoice__c') then raise exception 'Child state/parent/STEM/link ownership is unknown' using errcode='40001'; end if;
   if child->'IsDeleted'='false'::jsonb and child->'Cancelled__c'='false'::jsonb then
     active_rows:=active_rows||jsonb_build_array(child);
     if child ? 'Product__c' then
       count_fuel:=count_fuel+1; itemkey:=child->>'Product__c'; object_name:='STEM_Line_Item__c';
       qty:=public.xero_aggregate_supplier_money_v3(child->'Quantity_Delivered_Per_BDN__c');price:=public.xero_aggregate_supplier_money_v3(child->'Unit_Buy_At__c');amount:=public.xero_aggregate_supplier_money_v3(child->'Total_Cost__c');
       if child->>'Unit_of_Measure__c' is distinct from 'MT' or child->>'Original_Supplier__c' is distinct from p->>'Supplier__c' then raise exception 'Fuel supplier/unit changed' using errcode='40001'; end if;
     else
       count_charge:=count_charge+1; itemkey:=child->>'Product2Id__c'; object_name:='STEM_Extra_Cost__c';qty:=1;price:=public.xero_aggregate_supplier_money_v3(child->'Lumpsum_Cost__c');amount:=public.xero_aggregate_supplier_money_v3(child->'Line_Total_Buy__c');
       if child->>'Supplier__c' is distinct from p->>'Supplier__c' then raise exception 'Charge supplier changed' using errcode='40001'; end if;
     end if;
     if qty<=0 or price<=0 or amount<=0 or round(qty*price*100)<>amount*100 then raise exception 'Source delivered quantity/price/cents are inconsistent' using errcode='40001'; end if;
     if ((s#>array['safetyContext','fields',object_name]) ? 'CurrencyIsoCode' or s#>'{safetyContext,singleCurrency}' is distinct from 'true'::jsonb) and child->>'CurrencyIsoCode' is distinct from 'USD'
       or child ? 'CurrencyIsoCode' and child->>'CurrencyIsoCode' is distinct from 'USD' then raise exception 'Authoritative line currency is missing or not USD' using errcode='40001'; end if;
     select count(*),min(value::text)::jsonb into n,product from jsonb_array_elements(s->'products') where left(value->>'Id',15)=left(itemkey,15);
     if n<>1 or product->>'Name' is distinct from coalesce(child#>>'{Product__r,Name}',child#>>'{Product2Id__r,Name}')
       or child ? 'Product__c' and product#>>'{RecordType,DeveloperName}' is distinct from 'Petroleum_Product' then raise exception 'Current independently identified product is ambiguous' using errcode='40001'; end if;
     sum_source:=sum_source+amount;
   end if;
 end loop;
 if count_fuel not between 1 and 2 or count_charge>1 or sum_source<>total or jsonb_array_length(active_rows)<>(select count(distinct value->>'Id') from jsonb_array_elements(active_rows)) then raise exception 'Aggregate source shape or exhaustive total changed' using errcode='40001'; end if;
 if ((s#>'{safetyContext,fields,Supplier_Invoice__c}') ? 'CurrencyIsoCode' or s#>'{safetyContext,singleCurrency}' is distinct from 'true'::jsonb) and p->>'CurrencyIsoCode' is distinct from 'USD'
   or p ? 'CurrencyIsoCode' and p->>'CurrencyIsoCode' is distinct from 'USD' then raise exception 'Authoritative parent currency is missing or not USD' using errcode='40001'; end if;
 -- Resolve direct buyer links first; explicit null charge links are retained.
 select coalesce(jsonb_agg(distinct value->'Buyer_Invoice__c'),'[]') into linked_ids from jsonb_array_elements(active_rows) where value->'Buyer_Invoice__c'<>'null'::jsonb;
 if jsonb_array_length(linked_ids)>0 then
   select coalesce(jsonb_agg(value),'[]') into selected_buyers from jsonb_array_elements(s->'buyers') where (value->'Id') in(select value from jsonb_array_elements(linked_ids));
   if jsonb_array_length(selected_buyers)<>jsonb_array_length(linked_ids) then raise exception 'Direct buyer link evidence is incomplete' using errcode='40001'; end if;
 else
   select coalesce(jsonb_agg(value),'[]') into selected_buyers from jsonb_array_elements(s->'buyers') where value->>'STEM__c'=p->>'STEM__c' and value->'IsDeleted'='false'::jsonb and value->'Proforma__c'='false'::jsonb and value->'Deprecated__c'='false'::jsonb and public.xero_aggregate_supplier_money_v3(value->'Amount__c')>=0;
   if jsonb_array_length(selected_buyers)<>1 then raise exception 'Fallback buyer ownership is ambiguous' using errcode='40001'; end if;
 end if;
 for row in select value from jsonb_array_elements(selected_buyers) loop
   if row->'IsDeleted' is distinct from 'false'::jsonb or row->'Proforma__c' is distinct from 'false'::jsonb or row->'Deprecated__c' is distinct from 'false'::jsonb
     or row->'Cancelled__c'='true'::jsonb or public.xero_aggregate_supplier_money_v3(row->'Amount__c')<0
     or row->>'STEM__c' is distinct from p->>'STEM__c' or public.xero_document_correction_date_v1(row->>'Delivery_Date__c') is not true
     or public.xero_document_correction_date_v1(row->>'Invoice_Date__c') is not true then raise exception 'Current buyer date/state evidence is incomplete' using errcode='40001'; end if;
   if delivery is not null and (delivery<>row->>'Delivery_Date__c' or invoice_date<>row->>'Invoice_Date__c') then raise exception 'Linked buyer dates contradict' using errcode='40001'; end if;
   delivery:=row->>'Delivery_Date__c';invoice_date:=row->>'Invoice_Date__c';
 end loop;
 if delivery<'2026-01-01' or a#>>'{buyerDateResolution,deliveryDate}' is distinct from delivery or a#>>'{buyerDateResolution,invoiceDate}' is distinct from invoice_date
   or s#>'{buyerCoverage,complete}' is distinct from 'true'::jsonb or s#>'{buyerCoverage,allDates}' is distinct from 'true'::jsonb or s#>'{buyerCoverage,sameStemComplete}' is distinct from 'true'::jsonb then raise exception 'Exact buyer date resolution changed' using errcode='40001'; end if;
 if rev->>'reviewRecordHash' is distinct from public.xero_document_correction_hash_v1(rev-'reviewRecordHash')
   or nullif(btrim(rev->>'reviewer'),'') is null or rev ? 'reviewerId' or a->'aggregate' is distinct from jsonb_build_object('components',rev->'components','allocations',rev->'allocations','productEvidence',rev->'productEvidence')
   or public.xero_issued_petroleum_attachment_manifest_v2(f->'attachmentManifest',f) is not true
   or f->>'parentId' is distinct from p->>'Id' or f->>'orgId' is distinct from s->>'orgId'
   or f#>'{version,isLatest}' is distinct from 'true'::jsonb or f#>>'{version,latestPublishedVersionId}' is distinct from f->>'versionId'
   or (select string_agg(value#>>'{}',' ' order by ord) from jsonb_array_elements(rev->'sourceTokens') with ordinality z(value,ord)) is distinct from p->>'Name' then raise exception 'Literal native document/review evidence changed' using errcode='40001'; end if;
 if jsonb_typeof(rev->'components') is distinct from 'array' or jsonb_array_length(rev->'components') not between 1 and 3
   or jsonb_typeof(rev->'allocations') is distinct from 'array' or jsonb_array_length(rev->'allocations') not between 1 and 24
   or jsonb_array_length(rev->'allocations')<>(select count(distinct (value->>'componentId',value->>'paperLineId',value->>'sourceId')) from jsonb_array_elements(rev->'allocations')) then raise exception 'Paper/allocation scope is missing or duplicated' using errcode='40001'; end if;
 for comp in select value from jsonb_array_elements(rev->'components') loop
   if coalesce(comp->>'documentType','') not in ('INVOICE','FINAL INVOICE','PROFORMA INVOICE') or comp->>'currency' is distinct from 'USD'
     or comp->>'sellerName' is distinct from rev#>>'{identityFacts,printedSeller}' or comp->>'buyerName' is distinct from rev#>>'{identityFacts,printedBuyer}'
     or comp->>'vessel' is distinct from rev#>>'{identityFacts,printedVessel}' or comp->>'sourceToken' not in(select value#>>'{}' from jsonb_array_elements(rev->'sourceTokens'))
     or (comp->>'numberRule'='exact' and comp->>'printedNumber' is distinct from comp->>'sourceToken')
     or (comp->>'numberRule'='reviewed_ascii_hyphens' and replace(comp->>'printedNumber','-','') is distinct from comp->>'sourceToken')
     or coalesce(comp->>'numberRule','') not in ('exact','reviewed_ascii_hyphens')
     or jsonb_typeof(comp->'lines') is distinct from 'array' or jsonb_array_length(comp->'lines') not between 1 and 6 then raise exception 'Literal supplier component identity changed' using errcode='40001'; end if;
   foreach k in array array['invoiceDate','dueDate','deliveryDate'] loop
     if not(comp ? k) or (comp->k<>'null'::jsonb and public.xero_document_correction_date_v1(comp->>k) is not true) then raise exception 'Printed omitted/null date evidence changed' using errcode='40001'; end if;
   end loop;
   if coalesce(comp->>'taxEvidence','') not in ('explicit_zero_tax','no_tax_line_or_increment_observed') or not(comp ? 'totalTax')
     or (comp->>'taxEvidence'='explicit_zero_tax' and public.xero_aggregate_supplier_money_v3(comp->'totalTax')<>0)
     or (comp->>'taxEvidence'='no_tax_line_or_increment_observed' and comp->'totalTax'<>'null'::jsonb) then raise exception 'Paper tax evidence changed' using errcode='40001'; end if;
   sum_component:=0;
   for line in select value from jsonb_array_elements(comp->'lines') loop
     amount:=public.xero_aggregate_supplier_money_v3(line->'amount');
     if coalesce(line->>'kind','') not in ('fuel','charge','discount') or amount*100<>round(amount*100) or (line->>'kind'='discount' and amount>=0) or (line->>'kind'<>'discount' and amount<=0) then raise exception 'Signed printed amount is invalid' using errcode='40001'; end if;
     if line->>'kind' in ('fuel','discount') then
       qty:=public.xero_aggregate_supplier_money_v3(line->'quantity');price:=public.xero_aggregate_supplier_money_v3(line->'unitPrice');
       if qty<=0 or price<=0 or line->>'unit' not in ('MT','MTS','METRIC TON','METRIC TONS','METRIC TONNE','METRIC TONNES')
         or round(qty*price*100)<>abs(amount)*100 then raise exception 'Printed quantity/rate arithmetic changed' using errcode='40001'; end if;
       if line->>'kind'='discount' then
         select count(*),min(value::text)::jsonb into n,fuel from jsonb_array_elements(comp->'lines') where value->>'id'=line->>'appliesToLineId' and value->>'kind'='fuel';
         if n<>1 or public.xero_aggregate_supplier_money_v3(fuel->'quantity')<>qty then raise exception 'Discount quantity/fuel allocation changed' using errcode='40001'; end if;
       end if;
     else
       if line->'quantity' is distinct from 'null'::jsonb or line->'unit' is distinct from 'null'::jsonb or line->'unitPrice' is distinct from 'null'::jsonb then raise exception 'Charge printed null fields changed' using errcode='40001'; end if;
     end if;
     select count(*),coalesce(sum(public.xero_aggregate_supplier_money_v3(value->'amount')),0) into n,actual from jsonb_array_elements(rev->'allocations') where value->>'componentId'=comp->>'id' and value->>'paperLineId'=line->>'id';
     if n=0 or actual<>amount then raise exception 'A paper component line is not exhaustively allocated' using errcode='40001'; end if;
     if line->>'kind' in ('fuel','discount') and (select sum(public.xero_aggregate_supplier_money_v3(value->'quantity')) from jsonb_array_elements(rev->'allocations') where value->>'componentId'=comp->>'id' and value->>'paperLineId'=line->>'id')<>qty then raise exception 'Printed allocation quantity is not exhaustive' using errcode='40001'; end if;
     sum_component:=sum_component+amount;
   end loop;
   if sum_component<>public.xero_aggregate_supplier_money_v3(comp->'total') then raise exception 'Component total differs from signed printed lines' using errcode='40001'; end if;
   sum_paper:=sum_paper+sum_component;
 end loop;
 if sum_paper<>total then raise exception 'Printed component totals differ from raw source/target' using errcode='40001'; end if;
 for edge in select value from jsonb_array_elements(rev->'allocations') loop
   select count(*),min(value::text)::jsonb into n,child from jsonb_array_elements(active_rows) where value->>'Id'=edge->>'sourceId';
   if n<>1 then raise exception 'Allocation source ownership is unknown' using errcode='40001'; end if;
   select count(*),min(value::text)::jsonb into n,comp from jsonb_array_elements(rev->'components') where value->>'id'=edge->>'componentId';
   if n<>1 then raise exception 'Allocation paper component is unknown' using errcode='40001'; end if;
   select count(*),min(value::text)::jsonb into n,line from jsonb_array_elements(comp->'lines') where value->>'id'=edge->>'paperLineId';
   if n<>1 then raise exception 'Allocation paper line is unknown' using errcode='40001'; end if;
   -- A signed discount uses the independently reviewed product facts of its
   -- exact fuel line; its own quantity/rate/negative amount remain untouched.
   fuel:=line;
   if line->>'kind'='discount' then
     select count(*),min(value::text)::jsonb into n,fuel from jsonb_array_elements(comp->'lines') where value->>'id'=line->>'appliesToLineId' and value->>'kind'='fuel';
     if n<>1 then raise exception 'Discount fuel product binding is unknown' using errcode='40001'; end if;
   end if;
   select count(*),min(value::text)::jsonb into n,e from jsonb_array_elements(rev->'productEvidence') where value->>'id'=edge->>'productEvidenceId';
   if n<>1 or e->>'componentId' is distinct from comp->>'id' or e->>'paperLineId' is distinct from fuel->>'id'
     or e->>'sourceProductId' is distinct from coalesce(child->>'Product__c',child->>'Product2Id__c') or nullif(btrim(e->>'independentEvidence'),'') is null
     or coalesce(e->>'reviewRecordHash','') !~ hashpat or e->>'printedDescription' is distinct from fuel->>'description' then raise exception 'Independent product/grade binding is unproven' using errcode='40001'; end if;
   select count(*),min(value::text)::jsonb into n,product from jsonb_array_elements(s->'products') where value->>'Id'=e->>'sourceProductId';
   if n<>1 or e->>'productFactsHash' is distinct from public.xero_document_correction_hash_v1(product) or e->>'sourceProductName' is distinct from product->>'Name'
     or not(e->'sourceIds' ? (child->>'Id')) then raise exception 'Independent product facts changed' using errcode='40001'; end if;
   amount:=public.xero_aggregate_supplier_money_v3(edge->'amount');
   if child ? 'Product__c' then
     if coalesce(line->>'kind','') not in ('fuel','discount') or e->>'basis' is distinct from 'independently_reviewed_product_grade'
       or nullif(btrim(e->>'sourceGrade'),'') is null or nullif(btrim(e->>'printedGrade'),'') is null then raise exception 'Fuel grade/line proof is incomplete' using errcode='40001'; end if;
     qty:=public.xero_aggregate_supplier_money_v3(edge->'quantity');price:=public.xero_aggregate_supplier_money_v3(line->'unitPrice');
     if qty<=0 or round(qty*price*100)<>(case when line->>'kind'='discount' then -amount*100 else amount*100 end) then raise exception 'Signed edge quantity/rate arithmetic differs' using errcode='40001'; end if;
     if line->>'kind'='fuel' then
       if public.xero_aggregate_supplier_money_v3(line->'netUnitPrice')<>public.xero_aggregate_supplier_money_v3(child->'Unit_Buy_At__c') or public.xero_aggregate_supplier_money_v3(e->'netUnitPrice')<>public.xero_aggregate_supplier_money_v3(child->'Unit_Buy_At__c') then raise exception 'Independent net source/printed price differs' using errcode='40001'; end if;
       select coalesce(sum(public.xero_aggregate_supplier_money_v3(z.edge->'amount')),0) into actual
         from jsonb_array_elements(rev->'allocations') z(edge) join jsonb_array_elements(comp->'lines') zline(value) on zline.value->>'id'=z.edge->>'paperLineId'
         where z.edge->>'componentId'=comp->>'id' and z.edge->>'sourceId'=child->>'Id' and zline.value->>'kind'='discount' and zline.value->>'appliesToLineId'=line->>'id';
       if round(qty*public.xero_aggregate_supplier_money_v3(child->'Unit_Buy_At__c')*100)<>(amount+actual)*100 then raise exception 'Printed signed discount does not reconcile net source allocation' using errcode='40001'; end if;
     else
       select count(*) into n from jsonb_array_elements(rev->'allocations') z(edge) where z.edge->>'componentId'=comp->>'id' and z.edge->>'paperLineId'=line->>'appliesToLineId' and z.edge->>'sourceId'=child->>'Id' and public.xero_aggregate_supplier_money_v3(z.edge->'quantity')=qty;
       if n<>1 then raise exception 'Discount quantity is not bound to its exact fuel edge' using errcode='40001'; end if;
     end if;
   else
     if line->>'kind' is distinct from 'charge' or e->>'basis' is distinct from 'independently_reviewed_charge_description' or edge->'quantity' is distinct from 'null'::jsonb then raise exception 'Charge allocation proof changed' using errcode='40001'; end if;
   end if;
 end loop;
 for child in select value from jsonb_array_elements(active_rows) loop
   select count(*),coalesce(sum(public.xero_aggregate_supplier_money_v3(value->'amount')),0) into n,actual from jsonb_array_elements(rev->'allocations') where value->>'sourceId'=child->>'Id';
   if n=0 or actual<>public.xero_aggregate_supplier_money_v3(coalesce(child->'Total_Cost__c',child->'Line_Total_Buy__c')) then raise exception 'Source allocation amount is not exhaustive' using errcode='40001'; end if;
   if child ? 'Product__c' then
     select sum(public.xero_aggregate_supplier_money_v3(z.edge->'quantity')) into actual from jsonb_array_elements(rev->'allocations') z(edge)
       join jsonb_array_elements(rev->'components') zc(value) on zc.value->>'id'=z.edge->>'componentId'
       join jsonb_array_elements(zc.value->'lines') zl(value) on zl.value->>'id'=z.edge->>'paperLineId'
       where z.edge->>'sourceId'=child->>'Id' and zl.value->>'kind'='fuel';
     if actual<>public.xero_aggregate_supplier_money_v3(child->'Quantity_Delivered_Per_BDN__c') then raise exception 'Source delivered quantity allocation is not exhaustive' using errcode='40001'; end if;
   end if;
 end loop;
 -- Completeness/negative claims originate in the trusted collector and remain
 -- exact approved material. The database additionally checks selected originals.
 foreach k in array array['sourceQueryAll','sourceComplete','targetComplete','targetIncludesArchived','creditComplete','globalAccountsComplete','globalContactsComplete','claimsComplete','mappingsComplete','filesComplete'] loop
   if scope#>array['coverage',k] is distinct from 'true'::jsonb then raise exception 'Approved complete all-year identity/claim scope changed' using errcode='40001'; end if;
 end loop;
 foreach k in array array['sourceMappings','targetMappings','referenceClaims','postingClaims','disputes'] loop
   if scope->k is distinct from '[]'::jsonb then raise exception 'Current ownership, payment or dispute claim blocks first v3 contract' using errcode='40001'; end if;
 end loop;
 if scope->>'coverageFingerprint' is distinct from public.xero_document_correction_hash_v1(scope-'coverageFingerprint')
   or (select count(*) from jsonb_array_elements(scope->'sourceClaims') where value->>'Id'=p->>'Id' and value=p)<>1
   or (select count(*) from jsonb_array_elements(scope->'targetClaims') where value->>'InvoiceID'=r->>'InvoiceID' and value=r)<>1
   or jsonb_array_length(scope->'sourceClaims')<>(scope#>>'{coverage,sourceCount}')::integer
   or jsonb_array_length(scope->'targetClaims')<>(scope#>>'{coverage,targetCount}')::integer
   or jsonb_array_length(scope->'creditClaims')<>(scope#>>'{coverage,creditCount}')::integer then raise exception 'Raw selected source/target scope identity changed' using errcode='40001'; end if;
 for row in select value from jsonb_array_elements(scope->'accounts') loop
   if row->>'id'=left(p->>'Supplier__c',15) then
     if row->>'name' is distinct from p#>>'{Supplier__r,Name}' or row->>'companyCode' is distinct from p#>>'{Supplier__r,Company_Code__c}' or row->'inactiveSuspended' is distinct from 'false'::jsonb then raise exception 'Current selected Account identity changed' using errcode='40001'; end if;
   elsif scope#>'{coverage,sourceAccountIds}' ? (row->>'id') and row->'inactiveSuspended' is distinct from 'true'::jsonb then raise exception 'Competing active owner is unsupported by first v3' using errcode='40001'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(scope->'accounts') where value->>'id'=left(p->>'Supplier__c',15))<>1
   or (select count(*) from jsonb_array_elements(scope->'contacts') where value->>'id'=lower(r#>>'{Contact,ContactID}') and value->>'name'=r#>>'{Contact,Name}' and value->>'status'='ACTIVE')<>1
   or rev#>>'{identityFacts,sourceId}' is distinct from p->>'Id' or rev#>>'{identityFacts,accountId}' is distinct from p->>'Supplier__c'
   or rev#>>'{identityFacts,companyId}' is distinct from p#>>'{Supplier__r,Company__c}' or rev#>>'{identityFacts,companyName}' is distinct from p#>>'{Supplier__r,Company__r,Full_Name__c}'
   or rev#>>'{identityFacts,sourceVessel}' is distinct from p#>>'{STEM__r,Vessel__r,Name}' or rev#>>'{identityFacts,actualBuyerLegalIdentity}' is distinct from 'FRATELLI COSULICH BUNKERS (HK) LTD'
   or rev#>>'{identityFacts,targetDate}' is distinct from public.xero_aggregate_supplier_calendar_date_v3(r,'Date')
   or rev#>>'{identityFacts,deliveryDate}' is distinct from delivery or rev#>>'{identityFacts,invoiceDate}' is distinct from invoice_date then raise exception 'Reviewed literal identity/date facts changed' using errcode='40001'; end if;
 -- Candidate discovery remains all-year and Contact/source-owner scoped.
 -- Equal amounts, references or bill numbers across distinct suppliers do not
 -- establish ownership and do not introduce a foreign-Contact collision gate.
 for row in select value from jsonb_array_elements(scope->'sourceClaims') loop
   if left(row->>'Id',15)<>left(p->>'Id',15) and scope#>'{coverage,sourceAccountIds}' ? left(row->>'Supplier__c',15)
     and (left(row->>'STEM__c',15)=left(p->>'STEM__c',15) or exists(
       select 1 from regexp_split_to_table(coalesce(row->>'Name',''),'[[:space:]]+') token
       join jsonb_array_elements(rev->'sourceTokens') t(value) on upper(regexp_replace(token,'[^A-Za-z0-9]','','g'))=upper(regexp_replace(value#>>'{}','[^A-Za-z0-9]','','g'))))
     then raise exception 'All-year source owner candidate is ambiguous' using errcode='40001'; end if;
 end loop;
 for row in select value from jsonb_array_elements((scope->'targetClaims')||(scope->'creditClaims')) loop
   if coalesce(lower(row->>'InvoiceID'),lower(row->>'CreditNoteID'))<>lower(r->>'InvoiceID') and lower(row#>>'{Contact,ContactID}')=lower(r#>>'{Contact,ContactID}')
     and (upper(regexp_replace(coalesce(row->>'Reference',''),'[^A-Za-z0-9]','','g'))=upper(regexp_replace(p#>>'{STEM__r,KeyStem__c}','[^A-Za-z0-9]','','g'))
       or upper(regexp_replace(coalesce(row->>'InvoiceNumber',row->>'CreditNoteNumber',''),'[^A-Za-z0-9]','','g'))=upper(regexp_replace(r->>'InvoiceNumber','[^A-Za-z0-9]','','g'))
       or exists(select 1 from jsonb_array_elements(rev->'sourceTokens') t(value) where upper(regexp_replace(coalesce(row->>'InvoiceNumber',row->>'CreditNoteNumber',''),'[^A-Za-z0-9]','','g'))=upper(regexp_replace(value#>>'{}','[^A-Za-z0-9]','','g'))))
     then raise exception 'All-year Contact-scoped bill or credit identity is ambiguous' using errcode='40001'; end if;
 end loop;
 d:=jsonb_build_object('policyVersion',policy,'tenantId',a->'tenantId','salesforceOrgId',s->'orgId','sourceId',p->'Id','targetId',r->'InvoiceID',
   'accountId',p->'Supplier__c','stemId',p->'STEM__c','vesselId',p#>'{STEM__r,Vessel__c}','contactId',r#>'{Contact,ContactID}',
   'documentId',f->'documentId','versionId',f->'versionId','pdfSha256',f->'sha256','reviewRecordHash',rev->'reviewRecordHash',
   'approvedReviewRecordHash',public.xero_document_correction_hash_v1(jsonb_build_object('policyVersion',policy,'record',jsonb_build_object('sourceId',p->'Id','xeroDocumentId',r->'InvoiceID','documentId',f->'documentId','versionId',f->'versionId','sha256',f->'sha256','review',rev,'attachments',f#>'{attachmentManifest,entries}'))));
 -- currentFiles are bound in the observation. Reconstruct from the checked
 -- complete manifest so there is no caller-controlled verified boolean.
 select jsonb_agg(jsonb_build_object('parentId',p->'Id','linkId',value->'linkId','latestPublishedVersionId',value->'versionId','isLatest',true,'nativeBytesVerified',true,'entryHash',public.xero_document_correction_hash_v1(value)) order by ord)
   into ids from jsonb_array_elements(f#>'{attachmentManifest,entries}') with ordinality z(value,ord);
 expected:=d||jsonb_build_object('sourceHash',public.xero_document_correction_hash_v1(s),'targetHash',public.xero_document_correction_hash_v1(r),
   'fileHash',public.xero_document_correction_hash_v1(f),'currentFilesHash',public.xero_document_correction_hash_v1(ids),'documentaryBinding',d,
   'safetyContextHash',public.xero_document_correction_hash_v1(s->'safetyContext'),'observationActorId',lower(obs->>'actorId'),
   'identityHash',public.xero_document_correction_hash_v1(scope),'mappingHash',public.xero_document_correction_hash_v1(jsonb_build_object('productMappings',a->'productMappings','accountTax',a->'accountTax')),
   'buyerDateResolutionHash',public.xero_document_correction_hash_v1(a->'buyerDateResolution'),'settlementHash',public.xero_document_correction_hash_v1(settlement));
 if b is distinct from expected or reg->'binding' is distinct from d or reg->>'purpose' is distinct from 'documentary_review_registration'
   or reg->>'policyVersion' is distinct from policy or reg->>'reviewer' is distinct from rev->>'reviewer' or reg->>'reviewedAt' is distinct from rev->>'reviewedAt'
   or reg->>'approvedReviewRecordHash' is distinct from d->>'approvedReviewRecordHash' or reg->'financialApprovalGranted' is distinct from 'false'::jsonb
   or reg ? 'actorId' or reg ? 'registrationId' or obs->>'purpose' is distinct from 'current_aggregate_observation'
   or obs->>'coverageScope' is distinct from scope#>>'{coverage,scope}'
   or (select count(*) from jsonb_array_elements(reg->'cases') where value=jsonb_build_object('sourceId',p->'Id','targetId',r->'InvoiceID'))<>1
   or reg->'cases' is distinct from obs->'cases' then raise exception 'Independent documentary/current provenance binding changed' using errcode='40001'; end if;
end $$;

-- Documentary registration is proof, not link approval. Only a separately
-- approved dedicated processing run grants this local identity-only action.
create function public.link_xero_aggregate_supplier_document_v3(
 p_run_id uuid,p_expected_run_revision integer,p_item_id uuid,p_expected_item_updated_at timestamptz,
 p_tenant_id uuid,p_review jsonb,p_actor_id uuid,p_actor_email text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_run public.xero_financial_sync_runs; v_item public.xero_financial_sync_items;
 v_mapping public.xero_financial_document_mappings; v_product public.xero_financial_product_mappings;
 v_source jsonb; v_saved jsonb; v_evidence jsonb:=p_review->'evidence'; a jsonb:=v_evidence->'accounting';
 raw_source jsonb:=a->'source'; raw_parent jsonb:=raw_source->'parent'; raw_target jsonb:=a->'target';
 v_current jsonb:=v_evidence#>'{observations,currentObservation}'; v_registration jsonb:=v_evidence#>'{observations,registeredReview}';
 v_retained jsonb; v_acceptance jsonb; v_expected jsonb; v_audit jsonb; row jsonb; v_count integer:=0;
 v_now timestamptz:=clock_timestamp(); v_at timestamptz; v_source_id text; v_target text; v_contact text; k text;
 policy constant text:='issued_petroleum_preserve_v3'; hashpat constant text:='^[a-f0-9]{64}$';
begin
 if current_user is distinct from 'service_role' then raise exception 'Aggregate preservation requires the service role' using errcode='42501'; end if;
 if p_run_id is null or p_item_id is null or p_tenant_id is null or p_actor_id is null or p_expected_run_revision is null
   or p_expected_run_revision<1 or p_expected_item_updated_at is null or p_actor_id='00000000-0000-0000-0000-000000000000'
   or p_tenant_id='00000000-0000-0000-0000-000000000000' or length(btrim(coalesce(p_actor_email,''))) not between 1 and 320
   or jsonb_typeof(p_review) is distinct from 'object' or octet_length(p_review::text)>4000000
   or (select count(*) from jsonb_object_keys(p_review))<>9
   or not(p_review ?& array['policyVersion','fingerprint','evidenceFingerprint','approvalMaterialHash','reviewFingerprint','legacyReviewFingerprint','evidence','accountingCanonical','evidenceCanonical'])
   or p_review->>'policyVersion' is distinct from policy then raise exception 'Invalid aggregate preservation transaction scope' using errcode='40001'; end if;
 foreach k in array array['fingerprint','evidenceFingerprint','approvalMaterialHash','reviewFingerprint','legacyReviewFingerprint'] loop
   if coalesce(p_review->>k,'') !~ hashpat then raise exception 'Missing aggregate review fingerprint' using errcode='40001'; end if;
 end loop;
 if p_review->>'accountingCanonical' is distinct from public.xero_document_correction_canonical_v1(jsonb_build_object('policyVersion',policy,'accounting',a))
   or p_review->>'evidenceCanonical' is distinct from public.xero_document_correction_canonical_v1(v_evidence)
   or p_review->>'fingerprint' is distinct from public.xero_document_correction_hash_v1(jsonb_build_object('policyVersion',policy,'accounting',a))
   or p_review->>'evidenceFingerprint' is distinct from public.xero_document_correction_hash_v1(v_evidence)
   or p_review->>'approvalMaterialHash' is distinct from public.xero_document_correction_hash_v1(public.xero_aggregate_supplier_approval_material_v3(v_evidence)) then raise exception 'Aggregate canonical proof or stable material differs' using errcode='40001'; end if;
 -- Global accounting writer barrier is acquired BEFORE tuple locks, sharing the
 -- existing correction/run/payment writer order. Unique ownership indexes still
 -- protect against writers not participating in advisory serialization.
 perform public.xero_document_correction_lock_v1();
 select * into v_run from public.xero_financial_sync_runs where id=p_run_id for update;
 select * into v_item from public.xero_financial_sync_items where id=p_item_id and run_id=p_run_id for update;
 if v_run.id is null or v_item.id is null or v_run.mode is distinct from 'preview'
   or v_run.control_totals->>'preservationPolicy' is distinct from policy
   or v_run.reviewed_by is distinct from p_actor_id or lower(btrim(v_run.reviewed_by_email)) is distinct from lower(btrim(p_actor_email))
   or v_run.reviewed_at is null or not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=p_tenant_id::text)
   or a->>'tenantId' is distinct from p_tenant_id::text then raise exception 'Dedicated reviewed run, actor or tenant changed' using errcode='40001'; end if;
 v_source:=v_item.source_payload;v_saved:=v_source->'aggregateSupplierReview';
 v_source_id:=public.xero_grouped_salesforce_id_v1(v_source->>'salesforceId');v_target:=lower(raw_target->>'InvoiceID');v_contact:=lower(raw_target#>>'{Contact,ContactID}');
 if v_item.source_object is distinct from 'Supplier_Invoice__c' or v_item.source_type is distinct from 'supplier_bill'
   or v_source->>'salesforceObject' is distinct from v_item.source_object or v_source->>'documentKind' is distinct from v_item.source_type
   or v_source_id is null or v_source_id is distinct from public.xero_grouped_salesforce_id_v1(v_item.source_id)
   or v_source_id is distinct from public.xero_grouped_salesforce_id_v1(raw_parent->>'Id')
   or public.xero_grouped_salesforce_id_v1(v_source->>'accountId') is distinct from public.xero_grouped_salesforce_id_v1(raw_parent->>'Supplier__c')
   or public.xero_grouped_salesforce_id_v1(v_source->>'stemId') is distinct from public.xero_grouped_salesforce_id_v1(raw_parent->>'STEM__c')
   or v_source->>'sourceFingerprint' is distinct from raw_source->>'sourceFingerprint' or v_source->>'financialFingerprint' is distinct from raw_source->>'financialFingerprint'
   or v_source->>'documentNumber' is distinct from raw_parent->>'Name' or v_item.source_document_number is distinct from raw_parent->>'Name'
   or v_item.currency is distinct from 'USD' or v_source->>'currency' is distinct from 'USD'
   or v_source->>'xeroType' is distinct from 'ACCPAY' or v_source->>'contactId' is distinct from v_contact
   or v_item.source_total is distinct from public.xero_aggregate_supplier_money_v3(raw_parent->'Invoice_Amount__c')
   or public.xero_aggregate_supplier_money_v3(v_source->'total') is distinct from v_item.source_total
   or v_item.xero_payload is distinct from raw_target or lower(v_item.xero_document_id) is distinct from v_target
   or v_item.xero_document_status is distinct from 'AUTHORISED'
   or coalesce(v_target,'') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or coalesce(v_contact,'') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or v_item.proposed_action is distinct from 'protected_legacy' or v_item.selected is distinct from true
   or v_item.proposed_payload is distinct from 'null'::jsonb or v_item.blockers is distinct from '[]'::jsonb
   or v_item.mutation_attempts is distinct from 0 or v_item.error_code is not null or v_item.error_message is not null
   or v_source#>>'{issuedSupplierPreservation,policyVersion}' is distinct from policy
   or v_source#>'{issuedSupplierPreservation,proofValid}' is distinct from 'true'::jsonb
   or v_source#>'{issuedSupplierPreservation,accepted}' is distinct from 'false'::jsonb
   or v_source#>'{issuedSupplierPreservation,requiresExplicitReview}' is distinct from 'true'::jsonb
   or v_source#>'{issuedSupplierPreservation,workflowEligible}' is distinct from 'false'::jsonb
   or v_source#>'{issuedSupplierPreservation,approvalGranted}' is distinct from 'false'::jsonb then raise exception 'Original selected aggregate item or non-executable marker changed' using errcode='40001'; end if;
 -- Original preview envelope is never replaced. Exactly two fresh observation
 -- times may differ; every other fact, including current actors and bindings,
 -- documentary reviewer/reviewedAt and full raw coverage, remains exact approval.
 if jsonb_typeof(v_saved) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_saved))<>9
   or v_saved->>'policyVersion' is distinct from policy
   or v_saved->>'accountingCanonical' is distinct from p_review->>'accountingCanonical'
   or v_saved->>'fingerprint' is distinct from p_review->>'fingerprint'
   or v_saved->>'reviewFingerprint' is distinct from p_review->>'reviewFingerprint'
   or v_saved->>'legacyReviewFingerprint' is distinct from p_review->>'legacyReviewFingerprint'
   or v_saved->>'approvalMaterialHash' is distinct from p_review->>'approvalMaterialHash'
   or v_saved->>'evidenceCanonical' is distinct from public.xero_document_correction_canonical_v1(v_saved->'evidence')
   or v_saved->>'evidenceFingerprint' is distinct from public.xero_document_correction_hash_v1(v_saved->'evidence')
   or public.xero_aggregate_supplier_approval_material_v3(v_saved->'evidence') is distinct from public.xero_aggregate_supplier_approval_material_v3(v_evidence)
   or v_source->>'issuedSupplierReviewFingerprint' is distinct from p_review->>'reviewFingerprint'
   or v_source#>>'{issuedSupplierPreservation,fingerprint}' is distinct from p_review->>'fingerprint'
   or v_source#>>'{issuedSupplierPreservation,evidenceFingerprint}' is distinct from v_saved->>'evidenceFingerprint'
   or v_source#>>'{issuedSupplierPreservation,approvalMaterialHash}' is distinct from p_review->>'approvalMaterialHash' then raise exception 'Approved stable aggregate material changed' using errcode='40001'; end if;
 perform public.xero_aggregate_supplier_assert_v3(v_evidence);
 if v_current->>'actorId' is distinct from p_actor_id::text or v_current#>>'{binding,observationActorId}' is distinct from p_actor_id::text then raise exception 'Current observation actor is not the authenticated execution actor' using errcode='40001'; end if;
 v_acceptance:=jsonb_build_object('runId',p_run_id,'itemId',p_item_id,'runRevision',p_expected_run_revision,'itemUpdatedAt',p_expected_item_updated_at,'actorId',p_actor_id,'actorEmail',lower(btrim(p_actor_email)));
 v_retained:=jsonb_build_object('differences',v_item.differences,'stemId',v_source->'stemId','accountId',v_source->'accountId','reviewFingerprint',p_review->'legacyReviewFingerprint',
   'issuedSupplierPreservation',jsonb_build_object('policyVersion',policy,'fingerprint',p_review->'fingerprint','approvalMaterialHash',p_review->'approvalMaterialHash',
     'previewEvidenceFingerprint',v_saved->'evidenceFingerprint','executionEvidenceFingerprint',p_review->'evidenceFingerprint',
     'originalPreviewReview',v_saved,'executionReview',p_review,'acceptance',v_acceptance,'reviewedXero',raw_target));
 v_expected:=jsonb_build_object('salesforce_object',v_item.source_object,'salesforce_id',v_source->>'salesforceId','salesforce_document_number',v_source->>'documentNumber',
   'document_kind','supplier_bill','xero_document_type','ACCPAY','xero_document_id',v_target,'xero_document_number',raw_target->>'InvoiceNumber','xero_contact_id',v_contact,
   'xero_status','AUTHORISED','source_fingerprint',v_source->>'sourceFingerprint','financial_fingerprint',v_source->>'financialFingerprint','protected_legacy',true,'retained_differences',v_retained);
 for v_mapping in select * from public.xero_financial_document_mappings where (salesforce_object=v_item.source_object and left(salesforce_id,15)=v_source_id)
   or lower(xero_document_id)=v_target order by id for update loop
   v_count:=v_count+1;
   if v_item.status is distinct from 'linked' or (to_jsonb(v_mapping)-'id'-'last_reconciled_at'-'created_at'-'updated_at') is distinct from v_expected then raise exception 'Source or target already has different ownership or receipt' using errcode='40001'; end if;
 end loop;
 if v_item.status='linked' then
   v_audit:=jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,'mappingId',v_mapping.id,'issuedSupplierPreservation',v_retained->'issuedSupplierPreservation');
   if v_count<>1 or v_item.applied_at is null or not exists(select 1 from public.xero_financial_audit_events where run_id=p_run_id
     and event_type='aggregate_supplier_document_preservation_linked' and outcome='success' and actor_id=p_actor_id and actor_email=lower(btrim(p_actor_email))
     and record_counts='{"linked":1,"applied":0,"financialWrites":0}'::jsonb and fingerprints=v_audit) then raise exception 'Identical durable aggregate receipt cannot be confirmed' using errcode='40001'; end if;
   return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',true,
     'approvalMaterialHash',p_review->'approvalMaterialHash','previewEvidenceFingerprint',v_saved->'evidenceFingerprint','executionEvidenceFingerprint',p_review->'evidenceFingerprint');
 end if;
 if v_run.status is distinct from 'processing' or v_run.revision is distinct from p_expected_run_revision or v_item.status is distinct from 'selected'
   or v_item.updated_at is distinct from p_expected_item_updated_at or v_item.applied_at is not null or v_count<>0
   or public.xero_document_correction_active_v1() then raise exception 'Aggregate revision or global correction writer changed' using errcode='40001'; end if;
 foreach k in array array['registeredReview','currentObservation'] loop
   v_at:=(v_evidence#>>array['observations',k,'at'])::timestamptz;
   if v_at is null or v_at<v_now-interval '5 minutes' or v_at>v_now+interval '30 seconds' then raise exception 'Fresh current provenance is stale or future-dated' using errcode='40001'; end if;
 end loop;
 if (v_registration->>'reviewedAt')::timestamptz>(v_registration->>'at')::timestamptz
   or (v_current->>'at')::timestamptz<v_run.reviewed_at then raise exception 'Current provenance predates independent review' using errcode='40001'; end if;
 -- Recheck live local product grants under row locks. Include disabled rows and
 -- all raw15/18 aliases, so a duplicate prefix cannot disappear in filtering.
 for row in select value from jsonb_array_elements(a->'productMappings') loop
   v_count:=0;
   for v_product in select * from public.xero_financial_product_mappings where direction='supplier' and left(salesforce_product_id,15)=left(row->>'salesforceProductId',15) order by id for share loop
     v_count:=v_count+1;
     if v_product.id::text is distinct from row->>'id' or not v_product.enabled or row->'enabled' is distinct from 'true'::jsonb
       or v_product.revision is distinct from (row->>'revision')::integer or v_product.xero_account_code is distinct from '51100' or row->>'xeroAccountCode' is distinct from '51100'
       or v_product.xero_tax_type is distinct from 'NONE' or row->>'xeroTaxType' is distinct from 'NONE' or row->>'direction' is distinct from 'supplier'
       or v_product.approved_by is null or v_product.approved_by::text is distinct from row->>'approvedBy'
       or lower(btrim(v_product.approved_by_email)) is distinct from lower(btrim(row->>'approvedByEmail')) or v_product.approved_at is null
       or v_product.approved_at is distinct from (row->>'approvedAt')::timestamptz then raise exception 'Current approved product revision changed' using errcode='40001'; end if;
   end loop;
   if v_count<>1 then raise exception 'Current product prefix grant is missing or ambiguous' using errcode='40001'; end if;
 end loop;
 if jsonb_array_length(a->'productMappings')<>(select count(distinct coalesce(value->>'Product__c',value->>'Product2Id__c')) from jsonb_array_elements((raw_source->'children')||(raw_source->'charges')) where value->'IsDeleted'='false'::jsonb and value->'Cancelled__c'='false'::jsonb)
   or exists(select 1 from jsonb_array_elements((raw_source->'children')||(raw_source->'charges')) z(value) where value->'IsDeleted'='false'::jsonb and value->'Cancelled__c'='false'::jsonb
      and not exists(select 1 from jsonb_array_elements(a->'productMappings') m(value) where left(m.value->>'salesforceProductId',15)=left(coalesce(z.value->>'Product__c',z.value->>'Product2Id__c'),15))) then raise exception 'Current product grants are not exhaustive' using errcode='40001'; end if;
 insert into public.xero_financial_document_mappings(salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences,last_reconciled_at,created_at,updated_at)
 values(v_item.source_object,v_source->>'salesforceId',v_source->>'documentNumber','supplier_bill','ACCPAY',v_target,raw_target->>'InvoiceNumber',v_contact,'AUTHORISED',v_source->>'sourceFingerprint',v_source->>'financialFingerprint',true,v_retained,v_now,v_now,v_now) returning * into v_mapping;
 v_audit:=jsonb_build_object('tenantId',p_tenant_id,'itemId',p_item_id,'mappingId',v_mapping.id,'issuedSupplierPreservation',v_retained->'issuedSupplierPreservation');
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
 values(p_run_id,'aggregate_supplier_document_preservation_linked','success',p_actor_id,lower(btrim(p_actor_email)),
   '{"linked":1,"applied":0,"financialWrites":0}',v_audit);
 update public.xero_financial_sync_items set status='linked',applied_at=v_now,updated_at=v_now where id=p_item_id;
 return jsonb_build_object('id',p_item_id,'status','linked','xeroDocumentId',v_target,'mappingId',v_mapping.id,'alreadyLinked',false,
   'approvalMaterialHash',p_review->'approvalMaterialHash','previewEvidenceFingerprint',v_saved->'evidenceFingerprint','executionEvidenceFingerprint',p_review->'evidenceFingerprint');
end $$;

revoke all on function public.xero_aggregate_supplier_approval_material_v3(jsonb),public.xero_aggregate_supplier_money_v3(jsonb),public.xero_aggregate_supplier_assert_v3(jsonb),public.xero_aggregate_supplier_calendar_date_v3(jsonb,text),public.link_xero_aggregate_supplier_document_v3(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.xero_aggregate_supplier_approval_material_v3(jsonb),public.xero_aggregate_supplier_money_v3(jsonb),public.xero_aggregate_supplier_assert_v3(jsonb),public.xero_aggregate_supplier_calendar_date_v3(jsonb,text),public.link_xero_aggregate_supplier_document_v3(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) to service_role;
comment on function public.link_xero_aggregate_supplier_document_v3(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text) is 'Service-only atomic local link for separately approved raw aggregate supplier v3 zero-settlement proof; retains immutable preview and execution evidence; no provider financial writes.';
