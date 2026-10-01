import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier, fcosSalesforceEnvironment, fcosRuntimeConnectionCatalogue } from '../config/fcosConnections.js';
import { isDeploymentReadOnly } from './_deploymentReadOnly.js';
import { externalActionGates } from './_externalActionGates.js';
import { fcunoFederationConfig } from './_fcunoIdentityFederation.js';
import { serverSupabaseConfig } from './_supabaseConfig.js';

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
  // The producer permits missing upload-excluded controls only after verifying
  // immutable HEAD bytes and the supplied exact source digest. Ordinary dirty
  // checkouts cannot inherit this attested sanitized state.
  const cleanSource = provenance?.gitDirty === false
    || (provenance?.gitDirty === null && provenance?.sourceAttested === true)
    || (provenance?.gitDirty === true && provenance?.sanitizedCheckout === true
      && provenance?.sourceAttested === true && provenance?.commitVerified === true);
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

/** No refresh, POST, RPC, reconciliation, publication or persisted evidence. */
export async function probeRuntimeConnections({ env = process.env, client, receipt, fetchImpl = fetch, now = Date.now() }) {
  const binding = runtimeDeploymentBinding(env, receipt);
  const fetchJson = async (url, headers) => {
    const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return response.json().catch(() => null);
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
  const [supabase, salesforce, xero] = await Promise.all([
    config.url === supabaseUrl && supabaseMode
      ? attempt(supabaseRef, supabaseMode, async () => {
        const headers = { apikey: config.key, ...(supabaseMode === 'service_role' ? { authorization: `Bearer ${config.key}` } : {}) };
        const rows = await fetchJson(`${supabaseUrl}/rest/v1/user_profiles?select=id&limit=1`, headers);
        return Array.isArray(rows);
      }) : unknown(supabaseRef, '', 'TARGET_OR_CREDENTIAL_UNVERIFIED'),
    clean(env.SALESFORCE_INSTANCE_URL) === sf.instanceUrl && clean(env.SALESFORCE_ACCESS_TOKEN)
      ? attempt(sf.orgId, 'oauth', async () => {
        const version = /^v\d+\.\d+$/.test(clean(env.SALESFORCE_API_VERSION)) ? clean(env.SALESFORCE_API_VERSION) : 'v67.0';
        const data = await fetchJson(`${sf.instanceUrl}/services/data/${version}/query?q=${encodeURIComponent('SELECT Id, IsSandbox FROM Organization LIMIT 1')}`,
          { authorization: `Bearer ${env.SALESFORCE_ACCESS_TOKEN}` });
        return data?.records?.length === 1 && data.records[0].Id === sf.orgId && data.records[0].IsSandbox === false;
      }) : unknown(sf.orgId, '', 'EXISTING_ACCESS_SESSION_UNAVAILABLE'),
    (async () => {
      const expectedTenant = clean(env.XERO_TENANT_ID);
      if (!uuid(expectedTenant) || !client) return unknown('', '', 'TENANT_UNVERIFIED');
      return attempt(expectedTenant, 'oauth', async () => {
        const { data, error } = await client.from('xero_contact_sync_connections')
          .select('tenant_id,access_token,expires_at').eq('id', 'primary').maybeSingle();
        if (error || data?.tenant_id !== expectedTenant || !data?.access_token || Date.parse(data.expires_at || '') <= now + 90000
          || !Number.isFinite(Date.parse(data.expires_at || ''))) return false;
        const connections = await fetchJson('https://api.xero.com/connections', { authorization: `Bearer ${data.access_token}` });
        return Array.isArray(connections) && connections.some((entry) => entry?.tenantId === expectedTenant && entry?.tenantType === 'ORGANISATION');
      });
    })(),
  ]);
  const federation = fcunoFederationConfig(env);
  const flags = {
    VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED: clean(env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED).toLowerCase() === 'true',
    FCOS_ENABLE_FCUNO_FEDERATION: federation.federationEnabled,
    FCOS_ENABLE_FCUNO_IDENTITY_SYNC: federation.syncEnabled,
    FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN: federation.legacyPasswordEnabled,
  };
  return {
    schemaVersion: 1, ...binding, configuration: fcosRuntimeConnectionCatalogue(env), capturedAt: new Date(now).toISOString(),
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
