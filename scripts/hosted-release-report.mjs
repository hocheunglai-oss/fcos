import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubClient } from './lib/hosted-release/github.mjs';
import { releaseNotification, releaseTiming } from './lib/hosted-release/telemetry.mjs';
import { digest, assertBoundEvidence } from './lib/hosted-release/contract.mjs';
import { hostedSession, readManifest, writeJson } from './lib/hosted-release/session.mjs';
import { terminalReleaseStatus } from './lib/hosted-release/controller.mjs';

function executorResult(file, expected) {
  if (!expected) return { state: 'not_requested', result: null };
  if (!file || !existsSync(file)) return { state: 'missing', result: null };
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || !['complete','rolled_back','waiting_dependency','intervention_required','failed'].includes(value.status)
      || value.code !== undefined && !/^[A-Z][A-Z0-9_]{0,127}$/.test(value.code)
      || value.cause !== undefined && !/^[A-Z][A-Z0-9_]{0,127}$/.test(value.cause)
      || value.phase !== undefined && !/^[a-z][a-z0-9_.-]{0,127}$/.test(value.phase)
      || value.recovery !== undefined && (typeof value.recovery !== 'string' || value.recovery.length > 2000 || /[\r\n\x00-\x1f]/.test(value.recovery))
      || value.missing !== undefined && (!Array.isArray(value.missing) || value.missing.length > 100 || value.missing.some(id => !/^[a-z][a-z0-9_]{0,127}$/.test(id)))) return { state: 'invalid', result: null };
    return { state: 'available', result: { status: value.status,
      ...(value.code ? { code: value.code } : {}), ...(value.cause ? { cause: value.cause } : {}), ...(value.phase ? { phase: value.phase } : {}),
      ...(value.recovery ? { recovery: value.recovery } : {}), ...(value.missing ? { missing: value.missing } : {}) } };
  } catch { return { state: 'invalid', result: null }; }
}

export async function reportHostedRelease({ env = process.env, createGithub = githubClient, sessionFactory = hostedSession } = {}) {
  const manifest = readManifest(env.FCOS_RELEASE_MANIFEST);
  const github = createGithub({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID });
  await github.identity();
  const base = `/repos/${manifest.targets.repository}/actions/runs/${env.GITHUB_RUN_ID}`;
  const run = await github.read(base), jobs = await github.pages(`${base}/attempts/${run.run_attempt}/jobs`, 'jobs');
  const needs = JSON.parse(env.FCOS_JOB_RESULTS || '{}');
  const attempted = ['success','failure','cancelled'].includes(needs.execute?.result);
  const executor = executorResult(env.FCOS_RELEASE_RESULT_FILE, attempted || !!env.FCOS_RELEASE_RESULT_FILE), result = executor.result;
  const failure = Object.values(needs).some(row => row.result === 'failure' || row.result === 'cancelled');
  let snapshot, journalStatus = 'unavailable';
  try {
    const session = await sessionFactory({ manifest, controllerDirectory: resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller'), candidateDirectory: resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate'), env, jobName: 'release / report' });
    snapshot = await session.coordinator.snapshot({ releaseId: manifest.releaseId, manifestHash: digest(manifest) });
    journalStatus = 'observed';
  } catch { /* A failed preparation still produces a sanitized failure report. */ }
  const recoveredRunIds = [...new Set([snapshot?.registration?.registration_actor?.runId, ...Object.values(snapshot?.operations || {}).map(row => row.actor?.runId)].filter(id => id && String(id) !== String(run.id)))];
  let approvalJobs = jobs;
  if (snapshot?.approval?.run_id && String(snapshot.approval.run_id) !== String(run.id))
    approvalJobs = await github.pages(`/repos/${manifest.targets.repository}/actions/runs/${snapshot.approval.run_id}/attempts/1/jobs`, 'jobs');
  const ready = approvalJobs.find(row => row.name === 'release / ready / before' && row.conclusion === 'success');
  const approval = snapshot?.approval ? { approvedAt: snapshot.approval.receipt.protectedJobStartedAt } : null;
  const completed = terminalReleaseStatus(snapshot, manifest);
  const missing = snapshot && !completed ? manifest.requiredChecks.filter(id => { try { const proof = snapshot.checks?.[id]; assertBoundEvidence(proof?.evidence || proof,manifest,id); return false; } catch { return true; } }) : [];
  const qualification = snapshot?.checks?.['hosted.qualification']?.evidence || snapshot?.checks?.['hosted.qualification'];
  const qualified = manifest.executionMode === 'qualification' && qualification?.actualGithubArtifactValidated === true
    && qualification.manifestHash === digest(manifest) && needs.qualification_publish?.result === 'success';
  const artifactProblem = ['missing','invalid'].includes(executor.state);
  const diagnostics = artifactProblem ? { code: executor.state === 'missing' ? 'EXECUTOR_RESULT_ARTIFACT_MISSING' : 'EXECUTOR_RESULT_ARTIFACT_INVALID',
    phase: 'production.report', recovery: 'Inspect the coordinator journal and resume the unchanged manifest through a new hosted workflow dispatch; never replay a provider write.' }
    : result ? Object.fromEntries(['code','phase','recovery','cause'].filter(key => result[key] !== undefined).map(key => [key,result[key]])) : {};
  const status = artifactProblem || failure || ['intervention_required','failed'].includes(result?.status) ? 'intervention_required'
    : completed || (qualified ? 'qualification_passed' : missing.length || !snapshot ? 'intervention_required' : 'waiting_dependency');
  const timing = releaseTiming({ run, jobs, approval, prerequisiteCompletedAt: ready?.completed_at, recoveredRunIds });
  const event = releaseNotification({ manifest, status, phase: diagnostics.phase, runId: run.id, missing: result?.missing || missing });
  const notification = event ? { ...event, ...diagnostics } : null;
  const report = { schemaVersion: 2, status, ...diagnostics, timing, notification, journalStatus, executorArtifact: executor.state,
    ...(completed ? { journalReleaseStatus: completed } : {}) };
  writeJson(env.FCOS_RELEASE_OUTPUT || 'release-report.json', report);
  if (env.GITHUB_STEP_SUMMARY) {
    const detail = Object.entries(diagnostics).map(([key,value]) => `${key}: ${value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])}`).join('\n\n');
    appendFileSync(env.GITHUB_STEP_SUMMARY,
      `\n## Hosted release outcome\n\n${status}\n\n${detail ? `${detail}\n\n` : ''}Compute: ${timing.computeSeconds}s (parallel job sum). Initial queue: ${timing.initialQueueSeconds ?? 'unobserved'}s. Approval waiting: ${timing.approvalWaitSeconds ?? 'unobserved'}s. Recovery runs: ${timing.recovery.runIds.join(', ') || 'none observed'}. No estimate is substituted.\n`);
  }
  // GitHub Mobile delivery is an account setting, not something a runner can
  // attest. Its actual receipt is a one-time activation prerequisite.
  if (failure || status === 'rolled_back' || status === 'intervention_required') process.exitCode = 1;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) reportHostedRelease().catch(() => {
  console.error('FCOS_RELEASE_REPORT_UNAVAILABLE'); process.exitCode = 1;
});
