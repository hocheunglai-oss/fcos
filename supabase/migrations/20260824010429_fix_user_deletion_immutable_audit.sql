-- Variable Charges events are immutable audit evidence. The original
-- actor_user_id foreign key used ON DELETE SET NULL, which asks Postgres to
-- update those immutable rows whenever an FCOS user is deleted. Preserve the
-- recorded actor UUID and email as historical attribution instead.
alter table public.variable_charge_events
  drop constraint if exists ship_agent_charge_events_actor_user_id_fkey;

-- Defensive compatibility for databases where the constraint was recreated
-- after the table was renamed.
alter table public.variable_charge_events
  drop constraint if exists variable_charge_events_actor_user_id_fkey;

comment on column public.variable_charge_events.actor_user_id is
  'Immutable historical FCOS actor UUID. Deliberately not a live user_profiles foreign key; actor_email and the UUID remain unchanged after user deletion.';
