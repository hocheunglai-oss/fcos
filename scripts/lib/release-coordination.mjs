import { createHash, createPublicKey, verify } from 'node:crypto';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';
import { assertReleaseReceiptBinding } from './release-readiness.mjs';
import { PREVIEW_COORDINATION_CANONICAL } from './preview-email-coordination.mjs';

export const RELEASE_COORDINATION_DOMAIN = 'FCOS-PRODUCTION-COORDINATION-GRANT-V1\0';
export const RELEASE_COORDINATION_FILE = 'fcos-preview-email-coordination-claim.json'; // Reuse the reviewed bounded ZIP format.
export const RELEASE_COORDINATION_ENABLE = 'FCOS_RELEASE_COORDINATION_ENABLED';
export const RELEASE_COORDINATION_ROUTES = Object.freeze({
  production: Object.freeze({ workflow: '.github/workflows/production-release.yml', environment: 'fcos-production-release', job: 'production' }),
  compatibility: Object.freeze({ workflow: '.github/workflows/runtime-compatibility-release.yml', environment: 'fcos-runtime-compatibility-release', job: 'preflight' }),
});
export const coordinationDigest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const coordinationEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function releaseCoordinationFailure() { throw new Error('Release coordination unavailable; retain the original operation and canonical lease for read-only recovery.'); }
const need = value => { if (!value) releaseCoordinationFailure(); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const deployment = value => typeof value === 'string' && /^dpl_[A-Za-z0-9]+$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const exact = (v, keys) => { need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))); return Object.fromEntries(keys.map(k => [k, v[k]])); };
const origin = value => { try { return canonicalFcosE2eCandidateUrl(value) === value; } catch { return false; } };
const frozen = v => { if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v); } return v; };
export function releaseCoordinationDeadline(b) { return Math.min(b.dispatchedAt + 1800000, b.jobStartedAt + 1800000, b.intentAt + 1800000, b.readinessAt + 1800000, b.evidenceExpiresAt); }
export function validateReleaseCoordinationBinding(raw, now = Date.now()) {
  const b = exact(raw, ['schemaVersion', 'route', 'repositoryId', 'environmentId', 'runId', 'runAttempt', 'jobId', 'harnessSha',
    'operationId', 'dispatchedAt', 'jobStartedAt', 'intentAt', 'readinessAt', 'evidenceExpiresAt', 'candidate', 'previousProduction', 'readinessSha256']);
  b.candidate = exact(b.candidate, ['sha', 'sourceDigest', 'lockHash', 'configurationRevision', 'deploymentId', 'url']);
  b.previousProduction = exact(b.previousProduction, ['deploymentId', 'sha', 'url']);
  need(b.schemaVersion === 1 && Object.hasOwn(RELEASE_COORDINATION_ROUTES, b.route) && b.runAttempt === 1
    && [b.repositoryId, b.environmentId, b.runId, b.jobId].every(positive) && sha(b.harnessSha)
    && b.operationId === `fcos-release-${b.runId}` && sha(b.candidate.sha) && sha(b.previousProduction.sha)
    && ['sourceDigest', 'lockHash', 'configurationRevision'].every(k => hash(b.candidate[k])) && hash(b.readinessSha256)
    && deployment(b.candidate.deploymentId) && deployment(b.previousProduction.deploymentId)
    && b.candidate.deploymentId !== b.previousProduction.deploymentId && origin(b.candidate.url) && origin(b.previousProduction.url)
    && [b.dispatchedAt, b.jobStartedAt, b.intentAt, b.readinessAt].every(t => positive(t) && t <= now + 30000)
    && b.jobStartedAt >= b.dispatchedAt && b.intentAt >= b.jobStartedAt && b.intentAt >= b.readinessAt
    && positive(b.evidenceExpiresAt) && b.evidenceExpiresAt <= b.readinessAt + 1800000 && releaseCoordinationDeadline(b) > now);
  return frozen(b);
}
export function releaseCoordinationLeaseHash(b) { return coordinationDigest(`FCOS-PRODUCTION-CANONICAL-LEASE-V1\0${JSON.stringify(b)}`); }
export const releaseCoordinationVariable = b => `FCOS_RELEASE_COORDINATION_${b.runId}`;
export const releaseCoordinationArtifact = (b, phase) => { need(['intent', 'consumed'].includes(phase)); return `fcos-release-coordination-${phase}-${b.runId}`; };
export function releaseCoordinationGrantData(raw) {
  const g = exact(raw, ['schemaVersion', 'kind', 'keyId', 'repository', 'teamId', 'projectId', 'binding', 'intentArtifactId',
    'intentArchiveSha256', 'lease', 'consumptionSha256', 'issuedAt', 'expiresAt', 'coordinationOnly', 'providerAuthorityGranted']);
  g.binding = validateReleaseCoordinationBinding(g.binding, g.issuedAt);
  g.lease = exact(g.lease, ['epoch', 'objective', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId', 'coordinationOnly', 'providerAuthorityGranted', 'uncertainOutcomeRequiresReadback']);
  need(g.schemaVersion === 1 && g.kind === 'fcos_production_coordination_grant' && g.keyId === FCOS_CONNECTION_POLICY.attestation.keyId
    && g.repository === fcosConnectionIdentifier('github', 'Repository') && g.teamId === fcosConnectionIdentifier('vercel', 'Team ID')
    && g.projectId === fcosConnectionIdentifier('vercel', 'Project ID') && positive(g.intentArtifactId) && hash(g.intentArchiveSha256)
    && ['epoch', 'objective', 'ownerThreadId'].every(k => g.lease[k] === PREVIEW_COORDINATION_CANONICAL[k])
    && g.lease.operationId === g.binding.operationId && g.lease.bindingSha256 === releaseCoordinationLeaseHash(g.binding)
    && uuid(g.lease.leaseId) && g.lease.coordinationOnly === true && g.lease.providerAuthorityGranted === false
    && g.lease.uncertainOutcomeRequiresReadback === true && hash(g.consumptionSha256)
    && positive(g.issuedAt) && positive(g.expiresAt) && g.issuedAt >= g.binding.intentAt && g.expiresAt > g.issuedAt
    && g.expiresAt <= releaseCoordinationDeadline(g.binding) && g.coordinationOnly === true && g.providerAuthorityGranted === false);
  return frozen(g);
}
export const releaseCoordinationMessage = grant => Buffer.from(`${RELEASE_COORDINATION_DOMAIN}${JSON.stringify(grant)}`);
/** Pure verifier; only the fixed hosted collector below may create a live capability. */
export function verifyReleaseCoordinationGrant(text, expected, now = Date.now(), publicKey = FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64) {
  try {
    need(typeof text === 'string' && Buffer.byteLength(text) <= 32768);
    const wrapper = exact(JSON.parse(text), ['grant', 'signature']), grant = releaseCoordinationGrantData(wrapper.grant);
    need(coordinationEqual(grant, wrapper.grant) && coordinationEqual(grant.binding, validateReleaseCoordinationBinding(expected, now)) && grant.issuedAt <= now && grant.expiresAt > now);
    const signature = Buffer.from(wrapper.signature, 'base64url'), key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' });
    need(signature.length === 64 && signature.toString('base64url') === wrapper.signature && key.asymmetricKeyType === 'ed25519'
      && verify(null, releaseCoordinationMessage(grant), key, signature));
    return frozen({ grant, envelopeSha256: coordinationDigest(text) });
  } catch { releaseCoordinationFailure(); }
}

/** Recollection must prove the same evidence while retaining the original lease clock. */
export function retainReleaseCoordinationReadiness(original, refreshed, now = Date.now()) {
  assertReleaseReceiptBinding(original, original?.candidate, { now });
  assertReleaseReceiptBinding(refreshed, original.candidate, { now });
  need(Date.parse(refreshed.capturedAt) >= Date.parse(original.capturedAt)
    && coordinationEqual({ ...refreshed, capturedAt: original.capturedAt }, original));
  return original;
}

export function releaseCoordinationEvidenceDeadline(readiness, now = Date.now()) {
  assertReleaseReceiptBinding(readiness, readiness?.candidate, { now });
  need(Array.isArray(readiness.trustedEvidence) && readiness.trustedEvidence.length === 2
    && ['restricted_browser', 'normal_role'].every(kind => readiness.trustedEvidence.filter(row => row.kind === kind).length === 1));
  const times = [readiness.quality?.capturedAt, ...readiness.trustedEvidence.map(row => row.capturedAt)].map(Date.parse);
  need(times.every(value => Number.isFinite(value) && value <= now && value + 1800000 > now));
  return Math.min(...times) + 1800000;
}
