import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCUMENT_FIELD_POLICY, buildDocumentFieldProjection, projectAccountingPayload, compareDocumentFieldProjection,
  evaluateDocumentFieldCorrection, buildDocumentFieldCorrectionPayload, verifyDocumentFieldCorrectionReadback,
} from '../api/_xeroDocumentFieldPolicy.js';

const stem = { RefCode__c: 'HK2625070T', Vessel__r: { Name: 'HUAYUE' }, Delivery_Date__c: '2025-12-01' };
const buyer = (overrides = {}) => ({ Id: 'buyer-1', Name: '25070T-INV-1', STEM__c: 'stem-1', STEM__r: structuredClone(stem),
  Amount__c: 125, Delivery_Date__c: '2026-01-27', Invoice_Date__c: '2026-01-28', Invoice_Due_Date__c: '2026-02-25',
  Proforma__c: false, Deprecated__c: false, ...overrides });
const bill = (overrides = {}) => ({ Id: 'supplier-1', Name: 'Original Supplier Invoice / 01', STEM__c: 'stem-1', STEM__r: structuredClone(stem),
  Invoice_Amount__c: 125, Invoice_Date__c: '2025-10-01', Invoice_Due_Date__c: '2026-02-28', Delivery_Date__c: '2025-11-01', ...overrides });
const sales = (overrides = {}) => buildDocumentFieldProjection({ record: buyer(overrides), direction: 'buyer' });
const supplier = (overrides = {}) => buildDocumentFieldProjection({ record: bill(), direction: 'supplier', buyers: [buyer()], lines: [], extras: [], ...overrides });
const unlocked = { periodLockDate: null, endOfYearLockDate: null };
const raw = (overrides = {}) => ({ InvoiceID: 'invoice-1', Type: 'ACCREC', Status: 'AUTHORISED', Date: '2026-01-27', DueDate: '2026-01-27',
  InvoiceNumber: 'Old number', Reference: 'Old reference', Contact: { ContactID: 'contact-1', Name: 'Buyer', ContactPersons: [] },
  CurrencyCode: 'USD', CurrencyRate: 1, LineAmountTypes: 'Exclusive', SubTotal: 125, TotalTax: 0, Total: 125,
  AmountDue: 125, AmountPaid: 0, AmountCredited: 0, IsDiscounted: false, Payments: [], CreditNotes: [], Prepayments: [], Overpayments: [],
  BrandingThemeID: 'theme', HasAttachments: true, Attachments: [{ AttachmentID: 'attachment', FileName: 'source.pdf' }],
  UpdatedDateUTC: '/Date(1769558400000+0000)/', UpdatedDateUTCString: '2026-01-28T00:00:00Z',
  LineItems: [{ LineItemID: 'line-1', Description: 'Old Description', Quantity: 2, UnitAmount: 75, LineAmount: 125,
    DiscountAmount: 25, AccountCode: '41100', AccountID: 'account-id', TaxType: 'NONE', TaxAmount: 0,
    ItemCode: 'Fuel', Tracking: [{ TrackingCategoryID: 'tracking-id', TrackingOptionID: 'option-id', Name: 'Division', Option: 'HK' }] }], ...overrides });
const correction = (overrides = {}) => ({ projection: sales(), rawXeroInvoice: raw(), direction: 'buyer', organisation: unlocked, ...overrides });

test('sales projection uses only buyer delivery date and exact prescribed headers and description', () => {
  const projection = sales();
  assert.equal(projection.policy, DOCUMENT_FIELD_POLICY); assert.equal(projection.scope, 'current');
  assert.deepEqual(projection.fields, { Date: '2026-01-27', DueDate: '2026-02-25', InvoiceNumber: '25070T-INV-1', Reference: 'HUAYUE', Description: 'INVOICE 28/1/2026' });
  assert.deepEqual(projection.blockers, []); assert.equal(projection.evidence.dateSource, 'Invoice__c.Delivery_Date__c');
  assert.match(projection.fingerprint, /^[a-f0-9]{64}$/);
});

test('cutoff is inclusive and follows delivery date even when issue date is on the opposite side', () => {
  assert.equal(sales({ Delivery_Date__c: '2026-01-01', Invoice_Date__c: '2025-12-31' }).scope, 'current');
  assert.equal(sales({ Delivery_Date__c: '2025-12-31', Invoice_Date__c: '2026-01-01' }).scope, 'legacy');
  assert.equal(supplier({ buyers: [buyer({ Delivery_Date__c: '2026-01-01', Invoice_Date__c: '2025-12-01' })] }).scope, 'current');
  assert.equal(supplier({ record: bill({ Invoice_Date__c: '2026-03-01' }), buyers: [buyer({ Delivery_Date__c: '2025-12-31' })] }).scope, 'legacy');
});

test('unknown or impossible delivery date never falls back to STEM, supplier, created, BDN or expected dates', () => {
  for (const date of [undefined, null, '', '2026-02-30', '2026-2-1', '2026-01-27T00:00:00Z', ' 2026-01-27']) {
    const projection = sales({ Delivery_Date__c: date, CreatedDate: '2026-02-01T00:00:00Z', Expected_Delivery_Date__c: '2026-02-01', BDN_Date__c: '2026-02-01' });
    assert.equal(projection.scope, 'unavailable'); assert.equal(projection.fields.Date, null);
    assert.ok(projection.blockerCodes.includes('DOCUMENT_FIELD_DELIVERY_DATE_MISSING'));
    assert.equal(supplier({ buyers: [buyer({ Delivery_Date__c: date })] }).scope, 'unavailable');
  }
  assert.equal(sales({ Delivery_Date__c: '2028-02-29' }).fields.Date, '2028-02-29');
});

test('missing headers and buyer eligibility evidence hold; due date before issue remains literal', () => {
  for (const changes of [{ Invoice_Date__c: null }, { Invoice_Due_Date__c: null }, { Name: '' }, { Proforma__c: undefined },
    { Deprecated__c: undefined }, { Proforma__c: true }, { Deprecated__c: true }, { IsDeleted: true }, { STEM__r: {} }]) assert.ok(sales(changes).blockers.length);
  const result = sales({ Invoice_Due_Date__c: '2026-01-02' });
  assert.equal(result.fields.DueDate, '2026-01-02'); assert.deepEqual(result.blockers, []);
});

test('credit notes and unknown directions are unsupported, never projected', () => {
  for (const projection of [sales({ Name: '25070T-CN-1' }), sales({ Amount__c: -125 }), supplier({ record: bill({ Invoice_Amount__c: -125 }) }),
    buildDocumentFieldProjection({ record: buyer(), direction: 'credit' })]) assert.equal(projection.scope, 'unsupported');
  assert.equal(buildDocumentFieldProjection({ record: null, direction: 'buyer' }).scope, 'unavailable');
});

test('bill follows explicitly linked buyer via both product lines and extras, ignoring alternate same-STEM buyers', () => {
  for (const collection of ['lines', 'extras']) {
    const projection = supplier({ buyers: [buyer(), buyer({ Id: 'buyer-2', Delivery_Date__c: '2026-05-01' })],
      [collection]: [{ Id: 'child', Supplier_Invoice__c: 'supplier-1', Buyer_Invoice__c: 'buyer-1' }] });
    assert.equal(projection.evidence.resolution, 'linked_buyers'); assert.deepEqual(projection.blockers, []);
    assert.deepEqual(projection.fields, { Date: '2026-01-27', DueDate: '2026-02-28', InvoiceNumber: '25070T- HUAYUE', Description: '28/1/2026' });
    assert.equal(projection.evidence.originalName, 'Original Supplier Invoice / 01'); assert.equal(Object.hasOwn(projection.fields, 'Reference'), false);
  }
});

test('bill fallback requires exactly one active normal same-STEM buyer', () => {
  const projection = supplier({ buyers: [buyer(), buyer({ Id: 'proforma', Proforma__c: true }), buyer({ Id: 'deprecated', Deprecated__c: true }),
    buyer({ Id: 'credit', Amount__c: -125 }), buyer({ Id: 'other', STEM__c: 'other-stem' })] });
  assert.equal(projection.evidence.resolution, 'unique_stem_buyer'); assert.deepEqual(projection.blockers, []);
  for (const buyers of [[], [buyer(), buyer({ Id: 'second' })], [buyer({ Proforma__c: true })], [buyer({ STEM__c: 'other-stem' })]]) {
    const held = supplier({ buyers }); assert.equal(held.scope, 'unavailable'); assert.ok(held.blockerCodes.includes('DOCUMENT_FIELD_BUYER_AMBIGUOUS'));
  }
});

test('missing, inactive or wrong-STEM explicitly linked evidence cannot fall back to an unrelated active buyer', () => {
  for (const selected of [undefined, buyer({ Id: 'selected', Deprecated__c: true }), buyer({ Id: 'selected', Proforma__c: true }),
    buyer({ Id: 'selected', Amount__c: -125 }), buyer({ Id: 'selected', STEM__c: 'other' })]) {
    const projection = supplier({ buyers: [buyer(), ...(selected ? [selected] : [])], lines: [{ Supplier_Invoice__c: 'supplier-1', Buyer_Invoice__c: 'selected' }] });
    assert.ok(projection.blockers.length); assert.equal(projection.evidence.resolution, 'linked_buyers');
  }
});

test('multiple linked buyers require agreement on both delivery and invoice dates', () => {
  const lines = ['buyer-1', 'buyer-2'].map((id) => ({ Supplier_Invoice__c: 'supplier-1', Buyer_Invoice__c: id }));
  assert.deepEqual(supplier({ buyers: [buyer(), buyer({ Id: 'buyer-2' })], lines }).blockers, []);
  const delivery = supplier({ buyers: [buyer(), buyer({ Id: 'buyer-2', Delivery_Date__c: '2026-01-28' })], lines });
  assert.equal(delivery.scope, 'unavailable'); assert.ok(delivery.blockerCodes.includes('DOCUMENT_FIELD_DELIVERY_DATE_CONFLICT'));
  const issue = supplier({ buyers: [buyer(), buyer({ Id: 'buyer-2', Invoice_Date__c: '2026-01-29' })], lines });
  assert.equal(issue.scope, 'current'); assert.ok(issue.blockerCodes.includes('DOCUMENT_FIELD_INVOICE_DATE_CONFLICT'));
});

test('literal source casing and spacing are preserved; shared bill reference is not globally unique', () => {
  const record = bill({ STEM__r: { RefCode__c: 'aBcd00xY', Vessel__r: { Name: '  Vessel Mixed  ' } } });
  const first = supplier({ record }); const second = supplier({ record: { ...record, Id: 'supplier-2', Name: 'Different source name' } });
  assert.equal(first.fields.InvoiceNumber, '00xY-   Vessel Mixed  '); assert.equal(first.fields.InvoiceNumber, second.fields.InvoiceNumber);
  assert.deepEqual(first.blockers, []); assert.deepEqual(second.blockers, []); assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(sales({ Name: ' Inv Mixed  ' }).fields.InvoiceNumber, ' Inv Mixed  ');
  assert.ok(supplier({ record: bill({ STEM__r: { ...stem, RefCode__c: 'HK26' } }) }).blockerCodes.includes('DOCUMENT_FIELD_REFCODE_MISSING'));
});

test('fingerprint is independent of snapshot ordering and changes with source identity or prescribed evidence', () => {
  const buyers = [buyer(), buyer({ Id: 'buyer-2' })];
  const lines = buyers.map((row, index) => ({ Id: `line-${index}`, Supplier_Invoice__c: 'supplier-1', Buyer_Invoice__c: row.Id }));
  assert.equal(supplier({ buyers, lines }).fingerprint, supplier({ buyers: [...buyers].reverse(), lines: [...lines].reverse() }).fingerprint);
  assert.notEqual(sales().fingerprint, sales({ Invoice_Date__c: '2026-01-29' }).fingerprint);
  assert.notEqual(sales().fingerprint, sales({ Id: 'buyer-2' }).fingerprint);
});

test('accounting payload projection deep-clones and changes only allowed fields, preserving bill API Reference', () => {
  const source = raw(); const original = structuredClone(source);
  const projected = projectAccountingPayload(source, sales());
  assert.deepEqual(source, original); assert.equal(projected.LineItems[0].Description, 'INVOICE 28/1/2026');
  assert.deepEqual({ ...projected.LineItems[0], Description: source.LineItems[0].Description }, source.LineItems[0]);
  assert.notEqual(projected.LineItems[0].Tracking, source.LineItems[0].Tracking);
  assert.equal(projectAccountingPayload(source, supplier()).Reference, 'Old reference');
  for (const projection of [sales({ Delivery_Date__c: '2025-12-31' }), sales({ Delivery_Date__c: null }), sales({ Invoice_Due_Date__c: null }), sales({ Amount__c: -125 })]) {
    assert.deepEqual(projectAccountingPayload(source, projection), original);
  }
});

test('field comparison is exact for casing/spacing and identifies every line; canonical date representations agree', () => {
  const projected = projectAccountingPayload(raw(), sales());
  projected.Date = '/Date(1769472000000+0000)/'; projected.DueDate = '2026-02-25T00:00:00';
  assert.deepEqual(compareDocumentFieldProjection(sales(), projected), []);
  projected.Reference = 'huayue'; projected.LineItems[0].Description = 'INVOICE 28/1/2026 ';
  projected.LineItems.push({ ...projected.LineItems[0], LineItemID: 'line-2' });
  const differences = compareDocumentFieldProjection(sales(), projected);
  assert.deepEqual(differences.map((row) => row.field), ['Reference', 'LineItems[0].Description', 'LineItems[1].Description']);
  assert.deepEqual(differences.slice(1).map((row) => [row.lineIndex, row.lineItemId]), [[0, 'line-1'], [1, 'line-2']]);
});

test('correction payload uses current Xero financial lines and omits read-only headers and unchanged Date', () => {
  const input = correction(); const before = structuredClone(input.rawXeroInvoice);
  assert.equal(evaluateDocumentFieldCorrection(input).eligible, true);
  const payload = buildDocumentFieldCorrectionPayload(input);
  assert.deepEqual(Object.keys(payload).sort(), ['DueDate', 'InvoiceID', 'InvoiceNumber', 'LineAmountTypes', 'LineItems', 'Reference'].sort());
  assert.deepEqual({ ...payload.LineItems[0], Description: before.LineItems[0].Description }, before.LineItems[0]);
  assert.deepEqual(input.rawXeroInvoice, before); assert.notEqual(payload.LineItems[0].Tracking, before.LineItems[0].Tracking);
  const moved = buildDocumentFieldCorrectionPayload(correction({ rawXeroInvoice: raw({ Date: '2026-01-28', CurrencyRate: 7.78345 }) }));
  assert.equal(moved.Date, '2026-01-27'); assert.equal(moved.CurrencyRate, 7.78345);
});

test('paid and partially settled sales or bills allow only nonfinancial corrections while Date is unchanged', () => {
  for (const direction of ['buyer', 'supplier']) for (const payment of [
    { Status: 'PAID', AmountDue: 0, AmountPaid: 125 }, { AmountDue: 100, AmountPaid: 25 }, { AmountDue: 100, AmountCredited: 25 },
    { Payments: [{ PaymentID: 'payment-1', Amount: 0 }] },
  ]) {
    const input = correction({ direction, projection: direction === 'buyer' ? sales() : supplier(),
      rawXeroInvoice: raw({ Type: direction === 'buyer' ? 'ACCREC' : 'ACCPAY', ...payment }) });
    assert.equal(evaluateDocumentFieldCorrection(input).eligible, true);
    const payload = buildDocumentFieldCorrectionPayload(input); assert.equal(Object.hasOwn(payload, 'Date'), false);
    if (direction === 'supplier') assert.equal(Object.hasOwn(payload, 'Reference'), false);
    input.rawXeroInvoice.Date = '2026-01-28';
    assert.ok(evaluateDocumentFieldCorrection(input).blockerCodes.includes('DOCUMENT_FIELD_SETTLED_DATE_CHANGE'));
    assert.throws(() => buildDocumentFieldCorrectionPayload(input), { code: 'XERO_DOCUMENT_FIELD_CORRECTION_HELD' });
  }
});

test('corrections fail closed on locks, identity, status, duplicate/missing lines and incomplete raw financial evidence', () => {
  for (const input of [correction({ organisation: {} }), correction({ organisation: null }), correction({ organisation: { ...unlocked, periodLockDate: '2026-01-27' } }),
    correction({ organisation: { ...unlocked, endOfYearLockDate: '2026-01-28' } }), correction({ organisation: { ...unlocked, periodLockDate: 'invalid' } }),
    correction({ expectedInvoiceId: 'different' }), correction({ expectedStatus: 'DRAFT' }), correction({ direction: 'supplier' }),
    ...[{ Type: 'ACCRECCREDIT' }, { Status: 'VOIDED' }, { Status: 'DELETED' }, { AmountPaid: undefined }, { CurrencyRate: undefined }, { CurrencyRate: 0 }, { Contact: {} },
      { LineItems: [] }, { LineItems: [null] }, { LineItems: [{ Description: 'missing ID' }] }, { LineItems: [raw().LineItems[0], raw().LineItems[0]] },
      { LineItems: [{ ...raw().LineItems[0], ValidationErrors: [{ Message: 'Invalid tax code' }] }] },
      { LineItems: [{ ...raw().LineItems[0], UnknownFinancialAmount: 5 }] }, { HasErrors: true }].map((changes) => correction({ rawXeroInvoice: raw(changes) }))]) {
    assert.equal(evaluateDocumentFieldCorrection(input).eligible, false);
    assert.throws(() => buildDocumentFieldCorrectionPayload(input), { code: 'XERO_DOCUMENT_FIELD_CORRECTION_HELD' });
  }
  const movingOutOfLock = correction({ rawXeroInvoice: raw({ Date: '2025-12-31' }), organisation: { ...unlocked, periodLockDate: '2025-12-31' } });
  assert.ok(evaluateDocumentFieldCorrection(movingOutOfLock).blockerCodes.includes('DOCUMENT_FIELD_PERIOD_LOCKED'));
});

test('readback allows timestamp and prescribed changes only and catches every material invariant mutation', () => {
  const before = raw(); const projection = sales(); const after = projectAccountingPayload(before, projection);
  after.UpdatedDateUTC = '/Date(1770000000000)/'; after.UpdatedDateUTCString = '2026-02-02T02:40:00Z';
  assert.equal(verifyDocumentFieldCorrectionReadback({ before, after, projection }).ok, true);
  const mutations = [
    (value) => { value.Total += 0.01; }, (value) => { value.CurrencyRate = 0.99; }, (value) => { value.Status = 'PAID'; },
    (value) => { value.Contact.ContactID = 'changed'; }, (value) => { value.Payments.push({ PaymentID: 'new-payment' }); },
    (value) => { value.LineItems[0].LineItemID = 'changed'; }, (value) => { value.LineItems[0].AccountCode = '999'; },
    (value) => { value.LineItems[0].Tracking[0].Option = 'SG'; }, (value) => { value.LineItems[0].DiscountAmount = 24.99; },
    (value) => { value.LineItems[0].TaxAmount = 0.01; }, (value) => { value.Attachments = []; }, (value) => { value.HasAttachments = false; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(after); mutate(changed);
    const result = verifyDocumentFieldCorrectionReadback({ before, after: changed, projection });
    assert.equal(result.ok, false); assert.ok(result.invariantDifferences.length);
  }
  const wrongText = structuredClone(after); wrongText.LineItems[0].Description = 'INVOICED 28/1/2026';
  assert.ok(verifyDocumentFieldCorrectionReadback({ before, after: wrongText, projection }).blockerCodes.includes('DOCUMENT_FIELD_READBACK_MISMATCH'));
});

test('readback preserves bill API Reference and detects line deletion, order changes and conflicting date aliases', () => {
  const before = raw({ Type: 'ACCPAY' }); before.LineItems.push({ ...before.LineItems[0], LineItemID: 'line-2' });
  const projection = supplier(); const after = projectAccountingPayload(before, projection);
  assert.equal(verifyDocumentFieldCorrectionReadback({ before, after, projection }).ok, true);
  for (const mutate of [(value) => { value.Reference = 'changed'; }, (value) => { value.LineItems.pop(); },
    (value) => { value.LineItems.reverse(); }, (value) => { value.DateString = '2026-01-28'; }]) {
    const changed = structuredClone(after); mutate(changed);
    assert.equal(verifyDocumentFieldCorrectionReadback({ before, after: changed, projection }).ok, false);
  }
  assert.equal(verifyDocumentFieldCorrectionReadback({ before, projection }).ok, false);
});
