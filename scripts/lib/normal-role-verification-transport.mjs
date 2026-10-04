import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';

const protectionHeaders = ['x-vercel-protection-bypass', 'x-vercel-set-bypass-cookie'];
export const NORMAL_ROLE_TRANSPORT_BLOCKED_REASONS = Object.freeze([
  'REQUEST_POLICY_DENIED',
  'UNSAFE_REQUEST',
  'NO_REDIRECT_RESPONSE',
  'TRANSPORT_FAILURE',
]);

export function stripNormalRoleProtectionHeaders(headers) {
  const clean = new Headers(headers);
  for (const name of protectionHeaders) clean.delete(name);
  return Object.fromEntries(clean.entries());
}

// Preserve Playwright's native repeated Set-Cookie representation for fulfill.
// WHATWG Headers rejects its newline-separated values. Cookie values remain
// opaque; only the two protection control names are removed.
export function stripNormalRoleResponseProtectionHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !protectionHeaders.includes(name.toLowerCase())));
}

/** The caller supplies its existing read policy; transport grants no authority.
 * Playwright continue() header overrides survive redirects. Keep the bypass
 * exclusively in a no-redirect Preview fetch, then fulfill the browser request
 * with the actual response. Approved foreign reads also refuse redirects and
 * receive clean headers, protecting their own existing authentication headers.
 */
export const NORMAL_ROLE_REQUEST_CATEGORIES = Object.freeze([
  'DEDICATED_NOTIFICATIONS', 'BACKGROUND_SYNC', 'PREFERENCE_INITIALIZATION', 'TELEMETRY', 'AUTH_REFRESH', 'UNKNOWN',
]);
const resourceTypes = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other']);
export function normalRoleRequestDiagnostic({ url, method, resourceType }, origin) {
  let target;
  try { target = new URL(url); } catch { /* Unknown remains a fixed category. */ }
  let category = 'UNKNOWN';
  if (target?.origin === origin) {
    if (target.pathname === '/api/work-notifications') category = 'DEDICATED_NOTIFICATIONS';
    else if (target.pathname === '/api/email-router-background-sync' || target.pathname === '/api/functions/emailRouterBackgroundSync') category = 'BACKGROUND_SYNC';
    else if (target.pathname === '/api/functions/workspacePreferencesSave') category = 'PREFERENCE_INITIALIZATION';
    else if (target.pathname.startsWith('/_vercel/speed-insights/')) category = 'TELEMETRY';
  } else if (target?.pathname === '/auth/v1/token') category = 'AUTH_REFRESH';
  return { category, method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method) ? method : 'OTHER',
    resourceType: resourceTypes.has(resourceType) ? resourceType : 'other' };
}

export function createNormalRoleVerificationRoute({ origin, protectionBypass, requestAllowed, onBlockedMutation,
  excludeRequest, onExcludedRequest, deniedReadsFatal = false }) {
  const preview = canonicalFcosE2eCandidateUrl(origin);
  if (preview !== origin || typeof requestAllowed !== 'function' || typeof onBlockedMutation !== 'function'
    || protectionBypass !== undefined && typeof protectionBypass !== 'string'
    || excludeRequest !== undefined && (typeof excludeRequest !== 'function' || typeof onExcludedRequest !== 'function')
    || typeof deniedReadsFatal !== 'boolean') {
    throw new Error('Normal-role verification transport configuration is invalid.');
  }
  return async route => {
    let diagnostic = { category: 'UNKNOWN', method: 'OTHER', resourceType: 'other' };
    const blocked = reason => onBlockedMutation(NORMAL_ROLE_TRANSPORT_BLOCKED_REASONS.includes(reason) ? reason : 'TRANSPORT_FAILURE', diagnostic);
    try {
      const request = route.request(), url = request.url(), method = request.method();
      const requestHeaders = request.headers();
      // Forward only an additive non-secret selector, never the private header
      // map. Duplicate/comma-separated, whitespace or oversized selectors deny.
      const selectors = Object.entries(requestHeaders).filter(([name]) => name.toLowerCase() === 'x-fcos-function-name');
      const headerSelector = selectors.length === 1 ? selectors[0][1] : undefined;
      const functionName = typeof headerSelector === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(headerSelector)
        ? headerSelector : undefined;
      const resourceType = typeof request.resourceType === 'function' ? request.resourceType() : 'other';
      diagnostic = normalRoleRequestDiagnostic({ url, method, resourceType }, preview);
      let body;
      try { body = request.postDataJSON(); } catch { body = undefined; /* BODY_JSON_UNAVAILABLE has no read authority. */ }
      const policyRequest = { url, method, body, functionName, resourceType,
        jsonContentType: /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(new Headers(requestHeaders).get('content-type') || '') };
      if (excludeRequest?.(policyRequest, preview)) {
        await route.abort();
        onExcludedRequest('SPEED_INSIGHTS_SCRIPT');
        return;
      }
      if (!requestAllowed(policyRequest, preview)) {
        if (deniedReadsFatal || !['GET', 'HEAD'].includes(method)) blocked('REQUEST_POLICY_DENIED');
        await route.abort(); return;
      }
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password
        || [...target.searchParams.keys()].some(name => protectionHeaders.includes(name.toLowerCase()))) {
        blocked('UNSAFE_REQUEST');
        await route.abort().catch(() => {}); return;
      }
      const headers = stripNormalRoleProtectionHeaders(requestHeaders);
      if (target.origin === preview && protectionBypass) headers['x-vercel-protection-bypass'] = protectionBypass;
      const response = await route.fetch({ headers, maxRedirects: 0, timeout: 20000 });
      const status = response.status();
      if (response.url() !== url || !Number.isInteger(status) || status < 200 || status > 599
        || status >= 300 && status < 400) {
        blocked('NO_REDIRECT_RESPONSE');
        await route.abort().catch(() => {}); return;
      }
      await route.fulfill({ response, headers: stripNormalRoleResponseProtectionHeaders(response.headers()) });
    } catch {
      // Request errors can include private headers. A failed transport blocks
      // complete coverage and reports no private error or response metadata.
      blocked('TRANSPORT_FAILURE');
      await route.abort().catch(() => {});
    }
  };
}
