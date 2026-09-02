import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getPhysicalHedgeSalesforceStatuses } from '../api/_hedgePhysicalSalesforce.js';
import { loadValidatedHedgeSalesforceMapping } from '../api/_hedgeSalesforce.js';
import { sfQueryAll } from '../api/_salesforce.js';
import { serverSupabaseConfig } from '../api/_supabaseConfig.js';

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function argumentsFor(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((value) => value.startsWith(prefix)).map((value) => value.slice(prefix.length)).filter(Boolean);
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function summarizeStatus(row) {
  return {
    physicalTradeId: row.physicalTradeId,
    stem: row.stemKey,
    state: row.state,
    proposedSalesforceCost: row.proposedSalesforceCost,
    currentSalesforceCost: row.currentSalesforceCost,
    venues: row.venues.map((venue) => ({
      venue: venue.venue,
      state: venue.state,
      proposedSalesforceCost: venue.salesforceCost,
      currentSalesforceCost: venue.currentSalesforceCost,
    })),
  };
}

async function relevantSalesforceSnapshot(client, physicalIds) {
  const [{ config }, physicalResult] = await Promise.all([
    loadValidatedHedgeSalesforceMapping(client),
    client.from('hedge_physical_trades').select('id,stem_number').in('id', physicalIds),
  ]);
  if (physicalResult.error) throw new Error(`Physical Trade STEM references could not be loaded: ${physicalResult.error.message}`);
  const stemKeys = [...new Set((physicalResult.data || []).map((row) => String(row.stem_number || '').trim()).filter(Boolean))];
  if (!stemKeys.length) return { rows: [], hash: fingerprint([]) };

  const stemResult = await sfQueryAll(`SELECT Id,${config.stemNameField} FROM ${config.stemObjectName} WHERE ${config.stemNameField} IN ('${stemKeys.map(escapeSoql).join("','")}')`);
  const stemIds = (stemResult.records || []).map((row) => row.Id);
  if (!stemIds.length) return { rows: [], hash: fingerprint([]) };

  const fields = [
    'Id',
    'Name',
    'IsDeleted',
    'LastModifiedDate',
    config.stemLookupField,
    config.productLookupField,
    config.supplierLookupField,
    config.amountField,
    config.externalKeyField,
    config.cancelledField,
    config.buyerInvoiceField,
    config.supplierInvoiceField,
  ];
  const supplierIds = Object.values(config.venues).map((venue) => venue.supplierId);
  const result = await sfQueryAll(`SELECT ${fields.join(',')} FROM ${config.objectName} WHERE ${config.stemLookupField} IN ('${stemIds.join("','")}') AND ${config.productLookupField} = '${config.productId}' AND ${config.supplierLookupField} IN ('${supplierIds.join("','")}')`);
  const rows = (result.records || []).map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null]))).sort((left, right) => left.Id.localeCompare(right.Id));
  return { rows, hash: fingerprint(rows) };
}

async function main() {
  for (const envFile of argumentsFor('env-file')) process.loadEnvFile(envFile);
  const actorEmail = argument('actor-email');
  const expectedCount = Number(argument('expect', '0'));
  if (!actorEmail) throw new Error('Use --actor-email=<authorized FCOS user>.');
  const config = serverSupabaseConfig();
  if (!config.configured) throw new Error(`Supabase is not configured: ${config.missingEnv.join(', ')}`);
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [profileResult, linkResult] = await Promise.all([
    client.from('user_profiles').select('id,email').ilike('email', actorEmail).maybeSingle(),
    client.from('hedge_swap_physical_links').select('physical_trade_id'),
  ]);
  if (profileResult.error || !profileResult.data) throw new Error(`Authorized FCOS profile was not found for ${actorEmail}.`);
  if (linkResult.error) throw new Error(`Physical Trade links could not be loaded: ${linkResult.error.message}`);
  const physicalIds = [...new Set((linkResult.data || []).map((row) => row.physical_trade_id).filter(Boolean))].sort();
  if (expectedCount && physicalIds.length !== expectedCount) throw new Error(`Expected ${expectedCount} linked Physical Trades, found ${physicalIds.length}.`);

  const before = await relevantSalesforceSnapshot(client, physicalIds);
  const batches = [];
  for (let index = 0; index < physicalIds.length; index += 50) batches.push(physicalIds.slice(index, index + 50));
  const results = [];
  for (const ids of batches) {
    const result = await getPhysicalHedgeSalesforceStatuses(client, profileResult.data, { physicalTradeIds: ids, persist: true });
    if (result.salesforceWritePerformed !== false) throw new Error('Backfill safety assertion failed: a Salesforce write was reported.');
    results.push(...result.rows);
  }
  const after = await relevantSalesforceSnapshot(client, physicalIds);
  if (before.hash !== after.hash) throw new Error('Backfill safety assertion failed: relevant Salesforce rows changed during calculation-only backfill.');

  const mappingResult = await client.from('hedge_physical_salesforce_costs').select('physical_trade_id,venue,salesforce_record_id,sync_state').in('physical_trade_id', physicalIds);
  if (mappingResult.error) throw new Error(`Persisted calculation rows could not be verified: ${mappingResult.error.message}`);
  if ((mappingResult.data || []).some((row) => row.salesforce_record_id)) throw new Error('Backfill safety assertion failed: an unmanaged Salesforce record was persisted as a managed mapping.');

  console.log(JSON.stringify({
    physicalTradeCount: physicalIds.length,
    calculationRowCount: (mappingResult.data || []).length,
    salesforceRowsBefore: before.rows.length,
    salesforceRowsAfter: after.rows.length,
    salesforceSnapshotUnchanged: before.hash === after.hash,
    salesforceWritePerformed: false,
    statuses: results.map(summarizeStatus),
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
