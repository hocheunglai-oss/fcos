import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateGroupedPreservation, GROUPED_PRESERVATION_POLICY, GROUPED_PRESERVATION_MAX_LINES } from '../api/_xeroGroupedPreservation.js';

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const ids = { tenant: uuid(1), contact: uuid(2), invoice: uuid(3), xeroLine: uuid(4),
  document: 'a01000000000001', account: '001000000000001', product: '01t000000000001',
  firstLine: 'a02000000000001', secondLine: 'a02000000000002' };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const plainLine = { description: 'Marine fuel', quantity: '1', unitAmount: '10.01', lineAmount: '10.01',
  accountCode: '51100', taxType: 'NONE', taxAmount: '0', discountRate: '0', discountAmount: '0', tracking: [], itemCode: '' };

function fixture() {
  return {
    tenantId: ids.tenant, organisation: { baseCurrency: 'USD' },
    source: { complete: true, salesforceObject: 'Supplier_Invoice__c', salesforceId: ids.document,
      accountId: ids.account, contactId: ids.contact, sourceFingerprint: sha('authoritative source'),
      documentNumber: 'SF-2026-100', reference: 'STEM-100', invoiceDate: '2026-01-03', dueDate: '2026-02-03', deliveryDate: '2026-01-02',
      xeroType: 'ACCPAY', xeroCollection: 'Invoices', currency: 'USD', subtotal: '30.03', total: '30.03', signedTotal: '30.03',
      totalTax: '0', lineAmountTypes: 'NoTax', isDiscounted: false, readiness: { ready: true, evidenceFingerprint: sha('issued file and children') },
      lines: [
        { ...structuredClone(plainLine), id: ids.firstLine, productId: ids.product, currency: 'USD' },
        { ...structuredClone(plainLine), id: ids.secondLine, productId: ids.product, currency: 'USD', quantity: '2', lineAmount: '20.02' },
      ] },
    xero: { complete: true, id: ids.invoice, collection: 'Invoices', type: 'ACCPAY', status: 'AUTHORISED',
      contactId: ids.contact, invoiceNumber: 'SF-2026-100', reference: 'Legacy retained reference', date: '2026-01-03', dueDate: '2026-02-02',
      currency: 'USD', currencyRate: '1', subtotal: '30.03', total: '30.03', totalTax: '0', lineAmountTypes: 'Exclusive', isDiscounted: false,
      amountDue: '30.03', amountPaid: '0', amountCredited: '0',
      lines: [{ ...structuredClone(plainLine), id: ids.xeroLine, unitAmount: '30.03', lineAmount: '30.03', description: 'Combined historical fuel' }] },
    productMappings: [{ id: uuid(5), direction: 'supplier', salesforceProductId: ids.product,
      xeroAccountCode: '51100', xeroTaxType: 'NONE', enabled: true, revision: 1 }],
    identity: { complete: true, matchBasis: 'invoice_number', candidateXeroDocumentIds: [ids.invoice],
      documentIdentitySourceIds: [ids.document], candidateContactIds: [ids.contact], accountIdsForContact: [ids.account], sourceMappings: [], targetMappings: [],
      contactIdentity: { salesforceAccountId: ids.account, xeroContactId: ids.contact, status: 'ACTIVE',
        matchBasis: 'account_name', sourceMatchValue: 'marine supplier limited', xeroMatchValue: 'marine supplier limited',
        evidenceFingerprint: sha('raw Account and Contact records and identity policy') } },
  };
}

function rejected(change, expectedCode, input = fixture()) {
  change(input);
  const result = evaluateGroupedPreservation(input);
  assert.equal(result.eligible, false, `Unexpected eligibility: ${JSON.stringify(result)}`);
  assert.equal(result.fingerprint, null);
  assert.equal(result.evidence, null);
  assert.equal(result.accepted, false);
  assert.equal(result.requiresExplicitReview, true);
  assert.ok(result.blockers.some((blocker) => blocker.code === expectedCode), JSON.stringify(result.blockers));
  return result;
}

function accept(input) {
  const preview = evaluateGroupedPreservation(input);
  assert.equal(preview.eligible, true, JSON.stringify(preview.blockers));
  const mapping = { id: uuid(10), tenantId: input.tenantId, salesforceObject: input.source.salesforceObject,
    salesforceId: input.source.salesforceId, xeroDocumentId: input.xero.id, protectedLegacy: true,
    xeroDocumentType: input.xero.type, xeroContactId: input.xero.contactId,
    accountId: input.source.accountId, sourceFingerprint: input.source.sourceFingerprint,
    policyVersion: GROUPED_PRESERVATION_POLICY, acceptedFingerprint: preview.fingerprint };
  input.identity.sourceMappings = [structuredClone(mapping)];
  input.identity.targetMappings = [structuredClone(mapping)];
  return preview;
}

test('positive source lines may preserve one existing line with exact independently asserted cents and retained differences', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = evaluateGroupedPreservation(input);
  assert.equal(result.eligible, true);
  assert.equal(result.accepted, false);
  assert.equal(result.policyVersion, 'positive_many_to_one_v1');
  assert.equal(result.requiresExplicitReview, true);
  assert.deepEqual(result.evidence.accounting.groupedTotals, [{ accountCode: '51100', taxType: 'NONE', totalCents: '3003' }]);
  assert.deepEqual(result.evidence.accounting.source.lines.map((line) => line.lineAmountCents), ['1001', '2002']);
  assert.equal(result.evidence.accounting.source.documentNumber, 'SF-2026-100');
  assert.equal(result.evidence.accounting.xero.invoiceNumber, 'SF-2026-100');
  assert.equal(result.evidence.accounting.source.lineAmountTypes, 'NoTax');
  assert.equal(result.evidence.accounting.xero.lineAmountTypes, 'Exclusive');
  assert.equal(result.evidence.accounting.xero.reference, 'Legacy retained reference');
  assert.deepEqual(input, before, 'The helper must not mutate any adapter evidence.');
  assert.deepEqual(Object.keys(result).sort(), ['accepted', 'blockers', 'eligible', 'evidence', 'fingerprint', 'policyVersion', 'requiresExplicitReview']);
  assert.equal(Object.hasOwn(result, 'proposedPayload'), false);
});

test('buyer invoices and multiple products are allowed only on their approved matching accounting account', () => {
  const input = fixture();
  input.source.salesforceObject = 'Invoice__c'; input.source.xeroType = 'ACCREC'; input.xero.type = 'ACCREC';
  input.productMappings[0].direction = 'buyer';
  input.source.lines[1].productId = '01t000000000002';
  input.productMappings.push({ ...input.productMappings[0], id: uuid(7), salesforceProductId: '01t000000000002' });
  assert.equal(evaluateGroupedPreservation(input).eligible, true);
});

test('exact invoice identity permits only whitespace normalization; equal date, total and Contact are insufficient', async (t) => {
  const input = fixture();
  input.source.documentNumber = '  INV\t 123-A  ';
  input.xero.invoiceNumber = 'INV 123-A';
  assert.equal(evaluateGroupedPreservation(input).eligible, true);
  for (const number of ['INV123-A', 'INV 123A', 'inv 123-a', 'INV 123-A revised', 'OTHER', '']) {
    await t.test(JSON.stringify(number), () => {
      const example = fixture();
      example.source.documentNumber = 'INV 123-A';
      example.xero.date = example.source.invoiceDate;
      rejected((row) => { row.xero.invoiceNumber = number; }, 'MATCH_BASIS_INVALID', example);
    });
  }
  await t.test('both blank numbers', () => rejected((row) => {
    row.source.documentNumber = ' '; row.xero.invoiceNumber = '\t';
  }, 'MATCH_BASIS_INVALID'));
});

test('decimal arithmetic adds 0.10 and 0.20 exactly and rounds individual half cents before summing', () => {
  const input = fixture();
  input.source.lines[0] = { ...input.source.lines[0], quantity: '1', unitAmount: '0.10', lineAmount: '0.10' };
  input.source.lines[1] = { ...input.source.lines[1], quantity: '1', unitAmount: '0.20', lineAmount: '0.20' };
  for (const field of ['subtotal', 'total', 'signedTotal']) input.source[field] = '0.30';
  for (const field of ['subtotal', 'total', 'amountDue']) input.xero[field] = '0.30';
  input.xero.lines[0].unitAmount = '0.30'; input.xero.lines[0].lineAmount = '0.30';
  assert.equal(evaluateGroupedPreservation(input).evidence.accounting.groupedTotals[0].totalCents, '30');
  // 0.5 * 0.01 rounds to 0.01 per authoritative line, not 0.005.
  for (const line of input.source.lines) Object.assign(line, { quantity: '0.5', unitAmount: '0.01', lineAmount: '0.01' });
  for (const field of ['subtotal', 'total', 'signedTotal']) input.source[field] = '0.02';
  for (const field of ['subtotal', 'total', 'amountDue']) input.xero[field] = '0.02';
  input.xero.lines[0].unitAmount = '0.02'; input.xero.lines[0].lineAmount = '0.02';
  const rounded = evaluateGroupedPreservation(input);
  assert.equal(rounded.eligible, true, JSON.stringify(rounded.blockers));
  assert.equal(rounded.evidence.accounting.groupedTotals[0].totalCents, '2');
  rejected((row) => { row.source.lines[0].lineAmount = '0.005'; }, 'CENT_PRECISION', input);
});

test('missing headers and material accounting dimensions are never silently defaulted', async (t) => {
  for (const side of ['source', 'xero']) {
    for (const field of ['subtotal', 'total', 'totalTax', 'lineAmountTypes', 'isDiscounted']) {
      await t.test(`${side}.${field}`, () => {
        const input = fixture(); delete input[side][field];
        assert.equal(evaluateGroupedPreservation(input).eligible, false);
      });
    }
    for (const field of ['quantity', 'unitAmount', 'lineAmount', 'taxType', 'taxAmount', 'discountRate', 'discountAmount', 'tracking', 'itemCode']) {
      await t.test(`${side}.line.${field}`, () => {
        const input = fixture(); delete input[side].lines[0][field];
        assert.equal(evaluateGroupedPreservation(input).eligible, false);
      });
    }
  }
});

test('one-cent differences, cancellation and invalid precision fail even when document totals agree', async (t) => {
  const cases = [
    ['source quantity arithmetic', (row) => { row.source.lines[0].lineAmount = '10.02'; }, 'LINE_ARITHMETIC_MISMATCH'],
    ['Xero quantity arithmetic', (row) => { row.xero.lines[0].unitAmount = '30.04'; }, 'LINE_ARITHMETIC_MISMATCH'],
    ['source header sum', (row) => { row.source.subtotal = row.source.total = row.source.signedTotal = '30.04'; }, 'LINE_HEADER_MISMATCH'],
    ['Xero header sum', (row) => { row.xero.subtotal = row.xero.total = row.xero.amountDue = '30.04'; }, 'LINE_HEADER_MISMATCH'],
    ['header tax mismatch', (row) => { row.xero.subtotal = '30.02'; }, 'HEADER_TOTAL_MISMATCH'],
    ['fractional authoritative cent', (row) => { row.source.total = '30.031'; }, 'CENT_PRECISION'],
    ['negative source quantity', (row) => { row.source.lines[0].quantity = '-1'; }, 'AMOUNT_INVALID'],
    ['negative source unit', (row) => { row.source.lines[0].unitAmount = '-10.01'; }, 'AMOUNT_INVALID'],
    ['negative offset line', (row) => { row.source.lines[0].lineAmount = '-10.01'; row.source.lines[1].lineAmount = '40.04'; }, 'AMOUNT_INVALID'],
    ['negative source signed total', (row) => { row.source.signedTotal = '-30.03'; }, 'AMOUNT_INVALID'],
    ['zero quantity', (row) => { row.source.lines[0].quantity = 0; }, 'AMOUNT_INVALID'],
    ['zero unit amount', (row) => { row.xero.lines[0].unitAmount = 0; }, 'AMOUNT_INVALID'],
    ['zero authoritative source amount', (row) => { row.source.lines[0].lineAmount = 0; }, 'AMOUNT_INVALID'],
    ['NaN', (row) => { row.source.lines[0].lineAmount = NaN; }, 'AMOUNT_INVALID'],
    ['Infinity', (row) => { row.xero.total = Infinity; }, 'AMOUNT_INVALID'],
    ['boolean number', (row) => { row.source.total = true; }, 'AMOUNT_INVALID'],
    ['whitespace number', (row) => { row.source.total = ' 30.03'; }, 'AMOUNT_INVALID'],
    ['exponent number', (row) => { row.source.total = '3.003e1'; }, 'AMOUNT_INVALID'],
    ['unsafe large invoice', (row) => { row.source.total = '10000000000'; }, 'AMOUNT_BOUND'],
  ];
  for (const [name, change, code] of cases) await t.test(name, () => rejected(change, code));
});

test('discount, tax, tracking, inventory and FX cannot be masked by an equal total', async (t) => {
  for (const side of ['source', 'xero']) {
    const cases = [
      ['isDiscounted', (row) => { row[side].isDiscounted = true; }, 'DISCOUNT_UNSUPPORTED'],
      ['discount rate', (row) => { row[side].lines[0].discountRate = '1'; }, 'DISCOUNT_UNSUPPORTED'],
      ['discount amount', (row) => { row[side].lines[0].discountAmount = '0.01'; }, 'DISCOUNT_UNSUPPORTED'],
      ['tax total', (row) => { row[side].totalTax = '0.01'; }, 'TAX_UNSUPPORTED'],
      ['tax amount', (row) => { row[side].lines[0].taxAmount = '0.01'; }, 'TAX_UNSUPPORTED'],
      ['tax code', (row) => { row[side].lines[0].taxType = 'ZERORATED'; }, 'SCOPE_UNSUPPORTED'],
      ['inclusive amounts', (row) => { row[side].lineAmountTypes = 'Inclusive'; }, 'SCOPE_UNSUPPORTED'],
      ['tracking', (row) => { row[side].lines[0].tracking = [{ TrackingCategoryID: uuid(40), TrackingOptionID: uuid(41) }]; }, 'TRACKING_UNSUPPORTED'],
      ['inventory', (row) => { row[side].lines[0].itemCode = 'FUEL'; }, 'INVENTORY_UNSUPPORTED'],
    ];
    for (const [name, change, code] of cases) await t.test(`${side} ${name}`, () => rejected(change, code));
  }
  await t.test('different document currencies', () => rejected((row) => { row.xero.currency = 'EUR'; }, 'CURRENCY_MISMATCH'));
  await t.test('foreign base currency', () => rejected((row) => { row.organisation.baseCurrency = 'HKD'; }, 'FX_UNSUPPORTED'));
  await t.test('foreign source line currency', () => rejected((row) => { row.source.lines[0].currency = 'EUR'; }, 'CURRENCY_MISMATCH'));
  await t.test('currency rate', () => rejected((row) => { row.xero.currencyRate = '1.0001'; }, 'FX_UNSUPPORTED'));
  await t.test('missing currency rate', () => rejected((row) => { delete row.xero.currencyRate; }, 'AMOUNT_INVALID'));
  await t.test('missing currency', () => rejected((row) => { delete row.source.currency; }, 'CURRENCY_INVALID'));
});

test('same grand total cannot cross accounts or unapproved/ambiguous product mappings', async (t) => {
  const cases = [
    ['different Xero account', (row) => { row.xero.lines[0].accountCode = '51201'; }, 'ACCOUNT_GROUP_MISMATCH'],
    ['source line differs from mapping', (row) => { row.source.lines[1].accountCode = '51201'; }, 'MAPPING_MISMATCH'],
    ['two individually approved source accounts', (row) => {
      row.source.lines[1].accountCode = '51201'; row.source.lines[1].productId = '01t000000000002';
      row.productMappings.push({ ...row.productMappings[0], id: uuid(7), salesforceProductId: '01t000000000002', xeroAccountCode: '51201' });
    }, 'ACCOUNT_GROUP_MISMATCH'],
    ['no approved mapping', (row) => { row.productMappings = []; }, 'MAPPING_MISMATCH'],
    ['disabled mapping', (row) => { row.productMappings[0].enabled = false; }, 'MAPPING_INVALID'],
    ['wrong mapping direction', (row) => { row.productMappings[0].direction = 'buyer'; }, 'SCOPE_UNSUPPORTED'],
    ['missing revision', (row) => { delete row.productMappings[0].revision; }, 'MAPPING_INVALID'],
    ['duplicate approved row', (row) => { row.productMappings.push({ ...row.productMappings[0] }); }, 'MAPPING_DUPLICATE'],
    ['unused mapping', (row) => { row.productMappings.push({ ...row.productMappings[0], id: uuid(7), salesforceProductId: '01t000000000002' }); }, 'MAPPING_UNUSED'],
  ];
  for (const [name, change, code] of cases) await t.test(name, () => rejected(change, code));
});

test('complete unique canonical identities and exact Contact ownership are mandatory', async (t) => {
  const cases = [
    ['incomplete source', (row) => { row.source.complete = false; }, 'EVIDENCE_INCOMPLETE'],
    ['incomplete Xero', (row) => { delete row.xero.complete; }, 'EVIDENCE_INCOMPLETE'],
    ['incomplete scope', (row) => { row.identity.complete = false; }, 'EVIDENCE_INCOMPLETE'],
    ['unready source', (row) => { row.source.readiness.ready = false; }, 'SOURCE_NOT_READY'],
    ['missing readiness fingerprint', (row) => { delete row.source.readiness.evidenceFingerprint; }, 'FINGERPRINT_INVALID'],
    ['missing source fingerprint', (row) => { delete row.source.sourceFingerprint; }, 'FINGERPRINT_INVALID'],
    ['missing source line ID', (row) => { delete row.source.lines[0].id; }, 'IDENTITY_INVALID'],
    ['duplicate source line ID alias', (row) => { row.source.lines[1].id = `${row.source.lines[0].id}AAA`; }, 'LINE_ID_DUPLICATE'],
    ['invalid Salesforce checksum', (row) => { row.source.salesforceId += 'BBB'; }, 'IDENTITY_INVALID'],
    ['missing Xero line ID', (row) => { delete row.xero.lines[0].id; }, 'IDENTITY_INVALID'],
    ['missing product ID', (row) => { delete row.source.lines[0].productId; }, 'IDENTITY_INVALID'],
    ['ambiguous Xero candidates', (row) => { row.identity.candidateXeroDocumentIds.push(uuid(11)); }, 'IDENTITY_AMBIGUOUS'],
    ['duplicate canonical Xero candidate', (row) => { row.identity.candidateXeroDocumentIds.push(row.xero.id.toUpperCase()); }, 'IDENTITY_AMBIGUOUS'],
    ['duplicate source identity alias', (row) => { row.identity.documentIdentitySourceIds.push(`${ids.document}AAA`); }, 'IDENTITY_AMBIGUOUS'],
    ['shared Contact across Accounts', (row) => { row.identity.accountIdsForContact.push('001000000000002'); }, 'IDENTITY_AMBIGUOUS'],
    ['ambiguous Contact for one Account', (row) => { row.identity.candidateContactIds.push(uuid(20)); }, 'IDENTITY_AMBIGUOUS'],
    ['wrong Contact', (row) => { row.xero.contactId = uuid(12); }, 'CONTACT_MISMATCH'],
    ['wrong Contact identity Account', (row) => { row.identity.contactIdentity.salesforceAccountId = '001000000000002'; }, 'CONTACT_IDENTITY_MISMATCH'],
    ['wrong Contact identity Contact', (row) => { row.identity.contactIdentity.xeroContactId = uuid(12); }, 'CONTACT_IDENTITY_MISMATCH'],
    ['inactive Contact', (row) => { row.identity.contactIdentity.status = 'ARCHIVED'; }, 'SCOPE_UNSUPPORTED'],
    ['wrong Contact name evidence', (row) => { row.identity.contactIdentity.xeroMatchValue = 'different supplier'; }, 'CONTACT_IDENTITY_MISMATCH'],
    ['empty Contact name evidence', (row) => { row.identity.contactIdentity.sourceMatchValue = row.identity.contactIdentity.xeroMatchValue = ' '; }, 'CONTACT_IDENTITY_MISMATCH'],
    ['missing Contact evidence fingerprint', (row) => { delete row.identity.contactIdentity.evidenceFingerprint; }, 'FINGERPRINT_INVALID'],
    ['missing ownership query', (row) => { delete row.identity.targetMappings; }, 'EVIDENCE_BOUND'],
    ['false invoice-number identity', (row) => { row.xero.invoiceNumber = 'OTHER-100'; }, 'MATCH_BASIS_INVALID'],
    ['date-and-amount-only discovery', (row) => { row.identity.matchBasis = 'date_amount'; }, 'SCOPE_UNSUPPORTED'],
    ['invalid date', (row) => { row.source.invoiceDate = '2026-02-30'; }, 'DATE_INVALID'],
    ['same invoice number on another accounting date', (row) => { row.xero.date = '2025-01-03'; }, 'INVOICE_DATE_MISMATCH'],
    ['unsupported buyer credit', (row) => { row.source.xeroType = row.xero.type = 'ACCPAYCREDIT'; row.xero.collection = 'CreditNotes'; }, 'SCOPE_UNSUPPORTED'],
  ];
  for (const [name, change, code] of cases) await t.test(name, () => rejected(change, code));
});

test('initial eligibility excludes drafts, paid or void documents and unreconciled settlement evidence', async (t) => {
  for (const status of ['DRAFT', 'SUBMITTED', 'DELETED', 'VOIDED', 'PAID']) {
    await t.test(status, () => rejected((row) => { row.xero.status = status; }, 'SCOPE_UNSUPPORTED'));
  }
  await t.test('settlement total mismatch', () => rejected((row) => { row.xero.amountPaid = '0.01'; }, 'SETTLEMENT_INVALID'));
  await t.test('missing settlement header', () => rejected((row) => { delete row.xero.amountCredited; }, 'AMOUNT_INVALID'));
});

test('its accepted canonical mapping preserves the same proof through linking and later cash/credit settlement', () => {
  const input = fixture();
  const initial = accept(input);
  input.identity.targetMappings[0].salesforceId += 'AAA';
  const linked = evaluateGroupedPreservation(input);
  assert.equal(linked.eligible, true, JSON.stringify(linked.blockers));
  assert.equal(linked.accepted, true);
  assert.equal(linked.fingerprint, initial.fingerprint);
  assert.notDeepEqual(linked.evidence.observations, initial.evidence.observations);
  input.xero.status = 'PAID'; input.xero.amountDue = '0'; input.xero.amountPaid = '20.02'; input.xero.amountCredited = '10.01';
  const settled = evaluateGroupedPreservation(input);
  assert.equal(settled.eligible, true, JSON.stringify(settled.blockers));
  assert.equal(settled.accepted, true);
  assert.equal(settled.fingerprint, initial.fingerprint);
  assert.equal(settled.evidence.observations.status, 'PAID');
  assert.equal(settled.evidence.observations.amountCreditedCents, '1001');
  assert.notDeepEqual(settled.evidence.observations, linked.evidence.observations, 'The outer review must bind fresh settlement observations.');
  rejected((row) => { row.xero.amountDue = '0.01'; row.xero.amountPaid = '20.01'; }, 'SETTLEMENT_INVALID', input);
});

test('accepted ownership cannot be forged by another source, tenant, target, ordinary mapping, partial query or changed source', async (t) => {
  const cases = [
    ['other source', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.salesforceId = 'a01000000000002'; }],
    ['other tenant', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.tenantId = uuid(20); }],
    ['other target', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.xeroDocumentId = uuid(20); }],
    ['other mapped type', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.xeroDocumentType = 'ACCREC'; }],
    ['other mapped Contact', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.xeroContactId = uuid(20); }],
    ['other mapped Account', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.accountId = '001000000000002'; }],
    ['inconsistent stored source fingerprint', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.sourceFingerprint = sha('inconsistent'); }],
    ['ordinary mapping', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.protectedLegacy = false; }],
    ['other policy', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.policyVersion = 'unknown_v9'; }],
    ['wrong accepted hash', (row) => { for (const mapping of [...row.identity.sourceMappings, ...row.identity.targetMappings]) mapping.acceptedFingerprint = sha('other'); }],
    ['different mapping identity', (row) => { row.identity.targetMappings[0].id = uuid(20); }],
    ['one query omits self mapping', (row) => { row.identity.sourceMappings = []; }],
    ['duplicate mapping', (row) => { row.identity.targetMappings.push({ ...row.identity.targetMappings[0] }); }],
    ['future source amendment', (row) => { row.source.sourceFingerprint = sha('amended'); }],
    ['changed retained Xero reference', (row) => { row.xero.reference = 'another'; }],
    ['changed approved account revision', (row) => { row.productMappings[0].revision += 1; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const input = fixture(); accept(input); rejected(change, 'OWNERSHIP_CONFLICT', input);
  });
});

test('every retained material field contributes to the accounting fingerprint', async (t) => {
  const baseline = evaluateGroupedPreservation(fixture()).fingerprint;
  const cases = [
    ['source fingerprint', (row) => { row.source.sourceFingerprint = sha('changed'); }],
    ['issued readiness fingerprint', (row) => { row.source.readiness.evidenceFingerprint = sha('changed'); }],
    ['source number whitespace', (row) => { row.source.documentNumber += ' '; }],
    ['source reference', (row) => { row.source.reference += '-AMENDED'; }],
    ['invoice/accounting date', (row) => { row.source.invoiceDate = row.xero.date = '2026-01-04'; }],
    ['source due date', (row) => { row.source.dueDate = '2026-02-04'; }],
    ['Xero number whitespace', (row) => { row.xero.invoiceNumber += ' '; }],
    ['Xero reference', (row) => { row.xero.reference += '-AMENDED'; }],
    ['Xero due date', (row) => { row.xero.dueDate = '2026-02-04'; }],
    ['Xero tax mode', (row) => { row.xero.lineAmountTypes = 'NoTax'; }],
    ['source tax mode', (row) => { row.source.lineAmountTypes = 'Exclusive'; }],
    ['source description', (row) => { row.source.lines[0].description += ' changed'; }],
    ['Xero description', (row) => { row.xero.lines[0].description += ' changed'; }],
    ['source line identity', (row) => { row.source.lines[0].id = 'a02000000000003'; }],
    ['Xero line identity', (row) => { row.xero.lines[0].id = uuid(40); }],
    ['quantity and unit distribution', (row) => { row.source.lines[1].quantity = '1'; row.source.lines[1].unitAmount = '20.02'; }],
    ['product mapping revision', (row) => { row.productMappings[0].revision += 1; }],
    ['product mapping identity', (row) => { row.productMappings[0].id = uuid(40); }],
    ['Contact identity proof', (row) => { row.identity.contactIdentity.evidenceFingerprint = sha('updated Contact evidence'); }],
    ['Contact identity basis', (row) => { row.identity.contactIdentity.matchBasis = 'company_key'; }],
    ['Contact name match evidence', (row) => { row.identity.contactIdentity.sourceMatchValue = row.identity.contactIdentity.xeroMatchValue = 'renamed supplier'; }],
    ['tenant', (row) => { row.tenantId = uuid(40); }],
    ['source document identity', (row) => { row.source.salesforceId = 'a01000000000002'; row.identity.documentIdentitySourceIds = [row.source.salesforceId]; }],
    ['Xero document identity', (row) => { row.xero.id = uuid(40); row.identity.candidateXeroDocumentIds = [row.xero.id]; }],
    ['source product identity', (row) => { for (const line of row.source.lines) line.productId = '01t000000000002'; row.productMappings[0].salesforceProductId = '01t000000000002'; }],
    ['authoritative total and line amounts', (row) => {
      row.source.lines[1].unitAmount = '10.02'; row.source.lines[1].lineAmount = '20.04';
      row.source.subtotal = row.source.total = row.source.signedTotal = row.xero.subtotal = row.xero.total = row.xero.amountDue = '30.05';
      row.xero.lines[0].unitAmount = row.xero.lines[0].lineAmount = '30.05';
    }],
    ['Contact', (row) => { row.source.contactId = row.xero.contactId = row.identity.contactIdentity.xeroContactId = uuid(40); row.identity.candidateContactIds = [uuid(40)]; }],
    ['Account', (row) => { row.source.accountId = row.identity.contactIdentity.salesforceAccountId = '001000000000002'; row.identity.accountIdsForContact = [row.source.accountId]; }],
    ['currency', (row) => { row.source.currency = row.xero.currency = row.organisation.baseCurrency = 'EUR'; for (const line of row.source.lines) line.currency = 'EUR'; }],
    ['accounting code', (row) => { row.productMappings[0].xeroAccountCode = row.xero.lines[0].accountCode = '51201'; for (const line of row.source.lines) line.accountCode = '51201'; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const input = fixture(); change(input); const result = evaluateGroupedPreservation(input);
    assert.equal(result.eligible, true, JSON.stringify(result.blockers));
    assert.notEqual(result.fingerprint, baseline, name);
  });
});

test('canonical aliases, decimal formatting and unique line/mapping order do not manufacture new fingerprints', () => {
  const input = fixture();
  input.source.lines[1].productId = '01t000000000002';
  input.productMappings.push({ ...input.productMappings[0], id: uuid(7), salesforceProductId: '01t000000000002' });
  const original = evaluateGroupedPreservation(input);
  input.source.lines.reverse(); input.productMappings.reverse();
  input.source.salesforceId += 'AAA'; input.source.accountId += 'AAA'; input.source.lines[0].id += 'AAA';
  input.source.lines[0].quantity = 2; input.source.lines[0].unitAmount = '10.01000000'; input.source.total = 30.03;
  const changed = evaluateGroupedPreservation(input);
  assert.equal(changed.eligible, true, JSON.stringify(changed.blockers));
  assert.equal(changed.fingerprint, original.fingerprint);
  assert.deepEqual(changed.evidence, original.evidence);
});

test('results are deeply immutable, detached and bounded; malformed shapes fail closed', async (t) => {
  const input = fixture(); const result = evaluateGroupedPreservation(input);
  assert.ok(Object.isFrozen(result.evidence.accounting.source.lines[0]));
  assert.ok(Object.isFrozen(result.evidence.observations.ownership));
  assert.throws(() => { result.evidence.accounting.source.lines[0].lineAmountCents = '1'; }, TypeError);
  input.source.lines[0].description = 'later change';
  assert.equal(result.evidence.accounting.source.lines[0].description, 'Marine fuel');
  const malformed = evaluateGroupedPreservation(null);
  assert.equal(malformed.eligible, false); assert.ok(Object.isFrozen(malformed.blockers[0]));
  assert.ok(malformed.blockers.length <= 64);
  await t.test('one source line', () => rejected((row) => { row.source.lines.pop(); }, 'LINE_COUNT_UNSUPPORTED'));
  await t.test('too many source lines', () => rejected((row) => { row.source.lines = Array(GROUPED_PRESERVATION_MAX_LINES + 1).fill(row.source.lines[0]); }, 'EVIDENCE_BOUND'));
  await t.test('two Xero lines', () => rejected((row) => { row.xero.lines.push({ ...row.xero.lines[0], id: uuid(40) }); }, 'EVIDENCE_BOUND'));
  await t.test('oversized description', () => rejected((row) => { row.source.lines[0].description = 'x'.repeat(2001); }, 'FIELD_INVALID'));
  await t.test('oversized complete proof', () => {
    const large = fixture();
    large.source.lines = Array.from({ length: 50 }, (_, index) => ({ ...structuredClone(large.source.lines[0]),
      id: `a02${String(index).padStart(12, '0')}`, description: 'x'.repeat(2000), quantity: '1', unitAmount: '1', lineAmount: '1' }));
    large.source.subtotal = large.source.total = large.source.signedTotal = '50';
    large.xero.subtotal = large.xero.total = large.xero.amountDue = '50';
    large.xero.lines[0].unitAmount = large.xero.lines[0].lineAmount = '50';
    rejected(() => {}, 'EVIDENCE_BOUND', large);
  });
});
