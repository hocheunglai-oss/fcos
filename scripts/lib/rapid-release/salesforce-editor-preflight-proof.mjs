import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { canonical, digest, isDigest, isSha, targets } from './contract.mjs';
import { editorDesktopCases, editorDesktopCaseSetDigest } from './salesforce-devee-desktop-checkpoint.mjs';

export const EDITOR_PREFLIGHT_PROOF_KIND = 'fcos_salesforce_editor_preflight_qualification_v1';
export const EDITOR_PREFLIGHT_SOURCE_KIND = 'fcos_salesforce_editor_observation_source_v1';
export const EDITOR_PREFLIGHT_ENVIRONMENT = 'fcos-editor-native-preflight-v1';
export const EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT = 'fcos-editor-native-source-v1';
export const EDITOR_PREFLIGHT_MAX_AGE_MS = 86_400_000;

const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const devee = fcosSalesforceEnvironment('devee');
const apex = ['FcosCompanyFxRateService', 'FcosCompanyFxRateServiceTest', 'FcosDeveeEditorFixtureRehearsalTest',
  'FcosTradeCurrencyController', 'FcosTradeCurrencyGuard', 'FcosTradeCurrencyParentGuard', 'FcosTradeCurrencyService'];
const bundles = ['fcbEditOfferLineItemModal', 'fcbEditSupplierBidModal', 'fcbPromotedOfferLineItemExtraCosts',
  'fcbSupplierBidExtraCosts', 'fcosTradeCurrencyEditor'];
export const EDITOR_PREFLIGHT_COMPONENTS = Object.freeze([
  ...apex.map(name => `ApexClass:${name}`), 'ApexTrigger:FcosTradeCurrencySideTrigger',
  ...bundles.map(name => `LightningComponentBundle:${name}`),
].sort());
export const EDITOR_PREFLIGHT_COMPONENT_FILES = Object.freeze([
  ...apex.flatMap(name => [`classes/${name}.cls`, `classes/${name}.cls-meta.xml`]),
  'triggers/FcosTradeCurrencySideTrigger.trigger', 'triggers/FcosTradeCurrencySideTrigger.trigger-meta.xml',
  ...bundles.flatMap(name => ['css', 'html', 'js', 'js-meta.xml'].map(extension => `lwc/${name}/${name}.${extension}`)),
].sort());

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
const jobId = value => typeof value === 'string' && /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(value);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const same = (left, right) => canonical(left) === canonical(right);
function check(condition, suffix) {
  if (!condition) throw Object.assign(new Error(`EDITOR_PREFLIGHT_${suffix}`), { code: `EDITOR_PREFLIGHT_${suffix}` });
}
function keys(value, names, suffix = 'SCHEMA_INVALID') {
  check(plain(value) && same(Object.keys(value).sort(), [...names].sort()), suffix);
}
function inventory(value, exactPaths) {
  check(plain(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 10_000, 'FILE_INVENTORY_INVALID');
  for (const [path, entry] of Object.entries(value)) {
    check(/^[A-Za-z0-9_][A-Za-z0-9_./ -]*$/u.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..'),
      'FILE_INVENTORY_INVALID');
    keys(entry, ['sha256', 'size'], 'FILE_INVENTORY_INVALID');
    check(isDigest(entry.sha256) && Number.isSafeInteger(entry.size) && entry.size >= 0, 'FILE_INVENTORY_INVALID');
  }
  if (exactPaths) check(same(Object.keys(value).sort(), exactPaths), 'COMPONENT_SCOPE_INVALID');
}
function source(value) {
  keys(value, ['candidateSha', 'sourceTreeHash', 'dependencyLockDigest', 'componentFiles', 'dependencyFiles',
    'fixtureSourceDigest', 'assumptionsDigest']);
  check(isSha(value.candidateSha) && [value.sourceTreeHash, value.dependencyLockDigest, value.fixtureSourceDigest,
    value.assumptionsDigest].every(isDigest), 'SOURCE_INVALID');
  inventory(value.componentFiles, EDITOR_PREFLIGHT_COMPONENT_FILES);
  inventory(value.dependencyFiles);
  check(Object.keys(value.dependencyFiles).every(path => !Object.hasOwn(value.componentFiles, path)), 'DEPENDENCY_SCOPE_INVALID');
}
function sameClosure(left, right) {
  return ['dependencyLockDigest', 'componentFiles', 'dependencyFiles', 'fixtureSourceDigest', 'assumptionsDigest']
    .every(key => same(left[key], right[key]));
}
function nativeOwner(record, environment, sha) {
  check(plain(record) && positive(record.id) && record.creator?.id === publication.requiredAccountId
    && record.creator.login === publication.requiredAccount && record.environment === environment
    && record.sha === sha && stamp(record.created_at) && plain(record.payload), 'NATIVE_RECEIPT_INVALID');
}
function effects(value, positiveSynthetic = false) {
  keys(value, ['businessWrites', 'financialRequests', 'customerSends', 'syntheticFixtureWrites']);
  check(value.businessWrites === 0 && value.financialRequests === 0 && value.customerSends === 0
    && Number.isSafeInteger(value.syntheticFixtureWrites) && value.syntheticFixtureWrites >= (positiveSynthetic ? 1 : 0),
  'PROHIBITED_EFFECT_OR_MISSING_SYNTHETIC_WRITES');
}
function nativeReport(response, id, checkOnly, minimumTests) {
  const report = response?.result;
  check(response?.status === 0 && plain(report) && report.id === id && jobId(id) && report.status === 'Succeeded'
    && report.success === true && report.done === true && report.checkOnly === checkOnly && report.rollbackOnError === true
    && report.numberComponentErrors === 0 && report.numberComponentsDeployed === EDITOR_PREFLIGHT_COMPONENTS.length
    && report.numberTestErrors === 0 && Number.isSafeInteger(report.numberTestsCompleted)
    && report.numberTestsCompleted >= minimumTests && stamp(report.createdDate) && stamp(report.completedDate)
    && report.createdDate <= report.completedDate, 'NATIVE_JOB_INVALID');
  const successes = report.details?.componentSuccesses;
  check(Array.isArray(successes) && same(successes.filter(row => row.componentType).map(row => {
    check(row.success === true && row.deleted === false, 'NATIVE_JOB_INVALID');
    return `${row.componentType}:${row.fullName}`;
  }).sort(), EDITOR_PREFLIGHT_COMPONENTS), 'NATIVE_COMPONENT_SCOPE_INVALID');
  check(!(report.details?.componentFailures?.length) && !(report.details?.runTestResult?.codeCoverageWarnings?.length),
    'NATIVE_JOB_INVALID');
  return report;
}
function actors(value) {
  check(Array.isArray(value) && value.length >= 2 && value.length <= 3, 'ACTORS_INVALID');
  const roles = value.map(actor => {
    keys(actor, ['role', 'userId', 'profile', 'permissionEvidenceDigest']);
    check(['normal', 'restricted', 'fixture-administrator'].includes(actor.role)
      && /^005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(actor.userId || '')
      && typeof actor.profile === 'string' && actor.profile.trim().length > 0 && isDigest(actor.permissionEvidenceDigest), 'ACTORS_INVALID');
    return actor.role;
  });
  check(new Set(roles).size === roles.length && roles.includes('normal') && roles.includes('restricted'), 'ACTORS_INVALID');
  const normal = value.find(actor => actor.role === 'normal'), restricted = value.find(actor => actor.role === 'restricted');
  check(normal.permissionEvidenceDigest !== restricted.permissionEvidenceDigest, 'ACTORS_INVALID');
}
function verifyCleanup(cleanup, expected, completedAt, lastObservation) {
  keys(cleanup, ['orgId', 'completedAt', 'restoration', 'records', 'managedSides', 'metadata', 'assignments', 'listeners']);
  keys(cleanup.restoration, ['sourceTreeHash', 'inventoryHash', 'observedAt', 'evidenceDigest']);
  check(cleanup.orgId === devee.orgId && stamp(cleanup.completedAt) && cleanup.completedAt <= completedAt
    && stamp(cleanup.restoration.observedAt) && cleanup.restoration.observedAt >= lastObservation
    && cleanup.restoration.observedAt <= cleanup.completedAt
    && same({ sourceTreeHash: cleanup.restoration.sourceTreeHash, inventoryHash: cleanup.restoration.inventoryHash }, expected.restoration)
    && isDigest(cleanup.restoration.evidenceDigest), 'RESTORATION_INVALID');
  for (const category of ['records', 'managedSides', 'metadata', 'assignments', 'listeners']) {
    const wanted = expected.cleanupScope[category], rows = cleanup[category];
    check(Array.isArray(wanted) && wanted.length > 0 && new Set(wanted).size === wanted.length
      && wanted.every(id => typeof id === 'string' && id.length > 0)
      && Array.isArray(rows) && same(rows.map(row => row.id).sort(), [...wanted].sort()), 'CLEANUP_SCOPE_INVALID');
    for (const row of rows) {
      keys(row, ['id', 'state', 'observedAt', 'evidenceDigest']);
      check(row.state === (category === 'listeners' ? 'stopped' : 'absent') && stamp(row.observedAt)
        && row.observedAt >= lastObservation && row.observedAt <= cleanup.completedAt && isDigest(row.evidenceDigest), 'CLEANUP_NOT_VERIFIED');
    }
  }
}
function historicalSource(record, observation, expectedSource, evidence, qualificationCreatedAt) {
  nativeOwner(record, EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT, observation.source.candidateSha);
  const attestation = record.payload;
  keys(attestation, ['schemaVersion', 'kind', 'repository', 'source', 'runId', 'validFrom', 'validUntil',
    'validationJobId', 'deploymentJobId', 'nativeInventoryHash', 'validationEvidenceDigest',
    'deploymentEvidenceDigest', 'inventoryEvidenceDigest', 'observationEvidenceDigest']);
  source(attestation.source);
  check(attestation.schemaVersion === 1 && attestation.kind === EDITOR_PREFLIGHT_SOURCE_KIND
    && attestation.repository === targets().repository && same(attestation.source, observation.source)
    && positive(attestation.runId) && attestation.runId === observation.runId
    && jobId(attestation.validationJobId) && jobId(attestation.deploymentJobId)
    && attestation.validationJobId !== attestation.deploymentJobId
    && isDigest(attestation.nativeInventoryHash) && attestation.observationEvidenceDigest === observation.evidenceDigest
    && stamp(attestation.validFrom) && stamp(attestation.validUntil)
    && attestation.validFrom <= observation.startedAt && attestation.validUntil >= observation.completedAt
    && record.created_at <= qualificationCreatedAt
    && sameClosure(attestation.source, expectedSource), 'HISTORICAL_SOURCE_NOT_EQUIVALENT');
  keys(evidence, ['validation', 'deployment', 'inventory'], 'HISTORICAL_NATIVE_EVIDENCE_REQUIRED');
  check(attestation.validationEvidenceDigest === digest(evidence.validation)
    && attestation.deploymentEvidenceDigest === digest(evidence.deployment)
    && attestation.inventoryEvidenceDigest === digest(evidence.inventory), 'HISTORICAL_NATIVE_EVIDENCE_MISMATCH');
  const validated = nativeReport(evidence.validation, attestation.validationJobId, true, 1);
  const deployed = nativeReport(evidence.deployment, attestation.deploymentJobId, false, 0);
  const installed = evidence.inventory;
  keys(installed, ['orgId', 'username', 'isSandbox', 'sourceTreeHash', 'componentFiles', 'dependencyFiles', 'inventoryHash', 'observedAt']);
  inventory(installed.componentFiles, EDITOR_PREFLIGHT_COMPONENT_FILES);
  inventory(installed.dependencyFiles);
  check(installed.orgId === devee.orgId && installed.username === devee.username && installed.isSandbox === true
    && installed.sourceTreeHash === observation.source.sourceTreeHash && installed.inventoryHash === attestation.nativeInventoryHash
    && same(installed.componentFiles, observation.source.componentFiles) && same(installed.dependencyFiles, observation.source.dependencyFiles)
    && stamp(installed.observedAt) && attestation.validFrom <= validated.createdDate
    && validated.completedDate <= deployed.createdDate && deployed.completedDate <= installed.observedAt
    && installed.observedAt <= observation.startedAt && installed.observedAt <= record.created_at,
  'HISTORICAL_NATIVE_CHRONOLOGY_OR_SOURCE_INVALID');
}

/**
 * Pure verifier. The caller fetches native envelopes/reports through pinned providers and
 * computes `expected` from the clean current source and reviewed dependency/cleanup scope.
 * `nativeEvidence.inventory` is the trusted source-equivalent native byte inventory, not
 * a caller's `matchesSource` assertion. No report or old timestamp is rewritten here.
 * A delayed owner attestation is allowed only with separately supplied original native
 * reports, inventory and observation artifact. Original timestamps remain unchanged;
 * deterministic historical cases do not inherit the current receipt's expiry limit.
 */
export function verifySalesforceEditorPreflightProof({ receipt, expected, nativeEvidence, caseEvidence,
  historicalAttestations = [], historicalNativeEvidence = {}, now = Date.now(), approvalAt } = {}) {
  check(Number.isFinite(now), 'TIME_INVALID');
  keys(expected, ['receiptId', 'receiptDigest', 'controllerSha', 'baselineSha', 'source', 'packageDigest',
    'inventoryHash', 'minimumTests', 'actors', 'restoration', 'cleanupScope']);
  source(expected.source);
  actors(expected.actors);
  keys(expected.restoration, ['sourceTreeHash', 'inventoryHash']);
  keys(expected.cleanupScope, ['records', 'managedSides', 'metadata', 'assignments', 'listeners']);
  check(positive(expected.receiptId) && isDigest(expected.receiptDigest) && isSha(expected.controllerSha)
    && isSha(expected.baselineSha) && positive(expected.minimumTests) && [expected.packageDigest, expected.inventoryHash,
      expected.restoration.sourceTreeHash, expected.restoration.inventoryHash].every(isDigest), 'EXPECTED_BINDING_INVALID');
  nativeOwner(receipt, EDITOR_PREFLIGHT_ENVIRONMENT, expected.source.candidateSha);
  check(receipt.id === expected.receiptId && digest(receipt.payload) === expected.receiptDigest, 'PINNED_RECEIPT_MISMATCH');
  const proof = receipt.payload;
  keys(proof, ['schemaVersion', 'kind', 'repository', 'controllerSha', 'baselineSha', 'source', 'org',
    'startedAt', 'completedAt', 'expiresAt', 'caseSetDigest', 'native', 'actors', 'cases', 'effects', 'cleanup']);
  keys(proof.org, ['orgId', 'username', 'isSandbox']);
  source(proof.source);
  check(proof.schemaVersion === 1 && proof.kind === EDITOR_PREFLIGHT_PROOF_KIND && proof.repository === targets().repository
    && proof.controllerSha === expected.controllerSha && proof.baselineSha === expected.baselineSha
    && same(proof.source, expected.source) && proof.caseSetDigest === editorDesktopCaseSetDigest
    && same(proof.org, { orgId: devee.orgId, username: devee.username, isSandbox: true }), 'SOURCE_OR_IDENTITY_MISMATCH');
  check([proof.startedAt, proof.completedAt, proof.expiresAt].every(stamp) && proof.startedAt <= proof.completedAt
    && Date.parse(proof.completedAt) - Date.parse(proof.startedAt) <= EDITOR_PREFLIGHT_MAX_AGE_MS
    && proof.completedAt <= receipt.created_at && Date.parse(receipt.created_at) <= now
    && Date.parse(proof.expiresAt) > now && Date.parse(proof.expiresAt) - Date.parse(proof.completedAt) <= EDITOR_PREFLIGHT_MAX_AGE_MS
    && now - Date.parse(proof.completedAt) <= EDITOR_PREFLIGHT_MAX_AGE_MS, 'MISSING_OR_EXPIRED_EVIDENCE');
  if (approvalAt !== undefined) check(stamp(approvalAt) && receipt.created_at < approvalAt && Date.parse(approvalAt) <= now,
    'QUALIFICATION_NOT_BEFORE_APPROVAL');
  actors(proof.actors);
  check(same(proof.actors, expected.actors), 'ACTORS_INVALID');
  effects(proof.effects, true);
  keys(proof.native, ['validationJobId', 'deploymentJobId', 'packageDigest', 'validationEvidenceDigest',
    'deploymentEvidenceDigest', 'inventoryEvidenceDigest', 'inventoryHash']);
  keys(nativeEvidence, ['validation', 'deployment', 'inventory', 'cleanup']);
  const native = proof.native;
  check(native.packageDigest === expected.packageDigest && native.inventoryHash === expected.inventoryHash
    && native.validationEvidenceDigest === digest(nativeEvidence.validation)
    && native.deploymentEvidenceDigest === digest(nativeEvidence.deployment)
    && native.inventoryEvidenceDigest === digest(nativeEvidence.inventory), 'NATIVE_EVIDENCE_DIGEST_MISMATCH');
  const validated = nativeReport(nativeEvidence.validation, native.validationJobId, true, expected.minimumTests);
  const deployed = nativeReport(nativeEvidence.deployment, native.deploymentJobId, false, 0);
  check(native.validationJobId !== native.deploymentJobId && proof.startedAt <= validated.createdDate
    && validated.completedDate <= deployed.createdDate, 'NATIVE_JOB_ORDER_INVALID');
  const installed = nativeEvidence.inventory;
  keys(installed, ['orgId', 'username', 'isSandbox', 'sourceTreeHash', 'componentFiles', 'dependencyFiles', 'inventoryHash', 'observedAt']);
  inventory(installed.componentFiles, EDITOR_PREFLIGHT_COMPONENT_FILES);
  inventory(installed.dependencyFiles);
  check(installed.orgId === devee.orgId && installed.username === devee.username && installed.isSandbox === true
    && installed.sourceTreeHash === proof.source.sourceTreeHash && installed.inventoryHash === native.inventoryHash
    && same(installed.componentFiles, proof.source.componentFiles) && same(installed.dependencyFiles, proof.source.dependencyFiles)
    && stamp(installed.observedAt) && deployed.completedDate <= installed.observedAt && installed.observedAt <= proof.completedAt,
  'INSTALLED_SOURCE_NOT_EQUIVALENT');
  check(Array.isArray(proof.cases) && proof.cases.length === editorDesktopCases.length && plain(caseEvidence)
    && Array.isArray(historicalAttestations) && plain(historicalNativeEvidence), 'CASES_INVALID');
  let syntheticWrites = 0, lastObservation = installed.observedAt;
  for (const [index, observation] of proof.cases.entries()) {
    keys(observation, ['id', 'outcome', 'runId', 'startedAt', 'completedAt', 'evidenceDigest', 'source', 'sourceAttestationId']);
    source(observation.source);
    check(observation.id === editorDesktopCases[index] && observation.outcome === 'passed' && positive(observation.runId)
      && stamp(observation.startedAt) && stamp(observation.completedAt) && observation.startedAt <= observation.completedAt
      && observation.completedAt <= proof.completedAt && isDigest(observation.evidenceDigest), 'CASES_INVALID');
    const artifact = caseEvidence[observation.evidenceDigest];
    keys(artifact, ['caseId', 'outcome', 'runId', 'startedAt', 'completedAt', 'sourceDigest', 'actorRoles', 'effects', 'observations']);
    check(digest(artifact) === observation.evidenceDigest && artifact.caseId === observation.id && artifact.outcome === 'passed'
      && artifact.runId === observation.runId && artifact.startedAt === observation.startedAt && artifact.completedAt === observation.completedAt
      && artifact.sourceDigest === digest(observation.source) && plain(artifact.observations) && Object.keys(artifact.observations).length > 0,
    'CASE_EVIDENCE_MISMATCH');
    effects(artifact.effects);
    syntheticWrites += artifact.effects.syntheticFixtureWrites;
    check(Array.isArray(artifact.actorRoles) && artifact.actorRoles.length > 0
      && new Set(artifact.actorRoles).size === artifact.actorRoles.length
      && artifact.actorRoles.every(role => proof.actors.some(actor => actor.role === role))
      && (observation.id !== 'normal-and-restricted-access' || ['normal', 'restricted'].every(role => artifact.actorRoles.includes(role))),
    'CASE_ACTOR_COVERAGE_INVALID');
    if (observation.sourceAttestationId === null) {
      check(same(observation.source, proof.source) && installed.observedAt <= observation.startedAt, 'FRESH_CASE_SOURCE_INVALID');
    } else {
      check(positive(observation.sourceAttestationId), 'HISTORICAL_SOURCE_ATTESTATION_REQUIRED');
      const matches = historicalAttestations.filter(record => record.id === observation.sourceAttestationId);
      check(matches.length === 1, 'HISTORICAL_SOURCE_ATTESTATION_REQUIRED');
      historicalSource(matches[0], observation, proof.source,
        historicalNativeEvidence[observation.sourceAttestationId], receipt.created_at);
    }
    if (observation.completedAt > lastObservation) lastObservation = observation.completedAt;
  }
  check(syntheticWrites > 0 && syntheticWrites <= proof.effects.syntheticFixtureWrites, 'SYNTHETIC_WRITE_EVIDENCE_MISMATCH');
  keys(proof.cleanup, ['evidenceDigest', 'completedAt', 'restoredInventoryHash']);
  check(proof.cleanup.evidenceDigest === digest(nativeEvidence.cleanup)
    && proof.cleanup.completedAt === nativeEvidence.cleanup.completedAt && proof.cleanup.completedAt >= lastObservation
    && proof.cleanup.restoredInventoryHash === expected.restoration.inventoryHash, 'CLEANUP_EVIDENCE_MISMATCH');
  verifyCleanup(nativeEvidence.cleanup, expected, proof.completedAt, lastObservation);
  return { receiptId: receipt.id, receiptDigest: digest(proof), candidateSha: proof.source.candidateSha,
    controllerSha: proof.controllerSha, baselineSha: proof.baselineSha, sourceTreeHash: proof.source.sourceTreeHash,
    caseSetDigest: proof.caseSetDigest, qualificationValidationJobId: native.validationJobId,
    qualificationDeploymentJobId: native.deploymentJobId, installedInventoryHash: native.inventoryHash,
    cleanupEvidenceDigest: proof.cleanup.evidenceDigest, completedAt: proof.completedAt, expiresAt: proof.expiresAt };
}
