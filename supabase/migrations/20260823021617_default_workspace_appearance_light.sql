begin;

alter table public.user_navigation_preferences
  alter column appearance_mode set default 'light';

with changed_preferences as (
  update public.user_navigation_preferences
  set
    appearance_mode = 'light',
    revision = revision + 1,
    updated_by = null,
    updated_at = clock_timestamp()
  where appearance_mode is distinct from 'light'
  returning user_id, revision
)
insert into public.workspace_preference_events (
  user_id,
  actor_user_id,
  event_type,
  changed_fields,
  resulting_revision
)
select
  user_id,
  null,
  'preferences_updated',
  array['appearance_mode']::text[],
  revision
from changed_preferences;

commit;
