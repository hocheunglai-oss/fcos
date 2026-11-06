-- Controller-only initial setup, deliberately outside application migrations.
-- Derived from release_coordination.sql and the N12 control postimage. No public/financial tables.
create table fcos_release_coordination.rapid_handover_receipts (
 receipt_id bigint generated always as identity unique,
 handover_id text not null check(handover_id ~ '^[a-z0-9-]{8,96}$'),
 phase text not null check(phase in ('prepared','aborted','finalized')),
 plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(handover_id,phase)
);
alter table fcos_release_coordination.rapid_handover_receipts owner to fcos_coordinator_owner;
alter table fcos_release_coordination.rapid_handover_receipts enable row level security;
revoke all on fcos_release_coordination.rapid_handover_receipts from public,anon,authenticated,service_role,fcos_coordinator_runtime;
grant select,insert on fcos_release_coordination.rapid_handover_receipts to postgres;
create trigger rapid_handover_append_only before update or delete or truncate
 on fcos_release_coordination.rapid_handover_receipts for each statement execute function fcos_release_coordination.reject_mutation();
create function fcos_release_coordination.rapid_handover_control_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare held boolean;
begin
 select exists(select 1 from fcos_release_coordination.rapid_handover_receipts p where p.phase='finalized' or p.phase='prepared'
  and not exists(select 1 from fcos_release_coordination.rapid_handover_receipts a where a.handover_id=p.handover_id and a.phase='aborted')) into held;
 if held then
  if tg_op='UPDATE' then
   -- Preparation permits exactly freezing the original qualification row; finalized stays frozen.
   if new.mode='frozen' and (to_jsonb(new)-'mode')=(to_jsonb(old)-'mode') then return new;end if;
  end if;
  raise exception 'RAPID_HANDOVER_OLD_WRITER_PERMANENTLY_FENCED';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
alter function fcos_release_coordination.rapid_handover_control_guard() owner to fcos_coordinator_owner;
revoke all on function fcos_release_coordination.rapid_handover_control_guard() from public,anon,authenticated,service_role,fcos_coordinator_runtime;
create trigger rapid_handover_control_guard before insert or update or delete
 on fcos_release_coordination.control for each row execute function fcos_release_coordination.rapid_handover_control_guard();
create trigger rapid_handover_control_no_truncate before truncate
 on fcos_release_coordination.control for each statement execute function fcos_release_coordination.rapid_handover_control_guard();
