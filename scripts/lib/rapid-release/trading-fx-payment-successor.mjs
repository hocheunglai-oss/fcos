import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { verifyReviewedOrgInventory } from '../salesforce-reviewed-release.mjs';
import { nativeCompatibilityReader } from './compatibility.mjs';
import { assertAuthorization, digest, isDigest, requireCondition, sourceSnapshot, validateManifest } from './contract.mjs';
import { vercelProvider } from './providers.mjs';
import { authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';
import { hostedLocalMirrorTransport } from './salesforce-reviewed-adapter.mjs';
import { readTradingFxFinalPosteffectClosed, TRADING_FX_FINAL_POSTEFFECT_ORIGINAL } from './trading-fx-final-posteffect-checkpoint.mjs';
import { readTradingFxFinalPosteffectRetainedEvidence } from './trading-fx-final-posteffect-history.mjs';
import { assertPaymentSalesSupportRepairBinding, verifyPaymentSalesSupportRepairSource } from './trading-fx-payment-profile-repair.mjs';
import { promoteSalesSupportCorrection } from './trading-fx-sales-support-promotion.mjs';
import {
  applyTradingFxSalesSupportCorrection, applyTradingFxSalesSupportSandboxCorrection, verifyTradingFxSalesSupportReadGrants,
} from './trading-fx-sales-support-transport.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const order = 'devee-mirror-qat-production';
const correctionOperations = ['devee', 'shared_mirror', 'qat', 'production'].map(stage => `salesforce:${stage}:sales-support-correction`);
const check = (condition, code) => requireCondition(condition, `TRADING_FX_PAYMENT_SUCCESSOR_${code}`);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

function assertPaymentSuccessor(manifest, verified) {
  validateManifest(manifest);
  const { releaseId, controllerSha, createdAt, prerequisites, ...candidate } = manifest;
  const { releaseId: priorRelease, controllerSha: priorController, createdAt: priorCreated, prerequisites: prior, ...priorCandidate } = verified.manifest;
  const { adapterDigest, plan, ...descriptor } = prerequisites ?? {};
  const { adapterDigest: priorAdapterDigest, plan: priorPlan, ...priorDescriptor } = prior ?? {};
  const { tradingFxFinalPosteffectClosureReceiptId: receiptId, paymentRepair, ...priorPlanCandidate } = plan ?? {};
  const closure = verified.closed?.closure;
  const repair = assertPaymentSalesSupportRepairBinding(paymentRepair);
  check(Number.isSafeInteger(receiptId) && receiptId > 0 && closure?.id === receiptId
    && Number.isFinite(Date.parse(closure.created_at)) && Date.parse(createdAt) >= Date.parse(closure.created_at)
    && Date.parse(createdAt) > Date.parse(priorCreated) && releaseId !== priorRelease && controllerSha !== priorController
    && isDigest(adapterDigest) && isDigest(priorAdapterDigest) && adapterDigest !== priorAdapterDigest
    && descriptor.adapter === 'trading-fx-prerequisites' && same(descriptor, priorDescriptor)
    && same(candidate, priorCandidate) && same(priorPlanCandidate, priorPlan)
    && priorPlan.salesSupportRepair?.viewAllFieldsCorrection === true
    && repair.sourceCommit !== priorPlan.salesSupportRepair.sourceCommit
    && repair.sourceTreeHash !== priorPlan.salesSupportRepair.sourceTreeHash
    && repair.correctionFingerprint !== priorPlan.salesSupportRepair.correctionFingerprint,
  'SCOPE_CHANGED');
  return repair;
}

export async function readTradingFxPaymentSuccessor({ manifest, github }, { readClosed = readTradingFxFinalPosteffectClosed } = {}) {
  const verified = await readClosed({ github });
  assertPaymentSuccessor(manifest, verified);
  return verified;
}

export async function applyTradingFxPaymentSuccessor({ input, verified, github }) {
  const { manifest, approval, authorization, env, salesforce, salesforceCandidateDirectory: cwd, correctionDirectory } = input;
  const repair = assertPaymentSuccessor(manifest, verified);
  const plan = manifest.prerequisites.plan;
  assertAuthorization(approval, manifest, { id: approval?.deploymentId });
  const manifestHash = digest(manifest);
  check(approval.runId !== verified.approval.runId && Date.parse(approval.approvedAt) >= Date.parse(verified.closed.closure.created_at)
    && authorization?.manifestHash === manifestHash && same(authorization.nativeReview, approval)
    && /^dpl_[A-Za-z0-9]+$/u.test(approval.deploymentId || '')
    && salesforce?.correction && cwd && correctionDirectory && cwd !== correctionDirectory, 'EXACT_AUTHORIZATION_REQUIRED');

  const candidate = sourceSnapshot(cwd);
  check(candidate.sha === manifest.candidate.sha && candidate.sourceDigest === manifest.candidate.sourceDigest
    && candidate.lockDigest === manifest.candidate.lockDigest, 'APPLICATION_CHANGED');
  const verifySource = () => verifyPaymentSalesSupportRepairSource({ cwd: correctionDirectory, repair });
  verifySource();
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  check(reviewed.fingerprint === plan.salesforceFingerprint && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash,
    'REVIEW_CHANGED');

  const priorMirror = verified.mirrorReceipts.at(-1)?.payload?.proof;
  check(priorMirror?.commit === TRADING_FX_FINAL_POSTEFFECT_ORIGINAL.correctionMirrorCommit
    && priorMirror.pullRequest?.number === 9 && priorMirror.sourceTreeHash === plan.salesSupportRepair.sourceTreeHash,
  'ORIGINAL_MIRROR_CHANGED');
  const historical = verified.closed.result.completedOperations;
  check(correctionOperations.every(id => historical.filter(row => row.operationId === id).length === 1), 'ORIGINAL_CHECKPOINTS_CHANGED');
  const retainedOperations = historical.filter(row => !correctionOperations.includes(row.operationId));

  const readOnlyEnv = { FCOS_RAPID_DATABASE_URL: env.FCOS_RAPID_DATABASE_URL, FCOS_RAPID_DATABASE_CA: env.FCOS_RAPID_DATABASE_CA };
  const url = URL.parse(readOnlyEnv.FCOS_RAPID_DATABASE_URL || '');
  check(url?.username === fcosConnectionIdentifier('supabase', 'Database release read-only user'), 'READ_ONLY_DATABASE_REQUIRED');
  const vercel = vercelProvider({ manifest, github, env });
  const baseline = await nativeCompatibilityReader({ provider: vercel, env: readOnlyEnv })({ manifest });
  const signingProvider = { nativeConfiguration: () => vercel.nativeConfiguration(),
    tradingFxSigningEnvironment: request => vercel.tradingFxSigningEnvironment(request) };
  const { databaseOperation, database } = await readTradingFxFinalPosteffectRetainedEvidence({
    verified: { ...verified, signingProvider }, github, env, baseline,
  });
  check(same(databaseOperation, verified.closed.result.evidence.databaseOperation), 'ORIGINAL_DATABASE_EVIDENCE_CHANGED');

  const directory = mkdtempSync(join(tmpdir(), 'fcos-trading-fx-payment-successor-'));
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory, cwd,
      env: { ...env, HOME: directory }, requireMirrorCredential: false });
    const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
    const environments = new Map(policy.environments.map(environment => [environment.key, environment]));
    const verifyInventory = async stage => {
      const environment = environments.get(stage);
      await verifyReviewedOrgInventory({ provider, environment, plan: reviewed, expected: reviewed.nativeInventories[stage].final,
        profileRecovery: stage === 'production' ? 'after-final-view-all-fields-correction' : undefined });
      for (const permission of reviewed.binding.permissionSets) {
        check(await provider.permissionAssigned(environment, permission) === true, 'ORIGINAL_PERMISSION_CHANGED');
      }
    };
    for (const { key } of policy.environments) await verifyInventory(key);

    const fingerprint = repair.correctionFingerprint;
    const context = salesforce.correction;
    const correction = { ...context, fingerprint, cwd: correctionDirectory, commandEnvironment,
      repair: plan.salesSupportRepair, paymentRepair: repair };
    const mirror = await hostedLocalMirrorTransport({ manifest, approval, env, salesforce: context,
      reviewed: { fingerprint, binding: { sourceTreeHash: repair.sourceTreeHash, orgIds: reviewed.binding.orgIds } } });
    const { operations, verifyMirror } = await promoteSalesSupportCorrection({ fingerprint, sourceTreeHash: repair.sourceTreeHash,
      verifySource, verifySandbox: verifyInventory, context, sandbox: stage => applyTradingFxSalesSupportSandboxCorrection({ ...correction, stage }),
      mirror, originalMirror: priorMirror, production: () => applyTradingFxSalesSupportCorrection(correction) });
    check(same(operations.map(operation => operation.operationId), correctionOperations)
      && operations.every(operation => operation.verified === true && operation.intentRecorded === true && isDigest(operation.evidenceDigest)),
    'CORRECTION_CHECKPOINTS_CHANGED');
    await verifyInventory('production');
    verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment, read: false, repair: plan.salesSupportRepair,
      finalPackageApplied: true, paymentAdjustmentCorrection: true });
    await verifyMirror();
    return { passed: true, manifestHash, backwardCompatible: true, database,
      salesforce: { order, mirrorVerified: true, sourceTreeHash: plan.salesforceSourceTreeHash, fingerprint: plan.salesforceFingerprint,
        correction: { fingerprint, sourceTreeHash: repair.sourceTreeHash, order } },
      completedOperations: [databaseOperation, ...retainedOperations, ...operations] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
