do $$
begin
  if not exists (
    select 1 from public.app_modules
    where id = 'outlook_nomination_filing' and path = '/outlook-nomination-filing'
  ) or to_regclass('public.fcos_nomination_filing_grants') is null then
    raise exception 'Outlook filing access requires the verified disabled ledger.';
  end if;

  insert into public.permission_access_catalog (id, kind)
  values ('outlook_nomination_filing', 'module');
end $$;
