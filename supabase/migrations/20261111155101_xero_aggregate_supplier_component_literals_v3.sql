create or replace function public.xero_aggregate_supplier_assert_v3(p_evidence jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 a jsonb:=p_evidence->'accounting'; s jsonb:=a->'source'; p jsonb:=s->'parent'; r jsonb:=a->'target'; f jsonb:=a->'issuedFile';
 scope jsonb:=a->'identityScope'; rev jsonb:=f->'review'; reg jsonb:=p_evidence#>'{observations,registeredReview}'; obs jsonb:=p_evidence#>'{observations,currentObservation}';
 b jsonb:=obs->'binding'; d jsonb; expected jsonb; settlement jsonb; collections jsonb:='{}'; row jsonb; child jsonb; product jsonb; comp jsonb; line jsonb; edge jsonb; e jsonb; fuel jsonb; proof jsonb;
 money numeric; qty numeric; price numeric; amount numeric; total numeric; sum_source numeric:=0; sum_paper numeric:=0; sum_component numeric; actual numeric; count_fuel integer:=0; count_charge integer:=0; n integer; object_name text; k text;
 children jsonb; active_rows jsonb:='[]'; selected_buyers jsonb:='[]'; linked jsonb; delivery text; invoice_date text; itemkey text; ids jsonb; linked_ids jsonb;
 component_literals jsonb; literal jsonb; has_component_literals boolean;
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
 -- Optional exact literal pairs are material facts, not registration authority.
 -- Retain the independently bound full review/self-hash/provenance below.
 has_component_literals:=(rev->'identityFacts') ? 'componentLiterals';
 if has_component_literals then
   component_literals:=rev#>'{identityFacts,componentLiterals}';
   if jsonb_typeof(component_literals) is distinct from 'array' then raise exception 'Component literal review must be an exact complete array' using errcode='40001'; end if;
   if jsonb_array_length(component_literals)<>jsonb_array_length(rev->'components')
     or exists(select 1 from jsonb_array_elements(rev->'components') with ordinality c(value,ord) where value->'ordinal' is distinct from to_jsonb(ord))
     or jsonb_array_length(component_literals)<>(select count(distinct value->>'componentId') from jsonb_array_elements(component_literals))
     or exists(select 1 from jsonb_array_elements(component_literals) z(value)
       where (select count(*) from jsonb_array_elements(rev->'components') c(value) where c.value->>'id'=z.value->>'componentId')<>1)
     then raise exception 'Component literal review coverage is missing, duplicate or foreign' using errcode='40001'; end if;
   for literal in select value from jsonb_array_elements(component_literals) loop
     if jsonb_typeof(literal) is distinct from 'object' then raise exception 'Component literal review entry must be an object' using errcode='40001'; end if;
     if (select count(*) from jsonb_object_keys(literal))<>6 or not(literal ?& array['componentId','printedSeller','printedBuyer','printedVessel','independentEvidence','reviewRecordHash'])
       then raise exception 'Component literal review requires exactly six fields' using errcode='40001'; end if;
     foreach k in array array['componentId','printedSeller','printedBuyer','printedVessel','independentEvidence'] loop
       -- JS length counts UTF-16 code units; non-BMP characters count twice.
       -- The trim set mirrors ECMAScript whitespace, and only ASCII controls
       -- are prohibited, exactly as in the pure documentary text predicate.
       if jsonb_typeof(literal->k) is distinct from 'string'
         or char_length(literal->>k)*2-char_length(regexp_replace(literal->>k,'['||chr(65536)||'-'||chr(1114111)||']','','g'))>2000
         or nullif(btrim(literal->>k,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') is null
         or literal->>k ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']')
         then raise exception 'Component literal review contains an invalid bounded string' using errcode='40001'; end if;
     end loop;
     if jsonb_typeof(literal->'reviewRecordHash') is distinct from 'string' or coalesce(literal->>'reviewRecordHash','') !~ hashpat
       or literal->>'reviewRecordHash' is distinct from public.xero_document_correction_hash_v1(jsonb_build_object(
         'policyVersion',policy,'componentId',literal->'componentId','sourceSeller',rev#>'{identityFacts,sourceSeller}',
         'actualBuyerLegalIdentity',rev#>'{identityFacts,actualBuyerLegalIdentity}','sourceVessel',rev#>'{identityFacts,sourceVessel}',
         'printedSeller',literal->'printedSeller','printedBuyer',literal->'printedBuyer','printedVessel',literal->'printedVessel','independentEvidence',literal->'independentEvidence'))
       then raise exception 'Component literal review material hash changed' using errcode='40001'; end if;
   end loop;
   if rev#>>'{identityFacts,sourceSeller}' is distinct from p#>>'{Supplier__r,Name}'
     or rev#>>'{identityFacts,printedSeller}' is distinct from rev#>>'{components,0,sellerName}'
     or rev#>>'{identityFacts,printedBuyer}' is distinct from rev#>>'{components,0,buyerName}'
     or rev#>>'{identityFacts,printedVessel}' is distinct from rev#>>'{components,0,vessel}'
     then raise exception 'Component literal first anchors or verified source seller changed' using errcode='40001'; end if;
 end if;
 for comp in select value from jsonb_array_elements(rev->'components') loop
   if has_component_literals then select value into literal from jsonb_array_elements(component_literals) where value->>'componentId'=comp->>'id';
   else literal:=rev->'identityFacts'; end if;
   if coalesce(comp->>'documentType','') not in ('INVOICE','FINAL INVOICE','PROFORMA INVOICE') or comp->>'currency' is distinct from 'USD'
     or comp->>'sellerName' is distinct from literal->>'printedSeller' or comp->>'buyerName' is distinct from literal->>'printedBuyer'
     or comp->>'vessel' is distinct from literal->>'printedVessel' or comp->>'sourceToken' not in(select value#>>'{}' from jsonb_array_elements(rev->'sourceTokens'))
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

revoke all on function public.xero_aggregate_supplier_assert_v3(jsonb) from public,anon,authenticated;
grant execute on function public.xero_aggregate_supplier_assert_v3(jsonb) to service_role;
