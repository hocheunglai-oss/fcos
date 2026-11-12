import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, allocation, id } from './fixtures/xeroPrepayment.js';
import {
  buildXeroPrepaymentAllocation, buildXeroPrepaymentAllocationReversal, buildXeroPrepaymentRefund,
} from '../api/_xeroPrepaymentCurrency.js';
import { verifyXeroPrepaymentOutcome } from '../api/_xeroPrepaymentReadback.js';

function readFixture(source) {
  const calls = [];
  const responses = {
    BankTransactions: source.xeroBankTransactions,
    Prepayments: source.xeroPrepayments,
    Invoices: source.xeroInvoices,
    Payments: source.xeroPayments,
  };
  return {
    calls,
    async read(path) {
      calls.push(path);
      const url = new URL(path, 'https://fixture.invalid');
      const [, resource] = url.pathname.split('/');
      assert.ok(responses[resource]);
      return structuredClone({ [resource]: responses[resource] });
    },
  };
}

function inputs(source) {
  return {
    agreedCurrency: 'HKD', organisation: { OrganisationID: source.tenantId, BaseCurrency: 'USD' },
    bankAccount: { AccountID: id(2), Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'HKD' },
    contact: { ContactID: id(3), SalesforceAccountID: source.events[0].Party__c },
  };
}

test('deposit recovery finds one exact immutable reference and reads only two detail records', async () => {
  const source = fixture();
  const request = source.operations[0].request_evidence;
  const api = readFixture(source);
  const outcome = await verifyXeroPrepaymentOutcome(request, api.read);
  assert.deepEqual(outcome.identities, { xeroBankTransactionId: id(6), xeroPrepaymentId: id(5) });
  assert.equal(new URL(api.calls[0], 'https://fixture.invalid').searchParams.get('where'), `Reference=="${request.proposal.evidence.bankReference}"`);
  assert.deepEqual(api.calls.slice(1), [`/BankTransactions/${id(6)}`, `/Prepayments/${id(5)}`]);
  source.xeroBankTransactions.push({ ...source.xeroBankTransactions[0], BankTransactionID: id(90) });
  api.calls.length = 0;
  await assert.rejects(verifyXeroPrepaymentOutcome(request, api.read), /Exactly one bank transaction/);
  assert.equal(api.calls.length, 1);
});

test('allocation readback requires a unique provider ID and exact invoice and balance changes', async () => {
  const source = fixture();
  const row = allocation(source, { posted: false });
  source.invoices[0].Proforma__c = false;
  const proposal = buildXeroPrepaymentAllocation({
    ...inputs(source), allocation: row, cashEvent: source.events[0], prepayment: source.xeroPrepayments[0],
    document: source.invoices[0], invoiceMapping: source.documentMappings[0], invoice: source.xeroInvoices[0],
  });
  Object.assign(source.xeroPrepayments[0], { RemainingCredit: 0, Status: 'PAID',
    Allocations: [{ AllocationId: id(13), Amount: 780, Date: '2026-09-11', Invoice: { InvoiceID: id(7) } }] });
  Object.assign(source.xeroInvoices[0], { AmountDue: 780, AmountCredited: 780, Prepayments: [{ PrepaymentID: id(5), AppliedAmount: 780 }] });
  const api = readFixture(source);
  const request = { action: 'allocate', proposal };
  assert.deepEqual((await verifyXeroPrepaymentOutcome(request, api.read)).identities,
    { xeroPrepaymentId: id(5), xeroAllocationId: id(13) });
  assert.deepEqual(api.calls, [`/Prepayments/${id(5)}`, `/Invoices/${id(7)}`]);
  delete source.xeroPrepayments[0].Allocations[0].AllocationId;
  await assert.rejects(verifyXeroPrepaymentOutcome(request, api.read), /exact Xero readback identity/);
});

test('reversal requires an explicit allocation collection and restores exact balances without a DELETE receipt', async () => {
  const source = fixture();
  const original = allocation(source);
  const prepayment = source.xeroPrepayments[0];
  const invoice = source.xeroInvoices[0];
  const reversal = allocation(source, { reverse: true, posted: false });
  const proposal = buildXeroPrepaymentAllocationReversal({ reversal, prepayment, invoice, originalAllocation: {
    ...original, Xero_Prepayment_Id__c: id(5), Xero_Allocation_Id__c: id(13), Xero_Invoice_Id__c: id(7),
  } });
  Object.assign(prepayment, { RemainingCredit: 780, Status: 'AUTHORISED', Allocations: [] });
  Object.assign(invoice, { AmountDue: 1560, AmountCredited: 0, Prepayments: [] });
  const api = readFixture(source);
  const request = { action: 'reverse', proposal };
  assert.equal((await verifyXeroPrepaymentOutcome(request, api.read)).result.status, 'reversed');
  assert.equal(api.calls.length, 2);
  delete prepayment.Allocations;
  await assert.rejects(verifyXeroPrepaymentOutcome(request, api.read), /omitted the prepayment allocation/);
});

test('refund verifies the new payment on its own endpoint and preserves exact original cash history', async () => {
  const source = fixture();
  const original = source.events[0];
  const prepayment = source.xeroPrepayments[0];
  const refund = { ...original, Id: 'refund', Kind__c: 'Refund', Original_Cash_Event__c: original.Id,
    Operation_Id__c: id(90), Payment_Date__c: '2026-09-12' };
  const proposal = buildXeroPrepaymentRefund({ ...inputs(source), refundEvent: refund, originalEvent: original, prepayment });
  source.xeroPayments.push({ ...proposal.payload.Payments[0], PaymentID: id(91), PaymentType: 'ARPREPAYMENTPAYMENT', Status: 'AUTHORISED', BankAmount: 780 });
  Object.assign(prepayment, { RemainingCredit: 0, Status: 'PAID', Payments: [{ PaymentID: id(91), Amount: 780 }] });
  const api = readFixture(source);
  const request = { action: 'refund', proposal };
  assert.deepEqual((await verifyXeroPrepaymentOutcome(request, api.read)).identities, { xeroPrepaymentId: id(5), xeroPaymentId: id(91) });
  assert.deepEqual(api.calls, [`/Prepayments/${id(5)}`, `/Payments/${id(91)}`]);
  source.xeroPayments[0].BankAmount = 779.99;
  await assert.rejects(verifyXeroPrepaymentOutcome(request, api.read), /differs from immutable refund evidence/);
});
