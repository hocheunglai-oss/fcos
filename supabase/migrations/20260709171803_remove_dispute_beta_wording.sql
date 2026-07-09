update public.app_modules
set
  label = 'Dispute Workflow',
  path = '/disputes',
  updated_at = now()
where id = 'disputes';
