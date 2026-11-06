import { AsyncLocalStorage } from 'node:async_hooks';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const requestSafety = new AsyncLocalStorage();
const canonicalHostname = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;

function singleHostname(value) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value)) return null;
  const hostname = value.toLowerCase();
  if (hostname.includes('..') || hostname.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'))) return null;
  return hostname;
}

/** Host is the routing authority. Forwarded headers may only corroborate it. */
export function deploymentRequestSafety(req, env = process.env) {
  const hostValues = Object.entries(req?.headers || {}).filter(([key]) => key.toLowerCase() === 'host');
  const rawHosts = (req?.rawHeaders || []).filter((_, index, values) => index % 2 === 1 && String(values[index - 1]).toLowerCase() === 'host');
  let hostname = hostValues.length === 1 ? singleHostname(hostValues[0][1]) : null;
  if (rawHosts.length > 1 || (rawHosts.length === 1 && singleHostname(rawHosts[0]) !== hostname)) hostname = null;
  const forwardedHosts = Object.entries(req?.headers || {}).filter(([key]) => key.toLowerCase() === 'x-forwarded-host');
  if (forwardedHosts.length && (forwardedHosts.length !== 1 || singleHostname(forwardedHosts[0][1]) !== hostname)) hostname = null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(String(req?.url || ''))) {
    try { if (new URL(req.url).host !== hostname) hostname = null; } catch { hostname = null; }
  }
  const vercel = env.VERCEL === '1' || Boolean(env.VERCEL_ENV);
  const preview = String(env.VERCEL_ENV || '').trim().toLowerCase() === 'preview';
  const explicitReadOnly = String(env.FCOS_ENABLE_READ_ONLY_CI || '').trim().toLowerCase() === 'true';
  const staged = vercel && hostname !== canonicalHostname;
  return Object.freeze({ hostname, canonical: hostname === canonicalHostname, readOnly: preview || explicitReadOnly || staged,
    ciAllowed: explicitReadOnly || (Boolean(hostname) && (preview || staged)),
    reason: preview ? 'preview' : explicitReadOnly ? 'explicit_read_only' : staged ? 'noncanonical_or_unknown_host' : 'canonical_or_local' });
}

export function currentDeploymentRequestSafety() {
  return requestSafety.getStore() || null;
}

export function runWithDeploymentRequestSafety(req, run, env = process.env) {
  return requestSafety.run(deploymentRequestSafety(req, env), run);
}

/** Every public entrypoint establishes its own immutable scope before dispatch. */
export function withDeploymentRequestSafety(handler) {
  return function deploymentSafeHandler(req, res) {
    return runWithDeploymentRequestSafety(req, () => handler(req, res));
  };
}

export function isReadOnlyCiEnabled(env = process.env) {
  const safety = currentDeploymentRequestSafety();
  return safety ? safety.readOnly && safety.ciAllowed : env.FCOS_ENABLE_READ_ONLY_CI === 'true';
}

/** Request scope takes precedence; a helper cannot override it with another env. */
export function isDeploymentReadOnly(env = process.env) {
  const safety = currentDeploymentRequestSafety();
  if (safety) return safety.readOnly;
  return String(env.VERCEL_ENV || '').trim().toLowerCase() === 'preview'
    || String(env.FCOS_ENABLE_READ_ONLY_CI || '').trim().toLowerCase() === 'true'
    || env.VERCEL === '1' || Boolean(env.VERCEL_ENV);
}

export function requireDeploymentMutationAllowed(mutation, env = process.env) {
  if (!mutation || !isDeploymentReadOnly(env)) return;
  throw Object.assign(new Error('This verification environment permits read-only operations.'), {
    status: 403,
    code: 'FCOS_DEPLOYMENT_READ_ONLY',
  });
}
