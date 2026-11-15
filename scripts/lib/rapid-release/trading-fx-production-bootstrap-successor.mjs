import { digest, requireCondition, validateManifest } from './contract.mjs';
import { salesSupportRepairPackage } from './trading-fx-sales-support-repair.mjs';

export function assertTradingFxProductionBootstrapSuccessor(manifest, prior) {
  validateManifest(manifest);
  const { tradingFxProductionBootstrapRecoveryReceiptId: receiptId, salesSupportRepair, ...retainedPlan } =
    manifest.prerequisites?.plan ?? {};
  const { profileDigest, manifestDigest } = salesSupportRepairPackage();
  const { releaseId, controllerSha, createdAt, prerequisites, ...retainedManifest } = manifest;
  const { releaseId: priorReleaseId, controllerSha: priorControllerSha, createdAt: _priorCreatedAt,
    prerequisites: priorPrerequisites, ...priorRetainedManifest } = prior;

  requireCondition(Number.isSafeInteger(receiptId) && receiptId > 0
    && releaseId !== priorReleaseId && controllerSha !== priorControllerSha
    && Date.parse(createdAt) > Date.parse(prior.createdAt)
    && prerequisites.adapter === 'trading-fx-prerequisites' && prerequisites.adapter === priorPrerequisites.adapter
    && prerequisites.adapterDigest !== priorPrerequisites.adapterDigest
    && digest(retainedManifest) === digest(priorRetainedManifest)
    && digest(retainedPlan) === digest(priorPrerequisites.plan)
    && digest(salesSupportRepair ?? null) === digest({ profileDigest, manifestDigest }),
  'TRADING_FX_PRODUCTION_BOOTSTRAP_SUCCESSOR_SCOPE_CHANGED');
}
