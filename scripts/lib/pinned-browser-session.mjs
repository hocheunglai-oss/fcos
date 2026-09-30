import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../../config/fcosConnections.js';

const error = (code, cleanup) => Object.assign(new Error(code), { code, ...(cleanup ? { cleanup } : {}) });
const fail = (code) => { throw error(code); };
const unavailable = new Set(['unavailable', 'unsupported', 'authentication_blocked', 'identity_mismatch']);
const productionOrigin = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;
const providerQueryKeys = new Set(['tab', 'section', 'search', 'filter', 'page', 'sort', 'q', 'type', 'state', 'client_id', 'redirect_uri', 'response_type', 'scope', 'code_challenge', 'code_challenge_method', 'prompt', 'access_type', 'include_granted_scopes', 'login_hint', 'continue', 'return_to', 'return_url', 'next', 'starturl']);
const secretsInUrl = /(?:token|secret|password|credential|authorization|saml|session|api[_-]?key)|^(?:code|sid|key)$/i;

export function approvedBrowserProfile({ provider, environment, purpose } = {}) {
  if (!['authentication', 'verification'].includes(purpose)) fail('BROWSER_PURPOSE_INVALID');
  if (provider === 'salesforce') {
    if (purpose !== 'authentication') fail('SALESFORCE_BROWSER_AUTH_ONLY');
    if (!['devee', 'qat', 'production'].includes(environment)) fail('BROWSER_TARGET_INVALID');
    return fcosSalesforceEnvironment(environment).browserProfile;
  }
  if (provider === 'drive') {
    if (purpose !== 'authentication' || environment !== 'production') fail('DRIVE_BROWSER_AUTH_ONLY');
    return FCOS_CONNECTION_POLICY.integrations.googleDriveMarketReports.browserProfile;
  }
  if (provider === 'salesforce-mirror' && environment === 'devee') {
    return FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce').publication.browserProfile;
  }
  if (['github', 'vercel', 'supabase', 'fcos'].includes(provider)
    && ['repository', 'development', 'preview', 'production'].includes(environment)) return FCOS_CONNECTION_POLICY.browserProfile;
  fail('BROWSER_TARGET_INVALID');
}

function safeUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { fail('BROWSER_URL_INVALID'); }
  if (String(value).length > 8192 || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.port
    || /[\\\u0000-\u0020]/.test(String(value)) || /%(?:00|0a|0d|2e|2f|5c)/i.test(parsed.pathname)) fail('BROWSER_URL_INVALID');
  for (const [key, val] of parsed.searchParams) {
    if (secretsInUrl.test(key) || !providerQueryKeys.has(key.toLowerCase()) || /[\u0000-\u001f]/.test(val)) fail('BROWSER_SECRET_URL_MATERIAL');
  }
  return parsed;
}
const beneath = (pathname, root) => pathname === root || pathname.startsWith(`${root}/`);
const authPath = (pathname) => pathname === '/' || pathname === '/login' || pathname === '/secur/login_portal.jsp' || pathname === '/services/oauth2/authorize';
const uiPath = (pathname) => !/^\/(?:api|assets|\.well-known)(?:\/|$)/i.test(pathname);

function validateTargetUrl(parsed, context, preview, depth = 0) {
  if (depth > 4) fail('BROWSER_REDIRECT_TARGET_INVALID');
  const { provider, environment, purpose } = context;
  let accepted = false;
  if (preview) accepted = parsed.origin === preview.origin && uiPath(parsed.pathname);
  else if (provider === 'fcos') accepted = environment === 'production' && parsed.origin === productionOrigin && uiPath(parsed.pathname);
  else if (provider === 'salesforce') accepted = parsed.origin === fcosSalesforceEnvironment(environment).instanceUrl && authPath(parsed.pathname);
  else if (provider === 'drive') accepted = parsed.origin === 'https://accounts.google.com'
    && (beneath(parsed.pathname, '/signin') || beneath(parsed.pathname, '/v3/signin') || ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(parsed.pathname));
  else if (provider === 'github' || provider === 'salesforce-mirror') {
    const repository = provider === 'github' ? fcosConnectionIdentifier('github', 'Repository')
      : FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce').publication.repository;
    accepted = parsed.origin === 'https://github.com' && (purpose === 'verification' ? beneath(parsed.pathname, `/${repository}`)
      : ['/login', '/login/device', '/login/oauth/authorize'].includes(parsed.pathname));
  } else if (provider === 'vercel') accepted = parsed.origin === 'https://vercel.com'
    && (purpose === 'authentication' ? beneath(parsed.pathname, '/login')
      : beneath(parsed.pathname, `/${fcosConnectionIdentifier('vercel', 'Team')}/${fcosConnectionIdentifier('vercel', 'Project')}`));
  else if (provider === 'supabase') accepted = parsed.origin === 'https://supabase.com'
    && (purpose === 'authentication' ? parsed.pathname === '/dashboard/sign-in'
      : beneath(parsed.pathname, `/dashboard/project/${fcosConnectionIdentifier('supabase', 'Project ref')}`));
  if (!accepted) fail('BROWSER_URL_TARGET_MISMATCH');
  // Redirect parameters must not open a second, arbitrary origin. OAuth scope
  // strings and plain UI filters are not interpreted as redirect destinations.
  for (const [key, val] of parsed.searchParams) {
    if (!['redirect_uri', 'continue', 'return_to', 'return_url', 'next', 'starturl'].includes(key.toLowerCase())) continue;
    let destination;
    try { destination = new URL(val, parsed.origin); } catch { fail('BROWSER_REDIRECT_TARGET_INVALID'); }
    if (destination.origin !== parsed.origin || destination.username || destination.password || destination.hash
      || secretsInUrl.test(destination.search)) fail('BROWSER_REDIRECT_TARGET_INVALID');
    validateTargetUrl(safeUrl(destination.href), context, preview, depth + 1);
  }
  return parsed.href;
}

async function bindPreviewTarget(context, verifyDeployment, now) {
  if (!(context.environment === 'preview' && ['fcos', 'vercel'].includes(context.provider) && context.purpose === 'verification')) return null;
  if (typeof verifyDeployment !== 'function' || typeof context.expectedSha !== 'string' || !/^[0-9a-f]{40}$/.test(context.expectedSha)) fail('BROWSER_PREVIEW_VERIFICATION_UNAVAILABLE');
  const target = safeUrl(context.deploymentUrl);
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(target.hostname) || target.pathname !== '/' || target.search) fail('BROWSER_PREVIEW_TARGET_INVALID');
  const pins = { account: fcosConnectionIdentifier('vercel', 'Account'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), projectId: fcosConnectionIdentifier('vercel', 'Project ID') };
  let proof;
  try { proof = await verifyDeployment(target.origin, { provider: 'vercel', environment: 'preview', expectedSha: context.expectedSha, ...pins }); }
  catch { fail('BROWSER_PREVIEW_VERIFICATION_FAILED'); }
  let verifiedUrl;
  try { verifiedUrl = safeUrl(proof?.url); } catch { fail('BROWSER_PREVIEW_PROOF_INVALID'); }
  const age = now() - Date.parse(proof?.verifiedAt || '');
  if (proof?.account !== pins.account || proof?.teamId !== pins.teamId || proof?.projectId !== pins.projectId
    || proof?.environment !== 'preview' || proof?.readyState !== 'READY' || proof?.sha !== context.expectedSha
    || !/^dpl_[A-Za-z0-9]+$/.test(proof?.deploymentId || '') || verifiedUrl.origin !== target.origin
    || verifiedUrl.pathname !== '/' || verifiedUrl.search || !Number.isFinite(age)
    || age < -FCOS_CONNECTION_POLICY.attestation.maxClockSkewSeconds * 1000
    || age > FCOS_CONNECTION_POLICY.attestation.freshnessSeconds * 1000) fail('BROWSER_PREVIEW_PROOF_INVALID');
  return Object.freeze({ origin: target.origin, verifiedAt: Date.parse(proof.verifiedAt) });
}

/** The injected deployment verifier must independently use the pinned CLI/API.
 * Browser methods must expose documented inventory/metadata and a task-owned
 * session release; release must not terminate another caller's browser runtime.
 * open must create a new task-owned tab, never reuse or claim an existing tab.
 */
export async function createPinnedBrowserSession({ api, context, routes, explicitBrowserRequest = false, verifyDeployment, now = Date.now }) {
  if (routes?.approvalDenied) fail('BROWSER_APPROVAL_DENIED');
  if (!explicitBrowserRequest && (!unavailable.has(routes?.cli) || !unavailable.has(routes?.api))) fail('BROWSER_FALLBACK_NOT_JUSTIFIED');
  const profile = approvedBrowserProfile(context);
  if (['list', 'select', 'release', 'open', 'close'].some((method) => typeof api?.[method] !== 'function')) fail('BROWSER_PROFILE_VERIFICATION_UNSUPPORTED');
  const preview = await bindPreviewTarget(context, verifyDeployment, now);
  let inventory;
  try { inventory = await api.list(); } catch { fail('BROWSER_INVENTORY_UNAVAILABLE'); }
  if (!Array.isArray(inventory)) fail('BROWSER_INVENTORY_INVALID');
  const candidates = inventory.filter((browser) => browser?.type === 'extension'
    && browser?.metadata?.profileName === profile && typeof browser?.id === 'string');
  if (candidates.length !== 1) fail('BROWSER_PINNED_PROFILE_UNAVAILABLE');
  const browser = candidates[0];
  let selected;
  try { selected = await api.select(browser.id); }
  catch {
    let released = true;
    try { await api.release(browser.id); } catch { released = false; }
    throw error('BROWSER_SELECTION_FAILED', { complete: false, remainingOwnedTabs: 0, ownershipUncertain: true,
      blockers: ['BROWSER_SESSION_OWNERSHIP_UNCERTAIN', ...(!released ? ['BROWSER_SESSION_RELEASE_FAILED'] : [])] });
  }
  if (selected?.id !== browser.id || selected?.type !== 'extension' || selected?.metadata?.profileName !== profile) {
    let released = true;
    try { await api.release(browser.id); } catch { released = false; }
    throw error('BROWSER_SELECTED_PROFILE_MISMATCH', { complete: false, remainingOwnedTabs: 0, ownershipUncertain: true,
      blockers: ['BROWSER_SESSION_OWNERSHIP_UNCERTAIN', ...(!released ? ['BROWSER_SESSION_RELEASE_FAILED'] : [])] });
  }
  const tabs = new Set();
  let state = 'active', ownershipUncertain = false, released = false;
  let tail = Promise.resolve(), cleanupWork;
  const performCleanup = () => {
    if (cleanupWork) return cleanupWork;
    cleanupWork = (async () => {
      const blockers = [];
      for (const id of tabs) {
        try { await api.close(browser.id, id); tabs.delete(id); } catch { blockers.push('BROWSER_TAB_CLEANUP_FAILED'); }
      }
      if (!released) {
        try { await api.release(browser.id); released = true; } catch { blockers.push('BROWSER_SESSION_RELEASE_FAILED'); }
      }
      state = 'closed';
      if (ownershipUncertain) blockers.push('BROWSER_SESSION_OWNERSHIP_UNCERTAIN');
      return { complete: blockers.length === 0 && tabs.size === 0, remainingOwnedTabs: tabs.size, ownershipUncertain, blockers: [...new Set(blockers)] };
    })().finally(() => { cleanupWork = undefined; });
    return cleanupWork;
  };
  return {
    profile, browserId: browser.id,
    open(url) {
      if (state !== 'active') return Promise.reject(error('BROWSER_SESSION_CLOSED'));
      const pending = tail.then(async () => {
        if (state !== 'active') fail('BROWSER_SESSION_CLOSED');
        let tab;
        let opening = false;
        try {
          const parsed = safeUrl(url);
          if (preview && now() - preview.verifiedAt > FCOS_CONNECTION_POLICY.attestation.freshnessSeconds * 1000) fail('BROWSER_PREVIEW_PROOF_EXPIRED');
          const href = validateTargetUrl(parsed, context, preview);
          opening = true;
          tab = await api.open(browser.id, href);
          const validId = typeof tab?.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(tab.id) || Number.isSafeInteger(tab?.id) && tab.id >= 0;
          if (!validId || tab.browserId !== browser.id) {
            ownershipUncertain = true;
            fail('BROWSER_TAB_PROFILE_MISMATCH');
          }
          tabs.add(tab.id); // Only confirmed task-owned tabs may ever be closed.
          if (tab.url) validateTargetUrl(safeUrl(tab.url), context, preview);
          if (state !== 'active') fail('BROWSER_SESSION_CLOSED');
          return tab;
        } catch (cause) {
          if (opening && !tabs.has(tab?.id)) ownershipUncertain = true;
          state = 'closing';
          const cleanup = await performCleanup();
          const code = /^BROWSER_[A-Z_]+$/.test(cause?.code || '') ? cause.code : 'BROWSER_TAB_OPEN_FAILED';
          throw error(code, cleanup);
        }
      });
      tail = pending.catch(() => {});
      return pending;
    },
    cleanup() {
      // Seal immediately; no queued or newly requested open may begin afterward.
      if (state === 'active') state = 'closing';
      return tail.then(performCleanup);
    },
  };
}
