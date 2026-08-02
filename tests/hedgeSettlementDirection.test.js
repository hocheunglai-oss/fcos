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
  assert.equal(direction.beneficiaryBankConfigured, false);
});

test('a positive FCBHK settlement makes FCBHK the beneficiary', () => {
  const direction = hedgeSettlementPaymentDirection(441426.96, fcbs);
  assert.equal(direction.label, 'FCBS pays FCBHK');
  assert.equal(direction.invoiceType, 'Debit Note');
  assert.equal(direction.beneficiary.fullName, 'FRATELLI COSULICH BUNKERS (HK) LTD');
  assert.equal(direction.beneficiaryBankConfigured, true);
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
  assert.match(view, /FCBS bank instructions are not configured/);
  assert.match(documents, /PAYMENT DIRECTION:/);
  assert.match(documents, /Obtain directly from the beneficiary/);
  assert.doesNotMatch(documents, /Beneficiary: FRATELLI COSULICH BUNKERS \(HK\) LTD/);
  assert.match(documents, /authoritativeInvoicePayload/);
  for (const variable of ['payer', 'payee', 'beneficiary']) {
    assert.match(service, new RegExp(`'${variable}'`));
    assert.match(settings, new RegExp(`\\{${variable}\\}`));
  }
});
