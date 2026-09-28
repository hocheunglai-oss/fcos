import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialClassifications, classifyXeroFinancialDocument as classifyDocument, xeroReviewFingerprint, blockRepeatedFinancialTargets } from '../api/_xeroFinancialSync.js';

const classifyXeroFinancialDocument = (source, candidates, options = {}) => classifyDocument(source, candidates, { ...options, organisation: { baseCurrency: 'USD', ...options.organisation } });

const account = { accountId: 'account-a', accountName: 'SHENGQING BUNKERS (HK) LTD', companyCode: 'HKSHENGQING' };
const sharedAccounts = [account, { ...account, accountId: 'account-b', companyCode: 'HKSHENGQING BUNKERS (HK) LTD' }];
const line = { description: 'Fuel · 194.31 MT', quantity: 1, unitAmount: 121832.37, accountCode: '41100', taxType: 'NONE' };
function source(overrides = {}) { return { salesforceObject: 'Invoice__c', salesforceId: 'sf-invoice', ...account, contactName: account.accountName,
  documentNumber: '25070T-INV-1', xeroType: 'ACCREC', xeroCollection: 'Invoices', contactId: 'contact', currency: 'USD', total: 121832.37,
  invoiceDate: '2026-01-28', dueDate: '2026-02-25', deliveryDate: '2026-01-27', stemKey: 'HK2625070T', stemName: 'HK2625070T - HUAYUE - HONG KONG',
  reference: 'HK2625070T · Salesforce buyer invoice', lines: [line], blockers: [],
  readiness: { ready: true, blockers: [], file: 'synthetic-issued-source.pdf' },
  sharedContactAccounts: sharedAccounts, ...overrides }; }
function xero(overrides = {}) { return { id: 'xero-invoice', type: 'ACCREC', collection: 'Invoices', status: 'AUTHORISED', contactId: 'contact', contactName: account.accountName,
  currency: 'USD', total: 121832.37, amountDue: 121832.37, amountPaid: 0, amountCredited: 0, invoiceNumber: '79402S', date: '2026-01-27', dueDate: '2026-01-27', reference: 'HUAYUE',
  lineItems: [{ LineItemID: 'line-1', Description: 'INVOICED 28/1/2026', Quantity: 1, UnitAmount: 121832.37, AccountCode: '41100', TaxType: 'NONE' }], ...overrides }; }

test('observed same-name shared Contact becomes a Finance-reviewed safe update with both exact Account IDs', () => {
  const result = classifyXeroFinancialDocument(source(), [xero()]);
  assert.equal(result.status, 'eligible'); assert.equal(result.action, 'safe_update'); assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.matchEvidence.sharedAccounts.map(a => a.accountId), ['account-a', 'account-b']);
  assert.equal(result.matchEvidence.basis, 'date_amount'); assert.match(result.warnings.join(' '), /shared/); assert.deepEqual(result.blockers, []);
});
test('different-name shared Contact cannot use weak legacy date/amount evidence', () => {
  const result = classifyXeroFinancialDocument(source({ sharedContactAccounts: [account, { ...account, accountId: 'other', accountName: 'Different company' }] }), [xero()]);
  assert.equal(result.status, 'blocked'); assert.match(result.blockers.join(' '), /date and amount alone/);
});
test('ambiguous contact resolution never picks the first matching Contact for any operation', () => {
  const sf = { buyers: [{ Id: 'sf', Name: 'INV', Amount__c: 100, Invoice_Date__c: '2026-01-01', STEM__r: { Account__c: 'a', Account__r: { Name: 'Buyer', Company_Code__c: 'HKKEY' } } }], suppliers: [], lines: [], extras: [] };
  const result = buildFinancialClassifications(sf, { contacts: [{ id: 'c1', name: 'Buyer', status: 'ACTIVE' }, { id: 'c2', name: 'KEY', status: 'ACTIVE' }], documents: [], inactiveDocuments: [], organisation: {} }, { productMappings: [], documentMappings: [] });
  assert.equal(result.rows[0].contactId, null); assert.equal(result.rows[0].status, 'blocked'); assert.equal(result.rows[0].proposedPayload, null);
});
test('conflicting saved document and exact number always block rather than overwriting the saved target', () => {
  const result = classifyXeroFinancialDocument(source(), [xero(), xero({ id: 'second', invoiceNumber: '25070T-INV-1' })], { storedMapping: { xero_document_id: 'xero-invoice' } });
  assert.equal(result.status, 'blocked'); assert.match(result.blockers.join(' '), /conflicting_document_identity/);
  assert.deepEqual(result.matchEvidence.candidates.map(r => r.id), ['xero-invoice', 'second']);
});
test('same supplier invoice number on different Contacts is not a duplicate identity', () => {
  const s = source({ xeroType: 'ACCPAY', sharedContactAccounts: [] });
  const result = classifyXeroFinancialDocument(s, [xero({ type: 'ACCPAY', invoiceNumber: s.documentNumber }), xero({ id: 'other', type: 'ACCPAY', invoiceNumber: s.documentNumber, contactId: 'other-contact' })]);
  assert.equal(result.status, 'eligible'); assert.equal(result.xero.id, 'xero-invoice');
  const conflict = classifyXeroFinancialDocument(s, [xero({ type: 'ACCPAY', invoiceNumber: s.documentNumber }), xero({ id: 'duplicate', type: 'ACCPAY', invoiceNumber: s.documentNumber })]);
  assert.equal(conflict.status, 'blocked');
});
test('an existing shared-Contact document cannot silently follow a reassigned Salesforce Account or Xero Contact', () => {
  for (const mapping of [ { xero_document_id: 'xero-invoice', retained_differences: { accountId: 'old-account' } }, { xero_document_id: 'xero-invoice', xero_contact_id: 'old-contact' } ]) {
    assert.equal(classifyXeroFinancialDocument(source(), [xero()], { storedMapping: mapping }).status, 'blocked');
  }
});
test('full STEM token is evidence even when Salesforce display name includes vessel/port; substring is not', () => {
  const exact = classifyXeroFinancialDocument(source(), [xero({ reference: 'HK2625070T / HUAYUE', date: '2026-02-01' })]);
  assert.equal(exact.matchEvidence.basis, 'stem_reference');
  for (const reference of ['XHK2625070T', 'HK2625070T1']) {
    const result = classifyXeroFinancialDocument(source(), [xero({ reference, date: '2026-02-01' })]);
    assert.equal(result.action, 'create_draft'); assert.equal(result.matchEvidence.basis, null);
  }
});
test('missing and impossible dates never establish a match; near matches prevent duplicate draft creation', () => {
  for (const date of [null, '2026-02-30']) {
    const result = classifyXeroFinancialDocument(source({ invoiceDate: date, deliveryDate: date }), [xero({ date, reference: '' })]);
    assert.equal(result.status, 'blocked'); assert.equal(result.action, 'blocked');
  }
});
test('unique exact owner survives weaker date/amount claim while loser remains blocked', () => {
  const rows = [ { action: 'safe_update', status: 'eligible', xero: { id: 'x' }, matchEvidence: { basis: 'document_number' } }, { action: 'safe_update', status: 'eligible', xero: { id: 'x' }, matchEvidence: { basis: 'date_amount' } } ];
  blockRepeatedFinancialTargets(rows, row => row.xero.id, 'Duplicate claim', row => row.matchEvidence.basis === 'document_number' ? 2 : 0);
  assert.equal(rows[0].status, 'eligible'); assert.equal(rows[1].status, 'blocked'); assert.equal(rows[1].proposedPayload, null);
});
test('protected history with matching economic lines is offered only as a reviewed no-write link', () => {
  const result = classifyXeroFinancialDocument(source(), [xero({ status: 'PAID', amountDue: 0, amountPaid: 121832.37 })]);
  assert.equal(result.action, 'protected_legacy'); assert.equal(result.status, 'eligible'); assert.equal(result.reviewRequired, true); assert.equal(result.acceptedLegacy, false);
  assert.ok(result.differences.some(d => d.field === 'invoiceDate')); assert.match(result.warnings.join(' '), /unchanged/);
});
test('protected accounting code, tax, duplicate-line or amount differences remain exceptions', () => {
  const protectedDoc = xero({ status: 'PAID', amountDue: 0, amountPaid: 121832.37 });
  for (const lines of [ [{ ...protectedDoc.lineItems[0], AccountCode: '999' }], [{ ...protectedDoc.lineItems[0], TaxType: 'INPUT' }], [{ ...protectedDoc.lineItems[0], TaxAmount: 1 }], [{ ...protectedDoc.lineItems[0], LineAmount: 121800 }], [...protectedDoc.lineItems, ...protectedDoc.lineItems] ]) {
    const result = classifyXeroFinancialDocument(source(), [{ ...protectedDoc, lineItems: lines }]);
    assert.equal(result.status, 'protected'); assert.equal(result.reviewRequired, false); assert.ok(result.blockers.length);
  }
});
test('line ordering/whitespace alone is not a difference and duplicate counts remain significant', () => {
  const s = source({ lines: [{ ...line, description: 'Fuel one', unitAmount: 60000 }, { ...line, description: 'Fuel two', unitAmount: 61832.37 }], sharedContactAccounts: [] });
  const document = xero({ invoiceNumber: s.documentNumber, date: s.invoiceDate, dueDate: s.dueDate, reference: s.reference,
    lineItems: [{ Description: ' Fuel   two ', Quantity: 1, UnitAmount: 61832.37, AccountCode: '41100', TaxType: 'NONE' }, { Description: 'Fuel one', Quantity: 1, UnitAmount: 60000, AccountCode: '41100', TaxType: 'NONE' }] });
  const result = classifyXeroFinancialDocument(s, [document]); assert.equal(result.action, 'link'); assert.equal(result.differences.length, 0);
  document.lineItems = [document.lineItems[0], document.lineItems[0]];
  assert.ok(classifyXeroFinancialDocument(s, [document]).differences.length);
});
test('review fingerprint changes when shared identity evidence or required review changes', () => {
  const row = { ...source(), ...classifyXeroFinancialDocument(source(), [xero()]) };
  assert.notEqual(xeroReviewFingerprint(row), xeroReviewFingerprint({ ...row, reviewRequired: false }));
  assert.notEqual(xeroReviewFingerprint(row), xeroReviewFingerprint({ ...row, matchEvidence: { ...row.matchEvidence, sharedAccounts: [account] } }));
});

test('global buyer invoice number on another Contact cannot be bypassed by a legacy fallback or stored link', () => {
  const collision = xero({ id: 'different-contact', contactId: 'other', invoiceNumber: '25070T-INV-1' });
  const candidate = xero();
  const fallback = classifyXeroFinancialDocument(source(), [collision, candidate]);
  assert.equal(fallback.status, 'blocked'); assert.match(fallback.blockers.join(' '), /Contact conflicts/);
  const stored = classifyXeroFinancialDocument(source(), [collision, candidate], { storedMapping: { xero_document_id: candidate.id } });
  assert.equal(stored.status, 'blocked'); assert.match(stored.blockers.join(' '), /conflicting_document_identity/);
});


test('distinct dated invoices with the same Contact and amount remain valid new drafts', () => {
  const result = classifyXeroFinancialDocument(source(), [xero({ date: '2026-02-10', reference: 'HK2629999T', invoiceNumber: 'OTHER-INV' })]);
  assert.equal(result.action, 'create_draft'); assert.equal(result.status, 'eligible');
});
test('same Salesforce full names resolving via one historical CL-key alias remain reviewable', () => {
  const result = classifyXeroFinancialDocument(source({ contactName: 'SHENGQING' }), [xero({ contactName: 'SHENGQING' })]);
  assert.equal(result.status, 'eligible'); assert.equal(result.reviewRequired, true);
});
