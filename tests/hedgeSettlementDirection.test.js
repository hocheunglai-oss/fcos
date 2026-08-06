import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateHedgeInvoicePdf, normalizeHedgeInvoice } from '../api/_hedgeDocuments.js';
import {
  DEFAULT_RATES,
  hedgeSettlementPaymentDirection,
  monthlyBrokerCommissionSummary,
  settlementSummary,
} from '../src/hedge/lib/domain.js';

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
  assert.match(documents, /const brandBlue = \[0, 65, 123\]/);
  assert.match(documents, /doc\.setTextColor\(\.\.\.brandBlue\)/);
  assert.match(documents, /doc\.setDrawColor\(\.\.\.brandBlue\)/);
  assert.match(documents, /doc\.line\(margin, 45, right, 45\)/);
  assert.match(documents, /doc\.line\(margin, 48, right, 48\)/);
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

test('broker commissions are grouped by trade month and every broker', () => {
  const swaps = [
    { id: 'jul-ginga-1', trade_date: '2026-07-02', venue: 'ICE', broker: 'Ginga', quantity: 100, unit: 'MT' },
    { id: 'jul-ginga-2', trade_date: '2026-07-03', venue: 'ICE', broker: ' ginga ', quantity: 100, unit: 'MT', round_trip: true },
    { id: 'jul-fis', trade_date: '2026-07-04', venue: 'ICE', broker: 'FIS', quantity: 100, unit: 'BBL' },
    { id: 'jul-new', trade_date: '2026-07-05', venue: 'ICE', broker: 'New Broker', quantity: 100, unit: 'MT' },
    { id: 'jun-ginga', trade_date: '2026-06-06', venue: 'ICE', broker: 'Ginga', quantity: 200, unit: 'MT' },
    { id: 'non-ice', trade_date: '2026-07-07', venue: 'FCBS', broker: 'Ginga', quantity: 100, unit: 'MT' },
    { id: 'missing-broker', trade_date: '2026-07-08', venue: 'ICE', broker: '', quantity: 100, unit: 'MT' },
  ];
  const rates = { ...DEFAULT_RATES, broker_mt: 0.05, broker_bbl: 0.1 };

  const result = monthlyBrokerCommissionSummary(swaps, rates);
  assert.deepEqual(result.map((row) => row.month), ['2026-07', '2026-06']);
  assert.deepEqual(result[0].rows, [
    { broker: 'FIS', tradeCount: 1, commission: 10 },
    { broker: 'Ginga', tradeCount: 2, commission: 15 },
    { broker: 'New Broker', tradeCount: 1, commission: 5 },
  ]);
  assert.equal(result[0].tradeCount, 4);
  assert.equal(result[0].totalCommission, 30);
  assert.equal(result[1].totalCommission, 10);

  const july = settlementSummary(swaps, [], rates, '2026-07');
  assert.equal(july.brokerSwaps.length, 4);
  assert.equal(july.broker, 30);
});

test('settlement UI includes the all-month broker commission ledger', async () => {
  const view = await readFile(new URL('../src/hedge/views/SettlementView.jsx', import.meta.url), 'utf8');
  assert.match(view, /Monthly broker commissions/);
  assert.match(view, /Commission payable \(USD\)/);
  assert.match(view, /Month total \(USD\)/);
  assert.match(view, /monthlyBrokerCommissionSummary/);
});
