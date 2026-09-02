begin;

alter table public.hedge_counterparties
  add column if not exists settlement_mode text not null default 'external',
  add column if not exists is_system_managed boolean not null default false;

alter table public.hedge_counterparties
  drop constraint if exists hedge_counterparties_settlement_mode_check;

alter table public.hedge_counterparties
  add constraint hedge_counterparties_settlement_mode_check
  check (settlement_mode in ('external', 'internal_no_invoice'));

create unique index if not exists hedge_counterparties_short_name_normalized_uidx
  on public.hedge_counterparties (lower(btrim(short_name)))
  where nullif(btrim(short_name), '') is not null;

insert into public.hedge_counterparties (
  short_name,
  full_name,
  settlement_mode,
  is_system_managed,
  created_by
) values (
  'FCBHK',
  'FRATELLI COSULICH BUNKERS (HK) LTD',
  'internal_no_invoice',
  true,
  'system'
)
on conflict (lower(btrim(short_name))) where nullif(btrim(short_name), '') is not null
do update set
  short_name = 'FCBHK',
  full_name = 'FRATELLI COSULICH BUNKERS (HK) LTD',
  settlement_mode = 'internal_no_invoice',
  is_system_managed = true;

update public.hedge_settings
set value = jsonb_set(
      value,
      '{counterparts}',
      coalesce(value->'counterparts', '[]'::jsonb) || '"FCBHK"'::jsonb,
      true
    )
where key = 'lists'
  and not coalesce(value->'counterparts', '[]'::jsonb) @> '["FCBHK"]'::jsonb;

create or replace function public.hedge_counterparty_is_internal(p_counterparty text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select upper(btrim(coalesce(p_counterparty, ''))) = 'FCBHK'
    or exists (
      select 1
      from public.hedge_counterparties counterparty
      where lower(btrim(counterparty.short_name)) = lower(btrim(coalesce(p_counterparty, '')))
        and counterparty.settlement_mode = 'internal_no_invoice'
    );
$$;

create or replace function public.protect_system_hedge_counterparty()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_system_managed then
    if tg_op = 'DELETE' then
      raise exception 'HEDGE_SYSTEM_COUNTERPARTY_DELETE_BLOCKED';
    end if;
    if new.short_name is distinct from old.short_name
      or new.settlement_mode is distinct from old.settlement_mode
      or new.is_system_managed is distinct from old.is_system_managed then
      raise exception 'HEDGE_SYSTEM_COUNTERPARTY_IDENTITY_BLOCKED';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_system_hedge_counterparty on public.hedge_counterparties;
create trigger protect_system_hedge_counterparty
before update or delete on public.hedge_counterparties
for each row execute function public.protect_system_hedge_counterparty();

create or replace function public.block_internal_hedge_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.hedge_counterparty_is_internal(new.counterparty) then
    raise exception 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists block_internal_hedge_invoice on public.hedge_invoices;
create trigger block_internal_hedge_invoice
before insert or update of counterparty on public.hedge_invoices
for each row execute function public.block_internal_hedge_invoice();

create or replace function public.block_internal_hedge_invoice_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.hedge_swap_hedges swap
    where swap.id = new.swap_id
      and public.hedge_counterparty_is_internal(swap.counterparty)
  ) then
    raise exception 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists block_internal_hedge_invoice_link on public.hedge_invoice_swaps;
create trigger block_internal_hedge_invoice_link
before insert or update of swap_id on public.hedge_invoice_swaps
for each row execute function public.block_internal_hedge_invoice_link();

create or replace function public.validate_internal_physical_trade_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.hedge_swap_physical_links link
      join public.hedge_swap_hedges swap on swap.id = link.swap_id
      where link.physical_trade_id = old.id
        and public.hedge_counterparty_is_internal(swap.counterparty)
    ) then
      raise exception 'HEDGE_INTERNAL_PHYSICAL_DELETE_BLOCKED';
    end if;
    return old;
  end if;

  if exists (
    select 1
    from public.hedge_swap_physical_links link
    join public.hedge_swap_hedges swap on swap.id = link.swap_id
    where link.physical_trade_id = old.id
      and public.hedge_counterparty_is_internal(swap.counterparty)
      and (
        not public.hedge_counterparty_is_internal(new.counterparty)
        or nullif(btrim(new.stem_number), '') is null
        or new.product is distinct from swap.product
      )
  ) then
    raise exception 'HEDGE_INTERNAL_PHYSICAL_IDENTITY_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_internal_physical_trade_update on public.hedge_physical_trades;
create trigger validate_internal_physical_trade_update
before update or delete on public.hedge_physical_trades
for each row execute function public.validate_internal_physical_trade_update();

create or replace function public.validate_internal_hedge_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_swap public.hedge_swap_hedges%rowtype;
  v_physical public.hedge_physical_trades%rowtype;
begin
  select * into v_swap from public.hedge_swap_hedges where id = new.swap_id;
  if public.hedge_counterparty_is_internal(v_swap.counterparty) then
    select * into v_physical from public.hedge_physical_trades where id = new.physical_trade_id;
    if not public.hedge_counterparty_is_internal(v_physical.counterparty) then
      raise exception 'HEDGE_INTERNAL_PHYSICAL_COUNTERPARTY';
    end if;
    if nullif(btrim(v_physical.stem_number), '') is null then
      raise exception 'HEDGE_INTERNAL_STEM_REQUIRED';
    end if;
    if v_physical.product is distinct from v_swap.product then
      raise exception 'HEDGE_INTERNAL_PRODUCT_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_internal_hedge_link on public.hedge_swap_physical_links;
create trigger validate_internal_hedge_link
before insert or update on public.hedge_swap_physical_links
for each row execute function public.validate_internal_hedge_link();

create or replace function public.save_hedge_swap_with_links(
  p_swap_id uuid,
  p_expected_revision bigint,
  p_payload jsonb,
  p_physical_trade_ids uuid[],
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_swap public.hedge_swap_hedges%rowtype;
  v_id uuid := coalesce(p_swap_id, gen_random_uuid());
  v_ids uuid[] := coalesce(p_physical_trade_ids, array[]::uuid[]);
  v_counterparty text := upper(btrim(coalesce(p_payload->>'counterparty', '')));
begin
  if v_counterparty = '' then raise exception 'HEDGE_COUNTERPARTY_REQUIRED'; end if;
  if cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) id) then
    raise exception 'HEDGE_PHYSICAL_LINK_DUPLICATE';
  end if;
  if cardinality(v_ids) <> (select count(*) from public.hedge_physical_trades where id = any(v_ids)) then
    raise exception 'HEDGE_PHYSICAL_LINK_INVALID';
  end if;

  if p_swap_id is null then
    insert into public.hedge_swap_hedges (
      id, trade_date, product, direction, swap_month, quantity, unit, price,
      venue, broker, counterparty, notes, is_expired, round_trip, initial_margin,
      current_margin, pricing_basis, bal_start_date, trade_type, leg1_month,
      leg1_price, leg1_basis, leg1_bal_date, leg2_month, leg2_price, leg2_basis,
      leg2_bal_date, sf_record_id, created_by, created_by_id, updated_by_id
    ) values (
      v_id, nullif(p_payload->>'trade_date', '')::date, nullif(p_payload->>'product', ''),
      nullif(p_payload->>'direction', ''), nullif(p_payload->>'swap_month', ''), nullif(p_payload->>'quantity', '')::numeric,
      nullif(p_payload->>'unit', ''), nullif(p_payload->>'price', '')::numeric, nullif(p_payload->>'venue', ''),
      nullif(p_payload->>'broker', ''), v_counterparty, nullif(p_payload->>'notes', ''),
      coalesce((p_payload->>'is_expired')::boolean, false), coalesce((p_payload->>'round_trip')::boolean, false),
      nullif(p_payload->>'initial_margin', '')::numeric, nullif(p_payload->>'current_margin', '')::numeric,
      nullif(p_payload->>'pricing_basis', ''), nullif(p_payload->>'bal_start_date', '')::date,
      nullif(p_payload->>'trade_type', ''), nullif(p_payload->>'leg1_month', ''), nullif(p_payload->>'leg1_price', '')::numeric,
      nullif(p_payload->>'leg1_basis', ''), nullif(p_payload->>'leg1_bal_date', '')::date,
      nullif(p_payload->>'leg2_month', ''), nullif(p_payload->>'leg2_price', '')::numeric,
      nullif(p_payload->>'leg2_basis', ''), nullif(p_payload->>'leg2_bal_date', '')::date,
      nullif(p_payload->>'sf_record_id', ''), lower(btrim(coalesce(p_actor_email, ''))), p_actor_user_id, p_actor_user_id
    ) returning * into v_swap;
  else
    delete from public.hedge_swap_physical_links where swap_id = p_swap_id;
    update public.hedge_swap_hedges set
      trade_date = nullif(p_payload->>'trade_date', '')::date,
      product = nullif(p_payload->>'product', ''),
      direction = nullif(p_payload->>'direction', ''),
      swap_month = nullif(p_payload->>'swap_month', ''),
      quantity = nullif(p_payload->>'quantity', '')::numeric,
      unit = nullif(p_payload->>'unit', ''),
      price = nullif(p_payload->>'price', '')::numeric,
      venue = nullif(p_payload->>'venue', ''),
      broker = nullif(p_payload->>'broker', ''),
      counterparty = v_counterparty,
      notes = nullif(p_payload->>'notes', ''),
      round_trip = coalesce((p_payload->>'round_trip')::boolean, false),
      initial_margin = nullif(p_payload->>'initial_margin', '')::numeric,
      current_margin = nullif(p_payload->>'current_margin', '')::numeric,
      pricing_basis = nullif(p_payload->>'pricing_basis', ''),
      bal_start_date = nullif(p_payload->>'bal_start_date', '')::date,
      trade_type = nullif(p_payload->>'trade_type', ''),
      leg1_month = nullif(p_payload->>'leg1_month', ''),
      leg1_price = nullif(p_payload->>'leg1_price', '')::numeric,
      leg1_basis = nullif(p_payload->>'leg1_basis', ''),
      leg1_bal_date = nullif(p_payload->>'leg1_bal_date', '')::date,
      leg2_month = nullif(p_payload->>'leg2_month', ''),
      leg2_price = nullif(p_payload->>'leg2_price', '')::numeric,
      leg2_basis = nullif(p_payload->>'leg2_basis', ''),
      leg2_bal_date = nullif(p_payload->>'leg2_bal_date', '')::date,
      sf_record_id = nullif(p_payload->>'sf_record_id', ''),
      updated_by_id = p_actor_user_id
    where id = p_swap_id and revision = p_expected_revision
    returning * into v_swap;
    if not found then raise exception 'REVISION_CONFLICT'; end if;
  end if;

  if public.hedge_counterparty_is_internal(v_counterparty) then
    if cardinality(v_ids) = 0 then raise exception 'HEDGE_INTERNAL_PHYSICAL_REQUIRED'; end if;
    if exists (select 1 from public.hedge_physical_trades where id = any(v_ids) and not public.hedge_counterparty_is_internal(counterparty)) then
      raise exception 'HEDGE_INTERNAL_PHYSICAL_COUNTERPARTY';
    end if;
    if exists (select 1 from public.hedge_physical_trades where id = any(v_ids) and nullif(btrim(stem_number), '') is null) then
      raise exception 'HEDGE_INTERNAL_STEM_REQUIRED';
    end if;
    if exists (select 1 from public.hedge_physical_trades where id = any(v_ids) and product is distinct from v_swap.product) then
      raise exception 'HEDGE_INTERNAL_PRODUCT_MISMATCH';
    end if;
  end if;

  insert into public.hedge_swap_physical_links (swap_id, physical_trade_id, link_order)
  select v_id, id, ordinality - 1
  from unnest(v_ids) with ordinality selected(id, ordinality);

  select * into v_swap from public.hedge_swap_hedges where id = v_id;
  return to_jsonb(v_swap);
end;
$$;

alter table public.hedge_counterparties enable row level security;
revoke all on table public.hedge_counterparties from public, anon, authenticated;
grant all on table public.hedge_counterparties to service_role;

revoke all on function public.hedge_counterparty_is_internal(text) from public, anon, authenticated;
revoke all on function public.protect_system_hedge_counterparty() from public, anon, authenticated;
revoke all on function public.block_internal_hedge_invoice() from public, anon, authenticated;
revoke all on function public.block_internal_hedge_invoice_link() from public, anon, authenticated;
revoke all on function public.validate_internal_physical_trade_update() from public, anon, authenticated;
revoke all on function public.validate_internal_hedge_link() from public, anon, authenticated;
revoke all on function public.save_hedge_swap_with_links(uuid, bigint, jsonb, uuid[], uuid, text) from public, anon, authenticated;

grant execute on function public.hedge_counterparty_is_internal(text) to service_role;
grant execute on function public.save_hedge_swap_with_links(uuid, bigint, jsonb, uuid[], uuid, text) to service_role;

commit;
