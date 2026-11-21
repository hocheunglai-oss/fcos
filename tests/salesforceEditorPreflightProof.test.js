import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { salesforcePromotionHash } from '../scripts/lib/salesforce-promotion-journal.mjs';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { editorDesktopCases, editorDesktopCaseSetDigest } from '../scripts/lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';
import { EDITOR_PREFLIGHT_COMPONENTS, EDITOR_PREFLIGHT_COMPONENT_FILES, EDITOR_PREFLIGHT_ENVIRONMENT,
  EDITOR_PREFLIGHT_MAX_AGE_MS, EDITOR_PREFLIGHT_PROOF_KIND, EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT,
  EDITOR_PREFLIGHT_SOURCE_KIND, createEditorNativeExportProjection, verifyEditorReviewedNativeProjection, verifySalesforceEditorPreflightProof }
  from '../scripts/lib/rapid-release/salesforce-editor-preflight-proof.mjs';
import { createEditorPreflightAttestation, EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT, EDITOR_PREFLIGHT_ATTESTATION_TASK,
  readEditorPreflightAttestation, verifyEditorPreflightPostimage }
  from '../scripts/lib/rapid-release/salesforce-editor-preflight-transport.mjs';

const clock = Date.parse('2026-11-18T08:00:00.000Z');
const at = seconds => new Date(clock + seconds * 1000).toISOString();
const hash = value => digest(value);
const sha = character => character.repeat(40);
const devee = fcosSalesforceEnvironment('devee');
const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const owner = { id: publication.requiredAccountId, login: publication.requiredAccount };
const validationId = '0Af000000000000001', deploymentId = '0Af000000000000002';
const effects = syntheticFixtureWrites => ({ businessWrites: 0, financialRequests: 0, customerSends: 0, syntheticFixtureWrites });
const transport = order => ({ order, buySourceAndProductMatch: true, sellSourceAndProductMatch: true });
const ordinary = unitPriceMinor => ({
  currency: 'USD', unitPriceMinor, subtotalMinor: unitPriceMinor * 2, editableUnitPriceMinor: unitPriceMinor, saveSubmitted: false,
});
const observationsByCase = {
  'transport-source-both-orders': { forward: transport('buy-sell'), reverse: transport('sell-buy') },
  'wrong-product-rejected': { buySourceAndProductMatch: true, productDiffersFromBothSources: true, sellSourceAbsent: true },
  'ordinary-usd-preview': { quote: ordinary(12_000), supplier: ordinary(8_000) },
  'managed-hkd-rate-and-review': { currency: 'HKD', renderedRate: 7.84, signedRate: 7.84, rateLocked: true, reviewHeld: true },
  'scoped-save-and-stale-response': {
    savedOnlySelectedFixture: true, confirmationReadbackMatched: true, olderResponseArrivedAfterSwitch: true, stalePriceAbsent: true,
  },
  'normal-and-restricted-access': {
    normal: { cardMounted: true, signedEligible: true },
    restricted: { nativeDenied: true, visibleDenial: true, writeControlsRendered: false },
  },
};

function nativeReport(checkOnly) {
  return { status: 0, result: {
    id: checkOnly ? validationId : deploymentId, status: 'Succeeded', success: true, done: true, checkOnly,
    rollbackOnError: true, numberComponentErrors: 0, numberComponentsDeployed: 13,
    numberTestErrors: 0, numberTestsCompleted: checkOnly ? 600 : 0,
    createdDate: at(checkOnly ? 1 : 3), completedDate: at(checkOnly ? 2 : 4),
    details: { componentSuccesses: [
      ...EDITOR_PREFLIGHT_COMPONENTS.map(id => ({ componentType: id.split(':')[0], fullName: id.split(':')[1], success: true, deleted: false })),
      { componentType: '', fullName: 'package.xml', success: true, deleted: false },
    ], componentFailures: [], runTestResult: { codeCoverageWarnings: [] } },
  } };
}
function fixture() {
  const source = { candidateSha: sha('a'), sourceTreeHash: hash('metadata tree'), dependencyLockDigest: hash('package lock'),
    componentFiles: Object.fromEntries(EDITOR_PREFLIGHT_COMPONENT_FILES.map(path => [path, { sha256: hash(path), size: 100 }])),
    dependencyFiles: { 'classes/TestDataFactory.cls': { sha256: hash('test factory'), size: 123 },
      'classes/VariableChargeInvoiceReadinessService.cls': { sha256: hash('live Puccini dependency'), size: 456 } },
    fixtureSourceDigest: hash('complete temporary fixture source'), assumptionsDigest: hash('native configuration and permissions') };
  const actors = [
    { role: 'normal', userId: '005000000000001AAA', profile: 'FCB Trader', permissionEvidenceDigest: hash('normal grant') },
    { role: 'restricted', userId: '005000000000001AAA', profile: 'FCB Trader', permissionEvidenceDigest: hash('native revocation') },
  ];
  const cleanupScope = { records: ['synthetic-quote', 'synthetic-line'], managedSides: ['synthetic-side'],
    metadata: ['LightningComponentBundle:fixtureHost'], assignments: ['temporary-grant'], listeners: ['fixture-listener'] };
  const restored = { sourceTreeHash: hash('baseline metadata tree'), inventoryHash: hash('restored baseline') };
  const cleanup = { orgId: devee.orgId, completedAt: at(24),
    restoration: { ...restored, observedAt: at(23), evidenceDigest: hash('complete restoration native read') },
    ...Object.fromEntries(Object.entries(cleanupScope).map(([category, ids]) => [category,
      ids.map(id => ({ id, state: category === 'listeners' ? 'stopped' : 'absent', observedAt: at(22), evidenceDigest: hash('native read ' + id) }))])),
  };
  const nativeEvidence = { validation: nativeReport(true), deployment: nativeReport(false),
    inventory: { orgId: devee.orgId, username: devee.username, isSandbox: true, sourceTreeHash: source.sourceTreeHash,
      componentFiles: structuredClone(source.componentFiles), dependencyFiles: structuredClone(source.dependencyFiles),
      inventoryHash: hash('installed native inventory'), observedAt: at(5) }, cleanup };
  const caseEvidence = {};
  const cases = editorDesktopCases.map((id, index) => {
    const evidence = { caseId: id, outcome: 'passed', runId: 44000000001, startedAt: at(6 + index), completedAt: at(6.5 + index),
      sourceDigest: digest(source), actorRoles: id === 'normal-and-restricted-access' ? ['normal', 'restricted'] : ['normal'],
      effects: effects(id === 'scoped-save-and-stale-response' ? 2 : 0),
      observations: { ...structuredClone(observationsByCase[id]), nativeEventDigest: hash(id + ' native event') } };
    const evidenceDigest = digest(evidence);
    caseEvidence[evidenceDigest] = evidence;
    return { id, outcome: 'passed', runId: evidence.runId, startedAt: evidence.startedAt, completedAt: evidence.completedAt,
      evidenceDigest, source: structuredClone(source), sourceAttestationId: null };
  });
  const payload = { schemaVersion: 1, kind: EDITOR_PREFLIGHT_PROOF_KIND, repository: targets().repository,
    controllerSha: sha('b'), baselineSha: sha('c'), source: structuredClone(source),
    org: { orgId: devee.orgId, username: devee.username, isSandbox: true },
    startedAt: at(0), completedAt: at(25), expiresAt: at(3600), caseSetDigest: editorDesktopCaseSetDigest,
    native: { validationJobId: validationId, deploymentJobId: deploymentId, packageDigest: hash('immutable deploy package'),
      validationEvidenceDigest: digest(nativeEvidence.validation), deploymentEvidenceDigest: digest(nativeEvidence.deployment),
      inventoryEvidenceDigest: digest(nativeEvidence.inventory), inventoryHash: nativeEvidence.inventory.inventoryHash },
    actors: structuredClone(actors), cases, effects: effects(2),
    cleanup: { evidenceDigest: digest(cleanup), completedAt: cleanup.completedAt, restoredInventoryHash: restored.inventoryHash } };
  const receipt = { id: 1234, creator: owner, environment: EDITOR_PREFLIGHT_ENVIRONMENT,
    sha: source.candidateSha, created_at: at(26), payload };
  const expected = { receiptId: receipt.id, receiptDigest: digest(payload), controllerSha: payload.controllerSha,
    baselineSha: payload.baselineSha, source, packageDigest: payload.native.packageDigest, inventoryHash: payload.native.inventoryHash,
    minimumTests: 600, actors, restoration: restored, cleanupScope };
  return { receipt, expected, nativeEvidence, caseEvidence, historicalAttestations: [], historicalNativeEvidence: {}, now: clock + 30_000 };
}
function seal(input) {
  input.expected.receiptDigest = digest(input.receipt.payload);
  return input;
}
function transportFixture(proofInput = fixture()) {
  const { expected } = proofInput;
  const manifest = {
    selection: { salesforce: true, database: false },
    candidate: { sha: expected.source.candidateSha, sourceDigest: hash('candidate source'), lockDigest: expected.source.dependencyLockDigest },
    controllerSha: expected.controllerSha,
    previous: { sha: expected.baselineSha },
    prerequisites: {
      adapter: 'salesforce-reviewed-manifest',
      plan: { mirrorPublication: 'local-collaborator', deveeDesktopCaseSetDigest: editorDesktopCaseSetDigest,
        salesforceSourceTreeHash: expected.source.sourceTreeHash, salesforceFingerprint: hash('salesforce plan') },
    },
  };
  const { receipt, ...privateEvidence } = proofInput;
  const payload = createEditorPreflightAttestation({ manifest, proofInput: { ...privateEvidence, proof: receipt.payload },
    now: clock + 26_000 });
  const record = {
    id: 4500, ref: manifest.candidate.sha, sha: manifest.candidate.sha, created_at: at(27),
    creator: { ...owner, type: 'User' }, repository_url: 'https://api.github.com/repos/' + targets().repository,
    environment: EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT, original_environment: EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT,
    task: EDITOR_PREFLIGHT_ATTESTATION_TASK, production_environment: false, transient_environment: false, payload,
  };
  Object.assign(manifest.prerequisites.plan, { editorPreflightReceiptId: record.id, editorPreflightReceiptDigest: digest(payload) });
  const reads = [];
  const github = { read: async path => { reads.push(path); return record; } };
  return { manifest, proofInput, record, github, reads, now: clock + 30_000 };
}

function projectionBytes() {
  const sourceFiles = {}, nativeFiles = {}, modes = { exact: 0, omitted: 0, indented: 0 };
  const bodies = EDITOR_PREFLIGHT_COMPONENT_FILES.filter(path => /\.(?:cls|trigger|js|html|css|js-meta\.xml)$/u.test(path));
  const compactMetadata = EDITOR_PREFLIGHT_COMPONENT_FILES.filter(path => /^(?:classes\/.*\.cls-meta\.xml|triggers\/.*\.trigger-meta\.xml)$/u.test(path));
  assert.ok(bodies.length >= 20); assert.ok(compactMetadata.length >= 7);
  for (const path of EDITOR_PREFLIGHT_COMPONENT_FILES) {
    let source;
    if (compactMetadata.includes(path)) {
      const kind = path.startsWith('classes/') ? 'ApexClass' : 'ApexTrigger';
      source = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<${kind} xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>63.0</apiVersion><status>Active</status></${kind}>\n`);
    } else source = Buffer.from(`exact ${path}\n`);
    sourceFiles[path] = source;
  }
  for (const path of EDITOR_PREFLIGHT_COMPONENT_FILES) {
    const source = sourceFiles[path];
    if (bodies.includes(path) && modes.omitted < 20) {
      nativeFiles[path] = { sha256: digest(source.subarray(0, -1)), size: source.length - 1 }; modes.omitted++;
    } else if (compactMetadata.includes(path) && modes.indented < 7) {
      const kind = path.startsWith('classes/') ? 'ApexClass' : 'ApexTrigger';
      const native = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<${kind} xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>63.0</apiVersion>\n    <status>Active</status>\n</${kind}>\n`);
      nativeFiles[path] = { sha256: digest(native), size: native.length }; modes.indented++;
    } else { nativeFiles[path] = { sha256: digest(source), size: source.length }; modes.exact++; }
  }
  assert.deepEqual(modes, { exact: 9, omitted: 20, indented: 7 });
  return { sourceFiles, nativeFiles };
}

function projectionProof() {
  const input = fixture();
  const projection = createEditorNativeExportProjection(projectionBytes());
  input.expected.source.componentFiles = structuredClone(projection.sourceFiles);
  input.receipt.payload.source.componentFiles = structuredClone(projection.sourceFiles);
  input.nativeEvidence.inventory.componentFiles = structuredClone(projection.sourceFiles);
  input.nativeEvidence.inventory.nativeExportProjection = projection;
  input.nativeEvidence.inventory.observedNativeInventoryHash = hash('raw native export inventory');
  input.receipt.payload.schemaVersion = 2;
  for (const observation of input.receipt.payload.cases) {
    const artifact = input.caseEvidence[observation.evidenceDigest];
    delete input.caseEvidence[observation.evidenceDigest];
    observation.source.componentFiles = structuredClone(projection.sourceFiles);
    artifact.sourceDigest = digest(observation.source);
    observation.evidenceDigest = digest(artifact);
    input.caseEvidence[observation.evidenceDigest] = artifact;
  }
  input.receipt.payload.native.inventoryEvidenceDigest = digest(input.nativeEvidence.inventory);
  input.receipt.payload.native.nativeExportProjectionDigest = digest(projection);
  input.receipt.payload.native.nativeComponentFilesDigest = digest(projection.nativeFiles);
  input.receipt.payload.native.observedNativeInventoryHash = input.nativeEvidence.inventory.observedNativeInventoryHash;
  return seal(input);
}

test('native export provenance permits only the current 20 LF and seven Apex XML representations', () => {
  const fixture = projectionBytes();
  const projection = createEditorNativeExportProjection(fixture);
  assert.equal(Object.values(projection.modes).filter(mode => mode === 'terminal-lf-omitted').length, 20);
  assert.equal(Object.values(projection.modes).filter(mode => mode === 'apex-metadata-provider-indent').length, 7);
  assert.equal(Object.values(projection.modes).filter(mode => mode === 'exact').length, 9);
  const mutated = structuredClone(fixture.nativeFiles);
  const path = EDITOR_PREFLIGHT_COMPONENT_FILES[0];
  mutated[path] = { sha256: hash('one byte differs'), size: 1 };
  assert.throws(() => createEditorNativeExportProjection({ sourceFiles: fixture.sourceFiles, nativeFiles: mutated }),
    /EDITOR_PREFLIGHT_NATIVE_EXPORT_PROJECTION_INVALID/);
});

test('publication recomputes the full observed native hash from the reviewed projection and unchanged inventory', () => {
  const projection = createEditorNativeExportProjection(projectionBytes());
  const reviewed = { projectedNativeInventory: true, projectionPaths: EDITOR_PREFLIGHT_COMPONENT_FILES,
    inventoryHash: hash('reviewed projected inventory'), files: {
      'classes/Another.cls': { sha256: hash('unchanged dependency'), size: 20 },
    } };
  const complete = Object.fromEntries(Object.entries({ ...reviewed.files, ...projection.nativeFiles }).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0));
  const observedNativeInventoryHash = salesforcePromotionHash(complete);
  const input = { reviewed, projection, inventoryHash: reviewed.inventoryHash, observedNativeInventoryHash };
  verifyEditorReviewedNativeProjection(input);
  assert.throws(() => verifyEditorReviewedNativeProjection({ ...input, inventoryHash: hash('different review') }),
    /EDITOR_PREFLIGHT_NATIVE_EXPORT_PROJECTION_INVALID/);
  const changed = { ...reviewed, files: { 'classes/Another.cls': { sha256: hash('changed dependency'), size: 18 } } };
  assert.throws(() => verifyEditorReviewedNativeProjection({ ...input, reviewed: changed }),
    /EDITOR_PREFLIGHT_NATIVE_EXPORT_PROJECTION_INVALID/);
});

test('v2 attestation pins raw native component exports and rechecks them at postimage', async () => {
  const input = transportFixture(projectionProof());
  const proof = await readEditorPreflightAttestation({ ...input, approvalAt: at(28) });
  assert.equal(proof.schemaVersion, 2);
  assert.equal(proof.nativeComponentFilesDigest, input.proofInput.receipt.payload.native.nativeComponentFilesDigest);
  const reviewedInventoryHash = hash('reviewed inventory');
  const reviewed = { fingerprint: proof.salesforceFingerprint, binding: { sourceTreeHash: proof.sourceTreeHash },
    nativeInventories: { devee: { final: { inventoryHash: reviewedInventoryHash } } } };
  const deployment = { status: 'Succeeded', orgId: devee.orgId, fingerprint: proof.salesforceFingerprint,
    jobId: '0Af000000000000003', validationJobId: '0Af000000000000004' };
  const inventory = { orgId: devee.orgId, identity: { username: devee.username, isSandbox: true },
    verificationMethod: 'metadata-api-reviewed-native-byte-inventory', inventoryHash: reviewedInventoryHash,
    observedNativeInventoryHash: proof.observedNativeInventoryHash,
    observedInventory: structuredClone(input.proofInput.nativeEvidence.inventory.nativeExportProjection.nativeFiles),
    evidenceSha256: hash('v2 native postimage'), verifiedAt: at(30) };
  const args = { ...input, proof, reviewed, deployment, readInstalledInventory: async () => inventory };
  await verifyEditorPreflightPostimage(args);
  inventory.observedNativeInventoryHash = hash('changed native envelope');
  await assert.rejects(verifyEditorPreflightPostimage(args), /DEVEE_POSTIMAGE_CHANGED/);
  inventory.observedNativeInventoryHash = proof.observedNativeInventoryHash;
  inventory.observedInventory[EDITOR_PREFLIGHT_COMPONENT_FILES[0]].sha256 = hash('changed export');
  await assert.rejects(verifyEditorPreflightPostimage(args), /DEVEE_POSTIMAGE_CHANGED/);
});
test('staging accepts only the owner-created compact preflight and promotion checks its original chronology', async () => {
  const input = transportFixture();
  const proof = await readEditorPreflightAttestation(input);
  assert.equal(proof.proofId, input.record.id);
  assert.deepEqual(input.reads, ['/repos/' + targets().repository + '/deployments/4500']);
  await assert.rejects(readEditorPreflightAttestation({ ...input, approvalAt: at(26) }), /QUALIFICATION_NOT_BEFORE_APPROVAL/);
  await assert.rejects(readEditorPreflightAttestation({ ...input, now: clock + 3_600_000 }), /ATTESTATION_INVALID/);
  input.record.creator.type = 'Bot';
  await assert.rejects(readEditorPreflightAttestation(input), /ATTESTATION_INVALID/);
  delete input.manifest.prerequisites.plan.editorPreflightReceiptId;
  delete input.manifest.prerequisites.plan.editorPreflightReceiptDigest;
  await assert.rejects(readEditorPreflightAttestation(input), /LOCATOR_INVALID/);
  input.manifest.selection.salesforce = false;
  assert.equal(await readEditorPreflightAttestation(input), null);
});
test('the preapproval receipt is checked against a fresh DEVEE promotion postimage before mirror publication', async () => {
  const input = transportFixture();
  const proof = await readEditorPreflightAttestation({ ...input, approvalAt: at(28) });
  const reviewedInventoryHash = hash('reviewed inventory');
  const reviewed = { fingerprint: proof.salesforceFingerprint, binding: { sourceTreeHash: proof.sourceTreeHash },
    nativeInventories: { devee: { final: { inventoryHash: reviewedInventoryHash } } } };
  const deployment = { status: 'Succeeded', orgId: devee.orgId, fingerprint: proof.salesforceFingerprint,
    jobId: '0Af000000000000003', validationJobId: '0Af000000000000004' };
  const inventory = { orgId: devee.orgId, identity: { username: devee.username, isSandbox: true },
    verificationMethod: 'metadata-api-reviewed-native-byte-inventory', inventoryHash: reviewedInventoryHash,
    observedNativeInventoryHash: proof.installedInventoryHash, evidenceSha256: hash('real fresh inventory receipt'), verifiedAt: at(30) };
  const args = { ...input, proof, reviewed, deployment, readInstalledInventory: async () => inventory };
  assert.equal((await verifyEditorPreflightPostimage(args)).finalInventoryReceiptDigest, inventory.evidenceSha256);

  const successor = { ...input.manifest, controllerSha: '5'.repeat(40), prerequisites: {
    ...input.manifest.prerequisites, plan: { ...input.manifest.prerequisites.plan, editorsProductionValidationAdoptionReceiptId: 4600 },
  } };
  const adopted = { ...proof, admittedControllerSha: successor.controllerSha, adoptionReceiptId: 4600 };
  const adoptedArgs = { ...args, manifest: successor, proof: adopted };
  assert.equal((await verifyEditorPreflightPostimage(adoptedArgs)).proofDigest, proof.proofDigest);
  await assert.rejects(verifyEditorPreflightPostimage({
    ...adoptedArgs, proof: { ...adopted, adoptionReceiptId: 4601 },
  }), /PROMOTION_BINDING_INVALID/);
  await assert.rejects(verifyEditorPreflightPostimage({
    ...adoptedArgs, proof: { ...adopted, admittedControllerSha: proof.controllerSha },
  }), /PROMOTION_BINDING_INVALID/);

  inventory.observedNativeInventoryHash = hash('provider drift');
  await assert.rejects(verifyEditorPreflightPostimage(args), /DEVEE_POSTIMAGE_CHANGED/);
  deployment.jobId = proof.qualificationDeploymentJobId;
  await assert.rejects(verifyEditorPreflightPostimage(args), /PROMOTION_BINDING_INVALID/);
});
function updateCaseArtifact(input, index, change) {
  const observation = input.receipt.payload.cases[index], old = observation.evidenceDigest;
  const artifact = input.caseEvidence[old];
  change(artifact, observation);
  delete input.caseEvidence[old];
  observation.evidenceDigest = digest(artifact);
  input.caseEvidence[observation.evidenceDigest] = artifact;
}
test('rejects digest-bound case artifacts that lack the actual passing observations', () => {
  const regressions = [
    observation => { observation.reverse.order = 'buy-sell'; },
    observation => { observation.sellSourceAbsent = false; },
    observation => { observation.supplier.saveSubmitted = true; },
    observation => { observation.renderedRate = 7.85; },
    observation => { observation.stalePriceAbsent = false; },
    observation => { observation.restricted.writeControlsRendered = true; },
  ];
  for (const [index, mutate] of regressions.entries()) {
    const input = fixture();
    updateCaseArtifact(input, index, artifact => mutate(artifact.observations));
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_CASE_OBSERVATION_INVALID/,
      editorDesktopCases[index]);
  }
  const digestOnly = fixture();
  updateCaseArtifact(digestOnly, 0, artifact => { artifact.observations = { nativeEventDigest: hash('uninterpreted evidence') }; });
  assert.throws(() => verifySalesforceEditorPreflightProof(seal(digestOnly)), /EDITOR_PREFLIGHT_CASE_OBSERVATION_INVALID/);
});
function historicalFixture() {
  const input = fixture(), observation = input.receipt.payload.cases[0];
  observation.source.candidateSha = sha('d');
  observation.source.sourceTreeHash = hash('prior tree with unrelated non-dependency files changed');
  observation.sourceAttestationId = 900;
  observation.startedAt = at(-200);
  observation.completedAt = at(-190);
  observation.runId = 43900000001;
  updateCaseArtifact(input, 0, artifact => {
    artifact.sourceDigest = digest(observation.source);
    artifact.startedAt = observation.startedAt;
    artifact.completedAt = observation.completedAt;
    artifact.runId = observation.runId;
  });
  input.historicalAttestations.push({ id: 900, creator: owner, environment: EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT,
    sha: observation.source.candidateSha, created_at: at(-50), payload: {
      schemaVersion: 1, kind: EDITOR_PREFLIGHT_SOURCE_KIND, repository: targets().repository,
      source: structuredClone(observation.source), runId: observation.runId, validFrom: at(-300), validUntil: at(-100),
      validationJobId: '0Af000000000000003', deploymentJobId: '0Af000000000000004',
      nativeInventoryHash: hash('prior native inventory'), validationEvidenceDigest: hash('pending'),
      deploymentEvidenceDigest: hash('pending'), inventoryEvidenceDigest: hash('pending'),
      observationEvidenceDigest: observation.evidenceDigest,
    } });
  const original = { validation: nativeReport(true), deployment: nativeReport(false), inventory: {
    ...structuredClone(input.nativeEvidence.inventory), sourceTreeHash: observation.source.sourceTreeHash,
    observedAt: at(-220), inventoryHash: hash('prior native inventory'),
  } };
  original.validation.result.id = '0Af000000000000003';
  original.validation.result.createdDate = at(-280); original.validation.result.completedDate = at(-270);
  original.deployment.result.id = '0Af000000000000004';
  original.deployment.result.createdDate = at(-260); original.deployment.result.completedDate = at(-250);
  input.historicalNativeEvidence[900] = original;
  const attestation = input.historicalAttestations[0].payload;
  attestation.validationEvidenceDigest = digest(original.validation);
  attestation.deploymentEvidenceDigest = digest(original.deployment);
  attestation.inventoryEvidenceDigest = digest(original.inventory);
  return seal(input);
}

test('a complete native preflight binds all thirteen components before the final approval', () => {
  const input = fixture();
  const result = verifySalesforceEditorPreflightProof({ ...input, approvalAt: at(28) });
  assert.equal(EDITOR_PREFLIGHT_COMPONENTS.length, 13);
  assert.equal(EDITOR_PREFLIGHT_COMPONENT_FILES.length, 36);
  assert.equal(result.receiptId, input.receipt.id);
  assert.equal(result.sourceTreeHash, input.expected.source.sourceTreeHash);
  assert.equal(result.qualificationDeploymentJobId, deploymentId);
  assert.equal(result.cleanupEvidenceDigest, digest(input.nativeEvidence.cleanup));
  assert.equal(result.completedAt, at(25));
});

test('missing, legacy, unknown-field and digest-substituted receipts fail closed', () => {
  assert.throws(() => verifySalesforceEditorPreflightProof(), /EDITOR_PREFLIGHT_SCHEMA_INVALID/);
  for (const mutate of [
    i => { i.receipt.payload = { passed: true, fixturesRestored: true }; },
    i => { i.receipt.payload.passed = true; },
    i => { i.receipt.payload.native.validationEvidenceDigest = hash('unrelated report'); },
    i => { i.receipt.id++; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_/);
  }
  const unsealed = fixture(); unsealed.receipt.payload.baselineSha = sha('e');
  assert.throws(() => verifySalesforceEditorPreflightProof(unsealed), /PINNED_RECEIPT_MISMATCH/);
});

test('exact current candidate, controller, baseline, fixture, dependency and actor bindings are mandatory', () => {
  for (const mutate of [
    i => { i.expected.source.candidateSha = sha('e'); },
    i => { i.expected.controllerSha = sha('e'); },
    i => { i.expected.baselineSha = sha('e'); },
    i => { i.expected.source.dependencyLockDigest = hash('new lock'); },
    i => { i.expected.source.fixtureSourceDigest = hash('different fixture harness'); },
    i => { i.expected.source.assumptionsDigest = hash('permission changed'); },
    i => { i.expected.source.dependencyFiles['classes/VariableChargeInvoiceReadinessService.cls'].sha256 = hash('dependency changed'); },
    i => { i.expected.actors[0].userId = '005000000000002AAA'; },
    i => { delete i.receipt.payload.source.componentFiles[EDITOR_PREFLIGHT_COMPONENT_FILES[0]]; },
    i => { i.receipt.payload.source.componentFiles['classes/Unexpected.cls'] = { sha256: hash('extra'), size: 1 }; },
    i => { i.receipt.payload.source.dependencyFiles['../outside.cls'] = { sha256: hash('outside'), size: 1 }; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_/);
  }
});

test('native owner, target and expiry cannot be replaced or backdated into approval', () => {
  for (const mutate of [
    i => { i.receipt.creator = { id: 41898282, login: 'github-actions[bot]' }; },
    i => { i.receipt.environment = 'fcos-production-release'; },
    i => { i.receipt.payload.org.orgId = fcosSalesforceEnvironment('qat').orgId; },
    i => { i.receipt.payload.expiresAt = at(29); },
    i => { i.receipt.payload.expiresAt = at(25 + EDITOR_PREFLIGHT_MAX_AGE_MS / 1000 + 1); },
    i => { i.receipt.created_at = at(31); },
    i => { i.receipt.payload.startedAt = at(-90_000); },
    i => { i.approvalAt = at(25); },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_/);
  }
});

test('actual native validation and deployment reports and source inventory are required', () => {
  for (const mutate of [
    i => { i.nativeEvidence.validation.result.numberTestsCompleted = 599; },
    i => { i.nativeEvidence.validation.result.numberTestErrors = 1; },
    i => { i.nativeEvidence.deployment.result.checkOnly = true; },
    i => { i.nativeEvidence.deployment.result.rollbackOnError = false; },
    i => { i.nativeEvidence.deployment.result.details.componentSuccesses.splice(0, 1); },
    i => { i.nativeEvidence.validation.result.details.runTestResult.codeCoverageWarnings.push({ message: 'insufficient' }); },
    i => { i.nativeEvidence.deployment.result.createdDate = at(1); },
    i => { i.nativeEvidence.inventory.componentFiles[EDITOR_PREFLIGHT_COMPONENT_FILES[0]].sha256 = hash('other installed source'); },
    i => { i.nativeEvidence.inventory.observedAt = at(3); },
  ]) {
    const input = fixture(); mutate(input);
    const native = input.receipt.payload.native;
    native.validationEvidenceDigest = digest(input.nativeEvidence.validation);
    native.deploymentEvidenceDigest = digest(input.nativeEvidence.deployment);
    native.inventoryEvidenceDigest = digest(input.nativeEvidence.inventory);
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_/);
  }
});

test('all six original case artifacts, roles and zero prohibited writes are checked', () => {
  for (const mutate of [
    i => { i.receipt.payload.cases.pop(); },
    i => { i.receipt.payload.cases[1] = structuredClone(i.receipt.payload.cases[0]); },
    i => { delete i.caseEvidence[i.receipt.payload.cases[0].evidenceDigest]; },
    i => { i.receipt.payload.cases[0].completedAt = at(0); },
    i => { i.receipt.payload.cases[0].startedAt = at(4); },
    i => { i.receipt.payload.effects.businessWrites = 1; },
    i => { i.receipt.payload.effects.financialRequests = 1; },
    i => { i.receipt.payload.effects.customerSends = 1; },
    i => { i.receipt.payload.effects.syntheticFixtureWrites = 0; },
    i => updateCaseArtifact(i, 5, artifact => { artifact.actorRoles = ['normal']; }),
    i => updateCaseArtifact(i, 0, artifact => { artifact.effects.customerSends = 1; }),
    i => updateCaseArtifact(i, 0, artifact => { artifact.sourceDigest = hash('rewritten source'); }),
    i => { i.receipt.payload.actors[1].permissionEvidenceDigest = i.receipt.payload.actors[0].permissionEvidenceDigest; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_/);
  }
});

test('cleanup requires exact itemized native scope and restoration after the observations', () => {
  for (const mutate of [
    i => { i.nativeEvidence.cleanup.records.pop(); },
    i => { i.nativeEvidence.cleanup.managedSides[0].state = 'present'; },
    i => { i.nativeEvidence.cleanup.assignments[0].state = 'present'; },
    i => { i.nativeEvidence.cleanup.listeners[0].state = 'running'; },
    i => { i.nativeEvidence.cleanup.metadata[0].observedAt = at(5); },
    i => { i.nativeEvidence.cleanup.restoration.observedAt = at(5); },
    i => { i.nativeEvidence.cleanup.restoration.inventoryHash = hash('wrong restored tree'); },
    i => { i.nativeEvidence.cleanup.completedAt = at(8); },
  ]) {
    const input = fixture(); mutate(input);
    input.receipt.payload.cleanup.evidenceDigest = digest(input.nativeEvidence.cleanup);
    input.receipt.payload.cleanup.completedAt = input.nativeEvidence.cleanup.completedAt;
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /EDITOR_PREFLIGHT_/);
  }
});

test('a delayed historical attestation verifies original native evidence without rewriting observation times', () => {
  const input = historicalFixture();
  assert.doesNotThrow(() => verifySalesforceEditorPreflightProof(input));
  assert.equal(input.receipt.payload.cases[0].startedAt, at(-200));
  assert.equal(input.receipt.payload.cases[0].runId, 43900000001);
  for (const mutate of [
    i => { i.historicalAttestations = []; },
    i => { i.historicalAttestations.push(structuredClone(i.historicalAttestations[0])); },
    i => { i.historicalAttestations[0].created_at = at(27); },
    i => { i.historicalAttestations[0].creator = { id: 41898282, login: 'github-actions[bot]' }; },
    i => { i.historicalAttestations[0].payload.validUntil = at(-195); },
    i => { i.historicalAttestations[0].payload.runId++; },
    i => { i.historicalAttestations[0].payload.source.assumptionsDigest = hash('different original assumptions'); },
    i => { i.receipt.payload.cases[0].sourceAttestationId = null; },
    i => { i.historicalNativeEvidence = {}; },
    i => { i.historicalNativeEvidence[900].inventory.observedAt = at(-195); },
  ]) {
    const value = historicalFixture(); mutate(value);
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(value)), /EDITOR_PREFLIGHT_/);
  }
});

test('historical source joins reject relevant component, dependency, lock and fixture drift', () => {
  for (const mutate of [
    origin => { origin.componentFiles[EDITOR_PREFLIGHT_COMPONENT_FILES[0]].sha256 = hash('changed component'); },
    origin => { origin.dependencyFiles['classes/TestDataFactory.cls'].sha256 = hash('changed dependency'); },
    origin => { origin.dependencyLockDigest = hash('old dependency lock'); },
    origin => { origin.fixtureSourceDigest = hash('old harness'); },
  ]) {
    const input = historicalFixture(), observation = input.receipt.payload.cases[0];
    mutate(observation.source);
    input.historicalAttestations[0].payload.source = structuredClone(observation.source);
    updateCaseArtifact(input, 0, artifact => { artifact.sourceDigest = digest(observation.source); });
    input.historicalAttestations[0].payload.observationEvidenceDigest = observation.evidenceDigest;
    assert.throws(() => verifySalesforceEditorPreflightProof(seal(input)), /HISTORICAL_SOURCE_NOT_EQUIVALENT/);
  }
});

test('deterministic historical observations have no blanket age limit while original chronology remains verified', () => {
  const input = historicalFixture(), observation = input.receipt.payload.cases[0];
  const offset = 30 * 86_400_000;
  const earlier = value => new Date(Date.parse(value) - offset).toISOString();
  observation.startedAt = earlier(observation.startedAt);
  observation.completedAt = earlier(observation.completedAt);
  updateCaseArtifact(input, 0, artifact => {
    artifact.startedAt = observation.startedAt; artifact.completedAt = observation.completedAt;
  });
  const attestation = input.historicalAttestations[0].payload, original = input.historicalNativeEvidence[900];
  attestation.validFrom = earlier(attestation.validFrom); attestation.validUntil = earlier(attestation.validUntil);
  original.validation.result.createdDate = earlier(original.validation.result.createdDate);
  original.validation.result.completedDate = earlier(original.validation.result.completedDate);
  original.deployment.result.createdDate = earlier(original.deployment.result.createdDate);
  original.deployment.result.completedDate = earlier(original.deployment.result.completedDate);
  original.inventory.observedAt = earlier(original.inventory.observedAt);
  attestation.validationEvidenceDigest = digest(original.validation);
  attestation.deploymentEvidenceDigest = digest(original.deployment);
  attestation.inventoryEvidenceDigest = digest(original.inventory);
  attestation.observationEvidenceDigest = observation.evidenceDigest;
  assert.doesNotThrow(() => verifySalesforceEditorPreflightProof(seal(input)));
});
