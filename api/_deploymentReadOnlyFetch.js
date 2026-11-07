import { AsyncLocalStorage } from 'node:async_hooks';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { isDeploymentReadOnly, requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';

const supabaseOrigin = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const sessionProofWrite = new AsyncLocalStorage();

// The signed FCUNO verifier opens this scope for a single immutable proof row.
export function withVerifiedFcunoSessionInsert(binding, write) {
  return sessionProofWrite.run({ body: JSON.stringify(binding), consumed: false }, write);
}

function consumeVerifiedFcunoSessionInsert(url, method, headers, body) {
  const scope = sessionProofWrite.getStore();
  if (!scope || scope.consumed || method !== 'POST' || url.search
    || url.pathname !== '/rest/v1/fcos_external_identity_sessions'
    || ![null, 'public'].includes(headers.get('content-profile'))
    || ![null, 'return=minimal'].includes(headers.get('prefer'))
    || body !== scope.body) return false;
  scope.consumed = true;
  return true;
}

// Reviewed SQL read functions, required by access evaluation and Dashboard usage.
// Unknown RPCs remain denied even when invoked with GET or Prefer: tx=rollback.
export const READ_ONLY_SUPABASE_RPCS = Object.freeze(['fcos_effective_access', 'dashboard_ai_usage_summary']);

export function requireDeploymentSupabaseRequestAllowed(input, init = {}) {
  if (!isDeploymentReadOnly()) return;
  let url;
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); } catch { requireDeploymentMutationAllowed(true); }
  const method = String(init.method || input?.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || input?.headers);
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1];
  const readRpc = rpc && READ_ONLY_SUPABASE_RPCS.includes(rpc)
    && ['GET', 'HEAD', 'POST'].includes(method)
    && ['public', null].includes(headers.get(method === 'POST' ? 'content-profile' : 'accept-profile'));
  const read = !rpc && ['GET', 'HEAD'].includes(method)
    && (/^\/rest\/v1\/[a-zA-Z0-9_]+$/.test(url.pathname)
      || url.pathname === '/auth/v1/user'
      || /^\/storage\/v1\/object\/(?:authenticated\/)?[^/]+\/.+/.test(url.pathname));
  const approvedTarget = url.origin === supabaseOrigin && !url.username && !url.password && !url.hash;
  const verifiedProof = approvedTarget && consumeVerifiedFcunoSessionInsert(url, method, headers, init.body);
  requireDeploymentMutationAllowed(!(approvedTarget && (readRpc || read || verifiedProof)));
}

/** A cached service client still checks the current request at fetch time. */
export function deploymentSafeSupabaseFetch(input, init) {
  requireDeploymentSupabaseRequestAllowed(input, init);
  return fetch(input, init);
}
