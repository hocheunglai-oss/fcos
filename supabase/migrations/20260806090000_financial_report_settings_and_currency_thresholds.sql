create extension if not exists pgcrypto;

insert into public.app_modules (id, label, path, sort_order)
values ('financial_report_settings_manage', 'Manage Financial Report Settings', '/payment-collections', 194)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'financial_report_settings_manage', id in ('finance', 'administrator', 'general_manager')
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'financial_report_settings_manage', user_type in ('finance', 'administrator', 'general_manager')
from public.user_profiles
where use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table if not exists public.financial_report_settings (
  purpose_key text primary key,
  label text not null,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  configured boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purpose_key in ('outstanding_invoice_reports', 'incoming_payment_reports', 'incoming_payment_interest_requests', 'hedge_sfs_reports'))
);

create table if not exists public.financial_report_setting_events (
  id uuid primary key default gen_random_uuid(),
  purpose_key text not null references public.financial_report_settings(purpose_key) on delete restrict,
  revision integer not null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create index if not exists financial_report_setting_events_purpose_created_idx
on public.financial_report_setting_events(purpose_key, created_at desc);

insert into public.financial_report_settings (purpose_key, label, settings, configured)
select
  'outstanding_invoice_reports',
  'Outstanding buyer invoice reports',
  case
    when updated_by is not null or nullif(trim(updated_by_email), '') is not null or updated_at > created_at + interval '1 second'
      then (settings - 'from' - 'appUrl')
    else jsonb_set(jsonb_set((settings - 'from' - 'appUrl'), '{to}', '[]'::jsonb, true), '{cc}', '[]'::jsonb, true)
  end,
  case
    when not (updated_by is not null or nullif(trim(updated_by_email), '') is not null or updated_at > created_at + interval '1 second') then false
    when jsonb_typeof(settings->'to') = 'array' then jsonb_array_length(settings->'to') > 0
    when jsonb_typeof(settings->'to') = 'string' then length(trim(settings->>'to')) > 0
    else false
  end
from public.buyer_invoice_email_settings
where id = 'default'
on conflict (purpose_key) do nothing;

insert into public.financial_report_settings (purpose_key, label, settings, configured)
values
  (
    'outstanding_invoice_reports',
    'Outstanding buyer invoice reports',
    '{"enabled":true,"to":[],"cc":[],"bcc":[],"daysAhead":7,"subject":"Outstanding Buyer Invoices Report","intro":"<h2>Outstanding Buyer Invoices</h2><p>Please find below the latest overdue buyer invoices and buyer invoices due in {{daysAhead}} days.</p><p>Report window: {{reportStart}} to {{reportEnd}}. Overdue invoices are always included.</p>","includeSummary":true,"includeTable":true,"buyerTraders":[],"weekdays":["Mon","Tue","Wed","Thu","Fri"],"sendTimes":["08:00","14:00"]}'::jsonb,
    false
  ),
  (
    'incoming_payment_reports',
    'Incoming payment reports',
    '{"to":[],"cc":[],"bcc":[],"subject":"Incoming Payment Report - {{dateFrom}} to {{dateTo}}","intro":"<h2>Incoming Payment Report</h2><p>Please find below the receivable payments and Buyer CIA invoices for the selected filters.</p><p>Payment created date range: {{dateFrom}} to {{dateTo}}.<br>Incoming total: {{incomingTotal}}.</p><p>{{receivablePaymentsTable}}</p><p>{{buyerCiaInvoicesTable}}</p>","includeReceivablePayments":true,"includeBuyerCiaInvoices":true}'::jsonb,
    false
  ),
  (
    'incoming_payment_interest_requests',
    'Late payment interest requests',
    '{"to":[],"cc":[],"bcc":[],"subject":"Late Payment Interest Invoice Request - {{stemName}}","body":"<h2>Late Payment Interest Invoice Request</h2><p>{{requestedBy}} is requesting the Finance team to issue a late payment interest invoice for the following delayed buyer payment.</p><p>Buyer: {{buyerName}}<br>Group: {{buyerGroupName}}<br>STEM: {{stemName}}</p><p>{{stemLink}}</p><p>Payment: {{paymentName}}<br>Received date: {{receivedDate}}<br>Payment terms delay: {{delayDays}}<br>Payment amount: {{paymentAmount}}<br>Receivable balance: {{receivableBalance}}<br>Calculated interest total: {{interestTotal}}</p><p>{{interestCalculationTable}}</p>"}'::jsonb,
    false
  ),
  (
    'hedge_sfs_reports',
    'Hedge SFS reports',
    '{"to":[],"cc":[],"bcc":[]}'::jsonb,
    false
  )
on conflict (purpose_key) do nothing;

create or replace function public.save_financial_report_settings(
  p_purpose_key text,
  p_settings jsonb,
  p_configured boolean,
  p_expected_revision integer,
  p_actor_user_id uuid,
  p_actor_email text
)
returns public.financial_report_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.financial_report_settings%rowtype;
  v_saved public.financial_report_settings%rowtype;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Financial report settings must be a JSON object.';
  end if;
  if p_settings ? 'from' or p_settings ? 'sender' or p_settings ? 'mailbox' then
    raise exception 'Sender identity is controlled by the Graph mailbox route.';
  end if;

  select * into v_current
  from public.financial_report_settings
  where purpose_key = p_purpose_key
  for update;

  if not found then
    raise exception 'Financial report purpose is not registered.';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_current.revision then
    raise exception 'Financial report settings changed after they were opened.' using errcode = '40001';
  end if;

  update public.financial_report_settings set
    settings = p_settings,
    configured = p_configured,
    revision = revision + 1,
    updated_by = p_actor_user_id,
    updated_by_email = nullif(trim(p_actor_email), ''),
    updated_at = now()
  where purpose_key = p_purpose_key
  returning * into v_saved;

  insert into public.financial_report_setting_events (purpose_key, revision, actor_user_id, actor_email)
  values (v_saved.purpose_key, v_saved.revision, p_actor_user_id, nullif(trim(p_actor_email), ''));

  return v_saved;
end;
$$;

alter table public.incoming_payment_settings
add column if not exists legacy_fully_paid_threshold numeric(18, 2) null;

update public.incoming_payment_settings
set legacy_fully_paid_threshold = fully_paid_threshold
where legacy_fully_paid_threshold is null;

comment on column public.incoming_payment_settings.fully_paid_threshold is
  'Legacy audit value. FCOS settlement decisions use payment_collection_currency_thresholds.';

alter table if exists public.incoming_payment_interest_notifications
alter column recipient_email drop default;

create table if not exists public.payment_collection_currency_thresholds (
  currency_iso_code text primary key check (currency_iso_code ~ '^[A-Z]{3}$'),
  threshold numeric(18, 4) not null check (threshold >= 0 and threshold <= 1000000),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_collection_threshold_events (
  id uuid primary key default gen_random_uuid(),
  currency_iso_code text not null,
  threshold numeric(18, 4) not null,
  revision integer not null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create index if not exists payment_collection_threshold_events_currency_created_idx
on public.payment_collection_threshold_events(currency_iso_code, created_at desc);

create or replace function public.save_payment_collection_currency_threshold(
  p_currency_iso_code text,
  p_threshold numeric,
  p_expected_revision integer,
  p_actor_user_id uuid,
  p_actor_email text
)
returns public.payment_collection_currency_thresholds
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency text := upper(trim(p_currency_iso_code));
  v_current public.payment_collection_currency_thresholds%rowtype;
  v_saved public.payment_collection_currency_thresholds%rowtype;
begin
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code.';
  end if;
  if p_threshold is null or p_threshold < 0 or p_threshold > 1000000 then
    raise exception 'Threshold must be between 0 and 1,000,000.';
  end if;

  select * into v_current
  from public.payment_collection_currency_thresholds
  where currency_iso_code = v_currency
  for update;

  if found and (p_expected_revision is null or p_expected_revision <> v_current.revision) then
    raise exception 'Currency threshold changed after it was opened.' using errcode = '40001';
  end if;
  if not found and coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'Currency threshold changed after it was opened.' using errcode = '40001';
  end if;

  insert into public.payment_collection_currency_thresholds (
    currency_iso_code, threshold, revision, updated_by, updated_by_email, updated_at
  ) values (
    v_currency, round(p_threshold, 4), 1, p_actor_user_id, nullif(trim(p_actor_email), ''), now()
  )
  on conflict (currency_iso_code) do update set
    threshold = excluded.threshold,
    revision = public.payment_collection_currency_thresholds.revision + 1,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_saved;

  insert into public.payment_collection_threshold_events (currency_iso_code, threshold, revision, actor_user_id, actor_email)
  values (v_saved.currency_iso_code, v_saved.threshold, v_saved.revision, p_actor_user_id, nullif(trim(p_actor_email), ''));

  return v_saved;
end;
$$;

create or replace function public.save_payment_collection_currency_thresholds(
  p_thresholds jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_saved public.payment_collection_currency_thresholds%rowtype;
  v_results jsonb := '[]'::jsonb;
begin
  if p_thresholds is null or jsonb_typeof(p_thresholds) <> 'array' then
    raise exception 'Payment thresholds must be an array.';
  end if;
  if jsonb_array_length(p_thresholds) > 50 then
    raise exception 'At most 50 payment thresholds may be saved together.';
  end if;

  for v_item in select value from jsonb_array_elements(p_thresholds)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each payment threshold must be an object.';
    end if;
    select * into v_saved
    from public.save_payment_collection_currency_threshold(
      v_item->>'currencyIsoCode',
      (v_item->>'threshold')::numeric,
      (v_item->>'expectedRevision')::integer,
      p_actor_user_id,
      p_actor_email
    );
    v_results := v_results || jsonb_build_array(to_jsonb(v_saved));
  end loop;

  return v_results;
end;
$$;

alter table public.financial_report_settings enable row level security;
alter table public.financial_report_setting_events enable row level security;
alter table public.payment_collection_currency_thresholds enable row level security;
alter table public.payment_collection_threshold_events enable row level security;

revoke all on table public.financial_report_settings from public, anon, authenticated;
revoke all on table public.financial_report_setting_events from public, anon, authenticated;
revoke all on table public.payment_collection_currency_thresholds from public, anon, authenticated;
revoke all on table public.payment_collection_threshold_events from public, anon, authenticated;
grant all on table public.financial_report_settings to service_role;
grant all on table public.financial_report_setting_events to service_role;
grant all on table public.payment_collection_currency_thresholds to service_role;
grant all on table public.payment_collection_threshold_events to service_role;

revoke all on function public.save_financial_report_settings(text, jsonb, boolean, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.save_payment_collection_currency_threshold(text, numeric, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.save_payment_collection_currency_thresholds(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_financial_report_settings(text, jsonb, boolean, integer, uuid, text) to service_role;
grant execute on function public.save_payment_collection_currency_threshold(text, numeric, integer, uuid, text) to service_role;
grant execute on function public.save_payment_collection_currency_thresholds(jsonb, uuid, text) to service_role;
