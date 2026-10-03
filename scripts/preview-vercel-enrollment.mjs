import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { providerRuntime } from './fcos-connections.mjs';
import { assertProtectedDefault } from './lib/release-evidence.mjs';
import { PREVIEW_EMAIL_BUILD_ENABLE, PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLE, PREVIEW_EMAIL_CONTRACT_SHA256,
  previewEmailBuildCandidate, previewEmailBuildControlRevision } from './lib/preview-email-build.mjs';
import { ENROLLMENT_FIXED_TARGET as TARGET, ENROLLMENT_KEYCHAIN_SERVICE, ENROLLED_AUTHORITY_ENABLE,
  ENROLLED_AUTHORITY_MODE, ENROLLED_AUTHORITY_MODE_VARIABLE, ENROLLED_AUTHORITY_RECEIPT, ENROLLED_AUTHORITY_SECRET,
  createPrivateEnrollment, signEnrollmentReceipt, enrolledAuthorityContext } from './lib/preview-vercel-enrollment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = fcosConnectionIdentifier('github', 'Required account');
const RELEASE = 'FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED';
const TOKEN = 'FCOS_RELEASE_VERCEL_TOKEN';
const TOKEN_ID = 'FCOS_RELEASE_VERCEL_TOKEN_ID';
const ENROLLMENT_ID = 'FCOS_PREVIEW_VERCEL_ENROLLMENT_ID';
const SHA = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const HASH = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const UUID = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error('Enrollment operation failed; private diagnostics suppressed. Inspect the durable safe state before any recovery.'); };
const metadata = rows => rows.map(({ name, created_at, updated_at }) => ({ name, created_at, updated_at })).sort((a, b) => a.name.localeCompare(b.name));

export function enrollmentPlan() {
  return { schemaVersion: 1, enabledByDefault: false, target: TARGET, actions: ['enroll', 'attest'], providerCalls: 0,
    keyReads: 0, deploymentAuthorized: false, requirements: ['exact human action approval and helper/source hashes',
      'one durable issuance attempt; uncertain outcomes require separate reconciliation', 'paired private secrets remain disabled',
      'fresh run-bound signed metadata; existing attestor requires explicit new-purpose approval'] };
}
function assertSecretSnapshot(rows, now) {
  const allowed = ['FCOS_E2E_VERCEL_BYPASS', 'FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN',
    'FCOS_RELEASE_RUNTIME_TOKEN', TOKEN, ENROLLED_AUTHORITY_SECRET], names = new Set();
  const timestamp = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) fail();
    const parsed = Date.parse(value);
    if (!positive(parsed) || new Date(parsed).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) fail();
    return parsed;
  };
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > allowed.length) fail();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail();
    const descriptors = Object.getOwnPropertyDescriptors(row), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 3 || !['name', 'created_at', 'updated_at'].every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))) fail();
    const { name, created_at, updated_at } = row;
    if (!allowed.includes(name) || names.has(name)) fail();
    names.add(name);
    if (timestamp(created_at) > timestamp(updated_at) || timestamp(updated_at) > now + 30_000) fail();
  }
  if (!names.has('FCOS_RELEASE_GH_TOKEN') || !names.has(TOKEN)) fail();
}
function approvalData(a, action, scriptSha256, now) {
  if (!a || a.schemaVersion !== 1 || a.action !== action || !['enroll', 'attest'].includes(action)
    || a.authorized !== true || a.authorizedBy !== OWNER || typeof a.authorizationEvidence !== 'string' || !a.authorizationEvidence.trim()
    || !positive(a.authorizedAt) || a.authorizedAt > now || now - a.authorizedAt > 60 * 60_000
    || a.scriptSha256 !== scriptSha256 || !HASH(scriptSha256) || !UUID(a.nonce) || !UUID(a.enrollmentId)
    || !same(a.target, TARGET) || !SHA(a.harnessSha) || !SHA(a.candidateSha) || !HASH(a.controlRevision)
    || a.contractSha256 !== PREVIEW_EMAIL_CONTRACT_SHA256 || !positive(a.expiresAt) || !positive(a.leaseDeadline)
    || action === 'enroll' && !/^[A-Za-z0-9_-]{1,200}$/.test(a.previousReviewedTokenId || '')
    || a.expiresAt > a.leaseDeadline || a.expiresAt <= now || a.expiresAt - now > 24 * 60 * 60_000
    || action === 'attest' && (a.attestorNewPurposeAuthorized !== true || !positive(a.runId)
      || !['verify-authority', 'create', 'readback'].includes(a.operation))) fail();
  if (action === 'enroll') assertSecretSnapshot(a.secretMetadata, now);
  previewEmailBuildCandidate(a.candidateSha);
  return a;
}

// Adapters are injectable for offline failure tests. The CLI supplies only the
// fixed local adapters below; neither approval files nor receipts select code.
export async function runEnrollmentOperation({ action = 'plan', approval, scriptSha256, io, now = () => Date.now(),
  attestationPublicKey = FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64 } = {}) {
  if (action === 'plan') return enrollmentPlan();
  let state, claimed = false;
  try {
    const a = approvalData(approval, action, scriptSha256, now());
    // No provider or Keychain call occurs until the exact local approval passes.
    const checked = await io.preflight(a);
    approvalData(a, action, scriptSha256, now());
    const account = `${FCOS_CONNECTION_POLICY.keychainAccount}:${a.enrollmentId}`;
    if (action === 'enroll') {
      if (!same(metadata(checked.secrets), metadata(a.secretMetadata)) || checked.tokenId !== a.previousReviewedTokenId) fail();
      state = { schemaVersion: 1, enrollmentId: a.enrollmentId, nonce: a.nonce, phase: 'issuance_requested',
        requestedAt: now(), expiresAt: a.expiresAt, sourceSha: a.harnessSha, productionAuthorized: false };
      await io.claim(a, state); claimed = true; // Exclusive, durable, before the ONE non-retryable POST.
      const issuance = await io.issue(a);
      const fresh = await io.tokenMetadata(issuance?.token?.id);
      const capsule = createPrivateEnrollment({ issuance, metadata: fresh, enrollmentId: a.enrollmentId, requestedExpiresAt: a.expiresAt, now: now() });
      state.tokenId = capsule.enrollment.tokenId;
      state.phase = 'private_enrollment_write_requested'; await io.save(a, state);
      const privateText = JSON.stringify(capsule);
      await io.keychainSet(account, privateText);
      if (await io.keychainGet(account) !== privateText) fail();
      for (const [name, value] of [[TOKEN, issuance.bearerToken], [ENROLLED_AUTHORITY_SECRET, privateText]]) {
        state.phase = name === TOKEN ? 'bearer_write_requested' : 'companion_write_requested'; await io.save(a, state);
        if (now() >= a.expiresAt) fail();
        await io.secretSet(name, value);
      }
      // Partial writes cannot reach pins or activation. Neither success nor
      // failure changes a deployment/diagnostic/authority enable flag.
      const after = await io.secretMetadata();
      for (const name of [TOKEN, ENROLLED_AUTHORITY_SECRET, 'FCOS_RELEASE_GH_TOKEN']) {
        const rows = after.filter(row => row.name === name);
        if (rows.length !== 1 || !Number.isFinite(Date.parse(rows[0].created_at)) || !Number.isFinite(Date.parse(rows[0].updated_at))) fail();
        if (name !== 'FCOS_RELEASE_GH_TOKEN' && Date.parse(rows[0].updated_at) < state.requestedAt - 1000) fail();
      }
      const untouched = rows => metadata(rows.filter(row => ![TOKEN, ENROLLED_AUTHORITY_SECRET].includes(row.name)));
      if (!same(untouched(after), untouched(checked.secrets))) fail();
      await io.assertDisabled();
      await io.variableSet(TOKEN_ID, state.tokenId);
      await io.variableSet(ENROLLMENT_ID, a.enrollmentId);
      state.secretMetadata = metadata(after);
      state.phase = 'enrolled_disabled'; await io.save(a, state);
      return { enrolled: true, enrollmentId: a.enrollmentId, activationPerformed: false, productionAuthorized: false };
    }
    state = await io.readEnrollment(a);
    if (state?.phase !== 'enrolled_disabled' || state.enrollmentId !== a.enrollmentId || state.expiresAt !== a.expiresAt
      || !same(metadata(checked.secrets), state.secretMetadata)
      || checked.tokenId !== state.tokenId || checked.enrollmentId !== a.enrollmentId) fail();
    await io.claimAttestation(a); // One signed publication attempt per exact approval nonce.
    const privateEnrollment = await io.keychainGet(account);
    // Read the approved signing key BEFORE the metadata snapshot; user consent
    // latency therefore cannot rejuvenate an old metadata observation.
    const privateKey = await io.signingKey(), key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519' || createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64') !== attestationPublicKey) fail();
    const fresh = await io.tokenMetadata(state.tokenId), observedAt = now();
    if (typeof privateEnrollment !== 'string' || Buffer.byteLength(privateEnrollment) > 4096) fail();
    const parsed = JSON.parse(privateEnrollment);
    if (parsed?.enrollment?.enrollmentId !== a.enrollmentId || parsed.enrollment.tokenId !== state.tokenId || parsed.enrollment.expiresAt !== a.expiresAt) fail();
    const envelope = signEnrollmentReceipt({ privateEnrollment, metadata: fresh, context: enrolledAuthorityContext({
      repositoryId: checked.repositoryId, environmentId: checked.environmentId, runId: a.runId, harnessSha: a.harnessSha,
      controlRevision: a.controlRevision, contractSha256: a.contractSha256, candidateSha: a.candidateSha, operation: a.operation }), privateKey, now: observedAt });
    if (now() >= envelope.receipt.expiresAt) fail();
    await io.variableSet(ENROLLED_AUTHORITY_RECEIPT, JSON.stringify(envelope));
    if (now() >= envelope.receipt.expiresAt) fail();
    return { attested: true, runId: a.runId, runAttempt: 1, operation: a.operation,
      observedAt, expiresAt: envelope.receipt.expiresAt, activationPerformed: false, productionAuthorized: false };
  } catch {
    // Never access exception.message, cause, stdout or arbitrary getters.
    // In particular, an uncertain issuance is NEVER repeated or auto-revoked.
    if (action === 'enroll' && state && claimed) {
      state.phase = 'quarantined_reconciliation_required';
      try { await io.save(approval, state); } catch { /* The original exclusive intent remains the recovery boundary. */ }
    }
    fail();
  }
}

function buffered(command, args, { env, input, cwd = ROOT } = {}) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0 || result.error) fail();
  return result.stdout;
}
function localLayout() {
  const common = buffered('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const primary = dirname(common);
  const remote = buffered('git', ['remote', 'get-url', 'origin']).trim();
  if (![ `https://github.com/${TARGET.repository}.git`, `https://github.com/${TARGET.repository}`, `git@github.com:${TARGET.repository}.git` ].includes(remote)) fail();
  if (!common.endsWith('/.git') || buffered('git', ['-C', primary, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim() !== common) fail();
  return { primary, directory: join(primary, '.fcos-cli/preview-vercel-enrollment') };
}
function ownedDirectory(directory, create = false) {
  if (create) { try { mkdirSync(directory, { mode: 0o700 }); } catch { if (!lstatSync(directory).isDirectory()) fail(); } }
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022) fail();
  return directory;
}
function regularPrivate(fd) {
  const info = fstatSync(fd);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) fail();
}
export function readPrivateEnrollmentState(file, limit = 32 * 1024) {
  ownedDirectory(dirname(file));
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { regularPrivate(fd); if (fstatSync(fd).size > limit) fail(); return JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
}
export function writePrivateEnrollmentState(file, value, exclusive = false) {
  ownedDirectory(dirname(file));
  if (!exclusive) { const previous = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { regularPrivate(previous); } finally { closeSync(previous); } }
  const destination = exclusive ? file : join(dirname(file), `.state-${randomUUID()}.json`);
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { regularPrivate(fd); writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) renameSync(destination, file);
  const directory = openSync(dirname(file), constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(directory); } finally { closeSync(directory); }
}
function liveAdapters(a, layout) {
  const gh = providerRuntime('github');
  if (!gh.credentialAvailable) fail();
  const base = `repos/${TARGET.repository}`, environmentPath = `${base}/environments/${TARGET.environment}`;
  const github = (path, method = 'GET', body) => JSON.parse(buffered(gh.command, ['api', path, ...(method === 'GET' ? [] : ['--method', method, '--input', '-'])],
    { env: gh.env, ...(body === undefined ? {} : { input: JSON.stringify(body) }) }) || 'null');
  const collection = (path, key) => { const result = github(`${path}${path.includes('?') ? '&' : '?'}per_page=100`); if (!Array.isArray(result[key]) || result.total_count !== result[key].length || result[key].length > 100) fail(); return result[key]; };
  const variables = () => collection(`${environmentPath}/variables`, 'variables');
  const value = (rows, name) => { const matches = rows.filter(row => row.name === name); if (matches.length > 1) fail(); return matches[0]?.value; };
  const stateDirectory = join(layout.directory, a.enrollmentId), stateFile = join(stateDirectory, 'state.json');
  let keychain;
  let vc, operatorId;
  const assertOwner = () => { const user = github('user'); if (user.login !== OWNER || !positive(user.id) || operatorId && user.id !== operatorId) fail(); return user; };
  const provider = async (path, method = 'GET', body) => {
    const exactMetadata = /^\/v5\/user\/tokens\/[A-Za-z0-9_-]{1,200}$/.test(path);
    const allowed = [`/v9/projects/${TARGET.projectId}?teamId=${TARGET.teamId}`, '/v2/user',
      `/v13/deployments/${JSON.parse(readFileSync(join(ROOT, 'config/legacy-email-baseline-proof.json'))).baseline.deploymentId}?teamId=${TARGET.teamId}`];
    if (!vc || !(method === 'GET' && (exactMetadata || allowed.includes(path)) || method === 'POST' && path === `/v3/user/tokens?teamId=${TARGET.teamId}`)) fail();
    if (method === 'GET') return JSON.parse(buffered(vc.command, ['api', path, '--method', 'GET', ...vc.injectedArgs], { env: vc.env }));
    const url = `https://api.vercel.com${path}`;
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${vc.env.VERCEL_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.redirected !== false || response.url !== url || ![200, ...(method === 'POST' ? [201] : [])].includes(response.status)
      || !response.headers.get('content-type')?.includes('application/json')) fail();
    const reader = response.body?.getReader(); if (!reader) fail(); const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) fail(); chunks.push(value); } }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const assertDisabled = () => {
    for (const rows of [variables(), collection(`${base}/actions/variables`, 'variables')]) {
      for (const name of [PREVIEW_EMAIL_BUILD_ENABLE, RELEASE]) if (value(rows, name) !== 'false') fail();
      for (const name of [PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLE, ENROLLED_AUTHORITY_ENABLE]) if (![undefined, 'false'].includes(value(rows, name))) fail();
    }
  };
  return {
    async preflight(approval) {
      const user = assertOwner(); operatorId = user.id;
      const repository = github(base), branch = github(`${base}/branches/main`);
      if (user.login !== OWNER || !positive(user.id) || repository.full_name !== TARGET.repository || repository.owner?.login !== OWNER
        || repository.owner?.id !== user.id || repository.default_branch !== 'main' || repository.permissions?.admin !== true) fail();
      if (assertProtectedDefault(repository, branch, github(`${base}/branches/main/protection`)).sha !== approval.harnessSha
        || buffered('git', ['rev-parse', 'HEAD']).trim() !== approval.harnessSha || buffered('git', ['status', '--porcelain', '--untracked-files=normal']).trim()
        || previewEmailBuildControlRevision(ROOT) !== approval.controlRevision) fail();
      const candidate = previewEmailBuildCandidate(approval.candidateSha);
      if (github(`${base}/git/ref/heads/${encodeURIComponent(candidate.branch)}`).object?.sha !== approval.candidateSha) fail();
      const environment = github(environmentPath), rules = environment.protection_rules?.filter(row => row.type === 'required_reviewers');
      const reviewer = rules?.length === 1 && rules[0].reviewers?.length === 1 ? rules[0].reviewers[0] : null;
      if (environment.name !== TARGET.environment || !positive(environment.id) || environment.can_admins_bypass !== false
        || reviewer?.type !== 'User' || reviewer.reviewer?.login !== OWNER || reviewer.reviewer.id !== user.id || rules[0].prevent_self_review !== false
        || environment.deployment_branch_policy?.protected_branches !== true || environment.deployment_branch_policy?.custom_branch_policies !== false) fail();
      const rows = variables();
      for (const [name, expected] of Object.entries({ FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: approval.candidateSha,
        FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: approval.harnessSha, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: approval.controlRevision,
        FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: approval.contractSha256 })) if (value(rows, name) !== expected) fail();
      if (approval.action === 'enroll') assertDisabled();
      else {
        if (value(rows, RELEASE) !== 'false' || value(rows, ENROLLED_AUTHORITY_ENABLE) !== 'true' || value(rows, ENROLLED_AUTHORITY_MODE_VARIABLE) !== ENROLLED_AUTHORITY_MODE
          || value(rows, PREVIEW_EMAIL_BUILD_ENABLE) !== (approval.operation === 'verify-authority' ? 'false' : 'true')
          || approval.operation === 'verify-authority' && value(rows, PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLE) !== 'true') fail();
      }
      for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
        const runs = collection(`${base}/actions/runs?status=${status}`, 'workflow_runs');
        if (runs.some(run => /(?:preview-email-proof-build|production-release|runtime-compatibility-release)\.yml(?:@|$)/.test(run.path)
          && run.id !== approval.runId)) fail();
      }
      if (approval.action === 'attest') {
        const run = github(`${base}/actions/runs/${approval.runId}`);
        if (run.repository?.full_name !== TARGET.repository || run.head_repository?.full_name !== TARGET.repository || run.head_branch !== 'main'
          || run.head_sha !== approval.harnessSha || run.run_attempt !== 1 || run.event !== 'workflow_dispatch' || run.path?.split('@')[0] !== TARGET.workflow
          || run.actor?.id !== user.id || run.triggering_actor?.id !== user.id || run.actor?.login !== OWNER || run.triggering_actor?.login !== OWNER
          || !['waiting', 'in_progress', 'queued'].includes(run.status) || run.display_title !== `Review FCOS Preview email source ${approval.candidateSha}`) fail();
      }
      // Use reviewed source for providerRuntime; do not import mutable primary code.
      const swiftSource = join(ROOT, 'scripts/fcos-keychain-migrate.swift'), swiftDigest = digest(readFileSync(swiftSource));
      if (swiftDigest !== digest(buffered('git', ['show', `${approval.harnessSha}:scripts/fcos-keychain-migrate.swift`]))) fail();
      const compileDirectory = join(layout.directory, `compile-${approval.nonce}`);
      mkdirSync(compileDirectory, { mode: 0o700 }); ownedDirectory(compileDirectory);
      keychain = join(compileDirectory, 'fcos-keychain');
      buffered('/usr/bin/swiftc', [swiftSource, '-o', keychain]);
      const binary = lstatSync(keychain);
      if (!binary.isFile() || binary.isSymbolicLink() || binary.nlink !== 1 || binary.uid !== process.getuid()) fail();
      if (digest(readFileSync(swiftSource)) !== swiftDigest) fail();
      vc = providerRuntime('vercel', { requireCredential: false });
      if (buffered(vc.command, ['--version'], { env: vc.env }).trim().replace(/^Vercel CLI /i, '') !== '54.20.1') fail();
      const service = FCOS_CONNECTION_POLICY.providers.find(row => row.id === 'vercel').keychainService;
      vc.env.VERCEL_TOKEN = buffered(keychain, ['get', FCOS_CONNECTION_POLICY.keychainAccount, service]);
      if (!vc.env.VERCEL_TOKEN || buffered(vc.command, ['whoami', ...vc.injectedArgs], { env: vc.env }).trim() !== fcosConnectionIdentifier('vercel', 'Account')) fail();
      if ((await provider('/v2/user')).user?.username !== fcosConnectionIdentifier('vercel', 'Account')) fail();
      const project = await provider(`/v9/projects/${TARGET.projectId}?teamId=${TARGET.teamId}`), baseline = JSON.parse(readFileSync(join(ROOT, 'config/legacy-email-baseline-proof.json'))).baseline;
      if (project.id !== TARGET.projectId || project.accountId !== TARGET.teamId || project.name !== fcosConnectionIdentifier('vercel', 'Project')
        || project.link?.type !== 'github' || `${project.link.org}/${project.link.repo}` !== TARGET.repository || project.link.productionBranch !== 'main'
        || project.targets?.production?.id !== baseline.deploymentId || project.autoAssignCustomDomains !== false || !Array.isArray(project.link.deployHooks) || project.link.deployHooks.length) fail();
      const enabled = JSON.parse(readFileSync(join(ROOT, 'vercel.json'))).git?.deploymentEnabled;
      if (!(enabled === false || enabled && typeof enabled === 'object' && (enabled.main === false || !Object.hasOwn(enabled, 'main') && enabled['*'] === false))) fail();
      const production = await provider(`/v13/deployments/${baseline.deploymentId}?teamId=${TARGET.teamId}`);
      if (production.id !== baseline.deploymentId || production.projectId !== TARGET.projectId || production.ownerId !== TARGET.teamId
        || production.target !== 'production' || production.readyState !== 'READY' || production.meta?.githubCommitSha !== baseline.sha || `https://${production.url}` !== baseline.url) fail();
      return { repositoryId: repository.id, environmentId: environment.id, tokenId: value(rows, TOKEN_ID), enrollmentId: value(rows, ENROLLMENT_ID), secrets: collection(`${environmentPath}/secrets`, 'secrets') };
    },
    claim: (approval, state) => { ownedDirectory(stateDirectory, true); writePrivateEnrollmentState(stateFile, state, true); },
    save: (approval, state) => writePrivateEnrollmentState(stateFile, state),
    readEnrollment: () => readPrivateEnrollmentState(stateFile),
    claimAttestation: approval => { writePrivateEnrollmentState(join(stateDirectory, `attestation-${approval.nonce}.json`), { nonce: approval.nonce, runId: approval.runId, phase: 'publication_requested' }, true); },
    // CLI 54.20.1 tokens add cannot set an exact expiry. One fixed REST POST is
    // used instead; all output remains buffered and is never logged or retried.
    issue: approval => provider(`/v3/user/tokens?teamId=${TARGET.teamId}`, 'POST', { name: `fcos-preview-enrollment-${approval.enrollmentId}`, projectId: TARGET.projectId, expiresAt: approval.expiresAt }),
    tokenMetadata: async id => { if (!/^[A-Za-z0-9_-]{1,200}$/.test(id || '')) fail(); const result = await provider(`/v5/user/tokens/${id}`); return result.token; },
    keychainSet: (account, value) => buffered(keychain, ['set-stdin', account, ENROLLMENT_KEYCHAIN_SERVICE], { input: value }),
    keychainGet: account => buffered(keychain, ['get', account, ENROLLMENT_KEYCHAIN_SERVICE]),
    signingKey: () => buffered(keychain, ['get', FCOS_CONNECTION_POLICY.keychainAccount, FCOS_CONNECTION_POLICY.attestation.privateKeyService]),
    secretSet: (name, value) => { if (![TOKEN, ENROLLED_AUTHORITY_SECRET].includes(name)) fail(); assertOwner(); buffered(gh.command, ['secret', 'set', name, '--repo', TARGET.repository, '--env', TARGET.environment], { env: gh.env, input: value }); },
    secretMetadata: () => collection(`${environmentPath}/secrets`, 'secrets'), assertDisabled,
    variableSet: (name, value) => {
      if (![TOKEN_ID, ENROLLMENT_ID, ENROLLED_AUTHORITY_RECEIPT].includes(name)) fail();
      const present = variables().some(row => row.name === name);
      assertOwner();
      github(`${environmentPath}/variables${present ? `/${name}` : ''}`, present ? 'PATCH' : 'POST', { name, value });
      if (github(`${environmentPath}/variables/${name}`).value !== value) fail();
    },
  };
}

export async function enrollmentMain(args = process.argv.slice(2)) {
  try {
    if (!args.length || same(args, ['--plan'])) return enrollmentPlan();
    if (args.length !== 3 || args[0] !== '--execute-approved' || !['enroll', 'attest'].includes(args[1]) || !UUID(args[2])) fail();
    const layout = localLayout();
    ownedDirectory(layout.primary); ownedDirectory(join(layout.primary, '.fcos-cli')); ownedDirectory(layout.directory);
    const approval = readPrivateEnrollmentState(join(layout.directory, `approval-${args[2]}.json`));
    const scriptSha256 = digest(readFileSync(fileURLToPath(import.meta.url)));
    approvalData(approval, args[1], scriptSha256, Date.now());
    if (approval.nonce !== args[2]) fail();
    return await runEnrollmentOperation({ action: args[1], approval, scriptSha256, io: liveAdapters(approval, layout) });
  } catch { fail(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await enrollmentMain())); }
  catch { console.error('Enrollment operation failed; private diagnostics suppressed. Reconcile the durable intent before any recovery.'); process.exitCode = 1; }
}
