export const GOOGLE_DRIVE_MARKET_OAUTH_REQUIRED_ENV = Object.freeze([
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_MARKET_REFRESH_TOKEN',
]);

function oauthError(message, code, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  error.expose = true;
  return error;
}

export function googleDriveMarketOAuthConfig(environment = process.env) {
  const config = {
    clientId: String(environment.GOOGLE_DRIVE_CLIENT_ID || '').trim(),
    clientSecret: String(environment.GOOGLE_DRIVE_CLIENT_SECRET || '').trim(),
    refreshToken: String(environment.GOOGLE_DRIVE_MARKET_REFRESH_TOKEN || '').trim(),
  };
  const missing = GOOGLE_DRIVE_MARKET_OAUTH_REQUIRED_ENV.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) {
    throw oauthError(
      `Google Drive market-report configuration is incomplete. Missing: ${missing.join(', ')}.`,
      'MARKET_DRIVE_CONFIG_INVALID',
      500,
    );
  }
  return config;
}

export async function exchangeGoogleDriveRefreshToken(config, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const revoked = response.status === 400 && String(data.error || '').trim().toLowerCase() === 'invalid_grant';
    throw oauthError(
      revoked
        ? 'Google Drive authorization has expired or was revoked. Reauthorize the approved account and replace only the matching pinned refresh token.'
        : 'Google Drive authorization could not be refreshed. Review the pinned OAuth client and approved account.',
      revoked ? 'MARKET_DRIVE_AUTH_REVOKED' : 'MARKET_DRIVE_AUTH_FAILED',
    );
  }
  if (!String(data.access_token || '').trim()) {
    throw oauthError('Google Drive authorization did not return an access token.', 'MARKET_DRIVE_AUTH_FAILED');
  }
  return data;
}
