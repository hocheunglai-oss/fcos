import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';

export const RELEASE_MAX_AGE_MS = 30 * 60 * 1000;
export const releaseHash = value => createHash('sha256').update(value).digest('hex');
const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const hash = value => /^[0-9a-f]{64}$/.test(value || '');
const id = value => /^dpl_[A-Za-z0-9]+$/.test(value || '');
const immutable = value => { try { return canonicalFcosE2eCandidateUrl(value) === value; } catch { return false; } };
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000 && now - Date.parse(value) <= RELEASE_MAX_AGE_MS;
const safeCode = value => /^[A-Z][A-Z0-9_]{0,95}$/.test(value || '') ? value : 'EVIDENCE_INVALID';
const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));

// Hash the reviewed controls, not environment values, credentials or reports.
export function releaseConfigurationRevision(cwd, trustedCwd = cwd) {
  const files = ['config/fcosConnections.js', 'config/fcosCiIdentity.js', 'config/preview-parity-policy.json',
    'vercel.json', 'package.json', 'package-lock.json', 'AGENTS.md', '.codex/config.toml', '.codex/setup.mjs',
    '.codex/control-validation.mjs', '.codex/control-policy.json', '.codex/README.md',
    '.github/workflows/quality.yml', '.github/workflows/authenticated-release.yml', '.github/workflows/production-release.yml',
    '.github/workflows/normal-role-release.yml', 'scripts/normal-role-release.mjs', 'scripts/lib/normal-role-verification-transport.mjs', 'scripts/lib/normal-role-read-requests.mjs',
    'scripts/lib/preview-email-signer.mjs', 'scripts/lib/legacy-email-baseline-proof.mjs', 'config/legacy-email-baseline-proof.json',
    'scripts/lib/preview-email-build.mjs', 'scripts/preview-email-proof-build.mjs', '.github/workflows/preview-email-proof-build.yml',
    'scripts/lib/preview-parity.mjs', 'scripts/collect-preview-parity.mjs', 'scripts/lib/release-evidence.mjs',
    '.github/workflows/candidate-quality.yml', '.github/quality-candidates/f4576a8c918acef686f084c505b1715de11deeb8.json',
    'scripts/candidate-quality-receipt.mjs', 'scripts/lib/candidate-quality.mjs', 'scripts/lib/build-provenance.mjs',
    'scripts/lib/release-readiness.mjs', 'scripts/verify-e2e-candidate.mjs'];
  const trustedFiles = new Set(files.filter(file => file.startsWith('scripts/') || file.startsWith('.github/')
    || ['config/preview-parity-policy.json', 'config/legacy-email-baseline-proof.json'].includes(file)));
  const digest = createHash('sha256').update('fcos-release-configuration-v2\0');
  for (const file of files) {
    digest.update(`${file}\0`);
    const root = trustedFiles.has(file) ? trustedCwd : cwd;
    if (existsSync(join(root, file))) digest.update(readFileSync(join(root, file)));
    else digest.update('absent');
    digest.update('\0');
  }
  return digest.digest('hex');
}

/** Internal assembler. This report is informational, never execution authority.
 * Every consumer must recollect provider proof rather than accept a file's pass.
 * Inputs originate in the trusted collector; arbitrary input fields are dropped.
 */
export function createReleaseReadiness({ source, candidate, production, parity, evidence = [], quality, configurationRevision, lockHash, now = Date.now() } = {}) {
  const blockers = [];
  const fail = (code, scope) => blockers.push({ code: safeCode(code), scope: /^[a-zA-Z0-9_.-]{1,160}$/.test(scope || '') ? scope : 'release' });
  if (!fields(source, ['candidateHead', 'hashes', 'switchInventory']) || !fields(source?.hashes, ['application', 'policy', 'connections', 'ciIdentity', 'legacyEmailProof'])) fail('SOURCE_SCHEMA', 'source');
  if (!sha(source?.candidateHead) || !hash(source?.hashes?.application) || !hash(lockHash) || !hash(configurationRevision)) fail('SOURCE_IDENTITY', 'source');
  const bound = record => record && record.sha === source?.candidateHead && record.sourceDigest === source?.hashes?.application
    && record.lockHash === lockHash && record.configurationRevision === configurationRevision;
  if (!candidate || !id(candidate.id) || !immutable(candidate.url) || candidate.state !== 'READY' || candidate.target !== 'preview'
    || !bound(candidate)) fail('CANDIDATE_BINDING', 'candidate');
  if (!fields(candidate, ['id', 'url', 'sha', 'state', 'target', 'createdAt', 'teamId', 'projectId', 'sourceDigest', 'lockHash', 'configurationRevision'])) fail('CANDIDATE_SCHEMA', 'candidate');
  if (!production || !id(production.id) || !immutable(production.url) || !sha(production.sha) || production.state !== 'READY' || production.target !== 'production') fail('PRODUCTION_IDENTITY', 'production');
  if (!fresh(parity?.capturedAt, now) || !bound(parity?.binding) || parity.binding?.deploymentId !== candidate?.id
    || parity.binding?.url !== candidate?.url) fail('PARITY_BINDING', 'parity');
  if (!fields(parity, ['schemaVersion', 'policyVersion', 'pass', 'blockers', 'classifiedKeys', 'unknowns', 'acceptedHistoricalUnknowns', 'limitations', 'capturedAt', 'binding',
    'source', 'candidate', 'production', 'expectedRuntimeAuth', 'expectedRuntimeFlags', 'expectedRuntimeSafety', 'trustedEvidence', 'quality'])
    || parity.source && parity.source.candidateHead !== source?.candidateHead || parity.candidate && (parity.candidate.sha !== source?.candidateHead
      || parity.candidate.id !== candidate?.id || parity.candidate.sourceDigest !== source?.hashes?.application)
    || parity.production && parity.production.id !== production?.id) fail('PARITY_MIXED_IDENTITY', 'parity');
  if (parity?.pass !== true || !Array.isArray(parity?.blockers) || parity.blockers.length) {
    fail('PREVIEW_PARITY_BLOCKED', 'parity');
    for (const blocker of Array.isArray(parity?.blockers) ? parity.blockers : []) fail(blocker.code, blocker.scope);
  }
  const accepted = [];
  if (!Array.isArray(evidence)) fail('TRUSTED_EVIDENCE_SCHEMA', 'evidence');
  for (const record of Array.isArray(evidence) ? evidence : []) {
    if (!fields(record, ['sha', 'sourceDigest', 'lockHash', 'configurationRevision', 'deploymentId', 'candidateUrl', 'kind', 'runId', 'artifactId', 'archiveDigest', 'harnessSha', 'capturedAt'])
      || !bound(record) || record.deploymentId !== candidate?.id || record.candidateUrl !== candidate?.url
      || !fresh(record.capturedAt, now) || !Number.isSafeInteger(record.runId) || record.runId < 1
      || !Number.isSafeInteger(record.artifactId) || record.artifactId < 1 || !hash(record.archiveDigest)
      || !sha(record.harnessSha) || !['restricted_browser', 'normal_role'].includes(record.kind)) {
      fail('TRUSTED_EVIDENCE_BINDING', 'evidence'); continue;
    }
    accepted.push({ kind: record.kind, runId: record.runId, artifactId: record.artifactId, archiveDigest: record.archiveDigest,
      harnessSha: record.harnessSha, capturedAt: record.capturedAt });
  }
  for (const kind of ['restricted_browser', 'normal_role']) if (!accepted.some(record => record.kind === kind)) fail('TRUSTED_EVIDENCE_MISSING', kind);
  if (!bound(quality) || quality?.result !== 'success' || !fresh(quality?.capturedAt, now)
    || !Number.isSafeInteger(quality?.runId) || quality.runId < 1 || !Number.isSafeInteger(quality?.artifactId) || quality.artifactId < 1
    || !hash(quality?.archiveDigest)) fail('QUALITY_EVIDENCE_MISSING', 'quality');
  return {
    schemaVersion: 1, receiptKind: 'fcos_release_readiness', capturedAt: new Date(now).toISOString(),
    candidate: { sha: sha(source?.candidateHead) ? source.candidateHead : null,
      sourceDigest: hash(source?.hashes?.application) ? source.hashes.application : null,
      lockHash: hash(lockHash) ? lockHash : null, configurationRevision: hash(configurationRevision) ? configurationRevision : null,
      deploymentId: id(candidate?.id) ? candidate.id : null, url: immutable(candidate?.url) ? candidate.url : null },
    previousProduction: { deploymentId: id(production?.id) ? production.id : null,
      sha: sha(production?.sha) ? production.sha : null, url: immutable(production?.url) ? production.url : null },
    quality: Number.isSafeInteger(quality?.runId) ? { runId: quality.runId,
      artifactId: Number.isSafeInteger(quality.artifactId) ? quality.artifactId : null,
      archiveDigest: hash(quality.archiveDigest) ? quality.archiveDigest : null, result: quality.result === 'success' ? 'success' : 'unknown' } : null,
    trustedEvidence: accepted, blockers, ready: blockers.length === 0,
    productionAuthorized: false,
    limitation: 'Readiness is fresh consistency evidence. It cannot authorize Production, replace human approval, or prove unobserved workflows.',
  };
}

export function assertReleaseReceiptBinding(receipt, expected, { now = Date.now() } = {}) {
  if (receipt?.schemaVersion !== 1 || receipt.receiptKind !== 'fcos_release_readiness' || receipt.productionAuthorized !== false
    || !fields(receipt, ['schemaVersion', 'receiptKind', 'capturedAt', 'candidate', 'previousProduction', 'quality', 'trustedEvidence', 'blockers', 'ready', 'productionAuthorized', 'limitation'])
    || !fields(receipt.candidate, ['sha', 'sourceDigest', 'lockHash', 'configurationRevision', 'deploymentId', 'url'])
    || !fresh(receipt.capturedAt, now) || !Array.isArray(receipt.blockers) || receipt.blockers.length || receipt.ready !== true
    || Object.entries(expected).some(([key, value]) => receipt.candidate?.[key] !== value)) throw new Error('Release receipt is stale, blocked, or belongs to another candidate.');
  return true;
}
