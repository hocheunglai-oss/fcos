begin;

create or replace function public.load_work_notification_snapshot(
  p_user_id uuid,
  p_query_limit integer default 200,
  p_now timestamptz default now(),
  p_system_window timestamptz default (now() - interval '30 days')
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $function$
  with limits as (
    select greatest(10, least(coalesce(p_query_limit, 200), 400))::integer as row_limit
  )
  select jsonb_build_object(
    'collaboration', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from (
        select id, item_id, notification_type, title, message, read_at, handled_at, snoozed_until, created_at
        from public.collaboration_notifications
        where user_id = p_user_id
        order by created_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'growth', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from (
        select id, source_type, source_id, notification_type, title, message, link, read_at, handled_at, snoozed_until, created_at
        from public.growth_notifications
        where user_id = p_user_id
        order by created_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'improvements', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from (
        select id, ticket_id, notification_type, title, message, read_at, handled_at, snoozed_until, created_at
        from public.fcos_improvement_notifications
        where user_id = p_user_id
        order by created_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'collaborationUnread', (
      select count(*)
      from public.collaboration_notifications
      where user_id = p_user_id
        and read_at is null
        and handled_at is null
        and (snoozed_until is null or snoozed_until <= p_now)
    ),
    'growthUnread', (
      select count(*)
      from public.growth_notifications
      where user_id = p_user_id
        and read_at is null
        and handled_at is null
        and (snoozed_until is null or snoozed_until <= p_now)
    ),
    'improvementsUnread', (
      select count(*)
      from public.fcos_improvement_notifications
      where user_id = p_user_id
        and read_at is null
        and handled_at is null
        and (snoozed_until is null or snoozed_until <= p_now)
    ),
    'emailRouterAlerts', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from (
        select id, alert_code, severity, state, created_at
        from emailrouter.alerts
        where state in ('open', 'acknowledged')
        order by created_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'emailRouterStates', coalesce((
      select jsonb_agg(to_jsonb(item))
      from (
        select alert_id, read_at, handled_at, snoozed_until
        from emailrouter.alert_notification_states
        where user_id = p_user_id
      ) item
    ), '[]'::jsonb),
    'systemEvents', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.last_seen_at desc)
      from (
        select id, dedupe_key, handler, title, message, link, occurrence_count, last_request_id, created_at, last_seen_at
        from public.system_error_events
        where last_seen_at >= p_system_window
        order by last_seen_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'systemStates', coalesce((
      select jsonb_agg(to_jsonb(item))
      from (
        select event_id, read_at, handled_at, snoozed_until
        from public.system_error_notification_states
        where user_id = p_user_id
      ) item
    ), '[]'::jsonb),
    'variableChargeCases', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.updated_at desc)
      from (
        select id, stem_id, stem_name, workflow_status, assigned_buyer_user_id, revision, due_date, updated_at
        from public.variable_charge_cases
        where workflow_status in ('needs_action', 'ready_for_invoice', 'post_invoice_change')
        order by updated_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'variableChargeSupplierStages', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.updated_at desc)
      from (
        select
          stage.id,
          stage.case_id,
          stage.stem_id,
          stage.supplier_account_id,
          stage.status,
          stage.revision,
          stage.updated_at,
          jsonb_build_object('stem_name', charge_case.stem_name, 'due_date', charge_case.due_date) as variable_charge_cases
        from public.variable_charge_supplier_stages stage
        left join public.variable_charge_cases charge_case on charge_case.id = stage.case_id
        where stage.assigned_supplier_user_id = p_user_id
          and stage.status in ('pending', 'invalidated')
        order by stage.updated_at desc
        limit (select row_limit from limits)
      ) item
    ), '[]'::jsonb),
    'variableChargeStates', coalesce((
      select jsonb_agg(to_jsonb(item))
      from (
        select notification_key, case_id, read_at, handled_at, snoozed_until
        from public.variable_charge_notification_states
        where user_id = p_user_id
      ) item
    ), '[]'::jsonb),
    'generalManagerRoles', coalesce((
      select jsonb_agg(to_jsonb(item))
      from (
        select user_id
        from public.collaboration_roles
        where role = 'general_manager' and active = true
      ) item
    ), '[]'::jsonb),
    'specialTermsStates', coalesce((
      select jsonb_agg(to_jsonb(item))
      from (
        select notification_key, read_at, handled_at, snoozed_until
        from public.special_terms_notification_states
        where user_id = p_user_id
      ) item
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.load_work_notification_snapshot(uuid, integer, timestamptz, timestamptz) from public;
revoke all on function public.load_work_notification_snapshot(uuid, integer, timestamptz, timestamptz) from anon;
revoke all on function public.load_work_notification_snapshot(uuid, integer, timestamptz, timestamptz) from authenticated;
grant execute on function public.load_work_notification_snapshot(uuid, integer, timestamptz, timestamptz) to service_role;

comment on function public.load_work_notification_snapshot(uuid, integer, timestamptz, timestamptz)
is 'Returns the service-only FCOS notification database snapshot in one request. Contractual and financial source records are not copied.';

commit;
