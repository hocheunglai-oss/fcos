-- The old row is the serialized database state. A higher revision can be
-- prepared before a concurrent disable commits, so its incoming timestamp
-- must never lower the revocation floor observed under the row update lock.
create or replace function public.fcos_protect_external_identity_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.revision < old.revision then
    raise exception 'FCUNO identity revision cannot move backwards.';
  end if;
  if new.credential_revision < old.credential_revision then
    raise exception 'FCUNO credential revision cannot move backwards.';
  end if;
  if old.auth_user_id is not null and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'A linked FCOS authentication identity cannot be rebound.';
  end if;
  new.revoked_before := greatest(new.revoked_before, old.revoked_before);
  if new.revision = old.revision and row(
    new.source_active, new.use_fcos, new.use_spc, new.credential_revision,
    new.email, new.email_verified, new.username, new.full_name,
    new.source_updated_at, new.revoked_before
  ) is distinct from row(
    old.source_active, old.use_fcos, old.use_spc, old.credential_revision,
    old.email, old.email_verified, old.username, old.full_name,
    old.source_updated_at, old.revoked_before
  ) then
    raise exception 'A synchronized FCUNO identity revision is immutable.';
  end if;
  return new;
end;
$$;
revoke all on function public.fcos_protect_external_identity_revision() from public, anon, authenticated;
grant execute on function public.fcos_protect_external_identity_revision() to service_role;
