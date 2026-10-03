import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyXeroFinancialPayment } from '../api/_xeroFinancialSync.js';
import { prepareGroupRemittancePayment, durableGroupBankMarker } from '../api/_xeroGroupRemittanceControls.js';
import { resolveGroupRemittanceBankEvidence } from '../api/_xeroGroupRemittanceBankEvidence.js';
import { buildBuyerPaymentDocumentEvidence } from '../api/_xeroBuyerPaymentEvidence.js';
import { loadRemittanceInventory, enrichGroupRemittanceBankSources } from '../api/_xeroRemittanceInventory.js';
import { reconciliationBucket } from '../src/lib/financialWorkflowUi.js';

const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const key = (prefix, n) => `${prefix}${String(n).padStart(12, '0')}`;
const clone = structuredClone;
const ids = { tenant: uuid(1), invoice: uuid(2), bank: uuid(3), mapping: uuid(4), payment: uuid(5), contact: uuid(6), bankMapping: uuid(7), claim: uuid(8) };
function fixture() {
  const common = { IsDeleted: false, Name: 'GROUP RECEIPT', CreatedDate: '2026-01-02T00:00:00Z', LastModifiedDate: '2026-01-02T00:00:01Z',
    Date__c: '2026-01-02', Supplier_Invoice__c: null, Reference__c: null, Is_Deposit__c: false, Is_Volume_Discount__c: false,
    Commission_Invoice__c: null, CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] } };
  const parent = { ...clone(common), Id: key('a0S', 1), RecordType: { DeveloperName: 'Receivable_Remittance' }, Account__c: key('001', 1),
    Amount__c: 100, Bank__c: 'UBS', Remittance__c: null, STEM__c: null };
  const siblings = [2, 3].map(n => ({ ...clone(common), Id: key('a0S', n), Name: `Allocation ${n}`,
    RecordType: { DeveloperName: 'Receivable' }, Account__c: key('001', n), Amount__c: 50,
    Bank__c: null, Remittance__c: parent.Id, STEM__c: key('a0H', n) }));
  const accounts = [1, 2, 3].map(n => ({ Id: key('001', n), Name: n === 1 ? 'GROUP - FC' : 'FRATELLI COSULICH UNIPESSOAL SA',
    IsDeleted: false, Inactive_Suspended__c: false, RecordType: { DeveloperName: n === 1 ? 'Group' : 'Buyer_Supplier' },
    ParentId: n === 1 ? null : parent.Account__c, Company_Code__c: n === 1 ? 'GROUP - FC' : `HK DISTINCT ${n}`, LastModifiedDate: '2026-01-01T00:00:00Z' }));
  const inventories = siblings.map((child, index) => ({ stemId: child.STEM__c, complete: true, creditFields: [], records: [{
    Id: key('a0K', index + 1), Name: `${25000 + index}T-INV-1`, IsDeleted: false, STEM__c: child.STEM__c,
    STEM__r: { Account__c: child.Account__c }, Amount__c: 50, Proforma__c: false, Deprecated__c: false,
    Invoice_Date__c: '2025-12-25', Invoice_Due_Date__c: '2026-01-02', CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] },
  }] }));
  const payment = siblings[0];
  const rebuild = () => {
    const result = resolveGroupRemittanceBankEvidence(payment, { parent, siblings, visiblePayments: [parent, ...siblings], accounts,
      buyerDocumentInventories: inventories, complete: true });
    assert.equal(result.eligible, true, result.blocker); payment._groupBankEvidence = result.evidence;
    payment._buyerDocumentEvidence = buildBuyerPaymentDocumentEvidence(payment.STEM__c, inventories[0].records, { complete: true });
  };
  rebuild();
  const mapping = { id: ids.mapping, salesforce_object: 'Invoice__c', salesforce_id: inventories[0].records[0].Id,
    xero_document_id: ids.invoice, xero_document_type: 'ACCREC', xero_contact_id: ids.contact, source_fingerprint: 'a'.repeat(64),
    protected_legacy: true, retained_differences: { accountId: payment.Account__c, stemId: payment.STEM__c } };
  const document = { id: ids.invoice, type: 'ACCREC', status: 'AUTHORISED', contactId: ids.contact, currency: 'USD', total: 50, amountDue: 50 };
  const bank = { id: ids.bankMapping, salesforce_bank_name: 'UBS', xero_bank_account_id: ids.bank, enabled: true, revision: 1 };
  const bankAccount = { AccountID: ids.bank, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' };
  const actual = { PaymentID: ids.payment, Status: 'AUTHORISED', PaymentType: 'ACCRECPAYMENT', Amount: 50,
    BankAmount: 50, CurrencyRate: 1, Date: payment.Date__c, Reference: payment.Name,
    Account: { AccountID: ids.bank, CurrencyCode: 'USD' },
    Invoice: { InvoiceID: ids.invoice, Type: 'ACCREC', CurrencyCode: 'USD', Contact: { ContactID: ids.contact } } };
  const context = { tenantId: ids.tenant, groupPaymentControlsComplete: true, existingBySalesforce: new Map(), paymentMappings: [],
    paymentPostingClaims: new Map(), documentMappingById: new Map([[ids.mapping, mapping]]), documentBySupplierInvoice: new Map(),
    buyerByStem: new Map([[payment.STEM__c, [mapping]]]), currentDocumentById: new Map([[ids.invoice, document]]),
    bankByName: new Map([['UBS', bank]]), bankAccounts: new Map([[ids.bank, bankAccount]]), organisation: { baseCurrency: 'USD' }, xeroPayments: [] };
  return { payment, parent, siblings, accounts, inventories, rebuild, mapping, document, bank, bankAccount, actual, context,
    classify: () => classifyXeroFinancialPayment(payment, context) };
}
const assertHeld = f => { const row = f.classify(); assert.equal(row.status, 'blocked', row.blockers.join('; '));
  assert.equal(row.action, 'blocked'); assert.equal(row.proposedPayment, null); assert.equal(reconciliationBucket(row, 'payment'), 'attention'); return row; };
function exactAccepted(f, { claim = true } = {}) {
  f.context.xeroPayments = [f.actual];
  const initial = f.classify(); assert.equal(initial.action, 'payment_link', initial.blockers.join('; '));
  const saved = { salesforce_payment_id: f.payment.Id, salesforce_payment_name: f.payment.Name, document_mapping_id: ids.mapping,
    xero_payment_id: ids.payment, xero_bank_account_id: ids.bank, source_fingerprint: initial.sourceFingerprint,
    amount: 50, currency: 'USD', payment_date: f.payment.Date__c, status: 'linked', exception_reason: null,
    bank_source_evidence: clone(initial.bankSourceEvidence), retained_reference: {} };
  f.context.existingBySalesforce.set(f.payment.Id, saved); f.context.paymentMappings.push(saved);
  const reviewed = Object.fromEntries(['salesforcePaymentId', 'salesforcePaymentName', 'documentMappingId', 'xeroPaymentId', 'bankAccountId',
    'amount', 'currency', 'paymentDate', 'sourceFingerprint', 'bankSourceEvidence', 'documentMappingSnapshot', 'bankMappingSnapshot'].map(name => [name, clone(initial[name])]));
  const posting = { id: ids.claim, status: 'completed', control_totals: { paymentPosting: { state: 'group_linked', tenantId: ids.tenant,
    paymentId: f.payment.Id, reviewed, confirmedPaymentId: ids.payment, observedPaymentIds: [ids.payment] } } };
  if (claim) f.context.paymentPostingClaims.set(f.payment.Id, posting);
  return { initial, saved, posting };
}

test('Group source proof derives only runtime bank and keeps original raw bank/Account/reference unchanged', () => {
  const f = fixture(); const before = clone(f.payment); const prepared = prepareGroupRemittancePayment(f.payment, f.context);
  assert.equal(prepared.payment.Bank__c, 'UBS'); assert.deepEqual(f.payment, before); assert.equal(f.payment.Bank__c, null);
  assert.equal(prepared.payment.Account__c, before.Account__c); assert.equal(prepared.payment.Reference__c, null);
  const row = f.classify(); assert.equal(row.action, 'payment_apply', row.blockers.join('; '));
  assert.deepEqual(row.bankSourceEvidence, f.payment._groupBankEvidence);
  assert.deepEqual(row.documentMappingSnapshot, f.mapping); assert.deepEqual(row.bankMappingSnapshot, f.bank);
  assert.equal(row.proposedPayment.Account.AccountID, ids.bank); assert.equal(row.proposedPayment.Invoice.InvoiceID, ids.invoice);
});

test('missing document links become Waiting only after full source and current bank/controls validation', () => {
  const f = fixture(); f.context.buyerByStem.clear(); f.context.documentMappingById.clear();
  const row = f.classify(); assert.equal(row.status, 'blocked'); assert.equal(reconciliationBucket(row, 'payment'), 'waiting');
  assert.equal(row.proposedPayment, null); assert.ok(row.blockerCodes.every(code => code === 'invoice_link_pending'));
  assert.deepEqual(row.bankSourceEvidence, f.payment._groupBankEvidence); assert.equal(row.documentMappingSnapshot, undefined);
  assert.equal(f.payment.Bank__c, null);
  delete f.context.groupPaymentControlsComplete; assertHeld(f);
});

for (const [name, mutate] of [
  ['absent completeness', f => { delete f.context.groupPaymentControlsComplete; }],
  ['false completeness', f => { f.context.groupPaymentControlsComplete = false; }],
  ['missing mappings', f => { f.context.paymentMappings = null; }],
  ['missing claims', f => { f.context.paymentPostingClaims = {}; }],
  ['disabled bank', f => { f.bank.enabled = false; }],
  ['unknown approval revision', f => { f.bank.revision = 0; }],
  ['foreign bank source name', f => { f.bank.salesforce_bank_name = 'DBS'; }],
  ['missing approved bank', f => { f.context.bankByName.clear(); }],
  ['archived bank', f => { f.bankAccount.Status = 'ARCHIVED'; }],
  ['nonbank account', f => { f.bankAccount.Type = 'CURRENT'; }],
  ['bank FX', f => { f.bankAccount.CurrencyCode = 'HKD'; }],
  ['organisation FX', f => { f.context.organisation.baseCurrency = 'HKD'; }],
  ['missing bank snapshot', f => { f.context.bankAccounts.clear(); }],
  ['source completeness failure', f => { f.payment._groupBankEvidenceBlocker = 'Current source capture incomplete'; }],
  ['source unknown proof', f => { f.payment._groupBankEvidence = null; }],
  ['source drift', f => { f.payment.Amount__c = 49.99; }],
]) test(`Group controls retain Attention on ${name}`, () => { const f = fixture(); mutate(f); assertHeld(f); });

for (const status of ['linked', 'applied', 'protected', 'exception', null]) test(`parent payment mapping in ${status} status blocks its allocations`, () => {
  const f = fixture(); f.context.paymentMappings.push({ salesforce_payment_id: f.parent.Id, status });
  assert.match(assertHeld(f).blockers.join(' '), /header has an existing payment mapping or posting claim/);
});
for (const status of ['processing', 'completed', 'failed', 'cancelled', null]) test(`parent posting claim in ${status} status blocks its allocations`, () => {
  const f = fixture(); f.context.paymentPostingClaims.set(f.parent.Id, { status });
  assert.match(assertHeld(f).blockers.join(' '), /header has an existing payment mapping or posting claim/);
});

test('exact existing payment receives full proof and unchanged Group link stays protected with its exact-link journal', () => {
  const f = fixture(); const { initial } = exactAccepted(f);
  assert.equal(initial.proposedPayment, null); assert.equal(initial.status, 'eligible');
  const row = f.classify(); assert.equal(row.action, 'payment_link', row.blockers.join('; '));
  assert.equal(row.status, 'protected'); assert.equal(row.proposedPayment, null); assert.equal(row.paymentPostingClaimId, ids.claim);
  assert.deepEqual(row.bankSourceEvidence, initial.bankSourceEvidence);
});

test('retained-reference review binds full Group proof and requires its own explicit review without a POST payload', () => {
  const f = fixture(); f.actual.Reference = 'HISTORICAL-REMITTANCE'; f.context.xeroPayments = [f.actual];
  const row = f.classify(); assert.equal(row.action, 'payment_reference_link', row.blockers.join('; '));
  assert.equal(row.status, 'eligible'); assert.equal(row.proposedPayment, null); assert.equal(row.reviewRequired, true);
  assert.deepEqual(row.retainedReferenceEvidence.bankSourceEvidence, row.bankSourceEvidence);
  assert.equal(row.referenceComparison.sourceReference, null); assert.equal(row.referenceComparison.xeroReference, f.actual.Reference);
  assert.equal(f.payment.Reference__c, null); assert.equal(f.payment.Bank__c, null);
});

test('accepted Group reference retains both immutable proofs and its completed journal on current replay', () => {
  const f = fixture(); f.actual.Reference = 'HISTORICAL-REMITTANCE'; f.context.xeroPayments = [f.actual];
  const initial = f.classify(); assert.equal(initial.action, 'payment_reference_link');
  const saved = { salesforce_payment_id: f.payment.Id, document_mapping_id: ids.mapping, xero_payment_id: ids.payment,
    xero_bank_account_id: ids.bank, source_fingerprint: initial.sourceFingerprint, status: 'linked', exception_reason: null,
    amount: 50, currency: 'USD', payment_date: f.payment.Date__c, bank_source_evidence: clone(initial.bankSourceEvidence),
    retained_reference: { version: 1, tenantId: ids.tenant, sourceFingerprint: initial.sourceFingerprint,
      referenceReviewFingerprint: initial.referenceReviewFingerprint, evidence: clone(initial.retainedReferenceEvidence) } };
  const reviewed = Object.fromEntries(['salesforcePaymentId', 'salesforcePaymentName', 'documentMappingId', 'xeroPaymentId', 'bankAccountId',
    'amount', 'currency', 'paymentDate', 'sourceFingerprint', 'referenceReviewFingerprint', 'retainedReferenceEvidence',
    'bankSourceEvidence', 'documentMappingSnapshot', 'bankMappingSnapshot'].map(name => [name, clone(initial[name])]));
  f.context.existingBySalesforce.set(f.payment.Id, saved); f.context.paymentMappings.push(saved);
  f.context.paymentPostingClaims.set(f.payment.Id, { id: ids.claim, status: 'completed', control_totals: { paymentPosting: {
    state: 'reference_linked', tenantId: ids.tenant, paymentId: f.payment.Id, reviewed, confirmedPaymentId: ids.payment } } });
  const row = f.classify(); assert.equal(row.action, 'payment_link', row.blockers.join('; ')); assert.equal(row.status, 'protected');
  assert.equal(row.acceptedReference, true); assert.equal(row.proposedPayment, null); assert.equal(row.paymentPostingClaimId, ids.claim);
  assert.deepEqual(row.bankSourceEvidence, initial.bankSourceEvidence);
  f.context.paymentPostingClaims.clear(); assertHeld(f);
});

test('Group exact-link journal cannot hide changed status or confirmed target identity', () => {
  for (const mutate of [posting => { posting.status = 'failed'; },
    posting => { posting.control_totals.paymentPosting.confirmedPaymentId = uuid(99); },
    posting => { posting.control_totals.paymentPosting.reviewed.bankSourceEvidence = null; }]) {
    const f = fixture(); const { posting } = exactAccepted(f); mutate(posting); assertHeld(f);
  }
});

for (const [name, mutate] of [
  ['removed current source proof', f => { delete f.payment._groupBankEvidence; }],
  ['direct bank replacement after accepted Group proof', f => { delete f.payment._groupBankEvidence; f.payment.Bank__c = 'UBS'; }],
  ['changed membership', f => { f.accounts[1].Company_Code__c = 'HK NEW'; f.rebuild(); }],
  ['changed visible raw reference', f => { f.payment.Reference__c = 'New reference'; }],
  ['saved null proof', (_f, saved) => { saved.bank_source_evidence = null; }],
  ['saved array proof', (_f, saved) => { saved.bank_source_evidence = []; }],
  ['saved unknown policy', (_f, saved) => { saved.bank_source_evidence.policyVersion = 'unknown'; }],
  ['saved tampered raw parent', (_f, saved) => { saved.bank_source_evidence.source.parent.Amount__c = 100.01; }],
  ['source ID changed', f => { f.payment.Id = key('a0S', 999); }],
]) test(`durable Group marker cannot downgrade on ${name}`, () => { const f = fixture(); const { saved } = exactAccepted(f); mutate(f, saved); assertHeld(f); });

test('legacy existing payment mapping cannot be silently upgraded to newly derived Group bank authority', () => {
  const f = fixture(); const { saved } = exactAccepted(f, { claim: false }); delete saved.bank_source_evidence;
  assert.match(assertHeld(f).blockers.join(' '), /no reviewed Group bank-source evidence/);
});

test('Group mapping marker null, unknown, primitive and malformed shapes remain durable holds', () => {
  for (const value of [null, [], 'bad', 0, { policyVersion: 'unknown' }]) assert.equal(durableGroupBankMarker({ bank_source_evidence: value }), true);
  assert.equal(durableGroupBankMarker({}), false); assert.equal(durableGroupBankMarker({ bank_source_evidence: {} }), false);
});

for (const [name, mutate] of [
  ['different debtor Account', f => { f.mapping.retained_differences.accountId = f.siblings[1].Account__c; }],
  ['different source invoice', f => { f.mapping.salesforce_id = f.inventories[1].records[0].Id; }],
  ['different STEM', f => { f.mapping.retained_differences.stemId = f.siblings[1].STEM__c; }],
  ['missing mapped Account', f => { delete f.mapping.retained_differences.accountId; }],
  ['current Contact drift', f => { f.document.contactId = uuid(99); }],
  ['current invoice currency drift', f => { f.document.currency = 'HKD'; }],
  ['current invoice voided', f => { f.document.status = 'VOIDED'; }],
  ['current bank settlement mismatch', f => { f.context.xeroPayments = [f.actual]; f.actual.Account.AccountID = uuid(99); }],
  ['duplicate existing payments', f => { f.context.xeroPayments = [f.actual, { ...clone(f.actual), PaymentID: uuid(99) }]; }],
  ['current invoice amount due below allocation', f => { f.document.amountDue = 49; }],
]) test(`Group bank proof does not waive ${name}`, () => { const f = fixture(); mutate(f); assertHeld(f); });

test('non-Group ordinary Receivable and bankless hold retain legacy classification without new control flags', () => {
  const f = fixture(); delete f.payment._groupBankEvidence; f.payment.Bank__c = 'UBS'; delete f.context.groupPaymentControlsComplete;
  const row = f.classify(); assert.equal(row.action, 'payment_apply', row.blockers.join('; ')); assert.equal(row.bankSourceEvidence, undefined);
  assert.equal(row.bankEvidence, undefined); assert.equal(row.bankMappingSnapshot, undefined);
  f.payment.Bank__c = null; assertHeld(f);
});

async function collect(f, { visible = [f.payment], mutateResult = () => {} } = {}) {
  const calls = []; const raw = visible.map(row => { const copy = clone(row); delete copy._groupBankEvidence; return copy; });
  const queryAll = async (query, options) => {
    calls.push({ query, options });
    const records = /FROM Account/.test(query) ? f.accounts
      : /FROM Invoice__c/.test(query) ? f.inventories.flatMap(item => item.records)
        : /WHERE Remittance__c IN/.test(query) ? f.siblings : [f.parent];
    const result = { records: clone(records), totalSize: records.length, done: true }; mutateResult(result, query); return result;
  };
  const inventory = await loadRemittanceInventory(raw, { queryAll, fields: 'Id, IsDeleted, RecordType.DeveloperName', withCurrency: row => row });
  const rows = await enrichGroupRemittanceBankSources(raw, { inventory, queryAll, creditFields: [], invoiceCurrencyFields: '',
    currencyForInvoice: row => row._currency });
  return { inventory, rows, calls };
}

test('real source collector keeps complete nonvisible family and exact current Account/invoice scope', async () => {
  const f = fixture(); const collected = await collect(f);
  assert.equal(collected.calls.length, 4); assert.equal(collected.inventory.siblings.length, 2);
  assert.ok(collected.calls.every(call => !/Date__c\s*>=/.test(call.query)));
  assert.equal(collected.rows.length, 1); assert.equal(collected.rows[0].Bank__c, null);
  assert.deepEqual(collected.rows[0]._groupBankEvidence, f.payment._groupBankEvidence);
  f.context.buyerByStem.clear(); f.context.documentMappingById.clear();
  const row = classifyXeroFinancialPayment(collected.rows[0], f.context);
  assert.equal(reconciliationBucket(row, 'payment'), 'waiting'); assert.equal(row.proposedPayment, null);
});

test('real collector never omits a nonvisible negative/deleted sibling to derive bank', async () => {
  for (const change of [f => { f.siblings[1].Amount__c = -50; }, f => { f.siblings[1].IsDeleted = true; },
    f => { f.inventories[1].records[0].Name = '25001T-CN-1'; }]) {
    const f = fixture(); change(f); const collected = await collect(f);
    assert.equal(collected.rows[0]._groupBankEvidence, undefined); assert.ok(collected.rows[0]._groupBankEvidenceBlocker);
    const row = classifyXeroFinancialPayment(collected.rows[0], f.context);
    assert.equal(reconciliationBucket(row, 'payment'), 'attention'); assert.equal(row.proposedPayment, null);
  }
});

test('real collector fails closed on incomplete Account or source-invoice reads', async () => {
  for (const target of ['Account', 'Invoice__c']) {
    const f = fixture(); const collected = await collect(f, { mutateResult: (result, query) => {
      if (query.includes(`FROM ${target}`)) result.done = false;
    } });
    assert.equal(collected.rows[0]._groupBankEvidence, undefined);
    const row = classifyXeroFinancialPayment(collected.rows[0], f.context);
    assert.equal(reconciliationBucket(row, 'payment'), 'attention'); assert.equal(row.proposedPayment, null);
  }
});

test('real collector retains distinct same-name debtor Accounts and blocks current ParentId drift', async () => {
  const f = fixture(); f.accounts[2].ParentId = key('001', 999);
  const collected = await collect(f);
  assert.equal(collected.rows[0]._groupBankEvidence, undefined);
  assert.match(collected.rows[0]._groupBankEvidenceBlocker, /direct member/);
});
