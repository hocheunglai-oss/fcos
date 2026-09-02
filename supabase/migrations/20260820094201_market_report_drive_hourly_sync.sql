begin;

alter table public.market_report_imports
  add column if not exists source_md5 text,
  add column if not exists drive_file_id text,
  add column if not exists drive_modified_at timestamptz;

alter table public.market_report_imports
  drop constraint if exists market_report_imports_source_md5_check;
alter table public.market_report_imports
  add constraint market_report_imports_source_md5_check
  check (source_md5 is null or source_md5 ~ '^[a-f0-9]{32}$');

create unique index if not exists market_report_imports_source_md5_unique
  on public.market_report_imports (source_document_type, source_md5)
  where source_md5 is not null;
create index if not exists market_report_imports_drive_file_idx
  on public.market_report_imports (drive_file_id, drive_modified_at desc)
  where drive_file_id is not null;

create table if not exists public.market_report_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  deferred_count integer not null default 0 check (deferred_count >= 0),
  error_code text,
  revision bigint not null default 1,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.market_report_sync_runs enable row level security;
revoke all on table public.market_report_sync_runs from public, anon, authenticated;
grant all on table public.market_report_sync_runs to service_role;

create index if not exists market_report_sync_runs_recent_idx
  on public.market_report_sync_runs (started_at desc);

create trigger market_report_sync_runs_touch
before update on public.market_report_sync_runs
for each row execute function public.touch_market_intelligence_row();

create or replace function public.reserve_market_report_sync_run(p_run_key text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run public.market_report_sync_runs%rowtype;
begin
  if p_run_key !~ '^market-drive:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$' then
    raise exception 'INVALID_MARKET_SYNC_RUN_KEY';
  end if;

  insert into public.market_report_sync_runs (run_key)
  values (p_run_key)
  on conflict (run_key) do nothing
  returning * into v_run;

  if found then
    return jsonb_build_object('reserved', true, 'id', v_run.id, 'status', v_run.status);
  end if;

  select * into v_run
  from public.market_report_sync_runs
  where run_key = p_run_key;
  return jsonb_build_object('reserved', false, 'id', v_run.id, 'status', v_run.status);
end;
$$;

create or replace function public.finish_market_report_sync_run(
  p_run_key text,
  p_status text,
  p_discovered_count integer,
  p_skipped_count integer,
  p_imported_count integer,
  p_failed_count integer,
  p_deferred_count integer,
  p_error_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run public.market_report_sync_runs%rowtype;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'INVALID_MARKET_SYNC_STATUS';
  end if;
  if p_discovered_count is null
     or p_skipped_count is null
     or p_imported_count is null
     or p_failed_count is null
     or p_deferred_count is null
     or least(p_discovered_count, p_skipped_count, p_imported_count, p_failed_count, p_deferred_count) < 0 then
    raise exception 'INVALID_MARKET_SYNC_COUNTS';
  end if;
  if p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'INVALID_MARKET_SYNC_ERROR_CODE';
  end if;

  update public.market_report_sync_runs
  set status = p_status,
      discovered_count = p_discovered_count,
      skipped_count = p_skipped_count,
      imported_count = p_imported_count,
      failed_count = p_failed_count,
      deferred_count = p_deferred_count,
      error_code = p_error_code,
      completed_at = now()
  where run_key = p_run_key and status = 'running'
  returning * into v_run;

  if not found then
    raise exception 'MARKET_SYNC_RUN_NOT_RUNNING';
  end if;
  return jsonb_build_object(
    'id', v_run.id,
    'status', v_run.status,
    'discoveredCount', v_run.discovered_count,
    'skippedCount', v_run.skipped_count,
    'importedCount', v_run.imported_count,
    'failedCount', v_run.failed_count,
    'deferredCount', v_run.deferred_count
  );
end;
$$;

create or replace function public.save_market_drive_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_source_md5 text,
  p_drive_file_id text,
  p_drive_modified_at timestamptz,
  p_report_date date,
  p_observations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_import_id uuid;
begin
  if lower(coalesce(p_source_md5, '')) !~ '^[a-f0-9]{32}$' then
    raise exception 'INVALID_MARKET_SOURCE_MD5';
  end if;
  if coalesce(p_drive_file_id, '') !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'INVALID_MARKET_DRIVE_FILE_ID';
  end if;

  v_result := public.save_market_report_import(
    p_idempotency_key,
    p_source_document_type,
    p_source_hash,
    p_report_date,
    p_observations,
    null::uuid,
    'system@fcos.local'
  );
  v_import_id := (v_result->>'id')::uuid;

  update public.market_report_imports
  set source_md5 = lower(p_source_md5),
      drive_file_id = p_drive_file_id,
      drive_modified_at = p_drive_modified_at
  where id = v_import_id;

  return v_result || jsonb_build_object('driveRecorded', true);
end;
$$;

revoke all on function public.reserve_market_report_sync_run(text) from public, anon, authenticated;
revoke all on function public.finish_market_report_sync_run(text, text, integer, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.save_market_drive_report_import(text, text, text, text, text, timestamptz, date, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_market_report_sync_run(text) to service_role;
grant execute on function public.finish_market_report_sync_run(text, text, integer, integer, integer, integer, integer, text) to service_role;
grant execute on function public.save_market_drive_report_import(text, text, text, text, text, timestamptz, date, jsonb) to service_role;

commit;
