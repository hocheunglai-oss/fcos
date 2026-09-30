begin;
-- Freeze legacy authorization inputs until the snapshot, independent proof and
-- retired-writer guards commit together. Ordinary reads remain available.
lock table public.user_profiles,public.user_types,public.user_module_permissions,public.user_type_module_permissions in share row exclusive mode;
-- Separate permission groups from organizational role / FCUNO identity ownership.
create table public.permission_groups (
 id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'), label text not null check(length(btrim(label)) between 1 and 100),
 description text not null default '' check(length(description)<=1000), permissions jsonb not null default '{}', capabilities jsonb not null default '{}',
 is_system boolean not null default false, is_legacy boolean not null default false, sort_order integer not null default 100,
 revision bigint not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_permission_groups (
 user_id uuid not null references public.user_profiles(id) on delete cascade,
 group_id text not null references public.permission_groups(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(user_id,group_id)
);
create index user_permission_groups_group_idx on public.user_permission_groups(group_id,user_id);
alter table public.user_profiles add column access_revision bigint not null default 1 check(access_revision>0);
create table public.permission_access_events (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid references public.user_profiles(id) on delete set null, actor_email text not null,
 action text not null, target_id text not null, previous_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);
create index permission_access_events_created_idx on public.permission_access_events(created_at desc);
create table public.permission_access_migration_snapshots (
 user_id uuid primary key references public.user_profiles(id) on delete cascade, permissions jsonb not null, capabilities jsonb not null,
 previous_user_type text not null, previous_use_type_defaults boolean not null, created_at timestamptz not null default now()
);
create table public.permission_access_catalog (id text primary key, kind text not null check(kind in ('module','capability')));
insert into public.permission_access_catalog(id,kind) values ('dashboard','module'),('review','module'),('disputes','module'),('buyer_invoices','module'),('unofficial_compensation','module'),('incoming_payments','module'),('cashflow_forecast','module'),('pnl','module'),('brokers','module'),('buyers_administrator','module'),('master_contracts','module'),('markets','module'),('special_terms','module'),('hedge_desk','module'),('xero_portal','module'),('email_router','module'),('settings','module'),('admin','module'),('report_archive','module');
insert into public.permission_access_catalog(id,kind) values ('disputes_approve','capability'),('disputes_account','capability'),('buyer_invoices_manage','capability'),('financial_report_settings_manage','capability'),('cashflow_forecast_manage','capability'),('cashflow_bank_reconcile','capability'),('hedge_book_manage','capability'),('hedge_settlement_manage','capability'),('hedge_close_approve','capability'),('hedge_admin','capability'),('special_terms_manage','capability'),('special_terms_clause_approve','capability'),('broker_settings_manage','capability'),('xero_portal_manage','capability');
create temporary table access_role_defaults(id text primary key,permissions jsonb,capabilities jsonb) on commit drop;
insert into access_role_defaults values ('general_manager','{"dashboard": true, "review": true, "disputes": true, "buyer_invoices": true, "unofficial_compensation": true, "incoming_payments": true, "cashflow_forecast": true, "pnl": true, "brokers": true, "buyers_administrator": true, "master_contracts": true, "markets": true, "special_terms": true, "hedge_desk": true, "xero_portal": true, "email_router": true, "settings": true, "admin": true}'::jsonb,'{"disputes_approve": true, "disputes_account": true, "buyer_invoices_manage": true, "financial_report_settings_manage": true, "cashflow_forecast_manage": true, "cashflow_bank_reconcile": true, "hedge_book_manage": true, "hedge_settlement_manage": true, "hedge_close_approve": true, "hedge_admin": true, "special_terms_manage": true, "special_terms_clause_approve": true, "broker_settings_manage": true, "xero_portal_manage": true}'::jsonb);
insert into access_role_defaults values ('administrator','{"dashboard": true, "review": true, "disputes": true, "buyer_invoices": true, "unofficial_compensation": true, "incoming_payments": true, "cashflow_forecast": true, "pnl": true, "brokers": true, "buyers_administrator": true, "master_contracts": true, "markets": true, "special_terms": true, "hedge_desk": true, "xero_portal": true, "email_router": true, "settings": true, "admin": true}'::jsonb,'{"disputes_approve": true, "disputes_account": true, "buyer_invoices_manage": true, "financial_report_settings_manage": true, "cashflow_forecast_manage": true, "cashflow_bank_reconcile": true, "hedge_book_manage": true, "hedge_settlement_manage": true, "hedge_close_approve": true, "hedge_admin": true, "special_terms_manage": true, "special_terms_clause_approve": true, "broker_settings_manage": true, "xero_portal_manage": true}'::jsonb);
insert into access_role_defaults values ('manager','{"dashboard": true, "review": true, "disputes": true, "buyer_invoices": true, "unofficial_compensation": true, "incoming_payments": true, "cashflow_forecast": true, "pnl": true, "brokers": true, "report_archive": true, "buyers_administrator": false, "master_contracts": true, "hedge_desk": true, "markets": true, "special_terms": true, "settings": true, "admin": false}'::jsonb,'{"disputes_approve": true, "disputes_account": false, "buyer_invoices_manage": true, "financial_report_settings_manage": false, "cashflow_forecast_manage": true, "cashflow_bank_reconcile": false, "hedge_book_manage": true, "hedge_settlement_manage": false, "hedge_close_approve": false, "hedge_admin": false, "special_terms_manage": true, "special_terms_clause_approve": false, "broker_settings_manage": false}'::jsonb);
insert into access_role_defaults values ('finance','{"dashboard": true, "review": true, "disputes": true, "buyer_invoices": true, "unofficial_compensation": true, "incoming_payments": true, "cashflow_forecast": true, "pnl": true, "brokers": true, "report_archive": true, "buyers_administrator": false, "master_contracts": false, "hedge_desk": true, "markets": true, "special_terms": true, "xero_portal": true, "settings": false, "admin": false}'::jsonb,'{"disputes_approve": false, "disputes_account": true, "buyer_invoices_manage": true, "financial_report_settings_manage": true, "cashflow_forecast_manage": true, "cashflow_bank_reconcile": true, "hedge_book_manage": false, "hedge_settlement_manage": true, "hedge_close_approve": false, "hedge_admin": false, "special_terms_manage": false, "special_terms_clause_approve": false, "broker_settings_manage": true, "xero_portal_manage": true}'::jsonb);
insert into access_role_defaults values ('operations','{"dashboard": true, "review": true, "disputes": true, "buyer_invoices": false, "unofficial_compensation": false, "incoming_payments": true, "cashflow_forecast": false, "pnl": true, "brokers": false, "report_archive": false, "buyers_administrator": false, "master_contracts": false, "hedge_desk": false, "markets": true, "special_terms": true, "settings": false, "admin": false}'::jsonb,'{"disputes_approve": false, "disputes_account": false, "buyer_invoices_manage": false, "financial_report_settings_manage": false, "cashflow_forecast_manage": false, "cashflow_bank_reconcile": false, "hedge_book_manage": false, "hedge_settlement_manage": false, "hedge_close_approve": false, "hedge_admin": false, "special_terms_manage": true, "special_terms_clause_approve": false, "broker_settings_manage": false}'::jsonb);
insert into access_role_defaults values ('interoffice','{"dashboard": true, "review": true, "disputes": true, "buyer_invoices": true, "unofficial_compensation": true, "incoming_payments": true, "cashflow_forecast": true, "pnl": true, "brokers": true, "report_archive": false, "buyers_administrator": false, "master_contracts": false, "hedge_desk": false, "markets": true, "special_terms": true, "settings": false, "admin": false}'::jsonb,'{"disputes_approve": false, "disputes_account": false, "buyer_invoices_manage": false, "financial_report_settings_manage": false, "cashflow_forecast_manage": false, "cashflow_bank_reconcile": false, "hedge_book_manage": false, "hedge_settlement_manage": false, "hedge_close_approve": false, "hedge_admin": false, "special_terms_manage": false, "special_terms_clause_approve": false}'::jsonb);
insert into access_role_defaults values ('viewer','{"dashboard": true, "review": false, "disputes": false, "buyer_invoices": false, "unofficial_compensation": false, "incoming_payments": true, "cashflow_forecast": false, "pnl": false, "brokers": false, "report_archive": false, "buyers_administrator": false, "master_contracts": false, "hedge_desk": false, "markets": true, "special_terms": true, "settings": false, "admin": false}'::jsonb,'{"disputes_approve": false, "disputes_account": false, "buyer_invoices_manage": false, "financial_report_settings_manage": false, "cashflow_forecast_manage": false, "cashflow_bank_reconcile": false, "hedge_book_manage": false, "hedge_settlement_manage": false, "hedge_close_approve": false, "hedge_admin": false, "special_terms_manage": false, "special_terms_clause_approve": false}'::jsonb);

-- The old main dispatcher used fallback only when its entire requested-module
-- query was empty; dedicated endpoints used no fallback. Refuse sparse legacy
-- rows that would make those paths disagree instead of expanding a prior denial.
do $$ declare mismatch_count bigint; begin
 select count(*) into mismatch_count from public.user_profiles u
 join access_role_defaults d on d.id=u.user_type
 cross join public.permission_access_catalog c
 where u.active and u.use_type_defaults and u.user_type not in ('administrator','general_manager')
 and c.kind='module' and coalesce((d.permissions->>c.id)::boolean,false)
 and not exists(select 1 from public.user_type_module_permissions p where p.user_type_id=u.user_type and p.module_id=c.id);
 if mismatch_count>0 then raise exception 'Access migration requires explicit legacy module grants before cutover: % sparse entries disagree across existing authorization paths.',mismatch_count using errcode='55000'; end if;
end $$;

-- Materialize all defaults once. Missing grants after cutover always mean no access.
insert into public.permission_groups(id,label,description,is_system,sort_order,permissions,capabilities)
 select t.id,t.label,t.description,t.is_system,t.sort_order,
 (select jsonb_object_agg(c.id,case when c.id='report_archive' then to_jsonb(case
   when coalesce(v.can_view,(d.permissions->>c.id)::boolean,false) then
     case when coalesce((select a.can_view from public.user_type_module_permissions a where a.user_type_id=t.id and a.module_id='report_archive_manage'),true) then 'full' else 'read' end
   else 'none' end)
   else to_jsonb(coalesce(v.can_view,(d.permissions->>c.id)::boolean,false)) end)
  from public.permission_access_catalog c left join public.user_type_module_permissions v on v.user_type_id=t.id and v.module_id=c.id where c.kind='module'),
 (select jsonb_object_agg(c.id,to_jsonb(coalesce(v.can_view,(d.capabilities->>c.id)::boolean,false)))
  from public.permission_access_catalog c left join public.user_type_module_permissions v on v.user_type_id=t.id and v.module_id=c.id where c.kind='capability')
 from public.user_types t left join access_role_defaults d on d.id=t.id;

-- Capture the current module grants and actual server capability checks, including
-- legacy per-user capability overrides even on default-role users.
insert into public.permission_access_migration_snapshots(user_id,permissions,capabilities,previous_user_type,previous_use_type_defaults)
 select u.id,
 case when u.user_type in ('administrator','general_manager') then
 (select jsonb_object_agg(c.id,case when c.id='report_archive' then '"full"'::jsonb else 'true'::jsonb end) from public.permission_access_catalog c where kind='module')
 when u.use_type_defaults then g.permissions else
 (select jsonb_object_agg(c.id,case when c.id='report_archive' then to_jsonb(case when coalesce(v.can_view,false) then
 case when coalesce((select a.can_view from public.user_module_permissions a where a.user_id=u.id and a.module_id='report_archive_manage'),true) then 'full' else 'read' end
 else 'none' end) else to_jsonb(coalesce(v.can_view,false)) end)
 from public.permission_access_catalog c left join public.user_module_permissions v on v.user_id=u.id and v.module_id=c.id where c.kind='module') end,
 (select jsonb_object_agg(c.id,to_jsonb(case when u.user_type in ('administrator','general_manager') then true else coalesce(v.can_view,(g.capabilities->>c.id)::boolean,false) end))
 from public.permission_access_catalog c left join public.user_module_permissions v on v.user_id=u.id and v.module_id=c.id where c.kind='capability'),u.user_type,u.use_type_defaults
 from public.user_profiles u join public.permission_groups g on g.id=u.user_type;

insert into public.permission_groups(id,label,description,is_legacy,permissions,capabilities,sort_order)
 select 'legacy_'||replace(u.id::text,'-',''),left('Legacy personal access · '||coalesce(nullif(u.full_name,''),u.email,u.id::text),100),
 'Preserved access from the previous individual permission model. Manage through group membership.',true,s.permissions,s.capabilities,1000
 from public.user_profiles u join public.permission_access_migration_snapshots s on s.user_id=u.id join public.permission_groups g on g.id=u.user_type
 where not u.use_type_defaults or (u.user_type not in ('administrator','general_manager') and s.capabilities is distinct from g.capabilities);
insert into public.user_permission_groups(user_id,group_id)
 select u.id,case when l.id is not null then l.id else u.user_type end from public.user_profiles u
 left join public.permission_groups l on l.id='legacy_'||replace(u.id::text,'-','');

alter table public.permission_groups enable row level security;
alter table public.user_permission_groups enable row level security;
alter table public.permission_access_events enable row level security;
alter table public.permission_access_migration_snapshots enable row level security;
alter table public.permission_access_catalog enable row level security;
revoke all on public.permission_groups,public.user_permission_groups,public.permission_access_events,public.permission_access_migration_snapshots,public.permission_access_catalog from public,anon,authenticated;
grant select,insert,update,delete on public.permission_groups,public.user_permission_groups to service_role;
grant select,insert on public.permission_access_events to service_role;
grant select on public.permission_access_migration_snapshots,public.permission_access_catalog to service_role;

create function public.fcos_effective_access(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with profile as (select * from public.user_profiles where id=p_user_id),
 assigned as (select g.* from public.user_permission_groups m join public.permission_groups g on g.id=m.group_id where m.user_id=p_user_id),
 entries as (select c.id,c.kind,
 case when not u.active then case when c.id='report_archive' then '"none"'::jsonb else 'false'::jsonb end
 when u.user_type in ('administrator','general_manager') then case when c.id='report_archive' then '"full"'::jsonb else 'true'::jsonb end
 when c.id='report_archive' then to_jsonb(case when exists(select 1 from assigned g where g.permissions->>c.id in ('full','true')) then 'full' when exists(select 1 from assigned g where g.permissions->>c.id='read') then 'read' else 'none' end)
 else to_jsonb(exists(select 1 from assigned g where (case when c.kind='module' then g.permissions else g.capabilities end)->c.id='true'::jsonb)) end value,
 case when not u.active then '[]'::jsonb
 when u.user_type in ('administrator','general_manager') then '[{"id":"organizational_role","label":"Privileged organizational role"}]'::jsonb
 else coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'label',g.label) order by g.id) from assigned g where (case when c.kind='module' then g.permissions else g.capabilities end)->>c.id in ('true','read','full')),'[]'::jsonb) end sources
 from public.permission_access_catalog c cross join profile u)
 select jsonb_build_object('user_id',u.id,'access_revision',u.access_revision,
 'permissions',coalesce((select jsonb_object_agg(id,value) from entries where kind='module'),'{}'::jsonb),
 'capabilities',coalesce((select jsonb_object_agg(id,value) from entries where kind='capability'),'{}'::jsonb),
 'grant_sources',coalesce((select jsonb_object_agg(id,sources) from entries where sources<>'[]'::jsonb),'{}'::jsonb),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label) order by id) from assigned),'[]'::jsonb),
 'group_ids',coalesce((select jsonb_agg(id order by id) from assigned),'[]'::jsonb),
 'privileged_access',u.active and u.user_type in ('administrator','general_manager')) from profile u;
$$;
create function public.fcos_has_access(p_user_id uuid,p_permission text) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((public.fcos_effective_access(p_user_id)->'permissions'->>p_permission) in ('true','read','full')
 or (public.fcos_effective_access(p_user_id)->'capabilities'->>p_permission)='true',false);
$$;

-- Prove every active user's effective grants survive migration before committing.
do $$ declare row record; actual jsonb; begin
 for row in select s.* from public.permission_access_migration_snapshots s join public.user_profiles u on u.id=s.user_id where u.active loop
 actual:=public.fcos_effective_access(row.user_id);
 if actual->'permissions' is distinct from row.permissions or actual->'capabilities' is distinct from row.capabilities then
 raise exception 'People & Access migration would change an existing user grant. Migration stopped.'; end if;
 end loop;
end $$;

create function public.fcos_assert_access_administrator(p_actor_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.user_profiles where id=p_actor_id and active and user_type in ('administrator','general_manager') for update;
 if not found then raise exception 'Administrator access is required.' using errcode='42501'; end if;
end $$;
create function public.fcos_save_user_groups(p_actor_id uuid,p_user_id uuid,p_group_ids text[],p_expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous jsonb; after_value jsonb; current_revision bigint; begin
 perform pg_advisory_xact_lock(hashtextextended('fcos.permission_access',0));
 perform public.fcos_assert_access_administrator(p_actor_id);
 select access_revision into current_revision from public.user_profiles where id=p_user_id for update;
 if not found then raise exception 'User was not found.' using errcode='22023'; end if;
 if current_revision is distinct from p_expected_revision then raise exception 'Access changed after it was opened. Refresh and review before saving.' using errcode='40001'; end if;
 if p_group_ids is null or cardinality(p_group_ids)>100 or exists(select 1 from unnest(p_group_ids) i where i is null or not exists(select 1 from public.permission_groups g where g.id=i)) then
 raise exception 'Select valid permission groups.' using errcode='22023'; end if;
 previous:=public.fcos_effective_access(p_user_id);
 if (select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from (select distinct unnest(p_group_ids) id) ids)=previous->'group_ids' then return previous; end if;
 -- Membership changes invalidate any open group-wide impact preview.
 update public.permission_groups set revision=revision+1,updated_at=clock_timestamp() where id in (
   select group_id from public.user_permission_groups where user_id=p_user_id union select unnest(p_group_ids)
 );
 delete from public.user_permission_groups where user_id=p_user_id;
 insert into public.user_permission_groups(user_id,group_id) select p_user_id,id from (select distinct unnest(p_group_ids) id) ids;
 update public.user_profiles set access_revision=access_revision+1,updated_at=clock_timestamp() where id=p_user_id;
 after_value:=public.fcos_effective_access(p_user_id);
 insert into public.permission_access_events(actor_user_id,actor_email,action,target_id,previous_value,new_value)
 select p_actor_id,email,'memberships_saved',p_user_id::text,previous,after_value from public.user_profiles where id=p_actor_id;
 return after_value;
end $$;

create function public.fcos_save_permission_group(p_actor_id uuid,p_id text,p_expected_revision bigint,p_label text,p_description text,p_sort_order integer,p_permissions jsonb,p_capabilities jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_group public.permission_groups%rowtype; saved_group public.permission_groups%rowtype; previous_users jsonb; after_users jsonb; begin
 perform pg_advisory_xact_lock(hashtextextended('fcos.permission_access',0));
 perform public.fcos_assert_access_administrator(p_actor_id);
 select * into current_group from public.permission_groups where id=p_id for update;
 if coalesce(current_group.revision,0) is distinct from p_expected_revision then raise exception 'Group changed after it was opened. Refresh and review before saving.' using errcode='40001'; end if;
 if p_id is null or p_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$' or length(btrim(coalesce(p_label,''))) not between 1 and 100 or length(coalesce(p_description,''))>1000
 or jsonb_typeof(p_permissions) is distinct from 'object' or jsonb_typeof(p_capabilities) is distinct from 'object'
 or exists(select 1 from jsonb_each(p_permissions) e where not exists(select 1 from public.permission_access_catalog c where c.id=e.key and c.kind='module') or (case when e.key='report_archive' then e.value not in ('"none"'::jsonb,'"read"'::jsonb,'"full"'::jsonb) else jsonb_typeof(e.value)<>'boolean' end))
 or exists(select 1 from jsonb_each(p_capabilities) e where not exists(select 1 from public.permission_access_catalog c where c.id=e.key and c.kind='capability') or jsonb_typeof(e.value)<>'boolean')
 then raise exception 'Enter a valid group name and permission values.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(public.fcos_effective_access(user_id)),'[]'::jsonb) into previous_users from public.user_permission_groups where group_id=p_id;
 if current_group.id is not null and current_group.label=btrim(p_label) and current_group.description=coalesce(p_description,'') and current_group.sort_order=coalesce(p_sort_order,100) and current_group.permissions=p_permissions and current_group.capabilities=p_capabilities then return to_jsonb(current_group); end if;
 insert into public.permission_groups(id,label,description,sort_order,permissions,capabilities)
 values(p_id,btrim(p_label),coalesce(p_description,''),coalesce(p_sort_order,100),p_permissions,p_capabilities)
 on conflict(id) do update set label=excluded.label,description=excluded.description,sort_order=excluded.sort_order,permissions=excluded.permissions,capabilities=excluded.capabilities,revision=public.permission_groups.revision+1,updated_at=clock_timestamp() returning * into saved_group;
 -- A co-assigned group's impact preview depends on this group's grants too.
 update public.permission_groups set revision=revision+1,updated_at=clock_timestamp()
 where id<>p_id and id in (select other.group_id from public.user_permission_groups other
 where other.user_id in (select user_id from public.user_permission_groups where group_id=p_id));
 update public.user_profiles set access_revision=access_revision+1 where id in (select user_id from public.user_permission_groups where group_id=p_id);
 select coalesce(jsonb_agg(public.fcos_effective_access(user_id)),'[]'::jsonb) into after_users from public.user_permission_groups where group_id=p_id;
 insert into public.permission_access_events(actor_user_id,actor_email,action,target_id,previous_value,new_value)
 select p_actor_id,email,case when current_group.id is null then 'group_created' else 'group_updated' end,p_id,
 jsonb_build_object('group',to_jsonb(current_group),'users',previous_users),jsonb_build_object('group',to_jsonb(saved_group),'users',after_users) from public.user_profiles where id=p_actor_id;
 return to_jsonb(saved_group);
end $$;

create function public.fcos_delete_permission_group(p_actor_id uuid,p_id text,p_expected_revision bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare current_group public.permission_groups%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('fcos.permission_access',0));
 perform public.fcos_assert_access_administrator(p_actor_id);
 select * into current_group from public.permission_groups where id=p_id for update;
 if not found then raise exception 'Group was not found.' using errcode='22023'; end if;
 if current_group.revision is distinct from p_expected_revision then raise exception 'Group changed after it was opened. Refresh before deleting.' using errcode='40001'; end if;
 if exists(select 1 from public.user_permission_groups where group_id=p_id) then raise exception 'This group has members. Reassign or remove its members before deleting it.' using errcode='55000'; end if;
 delete from public.permission_groups where id=p_id;
 insert into public.permission_access_events(actor_user_id,actor_email,action,target_id,previous_value,new_value)
 select p_actor_id,email,'group_deleted',p_id,to_jsonb(current_group),null from public.user_profiles where id=p_actor_id;
 return true;
end $$;

-- Identity/organizational changes also invalidate the access snapshot. They never
-- alter memberships, including when FCUNO updates an identity or the GM changes.
-- Statement admission precedes profile row locks for ordinary UPDATE/DELETE.
-- Some existing organizational RPCs already lock profiles; a nonblocking lock
-- fails their transaction safely instead of creating an inverted-lock deadlock.
create function public.fcos_profile_access_change_lock() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('fcos.permission_access',0)) then
   raise exception 'Access is being updated. Refresh and retry the organizational change.' using errcode='40001';
 end if;
 return null;
end $$;
create trigger profile_access_update_lock before update of user_type,active on public.user_profiles for each statement execute function public.fcos_profile_access_change_lock();
create trigger profile_access_delete_lock before delete on public.user_profiles for each statement execute function public.fcos_profile_access_change_lock();
create function public.fcos_profile_access_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then
   update public.permission_groups set revision=revision+1,updated_at=clock_timestamp() where id in (select group_id from public.user_permission_groups where user_id=old.id);
   return old;
 end if;
 if new.user_type is distinct from old.user_type or new.active is distinct from old.active then
   new.access_revision:=old.access_revision+1;
   update public.permission_groups set revision=revision+1,updated_at=clock_timestamp() where id in (select group_id from public.user_permission_groups where user_id=old.id);
 end if;
 return new;
end $$;
create trigger profile_access_revision before update of user_type,active or delete on public.user_profiles for each row execute function public.fcos_profile_access_revision();
revoke all on function public.fcos_profile_access_change_lock() from public,anon,authenticated;
grant execute on function public.fcos_profile_access_change_lock() to service_role;

revoke all on function public.fcos_effective_access(uuid),public.fcos_has_access(uuid,text),public.fcos_assert_access_administrator(uuid),public.fcos_save_user_groups(uuid,uuid,text[],bigint),public.fcos_save_permission_group(uuid,text,bigint,text,text,integer,jsonb,jsonb),public.fcos_delete_permission_group(uuid,text,bigint),public.fcos_profile_access_revision() from public,anon,authenticated;
grant execute on function public.fcos_effective_access(uuid),public.fcos_has_access(uuid,text),public.fcos_assert_access_administrator(uuid),public.fcos_save_user_groups(uuid,uuid,text[],bigint),public.fcos_save_permission_group(uuid,text,bigint,text,text,integer,jsonb,jsonb),public.fcos_delete_permission_group(uuid,text,bigint),public.fcos_profile_access_revision() to service_role;

-- Finance authorization uses the same live group union as the API.
create or replace function public.save_company_finance_settings_v2(
  p_annual_interest_rate_pct numeric, p_expected_revision bigint, p_actor_user_id uuid, p_bank_charges_usd jsonb
) returns public.company_finance_settings
language plpgsql security invoker set search_path = '' as $$
declare
  v_current public.company_finance_settings%rowtype;
  v_saved public.company_finance_settings%rowtype;
  v_charges jsonb;
begin
  if not public.fcos_has_access(p_actor_user_id,'financial_report_settings_manage') then raise exception 'Finance settings management permission is required.' using errcode='42501'; end if;
  if p_annual_interest_rate_pct is null or p_annual_interest_rate_pct not between 0 and 100
    or p_annual_interest_rate_pct <> round(p_annual_interest_rate_pct,2) then
    raise exception 'The annual financing rate must be between 0 and 100 with at most two decimal places.' using errcode='22023';
  end if;
  select * into strict v_current from public.company_finance_settings where setting_key='company' for update;
  if p_expected_revision is distinct from v_current.revision then
    raise exception 'Finance settings changed after they were opened. Refresh before saving.' using errcode='40001';
  end if;
  v_charges := coalesce(p_bank_charges_usd,v_current.bank_charges_usd);
  if not public.valid_company_bank_charges(v_charges) then
    raise exception 'Enter valid UBS and DBS charges from USD 0 to 1,000,000 with at most two decimal places.' using errcode='22023';
  end if;
  if p_annual_interest_rate_pct = v_current.annual_interest_rate_pct and v_charges = v_current.bank_charges_usd then return v_current; end if;
  update public.company_finance_settings set annual_interest_rate_pct=p_annual_interest_rate_pct, bank_charges_usd=v_charges,
    revision=revision+1, updated_by=p_actor_user_id, updated_by_email=(select email from public.user_profiles where id=p_actor_user_id), updated_at=clock_timestamp()
    where setting_key='company' returning * into v_saved;
  insert into public.company_finance_setting_events(previous_rate_pct,annual_interest_rate_pct,revision,actor_user_id,actor_email,previous_bank_charges_usd,bank_charges_usd)
    values(v_current.annual_interest_rate_pct,v_saved.annual_interest_rate_pct,v_saved.revision,p_actor_user_id,coalesce(v_saved.updated_by_email,p_actor_user_id::text),v_current.bank_charges_usd,v_saved.bank_charges_usd);
  return v_saved;
end;
$$;


-- Retired authorization tables remain readable for rollback and evidence, but an
-- old application must not appear to save individual grants after the cutover.
create function public.fcos_reject_legacy_permission_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' and TG_TABLE_NAME='user_module_permissions' then
   if not exists(select 1 from public.user_profiles where id=old.user_id) then return old; end if;
 end if;
 raise exception 'Individual and role permission writes are retired. Use permission groups.' using errcode='55000';
end $$;
create trigger retired_user_permission_writes before insert or update or delete on public.user_module_permissions for each row execute function public.fcos_reject_legacy_permission_write();
create trigger retired_type_permission_writes before insert or update or delete on public.user_type_module_permissions for each row execute function public.fcos_reject_legacy_permission_write();
revoke all on function public.fcos_reject_legacy_permission_write() from public,anon,authenticated;
grant execute on function public.fcos_reject_legacy_permission_write() to service_role;
commit;
