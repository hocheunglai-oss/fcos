import { digest, FROZEN_COMPATIBILITY_SHA, releaseTargets, REQUIRED_LIVE_CHECKS, WRITE_PHASES } from '../../scripts/lib/hosted-release/contract.mjs';
const H='a'.repeat(64), S='b'.repeat(40);
export function fixtureManifest() { return {
  schemaVersion: 2, contract: 'fcos-hosted-release/v2', releaseId: 'qualification-example-001', stage: 'compatibility', executionMode: 'release', epoch: 2,
  candidate: { sha: FROZEN_COMPATIBILITY_SHA, branch: 'codex/readonly-collections-compatibility-successor-20261005', sourceSha256: H, lockSha256: H, configurationSha256: H, salesforceSourceSha256: H },
  controller: { sha: S, workflow: '.github/workflows/hosted-release-controller.yml', checkManifestSha256: H, configurationSha256: H },
  targets: releaseTargets(), scope: { sha256: H, handoffs: [], existingUi: false, financialAuthority: false },
  previousProduction: { deploymentId: 'dpl_previous', sha: 'c'.repeat(40), sourceSha256: H, schemaSha256: H, runtimeSha256: H },
  requiredChecks: [...REQUIRED_LIVE_CHECKS], authorization: { validitySeconds: 86400, actions: [...WRITE_PHASES], rollback: { mode: 'compatible_previous_only', schemaRollback: false } },
  migration: { mode: 'none', expectedSchemaSha256: H }, runtime: { expectedSha256: digest({ safety: true }), expectedProduction: { safety: true }, expectedPreview: { safety: true } }, changes: ['Frozen compatibility successor'],
}; }
