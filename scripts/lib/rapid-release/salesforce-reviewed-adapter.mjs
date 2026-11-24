import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertSalesforceProductionSettingCompatibility, assertReviewedInputsUnchanged, cliSalesforceProvider, loadReviewedSalesforcePlan } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { runReviewedMirror } from '../../sync-salesforce-reviewed-repository.mjs';
import { preflightSharedMirrorPublication } from '../../sync-salesforce-shared-repository.mjs';
import { openSalesforcePromotionJournal } from '../salesforce-promotion-journal.mjs';
import { assertReviewedMirror, assertReviewedJobReport, matchesSalesforceCheckpoint, reviewedJobExpectations, runReviewedSalesforceRelease, safeProjectFile, verifyReviewedOrgInventory } from '../salesforce-reviewed-release.mjs';
import { assertHostedSalesforceRunner, authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';
import { assertAuthorization, digest, git, isDigest, requireCondition, targets, validateManifest } from './contract.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { awaitLocalMirrorReceipt, createLocalMirrorRequest, LOCAL_MIRROR_ENVIRONMENT, readLocalMirrorDeployments,
  recordLocalMirrorDeployment, usesLocalCollaboratorMirror } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, githubClient, nativeWorkflowPath, verifyExecution } from './providers.mjs';
import { awaitDeveeDesktopReceipt, createDeveeDesktopRequest, recordVerifiedDeveeDesktopCheckpoint } from './salesforce-devee-desktop-checkpoint.mjs';
import { hasEditorPreflightLocator, verifyEditorPreflightPostimage } from './salesforce-editor-preflight-transport.mjs';
import { assertEditorsAdoptionApproval, assertEditorsValidationUsable, readEditorsProductionValidationAdoption,
  recoverEditorsProductionValidation } from './editors-production-validation-adoption.mjs';
import { applyTradingFxSalesSupportCorrection, applyTradingFxSalesSupportSandboxCorrection, verifyTradingFxSalesSupportReadGrants } from './trading-fx-sales-support-transport.mjs';
import { verifySalesSupportRepairSource } from './trading-fx-sales-support-source.mjs';
import { promoteSalesSupportCorrection } from './trading-fx-sales-support-promotion.mjs';
import { runPreBootstrapSmoke } from './smoke.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');

export async function reconcileHostedSalesforceJob({ environment, jobId, reviewed, operation, submittedAt, validationJobId, packageSha256,
  provider, journal, now = () => new Date() }) {
  const target = policy.environments.find(item => item.key === environment.key);
  const reviewedBootstrap = operation === 'bootstrap' && validationJobId === null && reviewed.review?.bootstrap?.components?.length > 0
    && /^[a-f0-9]{64}$/u.test(reviewed.binding.bootstrapSha256 || '');
  requireCondition(target?.orgId === environment.orgId && (['validation', 'deployment'].includes(operation) || reviewedBootstrap),
    'SALESFORCE_HOSTED_RECOVERY_SCOPE_INVALID');
  const entries = await journal.readCheckpoints();
  const original = entries.find(item => item.fingerprint === reviewed.fingerprint && item.stage === target.key
    && item.operation === operation && ['pending', 'resolved'].includes(item.outcome)
    && item.job?.id === jobId && item.job.validationId === validationJobId && item.job.submittedAt === submittedAt
    && item.job.packageSha256 === packageSha256);
  requireCondition(original && /^[a-f0-9]{64}$/u.test(original.evidenceDigest || ''),
    'SALESFORCE_HOSTED_ORIGINAL_JOB_REQUIRED');
  await provider.verifyIdentity(target);
  const report = await provider.report(target, jobId);
  let quickValidation;
  if (operation === 'deployment' && Number(report.numberTestsTotal) === 0) {
    requireCondition(entries.some(item => item.fingerprint === reviewed.fingerprint && item.stage === target.key
      && item.operation === 'validation' && item.outcome === 'resolved' && item.job?.id === validationJobId
      && /^[a-f0-9]{64}$/u.test(item.evidenceDigest || '')), 'SALESFORCE_HOSTED_ORIGINAL_VALIDATION_REQUIRED');
    quickValidation = { id: validationJobId, report: await provider.report(target, validationJobId) };
  }
  const proof = assertReviewedJobReport(report, { environment: target, jobId,
    ...reviewedJobExpectations(reviewed, target, operation), quickValidation });
  const verifiedAt = now();
  const completed = Date.parse(proof.completedAt);
  requireCondition(completed >= Date.parse(submittedAt) - 30_000 && completed <= verifiedAt.getTime() + 30_000,
    'SALESFORCE_HOSTED_ORIGINAL_JOB_TIMING_INVALID');
  return { fingerprint: reviewed.fingerprint, orgId: target.orgId, jobId, operation,
    sourceTreeHash: reviewed.binding.sourceTreeHash, manifestSha256: reviewed.binding.manifestSha256,
    evidenceSha256: digest({ original, reportSha256: proof.reportSha256 }), verifiedAt: verifiedAt.toISOString() };
}

export async function recoverReviewedDeveeBootstrap({ adoption, manifest, reviewed, provider, github, now = () => new Date() }) {
  if (adoption.jobId === koreaDeskBootstrap.jobId) {
    return recoverKoreaDeskDeveeBootstrap({ adoption, manifest, reviewed, provider, github, now });
  }
  const environment = policy.environments[0];
  const endpoint = '/repos/' + targets().repository + '/deployments/';
  const receipt = await github.read(endpoint + adoption.receiptId);
  const checkpoint = receipt?.payload?.data;
  const reference = checkpoint?.job;
  requireCondition(receipt?.id === adoption.receiptId && receipt.creator?.id === policy.publication.requiredAccountId
    && receipt.creator.login === targets().account && receipt.environment === 'fcos-release-journal-v1'
    && receipt.sha === manifest.candidate.sha && receipt.payload?.kind === 'fcos_rapid_release_event'
    && receipt.payload.event === 'salesforce.checkpoint' && receipt.payload.manifestHash !== digest(manifest)
    && checkpoint?.stage === 'devee' && checkpoint.operation === 'bootstrap' && checkpoint.outcome === 'resolved'
    && checkpoint.result === 'succeeded_no_change' && checkpoint.fingerprint === reviewed.fingerprint
    && /^[a-f0-9]{64}$/u.test(checkpoint.evidenceDigest || '') && Number.isSafeInteger(checkpoint.originalCheckpoint)
    && checkpoint.originalCheckpoint > 0 && reference?.id === adoption.jobId && reference.validationId === null
    && /^[a-f0-9]{64}$/u.test(reference.packageSha256 || '') && Number.isFinite(Date.parse(reference.submittedAt)),
  'SALESFORCE_DEVEE_BOOTSTRAP_RECEIPT_REQUIRED');

  const original = await github.read(endpoint + checkpoint.originalCheckpoint);
  requireCondition(original?.id === checkpoint.originalCheckpoint && original.creator?.id === 41898282
    && original.creator.login === 'github-actions[bot]' && original.environment === receipt.environment
    && original.sha === receipt.sha && original.payload?.kind === receipt.payload.kind
    && original.payload.releaseId === receipt.payload.releaseId && original.payload.manifestHash === receipt.payload.manifestHash
    && original.payload.event === 'salesforce.checkpoint' && original.payload.data?.stage === 'devee'
    && original.payload.data.operation === 'bootstrap' && original.payload.data.outcome === 'pending'
    && original.payload.data.fingerprint === checkpoint.fingerprint
    && digest(original.payload.data.job) === digest(reference), 'SALESFORCE_DEVEE_BOOTSTRAP_ORIGINAL_REQUIRED');

  const prepared = await provider.prepareBootstrap(environment, reviewed);
  try {
    requireCondition(prepared.packageSha256 === reference.packageSha256, 'SALESFORCE_DEVEE_BOOTSTRAP_PACKAGE_CHANGED');
  } finally { await prepared.cleanup(); }
  await provider.verifyIdentity(environment);
  const report = await provider.report(environment, reference.id);
  const proof = assertReviewedJobReport(report, { environment, jobId: reference.id,
    ...reviewedJobExpectations(reviewed, environment, 'bootstrap') });
  const completed = Date.parse(proof.completedAt);
  const successes = [report.details.componentSuccesses].flat();
  requireCondition(completed >= Date.parse(reference.submittedAt) - 30_000 && completed <= now().getTime() + 30_000
    && successes.filter(entry => ['CustomObject', 'CustomField', 'PermissionSet'].includes(entry.componentType))
      .every(entry => entry.changed === false && entry.created !== true && entry.deleted !== true), 'SALESFORCE_DEVEE_BOOTSTRAP_NO_CHANGE_REQUIRED');
  const inventory = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
    expected: reviewed.nativeInventories.devee.bootstrap, now });
  const verifiedAt = now().toISOString();
  return { ...proof, fingerprint: reviewed.fingerprint, validationJobId: null, submittedAt: reference.submittedAt,
    packageSha256: reference.packageSha256, verifiedAt, reconciledAt: verifiedAt,
    recoveredEvidenceDigest: digest({ receiptId: receipt.id, originalCheckpoint: original.id,
      providerReportSha256: proof.reportSha256, inventoryReceiptSha256: inventory.evidenceSha256 }) };
}

export const koreaDeskBootstrap = Object.freeze({
  runId: 45382062369,
  goLiveJobId: 138407997755,
  handoverId: 8026059961,
  dispatcher: '811757591628135762acda6d4eabdfbfb9158d1f',
  controller: 'e34a75eb2b1052bc547a50d6e429a4006b4b7f6f',
  candidate: '86d106b199a1608050ecdac54dbe2a5c92387175',
  releaseId: 'korea-desk-salesforce-86d106b1',
  manifestHash: '9aa4fa4c91e837f11214ced411504812cc316268e7cf960df07f12299ff766b0',
  fingerprint: '9d704c3b5e525c6492a00a3ca94f4dca1bc82fd463a83b8dcfeb119fd8cdaa7a',
  sourceTreeHash: 'a7d1c63e431ad8cc1193fe65fabdb471e23138cb9f63654fe4c70c680ed00a0b',
  jobId: '0AfHF000007K4t60AC',
  packageSha256: '51bc3f22200c04eeca1b4f339deb4cc4b82168b2d17b57f05922825308b09857',
  ownerClosureReportSha256: 'cece340bbe76e97cc61e4bb500a65b7754c627a7f8d786477ebdd90006c8761d',
  nativeReportFactsSha256: 'd4be4deed1708c882863dcd5737e2aaaf6f13398e47c74a4776f859c92100d70',
  submittedAt: '2026-11-24T11:46:35.845Z',
  oldHead: '09765faaeb3d8f19415586e59ca64778ab8f7a180998fd505c7991390db6d071',
  intentId: 8026784662,
  checkpointId: 8026867565,
  repositoryId: 1278654816,
  ownerId: policy.publication.requiredAccountId,
  botId: 41898282,
});
const koreaDeskWorkflow = '.github/workflows/fcos-rapid-release.yml';
const koreaDeskHistory = [
  [8026155424, 'release.prepared'], [8026155772, 'build.passed'], [8026160779, 'stage.intent'],
  [8026163303, 'stage.result'], [8026302611, 'smoke.passed'], [8026780353, 'approval.accepted'],
  [8026784662, 'prerequisites.intent'], ...[8026802882, 8026816095, 8026831250, 8026864332, 8026865290, 8026867565,
    8026875902].map(id => [id, 'salesforce.checkpoint']), [8026876181, 'obstacle.detected'],
];

export async function readKoreaDeskBootstrapHistory(github) {
  const original = koreaDeskBootstrap;
  const repo = '/repos/' + targets().repository;
  const runPath = repo + '/actions/runs/' + original.runId;
  const [run, jobs, approvals, records, mirror] = await Promise.all([
    github.read(runPath),
    github.read(runPath + '/jobs?filter=all&per_page=100'),
    github.read(runPath + '/approvals'),
    github.pages(repo + '/deployments?environment=fcos-release-journal-v1&sha=' + original.candidate + '&per_page=100'),
    github.pages(repo + '/deployments?environment=fcos-release-mirror-handoff-v1&sha=' + original.candidate + '&per_page=100'),
    assertFrozenWorkflow({ github, controllerSha: original.controller, dispatcherSha: original.dispatcher }),
  ]);
  const owner = person => person?.id === original.ownerId && person.login === targets().account;
  requireCondition(run.id === original.runId && run.status === 'completed' && run.conclusion === 'failure'
    && run.run_attempt === 1 && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.head_sha === original.dispatcher && nativeWorkflowPath(run) === koreaDeskWorkflow
    && run.repository?.id === original.repositoryId && owner(run.actor) && owner(run.triggering_actor)
    && run.display_title === `FCOS rapid resume ${original.manifestHash} ${original.candidate}`,
  'KOREA_DESK_ORIGINAL_RUN_CHANGED');
  const goLive = jobs.jobs?.filter(job => job.name === 'go-live');
  requireCondition(goLive?.length === 1 && goLive[0].id === original.goLiveJobId && goLive[0].run_id === run.id
    && goLive[0].run_attempt === 1 && goLive[0].status === 'completed' && goLive[0].conclusion === 'failure'
    && Date.parse(goLive[0].started_at) < Date.parse(original.submittedAt)
    && Date.parse(original.submittedAt) < Date.parse(goLive[0].completed_at)
    && approvals.filter(review => review.state === 'approved' && owner(review.user)
      && review.environments?.some(environment => environment.name === 'fcos-production-release'
        && environment.id === 23178773471)).length === 1,
  'KOREA_DESK_ORIGINAL_APPROVAL_CHANGED');
  requireCondition(!mirror.some(row => row.payload?.runId === original.runId || row.payload?.manifestHash === original.manifestHash),
    'KOREA_DESK_ORIGINAL_MIRROR_HISTORY_CHANGED');
  const recordsForRelease = records.filter(row => row.payload?.releaseId === original.releaseId);
  const chain = validateChain(recordsForRelease, original.manifestHash, original.releaseId);
  requireCondition(chain.length === recordsForRelease.length
    && [koreaDeskHistory.length, koreaDeskHistory.length + 1].includes(chain.length)
    && koreaDeskHistory.every(([id, event], index) => {
      const row = chain[index];
      return row.id === id && row.payload.event === event && row.sha === original.candidate
        && row.environment === 'fcos-release-journal-v1' && row.creator?.id === original.botId
        && row.creator.login === 'github-actions[bot]';
    }) && chain[14].payload.recordHash === original.oldHead, 'KOREA_DESK_ORIGINAL_HISTORY_CHANGED');
  const manifest = chain[0].payload.data.manifest;
  const approval = chain[5].payload.data;
  const intent = chain[6].payload.data;
  const job = chain[12].payload.data.job;
  requireCondition(validateManifest(manifest) === original.manifestHash && manifest.controllerSha === original.controller
    && manifest.candidate.sha === original.candidate
    && manifest.prerequisites.plan.salesforceFingerprint === original.fingerprint
    && manifest.prerequisites.plan.salesforceSourceTreeHash === original.sourceTreeHash
    && approval.runId === run.id && intent.operationId === original.releaseId + '-prerequisites'
    && chain[12].payload.data.stage === 'devee' && chain[12].payload.data.operation === 'bootstrap'
    && chain[12].payload.data.outcome === 'resolved' && chain[12].payload.data.fingerprint === original.fingerprint
    && digest(chain[11].payload.data.job) === digest(job) && job.id === original.jobId && job.validationId === null
    && job.packageSha256 === original.packageSha256 && job.submittedAt === original.submittedAt,
  'KOREA_DESK_ORIGINAL_BOOTSTRAP_CHANGED');
  assertAuthorization(approval, manifest, chain[3].payload.data.result, Date.parse(goLive[0].started_at));
  const receipt = chain[koreaDeskHistory.length];
  const pending = pendingOperations(chain);
  if (receipt) {
    const data = receipt.payload.data;
    requireCondition(owner(receipt.creator) && receipt.sha === original.candidate
      && receipt.environment === 'fcos-release-journal-v1' && receipt.payload.event === 'prerequisites.result'
      && digest(data) === digest(koreaDeskBootstrapClosure(data.evidence)) && pending.length === 0,
    'KOREA_DESK_BOOTSTRAP_CLOSURE_INVALID');
  } else {
    requireCondition(pending.length === 1 && pending[0].event === 'prerequisites.intent'
      && digest(pending[0].data) === digest(intent), 'KOREA_DESK_ORIGINAL_PENDING_SCOPE_CHANGED');
  }
  return { manifest, receipt, job, completedAt: goLive[0].completed_at };
}

export function koreaDeskBootstrapClosure(evidence) {
  const original = koreaDeskBootstrap;
  requireCondition(evidence && Object.keys(evidence).length === 7
    && ['alias', 'deveeInventory', 'deveeReport', 'deveeObservedInventory', 'qatInventory', 'productionInventory']
      .every(key => isDigest(evidence[key])) && Number.isFinite(Date.parse(evidence.observedAt)),
  'KOREA_DESK_BOOTSTRAP_CLOSURE_EVIDENCE_INVALID');
  return { operationId: original.releaseId + '-prerequisites', outcome: 'devee_bootstrap_verified_before_promotion',
    originalRunId: original.runId, originalGoLiveJobId: original.goLiveJobId, originalIntentId: original.intentId,
    originalBootstrapCheckpoint: original.checkpointId, originalSalesforceJobId: original.jobId,
    salesforceFingerprint: original.fingerprint, salesforceSourceTreeHash: original.sourceTreeHash,
    packageSha256: original.packageSha256, evidence, evidenceDigest: digest(evidence) };
}

export async function verifyKoreaDeskDeveeBootstrap({ history, reviewed, provider, now = () => new Date() }) {
  const original = koreaDeskBootstrap;
  const environment = policy.environments.find(item => item.key === 'devee');
  const reference = history.job;
  requireCondition(reviewed.fingerprint === original.fingerprint && reviewed.binding.sourceTreeHash === original.sourceTreeHash
    && reference.id === original.jobId && reference.packageSha256 === original.packageSha256
    && reference.validationId === null && reference.submittedAt === original.submittedAt,
  'KOREA_DESK_BOOTSTRAP_REVIEW_CHANGED');
  await provider.verifyIdentity(environment);
  const prepared = await provider.prepareBootstrap(environment, reviewed);
  try {
    requireCondition(prepared.packageSha256 === reference.packageSha256, 'KOREA_DESK_BOOTSTRAP_PACKAGE_CHANGED');
  } finally { await prepared.cleanup(); }
  const report = await provider.report(environment, reference.id);
  const proof = assertReviewedJobReport(report, { environment, jobId: reference.id,
    ...reviewedJobExpectations(reviewed, environment, 'bootstrap') });
  const expectedEffects = new Map([
    ['CustomField:STEM__c.Korea_Desk_Member__c', true], ['CustomField:STEM__c.Korea_Desk__c', true],
    ['CustomObject:STEM__c', false],
    ['PermissionSet:FCOS_Korea_Desk_Editor', true], ['PermissionSet:FCOS_Korea_Desk_Reader', true],
  ]);
  const successes = [report.details.componentSuccesses].flat();
  const descriptors = successes.filter(entry => entry.componentType === '' && entry.fullName === 'package.xml'
    && entry.success === true && ['package.xml', 'zip/package.xml'].includes(entry.fileName));
  const components = successes.filter(entry => !descriptors.includes(entry));
  const ids = components.map(entry => `${entry.componentType}:${entry.fullName}`);
  const completed = Date.parse(proof.completedAt);
  requireCondition(completed >= Date.parse(reference.submittedAt) - 30_000 && completed <= Date.parse(history.completedAt)
    && completed <= now().getTime() && report.checkOnly === false && report.rollbackOnError === true
    && descriptors.length === 1 && components.length === expectedEffects.size && new Set(ids).size === expectedEffects.size
    && components.every((entry, index) => expectedEffects.has(ids[index])
      && entry.created === expectedEffects.get(ids[index]) && entry.changed === true && entry.deleted === false && entry.success === true),
  'KOREA_DESK_BOOTSTRAP_EFFECT_CHANGED');
  const inventory = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
    expected: reviewed.nativeInventories.devee.bootstrap, now });
  requireCondition(isDigest(inventory.observedNativeInventoryHash), 'KOREA_DESK_BOOTSTRAP_INVENTORY_REQUIRED');
  // The pinned CLI adds a top-level files array populated from absolute local
  // source paths. Keep its full output digest alongside the native job facts.
  const nativeReport = { ...report };
  delete nativeReport.files;
  return { proof, inventory, reportFactsSha256: digest(nativeReport) };
}

async function recoverKoreaDeskDeveeBootstrap({ adoption, manifest, reviewed, provider, github, now }) {
  const history = await readKoreaDeskBootstrapHistory(github);
  const { manifest: prior, receipt } = history;
  const { deveeBootstrapAdoption: locator, ...plan } = manifest.prerequisites.plan;
  const evidence = receipt?.payload.data.evidence;
  requireCondition(receipt?.id === adoption.receiptId && digest(locator) === digest(adoption)
    && manifest.releaseId !== prior.releaseId && manifest.controllerSha !== prior.controllerSha
    && digest(manifest.candidate) === digest(prior.candidate) && digest(manifest.previous) === digest(prior.previous)
    && digest(manifest.selection) === digest(prior.selection) && digest(manifest.paths) === digest(prior.paths)
    && digest(manifest.build.publicEnvironment) === digest(prior.build.publicEnvironment)
    && manifest.prerequisites.adapter === prior.prerequisites.adapter
    && digest(plan) === digest(prior.prerequisites.plan)
    && evidence.alias === digest(prior.previous),
  'KOREA_DESK_BOOTSTRAP_SUCCESSOR_SCOPE_CHANGED');
  requireCondition(evidence.deveeReport === koreaDeskBootstrap.ownerClosureReportSha256,
    'KOREA_DESK_BOOTSTRAP_CLOSURE_REPORT_CHANGED');
  const { proof, inventory, reportFactsSha256 } = await verifyKoreaDeskDeveeBootstrap({ history, reviewed, provider, now });
  requireCondition(reportFactsSha256 === koreaDeskBootstrap.nativeReportFactsSha256,
    'KOREA_DESK_BOOTSTRAP_NATIVE_REPORT_CHANGED');
  requireCondition(inventory.observedNativeInventoryHash === evidence.deveeObservedInventory,
    'KOREA_DESK_BOOTSTRAP_RECEIPT_POSTIMAGE_CHANGED');
  const verifiedAt = now().toISOString();
  return { ...proof, fingerprint: reviewed.fingerprint, validationJobId: null, submittedAt: history.job.submittedAt,
    packageSha256: history.job.packageSha256, verifiedAt, reconciledAt: verifiedAt, reportFactsSha256,
    recoveredEvidenceDigest: digest({ receiptId: receipt.id, originalCheckpoint: koreaDeskBootstrap.checkpointId,
      ownerClosureReportSha256: evidence.deveeReport, providerReportSha256: proof.reportSha256, reportFactsSha256,
      inventoryReceiptSha256: inventory.evidenceSha256 }) };
}

export async function recoverReviewedDeveePromotion({ receiptId, manifest, reviewed, provider, github, now = () => new Date() }) {
  const endpoint = '/repos/' + targets().repository + '/deployments/';
  const receipt = await github.read(endpoint + receiptId);
  const result = receipt?.payload?.data;
  const references = result?.deveeCheckpoints;
  const includeBootstrap = Boolean(reviewed.review.bootstrap);
  requireCondition(receipt?.id === receiptId && receipt.creator?.id === policy.publication.requiredAccountId
    && receipt.creator.login === targets().account && receipt.environment === 'fcos-release-journal-v1'
    && receipt.sha === manifest.candidate.sha && receipt.payload?.kind === 'fcos_rapid_release_event'
    && receipt.payload.event === 'prerequisites.result' && isDigest(receipt.payload.manifestHash)
    && receipt.payload.manifestHash !== digest(manifest) && result?.outcome === 'devee_verified_mirror_not_published'
    && result.salesforceFingerprint === reviewed.fingerprint && isDigest(result.evidenceDigest)
    && (includeBootstrap || reviewed.invoiceAppPlacement)
    && Array.isArray(references) && references.length === (includeBootstrap ? 3 : 2)
    && new Set(references).size === references.length && references.every(id => Number.isSafeInteger(id) && id > 0),
  'SALESFORCE_DEVEE_PROMOTION_RECEIPT_REQUIRED');
  const originals = await Promise.all(references.map(id => github.read(endpoint + id)));
  return verifySandboxPromotionJobs({ receipt, references, originals, reviewed, provider, now, includeBootstrap });
}

async function verifySandboxPromotionJobs({ receipt, references, originals, reviewed, provider, now,
  environment = policy.environments[0], includeBootstrap = true }) {
  const operations = includeBootstrap ? ['bootstrap', 'validation', 'deployment'] : ['validation', 'deployment'];
  const jobs = originals.map((original, index) => {
    const checkpoint = original?.payload?.data;
    const operation = operations[index];
    const job = checkpoint?.job;
    requireCondition(original?.id === references[index] && original.creator?.id === 41898282
      && original.creator.login === 'github-actions[bot]' && original.environment === receipt.environment
      && original.sha === receipt.sha && original.payload?.kind === receipt.payload.kind
      && original.payload.releaseId === receipt.payload.releaseId && original.payload.manifestHash === receipt.payload.manifestHash
      && original.payload.event === 'salesforce.checkpoint' && checkpoint?.stage === environment.key
      && checkpoint.operation === operation && checkpoint.outcome === 'resolved'
      && checkpoint.fingerprint === reviewed.fingerprint && isDigest(checkpoint.evidenceDigest)
      && /^0Af[A-Za-z0-9]{15}$/u.test(job?.id || '') && Number.isFinite(Date.parse(job.submittedAt))
      && (operation === 'deployment' ? job.packageSha256 === undefined : job.validationId === null && isDigest(job.packageSha256)),
    'SALESFORCE_DEVEE_PROMOTION_CHECKPOINT_REQUIRED');
    return job;
  });
  const validation = jobs.at(-2);
  requireCondition(new Set(jobs.map(job => job.id)).size === jobs.length && jobs.at(-1).validationId === validation.id
    && jobs.every((job, index) => index === 0 || Date.parse(job.submittedAt) >= Date.parse(jobs[index - 1].submittedAt)),
  'SALESFORCE_DEVEE_PROMOTION_JOB_ORDER_REQUIRED');
  const conversions = includeBootstrap ? [provider.prepareBootstrap, provider.prepareValidation] : [provider.prepareValidation];
  for (const [index, prepare] of conversions.entries()) {
    const prepared = await prepare(environment, reviewed);
    try {
      requireCondition(prepared.packageSha256 === jobs[index].packageSha256, 'SALESFORCE_DEVEE_PROMOTION_PACKAGE_CHANGED');
    } finally { await prepared.cleanup(); }
  }

  await provider.verifyIdentity(environment);
  const reports = await Promise.all(jobs.map(job => provider.report(environment, job.id)));
  const inventory = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
    expected: reviewed.nativeInventories[environment.key].final, now });
  const placement = includeBootstrap ? undefined : await provider.verifyInvoiceAppPlacement?.(environment, reviewed, 'after');
  requireCondition(includeBootstrap || (placement?.orgId === environment.orgId && placement.phase === 'after'
    && isDigest(placement.evidenceSha256)), 'SALESFORCE_DEVEE_PROMOTION_APP_PLACEMENT_REQUIRED');
  return jobs.map((job, index) => {
    const operation = operations[index];
    const proof = assertReviewedJobReport(reports[index], { environment, jobId: job.id,
      ...reviewedJobExpectations(reviewed, environment, operation),
      ...(operation === 'deployment' ? { quickValidation: { id: validation.id, report: reports.at(-2) } } : {}) });
    const completed = Date.parse(proof.completedAt);
    const verifiedAt = now();
    requireCondition(completed >= Date.parse(job.submittedAt) - 30_000 && completed <= verifiedAt.getTime() + 30_000,
      'SALESFORCE_DEVEE_PROMOTION_JOB_TIMING_INVALID');
    return { operation, record: { ...proof, fingerprint: reviewed.fingerprint, validationJobId: job.validationId,
      submittedAt: job.submittedAt, verifiedAt: verifiedAt.toISOString(), reconciledAt: verifiedAt.toISOString(),
      ...(job.packageSha256 ? { packageSha256: job.packageSha256 } : {}),
      recoveredEvidenceDigest: digest({ receiptId: receipt.id, originalCheckpoint: references[index],
        providerReportSha256: proof.reportSha256, inventoryReceiptSha256: inventory.evidenceSha256,
        ...(placement ? { appPlacementSha256: placement.evidenceSha256 } : {}) }) } };
  });
}

export async function recoverTradingFxDeveePromotion({ recovery, reviewed, provider, now = () => new Date() }) {
  const { receipt, jobs: originals, permissions } = recovery;
  const { deveeCheckpoints: references, deveePermissionCheckpoints } = receipt.payload.data;
  const environment = policy.environments[0];
  const names = [...new Set([...reviewed.binding.permissionSets, ...(reviewed.review.bootstrap.permissionSets ?? [])])].sort();
  requireCondition(permissions.length === names.length && deveePermissionCheckpoints.length === names.length,
    'SALESFORCE_DEVEE_RECOVERY_PERMISSIONS_REQUIRED');
  const recovered = permissions.map((original, index) => {
    const checkpoint = original.payload.data;
    const { permission } = checkpoint;
    const operation = `permission:${names[index]}`;
    requireCondition(original.id === deveePermissionCheckpoints[index] && checkpoint.operation === operation
      && permission?.name === names[index] && permission.orgId === environment.orgId
      && typeof permission.prestate === 'boolean' && isDigest(checkpoint.evidenceDigest),
    'SALESFORCE_DEVEE_RECOVERY_PERMISSION_CHANGED');
    return { operation, record: { ...permission, status: 'Succeeded', addedByRelease: !permission.prestate,
      recoveredEvidenceDigest: checkpoint.evidenceDigest } };
  });
  const jobRecords = await verifySandboxPromotionJobs({ receipt, references, originals, reviewed, provider, now });
  await Promise.all(recovered.map(async ({ record }) => {
    requireCondition(await provider.permissionAssigned(environment, record.name) === true, 'SALESFORCE_DEVEE_RECOVERY_PERMISSION_DRIFT');
    record.verifiedAt = now().toISOString();
  }));
  return [...jobRecords, ...recovered];
}

function hostedReviewedPlan(cwd, plan) {
  const project = JSON.parse(readFileSync(safeProjectFile(cwd, 'sfdx-project.json'), 'utf8'));
  requireCondition(project.namespace === '' && project.packageDirectories?.length === 1
    && project.packageDirectories[0].path === 'force-app' && project.packageDirectories[0].default === true,
  'SALESFORCE_HOSTED_PROJECT_SCOPE_INVALID');
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  requireCondition(reviewed.fingerprint === plan.salesforceFingerprint
    && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash, 'SALESFORCE_HOSTED_PLAN_MISMATCH');
  const inputs = [reviewed.reviewAbsolute, reviewed.manifestAbsolute, reviewed.baselineWorkflowAbsolute, reviewed.bootstrapAbsolute]
    .filter(Boolean).map(file => relative(cwd, file));
  git(cwd, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', 'sfdx-project.json', ...inputs]);
  return reviewed;
}

function reviewedBootstrapFingerprint(reviewed, plan) {
  requireCondition(reviewed.review.bootstrap && /^[a-f0-9]{64}$/u.test(reviewed.binding.bootstrapSha256 || ''),
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
  const fingerprint = digest({ salesforceFingerprint: reviewed.fingerprint, bootstrapSha256: reviewed.binding.bootstrapSha256 });
  requireCondition(fingerprint === plan.bootstrapFingerprint, 'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_MISMATCH');
  return fingerprint;
}

export async function verifyPreBootstrapStage({ manifest, staged, plan, salesforceCandidateDirectory: cwd, env }, { withDatabase = false } = {}) {
  const databaseSelected = withDatabase ? manifest.selection.database === true : !manifest.selection.database;
  requireCondition(manifest.selection.salesforce && databaseSelected && cwd && plan.backwardCompatible === true
    && plan.deferSchemaDependentSmoke === true,
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
  requireCondition(plan.mirrorPublication === undefined || usesLocalCollaboratorMirror(manifest), 'SALESFORCE_MIRROR_MODE_INVALID');
  const reviewed = hostedReviewedPlan(cwd, plan);
  assertSalesforceProductionSettingCompatibility(cwd, reviewed, policy);
  return runPreBootstrapSmoke({ manifest, staged, env }, reviewedBootstrapFingerprint(reviewed, plan));
}

export async function applyReviewedPrerequisites(input) {
  return prepareReviewedSalesforcePrerequisites(input)();
}

export function prepareReviewedSalesforcePrerequisites({
  manifest, approval, plan, salesforce, salesforceCandidateDirectory: cwd, correctionDirectory, editorPreflight, env = process.env,
}, { withDatabase = false, tradingFxRecovery, tradingFxQatRecovery, tradingFxPostQatRecovery, tradingFxProductionBootstrapRecovery } = {}) {
  const manifestHash = digest(manifest);
  const databaseSelected = withDatabase ? manifest.selection.database === true : !manifest.selection.database;
  requireCondition(manifest.selection.salesforce && databaseSelected && plan.backwardCompatible === true
    && cwd && typeof salesforce?.journal?.readCheckpoints === 'function'
    && typeof salesforce?.ownership?.assert === 'function' && approval?.manifestHash === manifestHash
    && approval.nativeReviewVerified === true && approval.reviewer === targets().account,
  'SALESFORCE_HOSTED_REVIEW_REQUIRED');
  const reviewed = hostedReviewedPlan(cwd, plan);
  assertSalesforceProductionSettingCompatibility(cwd, reviewed, policy);
  const schemaBootstrap = Boolean(reviewed.review.bootstrap);
  if (schemaBootstrap || plan.deferSchemaDependentSmoke) {
    // Salesforce-only schema can qualify the full application before approval
    // when the staged application does not read the new metadata.
    requireCondition(plan.deferSchemaDependentSmoke === true
      || (!withDatabase && plan.deferSchemaDependentSmoke === false && plan.deferredModules === undefined),
    'SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED');
    reviewedBootstrapFingerprint(reviewed, plan);
  }

  assertHostedSalesforceRunner(env);
  const localMirror = plan.mirrorPublication === 'local-collaborator';
  requireCondition(plan.mirrorPublication === undefined || (localMirror && usesLocalCollaboratorMirror(manifest)), 'SALESFORCE_MIRROR_MODE_INVALID');
  const desktopCaseSet = reviewed.review.nativeDeveeDesktop?.caseSetDigest;
  requireCondition(plan.deveeDesktopCaseSetDigest === desktopCaseSet && (desktopCaseSet === undefined
    || (!withDatabase && !schemaBootstrap && localMirror && manifest.prerequisites.adapter === 'salesforce-reviewed-manifest')),
  'DEVEE_DESKTOP_HOSTED_SCOPE_INVALID');
  requireCondition(hasEditorPreflightLocator(plan) === Boolean(editorPreflight)
    && (!editorPreflight || desktopCaseSet !== undefined && editorPreflight.proofId === plan.editorPreflightReceiptId
      && editorPreflight.proofDigest === plan.editorPreflightReceiptDigest), 'EDITOR_PREFLIGHT_ATTESTATION_REQUIRED');
  const adoption = plan.deveeBootstrapAdoption;
  requireCondition(adoption === undefined || (!withDatabase && schemaBootstrap && reviewed.nativeInventories?.devee?.bootstrap
    && adoption && Object.keys(adoption).length === 2 && Number.isSafeInteger(adoption.receiptId) && adoption.receiptId > 0
    && /^0Af[A-Za-z0-9]{15}$/u.test(adoption.jobId || '')), 'SALESFORCE_DEVEE_BOOTSTRAP_ADOPTION_INVALID');
  const promotionReceiptId = plan.deveePromotionAdoptionReceiptId;
  requireCondition(promotionReceiptId === undefined || (adoption === undefined && !withDatabase
    && (schemaBootstrap || reviewed.invoiceAppPlacement) && localMirror
    && reviewed.nativeInventories?.devee?.final && Number.isSafeInteger(promotionReceiptId) && promotionReceiptId > 0),
  'SALESFORCE_DEVEE_PROMOTION_ADOPTION_INVALID');
  const editorsAdoption = plan.editorsProductionValidationAdoptionReceiptId;
  requireCondition(editorsAdoption === undefined || (!withDatabase && !schemaBootstrap && localMirror && editorPreflight
    && desktopCaseSet !== undefined && adoption === undefined && promotionReceiptId === undefined
    && Number.isSafeInteger(editorsAdoption) && editorsAdoption > 0), 'EDITORS_PRODUCTION_VALIDATION_ADOPTION_INVALID');
  requireCondition(tradingFxRecovery === undefined ? plan.tradingFxRecoveryReceiptId === undefined
    : withDatabase && schemaBootstrap && localMirror && reviewed.nativeInventories?.devee?.final
      && adoption === undefined && promotionReceiptId === undefined
      && tradingFxRecovery.receipt?.id === plan.tradingFxRecoveryReceiptId,
  'SALESFORCE_TRADING_FX_DEVEE_ADOPTION_INVALID');
  requireCondition(tradingFxQatRecovery === undefined ? plan.tradingFxQatRecoveryReceiptId === undefined
    : withDatabase && schemaBootstrap && localMirror && !tradingFxRecovery && adoption === undefined
      && promotionReceiptId === undefined && tradingFxQatRecovery.receipt?.id === plan.tradingFxQatRecoveryReceiptId,
  'SALESFORCE_TRADING_FX_QAT_ADOPTION_INVALID');
  requireCondition(tradingFxPostQatRecovery === undefined ? plan.tradingFxPostQatRecoveryReceiptId === undefined
    : withDatabase && schemaBootstrap && localMirror && !tradingFxRecovery && !tradingFxQatRecovery
      && adoption === undefined && promotionReceiptId === undefined && tradingFxPostQatRecovery.receipt?.id === plan.tradingFxPostQatRecoveryReceiptId,
  'SALESFORCE_TRADING_FX_POST_QAT_ADOPTION_INVALID');
  requireCondition(tradingFxProductionBootstrapRecovery === undefined
    ? plan.tradingFxProductionBootstrapRecoveryReceiptId === undefined
    : withDatabase && schemaBootstrap && localMirror && !tradingFxRecovery && !tradingFxQatRecovery && !tradingFxPostQatRecovery
      && !adoption && !promotionReceiptId
      && correctionDirectory && salesforce.correction && reviewed.nativeInventories?.production?.bootstrap
      && tradingFxProductionBootstrapRecovery.receipt?.id === plan.tradingFxProductionBootstrapRecoveryReceiptId,
  'SALESFORCE_TRADING_FX_PRODUCTION_BOOTSTRAP_ADOPTION_INVALID');
  return () => applyPreparedSalesforce({ manifest, manifestHash, approval, salesforce, cwd, correctionDirectory, env, reviewed, schemaBootstrap,
    localMirror, adoption, promotionReceiptId, tradingFxRecovery, tradingFxQatRecovery, tradingFxPostQatRecovery,
    tradingFxProductionBootstrapRecovery, editorPreflight, editorsAdoption });
}

export async function hostedLocalMirrorTransport({ manifest, approval, env, reviewed, salesforce }) {
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true });
  const { user, repo } = await github.identity();
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  requireCondition(user.login === 'github-actions[bot]' && repo.owner?.id === policy.publication.requiredAccountId
    && Number(env.GITHUB_RUN_ID) === approval.runId && Number.isSafeInteger(runAttempt) && runAttempt > 0,
  'LOCAL_MIRROR_WORKFLOW_IDENTITY_REQUIRED');
  let sequence = 0;
  let verifiedCommit;
  return async (mode, deployment, intent) => {
    const receipt = await salesforce.ownership.assert({
      fingerprint: reviewed.fingerprint, stage: 'devee', orgId: deployment.orgId, operation: 'shared-publication',
    });
    if (mode === 'publish') {
      requireCondition(intent?.status === 'submitting' && intent.receiptId === receipt.receiptId,
        'LOCAL_MIRROR_PUBLICATION_INTENT_REQUIRED');
    }
    const checkpoint = (await salesforce.journal.readCheckpoints())
      .find(item => item.stage === 'shared_mirror' && item.operation === 'publication');
    requireCondition(checkpoint?.outcome === (mode === 'check' ? 'resolved' : 'pending')
      && (mode !== 'publish' || checkpoint.evidenceDigest === digest(intent)), 'LOCAL_MIRROR_PUBLICATION_CHECKPOINT_REQUIRED');
    const expiresAt = mode === 'publish' ? intent.receiptExpiresAt : receipt.expiresAt;
    const request = createLocalMirrorRequest({
      manifest, approval, reviewed, deployment, runAttempt, intentHash: checkpoint.evidenceDigest,
      expiresAt, mode, sequence: ++sequence,
    });
    const proof = await awaitLocalMirrorReceipt({
      github, request, reviewed, workflowActorId: user.id, publisherId: policy.publication.requiredAccountId,
    });
    requireCondition((!verifiedCommit || verifiedCommit === proof.commit)
      && (mode !== 'check' || (checkpoint.mirror?.commit === proof.commit && checkpoint.mirror?.pullRequest === proof.pullRequest.number)),
    'LOCAL_MIRROR_HEAD_CHANGED');
    verifiedCommit = proof.commit;
    await salesforce.ownership.assert({
      fingerprint: reviewed.fingerprint, stage: 'devee', orgId: deployment.orgId, operation: 'shared-publication',
    });
    return proof;
  };
}

export async function recoverTradingFxSandboxBootstraps({ recovery, reviewed, priorReviewed, provider, priorProvider,
  saved = [], now = () => new Date() }) {
  requireCondition(priorReviewed.fingerprint === recovery.prior.prerequisites.plan.salesforceFingerprint
    && reviewed.binding.bootstrapSha256 === priorReviewed.binding.bootstrapSha256
    && reviewed.binding.manifestSha256 === priorReviewed.binding.manifestSha256
    && digest(reviewed.nativeInventories) === digest(priorReviewed.nativeInventories),
  'SALESFORCE_TRADING_FX_QAT_REVIEW_CHANGED');
  const { sourceTreeHash: priorTree, ...priorReview } = priorReviewed.review;
  const { sourceTreeHash: nextTree, ...nextReview } = reviewed.review;
  requireCondition(priorTree !== nextTree && digest(priorReview) === digest(nextReview),
    'SALESFORCE_TRADING_FX_QAT_REVIEW_CHANGED');

  if (!saved.some(item => item.stage === 'qat' && item.operation === 'bootstrap')) {
    const qat = policy.environments.find(item => item.key === 'qat');
    const failed = recovery.failedQatValidation.payload.data.job;
    await provider.verifyIdentity(qat);
    const report = await provider.report(qat, failed.id);
    requireCondition(report.id === failed.id && report.done === true && report.status === 'Failed'
      && report.checkOnly === true && report.rollbackOnError === true
      && Date.parse(report.completedDate) >= Date.parse(failed.submittedAt),
    'SALESFORCE_TRADING_FX_QAT_FAILED_VALIDATION_REQUIRED');
  }
  const records = [];
  for (const { payload: { data } } of recovery.bootstrap) {
    const environment = policy.environments.find(item => item.key === data.stage);
    const existing = saved.find(item => item.stage === data.stage && item.operation === 'bootstrap');
    if (existing) {
      requireCondition(existing.outcome === 'resolved' && digest(existing.job) === digest(data.job),
        'SALESFORCE_TRADING_FX_QAT_ADOPTION_CHANGED');
      continue;
    }
    requireCondition(environment?.isSandbox === true && data.job.validationId === null,
      'SALESFORCE_TRADING_FX_QAT_BOOTSTRAP_SCOPE_INVALID');
    await provider.verifyIdentity(environment);
    const prepared = await provider.prepareBootstrap(environment, reviewed);
    try {
      requireCondition(prepared.packageSha256 === data.job.packageSha256, 'SALESFORCE_TRADING_FX_QAT_BOOTSTRAP_PACKAGE_CHANGED');
    } finally { await prepared.cleanup(); }
    const report = await provider.report(environment, data.job.id);
    const proof = assertReviewedJobReport(report, { environment, jobId: data.job.id,
      ...reviewedJobExpectations(reviewed, environment, 'bootstrap') });
    const completed = Date.parse(proof.completedAt);
    requireCondition(completed >= Date.parse(data.job.submittedAt) - 30_000 && completed <= now().getTime() + 30_000,
      'SALESFORCE_HOSTED_ORIGINAL_JOB_TIMING_INVALID');
    const inventory = await verifyReviewedOrgInventory({ provider: priorProvider, environment, plan: priorReviewed,
      expected: priorReviewed.nativeInventories[environment.key][environment.key === 'devee' ? 'final' : 'bootstrap'], now });
    records.push({ stage: environment.key, operation: 'bootstrap', record: { ...proof, fingerprint: reviewed.fingerprint,
      validationJobId: null, submittedAt: data.job.submittedAt, packageSha256: data.job.packageSha256,
      verifiedAt: inventory.verifiedAt, recoveredEvidenceDigest: digest({ receiptId: recovery.receipt.id, checkpoint: data.evidenceDigest,
        report: proof.reportSha256, inventory: inventory.evidenceSha256 }) } });
  }
  for (const { payload: { data } } of recovery.permissions) {
    const environment = policy.environments.find(item => item.key === data.stage);
    const { name, orgId, prestate } = data.permission;
    requireCondition(environment?.isSandbox && environment.orgId === orgId && reviewed.binding.permissionSets.includes(name)
      && data.operation === 'permission:' + name && typeof prestate === 'boolean', 'SALESFORCE_TRADING_FX_QAT_PERMISSION_SCOPE_INVALID');
    requireCondition(await provider.permissionAssigned(environment, name) === true, 'SALESFORCE_TRADING_FX_QAT_PERMISSION_DRIFT');
    const existing = saved.find(item => item.stage === data.stage && item.operation === data.operation);
    if (existing) {
      requireCondition(existing.outcome === 'resolved' && digest(existing.permission) === digest(data.permission),
        'SALESFORCE_TRADING_FX_QAT_ADOPTION_CHANGED');
      continue;
    }
    records.push({ stage: environment.key, operation: data.operation, record: { status: 'Succeeded', name, orgId, prestate,
      addedByRelease: !prestate, recoveredEvidenceDigest: data.evidenceDigest, verifiedAt: now().toISOString() } });
  }
  return records;
}

export async function recoverTradingFxPostQat({ recovery, reviewed, provider, saved, now = () => new Date() }) {
  const records = [];
  for (const environment of policy.environments.filter(item => item.isSandbox)) {
    const stage = environment.key;
    const originals = recovery.jobs.filter(row => row.payload.data.stage === stage);
    requireCondition(originals.length === 3, 'SALESFORCE_POST_QAT_JOB_SCOPE_INVALID');
    const adopted = await verifySandboxPromotionJobs({ receipt: recovery.receipt, references: originals.map(row => row.id),
      originals, reviewed, provider, now, environment });
    records.push(...adopted.map(entry => ({ stage, ...entry })));
    for (const { payload: { data } } of recovery.permissions.filter(row => row.payload.data.stage === stage)) {
      const { permission, operation } = data;
      requireCondition(permission.orgId === environment.orgId && reviewed.binding.permissionSets.includes(permission.name)
        && await provider.permissionAssigned(environment, permission.name) === true, 'SALESFORCE_POST_QAT_PERMISSION_DRIFT');
      records.push({ stage, operation, record: { ...permission, status: 'Succeeded', addedByRelease: !permission.prestate,
        verifiedAt: now().toISOString(), recoveredEvidenceDigest: data.evidenceDigest } });
    }
  }
  const { receipt, checkpoint } = recovery.mirror;
  const devee = records.find(({ stage, operation }) => stage === 'devee' && operation === 'deployment');
  const result = assertReviewedMirror(receipt.payload.proof, reviewed, policy, devee.record.jobId);
  requireCondition(records.filter(({ operation }) => operation.startsWith('permission:')).length
    === policy.environments.filter(({ isSandbox }) => isSandbox).length * reviewed.binding.permissionSets.length,
  'SALESFORCE_POST_QAT_PERMISSION_SCOPE_INVALID');
  requireCondition(checkpoint.payload.data.mirror.commit === result.commit
    && checkpoint.payload.data.mirror.pullRequest === result.pullRequest.number, 'SALESFORCE_POST_QAT_MIRROR_CHANGED');
  records.push({ stage: 'shared_mirror', operation: 'publication', record: { status: 'Succeeded', result,
    verifiedAt: now().toISOString(), recoveredEvidenceDigest: checkpoint.payload.data.evidenceDigest } });

  for (const { stage, operation, record } of records) {
    const existing = saved.find(item => item.stage === stage && item.operation === operation);
    if (!existing) continue;
    const matching = record.jobId
      ? existing.job?.id === record.jobId && existing.job.validationId === record.validationJobId
        && existing.job.submittedAt === record.submittedAt && existing.job.packageSha256 === record.packageSha256
      : record.result
        ? existing.mirror?.commit === record.result.commit && existing.mirror.pullRequest === record.result.pullRequest.number
        : existing.permission?.name === record.name && existing.permission.orgId === record.orgId
          && existing.permission.prestate === record.prestate;
    requireCondition(matching && existing.fingerprint === reviewed.fingerprint && existing.outcome === 'resolved'
      && isDigest(existing.evidenceDigest), 'SALESFORCE_POST_QAT_CHECKPOINT_CHANGED');
  }
  return records;
}

export async function recoverTradingFxProductionReadbacks({ recovery, reviewed, provider, saved, now = () => new Date() }) {
  const { checkpoint, receipt } = recovery;
  const { salesforceOperations, mirror } = checkpoint;
  const original = salesforceOperations.find(({ stage, operation }) => stage === 'production' && operation === 'bootstrap');
  requireCondition(original?.job?.validationId === null && isDigest(original.job.packageSha256)
    && reviewed.fingerprint === checkpoint.prior.prerequisites.plan.salesforceFingerprint,
  'SALESFORCE_TRADING_FX_PRODUCTION_BOOTSTRAP_SCOPE_CHANGED');
  const environment = policy.environments.find(({ key }) => key === 'production');
  await provider.verifyIdentity(environment);
  const prepared = await provider.prepareBootstrap(environment, reviewed);
  try {
    requireCondition(prepared.packageSha256 === original.job.packageSha256, 'SALESFORCE_TRADING_FX_PRODUCTION_BOOTSTRAP_PACKAGE_CHANGED');
  } finally { await prepared.cleanup(); }
  const proof = assertReviewedJobReport(await provider.report(environment, original.job.id), {
    environment, jobId: original.job.id, ...reviewedJobExpectations(reviewed, environment, 'bootstrap'),
  });
  const time = now();
  requireCondition(Date.parse(proof.completedAt) >= Date.parse(original.job.submittedAt) - 30_000
    && Date.parse(proof.completedAt) <= time.getTime() + 30_000, 'SALESFORCE_TRADING_FX_PRODUCTION_BOOTSTRAP_TIMING_CHANGED');
  const existing = saved.find(item => item.stage === 'production' && item.operation === 'bootstrap');
  requireCondition(!existing || (existing.fingerprint === reviewed.fingerprint && existing.outcome === 'resolved'
    && digest(existing.job) === digest(original.job)), 'SALESFORCE_TRADING_FX_PRODUCTION_BOOTSTRAP_JOB_CHANGED');
  const upstream = await recoverTradingFxPostQat({ recovery: { receipt,
    jobs: salesforceOperations.filter(operation => operation !== original).map(({ resolved }) => resolved),
    permissions: checkpoint.permissions, mirror: mirror.publication }, reviewed, provider, saved, now });
  return [...upstream, { stage: 'production', operation: 'bootstrap', record: {
    ...proof, fingerprint: reviewed.fingerprint, validationJobId: null, submittedAt: original.job.submittedAt,
    packageSha256: original.job.packageSha256, verifiedAt: time.toISOString(),
    recoveredEvidenceDigest: original.resolved.payload.data.evidenceDigest,
  } }];
}

async function applyPreparedSalesforce({ manifest, manifestHash, approval, salesforce, cwd, correctionDirectory, env, reviewed, schemaBootstrap, localMirror,
  adoption, promotionReceiptId, tradingFxRecovery, tradingFxQatRecovery, tradingFxPostQatRecovery, tradingFxProductionBootstrapRecovery,
  editorPreflight, editorsAdoption }) {
  const saved = await salesforce.journal.readCheckpoints();
  let editorsRecovery;
  if (editorsAdoption) {
    const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true });
    editorsRecovery = await readEditorsProductionValidationAdoption({ manifest, github });
    assertEditorsAdoptionApproval({ recovery: editorsRecovery, approval, manifest });
    await salesforce.ownership.assert({ fingerprint: reviewed.fingerprint, stage: 'production',
      orgId: reviewed.binding.orgIds.production, operation: 'deployment' });
  }
  const localTransport = localMirror ? await hostedLocalMirrorTransport({ manifest, approval, env, reviewed, salesforce }) : null;
  const directory = mkdtempSync(join(tmpdir(), 'fcos-salesforce-hosted-'));
  const credentials = mkdtempSync(join(tmpdir(), 'fcos-salesforce-credentials-'));
  let finished = false;
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory: credentials, cwd, env, requireMirrorCredential: !localMirror && saved.length === 0 });
    const journal = openSalesforcePromotionJournal({ directory, binding: reviewed.binding });
    try {
      const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
      provider.reconcile = (environment, jobId, { operation, submittedAt, validationJobId, packageSha256 }) =>
        reconcileHostedSalesforceJob({ environment, jobId, reviewed, operation, submittedAt, validationJobId,
          packageSha256, provider, journal: salesforce.journal });
      if (editorsRecovery) {
        const records = await recoverEditorsProductionValidation({ recovery: editorsRecovery, reviewed, provider, saved });
        await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        for (const { stage, operation, record } of records) {
          const local = journal.update(stage, operation, record);
          // The engine records missing successor jobs in promotion order as it
          // verifies them. Rebind existing durable receipts to this local readback.
          if (saved.some(item => item.stage === stage && item.operation === operation)) {
            await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage, operation, record: local });
          }
        }
        const deploy = provider.deploy;
        provider.deploy = (environment, validationJobId) => {
          const validation = journal.state.stages.production.validation;
          requireCondition(environment.key === 'production' && validationJobId === validation.jobId,
            'EDITORS_ADOPTION_UNEXPECTED_DEPLOYMENT');
          assertEditorsValidationUsable(validation);
          return deploy(environment, validationJobId);
        };
        provider.prepareValidation = () => requireCondition(false, 'EDITORS_ADOPTION_UNEXPECTED_VALIDATION');
      }
      if (adoption && !saved.some(item => item.stage === 'devee' && item.operation === 'bootstrap')) {
        const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true });
        const record = await recoverReviewedDeveeBootstrap({ adoption, manifest, reviewed, provider, github });
        await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        const savedBootstrap = journal.update('devee', 'bootstrap', record);
        await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage: 'devee', operation: 'bootstrap', record: savedBootstrap });
      }
      if (tradingFxPostQatRecovery || tradingFxProductionBootstrapRecovery) {
        const adopted = tradingFxProductionBootstrapRecovery
          ? await recoverTradingFxProductionReadbacks({ recovery: tradingFxProductionBootstrapRecovery, reviewed, provider, saved })
          : await recoverTradingFxPostQat({ recovery: tradingFxPostQatRecovery, reviewed, provider, saved });
        await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        for (const { stage, operation, record } of adopted) {
          const current = saved.find(item => item.stage === stage && item.operation === operation);
          if (!current) {
            const local = journal.update(stage, operation, record);
            await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage, operation, record: local });
          }
        }
      }
      let retainedDeveeInventory;
      if (tradingFxQatRecovery) {
        const priorDirectory = join(directory, 'prior-source');
        const gitWorktree = args => execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
        try {
          gitWorktree(['worktree', 'add', '--detach', priorDirectory, tradingFxQatRecovery.prior.candidate.sha]);
          const priorReviewed = hostedReviewedPlan(priorDirectory, tradingFxQatRecovery.prior.prerequisites.plan);
          const priorProvider = cliSalesforceProvider({ cwd: priorDirectory, policy, commandEnvironment });
          const completeDevee = saved.some(item => item.stage === 'devee' && item.operation === 'deployment');
          const adopted = await recoverTradingFxSandboxBootstraps({ recovery: tradingFxQatRecovery, reviewed, priorReviewed,
            provider, priorProvider, saved });
          if (!completeDevee) retainedDeveeInventory = {
            expected: priorReviewed.nativeInventories.devee.final, provider: priorProvider, plan: priorReviewed,
          };
          // The old checkout is needed for repeated native predeployment readback.
          for (const { stage, operation, record } of adopted) {
            await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage, operation,
              record: journal.update(stage, operation, record) });
          }
        } catch (error) {
          try { gitWorktree(['worktree', 'remove', priorDirectory]); } catch { /* temporary directory cleanup follows */ }
          throw error;
        }
      }
      const tradingFxCheckpoints = tradingFxRecovery ? [...tradingFxRecovery.jobs, ...tradingFxRecovery.permissions] : [];
      for (const { payload: { data: original } } of tradingFxCheckpoints) {
        const existing = saved.find(item => item.stage === 'devee' && item.operation === original.operation);
        requireCondition(!existing || (existing.outcome === 'resolved' && existing.fingerprint === reviewed.fingerprint
          && isDigest(existing.evidenceDigest) && digest(existing.job ?? existing.permission ?? null)
            === digest(original.job ?? original.permission ?? null)), 'SALESFORCE_DEVEE_PROMOTION_CURRENT_CHECKPOINT_CHANGED');
      }
      const adoptionOperations = [...(schemaBootstrap ? ['bootstrap'] : []), 'validation', 'deployment', ...tradingFxCheckpoints
        .filter(checkpoint => checkpoint.payload.data.permission).map(checkpoint => checkpoint.payload.data.operation)];
      if ((tradingFxRecovery || promotionReceiptId) && adoptionOperations.some(operation =>
        !saved.some(item => item.stage === 'devee' && item.operation === operation))) {
        const recovered = tradingFxRecovery ? await recoverTradingFxDeveePromotion({ recovery: tradingFxRecovery, reviewed, provider })
          : await recoverReviewedDeveePromotion({ receiptId: promotionReceiptId, manifest, reviewed, provider,
            github: githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha, actions: true }) });
        await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        for (const { operation, record } of recovered) {
          const previous = saved.find(item => item.stage === 'devee' && item.operation === operation);
          if (previous) {
            const job = previous.job;
            requireCondition(previous.outcome === 'resolved' && previous.fingerprint === reviewed.fingerprint
              && isDigest(previous.evidenceDigest) && (operation.startsWith('permission:')
                ? previous.permission?.name === record.name && previous.permission.orgId === record.orgId
                  && previous.permission.prestate === record.prestate
                : job?.id === record.jobId && job.validationId === record.validationJobId
                  && job.submittedAt === record.submittedAt && job.packageSha256 === record.packageSha256),
              'SALESFORCE_DEVEE_PROMOTION_CURRENT_CHECKPOINT_CHANGED');
            continue;
          }
          const checkpoint = journal.update('devee', operation, record);
          await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage: 'devee', operation, record: checkpoint });
        }
      }
      provider.mirror = localTransport
        ? (mode, { deveeDeployment }) => {
          requireCondition(!editorsRecovery || mode === 'check', 'EDITORS_ADOPTION_MIRROR_CHECK_REQUIRED');
          return localTransport(mode, deveeDeployment, journal.state.stages.shared_mirror?.publication);
        }
        : mode => runReviewedMirror({ mode, cwd, plan: reviewed, state: journal.state, policy,
          provider, ownership: salesforce.ownership });
      if (localTransport) {
        provider.readPendingMirror = ({ deveeDeployment }) => localTransport('recover', deveeDeployment);
      }
      const authorization = {
        productionMutation: true, fingerprint: reviewed.fingerprint, manifestSha256: reviewed.binding.manifestSha256,
        sourceTreeHash: reviewed.binding.sourceTreeHash, orgIds: reviewed.binding.orgIds,
        authorizedBy: approval.reviewer, evidence: manifestHash,
        expiresAt: new Date(Date.parse(approval.approvedAt) + 86_400_000).toISOString(),
      };
      let mirrorPreflightPassed = localMirror;
      const ownership = {
        async assert(binding) {
          if (!mirrorPreflightPassed) {
            preflightSharedMirrorPublication();
            mirrorPreflightPassed = true;
          }
          const receipt = await salesforce.ownership.assert(binding);
          if (editorsRecovery && binding.stage === 'production' && binding.operation === 'deployment') {
            assertEditorsValidationUsable(journal.state.stages.production.validation);
          }
          return receipt;
        },
      };
      const retainedTradingFxMirror = tradingFxProductionBootstrapRecovery?.checkpoint.mirror.publication.proof;
      let corrections;
      let verifyCorrectedMirror;
      let repairProductionSalesSupport;
      if (tradingFxProductionBootstrapRecovery) {
        const repair = manifest.prerequisites.plan.salesSupportRepair;
        const verifySource = () => verifySalesSupportRepairSource({ cwd: correctionDirectory, repair });
        const originalMirror = tradingFxProductionBootstrapRecovery.viewAllFieldsClosure?.checkpoint.mirror ?? retainedTradingFxMirror;
        const context = salesforce.correction;
        const correctionReview = { fingerprint: repair.correctionFingerprint,
          binding: { sourceTreeHash: repair.sourceTreeHash, orgIds: reviewed.binding.orgIds } };
        const correctionMirror = await hostedLocalMirrorTransport({
          manifest, approval, env, reviewed: correctionReview, salesforce: context,
        });
        repairProductionSalesSupport = async () => {
          await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
          ({ operations: corrections, verifyMirror: verifyCorrectedMirror } = await promoteSalesSupportCorrection({
            fingerprint: repair.correctionFingerprint, sourceTreeHash: repair.sourceTreeHash,
            retainedMirror: repair.viewAllFieldsCorrection ? undefined : tradingFxProductionBootstrapRecovery.fieldBoundClosure?.checkpoint.mirror,
            verifySource, context, mirror: correctionMirror, originalMirror,
            verifySandbox: stage => verifyReviewedOrgInventory({ provider, plan: reviewed,
              environment: policy.environments.find(environment => environment.key === stage),
              expected: reviewed.nativeInventories[stage].final }),
            sandbox: stage => applyTradingFxSalesSupportSandboxCorrection({ ...context, stage, cwd: correctionDirectory,
              commandEnvironment, repair, fingerprint: repair.correctionFingerprint }),
            production: () => applyTradingFxSalesSupportCorrection({ ...context, cwd: correctionDirectory, commandEnvironment, repair,
              fingerprint: repair.correctionFingerprint }),
          }));
          await assertReviewedInputsUnchanged(reviewed, { cwd, policy });
        };
      }
      const hasPreparation = saved.some(item => item.stage === 'production' && item.operation === 'preparation'
        && (item.preparation?.validationJobId || item.preparation?.status === 'awaiting-authorized-bootstrap'));
      const verifyDeveeDesktop = reviewed.review.nativeDeveeDesktop === undefined ? undefined
        : async proof => {
          if (!editorPreflight) return verifyHostedDeveeDesktop({ manifest, approval, reviewed, salesforce, env, ...proof });
          const observed = await verifyEditorPreflightPostimage({ manifest, proof: editorPreflight, reviewed, ...proof });
          const checkpoint = await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage: 'devee',
            operation: 'native-desktop-preflight', record: { status: 'observed', runId: approval.runId, ...observed } });
          requireCondition(checkpoint?.payload?.data?.desktop?.proofId === observed.proofId, 'EDITOR_PREFLIGHT_CHECKPOINT_ACK_UNCERTAIN');
          if (editorsRecovery) {
            // The successor records the inherited publication after its own
            // DEVEE evidence, then independently checks the live mirror head.
            const publication = journal.update('shared_mirror', 'publication', journal.state.stages.shared_mirror.publication);
            await salesforce.journal.checkpoint({ fingerprint: reviewed.fingerprint, stage: 'shared_mirror',
              operation: 'publication', record: publication });
          }
          return observed;
        };
      const result = await runReviewedSalesforceRelease({ plan: reviewed, mode: hasPreparation ? 'apply' : 'approved-continuation',
        policy, journal, provider, verifyDeveeDesktop,
        ownership, externalJournal: salesforce.journal, authorization, retainedDeveeInventory, retainedTradingFxMirror, repairProductionSalesSupport,
        salesSupportViewAllFieldsCorrection: manifest.prerequisites.plan.salesSupportRepair?.viewAllFieldsCorrection === true,
        assertUnchanged: () => assertReviewedInputsUnchanged(reviewed, { cwd, policy }) });
      requireCondition(result.mode === 'applied', 'SALESFORCE_HOSTED_APPLY_REQUIRED');
      if (repairProductionSalesSupport) {
        requireCondition(corrections?.length === 4 && corrections.every(item => item.verified && item.intentRecorded),
          'SALESFORCE_TRADING_FX_SALES_SUPPORT_CORRECTION_REQUIRED');
        await verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment, read: false, repair: manifest.prerequisites.plan.salesSupportRepair });
        await verifyCorrectedMirror();
      }
      const completedOperations = (await salesforce.journal.readCheckpoints()).filter(item => item.outcome === 'resolved'
        && (retainedTradingFxMirror && item.stage === 'shared_mirror' && item.operation === 'publication'
          && item.mirror?.commit === retainedTradingFxMirror.commit && item.mirror?.pullRequest === retainedTradingFxMirror.pullRequest.number
          || journal.state.stages[item.stage]?.[item.operation]?.status === 'Succeeded'
          && matchesSalesforceCheckpoint(journal.state.stages[item.stage][item.operation], item)))
        .map(item => ({ operationId: `salesforce:${item.stage}:${item.operation}`, evidenceDigest: item.evidenceDigest,
          verified: true, intentRecorded: true }));
      const completedIds = new Set(completedOperations.map(item => item.operationId));
      requireCondition(completedIds.has('salesforce:shared_mirror:publication') && policy.environments.every(({ key }) =>
        completedIds.has(`salesforce:${key}:validation`) && completedIds.has(`salesforce:${key}:deployment`)
        && (!schemaBootstrap || completedIds.has(`salesforce:${key}:bootstrap`))
        && reviewed.binding.permissionSets.every(name => completedIds.has(`salesforce:${key}:permission:${name}`))),
      'SALESFORCE_HOSTED_COMPLETION_EVIDENCE_REQUIRED');
      if (corrections) completedOperations.push(...corrections);
      finished = true;
      return { passed: true, manifestHash, backwardCompatible: true, completedOperations,
        salesforce: { order: 'devee-mirror-qat-production', mirrorVerified: true,
          sourceTreeHash: reviewed.binding.sourceTreeHash, fingerprint: reviewed.fingerprint,
          ...(corrections ? { correction: {
            fingerprint: manifest.prerequisites.plan.salesSupportRepair.correctionFingerprint,
            sourceTreeHash: manifest.prerequisites.plan.salesSupportRepair.sourceTreeHash,
            order: 'devee-mirror-qat-production',
          } } : {}) } };
    } finally {
      if (tradingFxQatRecovery) {
        try {
          execFileSync('git', ['worktree', 'remove', join(directory, 'prior-source')],
            { cwd, stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
        } catch { /* temporary directory cleanup follows */ }
      }
      journal.close();
    }
  } finally {
    rmSync(credentials, { recursive: true, force: true });
    if (finished) rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyHostedDeveeDesktop({ manifest, approval, reviewed, salesforce, env, deployment, inventory, readInstalledInventory }) {
  const candidateSha = manifest.candidate.sha;
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha, actions: true });
  const execution = await verifyExecution({ github, manifest, env, phase: 'promote' });
  requireCondition(Number(env.GITHUB_RUN_ATTEMPT) === execution.run.run_attempt, 'DEVEE_DESKTOP_WORKFLOW_INVALID');
  const request = createDeveeDesktopRequest({ manifest, approval, reviewed, deployment, inventory,
    execution, workflowProof: execution.workflowProof });
  const recordRequest = payload => recordLocalMirrorDeployment({ github, candidateSha, actorId: execution.user.id, payload });
  const receipt = await awaitDeveeDesktopReceipt({ request, recordRequest,
    readRecords: () => readLocalMirrorDeployments(github, candidateSha), environment: LOCAL_MIRROR_ENVIRONMENT });
  return recordVerifiedDeveeDesktopCheckpoint({ request, receipt, readInstalledInventory, journal: salesforce.journal });
}
