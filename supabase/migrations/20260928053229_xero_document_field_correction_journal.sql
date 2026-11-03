-- Append-only field corrections. Existing identity mappings and acceptance
-- receipts are never rebased. No provider call occurs inside these transactions.
create table public.xero_document_field_correction_previews (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 policy text not null check(policy='document_field_correction_v1'),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=3000),
 summary jsonb not null check(jsonb_typeof(summary)='object'),
 check(octet_length(items::text)+octet_length(summary::text)<=20000000)
);
create index xero_document_correction_previews_tenant_idx on public.xero_document_field_correction_previews(tenant_id,created_at desc);
create table public.xero_document_field_correction_claims (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, xero_invoice_id uuid not null,
 mapping_id uuid references public.xero_financial_document_mappings(id),
 idempotency_key text not null check(length(btrim(idempotency_key)) between 1 and 200 and length(idempotency_key)<=200),
 evidence jsonb not null, evidence_canonical text not null, evidence_hash text not null,
 source_hash text not null, before_hash text not null, after_hash text not null, projection_hash text not null,
 actor_id uuid not null, actor_email text not null, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,idempotency_key)
);
create index xero_document_correction_target_idx on public.xero_document_field_correction_claims(tenant_id,xero_invoice_id,created_at desc);
create table public.xero_document_field_correction_events (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 claim_id uuid not null references public.xero_document_field_correction_claims(id),
 status text not null check(status in ('confirmed','rejected','uncertain')),
 linked_mapping_id uuid references public.xero_financial_document_mappings(id) deferrable initially deferred,
 evidence jsonb not null, evidence_canonical text not null, evidence_hash text not null,
 actor_id uuid not null, actor_email text not null, created_at timestamptz not null default clock_timestamp()
);
create index xero_document_correction_events_claim_idx on public.xero_document_field_correction_events(claim_id,sequence desc);

create function public.xero_document_correction_canonical_v1(p_value jsonb)
returns text language plpgsql immutable strict security invoker set search_path=public,pg_temp as $$
declare v text;
begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.xero_document_correction_canonical_v1(value),',' order by key collate "C"),'')||'}' into v from jsonb_each(p_value);
 when 'array' then select '['||coalesce(string_agg(public.xero_document_correction_canonical_v1(value),',' order by ord),'')||']' into v from jsonb_array_elements(p_value) with ordinality a(value,ord);
 when 'number' then v:=(p_value#>>'{}')::numeric::text; if position('.' in v)>0 then v:=rtrim(rtrim(v,'0'),'.'); end if;
 else v:=p_value::text; end case; return v;
end $$;
create function public.xero_document_correction_hash_v1(p_value jsonb)
returns text language sql immutable strict security invoker set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(public.xero_document_correction_canonical_v1(p_value),'UTF8')),'hex');
$$;
create function public.xero_document_correction_date_v1(p_value text)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
 return to_char(p_value::date,'YYYY-MM-DD')=p_value;
exception when others then return false;
end $$;
create function public.xero_document_correction_lock_v1()
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Correction writes require read committed' using errcode='40001'; end if;
 -- Shared with ALL existing payment mapping/run writers, before tuple locks.
 perform pg_advisory_xact_lock(192837465,731);
end $$;
create function public.xero_document_correction_serialize_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin perform public.xero_document_correction_lock_v1(); return null; end $$;
create function public.xero_document_correction_active_v1()
returns boolean language sql volatile security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.xero_document_field_correction_claims c where not exists(
   select 1 from public.xero_document_field_correction_events e where e.claim_id=c.id and e.status in ('confirmed','rejected')));
$$;
create function public.xero_document_correction_immutable_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception 'Correction evidence is append-only' using errcode='40001'; end $$;

-- Defend the SQL boundary even against rehashed, internally inconsistent proofs.
create function public.xero_document_correction_assert_v1(p_evidence jsonb,p_invoice uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare b jsonb:=p_evidence->'before'; a jsonb:=p_evidence->'expectedAfter'; s jsonb:=p_evidence->'source';
 p jsonb:=p_evidence->'projection'; h jsonb:=p->'header'; d jsonb:=p->'lineDescriptions';
 authority jsonb:=p_evidence->'authority'; l jsonb; n jsonb; i integer; v_id text;
 v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->>'policyVersion' is distinct from 'document_field_correction_v1'
   or jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object'
   or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(h) is distinct from 'object' or jsonb_typeof(d) is distinct from 'object'
   or (p-'header'-'lineDescriptions')<>'{}'::jsonb or jsonb_typeof(authority) is distinct from 'object'
   or authority->>'basis' is distinct from 'explicit_user_requested_2026_field_correction'
   or coalesce(authority->>'scopeHash','') !~ '^[0-9a-f]{64}$'
   or coalesce(authority->>'reviewedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   or (authority-'basis'-'scopeHash'-'reviewedAt')<>'{}'::jsonb
   or not(p_evidence ? 'mappingSnapshot') then raise exception 'Invalid correction authority or material evidence' using errcode='22023'; end if;
 perform (authority->>'reviewedAt')::timestamptz;
 if b->>'InvoiceID' is distinct from p_invoice::text or coalesce(b->>'Type','') not in ('ACCREC','ACCPAY')
   or coalesce(b->>'Status','') not in ('DRAFT','SUBMITTED','AUTHORISED','PAID')
   or coalesce(b->>'CurrencyCode','') !~ '^[A-Z]{3}$'
   or coalesce(b->'Contact'->>'ContactID','') !~ v_uuid
   or coalesce(public.xero_grouped_salesforce_id_v1(s->>'id'),'') !~ '^(a0K|a06)[A-Za-z0-9]{12}$'
   or coalesce(public.xero_grouped_salesforce_id_v1(s->>'accountId'),'') !~ '^001[A-Za-z0-9]{12}$'
   or coalesce(public.xero_grouped_salesforce_id_v1(s->>'stemId'),'') !~ '^a0H[A-Za-z0-9]{12}$'
   or coalesce(s->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
   or coalesce(s->>'financialFingerprint','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(s->'documentNumber') is distinct from 'string' or length(btrim(s->>'documentNumber')) not between 1 and 255
   or s->>'documentKind' is distinct from (case b->>'Type' when 'ACCREC' then 'buyer_invoice' else 'supplier_bill' end)
   or s->>'xeroType' is distinct from b->>'Type' or s->>'contactId' is distinct from b->'Contact'->>'ContactID'
   or s->>'currency' is distinct from b->>'CurrencyCode' or jsonb_typeof(s->'total') is distinct from 'number' or s->'total' is distinct from b->'Total'
   or s->>'object' is distinct from (case b->>'Type' when 'ACCREC' then 'Invoice__c' else 'Supplier_Invoice__c' end)
   or left(s->>'id',3) is distinct from (case b->>'Type' when 'ACCREC' then 'a0K' else 'a06' end)
   or not public.xero_document_correction_date_v1(s->>'deliveryDate')
   or s->>'deliveryDate'<'2026-01-01'
   or not public.xero_document_correction_date_v1(b->>'Date')
   or not public.xero_document_correction_date_v1(b->>'DueDate')
   or h->>'Date' is distinct from s->>'deliveryDate'
   or not public.xero_document_correction_date_v1(h->>'DueDate')
   or jsonb_typeof(h->'InvoiceNumber') is distinct from 'string' or length(btrim(h->>'InvoiceNumber')) not between 1 and 255
   or (h - case when b->>'Type'='ACCREC' then array['Date','DueDate','InvoiceNumber','Reference'] else array['Date','DueDate','InvoiceNumber'] end)<>'{}'::jsonb
   or (b->>'Type'='ACCREC' and (jsonb_typeof(h->'Reference') is distinct from 'string' or length(h->>'Reference')>255))
   then raise exception 'Invalid correction identity or source dates' using errcode='22023'; end if;
 if not (b ?& array['Total','SubTotal','TotalTax','AmountPaid','AmountCredited','AmountDue','LineAmountTypes'])
   or exists(select 1 from unnest(array['Total','SubTotal','TotalTax','AmountPaid','AmountCredited','AmountDue']) k
     where jsonb_typeof(b->k) is distinct from 'number' or (b->>k) !~ '^-?[0-9]+([.][0-9]+)?$')
   or (b->>'Total')::numeric<=0 or (b->>'AmountPaid')::numeric<0 or (b->>'AmountCredited')::numeric<0 or (b->>'AmountDue')::numeric<0
   or (b->>'AmountPaid')::numeric+(b->>'AmountCredited')::numeric+(b->>'AmountDue')::numeric<>(b->>'Total')::numeric
   or (b->>'Date' is distinct from a->>'Date' and (b->>'Status'='PAID' or (b->>'AmountPaid')::numeric<>0 or (b->>'AmountCredited')::numeric<>0))
   then raise exception 'Incomplete or incompatible settlement evidence' using errcode='22023'; end if;
 if jsonb_typeof(b->'LineItems') is distinct from 'array' or jsonb_typeof(a->'LineItems') is distinct from 'array' then
   raise exception 'Complete original lines are required' using errcode='22023'; end if;
 if jsonb_array_length(b->'LineItems') not between 1 and 500
   or jsonb_array_length(b->'LineItems')<>jsonb_array_length(a->'LineItems')
   or (select count(*) from jsonb_object_keys(d))<>jsonb_array_length(b->'LineItems')
   or (select count(distinct value->>'LineItemID') from jsonb_array_elements(b->'LineItems'))<>jsonb_array_length(b->'LineItems')
   or (b - case when b->>'Type'='ACCREC' then array['Date','DueDate','InvoiceNumber','LineItems','Reference'] else array['Date','DueDate','InvoiceNumber','LineItems'] end)
     is distinct from (a - case when b->>'Type'='ACCREC' then array['Date','DueDate','InvoiceNumber','LineItems','Reference'] else array['Date','DueDate','InvoiceNumber','LineItems'] end)
   or exists(select 1 from jsonb_each(h) x where a->x.key is distinct from x.value)
   then raise exception 'Correction changes exceed the exact field projection' using errcode='22023'; end if;
 for i in 0..jsonb_array_length(b->'LineItems')-1 loop
   l:=b->'LineItems'->i; n:=a->'LineItems'->i; v_id:=l->>'LineItemID';
   if jsonb_typeof(l) is distinct from 'object' or jsonb_typeof(n) is distinct from 'object' or coalesce(v_id,'') !~ v_uuid
     or (l-'Description') is distinct from (n-'Description') or jsonb_typeof(d->v_id) is distinct from 'string'
     or length(d->>v_id) not between 1 and 4000 or n->'Description' is distinct from d->v_id then
     raise exception 'Correction changed line identity or financial fields' using errcode='22023'; end if;
 end loop;
end $$;

create function public.xero_document_correction_insert_claim_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.xero_financial_document_mappings; v_previous jsonb;
begin
 if new.actor_id='00000000-0000-0000-0000-000000000000' or length(btrim(new.actor_email)) not between 1 and 320
   or new.actor_email<>lower(btrim(new.actor_email)) or octet_length(new.evidence_canonical)>250000
   or new.evidence_canonical::jsonb is distinct from new.evidence
   or new.evidence_hash is distinct from encode(sha256(convert_to(new.evidence_canonical,'UTF8')),'hex')
   or new.evidence_canonical is distinct from public.xero_document_correction_canonical_v1(new.evidence)
   then raise exception 'Invalid correction evidence hash or actor' using errcode='22023'; end if;
 perform public.xero_document_correction_assert_v1(new.evidence,new.xero_invoice_id);
 if not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=new.tenant_id::text) then
   raise exception 'Correction tenant changed' using errcode='40001'; end if;
 if public.xero_document_correction_active_v1() or exists(select 1 from public.xero_financial_sync_runs
   where status='processing' or (mode='payment_apply' and control_totals->'paymentPosting'->>'state' in ('intent','uncertain'))) then
   raise exception 'An unresolved accounting writer already holds the barrier' using errcode='40001'; end if;
 if new.mapping_id is null then
   if new.evidence->'mappingSnapshot' is distinct from 'null'::jsonb or exists(select 1 from public.xero_financial_document_mappings
     where lower(xero_document_id)=new.xero_invoice_id::text or (salesforce_object=new.evidence->'source'->>'object'
       and public.xero_grouped_salesforce_id_v1(salesforce_id)=public.xero_grouped_salesforce_id_v1(new.evidence->'source'->>'id'))) then
     raise exception 'Unmapped correction has an existing or conflicting mapping' using errcode='40001'; end if;
 else
   select * into m from public.xero_financial_document_mappings where id=new.mapping_id;
   if m.id is null or lower(m.xero_document_id)<>new.xero_invoice_id::text
     or m.xero_document_type is distinct from new.evidence->'before'->>'Type'
     or lower(m.xero_contact_id) is distinct from new.evidence->'before'->'Contact'->>'ContactID'
     or m.salesforce_object is distinct from new.evidence->'source'->>'object'
     or public.xero_grouped_salesforce_id_v1(m.salesforce_id) is distinct from public.xero_grouped_salesforce_id_v1(new.evidence->'source'->>'id')
     or (to_jsonb(m)-'last_reconciled_at'-'updated_at') is distinct from ((new.evidence->'mappingSnapshot')-'last_reconciled_at'-'updated_at') then
     raise exception 'Original correction mapping changed' using errcode='40001'; end if;
 end if;
 select c.evidence->'expectedAfter' into v_previous from public.xero_document_field_correction_claims c
   join public.xero_document_field_correction_events e on e.claim_id=c.id and e.status='confirmed'
   where c.tenant_id=new.tenant_id and c.xero_invoice_id=new.xero_invoice_id order by e.sequence desc limit 1;
 if v_previous is not null and v_previous is distinct from new.evidence->'before' then
   raise exception 'Prior confirmed correction changed' using errcode='40001'; end if;
 new.source_hash:=public.xero_document_correction_hash_v1(new.evidence->'source');
 new.before_hash:=public.xero_document_correction_hash_v1(new.evidence->'before');
 new.after_hash:=public.xero_document_correction_hash_v1(new.evidence->'expectedAfter');
 new.projection_hash:=public.xero_document_correction_hash_v1(new.evidence->'projection');
 return new;
end $$;

create function public.xero_document_correction_insert_event_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.xero_document_field_correction_claims;
begin
 select * into c from public.xero_document_field_correction_claims where id=new.claim_id;
 if c.id is null or new.actor_id<>c.actor_id or new.actor_email<>c.actor_email
   or octet_length(new.evidence_canonical)>250000 or new.evidence_canonical::jsonb is distinct from new.evidence
   or new.evidence_canonical is distinct from public.xero_document_correction_canonical_v1(new.evidence)
   or new.evidence_hash is distinct from encode(sha256(convert_to(new.evidence_canonical,'UTF8')),'hex')
   or jsonb_typeof(new.evidence) is distinct from 'object'
   or (new.evidence-'observed'-'basis'-'reason')<>'{}'::jsonb
   or not(new.evidence ? 'observed')
   or (new.evidence ? 'reason' and (jsonb_typeof(new.evidence->'reason') is distinct from 'string' or length(new.evidence->>'reason')>2000))
   or exists(select 1 from public.xero_document_field_correction_events where claim_id=c.id and status in ('confirmed','rejected')) then
   raise exception 'Correction outcome actor, evidence, or terminal state changed' using errcode='40001'; end if;
 if not exists(select 1 from public.xero_contact_sync_connections where id='primary' and tenant_id=c.tenant_id::text) then
   raise exception 'Correction tenant changed before outcome' using errcode='40001'; end if;
 new.linked_mapping_id:=null;
 if new.status='confirmed' then
   if new.evidence->>'basis' is distinct from 'exact_provider_readback' or new.evidence->'observed' is distinct from c.evidence->'expectedAfter' then
     raise exception 'Confirmation requires the complete exact expected snapshot' using errcode='40001'; end if;
   new.linked_mapping_id:=coalesce(c.mapping_id,gen_random_uuid());
 elsif new.status='rejected' then
   if new.evidence->>'basis' is distinct from 'definitive_provider_rejection' or new.evidence->'observed' is distinct from c.evidence->'before'
     or coalesce(length(btrim(new.evidence->>'reason')),0)=0 then
     raise exception 'Rejection requires definite provider rejection and unchanged exact readback' using errcode='40001'; end if;
 elsif new.status='uncertain' then
   if new.evidence->>'basis' is distinct from 'unconfirmed_provider_outcome' or jsonb_typeof(new.evidence->'observed') not in ('null','object') then
     raise exception 'Invalid uncertain correction evidence' using errcode='22023'; end if;
 else raise exception 'Unknown correction outcome' using errcode='22023'; end if;
 return new;
end $$;

-- The terminal event releases this transaction's barrier, but the shared
-- advisory lock remains held while the first real mapping is inserted. Any
-- conflicting owner rolls back BOTH records, leaving the original intent held.
create function public.xero_document_correction_link_confirmed_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.xero_document_field_correction_claims; s jsonb; a jsonb;
begin
 if new.status<>'confirmed' then return new; end if;
 select * into c from public.xero_document_field_correction_claims where id=new.claim_id;
 if c.mapping_id is not null then return new; end if;
 s:=c.evidence->'source'; a:=c.evidence->'expectedAfter';
 if exists(select 1 from public.xero_financial_document_mappings where lower(xero_document_id)=c.xero_invoice_id::text
   or (salesforce_object=s->>'object' and public.xero_grouped_salesforce_id_v1(salesforce_id)=public.xero_grouped_salesforce_id_v1(s->>'id'))) then
   raise exception 'Confirmed correction cannot replace an existing identity owner' using errcode='40001'; end if;
 insert into public.xero_financial_document_mappings(id,salesforce_object,salesforce_id,salesforce_document_number,document_kind,
   xero_document_type,xero_document_id,xero_document_number,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences)
 values(new.linked_mapping_id,s->>'object',s->>'id',s->>'documentNumber',s->>'documentKind',s->>'xeroType',c.xero_invoice_id::text,
   a->>'InvoiceNumber',s->>'contactId',a->>'Status',s->>'sourceFingerprint',s->>'financialFingerprint',true,
   jsonb_build_object('accountId',s->>'accountId','documentFieldCorrection',jsonb_build_object('policyVersion','document_field_correction_v1','claimId',c.id)));
 return new;
end $$;

create function public.xero_document_correction_guard_writer_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_table_name='xero_financial_document_mappings' and tg_op<>'INSERT' then
   if exists(select 1 from public.xero_document_field_correction_events where linked_mapping_id=old.id and status='confirmed') then
     if tg_op='DELETE' or (to_jsonb(new)-'last_reconciled_at'-'updated_at') is distinct from (to_jsonb(old)-'last_reconciled_at'-'updated_at') then
       raise exception 'A corrected document mapping is immutable' using errcode='40001'; end if;
   end if;
 end if;
 if tg_table_name='xero_financial_sync_runs' then
   -- Read-only preview persistence remains available. Every payment claim/link
   -- writer and processing document run participates, including legacy callers.
   if tg_op='DELETE' then return old; end if;
   if new.mode<>'payment_apply' and new.status<>'processing' then return new; end if;
 end if;
 if public.xero_document_correction_active_v1() then raise exception 'Unresolved document correction blocks accounting or identity writes' using errcode='40001'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;

create trigger correction_claim_serialize before insert on public.xero_document_field_correction_claims for each statement execute function public.xero_document_correction_serialize_v1();
create trigger correction_event_serialize before insert on public.xero_document_field_correction_events for each statement execute function public.xero_document_correction_serialize_v1();
create trigger correction_claim_validate before insert on public.xero_document_field_correction_claims for each row execute function public.xero_document_correction_insert_claim_v1();
create trigger correction_event_validate before insert on public.xero_document_field_correction_events for each row execute function public.xero_document_correction_insert_event_v1();
create trigger correction_event_link after insert on public.xero_document_field_correction_events for each row execute function public.xero_document_correction_link_confirmed_v1();
create trigger correction_claim_immutable before update or delete on public.xero_document_field_correction_claims for each row execute function public.xero_document_correction_immutable_v1();
create trigger correction_event_immutable before update or delete on public.xero_document_field_correction_events for each row execute function public.xero_document_correction_immutable_v1();
create trigger correction_preview_immutable before update or delete on public.xero_document_field_correction_previews for each row execute function public.xero_document_correction_immutable_v1();
create trigger correction_mapping_serialize before insert or update or delete on public.xero_financial_document_mappings for each statement execute function public.xero_document_correction_serialize_v1();
create trigger correction_payment_serialize before insert or update or delete on public.xero_financial_payment_mappings for each statement execute function public.xero_document_correction_serialize_v1();
create trigger correction_run_serialize before insert or update or delete on public.xero_financial_sync_runs for each statement execute function public.xero_document_correction_serialize_v1();
create trigger correction_mapping_guard before insert or update or delete on public.xero_financial_document_mappings for each row execute function public.xero_document_correction_guard_writer_v1();
create trigger correction_payment_guard before insert or update or delete on public.xero_financial_payment_mappings for each row execute function public.xero_document_correction_guard_writer_v1();
create trigger correction_run_guard before insert or update or delete on public.xero_financial_sync_runs for each row execute function public.xero_document_correction_guard_writer_v1();

create function public.claim_xero_document_field_correction_v1(p_tenant_id uuid,p_xero_invoice_id uuid,p_mapping_id uuid,p_idempotency_key text,
 p_evidence jsonb,p_canonical text,p_fingerprint text,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.xero_document_field_correction_claims; e public.xero_document_field_correction_events; v_replay boolean:=false;
begin
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_document_field_correction_claims where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
 if c.id is not null then
   if c.xero_invoice_id is distinct from p_xero_invoice_id or c.mapping_id is distinct from p_mapping_id
     or c.actor_id is distinct from p_actor_id or c.actor_email is distinct from p_actor_email
     or c.evidence is distinct from p_evidence or c.evidence_canonical is distinct from p_canonical or c.evidence_hash is distinct from p_fingerprint then
     raise exception 'Correction idempotency key evidence changed' using errcode='40001'; end if;
   v_replay:=true;
 else
   insert into public.xero_document_field_correction_claims(tenant_id,xero_invoice_id,mapping_id,idempotency_key,evidence,evidence_canonical,evidence_hash,actor_id,actor_email)
   values(p_tenant_id,p_xero_invoice_id,p_mapping_id,p_idempotency_key,p_evidence,p_canonical,p_fingerprint,p_actor_id,p_actor_email) returning * into c;
 end if;
 select * into e from public.xero_document_field_correction_events where claim_id=c.id order by sequence desc limit 1;
 return to_jsonb(c)||jsonb_build_object('status',coalesce(e.status,'intent'),'latestReceipt',case when e.id is null then null else to_jsonb(e) end,'alreadyClaimed',v_replay);
end $$;

create function public.finish_xero_document_field_correction_v1(p_claim_id uuid,p_status text,p_evidence jsonb,p_canonical text,p_fingerprint text,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.xero_document_field_correction_claims; e public.xero_document_field_correction_events;
begin
 perform public.xero_document_correction_lock_v1();
 select * into c from public.xero_document_field_correction_claims where id=p_claim_id;
 if c.id is null or c.actor_id is distinct from p_actor_id or c.actor_email is distinct from p_actor_email then
   raise exception 'Correction claim or actor changed' using errcode='40001'; end if;
 select * into e from public.xero_document_field_correction_events where claim_id=c.id order by sequence desc limit 1;
 if e.id is not null and e.status=p_status and e.evidence=p_evidence and e.evidence_canonical=p_canonical and e.evidence_hash=p_fingerprint then
   return to_jsonb(e)||jsonb_build_object('claim',to_jsonb(c),'linkedMapping',(select to_jsonb(m) from public.xero_financial_document_mappings m where m.id=e.linked_mapping_id));
 end if;
 insert into public.xero_document_field_correction_events(claim_id,status,evidence,evidence_canonical,evidence_hash,actor_id,actor_email)
 values(p_claim_id,p_status,p_evidence,p_canonical,p_fingerprint,p_actor_id,p_actor_email) returning * into e;
 return to_jsonb(e)||jsonb_build_object('claim',to_jsonb(c),'linkedMapping',(select to_jsonb(m) from public.xero_financial_document_mappings m where m.id=e.linked_mapping_id));
end $$;

alter table public.xero_document_field_correction_previews enable row level security;
alter table public.xero_document_field_correction_claims enable row level security;
alter table public.xero_document_field_correction_events enable row level security;
revoke all on public.xero_document_field_correction_previews,public.xero_document_field_correction_claims,public.xero_document_field_correction_events from public,anon,authenticated,service_role;
grant select,insert on public.xero_document_field_correction_previews,public.xero_document_field_correction_claims,public.xero_document_field_correction_events to service_role;
grant usage,select on sequence public.xero_document_field_correction_events_sequence_seq to service_role;
revoke all on function public.xero_document_correction_canonical_v1(jsonb),public.xero_document_correction_hash_v1(jsonb),public.xero_document_correction_date_v1(text),
 public.xero_document_correction_lock_v1(),public.xero_document_correction_serialize_v1(),public.xero_document_correction_active_v1(),public.xero_document_correction_immutable_v1(),
 public.xero_document_correction_assert_v1(jsonb,uuid),public.xero_document_correction_insert_claim_v1(),public.xero_document_correction_insert_event_v1(),public.xero_document_correction_link_confirmed_v1(),public.xero_document_correction_guard_writer_v1(),
 public.claim_xero_document_field_correction_v1(uuid,uuid,uuid,text,jsonb,text,text,uuid,text),public.finish_xero_document_field_correction_v1(uuid,text,jsonb,text,text,uuid,text)
 from public,anon,authenticated;
grant execute on function public.xero_document_correction_canonical_v1(jsonb),public.xero_document_correction_hash_v1(jsonb),public.xero_document_correction_date_v1(text),
 public.xero_document_correction_lock_v1(),public.xero_document_correction_serialize_v1(),public.xero_document_correction_active_v1(),public.xero_document_correction_immutable_v1(),
 public.xero_document_correction_assert_v1(jsonb,uuid),public.xero_document_correction_insert_claim_v1(),public.xero_document_correction_insert_event_v1(),public.xero_document_correction_link_confirmed_v1(),public.xero_document_correction_guard_writer_v1(),
 public.claim_xero_document_field_correction_v1(uuid,uuid,uuid,text,jsonb,text,text,uuid,text),public.finish_xero_document_field_correction_v1(uuid,text,jsonb,text,text,uuid,text)
 to service_role;

-- Fetch a bounded immutable page inside PostgreSQL rather than returning the
-- complete private preview to a serverless caller just to discard most rows.
create function public.read_xero_document_field_correction_page_v1(p_preview_id uuid,p_offset integer)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare p public.xero_document_field_correction_previews; n integer; page jsonb;
begin
 if p_preview_id is null or p_offset is null or p_offset<0 or p_offset%100<>0 then
   raise exception 'An exact preview and nonnegative 100-row offset are required' using errcode='22023'; end if;
 select * into p from public.xero_document_field_correction_previews where id=p_preview_id;
 if p.id is null then raise exception 'Correction preview does not exist' using errcode='22023'; end if;
 n:=jsonb_array_length(p.items);
 if p_offset>=n and not(p_offset=0 and n=0) then
   raise exception 'Correction preview offset is outside its immutable items' using errcode='22023'; end if;
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into page
   from jsonb_array_elements(p.items) with ordinality x(value,ord) where ord>p_offset and ord<=p_offset+100;
 return jsonb_build_object('id',p.id,'policy',p.policy,'created_at',p.created_at,'summary',p.summary,
   'totalCount',n,'nextOffset',case when p_offset+100<n then p_offset+100 else null end,'items',page);
end $$;
revoke all on function public.read_xero_document_field_correction_page_v1(uuid,integer) from public,anon,authenticated;
grant execute on function public.read_xero_document_field_correction_page_v1(uuid,integer) to service_role;
