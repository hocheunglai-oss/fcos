import { hkStrippedClKeyNameMatchKey, normalizeName } from './_xeroContactSync.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import {
  buildXeroPrepaymentAllocation, buildXeroPrepaymentAllocationReversal, buildXeroPrepaymentCreate,
  buildXeroPrepaymentRefund, xeroPrepaymentEvidenceFingerprint as hash,
} from './_xeroPrepaymentCurrency.js';
import { resolvePrepaymentPostingPolicy } from './_xeroPrepaymentPolicy.js';
import { prepaymentApprovalEvidence, prepaymentSourceFingerprint, reconcilePrepaymentLedger } from './_xeroPrepaymentReconciliation.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sameSource = (left, right) => Boolean(left && right && left.slice(0, 15) === right.slice(0, 15));

function fail(message, code = 'XERO_PREPAYMENT_REVIEW_INCOMPLETE') {
  throw Object.assign(new Error(message), { code, status: 409, expose: true });
}

function one(rows, label) {
  if (rows.length !== 1) fail(`Exactly one ${label} is required.`);
  return rows[0];
}

function exactBank(context, event) {
  const mapping = one(context.bankMappings.filter((row) => row.enabled === true
    && normalizeName(row.salesforce_bank_name) === normalizeName(event.Bank__c)), 'enabled Finance bank mapping');
  const account = one(context.accounts.filter((row) => row.AccountID === mapping.xero_bank_account_id), 'mapped Xero bank account');
  if (!UUID.test(mapping.id || '') || !Number.isInteger(mapping.revision) || mapping.revision < 1
    || account.Status !== 'ACTIVE' || account.Type !== 'BANK' || account.CurrencyCode !== event.Bank_Currency__c
    || account.Name !== mapping.xero_bank_account_name || (mapping.xero_bank_account_code && mapping.xero_bank_account_code !== account.Code)) {
    fail('The Finance bank mapping changed or does not match the active cash currency.');
  }
  return { account, evidence: { id: account.AccountID, name: account.Name, code: account.Code ?? null,
    currency: account.CurrencyCode, mappingId: mapping.id, revision: mapping.revision } };
}

function exactContact(context, event, contactId) {
  if (!UUID.test(contactId || '') || event.Party__r?.Inactive_Suspended__c !== false) fail('An exact active Salesforce party and Xero contact are required.');
  const contact = one(context.contacts.filter((row) => row.ContactID === contactId), 'selected Xero contact');
  const names = [normalizeName(event.Party__r.Name), hkStrippedClKeyNameMatchKey(event.Party__r.Company_Code__c)].filter(Boolean);
  if (contact.ContactStatus !== 'ACTIVE' || contact.MergedToContactID || !names.includes(normalizeName(contact.Name))) {
    fail('The active Xero contact does not match the Salesforce party.');
  }
  return { ...contact, SalesforceAccountID: event.Party__c };
}

function assertUnlocked(organisation, date) {
  const locks = [organisation.PeriodLockDate, organisation.EndOfYearLockDate].filter(Boolean).map(xeroPaymentDate);
  if (!date || locks.some((lock) => !lock || date <= lock)) fail('The exact accounting date is locked or could not be verified.', 'XERO_PREPAYMENT_PERIOD_LOCKED');
}

function assertNoDepositConflict(context, proposal) {
  if (context.bankDiscovery?.complete !== true || !Array.isArray(context.bankDiscovery.rows)) {
    fail('Complete Xero deposit discovery is required before reviewing a new deposit.');
  }
  const { evidence } = proposal;
  const mapped = new Set(context.operations.filter((row) => row.action === 'create' && row.status === 'applied')
    .map((row) => row.xero_bank_transaction_id));
  if (context.bankDiscovery.rows.some((row) => row.Reference === evidence.bankReference
    || (!mapped.has(row.BankTransactionID) && row.Type === proposal.payload.BankTransactions[0].Type
      && row.Contact?.ContactID === evidence.contactId && row.BankAccount?.AccountID === evidence.bank.id
      && row.CurrencyCode === evidence.currency && xeroPaymentDate(row.Date) === evidence.date
      && Math.round(Number(row.Total) * 100) === Math.round(evidence.nativeAmount * 100)))) {
    fail('An existing Xero deposit may already represent this cash event.', 'XERO_PREPAYMENT_CREATE_AMBIGUOUS');
  }
}

function exactInvoice(context, allocation) {
  const id = allocation.Buyer_Invoice__c || allocation.Supplier_Invoice__c;
  const object = allocation.Buyer_Invoice__c ? 'Invoice__c' : 'Supplier_Invoice__c';
  const document = one(context.invoices.filter((row) => sameSource(row.Id, id)), 'final Salesforce document');
  const mapping = one(context.documentMappings.filter((row) => sameSource(row.salesforce_id, id)
    && row.salesforce_object === object), 'final invoice mapping');
  const invoice = one(context.xeroInvoices.filter((row) => row.InvoiceID === mapping.xero_document_id), 'final Xero invoice');
  const proof = one((context.invoiceClassifications || []).filter((row) => sameSource(row.salesforceId, id)), 'fresh invoice classification');
  if (proof.status !== 'eligible' || !['link', 'protected_legacy'].includes(proof.action)
    || !Array.isArray(proof.blockers) || proof.blockers.length || !Array.isArray(proof.differences) || proof.differences.length
    || proof.xero?.id !== invoice.InvoiceID || !/^[a-f0-9]{64}$/.test(proof.sourceFingerprint || '')
    || proof.sourceFingerprint !== mapping.source_fingerprint) fail('Current invoice classification does not corroborate the durable mapping.');
  return { document, mapping, invoice, sourceFingerprint: proof.sourceFingerprint };
}

/** Build private reviewed evidence from server-loaded context. The request supplies selection only. */
export function buildPrepaymentReview(context, body, { ignoreOperationId = null } = {}) {
  const { action, sourceId } = body;
  if (!['create', 'allocate', 'reverse', 'refund'].includes(action)) fail('The prepayment action is unavailable.');
  const source = one((['create', 'refund'].includes(action) ? context.events : context.allocations)
    .filter((row) => row.Id === sourceId), 'selected Salesforce cash source');
  const cashEventId = source.Cash_Event__c || source.Original_Cash_Event__c || source.Id;
  const event = one(context.events.filter((row) => row.Id === cashEventId && row.Kind__c === 'Payment'), 'original cash event');
  if (!['USD', 'HKD'].includes(event.Trade_FX_Side__r?.Currency__c)
    || event.Trade_FX_Side__r.Currency__c !== event.Currency__c) fail('The agreed trade-side currency is missing or changed.');
  if (ignoreOperationId) {
    const original = one(context.operations.filter((row) => row.operation_id === ignoreOperationId), 'original pre-send claim');
    if (original.source_id !== sourceId || original.action !== action || original.status !== 'processing' || original.send_started_at) {
      fail('Only the exact unsent claim can be excluded from the fresh review.');
    }
  }
  if (context.operations.some((row) => sameSource(row.source_id, sourceId) && row.action === action
    && row.status !== 'cancelled_before_send' && row.operation_id !== ignoreOperationId)) {
    fail('Use the original prepayment operation for this source and action.');
  }
  const reconcileContext = { ...context, operations: context.operations.filter((row) => row.operation_id !== ignoreOperationId) };
  const balance = reconcilePrepaymentLedger(reconcileContext).balances.get(cashEventId);
  const organisation = context.organisation;
  if (!balance || organisation?.BaseCurrency !== 'USD' || !UUID.test(organisation.OrganisationID || '')) {
    fail('The reconciled cash balance or USD organisation evidence is unavailable.');
  }
  const agreedCurrency = event.Trade_FX_Side__r.Currency__c;
  let bank = action === 'reverse' ? null : exactBank(context, action === 'refund' ? source : event);
  let proposal; let policy; let contact; let invoice; let prepayment; let postingDate;
  if (action === 'create') {
    const current = resolvePrepaymentPostingPolicy(context.policies, event, context.accounts, context.taxes, context.tenantId);
    contact = exactContact(context, event, body.contactId);
    policy = { ...current.policy, accountName: current.depositAccount.Name };
    proposal = buildXeroPrepaymentCreate({ cashEvent: event, agreedCurrency, organisation, bankAccount: bank.account,
      contact, depositAccount: current.depositAccount, zeroTaxRate: current.zeroTaxRate });
    assertNoDepositConflict(context, proposal);
    postingDate = proposal.evidence.date;
  } else {
    const create = one(context.operations.filter((row) => sameSource(row.cash_event_id, cashEventId)
      && row.action === 'create' && row.status === 'applied'), 'applied original deposit');
    prepayment = one(context.xeroPrepayments.filter((row) => row.PrepaymentID === create.xero_prepayment_id), 'mapped Xero prepayment');
    policy = create.request_evidence?.immutableContext?.policy;
    if (policy?.direction !== event.Direction__c || policy?.currency !== event.Currency__c || !Number.isInteger(policy?.revision)
      || policy.revision < 1 || !policy.accountCode || !policy.taxType) fail('The applied deposit posting policy is unavailable.');
    contact = exactContact(context, event, create.request_evidence?.proposal?.evidence?.contactId);
    if (action === 'reverse') {
      const originalBank = create.request_evidence.immutableContext.bank;
      if (!UUID.test(originalBank?.id || '') || originalBank.currency !== event.Currency__c
        || create.request_evidence.proposal.evidence.bank?.id !== originalBank.id) {
        fail('The applied deposit bank evidence is unavailable.');
      }
      bank = { evidence: originalBank };
    }
    const common = { agreedCurrency, organisation, bankAccount: bank.account, contact, prepayment };
    if (action === 'refund') {
      proposal = buildXeroPrepaymentRefund({ ...common, refundEvent: source, originalEvent: event });
      postingDate = proposal.evidence.date;
    } else if (action === 'allocate') {
      invoice = exactInvoice(context, source);
      proposal = buildXeroPrepaymentAllocation({ ...common, allocation: source, cashEvent: event,
        document: invoice.document, invoiceMapping: invoice.mapping, invoice: invoice.invoice });
      postingDate = proposal.evidence.allocationDate;
    } else {
      const allocation = one(context.allocations.filter((row) => row.Id === source.Reverses_Allocation__c), 'original Salesforce allocation');
      const applied = one(context.operations.filter((row) => sameSource(row.source_id, allocation.Id)
        && row.action === 'allocate' && row.status === 'applied'), 'applied original allocation');
      invoice = exactInvoice(context, allocation);
      if (applied.invoice_mapping_id !== invoice.mapping.id || applied.xero_prepayment_id !== prepayment.PrepaymentID) {
        fail('The applied allocation does not belong to this invoice and prepayment.');
      }
      proposal = buildXeroPrepaymentAllocationReversal({ reversal: source, prepayment, invoice: invoice.invoice,
        originalAllocation: { ...allocation, Xero_Prepayment_Id__c: applied.xero_prepayment_id,
          Xero_Allocation_Id__c: applied.xero_allocation_id, Xero_Invoice_Id__c: invoice.invoice.InvoiceID } });
      postingDate = xeroPaymentDate(one(prepayment.Allocations.filter((row) => row.AllocationID === applied.xero_allocation_id),
        'live original allocation').Date);
    }
  }
  assertUnlocked(organisation, postingDate);
  const currency = source.Currency__c;
  const accountingUsd = Math.abs(Number(source.Cash_Event__c ? source.Allocated_Cash_USD__c : source.Cash_USD_Amount__c));
  const nativeAmount = currency === 'USD' ? accountingUsd
    : Math.abs(Number(source.Cash_Event__c ? source.Allocated_HKD__c : source.Cash_HKD_Amount__c));
  const base = {
    sourceId, action, cashEventId, status: 'eligible', currency, nativeAmount, accountingUsd, invoiceMappingId: invoice?.mapping.id ?? null,
    sourceFingerprint: prepaymentSourceFingerprint(source), proposal,
    immutableContext: {
      approvalHash: hash(prepaymentApprovalEvidence(reconcileContext)), bank: bank.evidence, policy,
      contact: { id: contact.ContactID, name: contact.Name, accountNumber: contact.AccountNumber ?? null },
      balance, postingDate, prepaymentId: prepayment?.PrepaymentID ?? null,
      prepaymentRemainingNative: prepayment ? Number(prepayment.RemainingCredit) : null,
      invoiceSourceFingerprint: invoice?.sourceFingerprint ?? null,
      invoice: invoice ? { name: invoice.document.Name ?? null, amountDue: Number(invoice.invoice.AmountDue) } : null,
    },
  };
  return { ...base, reviewFingerprint: hash(base) };
}
