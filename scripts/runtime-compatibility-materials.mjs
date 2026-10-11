import { writeFileSync, mkdtempSync, rmSync, realpathSync, openSync, closeSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
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
let invoked = false;
// The producer only publishes data. It cannot mint a live admission, sign a
// receipt, access provider/key credentials, claim a financial lease or deploy.
export async function produceRuntimeCompatibilityMaterials() {
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
  assertSuccessorLiveSource(verifyRuntimeCompatibilitySuccessorSource({ cwd: sourceCwd, candidateCommit: SUCCESSOR_LIVE_CONTRACT.candidateSha }));
  const controls = successorLiveControlBinding({ trustedCwd: ROOT, sourceCwd });
  const expected = { ...controls, runId, sha: SUCCESSOR_LIVE_CONTRACT.candidateSha, sourceDigest: SUCCESSOR_LIVE_CONTRACT.sourceDigest,
    lockHash: SUCCESSOR_LIVE_CONTRACT.lockHash, candidateTreeHash: SUCCESSOR_LIVE_CONTRACT.candidateTreeHash };
  const reads = githubReleaseReads({ command: '/usr/bin/gh', env: { PATH: '/usr/bin:/bin', HOME: env.HOME,
    GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY, GH_TOKEN: env.GH_TOKEN } }, { cwd: ROOT });
  const authenticate = async () => collectRuntimeMaterialProducer({ reads, expected, oidcClaims: await githubReleaseOidc({ env: process.env }), requireCompletedStep: false });
  // Authentication is complete before the public material variable is read.
  const producer = await authenticate(), text = await runtimeMaterialInput(reads, producer.environment);
  need(text !== null);
  const rows = parseRuntimeMaterialPack(text, producer.binding);
  assertSuccessorLiveMaterials({ context: rows.context, reviews: [rows.root, rows.independent], binding: expected });
  const name = runtimeMaterialArtifactName(runId);
  need(!(await runtimeMaterialArtifacts(reads, runId)).some(row => row.name === name));
  const current = await authenticate();
  need(JSON.stringify(current.binding) === JSON.stringify(producer.binding) && current.job.id === producer.job.id
    && current.step.number === producer.step.number && current.step.started_at === producer.step.started_at
    && await runtimeMaterialInput(reads, current.environment) === text);
  assertSuccessorLiveMaterials({ context: rows.context, reviews: [rows.root, rows.independent], binding: expected });
  const payload = runtimeMaterialPayload(text, current), encoded = `${JSON.stringify(payload)}\n`;
  const directory = mkdtempSync(join(tmpdir(), 'fcos-runtime-materials-')), stdout = process.stdout.write, stderr = process.stderr.write;
  let created, fd;
  try {
    // Same-run retries cannot issue another upload after an uncertain outcome.
    const runner = realpathSync(env.RUNNER_TEMP || '/'); need(runner !== '/');
    assertRuntimeMaterialPublicationFresh({ producer: current, payload, now: Date.now() });
    fd = openSync(join(runner, `fcos-runtime-material-publication-${runId}.lock`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, 'data-only immutable material upload attempted\n', { flush: true }); closeSync(fd); fd = undefined;
    const path = join(directory, RUNTIME_MATERIAL_FILENAME);
    writeFileSync(path, encoded, { flag: 'wx', mode: 0o600, flush: true });
    process.stdout.write = () => true; process.stderr.write = () => true;
    assertRuntimeMaterialPublicationFresh({ producer: current, payload, now: Date.now() });
    created = await new DefaultArtifactClient().uploadArtifact(name, [path], directory, { retentionDays: 7, compressionLevel: 0 });
    const reconciled = await reconcileRuntimeMaterialPublication({ reads, producer: current, created, payload });
    return { kind: 'fcos_exact04ee_runtime_material_publication', ...reconciled,
      materialHashes: Object.fromEntries(Object.entries(rows).map(([role, row]) => [role, row.sha256])), grantsAuthority: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
    process.stdout.write = stdout; process.stderr.write = stderr; rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { need(process.argv.length === 2); console.log(JSON.stringify(await produceRuntimeCompatibilityMaterials())); }
  catch { console.error('Runtime material publication failed or uncertain; original timestamps and attempted upload remain unchanged.'); process.exitCode = 1; }
}
