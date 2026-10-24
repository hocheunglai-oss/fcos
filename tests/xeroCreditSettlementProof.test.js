import assert from 'node:assert/strict';
import test from 'node:test';
import { creditSettlementProof } from '../api/_xeroCreditSettlementProof.js';

const creditId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const credit = (extra = {}) => ({ CreditNoteID: creditId, Type: 'ACCRECCREDIT', Status: 'AUTHORISED',
  Contact: { ContactID: contactId }, CurrencyCode: 'USD', Total: '100.00', RemainingCredit: '100.00',
  LineItems: [], Allocations: [], Payments: [], ...extra });
const allocation = (extra = {}) => ({ AllocationID: '33333333-3333-4333-8333-333333333333',
  Amount: '30', Date: '2026-09-30', Invoice: { InvoiceID: '44444444-4444-4444-8444-444444444444',
    Type: 'ACCREC', CurrencyCode: 'USD', Contact: { ContactID: contactId } }, ...extra });
const refund = (extra = {}) => ({ PaymentID: '55555555-5555-4555-8555-555555555555',
  PaymentType: 'ARCREDITPAYMENT', Status: 'AUTHORISED', Amount: '20', Date: '2026-09-30',
  CreditNote: { CreditNoteID: creditId, Type: 'ACCRECCREDIT', CurrencyCode: 'USD', Contact: { ContactID: contactId } }, ...extra });

test('actual CreditNotes schema proves explicit unallocated credit without AmountPaid and leaves raw intact', () => {
  const raw = credit(); const before = structuredClone(raw);
  assert.deepEqual(creditSettlementProof(raw), { amountPaid: '0', amountCredited: '0' });
  assert.equal(Object.hasOwn(raw, 'AmountPaid'), false);
  assert.deepEqual(raw, before);
  assert.deepEqual(creditSettlementProof(credit({ Total: 0, RemainingCredit: 0 })), { amountPaid: '0', amountCredited: '0' });
});

test('credit balance sums explicit invoice allocations and identified authorised refunds exactly', () => {
  assert.deepEqual(creditSettlementProof(credit({ RemainingCredit: 70, Allocations: [allocation()] })),
    { amountPaid: '0', amountCredited: '30' });
  assert.deepEqual(creditSettlementProof(credit({ RemainingCredit: '50.00', Allocations: [allocation()], Payments: [refund()], AppliedAmount: '30' })),
    { amountPaid: '20', amountCredited: '30' });
  assert.deepEqual(creditSettlementProof(credit({ RemainingCredit: 80, Payments: [refund({ CreditNote: undefined,
    Invoice: { InvoiceID: creditId, Type: 'ACCRECCREDIT', CurrencyCode: 'USD', Contact: { ContactID: contactId } } })] })), null);
  const legacy = refund(); delete legacy.CreditNote;
  legacy.Invoice = { InvoiceID: creditId, Type: 'ACCRECCREDIT', CurrencyCode: 'USD', Contact: { ContactID: contactId } };
  assert.deepEqual(creditSettlementProof(credit({ RemainingCredit: 80, Payments: [legacy] })), { amountPaid: '20', amountCredited: '0' });
  const supplier = refund({ PaymentType: 'APCREDITPAYMENT', CreditNote: { CreditNoteID: creditId,
    Type: 'ACCPAYCREDIT', CurrencyCode: 'USD', Contact: { ContactID: contactId } } });
  assert.deepEqual(creditSettlementProof(credit({ Type: 'ACCPAYCREDIT', RemainingCredit: 80, Payments: [supplier] })),
    { amountPaid: '20', amountCredited: '0' });
});

test('exact decimal balance preserves fractional differences instead of rounding them away', () => {
  assert.deepEqual(creditSettlementProof(credit({ Total: '0.3', RemainingCredit: '0.1', Allocations: [allocation({ Amount: '0.2' })] })),
    { amountPaid: '0', amountCredited: '0.2' });
  assert.equal(creditSettlementProof(credit({ Total: '100.000000000001' })), null);
  assert.equal(creditSettlementProof(credit({ Total: 0.1 + 0.2, RemainingCredit: '0.3' })), null);
  assert.equal(creditSettlementProof(credit({ Total: '999999999999.99', RemainingCredit: '999999999999.99' }))?.amountPaid, '0');
  assert.equal(creditSettlementProof(credit({ Total: '1000000000000', RemainingCredit: '1000000000000' })), null);
});

test('missing arrays, malformed or negative amounts, incomplete lines and inconsistent balances remain held', () => {
  const invalid = [null, {}, ...['Total', 'RemainingCredit', 'Payments', 'Allocations'].map((key) => {
    const row = credit(); delete row[key]; return row;
  }), ...[null, {}, 1, ''].flatMap((value) => [credit({ Payments: value }), credit({ Allocations: value })]),
  ...[null, undefined, NaN, Infinity, -1, '-0.001', ' ', '', '1e2', '00100', true, '100.0000000000001']
    .flatMap((value) => [credit({ Total: value }), credit({ RemainingCredit: value })]),
  credit({ RemainingCredit: 101 }), credit({ RemainingCredit: 90 }), credit({ LineItems: [null] }),
  credit({ LineItems: new Array(1) }), credit({ Payments: new Array(1) }), credit({ Allocations: new Array(1) }),
  credit({ AmountPaid: null }), credit({ AmountPaid: 20 }), credit({ AppliedAmount: 1 }),
  credit({ HasErrors: true }), credit({ HasValidationErrors: true }), credit({ ValidationErrors: {} })];
  for (const row of invalid) assert.equal(creditSettlementProof(row), null);
});

test('allocations need unique identities, same invoice currency and contact, positive amounts and unreversed evidence', () => {
  const incomplete = allocation(); delete incomplete.AllocationID;
  const malformed = [null, {}, incomplete, allocation({ AllocationID: ' ' }), allocation({ Amount: null }),
    allocation({ Amount: -30 }), allocation({ Amount: 0 }), allocation({ Date: '2026-02-30' }),
    allocation({ Invoice: { InvoiceID: 'invoice-one' } }), allocation({ Invoice: { ...allocation().Invoice, CurrencyCode: 'HKD' } }),
    allocation({ Invoice: { ...allocation().Invoice, Contact: { ContactID: 'other' } } }),
    allocation({ Invoice: { ...allocation().Invoice, Type: 'ACCPAY' } }), allocation({ IsDeleted: true }),
    allocation({ IsDeleted: null }), allocation({ ValidationErrors: [{ Message: 'error' }] }), allocation({ Prepayment: {} }),
    allocation({ CreditNote: { CreditNoteID: 'other' } })];
  for (const row of malformed) assert.equal(creditSettlementProof(credit({ RemainingCredit: 70, Allocations: [row] })), null);
  assert.equal(creditSettlementProof(credit({ RemainingCredit: 40, Allocations: [allocation(), allocation({ AllocationID: allocation().AllocationID.toUpperCase() })] })), null);
});

test('refunds need complete credit association and unique live identities, never infer missing evidence as zero', () => {
  const incomplete = refund(); delete incomplete.PaymentID;
  const malformed = [null, {}, incomplete, refund({ Amount: null }), refund({ Amount: -20 }), refund({ Amount: 0 }),
    refund({ Status: undefined }), refund({ Status: 'DELETED' }), refund({ PaymentType: undefined }), refund({ PaymentType: 'ACCRECPAYMENT' }),
    refund({ CreditNote: undefined }), refund({ CreditNote: { CreditNoteID: creditId } }),
    refund({ CreditNote: { ...refund().CreditNote, CreditNoteID: '66666666-6666-4666-8666-666666666666' } }),
    refund({ CreditNote: { ...refund().CreditNote, CurrencyCode: 'HKD' } }),
    refund({ CreditNote: { ...refund().CreditNote, Contact: { ContactID: '66666666-6666-4666-8666-666666666666' } } }),
    refund({ CreditNote: { ...refund().CreditNote, HasErrors: true } }),
    refund({ Invoice: { InvoiceID: creditId, Type: 'ACCRECCREDIT', CurrencyCode: 'USD', Contact: { ContactID: contactId } } }),
    refund({ Prepayment: {} }), refund({ Date: 'not-a-date' }), refund({ HasValidationErrors: true })];
  for (const row of malformed) assert.equal(creditSettlementProof(credit({ RemainingCredit: 80, Payments: [row] })), null);
  assert.equal(creditSettlementProof(credit({ RemainingCredit: 60, Payments: [refund(), refund()] })), null);
  assert.equal(creditSettlementProof(credit({ RemainingCredit: 50, Allocations: [allocation()], Payments: [refund({ PaymentID: allocation().AllocationID })] })), null);
});
