create table if not exists public.account_manager_notes (
  account_name_key text primary key
    check (account_name_key ~ '^[a-f0-9]{64}$'),
  account_name text not null
    check (btrim(account_name) <> ''),
  account_note text not null default ''
    check (char_length(account_note) <= 255),
  revision bigint not null default 1
    check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_manager_notes enable row level security;

revoke all on table public.account_manager_notes from public, anon, authenticated;
grant all on table public.account_manager_notes to service_role;

create or replace function public.save_account_manager_note(
  p_account_name_key text,
  p_account_name text,
  p_account_note text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_name_key text := lower(btrim(coalesce(p_account_name_key, '')));
  v_account_name text := btrim(coalesce(p_account_name, ''));
  v_account_note text := btrim(coalesce(p_account_note, ''));
  v_current public.account_manager_notes%rowtype;
  v_note public.account_manager_notes%rowtype;
  v_revision bigint := 1;
  v_now timestamptz := clock_timestamp();
begin
  if v_account_name_key !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid Account name key is required.';
  end if;
  if v_account_name = '' then
    raise exception 'Account name is required.';
  end if;
  if char_length(v_account_note) > 255 then
    raise exception 'Account note cannot exceed 255 characters.';
  end if;
  if not exists (
    select 1
    from public.user_profiles
    where id = p_actor_user_id
      and active = true
  ) then
    raise exception 'The note editor must be an active FCOS user.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-manager-note:' || v_account_name_key, 0));

  select * into v_current
  from public.account_manager_notes
  where account_name_key = v_account_name_key
  for update;

  if found then
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      raise exception 'This Account note changed after it was opened. Refresh and review the latest note before saving.';
    end if;
    v_revision := v_current.revision + 1;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'This Account note changed after it was opened. Refresh and review the latest note before saving.';
  end if;

  insert into public.account_manager_notes (
    account_name_key,
    account_name,
    account_note,
    revision,
    updated_by,
    updated_by_email,
    updated_at
  ) values (
    v_account_name_key,
    v_account_name,
    v_account_note,
    v_revision,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    v_now
  )
  on conflict (account_name_key) do update set
    account_name = excluded.account_name,
    account_note = excluded.account_note,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_note;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_manager_note_updated',
    jsonb_build_object(
      'account_name_key', v_account_name_key,
      'account_name', v_account_name,
      'previous_account_note', coalesce(v_current.account_note, ''),
      'account_note', v_account_note,
      'revision', v_revision
    )
  );

  return to_jsonb(v_note);
end;
$$;

revoke all on function public.save_account_manager_note(text, text, text, uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.save_account_manager_note(text, text, text, uuid, text, bigint)
to service_role;

notify pgrst, 'reload schema';
