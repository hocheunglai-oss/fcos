create or replace function public.save_email_sender_routes_batch(
  p_changes jsonb,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_change jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_change_count integer;
  v_unique_count integer;
begin
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Email sender changes must be supplied as a list.';
  end if;

  v_change_count := jsonb_array_length(p_changes);
  if v_change_count < 1 or v_change_count > 20 then
    raise exception 'Select between 1 and 20 email sender assignments.';
  end if;

  select count(distinct value->>'purposeKey')
  into v_unique_count
  from jsonb_array_elements(p_changes);
  if v_unique_count <> v_change_count then
    raise exception 'Each email purpose may appear only once in a batch.';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_result := public.save_email_sender_route(
      v_change->>'purposeKey',
      nullif(v_change->>'mailboxId', '')::uuid,
      p_reason,
      p_actor_user_id,
      p_actor_email,
      nullif(v_change->>'expectedRevision', '')::bigint
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return v_results;
end;
$$;

revoke all on function public.save_email_sender_routes_batch(jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.save_email_sender_routes_batch(jsonb, text, uuid, text) to service_role;
