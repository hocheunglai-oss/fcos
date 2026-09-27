import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildFinancialClassifications, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';

// Stateful storage fake applies the actual query filters and injects failures at
// persistence boundaries, rather than reconstructing the publication algorithm.
export function storage({ failAt, race } = {}) {
  const tables = {}; const calls = []; let itemChunks = 0;
  const client = { from(table) {
    let operation = 'select'; let values; let single = false; let order; let limit = Infinity; let start = 0; let end = Infinity;
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, list) { filters.push(row => list.includes(row[key])); return query; },
      not(key, operator, value) {
        if (operator === 'in') filters.push(row => !value.slice(1, -1).split(',').includes(row[key]));
        else if (key === 'control_totals->workflowSnapshot') filters.push(row => row.control_totals?.workflowSnapshot != null);
        else throw new Error(`Unexpected filter ${key}:${operator}`);
        return query;
      },
      order(key, options = {}) { order = { key, ascending: options.ascending !== false }; return query; },
      limit(value) { limit = value; return query; },
      range(a, b) { start = a; end = b; return query; },
      maybeSingle() { single = true; return query; },
      insert(next) { operation = 'insert'; values = next; return query; },
      update(next) { operation = 'update'; values = next; return query; },
      upsert(next) { operation = 'upsert'; values = next; return query; },
      then(resolve, reject) {
        try {
          const stage = table === 'xero_financial_sync_items' && operation === 'insert' ? `items:${++itemChunks}`
            : table === 'xero_financial_sync_runs' && operation === 'update' ? values.status ? 'publish' : 'snapshot'
              : table === 'xero_financial_audit_events' && operation === 'insert' ? 'audit' : `${table}:${operation}`;
          calls.push({ table, operation, stage, values: structuredClone(values) });
          if (stage === 'publish' && race) Object.assign(tables.xero_financial_sync_runs[0], race);
          if (stage === failAt) return Promise.resolve({ data: null, error: { message: `Injected ${stage} failure` } }).then(resolve, reject);
          let matches = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
          if (order) matches.sort((a, b) => String(a[order.key]).localeCompare(String(b[order.key])) * (order.ascending ? 1 : -1));
          matches = matches.slice(start, Math.min(end + 1, limit));
          if (operation === 'insert' || operation === 'upsert') {
            matches = structuredClone(Array.isArray(values) ? values : [values]);
            (tables[table] ||= []).push(...matches);
          }
          if (operation === 'update') matches.forEach(row => Object.assign(row, structuredClone(values)));
          return Promise.resolve({ data: structuredClone(single ? matches[0] || null : matches), error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  } };
  return { client, tables, calls };
}

export function fixture(options = {}) {
  const store = storage(options);
  const salesforce = { buyers: Array.from({ length: options.count ?? 205 }, (_, i) => ({
    Id: `invoice-${i}`, Name: `INV-${i}`, CurrencyIsoCode: 'USD', Amount__c: 100,
    Invoice_Date__c: '2026-09-01', Invoice_Due_Date__c: '2026-09-30',
    STEM__c: `stem-${i}`, STEM__r: { Name: `STEM-${i}` },
  })), suppliers: [], lines: [], extras: [], products: [], productRecords: [], fingerprintBasis: ['source'] };
  const xero = { documents: [], inactiveDocuments: [], contacts: [], organisation: { baseCurrency: 'USD' },
    paymentReadSnapshot: {}, fingerprintBasis: ['xero'], callCount: 2 };
  if (options.exact) {
    const buyer = salesforce.buyers[0];
    Object.assign(buyer, { File__c: '069000000000001AAA', Proforma__c: false, Deprecated__c: false });
    Object.assign(buyer.STEM__r, { Account__c: 'buyer', Account__r: { Name: 'Buyer' } });
    salesforce.lines.push({ Id: 'line', Buyer_Invoice__c: buyer.Id, Product__c: 'product', Product__r: { Name: 'Fuel' },
      Quantity__c: 1, Price_Per_Unit__c: 100, Total_Price__c: 100 });
    xero.contacts.push({ id: 'contact', name: 'Buyer', status: 'ACTIVE' });
    const productMappings = [{ id: 'mapping', enabled: true, direction: 'buyer', salesforce_product_id: 'product',
      xero_account_code: '200', xero_tax_type: 'NONE' }];
    store.tables.xero_financial_product_mappings = productMappings;
    const [source] = buildFinancialClassifications(salesforce, xero, { productMappings, documentMappings: [] }).rows;
    assert.equal(source.status, 'eligible');
    xero.documents.push(normalizeXeroInvoice({ ...source.proposedPayload, InvoiceID: randomUUID(), Total: 100, AmountDue: 100, AmountPaid: 0 }));
    assert.equal(buildFinancialClassifications(salesforce, xero, { productMappings, documentMappings: [] }).rows[0].action, 'link');
  }
  const paymentSnapshot = { rows: [], summary: { total: 0 }, tenantId: options.tenantId || '00000000-0000-4000-8000-000000000001' };
  const dependencies = { client: store.client, env: {},
    getConnection: async () => ({ tenantId: options.tenantId || '00000000-0000-4000-8000-000000000001', scope: 'accounting.invoices accounting.contacts accounting.settings.read' }),
    loadSafetyContext: async () => ({}), loadSalesforce: async () => salesforce,
    loadPayments: async () => [], loadXero: async () => xero,
    querySalesforce: async () => { throw new Error('Buyer-only fixture must not query supplier files'); },
    accountingFetch: async (_connection, path) => ({ [path.slice(1)]: [] }),
    paymentPreview: async () => {
      if (options.failAt === 'payments') throw new Error('Injected payments failure');
      return paymentSnapshot;
    },
  };
  return { ...store, dependencies, paymentSnapshot, salesforce, xero };
}

