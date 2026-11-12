create table public.xero_financial_rounding_policies (
  tenant_id uuid not null,
  currency text not null check(currency in ('USD','HKD')),
  enabled boolean not null default false,
  account_id uuid,
  account_code text,
  tax_type text,
  max_native_cents integer check(max_native_cents > 0),
  revision integer not null default 1 check(revision > 0),
  reason text not null check(length(trim(reason)) between 5 and 1000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  primary key(tenant_id,currency),
  check(not enabled or (account_id is not null and coalesce(length(trim(account_code)),0) > 0 and coalesce(length(trim(tax_type)),0) > 0 and max_native_cents is not null))
);
alter table public.xero_financial_rounding_policies enable row level security;
alter table public.xero_financial_rounding_policies force row level security;
revoke all on public.xero_financial_rounding_policies from public,anon,authenticated,service_role;
grant select,insert,update on public.xero_financial_rounding_policies to service_role;
create policy service_only on public.xero_financial_rounding_policies for all to service_role using(true) with check(true);
create function public.save_xero_rounding_policy_v1(p_tenant_id uuid,p_currency text,p_enabled boolean,p_account_id uuid,p_account_code text,p_tax_type text,p_max_native_cents integer,p_expected_revision integer,p_reason text,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare prior public.xero_financial_rounding_policies; saved public.xero_financial_rounding_policies;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||p_currency,0));
  select * into prior from public.xero_financial_rounding_policies where tenant_id=p_tenant_id and currency=p_currency for update;
  if coalesce(prior.revision,0) <> coalesce(p_expected_revision,0) then raise exception 'Rounding policy revision changed'; end if;
  insert into public.xero_financial_rounding_policies(tenant_id,currency,enabled,account_id,account_code,tax_type,max_native_cents,revision,reason,reviewed_by)
  values(p_tenant_id,p_currency,p_enabled,p_account_id,p_account_code,p_tax_type,p_max_native_cents,coalesce(prior.revision,0)+1,p_reason,p_actor_id)
  on conflict(tenant_id,currency) do update set enabled=excluded.enabled,account_id=excluded.account_id,account_code=excluded.account_code,tax_type=excluded.tax_type,max_native_cents=excluded.max_native_cents,revision=excluded.revision,reason=excluded.reason,reviewed_by=excluded.reviewed_by,reviewed_at=now()
  returning * into saved;
  insert into public.xero_financial_audit_events(event_type,outcome,actor_id,fingerprints)
  values('rounding_policy_reviewed','success',p_actor_id,jsonb_build_object('old',to_jsonb(prior),'new',to_jsonb(saved)));
  return to_jsonb(saved);
end $$;
revoke all on function public.save_xero_rounding_policy_v1(uuid,text,boolean,uuid,text,text,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.save_xero_rounding_policy_v1(uuid,text,boolean,uuid,text,text,integer,integer,text,uuid) to service_role;
