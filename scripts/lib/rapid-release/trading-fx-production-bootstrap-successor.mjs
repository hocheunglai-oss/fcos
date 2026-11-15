import { digest, requireCondition, validateManifest } from './contract.mjs';
import { assertSalesSupportRepairBinding } from './trading-fx-sales-support-source.mjs';

export function assertTradingFxProductionBootstrapSuccessor(manifest, prior) {
  validateManifest(manifest);
  const { tradingFxProductionBootstrapRecoveryReceiptId: receiptId, tradingFxFieldBoundCorrectionClosureReceiptId: fieldBoundClosure, salesSupportRepair, ...retainedPlan } =
    manifest.prerequisites?.plan ?? {};
  const repair = assertSalesSupportRepairBinding(salesSupportRepair);
  requireCondition(repair.fieldBoundPackageSha256 ? Number.isSafeInteger(fieldBoundClosure) && fieldBoundClosure > 0
    : fieldBoundClosure === undefined, 'TRADING_FX_FIELD_DENIAL_CLOSURE_REQUIRED');
  const { releaseId, controllerSha, createdAt, prerequisites, ...retainedManifest } = manifest;
  const { releaseId: priorReleaseId, controllerSha: priorControllerSha, createdAt: _priorCreatedAt,
    prerequisites: priorPrerequisites, ...priorRetainedManifest } = prior;

  requireCondition(Number.isSafeInteger(receiptId) && receiptId > 0
    && releaseId !== priorReleaseId && controllerSha !== priorControllerSha
    && Date.parse(createdAt) > Date.parse(prior.createdAt)
    && prerequisites.adapter === 'trading-fx-prerequisites' && prerequisites.adapter === priorPrerequisites.adapter
    && prerequisites.adapterDigest !== priorPrerequisites.adapterDigest
    && digest(retainedManifest) === digest(priorRetainedManifest)
    && digest(retainedPlan) === digest(priorPrerequisites.plan),
  'TRADING_FX_PRODUCTION_BOOTSTRAP_SUCCESSOR_SCOPE_CHANGED');
}

export function assertTradingFxFieldBoundCorrectionSuccessor(manifest, prior) {
  validateManifest(manifest);
  validateManifest(prior);
  const { releaseId, controllerSha, createdAt, prerequisites, ...retainedManifest } = manifest;
  const { releaseId: priorReleaseId, controllerSha: priorControllerSha, createdAt: priorCreatedAt,
    prerequisites: priorPrerequisites, ...priorRetainedManifest } = prior;
  const { tradingFxFieldBoundCorrectionClosureReceiptId: receiptId, salesSupportRepair, ...retainedPlan } = prerequisites?.plan ?? {};
  const { salesSupportRepair: priorRepair, ...priorRetainedPlan } = priorPrerequisites?.plan ?? {};
  const { fieldBoundPackageSha256, fieldBoundManifestDigest, correctionFingerprint, ...retainedRepair } =
    assertSalesSupportRepairBinding(salesSupportRepair);
  const { correctionFingerprint: priorFingerprint, ...priorRetainedRepair } = assertSalesSupportRepairBinding(priorRepair);
  requireCondition(Number.isSafeInteger(receiptId) && receiptId > 0 && fieldBoundPackageSha256 && fieldBoundManifestDigest
    && releaseId !== priorReleaseId && controllerSha !== priorControllerSha && Date.parse(createdAt) > Date.parse(priorCreatedAt)
    && correctionFingerprint !== priorFingerprint && prerequisites.adapter === 'trading-fx-prerequisites'
    && prerequisites.adapter === priorPrerequisites.adapter && prerequisites.adapterDigest !== priorPrerequisites.adapterDigest
    && digest(retainedRepair) === digest(priorRetainedRepair) && digest(retainedManifest) === digest(priorRetainedManifest)
    && digest(retainedPlan) === digest(priorRetainedPlan), 'TRADING_FX_FIELD_DENIAL_SUCCESSOR_SCOPE_CHANGED');
}
