import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { candidateProtectionState, prepareCandidateProtection } from '../scripts/e2e-protection-state.mjs';
import { verifyFcosE2eCandidate, resolveFcosE2eCandidate } from '../scripts/verify-e2e-candidate.mjs';

const candidateUrl = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
const commit = 'a'.repeat(40);
const secret = 'b'.repeat(32);
const env = {
  GITHUB_TOKEN: 'synthetic-github',
  FCOS_E2E_BASE_URL: candidateUrl, FCOS_E2E_EXPECTED_COMMIT: commit,
  FCOS_E2E_VERCEL_BYPASS: secret, FCOS_E2E_PROTECTION_STATE: '/tmp/test-protection.json',
  FCOS_E2E_STORAGE_STATE: '/tmp/test-auth.json', FCOS_REQUIRE_AUTH_E2E: '1',
};
const cookie = () => ({ name: '_vercel_jwt', domain: new URL(candidateUrl).hostname, path: '/',
  secure: true, httpOnly: true, sameSite: 'Lax', value: 'synthetic-cookie', expires: Date.now() / 1000 + 3600 });

test('protection cookie is host-only, short-lived, secure, HttpOnly, and contains no identity state', () => {
  const state = { cookies: [cookie()], origins: [] };
  assert.deepEqual(candidateProtectionState(state, candidateUrl), state);
  for (const patch of [
    { domain: '.vercel.app' }, { domain: `.${new URL(candidateUrl).hostname}` }, { domain: 'fcuno.com' },
    { name: 'other' }, { path: '/elsewhere' }, { secure: false }, { httpOnly: false },
    { sameSite: 'None' }, { expires: -1 }, { expires: Date.now() / 1000 + 9 * 86400 }, { value: '' },
  ]) assert.throws(() => candidateProtectionState({ cookies: [{ ...cookie(), ...patch }] }, candidateUrl));
  assert.throws(() => candidateProtectionState({ cookies: [cookie(), cookie()] }, candidateUrl));
  assert.throws(() => candidateProtectionState({ cookies: [cookie()], origins: [{ origin: 'https://fcuno.com' }] }, candidateUrl));
});

test('candidate verifier sends protection header only to validated immutable FCOS metadata, never follows redirects', async () => {
  let count = 0;
  const fetchImpl = async (url, options) => {
    count += 1;
    assert.equal(url, `${candidateUrl}/app-version.json`);
    assert.equal(options.headers['x-vercel-protection-bypass'], secret);
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ commit }));
  };
  await verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, protectionBypass: secret, fetchImpl });
  for (const invalid of ['https://fcuno.com', 'https://fcos.fcuno.com', `${candidateUrl}/?secret=bad`]) {
    await assert.rejects(verifyFcosE2eCandidate({ candidateUrl: invalid, expectedCommit: commit, protectionBypass: secret, fetchImpl }));
  }
  assert.equal(count, 1);
  await assert.rejects(verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, protectionBypass: secret,
    fetchImpl: async () => { throw new Error(`sensitive ${secret}`); } }), (error) => !error.message.includes(secret));
  await assert.rejects(verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, protectionBypass: secret,
    fetchImpl: async () => new Response(JSON.stringify({ commit: secret })) }), (error) => !error.message.includes(secret));
});

test('deployment discovery never sends the Vercel credential to GitHub', async () => {
  await resolveFcosE2eCandidate({ expectedCommit: commit, protectionBypass: secret, githubToken: 'synthetic-github',
    fetchImpl: async (url, options) => {
      if (url.startsWith('https://api.github.com/')) {
        assert.equal(options.headers['x-vercel-protection-bypass'], undefined);
        return new Response(JSON.stringify(url.includes('/statuses')
          ? [{ state: 'success', creator: { login: 'vercel[bot]' }, environment_url: candidateUrl }]
          : [{ id: 1, sha: commit, environment: 'Preview', creator: { login: 'vercel[bot]' } }]));
      }
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers['x-vercel-protection-bypass'], secret);
      return new Response(JSON.stringify({ commit }));
    } });
});

function harness({ status = 307, location = '/app-version.json', error = null, state = { cookies: [cookie()] } } = {}) {
  const calls = [];
  const context = {
    get: async (url, options) => { calls.push(['get', url, options]); if (error) throw error; return { url: () => url, status: () => status, headers: () => ({ location }) }; },
    storageState: async () => state,
    dispose: async () => calls.push(['dispose']),
  };
  return { calls, args: { env, request: { newContext: async (...args) => { calls.push(['context', ...args]); return context; } },
    verify: async (args) => { calls.push(['verify', args]); },
    writeState: async (args) => { calls.push(['write', args]); } } };
}

test('bootstrap verifies commit first, refuses redirects, and persists only a private scoped cookie', async () => {
  const { calls, args } = harness();
  assert.equal(await prepareCandidateProtection(args), env.FCOS_E2E_PROTECTION_STATE);
  assert.equal(calls[0][0], 'verify');
  assert.equal(calls[0][1].githubToken, env.GITHUB_TOKEN);
  assert.deepEqual(calls[1], ['context']);
  const get = calls.find(([name]) => name === 'get');
  assert.equal(get[1], `${candidateUrl}/app-version.json`);
  assert.equal(get[2].maxRedirects, 0);
  const write = calls.find(([name]) => name === 'write');
  assert.equal(write[1].path, env.FCOS_E2E_PROTECTION_STATE);
  assert.equal(JSON.stringify(write[1].state).includes(secret), false);
  assert.equal(write[1].state.origins.length, 0);
  assert.deepEqual(calls.at(-1), ['dispose']);
});

test('bootstrap fails closed without writing unsafe state or echoing protected request errors', async () => {
  for (const options of [{ status: 200 }, { location: 'https://fcuno.com' }, { error: new Error(secret) }, { state: { cookies: [] } }]) {
    const { calls, args } = harness(options);
    await assert.rejects(prepareCandidateProtection(args), (error) => !error.message.includes(secret));
    assert.equal(calls.some(([name]) => name === 'write'), false);
    assert.deepEqual(calls.at(-1), ['dispose']);
  }
  const { calls, args } = harness();
  await assert.rejects(prepareCandidateProtection({ ...args, env: { ...env, FCOS_E2E_VERCEL_BYPASS: '' } }), /required/);
  await assert.rejects(prepareCandidateProtection({ ...args, env: { ...env, FCOS_E2E_BASE_URL: 'https://fcuno.com' } }));
  assert.equal(calls.length, 0);
});

test('CI has no global bypass headers or sensitive trace recording and always removes generated authentication state', async () => {
  const config = await readFile(new URL('../playwright.config.js', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/authenticated-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /extraHTTPHeaders/);
  assert.match(config, /trace: 'off'/);
  assert.match(config, /screenshot: 'off', video: 'off'/);
  assert.match(workflow, /FCOS_E2E_VERCEL_BYPASS: \$\{\{ secrets.FCOS_E2E_VERCEL_BYPASS \}\}/);
  assert.match(workflow, /environment: fcos-ci-readonly/);
  assert.match(workflow, /Remove private browser state\n\s+if: \$\{\{ always\(\) \}\}/);
});
