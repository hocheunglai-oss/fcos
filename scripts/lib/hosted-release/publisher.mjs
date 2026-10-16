import { qualificationSourceBinding } from '../../../config/hostedReleaseQualification.js';
import { CONTROLLER_WORKFLOW, digest, fail, hash, validateManifest } from './contract.mjs';

/** Called only after an independent API/artifact collection, never with candidate-supplied job metadata. */
export function assertHostedJob({ manifest, run, job, expectedJobName, controllerSha, artifact }) {
  validateManifest(manifest);
  const source = qualificationSourceBinding(manifest);
  if (source && (run?.head_sha !== source.bootstrapSha || run.run_attempt !== 1 || !['.github/workflows/authenticated-release.yml', `.github/workflows/authenticated-release.yml@${source.ref.slice('refs/heads/'.length)}`].includes(run.path))) fail('PRODUCER_CONTROLLER_BINDING', 'proof.publish');
  const reusable = run?.referenced_workflows?.filter(row => row.path === `${manifest.targets.repository}/${CONTROLLER_WORKFLOW}@${manifest.controller.sha}`);
  if (reusable?.length !== 1 || reusable[0].sha !== manifest.controller.sha) fail('PRODUCER_CONTROLLER_BINDING', 'proof.publish');
  if (controllerSha !== manifest.controller.sha || run?.repository?.full_name !== manifest.targets.repository
    || run.head_repository?.full_name !== manifest.targets.repository || run.head_branch !== (source?.ref.slice('refs/heads/'.length) || 'main')
    || run.event !== 'workflow_dispatch' || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt)
    || job?.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha || job.name !== expectedJobName
    || job.status !== 'completed' || job.conclusion !== 'success' || !Number.isSafeInteger(job.id)
    || !Number.isFinite(Date.parse(job.started_at)) || !Number.isFinite(Date.parse(job.completed_at))) fail('PRODUCER_JOB_NOT_SUCCESSFUL', 'proof.publish');
  const step = job.steps?.find(row => row.name === 'Run admitted checks');
  if (step?.conclusion !== 'success' || step.status !== 'completed') fail('PRODUCER_STEP_NOT_SUCCESSFUL', 'proof.publish');
  if (!artifact || artifact.expired || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha || !Number.isSafeInteger(artifact.id)
    || artifact.digest?.replace(/^sha256:/, '') !== artifact.archiveSha256 || !hash(artifact.archiveSha256)
    || Date.parse(artifact.created_at) < Date.parse(job.started_at) || Date.parse(artifact.created_at) > Date.parse(job.completed_at) + 30000) fail('PRODUCER_ARTIFACT_BINDING', 'proof.publish');
  return true;
}

export async function publishChecks({ manifest, report, run, job, artifact, expectedJobName, coordinator, validateReport, allowEmpty = false, validateHistoricalCheck }) {
  assertHostedJob({ manifest, run, job, artifact, expectedJobName, controllerSha: manifest.controller.sha });
  if (typeof validateReport !== 'function') fail('CHECK_VALIDATOR_REQUIRED', 'proof.publish');
  const accepted = await validateReport(report);
  if (!Array.isArray(accepted) || !accepted.length && !allowEmpty) fail('CHECK_REPORT_EMPTY', 'proof.publish');
  const proofs = [];
  for (const check of accepted) {
    const historical = Date.parse(check.completedAt) < Date.parse(job.started_at);
    const historicalAccepted = historical && check.id === 'nom_b' && check.kind === 'deterministic'
      && typeof validateHistoricalCheck === 'function' && await validateHistoricalCheck({ check, manifest, run, job, artifact }) === true;
    if (check.status !== 'passed' || !manifest.requiredChecks.includes(check.id) || !hash(check.inputsSha256)
      || !Number.isFinite(Date.parse(check.completedAt)) || historical && !historicalAccepted
      || Date.parse(check.completedAt) > Date.parse(job.completed_at) + 30000) fail('CHECK_REPORT_INVALID', 'proof.publish');
    const proof = {
      schemaVersion: 2, checkId: check.id, status: 'passed', kind: check.kind,
      manifestHash: digest(manifest), candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha,
      inputsSha256: check.inputsSha256, artifactSha256: artifact.archiveSha256, capturedAt: check.completedAt,
      publisher: { trust: 'hosted_controller', runId: run.id, jobId: job.id, artifactId: artifact.id },
      ...(check.kind === 'volatile' ? { maxAgeSeconds: check.maxAgeSeconds } : {}), result: check.result,
    };
    // Keep producer time; caching or recollection must not manufacture freshness.
    await coordinator.appendEvidence({ releaseId: manifest.releaseId, manifestHash: digest(manifest), key: check.id, evidence: proof });
    proofs.push(proof);
  }
  return proofs;
}
