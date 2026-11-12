import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDashboardBuyerPaymentAnalysis } from '../api/_dashboardBuyerPaymentAnalysisService.js';
const accountId = '001000000000001AAA';
const stemId = 'a00000000000001AAA';
const schemas = {
  STEM__c: ['Id','Account__c','CreatedDate','Delivery_Date__c','Expected_Delivery_Date__c','CurrencyIsoCode','Total_Invoice_Amount__c','QLIK_Receivable_Balance__c'],
  Invoice__c: ['Id','Name','STEM__c','CreatedDate','Amount__c','Invoice_Due_Date__c','CurrencyIsoCode','Proforma__c','Deprecated__c'],
  Payment__c: ['Id','STEM__c','Account__c','Amount__c','Date__c','CurrencyIsoCode','RecordTypeId','Supplier_Invoice__c','Is_Deposit__c','Is_Volume_Discount__c','Commission_Invoice__c'],
};
const describe = async (object) => ({ fields: schemas[object].map((name) => ({ name })) });
const options = { scopedStemIds: [stemId], complete: true, expectedAccounts: { [stemId.slice(0, 15)]: accountId }, stemAccessWhere: 'Id != null', today: '2026-10-05', describe };
test('loader never queries outside the resolved dashboard scope and requests complete invoice history', async () => {
  const queries = [];
  const result = await loadDashboardBuyerPaymentAnalysis({ ...options, query: async (query, limit) => {
    queries.push(query); assert.equal(limit, 20001);
    assert.ok(query.includes(`'${stemId}'`));
    assert.ok(query.includes(`Account__c = '${accountId}'`));
    assert.ok(query.includes('Account__r.Inactive_Suspended__c = false'));
    if (!query.split(' FROM ')[1].startsWith('STEM__c')) assert.ok(query.includes('STEM__c IN (SELECT Id FROM STEM__c'));
    assert.doesNotMatch(query, /Proforma__c =|Deprecated__c =|Date__c >=/);
    const records = query.split(' FROM ')[1].startsWith('STEM__c') ? [{ Id: stemId, Account__c: accountId }] : [];
    return { records, totalSize: records.length };
  } });
  assert.equal(queries.length, 3); assert.equal(result.complete, true); assert.equal(result.timing.queryCount, 3);
});
test('loader fails closed on missing metadata, partial pagination, changed and foreign scope', async () => {
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, complete: false }), /incomplete/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, scopedStemIds: ["x' OR 1=1"] }), /invalid STEM/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, describe: async () => ({ fields: [] }) }), /does not expose/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, query: async () => ({ records: [], totalSize: 4 }) }), /incomplete payment evidence/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, query: async () => ({ records: [], totalSize: 0 }) }), /scope changed/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, query: async (q) => {
    const records = q.split(' FROM ')[1].startsWith('STEM__c') ? [{ Id: stemId, Account__c: accountId }] : q.includes('FROM Invoice__c') ? [{ STEM__c: 'a00000000000002AAA' }] : [];
    return { records, totalSize: records.length };
  } }), /outside/);
});

test('single-currency schema uses verified Organization settings and rejects wrong target or multicurrency', async () => {
  const single = async (object) => ({ fields: schemas[object].filter((name) => name !== 'CurrencyIsoCode').map((name) => ({ name })) });
  const { fcosSalesforceEnvironment } = await import('../config/fcosConnections.js');
  const target = fcosSalesforceEnvironment('production');
  const query = async (q) => {
    assert.doesNotMatch(q, /SELECT .*CurrencyIsoCode/);
    const records = q.includes('FROM Organization') ? [{ Id: target.orgId, IsSandbox: false }] : q.split(' FROM ')[1].startsWith('STEM__c') ? [{ Id: stemId, Account__c: accountId }] : [];
    return { records, totalSize: records.length };
  };
  const input = { ...options, describe: single, query, readOrganization: async () => ({ features: { multiCurrency: false, defaultCurrencyIsoCode: 'USD' } }) };
  const result = await loadDashboardBuyerPaymentAnalysis(input);
  assert.deepEqual(result.currencyBasis, { mode: 'verified_single_currency_organization', currency: 'USD' });
  assert.equal(result.timing.queryCount, 4);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...input, readOrganization: async () => ({ features: { multiCurrency: true, defaultCurrencyIsoCode: 'USD' } }) }), /could not be verified/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...input, query: async () => ({ records: [{ Id: 'foreign', IsSandbox: false }] }) }), /could not be verified/);
});

test('changed account membership withdraws the analysis despite unchanged STEM IDs', async () => {
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, query: async (q) => {
    const records = q.split(' FROM ')[1].startsWith('STEM__c') ? [{ Id: stemId, Account__c: '001000000000002AAA' }] : [];
    return { records, totalSize: records.length };
  } }), /scope changed/);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, expectedAccounts: {} }), /trusted dashboard/);
});

function syntheticScope(count) {
  const scopedStemIds = Array.from({ length: count }, (_, index) => `a0H${String(index + 1).padStart(12, '0')}AAA`);
  return { scopedStemIds, expectedAccounts: Object.fromEntries(scopedStemIds.map((id, index) => [id.slice(0, 15), `001${String(index + 1).padStart(12, '0')}AAA`])) };
}
function queryScope(soql) {
  return [...soql.match(/WHERE (?:Id|STEM__c) IN \(([^)]+)\)/)[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((match) => match[1]);
}
function objectName(soql) { return soql.match(/ FROM ([A-Za-z_]+)/)[1]; }

for (const count of [200, 5000]) {
  test(`${count} STEMs are split by encoded size without dropping scope or removing access guards`, async () => {
    const scope = syntheticScope(count);
    const seen = { STEM__c: [], Invoice__c: [], Payment__c: [] };
    let calls = 0;
    const result = await loadDashboardBuyerPaymentAnalysis({ ...options, ...scope, stemAccessWhere: "Id != null AND Account__r.Name != '香港 & special buyer'", query: async (soql) => {
      calls++;
      assert.ok(Buffer.byteLength(`/query/?q=${encodeURIComponent(soql)}`) <= 12288);
      assert.ok(soql.includes("Account__r.Name != '香港 & special buyer'"));
      assert.ok(soql.includes('Account__r.Inactive_Suspended__c = false'));
      const object = objectName(soql);
      if (object !== 'STEM__c') assert.ok(soql.includes('STEM__c IN (SELECT Id FROM STEM__c'));
      const ids = queryScope(soql);
      assert.ok(ids.length <= 200);
      for (const id of ids) assert.ok(soql.includes(`(Id = '${id}' AND Account__c = '${scope.expectedAccounts[id.slice(0, 15)]}')`));
      seen[object].push(...ids);
      const records = object === 'STEM__c' ? ids.map((Id) => ({ Id, Account__c: scope.expectedAccounts[Id.slice(0, 15)] })) : [];
      return { records, totalSize: records.length };
    } });
    for (const ids of Object.values(seen)) assert.deepEqual(ids, scope.scopedStemIds);
    assert.equal(result.complete, true);
    assert.equal(result.timing.queryCount, calls);
    assert.ok(calls > 3 * Math.ceil(count / 200));
  });
}

test('query sizing includes long object metadata and counts independently sized batches', async () => {
  const scope = syntheticScope(200);
  const references = Array.from({ length: 100 }, (_, index) => ({ name: `Supplier_Invoice_Link_${index}__c`, type: 'reference', referenceTo: ['Supplier_Invoice__c'] }));
  const calls = { STEM__c: 0, Invoice__c: 0, Payment__c: 0 };
  const result = await loadDashboardBuyerPaymentAnalysis({ ...options, ...scope, describe: async (object) => ({ fields: [...schemas[object].map((name) => ({ name })), ...(object === 'Payment__c' ? references : [])] }), query: async (soql) => {
    assert.ok(Buffer.byteLength(`/query/?q=${encodeURIComponent(soql)}`) <= 12288);
    const object = objectName(soql); calls[object]++;
    const records = object === 'STEM__c' ? queryScope(soql).map((Id) => ({ Id, Account__c: scope.expectedAccounts[Id.slice(0, 15)] })) : [];
    return { records, totalSize: records.length };
  } });
  assert.ok(calls.Payment__c > calls.STEM__c);
  assert.equal(result.timing.queryCount, Object.values(calls).reduce((a, b) => a + b, 0));
});

test('an oversized access guard or singleton fails before any evidence or currency query', async () => {
  let metadata = 0; let reads = 0;
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, stemAccessWhere: 'X'.repeat(13000), describe: async () => { metadata++; }, query: async () => { reads++; } }), { code: 'DASHBOARD_PAYMENT_ANALYSIS_SCOPE_TOO_LARGE' });
  assert.equal(metadata, 0); assert.equal(reads, 0);
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, describe: async (object) => ({ fields: [
    ...schemas[object].filter((name) => name !== 'CurrencyIsoCode').map((name) => ({ name })),
    ...(object === 'Payment__c' ? [{ name: 'Supplier_' + 'X'.repeat(13000) + '__c', type: 'reference', referenceTo: ['Supplier_Invoice__c'] }] : []),
  ] }), query: async () => { reads++; }, readOrganization: async () => { reads++; } }), { code: 'DASHBOARD_PAYMENT_ANALYSIS_SCOPE_TOO_LARGE' });
  assert.equal(reads, 0);
});

test('provider failures cannot expose SOQL, record IDs or provider details through the public API', async () => {
  const { publicApiErrorPayload } = await import('../api/_publicApiError.js');
  const single = async (object) => ({ fields: schemas[object].filter((name) => name !== 'CurrencyIsoCode').map((name) => ({ name })) });
  const { fcosSalesforceEnvironment } = await import('../config/fcosConnections.js');
  const target = fcosSalesforceEnvironment('production');
  for (const status of [400, 414, 503]) {
    const providerError = Object.assign(new Error(`GET /query/?q=SELECT Id '${stemId}' SECRET_PRIVATE_DETAIL failed`), { status, expose: true });
    const reject = async () => { throw providerError; };
    const organizationQuery = async () => ({ records: [{ Id: target.orgId, IsSandbox: false }] });
    for (const provider of [
      { query: reject },
      { describe: reject, query: reject },
      { describe: single, query: organizationQuery, readOrganization: reject },
    ]) {
      await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, ...provider }), (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'DASHBOARD_PAYMENT_ANALYSIS_READ_FAILED');
        const payload = JSON.stringify(publicApiErrorPayload(error, error.status, 'test-request'));
        assert.doesNotMatch(payload, /SELECT|query\/|a00000000000001|SECRET_PRIVATE_DETAIL/);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
  }
});

test('malformed and oversized evidence cannot return a partial analysis', async () => {
  for (const result of [null, undefined, {}, { records: null }, { records: [], totalSize: 1 }]) {
    await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, query: async () => result }), { code: 'DASHBOARD_PAYMENT_ANALYSIS_INCOMPLETE' });
  }
  const scope = syntheticScope(200);
  let invoiceBatches = 0;
  await assert.rejects(loadDashboardBuyerPaymentAnalysis({ ...options, ...scope, query: async (soql) => {
    const object = objectName(soql);
    let records = [];
    if (object === 'STEM__c') records = queryScope(soql).map((Id) => ({ Id, Account__c: scope.expectedAccounts[Id.slice(0, 15)] }));
    if (object === 'Invoice__c') { invoiceBatches++; records = Array.from({ length: 11000 }, () => ({ STEM__c: queryScope(soql)[0] })); }
    return { records, totalSize: records.length };
  } }), /complete invoice and payment evidence/);
  assert.equal(invoiceBatches, 2);
});
