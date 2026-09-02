begin;

create table if not exists public.market_intelligence_series (
  id uuid primary key default gen_random_uuid(),
  market_family text not null check (market_family in ('delivered', 'cargo', 'forward', 'compliance')),
  port_key text not null,
  port_label text not null,
  product_key text not null,
  product_label text not null,
  alias_label text,
  source_symbol text,
  source_name text not null default 'S&P Global Commodity Insights',
  source_type text not null check (source_type in ('assessment', 'posted', 'proxy', 'estimate', 'unavailable')),
  currency_code text not null default 'USD',
  unit text not null default 'USD/MT',
  basis_note text,
  active boolean not null default true,
  display_order integer not null default 0,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_family, port_key, product_key)
);

create table if not exists public.market_report_imports (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_document_type text not null check (source_document_type in ('bunkerwire', 'european_marketscan', 'manual')),
  source_hash text not null,
  report_date date not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  status text not null default 'completed' check (status in ('completed', 'replayed')),
  actor_user_id uuid,
  actor_email text,
  created_at timestamptz not null default now(),
  unique (source_document_type, source_hash)
);

create table if not exists public.market_price_observations (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.market_intelligence_series(id) on delete restrict,
  import_id uuid not null references public.market_report_imports(id) on delete restrict,
  price_date date not null,
  price numeric(18, 6) not null check (price > 0),
  day_change numeric(18, 6),
  quality_status text not null default 'verified' check (quality_status in ('verified', 'estimate')),
  source_hash text not null,
  source_page integer check (source_page is null or source_page > 0),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, price_date)
);

create table if not exists public.market_intelligence_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_id uuid,
  source_document_type text,
  source_hash text,
  observation_count integer not null default 0,
  result_status text not null,
  actor_user_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);

alter table public.market_intelligence_series enable row level security;
alter table public.market_report_imports enable row level security;
alter table public.market_price_observations enable row level security;
alter table public.market_intelligence_events enable row level security;

revoke all on table public.market_intelligence_series from public, anon, authenticated;
revoke all on table public.market_report_imports from public, anon, authenticated;
revoke all on table public.market_price_observations from public, anon, authenticated;
revoke all on table public.market_intelligence_events from public, anon, authenticated;
grant all on table public.market_intelligence_series to service_role;
grant all on table public.market_report_imports to service_role;
grant all on table public.market_price_observations to service_role;
grant all on table public.market_intelligence_events to service_role;

create or replace function public.touch_market_intelligence_row()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger market_intelligence_series_touch
before update on public.market_intelligence_series
for each row execute function public.touch_market_intelligence_row();

create trigger market_price_observations_touch
before update on public.market_price_observations
for each row execute function public.touch_market_intelligence_row();

create or replace function public.save_market_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_report_date date,
  p_observations jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.market_report_imports%rowtype;
  v_item jsonb;
  v_series public.market_intelligence_series%rowtype;
  v_count integer := 0;
begin
  if coalesce(length(trim(p_idempotency_key)), 0) < 16 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_source_document_type not in ('bunkerwire', 'european_marketscan', 'manual') then
    raise exception 'INVALID_SOURCE_DOCUMENT_TYPE';
  end if;
  if coalesce(length(p_source_hash), 0) <> 64 then
    raise exception 'INVALID_SOURCE_HASH';
  end if;
  if jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations) > 250 then
    raise exception 'INVALID_OBSERVATIONS';
  end if;

  select * into v_import
  from public.market_report_imports
  where idempotency_key = p_idempotency_key
     or (source_document_type = p_source_document_type and source_hash = p_source_hash)
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('id', v_import.id, 'status', 'replayed', 'observationCount', v_import.observation_count);
  end if;

  insert into public.market_report_imports (
    idempotency_key, source_document_type, source_hash, report_date,
    observation_count, actor_user_id, actor_email
  ) values (
    p_idempotency_key, p_source_document_type, p_source_hash, p_report_date,
    jsonb_array_length(p_observations), p_actor_user_id, lower(trim(p_actor_email))
  ) returning * into v_import;

  for v_item in select * from jsonb_array_elements(p_observations)
  loop
    select * into v_series
    from public.market_intelligence_series
    where source_symbol = upper(trim(v_item->>'sourceSymbol')) and active = true;
    if not found then
      raise exception 'UNKNOWN_MARKET_SERIES:%', coalesce(v_item->>'sourceSymbol', '');
    end if;
    if (v_item->>'price')::numeric <= 0 then
      raise exception 'INVALID_MARKET_PRICE:%', v_series.source_symbol;
    end if;

    insert into public.market_price_observations (
      series_id, import_id, price_date, price, day_change, quality_status,
      source_hash, source_page
    ) values (
      v_series.id, v_import.id, p_report_date, (v_item->>'price')::numeric,
      nullif(v_item->>'dayChange', '')::numeric,
      case when coalesce((v_item->>'isEstimate')::boolean, false) then 'estimate' else 'verified' end,
      p_source_hash, nullif(v_item->>'sourcePage', '')::integer
    )
    on conflict (series_id, price_date) do update set
      import_id = excluded.import_id,
      price = excluded.price,
      day_change = excluded.day_change,
      quality_status = excluded.quality_status,
      source_hash = excluded.source_hash,
      source_page = excluded.source_page;
    v_count := v_count + 1;
  end loop;

  insert into public.market_intelligence_events (
    event_type, entity_id, source_document_type, source_hash,
    observation_count, result_status, actor_user_id, actor_email
  ) values (
    'report_imported', v_import.id, p_source_document_type, p_source_hash,
    v_count, 'completed', p_actor_user_id, lower(trim(p_actor_email))
  );

  return jsonb_build_object('id', v_import.id, 'status', 'completed', 'observationCount', v_count);
end;
$$;

revoke all on function public.touch_market_intelligence_row() from public, anon, authenticated;
revoke all on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.touch_market_intelligence_row() to service_role;
grant execute on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text) to service_role;

insert into public.market_intelligence_series (
  market_family, port_key, port_label, product_key, product_label, alias_label,
  source_symbol, source_type, basis_note, display_order
) values
  ('delivered', 'singapore', 'Singapore', 'vlsfo', 'VLSFO 0.5%', null, 'MFSPD00', 'assessment', 'Delivered bunker assessment', 101),
  ('delivered', 'singapore', 'Singapore', 'hsfo380', 'HSFO 380', null, 'PUAFT00', 'assessment', 'Delivered bunker assessment', 102),
  ('delivered', 'singapore', 'Singapore', 'lsmgo', 'LSMGO 0.1%', null, 'AAXYO00', 'assessment', 'Delivered bunker assessment', 103),
  ('delivered', 'south-korea', 'South Korea', 'vlsfo', 'VLSFO 0.5%', null, 'MFSKD00', 'assessment', 'Delivered bunker assessment', 201),
  ('delivered', 'south-korea', 'South Korea', 'hsfo380', 'HSFO 380', null, 'PUAFR00', 'assessment', 'Delivered bunker assessment', 202),
  ('delivered', 'south-korea', 'South Korea', 'lsmgo', 'LSMGO 0.1%', null, 'AAXYS00', 'assessment', 'Delivered bunker assessment', 203),
  ('delivered', 'south-korea-west', 'South Korea (West)', 'vlsfo', 'VLSFO 0.5%', null, 'WKMFA00', 'assessment', 'Delivered bunker assessment', 301),
  ('delivered', 'south-korea-west', 'South Korea (West)', 'hsfo380', 'HSFO 380', null, null, 'unavailable', 'No exact series configured', 302),
  ('delivered', 'south-korea-west', 'South Korea (West)', 'lsmgo', 'LSMGO 0.1%', null, null, 'unavailable', 'No exact series configured', 303),
  ('delivered', 'zhoushan', 'Zhoushan', 'vlsfo', 'VLSFO 0.5%', null, 'MFZSD00', 'assessment', 'Delivered bunker assessment', 401),
  ('delivered', 'zhoushan', 'Zhoushan', 'hsfo380', 'HSFO 380', null, 'BFDZA00', 'assessment', 'Delivered bunker assessment', 402),
  ('delivered', 'zhoushan', 'Zhoushan', 'lsmgo', 'LSMGO 0.1%', null, 'MGZSD00', 'assessment', 'Delivered bunker assessment', 403),
  ('delivered', 'kaohsiung', 'Kaohsiung', 'vlsfo', 'VLSFO 0.5%', 'LS180', 'CB1AR00', 'posted', 'CPC posted MF-180 0.5%', 501),
  ('delivered', 'kaohsiung', 'Kaohsiung', 'hsfo380', 'HSFO 380', 'MF-380', 'CB3AN00', 'posted', 'CPC posted MF-380', 502),
  ('delivered', 'kaohsiung', 'Kaohsiung', 'lsmgo', 'LSMGO 0.1%', 'Marine Gasoil', 'CBGAP00', 'posted', 'CPC posted marine gasoil', 503),
  ('cargo', 'singapore', 'Singapore', 'vlsfo', 'VLSFO 0.5% cargo', 'FOB Singapore', 'AMFSA00', 'assessment', 'FOB Singapore cargo assessment', 601),
  ('forward', 'singapore', 'Singapore', 'vlsfo-bm', 'VLSFO balance month', 'BM', 'FOFS000', 'assessment', 'FOB Singapore cargo balance month', 701),
  ('forward', 'singapore', 'Singapore', 'vlsfo-m1', 'VLSFO M1', 'M1', 'FOFS001', 'assessment', 'FOB Singapore cargo M1', 702),
  ('forward', 'singapore', 'Singapore', 'vlsfo-m2', 'VLSFO M2', 'M2', 'FOFS002', 'assessment', 'FOB Singapore cargo M2', 703),
  ('forward', 'singapore', 'Singapore', 'hsfo380-m1', 'HSFO 380 M1', 'M1', 'FPLSM01', 'assessment', 'Singapore 380 CST cargo at London MOC', 704),
  ('forward', 'singapore', 'Singapore', 'hsfo380-m2', 'HSFO 380 M2', 'M2', 'FPLSM02', 'assessment', 'Singapore 380 CST cargo at London MOC', 705),
  ('forward', 'singapore', 'Singapore', 'east-west-m1', 'East-West M1', 'M1', 'FQLSM01', 'assessment', 'Singapore 380 CST versus Rotterdam 3.5%', 706),
  ('forward', 'singapore', 'Singapore', 'east-west-m2', 'East-West M2', 'M2', 'FQLSM02', 'assessment', 'Singapore 380 CST versus Rotterdam 3.5%', 707),
  ('forward', 'singapore', 'Singapore', 'gasoil-m1', 'Gasoil 10ppm M1', 'M1', 'MSGSL00', 'assessment', 'Singapore gasoil 10ppm at London MOC', 708),
  ('forward', 'singapore', 'Singapore', 'gasoil-m2', 'Gasoil 10ppm M2', 'M2', 'MSHSL00', 'assessment', 'Singapore gasoil 10ppm at London MOC', 709)
on conflict (market_family, port_key, product_key) do update set
  port_label = excluded.port_label,
  product_label = excluded.product_label,
  alias_label = excluded.alias_label,
  source_symbol = excluded.source_symbol,
  source_type = excluded.source_type,
  basis_note = excluded.basis_note,
  display_order = excluded.display_order,
  active = true;

commit;
