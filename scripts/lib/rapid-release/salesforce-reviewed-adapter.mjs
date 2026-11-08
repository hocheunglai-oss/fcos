import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertReviewedInputsUnchanged, cliSalesforceProvider, loadReviewedSalesforcePlan } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { runReviewedMirror } from '../../sync-salesforce-reviewed-repository.mjs';
import { openSalesforcePromotionJournal } from '../salesforce-promotion-journal.mjs';
import { runReviewedSalesforceRelease, safeProjectFile } from '../salesforce-reviewed-release.mjs';
import { digest, requireCondition, targets } from './contract.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');

export async function applyReviewedPrerequisites({ manifest, approval, plan, salesforce, salesforceCandidateDirectory: cwd }) {
  const manifestHash = digest(manifest);
  requireCondition(manifest.selection.salesforce && !manifest.selection.database && plan.backwardCompatible === true
    && cwd && typeof salesforce?.journal?.readCheckpoints === 'function'
    && typeof salesforce?.ownership?.assert === 'function' && approval?.manifestHash === manifestHash
    && approval.nativeReviewVerified === true && approval.reviewer === targets().account,
  'SALESFORCE_HOSTED_REVIEW_REQUIRED');
  const project = JSON.parse(readFileSync(safeProjectFile(cwd, 'sfdx-project.json'), 'utf8'));
  requireCondition(project.namespace === '' && project.packageDirectories?.length === 1
    && project.packageDirectories[0].path === 'force-app' && project.packageDirectories[0].default === true,
  'SALESFORCE_HOSTED_PROJECT_SCOPE_INVALID');
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  requireCondition(reviewed.fingerprint === plan.salesforceFingerprint
    && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash, 'SALESFORCE_HOSTED_PLAN_MISMATCH');
  requireCondition(!reviewed.review.bootstrap, 'SALESFORCE_HOSTED_BOOTSTRAP_UNQUALIFIED');

  const directory = mkdtempSync(join(tmpdir(), 'fcos-salesforce-hosted-'));
  let finished = false;
  try {
    const journal = openSalesforcePromotionJournal({ directory, binding: reviewed.binding });
    try {
      const provider = cliSalesforceProvider({ cwd, policy });
      provider.mirror = mode => runReviewedMirror({ mode, cwd, plan: reviewed, state: journal.state, policy,
        provider, ownership: salesforce.ownership });
      const authorization = {
        productionMutation: true, fingerprint: reviewed.fingerprint, manifestSha256: reviewed.binding.manifestSha256,
        sourceTreeHash: reviewed.binding.sourceTreeHash, orgIds: reviewed.binding.orgIds,
        authorizedBy: approval.reviewer, evidence: manifestHash,
        expiresAt: new Date(Date.parse(approval.approvedAt) + 86_400_000).toISOString(),
      };
      const run = mode => runReviewedSalesforceRelease({ plan: reviewed, mode, policy, journal, provider,
        ownership: salesforce.ownership, externalJournal: salesforce.journal,
        authorization: mode === 'apply' ? authorization : null,
        assertUnchanged: () => assertReviewedInputsUnchanged(reviewed, { cwd, policy }) });
      const saved = await salesforce.journal.readCheckpoints();
      if (!saved.some(item => item.stage === 'production' && item.operation === 'preparation' && item.preparation?.validationJobId)) {
        requireCondition((await run('prepare')).mode === 'prepared', 'SALESFORCE_HOSTED_PREPARATION_REQUIRED');
      }
      requireCondition((await run('apply')).mode === 'applied', 'SALESFORCE_HOSTED_APPLY_REQUIRED');
      const completedOperations = (await salesforce.journal.readCheckpoints()).filter(item => item.outcome === 'resolved'
        && journal.state.stages[item.stage]?.[item.operation]?.status === 'Succeeded'
        && digest(journal.state.stages[item.stage][item.operation]) === item.evidenceDigest)
        .map(item => ({ operationId: `salesforce:${item.stage}:${item.operation}`, evidenceDigest: item.evidenceDigest,
          verified: true, intentRecorded: true }));
      const completedIds = new Set(completedOperations.map(item => item.operationId));
      requireCondition(completedIds.has('salesforce:shared_mirror:publication') && policy.environments.every(({ key }) =>
        completedIds.has(`salesforce:${key}:validation`) && completedIds.has(`salesforce:${key}:deployment`)),
      'SALESFORCE_HOSTED_COMPLETION_EVIDENCE_REQUIRED');
      finished = true;
      return { passed: true, manifestHash, backwardCompatible: true, completedOperations,
        salesforce: { order: 'devee-mirror-qat-production', mirrorVerified: true,
          sourceTreeHash: reviewed.binding.sourceTreeHash, fingerprint: reviewed.fingerprint } };
    } finally {
      journal.close();
    }
  } finally {
    if (finished) rmSync(directory, { recursive: true, force: true });
  }
}
