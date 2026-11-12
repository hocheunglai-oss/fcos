import assert from 'node:assert/strict';
import { test } from 'node:test';
import { xeroPrepaymentApply, xeroPrepaymentContacts, xeroPrepaymentPreview, xeroPrepaymentQueue, xeroPrepaymentReconcile } from '../api/_xeroPrepayments.js';
import { fixture, id } from './fixtures/xeroPrepayment.js';

const tenantId = id(9);
const actorId = id(20);
const stemId = 'a01000000000001AAA';
const sourceId = 'a02000000000001AAA';
const selected = { stemId, sourceId, contactId: id(3), action: 'create' };
const selection = { tenantId, ...selected };
const enabled = { FCOS_ENABLE_XERO_PREPAYMENTS: 'true', FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' };

function setupFixture() {
  const context = fixture();
  Object.assign(context.events[0], { Id: sourceId, STEM__c: stemId, Party__r: { Name: 'Fixture Buyer', Inactive_Suspended__c: false },
    Trade_FX_Side__r: { Currency__c: 'HKD' } });
  Object.assign(context, {
    operations: [], xeroBankTransactions: [], xeroPrepayments: [], xeroInvoices: [], documentMappings: [], invoices: [],
    organisation: { OrganisationID: tenantId, BaseCurrency: 'USD' },
    accounts: [{ AccountID: id(2), Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'HKD', Name: 'Fixture Bank', Code: 'BANK' },
      { AccountID: id(4), Type: 'CURRENTLIABILITY', Status: 'ACTIVE', Name: 'Customer deposits', Code: 'DEPOSIT' }],
    contacts: [{ ContactID: id(3), ContactStatus: 'ACTIVE', Name: 'Fixture Buyer' }],
    bankMappings: [{ id: id(50), enabled: true, salesforce_bank_name: 'DBS', xero_bank_account_id: id(2),
      xero_bank_account_name: 'Fixture Bank', revision: 1 }],
    policies: [{ tenant_id: tenantId, direction: 'Sell', currency: 'HKD', enabled: true, account_id: id(4),
      account_code: 'DEPOSIT', tax_type: 'NONE', revision: 1 }],
    taxes: [{ TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, TaxComponents: [{ Rate: 0 }] }],
    bankDiscovery: { complete: true, rows: [] },
  });
  const state = { calls: [], operation: null, lose: false };
  const ledger = {
    async get() { return state.operation; },
    async claim(input) {
      state.calls.push('claim');
      state.operation = { operation_id: input.operationId, tenant_id: input.tenantId, actor_id: input.actorId, cash_event_id: input.cashEventId,
        source_id: input.sourceId, action: input.action, source_hash: input.sourceHash, review_hash: input.reviewHash,
        request_hash: input.requestHash, request_evidence: input.requestEvidence, status: 'processing' };
      return { claimed: true, operation: state.operation };
    },
    async markSent() {
      state.calls.push('mark');
      state.operation.send_started_at = '2026-11-12T01:00:00Z';
      return { marked: true, operation: state.operation };
    },
    async finish(input) {
      state.calls.push(input.status);
      Object.assign(state.operation, { status: input.status, response_evidence: input.responseEvidence });
      return { operation: state.operation };
    },
    async cancel() {
      state.calls.push('cancel');
      state.operation.status = 'cancelled_before_send';
      return { operation: state.operation };
    },
  };
  const options = {
    accessContext: { profile: { id: actorId } }, env: enabled, client: {},
    getConnection: async () => ({ tenantId, scope: 'accounting.transactions accounting.settings.read accounting.contacts.read' }),
    loadContext: async (stem, request) => {
      assert.equal(stem, stemId);
      assert.deepEqual(Object.fromEntries(Object.keys(selected).map((key) => [key, request[key]])), selected);
      assert.equal(request.proposal, undefined);
      state.calls.push('review');
      return { ...context, operations: state.operation ? [state.operation] : [] };
    },
    ledgerFor: () => ledger,
    transportFor: () => ({
      async prepareSend() { state.calls.push('reserve'); },
      async send() { state.calls.push('send'); },
      async readOutcome() {
        state.calls.push('read');
        if (state.lose) throw new Error('Provider outcome uncertain');
        return { identities: { xeroBankTransactionId: id(6), xeroPrepaymentId: id(5) }, privateProviderEvidence: 'private' };
      },
      async settle() { state.calls.push('settle'); },
    }),
  };
  return { options, state, context };
}

async function approval(f) {
  const review = await xeroPrepaymentPreview(selection, f.options);
  assert.equal(review.nativeAmount, 780);
  assert.equal(review.policyRevision, 1);
  assert.equal(review.contactName, 'Fixture Buyer');
  assert.equal(review.proposal, undefined);
  assert.equal(review.immutableContext, undefined);
  return { ...selection, operationId: id(23), reviewFingerprint: review.reviewFingerprint, reviewed: true };
}

test('Finance exact review applies the server proposal and returns only a safe receipt', async () => {
  const f = setupFixture();
  const approved = await approval(f);
  assert.deepEqual(await xeroPrepaymentApply({ ...approved, proposal: { method: 'DELETE', path: '/Contacts' } }, f.options),
    { operationId: approved.operationId, status: 'applied' });
  assert.deepEqual(f.state.calls, ['review', 'review', 'claim', 'review', 'reserve', 'mark', 'send', 'read', 'applied', 'settle']);
});

test('unapproved or stale reviews and disabled posting make no claim or send', async () => {
  const f = setupFixture();
  const approved = await approval(f);
  await assert.rejects(xeroPrepaymentApply({ ...approved, reviewed: false }, f.options), { code: 'XERO_PREPAYMENT_REVIEW_REQUIRED' });
  await assert.rejects(xeroPrepaymentApply(approved, { ...f.options, env: {} }), { code: 'XERO_PREPAYMENT_DISABLED' });
  f.context.policies[0].revision++;
  await assert.rejects(xeroPrepaymentApply(approved, f.options), { code: 'XERO_PREPAYMENT_STALE' });
  assert.equal(f.state.operation, null);
  assert.deepEqual(f.state.calls, ['review', 'review']);
});

test('original actor recovers marked operations with posting disabled and no new proposal', async () => {
  const f = setupFixture();
  const approved = await approval(f);
  f.state.lose = true;
  await assert.rejects(xeroPrepaymentApply(approved, f.options), { code: 'XERO_PREPAYMENT_UNKNOWN' });
  const recovery = { tenantId, operationId: approved.operationId, reviewFingerprint: approved.reviewFingerprint, reviewed: true };
  await assert.rejects(xeroPrepaymentReconcile(recovery, { ...f.options, accessContext: { profile: { id: id(99) } } }),
    { code: 'XERO_PREPAYMENT_OPERATION_MISMATCH' });
  f.state.lose = false;
  assert.deepEqual(await xeroPrepaymentReconcile(recovery, { ...f.options, env: {}, loadContext: () => assert.fail('recovery must not build a proposal') }),
    { operationId: approved.operationId, status: 'applied' });
  assert.equal(f.state.calls.filter((call) => call === 'send').length, 1);
  assert.equal(f.state.calls.filter((call) => call === 'reserve').length, 1);
});

test('deployment restrictions and exact tenant reject requests before opening a connection', async () => {
  const f = setupFixture();
  const options = { ...f.options, getConnection: () => assert.fail('connection must remain closed') };
  await assert.rejects(xeroPrepaymentPreview(selection, { ...options, env: { VERCEL_ENV: 'preview' } }), { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  await assert.rejects(xeroPrepaymentPreview(selection, { ...options, env: { XERO_TENANT_ID: id(99) } }),
    { code: 'XERO_PREPAYMENT_TENANT_CHANGED' });
});

test('recovery cancels an exact unmarked claim once and does not use Xero transport', async () => {
  const f = setupFixture();
  const approved = await approval(f);
  const makeLedger = f.options.ledgerFor;
  const options = { ...f.options, ledgerFor: () => ({ ...makeLedger(), async markSent() { throw new Error('Marker did not commit'); } }) };
  await assert.rejects(xeroPrepaymentApply(approved, options), { code: 'XERO_PREPAYMENT_UNSENT' });
  const recovery = { tenantId, operationId: approved.operationId, reviewFingerprint: approved.reviewFingerprint, reviewed: true };
  const reconcileOptions = { ...f.options, transportFor: () => assert.fail('Unsent recovery must not use the provider') };
  const receipt = { operationId: approved.operationId, status: 'cancelled_before_send' };
  assert.deepEqual(await xeroPrepaymentReconcile(recovery, reconcileOptions), receipt);
  assert.deepEqual(await xeroPrepaymentReconcile(recovery, reconcileOptions), receipt);
  assert.equal(f.state.calls.filter((call) => call === 'cancel').length, 1);
  assert.equal(f.state.calls.filter((call) => call === 'send').length, 0);
});

test('scoped queue uses stored tenant identity without refreshing Xero and limits recovery to the original actor', async () => {
  const f = setupFixture();
  const other = 'a02000000000002AAA';
  const options = {
    ...f.options,
    getConnection: () => assert.fail('Queue must not refresh the connection'),
    getStoredConnection: f.options.getConnection,
    loadQueue: async (stem, { tenantId: tenant }) => {
      assert.equal(stem, stemId);
      assert.equal(tenant, tenantId);
      return {
        events: [f.context.events[0], { ...f.context.events[0], Id: other }], allocations: [],
        operations: [{ operation_id: id(51), source_id: sourceId.slice(0, 15), cash_event_id: sourceId.slice(0, 15), action: 'create',
          status: 'unknown', actor_id: actorId, review_hash: 'a'.repeat(64), response_evidence: 'private' }],
      };
    },
  };
  const payload = await xeroPrepaymentQueue({ tenantId, stemId }, options);
  assert.deepEqual(payload.rows.map((row) => [row.sourceId, row.status]), [[sourceId, 'unknown'], [other, 'ready_for_review']]);
  assert.deepEqual(payload.rows[0].recovery, { operationId: id(51), reviewFingerprint: 'a'.repeat(64) });
  assert.equal(payload.rows[0].response_evidence, undefined);
  const otherActor = await xeroPrepaymentQueue({ tenantId, stemId }, { ...options, accessContext: { profile: { id: id(99) } } });
  assert.equal(otherActor.rows[0].recovery, null);
});

test('contact choices use the selected STEM and deposit identity', async () => {
  const f = setupFixture();
  const contact = { id: id(3), name: 'Fixture Buyer' };
  const result = await xeroPrepaymentContacts(selection, { ...f.options, loadContacts: async (stem, source, { connection }) => {
    assert.equal(stem, stemId);
    assert.equal(source, sourceId);
    assert.equal(connection.tenantId, tenantId);
    return [contact];
  } });
  assert.deepEqual(result, { tenantId, sourceId, contacts: [contact] });
});
