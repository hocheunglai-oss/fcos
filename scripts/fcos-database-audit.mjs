import { pathToFileURL } from 'node:url';
import { providerRuntime } from './fcos-connections.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

// Fixed catalog queries only; never accept arbitrary SQL, credentials or project IDs.
export const DATABASE_AUDIT_QUERY = `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access,
  has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service_access
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (c.relname LIKE 'cashflow_bank_%' OR c.relname LIKE 'variable_charge_%'
      OR c.relname LIKE 'hedge_physical_salesforce%' OR c.relname = 'cashflow_liquidity_instruments')
  ORDER BY c.relname`;

export async function runDatabaseAudit({ fetcher = fetch, runtime = providerRuntime('supabase') } = {}) {
  if (!runtime.credentialAvailable) throw new Error('Pinned Supabase authorization is unavailable.');
  const projectRef = fcosConnectionIdentifier('supabase', 'Project ref');
  const projectName = fcosConnectionIdentifier('supabase', 'Project name');
  const headers = { Authorization: `Bearer ${runtime.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  const request = async (path, options = {}) => {
    const response = await fetcher(`https://api.supabase.com/v1${path}`, {
      ...options, headers, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Supabase read-only audit failed (HTTP ${response.status}). No credentials or database contents logged.`);
    return response.json();
  };
  const projects = await request('/projects');
  const project = projects.find((item) => item.id === projectRef && item.name === projectName);
  if (!project) throw new Error('Pinned FCOS Supabase project identity could not be verified.');
  const tables = await request(`/projects/${projectRef}/database/query/read-only`, { method: 'POST', body: JSON.stringify({ query: DATABASE_AUDIT_QUERY }) });
  const config = await request(`/projects/${projectRef}/config/auth`);
  return { projectRef, projectName, tables, leakedPasswordProtection: config.password_hibp_enabled ?? null, readOnly: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runDatabaseAudit(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
