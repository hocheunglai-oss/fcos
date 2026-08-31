import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import {
  enforceFcunoFederatedAccess,
  normalizeFcunoIdentitySyncClaims,
  processFcunoIdentitySync,
  verifyFcunoIdentitySyncToken,
} from '../api/_fcunoIdentityFederation.js';

const issuer = 'https://identity.fcuno.example';
const audience = 'fcos-identity-sync';
const syncEnv = {
  FCOS_ENABLE_FCUNO_FEDERATION: 'false',
  FCOS_ENABLE_FCUNO_IDENTITY_SYNC: 'true',
  FCUNO_IDENTITY_ISSUER: issuer,
  FCUNO_IDENTITY_SYNC_AUDIENCE: audience,
  FCUNO_IDENTITY_JWKS_URI: `${issuer}/jwks.json`,
  FCUNO_IDENTITY_JWT_ALGORITHMS: 'ES256',
};

test('FCUNO identity synchronization is independently gated from FCOS login', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const token = await signedToken(privateKey, { jti: 'event-sync-only' });
  const verified = await verifyFcunoIdentitySyncToken({
    headers: { authorization: `Bearer ${token}` },
    env: syncEnv,
    jwks: publicKey,
  });
  assert.equal(verified.config.syncEnabled, true);
  assert.equal(verified.config.federationEnabled, false);

  await assert.rejects(
    verifyFcunoIdentitySyncToken({
      headers: { authorization: `Bearer ${token}` },
      env: { ...syncEnv, FCOS_ENABLE_FCUNO_IDENTITY_SYNC: 'false', FCOS_ENABLE_FCUNO_FEDERATION: 'true' },
      jwks: publicKey,
    }),
    (error) => error.code === 'FCUNO_IDENTITY_SYNC_DISABLED' && error.status === 404,
  );
});

async function signedToken(privateKey, payload = {}) {
  return new SignJWT({ typ: 'fcuno.identity-sync+jwt', ...payload })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('fcuno-user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

function accessToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('FCUNO sync token verification requires the exact configured issuer and audience', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const token = await signedToken(privateKey, { jti: 'event-1' });
  const verified = await verifyFcunoIdentitySyncToken({
    headers: { authorization: `Bearer ${token}` },
    env: syncEnv,
    jwks: publicKey,
  });
  assert.equal(verified.payload.iss, issuer);
  assert.equal(verified.payload.aud, audience);

  const wrongAudience = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256' }).setIssuer(issuer).setAudience('other-service')
    .setSubject('fcuno-user-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  await assert.rejects(
    verifyFcunoIdentitySyncToken({ headers: { authorization: `Bearer ${wrongAudience}` }, env: syncEnv, jwks: publicKey }),
    (error) => error.code === 'FCUNO_IDENTITY_TOKEN_INVALID' && error.status === 401,
  );
});

test('FCUNO sync claims accept only signed, revisioned source access projections', () => {
  const claims = normalizeFcunoIdentitySyncClaims({
    sub: 'fcuno-user-1',
    jti: 'event-1',
    event_id: 'event-1',
    event_type: 'fcuno.identity.v1',
    occurred_at: '2026-08-31T09:00:00.000Z',
    identity: {
      sub: 'fcuno-user-1',
      identity_revision: 4,
      credential_revision: 2,
      is_active: true,
      use_fcos: true,
      use_spc: false,
      email: 'User@FCUNO.example',
      email_verified: true,
      username: 'fcuno.user',
      display_name: 'FCUNO User',
      revoked_before: '1970-01-01T00:00:00.000Z',
    },
  });
  assert.deepEqual(claims, {
    subject: 'fcuno-user-1', eventId: 'event-1', revision: 4,
    credentialRevision: 2, sourceActive: true, useFcos: true, useSpc: false,
    email: 'user@fcuno.example', username: 'fcuno.user', fullName: 'FCUNO User',
    sourceUpdatedAt: '2026-08-31T09:00:00.000Z',
    revokedBefore: '1970-01-01T00:00:00.000Z',
  });
  assert.throws(
    () => normalizeFcunoIdentitySyncClaims({
      sub: 'fcuno-user-1', jti: 'event-1', event_id: 'event-1',
      event_type: 'fcuno.identity.v1', occurred_at: '2026-08-31T09:00:00.000Z',
      identity: { sub: 'fcuno-user-1', identity_revision: 1, credential_revision: 1, is_active: true, use_fcos: true, use_spc: false },
    }),
    (error) => error.code === 'FCUNO_IDENTITY_EMAIL_UNVERIFIED',
  );
});

function federationClient(link, profile) {
  return {
    from(table) {
      if (table === 'fcos_external_identity_links') {
        const query = {
          select() { return query; },
          eq() { return query; },
          maybeSingle: async () => ({ data: link, error: null }),
        };
        return query;
      }
      if (table === 'user_profiles') {
        const query = {
          select() { return query; },
          eq() { return query; },
          maybeSingle: async () => ({ data: profile, error: null }),
        };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function syncClient() {
  const state = { transaction: null, link: null, audit: [] };
  return {
    state,
    from(table) {
      if (table === 'fcos_external_identity_sync_transactions') {
        return {
          insert(row) {
            if (state.transaction) return { select() { return { maybeSingle: async () => ({ data: null, error: { code: '23505' } }) }; } };
            state.transaction = { id: 'transaction-1', ...row };
            return { select() { return { maybeSingle: async () => ({ data: state.transaction, error: null }) }; } };
          },
          select() {
            const query = { eq() { return query; }, maybeSingle: async () => ({ data: state.transaction, error: null }) };
            return query;
          },
          update(patch) {
            return { eq: async () => { Object.assign(state.transaction, patch); return { error: null }; } };
          },
        };
      }
      if (table === 'fcos_external_identity_links') {
        return {
          select() {
            const query = { eq() { return query; }, maybeSingle: async () => ({ data: state.link, error: null }) };
            return query;
          },
          upsert(row) {
            state.link = { id: state.link?.id || 'link-1', ...row };
            return { select() { return { maybeSingle: async () => ({ data: state.link, error: null }) }; } };
          },
        };
      }
      if (table === 'fcos_external_identity_audit') {
        return { insert: async (row) => { state.audit.push(row); return { error: null }; } };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test('FCUNO sync is event-idempotent and stores username as non-authorizing identity metadata', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const token = await signedToken(privateKey, {
    jti: 'event-username-1',
    event_id: 'event-username-1',
    event_type: 'fcuno.identity.v1',
    occurred_at: new Date().toISOString(),
    identity: {
      sub: 'fcuno-user-1', identity_revision: 1, credential_revision: 1,
      is_active: true, use_fcos: true, use_spc: false,
      username: 'fcuno.user', email: 'user@fcuno.example', email_verified: true,
      display_name: 'FCUNO User', revoked_before: '1970-01-01T00:00:00.000Z',
    },
  });
  const client = syncClient();
  const request = { headers: { authorization: `Bearer ${token}` }, env: syncEnv, client, jwks: publicKey };
  const first = await processFcunoIdentitySync(request);
  const retry = await processFcunoIdentitySync(request);
  assert.deepEqual([first.duplicate, retry.duplicate], [false, true]);
  assert.equal(client.state.link.username, 'fcuno.user');
  assert.equal(client.state.link.use_fcos, true);
  assert.equal(client.state.link.credential_revision, 1);
  assert.equal(client.state.transaction.status, 'applied');
});

test('FCUNO credential revocation timestamps invalidate older FCOS sessions without disabling access', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const revokedBefore = new Date(Date.now() - 30_000).toISOString();
  const token = await signedToken(privateKey, {
    jti: 'event-credential-2', event_id: 'event-credential-2',
    event_type: 'fcuno.identity.v1', occurred_at: new Date().toISOString(),
    identity: {
      sub: 'fcuno-user-1', identity_revision: 2, credential_revision: 2,
      is_active: true, use_fcos: true, use_spc: false,
      username: 'fcuno.user', email: 'user@fcuno.example', email_verified: true,
      display_name: 'FCUNO User', revoked_before: revokedBefore,
    },
  });
  const client = syncClient();
  await processFcunoIdentitySync({ headers: { authorization: `Bearer ${token}` }, env: syncEnv, client, jwks: publicKey });
  assert.equal(client.state.link.revoked_before, revokedBefore);
  assert.equal(client.state.link.source_active, true);
  assert.equal(client.state.link.use_fcos, true);
});

test('a concurrently applied newer identity revision prevents stale profile projection', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const occurredAt = new Date().toISOString();
  const token = await signedToken(privateKey, {
    jti: 'event-race-2', event_id: 'event-race-2', event_type: 'fcuno.identity.v1', occurred_at: occurredAt,
    identity: {
      sub: 'fcuno-user-1', identity_revision: 2, credential_revision: 1,
      is_active: true, use_fcos: true, use_spc: false,
      username: 'older.name', email: 'older@fcuno.example', email_verified: true,
      display_name: 'Older Name', revoked_before: '1970-01-01T00:00:00.000Z',
    },
  });
  const transaction = { id: 'transaction-race', status: 'received' };
  let identityReads = 0;
  let projected = false;
  const links = [
    { id: 'link-1', revision: 1, auth_user_id: 'auth-1' },
    { id: 'link-1', revision: 3, auth_user_id: 'auth-1' },
  ];
  const client = {
    from(table) {
      if (table === 'fcos_external_identity_sync_transactions') {
        return {
          insert(row) {
            Object.assign(transaction, row);
            return { select: () => ({ maybeSingle: async () => ({ data: transaction, error: null }) }) };
          },
          update(patch) {
            return { eq: async () => { Object.assign(transaction, patch); return { error: null }; } };
          },
        };
      }
      if (table === 'fcos_external_identity_links') {
        return {
          select() {
            const query = { eq: () => query, maybeSingle: async () => ({ data: links[Math.min(identityReads++, 1)], error: null }) };
            return query;
          },
          upsert() {
            return { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'P0001', message: 'revision race' } }) }) };
          },
        };
      }
      if (table === 'fcos_external_identity_audit') return { insert: async () => ({ error: null }) };
      if (table === 'user_profiles') {
        projected = true;
        throw new Error('A stale identity must not reach profile projection.');
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const result = await processFcunoIdentitySync({
    headers: { authorization: `Bearer ${token}` }, env: syncEnv, client, jwks: publicKey,
  });
  assert.equal(result.ignored, true);
  assert.equal(transaction.status, 'ignored');
  assert.equal(projected, false);
});

test('every FCOS auth boundary rejects a source-disabled FCUNO identity before module authorization', async () => {
  const profile = { id: '24b02cff-beb0-444c-a80c-d539a70b5840', email: 'user@fcuno.example', active: true };
  const client = federationClient({
    id: 'a8c3cbfd-5662-40b4-9a51-bbbd5170e357', auth_user_id: profile.id, source_active: false, use_fcos: true,
    revoked_before: new Date().toISOString(), email: profile.email, full_name: 'FCUNO User',
  }, profile);
  await assert.rejects(
    enforceFcunoFederatedAccess({
      client,
      authUser: { id: profile.id, identities: [{ provider: 'custom:fcuno', provider_id: 'fcuno-user-1', identity_data: { sub: 'fcuno-user-1' } }] },
      profile,
      accessToken: accessToken({ iat: Math.floor(Date.now() / 1000) }),
      env: { FCOS_ENABLE_FCUNO_FEDERATION: 'true', FCUNO_IDENTITY_ISSUER: issuer },
    }),
    (error) => error.code === 'FCUNO_IDENTITY_ACCESS_REVOKED' && error.status === 403,
  );
});

test('FCUNO revocation timestamp rejects an otherwise active session issued before revocation', async () => {
  const profile = { id: '24b02cff-beb0-444c-a80c-d539a70b5840', email: 'user@fcuno.example', active: true };
  const client = federationClient({
    id: 'a8c3cbfd-5662-40b4-9a51-bbbd5170e357', auth_user_id: profile.id, source_active: true, use_fcos: true,
    revoked_before: '2026-08-31T00:00:00.000Z', email: profile.email, full_name: 'FCUNO User',
  }, profile);
  await assert.rejects(
    enforceFcunoFederatedAccess({
      client,
      authUser: { id: profile.id, identities: [{ provider: 'custom:fcuno', provider_id: 'fcuno-user-1' }] },
      profile,
      accessToken: accessToken({ iat: Math.floor(Date.parse('2026-08-30T23:59:00.000Z') / 1000) }),
      env: { FCOS_ENABLE_FCUNO_FEDERATION: 'true', FCUNO_IDENTITY_ISSUER: issuer },
    }),
    (error) => error.code === 'FCUNO_IDENTITY_SESSION_REVOKED' && error.status === 401,
  );
});

test('FCOS uses the custom FCUNO OIDC provider behind public migration flags and enforces federation at server boundaries', async () => {
  const [authContext, login, serverBoundary] = await Promise.all([
    readFile(new URL('../src/lib/AuthContext.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/_authenticatedFunction.js', import.meta.url), 'utf8'),
  ]);
  assert.match(authContext, /VITE_FCOS_ENABLE_FCUNO_OIDC/);
  assert.match(authContext, /provider: FCUNO_OIDC_PROVIDER/);
  assert.match(authContext, /FCUNO_FORCE_REAUTH_KEY = 'fcos:fcuno-force-reauth'/);
  assert.match(authContext, /queryParams: forceReauthentication \? \{ prompt: 'login' \} : undefined/);
  assert.match(authContext, /sessionStorage\.setItem\(FCUNO_FORCE_REAUTH_KEY, 'true'\)/);
  assert.match(authContext, /if \(result\.user\) window\.sessionStorage\.removeItem\(FCUNO_FORCE_REAUTH_KEY\)/);
  assert.match(authContext, /VITE_FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN/);
  assert.match(login, /Continue with FCUNO/);
  assert.match(serverBoundary, /enforceFcunoFederatedAccess/);
});

test('FCUNO projection preserves local FCOS activation and new identities start without access', async () => {
  const source = await readFile(new URL('../api/_fcunoIdentityFederation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /const patch = \{[\s\S]{0,180}\bactive,/);
  assert.match(source, /user_type: 'viewer',[\s\S]{0,120}active: false,[\s\S]{0,120}use_type_defaults: false/);
  assert.doesNotMatch(source, /ban_duration/);
});

test('FCOS User Settings keeps FCUNO identity fields read-only while retaining local authorization', async () => {
  const [server, admin] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/AdminControl.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /Create company identities in FCUNO User Management/);
  assert.match(server, /Only FCOS authorization can be changed here/);
  assert.match(server, /Company identities must be deactivated or removed in FCUNO User Management/);
  assert.match(server, /identity_authority: identityManagedByFcuno \? 'fcuno' : 'fcos'/);
  assert.match(admin, /Open FCUNO Users/);
  assert.match(admin, /Identity is read-only from FCUNO/);
});
