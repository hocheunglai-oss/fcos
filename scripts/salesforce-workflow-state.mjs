import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALESFORCE_POLICY = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const PUBLICATION = SALESFORCE_POLICY?.publication;

export function deveeEnvironment() {
  const environment = SALESFORCE_POLICY?.environments?.find(({ key }) => key === PUBLICATION?.sourceEnvironmentKey);
  if (!environment || environment.key !== 'devee' || environment.isSandbox !== true) {
    throw new Error('The Salesforce development source must be the pinned DEVEE sandbox.');
  }
  return environment;
}

export function sourceStatePath() {
  if (!PUBLICATION?.sourceStatePath) throw new Error('The DEVEE source-state path is not configured.');
  const absolute = path.resolve(REPO_ROOT, PUBLICATION.sourceStatePath);
  const relative = path.relative(path.resolve(REPO_ROOT, '.fcos-cli'), absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The DEVEE source-state path must remain under .fcos-cli.');
  return absolute;
}

export function writeDeveeSourceState({ sourceTreeHash, deploymentJobId, deploymentScope, deployedAt = new Date().toISOString() }) {
  const environment = deveeEnvironment();
  if (!/^[a-f0-9]{64}$/u.test(String(sourceTreeHash || '')) || !String(deploymentJobId || '').trim()) {
    throw new Error('A source hash and successful DEVEE deployment job are required.');
  }
  const record = {
    schemaVersion: 1,
    environment: environment.key,
    alias: environment.alias,
    orgId: environment.orgId,
    isSandbox: true,
    sourceTreeHash,
    deploymentJobId,
    deploymentScope: String(deploymentScope || '').trim(),
    deploymentStatus: 'Succeeded',
    deployedAt,
  };
  const target = sourceStatePath();
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record;
}

export function readDeveeSourceState() {
  const target = sourceStatePath();
  if (!existsSync(target)) throw new Error('No successful DEVEE deployment proof exists for this source tree.');
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    throw new Error('The DEVEE deployment proof is malformed.');
  }
}

export function validateDeveeSourceState(record, sourceTreeHash, now = new Date()) {
  const environment = deveeEnvironment();
  const deployedAt = Date.parse(record?.deployedAt || '');
  const ageSeconds = Number.isFinite(deployedAt) ? Math.max(0, (now.getTime() - deployedAt) / 1000) : Number.POSITIVE_INFINITY;
  if (record?.schemaVersion !== 1
    || record?.environment !== 'devee'
    || record?.alias !== environment.alias
    || record?.orgId !== environment.orgId
    || record?.isSandbox !== true
    || record?.deploymentStatus !== 'Succeeded'
    || record?.sourceTreeHash !== sourceTreeHash
    || !String(record?.deploymentJobId || '').trim()
    || !String(record?.deploymentScope || '').trim()
    || ageSeconds > PUBLICATION.sourceStateMaximumAgeSeconds) {
    throw new Error('Shared publication requires a fresh successful DEVEE deployment for the exact source-tree hash.');
  }
  return true;
}
