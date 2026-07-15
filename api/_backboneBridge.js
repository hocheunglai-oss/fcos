import { createHmac, randomUUID } from 'node:crypto';

export const FCOS_BACKBONE_BRIDGE_PATH = '/api/fcos/v1/bridge';
export const FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION = '2026-07-15.1';

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
  if (data.schemaVersion !== FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION || data.requestId !== requestId) {
    const error = new Error('FCOS Backbone bridge returned an incompatible response.');
    error.status = 502;
    throw error;
  }
  return data;
}
