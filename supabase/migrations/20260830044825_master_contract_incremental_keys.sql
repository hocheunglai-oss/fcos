-- Concurrency-safe, human-readable keys for new Master Contracts and deliveries.
-- Existing keys remain immutable and continue to work unchanged.

begin;

create sequence if not exists public.master_contract_key_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no cycle;

create sequence if not exists public.master_contract_delivery_key_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no cycle;

do $migration$
declare
  v_contract_max bigint;
  v_contract_last bigint;
  v_contract_called boolean;
  v_delivery_max bigint;
  v_delivery_last bigint;
  v_delivery_called boolean;
  v_contract_next bigint;
  v_delivery_next bigint;
begin
  select coalesce(max((regexp_match(contract_key, '^Master_Contract_([0-9]+)$'))[1]::bigint), 0)
  into v_contract_max
  from public.master_contracts
  where contract_key ~ '^Master_Contract_[0-9]+$';

  select last_value, is_called
  into v_contract_last, v_contract_called
  from public.master_contract_key_seq;

  v_contract_next := greatest(
    v_contract_max + 1,
    case when v_contract_called then v_contract_last + 1 else v_contract_last end,
    1
  );
  perform setval('public.master_contract_key_seq', v_contract_next, false);

  select coalesce(max((regexp_match(delivery_key, '^Delivery_([0-9]+)$'))[1]::bigint), 0)
  into v_delivery_max
  from public.master_contract_deliveries
  where delivery_key ~ '^Delivery_[0-9]+$';

  select last_value, is_called
  into v_delivery_last, v_delivery_called
  from public.master_contract_delivery_key_seq;

  v_delivery_next := greatest(
    v_delivery_max + 1,
    case when v_delivery_called then v_delivery_last + 1 else v_delivery_last end,
    1
  );
  perform setval('public.master_contract_delivery_key_seq', v_delivery_next, false);
end;
$migration$;

alter table public.master_contracts
  drop constraint if exists master_contracts_contract_key_check;
alter table public.master_contracts
  add constraint master_contracts_contract_key_check
  check (contract_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$');

alter table public.master_contract_deliveries
  drop constraint if exists master_contract_deliveries_delivery_key_check;
alter table public.master_contract_deliveries
  add constraint master_contract_deliveries_delivery_key_check
  check (delivery_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,119}$');

-- The original snapshot RPC remains authoritative. Its key validation is
-- widened only enough to accept the governed mixed-case display format.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.save_master_contract_snapshot(uuid,text,text,bigint,jsonb,text,uuid,text,text,text,text)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    '^[A-Z0-9][A-Z0-9_-]{5,79}$',
    '^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$'
  );
  if v_updated = v_definition then
    raise exception 'The Master Contract snapshot key validation could not be upgraded safely.';
  end if;
  execute v_updated;
end;
$migration$;

create or replace function public.reserve_master_contract_keys(
  p_contract_count integer default 0,
  p_delivery_count integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract_keys jsonb := '[]'::jsonb;
  v_delivery_keys jsonb := '[]'::jsonb;
  v_index integer;
begin
  if p_contract_count not between 0 and 1
    or p_delivery_count not between 0 and 100 then
    raise exception 'An invalid Master Contract key reservation was requested.' using errcode = '22023';
  end if;

  if p_contract_count = 1 then
    v_contract_keys := jsonb_build_array(
      'Master_Contract_' || nextval('public.master_contract_key_seq')::text
    );
  end if;

  if p_delivery_count > 0 then
    for v_index in 1..p_delivery_count loop
      v_delivery_keys := v_delivery_keys || jsonb_build_array(
        'Delivery_' || nextval('public.master_contract_delivery_key_seq')::text
      );
    end loop;
  end if;

  return jsonb_build_object(
    'contractKeys', v_contract_keys,
    'deliveryKeys', v_delivery_keys
  );
end;
$$;

revoke all on sequence public.master_contract_key_seq from public, anon, authenticated;
revoke all on sequence public.master_contract_delivery_key_seq from public, anon, authenticated;
grant usage, select on sequence public.master_contract_key_seq to service_role;
grant usage, select on sequence public.master_contract_delivery_key_seq to service_role;

revoke all on function public.reserve_master_contract_keys(integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_master_contract_keys(integer, integer) to service_role;

commit;
