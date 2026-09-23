import { randomUUID } from 'node:crypto';

export const PETROLEUM_MAPPING_POLICY = 'petroleum-and-invoice-extras-v2';
export const PETROLEUM_PRODUCT_QUERY = 'SELECT Id, Name, RecordType.DeveloperName FROM Product2 ORDER BY Id';
const RULES = Object.freeze([
  { direction: 'buyer', code: '41100', type: 'REVENUE' },
  { direction: 'supplier', code: '51100', type: 'DIRECTCOSTS' },
]);

function policyError(message, code = 'XERO_PETROLEUM_MAPPING_INVALID', status = 409) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

const salesforceProductId = /^01t[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/;

// Petroleum uses its Salesforce record type. Invoice extras use only Product2
// relationships on the selected STEM_Extra_Cost__c snapshot rows.
export function petroleumMappingPlan(products, accounts, taxRates, mappings, { extras, extraProducts } = {}) {
  if (!Array.isArray(products) || !Array.isArray(mappings) || !Array.isArray(accounts) || !Array.isArray(taxRates)) {
    throw policyError('Product mapping evidence is incomplete.');
  }
  if (extras !== undefined && extraProducts !== undefined) throw policyError('Supply one source of invoice extra relationships.');
  const extraRows = extras ?? extraProducts ?? [];
  if (!Array.isArray(extraRows)) throw policyError('Invoice extra relationship evidence is incomplete.');
  const productById = new Map();
  for (const product of products) {
    if (!salesforceProductId.test(product?.Id || '') || !product.Name || productById.has(product.Id)) {
      throw policyError('Salesforce product evidence is incomplete or duplicated.');
    }
    productById.set(product.Id, product);
  }
  const petroleumIds = new Set(products.filter((row) => row.RecordType?.DeveloperName === 'Petroleum_Product').map((row) => row.Id));
  const extraIds = new Set();
  const seenExtras = new Set();
  for (const extra of extraRows) {
    if (!extra || typeof extra !== 'object' || !extra.Id || seenExtras.has(extra.Id)) {
      throw policyError('Salesforce invoice extra evidence is incomplete or duplicated.');
    }
    seenExtras.add(extra.Id);
    // Rows without a selected Product2 relationship cannot receive a mapping;
    // document classification reports those rows for Finance review.
    if (extra.Product2Id__c == null || extra.Product2Id__c === '') continue;
    if (!salesforceProductId.test(extra.Product2Id__c) || !productById.has(extra.Product2Id__c)
      || (extra.Product2Id__r?.Name && extra.Product2Id__r.Name !== productById.get(extra.Product2Id__c).Name)) {
      throw policyError('Salesforce invoice extra Product2 relationship evidence is incomplete or inconsistent.');
    }
    extraIds.add(extra.Product2Id__c);
  }
  const selected = products.filter((row) => petroleumIds.has(row.Id) || extraIds.has(row.Id));
  const empty = { productCount: petroleumIds.size, extraProductCount: extraIds.size,
    eligibleProductCount: selected.length, approvedCount: 0, preservedCount: 0,
    preservedOverrideCount: 0, defaultCount: 0, changes: [] };
  if (!selected.length) return empty;
  const tax = taxRates.filter((row) => row.TaxType === 'NONE' && row.Status === 'ACTIVE');
  if (tax.length !== 1 || tax[0].DisplayTaxRate == null || tax[0].EffectiveRate == null || Number(tax[0].DisplayTaxRate) !== 0 || Number(tax[0].EffectiveRate) !== 0
    || tax[0].CanApplyToRevenue !== true || tax[0].CanApplyToExpenses !== true) {
    throw policyError('Petroleum mappings require an active, zero-rate NONE tax type for sales and purchases.');
  }
  const targets = RULES.map((rule) => {
    const matches = accounts.filter((row) => row.Code === rule.code && row.Status === 'ACTIVE');
    if (matches.length !== 1 || matches[0].Type !== rule.type || !matches[0].Name) {
      throw policyError(`Petroleum ${rule.direction} mappings require active Xero account ${rule.code} (${rule.type}).`);
    }
    return { ...rule, name: matches[0].Name };
  });
  const byKey = new Map();
  for (const row of mappings) {
    const key = `${row?.direction}:${row?.salesforce_product_id}`;
    if (byKey.has(key)) throw policyError('Existing Xero product mappings are duplicated.');
    byKey.set(key, row);
  }
  const changes = [];
  let approvedCount = 0;
  let preservedCount = 0;
  let preservedOverrideCount = 0;
  for (const product of selected) {
    for (const rule of targets) {
      const before = byKey.get(`${rule.direction}:${product.Id}`) || null;
      const after = {
        direction: rule.direction, salesforce_product_id: product.Id, salesforce_product_name: product.Name,
        xero_account_code: rule.code, xero_account_name: rule.name, xero_tax_type: 'NONE', enabled: true,
      };
      if (before) {
        preservedCount += 1;
        if (Object.entries(after).some(([key, value]) => before[key] !== value)) preservedOverrideCount += 1;
        if (before.enabled === true) approvedCount += 1;
      } else {
        changes.push({ before: null, after });
        approvedCount += 1;
      }
    }
  }
  return { ...empty, approvedCount, preservedCount, preservedOverrideCount,
    defaultCount: changes.length, changes };
}

// Use the existing service-only revision-checked save RPC. A durable intent audit
// precedes every write; completion/failure records make partial runs traceable and
// safe to resume. Repeated checks do not change already compliant approvals.
export async function approvePetroleumMappings({ products, accounts, taxRates, mappings, extras, extraProducts, client, actor }) {
  const plan = petroleumMappingPlan(products, accounts, taxRates, mappings, { extras, extraProducts });
  const summary = { id: PETROLEUM_MAPPING_POLICY, productCount: plan.productCount,
    extraProductCount: plan.extraProductCount, eligibleProductCount: plan.eligibleProductCount,
    approvedCount: plan.approvedCount, preservedCount: plan.preservedCount,
    preservedOverrideCount: plan.preservedOverrideCount, defaultCount: plan.defaultCount, changedCount: 0 };
  if (!plan.changes.length) return summary;
  if (!actor?.id || !actor?.email) throw policyError('A signed-in Finance mapping manager is required.', 'XERO_PETROLEUM_MAPPING_ACTOR_REQUIRED', 403);
  const operationId = randomUUID();
  const audit = async (outcome, errorCode = null) => {
    const { error } = await client.from('xero_financial_audit_events').insert({
      event_type: 'petroleum_product_mappings_auto_approved', outcome,
      actor_id: actor.id, actor_email: actor.email,
      record_counts: { planned: plan.changes.length, completed: summary.changedCount,
        products: plan.productCount, extraProducts: plan.extraProductCount,
        preserved: plan.preservedCount, preservedOverrides: plan.preservedOverrideCount },
      fingerprints: { policy: PETROLEUM_MAPPING_POLICY, operationId, ...(outcome === 'started' ? {
        changes: plan.changes.map(({ before, after }) => ({
          before: before ? { id: before.id, revision: before.revision, accountCode: before.xero_account_code, taxType: before.xero_tax_type, enabled: before.enabled } : null,
          after,
        })),
      } : {}) }, error_code: errorCode,
    });
    if (error) throw policyError('Petroleum mapping audit could not be saved.', 'XERO_FINANCIAL_STORAGE_FAILED', 500);
  };
  await audit('started');
  try {
    for (const { before, after } of plan.changes) {
      const { error } = await client.rpc('save_xero_financial_product_mapping_v1', {
        p_mapping_id: before?.id || null, p_expected_revision: before?.revision ?? null,
        p_direction: after.direction, p_salesforce_product_id: after.salesforce_product_id,
        p_salesforce_product_name: after.salesforce_product_name, p_xero_account_code: after.xero_account_code,
        p_xero_account_name: after.xero_account_name, p_xero_tax_type: after.xero_tax_type, p_enabled: true,
        p_actor_id: actor.id, p_actor_email: actor.email,
      });
      if (error) throw policyError(error.code === '40001'
        ? 'A petroleum mapping changed during approval. Run the check again.' : 'Automatic petroleum mapping approval could not be saved.',
      error.code === '40001' ? 'XERO_FINANCIAL_STALE_WRITE' : 'XERO_FINANCIAL_STORAGE_FAILED', error.code === '40001' ? 409 : 500);
      summary.changedCount += 1;
    }
    await audit('success');
    return summary;
  } catch (error) {
    await audit('failed', error.code).catch(() => {}); // The started event remains durable if storage is unavailable.
    throw error;
  }
}
