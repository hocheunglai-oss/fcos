import { createHash, createPublicKey, verify } from 'node:crypto';
import { FCOS_CONNECTION_POLICY } from '../../config/fcosConnections.js';
import { ENROLLMENT_FIXED_TARGET } from './preview-vercel-enrollment.mjs';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection } from './runtime-compatibility-successor-live.mjs';
import { assertTrustedPreviewEmailIntentRecord } from './preview-email-build.mjs';
import { githubProviderFresh } from './github-provider-timestamp.mjs';

// Human implementation-purpose authority4e2cd1fb... permits this design only.
// Actual key access/signing/publication/claim upload and Preview remain disabled.
export const PREVIEW_COORDINATION_DOMAIN = 'FCOS-EXACT-04EE-COORDINATION-GRANT-V1\0';
export const PREVIEW_COORDINATION_VARIABLE = 'FCOS_PREVIEW_EMAIL_COORDINATION_GRANT';
export const PREVIEW_COORDINATION_FILENAME = 'fcos-preview-email-coordination-claim.json';
export const PREVIEW_COORDINATION_TARGET = ENROLLMENT_FIXED_TARGET;
export const PREVIEW_COORDINATION_CANONICAL = Object.freeze({ helperSha256: '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18',
  epoch: 'production-reconciliation-20261005', objective: 'production', ownerThreadId: '01a0f08b-7fcb-7870-9edc-343e16052b62' });
const LIVE_PROTECTED_ACTIONS_INSTALLED = false;
export function requirePreviewCoordinationProtectedActions() {
  if (!LIVE_PROTECTED_ACTIONS_INSTALLED) throw Object.assign(new Error('Preview coordination protected actions are not installed; source-only authority grants no private reads/signing/publication/upload or Preview.'),
    { code: 'PREVIEW_COORDINATION_PROTECTED_ACTIONS_NOT_INSTALLED' });
}
export const coordinationHash = value => createHash('sha256').update(value).digest('hex');
export const coordinationSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export function coordinationFailure() { throw new Error('Preview coordination failed; retain the canonical lease and original operation for GET-only recovery.'); }
function ordered(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) coordinationFailure();
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
const bindingKeys = ['repositoryId', 'environmentId', 'runId', 'runAttempt', 'workflow', 'dispatchedAt', 'jobId', 'jobStartedAt',
  'intentArtifactId', 'intentArchiveSha256', 'intentSha256', 'operationId', 'requestSha256', 'candidateSha', 'sourceDigest', 'lockHash',
  'candidateGitTree', 'candidateTreeHash', 'harnessSha', 'controlRevision', 'configurationRevision', 'contractSha256',
  'materialHashes', 'reviewedAt', 'provisionedAt', 'intentAt', 'issuanceEnvelopeSha256', 'issuanceObservedAt', 'issuanceExpiresAt'];

/** Preserve the protected variable's exact UTF-8 representation. Parsing never
 * replaces text, byte hash, signed property order or original issuance times.
 * Pure callers may supply an object, but production wrappers require strings. */
export function normalizeCoordinationEnvelope(raw, limit = 32768) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (typeof text !== 'string' || !text.length || Buffer.byteLength(text) > limit) coordinationFailure();
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) coordinationFailure();
  return freeze({ text, sha256: coordinationHash(Buffer.from(text, 'utf8')), value });
}
export function validateCoordinationBinding(raw, now = Date.now()) {
  const b = ordered(raw, bindingKeys), p = SUCCESSOR_LIVE_CONTRACT;
  b.materialHashes = ordered(b.materialHashes, ['context', 'root', 'independent']);
  b.reviewedAt = ordered(b.reviewedAt, ['root', 'independent']);
  if (![b.repositoryId, b.environmentId, b.runId, b.jobId, b.intentArtifactId].every(positive) || b.runAttempt !== 1
    || b.workflow !== ENROLLMENT_FIXED_TARGET.workflow || ['candidateSha', 'sourceDigest', 'lockHash', 'candidateGitTree', 'candidateTreeHash'].some(key => b[key] !== p[key])
    || !/^[a-f0-9]{40}$/.test(b.harnessSha || '') || !b.operationId?.startsWith(`fcos-preview-email-${b.runId}-`)
    || !uuid(b.operationId.slice(`fcos-preview-email-${b.runId}-`.length))
    || ['intentArchiveSha256', 'intentSha256', 'requestSha256', 'controlRevision', 'configurationRevision', 'contractSha256', 'issuanceEnvelopeSha256'].some(key => !hash(b[key]))
    || !Object.values(b.materialHashes).every(hash) || ![b.issuanceObservedAt, b.issuanceExpiresAt].every(positive)
    || b.issuanceObservedAt > now || b.issuanceExpiresAt <= now || b.issuanceExpiresAt <= b.issuanceObservedAt
    || b.issuanceExpiresAt - b.issuanceObservedAt > 600000) coordinationFailure();
  const times = [[b.provisionedAt, 2700000], [b.intentAt, 1800000],
    [b.reviewedAt.root, 1800000], [b.reviewedAt.independent, 1800000]];
  if (times.some(([time, age]) => !iso(time) || Date.parse(time) > now || now - Date.parse(time) > age)
    || ![b.dispatchedAt, b.jobStartedAt].every(time => githubProviderFresh(time, 1800000, now))
    || Date.parse(b.jobStartedAt) < Date.parse(b.dispatchedAt) || Date.parse(b.intentAt) < Date.parse(b.jobStartedAt)
    || Object.values(b.reviewedAt).some(time => Date.parse(time) < Date.parse(b.provisionedAt))) coordinationFailure();
  return freeze(b);
}
export function coordinationDeadline(b) {
  return Math.min(b.issuanceExpiresAt, Date.parse(b.provisionedAt) + 2700000,
    ...[b.dispatchedAt, b.jobStartedAt, b.intentAt, ...Object.values(b.reviewedAt)].map(t => Date.parse(t) + 1800000));
}
export function coordinationLeaseBinding(binding) {
  return coordinationHash(`FCOS-EXACT-04EE-CANONICAL-LEASE-V1\0${JSON.stringify(binding)}`);
}
export function coordinationClaimName(binding) {
  return `fcos-preview-email-consumed-${binding.runId}-${coordinationHash(binding.operationId)}`;
}

/** Data projection only. Genuine admission+original record are necessary here,
 * but only the separate fixed production wrapper can brand a hosted claim. */
export function coordinationBindingFromOriginal({ admission, original, issuanceEnvelope, now = Date.now() } = {}) {
  const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
  const { intent, trust } = assertTrustedPreviewEmailIntentRecord(original, { admission: selected, now });
  const issuance = normalizeCoordinationEnvelope(issuanceEnvelope, 16384), r = issuance.value.receipt, c = r?.context;
  if (selected.runId !== trust.runId || selected.runId !== intent.runId || selected.runAttempt !== trust.runAttempt
    || selected.workflow !== trust.workflow || selected.dispatchedAt !== trust.dispatchedAt || c?.runId !== intent.runId || c.runAttempt !== 1
    || c.operation !== 'create' || c.repositoryId !== trust.repositoryId || !positive(c.environmentId)
    || c.harnessSha !== selected.harnessSha || c.candidateSha !== selected.candidate.sha || c.controlRevision !== intent.controlRevision
    || c.contractSha256 !== selected.contractSha256 || r.observedAt !== r.issuedAt) coordinationFailure();
  return validateCoordinationBinding({ repositoryId: trust.repositoryId, environmentId: c.environmentId, runId: intent.runId, runAttempt: 1,
    workflow: selected.workflow, dispatchedAt: trust.dispatchedAt, jobId: trust.jobId, jobStartedAt: trust.jobStartedAt,
    intentArtifactId: trust.artifactId, intentArchiveSha256: trust.archiveDigest, intentSha256: coordinationHash(JSON.stringify(intent)),
    operationId: intent.operationId, requestSha256: intent.requestSha256, candidateSha: selected.candidate.sha,
    sourceDigest: selected.candidate.sourceDigest, lockHash: selected.candidate.lockHash, candidateGitTree: SUCCESSOR_LIVE_CONTRACT.candidateGitTree,
    candidateTreeHash: SUCCESSOR_LIVE_CONTRACT.candidateTreeHash, harnessSha: selected.harnessSha, controlRevision: intent.controlRevision,
    configurationRevision: selected.context.configurationRevision, contractSha256: selected.contractSha256,
    materialHashes: selected.materialHashes, reviewedAt: selected.reviewedAt, provisionedAt: selected.context.provisionedAt, intentAt: intent.intentAt,
    issuanceEnvelopeSha256: issuance.sha256, issuanceObservedAt: r.observedAt, issuanceExpiresAt: r.expiresAt }, now);
}
export function validateCoordinationLease(raw, binding) {
  const lease = ordered(raw, ['epoch', 'objective', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId',
    'coordinationOnly', 'providerAuthorityGranted', 'uncertainOutcomeRequiresReadback']);
  if (['epoch', 'objective', 'ownerThreadId'].some(key => lease[key] !== PREVIEW_COORDINATION_CANONICAL[key])
    || lease.operationId !== binding.operationId || lease.bindingSha256 !== coordinationLeaseBinding(binding) || !uuid(lease.leaseId)
    || lease.coordinationOnly !== true || lease.providerAuthorityGranted !== false || lease.uncertainOutcomeRequiresReadback !== true) coordinationFailure();
  return lease;
}
/** Pure grant construction/verification are deliberately unbranded. Fixture
 * keys and clocks can validate data, never enter the production capability set. */
export function coordinationGrantData({ binding, lease, consumptionSha256, issuedAt, expiresAt }) {
  const b = validateCoordinationBinding(binding, issuedAt);
  if (!hash(consumptionSha256) || !positive(issuedAt) || !positive(expiresAt) || expiresAt <= issuedAt
    || expiresAt > Math.min(issuedAt + 600000, coordinationDeadline(b)) || issuedAt < Math.max(b.issuanceObservedAt, Date.parse(b.intentAt))) coordinationFailure();
  return { schemaVersion: 1, kind: 'fcos_exact_04ee_coordination_grant', keyId: FCOS_CONNECTION_POLICY.attestation.keyId,
    target: ENROLLMENT_FIXED_TARGET, binding: b, helperSha256: PREVIEW_COORDINATION_CANONICAL.helperSha256,
    lease: validateCoordinationLease(lease, b), consumptionSha256, issuedAt, expiresAt,
    coordinationOnly: true, productionAuthorized: false };
}
export function coordinationGrantMessage(grant) { return Buffer.from(`${PREVIEW_COORDINATION_DOMAIN}${JSON.stringify(grant)}`); }
export function verifyCoordinationGrantData({ envelope, expected, now = Date.now(), publicKeySpkiBase64 = FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64 } = {}) {
  try {
    const parsed = normalizeCoordinationEnvelope(envelope), wrapped = ordered(parsed.value, ['grant', 'signature']);
    const g = ordered(wrapped.grant, ['schemaVersion', 'kind', 'keyId', 'target', 'binding', 'helperSha256', 'lease', 'consumptionSha256',
      'issuedAt', 'expiresAt', 'coordinationOnly', 'productionAuthorized']);
    const canonical = coordinationGrantData(g);
    if (!coordinationSame(g, canonical) || !coordinationSame(g.binding, validateCoordinationBinding(expected, now))
      || g.issuedAt > now || g.expiresAt <= now) coordinationFailure();
    const signature = Buffer.from(wrapped.signature, 'base64url');
    if (signature.length !== 64 || signature.toString('base64url') !== wrapped.signature) coordinationFailure();
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiBase64, 'base64'), type: 'spki', format: 'der' });
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, coordinationGrantMessage(canonical), key, signature)) coordinationFailure();
    return freeze({ grant: canonical, envelopeText: parsed.text, envelopeSha256: parsed.sha256 });
  } catch { coordinationFailure(); }
}
