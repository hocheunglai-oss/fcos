begin;

alter table public.hedge_mops_month_verifications
  add column if not exists source_message text;

alter table public.hedge_mops_month_verifications
  drop constraint if exists hedge_mops_month_verifications_source_message_check;
alter table public.hedge_mops_month_verifications
  add constraint hedge_mops_month_verifications_source_message_check
  check (source_message is null or (length(btrim(source_message)) > 0 and length(source_message) <= 50000));

comment on table public.hedge_mops_month_verifications is
  'One manually attested final MOPS monthly-average verification per contract month.';
comment on column public.hedge_mops_month_verifications.source_message is
  'The manually verified third-party text, stored as supplied without parsing or value comparison. Null only for historical verifications created before this field existed.';
comment on column public.hedge_mops_month_verifications.source_message_hash is
  'SHA-256 integrity hash of the stored manual verification text.';

drop function if exists public.verify_mops_month_with_audit(text, bigint, jsonb, jsonb, text, text, uuid, text);

create function public.verify_mops_month_with_audit(
  p_contract_month text,
  p_expected_revision bigint,
  p_calculated_snapshot jsonb,
  p_source_snapshot jsonb,
  p_source_message text,
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
  v_source_message text := btrim(coalesce(p_source_message, ''));
begin
  if p_contract_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or jsonb_typeof(p_calculated_snapshot) <> 'object'
     or jsonb_typeof(p_source_snapshot) <> 'object'
     or v_source_message = ''
     or length(v_source_message) > 50000
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
      contract_month, calculated_snapshot, source_snapshot, source_message,
      input_fingerprint, source_message_hash, verified_at, verified_by_id, verified_by_email
    ) values (
      p_contract_month, p_calculated_snapshot, p_source_snapshot, v_source_message,
      p_input_fingerprint, p_source_hash, clock_timestamp(), p_actor_user_id, v_email
    ) returning * into v_after;
  else
    if v_before.revision <> p_expected_revision then
      raise exception 'Monthly MOPS verification revision conflict.' using errcode = '40001';
    end if;
    update public.hedge_mops_month_verifications
    set calculated_snapshot = p_calculated_snapshot,
        source_snapshot = p_source_snapshot,
        source_message = v_source_message,
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
    'Manual final MOPS monthly-average verification saved.',
    case when v_before.id is null then null else to_jsonb(v_before) - 'source_message' end,
    to_jsonb(v_after) - 'source_message',
    jsonb_build_object('contractMonth', p_contract_month, 'verificationMode', 'manual_attestation'),
    p_actor_user_id,
    v_email,
    'fcos'
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function public.verify_mops_month_with_audit(text, bigint, jsonb, jsonb, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_mops_month_with_audit(text, bigint, jsonb, jsonb, text, text, text, uuid, text)
  to service_role;

commit;
