import { exchangeXeroAuthorizationCode } from '../_xeroPortal.js';
import { requireDeploymentMutationAllowed } from '../_deploymentReadOnly.js';

export default async function handler(req, res) {
  const origin = requestOrigin(req);
  const url = new URL(req.url, origin);
  const returnPath = '/xero-portal';
  try {
    if (url.searchParams.get('error')) {
      const message = url.searchParams.get('error_description') || url.searchParams.get('error') || 'Xero connection was not completed.';
      return redirect(res, `${returnPath}?xero=error&message=${encodeURIComponent(message)}`);
    }
    requireDeploymentMutationAllowed(true);
    const result = await exchangeXeroAuthorizationCode({
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
      req,
    });
    return redirect(res, `${result.returnPath || returnPath}?xero=connected`);
  } catch (error) {
    if (error?.code === 'FCOS_DEPLOYMENT_READ_ONLY') return json(res, 403, {
      error: error.message,
      code: error.code,
    });
    const message = error?.expose === false
      ? 'Xero connection failed. Check the FCOS server logs.'
      : error?.message || 'Xero connection failed.';
    return redirect(res, `${returnPath}?xero=error&message=${encodeURIComponent(message)}`);
  }
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function requestOrigin(req) {
  const protocol = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'fcos.fcuno.com').split(',')[0].trim();
  return `${protocol}://${host}`;
}
