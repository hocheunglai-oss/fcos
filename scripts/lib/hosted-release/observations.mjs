import pg from 'pg';
import { digest, fail } from './contract.mjs';
import { assertObserverConnection, observerClientConfiguration } from './observer-target.mjs';

// Logical catalog identities only: OIDs and ACL array order must not change a
// fingerprint, while effective access and executable relation behavior must.
export const SCHEMA_QUERY = `select jsonb_build_object(
 'schema',(select jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',
  (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
    order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
   from aclexplode(case when cardinality(n.nspacl)=0 then null else coalesce(n.nspacl,acldefault('n',n.nspowner)) end) x)) from pg_namespace n where n.nspname='public'),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),
   (select coalesce(jsonb_agg(option order by option),'[]') from unnest(c.reloptions) option),
   (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
     order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
    from aclexplode(case when cardinality(c.relacl)=0 then null else coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner)) end) x),
   case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) else null end) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')),
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attnum,pg_get_expr(d.adbin,d.adrelid),a.attnotnull,format_type(a.atttypid,a.atttypmod),
   (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
     order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
    from aclexplode(case when cardinality(a.attacl)=0 then null else a.attacl end) x)) order by c.relname,a.attnum),'[]')
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) order by c.relname,k.conname),'[]')
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(tablename,indexname,indexdef) order by tablename,indexname),'[]') from pg_indexes where schemaname='public'),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname),'[]') from pg_policies p where schemaname='public'),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,false)) order by c.relname,t.tgname),'[]')
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),
   (select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
     order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable),'[]')
    from aclexplode(case when cardinality(p.proacl)=0 then null else coalesce(p.proacl,acldefault('f',p.proowner)) end) x)) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p'))
) as snapshot`;

export function assertObserverTarget(connectionString, project) {
  if (!connectionString) fail('SCHEMA_OBSERVER_SETUP_REQUIRED');
  try { return assertObserverConnection(connectionString, project); } catch { fail('SCHEMA_OBSERVER_TARGET'); }
}
export async function collectSchemaObservation({ manifest, env = process.env, Client = pg.Client, now = Date.now }) {
  assertObserverTarget(env.FCOS_HOSTED_SCHEMA_DATABASE_URL, manifest.targets.supabaseProject);
  const client = new Client({ ...observerClientConfiguration(env.FCOS_HOSTED_SCHEMA_DATABASE_URL, manifest.targets.supabaseProject), connectionTimeoutMillis: 10000,
    statement_timeout: 15000, application_name: 'fcos-hosted-schema-read' });
  try {
    await client.connect();
    const { rows: [identity] } = await client.query(`select current_user as role,current_database() as database,
      r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls,
      exists(select 1 from pg_auth_members where member=r.oid) as memberships,
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema')
        and c.relkind in ('r','p') and (has_table_privilege(c.oid,'INSERT') or has_table_privilege(c.oid,'UPDATE') or has_table_privilege(c.oid,'DELETE') or has_table_privilege(c.oid,'TRUNCATE'))) as table_writes
      from pg_roles r where r.rolname=current_user`);
    if (identity.role !== 'fcos_release_observer' || identity.database !== 'postgres'
      || ['rolsuper','rolcreaterole','rolcreatedb','rolbypassrls','memberships','table_writes'].some(key => identity[key] !== false)) fail('SCHEMA_OBSERVER_PRIVILEGES');
    await client.query('begin isolation level repeatable read read only');
    await client.query('set local search_path = pg_catalog');
    const { rows: [result] } = await client.query(SCHEMA_QUERY);
    await client.query('commit');
    const sha256 = digest(result.snapshot);
    if (sha256 !== manifest.migration.expectedSchemaSha256) fail('LIVE_SCHEMA_CHANGED', 'live_schema', 'Reconcile the actual schema against the separately approved migration proof.');
    return { sha256, capturedAt: new Date(now()).toISOString(), target: manifest.targets.supabaseProject, readOnly: true };
  } catch (error) { if (error.code?.startsWith?.('SCHEMA_') || error.code === 'LIVE_SCHEMA_CHANGED') throw error; fail('SCHEMA_OBSERVATION_UNAVAILABLE', 'live_schema'); }
  finally { await client.end().catch(() => {}); }
}

export function hostedProof({ manifest, checkId, result, inputs, capturedAt, kind = 'volatile', env = process.env }) {
  const runId = Number(env.GITHUB_RUN_ID), jobId = Number(env.FCOS_VERIFIED_JOB_ID);
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(jobId) || jobId < 1) fail('OBSERVATION_PUBLISHER_IDENTITY');
  return { schemaVersion: 2, checkId, status: 'passed', kind, manifestHash: digest(manifest), candidateSha: manifest.candidate.sha,
    controllerSha: manifest.controller.sha, inputsSha256: digest(inputs), artifactSha256: digest(result), capturedAt,
    ...(kind === 'volatile' ? { maxAgeSeconds: 1800 } : {}), publisher: { trust: 'hosted_controller', runId, jobId }, result };
}
