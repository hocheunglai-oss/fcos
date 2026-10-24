import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier, fcosSalesforceEnvironment, fcosRuntimeConnectionCatalogue } from '../config/fcosConnections.js';
import { isDeploymentReadOnly } from './_deploymentReadOnly.js';
import { externalActionGates } from './_externalActionGates.js';
import { fcunoFederationConfig } from './_fcunoIdentityFederation.js';
import { serverSupabaseConfig } from './_supabaseConfig.js';
import { getAccessToken, getApiVersion, getInstanceUrl } from './_salesforce.js';
import { observeRuntimeXero, runtimeProbeRequestId, createRuntimeProbeDeadline } from './_xeroRuntimeObservation.js';
import runtimePolicy from '../config/preview-parity-policy.json' with { type: 'json' };

const unknown = (target = '', mode = '', code = 'AUTHENTICATION_UNOBSERVED') => ({ state: 'unknown', target, mode, code });
const authenticated = (target, mode) => ({ state: 'authenticated', target, mode });
const clean = (value) => String(value || '').trim();
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Claims alone are not proof. A recognized type still requires acceptance by
// the independently pinned Supabase endpoint before authentication is reported.
export function supabaseDiagnosticCredentialMode(key, now = Date.now()) {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key || '')) return 'secret_key';
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.role !== 'service_role' || claims.ref !== fcosConnectionIdentifier('supabase', 'Project ref')
      || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now + 90000) return null;
    return 'service_role';
  } catch { return null; }
}

export function runtimeDeploymentBinding(env, receipt) {
  const deploymentId = clean(env.VERCEL_DEPLOYMENT_ID);
  const sha = clean(env.VERCEL_GIT_COMMIT_SHA || env.FCOS_BUILD_COMMIT_SHA);
  const suppliedShas = [env.VERCEL_GIT_COMMIT_SHA, env.FCOS_BUILD_COMMIT_SHA].map(clean).filter(Boolean);
  const provenance = receipt?.provenance;
  const cleanSource = provenance?.gitDirty === false
    || (provenance?.gitDirty === null && provenance?.sourceAttested === true);
  const validProvenance = provenance?.schemaVersion === 1
    && provenance?.sourceDigestAlgorithm === 'sha256:fcos-vercel-source-v1'
    && provenance?.releaseEligible === true && cleanSource;
  const sourceDigest = receipt?.provenance?.sourceDigest;
  if (new Set(suppliedShas).size > 1 || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId) || !/^[0-9a-f]{40}$/.test(sha)
    || receipt?.deploymentId !== deploymentId || receipt?.commit !== sha || receipt?.gitDirty !== provenance?.gitDirty
    || !/^[0-9a-f]{64}$/.test(sourceDigest || '') || receipt?.provenance?.commit !== sha
    || !validProvenance) {
    throw Object.assign(new Error('Runtime deployment binding is unavailable.'), { status: 503, code: 'RUNTIME_BINDING_UNAVAILABLE' });
  }
  return { deploymentId, sha, sourceDigest };
}

/** Provider data reads are GET/SELECT only. Salesforce uses application auth,
 * which may acquire/renew a session through the existing OAuth grant helper.
 * Xero uses its own normal durable quota budget/request; no financial mutation,
 * Xero renewal, reconciliation, publication or allowance exception is available. */
export async function probeRuntimeConnections({ env = process.env, client, actorId, requestId, receipt, fetchImpl = fetch, now = Date.now(),
  observeXero = observeRuntimeXero, clock = Date.now, deadline = createRuntimeProbeDeadline() } = {}) {
  const binding = runtimeDeploymentBinding(env, receipt);
  if (!runtimeProbeRequestId(actorId) || !runtimeProbeRequestId(requestId)) {
    throw Object.assign(new Error('Runtime probe identity is unavailable.'), { code: 'RUNTIME_XERO_SCOPE_INVALID' });
  }
  const fetchJson = async (url, headers) => {
    const response = await deadline.run(() => fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(deadline.remaining()) }));
    if (!response.ok) return null;
    return deadline.run(() => response.json()).catch(() => null);
  };
  const attempt = async (target, mode, probe) => {
    try { return await probe() ? authenticated(target, mode) : unknown(target, mode); }
    catch { return unknown(target, mode, 'READ_PROBE_FAILED'); }
  };
  const config = serverSupabaseConfig(env);
  const supabaseRef = fcosConnectionIdentifier('supabase', 'Project ref');
  const supabaseUrl = `https://${supabaseRef}.supabase.co`;
  const supabaseMode = supabaseDiagnosticCredentialMode(config.key, now);
  const sf = fcosSalesforceEnvironment('production');
  // Probe sequentially. An unknown/refused provider never launches another
  // provider read; already successful reads are not used to bypass a refusal.
  const supabase = config.url === supabaseUrl && supabaseMode
      ? await attempt(supabaseRef, supabaseMode, async () => {
        const headers = { apikey: config.key, ...(supabaseMode === 'service_role' ? { authorization: `Bearer ${config.key}` } : {}) };
        const rows = await fetchJson(`${supabaseUrl}/rest/v1/user_profiles?select=id&limit=1`, headers);
        return Array.isArray(rows);
      }) : unknown(supabaseRef, '', 'TARGET_OR_CREDENTIAL_UNVERIFIED');
  const salesforce = supabase.state === 'authenticated'
    && (!clean(env.SALESFORCE_INSTANCE_URL) || clean(env.SALESFORCE_INSTANCE_URL) === sf.instanceUrl)
      && clean(getInstanceUrl()) === sf.instanceUrl
      ? await attempt(sf.orgId, 'application', async () => {
        // Application provenance is observed; the helper does not expose the
        // selected grant type or whether it reused an existing session.
        // Bound our wait, not the shared helper: its OAuth call has no abort
        // API and may finish/cache a session later. A timeout never resumes this
        // probe, retries authentication or issues a later Organization query.
        const authTimeout = deadline.remaining(), authDeadline = performance.now() + authTimeout;
        let authTimer, accessToken;
        try {
          const deadline = new Promise((_, reject) => {
            authTimer = setTimeout(() => reject(new Error('Salesforce authentication deadline exceeded.')), authTimeout);
          });
          accessToken = await Promise.race([Promise.resolve().then(() => getAccessToken()), deadline]);
        } finally {
          clearTimeout(authTimer);
        }
        if (performance.now() >= authDeadline || !clean(accessToken) || clean(getInstanceUrl()) !== sf.instanceUrl) return false;
        const apiVersion = clean(getApiVersion());
        const version = /^v\d+\.\d+$/.test(apiVersion) ? apiVersion : 'v67.0';
        const data = await fetchJson(`${sf.instanceUrl}/services/data/${version}/query?q=${encodeURIComponent('SELECT Id, IsSandbox FROM Organization LIMIT 1')}`,
          { authorization: `Bearer ${accessToken}` });
        return data?.records?.length === 1 && data.records[0].Id === sf.orgId && data.records[0].IsSandbox === false;
      }) : unknown(sf.orgId, 'application', 'TARGET_OR_CREDENTIAL_UNVERIFIED');
  const expectedTenant = clean(env.XERO_TENANT_ID);
  const xeroObservation = supabase.state === 'authenticated' && salesforce.state === 'authenticated' && uuid(expectedTenant) && client
    ? await observeXero({ client, actorId, requestId, binding, tenantId: expectedTenant, fetchImpl, now: clock, deadline })
    : null;
  const xero = xeroObservation?.auth || unknown('', '', 'TENANT_OR_PRIOR_PROVIDER_UNVERIFIED');
  const runtimeValidUntil = new Date(Math.min(now + runtimePolicy.maxAgeSeconds * 1000,
    xeroObservation ? Date.parse(xeroObservation.runtimeValidUntil) : Infinity)).toISOString();
  const federation = fcunoFederationConfig(env);
  const flags = {
    VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED: clean(env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED).toLowerCase() === 'true',
    FCOS_ENABLE_FCUNO_FEDERATION: federation.federationEnabled,
    FCOS_ENABLE_FCUNO_IDENTITY_SYNC: federation.syncEnabled,
    FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN: federation.legacyPasswordEnabled,
  };
  return {
    schemaVersion: 1, ...binding, configuration: fcosRuntimeConnectionCatalogue(env), capturedAt: new Date(now).toISOString(), runtimeValidUntil,
    flags: Object.fromEntries(Object.entries(flags).map(([key, value]) => [key, { state: 'known', value }])),
    safety: { readOnly: isDeploymentReadOnly(env), externalActions: Object.fromEntries(Object.entries(externalActionGates(env)).map(([key, gate]) => [key, gate.enabled])) },
    auth: {
      supabase, salesforce, xero,
      drive: unknown(FCOS_CONNECTION_POLICY.integrations.googleDriveMarketReports.accountEmail, '', 'NON_REFRESHING_SESSION_UNAVAILABLE'),
      fcuno: unknown(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer, 'oidc', 'INTEGRATION_AUTHENTICATION_UNOBSERVED'),
      microsoft: unknown('', '', 'TENANT_AND_SESSION_UNVERIFIED'),
      openai: unknown('', '', 'ORGANIZATION_AND_PROJECT_UNVERIFIED'),
    },
  };
}
