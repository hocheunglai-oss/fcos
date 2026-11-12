import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXeroPrepaymentCreate,
  validateXeroPrepaymentCreateResult,
  buildXeroPrepaymentAllocation,
  validateXeroPrepaymentAllocationResult,
  buildXeroPrepaymentRefund,
  validateXeroPrepaymentRefundResult,
  buildXeroPrepaymentAllocationReversal,
  validateXeroPrepaymentAllocationReversalResult,
  reconcileXeroPrepaymentInvoice,
  xeroPrepaymentEvidenceFingerprint,
  xeroPrepaymentIdempotencyKey,
} from '../api/_xeroPrepaymentCurrency.js';

const ids = {
  bank: '10000000-0000-4000-8000-000000000001',
  deposit: '10000000-0000-4000-8000-000000000002',
  contact: '10000000-0000-4000-8000-000000000003',
  prepayment: '10000000-0000-4000-8000-000000000004',
  bankTransaction: '10000000-0000-4000-8000-000000000005',
  invoice: '10000000-0000-4000-8000-000000000006',
  allocation: '10000000-0000-4000-8000-000000000007',
  refund: '10000000-0000-4000-8000-000000000008',
  organisation: '10000000-0000-4000-8000-000000000009',
};
const operation = suffix => `20000000-0000-4000-8000-0000000000${suffix}`;
const organisation = { OrganisationID: ids.organisation, BaseCurrency: 'USD' };
const contact = { ContactID: ids.contact, SalesforceAccountID: '001-party' };
const depositAccount = { AccountID: ids.deposit, Code: 'DEPOSITS', Type: 'PREPAYMENT', Status: 'ACTIVE' };
const zeroTaxRate = { TaxType: 'ZERORATED', EffectiveRate: 0, Status: 'ACTIVE' };
const bank = currency => ({ AccountID: ids.bank, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: currency });

function hkdEvent(overrides = {}) {
  return {
    Id: 'cash-payment', Kind__c: 'Payment', Direction__c: 'Sell', Currency__c: 'HKD', Bank_Currency__c: 'HKD',
    Bank_Native_Amount__c: 80.40, Cash_HKD_Amount__c: 80.40, Cash_USD_Amount__c: 10.05,
    FX_Rate__c: 8, FX_Revision__c: 'finance-2026-09-01-r1', FX_Effective_At__c: '2026-09-01T03:00:00.000Z',
    Payment_Date__c: '2026-09-01', Party__c: '001-party', Reference__c: 'Customer deposit',
    Operation_Id__c: operation('01'), Request_Fingerprint__c: 'a'.repeat(64), ...overrides,
  };
}

function usdEvent(overrides = {}) {
  return {
    Id: 'cash-usd', Kind__c: 'Payment', Direction__c: 'Buy', Currency__c: 'USD', Bank_Currency__c: 'USD',
    Bank_Native_Amount__c: 25, Cash_USD_Amount__c: 25, Payment_Date__c: '2026-09-01',
    Party__c: '001-party', Reference__c: 'Supplier deposit', Operation_Id__c: operation('02'),
    Request_Fingerprint__c: 'b'.repeat(64), ...overrides,
  };
}

function hkdPrepayment(overrides = {}) {
  return {
    PrepaymentID: ids.prepayment, Type: 'RECEIVE-PREPAYMENT', Status: 'AUTHORISED', CurrencyCode: 'HKD',
    CurrencyRate: 8, Contact: { ContactID: ids.contact }, Date: '2026-09-01', Total: 80.40,
    RemainingCredit: 80.40, Allocations: [], Payments: [], ...overrides,
  };
}

function invoice(overrides = {}) {
  return {
    InvoiceID: ids.invoice, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'HKD',
    CurrencyRate: 8.05, Contact: { ContactID: ids.contact }, Date: '2026-09-02', Total: 40, AmountDue: 40,
    AmountCredited: 0, AmountPaid: 0, Prepayments: [], Payments: [], ...overrides,
  };
}

function document(overrides = {}) {
  return { Id: 'sf-invoice', Proforma__c: false, Document_Currency__c: 'HKD',
    STEM__r: { Account__c: '001-party' }, ...overrides };
}

function invoiceMapping(overrides = {}) {
  return { salesforce_id: 'sf-invoice', salesforce_object: 'Invoice__c', xero_document_id: ids.invoice, ...overrides };
}

function appliedAllocation(overrides = {}) {
  return {
    Id: 'sf-allocation', Kind__c: 'Applied', Cash_Event__c: 'cash-payment', Currency__c: 'HKD',
    Allocated_HKD__c: 8.04, Allocated_Cash_USD__c: 1.01, Bank_Native_Allocation__c: 8.04,
    Buyer_Invoice__c: 'sf-invoice', Operation_Id__c: operation('03'), Request_Fingerprint__c: 'c'.repeat(64),
    ...overrides,
  };
}

function buildAllocation(overrides = {}) {
  return buildXeroPrepaymentAllocation({
    allocation: appliedAllocation(overrides.allocation), cashEvent: hkdEvent(overrides.cashEvent), agreedCurrency: 'HKD',
    organisation, bankAccount: bank('HKD'), contact, prepayment: hkdPrepayment(overrides.prepayment),
    document: document(overrides.document), invoiceMapping: invoiceMapping(overrides.invoiceMapping),
    invoice: invoice(overrides.invoice),
  });
}

test('builds deterministic RECEIVE/SPEND prepayment proposals without BankAmount', () => {
  const sell = buildXeroPrepaymentCreate({ cashEvent: hkdEvent(), agreedCurrency: 'HKD', organisation,
    bankAccount: bank('HKD'), contact, depositAccount, zeroTaxRate });
  assert.equal(sell.method, 'PUT');
  assert.equal(sell.path, '/BankTransactions');
  assert.equal(sell.payload.BankTransactions[0].Type, 'RECEIVE-PREPAYMENT');
  assert.equal(sell.payload.BankTransactions[0].CurrencyCode, 'HKD');
  assert.equal(sell.payload.BankTransactions[0].CurrencyRate, 8);
  assert.equal(sell.payload.BankTransactions[0].BankAmount, undefined);
  assert.equal(sell.payload.BankTransactions[0].IsReconciled, false);
  assert.equal(sell.payload.BankTransactions[0].LineItems[0].AccountCode, 'DEPOSITS');
  assert.equal(sell.headers['Idempotency-Key'], xeroPrepaymentIdempotencyKey({ action: 'create',
    operationId: operation('01'), requestFingerprint: 'a'.repeat(64) }));

  const buy = buildXeroPrepaymentCreate({ cashEvent: usdEvent(), agreedCurrency: 'USD', organisation,
    bankAccount: bank('USD'), contact, depositAccount, zeroTaxRate });
  assert.equal(buy.payload.BankTransactions[0].Type, 'SPEND-PREPAYMENT');
  assert.equal(buy.payload.BankTransactions[0].CurrencyRate, undefined);
  assert.equal(buy.payload.BankTransactions[0].LineItems[0].UnitAmount, 25);
});

test('requires verified USD base, exact currencies and explicit Finance posting configuration', () => {
  const input = { cashEvent: hkdEvent(), agreedCurrency: 'HKD', organisation, bankAccount: bank('HKD'),
    contact, depositAccount, zeroTaxRate };
  assert.throws(() => buildXeroPrepaymentCreate({ ...input, organisation: { ...organisation, BaseCurrency: 'HKD' } }),
    error => error.code === 'XERO_PREPAYMENT_BASE_CURRENCY_INVALID');
  assert.throws(() => buildXeroPrepaymentCreate({ ...input, agreedCurrency: 'USD' }),
    error => error.code === 'XERO_PREPAYMENT_CURRENCY_MISMATCH');
  assert.throws(() => buildXeroPrepaymentCreate({ ...input, bankAccount: bank('USD') }),
    error => error.code === 'XERO_PREPAYMENT_BANK_ACCOUNT_INVALID');
  assert.throws(() => buildXeroPrepaymentCreate({ ...input, depositAccount: { ...depositAccount, Type: 'BANK' } }),
    error => error.code === 'XERO_PREPAYMENT_POSTING_CONFIG_INVALID');
  assert.throws(() => buildXeroPrepaymentCreate({ ...input, zeroTaxRate: { ...zeroTaxRate, EffectiveRate: 5 } }),
    error => error.code === 'XERO_PREPAYMENT_POSTING_CONFIG_INVALID');
});

test('enforces exact two-decimal cash and half-up company USD conversion', () => {
  const base = { agreedCurrency: 'HKD', organisation, bankAccount: bank('HKD'), contact, depositAccount, zeroTaxRate };
  const rounded = hkdEvent({ Bank_Native_Amount__c: 8.04, Cash_HKD_Amount__c: 8.04, Cash_USD_Amount__c: 1.01 });
  assert.equal(buildXeroPrepaymentCreate({ ...base, cashEvent: rounded }).evidence.cashUsd, 1.01);
  assert.throws(() => buildXeroPrepaymentCreate({ ...base, cashEvent: { ...rounded, Bank_Native_Amount__c: '8.041' } }),
    error => error.code === 'XERO_PREPAYMENT_AMOUNT_INVALID');
  assert.throws(() => buildXeroPrepaymentCreate({ ...base, cashEvent: { ...rounded, Cash_USD_Amount__c: 1.00 } }),
    error => error.code === 'XERO_PREPAYMENT_ACCOUNTING_USD_MISMATCH');
});

test('validates created bank-transaction and prepayment IDs, amount, rate and status', () => {
  const proposal = buildXeroPrepaymentCreate({ cashEvent: hkdEvent(), agreedCurrency: 'HKD', organisation,
    bankAccount: bank('HKD'), contact, depositAccount, zeroTaxRate });
  const result = validateXeroPrepaymentCreateResult(proposal, {
    bankTransactionsResponse: { BankTransactions: [{ BankTransactionID: ids.bankTransaction,
      PrepaymentID: ids.prepayment, Type: 'RECEIVE-PREPAYMENT', Status: 'AUTHORISED', CurrencyCode: 'HKD',
      CurrencyRate: 8, Contact: { ContactID: ids.contact }, BankAccount: { AccountID: ids.bank },
      Date: '2026-09-01', Total: 80.40, IsReconciled: false, Reference: proposal.evidence.bankReference,
      LineItems: [{ Description: proposal.evidence.description, LineAmount: 80.40, AccountCode: 'DEPOSITS', TaxType: 'ZERORATED' }] }] },
    prepayment: hkdPrepayment(),
  });
  assert.deepEqual(result, { bankTransactionId: ids.bankTransaction, prepaymentId: ids.prepayment,
    status: 'created', idempotencyKey: proposal.evidence.idempotencyKey });
  assert.throws(() => validateXeroPrepaymentCreateResult(proposal, {
    bankTransactionsResponse: { BankTransactions: [{ BankTransactionID: ids.bankTransaction, PrepaymentID: ids.prepayment,
      Type: 'RECEIVE-PREPAYMENT', Status: 'AUTHORISED', CurrencyCode: 'HKD', CurrencyRate: 8,
      Contact: { ContactID: ids.contact }, BankAccount: { AccountID: ids.bank }, Date: '2026-09-01',
      Total: 80.40, BankAmount: 80.40, LineItems: [{ Description: proposal.evidence.description, LineAmount: 80.40, AccountCode: 'DEPOSITS', TaxType: 'ZERORATED' }] }] },
    prepayment: hkdPrepayment(),
  }), error => error.code === 'XERO_PREPAYMENT_READBACK_DRIFT');
});

test('builds and validates a partial allocation while preserving Payments', () => {
  const proposal = buildAllocation();
  assert.deepEqual(proposal.payload, { Allocations: [{ Amount: 8.04, Invoice: { InvoiceID: ids.invoice }, Date: '2026-09-02' }] });
  assert.equal(proposal.path, `/Prepayments/${ids.prepayment}/Allocations`);
  assert.equal(proposal.evidence.cashUsd, 1.01);
  const liveAllocation = { AllocationID: ids.allocation, Amount: 8.04, Date: '2026-09-02', Invoice: { InvoiceID: ids.invoice } };
  const result = validateXeroPrepaymentAllocationResult(proposal, {
    allocationsResponse: { Allocations: [liveAllocation] },
    prepayment: hkdPrepayment({ RemainingCredit: 72.36, Allocations: [liveAllocation] }),
    invoice: invoice({ AmountDue: 31.96, AmountCredited: 8.04,
      Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 8.04 }] }),
  });
  assert.deepEqual(result, { allocationId: ids.allocation, status: 'applied', allocationDate: '2026-09-02' });
});

test('validates a full-credit allocation with zero balances and PAID statuses', () => {
  const proposal = buildAllocation({
    allocation: { Allocated_HKD__c: 80.40, Allocated_Cash_USD__c: 10.05, Bank_Native_Allocation__c: 80.40 },
    invoice: { Total: 80.40, AmountDue: 80.40 },
  });
  const liveAllocation = { AllocationID: ids.allocation, Amount: 80.40, Date: '2026-09-02',
    Invoice: { InvoiceID: ids.invoice } };
  assert.equal(validateXeroPrepaymentAllocationResult(proposal, {
    allocationsResponse: { Allocations: [liveAllocation] },
    prepayment: hkdPrepayment({ Status: 'PAID', RemainingCredit: 0, Allocations: [liveAllocation] }),
    invoice: invoice({ Total: 80.40, Status: 'PAID', AmountDue: 0, AmountCredited: 80.40,
      Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 80.40 }] }),
  }).status, 'applied');
});

test('rejects proformas, credit notes, mismatched final invoices and over-allocation', () => {
  assert.throws(() => buildAllocation({ document: { Proforma__c: true } }),
    error => error.code === 'XERO_PREPAYMENT_INVOICE_INVALID');
  assert.throws(() => buildAllocation({ invoice: { CreditNoteID: ids.invoice, InvoiceID: undefined } }),
    error => error.code === 'XERO_PREPAYMENT_INVOICE_INVALID');
  assert.throws(() => buildAllocation({ invoice: { Contact: { ContactID: ids.bank } } }),
    error => error.code === 'XERO_PREPAYMENT_INVOICE_INVALID');
  assert.throws(() => buildAllocation({ invoiceMapping: { xero_document_id: ids.bank } }),
    error => error.code === 'XERO_PREPAYMENT_INVOICE_INVALID');
  assert.throws(() => buildAllocation({ invoice: { AmountDue: 5 } }),
    error => error.code === 'XERO_PREPAYMENT_ALLOCATION_EXCEEDS_BALANCE');
});

test('refund uses its own payment-date snapshot and validates same-currency actual bank amount', () => {
  const refundEvent = hkdEvent({ Id: 'cash-refund', Kind__c: 'Refund', Original_Cash_Event__c: 'cash-payment',
    Bank_Native_Amount__c: 16.08, Cash_HKD_Amount__c: 16.08, Cash_USD_Amount__c: 1.99,
    FX_Rate__c: 8.1, FX_Revision__c: 'finance-2026-09-05-r2', FX_Effective_At__c: '2026-09-05T01:00:00.000Z',
    Payment_Date__c: '2026-09-05', Reference__c: 'Deposit refund', Operation_Id__c: operation('04'),
    Request_Fingerprint__c: 'd'.repeat(64) });
  const before = hkdPrepayment({ RemainingCredit: 72.36 });
  const proposal = buildXeroPrepaymentRefund({ refundEvent, originalEvent: hkdEvent(), agreedCurrency: 'HKD', organisation,
    bankAccount: bank('HKD'), contact, prepayment: before });
  assert.equal(proposal.payload.Payments[0].CurrencyRate, 8.1);
  assert.equal(proposal.payload.Payments[0].BankAmount, undefined);
  const payment = { PaymentID: ids.refund, PaymentType: 'ARPREPAYMENTPAYMENT', Status: 'AUTHORISED',
    Prepayment: { PrepaymentID: ids.prepayment }, Account: { AccountID: ids.bank }, Date: '2026-09-05',
    Amount: 16.08, BankAmount: 16.08, CurrencyRate: 8.1 };
  assert.deepEqual(validateXeroPrepaymentRefundResult(proposal, { paymentsResponse: { Payments: [payment] },
    prepayment: hkdPrepayment({ RemainingCredit: 56.28, Payments: [{ PaymentID: ids.refund, Amount: 16.08 }] }) }),
  { paymentId: ids.refund, status: 'refunded', bankAmount: 16.08 });
});

test('reversal targets the exact allocation and validates inverse balances and collections', () => {
  const liveAllocation = { AllocationID: ids.allocation, Amount: 8.04, Date: '2026-09-02', Invoice: { InvoiceID: ids.invoice } };
  const refund = { PaymentID: ids.refund, Amount: 16.08 };
  const beforePrepayment = hkdPrepayment({ RemainingCredit: 56.28, Allocations: [liveAllocation], Payments: [refund] });
  const beforeInvoice = invoice({ AmountDue: 31.96, AmountCredited: 8.04,
    Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 8.04 }] });
  const originalAllocation = { ...appliedAllocation(), Xero_Prepayment_Id__c: ids.prepayment,
    Xero_Allocation_Id__c: ids.allocation, Xero_Invoice_Id__c: ids.invoice };
  const reversal = { ...appliedAllocation({ Id: 'sf-reversal', Kind__c: 'Reversal', Reverses_Allocation__c: 'sf-allocation',
    Allocated_HKD__c: -8.04, Allocated_Cash_USD__c: -1.01, Bank_Native_Allocation__c: -8.04,
    Operation_Id__c: operation('05'), Request_Fingerprint__c: 'e'.repeat(64) }) };
  const proposal = buildXeroPrepaymentAllocationReversal({ reversal, originalAllocation,
    prepayment: beforePrepayment, invoice: beforeInvoice });
  assert.equal(proposal.method, 'DELETE');
  assert.equal(proposal.path, `/Prepayments/${ids.prepayment}/Allocations/${ids.allocation}`);
  assert.deepEqual(proposal.headers, {});
  const result = validateXeroPrepaymentAllocationReversalResult(proposal, {
    deleteResponse: { AllocationID: ids.allocation, Invoice: { InvoiceID: ids.invoice }, IsDeleted: true },
    prepayment: hkdPrepayment({ RemainingCredit: 64.32, Allocations: [], Payments: [refund] }),
    invoice: invoice({ AmountDue: 40, AmountCredited: 0, Prepayments: [] }),
  });
  assert.equal(result.status, 'reversed');
  assert.equal(result.localIdempotencyKey, proposal.localIdempotencyKey);
});

test('rejects unknown allocations and payment drift after a write', () => {
  const proposal = buildAllocation();
  const liveAllocation = { AllocationID: ids.allocation, Amount: 8.04, Date: '2026-09-02', Invoice: { InvoiceID: ids.invoice } };
  const unknown = { AllocationID: ids.refund, Amount: 1, Date: '2026-09-02', Invoice: { InvoiceID: ids.invoice } };
  assert.throws(() => validateXeroPrepaymentAllocationResult(proposal, {
    allocationsResponse: { Allocations: [liveAllocation] },
    prepayment: hkdPrepayment({ RemainingCredit: 71.36, Allocations: [liveAllocation, unknown] }),
    invoice: invoice({ AmountDue: 31.96, AmountCredited: 8.04,
      Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 8.04 }] }),
  }), error => error.code === 'XERO_PREPAYMENT_ALLOCATION_UNKNOWN');
  assert.throws(() => validateXeroPrepaymentAllocationResult(proposal, {
    allocationsResponse: { Allocations: [liveAllocation] },
    prepayment: hkdPrepayment({ RemainingCredit: 72.36, Allocations: [liveAllocation],
      Payments: [{ PaymentID: ids.refund, Amount: 1 }] }),
    invoice: invoice({ AmountDue: 31.96, AmountCredited: 8.04,
      Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 8.04 }] }),
  }), error => error.code === 'XERO_PREPAYMENT_READBACK_DRIFT');
});

test('reconciles Prepayments/AmountCredited separately from Payments/AmountPaid and rejects drift', () => {
  const allocation = { AllocationID: ids.allocation, Amount: 8.04, Invoice: { InvoiceID: ids.invoice } };
  const refund = { PaymentID: ids.refund, Amount: 16.08 };
  const result = reconcileXeroPrepaymentInvoice({
    prepayment: hkdPrepayment({ RemainingCredit: 56.28, Allocations: [allocation], Payments: [refund] }),
    invoice: invoice({ AmountDue: 28.96, AmountCredited: 8.04, AmountPaid: 3,
      Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 8.04 }],
      Payments: [{ PaymentID: ids.bankTransaction, Amount: 3 }] }),
    expectedAllocations: [{ allocationId: ids.allocation, invoiceId: ids.invoice, amount: 8.04 }],
    expectedRefunds: [{ paymentId: ids.refund, amount: 16.08 }],
    expectedInvoicePayments: [{ paymentId: ids.bankTransaction, amount: 3 }],
  });
  assert.deepEqual(result, { allocated: 8.04, refunded: 16.08, remainingCredit: 56.28,
    invoicePrepayment: 8.04, amountPaid: 3, amountCredited: 8.04 });
  assert.throws(() => reconcileXeroPrepaymentInvoice({
    prepayment: hkdPrepayment({ RemainingCredit: 55.28, Allocations: [allocation], Payments: [refund] }),
    invoice: invoice({ AmountCredited: 8.04, Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 8.04 }] }),
    expectedAllocations: [{ allocationId: ids.allocation, invoiceId: ids.invoice, amount: 8.04 }],
    expectedRefunds: [{ paymentId: ids.refund, amount: 16.08 }],
  }), error => error.code === 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
});

test('evidence fingerprints are canonical and idempotency inputs are strict', () => {
  assert.equal(xeroPrepaymentEvidenceFingerprint({ a: 1, b: { c: 2 } }),
    xeroPrepaymentEvidenceFingerprint({ b: { c: 2 }, a: 1 }));
  assert.throws(() => xeroPrepaymentIdempotencyKey({ action: 'create', operationId: 'bad', requestFingerprint: 'a'.repeat(64) }),
    error => error.code === 'XERO_PREPAYMENT_ID_INVALID');
});


test('a native HKD cent with zero USD carrying remains valid and Finance chooses the posting account', () => {
  const proposal = buildXeroPrepaymentCreate({ cashEvent: hkdEvent({ Cash_HKD_Amount__c: 0.01, Bank_Native_Amount__c: 0.01, Cash_USD_Amount__c: 0, Reference__c: null }),
    agreedCurrency: 'HKD', organisation, bankAccount: bank('HKD'), contact,
    depositAccount: { ...depositAccount, Type: 'CURRENTLIABILITY' }, zeroTaxRate });
  assert.equal(proposal.payload.BankTransactions[0].LineItems[0].UnitAmount, 0.01);
  assert.equal(proposal.payload.BankTransactions[0].LineItems[0].Description, `cash-payment [FCOS cash cash-payment; ${operation('01')}]`);
});

test('fully allocated prepayment reconciles to zero and unknown direct payments fail closed', () => {
  const row = { AllocationID: ids.allocation, Amount: 80.4, Invoice: { InvoiceID: ids.invoice } };
  const input = { prepayment: hkdPrepayment({ RemainingCredit: 0, Status: 'PAID', Allocations: [row] }),
    invoice: invoice({ Total: 100, AmountDue: 19.6, AmountCredited: 80.4, Prepayments: [{ PrepaymentID: ids.prepayment, AppliedAmount: 80.4 }] }),
    expectedAllocations: [{ allocationId: ids.allocation, invoiceId: ids.invoice, amount: 80.4 }] };
  assert.equal(reconcileXeroPrepaymentInvoice(input).remainingCredit, 0);
  assert.throws(() => reconcileXeroPrepaymentInvoice({ ...input, invoice: { ...input.invoice, AmountDue: 1 } }), /outstanding balance/);
  assert.throws(() => reconcileXeroPrepaymentInvoice({ ...input, invoice: { ...input.invoice, Payments: [{ PaymentID: ids.refund, Amount: 1 }], AmountPaid: 1, AmountDue: 18.6 } }), /unknown or mismatched payments/);
});

test('credit after prepayment reversal is reconciled only against explicitly mapped credit evidence', () => {
  const creditNoteId = ids.refund;
  const input = { prepayment: hkdPrepayment(), invoice: invoice({ AmountDue: 0, AmountCredited: 40,
    CreditNotes: [{ CreditNoteID: creditNoteId, AppliedAmount: 40 }] }), expectedInvoiceCredits: [{ creditNoteId, amount: 40 }] };
  assert.equal(reconcileXeroPrepaymentInvoice(input).amountCredited, 40);
  assert.throws(() => reconcileXeroPrepaymentInvoice({ ...input, expectedInvoiceCredits: [] }), /unknown or mismatched credits/);
});


test('allocation retains final original-cash cent remainder and permits zero USD for an HKD cent', () => {
  const last = buildAllocation({ allocation: { Allocated_HKD__c: 8.04, Allocated_Cash_USD__c: 1, Bank_Native_Allocation__c: 8.04 } });
  assert.equal(last.evidence.cashUsd, 1);
  const tiny = buildAllocation({ allocation: { Allocated_HKD__c: 0.01, Allocated_Cash_USD__c: 0, Bank_Native_Allocation__c: 0.01 } });
  assert.equal(tiny.evidence.cashUsd, 0);
  assert.throws(() => buildAllocation({ allocation: { Allocated_Cash_USD__c: 10.06 } }), /original cash basis/);
});
