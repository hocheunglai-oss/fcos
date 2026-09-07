import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalFcosE2eCandidateUrl,
  main,
  resolveFcosE2eCandidate,
  verifyFcosE2eCandidate,
} from '../scripts/verify-e2e-candidate.mjs';

const project = 'fcos';
const team = 'hocheunglai-6535s-projects';
const candidateUrl = `https://${project}-a1b2c3d4e-${team}.vercel.app`;
const commit = '0123456789abcdef0123456789abcdef01234567';

test('accepts only the canonical immutable deployment hostname for the pinned FCOS project and team', () => {
  assert.equal(canonicalFcosE2eCandidateUrl(candidateUrl, { project, team }), candidateUrl);
  for (const candidate of [
    `${candidateUrl}/`,
    `${candidateUrl}?next=/`,
    `${candidateUrl}#fragment`,
    `https://user:password@${project}-a1b2c3d4e-${team}.vercel.app`,
    `https://${project}-a1b2c3d4e-${team}.vercel.app:443`,
    `https://${project}-a1b2c3d4-${team}.vercel.app`,
    `https://${project}-git-main-${team}.vercel.app`,
    `https://${project}-a1b2c3d4e-other-team.vercel.app`,
    'https://fcos.fcuno.com',
  ]) {
    assert.throws(() => canonicalFcosE2eCandidateUrl(candidate, { project, team }));
  }
});

test('verifies same-commit immutable metadata with no redirect before authentication', async () => {
  const calls = [];
  const result = await verifyFcosE2eCandidate({
    candidateUrl,
    expectedCommit: commit,
    project,
    team,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ commit, deploymentId: 'dpl_abc123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(result, { candidateUrl, commit, deploymentId: 'dpl_abc123' });
  assert.equal(calls[0].url, `${candidateUrl}/app-version.json`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.signal.aborted, false);
});

test('rejects redirects, foreign final URLs, mismatched commits, and malformed deployment identity', async () => {
  const response = ({ body, redirected = false, url = '' }) => ({
    ok: true,
    status: 200,
    redirected,
    url,
    json: async () => body,
  });
  await assert.rejects(
    verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, project, team, fetchImpl: async () => response({ body: { commit, deploymentId: 'dpl_abc123' }, redirected: true }) }),
    /must not redirect/,
  );
  await assert.rejects(
    verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, project, team, fetchImpl: async () => response({ body: { commit, deploymentId: 'dpl_abc123' }, url: 'https://elsewhere.example/app-version.json' }) }),
    /must not redirect/,
  );
  await assert.rejects(
    verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, project, team, fetchImpl: async () => response({ body: { commit: 'f'.repeat(40), deploymentId: 'dpl_abc123' } }) }),
    /does not match/,
  );
  await assert.rejects(
    verifyFcosE2eCandidate({ candidateUrl, expectedCommit: commit, project, team, fetchImpl: async () => response({ body: { commit, deploymentId: 'not-a-vercel-deployment' } }) }),
    /immutable Vercel deployment ID when present/,
  );
});

test('allows a null deployment ID in a prebuilt artifact while retaining URL and commit gates', async () => {
  const result = await verifyFcosE2eCandidate({
    candidateUrl,
    expectedCommit: commit,
    project,
    team,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      redirected: false,
      url: '',
      json: async () => ({ commit, deploymentId: null }),
    }),
  });
  assert.deepEqual(result, { candidateUrl, commit, deploymentId: null });
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    url: '',
    json: async () => body,
  };
}

test('discovers the newest exact-SHA FCOS Vercel Preview deployment and waits only for it', async () => {
  let clock = 0;
  let statusCalls = 0;
  const calls = [];
  const result = await resolveFcosE2eCandidate({
    expectedCommit: commit,
    githubToken: 'test-token',
    project,
    team,
    repository: 'hocheunglai-oss/fcos',
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/deployments?')) return jsonResponse([
        { id: 101, sha: commit, environment: 'Preview', creator: { login: 'vercel[bot]' }, created_at: '2026-09-06T00:00:00Z' },
        { id: 100, sha: commit, environment: 'Preview', creator: { login: 'vercel[bot]' }, created_at: '2026-09-05T00:00:00Z' },
      ]);
      if (url.includes('/deployments/101/statuses')) {
        statusCalls += 1;
        return jsonResponse(statusCalls === 1
          ? [{ state: 'pending', creator: { login: 'vercel[bot]' }, created_at: '2026-09-06T00:00:01Z' }]
          : [{ state: 'success', environment_url: candidateUrl, creator: { login: 'vercel[bot]' }, created_at: '2026-09-06T00:00:02Z' }]);
      }
      if (url.includes('/app-version.json')) return jsonResponse({ commit, deploymentId: null });
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  assert.deepEqual(result, { candidateUrl, commit, deploymentId: null, githubDeploymentId: 101 });
  assert.equal(statusCalls, 2);
  assert.equal(calls.some((url) => url.includes('/deployments/100/statuses')), false);
});

test('never accepts foreign, non-bot, wrong-SHA, or failed deployment records', async () => {
  const invalidDeployments = [
    { id: 1, sha: 'f'.repeat(40), environment: 'Preview', creator: { login: 'vercel[bot]' }, created_at: '2026-09-06T00:00:00Z' },
    { id: 2, sha: commit, environment: 'Preview', creator: { login: 'other-bot' }, created_at: '2026-09-06T00:00:01Z' },
    { id: 3, sha: commit, environment: 'Preview', creator: { login: 'vercel[bot]' }, repository_url: 'https://api.github.com/repos/other/repository', created_at: '2026-09-06T00:00:02Z' },
  ];
  await assert.rejects(
    resolveFcosE2eCandidate({
      expectedCommit: commit,
      githubToken: 'test-token',
      project,
      team,
      repository: 'hocheunglai-oss/fcos',
      maxWaitMs: 0,
      fetchImpl: async () => jsonResponse(invalidDeployments),
    }),
    /No successful immutable FCOS Preview deployment/,
  );

  await assert.rejects(
    resolveFcosE2eCandidate({
      expectedCommit: commit,
      githubToken: 'test-token',
      project,
      team,
      repository: 'hocheunglai-oss/fcos',
      fetchImpl: async (url) => (url.includes('/deployments?')
        ? jsonResponse([{ id: 9, sha: commit, environment: 'Preview', creator: { login: 'vercel[bot]' }, created_at: '2026-09-06T00:00:00Z' }])
        : jsonResponse([{ state: 'failure', creator: { login: 'vercel[bot]' }, created_at: '2026-09-06T00:00:01Z' }])),
    }),
    /reported failure/,
  );
});

function trustedCandidateResponse(url, providerUrl = candidateUrl) {
  if (url.includes('/deployments?')) return jsonResponse([
    { id: 123, sha: commit, environment: 'Preview', creator: { login: 'vercel[bot]' } },
  ]);
  if (url.includes('/deployments/123/statuses')) return jsonResponse([
    { state: 'success', environment_url: providerUrl, creator: { login: 'vercel[bot]' } },
  ]);
  assert.equal(url, `${candidateUrl}/app-version.json`);
  return jsonResponse({ commit, deploymentId: null });
}

test('explicit candidate must match independent provider evidence before its metadata is read', async () => {
  const calls = [];
  const result = await resolveFcosE2eCandidate({
    candidateUrl,
    expectedCommit: commit,
    githubToken: 'test-token',
    project,
    team,
    fetchImpl: async (url) => {
      calls.push(url);
      return trustedCandidateResponse(url);
    },
  });
  assert.deepEqual(result, { candidateUrl, commit, deploymentId: null, githubDeploymentId: 123 });
  assert.match(calls[0], /^https:\/\/api.github.com\/repos\/hocheunglai-oss\/fcos\/deployments\?/);
  assert.match(calls[1], /\/deployments\/123\/statuses/);
  assert.equal(calls[2], `${candidateUrl}/app-version.json`);
});

test('forged metadata, missing provider proof, and a different candidate URL cannot produce release evidence', async () => {
  let artifactCalls = 0;
  await assert.rejects(resolveFcosE2eCandidate({ candidateUrl, expectedCommit: commit,
    fetchImpl: async () => { artifactCalls++; return jsonResponse({ commit }); },
  }), /GITHUB_TOKEN is required/);
  await assert.rejects(resolveFcosE2eCandidate({ candidateUrl, expectedCommit: commit,
    githubToken: 'test-token', maxWaitMs: 0,
    fetchImpl: async (url) => {
      assert.match(url, /^https:\/\/api.github.com\//);
      return jsonResponse([]);
    },
  }), /No successful immutable/);
  await assert.rejects(resolveFcosE2eCandidate({ candidateUrl, expectedCommit: commit,
    githubToken: 'test-token', maxWaitMs: 0,
    fetchImpl: async (url) => {
      if (url.endsWith('/app-version.json')) artifactCalls++;
      return trustedCandidateResponse(url, candidateUrl.replace('a1b2c3d4e', 'z9y8x7w6v'));
    },
  }), /Requested candidate URL does not match/);
  assert.equal(artifactCalls, 0);
});

test('exports only the validated resolved base URL for later workflow steps', async () => {
  const writes = [];
  const result = await main({
    env: {
      FCOS_E2E_CANDIDATE_URL: candidateUrl,
      FCOS_E2E_EXPECTED_COMMIT: commit,
      GITHUB_TOKEN: 'test-token',
      GITHUB_ENV: '/tmp/github-env',
    },
    fetchImpl: async (url) => trustedCandidateResponse(url),
    append: async (...args) => writes.push(args),
  });
  assert.equal(result.candidateUrl, candidateUrl);
  assert.deepEqual(writes, [['/tmp/github-env', `FCOS_E2E_BASE_URL=${candidateUrl}\n`, 'utf8']]);
});
