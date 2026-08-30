import { createClient } from '@supabase/supabase-js';
import { processFcunoIdentitySync } from '../_fcunoIdentityFederation.js';
import { serverSupabaseConfig } from '../_supabaseConfig.js';
import { logRequestTelemetry, recordRequestFailure, requestIdFrom, runWithRequestTelemetry, telemetryResponseHeaders } from '../_requestTelemetry.js';

export const config = { api: { bodyParser: false } };
const MAX_BODY_BYTES = 64 * 1024;

function serviceClient() {
  const config = serverSupabaseConfig();
  if (!config.configured) throw Object.assign(new Error('FCOS server storage is unavailable.'), { status: 503, code: 'FCOS_STORAGE_UNAVAILABLE', expose: true });
  return createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function discardRawBody(req) {
  if (req.body != null) return;
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('FCUNO identity synchronization request is too large.'), { status: 413, code: 'FCUNO_IDENTITY_REQUEST_TOO_LARGE' });
  }
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('X-FCOS-Handler-Mutation', '1');
  res.setHeader('X-FCOS-External-Action', '0');
  for (const [name, value] of Object.entries(telemetryResponseHeaders())) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const requestId = requestIdFrom(req);
  return runWithRequestTelemetry({ handler: 'fcunoIdentitySync', requestId }, async () => {
    try {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' });
      await discardRawBody(req);
      return json(res, 202, await processFcunoIdentitySync({ headers: req.headers, client: serviceClient() }));
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 500);
      recordRequestFailure(error, status);
      return json(res, status >= 400 && status < 600 ? status : 500, {
        ok: false,
        error: status < 500 || error?.expose ? String(error?.message || 'FCUNO identity synchronization failed.') : 'FCUNO identity synchronization failed.',
        code: String(error?.code || 'FCUNO_IDENTITY_SYNC_FAILED').replace(/[^A-Z0-9_]/gi, '_').toUpperCase().slice(0, 100),
        requestId,
      });
    } finally {
      logRequestTelemetry(res.statusCode || 500);
    }
  });
}
