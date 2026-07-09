update public.app_modules
set
  label = 'Dispute Workflow',
  path = '/disputes-beta',
  updated_at = now()
where id = 'disputes';
