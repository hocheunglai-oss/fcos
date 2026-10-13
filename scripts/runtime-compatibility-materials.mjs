import { writeFileSync, mkdtempSync, rmSync, realpathSync, openSync, closeSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DefaultArtifactClient } from '@actions/artifact';
import { githubReleaseReads, RELEASE_REPOSITORY } from './lib/release-evidence.mjs';
import { githubReleaseOidc } from './lib/release-production.mjs';
import { SUCCESSOR_LIVE_CONTRACT, assertSuccessorLiveSource, assertSuccessorLiveMaterials,
  successorLiveControlBinding } from './lib/runtime-compatibility-successor-live.mjs';
import { verifyRuntimeCompatibilitySuccessorSource } from './verify-runtime-compatibility-successor.mjs';
import { RUNTIME_MATERIAL_FILENAME, runtimeMaterialArtifactName, runtimeMaterialInput, parseRuntimeMaterialPack,
  collectRuntimeMaterialProducer, runtimeMaterialPayload, runtimeMaterialArtifacts,
  assertRuntimeMaterialPublicationFresh, reconcileRuntimeMaterialPublication } from './lib/runtime-compatibility-material-transport.mjs';

const ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const need = value => { if (!value) throw new Error('Runtime material publication unavailable; retain original evidence for read-only reconciliation.'); };
const DIAGNOSTIC_PHASES = new Set(['entry', 'artifact_runtime', 'source', 'controls', 'oidc', 'producer_authentication', 'input_read',
  'pack_validation', 'material_validation', 'artifact_absence', 'input_recheck', 'payload', 'publication_freshness',
  'attempt_marker', 'artifact_upload', 'artifact_reconciliation']);
const DIAGNOSTIC_READS = new Set(['none', 'user', 'repository', 'protected_branch', 'branch_protection', 'workflow_run',
  'workflow_definition', 'environment', 'jobs', 'approvals', 'environment_variables', 'repository_variables',
  'artifact_list', 'artifact_metadata', 'artifact_archive', 'oidc_token', 'oidc_keys', 'unclassified']);

// Fixed primitive projection only: no exception, response body, URL, CLI
// arguments, material text, OIDC claims or credential values enter diagnostics.
export function runtimeMaterialDiagnostic({ phase, readClass, httpStatus, cliExitCode } = {}) {
  return { schemaVersion: 1, kind: 'fcos_runtime_material_failure',
    phase: DIAGNOSTIC_PHASES.has(phase) ? phase : 'unknown',
    readClass: DIAGNOSTIC_READS.has(readClass) ? readClass : 'unclassified',
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    cliExitCode: Number.isInteger(cliExitCode) && cliExitCode >= 0 && cliExitCode <= 255 ? cliExitCode : null };
}
export function runtimeMaterialReadClass(endpoint) {
  const base = 'repos/' + RELEASE_REPOSITORY;
  if (endpoint === 'user') return 'user';
  if (endpoint === base) return 'repository';
  if (typeof endpoint !== 'string' || !endpoint.startsWith(base + '/')) return 'unclassified';
  const path = endpoint.slice(base.length);
  if (/^\/branches\/[^/?]+\/protection$/.test(path)) return 'branch_protection';
  if (/^\/branches\/[^/?]+$/.test(path)) return 'protected_branch';
  if (/^\/actions\/runs\/\d+$/.test(path)) return 'workflow_run';
  if (/^\/actions\/workflows\/[^/?]+$/.test(path)) return 'workflow_definition';
  if (/^\/environments\/[^/?]+$/.test(path)) return 'environment';
  if (/^\/actions\/runs\/\d+\/attempts\/1\/jobs\?per_page=100&page=\d+$/.test(path)) return 'jobs';
  if (/^\/actions\/runs\/\d+\/approvals$/.test(path)) return 'approvals';
  if (/^\/environments\/[^/?]+\/variables\?per_page=100&page=\d+$/.test(path)) return 'environment_variables';
  if (/^\/actions\/variables\?per_page=100&page=\d+$/.test(path)) return 'repository_variables';
  if (/^\/actions\/runs\/\d+\/artifacts\?per_page=100&page=\d+$/.test(path)) return 'artifact_list';
  if (/^\/actions\/artifacts\/\d+\/zip$/.test(path)) return 'artifact_archive';
  if (/^\/actions\/artifacts\/\d+$/.test(path)) return 'artifact_metadata';
  return 'unclassified';
}
function diagnosticExecute(state) {
  return (command, args, options) => {
    state.readClass = runtimeMaterialReadClass(args[1]); state.httpStatus = null; state.cliExitCode = null;
    try { return execFileSync(command, args, options); }
    catch (error) {
      state.cliExitCode = Number.isInteger(error?.status) ? error.status : null;
      // Extract only a bounded numeric HTTP classification; never retain or
      // print the CLI's raw stdout/stderr or exception message.
      const boundedStderr = typeof error?.stderr === 'string' ? Buffer.byteLength(error.stderr, 'utf8') <= 8192
        : Buffer.isBuffer(error?.stderr) && error.stderr.length <= 8192;
      if (boundedStderr) {
        const status = /\bHTTP ([1-5]\d\d)\b/.exec(typeof error.stderr === 'string' ? error.stderr : error.stderr.toString('utf8'));
        state.httpStatus = status ? Number(status[1]) : null;
      }
      throw error;
    }
  };
}
function diagnosticOidcFetch(state) {
  return async (url, options) => {
    state.readClass = url === 'https://token.actions.githubusercontent.com/.well-known/jwks' ? 'oidc_keys' : 'oidc_token';
    state.httpStatus = null; state.cliExitCode = null;
    const response = await fetch(url, options);
    if (!response.ok) state.httpStatus = response.status;
    return response;
  };
}
let invoked = false;
// The producer only publishes data. It cannot mint a live admission, sign a
// receipt, access provider/key credentials, claim a financial lease or deploy.
export async function produceRuntimeCompatibilityMaterials() {
  const diagnostic = { phase: 'entry', readClass: 'none', httpStatus: null, cliExitCode: null };
  const phase = value => { diagnostic.phase = value; diagnostic.readClass = 'none'; diagnostic.httpStatus = null; diagnostic.cliExitCode = null; };
  try {
    need(arguments.length === 0 && !invoked); invoked = true;
    const env = process.env, workspace = realpathSync(env.GITHUB_WORKSPACE || '/');
    const runId = Number(env.GITHUB_RUN_ID), normal = env.GITHUB_JOB === 'compatibility-normal-role';
    need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === RELEASE_REPOSITORY && env.GITHUB_RUN_ATTEMPT === '1'
      && Number.isSafeInteger(runId) && runId > 0 && env.FCOS_E2E_EXPECTED_COMMIT === SUCCESSOR_LIVE_CONTRACT.candidateSha
      && env.GH_TOKEN && !env.NODE_OPTIONS && !env.NODE_PATH && !process.execArgv.length
      && ROOT === (normal ? workspace : join(workspace, 'trusted'))
      && (normal || ['proof', 'preflight'].includes(env.GITHUB_JOB))
      && (env.GITHUB_JOB !== 'proof' || ['create', 'readback'].includes(env.FCOS_RUNTIME_MATERIAL_OPERATION)));
    const sourceCwd = normal ? ROOT : realpathSync(env.FCOS_RELEASE_SOURCE_DIRECTORY || '/');
    need(normal || sourceCwd === join(workspace, 'candidate'));
    // GitHub injects the artifact SDK runtime into JavaScript actions. A shell
    // run step lacks it; reject that boundary before reads or a durable attempt.
    phase('artifact_runtime');
    need(typeof env.ACTIONS_RUNTIME_TOKEN === 'string' && env.ACTIONS_RUNTIME_TOKEN.length > 0
      && typeof env.ACTIONS_RESULTS_URL === 'string' && env.ACTIONS_RESULTS_URL.length > 0);
    phase('source');
    assertSuccessorLiveSource(verifyRuntimeCompatibilitySuccessorSource({ cwd: sourceCwd, candidateCommit: SUCCESSOR_LIVE_CONTRACT.candidateSha }));
    phase('controls');
    const controls = successorLiveControlBinding({ trustedCwd: ROOT, sourceCwd });
    const expected = { ...controls, runId, sha: SUCCESSOR_LIVE_CONTRACT.candidateSha, sourceDigest: SUCCESSOR_LIVE_CONTRACT.sourceDigest,
      lockHash: SUCCESSOR_LIVE_CONTRACT.lockHash, candidateTreeHash: SUCCESSOR_LIVE_CONTRACT.candidateTreeHash };
    const reads = githubReleaseReads({ command: '/usr/bin/gh', env: { PATH: '/usr/bin:/bin', HOME: env.HOME,
      GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY, GH_TOKEN: env.GH_TOKEN } }, { cwd: ROOT, execute: diagnosticExecute(diagnostic) });
    const authenticate = async () => {
      phase('oidc');
      const oidcClaims = await githubReleaseOidc({ env: process.env, fetchImpl: diagnosticOidcFetch(diagnostic) });
      phase('producer_authentication');
      return collectRuntimeMaterialProducer({ reads, expected, oidcClaims, requireCompletedStep: false });
    };
    // Authentication is complete before the public material variable is read.
    const producer = await authenticate();
    phase('input_read');
    const text = await runtimeMaterialInput(reads, producer.environment);
    need(text !== null);
    phase('pack_validation');
    const rows = parseRuntimeMaterialPack(text, producer.binding);
    phase('material_validation');
    assertSuccessorLiveMaterials({ context: rows.context, reviews: [rows.root, rows.independent], binding: expected });
    const name = runtimeMaterialArtifactName(runId);
    phase('artifact_absence');
    need(!(await runtimeMaterialArtifacts(reads, runId)).some(row => row.name === name));
    const current = await authenticate();
    phase('input_recheck');
    need(JSON.stringify(current.binding) === JSON.stringify(producer.binding) && current.job.id === producer.job.id
      && current.step.number === producer.step.number && current.step.started_at === producer.step.started_at
      && await runtimeMaterialInput(reads, current.environment) === text);
    phase('material_validation');
    assertSuccessorLiveMaterials({ context: rows.context, reviews: [rows.root, rows.independent], binding: expected });
    phase('payload');
    const payload = runtimeMaterialPayload(text, current), encoded = `${JSON.stringify(payload)}\n`;
    const directory = mkdtempSync(join(tmpdir(), 'fcos-runtime-materials-')), stdout = process.stdout.write, stderr = process.stderr.write;
    let created, fd;
    try {
      // Same-run retries cannot issue another upload after an uncertain outcome.
      const runner = realpathSync(env.RUNNER_TEMP || '/'); need(runner !== '/');
      phase('publication_freshness');
      assertRuntimeMaterialPublicationFresh({ producer: current, payload, now: Date.now() });
      phase('attempt_marker');
      fd = openSync(join(runner, `fcos-runtime-material-publication-${runId}.lock`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, 'data-only immutable material upload attempted\n', { flush: true }); closeSync(fd); fd = undefined;
      const path = join(directory, RUNTIME_MATERIAL_FILENAME);
      writeFileSync(path, encoded, { flag: 'wx', mode: 0o600, flush: true });
      process.stdout.write = () => true; process.stderr.write = () => true;
      phase('publication_freshness');
      assertRuntimeMaterialPublicationFresh({ producer: current, payload, now: Date.now() });
      phase('artifact_upload');
      created = await new DefaultArtifactClient().uploadArtifact(name, [path], directory, { retentionDays: 7, compressionLevel: 0 });
      phase('artifact_reconciliation');
      const reconciled = await reconcileRuntimeMaterialPublication({ reads, producer: current, created, payload });
      return { kind: 'fcos_exact04ee_runtime_material_publication', ...reconciled,
        materialHashes: Object.fromEntries(Object.entries(rows).map(([role, row]) => [role, row.sha256])), grantsAuthority: false };
    } finally {
      if (fd !== undefined) closeSync(fd);
      process.stdout.write = stdout; process.stderr.write = stderr; rmSync(directory, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(JSON.stringify(runtimeMaterialDiagnostic(diagnostic)));
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { need(process.argv.length === 2); console.log(JSON.stringify(await produceRuntimeCompatibilityMaterials())); }
  catch { console.error('Runtime material publication failed or uncertain; original timestamps and attempted upload remain unchanged.'); process.exitCode = 1; }
}
