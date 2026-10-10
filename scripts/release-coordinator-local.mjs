import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { collectLocalReleaseCoordination } from './lib/release-coordination-transport.mjs';
import { PREVIEW_COORDINATION_CANONICAL } from './lib/preview-email-coordination.mjs';
import { RELEASE_COORDINATION_DOMAIN, RELEASE_COORDINATION_ROUTES, releaseCoordinationDeadline, releaseCoordinationVariable,
  releaseCoordinationGrantData, releaseCoordinationMessage, verifyReleaseCoordinationGrant, coordinationDigest, coordinationEqual,
  validateReleaseCoordinationBinding, releaseCoordinationFailure } from './lib/release-coordination.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))), ownPath = fileURLToPath(import.meta.url);
const PRIMARY = '/Users/vincex/Documents/FCOS', approvals = `${PRIMARY}/.fcos-cli/release-coordination`;
const gh = '/Users/vincex/.local/gh/current/bin/gh';
const environment = { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_HOST: 'github.com', GH_REPO: fcosConnectionIdentifier('github', 'Repository'), GH_CONFIG_DIR: `${PRIMARY}/.fcos-cli/github` };
const need = value => { if (!value) releaseCoordinationFailure(); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function command(binary, args, input, timeout = 30000) { try { return execFileSync(binary, args, { cwd: ROOT, env: environment, input, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { releaseCoordinationFailure(); } }
function ownedRead(path, limit = 65536) {
  need(resolve(path) === path);
  for (let p = path; p !== '/'; p = resolve(p, '..')) need(!lstatSync(p).isSymbolicLink());
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = fstatSync(fd); need(s.isFile() && s.nlink === 1 && s.uid === process.getuid() && (s.mode & 0o777) === 0o600 && s.size <= limit); return readFileSync(fd); }
  finally { closeSync(fd); }
}
function pinned(reference) { need(reference && hash(reference.sha256)); const raw = ownedRead(reference.path); need(coordinationDigest(raw) === reference.sha256); return JSON.parse(raw); }
/** Action data is not human authentication. The actual collector separately requires the real exact personal GitHub review. */
export function assertReleaseCoordinatorApproval(a, nonce, scriptSha256, now = Date.now()) {
  need(a?.schemaVersion === 1 && a.kind === 'root_admitted_release_coordination_action' && a.action === 'issue-coordination'
    && a.purpose === RELEASE_COORDINATION_DOMAIN && a.nonce === nonce && uuid(nonce) && a.authorizedBy === fcosConnectionIdentifier('github', 'Required account')
    && a.scriptSha256 === scriptSha256 && hash(scriptSha256) && a.canonicalHelperSha256 === PREVIEW_COORDINATION_CANONICAL.helperSha256
    && Number.isSafeInteger(a.authorizedAt) && a.authorizedAt <= now && now - a.authorizedAt < 1800000
    && Number.isSafeInteger(a.privateReadinessAt) && a.privateReadinessAt <= now && now - a.privateReadinessAt < 2700000
    && a.authorityBasis?.kind === 'existing_direct_human_authorization' && a.authorityBasis.localReviewGrantsAuthority === false
    && Array.isArray(a.authorityBasis.citations) && a.authorityBasis.citations.length > 0 && a.rootReview?.sha256 !== a.independentReview?.sha256);
  validateReleaseCoordinationBinding(a.binding, now); return a;
}
function actionAdmission(nonce) {
  const directory = lstatSync(approvals); need(directory.isDirectory() && !directory.isSymbolicLink() && realpathSync(approvals) === approvals && directory.uid === process.getuid() && (directory.mode & 0o777) === 0o700);
  const a = JSON.parse(ownedRead(join(approvals, `approval-${nonce}.json`)));
  assertReleaseCoordinatorApproval(a, nonce, coordinationDigest(readFileSync(ownPath)));
  for (const ref of a.authorityBasis.citations) pinned(ref);
  const reviews = ['root', 'independent'].map(role => {
    const r = pinned(a[`${role}Review`]); need(r.kind === 'release_coordination_action_material_review' && r.role === role && r.accepted === true
      && r.sourceCommit === a.binding.harnessSha && r.scriptSha256 === a.scriptSha256 && r.bindingSha256 === coordinationDigest(a.binding)
      && typeof r.reviewerId === 'string' && r.reviewerId.length > 0 && Number.isSafeInteger(r.reviewedAt)
      && r.reviewedAt <= a.authorizedAt && r.reviewedAt >= a.authorizedAt - 1800000); return r;
  });
  need(reviews[0].reviewerId !== reviews[1].reviewerId);
  assertReleaseCoordinatorSource(ROOT, a.binding.harnessSha);
  return a;
}
/** Authenticate raw committed bytes, independent of index skip-worktree/assume-unchanged flags.
 * All script/config/workflow/action/control files and both dependency manifests are checked
 * in two Git batches. This is a source check, not an action admission. */
export function assertReleaseCoordinatorSource(cwd, commit) {
  need(/^[a-f0-9]{40}$/.test(commit));
  const root = resolve(cwd);
  const gitEnv = { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' };
  const git = (args, input) => execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], { cwd: root, env: gitEnv, input, timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  need(realpathSync(root) === git(['rev-parse', '--show-toplevel']).toString().trim()
    && git(['rev-parse', 'HEAD']).toString().trim() === commit && !git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).length
    && !git(['status', '--porcelain', '--untracked-files=no']).length);
  const paths = ['scripts', 'config', '.github', '.codex', 'AGENTS.md', 'package.json', 'package-lock.json'];
  const rows = git(['ls-tree', '-rz', '--full-tree', commit, '--', ...paths]).toString().split('\0').filter(Boolean).map(row => {
    const [header, path, extra] = row.split('\t'), [mode, type, oid] = header.split(' ');
    need(!extra && path && ['100644', '100755'].includes(mode) && type === 'blob' && /^[a-f0-9]{40}$/.test(oid));
    return { mode, oid, path };
  });
  need(rows.length > 0);
  const objects = git(['cat-file', '--batch'], rows.map(row => row.oid).join('\n') + '\n'); let offset = 0;
  for (const row of rows) {
    const end = objects.indexOf(10, offset), [oid, type, rawSize] = objects.subarray(offset, end).toString().split(' '), size = Number(rawSize);
    need(end >= offset && oid === row.oid && type === 'blob' && Number.isSafeInteger(size) && size >= 0 && end + 1 + size < objects.length && objects[end + 1 + size] === 10);
    const body = objects.subarray(end + 1, end + 1 + size); offset = end + 2 + size;
    need(createHash('sha1').update(`blob ${size}\0`).update(body).digest('hex') === oid);
    const path = join(root, row.path), info = lstatSync(path);
    for (let parent = path; parent !== root;) {
      need(!lstatSync(parent).isSymbolicLink());
      const next = resolve(parent, '..'); need(next !== parent); parent = next;
    }
    need(info.isFile() && info.nlink === 1 && (info.mode & 0o111 ? '100755' : '100644') === row.mode && body.equals(readFileSync(path)));
  }
  need(offset === objects.length); return rows.map(row => row.path);
}
export async function releaseCoordinatorMain(args = process.argv.slice(2)) {
  if (!args.length || coordinationEqual(args, ['--plan'])) return { kind: 'fcos_release_coordination_plan', routes: Object.keys(RELEASE_COORDINATION_ROUTES),
    requiresExactRootActionAndIndependentReview: true, requiresActualPersonalEnvironmentApproval: true, requiresCanonicalLease: true,
    automaticLeaseRelease: false, mutations: 0, privateReads: 0, providerAuthorityGranted: false };
  need(args.length === 2 && ['--issue-approved', '--validate-ledger-admission'].includes(args[0]) && uuid(args[1]) && process.platform === 'darwin');
  const a = actionAdmission(args[1]);
  const actual = collectLocalReleaseCoordination(a.binding.runId, a.binding.route);
  need(coordinationEqual(actual.binding, a.binding));
  // The fixed Python entry independently invokes this read-only admission before it can claim.
  if (args[0] === '--validate-ledger-admission') return { kind: 'fcos_actual_release_ledger_admission', nonce: args[1], actual };
  // Claim+permanent consumption precede every private read/signature/publication.
  const consumed = JSON.parse(command('/usr/bin/python3', ['-I', join(ROOT, 'scripts/lib/release-coordination-ledger.py'), '--claim-approved', args[1]], undefined, 180000));
  need(coordinationEqual(consumed.actual, actual));
  need(consumed.operationId === a.binding.operationId && hash(consumed.consumptionSha256));
  assertReleaseCoordinatorApproval(a, args[1], coordinationDigest(readFileSync(ownPath)));
  const directory = mkdtempSync(join(tmpdir(), 'fcos-release-coordination-key-'));
  try {
    const binary = join(directory, 'fcos-keychain'); command('/usr/bin/swiftc', [join(ROOT, 'scripts/fcos-keychain-migrate.swift'), '-o', binary]);
    assertReleaseCoordinatorApproval(a, args[1], coordinationDigest(readFileSync(ownPath)));
    const privateKey = createPrivateKey(command(binary, ['get', FCOS_CONNECTION_POLICY.keychainAccount, FCOS_CONNECTION_POLICY.attestation.privateKeyService]));
    need(privateKey.asymmetricKeyType === 'ed25519' && createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64') === FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64);
    assertReleaseCoordinatorApproval(a, args[1], coordinationDigest(readFileSync(ownPath)));
    const refreshed = collectLocalReleaseCoordination(a.binding.runId, a.binding.route); need(coordinationEqual(actual, refreshed));
    const grant = releaseCoordinationGrantData({ schemaVersion: 1, kind: 'fcos_production_coordination_grant', keyId: FCOS_CONNECTION_POLICY.attestation.keyId,
      repository: fcosConnectionIdentifier('github', 'Repository'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), projectId: fcosConnectionIdentifier('vercel', 'Project ID'),
      binding: actual.binding, intentArtifactId: actual.intentArtifactId, intentArchiveSha256: actual.intentArchiveSha256, lease: consumed.lease,
      consumptionSha256: consumed.consumptionSha256, issuedAt: Date.now(), expiresAt: Math.min(releaseCoordinationDeadline(a.binding), a.authorizedAt + 1800000, a.privateReadinessAt + 2700000),
      coordinationOnly: true, providerAuthorityGranted: false });
    const text = JSON.stringify({ grant, signature: sign(null, releaseCoordinationMessage(grant), privateKey).toString('base64url') });
    verifyReleaseCoordinationGrant(text, actual.binding);
    const route = RELEASE_COORDINATION_ROUTES[a.binding.route], base = `repos/${fcosConnectionIdentifier('github', 'Repository')}/environments/${route.environment}/variables`;
    // Exactly one create. Any failure retains permanent consumption and the lease.
    command(gh, ['api', '--method', 'POST', base, '--input', '-'], JSON.stringify({ name: releaseCoordinationVariable(a.binding), value: text }));
    const after = JSON.parse(command(gh, ['api', '--method', 'GET', `${base}/${releaseCoordinationVariable(a.binding)}`]));
    need(after.name === releaseCoordinationVariable(a.binding) && after.value === text);
    return { kind: 'fcos_release_coordination_issued', operationId: a.binding.operationId, grantSha256: coordinationDigest(text), leaseId: consumed.lease.leaseId,
      retainedLease: true, replayForbidden: true, providerAuthorityGranted: false };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  releaseCoordinatorMain().then(value => console.log(JSON.stringify(value))).catch(() => { console.error('Release coordination blocked or uncertain. Retain original lease and operation; GET-only recovery.'); process.exitCode = 1; });
}
