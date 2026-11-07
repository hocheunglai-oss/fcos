-- One-time controller Preview bootstrap only; no application/financial objects.
-- CREATE deliberately refuses any pre-existing object instead of replacing it.
create table fcos_release_coordination.rapid_bootstrap_receipts (
 receipt_id bigint generated always as identity primary key,
 operation_id text not null check(operation_id ~ '^fcos-bootstrap-[a-f0-9-]{36}$'),
 phase text not null unique check(phase in ('claimed','vercel_intent','vercel_observed','preview_qualified')),
 plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'),
 controller_sha text not null check(controller_sha ~ '^[a-f0-9]{40}$'),
 evidence jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table fcos_release_coordination.rapid_bootstrap_receipts owner to fcos_coordinator_owner;
alter table fcos_release_coordination.rapid_bootstrap_receipts enable row level security;
revoke all on fcos_release_coordination.rapid_bootstrap_receipts from public,anon,authenticated,service_role,fcos_coordinator_runtime;
grant select,insert on fcos_release_coordination.rapid_bootstrap_receipts to postgres;
grant usage,select on sequence fcos_release_coordination.rapid_bootstrap_receipts_receipt_id_seq to postgres;
create function fcos_release_coordination.rapid_bootstrap_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
begin
 if tg_table_name='rapid_bootstrap_receipts' then raise exception 'BOOTSTRAP_APPEND_ONLY';end if;
 if exists(select 1 from fcos_release_coordination.rapid_bootstrap_receipts where phase='claimed') then
  if tg_op='UPDATE' then
   if new.mode='frozen' and (to_jsonb(new)-'mode')=(to_jsonb(old)-'mode') then return new;end if;
  end if;
  raise exception 'BOOTSTRAP_OLD_WRITER_FENCED';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
alter function fcos_release_coordination.rapid_bootstrap_guard() owner to fcos_coordinator_owner;
revoke all on function fcos_release_coordination.rapid_bootstrap_guard() from public,anon,authenticated,service_role,fcos_coordinator_runtime;
create trigger rapid_bootstrap_append_only before update or delete or truncate
 on fcos_release_coordination.rapid_bootstrap_receipts for each statement execute function fcos_release_coordination.rapid_bootstrap_guard();
create trigger rapid_bootstrap_control_guard before insert or update or delete
 on fcos_release_coordination.control for each row execute function fcos_release_coordination.rapid_bootstrap_guard();
create trigger rapid_bootstrap_no_truncate before truncate
 on fcos_release_coordination.control for each statement execute function fcos_release_coordination.rapid_bootstrap_guard();
