begin;

-- Notification and My Commitments reads are user-scoped. The composite primary
-- key starts with notification_key, so it cannot efficiently serve this lookup.
create index if not exists special_terms_notification_states_user_idx
  on public.special_terms_notification_states (user_id);

commit;
