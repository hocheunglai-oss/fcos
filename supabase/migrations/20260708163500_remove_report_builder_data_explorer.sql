delete from public.app_modules
where id in ('reports', 'explorer');

update public.app_modules
set
  label = 'Dashboard and Qlik Validator Tool',
  sort_order = 50,
  updated_at = now()
where id = 'pnl';
