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
export function createNormalRoleVerificationRoute({ origin, protectionBypass, requestAllowed, onBlockedMutation }) {
  const preview = canonicalFcosE2eCandidateUrl(origin);
  if (preview !== origin || typeof requestAllowed !== 'function' || typeof onBlockedMutation !== 'function'
    || protectionBypass !== undefined && typeof protectionBypass !== 'string') {
    throw new Error('Normal-role verification transport configuration is invalid.');
  }
  return async route => {
    const blocked = reason => onBlockedMutation(NORMAL_ROLE_TRANSPORT_BLOCKED_REASONS.includes(reason) ? reason : 'TRANSPORT_FAILURE');
    try {
      const request = route.request(), url = request.url(), method = request.method();
      let body;
      try { body = request.postDataJSON(); } catch { body = undefined; /* BODY_JSON_UNAVAILABLE has no read authority. */ }
      if (!requestAllowed({ url, method, body }, preview)) {
        if (!['GET', 'HEAD'].includes(method)) blocked('REQUEST_POLICY_DENIED');
        await route.abort(); return;
      }
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password
        || [...target.searchParams.keys()].some(name => protectionHeaders.includes(name.toLowerCase()))) {
        blocked('UNSAFE_REQUEST');
        await route.abort().catch(() => {}); return;
      }
      const headers = stripNormalRoleProtectionHeaders(request.headers());
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
