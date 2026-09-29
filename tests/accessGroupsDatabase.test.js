import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { APP_MODULES } from '../src/lib/authModules.js';
import { resolveGroupAccess } from '../shared/accessGroups.js';
import { loadEffectiveGroupAccess } from '../api/_accessGroups.js';

const migration = new URL('../supabase/migrations/20260929133157_people_access_groups.sql', import.meta.url);
test('group cutover preserves grants, serializes changes, revokes live access and protects roles/audit', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const admin=randomUUID(), ordinary=randomUUID(), custom=randomUUID(), override=randomUUID(), inactive=randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table user_types(id text primary key,label text,description text default '',is_system boolean default false,sort_order integer default 100);
    create table user_profiles(id uuid primary key,email text,full_name text,user_type text,active boolean,use_type_defaults boolean,updated_at timestamptz default now());
    create table user_module_permissions(user_id uuid references user_profiles(id) on delete cascade,module_id text,can_view boolean,primary key(user_id,module_id));
    create table user_type_module_permissions(user_type_id text,module_id text,can_view boolean,primary key(user_type_id,module_id));
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    insert into user_types(id,label) values ('administrator','Administrator'),('viewer','Viewer'),('finance','Finance');
    insert into user_type_module_permissions values ('finance','financial_report_settings_manage',true),('viewer','dashboard',true),('viewer','report_archive',true),('viewer','report_archive_manage',false);`);
  await db.query(`insert into user_profiles(id,email,full_name,user_type,active,use_type_defaults) values ($1,'admin@test','Admin','administrator',true,true),($2,'viewer@test','Viewer','viewer',true,true),($3,'custom@test','Custom','finance',true,false),($4,'override@test','Override','finance',true,true),($5,'inactive@test','Inactive','administrator',false,true)`,[admin,ordinary,custom,override,inactive]);
  await db.query("insert into user_module_permissions values ($1,'dashboard',false),($1,'xero_portal',true),($1,'financial_report_settings_manage',false),($2,'financial_report_settings_manage',false)",[custom,override]);
  for(const file of ['20260920154626_dashboard_finance_settings.sql','20260921061845_dashboard_bank_charges.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const migrationSql = await readFile(migration,'utf8');
  await assert.rejects(db.exec(migrationSql), /explicit legacy module grants/);
  await db.exec('rollback');
  // Explicit zero rows prevent the legacy mixed-module/no-fallback discrepancy.
  for (const role of ['viewer','finance']) for (const moduleId of [...APP_MODULES.map(row=>row.id),'report_archive']) {
    await db.query('insert into user_type_module_permissions values ($1,$2,false) on conflict do nothing',[role,moduleId]);
  }
  await db.exec(migrationSql);
  await db.exec('set role service_role');
  const access=async id => (await db.query('select fcos_effective_access($1) a',[id])).rows[0].a;
  const adminAccess=await access(admin); assert.equal(adminAccess.privileged_access,true);
  const regular=await access(ordinary); assert.equal(regular.permissions.report_archive,'read'); assert.equal(regular.permissions.dashboard,true); assert.deepEqual(regular.group_ids,['viewer']);
  const personal=await access(custom); assert.equal(personal.group_ids.length,1); assert.match(personal.group_ids[0],/^legacy_/); assert.equal(personal.permissions.dashboard,false); assert.equal(personal.permissions.xero_portal,true); assert.equal(personal.capabilities.financial_report_settings_manage,false);
  assert.match((await access(override)).group_ids[0],/^legacy_/); assert.equal((await access(inactive)).permissions.dashboard,false);
  const snapshots=(await db.query('select * from permission_access_migration_snapshots')).rows;
  for(const snapshot of snapshots.filter(row=>row.user_id!==inactive)) { const actual=await access(snapshot.user_id); assert.deepEqual(actual.permissions,snapshot.permissions); assert.deepEqual(actual.capabilities,snapshot.capabilities); }
  const saveGroup=(id,revision,permissions,capabilities={},actor=admin)=>db.query('select fcos_save_permission_group($1,$2,$3,$4,$5,$6,$7,$8) g',[actor,id,revision,id,'Test',100,permissions,capabilities]);
  await assert.rejects(saveGroup('forbidden',0,{dashboard:true},{},ordinary),/Administrator/);
  await assert.rejects(saveGroup('invalid',0,{dashboard:'true'}),/valid group/);
  await saveGroup('desk',0,{dashboard:true,report_archive:'full'},{financial_report_settings_manage:true});
  const saveMember=(id,groups,rev,actor=admin)=>db.query('select fcos_save_user_groups($1,$2,$3,$4) a',[actor,id,groups,rev]);
  await assert.rejects(saveMember(ordinary,['desk'],1,ordinary),/Administrator/);
  await assert.rejects(saveMember(ordinary,['missing'],1),/valid permission groups/);
  await saveMember(ordinary,['viewer','desk'],1);
  const union=await access(ordinary); assert.equal(union.permissions.report_archive,'full'); assert.equal(union.capabilities.financial_report_settings_manage,true); assert.equal(union.access_revision,2);
  const groups=(await db.query('select * from permission_groups')).rows;
  const catalog=(await db.query('select * from permission_access_catalog')).rows;
  const js=resolveGroupAccess({groups,groupIds:union.group_ids,moduleIds:catalog.filter(x=>x.kind==='module').map(x=>x.id),capabilityIds:catalog.filter(x=>x.kind==='capability').map(x=>x.id)});
  assert.deepEqual(js.permissions,union.permissions); assert.deepEqual(js.capabilities,union.capabilities);
  for(const [key,value] of Object.entries(js.grant_sources)) assert.deepEqual(value.sort((a,b)=>a.id.localeCompare(b.id)),union.grant_sources[key]);
  await assert.rejects(saveGroup('desk',1,{dashboard:false}),/changed after/); // Membership changed the preview revision.
  await assert.rejects(saveMember(ordinary,[],1),/changed after/);
  await assert.rejects(db.query('select fcos_delete_permission_group($1,$2,$3)',[admin,'desk',2]),/members/);
  await db.query('select save_company_finance_settings_v2($1,$2,$3,$4)',[6,2,ordinary,null]);
  await saveMember(ordinary,['viewer'],2);
  assert.equal((await access(ordinary)).permissions.dashboard,true); assert.equal((await access(ordinary)).permissions.report_archive,'read');
  await assert.rejects(db.query('select save_company_finance_settings_v2($1,$2,$3,$4)',[7,3,ordinary,null]),/permission/);
  await saveMember(ordinary,[],3); assert.equal((await access(ordinary)).permissions.dashboard,false);
  await saveMember(ordinary,['administrator'],4); assert.equal((await access(ordinary)).privileged_access,false);
  assert.equal((await db.query('select user_type from user_profiles where id=$1',[ordinary])).rows[0].user_type,'viewer');
  await assert.rejects(saveGroup('role-imposter',0,{dashboard:true},{},ordinary),/Administrator/);
  await db.query('select fcos_delete_permission_group($1,$2,$3)',[admin,'desk',3]);
  await assert.rejects(db.query("update user_module_permissions set can_view=true where user_id=$1",[custom]),/retired/);
  await assert.rejects(db.exec("update user_type_module_permissions set can_view=false where user_type_id='viewer'"),/retired/);
  const events=(await db.query('select * from permission_access_events order by created_at')).rows; assert.equal(events.length,6); assert.ok(events.every(x=>x.actor_user_id===admin && x.previous_value!==undefined));
  await assert.rejects(db.exec('delete from permission_access_events'),/permission denied/);
  await saveGroup('impact_a',0,{dashboard:true}); await saveGroup('impact_b',0,{dashboard:true});
  await saveMember(override,['impact_a','impact_b'],1);
  await saveGroup('impact_b',2,{dashboard:true,xero_portal:true});
  await assert.rejects(saveGroup('impact_a',2,{dashboard:false}),/changed after/);
  await db.query("update user_profiles set user_type='viewer' where id=$1",[override]);
  await assert.rejects(saveGroup('impact_a',3,{dashboard:false}),/changed after/);
  const adminGroupRevision=Number((await db.query("select revision from permission_groups where id='administrator'")).rows[0].revision);
  const before=(await access(ordinary)).access_revision; await db.query('update user_profiles set active=false where id=$1',[ordinary]);
  await assert.rejects(saveGroup('administrator',adminGroupRevision,{dashboard:false}),/changed after/);
  assert.equal((await access(ordinary)).access_revision,before+1); assert.equal((await access(ordinary)).permissions.dashboard,false);
  await db.query('delete from user_profiles where id=$1',[custom]);
  assert.equal((await db.query('select count(*)::int n from user_module_permissions where user_id=$1',[custom])).rows[0].n,0);
  for(const role of ['anon','authenticated']) { await db.exec('reset role; set role '+role); await assert.rejects(db.exec('select * from permission_groups'),/permission denied/); await assert.rejects(access(admin),/permission denied/); await assert.rejects(saveMember(ordinary,[],6),/permission denied/); }
});

test('server resolver caches only within one request profile and rereads subsequent requests', async()=>{
  let calls=0; const client={rpc:async()=>({data:{user_id:'one',permissions:{dashboard:++calls===1}},error:null})};
  const firstProfile={id:'one'}; const first=await loadEffectiveGroupAccess(client,firstProfile);
  assert.equal(first.permissions.dashboard,true); await loadEffectiveGroupAccess(client,firstProfile); assert.equal(calls,1);
  assert.equal((await loadEffectiveGroupAccess(client,{id:'one'})).permissions.dashboard,false); assert.equal(calls,2);
});
