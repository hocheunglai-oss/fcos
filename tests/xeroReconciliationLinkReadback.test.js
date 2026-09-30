import assert from 'node:assert/strict';
import test from 'node:test';
import { readCampaignDocumentLinkReadback } from '../api/_xeroReconciliationLinkReadback.js';
import { bindXeroSharedControl, forecastXeroBudget, runWithXeroBudget, xeroControlError } from '../api/_xeroSharedControl.js';
import { xeroAccountingFetch } from '../api/_xeroContactSync.js';
import { fixtureSharedControl } from './helpers/xeroSharedControl.js';

const connection = { tenantId: 'tenant-one' };
const invoice = (id) => ({ InvoiceID: id, Type: 'ACCREC', Status: 'AUTHORISED',
  Contact: { ContactID: 'contact-one' }, CurrencyCode: 'USD', Total: '100.0000', AmountPaid: '20.00',
  AmountDue: '70.00', AmountCredited: '10.00', Payments: [{ PaymentID: 'payment-one', Amount: '20.00' }],
  CreditNotes: [{ CreditNoteID: 'credit-one', Total: '10.00' }],
  LineItems: [{ LineItemID: 'line-one', Quantity: '3.0000', UnitAmount: '33.3333', Description: 'Fuel' }],
  UpdatedDateUTC: '2026-09-30T00:00:00Z', UnknownProviderEvidence: { marker: 'preserve' } });
const credit = (id) => ({ CreditNoteID: id, Type: 'ACCRECCREDIT', Status: 'AUTHORISED',
  Contact: { ContactID: 'contact-one' }, CurrencyCode: 'USD', Total: '100', AmountPaid: '0',
  RemainingCredit: '70', Allocations: [{ Amount: '30', Invoice: { InvoiceID: 'invoice-allocated' } }],
  LineItems: [{ Quantity: 1, UnitAmount: 100, Description: 'Credit' }] });
const target = (targetId, collection = 'Invoices') => ({ targetId, collection });

function fixture(respond) {
  const calls = [];
  const scopes = [];
  const args = { connection, budgetId: 'budget-one', env: { XERO_TRANSIENT_RETRY_LIMIT: '2', fixtureOnly: 'retained' },
    targets: [],
    withBudget: async (currentConnection, scope, work) => {
      assert.strictEqual(currentConnection, connection);
      scopes.push(scope);
      return work();
    },
    accountingFetch: async (currentConnection, path, options) => {
      assert.strictEqual(currentConnection, connection);
      calls.push({ path, options });
      if (respond) return respond(path, options);
      if (path.startsWith('/Invoices?IDs=')) {
        return { Invoices: new URLSearchParams(path.split('?')[1]).get('IDs').split(',').reverse().map(invoice) };
      }
      return { CreditNotes: [credit(decodeURIComponent(path.split('/')[2].split('?')[0]))] };
    } };
  return { args, calls, scopes };
}

test('25 invoices use one exact verification GET and retain all raw settlement and line evidence', async () => {
  const ids = Array.from({ length: 25 }, (_, index) => `invoice-${index}`);
  const rawRows = ids.map(invoice);
  const f = fixture(() => ({ Invoices: [...rawRows].reverse() }));
  const result = await readCampaignDocumentLinkReadback({ ...f.args, targets: ids.map((id) => target(id.toUpperCase())) });
  assert.equal(result.callCount, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, `/Invoices?IDs=${encodeURIComponent(ids.join(','))}&summaryOnly=false&unitdp=4`);
  assert.deepEqual(f.scopes, [{ budgetId: 'budget-one', budgetPhase: 'verification' }]);
  assert.deepEqual(result.missingTargetIds, { invoices: [], creditNotes: [] });
  assert.deepEqual(result.rawTargets.invoices, rawRows);
  for (let index = 0; index < ids.length; index += 1) assert.strictEqual(result.rawTargets.invoices[index], rawRows[index]);
  assert.equal(result.rawTargets.invoices[0].Total, '100.0000');
  assert.deepEqual(result.rawTargets.invoices[0].UnknownProviderEvidence, { marker: 'preserve' });
  const options = f.calls[0].options;
  assert.equal(options.method, 'GET');
  assert.equal(options.budgetId, 'budget-one');
  assert.equal(options.budgetPhase, 'verification');
  assert.equal(options.retryOnRateLimit, false);
  assert.equal(options.env.XERO_TRANSIENT_RETRY_LIMIT, '0');
  assert.equal(options.env.fixtureOnly, 'retained');
  assert.equal(f.args.env.XERO_TRANSIENT_RETRY_LIMIT, '2');
});

test('mixed collections resolve unordered invoice IDs and use individual credit note routes', async () => {
  const f = fixture();
  const result = await readCampaignDocumentLinkReadback({ ...f.args,
    targets: [target('invoice-b'), target('credit-b', 'CreditNotes'), target('invoice-a'), target('credit-a', 'CreditNotes')] });
  assert.equal(result.callCount, 3);
  assert.equal(f.scopes.length, 3);
  assert.deepEqual(result.rawTargets.invoices.map((row) => row.InvoiceID), ['invoice-b', 'invoice-a']);
  assert.deepEqual(result.rawTargets.creditNotes.map((row) => row.CreditNoteID), ['credit-b', 'credit-a']);
  assert.deepEqual(f.calls.map((row) => row.path), [
    '/Invoices?IDs=invoice-b%2Cinvoice-a&summaryOnly=false&unitdp=4',
    '/CreditNotes/credit-b?unitdp=4', '/CreditNotes/credit-a?unitdp=4',
  ]);
  assert.ok(f.calls.every((row) => row.options.method === 'GET'));
});

test('partial exact invoice response, empty credit response and 404 explicitly mark requested targets missing', async () => {
  const f = fixture((path) => {
    if (path.startsWith('/Invoices')) return { Invoices: [invoice('invoice-found')] };
    if (path.includes('credit-empty')) return { CreditNotes: [] };
    if (path.includes('credit-missing')) throw Object.assign(new Error('missing'), { status: 404 });
    return { CreditNotes: [credit('credit-found')] };
  });
  const result = await readCampaignDocumentLinkReadback({ ...f.args, targets: [target('invoice-missing'), target('invoice-found'),
    target('credit-empty', 'CreditNotes'), target('credit-missing', 'CreditNotes'), target('credit-found', 'CreditNotes')] });
  assert.equal(result.callCount, 4);
  assert.deepEqual(result.missingTargetIds, { invoices: ['invoice-missing'], creditNotes: ['credit-empty', 'credit-missing'] });
  assert.deepEqual(result.rawTargets.invoices.map((row) => row.InvoiceID), ['invoice-found']);
  assert.deepEqual(result.rawTargets.creditNotes.map((row) => row.CreditNoteID), ['credit-found']);
  const invoice404 = fixture(() => { throw Object.assign(new Error('missing'), { status: 404 }); });
  const allMissing = await readCampaignDocumentLinkReadback({ ...invoice404.args, targets: [target('one'), target('two')] });
  assert.deepEqual(allMissing.missingTargetIds.invoices, ['one', 'two']);
  assert.equal(allMissing.callCount, 1);
});

test('unrelated, duplicate, malformed and incomplete invoice and credit responses reject the whole read', async () => {
  for (const collection of ['Invoices', 'CreditNotes']) {
    const make = collection === 'Invoices' ? invoice : credit;
    for (const response of [null, {}, { [collection]: null }, { [collection]: {} },
      { [collection]: [make('other')] }, { [collection]: [make('requested'), make('REQUESTED')] },
      { [collection]: [{}] }, { [collection]: [null] }, { [collection]: [1] },
      { [collection]: [{ ...make('requested'), LineItems: null }] },
      { [collection]: [{ ...make('requested'), LineItems: [null] }] },
      { [collection]: [{ ...make('requested'), Payments: {} }] },
      { [collection]: [{ ...make('requested'), Allocations: {} }] },
      { [collection]: [{ ...make('requested'), AmountPaid: null }] },
      { [collection]: [{ ...make('requested'), Total: NaN }] },
      { [collection]: [{ [collection === 'Invoices' ? 'InvoiceID' : 'CreditNoteID']: 'requested', LineItems: [] }] }]) {
      const f = fixture(() => response);
      await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, targets: [target('requested', collection)] }),
        { code: 'XERO_CAMPAIGN_LINK_READBACK_INCOMPLETE' });
    }
  }
});

test('validation errors and conflicting pagination cannot masquerade as exact evidence', async () => {
  for (const response of [
    { Invoices: [invoice('one')], HasErrors: true },
    { Invoices: [invoice('one')], ValidationErrors: [{ Message: 'bad' }] },
    { Invoices: [{ ...invoice('one'), HasValidationErrors: true }] },
    { Invoices: [{ ...invoice('one'), ValidationErrors: [{ Message: 'bad' }] }] },
    { Invoices: [invoice('one')], Pagination: { page: 1, pageSize: 100, pageCount: 2 } },
    { Invoices: [invoice('one')], Pagination: { page: 2, pageSize: 100, pageCount: 2 } },
    { Invoices: [invoice('one')], Pagination: { page: 1, pageSize: 1, pageCount: 1 } },
    { Invoices: [invoice('one')], Pagination: { page: 1, pageSize: 100, pageCount: 1, itemCount: 2 } },
  ]) {
    const f = fixture(() => response);
    await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, targets: [target('one'), target('two')] }),
      { code: 'XERO_CAMPAIGN_LINK_READBACK_INCOMPLETE' });
  }
  const f = fixture(() => ({ Invoices: [invoice('ONE')], Pagination: { page: 1, pageSize: 100, pageCount: 1, itemCount: 1 } }));
  const result = await readCampaignDocumentLinkReadback({ ...f.args, targets: [target('one')] });
  assert.equal(result.rawTargets.invoices[0].InvoiceID, 'ONE');
});

test('empty selection makes no calls and invalid, overlapping or over-bound targets fail before reading', async () => {
  const f = fixture();
  assert.deepEqual(await readCampaignDocumentLinkReadback(f.args), {
    rawTargets: { invoices: [], creditNotes: [] }, missingTargetIds: { invoices: [], creditNotes: [] }, callCount: 0,
  });
  for (const targets of [null, [target('')], [target(123)], [target(' id')], [target('one,two')],
    [target('one', 'Payments')], [target('one'), target('ONE')],
    [target('one'), target('ONE', 'CreditNotes')], Array.from({ length: 26 }, (_, i) => target(`id-${i}`))]) {
    await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, targets }), { code: 'XERO_CAMPAIGN_LINK_READBACK_INCOMPLETE' });
  }
  await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, connection: {} }), { code: 'XERO_CAMPAIGN_LINK_READBACK_INCOMPLETE' });
  await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, budgetId: null }), { code: 'XERO_CAMPAIGN_LINK_READBACK_INCOMPLETE' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.scopes.length, 0);
});

test('25 credit note reads run with at most two concurrent requests and charge every GET', async () => {
  let active = 0;
  let peak = 0;
  const f = fixture(async (path) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return { CreditNotes: [credit(path.split('/')[2].split('?')[0])] };
  });
  const ids = Array.from({ length: 25 }, (_, i) => `credit-${i}`);
  const result = await readCampaignDocumentLinkReadback({ ...f.args, targets: ids.map((id) => target(id, 'CreditNotes')) });
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(result.callCount, 25);
  assert.equal(f.scopes.length, 25);
  assert.deepEqual(result.rawTargets.creditNotes.map((row) => row.CreditNoteID), ids);
  assert.ok(f.calls.every((row) => /^\/CreditNotes\/credit-\d+\?unitdp=4$/.test(row.path)));
});

test('provider failure stops scheduling remaining reads and drains the in-flight worker before rejection', async () => {
  let finishSecond;
  let secondFinished = false;
  const firstError = Object.assign(new Error('provider failed'), { status: 503 });
  const f = fixture(async (path) => {
    if (path.includes('credit-0?')) throw firstError;
    await new Promise((resolve) => { finishSecond = resolve; });
    secondFinished = true;
    return { CreditNotes: [credit('credit-1')] };
  });
  let settled = false;
  const promise = readCampaignDocumentLinkReadback({ ...f.args, targets: Array.from({ length: 25 }, (_, i) => target(`credit-${i}`, 'CreditNotes')) })
    .finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
  assert.equal(settled, false);
  finishSecond();
  await assert.rejects(promise, (error) => error === firstError);
  assert.equal(secondFinished, true);
  assert.equal(f.calls.length, 2);
});

test('quota, renewal, transport and 429 failures are propagated without conversion into missing targets', async () => {
  for (const error of [xeroControlError('XERO_RESERVE_PROTECTED'), xeroControlError('XERO_CONNECTION_REVOKED'),
    Object.assign(new Error('rate limited'), { status: 429 }), new Error('transport failed')]) {
    const f = fixture(() => { throw error; });
    await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, targets: [target('one')] }), (actual) => actual === error);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  const denial = xeroControlError('XERO_RESERVE_PROTECTED');
  await assert.rejects(readCampaignDocumentLinkReadback({ ...f.args, targets: [target('one')],
    withBudget: async () => { throw denial; } }), (actual) => actual === denial);
  assert.equal(f.calls.length, 0);
});

test('real accounting adapter admits every request as verification under the original shared budget', async () => {
  const admissions = [];
  let fetched = 0;
  const protectedBudget = forecastXeroBudget({ operationCalls: 5, verificationCalls: 3 });
  assert.equal(protectedBudget.reserve, 200);
  const control = fixtureSharedControl({ admit: async (request) => {
    admissions.push(request);
    return { requestId: `read-${admissions.length}` };
  } });
  const scopedConnection = bindXeroSharedControl({ tenantId: 'fixture-tenant', tokenVersion: 1 }, control);
  const result = await readCampaignDocumentLinkReadback({ connection: scopedConnection, budgetId: 'shared-budget',
    targets: [target('invoice-one'), target('credit-one', 'CreditNotes'), target('credit-two', 'CreditNotes')],
    accountingFetch: xeroAccountingFetch, withBudget: runWithXeroBudget,
    fetchImpl: async (url, options) => {
      fetched += 1;
      assert.equal(options.method, 'GET');
      const path = new URL(url).pathname;
      return new Response(JSON.stringify(path.endsWith('/Invoices') ? { Invoices: [invoice('invoice-one')] }
        : { CreditNotes: [credit(path.split('/').at(-1))] }), { status: 200 });
    } });
  assert.equal(result.callCount, 3);
  assert.equal(fetched, 3);
  assert.equal(admissions.length, 3);
  assert.ok(admissions.every((request) => request.budgetId === 'shared-budget' && request.budgetPhase === 'verification'
    && request.tenantId === 'fixture-tenant' && request.method === 'GET'));
  control.admit = async () => { throw xeroControlError('XERO_RESERVE_PROTECTED'); };
  await assert.rejects(readCampaignDocumentLinkReadback({ connection: scopedConnection, budgetId: 'shared-budget',
    targets: [target('one')], fetchImpl: async () => { fetched += 1; throw new Error('must not reach provider'); } }),
  { code: 'XERO_RESERVE_PROTECTED' });
  assert.equal(fetched, 3);
});

test('real accounting adapter makes one actual call on 503 despite configured retry allowance', async () => {
  let fetched = 0;
  let admitted = 0;
  const scopedConnection = bindXeroSharedControl({ tenantId: 'fixture-tenant', tokenVersion: 1 }, fixtureSharedControl({
    admit: async () => ({ requestId: `read-${++admitted}` }),
  }));
  await assert.rejects(readCampaignDocumentLinkReadback({ connection: scopedConnection, budgetId: 'shared-budget',
    targets: [target('one')], env: { XERO_TRANSIENT_RETRY_LIMIT: '2' },
    fetchImpl: async () => { fetched += 1; return new Response('unavailable', { status: 503 }); } }),
  { status: 503 });
  assert.equal(fetched, 1);
  assert.equal(admitted, 1);
});
