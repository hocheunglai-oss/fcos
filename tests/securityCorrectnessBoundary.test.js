import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertStemReadRequest } from '../shared/salesforceReadRequest.js';
import { authorizeSalesforceDocument, headerBearerToken } from '../api/_salesforceDocumentAccess.js';
import { xeroPortalReturnPath, exchangeXeroAuthorizationCode, signXeroOAuthState } from '../api/_xeroPortal.js';

const stem = 'a0H000000000001AAA';
const invoice = 'a0I000000000001AAA';
const attachment = '00P000000000001AAA';
const version = '068000000000001AAA';
const doc = '069000000000001AAA';
const forbidden = (error) => error.status === 403;

test('STEM detail rejects all write shapes before cache or Salesforce execution', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const start = source.indexOf('async function salesforceStemDetailFull(');
  const end = source.indexOf('\nfunction uniquePresentValues', start);
  assert.ok(start > 0 && end > start);
  let cacheCalls = 0;
  const context = vm.createContext({
    assertStemReadRequest,
    cachedSalesforceValue: async () => { cacheCalls++; return { marker: 'read-only' }; },
    salesforceStemDetailUncached: () => { throw new Error('Unexpected loader'); },
  });
  const handler = vm.runInContext(source.slice(start, end) + '\nsalesforceStemDetailFull', context);
  for (const extra of [
    { updates: { Invoice_Due_Date__c: '2099-01-01' } },
    { updates: {} }, { childUpdates: [] },
    { childObject: 'Account', childId: invoice }, { record: { Name: 'changed' } },
  ]) {
    await assert.rejects(() => handler({ stemId: stem, ...extra }), { code: 'STEM_DETAIL_READ_ONLY' });
  }
  assert.equal(cacheCalls, 0);
  await handler({ stemId: stem });
  await handler({ stemId: 'HK2627315T' });
  assert.equal(cacheCalls, 2);
  const uncached = source.slice(source.indexOf('async function salesforceStemDetailUncached('), source.indexOf('async function salesforceStemDetailFull('));
  assert.ok(uncached.indexOf('assertStemReadRequest(body)') < uncached.indexOf('resolveStemId('));
  assert.doesNotMatch(uncached, /method:\s*'PATCH'|childUpdates|body\.updates/);
});

test('STEM detail keeps exact key compatibility but rejects malformed requests', () => {
  for (const stemId of [stem, stem.slice(0, 15), 'HK2627315T', 'LEGACY-1']) assert.doesNotThrow(() => assertStemReadRequest({ stemId }));
  for (const body of [null, [], {}, { stemId: 1 }, { stemId: ' ' }, { stemId: 'a'.repeat(81) }, { stemId: 'bad\nkey' }]) {
    assert.throws(() => assertStemReadRequest(body), { code: 'STEM_DETAIL_READ_ONLY' });
  }
});

test('document authorization accepts only live links to the authorized STEM scope', async () => {
  const loadScope = async (id) => {
    assert.equal(id, stem);
    return { relatedRecords: [{ id: stem }, { id: invoice }] };
  };
  let parent = invoice.slice(0, 15);
  const queries = [];
  const queryRows = async (soql) => {
    queries.push(soql);
    if (soql.includes('FROM Attachment')) return [{ ParentId: parent }];
    if (soql.includes('FROM ContentVersion')) return [{ ContentDocumentId: doc }];
    return [{ LinkedEntityId: parent }];
  };
  assert.equal(await authorizeSalesforceDocument({ stemId: stem, kind: 'attachment', id: attachment }, { loadScope, queryRows }), `/sobjects/Attachment/${attachment}/Body`);
  assert.equal(await authorizeSalesforceDocument({ stemId: stem, kind: 'contentVersion', id: version }, { loadScope, queryRows }), `/sobjects/ContentVersion/${version}/VersionData`);
  assert.ok(queries.some((query) => query.includes('FROM ContentDocumentLink')));
  const linkQuery = queries.find((query) => query.includes('FROM ContentDocumentLink'));
  assert.match(linkQuery, /AND LinkedEntityId IN/);
  assert.match(linkQuery, /LIMIT 1$/);
  assert.ok(linkQuery.includes(invoice));
  parent = 'a0I000000000009AAA';
  for (const [kind, id] of [['attachment', attachment], ['contentVersion', version]]) {
    await assert.rejects(() => authorizeSalesforceDocument({ stemId: stem, kind, id }, { loadScope, queryRows }), forbidden);
  }
});

test('document authorization fails closed on Interoffice denial, missing links and invalid IDs', async () => {
  let queried = false;
  const queryRows = async () => { queried = true; return []; };
  await assert.rejects(() => authorizeSalesforceDocument({ stemId: stem, kind: 'attachment', id: attachment }, {
    loadScope: async () => { throw Object.assign(new Error('Interoffice restricted'), { status: 403 }); }, queryRows,
  }), forbidden);
  assert.equal(queried, false);
  const loadScope = async () => ({ relatedRecords: [{ id: stem }] });
  for (const [kind, id] of [['attachment', attachment], ['contentVersion', version]]) {
    await assert.rejects(() => authorizeSalesforceDocument({ stemId: stem, kind, id }, { loadScope, queryRows }), forbidden);
  }
  for (const request of [{ kind: 'attachment', id: attachment }, { stemId: stem, kind: 'other', id: attachment }, { stemId: stem, kind: 'attachment', id: "' OR Id != ''" }]) {
    await assert.rejects(() => authorizeSalesforceDocument(request, { loadScope, queryRows }), { status: 400 });
  }
});

test('reusable auth is header-only and download dispatch passes live access context', async () => {
  assert.equal(headerBearerToken({ headers: {}, url: '/api/functions/salesforceDocumentDownload?token=secret', query: { token: 'secret' } }), null);
  assert.equal(headerBearerToken({ headers: { authorization: 'Bearer header-secret' } }), 'header-secret');
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  assert.match(source, /salesforceDocumentDownload\(req, res, accessContext\)/);
  assert.match(source, /loadScope: \(stemId\) => loadStemDocumentScope\(\{ stemId \}, accessContext\)/);
  assert.match(source, /downloadUrl: .*stemId=/);
});

test('Xero OAuth accepts only its legitimate workspace return path', async () => {
  for (const value of [undefined, null, '', '/xero-portal']) assert.equal(xeroPortalReturnPath(value), '/xero-portal');
  const invalid = ['//attacker.example', '/\\attacker.example', 'https://attacker.example', '/%2f/attacker.example', '\n/xero-portal', '/xero-portal/../login', '/xero-portal?next=//attacker.example'];
  for (const value of invalid) assert.throws(() => xeroPortalReturnPath(value), { code: 'XERO_PORTAL_INVALID_RETURN_PATH' });
  const env = { XERO_OAUTH_STATE_SECRET: 'test-only' };
  const state = signXeroOAuthState({ returnPath: '//attacker.example' }, env);
  let networkCalls = 0;
  await assert.rejects(() => exchangeXeroAuthorizationCode({ code: 'test', state, env, fetchImpl: async () => { networkCalls++; } }), { code: 'XERO_PORTAL_INVALID_RETURN_PATH' });
  assert.equal(networkCalls, 0);
});
