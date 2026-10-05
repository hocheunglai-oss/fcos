begin;

alter table public.dashboard_ai_settings drop constraint dashboard_ai_settings_model_id_check;
alter table public.dashboard_ai_settings add constraint dashboard_ai_settings_model_id_check
  check (model_id in ('auto', 'gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07',
    'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'));
alter table public.dashboard_ai_settings alter column model_id set default 'auto';

-- Opt untouched installation defaults into task routing. Preserve every
-- administrator-edited selection and its existing audit/revision controls.
update public.dashboard_ai_settings set model_id = 'auto', revision = revision + 1, updated_at = now()
where model_id = 'gpt-5-mini-2025-08-07' and revision = 1 and updated_by is null;

update public.hedge_settings set value = '"auto"'::jsonb
where key = 'assistant_model' and value = '"gpt-5-mini-2025-08-07"'::jsonb and revision = 1;

update emailrouter.settings set value = '{"modelId":"auto"}'::jsonb, revision = revision + 1, updated_at = now()
where key = 'advisor.model' and value = '{"modelId":"gpt-5-mini-2025-08-07"}'::jsonb and revision = 1;

alter table public.dashboard_ai_usage_events drop constraint dashboard_ai_usage_events_model_id_check;
alter table public.dashboard_ai_usage_events add constraint dashboard_ai_usage_events_model_id_check
  check (model_id in ('gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07',
    'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'));

create or replace function public.dashboard_ai_usage_summary(p_month_start date)
returns table (
  model_id text,
  month_calls bigint,
  month_cost_usd numeric,
  month_input_tokens numeric,
  month_output_tokens numeric,
  all_time_calls bigint,
  all_time_cost_usd numeric,
  all_time_input_tokens numeric,
  all_time_output_tokens numeric,
  last_used_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with models(model_id) as (
    values
      ('gpt-4o-mini-2024-07-18'::text),
      ('gpt-5-mini-2025-08-07'::text),
      ('gpt-5.6-luna'::text),
      ('gpt-5.6-terra'::text),
      ('gpt-5.6-sol'::text),
      ('gpt-6-astra'::text)
  )
  select
    models.model_id,
    count(events.openai_response_id) filter (
      where (events.created_at at time zone 'Asia/Hong_Kong')::date >= p_month_start
        and (events.created_at at time zone 'Asia/Hong_Kong')::date
          < (p_month_start + interval '1 month')::date
    )::bigint as month_calls,
    coalesce(sum(events.estimated_cost_usd) filter (
      where (events.created_at at time zone 'Asia/Hong_Kong')::date >= p_month_start
        and (events.created_at at time zone 'Asia/Hong_Kong')::date
          < (p_month_start + interval '1 month')::date
    ), 0)::numeric as month_cost_usd,
    coalesce(sum(events.input_tokens) filter (
      where (events.created_at at time zone 'Asia/Hong_Kong')::date >= p_month_start
        and (events.created_at at time zone 'Asia/Hong_Kong')::date
          < (p_month_start + interval '1 month')::date
    ), 0)::numeric as month_input_tokens,
    coalesce(sum(events.output_tokens) filter (
      where (events.created_at at time zone 'Asia/Hong_Kong')::date >= p_month_start
        and (events.created_at at time zone 'Asia/Hong_Kong')::date
          < (p_month_start + interval '1 month')::date
    ), 0)::numeric as month_output_tokens,
    count(events.openai_response_id)::bigint as all_time_calls,
    coalesce(sum(events.estimated_cost_usd), 0)::numeric as all_time_cost_usd,
    coalesce(sum(events.input_tokens), 0)::numeric as all_time_input_tokens,
    coalesce(sum(events.output_tokens), 0)::numeric as all_time_output_tokens,
    max(events.created_at) as last_used_at
  from models
  left join public.dashboard_ai_usage_events as events
    on events.model_id = models.model_id
  group by models.model_id
  order by models.model_id;
$$;


-- Existing server-only grants and RLS remain in force. No new grants or RPCs.
commit;
