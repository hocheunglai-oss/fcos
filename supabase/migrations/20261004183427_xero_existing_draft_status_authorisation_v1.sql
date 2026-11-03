-- Exact human-approved 54 existing drafts; this is status authorisation, not
-- document linking, payment authority, sending, or financial payload rebuilding.
-- Freshness/completeness belongs to the trusted server collector. SQL binds its
-- originals and independently enforces approval, ownership and durable writes.
create function public.xero_existing_draft_ascii_canonical_v1(p_value jsonb)
returns text language plpgsql immutable security invoker set search_path=pg_catalog,pg_temp as $$
declare raw text:=public.xero_document_correction_canonical_v1(p_value); out text:=''; cp integer; i integer;
begin
 if p_value is null then raise exception 'Approved original JSON required' using errcode='22023'; end if;
 for i in 1..length(raw) loop
  cp:=ascii(substr(raw,i,1));
  if cp<127 then out:=out||substr(raw,i,1);
  elsif cp<=65535 then out:=out||chr(92)||'u'||lpad(to_hex(cp),4,'0');
  else cp:=cp-65536;out:=out||chr(92)||'u'||to_hex(55296+cp/1024)||chr(92)||'u'||to_hex(56320+cp%1024); end if;
 end loop;
 return out;
end $$;
create table public.xero_existing_draft_authorisation_approved_records (
 target_id uuid primary key,tenant_id uuid not null,source_object text not null,source_id text not null,
 selection jsonb not null,reviewed_target jsonb not null,reviewed_target_canonical text not null,
 reviewed_target_hash text not null check(reviewed_target_hash~'^[a-f0-9]{64}$'),
 unique(source_object,source_id),
 check(jsonb_typeof(selection)='object' and selection ?& array['selectionFileSha256','selectionSha256','humanApprovalSha256','record'] and (selection-'selectionFileSha256'-'selectionSha256'-'humanApprovalSha256'-'record')='{}'::jsonb),
 check(jsonb_typeof(selection->'record')='object' and public.xero_document_correction_hash_v1(jsonb_build_object('tenantId',tenant_id,'record',selection->'record'))=any(array['067513544589c14577a09faaed9b54ffe45f3545b3ac655739cc8ee3da6d730e','07e1ab535495de50d0e7aa69e3d4c2334b3060bd6e3e9de5c8652f906194a6a1','0e0f44c9bf3561e4d79053e454b2f81e14efb551cd4c53cb1d5db81547dc1db3','1d46c43a3c6166cf57f95e0945a2ee0d3d4527ba052eb03b0a5d3904abc12a44','1f778ff2fa76a8a629013d2187540c3b22c25a0f59f5e8f28f932c3b9c9c146f','24519e2b9f1adebc887c1d66febebe8bc101a5de9ef7eab0e3bada06926c22af','28efd46c94906be69fba1c0d047f12f9b60ccd087483fed1948fa2c83feffb59','29233f1ff50bd2670dbbc9344dd338a9ac7a125a0061632d5afa6c167de85662','2bd8d04c574cda5b00bfd6156d1909305d11a093fed05c664077b3134a70e50e','347cb7f65822ec77eb841239bac810a29ab3f83c1ead80b3bb576599a20bfd51','411f5d6c5e23fe59558101e33790ea157335ea021e7c18b2c10137cf79f094a0','45a59a50a2ef4fbc7840c8a837bd96316021585ef54fd02dd5d6862513036d13','46daea265967c9050a19b88a7193222fccb631ff8009a74c59c5b036882431ce','4de511c1721a49128d0a2434d7658ba5b7ec84d20dec9c46e52b962de121c446','5660c0a10d87a567dc801f904b6b1309a583c613e279a8844d6eb80ced6af0e6','57f1eb6f5c0e62944dbfb5904e9def86eb3f88a79f9059a82990f2804915220c','5b0713e0bd4e2c74fde2386953806b1634c7df06738b2760ef174450d181a967','5fc27546e1d4907ebfee44da6f3a836e232421a014ef9b3086f6f79f9d7d784f','607bf69e18d131797eeed2e3e0f1b8f043d815088ea7727a57914ac48bc88da8','657c3941f7b4b2991ece4627d81ed849449126b752261e9a739a6055ab7a85c6','6a0d579a93f0d6730e9d9e231641b5de0fb64c9e08d8629dad71a0676844a0d9','6a502a19d86155e8dd2c85c0d2670a5e5a823103cbfffb61b1429014ac7ad122','6fe04ddd5c593f0c688c2268859dec491eaab78f9932216499972fc4257192d2','70c06a9e53bb9e9b01703bc4bc2423ff554a2ff11196044690b822c2bb36a85d','73adbc47aaea51c005b1d4e425ff19985d09b46229ad324eed13f3b85f1cc2c0','73f1dc2d7b8432d2bf1fae138c3cf753bda5085872b8ec760917b8935487fa87','779b809858862e3b69baba6e922e97a6cca361d1c6cd9c25ac8246adf802df6d','7bef7c049b993583e235ca566c1a4b7dd93e475b19c8db3e25b6a1cc45567099','809651dd3b1ee7b74b926ea401c25f8411819d49d6caa7f217d6a83e744f059b','8246d09f8e8119b04754b5c02fc6526bd47e29d8f7868a85960b72d7c7caa44d','896f50054100933dd381a58f4febdd0e30c56fdba3053bd3f42402e5ed4df581','8b198e5c642f4ac40b9e2f295815a8f5cb3dcdf359340f11446f39375bce280b','8ec2aaf2f4968edb7d13c1180add629f8b6a96aa7614bab16d0686afb5030f09','9304b212cb318fca1a7c921764841d05f57eace2bb51ad7ed15cbbb70e9dad65','95ad07fc7de1622a4a5d0be0df863f6ef75fd98cd2d3f051f43a8f53aa68eb9c','9a22df82b6f3716322fbde8685cce1cebf45bfe64329d5b76d223c28274c2358','9bb04cf4d02bb417266cc7b3fef05c20a93d4bc3eccdf8b5520ea11dc5243dcc','9be7a9f62dd4840cdcb105bd970307aa8e65e93e83801be1da3058497f189264','9be8db264a9d17b496df9addf037fba36f0a1e0857fa809ec5c5eece76e09f74','9c3922cde20f8473c039cb720fe83391afa2628dee242b3d7b6ab58aa2f26a72','a6d6cc8d95eff36942730fea81c29384b6f83b766a156829819c67ee8e07bab7','a7eb61603d8b2e32c9ec087093799cdfe6bd3ce7c9f394f266ce0dcc9d1e52ce','b02510361f1bed431baa4b6a86672525a5d0be73e23db247e62c3af5f8b5d46a','c33ecec19045768c2948418764bd2909ea939eb479eb5425ff46260384b6a188','c77a2166311b5b1216cce78107ac82775fad9c0618f4e0ab68b9d13d2480caf5','ce7e58585336cef590b5409ec57f3d1ceee1d71001c665691d798725438e5e19','d089da4702acf51833aa2dcccd59b6fc173a0c5cd679c18da53cfc9c2aa710a1','e0c8381158462f659efa67c44a938f866c4d479070b8afc93b0cbf99c1ac2037','e14bbb70ef94cff90b9aeabb04d2ddc9eb93f49dc6d8527e0f46d71989825925','f5117caa36f90e2574d0e9d00c55e6bf904d1598befca5bed7e26fd4081e6f46','f55d4beff997567846476ab96e920a431486a0317d93f3ab04b6d5073eee40de','faa7333b07e0048308000799341393dcabdc1991ca656d37501c6bbfe34c45a5','fc669436be630c8371b7d3b213f2f4bd67cd4f24d468d46769f904755f49141f','fec6f28482c0cf3b8cdf74a0dae1be42bb81671be2b27b481bdb9858a5b3b111' ])),
 check(selection#>>'{record,targetId}'=target_id::text and selection#>>'{record,sourceObject}'=source_object and selection#>>'{record,sourceId}'=source_id and selection#>>'{record,rawTargetSha256}'=reviewed_target_hash),
 check(reviewed_target->>'InvoiceID'=target_id::text and reviewed_target->>'Status'='DRAFT' and jsonb_typeof(reviewed_target)='object'),
 check((selection->>'selectionFileSha256') is not distinct from '6230b2578549e33b67555931391e9cdd943d5134377eebc357e2b0e46b1e7a24'),
 check((selection->>'selectionSha256') is not distinct from 'b3414d1d6f3bfe9e8c17e515d04ecbbe9cb216dac2bb2ec1ee4da30a53dd8506'),
 check((selection->>'humanApprovalSha256') is not distinct from 'f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004'),
 check(reviewed_target_canonical::jsonb=reviewed_target and reviewed_target_canonical=public.xero_existing_draft_ascii_canonical_v1(reviewed_target)),
 check(encode(sha256(convert_to(reviewed_target_canonical,'UTF8')),'hex')=reviewed_target_hash)
);
create table public.xero_existing_draft_authorisation_claims (
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.xero_financial_sync_runs(id),
 item_id uuid not null references public.xero_financial_sync_items(id),run_revision integer not null,item_updated_at timestamptz not null,
 tenant_id uuid not null,target_id uuid not null references public.xero_existing_draft_authorisation_approved_records(target_id),
 mapping_id uuid not null references public.xero_financial_document_mappings(id),idempotency_key text not null,
 evidence jsonb not null,evidence_canonical text not null,evidence_hash text not null,
 preview_evidence_hash text not null,mapping_snapshot jsonb not null,item_snapshot jsonb not null,
 actor_id uuid not null,actor_email text not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,idempotency_key),unique(run_id,item_id)
);
create table public.xero_existing_draft_authorisation_requests (
 claim_id uuid primary key references public.xero_existing_draft_authorisation_claims(id),
 request_id uuid not null unique,budget_id uuid not null references public.xero_shared_budgets(id),token_version integer not null,
 resource_path text not null,payload jsonb not null,actor_id uuid not null,actor_email text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.xero_existing_draft_authorisation_events (
 id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,
 claim_id uuid not null references public.xero_existing_draft_authorisation_claims(id),
 status text not null check(status in('confirmed','rejected','uncertain')),evidence jsonb not null,
 evidence_canonical text not null,evidence_hash text not null,receipt jsonb not null,
 actor_id uuid not null,actor_email text not null,created_at timestamptz not null default clock_timestamp()
);
create unique index xero_existing_draft_authorisation_terminal on public.xero_existing_draft_authorisation_events(claim_id) where status in('confirmed','rejected');
create index xero_existing_draft_authorisation_target on public.xero_existing_draft_authorisation_claims(tenant_id,target_id);
-- Keep the previous correction predicate unchanged and add unresolved status intents.
create or replace function public.xero_document_correction_active_v1()
returns boolean language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from public.xero_document_field_correction_claims c where not exists(
  select 1 from public.xero_document_field_correction_events e where e.claim_id=c.id and e.status in('confirmed','rejected')))
 or exists(select 1 from public.xero_existing_draft_authorisation_claims c where not exists(
  select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=c.id and e.status in('confirmed','rejected')));
$$;
create function public.xero_existing_draft_hash_assert_v1(p_value jsonb,p_canonical text,p_hash text)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_supplier_financial_json_bound_v1(p_value);
 if p_canonical is null or octet_length(p_canonical)>1000000 or coalesce(p_hash,'')!~'^[a-f0-9]{64}$'
  or p_canonical is distinct from public.xero_document_correction_canonical_v1(p_value)
  or p_canonical::jsonb is distinct from p_value or p_hash is distinct from encode(sha256(convert_to(p_canonical,'UTF8')),'hex') then
  raise exception 'Whole original canonical/hash mismatch' using errcode='40001'; end if;
end $$;
create function public.xero_existing_draft_timestamp_assert_v1(p_target jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare raw text; ts timestamptz; ms numeric; k text;
begin
 foreach k in array array['UpdatedDateUTC','UpdatedDateUTCString'] loop
  if p_target ? k then
   raw:=p_target->>k;
   if jsonb_typeof(p_target->k) is distinct from 'string' then raise exception 'Invalid top update timestamp' using errcode='40001'; end if;
   if k='UpdatedDateUTC' and raw~'^/Date\([0-9]{1,15}([+]0000)?\)/$' then
    ms:=substring(raw from '[0-9]{1,15}')::numeric;ts:=to_timestamp(ms/1000);
   elsif raw~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{3})?Z$' then
    if not public.xero_document_correction_date_v1(left(raw,10)) then raise exception 'Invalid top update date' using errcode='40001'; end if;
    ts:=raw::timestamptz;
   else raise exception 'Invalid top update timestamp' using errcode='40001'; end if;
   if ts<'2000-01-01'::timestamptz or ts>clock_timestamp()+interval '5 minutes' then raise exception 'Top update timestamp outside supported bounds' using errcode='40001'; end if;
  end if;
 end loop;
 if p_target ?& array['UpdatedDateUTC','UpdatedDateUTCString'] and p_target->>'UpdatedDateUTC'~'^/Date\(' then
  ms:=substring(p_target->>'UpdatedDateUTC' from '[0-9]{1,15}')::numeric;
  if floor(extract(epoch from (p_target->>'UpdatedDateUTCString')::timestamptz))<>floor(ms/1000) then raise exception 'Top update timestamp aliases disagree' using errcode='40001'; end if;
 end if;
end $$;
create function public.xero_existing_draft_preserved_v1(p_before jsonb,p_observed jsonb,p_status text)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare before_ms numeric;after_ms numeric;
begin
 perform public.xero_supplier_financial_json_bound_v1(p_observed);
 perform public.xero_existing_draft_timestamp_assert_v1(p_before);perform public.xero_existing_draft_timestamp_assert_v1(p_observed);
 before_ms:=case when p_before->>'UpdatedDateUTC'~'^/Date\(' then substring(p_before->>'UpdatedDateUTC' from '[0-9]{1,15}')::numeric when p_before ? 'UpdatedDateUTC' then extract(epoch from (p_before->>'UpdatedDateUTC')::timestamptz)*1000 when p_before ? 'UpdatedDateUTCString' then extract(epoch from (p_before->>'UpdatedDateUTCString')::timestamptz)*1000 end;
 after_ms:=case when p_observed->>'UpdatedDateUTC'~'^/Date\(' then substring(p_observed->>'UpdatedDateUTC' from '[0-9]{1,15}')::numeric when p_observed ? 'UpdatedDateUTC' then extract(epoch from (p_observed->>'UpdatedDateUTC')::timestamptz)*1000 when p_observed ? 'UpdatedDateUTCString' then extract(epoch from (p_observed->>'UpdatedDateUTCString')::timestamptz)*1000 end;
 if before_ms is not null and (after_ms is null or after_ms<before_ms) then raise exception 'Top update timestamp regressed or disappeared' using errcode='40001';end if;
 if p_observed->>'Status' is distinct from p_status
  or (p_before-'Status'-'UpdatedDateUTC'-'UpdatedDateUTCString') is distinct from (p_observed-'Status'-'UpdatedDateUTC'-'UpdatedDateUTCString') then
  raise exception 'Status readback changed protected original fields' using errcode='40001'; end if;
end $$;
create function public.xero_existing_draft_approved_subset_v1(p_approved jsonb,p_fresh jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog,pg_temp as $$
declare k text;v jsonb;i integer;
begin
 if jsonb_typeof(p_approved) is distinct from jsonb_typeof(p_fresh) then return false;end if;
 if jsonb_typeof(p_approved)='object' then
  for k,v in select key,value from jsonb_each(p_approved) loop
   if not(p_fresh ? k) or not public.xero_existing_draft_approved_subset_v1(v,p_fresh->k) then return false;end if;
  end loop;return true;
 elsif jsonb_typeof(p_approved)='array' then
  if jsonb_array_length(p_approved)<>jsonb_array_length(p_fresh) then return false;end if;
  for i in 0..jsonb_array_length(p_approved)-1 loop
   if not public.xero_existing_draft_approved_subset_v1(p_approved->i,p_fresh->i) then return false;end if;
  end loop;return true;
 end if;return p_approved is not distinct from p_fresh;
end $$;
create function public.xero_existing_draft_assert_v1(p_evidence jsonb,p_target uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare approved public.xero_existing_draft_authorisation_approved_records; b jsonb:=p_evidence->'before';
 r jsonb:=p_evidence->'reviewedTarget';s jsonb:=p_evidence->'source';c jsonb:=p_evidence->'current';
 v jsonb;k text;line jsonb;net bigint:=0;total bigint;org jsonb:=c->'organisation';
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_supplier_financial_json_bound_v1(p_evidence);
 select * into approved from public.xero_existing_draft_authorisation_approved_records where target_id=p_target;
 if approved.target_id is null or jsonb_typeof(p_evidence) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_evidence))<>7
  or not(p_evidence ?& array['policyVersion','selection','source','reviewedTarget','before','expectedAfter','current'])
  or p_evidence->>'policyVersion' is distinct from 'authorise_existing_xero_drafts_v1'
  or p_evidence->'selection' is distinct from approved.selection or r is distinct from approved.reviewed_target
  or jsonb_typeof(s) is distinct from 'object' or s->>'salesforceObject' is distinct from approved.source_object
  or s->>'salesforceId' is distinct from approved.source_id or s->>'currency' is distinct from 'USD'
  or s->>'xeroType' is distinct from r->>'Type' or s->>'contactId' is distinct from r#>>'{Contact,ContactID}'
  or coalesce(s->>'sourceFingerprint','')!~'^[a-f0-9]{64}$' or coalesce(s->>'financialFingerprint','')!~'^[a-f0-9]{64}$'
  or b->>'InvoiceID' is distinct from p_target::text or b->>'Status' is distinct from 'DRAFT'
  or b->>'CurrencyCode' is distinct from 'USD' or b->>'LineAmountTypes' is distinct from r->>'LineAmountTypes'
  or p_evidence->'expectedAfter' is distinct from jsonb_set(b,'{Status}','"AUTHORISED"'::jsonb)
  then raise exception 'Exact approved status evidence/source required' using errcode='40001'; end if;
  -- Same endpoint may expand metadata but never contradict an approved fact.
 if not public.xero_existing_draft_approved_subset_v1(r-'UpdatedDateUTC'-'UpdatedDateUTCString',b-'UpdatedDateUTC'-'UpdatedDateUTCString') then raise exception 'Approved original financial/header facts changed' using errcode='40001';end if;
 total:=public.xero_settled_supplier_cents_v1(b->'Total');
 if total<=0 or public.xero_settled_supplier_cents_v1(b->'AmountPaid')<>0 or public.xero_settled_supplier_cents_v1(b->'AmountCredited')<>0
  or public.xero_settled_supplier_cents_v1(b->'AmountDue')<>total or public.xero_settled_supplier_cents_v1(b->'CurrencyRate')<>100
  or public.xero_supplier_financial_cents_v1(s->'total')<>total or public.xero_supplier_financial_cents_v1(s->'signedTotal')<>total
  or public.xero_aggregate_supplier_calendar_date_v3(b,'Date') is null or public.xero_aggregate_supplier_calendar_date_v3(b,'DueDate') is null
  or public.xero_aggregate_supplier_calendar_date_v3(b,'Date')<'2026-01-01'
  or (b ? 'EnteredTotal' and public.xero_supplier_financial_cents_v1(b->'EnteredTotal')<>total)
  or b ? 'FullyPaidOnDate' or b ? 'Refunds' or b ? 'AmountRefunded' then raise exception 'Draft exact settlement/calendar changed' using errcode='40001'; end if;
 foreach k in array array['Payments','CreditNotes','Prepayments','Overpayments'] loop
  if jsonb_typeof(b->k) is distinct from 'array' or b->k is distinct from '[]'::jsonb then raise exception 'Explicit zero-settlement arrays required' using errcode='40001'; end if;
 end loop;
 foreach k in array array['HasErrors','HasValidationErrors','IsDeleted','SentToContact'] loop
  if b ? k and b->k is distinct from 'false'::jsonb then raise exception 'Draft errors/deletion/sending hold' using errcode='40001'; end if;
 end loop;
 if exists(with recursive nodes(value) as(
  select b union all select child.value from nodes n cross join lateral(
   select value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
  ) child) select 1 from nodes where jsonb_typeof(value)='object' and (value ? 'Refunds' or value ? 'AmountRefunded')) then
  raise exception 'Nested refund fields hold status authorisation' using errcode='40001';end if;
 if jsonb_typeof(b->'Contact') is distinct from 'object' then raise exception 'Full original contact required' using errcode='40001';end if;
 for v in select b union all select b->'Contact' union all select org union all select value from jsonb_array_elements(case when jsonb_typeof(b->'LineItems')='array' then b->'LineItems' else '[]'::jsonb end) loop
  foreach k in array array['HasErrors','HasValidationErrors','IsDeleted'] loop
   if v ? k and v->k is distinct from 'false'::jsonb then raise exception 'Target/contact/line error fields hold status authorisation' using errcode='40001';end if;
  end loop;
  if v ? 'ValidationErrors' and v->'ValidationErrors' is distinct from '[]'::jsonb then raise exception 'Target/contact/line validation errors hold status authorisation' using errcode='40001';end if;
 end loop;
 if jsonb_typeof(b->'LineItems') is distinct from 'array' or jsonb_array_length(b->'LineItems') not between 1 and 500 then raise exception 'Full protected target lines required' using errcode='40001'; end if;
 for line in select value from jsonb_array_elements(b->'LineItems') loop
  if not(approved.selection#>'{record,accountCodes}' ? (line->>'AccountCode')) or not(approved.selection#>'{record,taxTypes}' ? (line->>'TaxType')) then raise exception 'Approved target account/tax changed' using errcode='40001'; end if;
  net:=net+public.xero_supplier_financial_cents_v1(line->'LineAmount')+public.xero_supplier_financial_cents_v1(line->'TaxAmount');
 end loop;
 if net<>total or public.xero_supplier_financial_cents_v1(b->'SubTotal')<>total or public.xero_supplier_financial_cents_v1(b->'TotalTax')<>0
  or (b ? 'RoundingAmount' and public.xero_supplier_financial_cents_v1(b->'RoundingAmount')<>0) then raise exception 'Protected target signed lines/header do not sum exact total' using errcode='40001';end if;
 if jsonb_typeof(s->'lines') is distinct from 'array' or jsonb_array_length(s->'lines') not between 1 and 100 or s->'blockers' is distinct from '[]'::jsonb
  or s->>'postingMode' is distinct from 'draft' or s->>'xeroCollection' is distinct from 'Invoices'
  or coalesce(public.xero_grouped_salesforce_id_v1(s->>'accountId'),'') !~ '^001[A-Za-z0-9]{12}$'
  or coalesce(public.xero_grouped_salesforce_id_v1(s->>'stemId'),'') !~ '^a0H[A-Za-z0-9]{12}$' then raise exception 'Original ordinary source lines/identity required' using errcode='40001';end if;
 if (select count(distinct public.xero_grouped_salesforce_id_v1(value->>'sourceId')) from jsonb_array_elements(s->'lines'))<>jsonb_array_length(s->'lines') then raise exception 'Unique source line identities required' using errcode='40001';end if;
 for line in select value from jsonb_array_elements(s->'lines') loop
  if not(approved.selection#>'{record,accountCodes}' ? (line->>'accountCode')) or line->>'taxType' is distinct from 'NONE'
   or public.xero_aggregate_supplier_money_v3(line->'quantity')<=0 then raise exception 'Approved source account/tax/quantity changed' using errcode='40001';end if;
 end loop;
 if (select coalesce(jsonb_object_agg(bucket,amount),'{}'::jsonb) from (select value->>'accountCode' bucket,sum(round(public.xero_aggregate_supplier_money_v3(value->'quantity')*public.xero_aggregate_supplier_money_v3(value->'unitAmount')*100)) amount from jsonb_array_elements(s->'lines') group by 1) x)
  is distinct from (select coalesce(jsonb_object_agg(bucket,amount),'{}'::jsonb) from (select value->>'AccountCode' bucket,sum(public.xero_supplier_financial_cents_v1(value->'LineAmount')) amount from jsonb_array_elements(b->'LineItems') group by 1) x) then raise exception 'Strict signed account/tax currency bucket mismatch' using errcode='40001';end if;
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>11
  or not(c ?& array['tenantId','orgId','observedAt','sourceSnapshotHash','controlSnapshotHash','identitySnapshotHash','organisation','sourceEvidence','controls','identity','receipts'])
  or c->>'tenantId' is distinct from approved.tenant_id::text or public.xero_grouped_salesforce_id_v1(c->>'orgId') is distinct from left('00D2x000000Ei4oEAC',15)
  or c->>'sourceSnapshotHash' is distinct from public.xero_document_correction_hash_v1(c->'sourceEvidence')
  or c->>'controlSnapshotHash' is distinct from public.xero_document_correction_hash_v1(c->'controls')
  or c->>'identitySnapshotHash' is distinct from public.xero_document_correction_hash_v1(c->'identity')
  or jsonb_typeof(c->'controls') is distinct from 'object' or jsonb_typeof(c->'identity') is distinct from 'object'
  or jsonb_typeof(c->'sourceEvidence') is distinct from 'object' or jsonb_typeof(c->'receipts') is distinct from 'object'
  or jsonb_typeof(org) is distinct from 'object' or lower(org->>'OrganisationID') is distinct from approved.tenant_id::text
  or org->>'BaseCurrency' is distinct from 'USD' or org->>'OrganisationStatus' is distinct from 'ACTIVE'
  or coalesce(c->>'observedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'Trusted original current capsule binding differs' using errcode='40001'; end if;
 perform (c->>'observedAt')::timestamptz;
 foreach k in array array['PeriodLockDate','EndOfYearLockDate'] loop
  if org ? k and org->k<>'null'::jsonb and (public.xero_aggregate_supplier_calendar_date_v3(jsonb_build_object('Date',org->k),'Date') is null
   or public.xero_aggregate_supplier_calendar_date_v3(b,'Date')<=public.xero_aggregate_supplier_calendar_date_v3(jsonb_build_object('Date',org->k),'Date')) then raise exception 'Current organisation lock date hold' using errcode='40001'; end if;
 end loop;
 perform public.xero_existing_draft_timestamp_assert_v1(b);
end $$;
-- Existing shared admission takes tenant then its campaign global barrier.
-- Status transactions take global first and never wait for a held tenant lock,
-- preventing a new wait cycle without changing existing admission logic.
create function public.xero_existing_draft_tenant_lock_v1(p_tenant_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_tenant_id is null then raise exception 'Exact status tenant required' using errcode='40001';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('xero.shared.'||p_tenant_id::text,0)) then
  raise exception 'Active tenant admission; status held without side effects' using errcode='55P03';
 end if;
end $$;
create function public.xero_existing_draft_claim_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare r public.xero_financial_sync_runs;i public.xero_financial_sync_items;m public.xero_financial_document_mappings;
 saved jsonb;row jsonb;pm public.xero_financial_product_mappings;n integer:=0;product_id text;grant_direction text;product_count integer;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_document_correction_lock_v1();
 perform public.xero_existing_draft_tenant_lock_v1(new.tenant_id);
 begin lock table public.dispute_beta_cases in share mode nowait;exception when lock_not_available then raise exception 'Active dispute writer; status held without side effects' using errcode='55P03';end;
 if new.actor_id is null or new.actor_id='00000000-0000-0000-0000-000000000000' or new.actor_email is distinct from lower(btrim(new.actor_email)) or length(coalesce(new.actor_email,'')) not between 1 and 320
  or new.tenant_id::text is distinct from new.evidence#>>'{current,tenantId}'
  or new.idempotency_key is distinct from 'draft-status:'||new.run_id::text||':'||new.item_id::text then raise exception 'Exact status actor/idempotency required' using errcode='40001';end if;
 perform public.xero_campaign_actor_v1(new.actor_id,new.tenant_id);
 perform public.xero_existing_draft_hash_assert_v1(new.evidence,new.evidence_canonical,new.evidence_hash);
 perform public.xero_existing_draft_assert_v1(new.evidence,new.target_id);
 if public.xero_document_correction_active_v1() or exists(select 1 from public.xero_financial_sync_runs where (status='processing' and id<>new.run_id)
  or (mode='payment_apply' and control_totals#>>'{paymentPosting,state}' in('intent','uncertain')))
  or exists(select 1 from public.xero_reconciliation_batches where status='running')
  or exists(select 1 from public.xero_shared_requests where method<>'GET' and (state='inflight' or outcome_unknown)) then raise exception 'An unresolved writer already holds the status barrier' using errcode='40001';end if;
 select * into r from public.xero_financial_sync_runs where id=new.run_id for update;
 select * into i from public.xero_financial_sync_items where id=new.item_id and run_id=new.run_id for update;
 saved:=i.source_payload->'existingDraftAuthorisation';
 if r.id is null or r.mode is distinct from 'preview' or r.status is distinct from 'processing' or r.revision is distinct from new.run_revision
  or r.reviewed_by is distinct from new.actor_id or r.reviewed_by_email is distinct from new.actor_email or r.reviewed_at is null
  or r.control_totals->>'preservationPolicy' is distinct from 'authorise_existing_xero_drafts_v1'
  or jsonb_typeof(r.control_totals->'existingDraftAuthorisation') is distinct from 'object'
  or r.control_totals#>>'{workflowSnapshot,tenantId}' is distinct from new.tenant_id::text
  or i.id is null or i.updated_at is distinct from new.item_updated_at or i.status is distinct from 'selected' or i.selected is distinct from true
  or i.proposed_action is distinct from 'protected_legacy' or i.proposed_payload is distinct from 'null'::jsonb or i.blockers is distinct from '[]'::jsonb
  or i.mutation_attempts<>0 or i.applied_at is not null or i.error_code is not null or i.error_message is not null
  or i.xero_document_id is distinct from new.target_id::text or i.xero_document_status is distinct from 'DRAFT'
  or i.source_object is distinct from new.evidence#>>'{source,salesforceObject}' or i.source_id is distinct from new.evidence#>>'{source,salesforceId}'
  or (i.source_payload-'existingDraftAuthorisation') is distinct from new.evidence->'source' or i.currency is distinct from 'USD'
  or i.source_total*100 is distinct from public.xero_supplier_financial_cents_v1(new.evidence#>'{source,total}')::numeric
  or (saved-'current'-'before'-'expectedAfter') is distinct from (new.evidence-'current'-'before'-'expectedAfter')
  or i.xero_payload is distinct from saved->'before' then raise exception 'Exact reviewed selected status item changed' using errcode='40001';end if;
 perform public.xero_existing_draft_assert_v1(saved,new.target_id);
 perform public.xero_existing_draft_preserved_v1(saved->'before',new.evidence->'before','DRAFT');
 for m in select * from public.xero_financial_document_mappings where lower(xero_document_id)=new.target_id::text
  or (salesforce_object=i.source_object and public.xero_grouped_salesforce_id_v1(salesforce_id)=public.xero_grouped_salesforce_id_v1(i.source_id)) order by id for update loop
  n:=n+1;
  if m.id is distinct from new.mapping_id or m.xero_status is distinct from 'DRAFT' or m.xero_document_type is distinct from new.evidence#>>'{before,Type}'
   or m.salesforce_object is distinct from i.source_object or public.xero_grouped_salesforce_id_v1(m.salesforce_id) is distinct from public.xero_grouped_salesforce_id_v1(i.source_id)
   or m.xero_contact_id is distinct from new.evidence#>>'{before,Contact,ContactID}'
   or coalesce(m.source_fingerprint,'')!~'^[a-f0-9]{64}$' or coalesce(m.financial_fingerprint,'')!~'^[a-f0-9]{64}$'
   or not exists(select 1 from jsonb_array_elements(new.evidence#>'{current,controls,documentMappings}') x where (x-'last_reconciled_at'-'updated_at')=(to_jsonb(m)-'last_reconciled_at'-'updated_at'))
   or not exists(select 1 from jsonb_array_elements(saved#>'{current,controls,documentMappings}') x where (x-'last_reconciled_at'-'updated_at')=(to_jsonb(m)-'last_reconciled_at'-'updated_at'))
   or exists(select 1 from public.xero_document_field_correction_events where linked_mapping_id=m.id and status='confirmed')
   or m.retained_differences ? 'financialBucketPreservation' then raise exception 'Current exact historical status mapping differs' using errcode='40001';end if;
  new.mapping_snapshot:=to_jsonb(m);
 end loop;
 if n<>1 or exists(select 1 from public.xero_financial_payment_mappings where document_mapping_id=new.mapping_id)
  or exists(select 1 from public.dispute_beta_cases where left(stem_id,15)=public.xero_grouped_salesforce_id_v1(new.evidence#>>'{source,stemId}') and coalesce(lower(workflow_status),'') not in('closed','resolved','cancelled')) then raise exception 'Current mapping/payment/dispute status claim held' using errcode='40001';end if;
 -- Exact relevant grants are independent of unrelated disabled history.
 if jsonb_typeof(new.evidence#>'{current,controls,productMappings}') is distinct from 'array' then raise exception 'Original product grant coverage required' using errcode='40001';end if;
 grant_direction:=case i.source_object when 'Invoice__c' then 'buyer' else 'supplier' end;
 for product_id in select distinct public.xero_grouped_salesforce_id_v1(value->>'productId') collate "C" from jsonb_array_elements(new.evidence#>'{source,lines}') order by 1 loop
  if coalesce(product_id,'')!~'^01t[A-Za-z0-9]{12}$' then raise exception 'Original source product identity required' using errcode='40001';end if;
  product_count:=0;
  for pm in select * from public.xero_financial_product_mappings where xero_financial_product_mappings.direction=grant_direction and public.xero_grouped_salesforce_id_v1(salesforce_product_id)=product_id order by id for share loop
   product_count:=product_count+1;
   if not pm.enabled or pm.approved_by is null or pm.approved_at is null
    or (select count(*) from jsonb_array_elements(new.evidence#>'{current,controls,productMappings}') x where x->>'id'=pm.id::text and x=to_jsonb(pm))<>1
    or exists(select 1 from jsonb_array_elements(new.evidence#>'{source,lines}') x where public.xero_grouped_salesforce_id_v1(x->>'productId')=product_id and (x->>'accountCode' is distinct from pm.xero_account_code or x->>'taxType' is distinct from pm.xero_tax_type)) then raise exception 'Current relevant status product grant changed' using errcode='40001';end if;
  end loop;
  if product_count<>1 then raise exception 'Current relevant product grant missing or ambiguous' using errcode='40001';end if;
 end loop;
 new.preview_evidence_hash:=public.xero_document_correction_hash_v1(saved);new.item_snapshot:=to_jsonb(i);return new;
end $$;
create function public.xero_existing_draft_request_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare c public.xero_existing_draft_authorisation_claims;b public.xero_shared_budgets;s public.xero_shared_tenant_control;
 r public.xero_shared_requests;ver integer;reserved integer;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_existing_draft_authorisation_claims where id=new.claim_id;
 if c.id is null or c.actor_id is distinct from new.actor_id or c.actor_email is distinct from new.actor_email
  or exists(select 1 from public.xero_existing_draft_authorisation_events where claim_id=c.id and status in('confirmed','rejected')) then raise exception 'Status request claim/actor changed' using errcode='40001';end if;
 perform public.xero_existing_draft_tenant_lock_v1(c.tenant_id);
 ver:=public.xero_shared_assert_tenant(c.tenant_id::text);
 select * into b from public.xero_shared_budgets where id=new.budget_id for update;
 select * into s from public.xero_shared_tenant_control where tenant_id=c.tenant_id::text for update;
 select coalesce(sum(operation_remaining+verification_remaining),0) into reserved from public.xero_shared_budgets where tenant_id=c.tenant_id::text and state='active' and expires_at>clock_timestamp();
 select * into r from public.xero_shared_requests where id=new.request_id;
 if new.request_id is null or new.token_version is distinct from ver or b.id is null or b.tenant_id is distinct from c.tenant_id::text
  or b.owner_key is distinct from 'draft-status:'||c.run_id::text or b.state is distinct from 'active' or b.expires_at<=clock_timestamp()
  or b.verification_remaining<1 or b.verification_reserved<1 or (r.id is null and b.operation_remaining<1)
  or s.allowance_known is distinct from true or s.daily_hold or s.retry_at>clock_timestamp() or coalesce(s.available_calls,0)-200<reserved
  or (r.id is not null and (r.tenant_id is distinct from c.tenant_id::text or r.method is distinct from 'POST' or r.resource_key is distinct from 'Invoices'
   or r.phase is distinct from 'operation' or r.budget_id is distinct from new.budget_id or r.token_version is distinct from new.token_version or r.admitted_at<c.created_at))
  or exists(select 1 from public.xero_shared_requests where method<>'GET' and id<>new.request_id and (state='inflight' or outcome_unknown)) then raise exception 'Exact active reserved status request authority held' using errcode='40001';end if;
 new.resource_path:='/Invoices/'||c.target_id::text||'?unitdp=4';new.payload:=jsonb_build_object('Invoices',jsonb_build_array(jsonb_build_object('InvoiceID',c.target_id,'Status','AUTHORISED')));return new;
end $$;
-- Shared admission already owns the tenant lock. Do not acquire the global
-- lock here: the status writer takes global first, then tenant. Only the exact
-- planned status POST may pass an unresolved status claim on this tenant.
create function public.xero_existing_draft_provider_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if new.method='GET' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('xero.shared.'||new.tenant_id,0));
 if exists(select 1 from public.xero_existing_draft_authorisation_claims c where c.tenant_id::text=new.tenant_id
  and not exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=c.id and e.status in('confirmed','rejected')))
  and not exists(select 1 from public.xero_existing_draft_authorisation_claims c join public.xero_existing_draft_authorisation_requests b on b.claim_id=c.id
   where c.tenant_id::text=new.tenant_id and b.request_id=new.id and b.budget_id=new.budget_id and b.token_version=new.token_version
    and new.method='POST' and new.resource_key='Invoices' and new.phase='operation'
    and not exists(select 1 from public.xero_existing_draft_authorisation_events e where e.claim_id=c.id and e.status in('confirmed','rejected'))) then
  raise exception 'Unresolved status claim holds provider writes; only its exact bound POST is permitted' using errcode='40001';
 end if;
 return new;
end $$;
create trigger existing_draft_provider_guard before insert on public.xero_shared_requests for each row execute function public.xero_existing_draft_provider_guard_v1();
create function public.xero_existing_draft_event_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare c public.xero_existing_draft_authorisation_claims;b public.xero_existing_draft_authorisation_requests;
 r public.xero_shared_requests;v public.xero_shared_requests;vb public.xero_shared_budgets;run public.xero_financial_sync_runs;
 i public.xero_financial_sync_items;m public.xero_financial_document_mappings;e jsonb:=new.evidence;req jsonb;verify jsonb;status_write integer:=0;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_existing_draft_authorisation_claims where id=new.claim_id;
 if c.id is null or c.actor_id is distinct from new.actor_id or c.actor_email is distinct from new.actor_email
  or exists(select 1 from public.xero_existing_draft_authorisation_events where claim_id=c.id and status in('confirmed','rejected')) then raise exception 'Status claim/terminal/actor changed' using errcode='40001';end if;
 perform public.xero_existing_draft_tenant_lock_v1(c.tenant_id);
 perform public.xero_existing_draft_hash_assert_v1(e,new.evidence_canonical,new.evidence_hash);
 if (select count(*) from jsonb_object_keys(e))<>6 or not(e ?& array['policyVersion','claimEvidenceHash','observed','verification','request','status'])
  or e->>'policyVersion' is distinct from 'authorise_existing_xero_drafts_v1' or e->>'claimEvidenceHash' is distinct from c.evidence_hash or e->>'status' is distinct from new.status then raise exception 'Exact status outcome envelope required' using errcode='40001';end if;
 perform public.xero_campaign_actor_v1(new.actor_id,c.tenant_id);
 select * into run from public.xero_financial_sync_runs where id=c.run_id for update;
 select * into i from public.xero_financial_sync_items where id=c.item_id for update;
 select * into m from public.xero_financial_document_mappings where id=c.mapping_id for update;
 if run.status is distinct from 'processing' or run.revision is distinct from c.run_revision or run.reviewed_by is distinct from c.actor_id or run.reviewed_by_email is distinct from c.actor_email
  or run.control_totals->>'preservationPolicy' is distinct from 'authorise_existing_xero_drafts_v1'
  or to_jsonb(i) is distinct from c.item_snapshot or (to_jsonb(m)-'last_reconciled_at'-'updated_at') is distinct from (c.mapping_snapshot-'last_reconciled_at'-'updated_at') then raise exception 'Original status approval/item/mapping changed before outcome' using errcode='40001';end if;
 select * into b from public.xero_existing_draft_authorisation_requests where claim_id=c.id;
 if b.claim_id is not null then
  req:=jsonb_build_object('requestId',b.request_id,'budgetId',b.budget_id,'tokenVersion',b.token_version);
  if e->'request' is distinct from req then raise exception 'Original planned status request changed' using errcode='40001';end if;
  select * into r from public.xero_shared_requests where id=b.request_id;
  if r.id is not null and (r.tenant_id is distinct from c.tenant_id::text or r.method is distinct from 'POST' or r.resource_key is distinct from 'Invoices'
   or r.budget_id is distinct from b.budget_id or r.token_version is distinct from b.token_version or r.phase is distinct from 'operation' or r.admitted_at<b.created_at) then raise exception 'Admitted status request differs' using errcode='40001';end if;
 elsif e->'request' is distinct from 'null'::jsonb or new.status<>'uncertain' then raise exception 'Durable planned status request required' using errcode='40001';end if;
 if e->'verification' is distinct from 'null'::jsonb then
  verify:=e->'verification';
  if jsonb_typeof(verify) is distinct from 'object' or (select count(*) from jsonb_object_keys(verify))<>3 or jsonb_typeof(verify->'tokenVersion') is distinct from 'number' or not(verify ?& array['requestId','budgetId','tokenVersion']) then raise exception 'Exact verification request required' using errcode='40001';end if;
  select * into v from public.xero_shared_requests where id=(verify->>'requestId')::uuid;
  select * into vb from public.xero_shared_budgets where id=v.budget_id;
  if v.id is null or v.id::text is distinct from verify->>'requestId' or v.budget_id::text is distinct from verify->>'budgetId' or v.token_version::text is distinct from verify->>'tokenVersion'
   or v.tenant_id is distinct from c.tenant_id::text or v.method is distinct from 'GET' or v.resource_key is distinct from 'Invoices'
   or (r.id is not null and v.phase is distinct from 'verification') or (r.id is null and v.phase not in('operation','verification'))
   or v.state is distinct from 'complete' or coalesce(v.response_status,0) not between 200 and 299 or v.outcome_unknown or v.completed_at is null
   or v.admitted_at<=coalesce(r.admitted_at,b.created_at,c.created_at) or vb.owner_key is distinct from 'draft-status:'||c.run_id::text then raise exception 'Completed bound verification GET required' using errcode='40001';end if;
 elsif new.status<>'uncertain' then raise exception 'Terminal status requires complete verification GET' using errcode='40001';end if;
 if new.status='confirmed' then
  if r.id is null then raise exception 'Authorisation confirmation needs actual shared POST admission' using errcode='40001';end if;
  perform public.xero_existing_draft_preserved_v1(c.evidence->'before',e->'observed','AUTHORISED');status_write:=1;
 elsif new.status='rejected' then
  if r.id is null then
   if jsonb_typeof(e->'observed') is distinct from 'object' or e#>>'{observed,InvoiceID}' is distinct from c.target_id::text then raise exception 'Never-admitted held rejection needs actual scoped target observation' using errcode='40001';end if;
  else perform public.xero_existing_draft_preserved_v1(c.evidence->'before',e->'observed','DRAFT');end if;
  if r.id is not null and not(r.state='complete' and not r.outcome_unknown and coalesce(r.response_status,0) between 400 and 499 and coalesce(r.response_status,0) not in(408,409,429)) then raise exception 'Admitted ambiguous unchanged draft remains held' using errcode='40001';end if;
 elsif new.status='uncertain' then
  if jsonb_typeof(e->'observed') not in('object','null') then raise exception 'Invalid uncertain original observation' using errcode='40001';end if;
 else raise exception 'Unknown status outcome' using errcode='40001';end if;
 new.receipt:=jsonb_build_object('receiptContract','existing_draft_status_authorisation_receipt_v1','policyVersion','authorise_existing_xero_drafts_v1',
  'claimId',c.id,'claimEvidenceHash',c.evidence_hash,'outcomeEvidenceHash',new.evidence_hash,'sourceFingerprint',c.evidence#>'{source,sourceFingerprint}','financialFingerprint',c.evidence#>'{source,financialFingerprint}',
  'selectionFileSha256',c.evidence#>'{selection,selectionFileSha256}','selectionSha256',c.evidence#>'{selection,selectionSha256}','humanApprovalSha256',c.evidence#>'{selection,humanApprovalSha256}',
  'documentVerification','UNVERIFIED','status',new.status,'request',e->'request','verification',e->'verification','targetId',c.target_id,'mappingId',c.mapping_id,'runId',c.run_id,'itemId',c.item_id,
  'actorId',new.actor_id,'actorEmail',new.actor_email,'authorisations',status_write,'financialWrites',status_write,'sending',0,'payments',0,'allocations',0,'lineChanges',0);
 return new;
end $$;
-- The terminal event releases only this claim, while the global transaction lock
-- remains held. Mapping/status/item/audit and unknown resolution commit together.
create function public.xero_existing_draft_finish_effects_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare c public.xero_existing_draft_authorisation_claims;r public.xero_shared_requests;v uuid;
begin
 select * into c from public.xero_existing_draft_authorisation_claims where id=new.claim_id;
 if new.status in('confirmed','rejected') then
  select q.* into r from public.xero_shared_requests q join public.xero_existing_draft_authorisation_requests b on b.request_id=q.id where b.claim_id=c.id;
  if r.id is not null and (r.outcome_unknown or r.state='inflight') then
   v:=(new.evidence#>>'{verification,requestId}')::uuid;
   perform public.xero_shared_resolve_unknown(c.tenant_id::text,r.id,v,'draft-status-event:'||new.id::text);
  end if;
 end if;
 if new.status='confirmed' then
  update public.xero_financial_document_mappings set xero_status='AUTHORISED',last_reconciled_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.mapping_id;
  update public.xero_financial_sync_items set status='updated',xero_document_status='AUTHORISED',mutation_attempts=1,applied_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.item_id;
 end if;
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
 values(c.run_id,'existing_draft_status_authorisation_'||new.status,case new.status when 'confirmed' then 'success' else new.status end,new.actor_id,new.actor_email,
  jsonb_build_object('authorisations',case new.status when 'confirmed' then 1 else 0 end,'financialWrites',case new.status when 'confirmed' then 1 else 0 end,'sending',0,'payments',0,'allocations',0,'lineChanges',0),jsonb_build_object('existingDraftAuthorisation',new.receipt));return new;
end $$;
create function public.xero_existing_draft_mapping_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.xero_existing_draft_authorisation_claims c join public.xero_existing_draft_authorisation_events e on e.claim_id=c.id and e.status='confirmed' where c.mapping_id=old.id) then
  if tg_op='DELETE' then raise exception 'Authorised status mapping is immutable' using errcode='40001';end if;
  if (to_jsonb(new)-'last_reconciled_at'-'updated_at') is distinct from (to_jsonb(old)-'last_reconciled_at'-'updated_at') then
   if old.xero_status is distinct from 'DRAFT' or new.xero_status is distinct from 'AUTHORISED'
    or (to_jsonb(new)-'xero_status'-'last_reconciled_at'-'updated_at') is distinct from (to_jsonb(old)-'xero_status'-'last_reconciled_at'-'updated_at')
    or not exists(select 1 from public.xero_existing_draft_authorisation_claims c join public.xero_existing_draft_authorisation_events e on e.claim_id=c.id and e.status='confirmed'
     where c.mapping_id=old.id and (c.mapping_snapshot-'last_reconciled_at'-'updated_at')=(to_jsonb(old)-'last_reconciled_at'-'updated_at')) then raise exception 'Authorised status mapping financial/identity fields are immutable' using errcode='40001';end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger existing_draft_claim_serialize before insert on public.xero_existing_draft_authorisation_claims for each statement execute function public.xero_document_correction_serialize_v1();
create trigger existing_draft_claim_validate before insert on public.xero_existing_draft_authorisation_claims for each row execute function public.xero_existing_draft_claim_guard_v1();
create trigger existing_draft_request_serialize before insert on public.xero_existing_draft_authorisation_requests for each statement execute function public.xero_document_correction_serialize_v1();
create trigger existing_draft_request_validate before insert on public.xero_existing_draft_authorisation_requests for each row execute function public.xero_existing_draft_request_guard_v1();
create trigger existing_draft_event_serialize before insert on public.xero_existing_draft_authorisation_events for each statement execute function public.xero_document_correction_serialize_v1();
create trigger existing_draft_event_validate before insert on public.xero_existing_draft_authorisation_events for each row execute function public.xero_existing_draft_event_guard_v1();
create trigger existing_draft_event_finish after insert on public.xero_existing_draft_authorisation_events for each row execute function public.xero_existing_draft_finish_effects_v1();
create trigger existing_draft_mapping_guard before update or delete on public.xero_financial_document_mappings for each row execute function public.xero_existing_draft_mapping_guard_v1();
create function public.claim_xero_existing_draft_authorisation_v1(p_run_id uuid,p_expected_run_revision integer,p_item_id uuid,p_expected_item_updated_at timestamptz,p_tenant_id uuid,p_idempotency_key text,p_evidence jsonb,p_canonical text,p_fingerprint text,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare c public.xero_existing_draft_authorisation_claims;e public.xero_existing_draft_authorisation_events;m uuid;replay boolean:=false;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform public.xero_document_correction_lock_v1();
 perform public.xero_existing_draft_tenant_lock_v1(p_tenant_id);
 select * into c from public.xero_existing_draft_authorisation_claims where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
 if c.id is not null then
  if c.run_id is distinct from p_run_id or c.run_revision is distinct from p_expected_run_revision or c.item_id is distinct from p_item_id or c.item_updated_at is distinct from p_expected_item_updated_at
   or c.actor_id is distinct from p_actor_id or c.actor_email is distinct from p_actor_email or c.evidence is distinct from p_evidence or c.evidence_canonical is distinct from p_canonical or c.evidence_hash is distinct from p_fingerprint then raise exception 'Status idempotency evidence changed' using errcode='40001';end if;replay:=true;
 else
  select id into m from public.xero_financial_document_mappings where xero_document_id=p_evidence#>>'{before,InvoiceID}' and salesforce_object=p_evidence#>>'{source,salesforceObject}' and public.xero_grouped_salesforce_id_v1(salesforce_id)=public.xero_grouped_salesforce_id_v1(p_evidence#>>'{source,salesforceId}');
  insert into public.xero_existing_draft_authorisation_claims(run_id,item_id,run_revision,item_updated_at,tenant_id,target_id,mapping_id,idempotency_key,evidence,evidence_canonical,evidence_hash,preview_evidence_hash,mapping_snapshot,item_snapshot,actor_id,actor_email)
  values(p_run_id,p_item_id,p_expected_run_revision,p_expected_item_updated_at,p_tenant_id,(p_evidence#>>'{before,InvoiceID}')::uuid,m,p_idempotency_key,p_evidence,p_canonical,p_fingerprint,'','{}','{}',p_actor_id,p_actor_email) returning * into c;
 end if;
 select * into e from public.xero_existing_draft_authorisation_events where claim_id=c.id order by sequence desc limit 1;
 return to_jsonb(c)||jsonb_build_object('status',coalesce(e.status,'intent'),'request',(select to_jsonb(b) from public.xero_existing_draft_authorisation_requests b where claim_id=c.id),'latestReceipt',case when e.id is null then null else to_jsonb(e) end,'alreadyClaimed',replay);
end $$;
create function public.bind_xero_existing_draft_authorisation_request_v1(p_claim_id uuid,p_request_id uuid,p_budget_id uuid,p_token_version integer,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare b public.xero_existing_draft_authorisation_requests;c public.xero_existing_draft_authorisation_claims;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_existing_draft_authorisation_claims where id=p_claim_id;
 perform public.xero_existing_draft_tenant_lock_v1(c.tenant_id);
 select * into b from public.xero_existing_draft_authorisation_requests where claim_id=p_claim_id;
 if b.claim_id is not null then
  if b.request_id is distinct from p_request_id or b.budget_id is distinct from p_budget_id or b.token_version is distinct from p_token_version or b.actor_id is distinct from p_actor_id or b.actor_email is distinct from p_actor_email then raise exception 'Immutable status request binding changed' using errcode='40001';end if;
 else insert into public.xero_existing_draft_authorisation_requests(claim_id,request_id,budget_id,token_version,resource_path,payload,actor_id,actor_email)
  values(p_claim_id,p_request_id,p_budget_id,p_token_version,'','{}',p_actor_id,p_actor_email) returning * into b;end if;
 return to_jsonb(b);
end $$;
create function public.finish_xero_existing_draft_authorisation_v1(p_claim_id uuid,p_status text,p_evidence jsonb,p_canonical text,p_fingerprint text,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare c public.xero_existing_draft_authorisation_claims;e public.xero_existing_draft_authorisation_events;
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_existing_draft_authorisation_claims where id=p_claim_id;
 if c.id is null or c.actor_id is distinct from p_actor_id or c.actor_email is distinct from p_actor_email then raise exception 'Status outcome actor/claim differs' using errcode='40001';end if;
 perform public.xero_existing_draft_tenant_lock_v1(c.tenant_id);
 select * into e from public.xero_existing_draft_authorisation_events where claim_id=c.id order by sequence desc limit 1;
 if e.id is null or e.status is distinct from p_status or e.evidence is distinct from p_evidence or e.evidence_canonical is distinct from p_canonical or e.evidence_hash is distinct from p_fingerprint then
  insert into public.xero_existing_draft_authorisation_events(claim_id,status,evidence,evidence_canonical,evidence_hash,receipt,actor_id,actor_email)
  values(c.id,p_status,p_evidence,p_canonical,p_fingerprint,'{}',p_actor_id,p_actor_email) returning * into e;
 end if;
 return to_jsonb(e)||jsonb_build_object('claim',to_jsonb(c),'linkedMapping',case when e.status='confirmed' then (select to_jsonb(m) from public.xero_financial_document_mappings m where id=c.mapping_id) else null end,'item',(select to_jsonb(i) from public.xero_financial_sync_items i where id=c.item_id));
end $$;

create function public.persist_xero_existing_draft_authorisation_preview_v1(p_run jsonb,p_items jsonb,p_review_identity text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare
 requested public.xero_financial_sync_runs; saved public.xero_financial_sync_runs; item public.xero_financial_sync_items;
 snapshot jsonb:=p_run#>'{control_totals,workflowSnapshot}'; payload_hash text; row jsonb; items jsonb:='[]'; prior jsonb; n integer:=0;
 policy constant text:='authorise_existing_xero_drafts_v1';
begin
 if current_user is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform public.xero_supplier_financial_json_bound_v1(p_run);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 25 or octet_length(p_items::text)>8000000
   or coalesce(p_review_identity,'') !~ '^[a-f0-9]{64}$' or p_run#>>'{control_totals,preservationPolicy}' is distinct from policy
   or jsonb_typeof(p_run#>'{control_totals,existingDraftAuthorisation}') is distinct from 'object' or p_run#>>'{control_totals,postingMode}' is distinct from 'authorised'
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
     or item.source_object not in('Invoice__c','Supplier_Invoice__c') or item.source_type is distinct from (case item.source_object when 'Invoice__c' then 'buyer_invoice' else 'supplier_bill' end) or public.xero_grouped_salesforce_id_v1(item.source_id) is null
     or item.currency is distinct from 'USD' or item.source_total is null or item.selected is distinct from false or item.mutation_attempts is distinct from 0
     or not(row ? 'proposed_payload') or row->'proposed_payload' is distinct from 'null'::jsonb
     or item.created_at is null or item.updated_at is null or item.applied_at is not null or item.error_code is not null or item.error_message is not null
     or jsonb_typeof(item.source_payload) is distinct from 'object' or jsonb_typeof(item.xero_payload) is distinct from 'object' or jsonb_typeof(item.blockers) is distinct from 'array'
     or jsonb_typeof(item.warnings) is distinct from 'array' or jsonb_typeof(item.differences) is distinct from 'array'
     or not((item.status='eligible' and item.proposed_action='protected_legacy') or (item.status='blocked' and item.proposed_action='blocked')) then raise exception 'Explicit non-executable financial-only preview item required' using errcode='40001'; end if;
   if not exists(select 1 from public.xero_existing_draft_authorisation_approved_records ar where ar.target_id::text=item.xero_document_id
    and ar.source_object=item.source_object and public.xero_grouped_salesforce_id_v1(ar.source_id)=public.xero_grouped_salesforce_id_v1(item.source_id) and ar.tenant_id::text=snapshot->>'tenantId')
    or item.source_payload->>'salesforceObject' is distinct from item.source_object or item.source_payload->>'salesforceId' is distinct from item.source_id
    or item.xero_payload->>'InvoiceID' is distinct from item.xero_document_id then raise exception 'Pinned status preview identity differs' using errcode='40001';end if;
   if item.status='eligible' then
    perform public.xero_existing_draft_assert_v1(item.source_payload->'existingDraftAuthorisation',item.xero_document_id::uuid);
    if item.source_payload#>>'{existingDraftAuthorisation,current,tenantId}' is distinct from snapshot->>'tenantId'
     or (item.source_payload-'existingDraftAuthorisation') is distinct from item.source_payload#>'{existingDraftAuthorisation,source}'
     or item.xero_payload is distinct from item.source_payload#>'{existingDraftAuthorisation,before}' or item.xero_document_status is distinct from 'DRAFT'
     or item.blockers is distinct from '[]'::jsonb or item.source_payload ? 'existingDraftAuthorisationHold' then raise exception 'Status preview original binding differs' using errcode='40001';end if;
   else
    if item.blockers='[]'::jsonb or (item.source_payload ? 'existingDraftAuthorisation' and item.source_payload->'existingDraftAuthorisation'<>'null'::jsonb)
     or jsonb_typeof(item.source_payload->'existingDraftAuthorisationHold') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(item.source_payload->'existingDraftAuthorisationHold'))<>3
     or not((item.source_payload->'existingDraftAuthorisationHold') ?& array['policyVersion','targetId','reasonCode'])
     or item.source_payload#>>'{existingDraftAuthorisationHold,policyVersion}' is distinct from policy
     or item.source_payload#>>'{existingDraftAuthorisationHold,targetId}' is distinct from item.xero_document_id
     or coalesce(item.source_payload#>>'{existingDraftAuthorisationHold,reasonCode}','')!~'^[A-Z][A-Z0-9_]{0,99}$' then raise exception 'Non-executable pinned status hold required' using errcode='40001';end if;
   end if;
   item.proposed_payload:='null'::jsonb;items:=items||jsonb_build_array(to_jsonb(item));n:=n+1;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(items))<>n or (select count(distinct value->>'row_key') from jsonb_array_elements(items))<>n
   or (select count(distinct public.xero_grouped_salesforce_id_v1(value->>'source_id')) from jsonb_array_elements(items))<>n then raise exception 'Financial preview identities duplicate' using errcode='40001'; end if;
 payload_hash:=public.xero_document_correction_hash_v1(jsonb_build_object('run',p_run,'items',p_items,'reviewIdentity',p_review_identity));
 perform public.xero_document_correction_lock_v1();
 select * into saved from public.xero_financial_sync_runs where id=requested.id or idempotency_key=requested.idempotency_key order by id for update;
 if saved.id is not null then
   if saved.id is distinct from requested.id or saved.control_totals->>'preservationPolicy' is distinct from policy or saved.control_totals#>>'{workflowSnapshot,existingDraftPreviewPayloadHash}' is distinct from payload_hash
     or not exists(select 1 from public.xero_financial_audit_events where run_id=saved.id and event_type='existing_draft_authorisation_preview_published' and outcome='success' and actor_id=requested.created_by and fingerprints=jsonb_build_object('payloadHash',payload_hash,'reviewIdentity',p_review_identity)) then raise exception 'Exact financial preview durable outcome uncertain' using errcode='40001'; end if;
   if (select count(*) from public.xero_financial_sync_items where run_id=saved.id)<>n then raise exception 'Exact financial preview item count changed' using errcode='40001'; end if;
   for row in select value from jsonb_array_elements(items) loop
     select to_jsonb(i) into prior from public.xero_financial_sync_items i where id=(row->>'id')::uuid and run_id=saved.id;
     if prior is null or (prior-'status'-'selected'-'updated_at'-'applied_at'-'error_code'-'error_message') is distinct from (row-'status'-'selected'-'updated_at'-'applied_at'-'error_code'-'error_message') then raise exception 'Exact original financial preview item changed' using errcode='40001'; end if;
   end loop;
   return jsonb_build_object('run',to_jsonb(saved),'items',(select jsonb_agg(to_jsonb(i) order by row_index) from public.xero_financial_sync_items i where run_id=saved.id),'reused',true);
 end if;
 requested.classification_summary:=requested.classification_summary||jsonb_build_object('total',n,'eligible',(select count(*) from jsonb_array_elements(items) z where z->>'status'='eligible'),'blocked',(select count(*) from jsonb_array_elements(items) z where z->>'status'='blocked'));
 requested.status:='ready_for_review';requested.control_totals:=jsonb_set(requested.control_totals,'{workflowSnapshot,existingDraftPreviewPayloadHash}',to_jsonb(payload_hash));
 insert into public.xero_financial_sync_runs select requested.*;
 for row in select value from jsonb_array_elements(items) loop
   item:=jsonb_populate_record(null::public.xero_financial_sync_items,row);item.proposed_payload:='null'::jsonb;
   insert into public.xero_financial_sync_items select item.*;
 end loop;
 insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints) values(requested.id,'existing_draft_authorisation_preview_published','success',requested.created_by,lower(btrim(requested.created_by_email)),jsonb_build_object('items',n),jsonb_build_object('payloadHash',payload_hash,'reviewIdentity',p_review_identity));
 return jsonb_build_object('run',to_jsonb(requested),'items',items,'reused',false);
end $$;
create unique index xero_existing_draft_preview_event_unique on public.xero_financial_audit_events(run_id) where event_type='existing_draft_authorisation_preview_published';
revoke all on function public.persist_xero_existing_draft_authorisation_preview_v1(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_xero_existing_draft_authorisation_preview_v1(jsonb,jsonb,text) to service_role;
-- Private originals: no authenticated/anonymous table access. Journals only append.
alter table public.xero_existing_draft_authorisation_approved_records enable row level security;
alter table public.xero_existing_draft_authorisation_approved_records force row level security;
alter table public.xero_existing_draft_authorisation_claims enable row level security;
alter table public.xero_existing_draft_authorisation_claims force row level security;
alter table public.xero_existing_draft_authorisation_requests enable row level security;
alter table public.xero_existing_draft_authorisation_requests force row level security;
alter table public.xero_existing_draft_authorisation_events enable row level security;
alter table public.xero_existing_draft_authorisation_events force row level security;
revoke all on public.xero_existing_draft_authorisation_approved_records,public.xero_existing_draft_authorisation_claims,public.xero_existing_draft_authorisation_requests,public.xero_existing_draft_authorisation_events from public,anon,authenticated,service_role;
grant select on public.xero_existing_draft_authorisation_approved_records to service_role;
grant select,insert on public.xero_existing_draft_authorisation_claims,public.xero_existing_draft_authorisation_requests,public.xero_existing_draft_authorisation_events to service_role;
revoke all on sequence public.xero_existing_draft_authorisation_events_sequence_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.xero_existing_draft_authorisation_events_sequence_seq to service_role;
do $$declare tab text;fn record;begin
 foreach tab in array array['approved_records','claims','requests','events'] loop
  execute format('create trigger existing_draft_immutable before update or delete on public.%I for each row execute function public.xero_document_correction_immutable_v1()','xero_existing_draft_authorisation_'||tab);
 end loop;
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'xero_existing_draft_%' or p.proname in('claim_xero_existing_draft_authorisation_v1','bind_xero_existing_draft_authorisation_request_v1','finish_xero_existing_draft_authorisation_v1','persist_xero_existing_draft_authorisation_preview_v1')) loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
