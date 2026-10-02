import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PREVIEW_EMAIL_SIGNER_BODY = Object.freeze({
  messageId: 'fcos-verification-message',
  attachmentId: 'fcos-verification-attachment',
});

export const PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID = 'e7a386ee-3d81-43be-b330-537205ef57ec';

const SIGNER_EVIDENCE_KIND = 'fcos_preview_email_signer';
const SIGNER_EVIDENCE_PROBE = 'synthetic_attachment_link_v1';
const SIGNER_EVIDENCE_MAX_AGE_MS = 30 * 60_000;
const SIGNER_TOKEN_MAX_LIFETIME_MS = 5 * 60_000 + 10_000;
const SIGNER_TOKEN_MIN_LIFETIME_MS = 1_000;
const SOURCE_PATHS = Object.freeze([
  'api/_emailRouterHandlers.js',
  'api/_emailRouterCore.js',
  'api/functions/[name].js',
]);

// This is a bounded historical exception. The SHA-256 values attest the exact
// source bytes while the Git blob IDs make the closure proof independent of a
// checkout's working-tree files.
const REVIEWED_CANDIDATES = Object.freeze({
  ff8859b287009e20462c5c0cceff89ae12f13010: Object.freeze({
    sourceHashes: Object.freeze({
      'api/_emailRouterHandlers.js': '4d3e301b18fba542e9cb8adc982a7653f0f338c704501780df9b146698a644ee',
      'api/_emailRouterCore.js': '7a01903340d6170a5643efa04d05787c833c5b9cd13e82456db6e5a7b4e0ef81',
      'api/functions/[name].js': '0682b3c11d30a79a676dbb4b0c42a84477895adcc6f1066db4550322234b9229',
    }),
    blobIds: Object.freeze({
      'api/_emailRouterHandlers.js': '5429dc7062ea2a14155a99915b20176801a66449',
      'api/_emailRouterCore.js': '8df251477158bdd1e33920c7d771eb0d7c95189e',
      'api/functions/[name].js': '717edccb02711140af52552d9be4c3059ff2aee1',
    }),
  }),
  ee28300d25470fa9ca9a6dda37b3752287f20f19: Object.freeze({
    sourceHashes: Object.freeze({
      'api/_emailRouterHandlers.js': '4d3e301b18fba542e9cb8adc982a7653f0f338c704501780df9b146698a644ee',
      'api/_emailRouterCore.js': '7a01903340d6170a5643efa04d05787c833c5b9cd13e82456db6e5a7b4e0ef81',
      'api/functions/[name].js': '1bbde4f4074ff055faf2e072ab529861ce666e69cfbcbc11e039aa9d636ff994',
    }),
    blobIds: Object.freeze({
      'api/_emailRouterHandlers.js': '5429dc7062ea2a14155a99915b20176801a66449',
      'api/_emailRouterCore.js': '8df251477158bdd1e33920c7d771eb0d7c95189e',
      'api/functions/[name].js': '4530c2f4636782d1a3687f93290e7fd3b7a6cafc',
    }),
  }),
});

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const safeError = () => new Error('Preview Email Router signer evidence is unavailable.');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const digest = value => createHash('sha256').update(value).digest('hex');

function reviewedCandidate(commit) {
  if (typeof commit !== 'string' || !Object.prototype.hasOwnProperty.call(REVIEWED_CANDIDATES, commit)) throw safeError();
  return REVIEWED_CANDIDATES[commit];
}

function git(cwd, args, encoding = 'utf8') {
  try { return execFileSync('git', args, { cwd, encoding, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { throw safeError(); }
}

function exactSourceHashes(value, expected) {
  return exactKeys(value, SOURCE_PATHS) && SOURCE_PATHS.every(path => value[path] === expected[path]);
}

function exactInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function exactOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || parsed.origin !== origin) throw safeError();
    return parsed.origin;
  } catch { throw safeError(); }
}

function validatedSignedEnvelope(value, now) {
  if (!exactKeys(value, ['token', 'url', 'expiresAt']) || typeof value.token !== 'string' || value.token.length > 4096
    || typeof value.url !== 'string' || !exactInstant(value.expiresAt)) throw safeError();
  const [encodedPayload, encodedSignature, ...extra] = value.token.split('.');
  if (extra.length || !encodedPayload || !encodedSignature || !/^[A-Za-z0-9_-]+$/.test(encodedPayload)
    || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
    || Buffer.from(encodedPayload, 'base64url').toString('base64url') !== encodedPayload
    || Buffer.from(encodedSignature, 'base64url').toString('base64url') !== encodedSignature) throw safeError();
  let payload;
  try { payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')); } catch { throw safeError(); }
  if (!exactKeys(payload, ['mailboxId', 'messageId', 'attachmentId', 'expiresAt'])
    || payload.mailboxId !== PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID
    || payload.messageId !== PREVIEW_EMAIL_SIGNER_BODY.messageId
    || payload.attachmentId !== PREVIEW_EMAIL_SIGNER_BODY.attachmentId
    || !Number.isSafeInteger(payload.expiresAt)
    || new Date(payload.expiresAt).toISOString() !== value.expiresAt
    || payload.expiresAt - now < SIGNER_TOKEN_MIN_LIFETIME_MS
    || payload.expiresAt - now > SIGNER_TOKEN_MAX_LIFETIME_MS
    || Buffer.from(encodedSignature, 'base64url').byteLength !== 32
    || value.url !== `/api/email-router-attachment?token=${encodeURIComponent(value.token)}`) throw safeError();
}

export function previewEmailSignerEnabled(commit) {
  return typeof commit === 'string' && Object.prototype.hasOwnProperty.call(REVIEWED_CANDIDATES, commit);
}

export function previewEmailSignerSourceHashes(commit) {
  return { ...reviewedCandidate(commit).sourceHashes };
}

export function previewEmailSignerSourceProof({ commit, cwd = sourceRoot } = {}) {
  const reviewed = reviewedCandidate(commit);
  const resolvedCommit = String(git(cwd, ['rev-parse', '--verify', `${commit}^{commit}`])).trim();
  if (resolvedCommit !== commit) throw safeError();
  for (const path of SOURCE_PATHS) {
    const blob = String(git(cwd, ['rev-parse', '--verify', `${commit}:${path}`])).trim();
    if (blob !== reviewed.blobIds[path]) throw safeError();
    const bytes = git(cwd, ['cat-file', 'blob', blob], 'buffer');
    if (!Buffer.isBuffer(bytes) || digest(bytes) !== reviewed.sourceHashes[path]) throw safeError();
  }
  return { ...reviewed.sourceHashes };
}

export function previewEmailSignerEvidenceVerified(evidence, { deployment, sourceDigest, now = Date.now() } = {}) {
  try {
    const capturedAt = Date.parse(evidence?.capturedAt);
    const expectedNow = Number(now);
    if (!Number.isFinite(expectedNow) || !Number.isFinite(capturedAt) || capturedAt > expectedNow || expectedNow - capturedAt > SIGNER_EVIDENCE_MAX_AGE_MS
      || !exactKeys(evidence, ['schemaVersion', 'kind', 'probe', 'capturedAt', 'deploymentId', 'sha', 'sourceDigest', 'mailboxRegistryId', 'result', 'noAttachmentFetch', 'sourceHashes'])
      || evidence.schemaVersion !== 1 || evidence.kind !== SIGNER_EVIDENCE_KIND || evidence.probe !== SIGNER_EVIDENCE_PROBE
      || !exactInstant(evidence.capturedAt) || typeof deployment?.id !== 'string' || evidence.deploymentId !== deployment.id
      || typeof deployment?.sha !== 'string' || evidence.sha !== deployment.sha || !previewEmailSignerEnabled(evidence.sha)
      || typeof sourceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(sourceDigest) || evidence.sourceDigest !== sourceDigest
      || evidence.mailboxRegistryId !== PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID || evidence.result !== 'pass'
      || evidence.noAttachmentFetch !== true || !exactSourceHashes(evidence.sourceHashes, previewEmailSignerSourceHashes(evidence.sha))) throw safeError();
    return true;
  } catch { throw safeError(); }
}

export async function collectPreviewEmailSignerEvidence({ origin, deploymentId, sha, sourceDigest, bearerToken,
  protectionBypass, fetchImpl = globalThis.fetch, cwd = sourceRoot, now = Date.now } = {}) {
  try {
    const targetOrigin = exactOrigin(origin);
    if (typeof deploymentId !== 'string' || !deploymentId || typeof sourceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(sourceDigest)
      || typeof bearerToken !== 'string' || !bearerToken || typeof fetchImpl !== 'function') throw safeError();
    const sourceHashes = previewEmailSignerSourceProof({ commit: sha, cwd });
    const endpoint = `${targetOrigin}/api/functions/emailRouterAttachmentUrl`;
    const response = await fetchImpl(endpoint, { method: 'POST', body: JSON.stringify(PREVIEW_EMAIL_SIGNER_BODY), redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json',
        ...(protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : {}) } });
    if (response?.status !== 200 || response.ok !== true || response.redirected || response.url !== endpoint || typeof response.json !== 'function') throw safeError();
    validatedSignedEnvelope(await response.json(), Number(now()));
    const evidence = { schemaVersion: 1, kind: SIGNER_EVIDENCE_KIND, probe: SIGNER_EVIDENCE_PROBE,
      capturedAt: new Date(Number(now())).toISOString(), deploymentId, sha, sourceDigest,
      mailboxRegistryId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID, result: 'pass', noAttachmentFetch: true, sourceHashes };
    previewEmailSignerEvidenceVerified(evidence, { deployment: { id: deploymentId, sha }, sourceDigest, now: Number(now()) });
    return evidence;
  } catch { throw safeError(); }
}
