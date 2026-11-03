begin;

-- attempt_count is the fencing generation; updated_at is the database-issued
-- claim timestamp. No worker may publish after this six-minute lease expires. This exceeds the previous Vercel invocation
-- maximum (300s), so rollout recovery cannot overlap a legacy unfenced worker.
create index if not exists emailrouter_advisor_learning_jobs_processing_idx
  on emailrouter.advisor_learning_jobs (updated_at, created_at)
  where state = 'processing';

create or replace function public.claim_emailrouter_learning_job(p_mailbox_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  job emailrouter.advisor_learning_jobs%rowtype;
  action emailrouter.mail_actions%rowtype;
  message emailrouter.messages%rowtype;
  claimed_at timestamptz;
begin
  select j.* into job
  from emailrouter.advisor_learning_jobs j
  join emailrouter.mail_actions a on a.id = j.mail_action_id
  join emailrouter.messages m on m.id = a.message_id
  where m.mailbox_id = p_mailbox_id and a.state = 'confirmed'
    and a.action_type in ('redirect', 'forward')
    and (
      (j.state in ('pending', 'failed') and j.next_attempt_at <= clock_timestamp()
        and (j.attempt_count < 5 or j.state = 'pending'))
      or (j.state = 'processing' and j.updated_at <= clock_timestamp() - interval '6 minutes')
    )
  order by j.next_attempt_at, j.created_at, j.id
  limit 1 for update of j skip locked;
  if not found then return null; end if;

  if job.attempt_count >= 5 then
    update emailrouter.advisor_learning_jobs set state = 'failed',
      failure_code = 'email_router_learning_attempts_exhausted', updated_at = clock_timestamp()
    where id = job.id;
    update emailrouter.mail_actions set learning_state = 'failed' where id = job.mail_action_id;
    return jsonb_build_object('id', job.id, 'state', 'failed', 'exhausted', true);
  end if;

  claimed_at := clock_timestamp();
  update emailrouter.advisor_learning_jobs set state = 'processing',
    attempt_count = attempt_count + 1, updated_at = claimed_at,
    completed_at = null, failure_code = null
  where id = job.id returning * into job;
  select * into action from emailrouter.mail_actions where id = job.mail_action_id;
  select * into message from emailrouter.messages where id = action.message_id;
  return jsonb_build_object(
    'id', job.id, 'state', job.state, 'attempt_count', job.attempt_count,
    'updated_at', job.updated_at,
    'has_outcome', exists(select 1 from emailrouter.advisor_learning_outcomes where mail_action_id = action.id),
    'mail_actions', jsonb_build_object('id', action.id, 'message_id', action.message_id,
      'requested_by', action.requested_by,
      'messages', jsonb_build_object('provider_message_id', message.provider_message_id))
  );
end;
$$;

create or replace function public.finalize_emailrouter_learning_job(
  p_job_id uuid, p_attempt_count integer, p_claimed_at timestamptz,
  p_result jsonb default null, p_failure_code text default null
)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  job emailrouter.advisor_learning_jobs%rowtype;
  action emailrouter.mail_actions%rowtype;
  learned_outcome_id uuid;
  mailbox_id uuid;
  usage jsonb;
begin
  select * into job from emailrouter.advisor_learning_jobs where id = p_job_id for update;
  if not found then return false; end if;
  -- Retrying a successfully committed finalization is a read-only success.
  if job.state = 'completed' and job.attempt_count = p_attempt_count and p_failure_code is null then
    return true;
  end if;
  if job.state <> 'processing' or job.attempt_count is distinct from p_attempt_count
    or job.updated_at is distinct from p_claimed_at
    or job.updated_at <= clock_timestamp() - interval '6 minutes' then
    return false;
  end if;

  select * into action from emailrouter.mail_actions where id = job.mail_action_id for update;
  if action.state <> 'confirmed' or action.action_type not in ('redirect', 'forward') then
    raise exception 'EMAIL_ROUTER_LEARNING_ACTION_INVALID';
  end if;
  if p_failure_code is not null then
    update emailrouter.advisor_learning_jobs set state = 'failed', failure_code = p_failure_code,
      next_attempt_at = clock_timestamp() + make_interval(mins => least(1440, power(2, least(10, job.attempt_count))::integer)),
      updated_at = clock_timestamp()
    where id = job.id;
    update emailrouter.mail_actions set learning_state = 'failed' where id = action.id;
    return true;
  end if;

  select id into learned_outcome_id from emailrouter.advisor_learning_outcomes
    where mail_action_id = action.id for update;
  if learned_outcome_id is null then
    if p_result is null or jsonb_typeof(p_result) <> 'object'
      or coalesce(p_result->>'routing_category', '') not in (
        'market_report', 'price_quote', 'nomination', 'confirmation', 'invoice', 'payment',
        'settlement', 'operations', 'compliance', 'internal', 'general', 'other'
      ) then raise exception 'EMAIL_ROUTER_LEARNING_RESULT_INVALID'; end if;
    select m.mailbox_id into mailbox_id from emailrouter.messages m where m.id = action.message_id;
    insert into emailrouter.advisor_learning_outcomes (
      mail_action_id, mailbox_id, routing_category, sender_fingerprint, sender_domain_fingerprint,
      subject_token_fingerprints, attachment_profile, action_type, post_action_mode,
      post_action_folder_id, recipients_complete
    ) values (
      action.id, mailbox_id, p_result->>'routing_category', p_result->>'sender_fingerprint',
      p_result->>'sender_domain_fingerprint', p_result->'subject_token_fingerprints',
      p_result->>'attachment_profile', action.action_type, coalesce(action.post_action_mode, 'keep_current'),
      action.post_action_folder_id, coalesce(action.learning_recipients_complete, true)
    ) returning id into learned_outcome_id;

    usage := p_result->'usage';
    if usage is not null and jsonb_typeof(usage) = 'object' then
      insert into emailrouter.ai_usage_events (
        message_id, mail_action_id, actor_user_id, model_id, provider_request_id,
        input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, cost_usd, outcome
      ) values (
        action.message_id, action.id, action.requested_by, usage->>'model_id', usage->>'provider_request_id',
        (usage->>'input_tokens')::bigint, (usage->>'cached_input_tokens')::bigint,
        (usage->>'output_tokens')::bigint, (usage->>'reasoning_tokens')::bigint,
        (usage->>'total_tokens')::bigint, (usage->>'cost_usd')::numeric, 'success'
      );
    end if;
  end if;
  -- A legacy interrupted run may have stored the classification but only some
  -- recipients. Repair the full set atomically, preserving forgotten outcomes.
  delete from emailrouter.advisor_learning_outcome_destinations where outcome_id = learned_outcome_id;
  insert into emailrouter.advisor_learning_outcome_destinations (
    outcome_id, destination_id, group_id, recipient_kind, position
  ) select learned_outcome_id, d.destination_id, d.group_id, d.recipient_kind, d.position
    from emailrouter.mail_action_destinations d where d.mail_action_id = action.id;
  update emailrouter.advisor_learning_jobs set state = 'completed', completed_at = clock_timestamp(),
    failure_code = null, updated_at = clock_timestamp() where id = job.id;
  update emailrouter.mail_actions set learning_state = 'completed' where id = action.id;
  return true;
end;
$$;

revoke all on function public.claim_emailrouter_learning_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_emailrouter_learning_job(uuid) to service_role;
revoke all on function public.finalize_emailrouter_learning_job(uuid, integer, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.finalize_emailrouter_learning_job(uuid, integer, timestamptz, jsonb, text) to service_role;

notify pgrst, 'reload schema';
commit;
