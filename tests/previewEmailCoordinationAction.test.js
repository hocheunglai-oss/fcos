import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { assertCoordinationBackendReview, assertPreviewCoordinationAction, collectCoordinationBackendProof,
  COORDINATION_PROOF_SOURCE_FILES, COORDINATION_BACKEND_REVIEW_PATH, assertPreviewCoordinationPublicationCurrent } from '../scripts/lib/preview-email-coordination-action.mjs';
import { consumeHostedPreviewCoordinationClaim, assertHostedPreviewCoordinationClaim } from '../scripts/lib/preview-email-coordination-collector.mjs';
import { successorReleaseCoordinationVerified } from '../scripts/lib/release-coordination-transport.mjs';
import { createZipUploadStream } from '../node_modules/@actions/artifact/lib/internal/upload/zip.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runRuntimeCompatibilityRelease } from '../scripts/runtime-compatibility-release.mjs';
import { runPreviewEmailProofBuild } from '../scripts/preview-email-proof-build.mjs';
import { SUCCESSOR_LIVE_CONTRACT, SUCCESSOR_LIVE_HARNESS_FILES } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { previewEmailSignerEnabled } from '../scripts/lib/preview-email-signer.mjs';
import { legacyEmailCandidate } from '../scripts/lib/legacy-email-baseline-proof.mjs';
import { validateReleaseCoordinationBinding } from '../scripts/lib/release-coordination.mjs';
import { decodeCoordinationBackendResultArchive } from '../scripts/lib/coordination-backend-result-archive.mjs';
import { decodePreviewCoordinationArchive } from '../scripts/lib/preview-email-coordination-archive.mjs';
import { assertPreviewCoordinationIssuerEvidenceCurrent } from '../scripts/preview-email-coordinator-local.mjs';
import { execFileSync } from 'node:child_process';

const digest = value => createHash('sha256').update(value).digest('hex'), iso = value => new Date(value).toISOString();
const now = Date.parse('2026-10-10T12:35:00.000Z'), operator = fcosConnectionIdentifier('github', 'Required account');
const binding = { repository: fcosConnectionIdentifier('github', 'Repository'), harnessSha: 'a'.repeat(40), runId: 99, jobId: 100 };
const sources = COORDINATION_PROOF_SOURCE_FILES.map(path => ({ path, mode: lstatSync(path).mode & 0o111 ? '100755' : '100644', sha256: digest(readFileSync(path)) }));
function fixture() {
  const lease = { operationId: 'fcos-release-coordination-proof-99', bindingSha256: digest(JSON.stringify(binding)),
    providerAuthorityGranted: false, coordinationOnly: true, uncertainOutcomeRequiresReadback: true };
  const rootAction = { binding, lease, authorizedBy: operator, authorizedAt: now - 2000, actionAuthorizationSha256: 'a'.repeat(64) };
  const report = { kind: 'fcos_actual_artifact_coordination_backend_proof', binding, rootAction, capturedAt: iso(now),
    concurrency: 'one-winner-one-refusal', duplicate: 'refused', uncertainChildOutcome: 'GET-only-recovered', immutableReadback: true,
    grantsActivation: false, deploymentAuthority: false, artifacts: [{ marker: 'first' }, { marker: 'crash' }] };
  const acceptance = { kind: 'root_accepted_actual_pr105_artifact_backend_proof_v1', accepted: true, binding, actualReport: report,
    at: iso(now + 1000), originalDeadline: iso(now + 1790000), actionPublication: { sha256: 'b'.repeat(64) }, terminalBoundary: { sha256: 'c'.repeat(64) },
    actualPersonalReviewVerified: true, concurrencyOneWinnerOneRefusal: true, duplicateRefused: true, crashGetOnlyRecovered: true,
    immutableReadbackVerified: true, archiveDigestsMatchedActualProviderMetadata: true,
    backendActivationAuthority: false, privateSigningAuthority: false, productionDeploymentAuthority: false, archives: {} };
  const closure = { kind: 'root_reviewed_actual_pr105_artifact_backend_proof_operation_closure_v1', accepted: true, binding, lease,
    at: iso(now + 2000), operationConsumed: true, replayPermitted: false, backendProofPrerequisiteComplete: true,
    previewActivationAuthority: false, privateSigningAuthority: false, productionDeploymentAuthority: false,
    originalActionPublication: acceptance.actionPublication, actualTerminalBoundary: acceptance.terminalBoundary,
    materialAcceptance: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i), true])) };
  const record = () => {
    const acceptanceText = JSON.stringify(acceptance);
    closure.actualBackendAcceptance = { sha256: digest(acceptanceText) };
    return JSON.stringify({ schemaVersion: 1, kind: 'fcos_exact_04ee_closed_backend_review', accepted: true,
      grantsActivation: false, privateSigningAuthority: false, productionDeploymentAuthority: false,
      sources, acceptanceText, closureText: JSON.stringify(closure) });
  };
  return { acceptance, closure, report, record };
}
test('closed actual backend data requires original action/lease, immutable acceptance and full source closure', () => {
  const f = fixture(), raw = f.record(); assert.equal(assertCoordinationBackendReview(raw).sha256, digest(raw));
  for (const alter of [f => { f.acceptance.crashGetOnlyRecovered = false; }, f => { f.closure.replayPermitted = true; },
    f => { f.closure.lease = { ...f.closure.lease, bindingSha256: '0'.repeat(64) }; }, f => { f.acceptance.binding = { ...binding, runId: 98 }; },
    f => { f.closure.privateSigningAuthority = true; }, f => { f.report.rootAction.authorizedAt = now + 1; }]) {
    const changed = fixture(); alter(changed); assert.throws(() => assertCoordinationBackendReview(changed.record()));
  }
  for (const alter of [r => { r.sources.pop(); }, r => { r.sources[0].mode = '120000'; }, r => { r.acceptanceText += '\n'; },
    r => { r.closureText = JSON.stringify({ ...JSON.parse(r.closureText), actualBackendAcceptance: { sha256: '0'.repeat(64) } }); }]) {
    const r = JSON.parse(raw); alter(r); assert.throws(() => assertCoordinationBackendReview(JSON.stringify(r)));
  }
});
test('action admission preserves original binding and demands new readiness rather than source-only authority', async () => {
  const b = { issuanceObservedAt: now - 2000, intentAt: iso(now - 3000), originalOperation: 'fixture' };
  const a = { schemaVersion: 1, kind: 'root_admitted_preview_coordination_action', action: 'issue-preview-coordination',
    purpose: 'FCOS-EXACT-04EE-COORDINATION-GRANT-V1\0', authorizedBy: operator,
    target: { repository: binding.repository, environment: 'fcos-runtime-compatibility-release',
      workflow: '.github/workflows/preview-email-proof-build.yml',
      teamId: fcosConnectionIdentifier('vercel', 'Team ID'), projectId: fcosConnectionIdentifier('vercel', 'Project ID') },
    authorizedAt: now, privateReadinessAt: now - 1000, backendReviewSha256: 'd'.repeat(64), binding: b,
    scriptSha256: 'a'.repeat(64), actionAuthorizationEvidenceSha256: 'b'.repeat(64), implementationAuthoritySha256: 'c'.repeat(64),
    previewOnly: true, productionAuthorized: false, authorityBasis: { kind: 'existing_direct_human_authorization', localReviewGrantsAuthority: false, citations: [{}] },
    rootReview: { sha256: 'e'.repeat(64) }, independentReview: { sha256: 'f'.repeat(64) } };
  const raw = JSON.stringify(a); assert.equal(assertPreviewCoordinationAction(raw, b, a.backendReviewSha256, now).sha256, digest(raw));
  for (const alter of [a => { a.privateReadinessAt = now - 4000; }, a => { a.authorizedAt = now - 600000; },
    a => { a.productionAuthorized = true; }, a => { a.backendReviewSha256 = '0'.repeat(64); },
    a => { a.binding = { ...b, originalOperation: 'different' }; }, a => { a.authorityBasis.localReviewGrantsAuthority = true; }]) {
    const changed = structuredClone(a); alter(changed); assert.throws(() => assertPreviewCoordinationAction(JSON.stringify(changed), b, a.backendReviewSha256, now));
  }
  for (const dto of [a, { grant: a, signature: FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64 }, { observed: true, accepted: true }]) {
    assert.throws(() => assertHostedPreviewCoordinationClaim(dto, {})); await assert.rejects(() => consumeHostedPreviewCoordinationClaim(dto, {}));
    assert.equal(successorReleaseCoordinationVerified(dto, {}, dto), false);
  }
});
test('actual backend collector verifies immutable source modes and archives once per transport without branding fixture data', async () => {
  const f = fixture(), directory = mkdtempSync(join(tmpdir(), 'fcos-backend-data-'));
  const archives = new Map(); let calls = 0, corruptMode = false;
  try {
    for (const [i, phase] of ['concurrent', 'crash', 'result'].entries()) {
      const payload = phase === 'result' ? f.report : { kind: 'fcos_artifact_backend_exclusivity_probe', binding, marker: phase === 'crash' ? 'crash' : 'first' };
      const filename = phase === 'result' ? 'fcos-coordination-proof-99.json' : 'fcos-preview-email-coordination-claim.json';
      const path = join(directory, filename); writeFileSync(path, JSON.stringify(payload));
      const stream = await createZipUploadStream([{ sourcePath: path, destinationPath: filename, stats: lstatSync(path) }], 0);
      const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), metadata = { id: i + 200, name: `fcos-coordination-proof-${phase}-99`, expired: false,
        digest: `sha256:${digest(bytes)}`, created_at: iso(now - 1000), workflow_run: { id: 99, head_sha: binding.harnessSha } };
      f.acceptance.archives[metadata.name] = { metadata, archive: { sha256: digest(bytes) } }; archives.set(metadata.id, { bytes, metadata });
    }
    const raw = f.record(), content = (path, body) => ({ type: 'file', path, encoding: 'base64', content: body.toString('base64'),
      sha: createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex') });
    const reads = { json(endpoint) {
      calls++;
      if (endpoint.includes(`/contents/${COORDINATION_BACKEND_REVIEW_PATH}?`)) return content(COORDINATION_BACKEND_REVIEW_PATH, Buffer.from(raw));
      if (endpoint.includes('/git/trees/')) return { truncated: false, tree: sources.map(row => ({ ...row, type: 'blob', mode: corruptMode ? '120000' : row.mode,
        sha: content(row.path, readFileSync(row.path)).sha })) };
      for (const row of sources) if (endpoint.includes(`/contents/${row.path}?`)) return content(row.path, readFileSync(row.path));
      if (endpoint.endsWith('/actions/runs/99')) return { id: 99, run_attempt: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
        head_sha: binding.harnessSha, head_branch: 'main', repository: { full_name: binding.repository }, head_repository: { full_name: binding.repository },
        path: '.github/workflows/release-coordination-proof.yml', actor: { login: operator, id: 1 }, triggering_actor: { login: operator, id: 1 }, run_started_at: iso(now - 10000) };
      if (endpoint.endsWith('/actions/jobs/100')) return { id: 100, run_id: 99, run_attempt: 1, head_sha: binding.harnessSha,
        name: 'proof', status: 'completed', conclusion: 'success', started_at: iso(now - 9000), completed_at: iso(now + 500) };
      if (endpoint.endsWith('/approvals')) return [{ state: 'approved', user: { login: operator, id: 1 }, environments: [{ name: 'fcos-production-release' }] }];
      for (const [id, value] of archives) if (endpoint.endsWith(`/artifacts/${id}`)) return value.metadata;
      assert.fail(`Unexpected public fixture endpoint ${endpoint}`);
    }, archive(endpoint) { calls++; return archives.get(Number(/artifacts\/(\d+)/.exec(endpoint)[1])).bytes; } };
    const proof = await collectCoordinationBackendProof(reads, 'b'.repeat(40)); assert.equal(proof.observed, true);
    const firstCalls = calls; assert.equal(await collectCoordinationBackendProof(reads, 'b'.repeat(40)), proof); assert.equal(calls, firstCalls);
    assert.throws(() => assertHostedPreviewCoordinationClaim(proof, {}));
    corruptMode = true; await assert.rejects(() => collectCoordinationBackendProof({ ...reads }, 'b'.repeat(40)));
    archives.get(200).bytes[40] ^= 1; corruptMode = false;
    await assert.rejects(() => collectCoordinationBackendProof({ ...reads }, 'b'.repeat(40)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('native exact04ee entry collects source admission while fabricated runner options fail before private/provider I/O', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-native-admission-'));
  let privateAccesses = 0;
  const env = { GITHUB_RUN_ID: '99', RUNNER_TEMP: directory, get VERCEL_TOKEN() { privateAccesses++; assert.fail('Private provider access before admission'); } };
  try {
    const preflight = await runRuntimeCompatibilityRelease({ mode: 'execute', expectedCommit: SUCCESSOR_LIVE_CONTRACT.candidateSha,
      candidateUrl: 'https://fcos-fixture04-hocheunglai-6535s-projects.vercel.app', trustedCwd: directory, candidateCwd: directory, env });
    assert.equal(preflight.ready, false);
    assert.ok(preflight.blockers.some(row => row.code === 'CLEAN_EXACT_SOURCE_COLLECTION_FAILED'));
    await assert.rejects(() => runPreviewEmailProofBuild({ mode: 'create', candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha,
      trustedCwd: process.cwd(), candidateCwd: process.cwd(), env }), /runner_context/);
    assert.equal(privateAccesses, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('raw control closure covers all issuer, verifier, archive, native workflow and dependency paths; final2f4 stays gated', () => {
  for (const path of ['scripts/lib/preview-email-coordination-action.mjs', 'scripts/lib/coordination-backend-result-archive.mjs', 'scripts/lib/preview-email-coordination-collector.mjs',
    'scripts/lib/preview-email-coordination-ledger.py', 'scripts/preview-email-coordinator-local.mjs',
    'scripts/preview-email-proof-build.mjs', '.github/workflows/preview-email-proof-build.yml',
    'scripts/lib/release-coordination-transport.mjs', 'scripts/lib/release-coordination-ledger.py',
    'scripts/release-coordinator-local.mjs', 'scripts/lib/release-coordination-proof-worker.mjs', 'package.json', 'package-lock.json']) {
    assert.ok(SUCCESSOR_LIVE_HARNESS_FILES.includes(path), path);
  }
  const workflow = readFileSync('.github/workflows/preview-email-proof-build.yml', 'utf8');
  assert.equal((workflow.match(/--create\b/g) || []).length, 1); assert.ok(!workflow.includes('--coordinate'));
  assert.equal(previewEmailSignerEnabled(SUCCESSOR_LIVE_CONTRACT.deferredFinalSha, { observedProduction: true, admitted: true }), false);
  assert.equal(legacyEmailCandidate(SUCCESSOR_LIVE_CONTRACT.deferredFinalSha, { observedProduction: true, admitted: true }), null);
});
test('first compatibility binding requires separate exact backend and closure hashes while historical schema remains unchanged', () => {
  const b = { schemaVersion: 2, route: 'compatibility', repositoryId: 7, environmentId: 8, runId: 99, runAttempt: 1, jobId: 100,
    harnessSha: 'a'.repeat(40), operationId: 'fcos-release-99', dispatchedAt: now - 10000, jobStartedAt: now - 9000,
    intentAt: now - 1000, readinessAt: now - 2000, evidenceExpiresAt: now + 1700000,
    candidate: { sha: SUCCESSOR_LIVE_CONTRACT.candidateSha, sourceDigest: SUCCESSOR_LIVE_CONTRACT.sourceDigest,
      lockHash: SUCCESSOR_LIVE_CONTRACT.lockHash, configurationRevision: 'b'.repeat(64), deploymentId: 'dpl_Candidate04ee',
      url: 'https://fcos-fixture04-hocheunglai-6535s-projects.vercel.app' },
    previousProduction: { sha: 'c'.repeat(40), deploymentId: 'dpl_Previous', url: 'https://fcos-def123456-hocheunglai-6535s-projects.vercel.app' },
    readinessSha256: 'd'.repeat(64), backendReviewSha256: 'e'.repeat(64), backendClosureSha256: 'f'.repeat(64) };
  assert.deepEqual(validateReleaseCoordinationBinding(b, now), b);
  for (const alter of [b => { b.schemaVersion = 1; }, b => { delete b.backendClosureSha256; },
    b => { b.backendReviewSha256 = 'accepted'; }, b => { b.route = 'production'; }]) {
    const changed = structuredClone(b); alter(changed); assert.throws(() => validateReleaseCoordinationBinding(changed, now));
  }
  const historical = { ...b, schemaVersion: 1, candidate: { ...b.candidate, sha: '0'.repeat(40) } };
  delete historical.backendReviewSha256; delete historical.backendClosureSha256;
  assert.deepEqual(validateReleaseCoordinationBinding(historical, now), historical);
  assert.equal(successorReleaseCoordinationVerified(b, { accepted: true }, { accepted: true }), false);
});
test('last fixed variable read requires byte-identical current action and grant; revocation cannot be normalized away', () => {
  const expected = { actionText: ' {"action":"original"}\n', envelopeText: '{"grant":"original"}\n' };
  const rows = { action: { name: 'FCOS_PREVIEW_EMAIL_COORDINATION_ACTION', value: expected.actionText },
    grant: { name: 'FCOS_PREVIEW_EMAIL_COORDINATION_GRANT', value: expected.envelopeText } };
  assert.equal(assertPreviewCoordinationPublicationCurrent(rows, expected), true);
  for (const alter of [r => { delete r.action; }, r => { delete r.grant; }, r => { r.action.value = 'revoked'; },
    r => { r.grant.value = 'revoked'; }, r => { r.action.value = r.action.value.trim(); }, r => { r.grant.name = 'foreign'; }]) {
    const changed = structuredClone(rows); alter(changed); assert.throws(() => assertPreviewCoordinationPublicationCurrent(changed, expected));
  }
  assert.throws(() => assertHostedPreviewCoordinationClaim(rows, {}));
});

test('issuer final refresh refuses changed action, enrollment, metadata and admission without renewing originals', () => {
  const original = { admission: { capturedAt: iso(now), harnessSha: binding.harnessSha, context: { provisionedAt: iso(now - 1000) } },
    original: { intent: { intentAt: iso(now - 2000), requestSha256: 'a'.repeat(64) }, trust: { jobId: 100 } },
    binding, backendProof: { reviewSha256: 'b'.repeat(64) }, action: { sha256: 'c'.repeat(64) },
    actionText: 'original action\n', issuanceEnvelope: 'original enrolled receipt\n',
    secretMetadata: [{ name: 'FCOS_RELEASE_VERCEL_ENROLLMENT', created_at: iso(now - 1000), updated_at: iso(now - 1000) }] };
  const projection = { binding, backendProof: original.backendProof, actionSha256: original.action.sha256,
    issuanceEnvelopeSha256: digest(original.issuanceEnvelope), secretMetadata: original.secretMetadata };
  const current = structuredClone(original); current.admission.capturedAt = iso(now + 1);
  assert.equal(assertPreviewCoordinationIssuerEvidenceCurrent(original, current, projection), true);
  assert.equal(original.admission.capturedAt, iso(now));
  for (const alter of [a => { a.actionText += '\n'; }, a => { a.action.sha256 = 'd'.repeat(64); },
    a => { a.issuanceEnvelope += '\n'; }, a => { a.secretMetadata[0].updated_at = iso(now + 1); },
    a => { a.admission.context.provisionedAt = iso(now); }, a => { a.original.intent.intentAt = iso(now); },
    a => { a.original.trust.jobId++; }, a => { a.binding = { ...binding, runId: 98 }; },
    a => { a.backendProof.reviewSha256 = 'e'.repeat(64); }]) {
    const changed = structuredClone(current); alter(changed);
    assert.throws(() => assertPreviewCoordinationIssuerEvidenceCurrent(original, changed, projection));
  }
  assert.throws(() => assertPreviewCoordinationIssuerEvidenceCurrent(original, current, { ...projection, actionSha256: 'f'.repeat(64) }));
});

test('saved actual accepted archives pass complete offline backend collection with exact original result filename', async () => {
  const directory = new URL('./fixtures/coordination-backend-actual/', import.meta.url);
  const snapshot = (name, expected) => { const bytes = readFileSync(new URL(name, directory)); assert.equal(digest(bytes), expected); return JSON.parse(bytes); };
  const terminal = snapshot('terminal-artifact-boundary.json', 'f5ee1dd4ea39c08a043b8c7227125457d811df4bac10e8fc734e1251785810dd');
  const reviewed = snapshot('review-readback-123320.json', '341eb67e368a8713316579cf549db1396938b2451a30e22b1f350d1370bf7fe0');
  const raw = readFileSync(COORDINATION_BACKEND_REVIEW_PATH, 'utf8'), accepted = assertCoordinationBackendReview(raw);
  const { binding: originalBinding, actualReport } = accepted.acceptance.value;
  const content = (path, bytes) => ({ type: 'file', path, encoding: 'base64', content: bytes.toString('base64'),
    sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
  const old = new Map(accepted.value.sources.map(row => [row.path,
    execFileSync('/usr/bin/git', ['show', `${originalBinding.harnessSha}:${row.path}`])]));
  const tree = { truncated: false, tree: execFileSync('/usr/bin/git', ['ls-tree', '-r', '--full-tree', originalBinding.harnessSha], { encoding: 'utf8' })
    .split('\n').filter(Boolean).map(line => { const [mode, type, object, path] = line.split(/[\t ]/); return { path, mode, type, sha: object }; }) };
  const artifacts = new Map(Object.values(accepted.acceptance.value.archives).map(row => [row.metadata.id, row]));
  const reads = { json(endpoint) {
    if (endpoint.includes(`/contents/${COORDINATION_BACKEND_REVIEW_PATH}?`)) return content(COORDINATION_BACKEND_REVIEW_PATH, Buffer.from(raw));
    if (endpoint.includes('/git/trees/')) return tree;
    for (const [path, bytes] of old) if (endpoint.includes(`/contents/${path}?`)) return content(path, bytes);
    if (endpoint.endsWith(`/actions/runs/${originalBinding.runId}`)) return terminal.run;
    if (endpoint.endsWith(`/actions/jobs/${originalBinding.jobId}`)) return terminal.jobs.jobs.find(job => job.id === originalBinding.jobId);
    if (endpoint.endsWith('/approvals')) return reviewed.approvals;
    for (const [id, row] of artifacts) if (endpoint.endsWith(`/artifacts/${id}`)) return row.metadata;
    assert.fail(`Unexpected actual offline endpoint ${endpoint}`);
  }, archive(endpoint) {
    const id = Number(/artifacts\/(\d+)/.exec(endpoint)[1]), bytes = readFileSync(new URL(`actual-artifact-${id}.zip`, directory));
    assert.equal(digest(bytes), artifacts.get(id).archive.sha256); return bytes;
  } };
  const proof = await collectCoordinationBackendProof(reads, 'b'.repeat(40));
  assert.equal(proof.acceptanceSha256, accepted.acceptance.sha256); assert.equal(proof.closureSha256, accepted.closure.sha256);
  const result = reads.archive('artifacts/11670710077/zip');
  assert.deepEqual(decodeCoordinationBackendResultArchive(result, originalBinding.runId), actualReport);
  assert.throws(() => decodePreviewCoordinationArchive(result));
  for (const id of [originalBinding.runId + 1, '38052161466', 0, -1]) assert.throws(() => decodeCoordinationBackendResultArchive(result, id));
  assert.throws(() => decodeCoordinationBackendResultArchive(reads.archive('artifacts/11670745040/zip'), originalBinding.runId));
  assert.throws(() => assertHostedPreviewCoordinationClaim(proof, {}));
});
