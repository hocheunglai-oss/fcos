import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { processFcunoIdentitySync } from '../api/_fcunoIdentityFederation.js';
import { databaseClient, federationDatabase, nativePostgresAvailable, userId, subject } from './fcunoDatabaseFixture.js';

const issuer = 'https://fcuno.com';
const env = { FCOS_ENABLE_FCUNO_IDENTITY_SYNC: 'true', FCUNO_IDENTITY_ISSUER: issuer,
  FCUNO_IDENTITY_SYNC_AUDIENCE: 'fcos-identity-sync', FCUNO_IDENTITY_JWKS_URI: `${issuer}/api/fcos-identity-sync/jwks` };
async function token(privateKey, revision = 1, eventId = `event-${revision}`) {
  return new SignJWT({ typ: 'fcuno.identity-sync+jwt', event_id: eventId, event_type: 'fcuno.identity.v1',
    occurred_at: `2026-10-17T00:00:0${revision}.000Z`, identity: {
      sub: subject, identity_revision: revision, credential_revision: 1, is_active: true, use_fcos: true, use_spc: false,
      email: `user${revision}@fcuno.example`, email_verified: true, username: `user${revision}`, display_name: `User ${revision}`,
      revoked_before: '1970-01-01T00:00:00.000Z',
    } }).setProtectedHeader({ alg: 'ES256' }).setIssuer(issuer).setAudience('fcos-identity-sync').setSubject(subject)
    .setJti(eventId).setIssuedAt().setExpirationTime('5m').sign(privateKey);
}

test('signed identity retry executes atomic PostgreSQL projection, audit and completion', async (t) => {
  const { query, exec, client } = await federationDatabase(t);
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  await query(`insert into public.fcos_external_identity_links(issuer,subject,auth_user_id,revision) values($1,$2,$3,0)`, [issuer, subject, userId]);
  const firstToken = await token(privateKey);
  const apply = (signed = firstToken) => processFcunoIdentitySync({ headers: { authorization: `Bearer ${signed}` }, env, client, jwks: publicKey });
  const snapshot = async () => ({ profile: (await query('select * from user_profiles')).rows[0], transaction: (await query('select * from fcos_external_identity_sync_transactions')).rows[0],
    audit: (await query('select * from fcos_external_identity_audit')).rows });

  await t.test('link upsert survives transient profile failure and identical signed event recovers', async () => {
    await exec(`create function public.fail_projection() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_TRANSIENT'; end$$;
      create trigger fail_projection before update on public.user_profiles for each row execute function public.fail_projection();`);
    await assert.rejects(apply(), /FIXTURE_TRANSIENT/);
    assert.equal((await query('select revision from fcos_external_identity_links')).rows[0].revision, 1);
    assert.equal((await snapshot()).transaction.status, 'failed');
    await exec('drop trigger fail_projection on public.user_profiles');
    assert.equal((await apply()).access, 'active');
    const state = await snapshot();
    assert.equal(state.transaction.status, 'applied'); assert.equal(state.profile.email, 'user1@fcuno.example');
    assert.equal(state.profile.user_type, 'trader'); assert.equal(state.profile.active, true); assert.equal(state.audit.length, 1);
    assert.equal((await apply()).duplicate, true); assert.equal((await snapshot()).audit.length, 1);
  });
  await t.test('audit failure rolls projection back and exact retry records one complete audit', async () => {
    const second = await token(privateKey, 2);
    await exec(`create function public.fail_audit() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_AUDIT_TRANSIENT'; end$$;
      create trigger fail_audit before insert on public.fcos_external_identity_audit for each row execute function public.fail_audit();`);
    await assert.rejects(apply(second), /FIXTURE_AUDIT_TRANSIENT/);
    assert.equal((await snapshot()).profile.email, 'user1@fcuno.example');
    assert.equal((await query("select status from fcos_external_identity_sync_transactions where event_id='event-2'")).rows[0].status, 'failed');
    await exec('drop trigger fail_audit on public.fcos_external_identity_audit');
    await apply(second); assert.equal((await snapshot()).profile.email, 'user2@fcuno.example');
    assert.equal((await query("select count(*)::int n from fcos_external_identity_audit a join fcos_external_identity_sync_transactions t on t.id=a.transaction_id where t.event_id='event-2'")).rows[0].n, 1);
  });
  await t.test('browser roles cannot mutate proofs or execute synchronization RPC', async () => {
    for (const role of ['anon', 'authenticated']) {
      await exec(`set role ${role}`);
      await assert.rejects(query('select * from public.fcos_external_identity_sessions'), /permission denied/);
      await assert.rejects(query('select public.fcos_finalize_identity_sync(null,null,1)'), /permission denied/);
      await exec('reset role');
    }
    assert.equal((await query("select prosecdef from pg_proc where proname='fcos_finalize_identity_sync'")).rows[0].prosecdef, false);
  });
});

test('native PostgreSQL independent deliveries serialize equal-revision retry and newer projection',
  { skip: !nativePostgresAvailable && process.env.FCOS_REQUIRE_NATIVE_FCUNO_DATABASE !== '1' }, async (t) => {
  const { query, db, client } = await federationDatabase(t, { native: true });
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  await query('insert into public.fcos_external_identity_links(issuer,subject,auth_user_id,revision) values($1,$2,$3,0)', [issuer, subject, userId]);
  const oldToken = await token(privateKey, 1), newToken = await token(privateKey, 2);
  const apply = (signed, currentClient = client) => processFcunoIdentitySync({ headers: { authorization: `Bearer ${signed}` }, env, client: currentClient, jwks: publicKey });
  await apply(oldToken);
  // Simulate a previous ambiguous failure after link upsert. The same signed
  // event enters equal-revision retry while another event advances the link.
  await query("update fcos_external_identity_sync_transactions set status='failed' where event_id='event-1'");
  let releaseOlder, enteredOlder;
  const held = new Promise((resolve) => { releaseOlder = resolve; });
  const entered = new Promise((resolve) => { enteredOlder = resolve; });
  const delayed = databaseClient(query, async ({ operation }) => { if (operation === 'rpc') { enteredOlder(); await held; } });
  const older = apply(oldToken, delayed);
  await entered;
  await apply(newToken);
  releaseOlder();
  assert.equal((await older).ignored, true);
  const link = (await query('select id from fcos_external_identity_links')).rows[0];
  const final = (await query('select l.revision,p.email,p.full_name,p.user_type,p.active from fcos_external_identity_links l join user_profiles p on p.id=l.auth_user_id where l.id=$1', [link.id])).rows[0];
  assert.deepEqual(final, { revision: '2', email: 'user2@fcuno.example', full_name: 'User 2', user_type: 'trader', active: true });
  assert.equal((await query("select status from fcos_external_identity_sync_transactions where event_id='event-1'")).rows[0].status, 'ignored');
  // Independent PostgreSQL sessions contend on the same new event. Its audit
  // and completion must occur exactly once even when all reservations race.
  const third = await token(privateKey, 3);
  const blocked = await db.connect(); await blocked.query('begin');
  await blocked.query('select id from fcos_external_identity_links for update');
  const contenders = Array.from({ length: 12 }, () => apply(third));
  await blocked.query('commit'); blocked.release();
  const results = await Promise.all(contenders);
  assert.equal(results.filter((result) => !result.duplicate).length, 1);
  assert.equal((await query("select count(*)::int n from fcos_external_identity_audit a join fcos_external_identity_sync_transactions t on t.id=a.transaction_id where t.event_id='event-3'")).rows[0].n, 1);
  assert.equal((await query('select email from user_profiles')).rows[0].email, 'user3@fcuno.example');
});
