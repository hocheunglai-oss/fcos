import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBoundEvidence, digest, validateManifest } from './lib/hosted-release/contract.mjs';
import { collectAcceptance, safeFailure } from './lib/hosted-release/controller.mjs';
import { hostedSession, readManifest, workflowOutput, writeJson } from './lib/hosted-release/session.mjs';
import { admittedReadiness, READINESS_JOB, createReadinessReader, verifyReadinessBrowsers, verifyReadinessDeterministic } from './lib/hosted-release/readiness.mjs';

export async function produceHostedReadiness({ manifest, coordinator, github, admission, now = Date.now }) {
  validateManifest(manifest);
  if (!admission || manifest.executionMode !== 'release') return { status: 'inactive', accepted: false };
  const binding = { releaseId: manifest.releaseId, manifestHash: digest(manifest) }, snapshot = await coordinator.snapshot(binding);
  if (snapshot.mode !== 'active' || snapshot.epoch !== manifest.epoch) return { status: 'inactive', accepted: false };
  const acceptance = await collectAcceptance({ manifest, coordinator, provider: {}, now });
  if (acceptance.status !== 'ready') return { status: 'waiting_dependency', accepted: false, missing: acceptance.missing };
  for (const id of manifest.requiredChecks) assertBoundEvidence(acceptance.checks[id], manifest, id, { now: now() });
  const previewProof = snapshot.checks?.['preview.ready'], preview = previewProof?.evidence?.result || previewProof?.result;
  const receipt = { schemaVersion: 1, kind: 'fcos_hosted_preview_readiness', manifest, manifestHash: binding.manifestHash,
    mode: snapshot.mode, epoch: snapshot.epoch, setupSha256: manifest.setupSha256,
    activationReceiptSha256: admission.activation.activationReceiptSha256, readyAt: new Date(now()).toISOString(), preview, checks: acceptance.checks };
  const repository = await github.identity(), read = createReadinessReader({ read: github.read, now });
  await Promise.all([verifyReadinessBrowsers({ receipt, admission, repository, read, now: now() }),
    verifyReadinessDeterministic({ receipt, admission, repository, read })]);
  return { status: 'passed', accepted: true, receipt };
}

export async function hostedReadinessEntrypoint({ env = process.env, sessionFactory = hostedSession, now = Date.now } = {}) {
  const manifest = readManifest(env.FCOS_RELEASE_MANIFEST);
  const admission = admittedReadiness({ enabled: env.FCOS_HOSTED_READINESS_ENABLED, setupJson: env.FCOS_ADMITTED_RELEASE_SETUP,
    setupSha256: env.FCOS_ADMITTED_RELEASE_SETUP_SHA256, activationJson: env.FCOS_HOSTED_READINESS_ACTIVATION,
    repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID });
  // Disabled installation and qualification never publish a merge-gate receipt.
  if (!admission || manifest.executionMode !== 'release') { workflowOutput({ ready: 'false' }, env); return { status: 'inactive', accepted: false }; }
  const session = await sessionFactory({ manifest, env, now, jobName: READINESS_JOB,
    controllerDirectory: resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller'), candidateDirectory: resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate') });
  const result = await produceHostedReadiness({ manifest, coordinator: session.coordinator, github: session.github, admission, now });
  workflowOutput({ ready: String(result.accepted) }, env);
  if (result.accepted) writeJson(env.FCOS_RELEASE_OUTPUT || 'hosted-readiness.json', result.receipt);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) hostedReadinessEntrypoint().then(result => {
  console.log(JSON.stringify({ status: result.status, ready: result.accepted }));
}).catch(error => { const failure = safeFailure(error); console.error(JSON.stringify({ status: failure.status, code: error.code?.startsWith('HOSTED_READINESS_') ? error.code : failure.code })); process.exitCode = 1; });
