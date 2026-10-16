import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { need } from './core.mjs';
export function assertIsolatedEnvironment(env) {
  const values=typeof env.toObject==='function'?env.toObject():env;
  const forbidden=/^(?:SUPABASE_(?:DB_URL|SERVICE_ROLE_KEY|SECRET_KEYS|SECRET_KEY|ACCESS_TOKEN)|GH_TOKEN|GITHUB_TOKEN|VERCEL_TOKEN|SALESFORCE_ACCESS_TOKEN|SF_ACCESS_TOKEN|DATABASE_URL|POSTGRES_URL|FCOS_RELEASE_(?:VERCEL|GH|RUNTIME|PREVIEW_RUNTIME)_TOKEN|XERO_.*(?:TOKEN|SECRET)|GOOGLE_.*(?:TOKEN|SECRET)|OPENAI_API_KEY)$/;
  need(!Object.entries(values).some(([name,value])=>(forbidden.test(name)||/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(name)&&name!=='FCOS_COORDINATOR_GITHUB_METADATA_TOKEN')&&value),'COORDINATION_BROAD_CREDENTIAL_FORBIDDEN',500);
  const connectionString=typeof env.get==='function'?env.get('FCOS_COORDINATOR_DATABASE_URL'):env.FCOS_COORDINATOR_DATABASE_URL;
  let url;try{url=new URL(connectionString);}catch{need(false,'COORDINATION_DATABASE_ROLE_INVALID',500);}
  need(url.protocol==='postgresql:'&&url.hostname===`db.${fcosConnectionIdentifier('supabase','Project ref')}.supabase.co`
    &&decodeURIComponent(url.username)==='fcos_coordinator_runtime'&&url.pathname==='/postgres'
    &&url.searchParams.get('sslmode')==='verify-full'&&!url.hash,'COORDINATION_DATABASE_ROLE_INVALID',500);
  return connectionString;
}
export async function verifyDatabaseIdentity(query) {
  const {rows}=await query(`select current_user as identity, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
    exists(select 1 from pg_auth_members m where m.member=r.oid) as memberships,
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema','fcos_release_coordination') and n.nspname not like 'pg_toast%'
      and c.relkind in ('r','p','v','m','f') and has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as application_access,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname not in ('pg_catalog','information_schema','fcos_release_coordination')
      and p.prosecdef and has_schema_privilege(r.oid,n.oid,'USAGE') and has_function_privilege(r.oid,p.oid,'EXECUTE')) as external_definer_access
    from pg_roles r where r.rolname=current_user`);
  const r=rows[0];need(r?.identity==='fcos_coordinator_runtime'&&!r.rolsuper&&!r.rolcreaterole&&!r.rolcreatedb&&!r.rolbypassrls
    &&!r.memberships&&!r.application_access&&!r.external_definer_access,'COORDINATION_DATABASE_PRIVILEGES_INVALID',500);
  return true;
}
