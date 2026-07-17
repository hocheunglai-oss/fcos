import { createHmac, randomUUID } from 'node:crypto';

export const FCOS_BACKBONE_BRIDGE_PATH = '/api/fcos/v1/bridge';
export const FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION = '2026-07-17.1';
export const FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS = new Set([
  '2026-07-15.1',
  '2026-07-16.2',
  FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION,
]);
export const FCOS_BACKBONE_BRIDGE_CREDENTIAL_VERSIONS = new Set(['primary', 'previous']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedIdentityEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function identityDriftError() {
  const error = new Error('FCOS sign-in and active profile identities are out of sync.');
  error.status = 409;
  return error;
}

export function backboneBridgeActor(accessContext) {
  const authUserId = String(accessContext?.authUser?.id || '').trim();
  const profileId = String(accessContext?.profile?.id || '').trim();
  const authEmail = normalizedIdentityEmail(accessContext?.authUser?.email);
  const profileEmail = normalizedIdentityEmail(accessContext?.profile?.email);

  if (!UUID_PATTERN.test(authUserId)
    || profileId !== authUserId
    || !authEmail
    || profileEmail !== authEmail
    || accessContext?.profile?.active !== true) {
    throw identityDriftError();
  }

  return { userId: authUserId, email: authEmail };
}

export function authenticatedBackboneBridgePayload(payload, accessContext) {
  return {
    ...payload,
    actor: backboneBridgeActor(accessContext),
  };
}

function withoutSalesforceRecordIds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const safe = { ...value };
  delete safe.salesforceEnquiryId;
  delete safe.salesforceStemId;
  return safe;
}

export function browserSafeBackboneTradeProjection(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response;
  const safe = { ...response };
  if (safe.trade) safe.trade = withoutSalesforceRecordIds(safe.trade);
  if (Array.isArray(safe.stems)) safe.stems = safe.stems.map(withoutSalesforceRecordIds);
  if (Array.isArray(safe.items)) safe.items = safe.items.map(withoutSalesforceRecordIds);
  return safe;
}

export function backboneBridgeConfig(env = process.env) {
  const baseUrl = String(env.FCOS_BACKBONE_URL || 'https://fcbhk-erp.vercel.app').trim().replace(/\/+$/, '');
  const secret = String(env.FCOS_BACKBONE_BRIDGE_SECRET || '').trim();
  return {
    baseUrl,
    secret,
    configured: secret.length >= 32,
  };
}

export function canonicalBackboneBridgeRequest({ timestamp, requestId, method = 'POST', path = FCOS_BACKBONE_BRIDGE_PATH, body }) {
  return [timestamp, requestId.toLowerCase(), method.toUpperCase(), path, body].join('\n');
}

export function signBackboneBridgeRequest(secret, input) {
  return createHmac('sha256', secret).update(canonicalBackboneBridgeRequest(input)).digest('hex');
}

export async function backboneBridgeRequest(payload, options = {}) {
  const config = backboneBridgeConfig(options.env);
  if (!config.configured) {
    const error = new Error('FCOS Backbone bridge is not configured.');
    error.status = 503;
    throw error;
  }
  const url = new URL(FCOS_BACKBONE_BRIDGE_PATH, `${config.baseUrl}/`);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    const error = new Error('FCOS Backbone bridge requires HTTPS.');
    error.status = 500;
    throw error;
  }

  const requestId = options.requestId || randomUUID();
  const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(payload);
  const signature = signBackboneBridgeRequest(config.secret, {
    timestamp,
    requestId,
    method: 'POST',
    path: FCOS_BACKBONE_BRIDGE_PATH,
    body,
  });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fcos-timestamp': timestamp,
      'x-fcos-request-id': requestId,
      'x-fcos-signature': signature,
    },
    body,
    signal: options.signal || AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `FCOS Backbone bridge failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS.has(data.schemaVersion)
    || data.requestId !== requestId) {
    const error = new Error('FCOS Backbone bridge returned an incompatible response.');
    error.status = 502;
    throw error;
  }
  const credentialVersion = response.headers.get('x-fcos-bridge-key-version');
  if (credentialVersion && !FCOS_BACKBONE_BRIDGE_CREDENTIAL_VERSIONS.has(credentialVersion)) {
    const error = new Error('FCOS Backbone bridge returned an incompatible credential status.');
    error.status = 502;
    throw error;
  }
  return { ...data, bridgeCredentialVersion: credentialVersion || 'unknown' };
}
