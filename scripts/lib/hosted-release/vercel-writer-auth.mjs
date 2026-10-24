import { createHash, timingSafeEqual } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { ReleaseError } from './json-contract.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fields = ['operationId', 'tokenId', 'name', 'bearerSha256', 'teamId', 'projectId', 'createdAt', 'expiresAt',
  'originalIssuanceResponseSha256', 'exactIdMetadataReadbackSha256'];
function need(value, code = 'VERCEL_WRITER_CREDENTIAL_BINDING') {
  if (!value) throw new ReleaseError(code, 'vercel.preview', 'Correct the existing Preview credential binding through its original owner; do not retry a provider write.');
}

// Project writers cannot introspect /user/tokens. This explicit original-issuer
// contract replaces that unsupported capability only for the Preview writer.
export function validateVercelPreviewWriterBinding(binding, { targets, now = Date.now() } = {}) {
  need(exact(binding, ['schemaVersion', 'kind', ...fields, 'rootAcceptanceSha256'])
    && binding.schemaVersion === 1 && binding.kind === 'fcos_vercel_preview_project_writer'
    && /^preview-writer-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(binding.operationId)
    && /^[A-Za-z0-9_-]{1,200}$/.test(binding.tokenId) && binding.tokenId !== 'current' && !binding.tokenId.startsWith('vcp_')
    && binding.name === `fcos-hosted-preview-writer-${binding.operationId.slice(15)}`
    && ['bearerSha256', 'originalIssuanceResponseSha256', 'exactIdMetadataReadbackSha256', 'rootAcceptanceSha256'].every(key => hash(binding[key]))
    && binding.teamId === targets?.vercelTeam && binding.teamId === fcosConnectionIdentifier('vercel', 'Team ID')
    && binding.projectId === targets?.vercelProject && binding.projectId === fcosConnectionIdentifier('vercel', 'Project ID')
    && Number.isSafeInteger(binding.createdAt) && binding.createdAt > 0 && binding.createdAt <= now + 30000
    && Number.isSafeInteger(binding.expiresAt) && binding.expiresAt > now && binding.expiresAt > binding.createdAt
    && binding.expiresAt - binding.createdAt <= 31 * 86400000);
  return binding;
}

export function validateVercelPreviewWriterAcceptance(binding, setup, options) {
  validateVercelPreviewWriterBinding(binding, options);
  const reference = setup?.vercelPreviewWriterCredentialAcceptance;
  need(exact(reference, ['json', 'sha256']) && typeof reference.json === 'string' && Buffer.byteLength(reference.json) <= 32768
    && reference.sha256 === binding.rootAcceptanceSha256 && digest(reference.json) === reference.sha256, 'VERCEL_WRITER_ORIGINAL_PROOF_REQUIRED');
  let review; try { review = JSON.parse(reference.json); } catch { need(false, 'VERCEL_WRITER_ORIGINAL_PROOF_REQUIRED'); }
  need(exact(review, ['schemaVersion', 'kind', 'accepted', 'reviewerId', 'operator', 'reviewedAt', 'credential', 'provenance', 'independentReview'])
    && review.schemaVersion === 1 && review.kind === 'fcos_root_accepted_original_preview_writer' && review.accepted === true
    && review.reviewerId === '/root' && review.operator === fcosConnectionIdentifier('github', 'Required account')
    && Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) >= binding.createdAt - 30000
    && Date.parse(review.reviewedAt) <= (options?.now ?? Date.now()) + 30000
    && exact(review.credential, fields) && fields.every(key => review.credential[key] === binding[key])
    && exact(review.provenance, ['originalPlanSha256', 'originalIssuanceIntentSha256', 'originalCustodyReceiptSha256', 'metadataAuthority', 'singleTeamScope'])
    && ['originalPlanSha256', 'originalIssuanceIntentSha256', 'originalCustodyReceiptSha256'].every(key => hash(review.provenance[key]))
    && review.provenance.metadataAuthority === 'verified_existing_manager_exact_original_id_get'
    && review.provenance.singleTeamScope === binding.teamId
    && exact(review.independentReview, ['reviewerId', 'sha256'])
    && typeof review.independentReview.reviewerId === 'string' && /^\/root\/[^\s]{1,180}$/.test(review.independentReview.reviewerId)
    && hash(review.independentReview.sha256), 'VERCEL_WRITER_ORIGINAL_PROOF_REQUIRED');
  return review;
}

export function assertVercelPreviewWriterSecret(binding, { targets, env = process.env, now = Date.now() } = {}) {
  validateVercelPreviewWriterBinding(binding, { targets, now });
  need(env.FCOS_HOSTED_CREDENTIAL_CLASS === 'preview' && env.FCOS_HOSTED_ENVIRONMENT === 'fcos-hosted-preview', 'VERCEL_WRITER_CONTEXT');
  const token = env.FCOS_HOSTED_VERCEL_TOKEN;
  need(typeof token === 'string' && /^vcp_[A-Za-z0-9_-]{28,4092}$/.test(token)
    && env.FCOS_HOSTED_VERCEL_TOKEN_ID === binding.tokenId, 'VERCEL_WRITER_CREDENTIAL_SUBSTITUTED');
  need(timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(binding.bearerSha256, 'hex')), 'VERCEL_WRITER_CREDENTIAL_SUBSTITUTED');
  return binding;
}

// Separate Production authority: original issuer metadata and membership are
// setup evidence, never a claim that the restricted bearer can introspect them.
const productionFields = [...fields, 'issuerUserId', 'productionRightsReadbackSha256', 'metadataReadbackAt'];
function productionNeed(value, code = 'VERCEL_PRODUCTION_WRITER_CREDENTIAL_BINDING') {
  if (!value) throw new ReleaseError(code, 'vercel.production', 'Correct the existing Production credential binding through its original owner; do not retry a provider write.');
}
export function validateVercelProductionWriterBinding(binding, { targets, previewBinding, now = Date.now() } = {}) {
  productionNeed(exact(binding, ['schemaVersion', 'kind', ...productionFields, 'rootAcceptanceSha256'])
    && binding.schemaVersion === 1 && binding.kind === 'fcos_vercel_production_project_writer'
    && /^production-writer-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(binding.operationId)
    && typeof binding.tokenId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(binding.tokenId) && binding.tokenId !== 'current' && !binding.tokenId.startsWith('vcp_')
    && binding.name === `fcos-hosted-production-writer-${binding.operationId.slice(18)}`
    && ['bearerSha256', 'originalIssuanceResponseSha256', 'exactIdMetadataReadbackSha256', 'rootAcceptanceSha256',
      'productionRightsReadbackSha256'].every(key => hash(binding[key]))
    && typeof binding.issuerUserId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(binding.issuerUserId)
    && binding.teamId === targets?.vercelTeam && binding.teamId === fcosConnectionIdentifier('vercel', 'Team ID')
    && binding.projectId === targets?.vercelProject && binding.projectId === fcosConnectionIdentifier('vercel', 'Project ID')
    && Number.isSafeInteger(binding.createdAt) && binding.createdAt > 0 && binding.createdAt <= now + 30000
    && Number.isSafeInteger(binding.expiresAt) && binding.expiresAt > now && binding.expiresAt > binding.createdAt
    && binding.expiresAt - binding.createdAt <= 31 * 86400000
    && Number.isSafeInteger(binding.metadataReadbackAt) && binding.metadataReadbackAt >= binding.createdAt
    && binding.metadataReadbackAt <= now + 30000);
  productionNeed(!previewBinding || (binding.tokenId !== previewBinding.tokenId
    && binding.bearerSha256 !== previewBinding.bearerSha256), 'VERCEL_WRITER_CREDENTIALS_NOT_SEPARATE');
  return binding;
}

export function validateVercelProductionWriterAcceptance(binding, setup, options) {
  validateVercelProductionWriterBinding(binding, options);
  const reference = setup?.vercelProductionWriterCredentialAcceptance;
  productionNeed(exact(reference, ['json', 'sha256']) && typeof reference.json === 'string' && Buffer.byteLength(reference.json) <= 32768
    && reference.sha256 === binding.rootAcceptanceSha256 && digest(reference.json) === reference.sha256,
  'VERCEL_PRODUCTION_WRITER_ORIGINAL_PROOF_REQUIRED');
  let review; try { review = JSON.parse(reference.json); } catch { productionNeed(false, 'VERCEL_PRODUCTION_WRITER_ORIGINAL_PROOF_REQUIRED'); }
  const rights = review?.provenance?.issuerProductionRights;
  const reviewedAt = Date.parse(review?.reviewedAt), observedAt = Date.parse(rights?.observedAt);
  productionNeed(exact(review, ['schemaVersion', 'kind', 'accepted', 'reviewerId', 'operator', 'reviewedAt', 'credential', 'provenance', 'independentReview'])
    && review.schemaVersion === 1 && review.kind === 'fcos_root_accepted_original_production_writer' && review.accepted === true
    && review.reviewerId === '/root' && review.operator === fcosConnectionIdentifier('github', 'Required account')
    && Number.isFinite(reviewedAt) && reviewedAt >= binding.metadataReadbackAt && reviewedAt >= binding.createdAt
    && reviewedAt <= (options?.now ?? Date.now()) + 30000
    && exact(review.credential, productionFields) && productionFields.every(key => review.credential[key] === binding[key])
    && exact(review.provenance, ['originalPlanSha256', 'originalIssuanceIntentSha256', 'originalCustodyReceiptSha256',
      'metadataAuthority', 'singleTeamScope', 'issuerProductionRights'])
    && ['originalPlanSha256', 'originalIssuanceIntentSha256', 'originalCustodyReceiptSha256'].every(key => hash(review.provenance[key]))
    && review.provenance.metadataAuthority === 'verified_existing_manager_exact_original_id_get'
    && review.provenance.singleTeamScope === binding.teamId
    && exact(review.independentReview, ['reviewerId', 'sha256'])
    && typeof review.independentReview.reviewerId === 'string' && /^\/root\/[^\s]{1,180}$/.test(review.independentReview.reviewerId)
    && hash(review.independentReview.sha256), 'VERCEL_PRODUCTION_WRITER_ORIGINAL_PROOF_REQUIRED');
  productionNeed(exact(rights, ['account', 'userId', 'teamId', 'projectId', 'membershipRole', 'confirmed', 'observedAt', 'readbackSha256'])
    && rights.account === fcosConnectionIdentifier('vercel', 'Account') && rights.userId === binding.issuerUserId
    && rights.teamId === binding.teamId && rights.projectId === binding.projectId && rights.confirmed === true
    && ['OWNER', 'MEMBER'].includes(rights.membershipRole)
    && rights.readbackSha256 === binding.productionRightsReadbackSha256
    && Number.isFinite(observedAt) && observedAt >= binding.createdAt - 30000 && observedAt <= binding.createdAt + 300000
    && reviewedAt >= observedAt, 'VERCEL_PRODUCTION_WRITER_RIGHTS_PROOF_REQUIRED');
  return review;
}

export function assertVercelProductionWriterSecret(binding, { targets, previewBinding, stage, executionMode,
  env = process.env, now = Date.now() } = {}) {
  validateVercelProductionWriterBinding(binding, { targets, previewBinding, now });
  productionNeed(['compatibility', 'application'].includes(stage) && executionMode === 'release'
    && env.FCOS_HOSTED_CREDENTIAL_CLASS === 'production' && env.FCOS_HOSTED_ENVIRONMENT === 'fcos-hosted-production-resume'
    && env.FCOS_QUALIFICATION_BOOTSTRAP !== 'true', 'VERCEL_PRODUCTION_WRITER_CONTEXT');
  const token = env.FCOS_HOSTED_VERCEL_TOKEN;
  productionNeed(typeof token === 'string' && /^vcp_[A-Za-z0-9_-]{28,4092}$/.test(token)
    && env.FCOS_HOSTED_VERCEL_TOKEN_ID === binding.tokenId, 'VERCEL_PRODUCTION_WRITER_CREDENTIAL_SUBSTITUTED');
  productionNeed(timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(binding.bearerSha256, 'hex')),
    'VERCEL_PRODUCTION_WRITER_CREDENTIAL_SUBSTITUTED');
  return binding;
}
