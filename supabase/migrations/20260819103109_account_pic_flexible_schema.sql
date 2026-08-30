alter table public.account_pic_directories
  add column if not exists column_count integer not null default 0
    check (column_count between 0 and 50);

alter table public.account_pic_directory_rows
  add column if not exists row_label text not null default ''
    check (char_length(row_label) <= 300),
  add column if not exists cells jsonb not null default '{}'::jsonb
    check (jsonb_typeof(cells) = 'object');

create table if not exists public.account_pic_directory_columns (
  id uuid primary key,
  salesforce_account_id text not null
    references public.account_pic_directories(salesforce_account_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  label text not null check (btrim(label) <> '' and char_length(label) <= 200),
  input_type text not null
    check (input_type in ('text', 'multiline_text', 'checkbox', 'number', 'buyer_trader', 'supplier_trader')),
  column_kind text not null default 'field'
    check (column_kind in ('field', 'vessel_type')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salesforce_account_id, sequence)
);

create index if not exists account_pic_directory_columns_account_sequence_idx
  on public.account_pic_directory_columns(salesforce_account_id, sequence);

alter table public.account_pic_directory_columns enable row level security;
revoke all on table public.account_pic_directory_columns from public, anon, authenticated;
grant all on table public.account_pic_directory_columns to service_role;

do $$
declare
  v_directory record;
  v_column_ids uuid[];
begin
  for v_directory in
    select salesforce_account_id
    from public.account_pic_directories
    where not exists (
      select 1
      from public.account_pic_directory_columns c
      where c.salesforce_account_id = account_pic_directories.salesforce_account_id
    )
  loop
    v_column_ids := array[
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
    ];

    insert into public.account_pic_directory_columns (
      id, salesforce_account_id, sequence, label, input_type, column_kind
    ) values
      (v_column_ids[1], v_directory.salesforce_account_id, 1, 'Port / Region', 'text', 'field'),
      (v_column_ids[2], v_directory.salesforce_account_id, 2, 'Responsible Personnel', 'multiline_text', 'field'),
      (v_column_ids[3], v_directory.salesforce_account_id, 3, 'Team', 'text', 'field'),
      (v_column_ids[4], v_directory.salesforce_account_id, 4, 'Reporting / Supervision', 'multiline_text', 'field'),
      (v_column_ids[5], v_directory.salesforce_account_id, 5, 'Vessel Types Covered', 'multiline_text', 'field');

    update public.account_pic_directory_rows
    set cells = jsonb_build_object(
      v_column_ids[1]::text, port_region,
      v_column_ids[2]::text, responsible_personnel,
      v_column_ids[3]::text, team,
      v_column_ids[4]::text, reporting_supervision,
      v_column_ids[5]::text, vessel_types_covered
    )
    where salesforce_account_id = v_directory.salesforce_account_id;

    update public.account_pic_directories
    set column_count = 5
    where salesforce_account_id = v_directory.salesforce_account_id;
  end loop;
end;
$$;

create or replace function public.save_account_pic_directory_v2(
  p_salesforce_account_id text,
  p_account_name text,
  p_cl_key text,
  p_account_role text,
  p_columns jsonb,
  p_rows jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_request_hash text,
  p_operation text default 'save'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_account_id text := btrim(coalesce(p_salesforce_account_id, ''));
  v_account_name text := btrim(coalesce(p_account_name, ''));
  v_cl_key text := btrim(coalesce(p_cl_key, ''));
  v_account_role text := lower(btrim(coalesce(p_account_role, '')));
  v_columns jsonb := coalesce(p_columns, '[]'::jsonb);
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_request_hash text := lower(btrim(coalesce(p_request_hash, '')));
  v_operation text := lower(btrim(coalesce(p_operation, 'save')));
  v_current public.account_pic_directories%rowtype;
  v_existing public.account_pic_directory_operations%rowtype;
  v_revision bigint := 1;
  v_now timestamptz := clock_timestamp();
  v_column jsonb;
  v_row jsonb;
  v_column_id uuid;
  v_row_id uuid;
  v_sequence integer;
  v_label text;
  v_type text;
  v_kind text;
  v_row_label text;
  v_cells jsonb;
  v_cell jsonb;
  v_legacy_port text;
begin
  if v_account_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' then
    raise exception 'A valid Salesforce Account ID is required.';
  end if;
  if v_account_name = '' then raise exception 'Account name is required.'; end if;
  if v_account_role not in ('buyer', 'buyer_supplier') then
    raise exception 'The Salesforce Account must be an active Buyer or Buyer & Supplier.';
  end if;
  if jsonb_typeof(v_columns) <> 'array' or jsonb_array_length(v_columns) < 1 or jsonb_array_length(v_columns) > 50 then
    raise exception 'Buyer PIC columns must be a list of 1 to 50 columns.';
  end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 500 then
    raise exception 'Buyer PIC rows must be a list of at most 500 rows.';
  end if;
  if jsonb_array_length(v_columns) * jsonb_array_length(v_rows) > 25000 then
    raise exception 'A Buyer PIC table cannot exceed 25000 cells.';
  end if;
  if char_length(v_idempotency_key) not between 16 and 200 then raise exception 'A valid idempotency key is required.'; end if;
  if v_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'A valid request hash is required.'; end if;
  if v_operation not in ('save', 'import') then raise exception 'Buyer PIC operation is invalid.'; end if;
  if exists (
    select 1
    from jsonb_array_elements(v_columns) c
    group by lower(btrim(c->>'label'))
    having count(*) > 1
  ) then raise exception 'Buyer PIC column headers must be unique.'; end if;

  v_sequence := 0;
  for v_column in select value from jsonb_array_elements(v_columns)
  loop
    v_sequence := v_sequence + 1;
    if jsonb_typeof(v_column) <> 'object' then raise exception 'Every Buyer PIC column must be an object.'; end if;
    begin v_column_id := (v_column->>'id')::uuid; exception when others then raise exception 'Every Buyer PIC column requires a valid ID.'; end;
    v_label := btrim(coalesce(v_column->>'label', ''));
    v_type := lower(btrim(coalesce(v_column->>'inputType', '')));
    v_kind := lower(btrim(coalesce(v_column->>'columnKind', 'field')));
    if v_label = '' or char_length(v_label) > 200 then raise exception 'Every Buyer PIC column requires a header of at most 200 characters.'; end if;
    if v_type not in ('text', 'multiline_text', 'checkbox', 'number', 'buyer_trader', 'supplier_trader') then raise exception 'Buyer PIC column type is invalid.'; end if;
    if v_kind not in ('field', 'vessel_type') or (v_kind = 'vessel_type' and v_type <> 'checkbox') then raise exception 'Vessel type columns must use checkboxes.'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'Every Buyer PIC row must be an object.'; end if;
    begin v_row_id := (v_row->>'id')::uuid; exception when others then raise exception 'Every Buyer PIC row requires a valid ID.'; end;
    v_row_label := btrim(replace(replace(coalesce(v_row->>'rowLabel', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    if char_length(v_row_label) > 300 then raise exception 'Buyer PIC row headers cannot exceed 300 characters.'; end if;
    v_cells := coalesce(v_row->'cells', '{}'::jsonb);
    if jsonb_typeof(v_cells) <> 'object' then raise exception 'Every Buyer PIC row requires a cell object.'; end if;
    if exists (
      select 1 from jsonb_object_keys(v_cells) cell_key
      where not exists (select 1 from jsonb_array_elements(v_columns) c where c->>'id' = cell_key)
    ) then raise exception 'A Buyer PIC row contains a cell for an unknown column.'; end if;

    for v_column in select value from jsonb_array_elements(v_columns)
    loop
      v_column_id := (v_column->>'id')::uuid;
      v_type := v_column->>'inputType';
      v_cell := v_cells->(v_column_id::text);
      if v_type in ('text', 'multiline_text') then
        if v_cell is not null and jsonb_typeof(v_cell) <> 'string' then raise exception 'Text cells must contain text.'; end if;
        if char_length(btrim(replace(replace(coalesce(v_cell #>> '{}', ''), E'\r\n', E'\n'), E'\r', E'\n'))) > 4000 then raise exception 'Buyer PIC text cells cannot exceed 4000 characters.'; end if;
      elsif v_type = 'checkbox' then
        if v_cell is not null and jsonb_typeof(v_cell) not in ('boolean', 'null') then raise exception 'Checkbox cells must contain true or false.'; end if;
      elsif v_type = 'number' then
        if v_cell is not null and jsonb_typeof(v_cell) not in ('number', 'null') then raise exception 'Number cells must contain a number.'; end if;
      else
        if v_cell is not null and jsonb_typeof(v_cell) not in ('object', 'null') then raise exception 'Trader cells must contain a profile reference.'; end if;
        if jsonb_typeof(v_cell) = 'object' and coalesce(v_cell->>'profileId', '') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Trader cells require a valid profile ID.'; end if;
        if jsonb_typeof(v_cell) = 'object' and (char_length(coalesce(v_cell->>'name', '')) > 300 or char_length(coalesce(v_cell->>'email', '')) > 320) then raise exception 'Trader profile labels are too long.'; end if;
      end if;
    end loop;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(v_account_id, 0));

  select * into v_existing from public.account_pic_directory_operations
  where idempotency_key = v_idempotency_key for update;
  if found then
    if v_existing.operation <> v_operation or v_existing.salesforce_account_id <> v_account_id or v_existing.request_hash <> v_request_hash then
      raise exception 'This idempotency key belongs to a different Buyer PIC operation.';
    end if;
    return jsonb_build_object('replay', true, 'revision', v_existing.result_revision);
  end if;

  select * into v_current from public.account_pic_directories
  where salesforce_account_id = v_account_id for update;
  if found then
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      raise exception 'This Buyer PIC directory changed after it was opened. Refresh and review the latest update before saving.';
    end if;
    v_revision := v_current.revision + 1;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'This Buyer PIC directory changed after it was opened. Refresh and review the latest update before saving.';
  end if;

  insert into public.account_pic_directories (
    salesforce_account_id, account_name, cl_key, account_role, row_count, column_count,
    revision, updated_by, updated_by_email, updated_at
  ) values (
    v_account_id, v_account_name, v_cl_key, v_account_role, jsonb_array_length(v_rows), jsonb_array_length(v_columns),
    v_revision, p_actor_user_id, nullif(btrim(coalesce(p_actor_email, '')), ''), v_now
  ) on conflict (salesforce_account_id) do update set
    account_name = excluded.account_name, cl_key = excluded.cl_key, account_role = excluded.account_role,
    row_count = excluded.row_count, column_count = excluded.column_count, revision = excluded.revision,
    updated_by = excluded.updated_by, updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at;

  delete from public.account_pic_directory_rows where salesforce_account_id = v_account_id;
  delete from public.account_pic_directory_columns where salesforce_account_id = v_account_id;

  v_sequence := 0;
  for v_column in select value from jsonb_array_elements(v_columns)
  loop
    v_sequence := v_sequence + 1;
    insert into public.account_pic_directory_columns (id, salesforce_account_id, sequence, label, input_type, column_kind, updated_at)
    values ((v_column->>'id')::uuid, v_account_id, v_sequence, btrim(v_column->>'label'), v_column->>'inputType', coalesce(v_column->>'columnKind', 'field'), v_now);
  end loop;

  v_sequence := 0;
  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_sequence := v_sequence + 1;
    v_cells := coalesce(v_row->'cells', '{}'::jsonb);
    v_row_label := btrim(replace(replace(coalesce(v_row->>'rowLabel', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    select nullif(btrim(value #>> '{}'), '') into v_legacy_port
    from jsonb_each(v_cells)
    where jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> ''
    limit 1;
    insert into public.account_pic_directory_rows (
      id, salesforce_account_id, sequence, row_label, cells,
      port_region, responsible_personnel, team, reporting_supervision, vessel_types_covered, updated_at
    ) values (
      (v_row->>'id')::uuid, v_account_id, v_sequence, v_row_label, v_cells,
      coalesce(nullif(v_row_label, ''), v_legacy_port, 'Row ' || v_sequence), '', '', '', '', v_now
    );
  end loop;

  insert into public.account_pic_directory_operations (
    idempotency_key, operation, salesforce_account_id, request_hash, result_revision, actor_user_id, actor_email
  ) values (
    v_idempotency_key, v_operation, v_account_id, v_request_hash, v_revision,
    p_actor_user_id, nullif(btrim(coalesce(p_actor_email, '')), '')
  );

  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    case when v_operation = 'import' then 'account_pic_directory_imported' else 'account_pic_directory_saved' end,
    jsonb_build_object(
      'salesforce_account_id', v_account_id,
      'account_role', v_account_role,
      'row_count', jsonb_array_length(v_rows),
      'column_count', jsonb_array_length(v_columns),
      'cell_count', jsonb_array_length(v_rows) * jsonb_array_length(v_columns),
      'trader_variable_columns', (
        select count(*) from jsonb_array_elements(v_columns) c
        where c->>'inputType' in ('buyer_trader', 'supplier_trader')
      ),
      'revision', v_revision,
      'request_hash', v_request_hash
    )
  );

  return jsonb_build_object('replay', false, 'revision', v_revision);
end;
$$;

revoke all on function public.save_account_pic_directory_v2(text, text, text, text, jsonb, jsonb, uuid, text, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_account_pic_directory_v2(text, text, text, text, jsonb, jsonb, uuid, text, bigint, text, text, text)
  to service_role;
