import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrepaymentReview } from '../api/_xeroPrepaymentReview.js';
import { xeroPrepaymentEvidenceFingerprint as hash } from '../api/_xeroPrepaymentCurrency.js';
import { allocation, fixture, id } from './fixtures/xeroPrepayment.js';

function context() {
  const source = fixture();
  Object.assign(source.events[0], {
    Party__r: { Name: 'Fixture Buyer', Inactive_Suspended__c: false }, Trade_FX_Side__r: { Currency__c: 'HKD' },
  });
  return Object.assign(source, {
    organisation: { OrganisationID: source.tenantId, BaseCurrency: 'USD' },
    accounts: [
      { AccountID: id(2), Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'HKD', Name: 'Fixture Bank', Code: 'BANK' },
      { AccountID: id(4), Type: 'CURRENTLIABILITY', Status: 'ACTIVE', Name: 'Customer deposits', Code: 'DEPOSIT' },
    ],
    contacts: [{ ContactID: id(3), ContactStatus: 'ACTIVE', Name: 'Fixture Buyer' }],
    bankMappings: [{ id: id(50), enabled: true, salesforce_bank_name: 'DBS', xero_bank_account_id: id(2),
      xero_bank_account_name: 'Fixture Bank', xero_bank_account_code: 'BANK', revision: 1 }],
    policies: [{ tenant_id: source.tenantId, direction: 'Sell', currency: 'HKD', enabled: true, account_id: id(4),
      account_code: 'DEPOSIT', tax_type: 'NONE', revision: 1 }],
    taxes: [{ TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, TaxComponents: [{ Rate: 0 }] }],
    bankDiscovery: { complete: true, rows: [] },
  });
}

function freshDeposit() {
  const source = context();
  source.operations = [];
  source.xeroBankTransactions = [];
  source.xeroPrepayments = [];
  source.xeroInvoices = [];
  source.documentMappings = [];
  source.invoices = [];
  return source;
}

const create = { sourceId: 'cash', action: 'create', contactId: id(3) };

test('deposit review binds scoped identity, policy, exact amounts and empty duplicate evidence', () => {
  const source = freshDeposit();
  const original = buildPrepaymentReview(source, create);
  assert.equal(original.proposal.payload.BankTransactions[0].Reference, `FCOS-${source.events[0].Operation_Id__c}`);
  assert.equal(original.nativeAmount, 780);
  assert.equal(original.accountingUsd, 97.5);
  assert.equal(original.immutableContext.policy.revision, 1);
  assert.equal(original.immutableContext.bank.revision, 1);
  assert.equal(original.immutableContext.contact.id, id(3));
  assert.equal(original.reviewFingerprint, buildPrepaymentReview(source, create).reviewFingerprint);
  source.bankMappings[0].revision++;
  assert.notEqual(original.reviewFingerprint, buildPrepaymentReview(source, create).reviewFingerprint);
  source.bankDiscovery.rows.push({ Reference: original.proposal.evidence.bankReference });
  assert.throws(() => buildPrepaymentReview(source, create), { code: 'XERO_PREPAYMENT_CREATE_AMBIGUOUS' });
});

test('only the exact unsent claim can be excluded without changing its review fingerprint', () => {
  const source = freshDeposit();
  const initial = buildPrepaymentReview(source, create);
  source.operations.push({ operation_id: id(55), source_id: 'cash', action: 'create', status: 'processing' });
  assert.throws(() => buildPrepaymentReview(source, create), /original prepayment operation/);
  assert.deepEqual(buildPrepaymentReview(source, create, { ignoreOperationId: id(55) }), initial);
  source.operations[0].send_started_at = '2026-09-11T00:00:00Z';
  assert.throws(() => buildPrepaymentReview(source, create, { ignoreOperationId: id(55) }), /exact unsent claim/);
});

test('Finance review holds stale trade, party, accounting lock and incomplete deposit discovery', () => {
  for (const [change, expected] of [
    [(source) => { source.events[0].Trade_FX_Side__r.Currency__c = 'USD'; }, /agreed trade-side currency/],
    [(source) => { source.events[0].Party__r.Inactive_Suspended__c = true; }, /active Salesforce party/],
    [(source) => { source.organisation.PeriodLockDate = '2026-09-10'; }, /accounting date is locked/],
    [(source) => { source.bankDiscovery.complete = false; }, /Complete Xero deposit discovery/],
  ]) {
    const source = freshDeposit();
    change(source);
    assert.throws(() => buildPrepaymentReview(source, create), expected);
  }
});

function withAppliedDeposit() {
  const source = context();
  const applied = source.operations[0];
  applied.request_evidence.immutableContext = {
    policy: { direction: 'Sell', currency: 'HKD', accountCode: 'DEPOSIT', taxType: 'NONE', revision: 1 },
    bank: { id: id(2), currency: 'HKD' },
  };
  applied.request_hash = hash(applied.request_evidence);
  source.invoices[0].Proforma__c = false;
  source.documentMappings[0].source_fingerprint = 'f'.repeat(64);
  source.invoiceClassifications = [{ salesforceId: 'invoice', status: 'eligible', action: 'link',
    sourceFingerprint: source.documentMappings[0].source_fingerprint, xero: { id: id(7) }, blockers: [], differences: [] }];
  return source;
}

test('allocation requires the current maintained invoice classification and the original deposit policy', () => {
  const source = withAppliedDeposit();
  const row = allocation(source, { posted: false });
  const review = buildPrepaymentReview(source, { action: 'allocate', sourceId: row.Id });
  assert.equal(review.invoiceMappingId, id(8));
  assert.equal(review.immutableContext.prepaymentId, id(5));
  assert.equal(review.proposal.payload.Allocations[0].Amount, 780);
  source.invoiceClassifications[0].sourceFingerprint = 'a'.repeat(64);
  assert.throws(() => buildPrepaymentReview(source, { action: 'allocate', sourceId: row.Id }), /does not corroborate/);
});

test('reversal binds the original applied allocation and its historical bank', () => {
  const source = withAppliedDeposit();
  allocation(source);
  const reversal = allocation(source, { reverse: true, posted: false });
  source.bankMappings = [];
  const review = buildPrepaymentReview(source, { action: 'reverse', sourceId: reversal.Id });
  assert.equal(review.proposal.path, `/Prepayments/${id(5)}/Allocations/${id(13)}`);
  assert.equal(review.immutableContext.bank.id, id(2));
});

test('refund binds current bank and refund-date amounts to the historical deposit', () => {
  const source = withAppliedDeposit();
  const event = source.events[0];
  source.events.push({ ...event, Id: 'refund', Kind__c: 'Refund', Original_Cash_Event__c: event.Id,
    Original_Carrying_USD__c: 97.5, Original_Bank_Allocation__c: 780, Payment_Date__c: '2026-09-11', Operation_Id__c: id(56) });
  const review = buildPrepaymentReview(source, { action: 'refund', sourceId: 'refund' });
  assert.equal(review.proposal.payload.Payments[0].Date, '2026-09-11');
  assert.equal(review.immutableContext.prepaymentId, id(5));
});
