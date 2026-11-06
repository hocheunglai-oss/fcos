import { readFileSync } from 'node:fs';
import { assertHandoverConnection } from './handover.mjs';
import { digest, requireCondition } from './contract.mjs';

// Catalog state only: no application, financial or credential rows leave PostgreSQL.
export const SCHEMA_FINGERPRINT_SQL = `select encode(sha256(convert_to(jsonb_build_object(
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage')),
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.atttypid,a.atttypmod,a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by n.nspname,c.relname,a.attnum),'[]') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ('public','auth','storage') and a.attnum>0 and not a.attisdropped),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl) order by n.nspname,p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage') and p.prokind in ('f','p')),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]') from pg_policies p where p.schemaname in ('public','auth','storage')),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname),'[]') from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage')),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and not t.tgisinternal)
 )::text,'UTF8')),'hex') as digest`;
export function nativeCompatibilityReader({ provider, env = process.env, createClient } = {}) {
  return async ({ manifest, previous = manifest.previous }) => {
    requireCondition(env.FCOS_RAPID_DATABASE_URL && env.FCOS_RAPID_DATABASE_CA, 'NATIVE_COMPATIBILITY_CONNECTION_REQUIRED');
    const url = new URL(env.FCOS_RAPID_DATABASE_URL);
    requireCondition(url.protocol === 'postgresql:' && !url.search && !url.hash, 'NATIVE_COMPATIBILITY_CONNECTION_INVALID');
    const connection = { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), database: url.pathname.slice(1),
      password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: true, ca: readFileSync(env.FCOS_RAPID_DATABASE_CA, 'utf8') } };
    assertHandoverConnection(connection);
    const Client = createClient || (await import('pg')).Client, db = new Client(connection);
    await db.connect();
    try {
      await db.query('begin isolation level repeatable read read only');
      const identity = (await db.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
      requireCondition(identity.session_user === 'postgres' && identity.current_user === 'postgres' && identity.database === 'postgres'
        && identity.read_only === 'on', 'NATIVE_COMPATIBILITY_DATABASE_IDENTITY_MISMATCH');
      const schemaDigest = (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
      requireCondition(/^[a-f0-9]{64}$/.test(schemaDigest || ''), 'NATIVE_SCHEMA_FINGERPRINT_REQUIRED');
      const configuration = await provider.nativeConfiguration(), current = await provider.currentProduction();
      await db.query('commit');
      return { deploymentId: previous.deploymentId, currentDeploymentId: current.id, sha: current.sha,
        schemaDigest, configurationDigest: digest(configuration), observedAt: new Date().toISOString() };
    } finally { await db.end(); }
  };
}
