create table if not exists public.account_pic_directories (
  salesforce_account_id text primary key
    check (salesforce_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  account_name text not null
    check (btrim(account_name) <> ''),
  cl_key text not null default '',
  account_role text not null
    check (account_role in ('buyer', 'buyer_supplier')),
  row_count integer not null default 0
    check (row_count between 0 and 500),
  revision bigint not null default 1
    check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_pic_directory_rows (
  id uuid primary key default gen_random_uuid(),
  salesforce_account_id text not null
    references public.account_pic_directories(salesforce_account_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  port_region text not null default '' check (btrim(port_region) <> '' and char_length(port_region) <= 4000),
  responsible_personnel text not null default '' check (char_length(responsible_personnel) <= 4000),
  team text not null default '' check (char_length(team) <= 4000),
  reporting_supervision text not null default '' check (char_length(reporting_supervision) <= 4000),
  vessel_types_covered text not null default '' check (char_length(vessel_types_covered) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salesforce_account_id, sequence)
);

create table if not exists public.account_pic_directory_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique
    check (char_length(idempotency_key) between 16 and 200),
  operation text not null check (operation in ('save', 'import')),
  salesforce_account_id text not null
    references public.account_pic_directories(salesforce_account_id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_revision bigint not null check (result_revision > 0),
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create index if not exists account_pic_directory_rows_account_sequence_idx
  on public.account_pic_directory_rows(salesforce_account_id, sequence);

create index if not exists account_pic_directory_operations_account_idx
  on public.account_pic_directory_operations(salesforce_account_id, created_at desc);

alter table public.account_pic_directories enable row level security;
alter table public.account_pic_directory_rows enable row level security;
alter table public.account_pic_directory_operations enable row level security;

revoke all on table public.account_pic_directories from public, anon, authenticated;
revoke all on table public.account_pic_directory_rows from public, anon, authenticated;
revoke all on table public.account_pic_directory_operations from public, anon, authenticated;
grant all on table public.account_pic_directories to service_role;
grant all on table public.account_pic_directory_rows to service_role;
grant all on table public.account_pic_directory_operations to service_role;

create or replace function public.save_account_pic_directory(
  p_salesforce_account_id text,
  p_account_name text,
  p_cl_key text,
  p_account_role text,
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
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_request_hash text := lower(btrim(coalesce(p_request_hash, '')));
  v_operation text := lower(btrim(coalesce(p_operation, 'save')));
  v_current public.account_pic_directories%rowtype;
  v_directory public.account_pic_directories%rowtype;
  v_existing_operation public.account_pic_directory_operations%rowtype;
  v_revision bigint := 1;
  v_now timestamptz := clock_timestamp();
  v_row jsonb;
  v_sequence integer := 0;
  v_port_region text;
  v_responsible_personnel text;
  v_team text;
  v_reporting_supervision text;
  v_vessel_types_covered text;
begin
  if v_account_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' then
    raise exception 'A valid Salesforce Account ID is required.';
  end if;
  if v_account_name = '' then
    raise exception 'Account name is required.';
  end if;
  if v_account_role not in ('buyer', 'buyer_supplier') then
    raise exception 'The Salesforce Account must be an active Buyer or Buyer & Supplier.';
  end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 500 then
    raise exception 'Buyer PIC rows must be a list of at most 500 rows.';
  end if;
  if char_length(v_idempotency_key) not between 16 and 200 then
    raise exception 'A valid idempotency key is required.';
  end if;
  if v_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid request hash is required.';
  end if;
  if v_operation not in ('save', 'import') then
    raise exception 'Buyer PIC operation is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account_id, 0));

  select * into v_existing_operation
  from public.account_pic_directory_operations
  where idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing_operation.operation <> v_operation
      or v_existing_operation.salesforce_account_id <> v_account_id
      or v_existing_operation.request_hash <> v_request_hash then
      raise exception 'This idempotency key belongs to a different Buyer PIC operation.';
    end if;
    return jsonb_build_object('replay', true, 'revision', v_existing_operation.result_revision);
  end if;

  select * into v_current
  from public.account_pic_directories
  where salesforce_account_id = v_account_id
  for update;

  if found then
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      raise exception 'This Buyer PIC directory changed after it was opened. Refresh and review the latest update before saving.';
    end if;
    v_revision := v_current.revision + 1;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'This Buyer PIC directory changed after it was opened. Refresh and review the latest update before saving.';
  end if;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Every Buyer PIC row must be an object.';
    end if;
    v_port_region := btrim(replace(replace(coalesce(v_row->>'portRegion', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    v_responsible_personnel := btrim(replace(replace(coalesce(v_row->>'responsiblePersonnel', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    v_team := btrim(replace(replace(coalesce(v_row->>'team', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    v_reporting_supervision := btrim(replace(replace(coalesce(v_row->>'reportingSupervision', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    v_vessel_types_covered := btrim(replace(replace(coalesce(v_row->>'vesselTypesCovered', ''), E'\r\n', E'\n'), E'\r', E'\n'));
    if v_port_region = '' then
      raise exception 'Every Buyer PIC row requires Port / Region.';
    end if;
    if greatest(
      char_length(v_port_region),
      char_length(v_responsible_personnel),
      char_length(v_team),
      char_length(v_reporting_supervision),
      char_length(v_vessel_types_covered)
    ) > 4000 then
      raise exception 'Buyer PIC cells cannot exceed 4000 characters.';
    end if;
  end loop;

  insert into public.account_pic_directories (
    salesforce_account_id,
    account_name,
    cl_key,
    account_role,
    row_count,
    revision,
    updated_by,
    updated_by_email,
    updated_at
  ) values (
    v_account_id,
    v_account_name,
    v_cl_key,
    v_account_role,
    jsonb_array_length(v_rows),
    v_revision,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    v_now
  ) on conflict (salesforce_account_id) do update set
    account_name = excluded.account_name,
    cl_key = excluded.cl_key,
    account_role = excluded.account_role,
    row_count = excluded.row_count,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_directory;

  delete from public.account_pic_directory_rows
  where salesforce_account_id = v_account_id;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_sequence := v_sequence + 1;
    insert into public.account_pic_directory_rows (
      salesforce_account_id,
      sequence,
      port_region,
      responsible_personnel,
      team,
      reporting_supervision,
      vessel_types_covered,
      updated_at
    ) values (
      v_account_id,
      v_sequence,
      btrim(replace(replace(coalesce(v_row->>'portRegion', ''), E'\r\n', E'\n'), E'\r', E'\n')),
      btrim(replace(replace(coalesce(v_row->>'responsiblePersonnel', ''), E'\r\n', E'\n'), E'\r', E'\n')),
      btrim(replace(replace(coalesce(v_row->>'team', ''), E'\r\n', E'\n'), E'\r', E'\n')),
      btrim(replace(replace(coalesce(v_row->>'reportingSupervision', ''), E'\r\n', E'\n'), E'\r', E'\n')),
      btrim(replace(replace(coalesce(v_row->>'vesselTypesCovered', ''), E'\r\n', E'\n'), E'\r', E'\n')),
      v_now
    );
  end loop;

  insert into public.account_pic_directory_operations (
    idempotency_key,
    operation,
    salesforce_account_id,
    request_hash,
    result_revision,
    actor_user_id,
    actor_email
  ) values (
    v_idempotency_key,
    v_operation,
    v_account_id,
    v_request_hash,
    v_directory.revision,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), '')
  );

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    case when v_operation = 'import' then 'account_pic_directory_imported' else 'account_pic_directory_saved' end,
    jsonb_build_object(
      'salesforce_account_id', v_account_id,
      'account_role', v_account_role,
      'row_count', jsonb_array_length(v_rows),
      'revision', v_directory.revision,
      'request_hash', v_request_hash
    )
  );

  return jsonb_build_object('replay', false, 'revision', v_directory.revision);
end;
$$;

revoke all on function public.save_account_pic_directory(text, text, text, text, jsonb, uuid, text, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_account_pic_directory(text, text, text, text, jsonb, uuid, text, bigint, text, text, text)
  to service_role;
