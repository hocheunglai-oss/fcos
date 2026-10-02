import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES, previewEmailBuildControlRevision, createPreviewEmailBuildRequest } from '../scripts/lib/preview-email-build.mjs';
import { assertVercelPreviewAuthority, readPreviewVercelTokenMetadata,
  collectPreviewVercelAuthority } from '../scripts/lib/preview-vercel-authority.mjs';
import { createPreviewEmailVercelApi } from '../scripts/preview-email-proof-build.mjs';
import { LEGACY_EMAIL_BASELINE_CONTRACT } from '../scripts/lib/legacy-email-baseline-proof.mjs';

const now = Date.parse('2026-10-02T08:00:00.000Z');
const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const reviewedTokenId = 'reviewed-preview-token-id', privateMarker = 'private-fixture-value';
const currentPath = '/v5/user/tokens/current', listPath = '/v9/projects?limit=100';
const paths = [currentPath, listPath, '/v2/user', `/v2/teams/${teamId}`];
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fixture() {
  const project = { id: projectId, name: 'fcos', accountId: teamId, autoAssignCustomDomains: false,
    link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos', productionBranch: 'main', deployHooks: [] } };
  return { token: { id: reviewedTokenId, createdAt: now - 1000, expiresAt: now + 60 * 60 * 1000,
    scopes: [{ type: 'team', teamId }] }, reviewedTokenId, projects: { projects: [project], pagination: { count: 1, next: null, prev: null } },
  userStatus: 403, teamStatus: 403, project, deploymentConfiguration: { git: { deploymentEnabled: { main: false } } }, now };
}
function collector(value = fixture(), changed = {}) {
  const requests = [], projectReads = [];
  const options = { token: privateMarker, reviewedTokenId, deploymentConfiguration: value.deploymentConfiguration,
    now: () => now,
    readProject: async path => { projectReads.push(path); return value.project; },
    fetchImpl: async (url, request) => {
      const path = new URL(url).pathname + new URL(url).search;
      requests.push({ url, request });
      if (path === currentPath) return response({ token: value.token });
      if (path === listPath) return response(value.projects);
      if (path === '/v2/user') return response({ error: { code: 'forbidden' } }, value.userStatus);
      if (path === `/v2/teams/${teamId}`) return response({ error: { code: 'forbidden' } }, value.teamStatus);
      throw new Error(`Unexpected authority request: ${path}`);
    }, ...changed };
  return { options, requests, projectReads };
}

test('Preview authority binds reviewed live metadata and observed confinement without granting Production or asserting writes', () => {
  const value = fixture();
  value.token.createdAt = String(now);
  value.token.expiresAt = String(now + 86400000);
  const proof = assertVercelPreviewAuthority(value);
  assert.equal(proof.reviewedTokenBinding, 'verified');
  assert.equal(proof.projectScopeEvidence, 'observed');
  assert.equal(proof.projectId, projectId); assert.equal(proof.teamId, teamId);
  assert.equal(proof.tokenExpiresAt, now + 86400000);
  assert.equal(proof.productionAuthorized, false);
  assert.equal(proof.deploymentCreate, undefined);
  assert.equal(proof.identityVerified, undefined);
});

test('wrong token IDs, wider scopes, compromise, and unbounded or expired lifetime fail closed', () => {
  for (const change of [
    value => { value.reviewedTokenId = 'different'; }, value => { delete value.token.id; },
    value => { value.token.scopes = [{ type: 'user' }]; }, value => { value.token.scopes.push({ type: 'team', teamId: 'team_other' }); },
    value => { value.token.scopes[0].teamId = 'team_other'; }, value => { value.token.scopes[0].type = 'project'; },
    value => { value.token.revokedAt = now - 1; }, value => { value.token.leakedAt = now - 1; },
    value => { delete value.token.createdAt; }, value => { delete value.token.expiresAt; },
    value => { value.token.createdAt = now + 1; }, value => { value.token.expiresAt = now; },
    value => { value.token.expiresAt = value.token.createdAt + 86400001; },
    value => { value.token.createdAt = 'not-a-date'; }, value => { value.token.expiresAt = Infinity; },
    value => { value.token.expiresAt = true; }, value => { value.token.scopes[0].expiresAt = now; },
    value => { value.token.scopes[0].expiresAt = 'invalid'; }, value => { value.now = NaN; },
  ]) { const value = fixture(); change(value); assert.throws(() => assertVercelPreviewAuthority(value), /current metadata/); }
});

test('exact project success cannot substitute for complete unfiltered project scope and denied broad reads', () => {
  for (const change of [
    value => { value.projects = value.projects.projects; }, value => { delete value.projects.pagination; },
    value => { delete value.projects.pagination.next; }, value => { value.projects.pagination.next = now; },
    value => { value.projects.pagination.prev = now; }, value => { value.projects.pagination.count = 2; },
    value => { value.projects.hasMore = true; }, value => { value.projects.projects = []; },
    value => { value.projects.projects.push({ id: 'prj_other', accountId: teamId, name: 'other' }); },
    value => { value.projects.projects = [{ ...value.project, id: 'prj_other' }]; },
    value => { value.projects.projects = [{ ...value.project, accountId: 'team_other' }]; },
    value => { value.projects.projects = [{ ...value.project, name: 'other' }]; },
    value => { value.userStatus = 200; }, value => { value.teamStatus = 200; },
    value => { value.userStatus = 401; }, value => { value.teamStatus = 404; },
  ]) { const value = fixture(); change(value); assert.throws(() => assertVercelPreviewAuthority(value)); }
});

test('exact project, repository, retained automatic-release and hooks checks remain required', () => {
  for (const change of [
    value => { value.project = { ...value.project, id: 'prj_other' }; },
    value => { value.project = { ...value.project, accountId: 'team_other' }; },
    value => { value.project.name = 'other'; }, value => { value.project.link.type = 'gitlab'; },
    value => { value.project.link.org = 'other'; }, value => { value.project.link.repo = 'other'; },
    value => { value.project.autoAssignCustomDomains = true; }, value => { delete value.project.autoAssignCustomDomains; },
    value => { value.project.link.deployHooks.push({ id: 'hook' }); }, value => { delete value.project.link.deployHooks; },
    value => { value.deploymentConfiguration.git.deploymentEnabled.main = true; },
    value => { value.deploymentConfiguration.git.deploymentEnabled = { '*': false, main: true }; },
    value => { value.deploymentConfiguration = {}; },
  ]) { const value = fixture(); change(value); assert.throws(() => assertVercelPreviewAuthority(value)); }
  for (const enabled of [false, { '*': false }]) {
    const value = fixture(); value.deploymentConfiguration.git.deploymentEnabled = enabled;
    assert.equal(assertVercelPreviewAuthority(value).productionAuthorized, false);
  }
});

test('collector uses one team-free current read and unfiltered list, confirms exact denials, then uses pinned project reader', async () => {
  const value = collector(), result = await collectPreviewVercelAuthority(value.options);
  assert.deepEqual(value.requests.map(row => new URL(row.url).pathname + new URL(row.url).search), paths);
  assert.deepEqual(value.projectReads, [`/v9/projects/${projectId}`]);
  for (const { url, request } of value.requests) {
    assert.equal(new URL(url).origin, 'https://api.vercel.com');
    assert.equal(new URL(url).searchParams.has('teamId'), false);
    assert.equal(new URL(url).searchParams.has('slug'), false);
    assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
    assert.equal(request.headers.authorization, `Bearer ${privateMarker}`); assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.body, undefined);
  }
  assert.equal(result.authority.productionAuthorized, false);
  assert.ok(!JSON.stringify(result.authority).includes(privateMarker));
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('denied or incomplete current metadata stops before scope, identity fallback or project reads', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    let count = 0;
    const value = collector(fixture(), { fetchImpl: async url => {
      count++; assert.equal(new URL(url).pathname, currentPath); return response({}, status);
    } });
    await assert.rejects(() => collectPreviewVercelAuthority(value.options), /current token metadata is unavailable/);
    assert.equal(count, 1); assert.equal(value.projectReads.length, 0);
  }
  for (const metadata of [{}, { id: reviewedTokenId }, { ...fixture().token, id: 'other' }, { ...fixture().token, expiresAt: undefined }]) {
    let count = 0;
    const value = collector(fixture(), { fetchImpl: async () => { count++; return response({ token: metadata }); } });
    await assert.rejects(() => collectPreviewVercelAuthority(value.options), /current metadata/);
    assert.equal(count, 1); assert.equal(value.projectReads.length, 0);
  }
});

test('the metadata reader neither accepts local data nor falls back after transport failure', async () => {
  await assert.rejects(() => readPreviewVercelTokenMetadata({ reviewedTokenId, now }), /protected Preview credential/);
  let count = 0;
  await assert.rejects(() => readPreviewVercelTokenMetadata({ token: privateMarker, reviewedTokenId, now,
    fetchImpl: async () => { count++; throw Error(privateMarker); } }), error => {
    assert.ok(!error.message.includes(privateMarker)); return /GET failed/.test(error.message);
  });
  assert.equal(count, 1);
});

test('partial or broader project list stops before denial or exact-project checks', async () => {
  for (const change of [
    value => { value.projects.projects.push({ id: 'prj_other' }); },
    value => { value.projects.pagination.next = 1; }, value => { delete value.projects.pagination; },
  ]) {
    const inputs = fixture(); change(inputs); const value = collector(inputs);
    await assert.rejects(() => collectPreviewVercelAuthority(value.options), /complete unfiltered/);
    assert.equal(value.requests.length, 2); assert.equal(value.projectReads.length, 0);
  }
});

test('unverified denial statuses never authorize Preview and do not reach the project reader', async () => {
  for (const field of ['userStatus', 'teamStatus']) for (const status of [200, 401, 404, 429, 500]) {
    const inputs = fixture(); inputs[field] = status; const value = collector(inputs);
    await assert.rejects(() => collectPreviewVercelAuthority(value.options), /denial is unverified/);
    assert.equal(value.requests.length, field === 'userStatus' ? 3 : 4);
    assert.equal(value.projectReads.length, 0);
  }
});

test('authority rechecks expiration after provider reads instead of reusing its initial clock', async () => {
  const inputs = fixture(); inputs.token.expiresAt = now + 1;
  let clockReads = 0; const value = collector(inputs, { now: () => clockReads++ ? now + 1 : now });
  await assert.rejects(() => collectPreviewVercelAuthority(value.options), /current metadata/);
  assert.equal(clockReads, 2); assert.equal(value.requests.length, 4);
});

test('redirected, malformed, oversized, non-JSON and unavailable responses fail with redacted diagnostics', async () => {
  for (const fetchImpl of [
    async () => ({ status: 200, redirected: true }),
    async () => ({ status: 200, redirected: false, url: 'https://untrusted.invalid/' }),
    async () => new Response(privateMarker, { headers: { 'content-type': 'application/json' } }),
    async () => new Response(JSON.stringify({ token: fixture().token })),
    async () => new Response('x'.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
  ]) await assert.rejects(() => readPreviewVercelTokenMetadata({ token: privateMarker, reviewedTokenId, now, fetchImpl }), error => {
    assert.ok(!error.message.includes(privateMarker)); return /GET failed/.test(error.message);
  });
});

test('Preview project-resource adapter retains exact project/team pins using the same token for bounded GETs', async () => {
  const requests = [], api = createPreviewEmailVercelApi({ token: privateMarker, fetchImpl: async (url, request) => {
    requests.push({ url, request }); return response({ fixture: true });
  } });
  for (const path of [`/v9/projects/${projectId}`, `/v9/projects/${projectId}/env?decrypt=false`,
    `/v9/projects/${projectId}/env?decrypt=false&until=1`, '/v13/deployments/dpl_Fixture',
    `/v6/deployments?projectId=${projectId}&limit=100&since=${now}&until=1`]) {
    assert.deepEqual(await api.get(path), { fixture: true });
  }
  assert.equal(requests.length, 5);
  for (const { url, request } of requests) {
    assert.equal(new URL(url).origin, 'https://api.vercel.com');
    assert.equal(new URL(url).searchParams.get('teamId'), teamId);
    assert.equal(request.headers.authorization, `Bearer ${privateMarker}`);
    assert.equal(request.method, 'GET'); assert.equal(request.body, undefined);
    assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
  }
});

test('Preview adapter denies account, team, foreign, decrypted, filtered and unbounded paths before contacting provider', async () => {
  let calls = 0;
  const api = createPreviewEmailVercelApi({ token: privateMarker, fetchImpl: async () => { calls++; return response({}); } });
  for (const path of ['/v2/user', `/v2/teams/${teamId}`, '/v9/projects', '/v13/deployments', '/v13/deployments/dpl_test/promote',
    '/v9/projects/prj_other', `https://api.vercel.com/v9/projects/${projectId}`, '//untrusted.invalid/v6/deployments',
    `/v9/projects/${projectId}/env?decrypt=true`, `/v9/projects/${projectId}/env?decrypt=false&teamId=team_other`,
    `/v9/projects/${projectId}/env?decrypt=false&until=-1`, `/v9/projects/${projectId}/env?decrypt=false&until=99999999999999999999`,
    `/v6/deployments?projectId=${projectId}&limit=100`, `/v6/deployments?projectId=prj_other&limit=100&since=${now}`,
    `/v6/deployments?projectId=${projectId}&limit=100&since=${now}&since=1`,
  ]) await assert.rejects(() => api.get(path), /resource request failed/);
  assert.equal(calls, 0);
});

function exactRequest() {
  return createPreviewEmailBuildRequest({ candidateSha: LEGACY_EMAIL_BASELINE_CONTRACT.preview.candidates[0].sha,
    runId: 99, operationId: 'fcos-preview-email-99-12345678-1234-4123-8123-123456789abc' });
}
test('Preview POST sends only exact reviewed Git-source request once and never transparently retries uncertainty', async () => {
  const requests = [], api = createPreviewEmailVercelApi({ token: privateMarker, fetchImpl: async (url, request) => {
    requests.push({ url, request }); throw new Error(privateMarker);
  } });
  await assert.rejects(() => api.create(exactRequest()), error => {
    assert.ok(!error.message.includes(privateMarker)); return /Read back any uncertain creation/.test(error.message);
  });
  assert.equal(requests.length, 1);
  const { url, request } = requests[0];
  assert.equal(new URL(url).pathname, '/v13/deployments'); assert.equal(new URL(url).searchParams.get('teamId'), teamId);
  assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error');
  assert.equal(request.headers.authorization, `Bearer ${privateMarker}`);
  assert.deepEqual(JSON.parse(request.body), exactRequest());
});

test('Preview POST refuses Production target, environment overrides, altered project, branch, source or operation before fetch', () => {
  let calls = 0;
  const api = createPreviewEmailVercelApi({ token: privateMarker, fetchImpl: async () => { calls++; return response({}); } });
  for (const change of [
    value => { value.target = 'production'; }, value => { value.env = { PRIVATE: privateMarker }; },
    value => { value.build = { env: { PRIVATE: privateMarker } }; }, value => { value.project = 'prj_other'; },
    value => { value.gitSource.ref = 'main'; }, value => { value.gitSource.sha = 'a'.repeat(40); },
    value => { value.meta.fcosPreviewEmailBuildOperation = 'fcos-release-99'; }, value => { value.forceNew = true; },
  ]) { const value = exactRequest(); change(value); assert.throws(() => api.create(value)); }
  assert.equal(calls, 0);
});

test('Preview transport accepts provider success status and rejects redirects, HTTP and malformed JSON with no retries', async () => {
  const ok = createPreviewEmailVercelApi({ token: privateMarker, fetchImpl: async () => response({ id: 'dpl_Fixture' }, 201) });
  assert.equal((await ok.create(exactRequest())).id, 'dpl_Fixture');
  for (const fetchImpl of [
    async () => response({}, 500), async () => response({}, 403), async () => ({ status: 200, redirected: true }),
    async () => new Response(privateMarker, { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    const api = createPreviewEmailVercelApi({ token: privateMarker, fetchImpl: (...args) => { calls++; return fetchImpl(...args); } });
    await assert.rejects(() => api.create(exactRequest()), error => {
      assert.ok(!error.message.includes(privateMarker)); return /resource request failed/.test(error.message);
    });
    assert.equal(calls, 1);
  }
});

test('new Preview helper participates in local and remote control revision and builder uses the Preview authority path', () => {
  const helper = 'scripts/lib/preview-vercel-authority.mjs';
  assert.ok(PREVIEW_EMAIL_BUILD_CONTROL_FILES.includes(helper));
  const root = new URL('../', import.meta.url), directory = mkdtempSync(join(tmpdir(), 'fcos-preview-authority-'));
  try {
    for (const file of PREVIEW_EMAIL_BUILD_CONTROL_FILES) {
      const target = join(directory, file); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(new URL(file, root)));
    }
    const before = previewEmailBuildControlRevision(directory);
    writeFileSync(join(directory, helper), `${readFileSync(join(directory, helper), 'utf8')}\n`);
    assert.notEqual(previewEmailBuildControlRevision(directory), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const builder = readFileSync(new URL('../scripts/preview-email-proof-build.mjs', import.meta.url), 'utf8');
  assert.match(builder, /collectPreviewVercelAuthority\(\{ token: env\.VERCEL_TOKEN, reviewedTokenId: approved\.reviewedTokenId,/);
  assert.match(builder, /readProject: api/);
  assert.doesNotMatch(builder, /assertVercelProductionAuthority|readVercelTokenMetadata/);
  assert.doesNotMatch(builder, /'--scope'|cli\(\['api'/);
  assert.match(builder, /create: request => provider\.create\(request\)/);
  const controls = readFileSync(new URL('../scripts/lib/preview-email-build.mjs', import.meta.url), 'utf8');
  assert.match(controls, /for \(const file of PREVIEW_EMAIL_BUILD_CONTROL_FILES\)/);
});
