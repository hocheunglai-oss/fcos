import { execFileSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync, mkdirSync,
  writeFileSync, fsyncSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { ENROLLMENT_FIXED_TARGET, ENROLLMENT_KEYCHAIN_SERVICE, createPrivateEnrollment } from './preview-vercel-enrollment.mjs';

const contractBytes = readFileSync(new URL('../../config/runtime-compatibility-successor-live.json', import.meta.url));
const contract = JSON.parse(contractBytes);
export const recoveryHash = value => createHash('sha256').update(value).digest('hex');
if (recoveryHash(contractBytes) !== 'aecc93e6152c23b0bee23834f045cc2a6ae8a9fd9057c205080c6ade7614a5c0') throw new Error('Immutable recovery candidate contract differs.');
export const RECOVERY_PURPOSE = 'FCOS-EXACT-04EE-ABSENT-ENROLLMENT-RECOVERY-V1';
export const RECOVERY_TARGET = ENROLLMENT_FIXED_TARGET;
export const RECOVERY_CANONICAL_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18';
export const RECOVERY_PRESERVED_SECRETS = Object.freeze(['FCOS_E2E_VERCEL_BYPASS', 'FCOS_RELEASE_GH_TOKEN',
  'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN']);
export const RECOVERY_PAIR = Object.freeze(['FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT']);
export const recoverySame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const recoveryFailure = () => { throw new Error('Preview enrollment recovery refused; retain the original intent and lease for GET-only reconciliation.'); };
const need = value => { if (!value) recoveryFailure(); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const ref = value => value && typeof value.path === 'string' && value.path.startsWith('/') && hash(value.sha256);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const bindingKeys = ['schemaVersion', 'kind', 'action', 'purpose', 'authorizedBy', 'nonce', 'operationId', 'enrollmentId',
  'target', 'candidateSha', 'sourceDigest', 'lockHash', 'sourceCommit', 'sourceTree', 'protectedMainSha', 'sourcePullRequest', 'sourceBranch',
  'scriptSha256', 'librarySha256', 'ledgerSha256', 'canonicalHelperSha256',
  'authorizedAt', 'privateReadinessAt', 'expiresAt', 'leaseDeadline', 'secretMetadata'];

export function recoverySecretMetadata(rows, names = RECOVERY_PRESERVED_SECRETS, now = Date.now()) {
  need(Array.isArray(rows) && rows.length === names.length);
  const seen = new Set();
  for (const row of rows) {
    need(exact(row, ['name', 'created_at', 'updated_at']) && names.includes(row.name) && !seen.has(row.name));
    seen.add(row.name);
    for (const time of [row.created_at, row.updated_at]) need(typeof time === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(time)
      && Number.isFinite(Date.parse(time)) && Date.parse(time) <= now
      && new Date(Date.parse(time)).toISOString() === (time.includes('.') ? time : time.replace('Z', '.000Z')));
    need(Date.parse(row.created_at) <= Date.parse(row.updated_at));
  }
  return rows.map(row => ({ ...row })).sort((a, b) => a.name.localeCompare(b.name));
}

export function recoveryBinding(a) { return Object.fromEntries(bindingKeys.map(key => [key, a[key]])); }
export function assertEnrollmentRecoveryApproval(a, nonce, hashes, now = Date.now()) {
  need(exact(a, [...bindingKeys, 'privateActionEvidence', 'rootReview', 'independentReview']));
  need(a.schemaVersion === 1 && a.kind === 'root_admitted_absent_preview_enrollment_recovery'
    && a.action === 'enroll-absent' && a.purpose === RECOVERY_PURPOSE
    && a.authorizedBy === fcosConnectionIdentifier('github', 'Required account')
    && uuid(nonce) && a.nonce === nonce && uuid(a.enrollmentId)
    && a.enrollmentId !== '9cb4eb76-1d82-44ec-ba66-7285b98851c9'
    && a.operationId === `fcos-preview-enrollment-recovery-${a.enrollmentId}`
    && recoverySame(a.target, RECOVERY_TARGET) && a.candidateSha === contract.candidateSha
    && a.sourceDigest === contract.sourceDigest && a.lockHash === contract.lockHash
    && [a.sourceCommit, a.sourceTree, a.protectedMainSha].every(sha)
    && positive(a.sourcePullRequest) && typeof a.sourceBranch === 'string' && /^codex\/[a-z0-9][a-z0-9/_-]{1,180}$/.test(a.sourceBranch)
    && a.canonicalHelperSha256 === RECOVERY_CANONICAL_SHA256
    && ['scriptSha256', 'librarySha256', 'ledgerSha256'].every(key => hash(a[key]) && a[key] === hashes?.[key])
    && [now, a.authorizedAt, a.privateReadinessAt, a.expiresAt, a.leaseDeadline].every(positive)
    && a.privateReadinessAt <= a.authorizedAt && a.authorizedAt <= now
    && now - a.authorizedAt <= 3600000 && now - a.privateReadinessAt < 2700000
    && a.expiresAt > now && a.expiresAt <= a.leaseDeadline && a.leaseDeadline - a.authorizedAt <= 86400000
    && [a.privateActionEvidence, a.rootReview, a.independentReview].every(ref));
  need(recoverySame(a.secretMetadata, recoverySecretMetadata(a.secretMetadata, RECOVERY_PRESERVED_SECRETS, now)));
  return a;
}

export function assertEnrollmentRecoveryEvidence(a, evidence, reviews, now = Date.now()) {
  const bindingSha256 = recoveryHash(JSON.stringify(recoveryBinding(a)));
  need(evidence?.kind === 'direct_human_absent_preview_enrollment_recovery_authority'
    && evidence.authorizedBy === a.authorizedBy && evidence.purpose === a.purpose
    && evidence.sourceCommit === a.sourceCommit && evidence.scriptSha256 === a.scriptSha256
    && evidence.bindingSha256 === bindingSha256 && evidence.authorizedAt === a.authorizedAt
    && evidence.privateReadinessAt === a.privateReadinessAt
    && ['localManagementCredentialReadAuthorized', 'oneProjectTokenIssuanceAuthorized', 'newCapsuleWriteAuthorized',
      'pairedProtectedSecretCreationAuthorized', 'disabledEnrollmentPinWriteAuthorized', 'reviewedDraftSourceAuthorized'].every(key => evidence[key] === true)
    && ['attestationKeyAccessAuthorized', 'signingAuthorized', 'previewExecutionAuthorized', 'productionAuthorized',
      'financialAuthorized'].every(key => evidence[key] === false));
  need(Array.isArray(reviews) && reviews.length === 2);
  const reviewers = new Set();
  for (const role of ['root', 'independent']) {
    const matches = reviews.filter(row => row?.role === role), review = matches[0];
    need(matches.length === 1 && review.kind === 'absent_preview_enrollment_recovery_material_review'
      && review.accepted === true && review.sourceCommit === a.sourceCommit && review.scriptSha256 === a.scriptSha256
      && review.bindingSha256 === bindingSha256 && typeof review.reviewerId === 'string' && review.reviewerId.length > 0
      && !reviewers.has(review.reviewerId) && positive(review.reviewedAt) && review.reviewedAt >= a.authorizedAt
      && review.reviewedAt - a.authorizedAt < 600000 && review.reviewedAt <= now);
    reviewers.add(review.reviewerId);
  }
  return bindingSha256;
}

export function enrollmentRecoveryPlan() {
  return { schemaVersion: 1, kind: 'fcos_absent_preview_enrollment_recovery_plan', target: RECOVERY_TARGET,
    candidateSha: contract.candidateSha, requiresActualReviewedDraftPullRequest: true,
    requiresFreshExactPrivateAction: true, requiresTwoMaterialReviews: true, requiresAbsentPair: true,
    requiresCanonicalLeaseAndPermanentIntent: true, preservesSecretMetadata: RECOVERY_PRESERVED_SECRETS,
    issuanceAttempts: 0, providerCalls: 0, privateReads: 0, writes: 0, automaticReplay: false,
    attestationOrSigningAuthorized: false, previewAuthorized: false, productionAuthorized: false };
}

// Private orchestration has no exported adapter or test hook. Only the fixed
// native entry below can supply provider, credential and durable-ledger actions.
async function runEnrollmentRecovery({ approval, nonce, hashes, io, now = () => Date.now() }) {
  const a = structuredClone(assertEnrollmentRecoveryApproval(approval, nonce, hashes, now()));
  const check = () => assertEnrollmentRecoveryApproval(a, nonce, hashes, now());
  let state, consumed = false;
  try {
    await io.publicPreflight(a); check();
    // Compilation touches no credential/provider state. Detect local SDK and
    // toolchain failures before claiming the durable private operation.
    await io.prepareLocal(a); check();
    await io.publicPreflight(a); check();
    const claim = await io.claim(a); consumed = true;
    need(claim.operationId === a.operationId && hash(claim.consumptionSha256)
      && claim.lease?.epoch === 'production-reconciliation-20261005' && claim.lease.objective === 'production'
      && claim.lease.ownerThreadId === '01a0f08b-7fcb-7870-9edc-343e16052b62' && claim.lease.operationId === a.operationId
      && claim.lease.bindingSha256 === recoveryHash(`FCOS-ABSENT-PREVIEW-ENROLLMENT-LEASE-V1\0${JSON.stringify(recoveryBinding(a))}`)
      && uuid(claim.lease.leaseId) && claim.lease.coordinationOnly === true && claim.lease.providerAuthorityGranted === false
      && claim.lease.uncertainOutcomeRequiresReadback === true);
    state = { schemaVersion: 1, enrollmentId: a.enrollmentId, nonce: a.nonce, operationId: a.operationId,
      phase: 'consumed_before_private_reads', requestedAt: now(), expiresAt: a.expiresAt, sourceSha: a.sourceCommit,
      recoveryConsumptionSha256: claim.consumptionSha256, lease: claim.lease, productionAuthorized: false };
    await io.save(a, state); check();
    await io.publicPreflight(a); check();
    await io.assertClaim(a); check();
    await io.privatePreflight(a); check();
    await io.publicPreflight(a); check();
    state.phase = 'issuance_requested'; await io.save(a, state); check();
    await io.assertClaim(a); check();
    const issuance = await io.issue(a); // Exactly one POST; never retry.
    const returnedTokenId = issuance?.token?.id;
    need(typeof returnedTokenId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(returnedTokenId) && returnedTokenId !== 'current');
    // Persist only known nonsecret custody evidence before a metadata failure.
    // A returned ID never authorizes a second issuance or stores bearer material.
    state.tokenId = returnedTokenId; state.phase = 'issuance_returned_metadata_pending';
    await io.save(a, state); check();
    const metadata = await io.tokenMetadata(returnedTokenId); check();
    const capsule = createPrivateEnrollment({ issuance, metadata, enrollmentId: a.enrollmentId,
      requestedExpiresAt: a.expiresAt, now: now() });
    state.tokenId = capsule.enrollment.tokenId;
    state.phase = 'private_enrollment_write_requested'; await io.save(a, state); check();
    const privateText = JSON.stringify(capsule);
    await io.assertClaim(a); check();
    await io.createCapsule(a, privateText); check();
    await io.assertClaim(a); check();
    need(await io.readCapsule(a) === privateText); check();
    for (const [name, value] of [[RECOVERY_PAIR[0], issuance.bearerToken], [RECOVERY_PAIR[1], privateText]]) {
      state.phase = name === RECOVERY_PAIR[0] ? 'bearer_write_requested' : 'companion_write_requested';
      await io.save(a, state); check();
      await io.assertPairPublicationState(a, name); check();
      await io.assertClaim(a); check();
      await io.createSecret(name, value); check();
    }
    const after = recoverySecretMetadata(await io.secretMetadata(), [...RECOVERY_PRESERVED_SECRETS, ...RECOVERY_PAIR], now());
    need(recoverySame(after.filter(row => !RECOVERY_PAIR.includes(row.name)), a.secretMetadata));
    need(after.filter(row => RECOVERY_PAIR.includes(row.name)).every(row => Date.parse(row.updated_at) >= state.requestedAt - 1000));
    await io.assertDisabled(a); check();
    state.phase = 'disabled_pin_write_requested'; await io.save(a, state); check();
    await io.assertClaim(a); check();
    await io.publishDisabledPins(a, state.tokenId); check();
    state.secretMetadata = after; state.phase = 'enrolled_disabled'; await io.save(a, state); check();
    return { kind: 'fcos_absent_preview_enrollment_recovery', enrolled: true, enrollmentId: a.enrollmentId,
      operationId: a.operationId, consumptionSha256: claim.consumptionSha256,
      activationPerformed: false, previewAuthorized: false, productionAuthorized: false };
  } catch {
    // Never inspect exception getters/messages/stdout. Private evidence stays in
    // memory. A failure after consumption cannot create a fresh issuance attempt.
    if (consumed && state) { state.phase = 'quarantined_reconciliation_required'; try { await io.save(a, state); } catch { /* Permanent intent survives. */ } }
    recoveryFailure();
  }
}

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url))), PRIMARY = '/Users/vincex/Documents/FCOS';
const DIRECTORY = `${PRIMARY}/.fcos-cli/preview-vercel-enrollment-recovery`;
const ownPath = join(ROOT, 'scripts/preview-vercel-enrollment-recovery.mjs'), libraryPath = fileURLToPath(import.meta.url);
const ledgerPath = join(ROOT, 'scripts/lib/preview-vercel-enrollment-recovery-ledger.py');
const gh = '/Users/vincex/.local/gh/current/bin/gh';
const node = '/Users/vincex/.local/node-lts/current/bin/node';
const vc = '/Users/vincex/.local/node-lts/current/lib/node_modules/vercel/dist/vc.js';
const target = RECOVERY_TARGET;
const NATIVE_FETCH = globalThis.fetch.bind(globalThis);
const env = { PATH: '/usr/bin:/bin', HOME: PRIMARY.replace('/Documents/FCOS', ''), GH_HOST: 'github.com',
  GH_REPO: target.repository, GH_CONFIG_DIR: `${PRIMARY}/.fcos-cli/github` };
const base = `repos/${target.repository}`, environmentPath = `${base}/environments/${target.environment}`;
function command(binary, args, input, customEnv = env, timeout = 30000) {
  try { return execFileSync(binary, args, { cwd: ROOT, env: customEnv, input, encoding: 'utf8', timeout,
    maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { recoveryFailure(); }
}
function ownedDirectory(path) {
  for (let p = path; p !== '/'; p = dirname(p)) need(!lstatSync(p).isSymbolicLink());
  const info = lstatSync(path);
  need(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700);
}
function privateRead(path, limit = 65536) {
  need(typeof path === 'string' && resolve(path) === path);
  for (let p = path; p !== '/'; p = dirname(p)) need(!lstatSync(p).isSymbolicLink());
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const info = fstatSync(fd);
    need(info.isFile() && info.nlink === 1 && info.uid === process.getuid() && (info.mode & 0o777) === 0o600 && info.size <= limit);
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
function pinned(ref) { const text = privateRead(ref.path); need(recoveryHash(text) === ref.sha256); return JSON.parse(text); }
function hashes() { return { scriptSha256: recoveryHash(readFileSync(ownPath)), librarySha256: recoveryHash(readFileSync(libraryPath)), ledgerSha256: recoveryHash(readFileSync(ledgerPath)) }; }
function action(nonce) {
  ownedDirectory(DIRECTORY);
  const a = JSON.parse(privateRead(join(DIRECTORY, `approval-${nonce}.json`)));
  assertEnrollmentRecoveryApproval(a, nonce, hashes());
  assertEnrollmentRecoveryEvidence(a, pinned(a.privateActionEvidence), [pinned(a.rootReview), pinned(a.independentReview)]);
  return a;
}
const get = endpoint => JSON.parse(command(gh, ['api', '--method', 'GET', endpoint]));
function collection(endpoint, key) {
  const result = get(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100`);
  need(Array.isArray(result[key]) && result.total_count === result[key].length && result[key].length <= 100);
  return result[key];
}
const metadata = rows => rows.map(({ name, created_at, updated_at }) => ({ name, created_at, updated_at }));
function regular(path) {
  for (let p = path; p !== '/'; p = dirname(p)) need(!lstatSync(p).isSymbolicLink());
  const info = lstatSync(path); need(info.isFile() && info.nlink === 1); return info;
}
function assertRawSource(a, remote) {
  const gitEnv = { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' };
  const git = args => command('/usr/bin/git', ['--no-replace-objects', ...args], undefined, gitEnv);
  need(realpathSync(ROOT) === git(['rev-parse', '--show-toplevel']).trim() && git(['rev-parse', 'HEAD']).trim() === a.sourceCommit
    && git(['rev-parse', 'HEAD^{tree}']).trim() === a.sourceTree && !git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim()
    && !git(['status', '--porcelain', '--untracked-files=all', '--', 'scripts', 'config', '.github', '.codex', 'AGENTS.md', 'package.json', 'package-lock.json', 'vercel.json']).trim()
    && [`https://github.com/${target.repository}.git`, `https://github.com/${target.repository}`, `git@github.com:${target.repository}.git`].includes(git(['remote', 'get-url', 'origin']).trim()));
  need(remote.sha === a.sourceTree && remote.truncated === false && Array.isArray(remote.tree));
  const rows = remote.tree.filter(row => row.type !== 'tree' && (['scripts/', 'config/', '.github/', '.codex/'].some(prefix => row.path?.startsWith(prefix))
    || ['AGENTS.md', 'package.json', 'package-lock.json', 'vercel.json'].includes(row.path)));
  need(rows.length > 0 && new Set(rows.map(row => row.path)).size === rows.length
    && ['scripts/preview-vercel-enrollment-recovery.mjs', 'scripts/lib/preview-vercel-enrollment-recovery.mjs',
      'scripts/lib/preview-vercel-enrollment-recovery-ledger.py', 'vercel.json'].every(path => rows.some(row => row.path === path)));
  for (const row of rows) {
    need(typeof row.path === 'string' && !row.path.startsWith('/') && row.path.split('/').every(part => part && !['.', '..'].includes(part))
      && row.type === 'blob' && ['100644', '100755'].includes(row.mode) && sha(row.sha));
    const path = join(ROOT, row.path), info = regular(path), raw = readFileSync(path);
    need((info.mode & 0o111 ? '100755' : '100644') === row.mode
      && createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex') === row.sha);
  }
}
function disabled(rows) {
  const value = name => { const matches = rows.filter(row => row.name === name); need(matches.length <= 1); return matches[0]?.value; };
  for (const name of ['FCOS_PREVIEW_EMAIL_BUILD_ENABLED', 'FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED']) need(value(name) === 'false');
  for (const name of ['FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED', 'FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED']) need([undefined, 'false'].includes(value(name)));
}
function assertIdleRuns() {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) need(!collection(`${base}/actions/runs?status=${status}`, 'workflow_runs')
    .some(run => /(?:preview-email-proof-build|production-release|runtime-compatibility-release)\.yml(?:@|$)/.test(run.path)));
}
const admittedRawTrees = new Map();
function publicPreflight(a, pairNames = []) {
  need(recoverySame(action(a.nonce), a));
  const user = get('user');
  need(user.login === fcosConnectionIdentifier('github', 'Required account') && Number.isSafeInteger(user.id) && user.id > 0);
  const repository = get(base), branch = get(`${base}/branches/main`), protection = get(`${base}/branches/main/protection`);
  need(user.login === fcosConnectionIdentifier('github', 'Required account') && Number.isSafeInteger(user.id) && user.id > 0
    && repository.full_name === target.repository && repository.owner?.id === user.id && repository.owner?.login === user.login
    && repository.default_branch === 'main' && repository.permissions?.admin === true && branch.name === 'main'
    && branch.commit?.sha === a.protectedMainSha && branch.protected === true && protection.enforce_admins?.enabled === true
    && protection.required_status_checks?.strict === true);
  const pr = get(`${base}/pulls/${a.sourcePullRequest}`);
  need(pr.number === a.sourcePullRequest && pr.state === 'open' && pr.draft === true && pr.user?.login === user.login
    && pr.head?.repo?.full_name === target.repository && pr.base?.repo?.full_name === target.repository
    && pr.head.ref === a.sourceBranch && pr.head.sha === a.sourceCommit && pr.base.ref === 'main' && pr.base.sha === a.protectedMainSha);
  need(get(`${base}/git/ref/heads/${encodeURIComponent(a.sourceBranch)}`).object?.sha === a.sourceCommit);
  const commit = get(`${base}/git/commits/${a.sourceCommit}`);
  need(commit.sha === a.sourceCommit && commit.tree?.sha === a.sourceTree);
  const rawTree = get(`${base}/git/trees/${a.sourceTree}?recursive=1`);
  assertRawSource(a, rawTree); admittedRawTrees.set(a.sourceCommit, rawTree);
  const environment = get(environmentPath), rules = environment.protection_rules?.filter(row => row.type === 'required_reviewers');
  const reviewer = rules?.length === 1 && rules[0].reviewers?.length === 1 ? rules[0].reviewers[0] : null;
  need(environment.name === target.environment && Number.isSafeInteger(environment.id) && environment.id > 0
    && environment.can_admins_bypass === false && reviewer?.type === 'User' && reviewer.reviewer?.id === user.id
    && reviewer.reviewer.login === user.login && rules[0].prevent_self_review === false
    && environment.deployment_branch_policy?.protected_branches === true && environment.deployment_branch_policy.custom_branch_policies === false);
  disabled(collection(`${environmentPath}/variables`, 'variables'));
  disabled(collection(`${base}/actions/variables`, 'variables'));
  assertIdleRuns();
  const rows = recoverySecretMetadata(metadata(collection(`${environmentPath}/secrets`, 'secrets')), [...RECOVERY_PRESERVED_SECRETS, ...pairNames]);
  need(recoverySame(rows.filter(row => !RECOVERY_PAIR.includes(row.name)), a.secretMetadata));
  return { binding: recoveryBinding(a), repositoryId: repository.id, environmentId: environment.id,
    sourceCommit: a.sourceCommit, sourceTree: a.sourceTree, protectedMainSha: a.protectedMainSha, secretMetadata: a.secretMetadata };
}


// Reuse only the authenticated immutable raw tree. The mutable run inventory
// is re-read inside issuance immediately before the sole POST.
// Every targeted guard still rechecks local raw bytes/HEAD, original action,
// current provider identity/head/protection/environment, flags and full secrets.
function targetedPreflight(a, pairNames = []) {
  need(recoverySame(action(a.nonce), a));
  const rawTree = admittedRawTrees.get(a.sourceCommit); need(rawTree); assertRawSource(a, rawTree);
  const user = get('user');
  need(user.login === fcosConnectionIdentifier('github', 'Required account') && Number.isSafeInteger(user.id) && user.id > 0);
  const branch = get(`${base}/branches/main`), protection = get(`${base}/branches/main/protection`);
  need(branch.name === 'main' && branch.commit?.sha === a.protectedMainSha && branch.protected === true
    && protection.enforce_admins?.enabled === true && protection.required_status_checks?.strict === true);
  const pr = get(`${base}/pulls/${a.sourcePullRequest}`);
  need(pr.number === a.sourcePullRequest && pr.state === 'open' && pr.draft === true && pr.user?.login === user.login
    && pr.head?.repo?.full_name === target.repository && pr.base?.repo?.full_name === target.repository
    && pr.head.ref === a.sourceBranch && pr.head.sha === a.sourceCommit && pr.base.ref === 'main' && pr.base.sha === a.protectedMainSha);
  const environment = get(environmentPath), rules = environment.protection_rules?.filter(row => row.type === 'required_reviewers');
  const reviewer = rules?.length === 1 && rules[0].reviewers?.length === 1 ? rules[0].reviewers[0] : null;
  need(environment.name === target.environment && Number.isSafeInteger(environment.id) && environment.id > 0
    && environment.can_admins_bypass === false && reviewer?.type === 'User' && reviewer.reviewer?.id === user.id
    && reviewer.reviewer.login === user.login && rules[0].prevent_self_review === false
    && environment.deployment_branch_policy?.protected_branches === true && environment.deployment_branch_policy.custom_branch_policies === false);
  disabled(collection(`${environmentPath}/variables`, 'variables'));
  disabled(collection(`${base}/actions/variables`, 'variables'));
  const rows = recoverySecretMetadata(metadata(collection(`${environmentPath}/secrets`, 'secrets')), [...RECOVERY_PRESERVED_SECRETS, ...pairNames]);
  need(recoverySame(rows.filter(row => !RECOVERY_PAIR.includes(row.name)), a.secretMetadata));
}

// Source-controlled add-only capsule custody. The compiled helper has no
// attestation-key operation and cannot select another account/service.
export function recoveryKeychainSource(enrollmentId) {
  need(uuid(enrollmentId));
  const manager = FCOS_CONNECTION_POLICY.providers.find(row => row.id === 'vercel').keychainService;
  return `import Foundation\nimport Security\nimport Darwin\nlet account = ${JSON.stringify(FCOS_CONNECTION_POLICY.keychainAccount)}\nlet manager = ${JSON.stringify(manager)}\nlet capsuleAccount = ${JSON.stringify(`${FCOS_CONNECTION_POLICY.keychainAccount}:${enrollmentId}`)}\nlet capsuleService = ${JSON.stringify(ENROLLMENT_KEYCHAIN_SERVICE)}\nfunc query(_ a:String,_ s:String)->[String:Any] { [kSecClass as String:kSecClassGenericPassword,kSecAttrAccount as String:a,kSecAttrService as String:s,kSecMatchLimit as String:kSecMatchLimitOne] }\nfunc read(_ a:String,_ s:String) { var q=query(a,s);q[kSecReturnData as String]=true;var result:CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&result)==errSecSuccess,let data=result as? Data else { exit(1) };FileHandle.standardOutput.write(data) }\nguard CommandLine.arguments.count==2 else { exit(1) }\nswitch CommandLine.arguments[1] {\ncase "read-manager":read(account,manager)\ncase "read-capsule":read(capsuleAccount,capsuleService)\ncase "require-absent":var q=query(capsuleAccount,capsuleService);q[kSecReturnAttributes as String]=true;var result:CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&result)==errSecItemNotFound else { exit(1) }\ncase "add-capsule":let data=FileHandle.standardInput.readDataToEndOfFile();guard !data.isEmpty && data.count<=4096 else { exit(1) };var q=query(capsuleAccount,capsuleService);q.removeValue(forKey:kSecMatchLimit as String);q[kSecValueData as String]=data;q[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;guard SecItemAdd(q as CFDictionary,nil)==errSecSuccess else { exit(1) }\ndefault:exit(1)\n}\n`;
}
async function fixedProvider(path, method, token, body) {
  const url = `https://api.vercel.com${path}`;
  try {
    const response = await NATIVE_FETCH(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    need(response.redirected === false && response.url === url && [200, ...(method === 'POST' ? [201] : [])].includes(response.status)
      && response.headers.get('content-type')?.includes('application/json'));
    const reader = response.body?.getReader(); need(reader); const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; need(size <= 1024 * 1024); chunks.push(value); } }
    finally { try { await reader.cancel(); } catch { /* Do not inspect cleanup diagnostics. */ } }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { recoveryFailure(); }
}
function saveState(a, state) {
  const root = `${PRIMARY}/.fcos-cli/preview-vercel-enrollment`; ownedDirectory(root);
  const directory = join(root, a.enrollmentId);
  try { mkdirSync(directory, { mode: 0o700 }); } catch { ownedDirectory(directory); }
  ownedDirectory(directory);
  const destination = join(directory, 'state.json');
  if (state.phase !== 'consumed_before_private_reads') {
    const previous = JSON.parse(privateRead(destination)); need(previous.operationId === a.operationId && previous.nonce === a.nonce);
  }
  const path = state.phase === 'consumed_before_private_reads' ? destination : join(directory, `.state-${randomUUID()}.json`);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, `${JSON.stringify(state)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  if (path !== destination) renameSync(path, destination);
  const dir = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(dir); } finally { closeSync(dir); }
}
function adapters(a) {
  let directory, binary, manager, claim, fullyAdmitted = false;
  const assertClaim = () => {
    need(claim);
    const current = JSON.parse(command('/usr/bin/python3', ['-I', ledgerPath, '--read-consumed', a.nonce]));
    need(recoverySame(current, claim));
    need(recoverySame(action(a.nonce), a));
    const rawTree = admittedRawTrees.get(a.sourceCommit); need(rawTree); assertRawSource(a, rawTree);
  };
  const venv = () => ({ PATH: '/usr/bin:/bin', HOME: env.HOME, VERCEL_TOKEN: manager, CI: '1', NO_COLOR: '1',
    VERCEL_TELEMETRY_DISABLED: '1', VERCEL_NO_UPDATE_NOTIFICATION: '1' });
  const varSet = (name, value) => {
    const before = collection(`${environmentPath}/variables`, 'variables'); disabled(before);
    const rows = before.filter(row => row.name === name); need(rows.length <= 1);
    need(recoverySame(action(a.nonce), a));
    assertClaim();
    command(gh, ['api', '--method', rows.length ? 'PATCH' : 'POST', `${environmentPath}/variables${rows.length ? `/${name}` : ''}`, '--input', '-'], JSON.stringify({ name, value }));
    need(get(`${environmentPath}/variables/${name}`).value === value);
    const after = collection(`${environmentPath}/variables`, 'variables'); disabled(after);
    need(recoverySame(before.filter(row => row.name !== name), after.filter(row => row.name !== name)));
  };
  return {
    publicPreflight(value) {
      if (!fullyAdmitted) { const result = publicPreflight(value); fullyAdmitted = true; return result; }
      return targetedPreflight(value);
    },
    claim() { claim = JSON.parse(command('/usr/bin/python3', ['-I', ledgerPath, '--claim-approved', a.nonce], undefined, env, 180000)); return claim; },
    assertClaim,
    save: saveState,
    prepareLocal() {
      directory = mkdtempSync(join(realpathSync(tmpdir()), 'fcos-enrollment-recovery-')); binary = join(directory, 'keychain');
      const source = join(directory, 'keychain.swift'); writeFileSync(source, recoveryKeychainSource(a.enrollmentId), { mode: 0o600 });
      const cache = join(directory, 'module-cache'); mkdirSync(cache, { mode: 0o700 });
      command('/usr/bin/swiftc', [source, '-module-cache-path', cache, '-o', binary], undefined, { ...env, CLANG_MODULE_CACHE_PATH: cache }); regular(binary);
    },
    async privatePreflight() {
      need(binary); regular(binary);
      command(binary, ['require-absent']);
      assertClaim(); // Recheck original clocks and lease after any Keychain consent.
      manager = command(binary, ['read-manager']); need(manager && !/\s/.test(manager) && manager.length <= 4096);
      assertClaim(); // Native consent cannot renew readiness or permit lease loss.
      const args = ['--global-config', `${PRIMARY}/.fcos-cli/vercel`, '--scope', fcosConnectionIdentifier('vercel', 'Team'), '--cwd', ROOT, '--no-color'];
      need(command(node, [vc, '--version'], undefined, venv()).trim().replace(/^Vercel CLI /i, '') === '54.20.1');
      need(command(node, [vc, 'whoami', ...args], undefined, venv()).trim() === fcosConnectionIdentifier('vercel', 'Account'));
      const api = path => JSON.parse(command(node, [vc, 'api', path, '--method', 'GET', ...args], undefined, venv()));
      need(api('/v2/user').user?.username === fcosConnectionIdentifier('vercel', 'Account'));
      const project = api(`/v9/projects/${target.projectId}?teamId=${target.teamId}`);
      const baseline = JSON.parse(readFileSync(join(ROOT, 'config/legacy-email-baseline-proof.json'))).baseline;
      need(project.id === target.projectId && project.accountId === target.teamId && project.name === fcosConnectionIdentifier('vercel', 'Project')
        && project.link?.type === 'github' && `${project.link.org}/${project.link.repo}` === target.repository
        && project.link.productionBranch === 'main' && project.targets?.production?.id === baseline.deploymentId
        && project.autoAssignCustomDomains === false && Array.isArray(project.link.deployHooks) && project.link.deployHooks.length === 0);
      const enabled = JSON.parse(readFileSync(join(ROOT, 'vercel.json'))).git?.deploymentEnabled;
      need(enabled === false || enabled && typeof enabled === 'object' && (enabled.main === false || !Object.hasOwn(enabled, 'main') && enabled['*'] === false));
      const production = api(`/v13/deployments/${baseline.deploymentId}?teamId=${target.teamId}`);
      need(production.id === baseline.deploymentId && production.projectId === target.projectId && production.ownerId === target.teamId
        && production.target === 'production' && production.readyState === 'READY' && production.meta?.githubCommitSha === baseline.sha
        && `https://${production.url}` === baseline.url);
    },
    issue() {
      assertIdleRuns(); assertClaim(); // Fresh mutable inventory; no clock renewal.
      return fixedProvider(`/v3/user/tokens?teamId=${target.teamId}`, 'POST', manager,
        { name: `fcos-preview-enrollment-${a.enrollmentId}`, projectId: target.projectId, expiresAt: a.expiresAt });
    },
    tokenMetadata: async id => { assertClaim(); need(typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) && id !== 'current');
      const result = await fixedProvider(`/v5/user/tokens/${id}`, 'GET', manager); need(result.token?.id === id); return result.token; },
    createCapsule: (_, text) => command(binary, ['add-capsule'], text),
    readCapsule: () => command(binary, ['read-capsule']),
    assertPairPublicationState: (_, name) => targetedPreflight(a, name === RECOVERY_PAIR[0] ? [] : [RECOVERY_PAIR[0]]),
    // GitHub secret creation is an upsert API. The canonical lease, fresh absent
    // destination check and one CLI invocation bound it; no CAS is claimed.
    createSecret: (name, value) => { need(RECOVERY_PAIR.includes(name)); command(gh, ['secret', 'set', name, '--repo', target.repository, '--env', target.environment], value); },
    secretMetadata: () => metadata(collection(`${environmentPath}/secrets`, 'secrets')),
    assertDisabled: () => targetedPreflight(a, RECOVERY_PAIR),
    publishDisabledPins: (_, tokenId) => { targetedPreflight(a, RECOVERY_PAIR);
      varSet('FCOS_RELEASE_VERCEL_TOKEN_ID', tokenId); targetedPreflight(a, RECOVERY_PAIR);
      varSet('FCOS_PREVIEW_VERCEL_ENROLLMENT_ID', a.enrollmentId); targetedPreflight(a, RECOVERY_PAIR); },
    cleanup: () => { manager = undefined; if (directory) rmSync(directory, { recursive: true, force: true }); },
  };
}
export async function runFixedEnrollmentRecovery(args) {
  need(Array.isArray(args) && args.length === 2 && ['--execute-approved', '--validate-ledger-admission'].includes(args[0]) && uuid(args[1])
    && process.platform === 'darwin' && process.version === 'v24.18.0'
    && realpathSync(process.execPath) === realpathSync(node)
    && !process.env.NODE_OPTIONS && !process.env.NODE_PATH && process.execArgv.length === 0
    && !['0', 'false'].includes(process.env.NODE_TLS_REJECT_UNAUTHORIZED)
    && process.argv[1] && resolve(process.argv[1]) === ownPath);
  const a = action(args[1]);
  if (args[0] === '--validate-ledger-admission') return { kind: 'fcos_actual_absent_enrollment_recovery_admission', nonce: a.nonce, actual: publicPreflight(a) };
  const io = adapters(a);
  try { return await runEnrollmentRecovery({ approval: a, nonce: a.nonce, hashes: hashes(), io }); }
  finally { try { io.cleanup(); } catch { /* No private diagnostics. */ } }
}
