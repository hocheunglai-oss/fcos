import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { changedPaths, digest, git, isSha, requireCondition, sourceSnapshot, validateManifest } from './lib/rapid-release/contract.mjs';
import { paymentSalesSupportRepairParent, verifyPaymentSalesSupportRepairSource } from './lib/rapid-release/trading-fx-payment-profile-repair.mjs';
import { verifySalesSupportRepairSource } from './lib/rapid-release/trading-fx-sales-support-source.mjs';
import { assertSalesforceProductionSettingCompatibility, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { safeProjectFile } from './lib/salesforce-reviewed-release.mjs';

function assertNoIgnoredMetadata(directory) {
  requireCondition(!git(directory, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'force-app/main/default']),
    'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT');
}

function verifyReviewedApplication({ cwd, manifest, verifierDirectory }) {
  const { candidate: { sha: candidateSha }, controllerSha } = manifest;
  const candidate = sourceSnapshot(cwd);
  requireCondition(candidate.sha === candidateSha && candidate.sourceDigest === manifest.candidate.sourceDigest
    && candidate.lockDigest === manifest.candidate.lockDigest, 'SALESFORCE_REVIEW_SOURCE_MISMATCH');
  const paths = changedPaths(cwd, manifest.previous.sha);
  requireCondition(JSON.stringify(paths) === JSON.stringify(manifest.paths)
    && paths.every(path => !/^(?:\.github\/|\.githooks\/|vercel\.json$)/u.test(path))
    && JSON.parse(git(cwd, ['show', candidateSha + ':vercel.json'])).git?.deploymentEnabled === false,
  'SALESFORCE_REVIEW_SOURCE_DEPLOYMENT_DISABLED_REQUIRED');
  const { adapterDigest, plan } = manifest.prerequisites;
  const registry = JSON.parse(git(verifierDirectory, ['show', controllerSha + ':config/rapid-release-adapters.json']));
  const adapter = registry.adapters.find(entry => entry.id === manifest.prerequisites.adapter);
  requireCondition(adapter?.status === 'qualified' && adapter.salesforce === true && adapter.database === manifest.selection.database
    && adapter.sourceDigest === adapterDigest && /^scripts\/[A-Za-z0-9_./-]+\.mjs$/u.test(adapter.path)
    && !adapter.path.split('/').includes('..')
    && git(verifierDirectory, ['rev-parse', controllerSha + ':' + adapter.path]) === git(verifierDirectory, ['rev-parse', 'HEAD:' + adapter.path])
    && digest(readFileSync(resolve(verifierDirectory, adapter.path))) === adapterDigest,
  'SALESFORCE_REVIEW_SOURCE_ADAPTER_MISMATCH');
  const tracked = new Set(candidate.files.map(file => file.path));
  const checkTracked = paths => requireCondition(paths.every(path => tracked.has(path)), 'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT');
  checkTracked(['sfdx-project.json', plan.salesforceManifestPath, plan.salesforceReviewPath]);
  const review = JSON.parse(readFileSync(safeProjectFile(cwd, plan.salesforceReviewPath), 'utf8'));
  checkTracked([review.baselineWorkflowPath, review.bootstrap?.manifestPath].filter(Boolean));
  for (const descriptor of Object.values(review.inventoryManifests || {})) {
    for (const entry of [descriptor, descriptor.apex, descriptor.metadata].filter(Boolean)) {
      checkTracked([entry.path]);
      const absolute = safeProjectFile(cwd, entry.path);
      requireCondition(digest(readFileSync(absolute)) === entry.sha256, 'SALESFORCE_REVIEW_SOURCE_RETRIEVAL_DIGEST_MISMATCH');
    }
  }
  assertNoIgnoredMetadata(cwd);
  const reviewed = loadReviewedSalesforcePlan({ cwd, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  requireCondition(reviewed.fingerprint === plan.salesforceFingerprint && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash
    && plan.backwardCompatible === true, 'SALESFORCE_REVIEW_SOURCE_INVENTORY_MISMATCH');
  assertSalesforceProductionSettingCompatibility(cwd, reviewed);
  return { candidateSha, controllerSha, manifestHash: digest(manifest), salesforceFingerprint: reviewed.fingerprint };
}

function verifyReviewedCorrection({ cwd, candidateSha, manifest, verifierDirectory }) {
  const { adapter, plan: { salesSupportRepair, paymentRepair, tradingFxFinalPosteffectClosureReceiptId } } = manifest.prerequisites;
  const repair = paymentRepair ?? salesSupportRepair;
  const parent = paymentRepair ? paymentSalesSupportRepairParent : manifest.candidate.sha;
  const commonDirectory = dir => git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  requireCondition(adapter === 'trading-fx-prerequisites' && repair?.sourceCommit === candidateSha
    && (!paymentRepair || (salesSupportRepair.sourceCommit === parent
      && Number.isSafeInteger(tradingFxFinalPosteffectClosureReceiptId) && tradingFxFinalPosteffectClosureReceiptId > 0))
    && commonDirectory(cwd) === commonDirectory(verifierDirectory)
    && git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']) === `${candidateSha} ${parent}`,
  'SALESFORCE_REVIEW_CORRECTION_SCOPE_MISMATCH');
  if (paymentRepair) verifyPaymentSalesSupportRepairSource({ cwd, repair });
  else verifySalesSupportRepairSource({ cwd, repair });

  // Reuse the ordinary application gate with the original bytes. The independent
  // Profile overlay cannot change the legacy review, adapter or application manifest.
  const folder = mkdtempSync(join(tmpdir(), 'fcos-salesforce-review-source-'));
  const application = join(folder, 'application');
  const worktree = args => git(verifierDirectory, ['worktree', ...args]);
  let created = false;
  try {
    worktree(['add', '--detach', '--no-checkout', application, manifest.candidate.sha]);
    created = true;
    git(application, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ':/']);
    const verified = verifyReviewedApplication({ cwd: application, manifest, verifierDirectory });
    return { ...verified, candidateSha, applicationCandidateSha: verified.candidateSha,
      correctionSourceTreeHash: repair.sourceTreeHash, correctionFingerprint: repair.correctionFingerprint };
  } finally {
    if (created) worktree(['remove', application]);
    rmSync(folder, { recursive: true, force: true });
  }
}

export function verifySalesforceReviewSource({ cwd, candidateSha, manifest, verifierDirectory }) {
  // GitHub needs the exact source commit before it can record the Demo receipt.
  validateManifest(manifest, { sourcePublicationOnly: true });
  requireCondition(isSha(candidateSha) && manifest.selection.salesforce === true && manifest.prerequisites?.plan,
    'SALESFORCE_REVIEW_SOURCE_PLAN_REQUIRED');
  const controllerSha = manifest.controllerSha;
  requireCondition(!git(verifierDirectory, ['status', '--porcelain', '--untracked-files=no'])
    && git(verifierDirectory, ['merge-base', controllerSha, 'HEAD']) === controllerSha,
  'SALESFORCE_REVIEW_SOURCE_CONTROLLER_MISMATCH');
  const input = { cwd, candidateSha, manifest, verifierDirectory };
  return candidateSha === manifest.candidate.sha ? verifyReviewedApplication(input) : verifyReviewedCorrection(input);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [cwd, candidateSha, manifestFile] = process.argv.slice(2);
    const verifierDirectory = fileURLToPath(new URL('..', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    console.log(JSON.stringify(verifySalesforceReviewSource({ cwd, candidateSha, manifest, verifierDirectory })));
  } catch (error) {
    console.error(error?.code || 'SALESFORCE_REVIEW_SOURCE_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
