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
