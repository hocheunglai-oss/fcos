import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALESFORCE_POLICY = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const PUBLICATION = SALESFORCE_POLICY?.publication;
export const SALESFORCE_WORKFLOW_SCHEMA_VERSION = 2;
export const COMPLETE_SALESFORCE_SCOPE = 'force-app/main/default';
export const FULL_SALESFORCE_TEST_LEVEL = 'RunLocalTests';
export const SALESFORCE_RELEASE_MODE = 'schema-free-complete-owned-tree';

function validHash(value) { return /^[a-f0-9]{64}$/u.test(String(value || '')); }
function environmentPolicy(key) {
  const environment = SALESFORCE_POLICY?.environments?.find((candidate) => candidate.key === key);
  if (!environment) throw new Error(`Unknown Salesforce environment ${key}.`);
  return environment;
}

export function deveeEnvironment() {
  const environment = environmentPolicy(PUBLICATION?.sourceEnvironmentKey);
  if (environment.key !== 'devee' || environment.isSandbox !== true) throw new Error('The Salesforce development source must be the pinned DEVEE sandbox.');
  return environment;
}

export function sourceStatePath() {
  if (!PUBLICATION?.sourceStatePath) throw new Error('The DEVEE source-state path is not configured.');
  const absolute = path.resolve(REPO_ROOT, PUBLICATION.sourceStatePath);
  const relative = path.relative(path.resolve(REPO_ROOT, '.fcos-cli'), absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The Salesforce workflow-state path must remain under .fcos-cli.');
  return absolute;
}

function environmentRecord(environment) {
  return {
    key: environment.key, alias: environment.alias, orgId: environment.orgId,
    isSandbox: environment.isSandbox, username: environment.username || null,
    validation: null, deployment: null,
  };
}

export function createSalesforceWorkflowState({
  sourceTreeHash, sourceScope = COMPLETE_SALESFORCE_SCOPE,
  releaseMode = SALESFORCE_RELEASE_MODE, now = new Date(),
}) {
  if (!validHash(sourceTreeHash)) throw new Error('The Salesforce workflow requires an exact source-tree SHA-256 hash.');
  if (sourceScope !== COMPLETE_SALESFORCE_SCOPE || releaseMode !== SALESFORCE_RELEASE_MODE) {
    throw new Error('The Salesforce workflow must target the complete authoritative source without a schema bootstrap.');
  }
  const timestamp = now.toISOString();
  return {
    schemaVersion: SALESFORCE_WORKFLOW_SCHEMA_VERSION, releaseMode, sourceTreeHash, sourceScope,
    createdAt: timestamp, updatedAt: timestamp,
    environments: Object.fromEntries((SALESFORCE_POLICY?.environments || []).map((environment) => [environment.key, environmentRecord(environment)])),
    publication: null, finalMirror: null,
  };
}

export function workflowMatchesFrozenSource(record, { sourceTreeHash, releaseMode = SALESFORCE_RELEASE_MODE }) {
  return record?.schemaVersion === SALESFORCE_WORKFLOW_SCHEMA_VERSION
    && record?.releaseMode === releaseMode
    && record?.sourceTreeHash === sourceTreeHash
    && record?.sourceScope === COMPLETE_SALESFORCE_SCOPE;
}

export function validateSalesforceWorkflowState(record) {
  if (record?.schemaVersion !== SALESFORCE_WORKFLOW_SCHEMA_VERSION
    || record?.releaseMode !== SALESFORCE_RELEASE_MODE
    || !validHash(record?.sourceTreeHash)
    || record?.sourceScope !== COMPLETE_SALESFORCE_SCOPE
    || !record?.environments || typeof record.environments !== 'object') {
    throw new Error('The Salesforce workflow state is malformed or does not represent the schema-free complete owned source tree.');
  }
  for (const environment of SALESFORCE_POLICY?.environments || []) {
    const saved = record.environments[environment.key];
    if (saved?.key !== environment.key || saved?.alias !== environment.alias || saved?.orgId !== environment.orgId
      || saved?.isSandbox !== environment.isSandbox || saved?.username !== (environment.username || null)) {
      throw new Error(`The saved ${environment.label} workflow identity no longer matches connection policy.`);
    }
  }
  return true;
}

export function readSalesforceWorkflowState({ allowMissing = false } = {}) {
  const target = sourceStatePath();
  if (!existsSync(target)) {
    if (allowMissing) return null;
    throw new Error('No Salesforce promotion workflow state exists.');
  }
  let record;
  try { record = JSON.parse(readFileSync(target, 'utf8')); }
  catch { throw new Error('The Salesforce promotion workflow state is malformed.'); }
  validateSalesforceWorkflowState(record);
  return record;
}

export function writeSalesforceWorkflowState(record, now = new Date()) {
  validateSalesforceWorkflowState(record);
  const next = structuredClone(record);
  next.updatedAt = now.toISOString();
  const target = sourceStatePath();
  const temporary = `${target}.${process.pid}.tmp`;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  return next;
}

export function archiveWorkflowStateFile(target, now = new Date()) {
  if (!existsSync(target)) return null;
  const bytes = readFileSync(target);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const timestamp = now.toISOString().replace(/[:.]/gu, '-');
  const archiveDirectory = path.join(path.dirname(target), 'salesforce-workflow-history');
  const archivePath = path.join(archiveDirectory, `${timestamp}-${digest}.json`);
  mkdirSync(archiveDirectory, { recursive: true });
  if (existsSync(archivePath)) throw new Error('The immutable Salesforce workflow archive already exists.');
  renameSync(target, archivePath);
  return archivePath;
}
export function archiveSalesforceWorkflowState(now = new Date()) { return archiveWorkflowStateFile(sourceStatePath(), now); }

export function updateSalesforceEnvironmentState(record, environmentKey, changes, now = new Date()) {
  validateSalesforceWorkflowState(record);
  const environment = environmentPolicy(environmentKey);
  const next = structuredClone(record);
  next.environments[environmentKey] = {
    ...next.environments[environmentKey], ...structuredClone(changes),
    key: environment.key, alias: environment.alias, orgId: environment.orgId,
    isSandbox: environment.isSandbox, username: environment.username || null,
  };
  next.updatedAt = now.toISOString();
  validateSalesforceWorkflowState(next);
  return next;
}

function assertBoundJob(job, frozen, { checkOnly }) {
  if (job?.sourceTreeHash !== frozen.sourceTreeHash
    || job?.releaseMode !== SALESFORCE_RELEASE_MODE
    || job?.deploymentScope !== COMPLETE_SALESFORCE_SCOPE
    || job?.testLevel !== FULL_SALESFORCE_TEST_LEVEL
    || job?.checkOnly !== checkOnly
    || !String(job?.jobId || '').trim()) {
    throw new Error('The saved Salesforce job is not bound to the frozen schema-free complete source.');
  }
}
export function validationResumeDisposition(validation, frozen) {
  if (!validation) return 'submit';
  assertBoundJob(validation, frozen, { checkOnly: true });
  if (validation.status === 'Succeeded') return 'reuse';
  if (['Submitted', 'Queued', 'Pending', 'InProgress', 'Canceling'].includes(validation.status)) return 'resume';
  throw new Error(`The saved Salesforce validation ended with ${validation.status || 'an unknown status'}; change the source or explicitly start a new workflow from DEVEE.`);
}
export function deploymentResumeDisposition(deployment, frozen) {
  if (!deployment) return 'submit';
  assertBoundJob(deployment, frozen, { checkOnly: false });
  if (deployment.status === 'Succeeded') return 'reuse';
  if (['Submitted', 'Queued', 'Pending', 'InProgress', 'Canceling'].includes(deployment.status)) return 'resume';
  throw new Error(`The saved Salesforce deployment ended with ${deployment.status || 'an unknown status'}; inspect it before retrying.`);
}

export function deveeSourceProof(record, now = new Date(), { allowStaleVerification = false } = {}) {
  validateSalesforceWorkflowState(record);
  const environment = record.environments.devee;
  const validation = environment?.validation;
  const deployment = environment?.deployment;
  const proof = {
    schemaVersion: SALESFORCE_WORKFLOW_SCHEMA_VERSION, releaseMode: record.releaseMode,
    environment: 'devee', alias: environment?.alias, orgId: environment?.orgId, isSandbox: environment?.isSandbox,
    sourceTreeHash: record.sourceTreeHash,
    validationJobId: validation?.jobId, validationStatus: validation?.status,
    validationCheckOnly: validation?.checkOnly, validationTestLevel: validation?.testLevel,
    validationScope: validation?.deploymentScope, validationSourceTreeHash: validation?.sourceTreeHash,
    validationReleaseMode: validation?.releaseMode,
    deploymentJobId: deployment?.jobId, deploymentValidationJobId: deployment?.validationJobId,
    deploymentSourceTreeHash: deployment?.sourceTreeHash, deploymentReleaseMode: deployment?.releaseMode,
    deploymentScope: deployment?.deploymentScope, testLevel: deployment?.testLevel,
    deploymentStatus: deployment?.status, checkOnly: deployment?.checkOnly,
    deployedAt: deployment?.completedAt, verifiedAt: deployment?.verifiedAt,
  };
  validateDeveeSourceState(proof, record.sourceTreeHash, now, { allowStaleVerification });
  return proof;
}
export function readDeveeSourceState({ allowStaleVerification = false, now = new Date() } = {}) {
  return deveeSourceProof(readSalesforceWorkflowState(), now, { allowStaleVerification });
}

export function validateDeveeSourceState(record, sourceTreeHash, now = new Date(), { allowStaleVerification = false } = {}) {
  const environment = deveeEnvironment();
  const deployedAt = Date.parse(record?.deployedAt || '');
  const verifiedAt = Date.parse(record?.verifiedAt || '');
  const ageSeconds = Number.isFinite(verifiedAt) ? Math.max(0, (now.getTime() - verifiedAt) / 1000) : Number.POSITIVE_INFINITY;
  if (record?.schemaVersion !== SALESFORCE_WORKFLOW_SCHEMA_VERSION
    || record?.releaseMode !== SALESFORCE_RELEASE_MODE
    || record?.environment !== 'devee' || record?.alias !== environment.alias
    || record?.orgId !== environment.orgId || record?.isSandbox !== true
    || record?.sourceTreeHash !== sourceTreeHash
    || !String(record?.validationJobId || '').trim() || record?.validationStatus !== 'Succeeded'
    || record?.validationCheckOnly !== true || record?.validationTestLevel !== FULL_SALESFORCE_TEST_LEVEL
    || record?.validationScope !== COMPLETE_SALESFORCE_SCOPE || record?.validationSourceTreeHash !== sourceTreeHash
    || record?.validationReleaseMode !== SALESFORCE_RELEASE_MODE
    || !String(record?.deploymentJobId || '').trim() || record?.deploymentValidationJobId !== record?.validationJobId
    || record?.deploymentSourceTreeHash !== sourceTreeHash || record?.deploymentReleaseMode !== SALESFORCE_RELEASE_MODE
    || record?.deploymentScope !== COMPLETE_SALESFORCE_SCOPE || record?.testLevel !== FULL_SALESFORCE_TEST_LEVEL
    || record?.deploymentStatus !== 'Succeeded' || record?.checkOnly !== false || !Number.isFinite(deployedAt)
    || (!allowStaleVerification && (!Number.isFinite(verifiedAt) || ageSeconds > PUBLICATION.sourceStateMaximumAgeSeconds))) {
    throw new Error('Shared publication requires fresh schema-free complete-source RunLocalTests deployment proof for the exact source-tree hash.');
  }
  return true;
}

export function refreshDeveeSourceVerification(record, {
  sourceTreeHash, validationJobId, deploymentJobId, liveIdentity, liveDeployment,
}, now = new Date()) {
  const environment = deveeEnvironment();
  const previous = deveeSourceProof(record, now, { allowStaleVerification: true });
  if (sourceTreeHash !== previous.sourceTreeHash || validationJobId !== previous.validationJobId
    || deploymentJobId !== previous.deploymentJobId || liveIdentity?.alias !== environment.alias
    || liveIdentity?.orgId !== environment.orgId || liveIdentity?.username !== environment.username
    || liveIdentity?.connectedStatus !== 'Connected' || liveIdentity?.organizationId !== environment.orgId
    || liveIdentity?.isSandbox !== true || liveDeployment?.id !== deploymentJobId
    || liveDeployment?.status !== 'Succeeded' || liveDeployment?.checkOnly !== false) {
    throw new Error('The live DEVEE identity or successful deployment proof cannot refresh the saved schema-free complete-source proof.');
  }
  return updateSalesforceEnvironmentState(record, 'devee', {
    deployment: { ...record.environments.devee.deployment, verifiedAt: now.toISOString() },
  }, now);
}

export function writeDeveeSourceState({
  sourceTreeHash, deploymentJobId, validationJobId, deploymentScope,
  testLevel = FULL_SALESFORCE_TEST_LEVEL, deployedAt, verifiedAt = new Date().toISOString(),
}) {
  const workflow = readSalesforceWorkflowState();
  if (workflow.sourceTreeHash !== sourceTreeHash || deploymentScope !== COMPLETE_SALESFORCE_SCOPE) {
    throw new Error('A DEVEE proof can only bind the frozen complete authoritative source.');
  }
  const current = workflow.environments.devee;
  const originalDeploymentTime = deployedAt || current.deployment?.completedAt || verifiedAt;
  const next = updateSalesforceEnvironmentState(workflow, 'devee', {
    deployment: {
      ...(current.deployment || {}), jobId: deploymentJobId, validationJobId, sourceTreeHash,
      releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope, testLevel, status: 'Succeeded', checkOnly: false,
      completedAt: originalDeploymentTime, verifiedAt,
    },
  });
  writeSalesforceWorkflowState(next);
  return deveeSourceProof(next);
}
