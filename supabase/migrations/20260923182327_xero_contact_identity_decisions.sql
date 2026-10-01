create table public.xero_contact_identity_decisions (
  tenant_id uuid not null,
  contact_id uuid not null,
  decision text not null check (decision in ('verified_xero_only', 'revoked')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  evidence_note text not null check (length(btrim(evidence_note)) between 15 and 2000),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 500),
  revision integer not null default 1 check (revision > 0),
  actor_id uuid not null,
  actor_email text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, contact_id)
);
create table public.xero_contact_identity_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  contact_id uuid not null,
  before_decision jsonb,
  after_decision jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.xero_contact_identity_decisions enable row level security;
alter table public.xero_contact_identity_audit enable row level security;
revoke all on table public.xero_contact_identity_decisions, public.xero_contact_identity_audit from public, anon, authenticated, service_role;
revoke all on sequence public.xero_contact_identity_audit_id_seq from public, anon, authenticated, service_role;
grant select, insert, update on public.xero_contact_identity_decisions to service_role;
grant select, insert on public.xero_contact_identity_audit to service_role;
grant usage, select on sequence public.xero_contact_identity_audit_id_seq to service_role;

create function public.audit_xero_contact_identity_v1() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.xero_contact_identity_audit(tenant_id,contact_id,before_decision,after_decision)
  values(new.tenant_id,new.contact_id,case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end;
$$;
create trigger xero_contact_identity_audit after insert or update on public.xero_contact_identity_decisions
for each row execute function public.audit_xero_contact_identity_v1();
revoke all on function public.audit_xero_contact_identity_v1() from public, anon, authenticated;
grant execute on function public.audit_xero_contact_identity_v1() to service_role;

create function public.save_xero_contact_identity_v1(
  p_tenant_id uuid, p_contact_id uuid, p_decision text, p_fingerprint text,
  p_evidence_note text, p_evidence_reference text, p_expected_revision integer,
  p_actor_id uuid, p_actor_email text
) returns public.xero_contact_identity_decisions
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.xero_contact_identity_decisions;
begin
  if p_actor_id is null or nullif(btrim(p_actor_email),'') is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'A verified actor and revision are required' using errcode='22023';
  end if;
  if p_expected_revision=0 then
    insert into public.xero_contact_identity_decisions(tenant_id,contact_id,decision,fingerprint,evidence_note,evidence_reference,actor_id,actor_email)
    values(p_tenant_id,p_contact_id,p_decision,p_fingerprint,btrim(p_evidence_note),btrim(p_evidence_reference),p_actor_id,lower(btrim(p_actor_email)))
    on conflict do nothing returning * into v_row;
  else
    update public.xero_contact_identity_decisions set decision=p_decision,fingerprint=p_fingerprint,
      evidence_note=btrim(p_evidence_note),evidence_reference=btrim(p_evidence_reference),
      actor_id=p_actor_id,actor_email=lower(btrim(p_actor_email)),revision=revision+1,updated_at=now()
    where tenant_id=p_tenant_id and contact_id=p_contact_id and revision=p_expected_revision returning * into v_row;
  end if;
  if v_row.contact_id is null then
    raise exception 'Contact identity decision changed; reload before saving' using errcode='40001';
  end if;
  return v_row;
end;
$$;
revoke all on function public.save_xero_contact_identity_v1(uuid,uuid,text,text,text,text,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.save_xero_contact_identity_v1(uuid,uuid,text,text,text,text,integer,uuid,text) to service_role;
