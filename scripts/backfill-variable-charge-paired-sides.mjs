import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { variableChargeInternals } from '../api/_variableCharges.js';

const EXPECTED_ORG = Object.freeze({
  alias: 'source-salesforce',
  orgId: '00D2x000000Ei4oEAC',
  username: 'vincent@cosulich.com.hk',
  sandbox: false,
});
const EXPECTED_SUPABASE_REF = 'pjforfvchygdyqfcgpmw';
const API_VERSION = 'v67.0';
const PAGE_SIZE = 1_000;
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hash(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function chunks(values, size = 150) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function sf(args, { input } = {}) {
  const output = execFileSync('sf', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
    maxBuffer: 80 * 1024 * 1024,
  });
  const parsed = JSON.parse(output);
  if (Object.hasOwn(parsed, 'status') && parsed.status !== 0) {
    throw new Error(parsed.message || `Salesforce command failed: ${args.join(' ')}`);
  }
  return Object.hasOwn(parsed, 'result') ? parsed.result : parsed;
}

function query(alias, soql) {
  return sf(['data', 'query', '--target-org', alias, '--query', soql, '--result-format', 'json', '--json']).records || [];
}

function queryByIds(alias, selectFrom, idField, ids, suffix = '') {
  const rows = [];
  for (const group of chunks([...new Set(ids)].filter((id) => SALESFORCE_ID.test(id)))) {
    rows.push(...query(alias, `${selectFrom} WHERE ${idField} IN (${group.map((id) => `'${escapeSoql(id)}'`).join(',')}) ${suffix}`));
  }
  return rows;
}

function sfRest(alias, path, { method = 'GET', body } = {}) {
  const args = ['api', 'request', 'rest', path, '--target-org', alias, '--method', method];
  if (body !== undefined) args.push('--body', '-');
  return sf(args, body === undefined ? {} : { input: JSON.stringify(body) });
}

function staleHeader(lastModifiedDate) {
  const parsed = new Date(lastModifiedDate);
  if (Number.isNaN(parsed.getTime())) throw new Error('Every Salesforce backfill write requires LastModifiedDate.');
  return { 'If-Unmodified-Since': parsed.toUTCString() };
}

function composite(alias, requests) {
  for (const group of chunks(requests, 25)) {
    if (!group.length) continue;
    const result = sfRest(alias, `/services/data/${API_VERSION}/composite`, {
      method: 'POST',
      body: { allOrNone: true, compositeRequest: group },
    });
    const failed = (result.compositeResponse || []).find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
    if (failed) throw new Error(failed.body?.[0]?.message || failed.body?.message || 'Salesforce rejected the paired-workflow backfill.');
  }
}

async function allRows(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

function pairKey(stemId, supplierId) {
  return `${stemId}:${supplierId}`;
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return status === 'verified' ? 'verified' : status === 'invalidated' ? 'invalidated' : 'pending';
}

export function requiredSupplierIds({ lineItems, extraCosts, accounts, supplierStages }) {
  const accountMap = new Map(accounts.map((row) => [row.Id, row]));
  const stageMap = new Map(supplierStages.map((row) => [row.Supplier__c, row]));
  const exact = new Set([
    ...lineItems.map((row) => row.Original_Supplier__c),
    ...extraCosts.map((row) => row.Supplier__c),
  ].filter(Boolean));
  return [...exact].filter((supplierId) => {
    const account = accountMap.get(supplierId);
    return account?.Inactive_Suspended__c !== true
      && (account?.Is_Agent__c === true
        || account?.Is_Variable__c === true
        || stageMap.get(supplierId)?.Manual_Review_Required__c === true);
  }).sort();
}

export function buyerCaseBackfillStatus({ caseRow, stem, hasHistoricalConfirmation }) {
  if (caseRow?.confirmation_status === 'confirmed' && stem?.Variable_Charges_Confirmed__c === true && hasHistoricalConfirmation) return 'confirmed';
  if (caseRow?.confirmation_status === 'invalidated' || (hasHistoricalConfirmation && stem?.Variable_Charges_Confirmed__c !== true)) return 'invalidated';
  return 'pending';
}

function liveProjection({ stem, lineItems, extraCosts, accounts, supplierStages, nominations, supplierIds }) {
  const required = new Set(supplierIds);
  const live = {
    stem,
    allLineItems: lineItems,
    lineItems: lineItems.filter((row) => required.has(row.Original_Supplier__c)),
    extraCosts: extraCosts.filter((row) => required.has(row.Supplier__c)),
    accounts: accounts.filter((row) => required.has(row.Id)),
    supplierStages: supplierStages.filter((row) => required.has(row.Supplier__c)),
    nominations,
    supplierRequirements: supplierIds.map((supplierId) => ({ supplierId })),
  };
  return {
    live,
    legacyFingerprint: variableChargeInternals.liveFingerprint(live),
    buyerAggregateFingerprint: variableChargeInternals.buyerAggregateFingerprint(live),
    costFingerprints: Object.fromEntries(supplierIds.map((supplierId) => [supplierId, variableChargeInternals.supplierLiveFingerprint(live, supplierId)])),
    buyerFingerprints: Object.fromEntries(supplierIds.map((supplierId) => [supplierId, variableChargeInternals.buyerChargeLiveFingerprint(live, supplierId)])),
  };
}

function assertOrg(alias) {
  if (alias !== EXPECTED_ORG.alias) throw new Error('Use --target-org source-salesforce. Paired historical backfill is Production-only.');
  const org = sf(['org', 'display', '--target-org', alias, '--verbose', '--json']);
  const sandbox = org.isSandbox === true || org.instanceUrl?.includes('.sandbox.') || org.instanceUrl?.includes('--');
  if (org.id !== EXPECTED_ORG.orgId || org.username !== EXPECTED_ORG.username || sandbox !== EXPECTED_ORG.sandbox) {
    throw new Error(`Salesforce identity mismatch; expected ${EXPECTED_ORG.orgId} / ${EXPECTED_ORG.username} / production.`);
  }
  return org;
}

function supabaseClient() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY are required.');
  const parsed = new URL(url);
  if (!parsed.hostname.startsWith(`${EXPECTED_SUPABASE_REF}.`)) throw new Error(`Supabase identity mismatch; expected project ${EXPECTED_SUPABASE_REF}.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadLedger(client) {
  const [cases, stages, caseConfirmations, supplierConfirmations] = await Promise.all([
    allRows(client, 'variable_charge_cases', 'id,stem_id,confirmation_status,last_confirmation_id,source_fingerprint,assigned_buyer_user_id'),
    allRows(client, 'variable_charge_supplier_stages', 'id,case_id,stem_id,supplier_account_id,assigned_supplier_user_id,status'),
    allRows(client, 'variable_charge_confirmations', 'id,case_id,confirmed_by,confirmed_by_email,created_at'),
    allRows(client, 'variable_charge_supplier_confirmations', 'id,supplier_stage_id,confirmed_by,created_at'),
  ]);
  return { cases, stages, caseConfirmations, supplierConfirmations };
}

function latestBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const current = result.get(row[key]);
    if (!current || String(row.created_at) > String(current.created_at)) result.set(row[key], row);
  }
  return result;
}

function sfData(alias, stemIds) {
  const stems = queryByIds(alias,
    'SELECT Id, Name, KeyStem__c, Account__c, CreatedDate, Delivery_Date__c, ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c, ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c, Payment_Term__c, Total__c, Costs_Total__c, Total_Invoice_Amount__c, Receivable_Balance__c, Payable_Balance__c, Variable_Charges_Confirmed__c, LastModifiedDate FROM STEM__c',
    'Id', stemIds);
  const lineItems = queryByIds(alias,
    'SELECT Id, STEM__c, Original_Supplier__c, Product__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Unit_of_Measure__c, Unit_Sell_At__c, Unit_Buy_At__c, Total_Cost__c, Total_Price__c, Commission_Cost__c, Payment_Term__c, Buyer_Invoice__c, Supplier_Invoice__c, Cancelled__c, LastModifiedDate FROM STEM_Line_Item__c',
    'STEM__c', stemIds, 'AND Cancelled__c = false');
  const extraCosts = queryByIds(alias,
    'SELECT Id, STEM__c, STEM_Line_Item__c, Supplier__c, Supplier_Invoice__c, Product2Id__c, Description__c, RecordTypeId, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Range_Max__c, Unit_of_Measure__c, Unit_Cost__c, Unit_Price__c, Lumpsum_Cost__c, Lumpsum_Price__c, Line_Total_Buy__c, Line_Total__c, Payment_Term__c, Buyer_Invoice__c, Cancelled__c, LastModifiedDate FROM STEM_Extra_Cost__c',
    'STEM__c', stemIds, 'AND Cancelled__c = false AND Supplier__c != null');
  const sfStages = queryByIds(alias,
    'SELECT Id, STEM__c, Supplier__c, Manual_Review_Required__c, Supplier_Status__c, Reviewed_Source_Fingerprint__c, Buyer_Charge_Status__c, Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Confirmed_At__c, Buyer_Charge_Confirmed_By_Email__c, LastModifiedDate FROM STEM_Variable_Charge_Supplier__c',
    'STEM__c', stemIds);
  const nominations = queryByIds(alias,
    "SELECT Id, STEM__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c, Buyer_Confirmation__c FROM Nomination__c",
    'STEM__c', stemIds, "AND Deprecated__c = false AND RecordType.DeveloperName = 'Buyer'");
  const supplierIds = [...new Set([
    ...lineItems.map((row) => row.Original_Supplier__c),
    ...extraCosts.map((row) => row.Supplier__c),
    ...sfStages.map((row) => row.Supplier__c),
  ].filter(Boolean))];
  const accounts = queryByIds(alias,
    'SELECT Id, Name, Is_Agent__c, Is_Variable__c, Supplier_Payment_Term__c, Inactive_Suspended__c FROM Account',
    'Id', supplierIds);
  return { stems, lineItems, extraCosts, sfStages, nominations, accounts };
}

function fingerprintPath(stemId, supplierId, side) {
  const normalized = side === 'buyer_charge' ? 'buyer-charge' : 'cost';
  return `/services/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/${normalized}/fingerprint`;
}

function confirmationPath(stemId, supplierId) {
  return `/services/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/confirm`;
}

async function main() {
  const alias = argument('--target-org');
  const execute = process.argv.includes('--execute');
  const org = assertOrg(alias);
  if (execute && argument('--confirm-org-id') !== EXPECTED_ORG.orgId) {
    throw new Error(`Execution requires --confirm-org-id ${EXPECTED_ORG.orgId}.`);
  }
  const client = supabaseClient();
  const ledger = await loadLedger(client);
  const stemIds = ledger.cases.map((row) => row.stem_id).filter((id) => SALESFORCE_ID.test(id));
  if (stemIds.length !== ledger.cases.length) throw new Error('The Variable Charges ledger contains an invalid Salesforce STEM identity.');
  const salesforce = sfData(alias, stemIds);
  const stemMap = new Map(salesforce.stems.map((row) => [row.Id, row]));
  const sfStageMap = new Map(salesforce.sfStages.map((row) => [pairKey(row.STEM__c, row.Supplier__c), row]));
  const ledgerStageMap = new Map(ledger.stages.map((row) => [pairKey(row.stem_id, row.supplier_account_id), row]));
  const caseConfirmationMap = latestBy(ledger.caseConfirmations, 'case_id');
  const supplierConfirmationMap = latestBy(ledger.supplierConfirmations, 'supplier_stage_id');
  const plans = [];
  const blockers = [];

  for (const caseRow of ledger.cases) {
    const stem = stemMap.get(caseRow.stem_id);
    if (!stem) { blockers.push({ code: 'STEM_MISSING', stemId: caseRow.stem_id }); continue; }
    const stemLines = salesforce.lineItems.filter((row) => row.STEM__c === stem.Id);
    const stemExtras = salesforce.extraCosts.filter((row) => row.STEM__c === stem.Id);
    const stemStages = salesforce.sfStages.filter((row) => row.STEM__c === stem.Id);
    const exactAccountIds = new Set([...stemLines.map((row) => row.Original_Supplier__c), ...stemExtras.map((row) => row.Supplier__c)].filter(Boolean));
    const stemAccounts = salesforce.accounts.filter((row) => exactAccountIds.has(row.Id));
    const supplierIds = requiredSupplierIds({ lineItems: stemLines, extraCosts: stemExtras, accounts: stemAccounts, supplierStages: stemStages });
    const missingLedgerStages = supplierIds.filter((supplierId) => !ledgerStageMap.has(pairKey(stem.Id, supplierId)));
    if (missingLedgerStages.length) {
      blockers.push({ code: 'SUPABASE_STAGE_MISSING', stemId: stem.Id, supplierIds: missingLedgerStages });
      continue;
    }
    const projection = liveProjection({
      stem, lineItems: stemLines, extraCosts: stemExtras, accounts: stemAccounts,
      supplierStages: stemStages,
      nominations: salesforce.nominations.filter((row) => row.STEM__c === stem.Id),
      supplierIds,
    });
    const historicalBuyer = caseConfirmationMap.get(caseRow.id) || null;
    const buyerCaseStatus = buyerCaseBackfillStatus({ caseRow, stem, hasHistoricalConfirmation: Boolean(historicalBuyer) });
    if (buyerCaseStatus === 'confirmed' && !historicalBuyer?.confirmed_by_email) {
      blockers.push({ code: 'BUYER_ACTOR_MISSING', stemId: stem.Id });
      continue;
    }
    const costSnapshots = {};
    const buyerSnapshots = {};
    for (const supplierId of supplierIds) {
      const ledgerStage = ledgerStageMap.get(pairKey(stem.Id, supplierId));
      const sfStage = sfStageMap.get(pairKey(stem.Id, supplierId));
      if (sfStage?.Supplier_Status__c === 'Verified') {
        if (!supplierConfirmationMap.has(ledgerStage.id)) {
          blockers.push({ code: 'COST_ACTOR_MISSING', stemId: stem.Id, supplierId });
          continue;
        }
        costSnapshots[supplierId] = sfRest(alias, fingerprintPath(stem.Id, supplierId, 'cost'));
      }
      if (buyerCaseStatus === 'confirmed') {
        buyerSnapshots[supplierId] = sfRest(alias, fingerprintPath(stem.Id, supplierId, 'buyer_charge'));
      }
    }
    plans.push({ caseRow, stem, supplierIds, projection, historicalBuyer, buyerCaseStatus, costSnapshots, buyerSnapshots });
  }

  if (blockers.length) throw new Error(`Backfill preflight failed: ${JSON.stringify(blockers)}`);

  const buyerConfirms = plans.reduce((count, plan) => count + (plan.buyerCaseStatus === 'confirmed' ? plan.supplierIds.length : 0), 0);
  const invalidatedCases = plans.filter((plan) => plan.buyerCaseStatus === 'invalidated').length;
  const pendingCases = plans.filter((plan) => plan.buyerCaseStatus === 'pending').length;

  if (execute) {
    const resetRequests = [];
    let requestIndex = 0;
    for (const plan of plans) {
      if (plan.buyerCaseStatus !== 'confirmed') {
        if (plan.stem.Variable_Charges_Confirmed__c === true) {
          resetRequests.push({
            method: 'PATCH', url: `/services/data/${API_VERSION}/sobjects/STEM__c/${plan.stem.Id}`,
            referenceId: `stemReset${requestIndex++}`, httpHeaders: staleHeader(plan.stem.LastModifiedDate),
            body: { Variable_Charges_Confirmed__c: false },
          });
        }
        if (plan.buyerCaseStatus === 'invalidated') {
          for (const supplierId of plan.supplierIds) {
            const stage = sfStageMap.get(pairKey(plan.stem.Id, supplierId));
            const body = {
              Buyer_Charge_Status__c: 'Invalidated',
              Buyer_Charge_Reviewed_Source_Fingerprint__c: null,
              Buyer_Charge_Confirmed_At__c: null,
              Buyer_Charge_Confirmed_By_Email__c: null,
            };
            resetRequests.push(stage ? {
              method: 'PATCH', url: `/services/data/${API_VERSION}/sobjects/STEM_Variable_Charge_Supplier__c/${stage.Id}`,
              referenceId: `stageInvalid${requestIndex++}`, httpHeaders: staleHeader(stage.LastModifiedDate), body,
            } : {
              method: 'POST', url: `/services/data/${API_VERSION}/sobjects/STEM_Variable_Charge_Supplier__c`,
              referenceId: `stageInvalid${requestIndex++}`,
              body: { ...body, STEM__c: plan.stem.Id, Supplier__c: supplierId, Manual_Review_Required__c: false },
            });
          }
        }
      }
    }
    composite(alias, resetRequests);

    let latest = sfData(alias, stemIds);
    let latestStemMap = new Map(latest.stems.map((row) => [row.Id, row]));
    let latestStageMap = new Map(latest.sfStages.map((row) => [pairKey(row.STEM__c, row.Supplier__c), row]));
    for (const plan of plans.filter((row) => row.buyerCaseStatus === 'confirmed')) {
      for (const supplierId of plan.supplierIds) {
        const snapshot = sfRest(alias, fingerprintPath(plan.stem.Id, supplierId, 'buyer_charge'));
        const stage = latestStageMap.get(pairKey(plan.stem.Id, supplierId));
        const stem = latestStemMap.get(plan.stem.Id);
        if (stage?.Buyer_Charge_Status__c === 'Verified'
          && stage.Buyer_Charge_Reviewed_Source_Fingerprint__c === (snapshot.buyerFingerprint || snapshot.fingerprint)) continue;
        sfRest(alias, confirmationPath(plan.stem.Id, supplierId), {
          method: 'POST',
          body: {
            stemId: plan.stem.Id,
            supplierId,
            sides: ['buyer_charge'],
            verifierEmail: plan.historicalBuyer.confirmed_by_email,
            expectedBuyerFingerprint: snapshot.buyerFingerprint || snapshot.fingerprint,
            expectedStemLastModifiedAt: stem.LastModifiedDate,
            expectedStageLastModifiedAt: stage?.LastModifiedDate || null,
          },
        });
        latest = sfData(alias, stemIds);
        latestStemMap = new Map(latest.stems.map((row) => [row.Id, row]));
        latestStageMap = new Map(latest.sfStages.map((row) => [pairKey(row.STEM__c, row.Supplier__c), row]));
      }
    }

    latest = sfData(alias, stemIds);
    latestStemMap = new Map(latest.stems.map((row) => [row.Id, row]));
    latestStageMap = new Map(latest.sfStages.map((row) => [pairKey(row.STEM__c, row.Supplier__c), row]));
    for (const plan of plans) {
      const latestStem = latestStemMap.get(plan.stem.Id);
      if ((plan.buyerCaseStatus === 'confirmed') !== (latestStem.Variable_Charges_Confirmed__c === true)) {
        throw new Error(`Salesforce buyer readiness did not reconcile for ${plan.stem.Id}.`);
      }
      const sides = [];
      for (const supplierId of plan.supplierIds) {
        const stage = latestStageMap.get(pairKey(plan.stem.Id, supplierId));
        const ledgerStage = ledgerStageMap.get(pairKey(plan.stem.Id, supplierId));
        const costSnapshot = stage?.Supplier_Status__c === 'Verified'
          ? sfRest(alias, fingerprintPath(plan.stem.Id, supplierId, 'cost')) : null;
        const costStatus = stage?.Supplier_Status__c === 'Verified'
          ? stage.Reviewed_Source_Fingerprint__c === (costSnapshot?.costFingerprint || costSnapshot?.fingerprint)
            ? 'verified' : 'invalidated'
          : normalizeStatus(stage?.Supplier_Status__c);
        const buyerSnapshot = plan.buyerCaseStatus === 'confirmed'
          ? sfRest(alias, fingerprintPath(plan.stem.Id, supplierId, 'buyer_charge')) : null;
        const buyerStatus = plan.buyerCaseStatus === 'confirmed'
          && stage?.Buyer_Charge_Status__c === 'Verified'
          && stage.Buyer_Charge_Reviewed_Source_Fingerprint__c === (buyerSnapshot?.buyerFingerprint || buyerSnapshot?.fingerprint)
          ? 'verified' : plan.buyerCaseStatus === 'invalidated' ? 'invalidated' : 'pending';
        if (costStatus === 'verified' && !supplierConfirmationMap.has(ledgerStage.id)) {
          throw new Error(`Historical supplier-cost actor is unavailable for ${plan.stem.Id}/${supplierId}.`);
        }
        const common = {
          supplierAccountId: supplierId,
          defaultAssigneeUserId: ledgerStage.assigned_supplier_user_id || null,
          buyerTraderUserId: plan.caseRow.assigned_buyer_user_id || null,
          salesforceStageLastModifiedAt: stage?.LastModifiedDate || null,
        };
        sides.push({ ...common, side: 'cost', status: costStatus, sourceFingerprint: plan.projection.costFingerprints[supplierId] });
        sides.push({ ...common, side: 'buyer_charge', status: buyerStatus, sourceFingerprint: plan.projection.buyerFingerprints[supplierId] });
      }
      const { error } = await client.rpc('reconcile_variable_charge_paired_backfill', {
        p_stem_id: plan.stem.Id,
        p_buyer_aggregate_fingerprint: plan.projection.buyerAggregateFingerprint,
        p_buyer_case_status: plan.buyerCaseStatus,
        p_salesforce_stem_last_modified_at: latestStem.LastModifiedDate,
        p_sides: sides,
      });
      if (error) throw new Error(`Supabase reconciliation failed for ${plan.stem.Id}: ${error.message}`);
    }
  }

  const report = {
    migration: 'variable-charge-paired-sides-v1',
    mode: execute ? 'execute' : 'dry-run',
    targetAlias: alias,
    orgId: org.id,
    supabaseProjectRef: EXPECTED_SUPABASE_REF,
    completedAt: new Date().toISOString(),
    caseCount: plans.length,
    supplierPairCount: plans.reduce((count, plan) => count + plan.supplierIds.length, 0),
    buyerConfirmationCount: buyerConfirms,
    invalidatedCaseCount: invalidatedCases,
    pendingCaseCount: pendingCases,
    legacyFingerprintMatchCount: plans.filter((plan) => plan.caseRow.source_fingerprint === plan.projection.legacyFingerprint).length,
    actorEvidence: {
      buyerCases: plans.filter((plan) => Boolean(plan.historicalBuyer)).length,
      supplierSides: plans.reduce((count, plan) => count + plan.supplierIds.filter((supplierId) => {
        const stage = ledgerStageMap.get(pairKey(plan.stem.Id, supplierId));
        return supplierConfirmationMap.has(stage.id);
      }).length, 0),
    },
  };
  report.reportHash = hash(JSON.stringify(report));
  mkdirSync(resolve('output'), { recursive: true });
  writeFileSync(resolve('output', `variable-charge-paired-backfill-${report.mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
