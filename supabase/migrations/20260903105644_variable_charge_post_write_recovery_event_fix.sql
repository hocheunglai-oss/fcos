-- Record whether a confirmation completed through the narrowly validated
-- post-write recovery path. This is a redacted workflow boolean only.
create or replace function public.variable_charge_assert_event_metadata(p_metadata jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Variable Charges event metadata must be an object.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_metadata, '{}'::jsonb)) loop
    if v_key not in (
      'caseState', 'previousState', 'reasonProvided', 'evidencePresent',
      'chargeToBuyer', 'resolution', 'sourceChanged', 'assignmentChanged',
      'notificationState', 'operationStatus', 'side', 'supplierAccountId',
      'targetRole', 'combinedConfirmation', 'postWriteRecovery'
    ) then
      raise exception 'Variable Charges event metadata may contain only redacted workflow fields.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.variable_charge_assert_event_metadata(jsonb) from public, anon, authenticated;
grant execute on function public.variable_charge_assert_event_metadata(jsonb) to service_role;
