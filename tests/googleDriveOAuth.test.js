import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exchangeGoogleDriveRefreshToken,
  googleDriveMarketOAuthConfig,
} from '../api/_googleDriveOAuth.js';

const config = Object.freeze({
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  folderId: 'folder-id',
});

test('market-report OAuth uses the approved market refresh authority', () => {
  assert.deepEqual(googleDriveMarketOAuthConfig({
    GOOGLE_DRIVE_CLIENT_ID: ' client-id ',
    GOOGLE_DRIVE_CLIENT_SECRET: ' client-secret ',
    GOOGLE_DRIVE_MARKET_REFRESH_TOKEN: ' market-refresh-token ',
  }), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'market-refresh-token',
  });
  assert.throws(
    () => googleDriveMarketOAuthConfig({
      GOOGLE_DRIVE_CLIENT_ID: 'client-id',
      GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret',
    }),
    (error) => error.code === 'MARKET_DRIVE_CONFIG_INVALID'
      && error.message.includes('GOOGLE_DRIVE_MARKET_REFRESH_TOKEN'),
  );
});

test('Google invalid_grant becomes an actionable authorization-revoked error', async () => {
  await assert.rejects(
    exchangeGoogleDriveRefreshToken(config, {
      fetchImpl: async () => new Response(JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }), { status: 400, headers: { 'content-type': 'application/json' } }),
    }),
    (error) => error.code === 'MARKET_DRIVE_AUTH_REVOKED'
      && error.status === 503
      && error.expose === true
      && !error.message.includes('invalid_grant'),
  );
});

test('Google Drive OAuth returns the access token and expiry evidence', async () => {
  const result = await exchangeGoogleDriveRefreshToken(config, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.body.get('client_id'), config.clientId);
      assert.equal(options.body.get('refresh_token'), config.refreshToken);
      return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(result, { access_token: 'access-token', expires_in: 3600 });
});
