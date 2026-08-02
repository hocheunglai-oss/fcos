begin;

create table if not exists public.hedge_mops_month_verifications (
  id uuid primary key default gen_random_uuid(),
  contract_month text not null unique check (contract_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  calculated_snapshot jsonb not null check (jsonb_typeof(calculated_snapshot) = 'object'),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  source_message_hash text not null check (source_message_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null default now(),
  verified_by_id uuid references public.user_profiles(id) on delete set null,
  verified_by_email text not null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0)
);

drop trigger if exists hedge_mops_month_verifications_touch_revision on public.hedge_mops_month_verifications;
create trigger hedge_mops_month_verifications_touch_revision
before update on public.hedge_mops_month_verifications
for each row execute function public.hedge_touch_revision();

create index if not exists hedge_mops_month_verifications_verified_idx
  on public.hedge_mops_month_verifications(contract_month desc, verified_at desc);

alter table public.hedge_mops_month_verifications enable row level security;
revoke all on table public.hedge_mops_month_verifications from public, anon, authenticated;
grant all on table public.hedge_mops_month_verifications to service_role;

comment on table public.hedge_mops_month_verifications is
  'One server-validated third-party final MOPS monthly-average verification per contract month.';
comment on column public.hedge_mops_month_verifications.source_message_hash is
  'SHA-256 evidence hash. The pasted third-party message itself is not stored.';

create or replace function public.verify_mops_month_with_audit(
  p_contract_month text,
  p_expected_revision bigint,
  p_calculated_snapshot jsonb,
  p_source_snapshot jsonb,
  p_input_fingerprint text,
  p_source_hash text,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_before public.hedge_mops_month_verifications%rowtype;
  v_after public.hedge_mops_month_verifications%rowtype;
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
begin
  if p_contract_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or jsonb_typeof(p_calculated_snapshot) <> 'object'
     or jsonb_typeof(p_source_snapshot) <> 'object'
     or p_input_fingerprint !~ '^[a-f0-9]{64}$'
     or p_source_hash !~ '^[a-f0-9]{64}$'
     or p_actor_user_id is null
     or v_email = '' then
    raise exception 'Invalid monthly MOPS verification payload.' using errcode = '22023';
  end if;

  select * into v_before
  from public.hedge_mops_month_verifications
  where contract_month = p_contract_month
  for update;

  if v_before.id is null then
    if p_expected_revision <> 0 then
      raise exception 'Monthly MOPS verification revision conflict.' using errcode = '40001';
    end if;
    insert into public.hedge_mops_month_verifications (
      contract_month, calculated_snapshot, source_snapshot, input_fingerprint,
      source_message_hash, verified_at, verified_by_id, verified_by_email
    ) values (
      p_contract_month, p_calculated_snapshot, p_source_snapshot, p_input_fingerprint,
      p_source_hash, clock_timestamp(), p_actor_user_id, v_email
    ) returning * into v_after;
  else
    if v_before.revision <> p_expected_revision then
      raise exception 'Monthly MOPS verification revision conflict.' using errcode = '40001';
    end if;
    update public.hedge_mops_month_verifications
    set calculated_snapshot = p_calculated_snapshot,
        source_snapshot = p_source_snapshot,
        input_fingerprint = p_input_fingerprint,
        source_message_hash = p_source_hash,
        verified_at = clock_timestamp(),
        verified_by_id = p_actor_user_id,
        verified_by_email = v_email
    where id = v_before.id
    returning * into v_after;
  end if;

  insert into public.hedge_events (
    event_type, entity_type, entity_id, label, before_data, after_data,
    metadata, actor_user_id, actor_email, source
  ) values (
    'mops_monthly_average_verified',
    'MopsMonthVerification',
    v_after.id,
    'Final MOPS monthly average verified against third-party message.',
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    jsonb_build_object('contractMonth', p_contract_month),
    p_actor_user_id,
    v_email,
    'fcos'
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function public.verify_mops_month_with_audit(text, bigint, jsonb, jsonb, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_mops_month_with_audit(text, bigint, jsonb, jsonb, text, text, uuid, text)
  to service_role;

commit;
