import { fileURLToPath } from 'node:url';

import {
  MigrationError,
  fingerprint,
  prepareMigration,
  readEnvironment,
  safeSummary,
} from './migrate-email-router.mjs';

const CONTRACT_VERSION = 'emailrouter-fcos-operational-reconciliation/v1';

function restUrl(connection, path) {
  return `${connection.url}/rest/v1/${path}`;
}

function headers(connection) {
  return {
    apikey: connection.serviceKey,
    Authorization: `Bearer ${connection.serviceKey}`,
    'Content-Type': 'application/json',
  };
}

function numericCounts(value = {}) {
  const keys = ['providerDirectoryDestinations', 'fcosProfileDestinations', 'destinationGroups', 'destinationGroupMembers', 'routingPresets', 'routingPresetMembers', 'settings'];
  const result = {};
  for (const key of keys) {
    const count = Number(value[key]);
    if (!Number.isInteger(count) || count < 0) throw new MigrationError('INVALID_TARGET_RECONCILIATION_RESPONSE');
    result[key] = count;
  }
  return result;
}

function fingerprintValue(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function sanitizeTargetResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MigrationError('INVALID_TARGET_RECONCILIATION_RESPONSE');
  }
  const counts = numericCounts(value.counts);
  const targetFingerprint = fingerprintValue(value.fingerprint);
  if (!targetFingerprint) throw new MigrationError('INVALID_TARGET_RECONCILIATION_RESPONSE');
  const metadata = value.metadataSync && typeof value.metadataSync === 'object' ? value.metadataSync : null;
  const metadataFingerprint = metadata ? fingerprintValue(metadata.fingerprint) : null;
  return {
    counts,
    fingerprint: targetFingerprint,
    metadataSync: metadataFingerprint ? { fingerprint: metadataFingerprint } : { fingerprint: null },
  };
}

async function requestReconciliation(connections, requestBody, fetchFn) {
  let response;
  try {
    response = await fetchFn(restUrl(connections.target, 'rpc/reconcile_emailrouter_operational_config'), {
      method: 'POST',
      headers: headers(connections.target),
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new MigrationError('TARGET_RECONCILIATION_UNAVAILABLE');
  }
  if (!response.ok) throw new MigrationError('TARGET_RECONCILIATION_UNAVAILABLE');
  try {
    return sanitizeTargetResult(await response.json());
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('INVALID_TARGET_RECONCILIATION_RESPONSE');
  }
}

function parseArgs(argv) {
  if (argv.slice(2).length) throw new MigrationError('INVALID_ARGUMENT');
}

export async function runReconciliation({ env = process.env, argv = process.argv, fetchFn = fetch } = {}) {
  parseArgs(argv);
  const prepared = await prepareMigration({ env, fetchFn });
  const connections = readEnvironment(env);
  const expectedCounts = {
    providerDirectoryDestinations: prepared.operational.counts.providerDirectoryDestinations,
    fcosProfileDestinations: prepared.operational.counts.fcosProfileDestinations,
    destinationGroups: prepared.operational.counts.destinationGroups,
    destinationGroupMembers: prepared.operational.counts.destinationGroupMembers,
    routingPresets: prepared.operational.counts.routingPresets,
    routingPresetMembers: prepared.operational.counts.routingPresetMembers,
    settings: prepared.operational.counts.settings,
  };
  const expected = {
    contractVersion: CONTRACT_VERSION,
    configuration: { counts: expectedCounts, fingerprint: prepared.operational.fingerprint },
    metadataSync: prepared.metadataSync.request.sourceMetadata,
  };
  const target = await requestReconciliation(connections, { p_expected: expected }, fetchFn);
  const countsMatch = fingerprint(expectedCounts) === fingerprint(target.counts);
  const configurationMatches = countsMatch && target.fingerprint === prepared.operational.fingerprint;
  const metadataMatches = target.metadataSync.fingerprint === null
    ? 'not_reported'
    : target.metadataSync.fingerprint === fingerprint(prepared.metadataSync.request.sourceMetadata);

  return {
    contractVersion: CONTRACT_VERSION,
    mode: 'dry_run',
    outcome: configurationMatches && metadataMatches !== false ? 'matched' : 'mismatch',
    activeUserReconciliation: prepared.activeUserMapping.summary,
    operationalConfiguration: {
      expected: { counts: expectedCounts, fingerprint: prepared.operational.fingerprint },
      actual: target,
      matches: configurationMatches,
    },
    metadataSync: {
      ...prepared.metadataSync.summary,
      matches: metadataMatches,
    },
    excluded: {
      actions: 'not_read_or_reconciled',
      recommendations: 'not_read_or_reconciled',
      aiLearningHistory: 'not_read_or_reconciled',
      messageContent: 'not_read_or_reconciled',
      recipientArrays: 'not_read_or_reconciled',
    },
  };
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await runReconciliation())}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ...safeSummary(error), contractVersion: CONTRACT_VERSION })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  await main();
}
