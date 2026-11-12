import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const EXPECTED_SUPABASE_URL = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const AUTH_CONFIGURATION_ERROR = 'FCOS authentication is not configured correctly. Contact an administrator; local administrator mode is unavailable on this site.';

function isPublicKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

// This is a UI startup guard, not an alternative to server authentication.
export function resolveAuthRuntimePolicy({ url, publicKey, development = false, hostname = '' } = {}) {
  const localDevelopment = development === true && LOOPBACK_HOSTS.has(hostname);
  const configuredUrl = typeof url === 'string' ? url.trim() : '';
  const configuredKey = typeof publicKey === 'string' ? publicKey.trim() : '';
  const empty = !configuredUrl && !configuredKey;
  let approvedUrl = configuredUrl === EXPECTED_SUPABASE_URL;
  if (localDevelopment && configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      approvedUrl ||= LOOPBACK_HOSTS.has(parsed.hostname)
        && ['http:', 'https:'].includes(parsed.protocol)
        && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
        && parsed.pathname === '/';
    } catch { /* Invalid configuration remains unavailable. */ }
  }
  const configured = Boolean(approvedUrl && isPublicKey(configuredKey));
  const localAdminAllowed = localDevelopment && empty;
  return {
    configured,
    localAdminAllowed,
    error: configured || localAdminAllowed ? null : AUTH_CONFIGURATION_ERROR,
  };
}
