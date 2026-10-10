import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DefaultArtifactClient } from '@actions/artifact';
import { assertReleaseCoordinatorSource } from './release-coordinator-local.mjs';
import { assertProtectedDefault, assertReleaseGitHubAccount, githubReleaseReads, RELEASE_REPOSITORY } from './lib/release-evidence.mjs';
import { githubReleaseOidc } from './lib/release-production.mjs';
import { PREVIEW_COORDINATION_CANONICAL } from './lib/preview-email-coordination.mjs';
import { decodePreviewCoordinationArchive } from './lib/preview-email-coordination-archive.mjs';
import { coordinationDigest, coordinationEqual, RELEASE_COORDINATION_FILE } from './lib/release-coordination.mjs';
import { releaseCoordinationRows } from './lib/release-coordination-trust.mjs';
import { guardProofWorkerParent, proofPhase, superviseCoordinationProofWorker } from './lib/release-coordination-proof-worker.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url)), ownPath = fileURLToPath(import.meta.url);
const environmentName = 'fcos-production-release', workflow = '.github/workflows/release-coordination-proof.yml';
const need = value => { if (!value) throw new Error('Protected artifact coordination proof unavailable. No deployment or lease action authorized.'); };
export const releaseCoordinationProofPlan = () => ({ kind: 'fcos_artifact_coordination_proof_plan', defaultDisabled: true,
  requiresRootHeldCanonicalLeaseAndExactAction: true, requiresPersonalEnvironmentReview: true, grantsActivation: false, mutations: 0 });

/** Exercises only the supplied archive backend. Its result never grants activation. */
export async function exerciseArtifactCoordination({ upload, read, crash, phase = () => {} }) {
  phase('concurrency-started');
  const results = await Promise.allSettled([upload('concurrent', 'first'), upload('concurrent', 'second')]);
  phase('concurrency-settled');
  const success = results.flatMap((row, index) => row.status === 'fulfilled' ? [{ result: row.value, marker: index ? 'second' : 'first' }] : []);
  need(success.length === 1 && results.filter(row => row.status === 'rejected').length === 1);
  const original = await read('concurrent');
  need(original.id === success[0].result.id && original.digest === success[0].result.digest && original.marker === success[0].marker);
  phase('duplicate-refusal-started');
  let rejected = false; try { await upload('concurrent', 'duplicate'); } catch { rejected = true; } need(rejected);
  need(coordinationEqual(await read('concurrent'), original));
  phase('crash-started');
  need(await crash() === 86); // Child exited after remote completion, before returning an ID to its parent.
  phase('crash-settled'); phase('crash-recovery-started');
  const recovered = await read('crash'); need(recovered.marker === 'crash');
  rejected = false; try { await upload('crash', 'retry'); } catch { rejected = true; } need(rejected);
  need(coordinationEqual(await read('crash'), recovered) && coordinationEqual(await read('concurrent'), original));
  return { concurrency: 'one-winner-one-refusal', duplicate: 'refused', uncertainChildOutcome: 'GET-only-recovered',
    immutableReadback: true, artifacts: [original, recovered], grantsActivation: false, deploymentAuthority: false };
}
/** Waiting produces data only; full actual action/lease admission follows. */
export async function waitForProofAction({ read, runId, deadline, now = Date.now, pause = ms => new Promise(done => setTimeout(done, ms)) }) {
  while (now() < deadline) {
    const value = JSON.parse(read() || 'null');
    if (value?.binding?.runId === runId) { need(now() < deadline); return value; }
    await pause(Math.min(10000, deadline - now()));
  }
  need(false);
}
async function actualContext({ allowWait = true } = {}) {
  const env = process.env, runId = Number(env.GITHUB_RUN_ID);
  need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_RUN_ATTEMPT === '1' && env.GITHUB_JOB === 'proof'
    && env.GITHUB_REPOSITORY === RELEASE_REPOSITORY && Number.isSafeInteger(runId) && runId > 0
    && resolve(ROOT) === join(resolve(env.GITHUB_WORKSPACE || '/'), 'trusted'));
  const reads = githubReleaseReads({ command: '/usr/bin/gh', env: { PATH: '/usr/bin:/bin', HOME: env.HOME, GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY, GH_TOKEN: env.GH_TOKEN } }, { cwd: ROOT });
  const operator = assertReleaseGitHubAccount(reads), base = `repos/${RELEASE_REPOSITORY}`;
  const repository = reads.json(base), branch = reads.json(`${base}/branches/${repository.default_branch}`);
  const trusted = assertProtectedDefault(repository, branch, reads.json(`${base}/branches/${repository.default_branch}/protection`));
  const environment = reads.json(`${base}/environments/${environmentName}`), rules = environment.protection_rules?.filter(row => row.type === 'required_reviewers');
  need(environment.can_admins_bypass === false && environment.deployment_branch_policy?.protected_branches === true
    && environment.deployment_branch_policy?.custom_branch_policies === false && rules?.length === 1 && rules[0].prevent_self_review === false
    && rules[0].reviewers?.length === 1 && rules[0].reviewers[0].type === 'User' && rules[0].reviewers[0].reviewer?.id === operator.id);
  const rows = releaseCoordinationRows(reads.json(`${base}/environments/${environmentName}/variables?per_page=100`), 'variables');
  const variable = name => rows.find(row => row.name === name)?.value;
  need(variable('FCOS_RELEASE_COORDINATION_PROOF_ENABLED') === 'true' && variable('FCOS_RELEASE_COORDINATION_PROOF_HARNESS_SHA') === trusted.sha);
  const run = reads.json(`${base}/actions/runs/${runId}`), jobs = releaseCoordinationRows(reads.json(`${base}/actions/runs/${runId}/attempts/1/jobs?per_page=100`), 'jobs');
  need(run.id === runId && run.run_attempt === 1 && run.status === 'in_progress' && run.conclusion === null && run.event === 'workflow_dispatch'
    && run.head_sha === trusted.sha && run.head_branch === trusted.branch && [workflow, `${workflow}@${trusted.branch}`].includes(run.path)
    && run.repository?.id === repository.id && run.head_repository?.id === repository.id
    && [run.actor, run.triggering_actor].every(row => row?.id === operator.id && row.login === operator.login)
    && jobs.length === 1 && jobs[0].name === 'proof' && jobs[0].run_id === runId && jobs[0].run_attempt === 1
    && jobs[0].head_sha === trusted.sha && jobs[0].status === 'in_progress' && jobs[0].conclusion === null);
  const approvals = reads.json(`${base}/actions/runs/${runId}/approvals`).filter(row => row.environments?.some(e => e.id === environment.id && e.name === environmentName));
  need(approvals.length === 1 && approvals[0].state === 'approved' && approvals[0].user?.id === operator.id);
  const originalDeadline = Math.min(Date.parse(run.run_started_at), Date.parse(jobs[0].started_at)) + 1800000;
  need(Number.isFinite(originalDeadline) && originalDeadline > Date.now());
  assertReleaseCoordinatorSource(ROOT, trusted.sha);
  const claims = await githubReleaseOidc({ env });
  need(claims.repository_id === String(repository.id) && claims.repository === RELEASE_REPOSITORY && claims.run_id === String(runId)
    && claims.run_attempt === '1' && claims.workflow_sha === trusted.sha && claims.sha === trusted.sha && claims.event_name === 'workflow_dispatch'
    && claims.workflow_ref === `${RELEASE_REPOSITORY}/${workflow}@refs/heads/${trusted.branch}` && claims.sub === `repo:${RELEASE_REPOSITORY}:environment:${environmentName}`);
  let action = JSON.parse(variable('FCOS_RELEASE_COORDINATION_PROOF_ACTION') || 'null');
  if (action?.binding?.runId !== runId) {
    need(allowWait);
    await waitForProofAction({ runId, deadline: originalDeadline, read: () => {
      const current = releaseCoordinationRows(reads.json(`${base}/environments/${environmentName}/variables?per_page=100`), 'variables');
      const value = name => current.find(row => row.name === name)?.value;
      need(value('FCOS_RELEASE_COORDINATION_PROOF_ENABLED') === 'true' && value('FCOS_RELEASE_COORDINATION_PROOF_HARNESS_SHA') === trusted.sha);
      return value('FCOS_RELEASE_COORDINATION_PROOF_ACTION');
    } });
    // Fresh source/main/job/approval/OIDC and the unchanged original run clock.
    return actualContext({ allowWait: false });
  }
  const binding = { repository: RELEASE_REPOSITORY, harnessSha: trusted.sha, runId, jobId: jobs[0].id };
  need(action?.kind === 'root_admitted_artifact_coordination_proof' && coordinationEqual(action.binding, binding)
    && action.authorizedBy === operator.login && /^[a-f0-9]{64}$/.test(action.actionAuthorizationSha256 || '')
    && Number.isSafeInteger(action.authorizedAt) && action.authorizedAt <= Date.now()
    && ['epoch', 'objective', 'ownerThreadId'].every(key => action.lease?.[key] === PREVIEW_COORDINATION_CANONICAL[key])
    && action.lease.operationId === `fcos-release-coordination-proof-${runId}` && /^[a-f0-9-]{36}$/.test(action.lease.leaseId || '')
    && action.lease.bindingSha256 === coordinationDigest(binding) && action.lease.coordinationOnly === true
    && action.lease.providerAuthorityGranted === false && action.lease.uncertainOutcomeRequiresReadback === true);
  const deadline = Math.min(Date.parse(run.run_started_at), Date.parse(jobs[0].started_at), action.authorizedAt) + 1800000;
  need(Number.isFinite(deadline) && deadline > Date.now());
  need(deadline > Date.now()); return { binding, action, reads, base, deadline };
}
function backend(context, phase) {
  const { binding, reads, base, deadline } = context, name = phase => `fcos-coordination-proof-${phase}-${binding.runId}`;
  const payload = marker => ({ kind: 'fcos_artifact_backend_exclusivity_probe', binding, marker });
  const read = async phase => {
    const rows = releaseCoordinationRows(reads.json(`${base}/actions/runs/${binding.runId}/artifacts?per_page=100`), 'artifacts').filter(row => row.name === name(phase));
    need(rows.length === 1); const row = rows[0], archive = reads.archive(`${base}/actions/artifacts/${row.id}/zip`);
    need(row.expired === false && row.workflow_run?.id === binding.runId && row.workflow_run.head_sha === binding.harnessSha
      && row.digest === `sha256:${coordinationDigest(archive)}` && Date.parse(row.created_at) <= Date.now() && deadline > Date.now());
    const value = decodePreviewCoordinationArchive(archive); need(coordinationEqual(value, payload(value.marker)));
    return { id: row.id, digest: coordinationDigest(archive), marker: value.marker, createdAt: row.created_at };
  };
  const readback = async name => { phase('readback-started'); const result = await read(name); phase('readback-complete'); return result; };
  const upload = async (phase, marker) => {
    need(deadline > Date.now()); const directory = mkdtempSync(join(tmpdir(), 'fcos-backend-proof-'));
    try {
      const path = join(directory, RELEASE_COORDINATION_FILE); writeFileSync(path, JSON.stringify(payload(marker)), { mode: 0o600, flag: 'wx', flush: true });
      return await new DefaultArtifactClient().uploadArtifact(name(phase), [path], directory, { retentionDays: 30, compressionLevel: 0 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  };
  return { read: readback, upload: async (name, marker) => {
    phase('upload-started'); const result = await upload(name, marker); phase('upload-complete'); return result;
  } };
}
async function executeProofWorker({ mode, admission }) {
  need(['proof', 'crash'].includes(mode) && Number.isSafeInteger(admission?.deadline) && admission.deadline > Date.now());
  const connected = guardProofWorkerParent(mode === 'proof');
  const phase = value => { connected(); proofPhase(value, () => {}); if (mode === 'proof') process.send({ type: 'phase', phase: value }); };
  phase('worker-admission-started');
  const context = await actualContext({ allowWait: false });
  need(coordinationEqual(context.binding, admission.binding) && coordinationEqual(context.action, admission.action)
    && context.deadline === admission.deadline && context.deadline > Date.now());
  connected();
  phase('worker-admission-complete');
  const api = backend(context, phase);
  if (mode === 'crash') { await api.upload('crash', 'crash'); process.exit(86); }
  const result = await exerciseArtifactCoordination({ ...api, phase, crash: () => new Promise((resolve, reject) => {
    // Inherit the supervised process group and original deadline. No independent retry or renewed timer.
    const child = fork(ownPath, ['--proof-worker'], { cwd: ROOT, env: process.env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('error', reject); child.once('close', code => resolve(code));
    child.send({ mode: 'crash', admission }, error => { if (error) { child.kill('SIGKILL'); reject(new Error('Artifact crash child unavailable.')); } });
  }) });
  phase('terminal-context-started');
  const after = await actualContext({ allowWait: false });
  need(coordinationEqual(after.binding, context.binding) && coordinationEqual(after.action, context.action)
    && after.deadline === context.deadline && context.deadline > Date.now());
  phase('terminal-context-complete');
  return { schemaVersion: 1, kind: 'fcos_actual_artifact_coordination_backend_proof', binding: context.binding,
    rootAction: context.action, capturedAt: new Date().toISOString(), ...result, requiresRootTerminalReadbackAndLeaseResolution: true,
    limitation: 'Artifact backend observations only; no automatic activation, Vercel operation, key access or canonical lease mutation.' };
}
export async function runReleaseCoordinationProof() {
  proofPhase('admission-started');
  const context = await actualContext(); proofPhase('admission-complete');
  const admission = { binding: context.binding, action: context.action, deadline: context.deadline };
  const report = await superviseCoordinationProofWorker({ workerPath: ownPath, admission, cwd: ROOT, deadline: context.deadline });
  need(coordinationEqual(report.binding, context.binding) && coordinationEqual(report.rootAction, context.action)
    && report.kind === 'fcos_actual_artifact_coordination_backend_proof' && report.grantsActivation === false
    && report.deploymentAuthority === false && context.deadline > Date.now());
  need(process.env.RUNNER_TEMP && resolve(process.env.RUNNER_TEMP) !== '/');
  writeFileSync(join(process.env.RUNNER_TEMP, `fcos-coordination-proof-${context.binding.runId}.json`), JSON.stringify(report), { mode: 0o600, flag: 'wx', flush: true });
  proofPhase('report-written'); return report;
}
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  if (process.argv.length === 3 && process.argv[2] === '--proof-worker' && typeof process.send === 'function') {
    process.once('message', input => executeProofWorker(input).then(result => {
      need(process.connected);
      process.send({ type: 'result', result }, error => process.exit(error ? 1 : 0));
    }).catch(() => process.exit(1)));
  }
  else if (process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--plan') console.log(JSON.stringify(releaseCoordinationProofPlan()));
  else process.exitCode = 1;
}
