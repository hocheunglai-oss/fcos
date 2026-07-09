import { createSign } from 'node:crypto';

const DEFAULT_INSTANCE_URL = 'https://fratellicosulich.my.salesforce.com';
const DEFAULT_API_VERSION = 'v59.0';

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let cachedInstanceUrl = null;

export function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

export function getInstanceUrl() {
  return process.env.SALESFORCE_INSTANCE_URL || cachedInstanceUrl || DEFAULT_INSTANCE_URL;
}

export function getApiVersion() {
  return process.env.SALESFORCE_API_VERSION || DEFAULT_API_VERSION;
}

async function refreshAccessToken() {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const refreshToken = process.env.SALESFORCE_REFRESH_TOKEN;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Salesforce token refresh failed');

  cacheSalesforceToken(data);
  return cachedToken;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function jwtBearerConfig() {
  const clientId = process.env.SALESFORCE_JWT_CLIENT_ID || process.env.SALESFORCE_CLIENT_ID;
  const username = process.env.SALESFORCE_JWT_USERNAME || process.env.SALESFORCE_USERNAME;
  const privateKey = process.env.SALESFORCE_JWT_PRIVATE_KEY;
  return { clientId, username, privateKey };
}

function hasJwtBearerConfig() {
  const { clientId, username, privateKey } = jwtBearerConfig();
  return Boolean(clientId && username && privateKey);
}

function cacheSalesforceToken(data = {}) {
  cachedToken = data.access_token;
  cachedInstanceUrl = data.instance_url || cachedInstanceUrl;
  const issuedAt = Number(data.issued_at);
  const baseTime = Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : Date.now();
  cachedTokenExpiresAt = baseTime + 50 * 60 * 1000;
}

function createJwtBearerAssertion() {
  const { clientId, username, privateKey } = jwtBearerConfig();
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientId,
    sub: username,
    aud: loginUrl,
    exp: Math.floor(Date.now() / 1000) + 180,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey));
  return `${unsigned}.${base64Url(signature)}`;
}

async function jwtBearerAccessToken() {
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: createJwtBearerAssertion(),
  });

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Salesforce JWT bearer token request failed');

  cacheSalesforceToken(data);
  return cachedToken;
}

export function salesforceAuthMode() {
  if (hasJwtBearerConfig()) return 'jwt';
  if (process.env.SALESFORCE_CLIENT_ID && process.env.SALESFORCE_CLIENT_SECRET && process.env.SALESFORCE_REFRESH_TOKEN) return 'refresh_token';
  if (process.env.SALESFORCE_ACCESS_TOKEN) return 'access_token';
  return 'missing';
}

export async function getAccessToken({ forceRefresh = false } = {}) {
  if (hasJwtBearerConfig()) {
    if (!forceRefresh && cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
    return jwtBearerAccessToken();
  }

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const refreshToken = process.env.SALESFORCE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    if (!forceRefresh && cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
    return refreshAccessToken();
  }

  if (process.env.SALESFORCE_ACCESS_TOKEN) return process.env.SALESFORCE_ACCESS_TOKEN;

  throw new Error('Missing Salesforce env vars. Configure Salesforce JWT bearer env vars or set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_REFRESH_TOKEN in Vercel.');
}

export function cleanRecord(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanRecord);
  const { attributes, ...rest } = obj;
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, cleanRecord(value)]));
}

export async function sfRequest(path, { method = 'GET', body, retryOnExpiredSession = true } = {}) {
  const accessToken = await getAccessToken();
  const url = `${getInstanceUrl()}/services/data/${getApiVersion()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  const errorCode = data.errorCode || data[0]?.errorCode;
  if (retryOnExpiredSession && errorCode === 'INVALID_SESSION_ID') {
    cachedToken = null;
    cachedTokenExpiresAt = 0;
    return sfRequest(path, { method, body, retryOnExpiredSession: false });
  }
  if (!res.ok || data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
    throw new Error(data.message || data[0]?.message || `${method} ${path} failed`);
  }
  return data;
}

export async function sfDownload(path, { retryOnExpiredSession = true } = {}) {
  const accessToken = await getAccessToken();
  const url = `${getInstanceUrl()}/services/data/${getApiVersion()}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (retryOnExpiredSession && res.status === 401) {
    cachedToken = null;
    cachedTokenExpiresAt = 0;
    return sfDownload(path, { retryOnExpiredSession: false });
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data[0]?.message || `GET ${path} failed`);
  }

  return {
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

export async function sfQuery(soql, { clean = false, limit = 2000, softFail = false } = {}) {
  try {
    let data = await sfRequest(`/query/?q=${encodeURIComponent(soql)}`);
    let records = data.records || [];
    const totalSize = data.totalSize ?? records.length;

    while (data.nextRecordsUrl && records.length < limit) {
      data = await sfRequest(data.nextRecordsUrl.replace(`/services/data/${getApiVersion()}`, ''));
      records = records.concat(data.records || []);
    }

    return { records: clean ? records.map(cleanRecord) : records, totalSize };
  } catch (error) {
    if (softFail) return { records: [], totalSize: 0, error: error.message };
    throw error;
  }
}

export function chunkIds(ids, size = 200) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}
