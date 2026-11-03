import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { enforceFcunoFederatedAccess } from '../api/_fcunoIdentityFederation.js';
import { federationDatabase, userId, subject, sessionId } from './fcunoDatabaseFixture.js';

const issuer = 'https://fcuno.com';
const env = { FCOS_ENABLE_FCUNO_FEDERATION: 'true', FCUNO_IDENTITY_ISSUER: issuer };
// Deliberately unsigned fixtures model the claims only AFTER the real callers'
// Supabase getUser verification. They are never sent to an authenticated API.
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

test('FCUNO session proof is signed, session-bound, refresh-stable and independently revocable', async (t) => {
  const fixture = await federationDatabase(t);
  const { client, query } = fixture;
  const key = await generateKeyPair('ES256');
  const now = Math.floor(Date.now() / 1000) * 1000;
  const seconds = now / 1000;
  await query(`insert into public.fcos_external_identity_links(provider,issuer,subject,auth_user_id,source_active,use_fcos,
    revision,credential_revision,revoked_before,email,email_verified,username,full_name,source_updated_at)
    values('fcuno',$1,$2,$3,true,true,1,1,'1970-01-01','user@fcuno.example',true,'user','FCUNO User',now())`, [issuer, subject, userId]);
  const profile = (await query('select * from public.user_profiles where id=$1', [userId])).rows[0];
  const authUser = { id: userId, email: profile.email, identities: [{ provider: 'email' }, { provider: 'custom:fcuno', provider_id: subject }] };
  const claims = (patch = {}) => ({ sub: userId, session_id: sessionId, iat: seconds,
    amr: [{ method: 'oauth', timestamp: seconds }], ...patch });
  const provider = async (patch = {}, signingKey = key.privateKey) => new SignJWT({ typ: 'at+jwt', use_fcos: true,
    email_verified: true, identity_revision: 1, credential_revision: 1, jti: 'provider-initial',
    iss: issuer, aud: 'fcos-production', sub: subject, iat: seconds, exp: seconds + 300, ...patch })
    .setProtectedHeader({ alg: 'ES256' }).sign(signingKey);
  const enforce = (patch = {}) => enforceFcunoFederatedAccess({ client, authUser, profile, accessToken: jwt(claims()), env, now, jwks: key.publicKey, ...patch });

  await t.test('linkage, editable metadata, generic OAuth or password cannot create session proof', async () => {
    await assert.rejects(enforce(), { code: 'FCUNO_IDENTITY_REAUTHENTICATION_REQUIRED' });
    await assert.rejects(enforce({ accessToken: jwt(claims({ amr: [{ method: 'password', timestamp: seconds }] })),
      authUser: { ...authUser, app_metadata: { provider: 'custom:fcuno' }, user_metadata: { auth_time: seconds, credential_revision: 1 } } }),
    { code: 'FCUNO_IDENTITY_REAUTHENTICATION_REQUIRED' });
    assert.equal((await query('select count(*)::int n from public.fcos_external_identity_sessions')).rows[0].n, 0);
  });
  await t.test('only exact signed FCUNO audience, subject, type and synchronized revision bind', async () => {
    const otherKey = await generateKeyPair('ES256');
    for (const token of [await provider({ aud: 'another-app' }), await provider({ iss: 'https://another.example' }),
      await provider({ sub: 'another-user' }), await provider({ typ: 'id_token' }),
      await provider({ credential_revision: 2 }), await provider({ identity_revision: 2 }),
      await provider({ exp: seconds - 1 }), await provider({}, otherKey.privateKey)]) {
      await assert.rejects(enforce({ providerAccessToken: token }), (error) => error.status === 401);
    }
    for (const patch of [{ sub: 'another-user' }, { session_id: 'not-a-session' }, { amr: [] },
      { amr: [{ method: 'oauth', timestamp: String(seconds) }] },
      { amr: [{ method: 'oauth', timestamp: seconds }, { method: 'password', timestamp: seconds }] }]) {
      await assert.rejects(enforce({ accessToken: jwt(claims(patch)), providerAccessToken: await provider() }), { status: 401 });
    }
    assert.equal((await query('select count(*)::int n from public.fcos_external_identity_sessions')).rows[0].n, 0);
  });
  const initialToken = await provider();
  await t.test('fresh FCUNO proof binds once and retains local roles and activation', async () => {
    assert.equal((await enforce({ providerAccessToken: initialToken })).user_type, 'trader');
    const stored = (await query('select * from public.fcos_external_identity_sessions')).rows[0];
    assert.equal(stored.auth_user_id, userId);
    assert.equal(new Date(stored.authenticated_at).getTime(), now);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(initialToken.replaceAll('.', '\\.')));
    await assert.rejects(enforce({ accessToken: jwt(claims({ session_id: '44444444-4444-4444-8444-444444444444' })), providerAccessToken: initialToken }), { status: 401 });
  });
  await t.test('fresh verified sign-in records only session proof in read-only deployments', async () => {
    const configurations = [
      { VERCEL_ENV: 'preview' },
      { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' },
    ];
    for (const [index, configuration] of configurations.entries()) {
      const freshSessionId = `${index + 1}1111111-1111-4111-8111-111111111111`;
      const readonlyEnv = { ...env, ...configuration };
      const proof = await provider({ jti: `readonly-existing-${index}` });
      const freshClaims = claims({ session_id: freshSessionId });
      await assert.rejects(enforce({ env: readonlyEnv, accessToken: jwt(freshClaims) }),
        { code: 'FCUNO_IDENTITY_REAUTHENTICATION_REQUIRED' });
      await assert.rejects(enforce({ env: readonlyEnv, accessToken: jwt(freshClaims),
        providerAccessToken: await provider({ aud: 'other-app' }) }), { status: 401 });
      assert.equal((await query('select count(*)::int n from public.fcos_external_identity_sessions')).rows[0].n, 1);
      const result = await enforce({ env: readonlyEnv, accessToken: jwt(freshClaims), providerAccessToken: proof });
      assert.equal(result.id, profile.id);
      assert.equal(result.active, profile.active);
      assert.equal(result.user_type, profile.user_type);
      const stored = (await query('select * from public.fcos_external_identity_sessions where session_id=$1', [freshSessionId])).rows[0];
      assert.equal(stored.auth_user_id, userId);
      assert.equal(stored.subject, subject);
      assert.equal(new Date(stored.authenticated_at).getTime(), now);
      assert.equal(stored.credential_revision, 1);
      assert.equal(JSON.stringify(stored).includes(proof), false);
      await assert.rejects(enforce({ env: readonlyEnv,
        accessToken: jwt(claims({ session_id: '99999999-9999-4999-8999-999999999999' })), providerAccessToken: proof }),
      { status: 401 });
      assert.equal((await query('select count(*)::int n from public.fcos_external_identity_sessions')).rows[0].n, 2);
      assert.deepEqual((await query('select * from public.user_profiles where id=$1', [userId])).rows[0], profile);
      assert.equal((await query('select auth_user_id from public.fcos_external_identity_links where subject=$1', [subject])).rows[0].auth_user_id, userId);
      await query('delete from public.fcos_external_identity_sessions where session_id=$1', [freshSessionId]);
    }
  });
  await t.test('verified readonly sessions cannot bind an unowned link or provision a profile', async () => {
    const unboundSubject='77777777-7777-4777-8777-777777777777';
    await query(`insert into public.fcos_external_identity_links(provider,issuer,subject,auth_user_id,source_active,use_fcos,revision,credential_revision,revoked_before,email,email_verified,username,full_name,source_updated_at) values('fcuno',$1,$2,null,true,true,1,1,'1970-01-01','user@fcuno.example',true,'user','FCUNO User',now())`,[issuer,unboundSubject]);
    for(const configuration of [{VERCEL_ENV:'preview'},{FCOS_ENABLE_READ_ONLY_CI:'true'}]){
      const readonlyEnv={...env,...configuration};
      assert.equal((await enforce({env:readonlyEnv})).id,userId);
      await assert.rejects(enforce({env:readonlyEnv,authUser:{...authUser,identities:[{provider:'custom:fcuno',provider_id:unboundSubject}]},accessToken:jwt(claims({session_id:'88888888-8888-4888-8888-888888888888'})),providerAccessToken:await provider({sub:unboundSubject,jti:'readonly-unbound'})}),{status:403,code:'FCOS_DEPLOYMENT_READ_ONLY'});
      assert.equal((await query('select auth_user_id from public.fcos_external_identity_links where subject=$1',[unboundSubject])).rows[0].auth_user_id,null);
      await assert.rejects(enforce({env:readonlyEnv,profile:null}),{status:403,code:'FCOS_DEPLOYMENT_READ_ONLY'});
      assert.equal((await query('select count(*)::int n from public.fcos_external_identity_sessions')).rows[0].n,1);
      assert.equal((await query('select count(*)::int n from public.user_profiles')).rows[0].n,1);
    }
  });
  await t.test('normal refresh uses existing proof even after retained provider token expires', async () => {
    assert.equal((await enforce({ accessToken: jwt(claims({ iat: seconds + 3600 })), now: now + 3600_000,
      providerAccessToken: initialToken })).active, true);
    assert.equal((await query('select count(*)::int n from public.fcos_external_identity_sessions')).rows[0].n, 1);
  });
  await t.test('old refreshed session and old credential proof remain denied after revocation', async () => {
    await query('update public.fcos_external_identity_links set revision=2,credential_revision=2,revoked_before=$1 where subject=$2', [new Date(now + 1000).toISOString(), subject]);
    await assert.rejects(enforce({ accessToken: jwt(claims({ iat: seconds + 3600 })), now: now + 3600_000 }), { code: 'FCUNO_IDENTITY_SESSION_REVOKED' });
    const freshClaims = claims({ session_id: '55555555-5555-4555-8555-555555555555', iat: seconds + 2, amr: [{ method: 'oauth', timestamp: seconds + 2 }] });
    await assert.rejects(enforce({ accessToken: jwt(freshClaims), now: now + 2000,
      providerAccessToken: await provider({ jti: 'old-credential', identity_revision: 2, iat: seconds + 2, exp: seconds + 302 }) }), { code: 'FCUNO_IDENTITY_SESSION_REVOKED' });
    assert.equal((await enforce({ accessToken: jwt(freshClaims), now: now + 2000,
      providerAccessToken: await provider({ jti: 'new-credential', identity_revision: 2, credential_revision: 2, iat: seconds + 2, exp: seconds + 302 }) })).active, true);
  });
  await t.test('an explicitly enabled legacy exception retains local authorization', async () => {
    assert.equal((await enforce({ accessToken: jwt(claims({ amr: [{ method: 'password', timestamp: seconds }] })),
      env: { ...env, FCOS_FCUNO_BREAK_GLASS_EMAILS: profile.email } })).user_type, 'trader');
    await assert.rejects(enforce({ accessToken: jwt(claims({ amr: [{ method: 'magiclink', timestamp: seconds }] })),
      env: { ...env, FCOS_FCUNO_BREAK_GLASS_EMAILS: profile.email } }), { status: 401 });
  });
  await t.test('first entitled sign-in provisions inactive Viewer with no type defaults', async () => {
    await query('delete from public.user_profiles where id=$1', [userId]);
    const provisioned = await enforce({ profile: null, now: now + 4000,
      accessToken: jwt(claims({ session_id: '66666666-6666-4666-8666-666666666666', iat: seconds + 4,
        amr: [{ method: 'oauth', timestamp: seconds + 4 }] })),
      providerAccessToken: await provider({ jti: 'new-onboarding', identity_revision: 2, credential_revision: 2, iat: seconds + 4, exp: seconds + 304 }) });
    assert.equal(provisioned.active, false); assert.equal(provisioned.user_type, 'viewer'); assert.equal(provisioned.use_type_defaults, false);
  });
});
