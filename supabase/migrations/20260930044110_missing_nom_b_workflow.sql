begin;

-- Activation is prospective and occurs only in the explicitly enabled production worker.
create table public.missing_nom_b_scan_state (
  source_org_id text primary key,
  activated_at timestamptz not null default now(),
  completed_through timestamptz not null default now(),
  cursor_at timestamptz,
  cursor_id text,
  scan_until timestamptz,
  claim_token uuid,
  claim_until timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.missing_nom_b_reminders (
  id uuid primary key default gen_random_uuid(),
  source_org_id text not null references public.missing_nom_b_scan_state(source_org_id),
  stem_id text not null,
  invoice_id text not null,
  invoice_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'Pending' check (status in ('Pending','Processing','Sending','Sent','Failed','Blocked','Suppressed','Uncertain')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claim_until timestamptz,
  nomination_id text,
  recipient_user_id uuid,
  recipient_email text,
  evidence_fingerprint text,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_org_id, stem_id)
);
create index missing_nom_b_reminder_due_idx on public.missing_nom_b_reminders(source_org_id,status,next_attempt_at);
create table public.missing_nom_b_upload_operations (
  source_org_id text not null,
  operation_id uuid not null,
  user_id uuid not null,
  stem_id text not null,
  nomination_id text not null,
  request_hash text not null,
  source_fingerprint text not null,
  status text not null default 'Reserved' check(status in ('Reserved','Posting','Uncertain','Completed','Rejected')),
  claim_token uuid,
  claim_until timestamptz,
  result jsonb,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(source_org_id, operation_id)
);
create unique index missing_nom_b_upload_active_idx on public.missing_nom_b_upload_operations(source_org_id,nomination_id)
  where status in ('Reserved','Posting','Uncertain');

create function public.missing_nom_b_claim_scan(p_org text, p_token uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare s public.missing_nom_b_scan_state;
begin
  insert into public.missing_nom_b_scan_state(source_org_id) values(p_org) on conflict do nothing;
  select * into s from public.missing_nom_b_scan_state where source_org_id=p_org for update;
  if s.claim_until > now() then return null; end if;
  update public.missing_nom_b_scan_state set
    claim_token=p_token, claim_until=now()+interval '2 minutes',
    cursor_at=coalesce(cursor_at,greatest(activated_at,completed_through-interval '10 minutes')),
    cursor_id=coalesce(cursor_id,''), scan_until=coalesce(scan_until,now()), updated_at=now()
  where source_org_id=p_org returning * into s;
  return to_jsonb(s);
end $$;

-- Discovery insertion and checkpoint move are one transaction. Failed writes cannot skip invoices.
create function public.missing_nom_b_checkpoint(p_org text,p_token uuid,p_discoveries jsonb,p_cursor_at timestamptz,p_cursor_id text,p_done boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare s public.missing_nom_b_scan_state; item jsonb;
begin
  select * into s from public.missing_nom_b_scan_state where source_org_id=p_org for update;
  if s.claim_token is distinct from p_token or s.claim_until <= now() then raise exception 'MISSING_NOM_B_SCAN_CLAIM_LOST'; end if;
  if p_cursor_at < s.cursor_at or p_cursor_at > s.scan_until then raise exception 'MISSING_NOM_B_CURSOR_INVALID'; end if;
  for item in select value from jsonb_array_elements(p_discoveries) loop
    insert into public.missing_nom_b_reminders(source_org_id,stem_id,invoice_id,invoice_evidence)
    values(p_org,item->>'stemId',item->>'invoiceId',item->'invoice')
    on conflict(source_org_id,stem_id) do update set status='Pending',invoice_id=excluded.invoice_id,invoice_evidence=excluded.invoice_evidence,
      next_attempt_at=now(),claim_token=null,claim_until=null,last_error_code=null,updated_at=now()
    where missing_nom_b_reminders.status='Suppressed' and missing_nom_b_reminders.invoice_id<>excluded.invoice_id;
  end loop;
  update public.missing_nom_b_scan_state set
    completed_through=case when p_done then scan_until else completed_through end,
    cursor_at=case when p_done then null else p_cursor_at end,
    cursor_id=case when p_done then null else p_cursor_id end,
    scan_until=case when p_done then null else scan_until end,
    claim_token=case when p_done then null else p_token end,
    claim_until=case when p_done then null else now()+interval '2 minutes' end,
    last_success_at=case when p_done then now() else last_success_at end,updated_at=now()
  where source_org_id=p_org returning * into s;
  return to_jsonb(s);
end $$;

create function public.missing_nom_b_claim_reminders(p_org text,p_token uuid,p_limit integer default 20)
returns setof public.missing_nom_b_reminders language plpgsql security invoker set search_path = public as $$
begin
  -- Once the outbound boundary was crossed, a dead worker is never retried automatically.
  update public.missing_nom_b_reminders set status='Uncertain',last_error_code='STALE_SENDING',updated_at=now()
    where source_org_id=p_org and status='Sending' and claim_until<=now();
  return query with due as (
    select id from public.missing_nom_b_reminders where source_org_id=p_org and
      ((status in ('Pending','Failed','Blocked') and next_attempt_at<=now()) or (status='Processing' and claim_until<=now()))
    order by next_attempt_at,created_at for update skip locked limit least(greatest(p_limit,1),50)
  ) update public.missing_nom_b_reminders r set status='Processing',claim_token=p_token,
      claim_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
    from due where r.id=due.id returning r.*;
end $$;

create function public.missing_nom_b_begin_send(p_id uuid,p_token uuid,p_nomination text,p_user uuid,p_email text,p_fingerprint text,p_invoice jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare r public.missing_nom_b_reminders;
begin
  select * into r from public.missing_nom_b_reminders where id=p_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.source_org_id||':'||r.stem_id,0));
  select * into r from public.missing_nom_b_reminders where id=p_id for update;
  if r.status<>'Processing' or r.claim_token is distinct from p_token or r.claim_until<=now() then return false; end if;
  update public.missing_nom_b_upload_operations set status='Rejected',last_error_code='RESERVATION_EXPIRED',updated_at=now()
    where source_org_id=r.source_org_id and stem_id=r.stem_id and status='Reserved' and claim_until<=now();
  if exists(select 1 from public.missing_nom_b_upload_operations where source_org_id=r.source_org_id and stem_id=r.stem_id and status in ('Reserved','Posting','Uncertain')) then return false; end if;
  update public.missing_nom_b_reminders set status='Sending',nomination_id=p_nomination,recipient_user_id=p_user,
    recipient_email=p_email,evidence_fingerprint=p_fingerprint,invoice_id=p_invoice->>'Id',invoice_evidence=p_invoice,claim_until=now()+interval '5 minutes',updated_at=now() where id=p_id;
  return true;
end $$;

create function public.missing_nom_b_finish_reminder(p_id uuid,p_token uuid,p_status text,p_code text default null,p_delay_seconds integer default 300)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  if p_status not in ('Sent','Failed','Blocked','Suppressed','Uncertain') then raise exception 'MISSING_NOM_B_STATE_INVALID'; end if;
  update public.missing_nom_b_reminders set status=p_status,last_error_code=p_code,
    sent_at=case when p_status='Sent' then now() else sent_at end,
    next_attempt_at=now()+make_interval(secs=>greatest(p_delay_seconds,60)),claim_until=null,updated_at=now()
    where id=p_id and claim_token=p_token and status in ('Processing','Sending');
  return found;
end $$;

create function public.missing_nom_b_reserve_upload(p_org text,p_operation uuid,p_user uuid,p_stem text,p_nomination text,p_hash text,p_fingerprint text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare u public.missing_nom_b_upload_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org||':operation:'||p_operation::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_org||':'||p_stem,0));
  select * into u from public.missing_nom_b_upload_operations where source_org_id=p_org and operation_id=p_operation for update;
  if found then
    if u.user_id<>p_user or u.request_hash<>p_hash or u.nomination_id<>p_nomination or u.stem_id<>p_stem then raise exception 'MISSING_NOM_B_OPERATION_MISMATCH'; end if;
    if u.status='Completed' then return to_jsonb(u)||jsonb_build_object('acquired',false); end if;
    if u.status in ('Posting','Uncertain') then return to_jsonb(u)||jsonb_build_object('acquired',false); end if;
    if u.source_fingerprint<>p_fingerprint then raise exception 'MISSING_NOM_B_SOURCE_CHANGED'; end if;
    if u.claim_until>now() and u.status='Reserved' then return to_jsonb(u)||jsonb_build_object('acquired',false); end if;
  end if;
  update public.missing_nom_b_upload_operations set status='Rejected',last_error_code='RESERVATION_EXPIRED',updated_at=now()
    where source_org_id=p_org and stem_id=p_stem and status='Reserved' and claim_until<=now();
  update public.missing_nom_b_reminders set status='Uncertain',last_error_code='STALE_SENDING',updated_at=now()
    where source_org_id=p_org and stem_id=p_stem and status='Sending' and claim_until<=now();
  if exists(select 1 from public.missing_nom_b_reminders where source_org_id=p_org and stem_id=p_stem and status='Sending') then raise exception 'MISSING_NOM_B_REMINDER_IN_FLIGHT'; end if;
  if exists(select 1 from public.missing_nom_b_upload_operations where source_org_id=p_org and nomination_id=p_nomination and operation_id<>p_operation and status in ('Reserved','Posting','Uncertain')) then raise exception 'MISSING_NOM_B_UPLOAD_IN_FLIGHT'; end if;
  insert into public.missing_nom_b_upload_operations(source_org_id,operation_id,user_id,stem_id,nomination_id,request_hash,source_fingerprint,claim_token,claim_until)
    values(p_org,p_operation,p_user,p_stem,p_nomination,p_hash,p_fingerprint,p_token,now()+interval '2 minutes')
    on conflict(source_org_id,operation_id) do update set status='Reserved',claim_token=p_token,claim_until=now()+interval '2 minutes',updated_at=now()
    returning * into u;
  return to_jsonb(u)||jsonb_build_object('acquired',true);
end $$;

create function public.missing_nom_b_upload_transition(p_org text,p_operation uuid,p_token uuid,p_status text,p_result jsonb default null,p_code text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  if p_status not in ('Posting','Completed','Uncertain','Rejected') then raise exception 'MISSING_NOM_B_UPLOAD_STATE_INVALID'; end if;
  update public.missing_nom_b_upload_operations set status=p_status,result=coalesce(p_result,result),last_error_code=p_code,updated_at=now()
  where source_org_id=p_org and operation_id=p_operation and claim_token=p_token and
    ((p_status='Posting' and status='Reserved' and claim_until>now()) or
     (p_status in ('Completed','Uncertain') and status in ('Posting','Uncertain')) or
     (p_status='Rejected' and status in ('Reserved','Posting')));
  return found;
end $$;

alter table public.missing_nom_b_scan_state enable row level security;
alter table public.missing_nom_b_reminders enable row level security;
alter table public.missing_nom_b_upload_operations enable row level security;
revoke all on public.missing_nom_b_scan_state,public.missing_nom_b_reminders,public.missing_nom_b_upload_operations from public,anon,authenticated;
grant all on public.missing_nom_b_scan_state,public.missing_nom_b_reminders,public.missing_nom_b_upload_operations to service_role;
revoke all on function public.missing_nom_b_claim_scan(text,uuid),public.missing_nom_b_checkpoint(text,uuid,jsonb,timestamptz,text,boolean),public.missing_nom_b_claim_reminders(text,uuid,integer),public.missing_nom_b_begin_send(uuid,uuid,text,uuid,text,text,jsonb),public.missing_nom_b_finish_reminder(uuid,uuid,text,text,integer),public.missing_nom_b_reserve_upload(text,uuid,uuid,text,text,text,text,uuid),public.missing_nom_b_upload_transition(text,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.missing_nom_b_claim_scan(text,uuid),public.missing_nom_b_checkpoint(text,uuid,jsonb,timestamptz,text,boolean),public.missing_nom_b_claim_reminders(text,uuid,integer),public.missing_nom_b_begin_send(uuid,uuid,text,uuid,text,text,jsonb),public.missing_nom_b_finish_reminder(uuid,uuid,text,text,integer),public.missing_nom_b_reserve_upload(text,uuid,uuid,text,text,text,text,uuid),public.missing_nom_b_upload_transition(text,uuid,uuid,text,jsonb,text) to service_role;

insert into public.email_sender_purposes(purpose_key,label,description,module_id,sort_order)
values('missing_nom_b_reminders','Missing Nom B reminders','Once-per-STEM internal reminders for missing Buyer Nom B files.','dashboard',25)
on conflict(purpose_key) do nothing;
insert into public.email_sender_routes(purpose_key,mailbox_id)
select 'missing_nom_b_reminders',r.mailbox_id from public.email_sender_routes r
join public.email_sender_mailboxes m on m.id=r.mailbox_id
where r.purpose_key='outstanding_invoice_reports' and m.active and m.verification_state='verified'
on conflict(purpose_key) do nothing;
insert into public.email_sender_routes(purpose_key) values('missing_nom_b_reminders') on conflict(purpose_key) do nothing;
commit;
