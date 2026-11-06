import { readFileSync } from 'node:fs';
import { TLSSocket } from 'node:tls';
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import { fcosConnectionIdentifier as identifier } from '../../../config/fcosConnections.js';
import { digest, requireCondition as check } from './contract.mjs';

const proof = new WeakMap();
const role = () => identifier('supabase','Database release read-only role');
const caHash='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export const READONLY_DATABASE_IDENTITY_SQL=`select session_user,current_user,current_database() as database,
 current_setting('transaction_read_only') as read_only,r.rolname,r.rolcanlogin,r.rolsuper,r.rolinherit,
 r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
 (select count(*)::int from pg_auth_members where member=r.oid) as memberships,
 (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','auth','storage') and c.relkind in ('r','p','v','m','f')
  and (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES'))) as business_writers,
 (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','auth','storage') and p.prosecdef and has_function_privilege(r.oid,p.oid,'EXECUTE')) as privileged_routines,
 (select count(*)::int from pg_namespace n where n.nspname in ('public','auth','storage') and has_schema_privilege(r.oid,n.oid,'CREATE')) as business_creators,
 (select setconfig from pg_db_role_setting where setrole=r.oid and setdatabase=0) as settings
 from pg_roles r where r.rolname=session_user`;
const nativeTls=(db,host)=>db?.connection?.stream instanceof TLSSocket && db.connection.stream.authorized===true
  && db.connection.stream.encrypted===true && db.connection.stream.servername===host && !db.connection.stream.destroyed && !db._ending;
export function isNativeReadonlyConnection(connection) {
  const bound=connection && proof.get(connection);
  return Boolean(bound?.active && nativeTls(bound.db,connection.host) && bound.stream===bound.db.connection.stream);
}
export function assertReadonlyDatabaseIdentity(row,connection,{readOnly=true}={}) {
  check(isNativeReadonlyConnection(connection) && readOnly===true && row?.session_user===role()
    && row.current_user===role() && row.database==='postgres' && row.read_only==='on','PINNED_READONLY_DATABASE_IDENTITY_REQUIRED');
  return row;
}
function assertProfile(row) {
  check(row?.rolname===role() && row.rolcanlogin===true && Number(row.memberships)===0
    && row.business_writers===0 && row.privileged_routines===0 && row.business_creators===0
    && ['rolsuper','rolinherit','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls'].every(key=>row[key]===false)
    && Array.isArray(row.settings) && row.settings.length===1 && row.settings[0]==='default_transaction_read_only=on',
  'PINNED_READONLY_DATABASE_ROLE_REQUIRED');
}
// Called only inside the authorized initial handover schema transaction.
export async function installReadonlyHandoverPolicy(db) {
  const found=(await db.query(READONLY_DATABASE_IDENTITY_SQL.replace('r.rolname=session_user','r.rolname=$1'),[role()])).rows;
  if (!found.length) return;
  check(found.length===1,'PINNED_READONLY_DATABASE_ROLE_REQUIRED');assertProfile(found[0]);
  const name=role();check(/^[a-z_]{8,63}$/.test(name),'READONLY_ROLE_NAME_INVALID');
  await db.query(`grant select on fcos_release_coordination.rapid_handover_receipts to ${name}`);
  await db.query(`create policy rapid_readonly_handover on fcos_release_coordination.rapid_handover_receipts for select to ${name} using(true)`);
}
export async function openPinnedReadonlyDatabase({url,caFile,deps={}}) {
  let parsed;try {parsed=new URL(url);} catch {throw Error('PINNED_READONLY_DATABASE_URL_REQUIRED');}
  const host=identifier('supabase','Database session host');
  check(parsed.protocol==='postgresql:' && !parsed.search && !parsed.hash && parsed.hostname===host && parsed.port==='5432'
    && decodeURIComponent(parsed.username)===identifier('supabase','Database release read-only user') && parsed.pathname==='/postgres'
    && parsed.password.length>=32,'PINNED_READONLY_DATABASE_URL_REQUIRED');
  const ca=(deps.readFile||readFileSync)(caFile);check(digest(ca)===caHash,'PINNED_READONLY_DATABASE_CA_REQUIRED');
  const password=Buffer.from(decodeURIComponent(parsed.password));
  const Client=deps.Client || (await import('pg')).Client;
  const db=new Client({host,port:5432,user:decodeURIComponent(parsed.username),database:'postgres',password:password.toString(),
    ssl:{ca,rejectUnauthorized:true,servername:host},connectionTimeoutMillis:10000,query_timeout:10000,application_name:'fcos-rapid-readonly'});
  let connection;
  const invalidate=()=>{if(connection)proof.get(connection).active=false;};db.on?.('error',invalidate);db.on?.('end',invalidate);
  try {
    await db.connect();check(nativeTls(db,host),'PINNED_READONLY_DATABASE_TLS_REQUIRED');
    await db.query('BEGIN READ ONLY');
    const rows=(await db.query(READONLY_DATABASE_IDENTITY_SQL)).rows,row=rows?.length===1?rows[0]:null;
    assertProfile(row);
    connection=Object.freeze({host,port:5432,user:decodeURIComponent(parsed.username),database:'postgres',ssl:Object.freeze({ca,rejectUnauthorized:true})});
    proof.set(connection,{active:true,db,stream:db.connection.stream});assertReadonlyDatabaseIdentity(row,connection);
    await db.query('ROLLBACK');return {db,connection};
  } catch {
    try {await db.query('ROLLBACK');} catch { /* No retry or raw authentication diagnostics. */ }
    try {await db.end();} catch { /* Preserve refusal. */ }
    throw Error('PINNED_READONLY_DATABASE_CONNECTION_REFUSED');
  } finally {password.fill(0);db.password=null;if(db.connectionParameters)db.connectionParameters.password=null;}
}

/** Private SCRAM verifier transport only; never print or retain the returned SQL. */
export function createReadonlyRoleVerifier(password) {
  check(Buffer.isBuffer(password) && password.length>=32 && password.length<=128 && password.every(byte=>byte>=33 && byte<=126),'READONLY_ROLE_PASSWORD_REQUIRED');
  const salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
  const client=createHmac('sha256',salted).update('Client Key').digest();
  const stored=createHash('sha256').update(client).digest(),server=createHmac('sha256',salted).update('Server Key').digest();
  try {return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`;}
  finally {salted.fill(0);client.fill(0);stored.fill(0);server.fill(0);}
}
export function readonlyRoleProvisioningSql(scram) {
  check(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(scram || ''),'READONLY_ROLE_SCRAM_REQUIRED');
  const fields=scram.split(/[$:]/);
  check([fields[2],fields[3],fields[4]].every((value,index)=>Buffer.from(value,'base64').length===(index?32:16)
    && Buffer.from(value,'base64').toString('base64')===value),'READONLY_ROLE_SCRAM_REQUIRED');
  const name=role();check(/^[a-z_]{8,63}$/.test(name),'READONLY_ROLE_NAME_INVALID');
  return `begin;
do $$ begin
 if not exists(select 1 from fcos_release_coordination.control where singleton and mode='frozen' and epoch=1
  and operation_id is null and bootstrap_id is null and recovery_id is null and source_upgrade_id is null and plan_completion_id is null)
 then raise exception 'READONLY_ROLE_FROZEN_SETUP_REQUIRED';end if;
 if exists(select 1 from pg_roles where rolname='${name}') then raise exception 'READONLY_ROLE_ALREADY_EXISTS';end if;
end $$;
create role ${name} login nosuperuser noinherit nocreatedb nocreaterole noreplication nobypassrls password '${scram}';
alter role ${name} set default_transaction_read_only=on;
grant connect on database postgres to ${name};
grant usage on schema fcos_release_coordination to ${name};
grant select on fcos_release_coordination.control to ${name};
grant select(operation_id,phase) on fcos_release_coordination.operations to ${name};
grant select(operation_id,event_id,state) on fcos_release_coordination.operation_events to ${name};
create policy rapid_readonly_control on fcos_release_coordination.control for select to ${name} using(true);
create policy rapid_readonly_operations on fcos_release_coordination.operations for select to ${name} using(true);
create policy rapid_readonly_events on fcos_release_coordination.operation_events for select to ${name} using(true);
commit;`;
}
