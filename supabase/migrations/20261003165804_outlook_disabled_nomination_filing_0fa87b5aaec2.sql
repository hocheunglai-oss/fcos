-- REVIEW/APPROVAL PROPOSAL ONLY: production FCOS pjforfvchygdyqfcgpmw, filing disabled.
-- Recheck the exact project, current default ACLs and schema collisions immediately before approval/application.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF to_regclass('public.fcos_nomination_filing_grants') IS NOT NULL
    OR to_regclass('public.fcos_nomination_operations') IS NOT NULL
    OR to_regclass('public.fcos_nomination_slot_locks') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fcos_nomination_operation')
    OR EXISTS(SELECT 1 FROM public.app_modules WHERE id='outlook_nomination_filing' OR path='/outlook-nomination-filing')
  THEN RAISE EXCEPTION 'Pilot schema/module collision: abort rather than overwrite'; END IF;
END $$;
-- LOCAL CANDIDATE ONLY: no live migration or grant is authorized.
insert into public.app_modules(id,label,path,sort_order) values('outlook_nomination_filing','Outlook Nomination Filing','/outlook-nomination-filing',190) on conflict(id) do nothing;
-- No module membership or record grants are created by this migration.
create table public.fcos_nomination_filing_grants (
  user_id uuid not null,
  org_id text not null check (org_id ~ '^00D[A-Za-z0-9]{15}$'),
  record_id text not null check (record_id ~ '^[A-Za-z0-9]{18}$'),
  slot text not null check (slot in ('NOM B','CON S','Others')),
  salesforce_user_id text not null check (salesforce_user_id ~ '^005[A-Za-z0-9]{15}$'),
  proof_hash text not null check (proof_hash ~ '^[a-f0-9]{64}$'),
  permissions_verified boolean not null default false,
  audience_verified boolean not null default false,
  expires_at timestamptz not null,
  primary key(user_id,org_id,record_id,slot)
);
create table public.fcos_nomination_operations (
  id uuid primary key,
  user_id uuid not null,
  slot_key text not null,
  data jsonb not null,
  claim uuid,
  cancel_requested boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.fcos_nomination_slot_locks (
  slot_key text primary key,
  operation_id uuid not null references public.fcos_nomination_operations(id)
);
alter table public.fcos_nomination_filing_grants enable row level security;
alter table public.fcos_nomination_operations enable row level security;
alter table public.fcos_nomination_slot_locks enable row level security;
revoke all on public.fcos_nomination_filing_grants,public.fcos_nomination_operations,public.fcos_nomination_slot_locks from public,anon,authenticated,service_role;
grant select on public.fcos_nomination_filing_grants to service_role;
grant select,insert,update,delete on public.fcos_nomination_operations,public.fcos_nomination_slot_locks to service_role;

create function public.fcos_nomination_operation(p_action text,p_operation_id uuid,p_user_id uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare o public.fcos_nomination_operations; k text; c uuid; r jsonb; result jsonb; f jsonb; i integer;
begin
  if p_action='create' then
    if p_user_id is null or p_data->>'userId' <> p_user_id::text or p_data->>'id' <> p_operation_id::text then raise exception 'Invalid principal'; end if;
    k := p_data->>'orgId' || ':' || (p_data->'destination'->>'recordId') || ':' || (p_data->'destination'->>'slot');
    insert into public.fcos_nomination_operations(id,user_id,slot_key,data) values(p_operation_id,p_user_id,k,p_data);
    return p_data;
  end if;
  if p_action='completed' then
    result := '[]';
    for f in select value from jsonb_array_elements(p_data->'files') loop
      select receipt into r from public.fcos_nomination_operations t cross join lateral jsonb_array_elements(t.data->'receipts') receipt
        where t.user_id=p_user_id and t.data->>'orgId'=p_data->>'orgId'
        and t.data->'destination'=p_data->'destination' and receipt->>'sha256'=f->>'sha256' and receipt->>'fileName'=f->>'name'
        and receipt->>'mime'=f->>'mime' order by t.updated_at desc limit 1;
      result := result || jsonb_build_array(r); r := null;
    end loop;
    return result;
  end if;
  select * into o from public.fcos_nomination_operations where id=p_operation_id for update;
  if not found then return null; end if;
  if p_user_id is not null and o.user_id<>p_user_id then raise exception 'Invalid principal'; end if;
  if p_action='read' then return o.data; end if;
  if p_action='claim' then
    if o.cancel_requested or o.claim is not null or o.data->>'state' not in ('confirmed','running') or (o.data->>'cursor')::integer is distinct from (p_data->>'cursor')::integer then return null; end if;
    insert into public.fcos_nomination_slot_locks values(o.slot_key,o.id) on conflict do nothing;
    if not exists(select 1 from public.fcos_nomination_slot_locks where slot_key=o.slot_key and operation_id=o.id) then return null; end if;
    c := gen_random_uuid();
    -- Crash-safe: state becomes uncertain BEFORE any Salesforce request. There is no lease takeover.
    update public.fcos_nomination_operations set claim=c,data=jsonb_set(jsonb_set(data,'{state}','"uncertain"'),'{pending}',(p_data->'pending') || jsonb_build_object('attemptId',c)),updated_at=now() where id=o.id;
    return to_jsonb(c);
  end if;
  if p_action='cancel' then
    if o.data->>'state'='uncertain' then
      update public.fcos_nomination_operations set cancel_requested=true where id=o.id;
      return jsonb_build_object('state','reconciliation-required','receipts',o.data->'receipts');
    end if;
    update public.fcos_nomination_operations set data=jsonb_set(data,'{state}','"cancelled"'),cancel_requested=true,updated_at=now() where id=o.id;
    delete from public.fcos_nomination_slot_locks where operation_id=o.id;
    return jsonb_build_object('state','cancelled','receipts',o.data->'receipts');
  end if;
  if p_action in ('advance','uncertain','failed') and (o.claim is null or o.claim::text is distinct from p_data->>'claim') then raise exception 'Claim mismatch'; end if;
  if p_action='failed' then
    update public.fcos_nomination_operations set claim=null,data=jsonb_set(data - 'pending','{state}',case when o.cancel_requested then '"cancelled"'::jsonb when (data->>'cursor')::integer=0 then '"confirmed"'::jsonb else '"running"'::jsonb end),updated_at=now() where id=o.id returning data into result;
    if o.cancel_requested then delete from public.fcos_nomination_slot_locks where operation_id=o.id; end if;
    return result;
  end if;
  if p_action='uncertain' then
    if o.data->'pending'->>'requestKey' is distinct from p_data->'pending'->>'requestKey' then raise exception 'Pending request mismatch'; end if;
    update public.fcos_nomination_operations set claim=null,data=jsonb_set(data,'{pending}',(o.data->'pending') || jsonb_build_object('code',p_data->'pending'->'code')),updated_at=now() where id=o.id;
    return null;
  end if;
  if p_action in ('advance','recover') then
    if p_action='recover' and (o.data->>'state' is distinct from 'uncertain'
      or (o.data->>'cursor')::integer is distinct from (p_data->'expected'->>'cursor')::integer
      or o.data->'pending'->>'requestKey' is distinct from p_data->'expected'->>'requestKey'
      or o.data->'pending'->>'attemptId' is distinct from p_data->'expected'->>'attemptId'
      or p_data->'expected'->>'attemptId' is null) then return null; end if;
    f := o.data->'proposal'->'files'->((o.data->>'cursor')::integer);
    if f is null or p_data->'receipt'->>'key' is distinct from o.data->'pending'->>'requestKey'
      or p_data->'receipt'->>'fileName' is distinct from f->>'name'
      or p_data->'receipt'->>'sha256' is distinct from f->>'sha256'
      or p_data->'receipt'->>'mime' is distinct from f->>'mime'
      or p_data->'receipt'->>'size' is distinct from f->>'size'
      or p_data->'receipt'->>'versionNumber' is distinct from f->>'projectedVersion'
      or p_data->'receipt'->>'recordId' is distinct from o.data->'destination'->>'recordId'
      or p_data->'receipt'->>'slot' is distinct from o.data->'destination'->>'slot'
      or p_data->'receipt'->>'salesforceUserId' is distinct from o.data->>'salesforceUserId'
      or p_data->'receipt'->>'action' is distinct from f->>'action'
      or p_data->'receipt'->>'workflow' is distinct from (case when f->>'action'='already-filed' or o.data->'destination'->>'slot'='Others' then 'unchanged' else 'set-received-green' end)
      or p_data->'receipt'->'receivedStatus' is distinct from p_data->'snapshot'->'receivedStatus'
      or (p_data->'receipt'->>'workflow'='set-received-green' and p_data->'snapshot'->>'receivedStatus' is distinct from '🟢')
      or p_data->'snapshot'->>'recordId' is distinct from o.data->'destination'->>'recordId'
      or p_data->'snapshot'->>'slot' is distinct from o.data->'destination'->>'slot'
      or p_data->'snapshot'->>'salesforceUserId' is distinct from o.data->>'salesforceUserId'
      or p_data->'snapshot'->>'documentId' is distinct from p_data->'receipt'->>'contentDocumentId'
      or (f->>'action'='already-filed' and p_data->'snapshot'->>'fingerprint' is distinct from o.data->'snapshot'->>'fingerprint')
      or (f->>'action'='new-version' and p_data->'receipt'->>'snapshotFingerprint' is distinct from p_data->'snapshot'->>'fingerprint')
      or p_data->'receipt'->>'slotVerified' is distinct from 'true'
      or p_data->'receipt'->>'receivedVerified' is distinct from 'true' then raise exception 'Receipt identity mismatch'; end if;
    i := (o.data->>'cursor')::integer + 1;
    result := (o.data - 'pending') || jsonb_build_object('cursor',i,'receipts',(o.data->'receipts') || jsonb_build_array(p_data->'receipt'),'snapshot',p_data->'snapshot',
      'state',case when o.cancel_requested then 'cancelled' when i=jsonb_array_length(o.data->'proposal'->'files') then 'complete' else 'running' end);
    update public.fcos_nomination_operations set data=result,claim=null,updated_at=now() where id=o.id;
    if result->>'state' in ('complete','cancelled') then delete from public.fcos_nomination_slot_locks where operation_id=o.id; end if;
    return result;
  end if;
  raise exception 'Unknown operation';
end $$;
revoke all on function public.fcos_nomination_operation(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.fcos_nomination_operation(text,uuid,uuid,jsonb) to service_role;

COMMIT;
