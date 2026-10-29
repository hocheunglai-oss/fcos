-- Restrict approval writes to the chosen rows and any prior eligible selection.
-- Unselected eligible rows retain their timestamps and avoid unnecessary rewrites.
-- Revision checks, eligibility validation and approval audit remain atomic.

create or replace function public.authorise_xero_financial_sync_run_v1(
  p_run_id uuid,
  p_expected_revision integer,
  p_selected_item_ids uuid[],
  p_actor_id uuid,
  p_actor_email text
)
returns public.xero_financial_sync_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.xero_financial_sync_runs;
begin
  if coalesce(array_length(p_selected_item_ids, 1), 0) = 0 then
    raise exception 'At least one eligible row must be selected' using errcode = '22023';
  end if;

  update public.xero_financial_sync_runs set
    status = 'authorised',
    reviewed_by = p_actor_id,
    reviewed_by_email = lower(nullif(btrim(p_actor_email), '')),
    reviewed_at = now(),
    revision = revision + 1,
    updated_at = now()
  where id = p_run_id
    and revision = p_expected_revision
    and status = 'ready_for_review'
  returning * into v_run;

  if v_run.id is null then
    raise exception 'Xero sync preview changed after it was loaded' using errcode = '40001';
  end if;

  if exists (
    select 1 from unnest(p_selected_item_ids) selected_id
    left join public.xero_financial_sync_items item
      on item.id = selected_id and item.run_id = p_run_id
    where item.id is null or item.status <> 'eligible'
  ) then
    raise exception 'Selection contains a missing or ineligible row' using errcode = '22023';
  end if;

  update public.xero_financial_sync_items
  set selected = id = any(p_selected_item_ids),
      status = case when id = any(p_selected_item_ids) then 'selected' else status end,
      updated_at = now()
  where run_id = p_run_id
    and status = 'eligible'
    and (id = any(p_selected_item_ids) or selected);

  insert into public.xero_financial_audit_events (
    run_id, event_type, outcome, actor_id, actor_email, record_counts
  ) values (
    p_run_id, 'run_authorised', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('selected', array_length(p_selected_item_ids, 1))
  );

  return v_run;
end;
$$;

revoke all on function public.authorise_xero_financial_sync_run_v1(uuid,integer,uuid[],uuid,text) from public, anon, authenticated;
grant execute on function public.authorise_xero_financial_sync_run_v1(uuid,integer,uuid[],uuid,text) to service_role;
