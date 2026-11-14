import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { nativeHkdPaymentPostingPlan, confirmedPaymentValues, matchPaymentResponses, paymentConfirmationErrors } from '../api/_xeroPaymentIdentity.js';
import { loadPaymentPostingClaims, paymentClaimEvidenceIds, paymentPostingKey, postReviewedPaymentBatch, resolvePaymentPostingClaim, reviewPaymentPostingClaim } from '../api/_xeroPaymentPosting.js';
import { xeroFinancialPaymentApply } from '../api/_xeroFinancialSync.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const bankId = '33333333-3333-4333-8333-333333333333';
const actor = { id: '44444444-4444-4444-8444-444444444444', email: 'finance@example.com' };
function reviewed(index = 1) {
  return { salesforcePaymentId: `a0P00000000000${index}AAA`, salesforcePaymentName: `PAY-${index}`, type: 'Payable',
    currency: 'USD', amount: 125.5, paymentDate: '2026-09-05', amountDue: 500, documentMappingId: '55555555-5555-4555-8555-555555555555',
    sourceFingerprint: `source-${index}`, reviewFingerprint: `review-${index}`, action: 'payment_apply', status: 'eligible', blockers: [], blockerCodes: [],
    proposedPayment: { Invoice: { InvoiceID: invoiceId }, Account: { AccountID: bankId }, Amount: 125.5, Date: '2026-09-05', Reference: `PAY-${index}` } };
}
function confirmed(row) {
  return { PaymentID: `66666666-6666-4666-8666-66666666666${row.salesforcePaymentName.at(-1)}`, Status: 'AUTHORISED',
    PaymentType: row.type === 'Payable' ? 'ACCPAYPAYMENT' : 'ACCRECPAYMENT', Amount: row.proposedPayment.Amount,
    BankAmount: row.proposedPayment.Amount, CurrencyRate: 1, Date: row.proposedPayment.Date, Reference: row.proposedPayment.Reference,
    Invoice: { InvoiceID: row.proposedPayment.Invoice.InvoiceID, Type: row.type === 'Payable' ? 'ACCPAY' : 'ACCREC', CurrencyCode: row.currency },
    Account: { AccountID: row.proposedPayment.Account.AccountID } };
}
function database({ failTable, failOperation } = {}) {
  const tables = { xero_financial_sync_runs: [], xero_financial_payment_mappings: [], xero_financial_audit_events: [] }; const calls = [];
  return { tables, calls, from(table) {
    const filters = []; let values; let operation = 'select'; let single = false;
    const query = { select() { return query; }, eq(key, value) { filters.push((row) => row[key] === value); return query; },
      in(key, list) { filters.push((row) => list.includes(row[key])); return query; }, maybeSingle() { single = true; return query; },
      insert(value) { values = value; operation = 'insert'; return query; }, update(value) { values = value; operation = 'update'; return query; },
      upsert(value) { values = value; operation = 'upsert'; return query; }, then(resolve, reject) {
        calls.push({ table, operation });
        if (table === failTable && operation === failOperation) return Promise.resolve({ error: { code: 'TEST_FAILURE' } }).then(resolve, reject);
        const matches = tables[table].filter((row) => filters.every((filter) => filter(row)));
        if (operation === 'insert') {
          if (table === 'xero_financial_sync_runs' && tables[table].some((row) => row.idempotency_key === values.idempotency_key)) return Promise.resolve({ error: { code: '23505' } }).then(resolve, reject);
          tables[table].push(structuredClone(values));
        } else if (operation === 'update') matches.forEach((row) => Object.assign(row, structuredClone(values)));
        else if (operation === 'upsert') {
          const existing = tables[table].find((row) => row.salesforce_payment_id === values.salesforce_payment_id);
          if (existing) Object.assign(existing, structuredClone(values)); else tables[table].push(structuredClone(values));
        }
        return Promise.resolve({ data: single ? matches[0] || null : matches }).then(resolve, reject);
      } }; return query;
  } };
}
function fixture(rows = [reviewed()], client = database()) {
  const writes = []; const connection = { tenantId: tenant, scope: 'accounting.payments' };
  const accountingFetch = async (_connection, path, options) => {
    if (options.method === 'GET') return { Organisations: [{ BaseCurrency: 'USD' }] };
    writes.push(options); assert.equal(client.tables.xero_financial_audit_events.filter((event) => event.outcome === 'intent').length, options.body.Payments.length);
    return { Payments: options.body.Payments.map((payment) => confirmed(rows.find((row) => row.proposedPayment.Reference === payment.Reference))) };
  };
  return { rows, writes, client, connection, dependencies: { client, connection, actor, accountingFetch } };
}

test('partial payable and receivable payments require complete actual confirmation without copied money', () => {
  for (const type of ['Payable', 'Receivable']) {
    const row = { ...reviewed(), type }; const actual = confirmed(row);
    assert.deepEqual(paymentConfirmationErrors(row, actual), []);
    assert.deepEqual(confirmedPaymentValues(actual), { xero_payment_id: actual.PaymentID, xero_bank_account_id: bankId, amount: 125.5, currency: 'USD', payment_date: '2026-09-05' });
    for (const key of ['PaymentID', 'Status', 'PaymentType', 'Amount', 'BankAmount', 'Date', 'Reference', 'Invoice', 'Account']) {
      const missing = { ...actual }; delete missing[key]; assert.ok(paymentConfirmationErrors(row, missing).length, key);
    }
    for (const changes of [{ Amount: null }, { Amount: '125.5' }, { Amount: NaN }, { Amount: Infinity }, { Amount: -125.5 }, { Amount: 125.51 },
      { BankAmount: 124 }, { CurrencyRate: 0.99 }, { Status: 'DELETED' }, { PaymentType: 'ARCREDITPAYMENT' }, { Reference: 'OTHER' },
      { Date: '2026-02-30' }, { Date: '2026-09-06' }, { PaymentID: 'not-an-id' }, { PaymentID: '00000000-0000-0000-0000-000000000000' },
      { Invoice: { ...actual.Invoice, InvoiceID: actor.id } }, { Invoice: { ...actual.Invoice, CurrencyCode: 'HKD' } },
      { Invoice: { ...actual.Invoice, Type: 'ACCRECCREDIT' } }, { Account: { AccountID: actor.id } },
      { Account: { AccountID: bankId, CurrencyCode: 'HKD' } }, { HasValidationErrors: true }, { ValidationErrors: [{}] }]) {
      assert.ok(paymentConfirmationErrors(row, { ...actual, ...changes }).length, JSON.stringify(changes));
    }
    assert.ok(paymentConfirmationErrors(row, actual, actor.id).length, 'previous confirmed PaymentID cannot change');
  }
});

test('payment result matching ignores array order and rejects duplicate, ambiguous, or incomplete allocations', () => {
  const rows = [reviewed(1), reviewed(2)]; const responses = rows.map(confirmed);
  assert.deepEqual(matchPaymentResponses(rows, [...responses].reverse()).map((item) => item.response.PaymentID), responses.map((item) => item.PaymentID));
  for (const returned of [undefined, {}, [], [responses[0], responses[0]], [responses[0], { ...responses[1], PaymentID: responses[0].PaymentID }]]) {
    assert.ok(matchPaymentResponses(rows, returned).every((item) => item.errors.length));
  }
  assert.ok(matchPaymentResponses([rows[0], rows[0]], [responses[0]]).every((item) => item.errors.length));
  assert.ok(matchPaymentResponses(rows, [{ ...responses[0], Amount: 1 }, { ...responses[1], Invoice: { InvoiceID: invoiceId } }]).every((item) => item.errors.length));
});

test('successful reordered batch maps actual values and records durable intent and outcome', async () => {
  const f = fixture([reviewed(1), reviewed(2)]); const send = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (...args) => { const result = await send(...args); return { Payments: result.Payments.reverse() }; };
  const results = await postReviewedPaymentBatch(f.rows, f.dependencies);
  assert.ok(results.every((row) => row.status === 'applied')); assert.equal(f.writes.length, 1);
  assert.deepEqual(f.client.tables.xero_financial_payment_mappings.map((row) => row.xero_payment_id), f.rows.map((row) => confirmed(row).PaymentID));
  assert.ok(f.client.tables.xero_financial_sync_runs.every((run) => run.status === 'completed' && run.mode === 'payment_apply'));
  assert.deepEqual(f.client.tables.xero_financial_audit_events.map((event) => event.outcome), ['intent', 'intent', 'confirmed', 'confirmed']);
});

test('uncertain response and transport outcomes persist without mapping and cannot replay from a new preview', async () => {
  for (const kind of ['missing-body', 'amount', 'bank', 'currency', 'status', 'validation', 'transport']) {
    const f = fixture();
    f.dependencies.accountingFetch = async () => {
      f.writes.push(kind); if (kind === 'transport') throw new Error('provider details must not be exposed');
      const actual = confirmed(f.rows[0]);
      if (kind === 'missing-body') return {};
      if (kind === 'amount') actual.Amount = 130;
      if (kind === 'bank') actual.Account.AccountID = actor.id;
      if (kind === 'currency') actual.Invoice.CurrencyCode = 'HKD';
      if (kind === 'status') actual.Status = 'DELETED';
      if (kind === 'validation') actual.ValidationErrors = [{ Message: 'Invalid allocation' }];
      return { Payments: [actual] };
    };
    assert.equal((await postReviewedPaymentBatch(f.rows, f.dependencies))[0].status, 'failed');
    assert.equal(f.client.tables.xero_financial_payment_mappings.length, 0);
    const claim = f.client.tables.xero_financial_sync_runs[0];
    assert.equal(claim.status, 'failed'); assert.equal(claim.error_code, 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN');
    const newPreview = { ...f.rows[0], reviewFingerprint: 'new-preview', sourceFingerprint: 'changed-source' };
    assert.equal((await postReviewedPaymentBatch([newPreview], f.dependencies))[0].reviewRequired, true);
    assert.equal(f.writes.length, 1, kind);
  }
});

test('database claim serializes concurrent attempts for the same Salesforce payment', async () => {
  const f = fixture();
  const sameRecord15 = { ...f.rows[0], salesforcePaymentId: f.rows[0].salesforcePaymentId.slice(0, 15) };
  const results = await Promise.all([postReviewedPaymentBatch(f.rows, f.dependencies), postReviewedPaymentBatch([sameRecord15], f.dependencies)]);
  assert.equal(f.writes.length, 1); assert.equal(results.flat().filter((row) => row.status === 'applied').length, 1);
  assert.equal(f.client.tables.xero_financial_sync_runs.length, 1);
  assert.equal((await loadPaymentPostingClaims(f.client, tenant, [sameRecord15.salesforcePaymentId])).size, 1);
  assert.notEqual(paymentPostingKey(tenant, f.rows[0].salesforcePaymentId), paymentPostingKey(tenant, f.rows[0].salesforcePaymentId.toLowerCase()));
});

test('intent, audit, or final mapping failures never permit blind retry', async () => {
  for (const [failTable, failOperation, writes] of [['xero_financial_sync_runs', 'insert', 0], ['xero_financial_audit_events', 'insert', 0], ['xero_financial_payment_mappings', 'upsert', 1]]) {
    const f = fixture([reviewed()], database({ failTable, failOperation }));
    await assert.rejects(postReviewedPaymentBatch(f.rows, f.dependencies), { code: 'XERO_PAYMENT_POSTING_STORAGE_FAILED' });
    assert.equal(f.writes.length, writes);
    if (f.client.tables.xero_financial_sync_runs.length) {
      assert.equal((await postReviewedPaymentBatch(f.rows, f.dependencies))[0].status, 'failed'); assert.equal(f.writes.length, writes);
    }
  }
});

test('fresh complete evidence resolves an uncertain claim only to an exact no-write link', async () => {
  const f = fixture(); f.dependencies.accountingFetch = async () => ({});
  await postReviewedPaymentBatch(f.rows, f.dependencies);
  const claims = await loadPaymentPostingClaims(f.client, tenant, ['a0P000000000001AAA']); const claim = claims.get('a0P000000000001AAA');
  assert.equal(claims.size, 1);
  assert.equal(reviewPaymentPostingClaim(f.rows[0], claim, null).status, 'blocked');
  const actual = confirmed(f.rows[0]); const linked = { ...f.rows[0], action: 'payment_link', proposedPayment: null };
  assert.equal(reviewPaymentPostingClaim(linked, claim, actual).action, 'payment_link');
  assert.equal(reviewPaymentPostingClaim(linked, claim, { ...actual, BankAmount: undefined }).status, 'blocked');
  assert.equal(reviewPaymentPostingClaim({ ...linked, sourceFingerprint: 'changed' }, claim, actual).status, 'blocked');
  claim.control_totals.paymentPosting.confirmedPaymentId = actor.id;
  assert.equal(reviewPaymentPostingClaim(linked, claim, actual).status, 'blocked');
  claim.control_totals.paymentPosting.observedPaymentIds = [actual.PaymentID];
  assert.deepEqual(paymentClaimEvidenceIds(claims), [actual.PaymentID]);
  assert.equal((await loadPaymentPostingClaims(f.client, actor.id, ['a0P000000000001AAA'])).size, 0, 'claims are tenant scoped');
  assert.notEqual(paymentPostingKey(tenant, 'a0P000000000001AAA'), paymentPostingKey(actor.id, 'a0P000000000001AAA'));
  await assert.rejects(resolvePaymentPostingClaim(f.client, claim, actual, actor), { code: 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN' });
  delete claim.control_totals.paymentPosting.confirmedPaymentId;
  await resolvePaymentPostingClaim(f.client, claim, actual, actor);
  assert.equal(claim.status, 'completed'); assert.equal(claim.control_totals.paymentPosting.confirmedPaymentId, actual.PaymentID);
});

test('payment apply rejects stale preview and tenant drift before creating an intent', async () => {
  const f = fixture(); const row = f.rows[0]; const body = { mode: 'apply', reviewed: true,
    selectedPayments: [{ id: row.salesforcePaymentId, sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint }] };
  const deps = { client: f.client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, accessContext: { profile: actor },
    paymentPreview: async () => ({ tenantId: tenant, rows: f.rows }), getConnection: async () => f.connection, accountingFetch: f.dependencies.accountingFetch };
  await assert.rejects(xeroFinancialPaymentApply(body, { ...deps, getConnection: async () => ({ ...f.connection, tenantId: actor.id }) }), { code: 'XERO_PAYMENT_TENANT_CHANGED' });
  await assert.rejects(xeroFinancialPaymentApply({ ...body, selectedPayments: [{ ...body.selectedPayments[0], reviewFingerprint: 'stale' }] }, deps), { code: 'XERO_FINANCIAL_NO_ELIGIBLE_PAYMENTS' });
  assert.equal(f.client.tables.xero_financial_sync_runs.length, 0); assert.equal(f.writes.length, 0);
  assert.equal((await xeroFinancialPaymentApply(body, deps)).outcomes[0].status, 'applied');
  assert.equal((await xeroFinancialPaymentApply(body, deps)).outcomes[0].status, 'failed'); assert.equal(f.writes.length, 1);
});

test('actual financial-run schema enforces immutable cross-request tenant/payment reservation', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const sql = await readFile(new URL('../supabase/migrations/20260829080726_xero_financial_sync.sql', import.meta.url), 'utf8');
  await db.exec(sql.match(/create table if not exists public\.xero_financial_sync_runs \([\s\S]*?\n\);/)[0]);
  const insert = (tenantId) => db.query("insert into xero_financial_sync_runs(idempotency_key,mode,status) values($1,'payment_apply','processing') returning id", [paymentPostingKey(tenantId, 'a0P000000000001AAA')]);
  const results = await Promise.allSettled([insert(tenant), insert(tenant)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, '23505');
  await insert(actor.id); assert.equal((await db.query('select count(*)::int n from xero_financial_sync_runs')).rows[0].n, 2);
});

test('HKD posting is held before claiming intent or calling the provider', async () => {
  const f = fixture([{ ...reviewed(), currency: 'HKD' }]);
  await assert.rejects(postReviewedPaymentBatch(f.rows, f.dependencies), { code: 'XERO_PAYMENT_FX_PERSISTENCE_REQUIRED' });
  assert.deepEqual(f.client.calls, []);
  assert.deepEqual(f.writes, []);
});

test('HKD recovery cannot close an original claim before evidence persistence is available', async () => {
  const row = { ...reviewed(), currency: 'HKD' };
  const client = database();
  const claim = { control_totals: { paymentPosting: { state: 'uncertain', reviewed: row } } };
  await assert.rejects(resolvePaymentPostingClaim(client, claim, confirmed(row), actor), {
    code: 'XERO_PAYMENT_FX_PERSISTENCE_REQUIRED',
  });
  assert.deepEqual(client.calls, []);
  assert.equal(claim.control_totals.paymentPosting.state, 'uncertain');
});

test('verified native HKD recovery uses only the original claim transaction and never closes on lost acknowledgement', async () => {
  const row = { ...reviewed(), currency: 'HKD', xeroDocumentId: invoiceId, bankAccountId: bankId,
    amount: 780, nativeHkdMapping: { bankCurrency: 'USD', expectedBankAmount: 97.5, expectedXeroRate: 8,
      companyFxRevision: 'fixture-rate', currencyEvidence: { documentCurrency: 'HKD', nativeAmount: 780, rateRevision: 'fixture-rate' } } };
  row.proposedPayment.Amount = 780;
  const claimId = '77777777-7777-4777-8777-777777777777';
  const mappingId = '88888888-8888-4888-8888-888888888888';
  const claim = { id: claimId, reviewed_by: actor.id, reviewed_by_email: actor.email,
    idempotency_key: paymentPostingKey(tenant, row.salesforcePaymentId), source_fingerprint: row.sourceFingerprint,
    control_totals: { paymentPosting: { tenantId: tenant, paymentId: row.salesforcePaymentId.slice(0, 15),
      state: 'uncertain', reviewed: row } } };
  const actual = { ...confirmed(row), BankAmount: 97.5, CurrencyRate: 8, Account: { AccountID: bankId, CurrencyCode: 'USD' } };
  const calls = [];
  let response;
  const client = { async rpc(name, args) { calls.push({ name, args }); return response; } };
  for (const bad of [{ ...actual, BankAmount: 98 }, { ...actual, CurrencyRate: 7.9 }, { ...actual, Reference: 'other' }]) {
    await assert.rejects(resolvePaymentPostingClaim(client, claim, bad, actor), { code: 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN' });
  }
  await assert.rejects(resolvePaymentPostingClaim(client, claim, actual, { ...actor, email: 'wrong@example.invalid' }),
    { code: 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN' });
  assert.deepEqual(calls, []);
  await assert.rejects(resolvePaymentPostingClaim(client, claim, actual, actor), { code: 'XERO_PAYMENT_POSTING_STORAGE_FAILED' });
  assert.equal(claim.control_totals.paymentPosting.state, 'uncertain');
  response = { data: { mappingId, reused: true } };
  assert.deepEqual(await resolvePaymentPostingClaim(client, claim, actual, actor), response.data);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].name, 'finish_xero_native_hkd_payment_v1');
  assert.equal(calls[1].args.p_claim_id, claimId);
  assert.deepEqual(calls[1].args.p_confirmation, {
    paymentId: actual.PaymentID, invoiceId, bankAccountId: bankId, currency: 'HKD',
    date: row.paymentDate, amount: 780, bankAmount: 97.5, currencyRate: 8, reference: actual.Reference,
  });
});

test('server-issued native HKD posting confirms the original claim and refuses a duplicate POST', async () => {
  const row = reviewed();
  const source = { Id: row.salesforcePaymentId, Name: row.salesforcePaymentName, RecordType: { DeveloperName: 'Payable' },
    Supplier_Invoice__c: 'a06000000000101AAA', Payment_Currency__c: 'HKD', Payment_HKD_Amount__c: 780,
    Amount__c: 97.5, Date__c: row.paymentDate, Payment_FX_Rate__c: 8, Payment_FX_Revision__c: 'rate',
    Payment_FX_Effective_At__c: '2026-09-05T12:00:00Z', Invoice_Carrying_USD__c: 100, Settlement_FX_USD__c: 2.5,
    Bank_Currency__c: 'USD', Bank_Native_Amount__c: 97.5, Bank_FX_Evidence__c: 'synthetic receipt',
    Payment_Operation_Id__c: '99999999-9999-4999-8999-999999999999', Payment_Request_Fingerprint__c: 'a'.repeat(64) };
  const plan = nativeHkdPaymentPostingPlan(source, { xeroDocumentId: invoiceId, bankAccountId: bankId }, 'USD', 'USD');
  const native = { ...row, ...plan, xeroDocumentId: invoiceId, bankAccountId: bankId };
  const claimId = '77777777-7777-4777-8777-777777777777';
  const mappingId = '88888888-8888-4888-8888-888888888888';
  const trace = [];
  let claimed = false;
  let failClaim = true;
  let failFinish = true;
  const client = { async rpc(name, args) {
    trace.push(name);
    if (name === 'claim_xero_native_hkd_payment_v1') {
      if (failClaim) return {};
      if (claimed) return { data: { alreadyClaimed: true, claim: null } };
      assert.equal(args.p_row, native);
      claimed = true;
      return { data: { alreadyClaimed: false, claim: {
        id: claimId, status: 'processing', reviewed_by: actor.id, reviewed_by_email: actor.email,
        idempotency_key: paymentPostingKey(tenant, native.salesforcePaymentId), source_fingerprint: native.sourceFingerprint,
        control_totals: { paymentPosting: { tenantId: tenant, paymentId: native.salesforcePaymentId.slice(0, 15),
          reviewed: structuredClone(native), state: 'intent' } },
      } } };
    }
    assert.equal(name, 'finish_xero_native_hkd_payment_v1');
    assert.equal(args.p_claim_id, claimId);
    assert.equal(args.p_confirmation.bankAmount, 97.5);
    return failFinish ? {} : { data: { mappingId, reused: false } };
  } };
  const accountingFetch = async (_connection, path, options) => {
    assert.equal(claimed, true);
    trace.push('mock POST');
    assert.equal(path, '/Payments?summarizeErrors=false');
    assert.equal(options.retryOnRateLimit, false);
    assert.deepEqual(options.body, { Payments: [plan.proposedPayment] });
    return { Payments: [{ ...confirmed(native), BankAmount: 97.5, CurrencyRate: 8,
      Account: { AccountID: bankId, CurrencyCode: 'USD' } }] };
  };
  const deps = { client, connection: { tenantId: tenant }, actor, accountingFetch,
    options: { env: { FCOS_ENABLE_XERO_TRADING_FX_WRITES: 'true' } } };
  await assert.rejects(postReviewedPaymentBatch([native], { ...deps, options: { env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' } } }),
    { code: 'EXTERNAL_ACTION_GATE_DISABLED' });
  for (const untrusted of [structuredClone(native), { ...native, salesforcePaymentId: 'a0P000000000002AAA' },
    { ...native, proposedPayment: { ...native.proposedPayment, Reference: 'changed' } }]) {
    await assert.rejects(postReviewedPaymentBatch([untrusted], deps), { code: 'XERO_PAYMENT_FX_PERSISTENCE_REQUIRED' });
  }
  assert.deepEqual(trace, []);
  await assert.rejects(postReviewedPaymentBatch([native], deps), { code: 'XERO_PAYMENT_POSTING_STORAGE_FAILED' });
  assert.deepEqual(trace, ['claim_xero_native_hkd_payment_v1']);
  failClaim = false;
  await assert.rejects(postReviewedPaymentBatch([native], deps), { code: 'XERO_PAYMENT_POSTING_STORAGE_FAILED' });
  assert.equal((await postReviewedPaymentBatch([native], deps))[0].reviewRequired, true);
  assert.equal(trace.filter(event => event === 'mock POST').length, 1);
  failFinish = false;
  claimed = false;
  trace.length = 0;
  assert.equal((await postReviewedPaymentBatch([native], deps))[0].status, 'applied');
  assert.deepEqual(trace, ['claim_xero_native_hkd_payment_v1', 'mock POST', 'finish_xero_native_hkd_payment_v1']);
});
