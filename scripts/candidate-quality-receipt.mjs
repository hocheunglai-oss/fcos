import { constants, openSync, closeSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { releaseHash } from './lib/release-readiness.mjs';
import { CANDIDATE_QUALITY_SHA, CANDIDATE_QUALITY_WORKFLOW, CANDIDATE_QUALITY_MANIFEST,
  CANDIDATE_QUALITY_MANIFEST_HASH, CANDIDATE_QUALITY_FILENAME, CANDIDATE_QUALITY_ADMISSION,
  assertCandidateQualityRun, candidateQualitySource, createCandidateQualityReceipt } from './lib/candidate-quality.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fcosConnectionIdentifier('github', 'Repository');
const fail = () => { throw new Error('Trusted candidate quality operation failed; private diagnostics suppressed.'); };

// This adapter uses only the workflow's ephemeral read token. Every request is a
// fixed-host, repository-locked GET. No provider write or protected secret exists.
export function candidateQualityReads(token, request = fetch) {
  if (typeof token !== 'string' || !token.trim() || token !== token.trim()) fail();
  return { json: async endpoint => {
    if (typeof endpoint !== 'string' || !(endpoint === `repos/${repo}` || endpoint.startsWith(`repos/${repo}/`))
      || /[\\\r\n#]/.test(endpoint) || decodeURIComponent(endpoint).includes('..')) fail();
    try {
      const response = await request(`https://api.github.com/${endpoint}`, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(30000) });
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) fail();
      const content = await response.text();
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) fail();
      return JSON.parse(content);
    } catch { fail(); }
  } };
}

export async function runCandidateQualityReceipt({ mode, env = process.env, reads, now = Date.now() } = {}) {
  if (!['--source', '--publish'].includes(mode) || env.GITHUB_REPOSITORY !== repo || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_WORKFLOW_REF !== `${repo}/${CANDIDATE_QUALITY_WORKFLOW}@refs/heads/main`
    || env.FCOS_CANDIDATE_QUALITY_EXPECTED_SHA !== CANDIDATE_QUALITY_SHA || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') || !Number.isSafeInteger(Number(env.GITHUB_RUN_ID))
    || env.FCOS_CANDIDATE_QUALITY_ENABLED !== 'true') fail();
  const candidateCwd = resolve(root, '../candidate');
  if (env.FCOS_CANDIDATE_QUALITY_SOURCE_DIRECTORY !== candidateCwd || realpathSync(candidateCwd) !== candidateCwd) fail();
  const api = reads || candidateQualityReads(env.GH_TOKEN);
  const repository = await api.json(`repos/${repo}`);
  const branch = await api.json(`repos/${repo}/branches/main`);
  const run = await api.json(`repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}`);
  const harnessSha = assertCandidateQualityRun({ repository, branch, run, enabled: env.FCOS_CANDIDATE_QUALITY_ENABLED, phase: 'publishing', now });
  if (harnessSha !== env.GITHUB_SHA) fail();
  const candidateRef = await api.json(`repos/${repo}/git/ref/heads/${encodeURIComponent(CANDIDATE_QUALITY_ADMISSION.branch)}`);
  if (candidateRef.ref !== `refs/heads/${CANDIDATE_QUALITY_ADMISSION.branch}`
    || candidateRef.object?.sha !== CANDIDATE_QUALITY_SHA || candidateRef.object?.type !== 'commit') fail();
  for (const [path, expected] of [[CANDIDATE_QUALITY_MANIFEST, CANDIDATE_QUALITY_MANIFEST_HASH],
    [CANDIDATE_QUALITY_WORKFLOW, releaseHash(readFileSync(join(root, CANDIDATE_QUALITY_WORKFLOW)))]]) {
    const row = await api.json(`repos/${repo}/contents/${path}?ref=${harnessSha}`);
    if (row.type !== 'file' || row.path !== path || !/^[0-9a-f]{40}$/.test(row.sha || '') || row.encoding !== 'base64' || typeof row.content !== 'string'
      || releaseHash(Buffer.from(row.content, 'base64')) !== expected) fail();
  }
  const source = candidateQualitySource({ candidateCwd, trustedCwd: root, harnessSha });
  if (mode === '--source') return { sourceVerified: true, candidateSha: source.candidateSha, harnessSha };
  const jobs = await api.json(`repos/${repo}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`);
  const artifacts = await api.json(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`);
  const receipt = createCandidateQualityReceipt({ source, repository, branch, run, jobs, artifacts,
    enabled: env.FCOS_CANDIDATE_QUALITY_ENABLED, now });
  // Recheck current main and live admission immediately before publication.
  const latest = await api.json(`repos/${repo}/branches/main`);
  if (latest.name !== 'main' || latest.protected !== true || latest.commit?.sha !== harnessSha) fail();
  if (!env.RUNNER_TEMP || realpathSync(env.RUNNER_TEMP) !== resolve(env.RUNNER_TEMP)) fail();
  const output = join(env.RUNNER_TEMP, CANDIDATE_QUALITY_FILENAME);
  const fd = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, `${JSON.stringify(receipt)}\n`); } finally { closeSync(fd); }
  return { receiptPrepared: true, candidateSha: source.candidateSha, harnessSha, capturedAt: receipt.capturedAt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail();
    console.log(JSON.stringify(await runCandidateQualityReceipt({ mode: process.argv[2] })));
  } catch {
    console.error('Trusted candidate quality operation failed; private diagnostics suppressed.');
    process.exitCode = 1;
  }
}
