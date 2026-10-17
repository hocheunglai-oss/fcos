import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { readFileSync } from 'node:fs';
import { need } from './core.mjs';
export function assertIsolatedEnvironment(env) {
  const values=typeof env.toObject==='function'?env.toObject():env;
  const forbidden=/^(?:SUPABASE_(?:DB_URL|SERVICE_ROLE_KEY|SECRET_KEYS|SECRET_KEY|ACCESS_TOKEN)|GH_TOKEN|GITHUB_TOKEN|VERCEL_TOKEN|SALESFORCE_ACCESS_TOKEN|SF_ACCESS_TOKEN|DATABASE_URL|POSTGRES_URL|FCOS_RELEASE_(?:VERCEL|GH|RUNTIME|PREVIEW_RUNTIME)_TOKEN|XERO_.*(?:TOKEN|SECRET)|GOOGLE_.*(?:TOKEN|SECRET)|OPENAI_API_KEY)$/;
  need(!Object.entries(values).some(([name,value])=>(forbidden.test(name)||/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(name)&&name!=='FCOS_COORDINATOR_GITHUB_METADATA_TOKEN')&&value),'COORDINATION_BROAD_CREDENTIAL_FORBIDDEN',500);
  const connectionString=typeof env.get==='function'?env.get('FCOS_COORDINATOR_DATABASE_URL'):env.FCOS_COORDINATOR_DATABASE_URL;
  validateDatabaseUrl(connectionString);
  return connectionString;
}
function validateDatabaseUrl(connectionString) {
  let url,user,password;
  try {url=new URL(connectionString);user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);}
  catch {need(false,'COORDINATION_DATABASE_ROLE_INVALID',500);}
  const ref=fcosConnectionIdentifier('supabase','Project ref');
  const direct=url.hostname===`db.${ref}.supabase.co`&&user==='fcos_coordinator_runtime';
  const session=url.hostname===fcosConnectionIdentifier('supabase','Session pooler host')&&user===`fcos_coordinator_runtime.${ref}`;
  // pg connection-string query parameters can override authority/TLS fields. Admit
  // exactly one TLS mode, and construct explicit driver options below as well.
  const query=[...url.searchParams];
  need(url.protocol==='postgresql:'&&(direct||session)&&(!url.port||url.port==='5432')
    &&url.pathname==='/postgres'&&password.length>0&&!url.hash
    &&query.length===1&&query[0][0]==='sslmode'&&query[0][1]==='verify-full','COORDINATION_DATABASE_ROLE_INVALID',500);
  return {url,user,password};
}
export function coordinatorDatabaseOptions(env) {
  const {url,user,password}=validateDatabaseUrl(assertIsolatedEnvironment(env));
  return {host:url.hostname,port:5432,user,password,database:'postgres',ssl:{rejectUnauthorized:true,servername:url.hostname,
    ca:readFileSync(new URL('./supabase-root-2021.crt',import.meta.url),'utf8')}};
}
export async function verifyDatabaseIdentity(query) {
  const {rows}=await query(`select current_user as identity, session_user as login_identity, current_database() as database_name,
    r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
    exists(select 1 from pg_auth_members m where m.member=r.oid) as memberships,
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema','fcos_release_coordination') and n.nspname not like 'pg_toast%'
      and c.relkind in ('r','p','v','m','f') and has_schema_privilege(r.oid,n.oid,'USAGE') and has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as application_access,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname not in ('pg_catalog','information_schema','fcos_release_coordination')
      and p.prosecdef and has_schema_privilege(r.oid,n.oid,'USAGE') and has_function_privilege(r.oid,p.oid,'EXECUTE')) as external_definer_access
    from pg_roles r where r.rolname=current_user`);
  const r=rows[0];need(r?.identity==='fcos_coordinator_runtime'&&r.login_identity==='fcos_coordinator_runtime'&&r.database_name==='postgres'
    &&!r.rolsuper&&!r.rolcreaterole&&!r.rolcreatedb&&!r.rolbypassrls
    &&!r.memberships&&!r.application_access&&!r.external_definer_access,'COORDINATION_DATABASE_PRIVILEGES_INVALID',500);
  return true;
}
