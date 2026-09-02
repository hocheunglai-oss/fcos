create table if not exists public.dashboard_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  openai_response_id text not null unique,
  model_id text not null check (
    model_id in (
      'gpt-4o-mini-2024-07-18',
      'gpt-5-mini-2025-08-07',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-sol'
    )
  ),
  service_tier text not null default 'default',
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cache_write_input_tokens bigint not null default 0 check (cache_write_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  estimated_cost_usd numeric(18, 12) not null default 0 check (estimated_cost_usd >= 0),
  pricing_as_of date not null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dashboard_ai_usage_input_breakdown_check check (
    cached_input_tokens + cache_write_input_tokens <= input_tokens
  ),
  constraint dashboard_ai_usage_reasoning_check check (
    reasoning_tokens <= output_tokens
  )
);

create index if not exists dashboard_ai_usage_events_model_created_idx
  on public.dashboard_ai_usage_events (model_id, created_at desc);

alter table public.dashboard_ai_usage_events enable row level security;

revoke all on table public.dashboard_ai_usage_events from public, anon, authenticated;
grant all on table public.dashboard_ai_usage_events to service_role;

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
      ('gpt-5.6-sol'::text)
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

revoke all on function public.dashboard_ai_usage_summary(date) from public, anon, authenticated;
grant execute on function public.dashboard_ai_usage_summary(date) to service_role;
