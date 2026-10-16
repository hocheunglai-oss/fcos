import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubClient } from './lib/hosted-release/github.mjs';
import { releaseNotification, releaseTiming } from './lib/hosted-release/telemetry.mjs';
import { digest, assertBoundEvidence } from './lib/hosted-release/contract.mjs';
import { hostedSession, readManifest, writeJson } from './lib/hosted-release/session.mjs';

export async function reportHostedRelease({ env = process.env } = {}) {
  const manifest = readManifest(env.FCOS_RELEASE_MANIFEST);
  const github = githubClient({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID });
  await github.identity();
  const base = `/repos/${manifest.targets.repository}/actions/runs/${env.GITHUB_RUN_ID}`;
  const run = await github.read(base), jobs = await github.pages(`${base}/attempts/${run.run_attempt}/jobs`, 'jobs');
  const result = env.FCOS_RELEASE_RESULT_FILE ? JSON.parse(readFileSync(env.FCOS_RELEASE_RESULT_FILE, 'utf8')) : null;
  const needs = JSON.parse(env.FCOS_JOB_RESULTS || '{}');
  const failure = Object.values(needs).some(row => row.result === 'failure' || row.result === 'cancelled');
  let snapshot, journalStatus = 'unavailable';
  try {
    const session = await hostedSession({ manifest, controllerDirectory: resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller'), candidateDirectory: resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate'), env, jobName: 'release / report' });
    snapshot = await session.coordinator.snapshot({ releaseId: manifest.releaseId, manifestHash: digest(manifest) });
    journalStatus = 'observed';
  } catch { /* A failed preparation still produces a sanitized failure report. */ }
  const recoveredRunIds = [...new Set([snapshot?.registration?.registration_actor?.runId, ...Object.values(snapshot?.operations || {}).map(row => row.actor?.runId)].filter(id => id && String(id) !== String(run.id)))];
  let approvalJobs = jobs;
  if (snapshot?.approval?.run_id && String(snapshot.approval.run_id) !== String(run.id))
    approvalJobs = await github.pages(`/repos/${manifest.targets.repository}/actions/runs/${snapshot.approval.run_id}/attempts/1/jobs`, 'jobs');
  const ready = approvalJobs.find(row => row.name === 'release / ready / before' && row.conclusion === 'success');
  const approval = snapshot?.approval ? { approvedAt: snapshot.approval.receipt.protectedJobStartedAt } : null;
  const missing = snapshot ? manifest.requiredChecks.filter(id => { try { const proof = snapshot.checks?.[id]; assertBoundEvidence(proof?.evidence || proof,manifest,id); return false; } catch { return true; } }) : [];
  const qualification = snapshot?.checks?.['hosted.qualification']?.evidence || snapshot?.checks?.['hosted.qualification'];
  const qualified = manifest.executionMode === 'qualification' && qualification?.actualGithubArtifactValidated === true
    && qualification.manifestHash === digest(manifest) && needs.qualification_publish?.result === 'success';
  const completed = snapshot?.status || result?.status;
  const status = ['complete','rolled_back'].includes(completed) ? completed : qualified ? 'qualification_passed'
    : failure || result?.status === 'intervention_required' || missing.length || !snapshot ? 'intervention_required' : result?.status || 'waiting_dependency';
  const timing = releaseTiming({ run, jobs, approval, prerequisiteCompletedAt: ready?.completed_at, recoveredRunIds });
  const notification = releaseNotification({ manifest, status, phase: result?.phase, runId: run.id, missing: result?.missing || missing });
  const report = { schemaVersion: 2, status, timing, notification, journalStatus };
  writeJson(env.FCOS_RELEASE_OUTPUT || 'release-report.json', report);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `\n## Hosted release outcome\n\n${status}\n\nCompute: ${timing.computeSeconds}s (parallel job sum). Initial queue: ${timing.initialQueueSeconds ?? 'unobserved'}s. Approval waiting: ${timing.approvalWaitSeconds ?? 'unobserved'}s. Recovery runs: ${timing.recovery.runIds.join(', ') || 'none observed'}. No estimate is substituted.\n`);
  // GitHub Mobile delivery is an account setting, not something a runner can
  // attest. Its actual receipt is a one-time activation prerequisite.
  if (failure || status === 'rolled_back' || status === 'intervention_required') process.exitCode = 1;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) reportHostedRelease().catch(() => {
  console.error('FCOS_RELEASE_REPORT_UNAVAILABLE'); process.exitCode = 1;
});
