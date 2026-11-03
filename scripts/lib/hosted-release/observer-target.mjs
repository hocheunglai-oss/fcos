import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { readFileSync } from 'node:fs';

export function observerEndpoint(transport = 'direct') {
  const project = fcosConnectionIdentifier('supabase', 'Project ref');
  if (!['direct', 'session'].includes(transport)) throw new Error('SCHEMA_OBSERVER_TARGET');
  return { project, transport, port: 5432,
    host: transport === 'direct' ? `db.${project}.supabase.co` : fcosConnectionIdentifier('supabase', 'Session pooler host'),
    username: transport === 'direct' ? 'fcos_release_observer' : `fcos_release_observer.${project}` };
}

// Explicit session transport, never an automatic retry or regional-host guess.
export function assertObserverConnection(connectionString, project) {
  let url; try { url = new URL(connectionString); } catch { throw new Error('SCHEMA_OBSERVER_TARGET'); }
  const direct = observerEndpoint('direct'), session = observerEndpoint('session');
  const endpoint = url.hostname === direct.host ? direct : session;
  const params = [...url.searchParams.entries()];
  if (project !== direct.project || url.protocol !== 'postgresql:' || url.hostname !== endpoint.host
    || url.username !== endpoint.username || !url.password || url.pathname !== '/postgres' || url.hash
    || (url.port && url.port !== '5432') || url.searchParams.get('sslmode') !== 'verify-full'
    || params.some(([key]) => !['sslmode', 'sslrootcert'].includes(key))
    || new Set(params.map(([key]) => key)).size !== params.length
    || (url.searchParams.has('sslrootcert') && !['controller/supabase/functions/release-coordinator/supabase-root-2021.crt',
      'supabase/functions/release-coordinator/supabase-root-2021.crt'].includes(url.searchParams.get('sslrootcert'))))
    throw new Error('SCHEMA_OBSERVER_TARGET');
  return url;
}

export function observerClientConfiguration(connectionString, project) {
  const url = assertObserverConnection(connectionString, project);
  // Do not pass connectionString to pg: parsing it can replace explicit options
  // and an absent URL port otherwise falls through to PGPORT from the process.
  return { host: url.hostname, port: 5432, database: 'postgres', user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), options: '-c default_transaction_read_only=on -c search_path=pg_catalog',
    ssl: { ca: readFileSync(new URL('../../../supabase/functions/release-coordinator/supabase-root-2021.crt', import.meta.url)),
      rejectUnauthorized: true, servername: url.hostname } };
}
