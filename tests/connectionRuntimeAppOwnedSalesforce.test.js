import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const runtimeUrl = new URL('../api/_connectionRuntime.js', import.meta.url).href;
const configUrl = new URL('../config/fcosConnections.js', import.meta.url).href;

// This whole function executes in a fresh child with env:{}. It imports the
// actual runtime and actual application auth helper. Only network responses are
// mocked; synthetic keys are generated in that child and never printed/saved.
async function childScenario(options) {
  const { default: assert } = await import('node:assert/strict');
  const { generateKeyPairSync, verify } = await import('node:crypto');
  const { fcosSalesforceEnvironment } = await import(options.configUrl);
  const sf = fcosSalesforceEnvironment('production');
  const appEnv = { SALESFORCE_API_VERSION: options.version || 'v68.0' };
  if (!options.omitAppInstance) appEnv.SALESFORCE_INSTANCE_URL = options.appInstance || sf.instanceUrl;
  let publicKey;
  if (options.mode === 'jwt') {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    publicKey = keys.publicKey;
    Object.assign(appEnv, { SALESFORCE_JWT_CLIENT_ID: 'synthetic-client',
      SALESFORCE_JWT_USERNAME: 'synthetic@example.test',
      SALESFORCE_JWT_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  } else if (options.mode === 'refresh') {
    Object.assign(appEnv, { SALESFORCE_CLIENT_ID: 'synthetic-client',
      SALESFORCE_CLIENT_SECRET: 'private-synthetic-secret', SALESFORCE_REFRESH_TOKEN: 'private-synthetic-refresh' });
  } else if (options.mode !== 'missing') {
    appEnv.SALESFORCE_ACCESS_TOKEN = 'private-static-session';
    if (options.mode === 'partial') appEnv.SALESFORCE_JWT_CLIENT_ID = 'synthetic-incomplete-client';
  }
  const credentialReads = [];
  process.env = new Proxy(appEnv, { get(target, key) {
    if (typeof key === 'string' && key.startsWith('SALESFORCE_')) credentialReads.push(key);
    return Reflect.get(target, key);
  } });
  const { probeRuntimeConnections } = await import(options.runtimeUrl);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    if (target.href === 'https://login.salesforce.com/services/oauth2/token') {
      assert.equal(init.method, 'POST');
      const body = new URLSearchParams(init.body);
      const grant = body.get('grant_type');
      if (options.mode === 'jwt') {
        assert.equal(grant, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
        const parts = body.get('assertion').split('.');
        assert.equal(parts.length, 3);
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        assert.equal(claims.iss, 'synthetic-client');
        assert.equal(claims.sub, 'synthetic@example.test');
        assert.equal(claims.aud, 'https://login.salesforce.com');
        assert.ok(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')),
          publicKey, Buffer.from(parts[2], 'base64url')));
      } else {
        assert.equal(options.mode, 'refresh'); assert.equal(grant, 'refresh_token');
        assert.equal(body.get('client_secret'), 'private-synthetic-secret');
        assert.equal(body.get('refresh_token'), 'private-synthetic-refresh');
      }
      calls.push({ kind: 'grant', method: init.method, grant });
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
      if (options.authError) throw Error('private-provider-auth-error');
      return { ok: true, json: async () => ({ access_token: 'private-issued-session',
        instance_url: options.grantInstance || sf.instanceUrl, issued_at: String(Date.now()) }) };
    }
    assert.equal(target.origin, sf.instanceUrl);
    assert.equal(target.pathname, `/services/data/${/^v\d+\.\d+$/.test(appEnv.SALESFORCE_API_VERSION) ? appEnv.SALESFORCE_API_VERSION : 'v67.0'}/query`);
    assert.equal(target.searchParams.get('q'), 'SELECT Id, IsSandbox FROM Organization LIMIT 1');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.body, undefined);
    assert.equal(init.headers.authorization, `Bearer ${['jwt', 'refresh'].includes(options.mode) ? 'private-issued-session' : 'private-static-session'}`);
    calls.push({ kind: 'organization', method: init.method });
    if (options.dataError === 'network') throw Error('private-provider-network-error');
    if (options.dataError === 'http') return { ok: false };
    if (options.dataError === 'json') return { ok: true, json: async () => { throw Error('private-provider-json-error'); } };
    let records = [{ Id: sf.orgId, IsSandbox: false }];
    if (options.identity === 'foreign') records[0].Id = 'foreign-org';
    if (options.identity === 'sandbox') records[0].IsSandbox = true;
    if (options.identity === 'missing-sandbox') delete records[0].IsSandbox;
    if (options.identity === 'multiple') records.push({ ...records[0] });
    if (options.identity === 'empty') records = [];
    return { ok: true, json: async () => options.identity === 'malformed' ? {} : { records } };
  };
  const sha = 'a'.repeat(40), sourceDigest = 'b'.repeat(64);
  const env = { VERCEL_ENV: 'preview', VERCEL_DEPLOYMENT_ID: 'dpl_fixture', VERCEL_GIT_COMMIT_SHA: sha,
    SALESFORCE_INSTANCE_URL: options.diagnosticInstance || sf.instanceUrl };
  const receipt = { deploymentId: env.VERCEL_DEPLOYMENT_ID, commit: sha, gitDirty: false,
    provenance: { schemaVersion: 1, sourceDigestAlgorithm: 'sha256:fcos-vercel-source-v1',
      releaseEligible: true, commit: sha, sourceDigest, gitDirty: false } };
  credentialReads.length = 0;
  const started = performance.now();
  if (options.badBinding) {
    await assert.rejects(probeRuntimeConnections({ env, receipt: { ...receipt, commit: 'c'.repeat(40) } }), /binding/);
    assert.deepEqual(credentialReads, []); assert.deepEqual(calls, []);
    return process.stdout.write(JSON.stringify({ bindingRejected: true }));
  }
  const results = [];
  for (let i = 0; i < (options.repeat || 1); i += 1) results.push(await probeRuntimeConnections({ env, receipt }));
  const elapsedMs = performance.now() - started;
  // Let a timed-out OAuth request finish or reject. It must not trigger a query,
  // retry or unhandled rejection; the application helper itself was not cancelled.
  if (options.delayMs) await new Promise(resolve => setTimeout(resolve, Math.max(0, options.delayMs + 150 - elapsedMs)));
  for (const result of results) {
    assert.equal(result.auth.salesforce.target, sf.orgId);
    assert.equal(result.auth.salesforce.mode, 'application');
    assert.doesNotMatch(JSON.stringify(result), /private-|access_token|refresh_token|records|IsSandbox/);
    assert.equal(result.safety.readOnly, true);
    assert.ok(Object.values(result.safety.externalActions).every(value => value === false));
    assert.equal(result.sha, sha); assert.equal(result.sourceDigest, sourceDigest);
  }
  process.stdout.write(JSON.stringify({ results, calls, credentialReads, elapsedMs }));
}

async function scenario(options = {}) {
  const script = `(${childScenario.toString()})(${JSON.stringify({ runtimeUrl, configUrl, ...options })}).catch(error => { console.error(error); process.exitCode = 1; });`;
  const { stdout, stderr } = await runFile(process.execPath, ['--input-type=module', '-e', script],
    { env: {}, timeout: 12000, maxBuffer: 1024 * 1024 });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}
const authenticated = proof => assert.equal(proof.results[0].auth.salesforce.state, 'authenticated');
const unknown = proof => assert.equal(proof.results[0].auth.salesforce.state, 'unknown');

test('actual application JWT grant signs synthetic assertion, then only reads pinned Organization', async () => {
  const proof = await scenario({ mode: 'jwt' }); authenticated(proof);
  assert.deepEqual(proof.calls.map(call => call.kind), ['grant', 'organization']);
});
test('actual application refresh-token grant is reused without changing diagnostic mode', async () => {
  const proof = await scenario({ mode: 'refresh' }); authenticated(proof);
  assert.deepEqual(proof.calls.map(call => call.method), ['POST', 'GET']);
});
test('actual static and incomplete-durable fallback sessions work; missing auth remains unknown', async () => {
  for (const mode of ['static', 'partial']) {
    const proof = await scenario({ mode }); authenticated(proof);
    assert.deepEqual(proof.calls, [{ kind: 'organization', method: 'GET' }]);
  }
  const proof = await scenario({ mode: 'missing' }); unknown(proof); assert.deepEqual(proof.calls, []);
});
test('injected diagnostic target mismatch rejects before any application environment or credential read', async () => {
  const proof = await scenario({ mode: 'jwt', diagnosticInstance: 'https://foreign.example' }); unknown(proof);
  assert.deepEqual(proof.credentialReads, []); assert.deepEqual(proof.calls, []);
});
test('actual resolved application instance is checked before and after acquisition', async () => {
  const before = await scenario({ mode: 'jwt', appInstance: 'https://foreign.example' }); unknown(before);
  assert.deepEqual(before.calls, []);
  assert.ok(before.credentialReads.every(name => name === 'SALESFORCE_INSTANCE_URL'));
  const after = await scenario({ mode: 'jwt', omitAppInstance: true, grantInstance: 'https://foreign.example' }); unknown(after);
  assert.deepEqual(after.calls.map(call => call.kind), ['grant']);
});
test('exact Production org, sandbox false and single metadata record are mandatory', async () => {
  for (const identity of ['foreign', 'sandbox', 'missing-sandbox', 'multiple', 'empty', 'malformed']) {
    const proof = await scenario({ mode: 'static', identity }); unknown(proof);
    assert.deepEqual(proof.calls, [{ kind: 'organization', method: 'GET' }]);
  }
});
test('actual auth errors and data HTTP/network/JSON errors remain sanitized without retries', async () => {
  const auth = await scenario({ mode: 'refresh', authError: true }); unknown(auth);
  assert.deepEqual(auth.calls.map(call => call.kind), ['grant']);
  for (const dataError of ['http', 'network', 'json']) {
    const proof = await scenario({ mode: 'static', dataError }); unknown(proof); assert.equal(proof.calls.length, 1);
  }
  authenticated(await scenario({ mode: 'static', version: 'https://foreign.example' }));
});
test('invalid source binding prevents real helper access and cached app grant is reused', async () => {
  assert.equal((await scenario({ mode: 'jwt', badBinding: true })).bindingRejected, true);
  const proof = await scenario({ mode: 'refresh', repeat: 2 }); authenticated(proof);
  assert.deepEqual(proof.calls.map(call => call.kind), ['grant', 'organization', 'organization']);
});
for (const authError of [false, true]) {
  test(`auth deadline returns unknown and never queries after late ${authError ? 'rejection' : 'completion'}`, async () => {
    const proof = await scenario({ mode: 'refresh', delayMs: 5500, authError }); unknown(proof);
    assert.ok(proof.elapsedMs >= 4900 && proof.elapsedMs < 5500);
    assert.equal(proof.results[0].auth.salesforce.code, 'READ_PROBE_FAILED');
    assert.deepEqual(proof.calls.map(call => call.kind), ['grant']);
  });
}
