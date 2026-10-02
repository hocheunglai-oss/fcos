import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { collectBuildProvenance } from './lib/build-provenance.mjs';
import { githubReleaseReads, assertReleaseGitHubAccount, RELEASE_REPOSITORY } from './lib/release-evidence.mjs';
import { githubReleaseOidc } from './lib/release-production.mjs';
import { collectPreviewVercelAuthority } from './lib/preview-vercel-authority.mjs';
import { releaseHash } from './lib/release-readiness.mjs';
import { previewEmailBuildCandidate, createPreviewEmailBuildRequest, previewEmailBuildControlRevision, assertPreviewEmailBuildProtection,
  collectPreviewEmailEnvironmentRecords, createPreviewEmailBuildIntent, collectTrustedPreviewEmailIntent,
  runControlledPreviewEmailBuild, readPreviewEmailBuildVersion, PREVIEW_EMAIL_BUILD_ENVIRONMENT,
  PREVIEW_EMAIL_INTENT_FILENAME, PREVIEW_EMAIL_BUILD_FILENAME, PREVIEW_EMAIL_CONTRACT_SHA256 } from './lib/preview-email-build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const baseline = JSON.parse(readFileSync(new URL('../config/legacy-email-baseline-proof.json', import.meta.url))).baseline;
const projectId = fcosConnectionIdentifier('vercel', 'Project ID'), teamId = fcosConnectionIdentifier('vercel', 'Team ID');
const command = (binary, args, options = {}) => {
  try { return execFileSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
  catch { throw new Error('Pinned Preview proof command failed; private diagnostics suppressed.'); }
};
export function previewEmailBuildArguments(args, env = process.env) {
  if (args.length > 1 || args.some(value => !['--dry-run', '--prepare', '--create', '--readback'].includes(value))) throw new Error('Use one protected Preview proof mode.');
  return { mode: args[0]?.slice(2) || 'dry-run', candidateSha: env.FCOS_E2E_EXPECTED_COMMIT,
    candidateCwd: resolve(env.FCOS_RELEASE_SOURCE_DIRECTORY || ROOT), recoveryRunId: Number(env.FCOS_PREVIEW_EMAIL_ORIGINAL_RUN_ID) };
}
async function completeEnvironmentNames(reads, endpoint, field) {
  const values = []; let total;
  for (let page = 1; page <= 100; page++) {
    const response = await reads.json(`${endpoint}?per_page=100&page=${page}`);
    if (!Array.isArray(response?.[field]) || !Number.isSafeInteger(response.total_count) || response.total_count > 10000 || response.total_count < 0
      || total !== undefined && total !== response.total_count) throw new Error('Complete protected environment setup is unavailable.');
    total = response.total_count; values.push(...response[field]);
    if (values.length === total) return { [field]: values };
    if (!response[field].length || values.length > total) throw new Error('Protected environment paging is incomplete.');
  }
  throw new Error('Protected environment paging exceeded its bounded scan.');
}

/** The pinned CLI's --scope requires denied account reads, and its API client
 * retries POSTs. This Preview-only fallback uses fixed resource paths and one
 * fetch per operation; the durable state machine alone decides when to create. */
export function createPreviewEmailVercelApi({ token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token) throw new Error('The existing protected Preview credential is required.');
  const digits = /^[1-9][0-9]*$/;
  const positive = value => digits.test(value || '') && Number.isSafeInteger(Number(value));
  const allowedGet = path => {
    if (path === `/v9/projects/${projectId}` || /^\/v13\/deployments\/dpl_[A-Za-z0-9]+$/.test(path)) return true;
    const url = new URL(path, 'https://api.vercel.com');
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) return false;
    if (url.pathname === `/v9/projects/${projectId}/env`) return url.searchParams.get('decrypt') === 'false'
      && keys.every(key => ['decrypt', 'until'].includes(key))
      && (!url.searchParams.has('until') || positive(url.searchParams.get('until')));
    return url.pathname === '/v6/deployments' && url.searchParams.get('projectId') === projectId
      && url.searchParams.get('limit') === '100' && positive(url.searchParams.get('since'))
      && keys.every(key => ['projectId', 'limit', 'since', 'until'].includes(key))
      && (!url.searchParams.has('until') || positive(url.searchParams.get('until')));
  };
  const request = async (path, method, body) => {
    try {
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('#')
        || method === 'GET' && !allowedGet(path) || method === 'POST' && path !== '/v13/deployments') throw new Error('path');
      const url = new URL(path, 'https://api.vercel.com');
      if (url.origin !== 'https://api.vercel.com') throw new Error('origin');
      url.searchParams.set('teamId', teamId);
      const response = await fetchImpl(url.href, { method, headers: { authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(body === undefined ? {} : { body }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (response.redirected !== false || response.url && response.url !== url.href
        || !(response.status === 200 || method === 'POST' && response.status === 201)
        || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('response');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('body');
      const chunks = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 8 * 1024 * 1024) throw new Error('size');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new Error('Pinned Preview resource request failed; private diagnostics suppressed. Read back any uncertain creation.'); }
  };
  return { get: path => request(path, 'GET'), create: body => {
    const operationId = body?.meta?.fcosPreviewEmailBuildOperation;
    const runId = Number(/^fcos-preview-email-([1-9][0-9]*)-/.exec(operationId || '')?.[1]);
    const expected = createPreviewEmailBuildRequest({ candidateSha: body?.gitSource?.sha, runId, operationId });
    if (JSON.stringify(body) !== JSON.stringify(expected)) throw new Error('Preview POST must match the exact reviewed Git-source request without overrides.');
    return request('/v13/deployments', 'POST', JSON.stringify(expected));
  } };
}

export async function runPreviewEmailProofBuild({ mode = 'dry-run', candidateSha, candidateCwd = ROOT,
  recoveryRunId, trustedCwd = ROOT, env = process.env } = {}) {
  if (mode === 'dry-run') return { schemaVersion: 1, kind: 'fcos_preview_email_build_plan', enabledByDefault: false,
    productionAuthorized: false, mutations: 0, contractSha256: PREVIEW_EMAIL_CONTRACT_SHA256,
    workflow: '.github/workflows/preview-email-proof-build.yml', environment: PREVIEW_EMAIL_BUILD_ENVIRONMENT,
    requirements: ['current protected main', 'pinned human per-run review', 'exact contract/source/control pins',
      'unchanged retained Production', 'archive-backed intent before one Preview POST', 'readback-only recovery',
      'fresh complete metadata and actual source receipt', 'separate normal-user and signer evidence'] };
  if (!['prepare', 'create', 'readback'].includes(mode) || !env.RUNNER_TEMP || !env.GH_TOKEN || !env.VERCEL_TOKEN) throw new Error('Dedicated protected runner and existing credentials are required.');
  const candidate = previewEmailBuildCandidate(candidateSha);
  const source = collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true });
  const harness = collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true });
  const lockHash = releaseHash(readFileSync(join(candidateCwd, 'package-lock.json')));
  const controlRevision = previewEmailBuildControlRevision(trustedCwd);
  if (!source.releaseEligible || !harness.releaseEligible || source.commit !== candidate.sha
    || source.sourceDigest !== candidate.sourceDigest || lockHash !== candidate.lockHash) throw new Error('Clean exact source and dependency pins failed.');
  const reads = githubReleaseReads({ command: 'gh', env: { PATH: env.PATH, HOME: env.HOME, GH_HOST: 'github.com',
    GH_REPO: RELEASE_REPOSITORY, GH_TOKEN: env.GH_TOKEN } }, { cwd: trustedCwd });
  if (command('vercel', ['--version'], { cwd: trustedCwd, env: { PATH: env.PATH, HOME: env.HOME, CI: '1', NO_COLOR: '1',
    VERCEL_TELEMETRY_DISABLED: '1', VERCEL_NO_UPDATE_NOTIFICATION: '1' } }).trim().replace(/^Vercel CLI /i, '') !== '54.20.1') {
    throw new Error('The reviewed provider CLI version is required.');
  }
  const provider = createPreviewEmailVercelApi({ token: env.VERCEL_TOKEN }), api = provider.get;
  let signed, approved;
  async function authority(intent) {
    assertReleaseGitHubAccount(reads);
    signed = await githubReleaseOidc({ env });
    const repository = reads.json(`repos/${RELEASE_REPOSITORY}`);
    const branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
    const variables = await completeEnvironmentNames(reads, `repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}/variables`, 'variables');
    approved = assertPreviewEmailBuildProtection({ repository, branch,
      protection: reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`),
      environment: reads.json(`repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}`), variables,
      secrets: await completeEnvironmentNames(reads, `repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}/secrets`, 'secrets'),
      run: reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${signed.run_id}`),
      approvals: reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${signed.run_id}/approvals`), oidcClaims: signed,
      candidateSha, harnessSha: harness.commit, controlRevision });
    if (reads.json(`repos/${RELEASE_REPOSITORY}/git/ref/heads/${encodeURIComponent(candidate.branch)}`).object?.sha !== candidateSha) throw new Error('The reviewed candidate branch changed.');
    if (collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true }).sourceDigest !== source.sourceDigest
      || collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true }).commit !== harness.commit
      || previewEmailBuildControlRevision(trustedCwd) !== controlRevision) throw new Error('Reviewed source or controls changed during execution.');
    const { project } = await collectPreviewVercelAuthority({ token: env.VERCEL_TOKEN, reviewedTokenId: approved.reviewedTokenId,
      readProject: api, deploymentConfiguration: JSON.parse(readFileSync(join(candidateCwd, 'vercel.json'))) });
    if (project.link.productionBranch !== repository.default_branch || project.targets?.production?.id !== baseline.deploymentId) throw new Error('The retained Production target changed.');
    const previous = await api(`/v13/deployments/${baseline.deploymentId}`);
    if (previous.projectId !== projectId || previous.ownerId !== teamId && previous.teamId !== teamId
      || previous.target !== 'production' || previous.readyState !== 'READY' || previous.meta?.githubCommitSha !== baseline.sha
      || `https://${previous.url}` !== baseline.url) throw new Error('The exact retained Production readback failed.');
    if (intent) {
      if (intent.harnessSha !== harness.commit || intent.controlRevision !== controlRevision || intent.candidate.sha !== candidateSha
        || mode === 'create' && intent.runId !== approved.runId) throw new Error('Only this approved first run may submit its original intent.');
      const current = await collectPreviewEmailEnvironmentRecords({ api });
      if (JSON.stringify(current.records) !== JSON.stringify(intent.environmentRecords.records)) throw new Error('Project environment records changed after intent capture.');
    }
    return approved;
  }
  await authority();
  const directory = resolve(env.RUNNER_TEMP);
  if (directory === '/' || directory === resolve(trustedCwd) || directory === resolve(candidateCwd)
    || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('A private regular runner journal directory is required.');
  if (mode === 'prepare') {
    const intent = createPreviewEmailBuildIntent({ candidateSha, harnessSha: harness.commit, controlRevision,
      runId: approved.runId, operationId: `fcos-preview-email-${approved.runId}-${randomUUID()}`,
      records: await collectPreviewEmailEnvironmentRecords({ api }) });
    writeFileSync(join(directory, PREVIEW_EMAIL_INTENT_FILENAME), `${JSON.stringify(intent)}\n`, { mode: 0o600, flag: 'wx', flush: true });
    return { durableIntentPrepared: true, runId: approved.runId, candidateSha, mutations: 0, productionAuthorized: false };
  }
  const originalRunId = mode === 'create' ? approved.runId : recoveryRunId;
  if (!Number.isSafeInteger(originalRunId) || originalRunId <= 0 || mode === 'readback' && originalRunId === approved.runId) throw new Error('Readback needs a distinct original approved first-run intent.');
  const intent = await collectTrustedPreviewEmailIntent({ reads, runId: originalRunId, candidateSha,
    completed: mode === 'readback' ? 'intent' : false });
  const journalPath = join(directory, `fcos-preview-email-journal-${approved.runId}.jsonl`);
  // A repeated invocation in the same first attempt cannot resubmit a POST.
  // Recovery uses a separately reviewed run and only the original remote intent.
  writeFileSync(journalPath, '', { mode: 0o600, flag: 'wx', flush: true });
  const journal = async row => appendFileSync(journalPath, `${JSON.stringify(row)}\n`, { mode: 0o600, flush: true });
  const discover = async () => {
    const matches = [], ids = new Set(), cursors = new Set(); let until;
    for (let page = 0; page < 100; page++) {
      const data = await api(`/v6/deployments?projectId=${projectId}&limit=100&since=${Date.parse(intent.intentAt)}${until === undefined ? '' : `&until=${until}`}`);
      if (!Array.isArray(data.deployments) || data.deployments.length > 100 || !data.pagination
        || !Number.isSafeInteger(data.pagination.count) || data.pagination.count !== data.deployments.length) throw new Error('Operation recovery pagination is incomplete.');
      for (const row of data.deployments) {
        const id = row.uid || row.id;
        if (!/^dpl_[A-Za-z0-9]+$/.test(id || '') || ids.has(id)) throw new Error('Operation recovery returned duplicate deployment records.');
        ids.add(id);
        if (row.meta?.fcosPreviewEmailBuildOperation === intent.operationId) matches.push(id);
      }
      const next = data.pagination.next;
      if (next === null || next === undefined) {
        if (matches.length > 1) throw new Error('Multiple deployments match one Preview intent; manual review is required.');
        return matches.length === 1 ? api(`/v13/deployments/${matches[0]}`) : null;
      }
      if (!Number.isSafeInteger(next) || next <= 0 || cursors.has(next) || !data.deployments.length) throw new Error('Operation recovery cursor is invalid.');
      cursors.add(next); until = next;
    }
    throw new Error('Operation recovery exceeded its bounded scan.');
  };
  const waitReady = async raw => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (['READY', 'ERROR', 'CANCELED'].includes(raw.readyState)) return raw;
      await new Promise(done => setTimeout(done, 10000));
      raw = await api(`/v13/deployments/${raw.id}`);
    }
    throw new Error('Preview is still pending; recover the original intent by readback only.');
  };
  const receipt = await runControlledPreviewEmailBuild({ intent, mode, authority, journal, discover, waitReady,
    create: request => provider.create(request),
    collectRecords: () => collectPreviewEmailEnvironmentRecords({ api }),
    readVersion: deployment => readPreviewEmailBuildVersion(deployment, { bypass: env.FCOS_E2E_VERCEL_BYPASS }) });
  writeFileSync(join(directory, PREVIEW_EMAIL_BUILD_FILENAME), `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx', flush: true });
  return { receiptProduced: true, originalRunId, producingRunId: approved.runId, candidateSha,
    deploymentId: receipt.deployment.id, productionAuthorized: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runPreviewEmailProofBuild(previewEmailBuildArguments(process.argv.slice(2))); console.log(JSON.stringify(result)); }
  catch { console.error('FCOS protected Preview proof failed. Review the redacted journal; do not repeat an uncertain creation.'); process.exitCode = 1; }
}
