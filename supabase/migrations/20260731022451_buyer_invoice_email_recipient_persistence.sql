update public.buyer_invoice_email_settings
set
  settings = replace(
    settings::text,
    'lousia@cosulich.com.hk',
    'louisa@cosulich.com.hk'
  )::jsonb,
  updated_at = now()
where settings::text ilike '%lousia@cosulich.com.hk%';

create or replace function public.merge_buyer_invoice_email_settings(
  p_settings_patch jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns public.buyer_invoice_email_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  merged_row public.buyer_invoice_email_settings;
begin
  if p_settings_patch is null
     or jsonb_typeof(p_settings_patch) <> 'object'
     or p_settings_patch = '{}'::jsonb then
    raise exception 'A non-empty settings patch is required';
  end if;

  insert into public.buyer_invoice_email_settings (
    id,
    settings,
    updated_by,
    updated_by_email,
    updated_at
  )
  values (
    'default',
    p_settings_patch,
    p_actor_id,
    nullif(trim(p_actor_email), ''),
    now()
  )
  on conflict (id) do update
  set
    settings = public.buyer_invoice_email_settings.settings || excluded.settings,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into merged_row;

  return merged_row;
end;
$$;

revoke all on function public.merge_buyer_invoice_email_settings(jsonb, uuid, text)
from public, anon, authenticated;

grant execute on function public.merge_buyer_invoice_email_settings(jsonb, uuid, text)
to service_role;
