import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, requireCondition as check, targets, validateManifest } from './contract.mjs';
import { assertSmokeProof } from './engine.mjs';
import { DeploymentJournal, pendingOperations } from './journal.mjs';
import { readLocalMirrorStage, verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';

export const workflowPath = '.github/workflows/fcos-rapid-invoice-reminders-qat-closure.yml';
export const workflowTitle = 'Close stopped FCOS Invoice Reminders QAT validation';
export const productionEnvironment = Object.freeze({ id: 23178773471, name: 'fcos-production-release' });
export const schemaPins = Object.freeze({
  approved: '1a269959f2cc8ea07b8b440f3421ec8c230cab11b07c8b28b3fa025e745af413',
  storageMigration80: 'dcfa6fea815dacc3c75c8249d8651d1e7c2cb8713bf19106cca563bcb7246a4f',
});
export const original = Object.freeze({
  runId: 44908835387,
  repositoryId: 1278654816,
  ownerId: 265701760,
  botId: 41898282,
  handoverId: 7962366609,
  dispatcher: 'e948e3622e9cc2cca65b6915fb55b59f1df700d6',
  controller: 'a6f6caadbb8df8acba9b66e3f82428818a90dc3a',
  candidate: '4c4d1b4548e090bc7eebb96b66549dc743dc01ad',
  releaseId: 'rapid-4c4d1b4548e0-mwqfw86e',
  manifestHash: 'cf79bcd3730a4136892b447c3c1201434eb22f858e8a706ac7601c0ce79adc73',
  head: '826228f7de152f9455d9cce7c4d1ace72cfa42b27f109a7c77248cc8b107995d',
  fingerprint: '359f1af542ca8d889f95a6e02648dbf9c643b4159ccba064a75dc77278361828',
  sourceTreeHash: 'c25c41991a4dac9348360640f9ba91f44f2de5ee3b8b0d4f7814890c8c287627',
  packageSha256: '977a73847104a97807cca19ea7a5f719df6076b1b583a3c49d3ba9d048212b94',
  stagedDeploymentId: 'dpl_HsRWGY7JzrvU7zHx68xb7viUmdvr',
  stagedArtifactDigest: '676f63c376585023adf390eb6c2c8f969468ffd7b6b87e5f67613c348ace8cba',
  approvalReceiptId: 7964175989,
  intentReceiptId: 7964177844,
  deveeValidationId: '0AfHF000007JH7Z0AW',
  deveeDeploymentId: '0AfHF000007JH9B0AW',
  qatValidationId: '0AfBh000006lnBVKAY',
  mirrorRequestId: 7964240004,
  mirrorReceiptId: 7964258080,
  mirrorCommit: 'c9d9e4ce59696efd50d392ed5047648f1261734b',
  mirrorPullRequest: 9,
});

const repoPath = '/repos/' + targets().repository;
const operationId = original.releaseId + '-prerequisites';
const same = (left, right) => digest(left) === digest(right);
export const isClosureOwner = person => person?.id === original.ownerId && person.login === targets().account;
const isBot = person => person?.id === original.botId && person.login === 'github-actions[bot]';

export function assertClosureApproval(approvals) {
  const reviews = Array.isArray(approvals) && approvals.filter(review => review.environments?.some(environment =>
    environment.id === productionEnvironment.id && environment.name === productionEnvironment.name));
  check(reviews?.length === 1 && reviews[0].state === 'approved' && isClosureOwner(reviews[0].user),
    'REMINDER_CLOSURE_NATIVE_APPROVAL_REQUIRED');
}

export function assertClosureSchemaProof(proof) {
  check(proof?.approved === schemaPins.approved && proof.historical === schemaPins.approved
    && (proof.observed === schemaPins.approved && proof.storageMigrationId === null
      || proof.observed === schemaPins.storageMigration80 && proof.storageMigrationId === 80),
  'REMINDER_CLOSURE_SCHEMA_PROOF_MISMATCH');
  const { approved, observed, historical, storageMigrationId } = proof;
  return { approved, observed, historical, storageMigrationId };
}

export function closureResult({ evidenceDigest, closureRunId, schemaProof }) {
  check(isDigest(evidenceDigest) && Number.isSafeInteger(closureRunId) && closureRunId > 0,
    'REMINDER_CLOSURE_EVIDENCE_INVALID');
  return {
    operationId, outcome: 'stopped_invoice_reminders_qat_validation_failed', closureRunId, evidenceDigest,
    schemaProof: assertClosureSchemaProof(schemaProof),
    originalHead: original.head, originalRunId: original.runId, approvalReceiptId: original.approvalReceiptId,
    stagedDeploymentId: original.stagedDeploymentId, salesforceFingerprint: original.fingerprint,
    salesforceSourceTreeHash: original.sourceTreeHash, deveeValidationJobId: original.deveeValidationId,
    deveeDeploymentJobId: original.deveeDeploymentId, mirrorRequestId: original.mirrorRequestId,
    mirrorReceiptId: original.mirrorReceiptId, mirrorCommit: original.mirrorCommit,
    qatValidationJobId: original.qatValidationId, qatValidationStatus: 'Failed', qatValidationCheckOnly: true,
    qatDeploymentSubmitted: false, productionDeploySubmitted: false, promotionSubmitted: false,
  };
}

function verifyHistoricalRun({ run, jobs, approvals }) {
  check(run.id === original.runId && run.repository?.id === original.repositoryId
    && run.repository.full_name === targets().repository && isClosureOwner(run.actor) && isClosureOwner(run.triggering_actor)
    && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'failure'
    && run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.head_sha === original.dispatcher
    && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.display_title === `FCOS rapid release ${original.manifestHash} ${original.candidate}`,
  'REMINDER_CLOSURE_ORIGINAL_RUN_MISMATCH');
  const expected = [
    ['quality', 136860079558, 'success'],
    ['stage-and-smoke', 136861683106, 'success'],
    ['go-live', 136863517018, 'failure'],
  ];
  check(jobs.total_count === expected.length && jobs.jobs?.length === expected.length
    && expected.every(([name, id, conclusion]) => jobs.jobs.some(job => job.name === name && job.id === id
      && job.status === 'completed' && job.conclusion === conclusion && job.run_id === run.id && job.run_attempt === 1
      && Date.parse(run.created_at) <= Date.parse(job.started_at) && Date.parse(job.started_at) <= Date.parse(job.completed_at))),
  'REMINDER_CLOSURE_ORIGINAL_JOBS_MISMATCH');
  assertClosureApproval(approvals);
  return jobs.jobs.find(job => job.name === 'go-live');
}

export function verifyJournalBoundary(chain, closeRunCompletedAt) {
  const prior = chain.slice(0, 23);
  const receipt = chain[23];
  check([23, 24].includes(chain.length) && prior[22]?.payload.recordHash === original.head
    && prior.every(row => isBot(row.creator)) && chain.every(row => row.sha === original.candidate
      && row.ref === original.candidate && row.environment === 'fcos-release-journal-v1'
      && row.task === 'fcos-release-journal'),
  'REMINDER_CLOSURE_JOURNAL_HEAD_CHANGED');
  const pending = pendingOperations(chain);
  if (receipt) {
    check(pending.length === 0 && isClosureOwner(receipt.creator) && receipt.payload.event === 'prerequisites.result'
      && receipt.payload.previousHash === original.head && Date.parse(receipt.created_at) >= Date.parse(closeRunCompletedAt)
      && same(receipt.payload.data, closureResult(receipt.payload.data)), 'REMINDER_CLOSURE_RECEIPT_MISMATCH');
  } else {
    check(pending.length === 1 && pending[0].event === 'prerequisites.intent' && pending[0].data.operationId === operationId,
      'REMINDER_CLOSURE_PENDING_SCOPE_CHANGED');
  }
  return { prior, receipt };
}

function verifyCheckpoints(chain) {
  const expected = [
    ['devee', 'validation', 12, 7964220373, original.deveeValidationId, null],
    ['devee', 'deployment', 15, 7964229827, original.deveeDeploymentId, original.deveeValidationId],
    ['shared_mirror', 'publication', 17, 7964261249],
    ['qat', 'validation', 20, 7964283830, original.qatValidationId, null],
  ];
  return Object.fromEntries(expected.map(([stage, operation, sequence, id, jobId, validationId]) => {
    const row = chain[sequence];
    const data = row?.payload.data;
    check(row?.id === id && row.payload.event === 'salesforce.checkpoint' && data.stage === stage
      && data.operation === operation && data.outcome === 'resolved' && data.fingerprint === original.fingerprint
      && isDigest(data.evidenceDigest), 'REMINDER_CLOSURE_SALESFORCE_CHECKPOINT_MISMATCH');
    check(jobId ? data.job?.id === jobId && data.job.validationId === validationId
      && (operation !== 'validation' || data.job.packageSha256 === original.packageSha256)
      : same(data.mirror, { commit: original.mirrorCommit, pullRequest: original.mirrorPullRequest }),
    'REMINDER_CLOSURE_SALESFORCE_JOB_MISMATCH');
    return [`${stage}:${operation}`, row];
  }));
}

export function verifyStoppedReminder({ run, jobs, approvals, chain, mirrorRequest, mirrorReceipt }) {
  const goLive = verifyHistoricalRun({ run, jobs, approvals });
  const { prior, receipt } = verifyJournalBoundary(chain, goLive.completed_at);
  const manifest = prior[0].payload.data.manifest;
  const plan = manifest?.prerequisites?.plan;
  check(validateManifest(manifest) === original.manifestHash && manifest.controllerSha === original.controller
    && manifest.candidate.sha === original.candidate && manifest.selection.salesforce && !manifest.selection.database
    && manifest.prerequisites.adapter === 'salesforce-reviewed-manifest' && plan.mirrorPublication === 'local-collaborator'
    && plan.salesforceFingerprint === original.fingerprint && plan.salesforceSourceTreeHash === original.sourceTreeHash,
  'REMINDER_CLOSURE_MANIFEST_MISMATCH');
  const staged = readLocalMirrorStage(prior[3], { manifest, workflowActorId: original.botId });
  check(staged.id === original.stagedDeploymentId && staged.artifactDigest === original.stagedArtifactDigest,
    'REMINDER_CLOSURE_STAGING_MISMATCH');
  assertSmokeProof(prior[4].payload.data, manifest, staged);
  const approval = assertAuthorization(prior[5].payload.data, manifest, staged, Date.parse(prior[5].created_at));
  const request = { candidateSha: original.candidate, planDigest: digest(manifest.prerequisites) };
  check(prior[5].id === original.approvalReceiptId && prior[5].payload.event === 'approval.accepted'
    && approval.runId === run.id && approval.approvedAt === run.created_at
    && prior[6].id === original.intentReceiptId && prior[6].payload.event === 'prerequisites.intent'
    && same(prior[6].payload.data, { operationId, request, requestHash: digest(request) })
    && Date.parse(goLive.started_at) <= Date.parse(prior[5].created_at) && Date.parse(prior[22].created_at) <= Date.parse(goLive.completed_at)
    && prior[21].payload.event === 'salesforce.checkpoint' && prior[21].payload.data.stage === 'production'
    && prior[21].payload.data.operation === 'restoration-checkpoint' && prior[21].payload.data.outcome === 'evidence'
    && prior[22].payload.event === 'obstacle.detected' && prior[22].payload.data.code === 'UNCLASSIFIED_RELEASE_OBSTACLE',
  'REMINDER_CLOSURE_PREREQUISITE_BOUNDARY_MISMATCH');

  const checkpoints = verifyCheckpoints(prior);
  const publication = mirrorRequest?.payload;
  check(mirrorRequest?.id === original.mirrorRequestId && isBot(mirrorRequest.creator)
    && mirrorReceipt?.id === original.mirrorReceiptId && isClosureOwner(mirrorReceipt.creator)
    && [mirrorRequest, mirrorReceipt].every(row => row.ref === original.candidate && row.task === 'fcos-local-mirror-handoff')
    && publication?.manifestHash === original.manifestHash && publication.candidateSha === original.candidate
    && publication.controllerSha === original.controller && publication.runId === run.id && publication.runAttempt === 1
    && publication.mode === 'publish' && publication.sequence === 1
    && publication.intentHash === prior[16].payload.data.evidenceDigest
    && publication.deveeOrgId === fcosSalesforceEnvironment('devee').orgId
    && publication.deploymentJobId === original.deveeDeploymentId && publication.validationJobId === original.deveeValidationId
    && Date.parse(prior[16].created_at) <= Date.parse(mirrorRequest.created_at)
    && Date.parse(mirrorReceipt.created_at) <= Date.parse(checkpoints['shared_mirror:publication'].created_at),
  'REMINDER_CLOSURE_MIRROR_HISTORY_MISMATCH');
  const mirror = verifyLocalMirrorReceipt({ request: publication, requestDeployment: mirrorRequest, receiptDeployment: mirrorReceipt,
    reviewed: { fingerprint: original.fingerprint, binding: { sourceTreeHash: original.sourceTreeHash } },
    workflowActorId: original.botId, publisherId: original.ownerId, now: Date.parse(mirrorReceipt.created_at) });
  check(mirror.commit === original.mirrorCommit && mirror.pullRequest.number === original.mirrorPullRequest,
    'REMINDER_CLOSURE_MIRROR_CHECKPOINT_MISMATCH');
  return { manifest, staged, checkpoints, mirror, receipt, goLive };
}

async function verifyNativeClosureRun(github, receipt) {
  const id = receipt.payload.data.closureRunId;
  const path = `${repoPath}/actions/runs/${id}`;
  const [run, jobs, approvals] = await Promise.all([
    github.read(path), github.read(path + '/attempts/1/jobs?per_page=100'), github.read(path + '/approvals'),
  ]);
  const job = jobs.jobs?.[0];
  check(run.id === id && run.repository?.id === original.repositoryId && run.repository.full_name === targets().repository
    && run.run_attempt === 1 && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.status === 'completed' && run.conclusion === 'success' && isClosureOwner(run.actor)
    && isClosureOwner(run.triggering_actor) && nativeWorkflowPath(run) === workflowPath && run.display_title === workflowTitle
    && jobs.total_count === 1 && jobs.jobs?.length === 1 && job.name === 'close-invoice-reminders-qat-validation'
    && job.run_id === id && job.run_attempt === 1 && job.status === 'completed' && job.conclusion === 'success'
    && Date.parse(job.started_at) <= Date.parse(receipt.created_at) && Date.parse(receipt.created_at) <= Date.parse(job.completed_at),
  'REMINDER_CLOSURE_RECEIPT_RUN_MISMATCH');
  assertClosureApproval(approvals);
}

export async function readStoppedReminder(github, journal, currentClosureRunId) {
  const runPath = `${repoPath}/actions/runs/${original.runId}`;
  const deploymentPath = repoPath + '/deployments/';
  const [run, jobs, approvals, chain, mirrorRequest, mirrorReceipt] = await Promise.all([
    github.read(runPath), github.read(runPath + '/jobs?per_page=100'), github.read(runPath + '/approvals'),
    journal.read(), github.read(deploymentPath + original.mirrorRequestId), github.read(deploymentPath + original.mirrorReceiptId),
    assertFrozenWorkflow({ github, controllerSha: original.controller, dispatcherSha: original.dispatcher }),
  ]);
  const closure = verifyStoppedReminder({ run, jobs, approvals, chain, mirrorRequest, mirrorReceipt });
  if (closure.receipt && closure.receipt.payload.data.closureRunId !== currentClosureRunId) {
    await verifyNativeClosureRun(github, closure.receipt);
  }
  return closure;
}

export function reminderClosureJournal(github) {
  const verifiedGithub = { ...github, pages: async path => {
    const records = await github.pages(path);
    const own = records.filter(row => row.payload?.releaseId === original.releaseId);
    check(new Set(own.map(row => row.payload.recordHash)).size === own.length, 'REMINDER_CLOSURE_DUPLICATE_NATIVE_RECORD');
    return records;
  } };
  return new DeploymentJournal({ github: verifiedGithub, releaseId: original.releaseId, manifestHash: original.manifestHash,
    actorIds: [original.ownerId, original.botId] });
}

export async function appendReminderClosure({ read, journal, evidenceDigest, closureRunId, schemaProof }) {
  const { receipt } = await read();
  if (receipt) return receipt;
  const data = closureResult({ evidenceDigest, closureRunId, schemaProof });
  try {
    await journal.append('prerequisites.result', data, { expectedPreviousHash: original.head });
  } catch (error) {
    if (error.message === 'JOURNAL_ADVANCED') throw error;
    // A submission may have succeeded before a transport error. Resolve only by readback.
  }
  const observed = (await read()).receipt;
  check(observed && same(observed.payload.data, data), 'REMINDER_CLOSURE_APPEND_OUTCOME_UNCERTAIN');
  return observed;
}
