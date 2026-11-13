import {
  validateXeroPrepaymentAllocationResult, validateXeroPrepaymentAllocationReversalReadback,
  validateXeroPrepaymentCreateResult, validateXeroPrepaymentRefundResult,
} from './_xeroPrepaymentCurrency.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function fail(message) {
  throw Object.assign(new Error(message), { code: 'XERO_PREPAYMENT_READBACK_DRIFT', status: 409 });
}

function identity(value) {
  if (typeof value !== 'string' || !UUID.test(value) || value === '00000000-0000-0000-0000-000000000000') {
    fail('An exact Xero readback identity is required.');
  }
  return value;
}

function one(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) fail(`Exactly one ${label} is required.`);
  return rows[0];
}

async function exact(read, collection, idField, id) {
  const response = await read(`/${collection}/${identity(id)}`);
  const row = one(response?.[collection], collection);
  if (row[idField] !== id) fail(`Xero returned a different ${collection} identity.`);
  return row;
}

function canonicalCollection(rows, label, idField) {
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object')) fail(`Xero omitted the ${label} collection.`);
  const entries = rows.map((row) => {
    if (idField !== 'AllocationID') return row;
    const { AllocationId, ...rest } = row;
    if (row.AllocationID && AllocationId && row.AllocationID !== AllocationId) fail('Xero returned conflicting allocation identities.');
    return { ...rest, AllocationID: identity(row.AllocationID || AllocationId) };
  });
  const ids = entries.map((row) => identity(row[idField]));
  if (new Set(ids).size !== ids.length) fail(`Xero returned duplicate ${label} identities.`);
  return entries.sort((left, right) => left[idField].localeCompare(right[idField]));
}

async function prepaymentAt(read, id) {
  const row = await exact(read, 'Prepayments', 'PrepaymentID', id);
  return { ...row, Allocations: canonicalCollection(row.Allocations, 'prepayment allocation', 'AllocationID'),
    Payments: canonicalCollection(row.Payments, 'prepayment payment', 'PaymentID') };
}

async function invoiceAt(read, id) {
  const row = await exact(read, 'Invoices', 'InvoiceID', id);
  const prepayments = canonicalCollection(row.Prepayments, 'invoice prepayment', 'PrepaymentID');
  if (Object.hasOwn(row, 'Payments')) {
    return { ...row, Prepayments: prepayments, Payments: canonicalCollection(row.Payments, 'invoice payment', 'PaymentID') };
  }
  // Xero can omit Payments on an unpaid invoice. Prove it is empty with a bounded,
  // invoice-specific read rather than assuming that an omitted collection is empty.
  if (row.AmountPaid !== 0) fail('Xero omitted payments on an invoice without an explicit zero paid balance.');
  const params = new URLSearchParams({ where: `Invoice.InvoiceID=guid("${identity(id)}")`, page: '1', pageSize: '100' });
  const response = await read(`/Payments?${params}`);
  if (!Array.isArray(response?.Payments) || response.Payments.length !== 0
    || ['pagination', 'Pagination'].some(key => Object.hasOwn(response, key)
      && (response[key]?.page !== 1 || ![0, 1].includes(response[key]?.pageCount) || response[key]?.itemCount !== 0
        || (response[key]?.pageSize !== undefined && response[key].pageSize !== 100)))) {
    fail('Xero did not establish an empty invoice payment collection.');
  }
  return { ...row, Prepayments: prepayments, Payments: [] };
}

async function verifyCreate(proposal, read) {
  const { bankReference, operationId } = proposal.evidence;
  if (bankReference !== `FCOS-${identity(operationId)}` || proposal.payload.BankTransactions?.[0]?.Reference !== bankReference) {
    fail('The reviewed deposit has no exact Xero recovery reference.');
  }
  const params = new URLSearchParams({ where: `Reference=="${bankReference}"`, page: '1', pageSize: '100' });
  const response = await read(`/BankTransactions?${params}`);
  if (response?.pagination != null && (response.pagination.page !== 1 || response.pagination.pageCount !== 1
    || response.pagination.itemCount !== 1)) fail('The Xero deposit search is incomplete or ambiguous.');
  const candidate = one(response?.BankTransactions, 'bank transaction with the exact recovery reference');
  if (candidate.Reference !== bankReference) fail('Xero did not return the exact deposit reference.');
  const bankTransaction = await exact(read, 'BankTransactions', 'BankTransactionID', candidate.BankTransactionID);
  const prepayment = await prepaymentAt(read, bankTransaction.PrepaymentID);
  const result = validateXeroPrepaymentCreateResult(proposal, { bankTransactionsResponse: { BankTransactions: [bankTransaction] }, prepayment });
  return { identities: { xeroBankTransactionId: result.bankTransactionId, xeroPrepaymentId: result.prepaymentId }, result, bankTransaction, prepayment };
}

async function verifyApplication(proposal, read, reversal) {
  const evidence = proposal.evidence;
  const prepayment = await prepaymentAt(read, evidence.prepaymentId);
  const invoice = await invoiceAt(read, evidence.invoiceId);
  if (reversal) {
    const result = validateXeroPrepaymentAllocationReversalReadback(proposal, { prepayment, invoice });
    return { identities: { xeroPrepaymentId: evidence.prepaymentId, xeroAllocationId: result.allocationId }, result, prepayment, invoice };
  }
  const prior = new Set(evidence.before.collections.prepaymentAllocations.map((row) => identity(row.AllocationID)));
  const added = one(prepayment.Allocations.filter((row) => !prior.has(row.AllocationID)), 'new prepayment allocation');
  const result = validateXeroPrepaymentAllocationResult(proposal, { allocationsResponse: { Allocations: [added] }, prepayment, invoice });
  return { identities: { xeroPrepaymentId: evidence.prepaymentId, xeroAllocationId: result.allocationId }, result, prepayment, invoice };
}

async function verifyRefund(proposal, read) {
  const evidence = proposal.evidence;
  const prepayment = await prepaymentAt(read, evidence.prepaymentId);
  const prior = new Set(evidence.before.Payments.map((row) => identity(row.PaymentID)));
  const added = one(prepayment.Payments.filter((row) => !prior.has(row.PaymentID)), 'new prepayment refund');
  const detail = await exact(read, 'Payments', 'PaymentID', added.PaymentID);
  if ([added, detail].some(row => (Object.hasOwn(row, 'Prepayment') && row.Prepayment?.PrepaymentID !== evidence.prepaymentId)
    || (row.Invoice != null && row.Invoice.InvoiceID !== evidence.prepaymentId)
    || row.CreditNote != null || row.Overpayment != null)) {
    fail('Xero returned conflicting refund document linkage.');
  }
  // A standalone refund can expose its parent as Invoice.InvoiceID instead.
  // Require any reported ID to match and bind the parent through its exact new payment ID.
  const payment = Object.hasOwn(detail, 'Prepayment') ? detail
    : { ...detail, Prepayment: { PrepaymentID: evidence.prepaymentId } };
  const result = validateXeroPrepaymentRefundResult(proposal, { paymentsResponse: { Payments: [payment] }, prepayment });
  return { identities: { xeroPrepaymentId: evidence.prepaymentId, xeroPaymentId: result.paymentId }, result, prepayment, payment };
}

/** Verify the original financial outcome using independently admitted GET requests. */
export function verifyXeroPrepaymentOutcome(request, read) {
  const proposal = request?.proposal;
  if (request?.action === 'create' && proposal?.action === 'create') return verifyCreate(proposal, read);
  if (request?.action === 'allocate' && proposal?.action === 'allocation') return verifyApplication(proposal, read, false);
  if (request?.action === 'reverse' && proposal?.action === 'reversal') return verifyApplication(proposal, read, true);
  if (request?.action === 'refund' && proposal?.action === 'refund') return verifyRefund(proposal, read);
  fail('The original prepayment action could not be verified.');
}
