alter table public.master_contract_price_resolutions
  add column supplier_benchmark_date date,
  add column buyer_benchmark_date date,
  add column supplier_benchmark_value numeric(24,10),
  add column buyer_benchmark_value numeric(24,10),
  add column supplier_official_observation_id uuid,
  add column buyer_official_observation_id uuid,
  add column position_side text,
  add column position_days integer;

update public.master_contract_price_resolutions
set supplier_benchmark_date = benchmark_date,
    buyer_benchmark_date = benchmark_date,
    supplier_benchmark_value = benchmark_value,
    buyer_benchmark_value = benchmark_value,
    supplier_official_observation_id = official_observation_id,
    buyer_official_observation_id = official_observation_id,
    position_side = 'matched',
    position_days = 0;

alter table public.master_contract_price_resolutions
  alter column supplier_benchmark_date set not null,
  alter column buyer_benchmark_date set not null,
  alter column supplier_benchmark_value set not null,
  alter column buyer_benchmark_value set not null,
  alter column position_side set not null,
  alter column position_days set not null,
  add constraint master_contract_price_position_side_check
    check (position_side in ('long', 'short', 'matched')),
  add constraint master_contract_price_position_days_check
    check (position_days >= 0);

create or replace function public.save_master_contract_price_resolution_v2(
  p_contract_id uuid,
  p_expected_revision bigint,
  p_delivery_product_id uuid,
  p_supplier_benchmark_date date,
  p_buyer_benchmark_date date,
  p_benchmark_code text,
  p_benchmark_unit text,
  p_supplier_benchmark_value numeric,
  p_buyer_benchmark_value numeric,
  p_conversion_factor numeric,
  p_buy_unrounded numeric,
  p_sell_unrounded numeric,
  p_buy_rounded numeric,
  p_sell_rounded numeric,
  p_evidence_hash text,
  p_supplier_official_observation_id uuid,
  p_buyer_official_observation_id uuid,
  p_position_side text,
  p_position_days integer,
  p_alternate_publication_reason text,
  p_status text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract public.master_contracts%rowtype;
  v_operation public.master_contract_operations%rowtype;
  v_resolution public.master_contract_price_resolutions%rowtype;
  v_resolution_revision bigint;
  v_operation_name text;
begin
  v_operation_name := case when p_status = 'applied' then 'apply_price' else 'resolve_price' end;
  if p_status not in ('review_required', 'reviewed', 'applied', 'conflict')
    or p_actor_user_id is null
    or p_supplier_benchmark_date is null
    or p_buyer_benchmark_date is null
    or coalesce(p_benchmark_code, '') !~ '^[A-Z0-9.%-]{2,40}$'
    or p_benchmark_unit not in ('USD/MT', 'USD/bbl')
    or p_supplier_benchmark_value is null
    or p_buyer_benchmark_value is null
    or p_conversion_factor is null or p_conversion_factor <= 0
    or p_position_side not in ('long', 'short', 'matched')
    or p_position_days is null or p_position_days < 0
    or lower(btrim(coalesce(p_evidence_hash, ''))) !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'Complete reviewed buyer and supplier pricing evidence is required.' using errcode = '22023';
  end if;

  select * into v_operation from public.master_contract_operations
  where idempotency_key = btrim(p_idempotency_key) for update;
  if found then
    if v_operation.operation <> v_operation_name or v_operation.request_hash <> lower(btrim(p_request_hash)) then
      raise exception 'This Master Contract idempotency key belongs to a different request.' using errcode = '40001';
    end if;
    select * into v_resolution from public.master_contract_price_resolutions
    where delivery_product_id = p_delivery_product_id and resolution_revision = v_operation.result_revision;
    return jsonb_build_object('replay', true, 'resolutionId', v_resolution.id,
      'resolutionRevision', v_resolution.resolution_revision, 'status', v_resolution.status,
      'positionSide', v_resolution.position_side, 'positionDays', v_resolution.position_days);
  end if;

  select * into v_contract from public.master_contracts where id = p_contract_id for update;
  if not found then raise exception 'The Master Contract is unavailable.' using errcode = 'P0002'; end if;
  if v_contract.current_revision <> p_expected_revision then
    raise exception 'The Master Contract changed after it was opened. Refresh before resolving prices.' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.master_contract_delivery_products dp
    join public.master_contract_deliveries d on d.id = dp.delivery_id
    where dp.id = p_delivery_product_id and d.contract_id = p_contract_id and dp.active and d.active
  ) then raise exception 'The delivery product is not part of this active Master Contract.' using errcode = '23514'; end if;

  select coalesce(max(resolution_revision), 0) + 1 into v_resolution_revision
  from public.master_contract_price_resolutions where delivery_product_id = p_delivery_product_id;

  update public.master_contract_price_resolutions
  set status = 'superseded'
  where delivery_product_id = p_delivery_product_id
    and status in ('review_required', 'reviewed', 'conflict');

  insert into public.master_contract_price_resolutions (
    delivery_product_id, resolution_revision, benchmark_date, benchmark_code, benchmark_unit,
    benchmark_value, conversion_factor, buy_unrounded, sell_unrounded, buy_rounded, sell_rounded,
    evidence_hash, official_observation_id, alternate_publication_reason, status, reviewed_by,
    reviewed_at, applied_at, supplier_benchmark_date, buyer_benchmark_date,
    supplier_benchmark_value, buyer_benchmark_value, supplier_official_observation_id,
    buyer_official_observation_id, position_side, position_days
  ) values (
    p_delivery_product_id, v_resolution_revision, p_supplier_benchmark_date, p_benchmark_code, p_benchmark_unit,
    p_supplier_benchmark_value, p_conversion_factor, p_buy_unrounded, p_sell_unrounded, p_buy_rounded, p_sell_rounded,
    lower(btrim(p_evidence_hash)), p_supplier_official_observation_id, coalesce(p_alternate_publication_reason, ''),
    p_status, p_actor_user_id, case when p_status in ('reviewed', 'applied') then clock_timestamp() else null end,
    case when p_status = 'applied' then clock_timestamp() else null end,
    p_supplier_benchmark_date, p_buyer_benchmark_date, p_supplier_benchmark_value,
    p_buyer_benchmark_value, p_supplier_official_observation_id, p_buyer_official_observation_id,
    p_position_side, p_position_days
  ) returning * into v_resolution;

  update public.master_contract_delivery_products set price_status = p_status, updated_at = clock_timestamp()
  where id = p_delivery_product_id;
  insert into public.master_contract_operations (
    contract_id, idempotency_key, operation, request_hash, result_revision, actor_user_id
  ) values (
    p_contract_id, btrim(p_idempotency_key), v_operation_name, lower(btrim(p_request_hash)),
    v_resolution_revision, p_actor_user_id
  );
  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    'master_contract_split_pricing_recorded',
    jsonb_build_object('contract_id', p_contract_id, 'delivery_product_id', p_delivery_product_id,
      'resolution_revision', v_resolution_revision, 'status', p_status,
      'supplier_benchmark_date', p_supplier_benchmark_date, 'buyer_benchmark_date', p_buyer_benchmark_date,
      'position_side', p_position_side, 'position_days', p_position_days,
      'evidence_hash', lower(btrim(p_evidence_hash)),
      'alternate_reason_recorded', nullif(btrim(coalesce(p_alternate_publication_reason, '')), '') is not null)
  );
  return jsonb_build_object('replay', false, 'resolutionId', v_resolution.id,
    'resolutionRevision', v_resolution.resolution_revision, 'status', v_resolution.status,
    'positionSide', v_resolution.position_side, 'positionDays', v_resolution.position_days);
end;
$$;

revoke all on function public.save_master_contract_price_resolution_v2(uuid, bigint, uuid, date, date, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, text, integer, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_master_contract_price_resolution_v2(uuid, bigint, uuid, date, date, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, text, integer, text, text, uuid, text, text, text) to service_role;
