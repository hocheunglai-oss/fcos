begin;

alter table public.user_navigation_preferences
  alter column sidebar_mode set default 'auto_hide';

with changed_preferences as (
  update public.user_navigation_preferences
  set
    sidebar_mode = 'auto_hide',
    revision = revision + 1,
    updated_by = null,
    updated_at = clock_timestamp()
  where sidebar_mode is distinct from 'auto_hide'
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
  array['sidebar_mode']::text[],
  revision
from changed_preferences;

commit;
