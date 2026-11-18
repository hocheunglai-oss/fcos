import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { editorDesktopCases, editorDesktopCaseSetDigest } from '../scripts/lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';
import { EDITOR_PREFLIGHT_COMPONENTS, EDITOR_PREFLIGHT_COMPONENT_FILES, EDITOR_PREFLIGHT_ENVIRONMENT,
  EDITOR_PREFLIGHT_MAX_AGE_MS, EDITOR_PREFLIGHT_PROOF_KIND, EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT,
  EDITOR_PREFLIGHT_SOURCE_KIND, verifySalesforceEditorPreflightProof }
  from '../scripts/lib/rapid-release/salesforce-editor-preflight-proof.mjs';

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
