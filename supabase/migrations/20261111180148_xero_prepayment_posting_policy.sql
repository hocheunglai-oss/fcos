create table public.xero_prepayment_posting_policies (
  tenant_id uuid not null,
  direction text not null check (direction in ('Buy', 'Sell')),
  currency text not null check (currency in ('USD', 'HKD')),
  enabled boolean not null default false,
  account_id uuid,
  account_code text,
  tax_type text,
  revision integer not null default 1 check (revision > 0),
  reason text not null check (length(trim(reason)) between 5 and 1000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  primary key (tenant_id, direction, currency),
  check (
    (enabled and account_id is not null and coalesce(length(trim(account_code)), 0) > 0 and coalesce(length(trim(tax_type)), 0) > 0)
    or
    (not enabled and account_id is null and account_code is null and tax_type is null)
  )
);

create table public.xero_prepayment_posting_policy_history (
  tenant_id uuid not null,
  direction text not null check (direction in ('Buy', 'Sell')),
  currency text not null check (currency in ('USD', 'HKD')),
  enabled boolean not null,
  account_id uuid,
  account_code text,
  tax_type text,
  revision integer not null check (revision > 0),
  reason text not null check (length(trim(reason)) between 5 and 1000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, direction, currency, revision),
  check (
    (enabled and account_id is not null and coalesce(length(trim(account_code)), 0) > 0 and coalesce(length(trim(tax_type)), 0) > 0)
    or
    (not enabled and account_id is null and account_code is null and tax_type is null)
  )
);

comment on table public.xero_prepayment_posting_policies is
  'Current Finance-reviewed Xero prepayment posting policy, scoped to one exact tenant, trade direction and currency.';
comment on table public.xero_prepayment_posting_policy_history is
  'Immutable revision history for Finance-reviewed Xero prepayment posting policies.';

alter table public.xero_prepayment_posting_policies enable row level security;
alter table public.xero_prepayment_posting_policies force row level security;
alter table public.xero_prepayment_posting_policy_history enable row level security;
alter table public.xero_prepayment_posting_policy_history force row level security;

revoke all on public.xero_prepayment_posting_policies from public, anon, authenticated, service_role;
revoke all on public.xero_prepayment_posting_policy_history from public, anon, authenticated, service_role;
grant select on public.xero_prepayment_posting_policies to service_role;
grant select on public.xero_prepayment_posting_policy_history to service_role;

create policy xero_prepayment_posting_policy_service_only
  on public.xero_prepayment_posting_policies
  for select to service_role using (true);
create policy xero_prepayment_posting_policy_history_service_only
  on public.xero_prepayment_posting_policy_history
  for select to service_role using (true);

create function public.reject_xero_prepayment_posting_policy_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Xero prepayment posting policy history is immutable';
end;
$$;

create trigger xero_prepayment_posting_policy_history_immutable
before update or delete on public.xero_prepayment_posting_policy_history
for each row execute function public.reject_xero_prepayment_posting_policy_history_mutation();

create function public.record_xero_prepayment_posting_policy_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.xero_prepayment_posting_policy_history (
    tenant_id, direction, currency, enabled, account_id, account_code, tax_type,
    revision, reason, reviewed_by, reviewed_at
  ) values (
    new.tenant_id, new.direction, new.currency, new.enabled, new.account_id,
    new.account_code, new.tax_type, new.revision, new.reason, new.reviewed_by, new.reviewed_at
  );
  return new;
end;
$$;

create trigger xero_prepayment_posting_policy_record_history
after insert or update on public.xero_prepayment_posting_policies
for each row execute function public.record_xero_prepayment_posting_policy_history();

create function public.save_xero_prepayment_posting_policy_v1(
  p_tenant_id uuid,
  p_direction text,
  p_currency text,
  p_enabled boolean,
  p_account_id uuid,
  p_account_code text,
  p_tax_type text,
  p_expected_revision integer,
  p_reason text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior public.xero_prepayment_posting_policies;
  saved public.xero_prepayment_posting_policies;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'Expected revision must be a non-negative integer';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_direction || ':' || p_currency, 0));
  select * into prior
  from public.xero_prepayment_posting_policies
  where tenant_id = p_tenant_id and direction = p_direction and currency = p_currency
  for update;

  if coalesce(prior.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Prepayment posting policy revision changed';
  end if;

  insert into public.xero_prepayment_posting_policies (
    tenant_id, direction, currency, enabled, account_id, account_code, tax_type,
    revision, reason, reviewed_by, reviewed_at
  ) values (
    p_tenant_id, p_direction, p_currency, p_enabled, p_account_id, p_account_code, p_tax_type,
    coalesce(prior.revision, 0) + 1, p_reason, p_actor_id, now()
  )
  on conflict (tenant_id, direction, currency) do update set
    enabled = excluded.enabled,
    account_id = excluded.account_id,
    account_code = excluded.account_code,
    tax_type = excluded.tax_type,
    revision = excluded.revision,
    reason = excluded.reason,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

revoke all on function public.reject_xero_prepayment_posting_policy_history_mutation() from public, anon, authenticated;
revoke all on function public.record_xero_prepayment_posting_policy_history() from public, anon, authenticated;
revoke all on function public.save_xero_prepayment_posting_policy_v1(uuid, text, text, boolean, uuid, text, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.save_xero_prepayment_posting_policy_v1(uuid, text, text, boolean, uuid, text, text, integer, text, uuid) to service_role;
