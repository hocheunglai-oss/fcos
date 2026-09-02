import { createHash } from 'node:crypto';
import {
  hedgeSalesforceFailure,
  hedgeSalesforceFingerprint,
  loadFinalPaperHedgeAllocation,
  loadValidatedHedgeSalesforceMapping,
} from './_hedgeSalesforce.js';
import { physicalMidQuantity, roundMoney } from '../src/hedge/lib/domain.js';
import { getApiVersion, getInstanceUrl, sfQuery, sfQueryAll, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags } from './_runtimeCache.js';

const PHYSICAL_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const VENUES = ['ICE', 'FCBS'];
const MAX_PHYSICALS = 50;
const MONEY_TOLERANCE = 0.005;
const ACTIONABLE_STATES = new Set(['ready_to_add', 'update_required', 'removed', 'changed_salesforce', 'conflict']);
const BLOCKING_STATES = new Set(['no_stem', 'no_linked_hedge', 'waiting_final', 'locked_by_invoice']);

function apiName(value, label) {
  const name = String(value || '');
  if (!API_NAME.test(name)) throw hedgeSalesforceFailure(`Invalid Salesforce ${label} configuration.`, 503, 'HEDGE_SALESFORCE_MAPPING_INVALID');
  return name;
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function validPhysicalIds(values = []) {
  const ids = [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length || ids.length > MAX_PHYSICALS || ids.some((id) => !PHYSICAL_ID.test(id))) {
    throw hedgeSalesforceFailure(`Select between 1 and ${MAX_PHYSICALS} valid Physical Trades.`);
  }
  return ids;
}

function allocationKey(physicalTradeId, venue, generation = 1) {
  return `HEDGE:${physicalTradeId}:${venue}:${generation}`;
}

function allocateMoney(total, shares) {
  let allocated = 0;
  return shares.map((share, index) => {
    const value = index === shares.length - 1 ? roundMoney(total - allocated) : roundMoney(total * share);
    allocated = roundMoney(allocated + value);
    return value;
  });
}

function sameInstant(left, right) {
  if (left == null || right == null) return left == null && right == null;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime === rightTime : String(left) === String(right);
}

export function allocateGrossPnlAcrossPhysicals({ grossPnl, physicals = [], sgoRatio }) {
  if (!physicals.length) return [];
  const ordered = [...physicals];
  const weights = ordered.map((row) => Math.max(0, physicalMidQuantity(row, sgoRatio)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const shares = weights.map((weight) => totalWeight > 0 ? weight / totalWeight : 1 / weights.length);
  const grossRows = allocateMoney(roundMoney(grossPnl), shares);
  return ordered.map((physical, index) => ({
    physicalTradeId: physical.id,
    weight: weights[index],
    share: shares[index],
    grossPnl: grossRows[index],
    salesforceCost: roundMoney(-grossRows[index]),
  }));
}

function describeFields(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

async function validatePhysicalMapping(config) {
  const objectName = apiName(config.objectName, 'extra-cost object');
  const describe = await sfRequest(`/sobjects/${objectName}/describe`, { readOnly: true });
  const fields = describeFields(describe);
  const required = [
    config.externalKeyField,
    config.cancelledField,
    config.buyerInvoiceField,
    config.supplierInvoiceField,
  ];
  for (const fieldName of required) {
    const field = fields.get(apiName(fieldName, 'physical allocation field'));
    if (!field) throw hedgeSalesforceFailure(`Salesforce ${objectName}.${fieldName} is required for Physical Trade hedge results.`, 503, 'HEDGE_PHYSICAL_SALESFORCE_SCHEMA_INVALID');
  }
  const keyField = fields.get(config.externalKeyField);
  if (keyField.externalId !== true || keyField.unique !== true || keyField.createable !== true || keyField.updateable !== true) {
    throw hedgeSalesforceFailure(`Salesforce ${objectName}.${config.externalKeyField} must be a writable unique External ID.`, 503, 'HEDGE_PHYSICAL_SALESFORCE_SCHEMA_INVALID');
  }
}

async function loadPhysicalRows(client, physicalIds) {
  const [physicalResult, linkResult] = await Promise.all([
    client.from('hedge_physical_trades').select('*').in('id', physicalIds),
    client.from('hedge_swap_physical_links').select('physical_trade_id,swap_id,link_order').in('physical_trade_id', physicalIds).order('link_order'),
  ]);
  const error = physicalResult.error || linkResult.error;
  if (error) throw hedgeSalesforceFailure(`Physical Trade hedge links could not be loaded: ${error.message}`, 502);
  const rows = physicalResult.data || [];
  if (rows.length !== physicalIds.length) throw hedgeSalesforceFailure('One or more Physical Trades are no longer available.', 404);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    rows: physicalIds.map((id) => byId.get(id)),
    links: linkResult.data || [],
  };
}

async function loadExistingMappings(client, physicalIds) {
  const result = await client.from('hedge_physical_salesforce_costs').select('*').in('physical_trade_id', physicalIds);
  if (result.error) {
    if (/relation .*hedge_physical_salesforce_costs.* does not exist/i.test(result.error.message || '')) return [];
    throw hedgeSalesforceFailure(`Physical Trade Salesforce mappings could not be loaded: ${result.error.message}`, 502);
  }
  return result.data || [];
}

async function calculatePhysicals(client, physicalIds) {
  const scope = await loadPhysicalRows(client, physicalIds);
  const swapIds = [...new Set(scope.links.map((row) => row.swap_id))];
  const loadedSwaps = await Promise.all(swapIds.map(async (swapId) => {
    const loaded = await loadFinalPaperHedgeAllocation(client, swapId);
    const allocations = allocateGrossPnlAcrossPhysicals({
      grossPnl: loaded.financials.grossPnl,
      physicals: loaded.inputs.physicals,
      sgoRatio: loaded.inputs.sgoRatio,
    });
    return [swapId, { ...loaded, allocations: new Map(allocations.map((row) => [row.physicalTradeId, row])) }];
  }));
  const swapCache = new Map(loadedSwaps);

  return scope.rows.map((physical) => {
    const links = scope.links.filter((row) => row.physical_trade_id === physical.id);
    const issues = [];
    const stemKey = String(physical.stem_number || '').trim();
    if (!stemKey) issues.push('Add a Salesforce STEM number before posting the hedge result.');
    if (!links.length) issues.push('Link at least one Paper Hedge before posting a hedge result.');
    const venues = new Map();
    for (const link of links) {
      const loaded = swapCache.get(link.swap_id);
      const swap = loaded?.inputs?.swap;
      const allocation = loaded?.allocations?.get(physical.id);
      if (!swap || !allocation) {
        issues.push('A linked Paper Hedge allocation could not be calculated.');
        continue;
      }
      if (swap.product !== physical.product) issues.push(`Linked Paper Hedge ${String(swap.id).slice(0, 8)} uses ${swap.product || 'no product'}, not ${physical.product || 'the Physical Trade product'}.`);
      if (!VENUES.includes(swap.venue)) issues.push(`Salesforce posting is not configured for venue ${swap.venue || 'Not set'}.`);
      for (const issue of loaded.financials.issues || []) issues.push(issue);
      if (!VENUES.includes(swap.venue)) continue;
      const row = venues.get(swap.venue) || { venue: swap.venue, grossPnl: 0, salesforceCost: 0, contributions: [] };
      row.grossPnl = roundMoney(row.grossPnl + allocation.grossPnl);
      row.salesforceCost = roundMoney(-row.grossPnl);
      row.contributions.push({
        paperHedgeId: swap.id,
        paperHedgeRevision: Number(swap.revision || 0),
        product: swap.product,
        venue: swap.venue,
        share: allocation.share,
        allocationPercentage: Math.round(allocation.share * 100000000) / 1000000,
        physicalMidpointQuantity: allocation.weight,
        grossPnl: allocation.grossPnl,
        contractMonths: loaded.financials.months,
      });
      venues.set(swap.venue, row);
    }
    const uniqueIssues = [...new Set(issues)];
    return {
      physical,
      stemKey,
      issues: uniqueIssues,
      venues: [...venues.values()].sort((left, right) => left.venue.localeCompare(right.venue)).map((row) => ({
        ...row,
        calculationFingerprint: hedgeSalesforceFingerprint({
          physicalTradeId: physical.id,
          physicalRevision: physical.revision,
          stemKey,
          venue: row.venue,
          grossPnl: row.grossPnl,
          salesforceCost: row.salesforceCost,
          contributions: row.contributions,
        }),
      })),
    };
  });
}

function matchesIdentity(record, row, config) {
  return record?.[config.stemLookupField] === row.salesforceStemId
    && record?.[config.productLookupField] === config.productId
    && record?.[config.supplierLookupField] === row.supplierAccountId;
}

function stateFromManagedRecord(record, row, config) {
  if (record?.[config.buyerInvoiceField] || record?.[config.supplierInvoiceField]) {
    return { state: 'locked_by_invoice', issue: 'The Salesforce extra cost is already linked to an invoice and cannot be changed here.' };
  }
  if (record?.IsDeleted === true || record?.[config.cancelledField] === true) {
    return { state: 'removed', issue: 'The managed Salesforce extra cost was deleted or cancelled.' };
  }
  if (!matchesIdentity(record, row, config)) {
    return { state: 'changed_salesforce', issue: 'The managed Salesforce row no longer matches the expected STEM, Product, or Supplier.' };
  }
  const currentCost = Number(record?.[config.amountField] || 0);
  if (Math.abs(currentCost - row.salesforceCost) > MONEY_TOLERANCE) return { state: 'update_required', issue: null };
  return { state: 'added', issue: null };
}

async function resolveSalesforce(client, calculations, existingMappings) {
  const actionable = calculations.filter((row) => row.stemKey && row.venues.length);
  if (!actionable.length) return { config: null, identities: null, stems: new Map(), records: [], mappingByKey: new Map() };
  const { config, identities } = await loadValidatedHedgeSalesforceMapping(client);
  await validatePhysicalMapping(config);
  const stemObject = apiName(config.stemObjectName, 'STEM object');
  const stemNameField = apiName(config.stemNameField, 'STEM key field');
  const keys = [...new Set(actionable.map((row) => escapeSoql(row.stemKey)))];
  const stemResult = await sfQuery(`SELECT Id,${stemNameField} FROM ${stemObject} WHERE ${stemNameField} IN ('${keys.join("','")}')`, { clean: true, limit: Math.max(20, keys.length * 2) });
  const stemsByKey = new Map();
  for (const stem of stemResult.records) {
    const key = stem[stemNameField];
    if (!stemsByKey.has(key)) stemsByKey.set(key, []);
    stemsByKey.get(key).push(stem);
  }
  const stemIds = [...new Set(stemResult.records.map((row) => row.Id))];
  const mappingByKey = new Map(existingMappings.map((row) => [`${row.physical_trade_id}:${row.venue}`, row]));
  const linkedIds = existingMappings.map((row) => row.salesforce_record_id).filter((id) => SALESFORCE_ID.test(String(id || '')));
  const externalKeys = existingMappings.map((row) => row.allocation_key).filter(Boolean);
  const objectName = apiName(config.objectName, 'extra-cost object');
  const fields = [
    'Id', 'Name', 'IsDeleted', 'LastModifiedDate', config.stemLookupField, config.productLookupField,
    config.supplierLookupField, config.amountField, config.paymentTermField, config.descriptionField,
    config.externalKeyField, config.cancelledField, config.buyerInvoiceField, config.supplierInvoiceField,
  ].map((field) => apiName(field, 'extra-cost field'));
  const supplierIds = VENUES.map((venue) => config.venues[venue].supplierId);
  const clauses = [];
  if (stemIds.length) clauses.push(`(${config.stemLookupField} IN ('${stemIds.join("','")}') AND ${config.productLookupField} = '${config.productId}' AND ${config.supplierLookupField} IN ('${supplierIds.join("','")}'))`);
  if (linkedIds.length) clauses.push(`Id IN ('${[...new Set(linkedIds)].join("','")}')`);
  if (externalKeys.length) clauses.push(`${config.externalKeyField} IN ('${[...new Set(externalKeys)].map(escapeSoql).join("','")}')`);
  const extraResult = clauses.length
    ? await sfQueryAll(`SELECT ${fields.join(',')} FROM ${objectName} WHERE ${clauses.join(' OR ')}`, { clean: true, limit: Math.max(100, stemIds.length * 12) })
    : { records: [] };
  return { config, identities, stems: stemsByKey, records: extraResult.records || [], mappingByKey };
}

function statusSummary(rows, fallbackState) {
  if (!rows.length) return fallbackState;
  const priority = ['locked_by_invoice', 'conflict', 'changed_salesforce', 'removed', 'waiting_final', 'update_required', 'ready_to_add', 'added'];
  return priority.find((state) => rows.some((row) => row.state === state)) || fallbackState;
}

function decorateStatuses(calculations, resolved) {
  return calculations.map((calculation) => {
    const physical = calculation.physical;
    if (!calculation.stemKey) return { physicalTradeId: physical.id, physicalRevision: Number(physical.revision || 0), stemKey: '', state: 'no_stem', proposedSalesforceCost: null, venues: [], issues: calculation.issues };
    if (!calculation.venues.length) return { physicalTradeId: physical.id, physicalRevision: Number(physical.revision || 0), stemKey: calculation.stemKey, state: 'no_linked_hedge', proposedSalesforceCost: null, venues: [], issues: calculation.issues };
    const stemMatches = resolved.stems.get(calculation.stemKey) || [];
    const stemIssue = stemMatches.length === 1 ? null : stemMatches.length ? `Salesforce STEM ${calculation.stemKey} is not unique.` : `Salesforce STEM ${calculation.stemKey} was not found.`;
    const venueRows = calculation.venues.map((venueRow) => {
      const mapping = resolved.mappingByKey.get(`${physical.id}:${venueRow.venue}`) || null;
      const generation = Number(mapping?.generation || 1);
      const key = mapping?.allocation_key || allocationKey(physical.id, venueRow.venue, generation);
      const stem = stemMatches.length === 1 ? stemMatches[0] : null;
      const supplier = resolved.identities?.suppliers?.[venueRow.venue] || null;
      const base = {
        ...venueRow,
        generation,
        allocationKey: key,
        mappingId: mapping?.id || null,
        mappingRevision: Number(mapping?.revision || 0),
        salesforceStemId: stem?.Id || null,
        supplierAccountId: supplier?.Id || resolved.config?.venues?.[venueRow.venue]?.supplierId || null,
        supplierName: supplier?.Name || venueRow.venue,
        supplierClKey: supplier?.Company_Code__c || '',
      };
      const description = `FCOS final gross ${venueRow.venue} hedge P&L ${venueRow.grossPnl.toFixed(2)} USD allocated to ${calculation.stemKey}`.slice(0, 255);
      const row = { ...base, description };
      if (stemIssue || calculation.issues.length) return { ...row, state: 'waiting_final', reviewIssue: stemIssue || calculation.issues[0], currentSalesforceCost: mapping?.current_salesforce_cost == null ? null : Number(mapping.current_salesforce_cost), salesforceRecordId: mapping?.salesforce_record_id || null, salesforceRecordName: mapping?.salesforce_record_name || null };
      const recordsByKey = resolved.records.filter((record) => record?.[resolved.config.externalKeyField] === key);
      const mappedById = mapping?.salesforce_record_id ? resolved.records.find((record) => record.Id === mapping.salesforce_record_id) : null;
      const managed = mappedById || (recordsByKey.length === 1 ? recordsByKey[0] : null);
      const unmanaged = resolved.records.filter((record) => !record?.[resolved.config.externalKeyField] && matchesIdentity(record, row, resolved.config) && record.IsDeleted !== true && record?.[resolved.config.cancelledField] !== true);
      if (recordsByKey.length > 1 || (mappedById && recordsByKey.length === 1 && recordsByKey[0].Id !== mappedById.Id)) {
        return { ...row, state: 'conflict', reviewIssue: 'Multiple Salesforce rows claim this FCOS hedge allocation.', currentSalesforceCost: null, salesforceRecordId: null, salesforceRecordName: null };
      }
      if (!managed) {
        if (mapping?.salesforce_record_id) return { ...row, state: 'removed', reviewIssue: 'The managed Salesforce extra cost is no longer available.', currentSalesforceCost: mapping.current_salesforce_cost == null ? null : Number(mapping.current_salesforce_cost), salesforceRecordId: mapping.salesforce_record_id, salesforceRecordName: mapping.salesforce_record_name };
        if (unmanaged.length === 1 && (unmanaged[0]?.[resolved.config.buyerInvoiceField] || unmanaged[0]?.[resolved.config.supplierInvoiceField])) {
          return {
            ...row,
            state: 'locked_by_invoice',
            reviewIssue: 'A matching unmanaged Salesforce row is already linked to an invoice and cannot be adopted.',
            currentSalesforceCost: Number(unmanaged[0][resolved.config.amountField] || 0),
            salesforceRecordId: unmanaged[0].Id,
            salesforceRecordName: unmanaged[0].Name,
            salesforceUrl: physicalSalesforceRecordUrl(unmanaged[0].Id),
            unmanagedCandidate: true,
          };
        }
        if (unmanaged.length) return { ...row, state: 'conflict', reviewIssue: unmanaged.length === 1 ? 'An unmanaged matching SWAPS row already exists and requires explicit adoption.' : 'Multiple unmanaged matching SWAPS rows require review.', currentSalesforceCost: unmanaged.length === 1 ? Number(unmanaged[0][resolved.config.amountField] || 0) : null, salesforceRecordId: unmanaged.length === 1 ? unmanaged[0].Id : null, salesforceRecordName: unmanaged.length === 1 ? unmanaged[0].Name : null, unmanagedCandidate: unmanaged.length === 1 };
        return { ...row, state: 'ready_to_add', reviewIssue: null, currentSalesforceCost: null, salesforceRecordId: null, salesforceRecordName: null };
      }
      const state = stateFromManagedRecord(managed, row, resolved.config);
      return {
        ...row,
        managedRecord: true,
        state: state.state,
        reviewIssue: state.issue,
        currentSalesforceCost: Number(managed?.[resolved.config.amountField] || 0),
        salesforceRecordId: managed?.Id || null,
        salesforceRecordName: managed?.Name || null,
        salesforceUrl: managed?.Id ? physicalSalesforceRecordUrl(managed.Id) : null,
        salesforceLastModifiedAt: managed?.LastModifiedDate || null,
        existingPaymentTerm: managed?.[resolved.config.paymentTermField] || null,
        buyerInvoiceId: managed?.[resolved.config.buyerInvoiceField] || null,
        supplierInvoiceId: managed?.[resolved.config.supplierInvoiceField] || null,
      };
    });
    const proposedSalesforceCost = roundMoney(venueRows.reduce((sum, row) => sum + row.salesforceCost, 0));
    const currentValues = venueRows.map((row) => row.currentSalesforceCost).filter((value) => value != null);
    const currentSalesforceCost = currentValues.length === venueRows.length ? roundMoney(currentValues.reduce((sum, value) => sum + value, 0)) : null;
    const state = statusSummary(venueRows, calculation.issues.length ? 'waiting_final' : 'ready_to_add');
    return {
      physicalTradeId: physical.id,
      physicalRevision: Number(physical.revision || 0),
      stemKey: calculation.stemKey,
      state,
      proposedSalesforceCost,
      currentSalesforceCost,
      difference: currentSalesforceCost == null ? null : roundMoney(proposedSalesforceCost - currentSalesforceCost),
      venues: venueRows,
      issues: [...new Set([...calculation.issues, ...venueRows.map((row) => row.reviewIssue).filter(Boolean)])],
      previewFingerprint: hedgeSalesforceFingerprint({ physicalTradeId: physical.id, physicalRevision: physical.revision, stemKey: calculation.stemKey, venues: venueRows.map((row) => ({ venue: row.venue, generation: row.generation, key: row.allocationKey, recordId: row.salesforceRecordId, modified: row.salesforceLastModifiedAt, state: row.state, cost: row.salesforceCost, fingerprint: row.calculationFingerprint })) }),
      calculatedAt: new Date().toISOString(),
    };
  });
}

async function writeHistory(client, profile, row, eventType, metadata = {}) {
  const result = await client.from('hedge_physical_salesforce_cost_history').insert({
    physical_trade_id: row.physicalTradeId,
    venue: row.venue,
    event_type: eventType,
    generation: row.generation,
    allocation_key: row.allocationKey,
    salesforce_record_id: row.salesforceRecordId,
    gross_pnl: row.grossPnl,
    salesforce_cost: row.salesforceCost,
    calculation_fingerprint: row.calculationFingerprint,
    snapshot: { state: row.state, currentSalesforceCost: row.currentSalesforceCost, contributions: row.contributions, ...metadata },
    actor_user_id: profile?.id || null,
    actor_email: profile?.email || 'system',
  });
  if (result.error) throw hedgeSalesforceFailure(`Physical Trade Salesforce history could not be saved: ${result.error.message}`, 502);
}

async function persistStatuses(client, profile, statuses) {
  const now = new Date().toISOString();
  for (const status of statuses) {
    for (const row of status.venues) {
      const payload = {
        physical_trade_id: status.physicalTradeId,
        venue: row.venue,
        salesforce_stem_id: row.salesforceStemId,
        stem_key_snapshot: status.stemKey,
        generation: row.generation,
        allocation_key: row.allocationKey,
        supplier_account_id: row.supplierAccountId,
        supplier_name_snapshot: row.supplierName,
        // An unmanaged matching SWAPS row is only a review candidate. Do not
        // persist its identity until an authorized user explicitly adopts it.
        salesforce_record_id: row.unmanagedCandidate ? null : row.salesforceRecordId,
        salesforce_record_name: row.unmanagedCandidate ? null : row.salesforceRecordName,
        salesforce_last_modified_at: row.unmanagedCandidate ? null : row.salesforceLastModifiedAt,
        gross_pnl: row.grossPnl,
        salesforce_cost: row.salesforceCost,
        current_salesforce_cost: row.currentSalesforceCost,
        source_hedge_ids: row.contributions.map((item) => item.paperHedgeId),
        source_hedge_revisions: Object.fromEntries(row.contributions.map((item) => [item.paperHedgeId, item.paperHedgeRevision])),
        calculation_snapshot: { physicalRevision: status.physicalRevision, contributions: row.contributions, description: row.description },
        calculation_fingerprint: row.calculationFingerprint,
        mapping_revision: 2,
        sync_state: row.state,
        review_issue: row.reviewIssue,
        updated_at: now,
        updated_by: profile?.id || null,
        updated_by_email: profile?.email || 'system',
      };
      const existing = row.mappingId ? await client.from('hedge_physical_salesforce_costs').select('*').eq('id', row.mappingId).maybeSingle() : { data: null, error: null };
      if (existing.error) throw hedgeSalesforceFailure(`Physical Trade Salesforce mapping could not be checked: ${existing.error.message}`, 502);
      if (existing.data) {
        const persistedRecordId = row.unmanagedCandidate ? null : row.salesforceRecordId;
        const persistedLastModifiedAt = row.unmanagedCandidate ? null : row.salesforceLastModifiedAt;
        const currentCostChanged = existing.data.current_salesforce_cost == null
          ? row.currentSalesforceCost != null
          : row.currentSalesforceCost == null || Math.abs(Number(existing.data.current_salesforce_cost) - Number(row.currentSalesforceCost)) > MONEY_TOLERANCE;
        const changed = existing.data.calculation_fingerprint !== row.calculationFingerprint
          || existing.data.sync_state !== row.state
          || !sameInstant(existing.data.salesforce_last_modified_at, persistedLastModifiedAt)
          || existing.data.salesforce_record_id !== persistedRecordId
          || currentCostChanged
          || existing.data.review_issue !== row.reviewIssue;
        if (!changed) continue;
        const saved = await client.from('hedge_physical_salesforce_costs').update({ ...payload, revision: Number(existing.data.revision || 0) + 1 }).eq('id', existing.data.id).eq('revision', existing.data.revision).select('id').maybeSingle();
        if (saved.error || !saved.data) throw hedgeSalesforceFailure('This Physical Trade hedge-result calculation changed concurrently. Refresh before continuing.', 409, 'REVISION_CONFLICT');
        await writeHistory(client, profile, { ...row, physicalTradeId: status.physicalTradeId }, 'recalculated', { previousFingerprint: existing.data.calculation_fingerprint });
      } else {
        const saved = await client.from('hedge_physical_salesforce_costs').insert({ ...payload, created_by: profile?.id || null, created_by_email: profile?.email || 'system' });
        if (saved.error) {
          if (/duplicate key|unique constraint/i.test(saved.error.message || '')) continue;
          throw hedgeSalesforceFailure(`Physical Trade Salesforce preview could not be saved: ${saved.error.message}`, 502);
        }
        await writeHistory(client, profile, { ...row, physicalTradeId: status.physicalTradeId }, 'calculated');
      }
    }
  }
}

async function buildStatuses(client, profile, physicalIds, { persist = true } = {}) {
  const ids = validPhysicalIds(physicalIds);
  const [calculations, mappings] = await Promise.all([calculatePhysicals(client, ids), loadExistingMappings(client, ids)]);
  const resolved = await resolveSalesforce(client, calculations, mappings);
  const statuses = decorateStatuses(calculations, resolved);
  if (persist) await persistStatuses(client, profile, statuses);
  return { statuses, resolved };
}

export async function getPhysicalHedgeSalesforceStatuses(client, profile, body = {}) {
  const ids = validPhysicalIds(body.physicalTradeIds || body.physical_trade_ids);
  const result = await buildStatuses(client, profile, ids, { persist: body.persist !== false });
  return {
    rows: result.statuses,
    calculatedCount: result.statuses.filter((row) => row.venues.length).length,
    salesforceWritePerformed: false,
    checkedAt: new Date().toISOString(),
  };
}

export async function previewPhysicalHedgeSalesforce(client, profile, body = {}) {
  const id = validPhysicalIds([body.physicalTradeId || body.physical_trade_id])[0];
  const result = await buildStatuses(client, profile, [id], { persist: true });
  const status = result.statuses[0];
  if (body.expectedRevision != null && Number(body.expectedRevision) !== status.physicalRevision) {
    throw hedgeSalesforceFailure('This Physical Trade changed after it was opened. Refresh before continuing.', 409, 'REVISION_CONFLICT', { current: status });
  }
  return { ...status, salesforceWritePerformed: false };
}

async function reserveOperation(client, profile, body, status) {
  const key = String(body.idempotencyKey || '').trim();
  if (!key) throw hedgeSalesforceFailure('A Salesforce operation idempotency key is required.');
  const requestHash = createHash('sha256').update(JSON.stringify({ physicalTradeId: status.physicalTradeId, previewFingerprint: status.previewFingerprint, action: body.action, reason: String(body.reason || '') })).digest('hex');
  const existing = await client.from('hedge_integration_operations').select('*').eq('idempotency_key', key).maybeSingle();
  if (existing.error) throw hedgeSalesforceFailure(`Salesforce operation could not be checked: ${existing.error.message}`, 502);
  if (existing.data) {
    if (existing.data.request_hash !== requestHash) throw hedgeSalesforceFailure('This Salesforce operation key was already used for different data.', 409);
    if (existing.data.status === 'succeeded') return { replay: existing.data.response };
    if (['processing', 'uncertain'].includes(existing.data.status)) throw hedgeSalesforceFailure('This Salesforce operation is already running or requires review.', 409);
  }
  const payload = { idempotency_key: key, operation: 'hedge_physical_salesforce_sync', actor_user_id: profile.id, actor_email: profile.email, request_hash: requestHash, status: 'processing', error: null };
  const write = existing.data
    ? await client.from('hedge_integration_operations').update(payload).eq('id', existing.data.id).select('*').single()
    : await client.from('hedge_integration_operations').insert(payload).select('*').single();
  if (write.error) throw hedgeSalesforceFailure(`Salesforce operation could not be reserved: ${write.error.message}`, 502);
  return { operation: write.data };
}

function requestedActionForState(state, bodyAction) {
  if (state === 'ready_to_add') return 'create';
  if (state === 'update_required') return 'update';
  if (state === 'removed') return 'recreate';
  if (state === 'changed_salesforce') return 'restore';
  if (state === 'conflict' && bodyAction === 'adopt') return 'adopt';
  if (state === 'added') return 'none';
  return null;
}

export async function applyPhysicalHedgeSalesforce(client, profile, body = {}) {
  const preview = await previewPhysicalHedgeSalesforce(client, profile, body);
  if (preview.previewFingerprint !== body.previewFingerprint) throw hedgeSalesforceFailure('The calculation or Salesforce records changed after preview. Review the refreshed values before confirming.', 409, 'HEDGE_PHYSICAL_SALESFORCE_PREVIEW_STALE', { preview });
  if (preview.venues.some((row) => BLOCKING_STATES.has(row.state)) || !preview.venues.length) throw hedgeSalesforceFailure('Salesforce posting is blocked until every Physical Trade issue is resolved.', 409, 'HEDGE_PHYSICAL_SALESFORCE_NOT_READY', { preview });
  const action = String(body.action || 'apply');
  const reason = String(body.reason || '').trim();
  if (preview.venues.some((row) => ['conflict', 'changed_salesforce'].includes(row.state)) && reason.length < 5) throw hedgeSalesforceFailure('Enter a specific reason of at least five characters before adopting or restoring a Salesforce row.');
  const reservation = await reserveOperation(client, profile, body, preview);
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  const operation = reservation.operation;
  let salesforceAccepted = false;
  try {
    const { config } = await loadValidatedHedgeSalesforceMapping(client);
    await validatePhysicalMapping(config);
    const objectName = apiName(config.objectName, 'extra-cost object');
    const requests = [];
    const pending = [];
    for (const row of preview.venues) {
      const rowAction = requestedActionForState(row.state, action);
      if (!rowAction) throw hedgeSalesforceFailure(`The ${row.venue} Salesforce row cannot be changed from its current state.`, 409);
      if (rowAction === 'none') continue;
      const generation = rowAction === 'recreate' ? row.generation + 1 : row.generation;
      const key = allocationKey(preview.physicalTradeId, row.venue, generation);
      const common = {
        [config.amountField]: row.salesforceCost,
        [config.descriptionField]: row.description,
        [config.externalKeyField]: key,
      };
      const full = {
        RecordTypeId: config.recordTypeId,
        [config.stemLookupField]: row.salesforceStemId,
        [config.productLookupField]: config.productId,
        [config.supplierLookupField]: row.supplierAccountId,
        [config.fixedField]: true,
        [config.quantityField]: Number(config.quantity || 1),
        [config.paymentTermField]: config.venues[row.venue].paymentTerm,
        ...common,
      };
      const referenceId = `physical${requests.length}`;
      if (['update', 'restore', 'adopt'].includes(rowAction)) {
        if (!SALESFORCE_ID.test(String(row.salesforceRecordId || ''))) throw hedgeSalesforceFailure(`The ${row.venue} Salesforce record is unavailable for ${rowAction}.`, 409);
        requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${objectName}/${row.salesforceRecordId}`, referenceId, body: rowAction === 'update' ? common : full });
      } else {
        requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${objectName}`, referenceId, body: full });
      }
      pending.push({ row, rowAction, generation, key, referenceId });
    }
    if (!requests.length) {
      const response = { success: true, physicalTradeId: preview.physicalTradeId, results: [], unchanged: true, salesforceWritePerformed: false };
      const finalized = await client.from('hedge_integration_operations').update({ status: 'succeeded', response, error: null }).eq('id', operation.id);
      if (finalized.error) throw hedgeSalesforceFailure('FCOS could not finalize the unchanged Salesforce operation.', 502, 'HEDGE_PHYSICAL_SALESFORCE_CONFIRMATION_FAILED');
      return response;
    }
    const composite = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    salesforceAccepted = true;
    const responses = composite?.compositeResponse || [];
    const rejected = responses.find((response) => response.httpStatusCode < 200 || response.httpStatusCode >= 300);
    if (rejected) throw hedgeSalesforceFailure(rejected.body?.[0]?.message || rejected.body?.message || 'Salesforce rejected the Physical Trade hedge-result transaction.', rejected.httpStatusCode || 502, 'HEDGE_PHYSICAL_SALESFORCE_COMPOSITE_FAILED');
    const now = new Date().toISOString();
    const results = [];
    for (const item of pending) {
      const response = responses.find((row) => row.referenceId === item.referenceId);
      const recordId = ['create', 'recreate'].includes(item.rowAction) ? response?.body?.id : item.row.salesforceRecordId;
      if (!SALESFORCE_ID.test(String(recordId || ''))) throw hedgeSalesforceFailure('Salesforce accepted the transaction but did not return a valid record ID.', 502, 'HEDGE_PHYSICAL_SALESFORCE_CONFIRMATION_FAILED');
      const current = await client.from('hedge_physical_salesforce_costs').select('*').eq('physical_trade_id', preview.physicalTradeId).eq('venue', item.row.venue).maybeSingle();
      if (current.error || !current.data) throw hedgeSalesforceFailure('Salesforce accepted the transaction, but its FCOS mapping is unavailable.', 502, 'HEDGE_PHYSICAL_SALESFORCE_CONFIRMATION_FAILED');
      const saved = await client.from('hedge_physical_salesforce_costs').update({
        generation: item.generation,
        allocation_key: item.key,
        salesforce_record_id: recordId,
        current_salesforce_cost: item.row.salesforceCost,
        sync_state: 'added',
        review_issue: null,
        synced_at: now,
        synced_by: profile.id,
        synced_by_email: profile.email,
        updated_at: now,
        updated_by: profile.id,
        updated_by_email: profile.email,
        revision: Number(current.data.revision || 0) + 1,
      }).eq('id', current.data.id).eq('revision', current.data.revision).select('id').maybeSingle();
      if (saved.error || !saved.data) throw hedgeSalesforceFailure('Salesforce accepted the transaction, but FCOS could not confirm the mapping.', 502, 'HEDGE_PHYSICAL_SALESFORCE_CONFIRMATION_FAILED');
      const historyRow = { ...item.row, physicalTradeId: preview.physicalTradeId, generation: item.generation, allocationKey: item.key, salesforceRecordId: recordId, state: 'added' };
      await writeHistory(client, profile, historyRow, item.rowAction, { reasonProvided: Boolean(reason), previousRecordId: item.row.salesforceRecordId || null });
      results.push({ venue: item.row.venue, action: item.rowAction, recordId, salesforceCost: item.row.salesforceCost });
    }
    const response = { success: true, physicalTradeId: preview.physicalTradeId, results, salesforceWritePerformed: true };
    const finalized = await client.from('hedge_integration_operations').update({ status: 'succeeded', response, error: null }).eq('id', operation.id);
    if (finalized.error) throw hedgeSalesforceFailure('Salesforce accepted the transaction, but FCOS could not finalize its operation record.', 502, 'HEDGE_PHYSICAL_SALESFORCE_CONFIRMATION_FAILED');
    await expireRuntimeCacheTags(['salesforce:stem', ...preview.venues.map((row) => `salesforce:stem:${row.salesforceStemId}`), 'salesforce:dashboard', 'salesforce:documents']);
    return response;
  } catch (error) {
    const uncertain = salesforceAccepted || /timeout|network|fetch failed/i.test(String(error?.message || ''));
    await client.from('hedge_integration_operations').update({ status: uncertain ? 'uncertain' : 'failed', error: String(error?.code || error?.message || 'Salesforce failure').slice(0, 500) }).eq('id', operation.id);
    throw error;
  }
}

export function physicalSalesforceRecordUrl(recordId) {
  if (!SALESFORCE_ID.test(String(recordId || ''))) return null;
  return `${getInstanceUrl()}/lightning/r/STEM_Extra_Cost__c/${recordId}/view`;
}

export function physicalSalesforceStateIsActionable(state) {
  return ACTIONABLE_STATES.has(state);
}
