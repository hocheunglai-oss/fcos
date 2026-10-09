import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection } from './runtime-compatibility-successor-live.mjs';
import { ENROLLMENT_FIXED_TARGET } from './preview-vercel-enrollment.mjs';

// This consumer selects only the existing issuance-receipt purpose/domain.
// It contains no coordination signature, token issuance or provider adapter.
export const SUCCESSOR_ATTEST_PURPOSE = 'existing-preview-vercel-run-authority-exact04ee-v1';
export const SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18';
const policy = SUCCESSOR_LIVE_CONTRACT;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = () => { throw new Error('Exact successor attestation admission failed; private diagnostics suppressed.'); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function successorAttestationPlan() {
  return { schemaVersion: 1, kind: 'fcos_exact_04ee_existing_receipt_attestation_plan', enabledByDefault: false,
    implementedThrough: 'pure approval, genuine source/material admission and fixed public GitHub preflight',
    target: ENROLLMENT_FIXED_TARGET, purpose: SUCCESSOR_ATTEST_PURPOSE, providerCalls: 0, privateReads: 0,
    publicationInstalled: false, previewAuthorized: false, productionAuthorized: false,
    blocker: 'Actual canonical publication admission and permanent exact publication intent are not installed.' };
}

/** Runs before even constructing authenticated collectors. A personal approval
 * does not become an opaque source/material admission or a canonical lease. */
export function assertSuccessorAttestationApproval({ approval: value, nonce, scriptSha256, now = Date.now() } = {}) {
  const keys = ['schemaVersion', 'action', 'purpose', 'authorized', 'authorizedBy', 'authorizationEvidence', 'authorizedAt',
    'attestorNewPurposeAuthorized', 'scriptSha256', 'canonicalHelperSha256', 'nonce', 'target', 'candidateSha', 'sourceDigest',
    'lockHash', 'harnessSha', 'controlRevision', 'configurationRevision', 'contractSha256', 'enrollmentId', 'tokenId',
    'expiresAt', 'leaseDeadline', 'runId', 'runAttempt', 'operation', 'secretMetadata'];
  if (!exact(value, keys) || value.schemaVersion !== 1 || value.action !== 'attest' || value.purpose !== SUCCESSOR_ATTEST_PURPOSE
    || value.authorized !== true || value.authorizedBy !== fcosConnectionIdentifier('github', 'Required account')
    || typeof value.authorizationEvidence !== 'string' || !value.authorizationEvidence.trim() || value.authorizationEvidence.length > 2048
    || !positive(value.authorizedAt) || value.authorizedAt > now || now - value.authorizedAt > 3600000
    || value.attestorNewPurposeAuthorized !== true || !hash(scriptSha256) || value.scriptSha256 !== scriptSha256
    || value.canonicalHelperSha256 !== SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256
    || !uuid(nonce) || value.nonce !== nonce || !uuid(value.enrollmentId) || !same(value.target, ENROLLMENT_FIXED_TARGET)
    || value.candidateSha !== policy.candidateSha || value.sourceDigest !== policy.sourceDigest || value.lockHash !== policy.lockHash
    || !sha(value.harnessSha) || ![value.controlRevision, value.configurationRevision, value.contractSha256].every(hash)
    || !/^[A-Za-z0-9_-]{1,200}$/.test(value.tokenId || '') || value.tokenId === 'current'
    || ![value.expiresAt, value.leaseDeadline, value.runId].every(positive) || value.runAttempt !== 1
    || value.expiresAt <= now || value.expiresAt > value.leaseDeadline || value.expiresAt - now > 86400000
    || !['verify-authority', 'create', 'readback'].includes(value.operation)
    || !Array.isArray(value.secretMetadata) || value.secretMetadata.length !== 3) fail();
  const names = new Set();
  for (const row of value.secretMetadata) {
    if (!exact(row, ['name', 'created_at', 'updated_at'])
      || !['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT'].includes(row.name) || names.has(row.name)
      || !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at))
      || Date.parse(row.created_at) > Date.parse(row.updated_at) || Date.parse(row.updated_at) > now) fail();
    names.add(row.name);
  }
  return value;
}

export function bindSuccessorAttestationAdmission({ approval, nonce, scriptSha256, admission, now = Date.now() } = {}) {
  const value = assertSuccessorAttestationApproval({ approval, nonce, scriptSha256, now });
  const selected = successorLiveSelection(admission, policy.candidateSha, now);
  if (selected.workflow !== ENROLLMENT_FIXED_TARGET.workflow || selected.runId !== value.runId
    || selected.harnessSha !== value.harnessSha || selected.contractSha256 !== value.contractSha256
    || selected.context.previewControlRevision !== value.controlRevision
    || selected.context.configurationRevision !== value.configurationRevision) fail();
  return selected;
}

/** This is deliberately unconditional until an accepted actual canonical
 * admission exists. Caller booleans, callbacks, signed data and runner locks
 * cannot install the absent boundary or expose any private/publication method. */
export function requireSuccessorAttestationPublicationAdmission() {
  throw Object.assign(new Error('Exact successor attestation requires actual canonical publication admission; no private reads or publication performed.'),
    { code: 'EXACT_SUCCESSOR_CANONICAL_PUBLICATION_ADMISSION_REQUIRED' });
}

export async function runSuccessorAttestationAdmission({ action = 'plan', approval, nonce, scriptSha256,
  collectAdmission, preflightFixedReads, now = () => Date.now() } = {}) {
  if (action === 'plan') return successorAttestationPlan();
  if (action !== 'attest') fail();
  const originalApproval = freeze(structuredClone(assertSuccessorAttestationApproval({ approval, nonce, scriptSha256, now: now() })));
  try {
    const admission = await collectAdmission();
    bindSuccessorAttestationAdmission({ approval: originalApproval, nonce, scriptSha256, admission, now: now() });
    await preflightFixedReads(originalApproval, admission);
    bindSuccessorAttestationAdmission({ approval: originalApproval, nonce, scriptSha256, admission, now: now() });
  } catch { fail(); }
  requireSuccessorAttestationPublicationAdmission();
}
