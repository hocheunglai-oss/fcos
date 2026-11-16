import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertHandoverConnection, assertHandoverDatabaseIdentity, handoverDigest } from './handover.mjs';
import { digest, git, isSha, requireCondition } from './contract.mjs';
import { openPinnedDatabase } from './database-connection.mjs';
import { openPinnedReadonlyDatabase } from './readonly-database.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { lockStagingTransition } from './staging-ownership.mjs';

// Catalog state only: no application, financial or credential rows leave PostgreSQL.
export const SCHEMA_FINGERPRINT_SQL = `select encode(sha256(convert_to(jsonb_build_object(
 'schemas',(select coalesce(jsonb_agg(to_jsonb(n) order by n.nspname),'[]') from pg_namespace n where n.nspname in ('public','auth','storage')),
 'roles',(select coalesce(jsonb_agg(case when r.rolname='cli_login_postgres' and r.rolcanlogin
  and not (r.rolsuper or r.rolinherit or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls)
  and (select count(*) from pg_auth_members m where m.member=r.oid)=1
  and exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles g on g.oid=m.grantor
   where m.member=r.oid and p.rolname='postgres' and g.rolname='supabase_admin'
   and m.set_option and not m.inherit_option and not m.admin_option)
  then to_jsonb(r)-'rolvaliduntil' else to_jsonb(r) end order by r.rolname),'[]') from pg_roles r),
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member),'[]') from pg_auth_members m),
 'types',(select coalesce(jsonb_agg(to_jsonb(t) order by n.nspname,t.typname),'[]') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','auth','storage')),
 'enums',(select coalesce(jsonb_agg(to_jsonb(e) order by e.enumtypid,e.enumsortorder),'[]') from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','auth','storage')),
 'extensions',(select coalesce(jsonb_agg(to_jsonb(e) order by e.extname),'[]') from pg_extension e),
 'default_privileges',(select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]') from pg_default_acl d),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner,case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) else null end) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage')),
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.atttypid,a.atttypmod,a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by n.nspname,c.relname,a.attnum),'[]') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ('public','auth','storage') and a.attnum>0 and not a.attisdropped),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl,p.proowner) order by n.nspname,p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage') and p.prokind in ('f','p')),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]') from pg_policies p where p.schemaname in ('public','auth','storage')),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname),'[]') from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage')),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and not t.tgisinternal)
 )::text,'UTF8')),'hex') as digest`;
export async function withPinnedReadOnlyDatabase({ env = process.env, createClient, openDatabase, createIntentStore, github, lockStage = false }, callback) {
  let db, connection;
  if (openDatabase) {
    requireCondition(typeof openDatabase === 'function', 'NATIVE_COMPATIBILITY_CONNECTION_REQUIRED');
    ({ db, connection } = await openDatabase());
  } else if (env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN) {
    requireCondition(!env.FCOS_RAPID_DATABASE_URL, 'NATIVE_COMPATIBILITY_CREDENTIAL_AMBIGUOUS');
    requireCondition(env.FCOS_RAPID_DATABASE_CA, 'NATIVE_COMPATIBILITY_CONNECTION_REQUIRED');
    const directory = fileURLToPath(new URL('../../../', import.meta.url));
    const source = { sha: git(directory, ['rev-parse', 'HEAD']) };
    requireCondition(isSha(source.sha), 'NATIVE_COMPATIBILITY_CONTROLLER_SOURCE_REQUIRED');
    const credential = { kind: 'supabase_management', token: env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN };
    const create = createIntentStore || (await import('./database-intent.mjs')).createDatabaseCredentialIntentStore;
    const intentStore = await create({ credential, directory, source, purpose: 'rapid_compatibility_read_only', github });
    ({ db, connection } = await openPinnedDatabase({ credential, caFile: env.FCOS_RAPID_DATABASE_CA, intentStore,
      deps: createClient ? { Client: createClient } : {} }));
  } else {
    requireCondition(env.FCOS_RAPID_DATABASE_URL && env.FCOS_RAPID_DATABASE_CA, 'NATIVE_COMPATIBILITY_CONNECTION_REQUIRED');
    const url = new URL(env.FCOS_RAPID_DATABASE_URL);
    requireCondition(url.protocol === 'postgresql:' && !url.search && !url.hash, 'NATIVE_COMPATIBILITY_CONNECTION_INVALID');
    if (decodeURIComponent(url.username) === fcosConnectionIdentifier('supabase','Database release read-only user')) {
      ({db,connection}=await openPinnedReadonlyDatabase({url:env.FCOS_RAPID_DATABASE_URL,caFile:env.FCOS_RAPID_DATABASE_CA,
        deps:createClient?{Client:createClient}:undefined}));
    } else {
    connection = { host:url.hostname, port:Number(url.port || 5432), user:decodeURIComponent(url.username), database:url.pathname.slice(1),
      password:decodeURIComponent(url.password), ssl:{rejectUnauthorized:true,ca:readFileSync(env.FCOS_RAPID_DATABASE_CA,'utf8')} };
    assertHandoverConnection(connection);
    const Client = createClient || (await import('pg')).Client;
    db = new Client(connection);
    await db.connect();
    }
  }
  let transaction = false;
  try {
    assertHandoverConnection(connection);
    await db.query(lockStage ? 'begin isolation level read committed read only' : 'begin isolation level repeatable read read only');
    transaction = true;
    if (lockStage) await lockStagingTransition(db, { staging: true });
    const identity=(await db.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
    assertHandoverDatabaseIdentity(identity, connection, { readOnly: true, context: 'compatibility' });
    const result=await callback(db);await db.query('commit');transaction=false;return result;
  } catch (error) {
    if (transaction) { try { await db.query('rollback'); } catch { /* Preserve original failure. */ } }
    throw error;
  } finally {await db.end();}
}
export function nativeCompatibilityReader({ provider, env = process.env, createClient, openDatabase, createIntentStore, github } = {}) {
  return async ({ manifest, previous = manifest.previous }) => withPinnedReadOnlyDatabase({env,createClient,openDatabase,createIntentStore,github},async db=>{
    const schemaDigest=(await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
    requireCondition(/^[a-f0-9]{64}$/.test(schemaDigest || ''),'NATIVE_SCHEMA_FINGERPRINT_REQUIRED');
    const configuration=await provider.nativeConfiguration(), current=await provider.currentProduction();
    return {deploymentId:previous.deploymentId,currentDeploymentId:current.id,sha:current.sha,schemaDigest,configurationDigest:digest(configuration),observedAt:new Date().toISOString()};
  });
}
export async function verifyNativeHandoverDatabase(db, handover) {
  const latest=(await db.query("select receipt_id,handover_id,plan_hash,evidence from fcos_release_coordination.rapid_handover_receipts where phase='finalized' order by receipt_id desc limit 1")).rows[0];
  const control=(await db.query('select to_jsonb(c) as control from fcos_release_coordination.control c where singleton')).rows[0]?.control;
  const open=(await db.query("select count(*)::int as count from fcos_release_coordination.rapid_handover_receipts p where p.phase='prepared' and not exists(select 1 from fcos_release_coordination.rapid_handover_receipts c where c.handover_id=p.handover_id and c.phase in ('aborted','finalized'))")).rows[0]?.count;
  const unknown=(await db.query("select count(*)::int as count from fcos_release_coordination.operations o where o.phase in ('production.stage','production.promote','production.rollback') and (select e.state from fcos_release_coordination.operation_events e where e.operation_id=o.operation_id order by event_id desc limit 1) is distinct from 'complete'")).rows[0]?.count;
  const guard=(await db.query("select encode(sha256(convert_to(pg_get_functiondef('fcos_release_coordination.rapid_handover_control_guard()'::regprocedure),'UTF8')),'hex') as digest,(select count(*)::int from pg_trigger where tgrelid='fcos_release_coordination.control'::regclass and tgname in ('rapid_handover_control_guard','rapid_handover_control_no_truncate') and tgenabled='O') as triggers")).rows[0];
  requireCondition(latest && Number(latest.receipt_id)===handover.databaseReceiptId && latest.handover_id===handover.handoverId
    && latest.plan_hash===handover.planHash && latest.evidence.controllerSha===handover.controllerSha
    && handoverDigest(latest.evidence)===handover.nativeCoordinatorReadbackDigest
    && handoverDigest(latest.evidence.review)===handoverDigest(handover.nativeReview)
    && latest.evidence.qualificationDigest===handover.qualificationDigest
    && handoverDigest(control)===handoverDigest({...latest.evidence.controlPreimage,mode:'frozen'})
    && guard?.digest===latest.evidence.guardDigest && guard.triggers===2 && Number(open)===0 && Number(unknown)===0,
  'CURRENT_PERMANENT_HANDOVER_RECEIPT_REQUIRED');
  return {databaseReceiptId:Number(latest.receipt_id),evidenceDigest:handover.nativeCoordinatorReadbackDigest,observedAt:new Date().toISOString()};
}
export async function assertNativeHandoverState({handover,env=process.env,createClient,openDatabase,createIntentStore,github}) {
  return withPinnedReadOnlyDatabase({env,createClient,openDatabase,createIntentStore,github},db=>verifyNativeHandoverDatabase(db,handover));
}
