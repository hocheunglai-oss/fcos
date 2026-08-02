begin;

alter table public.hedge_market_prices
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_snapshot jsonb,
  add column if not exists verification_hash text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by_id uuid references public.user_profiles(id) on delete set null;

alter table public.hedge_market_prices
  drop constraint if exists hedge_market_prices_verification_status_check,
  add constraint hedge_market_prices_verification_status_check
    check (verification_status in ('unverified', 'verified', 'not_applicable')),
  drop constraint if exists hedge_market_prices_verified_evidence_check,
  add constraint hedge_market_prices_verified_evidence_check check (
    verification_status <> 'verified'
    or (
      verification_snapshot is not null
      and verification_hash is not null
      and verified_at is not null
      and verified_by_id is not null
    )
  );

update public.hedge_market_prices
set verification_status = 'not_applicable',
    verification_snapshot = null,
    verification_hash = null,
    verified_at = null,
    verified_by_id = null
where is_estimate = true;

create index if not exists hedge_market_prices_verification_idx
  on public.hedge_market_prices(price_date, verification_status, is_estimate);

alter table public.hedge_market_prices enable row level security;
revoke all on table public.hedge_market_prices from public, anon, authenticated;
grant all on table public.hedge_market_prices to service_role;

comment on column public.hedge_market_prices.verification_status is
  'Server-derived verification of the saved values against the manually pasted third-party source message.';

create or replace function public.expire_paper_hedge_with_audit(
  p_hedge_id uuid,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_email text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_before public.hedge_swap_hedges%rowtype;
  v_after public.hedge_swap_hedges%rowtype;
begin
  select * into v_before
  from public.hedge_swap_hedges
  where id = p_hedge_id
  for update;

  if not found or v_before.is_expired or v_before.revision <> p_expected_revision then
    return jsonb_build_object('expired', false);
  end if;

  update public.hedge_swap_hedges
  set is_expired = true,
      updated_by_id = p_actor_user_id
  where id = p_hedge_id
  returning * into v_after;

  insert into public.hedge_events (
    event_type, entity_type, entity_id, label, before_data, after_data,
    metadata, actor_user_id, actor_email, source
  ) values (
    'paper_hedge_auto_expired',
    'SwapHedge',
    p_hedge_id,
    'Paper hedge expired automatically after final verified MOPS.',
    jsonb_build_object('is_expired', false, 'revision', v_before.revision),
    jsonb_build_object('is_expired', true, 'revision', v_after.revision),
    coalesce(p_metadata, '{}'::jsonb),
    p_actor_user_id,
    lower(coalesce(nullif(btrim(p_actor_email), ''), 'system')),
    'fcos'
  );

  return jsonb_build_object('expired', true, 'revision', v_after.revision);
end;
$$;

revoke all on function public.expire_paper_hedge_with_audit(uuid, bigint, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.expire_paper_hedge_with_audit(uuid, bigint, uuid, text, jsonb)
  to service_role;

commit;
