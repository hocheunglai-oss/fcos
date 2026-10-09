import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { previewEmailSignerEvidenceVerified } from './preview-email-signer.mjs';
import { assertPreviewEmailBuildReceipt, collectTrustedPreviewEmailBuild, collectPreviewEmailEnvironmentRecords } from './preview-email-build.mjs';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection, successorEmailContract, successorLiveBinding } from './runtime-compatibility-successor-live.mjs';
import { successorLiveNormalCoverageVerified } from './runtime-compatibility-successor-adapter.mjs';

const contractBytes = readFileSync(new URL('../../config/legacy-email-baseline-proof.json', import.meta.url));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const LEGACY_EMAIL_BASELINE_CONTRACT = freeze(JSON.parse(contractBytes));
export const LEGACY_EMAIL_BASELINE_CONTRACT_HASH = createHash('sha256').update(contractBytes).digest('hex');
const contract = LEGACY_EMAIL_BASELINE_CONTRACT;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const time = value => typeof value === 'number' ? value : Date.parse(value);
const fresh = (value, now) => Number.isFinite(time(value)) && time(value) <= now && now - time(value) <= 1800000;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = () => { throw new Error('Retained Production email proof is unavailable or outside its reviewed scope.'); };
export const legacyEmailCandidate = (sha, { admission, now = Date.now() } = {}) => sha === SUCCESSOR_LIVE_CONTRACT.candidateSha
  ? successorLiveSelection(admission, sha, now).candidate : contract.preview.candidates.find(row => row.sha === sha) || null;

function assertRecords(records, now) {
  if (!exact(records, ['capturedAt', 'projectId', 'teamId', 'complete', 'records']) || records.complete !== true
    || records.projectId !== fcosConnectionIdentifier('vercel', 'Project ID') || records.teamId !== fcosConnectionIdentifier('vercel', 'Team ID')
    || !fresh(records.capturedAt, now) || !Array.isArray(records.records) || !records.records.length
    || records.records.some(row => !exact(row, ['id', 'key', 'type', 'target', 'gitBranch', 'createdAt', 'updatedAt', 'comment'])
      || typeof row.id !== 'string' || !row.id || !/^[A-Z][A-Z0-9_]{0,127}$/.test(row.key || '')
      || !Array.isArray(row.target) || !row.target.length || new Set(row.target).size !== row.target.length
      || row.target.some(target => !['production', 'preview', 'development'].includes(target))
      || !['plain', 'encrypted', 'sensitive', 'secret', 'system'].includes(row.type)
      || !(row.gitBranch === null || typeof row.gitBranch === 'string') || !(row.comment === null || typeof row.comment === 'string')
      || !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < row.createdAt
      || row.updatedAt > now) || new Set(records.records.map(row => row.id)).size !== records.records.length) fail();
}

/** Pure validation. Release entrypoints must obtain build and normal-role proofs
 * from protected workflow archives and records from fresh target-locked reads.
 * This accepts a historical limitation; it never establishes old value equality.
 */
export function assertLegacyEmailBaselineProof({ proof, production, candidate, sourceDigest, normal, admission, now = Date.now() } = {}) {
  const selectedContract = candidate?.sha === SUCCESSOR_LIVE_CONTRACT.candidateSha ? successorEmailContract(admission, now).contract : contract;
  if (!exact(proof, ['schemaVersion', 'contractId', 'capturedAt', 'records', 'build', 'signer']) || proof.schemaVersion !== 1
    || proof.contractId !== contract.id || !fresh(proof.capturedAt, now)
    || production?.id !== contract.baseline.deploymentId || production.sha !== contract.baseline.sha || production.url !== contract.baseline.url
    || production.target !== 'production' || production.state !== 'READY') fail();
  const pin = legacyEmailCandidate(candidate?.sha, { admission, now });
  if (!pin || sourceDigest !== pin.sourceDigest || candidate.target !== 'preview' || candidate.state !== 'READY'
    || normal?.kind !== 'normal_role' || normal.sha !== pin.sha || normal.deploymentId !== candidate.id || normal.sourceDigest !== sourceDigest
    || !/^[0-9a-f]{40}$/.test(normal.harnessSha || '') || !hash(normal.archiveDigest) || !positive(normal.runId) || !positive(normal.artifactId)
    || !fresh(normal.capturedAt, now)) fail();
  if (pin.sha === SUCCESSOR_LIVE_CONTRACT.candidateSha) {
    successorLiveBinding(admission, { sha: pin.sha, sourceDigest, harnessSha: normal.harnessSha }, now);
    if (!successorLiveNormalCoverageVerified({ admission, normal, candidate, now })) fail();
  }
  assertRecords(proof.records, now);
  for (const key of contract.historicalKeys) {
    const rows = proof.records.records.filter(row => row.key === key && row.target.includes('production'));
    const expected = contract.baseline.records[key], row = rows[0];
    if (rows.length !== 1 || row.id !== expected.id || row.type !== 'sensitive' || row.gitBranch !== null
      || row.target.length !== 1 || row.createdAt !== expected.createdAt || row.updatedAt !== expected.updatedAt
      || row.updatedAt > time(production.createdAt)) fail();
    const previewRows = proof.records.records.filter(row => row.key === key && row.target.includes('preview') && row.gitBranch === pin.branch);
    const preview = previewRows[0], expectedId = key === 'FCOS_MICROSOFT_TENANT_ID' ? pin.tenantRecordId
      : key === 'FCOS_MICROSOFT_CLIENT_ID' ? pin.clientRecordId : pin.attachmentRecordId;
    if (previewRows.length !== 1 || preview.id !== expectedId || preview.target.length !== 1
      || preview.type !== (key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' ? 'sensitive' : 'plain')
      || preview.updatedAt > time(candidate.createdAt) || preview.id === row.id) fail();
    if (key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET'
      && preview.comment !== `Dedicated read-only Preview signing key ${selectedContract.preview.attachmentOperationId}; no Production credential copied`) fail();
  }
  if (!exact(proof.build, ['receipt', 'trust']) || !exact(proof.build.trust, ['runId', 'artifactId', 'harnessSha', 'archiveDigest', 'capturedAt'])
    || !positive(proof.build.trust.runId) || !positive(proof.build.trust.artifactId) || !hash(proof.build.trust.archiveDigest)
    || proof.build.trust.harnessSha !== normal.harnessSha || !fresh(proof.build.trust.capturedAt, now)) fail();
  assertPreviewEmailBuildReceipt({ receipt: proof.build.receipt, records: proof.records,
    binding: { sha: pin.sha, sourceDigest, lockHash: pin.lockHash, deploymentId: candidate.id, candidateUrl: candidate.url, harnessSha: normal.harnessSha }, admission, now });
  if (pin.sha === SUCCESSOR_LIVE_CONTRACT.candidateSha && proof.build.trust.capturedAt !== proof.build.receipt.capturedAt) fail();
  previewEmailSignerEvidenceVerified(proof.signer, { deployment: candidate, sourceDigest, admission, now });
  if (JSON.stringify(proof.signer) !== JSON.stringify(normal.emailSigner) || time(proof.signer.capturedAt) < time(candidate.createdAt)) fail();
  return true;
}

export function legacyEmailUnknownAllowed(key, observations, now = Date.now(), admission) {
  try {
    if (!contract.historicalKeys.includes(key)) return false;
    const a = observations.production?.env?.keys?.[key], b = observations.candidate?.env?.keys?.[key];
    if (!exact(a, ['state', 'present']) || a.state !== 'unknown' || a.present !== true) return false;
    if (key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET') {
      if (!exact(b, ['state', 'present']) || b.state !== 'unknown' || b.present !== true) return false;
    } else if (!exact(b, ['state', 'value']) || b.state !== 'known'
      || b.value !== (key === 'FCOS_MICROSOFT_CLIENT_ID' ? contract.preview.clientId : contract.preview.tenantId)) return false;
    return assertLegacyEmailBaselineProof({ proof: observations.legacyEmailBaseline, production: observations.production.deployment,
      candidate: observations.candidate.deployment, sourceDigest: observations.source?.hashes?.application, normal: observations.legacyEmailNormal, admission, now });
  } catch { return false; }
}

export async function collectLegacyEmailBaselineEvidence({ api, reads, binding, production, candidate, normal, readVersion, admission, now = Date.now() } = {}) {
  if (!legacyEmailCandidate(candidate?.sha, { admission, now }) || normal?.kind !== 'normal_role' || !normal.emailSigner) fail();
  previewEmailSignerEvidenceVerified(normal.emailSigner, { deployment: candidate, sourceDigest: binding?.sourceDigest, admission, now });
  const records = await collectPreviewEmailEnvironmentRecords({ api, now });
  const build = await collectTrustedPreviewEmailBuild({ reads, api, binding: { ...binding, harnessSha: normal?.harnessSha }, records, readVersion, admission, now });
  const proof = { schemaVersion: 1, contractId: contract.id, capturedAt: new Date(now).toISOString(), records, build, signer: normal?.emailSigner };
  assertLegacyEmailBaselineProof({ proof, production, candidate, sourceDigest: binding.sourceDigest, normal, admission, now });
  return proof;
}
