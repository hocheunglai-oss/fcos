// Hermetic setup evidence; never an actual token, issuer response or acceptance.
import { digest } from '../../scripts/lib/hosted-release/contract.mjs';
export function admitPreviewWriterFixture(manifest, { now = Date.now() } = {}) {
  const token = 'vcp_HERMETIC_' + 'x'.repeat(48), H = 'a'.repeat(64);
  const credential = { operationId: 'preview-writer-11111111-1111-4111-8111-111111111111', tokenId: 'fixture-writer-id',
    name: 'fcos-hosted-preview-writer-11111111-1111-4111-8111-111111111111', bearerSha256: digest(token),
    teamId: manifest.targets.vercelTeam, projectId: manifest.targets.vercelProject, createdAt: now - 60000, expiresAt: now + 86400000,
    originalIssuanceResponseSha256: H, exactIdMetadataReadbackSha256: 'b'.repeat(64) };
  const review = { schemaVersion: 1, kind: 'fcos_root_accepted_original_preview_writer', accepted: true, reviewerId: '/root',
    operator: 'hocheunglai-oss', reviewedAt: new Date(now - 30000).toISOString(), credential: { ...credential },
    provenance: { originalPlanSha256: H, originalIssuanceIntentSha256: H, originalCustodyReceiptSha256: H,
      metadataAuthority: 'verified_existing_manager_exact_original_id_get', singleTeamScope: manifest.targets.vercelTeam },
    independentReview: { reviewerId: '/root/independent_fixture', sha256: H } };
  const acceptance = { json: JSON.stringify(review), sha256: digest(JSON.stringify(review)) };
  const binding = { schemaVersion: 1, kind: 'fcos_vercel_preview_project_writer', ...credential, rootAcceptanceSha256: acceptance.sha256 };
  manifest.verification.vercelPreviewWriterCredential = binding;
  const setup = { schemaVersion: 2, controllerSha: manifest.controller.sha, epoch: manifest.epoch,
    targetsSha256: digest(manifest.targets), verification: manifest.verification, vercelPreviewWriterCredentialAcceptance: acceptance };
  manifest.setupSha256 = digest(setup);
  const env = { FCOS_HOSTED_VERCEL_TOKEN: token, FCOS_HOSTED_VERCEL_TOKEN_ID: binding.tokenId,
    FCOS_HOSTED_CREDENTIAL_CLASS: 'preview', FCOS_HOSTED_ENVIRONMENT: 'fcos-hosted-preview',
    FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(setup),
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: manifest.targets.repository, GITHUB_REPOSITORY_ID: '1278654816',
    GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '1',
    FCOS_CONTROLLER_SHA: manifest.controller.sha };
  return { token, binding, review, acceptance, setup, env };
}

export function admitProductionWriterFixture(manifest, { now = Date.now(), previewFixture } = {}) {
  const token = 'vcp_HERMETIC_PRODUCTION_' + 'y'.repeat(48), H = 'a'.repeat(64);
  const credential = { operationId: 'production-writer-22222222-2222-4222-8222-222222222222', tokenId: 'fixture-production-writer-id',
    name: 'fcos-hosted-production-writer-22222222-2222-4222-8222-222222222222', bearerSha256: digest(token),
    teamId: manifest.targets.vercelTeam, projectId: manifest.targets.vercelProject, createdAt: now - 60000, expiresAt: now + 86400000,
    originalIssuanceResponseSha256: H, exactIdMetadataReadbackSha256: 'b'.repeat(64), issuerUserId: 'fixture-vercel-issuer',
    productionRightsReadbackSha256: 'c'.repeat(64), metadataReadbackAt: now - 45000 };
  const review = { schemaVersion: 1, kind: 'fcos_root_accepted_original_production_writer', accepted: true, reviewerId: '/root',
    operator: 'hocheunglai-oss', reviewedAt: new Date(now - 30000).toISOString(), credential: { ...credential },
    provenance: { originalPlanSha256: H, originalIssuanceIntentSha256: H, originalCustodyReceiptSha256: H,
      metadataAuthority: 'verified_existing_manager_exact_original_id_get', singleTeamScope: manifest.targets.vercelTeam,
      issuerProductionRights: { account: 'hocheunglai-6535', userId: credential.issuerUserId, teamId: credential.teamId,
        projectId: credential.projectId, membershipRole: 'OWNER', confirmed: true, observedAt: new Date(now - 45000).toISOString(),
        readbackSha256: credential.productionRightsReadbackSha256 } },
    independentReview: { reviewerId: '/root/independent_fixture', sha256: H } };
  const acceptance = { json: JSON.stringify(review), sha256: digest(JSON.stringify(review)) };
  const binding = { schemaVersion: 1, kind: 'fcos_vercel_production_project_writer', ...credential, rootAcceptanceSha256: acceptance.sha256 };
  manifest.verification.vercelProductionWriterCredential = binding;
  const setup = { ...(previewFixture?.setup || { schemaVersion: 2, controllerSha: manifest.controller.sha, epoch: manifest.epoch,
    targetsSha256: digest(manifest.targets) }), verification: manifest.verification, vercelProductionWriterCredentialAcceptance: acceptance };
  manifest.setupSha256 = digest(setup);
  const env = { ...previewFixture?.env, FCOS_HOSTED_VERCEL_TOKEN: token, FCOS_HOSTED_VERCEL_TOKEN_ID: binding.tokenId,
    FCOS_HOSTED_CREDENTIAL_CLASS: 'production', FCOS_HOSTED_ENVIRONMENT: 'fcos-hosted-production-resume',
    FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(setup),
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: manifest.targets.repository, GITHUB_REPOSITORY_ID: '1278654816',
    GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '1',
    FCOS_CONTROLLER_SHA: manifest.controller.sha };
  return { token, binding, review, acceptance, setup, env };
}
