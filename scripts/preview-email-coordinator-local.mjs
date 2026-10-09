import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { collectLocalPreviewCoordinationEvidence } from './lib/preview-email-coordination-collector.mjs';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection } from './lib/runtime-compatibility-successor-live.mjs';
import { ENROLLMENT_KEYCHAIN_SERVICE, ENROLLED_AUTHORITY_MAX_AGE_MS } from './lib/preview-vercel-enrollment.mjs';
import { PREVIEW_COORDINATION_DOMAIN, PREVIEW_COORDINATION_CANONICAL, PREVIEW_COORDINATION_VARIABLE, PREVIEW_COORDINATION_TARGET,
  requirePreviewCoordinationProtectedActions, normalizeCoordinationEnvelope, coordinationBindingFromOriginal,
  validateCoordinationBinding, validateCoordinationLease, coordinationDeadline, coordinationGrantData, coordinationGrantMessage,
  verifyCoordinationGrantData, coordinationHash, coordinationSame, coordinationFailure } from './lib/preview-email-coordination.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), ownPath = fileURLToPath(import.meta.url);
const PRIMARY = '/Users/vincex/Documents/FCOS', approvals = `${PRIMARY}/.fcos-cli/preview-email-coordination`;
const implementationAuthoritySha256 = '4e2cd1fb08bf09fe07ee5d593276f1eac513278af91cea9427d79b0e16779455';
const gh = '/Users/vincex/.local/gh/current/bin/gh';
const ghEnv = { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_HOST: 'github.com', GH_REPO: PREVIEW_COORDINATION_TARGET.repository,
  GH_CONFIG_DIR: `${PRIMARY}/.fcos-cli/github` };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const command = (binary, args, input) => execFileSync(binary, args, { cwd: ROOT, env: ghEnv, input,
  encoding: 'utf8', timeout: 30000, maxBuffer: 65536, stdio: ['pipe', 'pipe', 'pipe'] });
function ownedRead(path, limit = 32768) {
  for (let p = path; p !== '/'; p = resolve(p, '..')) if (lstatSync(p).isSymbolicLink()) coordinationFailure();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > limit) coordinationFailure();
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
/** Pure approval data. It cannot install the disabled actual action boundary. */
export function assertPreviewCoordinationApproval({ approval: a, nonce, scriptSha256, now = Date.now() } = {}) {
  const keys = ['schemaVersion', 'action', 'purpose', 'authorizedBy', 'authorizedAt', 'actionAuthorizationEvidenceSha256',
    'implementationAuthoritySha256', 'nonce', 'scriptSha256', 'canonicalHelperSha256', 'binding'];
  if (!a || typeof a !== 'object' || Object.keys(a).length !== keys.length || keys.some(key => !Object.hasOwn(a, key))
    || a.schemaVersion !== 1 || a.action !== 'issue-preview-coordination' || a.purpose !== PREVIEW_COORDINATION_DOMAIN
    || a.authorizedBy !== fcosConnectionIdentifier('github', 'Required account') || !Number.isSafeInteger(a.authorizedAt)
    || a.authorizedAt > now || now - a.authorizedAt > 600000 || !hash(a.actionAuthorizationEvidenceSha256)
    || a.implementationAuthoritySha256 !== implementationAuthoritySha256 || !uuid(nonce) || a.nonce !== nonce
    || !hash(scriptSha256) || a.scriptSha256 !== scriptSha256 || a.canonicalHelperSha256 !== PREVIEW_COORDINATION_CANONICAL.helperSha256) coordinationFailure();
  validateCoordinationBinding(a.binding, now); return a;
}
export function previewCoordinationPlan() {
  return { kind: 'fcos_exact_04ee_coordination_source_only', purpose: PREVIEW_COORDINATION_DOMAIN,
    implementationAuthoritySha256, protectedActionsInstalled: false, privateReads: 0, signing: 0, publication: 0,
    leaseClaims: 0, hostedUploads: 0, previewAuthorized: false, productionAuthorized: false };
}
function verifyOriginalReceipt(issuance, capsule, key, binding, now) {
  const r = issuance.value.receipt, c = capsule.enrollment;
  if (!coordinationSame(Object.keys(capsule), ['enrollment', 'binding']) || !coordinationSame(c, r.enrollment)
    || c.repository !== PREVIEW_COORDINATION_TARGET.repository || c.environment !== PREVIEW_COORDINATION_TARGET.environment
    || c.teamId !== PREVIEW_COORDINATION_TARGET.teamId || c.projectId !== PREVIEW_COORDINATION_TARGET.projectId
    || c.expiresAt <= now || c.createdAt > now || c.expiresAt - c.createdAt > 86400000
    || r.schemaVersion !== 1 || r.kind !== 'fcos_preview_vercel_run_authority' || r.keyId !== FCOS_CONNECTION_POLICY.attestation.keyId
    || r.projectOnly !== true || r.revoked !== false || r.leaked !== false || r.productionAuthorized !== false
    || r.observedAt !== r.issuedAt || r.expiresAt > c.expiresAt || r.expiresAt <= now
    || r.expiresAt - r.issuedAt > ENROLLED_AUTHORITY_MAX_AGE_MS || r.issuedAt > now
    || r.context.runId !== binding.runId || r.context.runAttempt !== 1 || r.context.operation !== 'create') coordinationFailure();
  const tag = Buffer.from(capsule.binding, 'base64url'), signature = Buffer.from(issuance.value.signature, 'base64url');
  if (tag.length !== 32 || tag.toString('base64url') !== capsule.binding || signature.length !== 64
    || signature.toString('base64url') !== issuance.value.signature) coordinationFailure();
  const message = Buffer.concat([Buffer.from('FCOS-PREVIEW-VERCEL-RUN-AUTHORITY-V1\0'), Buffer.from(JSON.stringify(r)), Buffer.from('\0'), tag]);
  if (!verify(null, message, key, signature)) coordinationFailure();
}
async function issueFixed(a) {
  // No caller adapter, key, transport, clock or callback can enter this path.
  const actual = await collectLocalPreviewCoordinationEvidence(a.binding.runId);
  successorLiveSelection(actual.admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, Date.now());
  if (typeof actual.issuanceEnvelope !== 'string') coordinationFailure();
  const binding = coordinationBindingFromOriginal({ ...actual, now: Date.now() });
  if (!coordinationSame(binding, a.binding)) coordinationFailure();
  const base = `repos/${PREVIEW_COORDINATION_TARGET.repository}/environments/${PREVIEW_COORDINATION_TARGET.environment}/variables`;
  const before = JSON.parse(command(gh, ['api', `${base}?per_page=100`]));
  if (!Array.isArray(before.variables) || before.total_count !== before.variables.length || before.variables.length > 100
    || before.variables.some(row => row.name === PREVIEW_COORDINATION_VARIABLE)) coordinationFailure();
  // Fixed unchanged canonical WriteLease is invoked by verified ledger source.
  // Consumption is O_EXCL+fsynced before all private reads/signing/publication.
  const ledger = join(ROOT, 'scripts/lib/preview-email-coordination-ledger.py');
  const consumption = JSON.parse(command('/usr/bin/python3', ['-I', ledger, '--claim'], JSON.stringify(binding)));
  if (consumption.operationId !== binding.operationId || !hash(consumption.consumptionSha256)) coordinationFailure();
  validateCoordinationLease(consumption.lease, binding);
  const compile = mkdtempSync(join(tmpdir(), 'fcos-coordination-keychain-'));
  try {
    const source = join(ROOT, 'scripts/fcos-keychain-migrate.swift'), binary = join(compile, 'fcos-keychain');
    // Actual admission already compared every allowlisted byte to raw pinned Git.
    command('/usr/bin/swiftc', [source, '-o', binary]);
    const info = lstatSync(binary); if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.nlink !== 1) coordinationFailure();
    const receipt = normalizeCoordinationEnvelope(actual.issuanceEnvelope, 16384);
    const enrollmentId = receipt.value.receipt.enrollment.enrollmentId;
    if (!uuid(enrollmentId)) coordinationFailure();
    const state = JSON.parse(ownedRead(`${PRIMARY}/.fcos-cli/preview-vercel-enrollment/${enrollmentId}/state.json`));
    if (state.phase !== 'enrolled_disabled' || state.enrollmentId !== enrollmentId
      || state.tokenId !== receipt.value.receipt.enrollment.tokenId || state.expiresAt !== receipt.value.receipt.enrollment.expiresAt
      || !Array.isArray(state.secretMetadata) || !coordinationSame([...state.secretMetadata].sort((a, b) => a.name.localeCompare(b.name)), actual.secretMetadata)) coordinationFailure();
    const capsule = JSON.parse(command(binary, ['get', `${FCOS_CONNECTION_POLICY.keychainAccount}:${enrollmentId}`, ENROLLMENT_KEYCHAIN_SERVICE]));
    const privateKey = createPrivateKey(command(binary, ['get', FCOS_CONNECTION_POLICY.keychainAccount, FCOS_CONNECTION_POLICY.attestation.privateKeyService]));
    const publicKey = createPublicKey(privateKey);
    if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.export({ type: 'spki', format: 'der' }).toString('base64') !== FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64) coordinationFailure();
    verifyOriginalReceipt(receipt, capsule, publicKey, binding, Date.now());
    // Original receipt/review/run/job/provisioning times are never renewed.
    coordinationBindingFromOriginal({ ...actual, now: Date.now() });
    const issuedAt = Date.now(), grant = coordinationGrantData({ binding, ...consumption, issuedAt,
      expiresAt: Math.min(issuedAt + 600000, coordinationDeadline(binding)) });
    const text = JSON.stringify({ grant, signature: sign(null, coordinationGrantMessage(grant), privateKey).toString('base64url') });
    verifyCoordinationGrantData({ envelope: text, expected: binding, now: Date.now(), publicKeySpkiBase64: FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64 });
    // Sole fixed create; no overwrite/delete, retry, provisioning, enrollment,
    // pin changes, enable writes or owner-token export. Uncertainty retains lease.
    command(gh, ['api', '--method', 'POST', base, '--input', '-'], JSON.stringify({ name: PREVIEW_COORDINATION_VARIABLE, value: text }));
    const after = JSON.parse(command(gh, ['api', `${base}/${PREVIEW_COORDINATION_VARIABLE}`]));
    if (after.name !== PREVIEW_COORDINATION_VARIABLE || after.value !== text) coordinationFailure();
    return { kind: 'fcos_preview_coordination_publication', grantSha256: coordinationHash(text), leaseId: consumption.lease.leaseId,
      operationId: binding.operationId, originalRunId: binding.runId, retainedLease: true, providerAuthorityGranted: false };
  } finally { rmSync(compile, { recursive: true, force: true }); }
}
export async function previewCoordinationMain(args = process.argv.slice(2)) {
  if (!args.length || coordinationSame(args, ['--plan'])) return previewCoordinationPlan();
  if (args.length !== 2 || args[0] !== '--issue-approved' || !uuid(args[1])) coordinationFailure();
  const directory = lstatSync(approvals);
  if (!directory.isDirectory() || directory.isSymbolicLink() || realpathSync(approvals) !== approvals || directory.uid !== process.getuid()
    || (directory.mode & 0o777) !== 0o700) coordinationFailure();
  const approval = JSON.parse(ownedRead(join(approvals, `approval-${args[1]}.json`)));
  assertPreviewCoordinationApproval({ approval, nonce: args[1], scriptSha256: coordinationHash(readFileSync(ownPath)), now: Date.now() });
  requirePreviewCoordinationProtectedActions(); // Immutable disabled boundary BEFORE authenticated/private I/O.
  return issueFixed(approval);
}
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  try { console.log(JSON.stringify(await previewCoordinationMain())); }
  catch { console.error('Preview coordination unavailable; original operation and lease remain GET-only.'); process.exitCode = 1; }
}
