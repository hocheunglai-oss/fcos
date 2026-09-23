import { randomUUID } from 'node:crypto';

export const PETROLEUM_MAPPING_POLICY = 'petroleum-products-v1';
export const PETROLEUM_PRODUCT_QUERY = 'SELECT Id, Name, RecordType.DeveloperName FROM Product2 ORDER BY Id';
const RULES = Object.freeze([
  { direction: 'buyer', code: '41100', type: 'REVENUE' },
  { direction: 'supplier', code: '51100', type: 'DIRECTCOSTS' },
]);

function policyError(message, code = 'XERO_PETROLEUM_MAPPING_INVALID', status = 409) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

// Classification is authoritative Salesforce metadata, never a product-name guess.
// Inactive products remain in scope because historical invoices still use them.
export function petroleumMappingPlan(products, accounts, taxRates, mappings) {
  const petroleum = products.filter((row) => row.RecordType?.DeveloperName === 'Petroleum_Product');
  if (!petroleum.length) return { productCount: 0, approvedCount: 0, changes: [] };
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
  const byKey = new Map(mappings.map((row) => [`${row.direction}:${row.salesforce_product_id}`, row]));
  const seen = new Set();
  const changes = [];
  for (const product of petroleum) {
    if (!/^01t[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(product.Id || '') || !product.Name || seen.has(product.Id)) {
      throw policyError('Salesforce petroleum product evidence is incomplete or duplicated.');
    }
    seen.add(product.Id);
    for (const rule of targets) {
      const before = byKey.get(`${rule.direction}:${product.Id}`) || null;
      const after = {
        direction: rule.direction, salesforce_product_id: product.Id, salesforce_product_name: product.Name,
        xero_account_code: rule.code, xero_account_name: rule.name, xero_tax_type: 'NONE', enabled: true,
      };
      if (!before || Object.entries(after).some(([key, value]) => before[key] !== value)) changes.push({ before, after });
    }
  }
  return { productCount: petroleum.length, approvedCount: petroleum.length * targets.length, changes };
}

// Use the existing service-only revision-checked save RPC. A durable intent audit
// precedes every write; completion/failure records make partial runs traceable and
// safe to resume. Repeated checks do not change already compliant approvals.
export async function approvePetroleumMappings({ products, accounts, taxRates, mappings, client, actor }) {
  const plan = petroleumMappingPlan(products, accounts, taxRates, mappings);
  const summary = { id: PETROLEUM_MAPPING_POLICY, productCount: plan.productCount, approvedCount: plan.approvedCount, changedCount: 0 };
  if (!plan.changes.length) return summary;
  if (!actor?.id || !actor?.email) throw policyError('A signed-in Finance mapping manager is required.', 'XERO_PETROLEUM_MAPPING_ACTOR_REQUIRED', 403);
  const operationId = randomUUID();
  const audit = async (outcome, errorCode = null) => {
    const { error } = await client.from('xero_financial_audit_events').insert({
      event_type: 'petroleum_product_mappings_auto_approved', outcome,
      actor_id: actor.id, actor_email: actor.email,
      record_counts: { planned: plan.changes.length, completed: summary.changedCount, products: plan.productCount },
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
