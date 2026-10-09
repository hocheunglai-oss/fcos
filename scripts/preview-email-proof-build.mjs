import { ENROLLED_AUTHORITY_MODE, ENROLLED_AUTHORITY_SECRET, ENROLLED_AUTHORITY_FILENAME, collectEnrolledPreviewAuthority, enrolledAuthorityContext, verifyEnrollmentReceipt } from './lib/preview-vercel-enrollment.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, lstatSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { collectBuildProvenance } from './lib/build-provenance.mjs';
import { SUCCESSOR_LIVE_CONTRACT, collectSuccessorLiveOperationAdmission, successorLiveBinding, successorLivePlan } from './lib/runtime-compatibility-successor-live.mjs';
import { githubReleaseReads, assertReleaseGitHubAccount, RELEASE_REPOSITORY } from './lib/release-evidence.mjs';
import { githubReleaseOidc } from './lib/release-production.mjs';
import { collectHostedPreviewCoordinationClaim } from './lib/preview-email-coordination-collector.mjs';
import { collectPreviewVercelAuthority, probePreviewVercelAuthority, PREVIEW_AUTHORITY_SUBSTAGES, PREVIEW_AUTHORITY_FAILURES } from './lib/preview-vercel-authority.mjs';
import { releaseHash } from './lib/release-readiness.mjs';
import { previewEmailBuildCandidate, previewEmailBuildContract, createPreviewEmailBuildRequest, previewEmailBuildControlRevision, assertPreviewEmailBuildProtection,
  collectPreviewEmailEnvironmentRecords, createPreviewEmailBuildIntent, collectTrustedPreviewEmailIntent, collectPreviewEmailBuildJobs,
  runControlledPreviewEmailBuild, readPreviewEmailBuildVersion, PREVIEW_EMAIL_BUILD_ENVIRONMENT,
  PREVIEW_EMAIL_INTENT_FILENAME, PREVIEW_EMAIL_BUILD_FILENAME, PREVIEW_EMAIL_CONTRACT_SHA256,
  PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_FILENAME } from './lib/preview-email-build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const baseline = JSON.parse(readFileSync(new URL('../config/legacy-email-baseline-proof.json', import.meta.url))).baseline;
const projectId = fcosConnectionIdentifier('vercel', 'Project ID'), teamId = fcosConnectionIdentifier('vercel', 'Team ID');
const command = (binary, args, options = {}) => {
  try { return execFileSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
  catch { throw new Error('Pinned Preview proof command failed; private diagnostics suppressed.'); }
};

const DIAGNOSTIC_PHASES = new Set(['runner_context', 'successor_admission', 'candidate_contract', 'candidate_provenance', 'harness_provenance',
  'dependency_lock', 'control_revision', 'source_pins', 'provider_cli_version', 'github_identity', 'actions_oidc',
  'protected_repository', 'environment_variables', 'environment_protection', 'environment_secrets', 'workflow_run',
  'environment_approval', 'workflow_job', 'protection_review', 'candidate_branch', 'source_recheck', 'vercel_authority',
  'retained_production', 'environment_records', 'intent_write', 'recovery_context', 'trusted_intent', 'execution_claim',
  'controlled_build', 'receipt_write', 'authority_probe', 'authority_probe_write', 'enrolled_authority', 'enrolled_authority_write', 'coordination_claim']);
const diagnosticFailure = phase => new Error(`FCOS protected Preview ${phase} failed; private diagnostics suppressed.`);
const authoritySubstages = new Set(PREVIEW_AUTHORITY_SUBSTAGES), authorityFailures = new Set(PREVIEW_AUTHORITY_FAILURES);

/** This journal exists before credential or source preflight. Exceptions are
 * never inspected: each row contains only a fixed phase/status/code and time.
 * The separate exclusive execution claim retains the one-invocation guard
 * while prepare and create append to the same workflow-uploaded journal. */
export function createPreviewEmailBuildDiagnostics({ mode, runId, directory, trustedCwd, candidateCwd, now = () => Date.now() } = {}) {
  let fd;
  try {
    if (!['prepare', 'create', 'readback', 'diagnose-authority', 'verify-authority', 'coordinate'].includes(mode) || !/^[1-9][0-9]*$/.test(String(runId || ''))
      || !Number.isSafeInteger(Number(runId)) || typeof directory !== 'string' || !directory) throw new Error('context');
    directory = resolve(directory);
    if (directory === '/' || directory === resolve(trustedCwd) || directory === resolve(candidateCwd)
      || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('directory');
    const journalPath = join(directory, `fcos-preview-email-journal-${runId}.jsonl`);
    fd = openSync(journalPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > 256 * 1024) throw new Error('file');
    const append = row => {
      const current = fstatSync(fd);
      if (!current.isFile() || current.nlink !== 1 || (current.mode & 0o077) !== 0 || current.size > 256 * 1024) throw diagnosticFailure('journal_write');
      appendFileSync(fd, `${JSON.stringify(row)}\n`, { flush: true });
    };
    return {
      async stage(phase, operation) {
        if (!DIAGNOSTIC_PHASES.has(phase) || typeof operation !== 'function') throw diagnosticFailure('diagnostic_phase');
        const row = status => ({ schemaVersion: 1, kind: 'fcos_preview_email_diagnostic', mode, phase, status,
          code: `FCOS_PREVIEW_${phase.toUpperCase()}_${status.toUpperCase()}`, capturedAt: new Date(now()).toISOString() });
        try {
          append(row('started'));
          const result = await operation();
          append(row('passed'));
          return result;
        } catch {
          // A failed journal write also fails closed. Neither the exception nor
          // command output, URLs, claims, headers or provider bodies are logged.
          try { append(row('failed')); } catch { /* The original safe stage still identifies this failure. */ }
          throw diagnosticFailure(phase);
        }
      },
      authority(row) {
        try {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('row');
          const prototype = Object.getPrototypeOf(row);
          if (prototype !== Object.prototype && prototype !== null) throw new Error('prototype');
          const descriptors = Object.getOwnPropertyDescriptors(row), keys = Reflect.ownKeys(descriptors);
          const allowed = ['substage', 'status', 'failureCategory', 'httpStatus', 'reviewedTokenIdMatches'];
          if (keys.some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value'))
            || !Object.hasOwn(descriptors, 'substage') || !Object.hasOwn(descriptors, 'status')) throw new Error('fields');
          const values = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
          if (!authoritySubstages.has(values.substage) || !['passed', 'failed'].includes(values.status)
            || (values.status === 'failed' ? !authorityFailures.has(values.failureCategory) : Object.hasOwn(values, 'failureCategory'))
            || Object.hasOwn(values, 'httpStatus') && (!['current_metadata', 'project_list', 'user_denial', 'team_denial'].includes(values.substage)
              || !Number.isInteger(values.httpStatus) || values.httpStatus < 200 || values.httpStatus > 599)
            || Object.hasOwn(values, 'reviewedTokenIdMatches') && (values.substage !== 'current_metadata'
              || typeof values.reviewedTokenIdMatches !== 'boolean')) throw new Error('values');
          append({ schemaVersion: 1, kind: 'fcos_preview_email_authority_diagnostic', mode,
            substage: values.substage, status: values.status,
            ...(Object.hasOwn(values, 'failureCategory') ? { failureCategory: values.failureCategory } : {}),
            ...(Object.hasOwn(values, 'httpStatus') ? { httpStatus: values.httpStatus } : {}),
            ...(Object.hasOwn(values, 'reviewedTokenIdMatches') ? { reviewedTokenIdMatches: values.reviewedTokenIdMatches } : {}),
            capturedAt: new Date(now()).toISOString() });
        } catch { throw diagnosticFailure('authority_journal'); }
      },
      claimExecution() {
        let claim;
        try {
          claim = openSync(join(directory, `fcos-preview-email-execution-${runId}.lock`),
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          writeFileSync(claim, 'fcos-preview-email-execution-claimed\n', { flush: true });
        } catch { throw diagnosticFailure('execution_claim'); }
        finally { if (claim !== undefined) closeSync(claim); }
      },
      journal(row) {
        const keys = row?.phase === 'complete' ? ['phase', 'operationId', 'deploymentId', 'capturedAt'] : ['phase', 'operationId', 'capturedAt'];
        if (!row || Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))
          || !['create_requested', 'delivery_uncertain', 'complete'].includes(row.phase)
          || !/^fcos-preview-email-[1-9][0-9]*-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.operationId || '')
          || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.capturedAt || '')
          || row.phase === 'complete' && !/^dpl_[A-Za-z0-9]+$/.test(row.deploymentId || '')) throw diagnosticFailure('operation_journal');
        append(row);
      },
      close() { closeSync(fd); },
    };
  } catch {
    if (fd !== undefined) closeSync(fd);
    throw diagnosticFailure('journal_initialization');
  }
}
export function previewEmailBuildArguments(args, env = process.env) {
  if (args.length > 1 || args.some(value => !['--dry-run', '--prepare', '--create', '--readback', '--diagnose-authority', '--verify-authority', '--coordinate'].includes(value))) throw new Error('Use one protected Preview proof mode.');
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
  const successor = candidateSha === SUCCESSOR_LIVE_CONTRACT.candidateSha;
  if (successor && mode === 'dry-run') return successorLivePlan();
  if (mode === 'dry-run') return { schemaVersion: 1, kind: 'fcos_preview_email_build_plan', enabledByDefault: false,
    productionAuthorized: false, mutations: 0, contractSha256: PREVIEW_EMAIL_CONTRACT_SHA256,
    workflow: '.github/workflows/preview-email-proof-build.yml', environment: PREVIEW_EMAIL_BUILD_ENVIRONMENT,
    requirements: ['current protected main', 'pinned human per-run review', 'exact contract/source/control pins',
      'unchanged retained Production', 'archive-backed intent before one Preview POST', 'readback-only recovery',
      'fresh complete metadata and actual source receipt', 'separate normal-user and signer evidence'] };
  const diagnostics = createPreviewEmailBuildDiagnostics({ mode, runId: env.GITHUB_RUN_ID,
    directory: env.RUNNER_TEMP, trustedCwd, candidateCwd });
  const stage = diagnostics.stage;
  try {
    if (mode === 'coordinate') {
      if (!successor) throw diagnosticFailure('coordination_claim');
      // Fixed production constructor; injected runner/test options cannot mint a
      // capability. Immutable source-only guard fails before authenticated I/O.
      return await stage('coordination_claim', () => collectHostedPreviewCoordinationClaim());
    }
    await stage('runner_context', () => {
      if (!env.GH_TOKEN || !env.VERCEL_TOKEN) throw new Error('Dedicated protected runner and existing credentials are required.');
    });
    let admission;
    const reads = githubReleaseReads({ command: 'gh', env: { PATH: env.PATH, HOME: env.HOME, GH_HOST: 'github.com',
      GH_REPO: RELEASE_REPOSITORY, GH_TOKEN: env.GH_TOKEN } }, { cwd: trustedCwd });
    if (successor) admission = await stage('successor_admission', () => collectSuccessorLiveOperationAdmission({ reads,
      sourceCwd: candidateCwd, trustedCwd, runId: Number(env.GITHUB_RUN_ID) }));
    const candidate = await stage('candidate_contract', () => previewEmailBuildCandidate(candidateSha, { admission }));
    const selectedContract = previewEmailBuildContract(candidateSha, { admission });
    const source = await stage('candidate_provenance', () => collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true }));
    const harness = await stage('harness_provenance', () => collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true }));
    const lockHash = await stage('dependency_lock', () => releaseHash(readFileSync(join(candidateCwd, 'package-lock.json'))));
    const controlRevision = await stage('control_revision', () => previewEmailBuildControlRevision(trustedCwd, { admission, sourceCwd: candidateCwd }));
    await stage('source_pins', () => {
      if (!source.releaseEligible || !harness.releaseEligible || source.commit !== candidate.sha
        || source.sourceDigest !== candidate.sourceDigest || lockHash !== candidate.lockHash) throw new Error('Clean exact source and dependency pins failed.');
    });
    await stage('provider_cli_version', () => {
      if (command('vercel', ['--version'], { cwd: trustedCwd, env: { PATH: env.PATH, HOME: env.HOME, CI: '1', NO_COLOR: '1',
        VERCEL_TELEMETRY_DISABLED: '1', VERCEL_NO_UPDATE_NOTIFICATION: '1' } }).trim().replace(/^Vercel CLI /i, '') !== '54.20.1') {
        throw new Error('The reviewed provider CLI version is required.');
      }
    });
    const provider = createPreviewEmailVercelApi({ token: env.VERCEL_TOKEN }), api = provider.get;
    let signed, approved, enrolledBinding;
    const recheckEnrolled = () => { if (enrolledBinding) verifyEnrollmentReceipt(enrolledBinding); };
    const authority = async intent => {
      await stage('github_identity', () => assertReleaseGitHubAccount(reads));
      signed = await stage('actions_oidc', () => githubReleaseOidc({ env }));
      const { repository, branch, protection } = await stage('protected_repository', () => {
        const repository = reads.json(`repos/${RELEASE_REPOSITORY}`);
        const branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
        const protection = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
        return { repository, branch, protection };
      });
      const variables = await stage('environment_variables', () => completeEnvironmentNames(reads, `repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}/variables`, 'variables'));
      const environment = await stage('environment_protection', () => reads.json(`repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}`));
      const secrets = await stage('environment_secrets', () => completeEnvironmentNames(reads, `repos/${RELEASE_REPOSITORY}/environments/${PREVIEW_EMAIL_BUILD_ENVIRONMENT}/secrets`, 'secrets'));
      const run = await stage('workflow_run', () => reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${signed.run_id}`));
      const approvals = await stage('environment_approval', () => reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${signed.run_id}/approvals`));
      const jobs = await stage('workflow_job', () => collectPreviewEmailBuildJobs({ reads, runId: Number(signed.run_id) }));
      approved = await stage('protection_review', () => {
        const result = assertPreviewEmailBuildProtection({ repository, branch, protection, environment, variables, secrets,
          run, jobs, approvals, oidcClaims: signed, candidateSha, harnessSha: harness.commit, controlRevision,
          admission, mode: ['diagnose-authority', 'verify-authority'].includes(mode) ? mode : 'build' });
        if (result.runId !== Number(env.GITHUB_RUN_ID)) throw new Error('This runner journal must bind the exact approved workflow run.');
        return result;
      });
      await stage('candidate_branch', () => {
        if (reads.json(`repos/${RELEASE_REPOSITORY}/git/ref/heads/${encodeURIComponent(candidate.branch)}`).object?.sha !== candidateSha) throw new Error('The reviewed candidate branch changed.');
      });
      await stage('source_recheck', () => {
        if (successor) successorLiveBinding(admission, { sha: candidateSha, harnessSha: harness.commit,
          sourceDigest: source.sourceDigest, lockHash, previewControlRevision: controlRevision });
        if (collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true }).sourceDigest !== source.sourceDigest
          || collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true }).commit !== harness.commit
          || previewEmailBuildControlRevision(trustedCwd, { admission, sourceCwd: candidateCwd }) !== controlRevision) throw new Error('Reviewed source or controls changed during execution.');
      });
      // The diagnostic gate requires both deployment gates off. This terminal
      // branch precedes environment reads, intent creation and every deploy path.
      if (mode === 'diagnose-authority') {
        const probe = await stage('authority_probe', () => probePreviewVercelAuthority({
          token: env.VERCEL_TOKEN, reviewedTokenId: approved.reviewedTokenId }));
        await stage('authority_probe_write', () => writeFileSync(join(resolve(env.RUNNER_TEMP), PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_FILENAME),
          `${JSON.stringify({ ...probe, runId: approved.runId, candidateSha, harnessSha: harness.commit, controlRevision })}\n`,
          { mode: 0o600, flag: 'wx', flush: true }));
        return { diagnosticCompleted: true, mutations: 0, previewAuthorized: false, productionAuthorized: false };
      }
      const configuration = JSON.parse(readFileSync(join(candidateCwd, 'vercel.json')));
      let project, enrolledReport;
      if (approved.authorityMode === ENROLLED_AUTHORITY_MODE) {
        enrolledBinding = {
          envelope: approved.authorityEnvelope, privateEnrollment: env[ENROLLED_AUTHORITY_SECRET], token: env.VERCEL_TOKEN,
          reviewedTokenId: approved.reviewedTokenId, enrollmentId: approved.enrollmentId,
          context: enrolledAuthorityContext({ repositoryId: repository.id, environmentId: approved.environmentId, runId: approved.runId,
            harnessSha: harness.commit, controlRevision, contractSha256: selectedContract.contractSha256, candidateSha,
            operation: mode === 'prepare' ? 'create' : mode }) };
        const result = await stage('enrolled_authority', () => collectEnrolledPreviewAuthority({ ...enrolledBinding,
          deploymentConfiguration: configuration, verifyOnly: mode === 'verify-authority' }));
        project = result.project;
        if (mode === 'verify-authority') enrolledReport = result.report;
      } else {
        ({ project } = await stage('vercel_authority', () => collectPreviewVercelAuthority({ token: env.VERCEL_TOKEN, reviewedTokenId: approved.reviewedTokenId,
          readProject: api, deploymentConfiguration: configuration, onDiagnostic: diagnostics.authority })));
      }
      const saveVerification = retainedProductionVerified => stage('enrolled_authority_write', () => writeFileSync(join(resolve(env.RUNNER_TEMP), ENROLLED_AUTHORITY_FILENAME),
        `${JSON.stringify({ ...enrolledReport, retainedProductionVerified, authorityVerified: retainedProductionVerified && enrolledReport.authorityVerified,
          runId: approved.runId, candidateSha, harnessSha: harness.commit, controlRevision })}\n`, { mode: 0o600, flag: 'wx', flush: true }));
      try { await stage('retained_production', async () => {
        if (project.link.productionBranch !== repository.default_branch || project.targets?.production?.id !== baseline.deploymentId) throw new Error('The retained Production target changed.');
        const previous = await api(`/v13/deployments/${baseline.deploymentId}`);
        if (previous.projectId !== projectId || previous.ownerId !== teamId && previous.teamId !== teamId
          || previous.target !== 'production' || previous.readyState !== 'READY' || previous.meta?.githubCommitSha !== baseline.sha
          || `https://${previous.url}` !== baseline.url) throw new Error('The exact retained Production readback failed.');
      }); } catch {
        if (enrolledReport) await saveVerification(false);
        throw new Error('Retained Production verification failed; private evidence suppressed.');
      }
      recheckEnrolled();
      if (enrolledReport) {
        await saveVerification(true);
        if (!enrolledReport.authorityVerified) throw new Error('Enrolled scope verification failed; inspect only the sanitized report.');
        return { authorityVerified: true, retainedProductionVerified: true, mutations: 0, previewAuthorized: false, productionAuthorized: false };
      }
      if (intent) {
        await stage('recovery_context', () => {
          if (intent.harnessSha !== harness.commit || intent.controlRevision !== controlRevision || intent.candidate.sha !== candidateSha
            || mode === 'create' && intent.runId !== approved.runId) throw new Error('Only this approved first run may submit its original intent.');
        });
        await stage('environment_records', async () => {
          const current = await collectPreviewEmailEnvironmentRecords({ api });
          if (JSON.stringify(current.records) !== JSON.stringify(intent.environmentRecords.records)) throw new Error('Project environment records changed after intent capture.');
        });
      }
      recheckEnrolled();
      return approved;
    };
    const initialAuthority = await authority();
    if (['diagnose-authority', 'verify-authority'].includes(mode)) return initialAuthority;
    const directory = resolve(env.RUNNER_TEMP);
    if (mode === 'prepare') {
      const records = await stage('environment_records', () => collectPreviewEmailEnvironmentRecords({ api }));
      await stage('intent_write', () => {
        const intent = createPreviewEmailBuildIntent({ candidateSha, harnessSha: harness.commit, controlRevision,
          runId: approved.runId, operationId: `fcos-preview-email-${approved.runId}-${randomUUID()}`,
          records, admission });
        writeFileSync(join(directory, PREVIEW_EMAIL_INTENT_FILENAME), `${JSON.stringify(intent)}\n`, { mode: 0o600, flag: 'wx', flush: true });
      });
      return { durableIntentPrepared: true, runId: approved.runId, candidateSha, mutations: 0, productionAuthorized: false };
    }
    const originalRunId = mode === 'create' ? approved.runId : recoveryRunId;
    await stage('recovery_context', () => {
      if (!Number.isSafeInteger(originalRunId) || originalRunId <= 0 || mode === 'readback' && originalRunId === approved.runId) throw new Error('Readback needs a distinct original approved first-run intent.');
    });
    const intent = await stage('trusted_intent', () => collectTrustedPreviewEmailIntent({ reads, runId: originalRunId, candidateSha,
      completed: mode === 'readback' ? 'intent' : false, admission }));
    // A repeated invocation in the same first attempt cannot resubmit a POST.
    // Recovery uses a separately reviewed run and only the original remote intent.
    await stage('execution_claim', () => diagnostics.claimExecution());
    const journal = diagnostics.journal;
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
    const receipt = await stage('controlled_build', () => runControlledPreviewEmailBuild({ intent, mode, authority, journal, discover, waitReady, admission,
      create: request => { recheckEnrolled(); return provider.create(request); },
      collectRecords: () => collectPreviewEmailEnvironmentRecords({ api }),
      readVersion: deployment => readPreviewEmailBuildVersion(deployment, { bypass: env.FCOS_E2E_VERCEL_BYPASS }) }));
    await stage('receipt_write', () => writeFileSync(join(directory, PREVIEW_EMAIL_BUILD_FILENAME), `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx', flush: true }));
    return { receiptProduced: true, originalRunId, producingRunId: approved.runId, candidateSha,
      deploymentId: receipt.deployment.id, productionAuthorized: false };
  } finally { diagnostics.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runPreviewEmailProofBuild(previewEmailBuildArguments(process.argv.slice(2))); console.log(JSON.stringify(result)); }
  catch { console.error('FCOS protected Preview proof failed. Review the redacted journal; do not repeat an uncertain creation.'); process.exitCode = 1; }
}
