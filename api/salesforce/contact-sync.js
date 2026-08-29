import {
  processSalesforceContactSyncWebhook,
  readRawRequestBody,
} from '../_xeroContactSync.js';
import {
  logRequestTelemetry,
  recordRequestFailure,
  requestIdFrom,
  runWithRequestTelemetry,
  telemetryResponseHeaders,
} from '../_requestTelemetry.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

function sendJson(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('X-FCOS-Handler-Mutation', '1');
  res.setHeader('X-FCOS-External-Action', '1');
  for (const [name, value] of Object.entries(telemetryResponseHeaders())) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

function publicError(error, status, requestId) {
  const expose = status < 500 || error?.expose === true;
  return {
    ok: false,
    error: expose
      ? String(error?.message || 'Salesforce contact sync could not be completed.')
      : 'Salesforce contact sync could not be completed. Use the request reference when reporting the problem.',
    code: String(error?.code || (status >= 500 ? 'XERO_CONTACT_SYNC_INTERNAL_ERROR' : 'XERO_CONTACT_SYNC_REJECTED'))
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 100),
    requestId,
  };
}

export default async function handler(req, res) {
  const requestId = requestIdFrom(req);
  return runWithRequestTelemetry({ handler: 'salesforceContactSyncWebhook', requestId }, async () => {
    try {
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'Method not allowed.' }, 405);
      const rawBody = await readRawRequestBody(req);
      const result = await processSalesforceContactSyncWebhook({
        rawBody,
        headers: req.headers,
      });
      return sendJson(res, result, 202);
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 500);
      recordRequestFailure(error, status);
      return sendJson(res, publicError(error, status, requestId), status >= 400 && status < 600 ? status : 500);
    } finally {
      logRequestTelemetry(res.statusCode || 500);
    }
  });
}
