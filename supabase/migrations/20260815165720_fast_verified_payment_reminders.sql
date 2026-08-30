begin;

create table if not exists public.buyer_invoice_payment_reminder_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 16 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  anchor_stem_id text not null check (anchor_stem_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  selected_stem_ids text[] not null default '{}'::text[],
  status text not null default 'validating'
    check (status in ('validating', 'sending', 'partial', 'accepted', 'failed', 'uncertain', 'completed')),
  batch_count integer not null default 0 check (batch_count between 1 and 100),
  accepted_batch_count integer not null default 0 check (accepted_batch_count between 0 and 100),
  failed_batch_count integer not null default 0 check (failed_batch_count between 0 and 100),
  timeline_recorded boolean not null default false,
  prepare_ms integer null check (prepare_ms is null or prepare_ms >= 0),
  validation_ms integer null check (validation_ms is null or validation_ms >= 0),
  graph_ms integer null check (graph_ms is null or graph_ms >= 0),
  timeline_ms integer null check (timeline_ms is null or timeline_ms >= 0),
  result_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_snapshot) = 'object'),
  error_code text null check (error_code is null or char_length(error_code) <= 100),
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null check (actor_email is null or char_length(actor_email) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.buyer_invoice_payment_reminder_batches (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.buyer_invoice_payment_reminder_operations(id) on delete restrict,
  batch_key_hash text not null check (batch_key_hash ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  stem_ids text[] not null default '{}'::text[],
  status text not null default 'sending'
    check (status in ('sending', 'accepted', 'failed', 'uncertain')),
  row_count integer not null default 0 check (row_count between 1 and 10000),
  recipient_count integer not null default 0 check (recipient_count between 1 and 1000),
  provider_request_id text null check (provider_request_id is null or char_length(provider_request_id) <= 200),
  graph_ms integer null check (graph_ms is null or graph_ms >= 0),
  error_code text null check (error_code is null or char_length(error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (operation_id, batch_key_hash)
);

create index if not exists buyer_invoice_payment_reminder_operations_repair_idx
on public.buyer_invoice_payment_reminder_operations(status, timeline_recorded, updated_at)
where timeline_recorded = false and status in ('partial', 'accepted', 'uncertain');

create index if not exists buyer_invoice_payment_reminder_batches_operation_idx
on public.buyer_invoice_payment_reminder_batches(operation_id, status);

alter table public.buyer_invoice_payment_reminder_operations enable row level security;
alter table public.buyer_invoice_payment_reminder_batches enable row level security;
revoke all on table public.buyer_invoice_payment_reminder_operations from public, anon, authenticated;
revoke all on table public.buyer_invoice_payment_reminder_batches from public, anon, authenticated;
grant all on table public.buyer_invoice_payment_reminder_operations to service_role;
grant all on table public.buyer_invoice_payment_reminder_batches to service_role;

create or replace function public.reserve_buyer_invoice_payment_reminder_operation(
  p_idempotency_key text,
  p_request_hash text,
  p_anchor_stem_id text,
  p_selected_stem_ids text[],
  p_batch_count integer,
  p_actor_user_id uuid,
  p_actor_email text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.buyer_invoice_payment_reminder_operations;
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_anchor_stem_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
    or p_batch_count not between 1 and 100
    or coalesce(array_length(p_selected_stem_ids, 1), 0) < 1 then
    raise exception 'Invalid payment reminder operation identity.';
  end if;

  select * into v_row
  from public.buyer_invoice_payment_reminder_operations
  where idempotency_key = btrim(p_idempotency_key)
  for update;

  if found then
    if v_row.request_hash <> p_request_hash then
      raise exception 'This payment reminder operation ID was already used for different data.';
    end if;
    if v_row.status = 'completed' then
      return jsonb_build_object('replay', true, 'operationId', v_row.id, 'result', v_row.result_snapshot);
    end if;
    if v_row.status in ('validating', 'sending', 'accepted') then
      return jsonb_build_object('blocked', true, 'operationId', v_row.id, 'status', v_row.status);
    end if;
    if v_row.status = 'uncertain' then
      return jsonb_build_object('uncertain', true, 'operationId', v_row.id, 'status', v_row.status);
    end if;
    update public.buyer_invoice_payment_reminder_operations
    set status = 'validating', error_code = null, updated_at = clock_timestamp(), completed_at = null
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.buyer_invoice_payment_reminder_operations (
      idempotency_key, request_hash, anchor_stem_id, selected_stem_ids,
      batch_count, actor_user_id, actor_email
    ) values (
      btrim(p_idempotency_key), p_request_hash, p_anchor_stem_id, p_selected_stem_ids,
      p_batch_count, p_actor_user_id, nullif(left(btrim(coalesce(p_actor_email, '')), 320), '')
    ) returning * into v_row;
  end if;

  return jsonb_build_object('operationId', v_row.id, 'status', v_row.status);
end;
$$;

create or replace function public.reserve_buyer_invoice_payment_reminder_batch(
  p_operation_id uuid,
  p_batch_key_hash text,
  p_request_hash text,
  p_stem_ids text[],
  p_row_count integer,
  p_recipient_count integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation public.buyer_invoice_payment_reminder_operations;
  v_batch public.buyer_invoice_payment_reminder_batches;
begin
  if p_batch_key_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_row_count not between 1 and 10000
    or p_recipient_count not between 1 and 1000 then
    raise exception 'Invalid payment reminder batch identity.';
  end if;

  select * into v_operation
  from public.buyer_invoice_payment_reminder_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'Payment reminder operation no longer exists.'; end if;
  if v_operation.status = 'uncertain' then
    return jsonb_build_object('uncertain', true, 'operationId', v_operation.id);
  end if;

  select * into v_batch
  from public.buyer_invoice_payment_reminder_batches
  where operation_id = p_operation_id and batch_key_hash = p_batch_key_hash
  for update;

  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception 'This payment reminder batch changed after it was reserved.';
    end if;
    if v_batch.status = 'accepted' then
      return jsonb_build_object('replay', true, 'batchId', v_batch.id, 'providerRequestId', v_batch.provider_request_id);
    end if;
    if v_batch.status in ('sending', 'uncertain') then
      return jsonb_build_object('uncertain', true, 'batchId', v_batch.id, 'status', v_batch.status);
    end if;
    update public.buyer_invoice_payment_reminder_batches
    set status = 'sending', error_code = null, graph_ms = null,
        provider_request_id = null, updated_at = clock_timestamp(), completed_at = null
    where id = v_batch.id
    returning * into v_batch;
  else
    insert into public.buyer_invoice_payment_reminder_batches (
      operation_id, batch_key_hash, request_hash, stem_ids, row_count, recipient_count
    ) values (
      p_operation_id, p_batch_key_hash, p_request_hash, p_stem_ids, p_row_count, p_recipient_count
    ) returning * into v_batch;
  end if;

  update public.buyer_invoice_payment_reminder_operations
  set status = 'sending', updated_at = clock_timestamp()
  where id = p_operation_id;
  return jsonb_build_object('batchId', v_batch.id, 'status', v_batch.status);
end;
$$;

create or replace function public.complete_buyer_invoice_payment_reminder_batch(
  p_operation_id uuid,
  p_batch_key_hash text,
  p_status text,
  p_provider_request_id text,
  p_graph_ms integer,
  p_error_code text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('accepted', 'failed', 'uncertain') then
    raise exception 'Invalid payment reminder batch completion state.';
  end if;
  update public.buyer_invoice_payment_reminder_batches
  set status = p_status,
      provider_request_id = case when p_status = 'accepted' then nullif(left(coalesce(p_provider_request_id, ''), 200), '') else null end,
      graph_ms = greatest(coalesce(p_graph_ms, 0), 0),
      error_code = case when p_status = 'accepted' then null else nullif(left(coalesce(p_error_code, ''), 100), '') end,
      updated_at = clock_timestamp(), completed_at = clock_timestamp()
  where operation_id = p_operation_id and batch_key_hash = p_batch_key_hash;
  if not found then raise exception 'Payment reminder batch no longer exists.'; end if;
end;
$$;

create or replace function public.complete_buyer_invoice_payment_reminder_operation(
  p_operation_id uuid,
  p_status text,
  p_accepted_batch_count integer,
  p_failed_batch_count integer,
  p_timeline_recorded boolean,
  p_prepare_ms integer,
  p_validation_ms integer,
  p_graph_ms integer,
  p_timeline_ms integer,
  p_result_snapshot jsonb,
  p_error_code text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('partial', 'accepted', 'failed', 'uncertain', 'completed') then
    raise exception 'Invalid payment reminder operation completion state.';
  end if;
  update public.buyer_invoice_payment_reminder_operations
  set status = p_status,
      accepted_batch_count = greatest(coalesce(p_accepted_batch_count, 0), 0),
      failed_batch_count = greatest(coalesce(p_failed_batch_count, 0), 0),
      timeline_recorded = coalesce(p_timeline_recorded, false),
      prepare_ms = greatest(coalesce(p_prepare_ms, 0), 0),
      validation_ms = greatest(coalesce(p_validation_ms, 0), 0),
      graph_ms = greatest(coalesce(p_graph_ms, 0), 0),
      timeline_ms = greatest(coalesce(p_timeline_ms, 0), 0),
      result_snapshot = case when p_status = 'completed' then coalesce(p_result_snapshot, '{}'::jsonb) else '{}'::jsonb end,
      error_code = case when p_status = 'completed' then null else nullif(left(coalesce(p_error_code, ''), 100), '') end,
      updated_at = clock_timestamp(),
      completed_at = case when p_status in ('failed', 'uncertain', 'completed') then clock_timestamp() else null end
  where id = p_operation_id;
  if not found then raise exception 'Payment reminder operation no longer exists.'; end if;
end;
$$;

create or replace function public.save_buyer_invoice_payment_reminder_timeline(
  p_operation_id uuid,
  p_rows jsonb,
  p_actor_user_id uuid,
  p_actor_email text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation public.buyer_invoice_payment_reminder_operations;
  v_row jsonb;
  v_item public.buyer_invoice_collection_items;
  v_event public.buyer_invoice_collection_events;
  v_results jsonb := '[]'::jsonb;
  v_stem_id text;
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Payment reminder timeline rows must be an array.';
  end if;
  select * into v_operation
  from public.buyer_invoice_payment_reminder_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'Payment reminder operation no longer exists.'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_stem_id := nullif(btrim(v_row->>'stemId'), '');
    if v_stem_id is null or not (v_stem_id = any(v_operation.selected_stem_ids)) then
      raise exception 'Payment reminder timeline contains an unrelated STEM.';
    end if;
    if not exists (
      select 1 from public.buyer_invoice_payment_reminder_batches b
      where b.operation_id = p_operation_id and b.status = 'accepted' and v_stem_id = any(b.stem_ids)
    ) then
      continue;
    end if;

    select * into v_item from public.buyer_invoice_collection_items where stem_id = v_stem_id for update;
    if found then
      update public.buyer_invoice_collection_items
      set status = case when status = 'To Contact' then 'Awaiting Buyer' else status end,
          owner_name = case when nullif(btrim(v_row->>'ownerName'), '') is not null then v_row->>'ownerName' else owner_name end,
          latest_note = left(coalesce(nullif(v_row->>'note', ''), 'Payment reminder sent.'), 10000),
          last_event_at = v_now, last_updated_by = p_actor_user_id,
          last_updated_by_email = nullif(left(btrim(coalesce(p_actor_email, '')), 320), ''),
          updated_at = v_now
      where stem_id = v_stem_id
      returning * into v_item;
    else
      insert into public.buyer_invoice_collection_items (
        stem_id, status, owner_name, latest_note, last_event_at,
        last_updated_by, last_updated_by_email, updated_at
      ) values (
        v_stem_id, 'Awaiting Buyer', coalesce(v_row->>'ownerName', ''),
        left(coalesce(nullif(v_row->>'note', ''), 'Payment reminder sent.'), 10000), v_now,
        p_actor_user_id, nullif(left(btrim(coalesce(p_actor_email, '')), 320), ''), v_now
      ) returning * into v_item;
    end if;

    insert into public.buyer_invoice_collection_events (
      stem_id, event_type, event_key, status, owner_name, note, metadata,
      actor_user_id, actor_email
    ) values (
      v_stem_id, 'reminder_sent', 'payment-reminder:' || p_operation_id::text || ':' || v_stem_id,
      v_item.status, v_item.owner_name,
      left(coalesce(nullif(v_row->>'note', ''), 'Payment reminder sent.'), 10000),
      jsonb_build_object(
        'operationId', p_operation_id,
        'recipientCount', greatest(coalesce((v_row->>'recipientCount')::integer, 0), 0),
        'subjectHash', nullif(v_row->>'subjectHash', '')
      ), p_actor_user_id, nullif(left(btrim(coalesce(p_actor_email, '')), 320), '')
    ) on conflict (stem_id, event_key) where event_key is not null do update
      set event_key = excluded.event_key
    returning * into v_event;

    v_results := v_results || jsonb_build_array(jsonb_build_object('item', to_jsonb(v_item), 'event', to_jsonb(v_event)));
  end loop;

  update public.buyer_invoice_payment_reminder_operations
  set timeline_recorded = true,
      status = case when accepted_batch_count >= batch_count then 'completed' else status end,
      updated_at = clock_timestamp(),
      completed_at = case when accepted_batch_count >= batch_count then clock_timestamp() else completed_at end
  where id = p_operation_id;

  return v_results;
end;
$$;

create or replace function public.repair_buyer_invoice_payment_reminder_timelines(
  p_limit integer default 20
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation public.buyer_invoice_payment_reminder_operations;
  v_batch public.buyer_invoice_payment_reminder_batches;
  v_stem_id text;
  v_rows jsonb;
  v_repaired integer := 0;
begin
  for v_operation in
    select * from public.buyer_invoice_payment_reminder_operations
    where timeline_recorded = false and status in ('partial', 'accepted', 'uncertain')
    order by updated_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  loop
    v_rows := '[]'::jsonb;
    for v_batch in
      select * from public.buyer_invoice_payment_reminder_batches
      where operation_id = v_operation.id and status = 'accepted'
    loop
      foreach v_stem_id in array v_batch.stem_ids loop
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'stemId', v_stem_id,
          'note', 'Payment reminder delivery was confirmed. FCOS restored the collection timeline from the protected delivery ledger.',
          'recipientCount', v_batch.recipient_count,
          'subjectHash', null
        ));
      end loop;
    end loop;
    if jsonb_array_length(v_rows) > 0 then
      perform public.save_buyer_invoice_payment_reminder_timeline(
        v_operation.id, v_rows, v_operation.actor_user_id, v_operation.actor_email
      );
      v_repaired := v_repaired + 1;
    end if;
  end loop;
  return jsonb_build_object('repaired', v_repaired);
end;
$$;

revoke all on function public.reserve_buyer_invoice_payment_reminder_operation(text, text, text, text[], integer, uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_buyer_invoice_payment_reminder_batch(uuid, text, text, text[], integer, integer) from public, anon, authenticated;
revoke all on function public.complete_buyer_invoice_payment_reminder_batch(uuid, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.complete_buyer_invoice_payment_reminder_operation(uuid, text, integer, integer, boolean, integer, integer, integer, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_buyer_invoice_payment_reminder_timeline(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.repair_buyer_invoice_payment_reminder_timelines(integer) from public, anon, authenticated;
grant execute on function public.reserve_buyer_invoice_payment_reminder_operation(text, text, text, text[], integer, uuid, text) to service_role;
grant execute on function public.reserve_buyer_invoice_payment_reminder_batch(uuid, text, text, text[], integer, integer) to service_role;
grant execute on function public.complete_buyer_invoice_payment_reminder_batch(uuid, text, text, text, integer, text) to service_role;
grant execute on function public.complete_buyer_invoice_payment_reminder_operation(uuid, text, integer, integer, boolean, integer, integer, integer, integer, jsonb, text) to service_role;
grant execute on function public.save_buyer_invoice_payment_reminder_timeline(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.repair_buyer_invoice_payment_reminder_timelines(integer) to service_role;

commit;
