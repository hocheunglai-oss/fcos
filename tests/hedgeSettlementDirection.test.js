import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateHedgeInvoicePdf, normalizeHedgeInvoice } from '../api/_hedgeDocuments.js';
import { hedgeSettlementPaymentDirection } from '../src/hedge/lib/domain.js';

const fcbs = {
  short_name: 'FCBS',
  full_name: 'FRATELLI COSULICH BUNKERS (S) PTE LTD',
};

test('a negative FCBHK settlement makes FCBS the beneficiary', () => {
  const direction = hedgeSettlementPaymentDirection(-419687.02, fcbs);
  assert.equal(direction.label, 'FCBHK pays FCBS');
  assert.equal(direction.invoiceType, 'Credit Note');
  assert.equal(direction.beneficiary.fullName, fcbs.full_name);
  assert.equal(Object.hasOwn(direction.beneficiary, 'bankName'), false);
});

test('a positive FCBHK settlement makes FCBHK the beneficiary', () => {
  const direction = hedgeSettlementPaymentDirection(441426.96, fcbs);
  assert.equal(direction.label, 'FCBS pays FCBHK');
  assert.equal(direction.invoiceType, 'Debit Note');
  assert.equal(direction.beneficiary.fullName, 'FRATELLI COSULICH BUNKERS (HK) LTD');
  assert.equal(direction.beneficiary.bankName, 'UBS AG, Singapore');
});

test('PDF normalization ignores a forged receivable flag and follows the signed amount', () => {
  const normalized = normalizeHedgeInvoice({
    invoiceNumber: 'FCBHK_TEST_001',
    netAmount: -419687.02,
    isReceivable: true,
    counterparty: fcbs,
  });
  assert.equal(normalized.isReceivable, false);
  assert.equal(normalized.paymentDirection.label, 'FCBHK pays FCBS');
  assert.equal(normalized.paymentDirection.beneficiary.fullName, fcbs.full_name);

  const generated = generateHedgeInvoicePdf({
    invoiceNumber: 'FCBHK_TEST_001',
    invoiceDate: '2026-08-02',
    settlementMonth: '2026-07',
    netAmount: -419687.02,
    isReceivable: true,
    counterparty: fcbs,
  });
  assert.equal(generated.invoice.paymentDirection.label, 'FCBHK pays FCBS');
  assert.ok(generated.buffer.length > 1000);
});

test('settlement invoice keeps eleven trades on one page', () => {
  const generated = generateHedgeInvoicePdf({
    invoiceNumber: 'FCBHK_TEST_011',
    invoiceDate: '2026-08-03',
    settlementMonth: '2026-07',
    netAmount: 11000,
    counterparty: fcbs,
    lineItems: Array.from({ length: 11 }, (_, index) => ({
      product: `JUL 2026 SWAP ${index + 1}`,
      direction: 'BUY',
      quantity: 100,
      unit: 'MT',
      price: 1,
      mtmValue: 1000,
      handlingFee: 0,
      netValue: 1000,
    })),
  });
  const pageMarkers = generated.buffer.toString('latin1').match(/\/Type \/Page\b/g) || [];
  assert.equal(pageMarkers.length, 1);
});

test('settlement UI and documents make the payment route explicit', async () => {
  const [view, documents, service, settings] = await Promise.all([
    readFile(new URL('../src/hedge/views/SettlementView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDocuments.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/hedge/components/HedgeSettingsPanel.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(view, /label: "FCBHK Invoices"/);
  assert.match(view, /Payment direction/);
  assert.match(view, /Beneficiary:/);
  assert.doesNotMatch(view, /FCBS bank instructions are not configured/);
  assert.doesNotMatch(view, /Money value=\{paymentDirection\.amount\}/);
  assert.match(documents, /PAYMENT DIRECTION:/);
  assert.match(documents, /addImage\(LOGO_DATA_URL, 'JPEG', 74, 12, 62, 24\)/);
  assert.match(documents, /FRATELLI COSULICH BUNKERS \(HK\) LTD', pageWidth \/ 2, 41, \{ align: 'center' \}/);
  assert.match(documents, /T \+852-25299138/);
  assert.match(documents, /GENERAL@COSULICH\.COM\.HK/);
  assert.match(documents, /doc\.line\(margin, 44, right, 44\)/);
  assert.match(documents, /doc\.line\(margin, 50, right, 50\)/);
  assert.match(documents, /doc\.rect\(0, 54, pageWidth, 11, 'F'\)/);
  assert.doesNotMatch(documents, /FCBHK settlement document/);
  assert.doesNotMatch(documents, /paymentDirection\.(payer|payee)\.shortName/);
  assert.doesNotMatch(documents, /Registered in Hong Kong/);
  assert.doesNotMatch(documents, /const totalsX/);
  assert.match(documents, /compactSinglePage = invoice\.lineItems\.length < 12/);
  assert.doesNotMatch(documents, /Obtain directly from the beneficiary/);
  assert.match(documents, /if \(invoice\.paymentDirection\.isReceivable\)/);
  assert.doesNotMatch(documents, /Beneficiary: FRATELLI COSULICH BUNKERS \(HK\) LTD/);
  assert.match(documents, /authoritativeInvoicePayload/);
  for (const variable of ['payer', 'payee', 'beneficiary']) {
    assert.match(service, new RegExp(`'${variable}'`));
    assert.match(settings, new RegExp(`\\{${variable}\\}`));
  }
});
