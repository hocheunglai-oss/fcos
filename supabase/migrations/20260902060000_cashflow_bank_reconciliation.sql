-- Service-only bank reconciliation and liquidity planning for Cashflow Forecast.
-- Bank statements remain evidence; Salesforce and Xero keep their existing authority.

create extension if not exists pgcrypto;

insert into public.app_modules (id, label, path, sort_order)
values ('cashflow_bank_reconcile', 'Bank Reconciliation', '/cashflow-forecast', 135)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id,
       'cashflow_bank_reconcile',
       id in ('administrator', 'general_manager', 'finance', 'admin_and_accounting')
       or lower(label) like '%finance%'
       or lower(label) like '%account%'
from public.user_types
on conflict (user_type_id, module_id) do nothing;

create table if not exists public.cashflow_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_code text not null check (bank_code in ('UBS', 'DBS', 'ISP')),
  account_label text not null,
  currency text not null check (currency in ('USD', 'EUR', 'HKD', 'CNY')),
  purpose text not null check (purpose in ('trading', 'trading_operations', 'treasury')),
  xero_bank_account_id text,
  xero_bank_account_name text,
  is_default_operating boolean not null default false,
  enabled boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  unique (bank_code, account_label, currency)
);

create unique index if not exists cashflow_bank_accounts_default_currency_idx
  on public.cashflow_bank_accounts (currency)
  where is_default_operating and enabled;

insert into public.cashflow_bank_accounts (
  bank_code, account_label, currency, purpose, is_default_operating, enabled
) values
  ('UBS', 'UBS USD', 'USD', 'trading', true, true),
  ('UBS', 'UBS EUR', 'EUR', 'trading', true, true),
  ('DBS', 'DBS USD', 'USD', 'trading_operations', false, true),
  ('DBS', 'DBS EUR', 'EUR', 'trading_operations', false, true),
  ('DBS', 'DBS HKD', 'HKD', 'trading_operations', true, true),
  ('DBS', 'DBS RMB', 'CNY', 'trading_operations', true, true),
  ('ISP', 'ISP USD Treasury', 'USD', 'treasury', false, true),
  ('ISP', 'ISP EUR Treasury', 'EUR', 'treasury', false, true)
on conflict (bank_code, account_label, currency) do nothing;

create table if not exists public.cashflow_bank_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.cashflow_bank_accounts(id),
  balance_date date not null,
  available_balance numeric(20, 6) not null,
  ledger_balance numeric(20, 6),
  source text not null default 'manual' check (source in ('manual', 'statement')),
  source_hash text,
  note text,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  unique (bank_account_id, balance_date)
);

create table if not exists public.cashflow_bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.cashflow_bank_accounts(id),
  source_file_name text not null,
  source_hash text not null,
  statement_from date not null,
  statement_to date not null,
  row_count integer not null check (row_count > 0),
  duplicate_row_count integer not null default 0 check (duplicate_row_count >= 0),
  status text not null default 'active' check (status in ('active', 'superseded')),
  imported_by uuid references public.user_profiles(id) on delete set null,
  imported_by_email text,
  imported_at timestamptz not null default now(),
  unique (bank_account_id, source_hash)
);

create table if not exists public.cashflow_bank_statement_entries (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.cashflow_bank_accounts(id),
  import_id uuid not null references public.cashflow_bank_statement_imports(id),
  entry_hash text not null,
  booking_date date not null,
  value_date date,
  amount numeric(20, 6) not null check (amount <> 0),
  currency text not null check (currency in ('USD', 'EUR', 'HKD', 'CNY')),
  reference text,
  description text,
  running_balance numeric(20, 6),
  created_at timestamptz not null default now(),
  unique (bank_account_id, entry_hash)
);

create table if not exists public.cashflow_bank_matches (
  id uuid primary key default gen_random_uuid(),
  statement_entry_id uuid not null unique references public.cashflow_bank_statement_entries(id),
  match_status text not null check (match_status in ('confirmed', 'dismissed')),
  salesforce_payment_id text,
  salesforce_payment_name text,
  reason text,
  revision integer not null default 1 check (revision > 0),
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_by_email text,
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (match_status = 'confirmed' and salesforce_payment_id is not null)
    or (match_status = 'dismissed' and salesforce_payment_id is null)
  )
);

create table if not exists public.cashflow_liquidity_instruments (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.cashflow_bank_accounts(id),
  instrument_type text not null check (instrument_type in ('term_deposit', 'bank_guarantee')),
  reference text not null,
  amount numeric(20, 6) not null check (amount > 0),
  expected_interest numeric(20, 6) not null default 0 check (expected_interest >= 0),
  start_date date not null,
  maturity_date date,
  tenor text check (tenor is null or tenor in ('1_week', '2_week', '1_month', 'custom')),
  status text not null default 'active' check (status in ('planned', 'active', 'matured', 'released', 'called', 'cancelled')),
  rollover_expected boolean not null default false,
  note text,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  check (
    (instrument_type = 'term_deposit' and maturity_date is not null and tenor is not null)
    or instrument_type = 'bank_guarantee'
  ),
  check (maturity_date is null or maturity_date >= start_date)
);

create table if not exists public.cashflow_bank_planned_movements (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.cashflow_bank_accounts(id),
  category text not null check (category in ('general_expense', 'payroll', 'tax', 'bank_fee', 'other')),
  description text not null,
  direction text not null check (direction in ('inflow', 'outflow')),
  amount numeric(20, 6) not null check (amount > 0),
  start_date date not null,
  recurrence text not null default 'one_off' check (recurrence in ('one_off', 'weekly', 'monthly')),
  end_date date,
  enabled boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.cashflow_bank_audit_events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('account', 'balance', 'statement_import', 'match', 'instrument', 'planned_movement')),
  entity_id text not null,
  event_type text not null,
  outcome text not null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_email text,
  record_counts jsonb not null default '{}'::jsonb,
  fingerprints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cashflow_bank_balance_account_date_idx
  on public.cashflow_bank_balance_snapshots (bank_account_id, balance_date desc);
create index if not exists cashflow_bank_entries_account_date_idx
  on public.cashflow_bank_statement_entries (bank_account_id, booking_date desc);
create index if not exists cashflow_bank_imports_account_date_idx
  on public.cashflow_bank_statement_imports (bank_account_id, imported_at desc);
create index if not exists cashflow_liquidity_account_dates_idx
  on public.cashflow_liquidity_instruments (bank_account_id, start_date, maturity_date);
create index if not exists cashflow_bank_planned_movement_dates_idx
  on public.cashflow_bank_planned_movements (bank_account_id, start_date, end_date);
create index if not exists cashflow_bank_audit_entity_idx
  on public.cashflow_bank_audit_events (entity_type, entity_id, created_at desc);

alter table public.cashflow_bank_accounts enable row level security;
alter table public.cashflow_bank_balance_snapshots enable row level security;
alter table public.cashflow_bank_statement_imports enable row level security;
alter table public.cashflow_bank_statement_entries enable row level security;
alter table public.cashflow_bank_matches enable row level security;
alter table public.cashflow_liquidity_instruments enable row level security;
alter table public.cashflow_bank_planned_movements enable row level security;
alter table public.cashflow_bank_audit_events enable row level security;

alter table public.cashflow_bank_accounts force row level security;
alter table public.cashflow_bank_balance_snapshots force row level security;
alter table public.cashflow_bank_statement_imports force row level security;
alter table public.cashflow_bank_statement_entries force row level security;
alter table public.cashflow_bank_matches force row level security;
alter table public.cashflow_liquidity_instruments force row level security;
alter table public.cashflow_bank_planned_movements force row level security;
alter table public.cashflow_bank_audit_events force row level security;

revoke all on table public.cashflow_bank_accounts from public, anon, authenticated;
revoke all on table public.cashflow_bank_balance_snapshots from public, anon, authenticated;
revoke all on table public.cashflow_bank_statement_imports from public, anon, authenticated;
revoke all on table public.cashflow_bank_statement_entries from public, anon, authenticated;
revoke all on table public.cashflow_bank_matches from public, anon, authenticated;
revoke all on table public.cashflow_liquidity_instruments from public, anon, authenticated;
revoke all on table public.cashflow_bank_planned_movements from public, anon, authenticated;
revoke all on table public.cashflow_bank_audit_events from public, anon, authenticated;
revoke all on sequence public.cashflow_bank_audit_events_id_seq from public, anon, authenticated;

grant select, insert, update on table public.cashflow_bank_accounts to service_role;
grant select, insert, update on table public.cashflow_bank_balance_snapshots to service_role;
grant select, insert, update on table public.cashflow_bank_statement_imports to service_role;
grant select, insert on table public.cashflow_bank_statement_entries to service_role;
grant select, insert, update on table public.cashflow_bank_matches to service_role;
grant select, insert, update on table public.cashflow_liquidity_instruments to service_role;
grant select, insert, update on table public.cashflow_bank_planned_movements to service_role;
grant select, insert on table public.cashflow_bank_audit_events to service_role;
grant usage, select on sequence public.cashflow_bank_audit_events_id_seq to service_role;

create or replace function public.save_cashflow_bank_account_v1(
  p_id uuid,
  p_bank_code text,
  p_account_label text,
  p_currency text,
  p_purpose text,
  p_xero_bank_account_id text,
  p_xero_bank_account_name text,
  p_is_default_operating boolean,
  p_enabled boolean,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.cashflow_bank_accounts
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.cashflow_bank_accounts;
begin
  if p_bank_code not in ('UBS', 'DBS', 'ISP')
     or p_currency not in ('USD', 'EUR', 'HKD', 'CNY')
     or p_purpose not in ('trading', 'trading_operations', 'treasury')
     or nullif(btrim(p_account_label), '') is null then
    raise exception 'Valid bank, account label, currency and purpose are required' using errcode = '22023';
  end if;
  if p_bank_code = 'UBS' and p_currency not in ('USD', 'EUR') then
    raise exception 'UBS is configured only for USD and EUR' using errcode = '22023';
  end if;
  if p_bank_code = 'DBS' and p_currency not in ('USD', 'EUR', 'HKD', 'CNY') then
    raise exception 'DBS currency is unsupported' using errcode = '22023';
  end if;
  if p_bank_code = 'ISP' and p_purpose <> 'treasury' then
    raise exception 'ISP is reserved for treasury instruments and guarantees' using errcode = '22023';
  end if;

  if coalesce(p_is_default_operating, false) then
    update public.cashflow_bank_accounts
    set is_default_operating = false,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_by_email = lower(nullif(btrim(p_actor_email), '')),
        updated_at = clock_timestamp()
    where currency = p_currency
      and is_default_operating
      and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.cashflow_bank_accounts (
      bank_code, account_label, currency, purpose,
      xero_bank_account_id, xero_bank_account_name,
      is_default_operating, enabled,
      created_by, created_by_email, updated_by, updated_by_email
    ) values (
      p_bank_code, btrim(p_account_label), p_currency, p_purpose,
      nullif(btrim(p_xero_bank_account_id), ''), nullif(btrim(p_xero_bank_account_name), ''),
      coalesce(p_is_default_operating, false), coalesce(p_enabled, true),
      p_actor_id, lower(nullif(btrim(p_actor_email), '')),
      p_actor_id, lower(nullif(btrim(p_actor_email), ''))
    ) returning * into v_row;
  else
    update public.cashflow_bank_accounts set
      bank_code = p_bank_code,
      account_label = btrim(p_account_label),
      currency = p_currency,
      purpose = p_purpose,
      xero_bank_account_id = nullif(btrim(p_xero_bank_account_id), ''),
      xero_bank_account_name = nullif(btrim(p_xero_bank_account_name), ''),
      is_default_operating = coalesce(p_is_default_operating, false),
      enabled = coalesce(p_enabled, true),
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_by_email = lower(nullif(btrim(p_actor_email), '')),
      updated_at = clock_timestamp()
    where id = p_id and revision = p_expected_revision
    returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'Bank account changed after it was opened' using errcode = '40001';
  end if;
  insert into public.cashflow_bank_audit_events (
    entity_type, entity_id, event_type, outcome, actor_id, actor_email, fingerprints
  ) values (
    'account', v_row.id::text, 'account_saved', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('bank', digest(v_row.bank_code, 'sha256'), 'label', digest(v_row.account_label, 'sha256'))
  );
  return v_row;
end;
$$;

create or replace function public.save_cashflow_bank_balance_v1(
  p_id uuid,
  p_bank_account_id uuid,
  p_balance_date date,
  p_available_balance numeric,
  p_ledger_balance numeric,
  p_note text,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.cashflow_bank_balance_snapshots
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.cashflow_bank_balance_snapshots;
begin
  if p_bank_account_id is null or p_balance_date is null or p_available_balance is null then
    raise exception 'Bank account, balance date and available balance are required' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.cashflow_bank_balance_snapshots (
      bank_account_id, balance_date, available_balance, ledger_balance,
      source, note, created_by, created_by_email, updated_by, updated_by_email
    ) values (
      p_bank_account_id, p_balance_date, p_available_balance, p_ledger_balance,
      'manual', nullif(btrim(p_note), ''), p_actor_id, lower(nullif(btrim(p_actor_email), '')),
      p_actor_id, lower(nullif(btrim(p_actor_email), ''))
    )
    on conflict (bank_account_id, balance_date) do update set
      available_balance = excluded.available_balance,
      ledger_balance = excluded.ledger_balance,
      source = 'manual',
      note = excluded.note,
      revision = public.cashflow_bank_balance_snapshots.revision + 1,
      updated_by = excluded.updated_by,
      updated_by_email = excluded.updated_by_email,
      updated_at = clock_timestamp()
    where p_expected_revision is not null
      and public.cashflow_bank_balance_snapshots.revision = p_expected_revision
    returning * into v_row;
  else
    update public.cashflow_bank_balance_snapshots set
      balance_date = p_balance_date,
      available_balance = p_available_balance,
      ledger_balance = p_ledger_balance,
      source = 'manual',
      note = nullif(btrim(p_note), ''),
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_by_email = lower(nullif(btrim(p_actor_email), '')),
      updated_at = clock_timestamp()
    where id = p_id and bank_account_id = p_bank_account_id and revision = p_expected_revision
    returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'Bank balance changed after it was opened' using errcode = '40001';
  end if;
  insert into public.cashflow_bank_audit_events (
    entity_type, entity_id, event_type, outcome, actor_id, actor_email, fingerprints
  ) values (
    'balance', v_row.id::text, 'balance_saved', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('snapshot', digest(concat(v_row.bank_account_id, ':', v_row.balance_date, ':', v_row.available_balance), 'sha256'))
  );
  return v_row;
end;
$$;

create or replace function public.import_cashflow_bank_statement_v1(
  p_bank_account_id uuid,
  p_source_file_name text,
  p_source_hash text,
  p_rows jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_import public.cashflow_bank_statement_imports;
  v_existing public.cashflow_bank_statement_imports;
  v_inserted integer := 0;
  v_duplicate integer := 0;
  v_from date;
  v_to date;
  v_row jsonb;
  v_count integer;
begin
  if p_bank_account_id is null or nullif(btrim(p_source_file_name), '') is null
     or nullif(btrim(p_source_hash), '') is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Bank account, source file, source hash and rows are required' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 10000 then
    raise exception 'A bank statement must contain between 1 and 10000 rows' using errcode = '22023';
  end if;
  select * into v_existing
  from public.cashflow_bank_statement_imports
  where bank_account_id = p_bank_account_id and source_hash = p_source_hash;
  if found then
    return jsonb_build_object('importId', v_existing.id, 'status', 'already_imported', 'inserted', 0, 'duplicates', v_existing.duplicate_row_count);
  end if;
  select min((value->>'bookingDate')::date), max((value->>'bookingDate')::date)
  into v_from, v_to
  from jsonb_array_elements(p_rows);
  if v_from is null or v_to is null then
    raise exception 'Statement rows require valid booking dates' using errcode = '22023';
  end if;
  insert into public.cashflow_bank_statement_imports (
    bank_account_id, source_file_name, source_hash, statement_from, statement_to,
    row_count, imported_by, imported_by_email
  ) values (
    p_bank_account_id, left(btrim(p_source_file_name), 255), p_source_hash,
    v_from, v_to, v_count, p_actor_id, lower(nullif(btrim(p_actor_email), ''))
  ) returning * into v_import;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.cashflow_bank_statement_entries (
      bank_account_id, import_id, entry_hash, booking_date, value_date,
      amount, currency, reference, description, running_balance
    ) values (
      p_bank_account_id, v_import.id, v_row->>'entryHash', (v_row->>'bookingDate')::date,
      nullif(v_row->>'valueDate', '')::date, (v_row->>'amount')::numeric,
      v_row->>'currency', nullif(left(v_row->>'reference', 500), ''),
      nullif(left(v_row->>'description', 1000), ''), nullif(v_row->>'runningBalance', '')::numeric
    ) on conflict (bank_account_id, entry_hash) do nothing;
    if found then v_inserted := v_inserted + 1; else v_duplicate := v_duplicate + 1; end if;
  end loop;
  update public.cashflow_bank_statement_imports
  set duplicate_row_count = v_duplicate
  where id = v_import.id;
  insert into public.cashflow_bank_audit_events (
    entity_type, entity_id, event_type, outcome, actor_id, actor_email, record_counts, fingerprints
  ) values (
    'statement_import', v_import.id::text, 'statement_imported', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'duplicates', v_duplicate),
    jsonb_build_object('source', p_source_hash)
  );
  return jsonb_build_object('importId', v_import.id, 'status', 'imported', 'inserted', v_inserted, 'duplicates', v_duplicate);
end;
$$;

create or replace function public.save_cashflow_bank_match_v1(
  p_statement_entry_id uuid,
  p_match_status text,
  p_salesforce_payment_id text,
  p_salesforce_payment_name text,
  p_reason text,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.cashflow_bank_matches
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.cashflow_bank_matches;
begin
  if p_statement_entry_id is null or p_match_status not in ('confirmed', 'dismissed') then
    raise exception 'Statement entry and match decision are required' using errcode = '22023';
  end if;
  if p_match_status = 'confirmed' and nullif(btrim(p_salesforce_payment_id), '') is null then
    raise exception 'A confirmed match requires an exact Salesforce Payment' using errcode = '22023';
  end if;
  insert into public.cashflow_bank_matches (
    statement_entry_id, match_status, salesforce_payment_id, salesforce_payment_name,
    reason, reviewed_by, reviewed_by_email
  ) values (
    p_statement_entry_id, p_match_status,
    case when p_match_status = 'confirmed' then btrim(p_salesforce_payment_id) else null end,
    case when p_match_status = 'confirmed' then nullif(btrim(p_salesforce_payment_name), '') else null end,
    nullif(btrim(p_reason), ''), p_actor_id, lower(nullif(btrim(p_actor_email), ''))
  )
  on conflict (statement_entry_id) do update set
    match_status = excluded.match_status,
    salesforce_payment_id = excluded.salesforce_payment_id,
    salesforce_payment_name = excluded.salesforce_payment_name,
    reason = excluded.reason,
    revision = public.cashflow_bank_matches.revision + 1,
    reviewed_by = excluded.reviewed_by,
    reviewed_by_email = excluded.reviewed_by_email,
    reviewed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where p_expected_revision is not null
    and public.cashflow_bank_matches.revision = p_expected_revision
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Bank match changed after it was opened' using errcode = '40001';
  end if;
  insert into public.cashflow_bank_audit_events (
    entity_type, entity_id, event_type, outcome, actor_id, actor_email, fingerprints
  ) values (
    'match', v_row.id::text, 'match_reviewed', v_row.match_status, p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('entry', digest(v_row.statement_entry_id::text, 'sha256'), 'payment', digest(coalesce(v_row.salesforce_payment_id, ''), 'sha256'))
  );
  return v_row;
end;
$$;

create or replace function public.save_cashflow_liquidity_instrument_v1(
  p_id uuid,
  p_bank_account_id uuid,
  p_instrument_type text,
  p_reference text,
  p_amount numeric,
  p_expected_interest numeric,
  p_start_date date,
  p_maturity_date date,
  p_tenor text,
  p_status text,
  p_rollover_expected boolean,
  p_note text,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.cashflow_liquidity_instruments
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.cashflow_liquidity_instruments;
begin
  if p_bank_account_id is null or p_instrument_type not in ('term_deposit', 'bank_guarantee')
     or nullif(btrim(p_reference), '') is null or coalesce(p_amount, 0) <= 0 or p_start_date is null
     or p_status not in ('planned', 'active', 'matured', 'released', 'called', 'cancelled') then
    raise exception 'Valid account, instrument, reference, amount, start date and status are required' using errcode = '22023';
  end if;
  if p_instrument_type = 'term_deposit'
     and (p_maturity_date is null or p_maturity_date < p_start_date or p_tenor not in ('1_week', '2_week', '1_month', 'custom')) then
    raise exception 'A term deposit requires a valid maturity date and tenor' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.cashflow_liquidity_instruments (
      bank_account_id, instrument_type, reference, amount, expected_interest,
      start_date, maturity_date, tenor, status, rollover_expected, note,
      created_by, created_by_email, updated_by, updated_by_email
    ) values (
      p_bank_account_id, p_instrument_type, btrim(p_reference), p_amount,
      greatest(coalesce(p_expected_interest, 0), 0), p_start_date, p_maturity_date,
      case when p_instrument_type = 'term_deposit' then p_tenor else null end,
      p_status, coalesce(p_rollover_expected, false), nullif(btrim(p_note), ''),
      p_actor_id, lower(nullif(btrim(p_actor_email), '')),
      p_actor_id, lower(nullif(btrim(p_actor_email), ''))
    ) returning * into v_row;
  else
    update public.cashflow_liquidity_instruments set
      bank_account_id = p_bank_account_id,
      instrument_type = p_instrument_type,
      reference = btrim(p_reference),
      amount = p_amount,
      expected_interest = greatest(coalesce(p_expected_interest, 0), 0),
      start_date = p_start_date,
      maturity_date = p_maturity_date,
      tenor = case when p_instrument_type = 'term_deposit' then p_tenor else null end,
      status = p_status,
      rollover_expected = coalesce(p_rollover_expected, false),
      note = nullif(btrim(p_note), ''),
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_by_email = lower(nullif(btrim(p_actor_email), '')),
      updated_at = clock_timestamp()
    where id = p_id and revision = p_expected_revision
    returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'Liquidity instrument changed after it was opened' using errcode = '40001';
  end if;
  insert into public.cashflow_bank_audit_events (
    entity_type, entity_id, event_type, outcome, actor_id, actor_email, fingerprints
  ) values (
    'instrument', v_row.id::text, 'instrument_saved', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('instrument', digest(concat(v_row.instrument_type, ':', v_row.reference, ':', v_row.amount), 'sha256'))
  );
  return v_row;
end;
$$;

create or replace function public.save_cashflow_bank_planned_movement_v1(
  p_id uuid,
  p_bank_account_id uuid,
  p_category text,
  p_description text,
  p_direction text,
  p_amount numeric,
  p_start_date date,
  p_recurrence text,
  p_end_date date,
  p_enabled boolean,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.cashflow_bank_planned_movements
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.cashflow_bank_planned_movements;
  v_account public.cashflow_bank_accounts;
begin
  select * into v_account from public.cashflow_bank_accounts where id = p_bank_account_id and enabled;
  if v_account.id is null or v_account.bank_code = 'ISP' then
    raise exception 'Planned operating cash requires an active UBS or DBS account' using errcode = '22023';
  end if;
  if p_category not in ('general_expense', 'payroll', 'tax', 'bank_fee', 'other')
     or p_direction not in ('inflow', 'outflow')
     or p_recurrence not in ('one_off', 'weekly', 'monthly')
     or nullif(btrim(p_description), '') is null
     or coalesce(p_amount, 0) <= 0
     or p_start_date is null
     or (p_end_date is not null and p_end_date < p_start_date) then
    raise exception 'Valid category, description, direction, amount and dates are required' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.cashflow_bank_planned_movements (
      bank_account_id, category, description, direction, amount,
      start_date, recurrence, end_date, enabled,
      created_by, created_by_email, updated_by, updated_by_email
    ) values (
      p_bank_account_id, p_category, btrim(p_description), p_direction, p_amount,
      p_start_date, p_recurrence, p_end_date, coalesce(p_enabled, true),
      p_actor_id, lower(nullif(btrim(p_actor_email), '')),
      p_actor_id, lower(nullif(btrim(p_actor_email), ''))
    ) returning * into v_row;
  else
    update public.cashflow_bank_planned_movements set
      bank_account_id = p_bank_account_id,
      category = p_category,
      description = btrim(p_description),
      direction = p_direction,
      amount = p_amount,
      start_date = p_start_date,
      recurrence = p_recurrence,
      end_date = p_end_date,
      enabled = coalesce(p_enabled, true),
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_by_email = lower(nullif(btrim(p_actor_email), '')),
      updated_at = clock_timestamp()
    where id = p_id and revision = p_expected_revision
    returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'Planned cash movement changed after it was opened' using errcode = '40001';
  end if;
  insert into public.cashflow_bank_audit_events (
    entity_type, entity_id, event_type, outcome, actor_id, actor_email, fingerprints
  ) values (
    'planned_movement', v_row.id::text, 'planned_movement_saved', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('movement', digest(concat(v_row.bank_account_id, ':', v_row.category, ':', v_row.direction, ':', v_row.amount, ':', v_row.start_date), 'sha256'))
  );
  return v_row;
end;
$$;

revoke all on function public.save_cashflow_bank_account_v1(uuid,text,text,text,text,text,text,boolean,boolean,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.save_cashflow_bank_balance_v1(uuid,uuid,date,numeric,numeric,text,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.import_cashflow_bank_statement_v1(uuid,text,text,jsonb,uuid,text) from public, anon, authenticated;
revoke all on function public.save_cashflow_bank_match_v1(uuid,text,text,text,text,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.save_cashflow_liquidity_instrument_v1(uuid,uuid,text,text,numeric,numeric,date,date,text,text,boolean,text,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.save_cashflow_bank_planned_movement_v1(uuid,uuid,text,text,text,numeric,date,text,date,boolean,integer,uuid,text) from public, anon, authenticated;

grant execute on function public.save_cashflow_bank_account_v1(uuid,text,text,text,text,text,text,boolean,boolean,integer,uuid,text) to service_role;
grant execute on function public.save_cashflow_bank_balance_v1(uuid,uuid,date,numeric,numeric,text,integer,uuid,text) to service_role;
grant execute on function public.import_cashflow_bank_statement_v1(uuid,text,text,jsonb,uuid,text) to service_role;
grant execute on function public.save_cashflow_bank_match_v1(uuid,text,text,text,text,integer,uuid,text) to service_role;
grant execute on function public.save_cashflow_liquidity_instrument_v1(uuid,uuid,text,text,numeric,numeric,date,date,text,text,boolean,text,integer,uuid,text) to service_role;
grant execute on function public.save_cashflow_bank_planned_movement_v1(uuid,uuid,text,text,text,numeric,date,text,date,boolean,integer,uuid,text) to service_role;
