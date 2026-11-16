import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fcosSalesforceEnvironment, FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { DeploymentJournal, pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';
import { LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import { assertEditorDesktopReview, awaitDeveeDesktopReceipt, createDeveeDesktopReceipt, createDeveeDesktopRequest,
  DEVEE_DESKTOP_OPERATION, DEVEE_DESKTOP_WORKFLOW, editorDesktopCases, editorDesktopCaseSetDigest,
  recordVerifiedDeveeDesktopCheckpoint, verifyDeveeDesktopReceipt } from '../scripts/lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';

const now = Date.parse('2026-11-16T00:00:00.000Z');
const at = offset => new Date(now + offset).toISOString();
const hash = character => character.repeat(64);
const sha = character => character.repeat(40);
const devee = fcosSalesforceEnvironment('devee');
const { publication } = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');
const owner = { id: publication.requiredAccountId, login: publication.requiredAccount };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const repo = { id: 1278654816, full_name: targets().repository, default_branch: 'main', owner };
const components = ['ApexClass:FcosTradeCurrencyService',
  ...['fcbEditOfferLineItemModal', 'fcbEditSupplierBidModal', 'fcbPromotedOfferLineItemExtraCosts',
    'fcbSupplierBidExtraCosts', 'fcosTradeCurrencyEditor'].map(name => 'LightningComponentBundle:' + name)];

function fixture() {
  const manifest = { releaseId: 'editors-exact-release', controllerSha: sha('a'), candidate: { sha: sha('b') }, build: { buildId: hash('f') } };
  const run = { id: 42, run_attempt: 1, actor: owner, repository: repo, head_branch: repo.default_branch,
    event: 'workflow_dispatch', status: 'in_progress', path: DEVEE_DESKTOP_WORKFLOW, head_sha: sha('c') };
  const approval = { manifestHash: digest(manifest), nativeReviewVerified: true,
    candidateSha: manifest.candidate.sha, buildId: manifest.build.buildId, reviewer: owner.login, runId: run.id, approvedAt: at(-60000) };
  const reviewed = { review: { nativeDeveeDesktop: { caseSetDigest: editorDesktopCaseSetDigest }, nativeProjection: 'schema-free-apex-lightning' },
    fingerprint: hash('1'), binding: { sourceTreeHash: hash('2'), orgIds: { devee: devee.orgId } },
    nativeInventories: { devee: { final: { inventoryHash: hash('3'), projectedNativeInventory: true } } } };
  const deployment = { status: 'Succeeded', orgId: devee.orgId, fingerprint: reviewed.fingerprint,
    jobId: '0Af000000000000002', validationJobId: '0Af000000000000001' };
  const inventory = { orgId: devee.orgId, inventoryHash: hash('3'), observedNativeInventoryHash: hash('4'),
    evidenceSha256: hash('5'), verifiedAt: at(-1000), identity: { isSandbox: true, username: devee.username },
    verificationMethod: 'metadata-api-reviewed-native-byte-inventory' };
  const workflowProof = { kind: 'native_workflow_blob_match', controllerSha: manifest.controllerSha,
    dispatcherSha: run.head_sha, path: DEVEE_DESKTOP_WORKFLOW, blobSha: sha('d') };
  const input = { manifest, approval, reviewed, deployment, inventory, execution: { user: bot, repo, run }, workflowProof, now };
  const request = createDeveeDesktopRequest(input);
  const environment = LOCAL_MIRROR_ENVIRONMENT;
  const requestDeployment = { id: 101, creator: bot, sha: request.candidateSha, environment, payload: request, created_at: at(1000) };
  const report = { orgId: request.orgId, isSandbox: true, deploymentJobId: request.deploymentJobId,
    validationJobId: request.validationJobId, sourceTreeHash: request.sourceTreeHash, installedInventoryHash: request.installedInventoryHash,
    caseSetDigest: request.caseSetDigest, startedAt: at(2000), verifiedAt: at(4000), roles: ['normal', 'restricted'],
    cases: editorDesktopCases.map(id => ({ id, passed: true, evidenceDigest: digest(id) })),
    businessWrites: 0, financialRequests: 0, customerSends: 0, approvedFixturesOnly: true,
    syntheticFixtureWrites: 2, fixturesRestored: true, evidenceDigest: hash('6') };
  const receipt = createDeveeDesktopReceipt({ request, requestId: requestDeployment.id, report });
  const receiptDeployment = { id: 102, creator: owner, sha: request.candidateSha, environment, payload: receipt, created_at: at(5000) };
  return { input, request, requestDeployment, report, receiptDeployment, environment };
}

test('only the frozen scope of the combined Editors review can opt into the DEVEE checkpoint', () => {
  const { input: { reviewed } } = fixture();
  assert.doesNotThrow(() => assertEditorDesktopReview({}, [], undefined));
  assert.doesNotThrow(() => assertEditorDesktopReview(reviewed.review, components, reviewed.nativeInventories));
  assert.throws(() => assertEditorDesktopReview(reviewed.review, components.slice(1), reviewed.nativeInventories), /DEVEE_DESKTOP_REVIEW_SCOPE_INVALID/);
  assert.throws(() => assertEditorDesktopReview({ ...reviewed.review, bootstrap: {} }, components, reviewed.nativeInventories), /REVIEW_SCOPE_INVALID/);
  assert.throws(() => assertEditorDesktopReview({ ...reviewed.review, nativeDeveeDesktop: { caseSetDigest: hash('0') } },
    components, reviewed.nativeInventories), /REVIEW_SCOPE_INVALID/);
});

test('request binds original DEVEE Quick Deploy, its native final tree and exact currently approved workflow', () => {
  const { input, request } = fixture();
  assert.equal(request.runId, input.approval.runId);
  assert.equal(request.deploymentJobId, input.deployment.jobId);
  assert.equal(request.workflowBlobSha, input.workflowProof.blobSha);
  assert.equal(request.inventoryReceiptDigest, input.inventory.evidenceSha256);
  const mutations = [
    value => { value.execution.run.run_attempt = 2; },
    value => { value.execution.run.actor = bot; },
    value => { value.execution.run.path = '.github/workflows/other.yml'; },
    value => { value.workflowProof.controllerSha = sha('9'); },
    value => { value.approval.runId += 1; },
    value => { value.approval.buildId = hash('e'); },
    value => { value.inventory.verifiedAt = at(-301000); },
    value => { value.inventory.identity.isSandbox = false; },
    value => { value.inventory.inventoryHash = hash('9'); },
    value => { value.deployment.validationJobId = value.deployment.jobId; },
  ];
  for (const change of mutations) {
    const invalid = structuredClone(input);
    change(invalid);
    assert.throws(() => createDeveeDesktopRequest(invalid), /DEVEE_DESKTOP_(WORKFLOW_INVALID|POSTIMAGE_REQUIRED)/);
  }
});

test('native owner receipt attests exact installed bytes, cases, roles and zero prohibited writes', () => {
  const { request, requestDeployment, receiptDeployment, report, environment } = fixture();
  const verify = options => verifyDeveeDesktopReceipt({ request, requestDeployment, receiptDeployment, environment, now: now + 6000, ...options });
  assert.deepEqual(verify(), { requestId: 101, requestDigest: digest(request), proofId: 102, proofDigest: receiptDeployment.payload.proofDigest });
  for (const invalid of [{ roles: ['normal'] }, { cases: report.cases.slice(1) }, { businessWrites: 1 },
    { fixturesRestored: false }, { approvedFixturesOnly: false }, { isSandbox: false }, { customerSends: 1 }, { financialRequests: 1 },
    { deploymentJobId: request.validationJobId }, { installedInventoryHash: hash('7') }]) {
    assert.throws(() => createDeveeDesktopReceipt({ request, requestId: 101, report: { ...report, ...invalid } }), /DEVEE_DESKTOP_EVIDENCE_INVALID/);
  }
  assert.throws(() => verify({ receiptDeployment: { ...receiptDeployment, creator: bot } }), /NATIVE_RECEIPT_INVALID/);
  assert.throws(() => verify({ requestDeployment: { ...requestDeployment, creator: owner } }), /NATIVE_REQUEST_INVALID/);
  assert.throws(() => verify({ request: { ...request, runId: request.runId + 1 } }), /NATIVE_REQUEST_INVALID/);
  assert.throws(() => verify({ receiptDeployment: { ...receiptDeployment, created_at: at(3000) } }), /NATIVE_RECEIPT_INVALID/);
  assert.throws(() => verify({ now: Date.parse(request.expiresAt) }), /NATIVE_REQUEST_INVALID/);
  assert.throws(() => verify({ receiptDeployment: { ...receiptDeployment, payload: { ...receiptDeployment.payload, proofDigest: hash('9') } } }),
    /NATIVE_RECEIPT_INVALID/);
});

test('pending, duplicate and expired desktop proofs preserve a single request without publication', async () => {
  const { request, requestDeployment, receiptDeployment, environment } = fixture();
  let requestCalls = 0;
  const input = { request, environment, recordRequest: async () => { requestCalls++; return requestDeployment; } };
  const expiry = Date.parse(request.expiresAt);
  let clock = expiry - 100;
  await assert.rejects(awaitDeveeDesktopReceipt({ ...input, now: () => clock,
    readRecords: async () => [{ ...receiptDeployment, creator: bot }], pause: async elapsed => { clock += elapsed; } }),
  /DEVEE_DESKTOP_EVIDENCE_WINDOW_ENDED/);
  assert.equal(requestCalls, 1);
  await assert.rejects(awaitDeveeDesktopReceipt({ ...input, now: () => now + 6000,
    readRecords: async () => [receiptDeployment, { ...receiptDeployment, id: 103 }] }), /NATIVE_RECEIPT_DUPLICATE/);
  const result = await awaitDeveeDesktopReceipt({ ...input, now: () => now + 6000, readRecords: async () => [receiptDeployment] });
  assert.equal(result.proofId, receiptDeployment.id);
  assert.equal(requestCalls, 3);
});

test('typed journal acknowledgement recovery reuses the native checkpoint once', async () => {
  const { input, request, requestDeployment, receiptDeployment, environment } = fixture();
  const rows = [];
  let writes = 0;
  const github = { candidateSha: request.candidateSha, pages: async () => rows,
    async write(_path, body) { rows.push({ id: 103, creator: bot, ...body }); writes++; throw Error('lost acknowledgement'); } };
  const journal = new DeploymentJournal({ github, releaseId: request.releaseId, manifestHash: input.approval.manifestHash, actorIds: [bot.id] });
  const proof = verifyDeveeDesktopReceipt({ request, requestDeployment, receiptDeployment, environment, now: now + 6000 });
  const readback = { ...input.inventory, evidenceSha256: hash('8') };
  const args = { journal, request, receipt: proof };
  await assert.rejects(recordVerifiedDeveeDesktopCheckpoint({ ...args,
    readInstalledInventory: async () => ({ ...readback, observedNativeInventoryHash: hash('9') }) }), /DEVEE_DESKTOP_POSTIMAGE_CHANGED/);
  assert.equal(writes, 0);
  const record = () => recordVerifiedDeveeDesktopCheckpoint({ ...args, readInstalledInventory: async () => readback });
  assert.equal((await record()).proofId, 102);
  assert.equal((await record()).proofId, 102);
  assert.equal(writes, 1);
  assert.equal(rows[0].payload.data.desktop.proofId, receiptDeployment.id);
  assert.equal(rows[0].payload.data.outcome, 'evidence');
  assert.deepEqual(pendingOperations(await journal.read()), []);
  await assert.rejects(journal.checkpoint({ fingerprint: request.fingerprint, stage: 'production', operation: DEVEE_DESKTOP_OPERATION,
    record: { status: 'observed' } }), /DEVEE_DESKTOP_CHECKPOINT_INVALID/);
});
