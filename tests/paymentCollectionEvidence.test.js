import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  ciaComparisonBoundary,
  classifyBuyerPaymentEvidence,
  earliestEtaDate,
  summarizeBuyerPaymentEvidence,
} from '../src/lib/paymentCollectionEvidence.js';

test('uses the later available ETA or delivery boundary for the inclusive CIA rule', () => {
  assert.equal(earliestEtaDate('2026-07-08', '2026-07-06'), '2026-07-06');
  assert.deepEqual(
    ciaComparisonBoundary({
      etaStartDate: '2026-07-06',
      etaEndDate: '2026-07-08',
      deliveryDate: '2026-07-07',
    }),
    {
      earliestEtaDate: '2026-07-06',
      actualDeliveryDate: '2026-07-07',
      ciaBoundaryDate: '2026-07-07',
    },
  );
});

test('classifies a partial receipt on either qualifying boundary as Partial CIA', () => {
  for (const input of [
    { paymentDate: '2026-07-06', etaStartDate: '2026-07-06' },
    { paymentDate: '2026-07-07', etaStartDate: '2026-07-06', deliveryDate: '2026-07-07' },
    { paymentDate: '2026-07-06', etaStartDate: '2026-07-07', deliveryDate: '2026-07-05' },
  ]) {
    const result = classifyBuyerPaymentEvidence(input);
    assert.equal(result.code, 'partial_cia');
    assert.equal(result.label, 'Partial CIA');
    assert.equal(result.isCia, true);
  }
});

test('classifies a receipt after both boundaries or without a boundary as Partial Payment', () => {
  for (const input of [
    { paymentDate: '2026-07-08', etaStartDate: '2026-07-06', deliveryDate: '2026-07-07' },
    { paymentDate: '2026-07-05' },
  ]) {
    const result = classifyBuyerPaymentEvidence(input);
    assert.equal(result.code, 'partial_payment');
    assert.equal(result.label, 'Partial Payment');
    assert.equal(result.isCia, false);
  }
});

test('labels a settled collection as Full CIA or Full Payment using the same date rule', () => {
  assert.equal(classifyBuyerPaymentEvidence({
    paymentDate: '2026-07-06',
    etaStartDate: '2026-07-06',
    isFull: true,
  }).label, 'Full CIA');
  assert.equal(classifyBuyerPaymentEvidence({
    paymentDate: '2026-07-07',
    etaStartDate: '2026-07-06',
    isFull: true,
  }).label, 'Full Payment');
});

test('summarizes every positive buyer receipt and marks only the settling receipt as full', () => {
  const result = summarizeBuyerPaymentEvidence({
    payments: [
      { paymentId: 'p3', paymentDate: '2026-07-09', amount: 200 },
      { paymentId: 'p1', paymentDate: '2026-07-05', amount: 300 },
      { paymentId: 'p2', paymentDate: '2026-07-07', amount: 500 },
      { paymentId: 'ignored', paymentDate: '2026-07-04', amount: -25 },
    ],
    etaStartDate: '2026-07-06',
    deliveryDate: '2026-07-07',
    isFullyPaid: true,
  });

  assert.equal(result.paymentCount, 3);
  assert.equal(result.totalReceivedAmount, 1000);
  assert.equal(result.ciaReceivedAmount, 800);
  assert.equal(result.otherReceivedAmount, 200);
  assert.deepEqual(result.payments.map((payment) => payment.evidence.code), [
    'partial_cia',
    'partial_cia',
    'full_payment',
  ]);
  assert.equal(result.latestPayment.paymentId, 'p3');
  assert.equal(result.latestEvidence.label, 'Full Payment');
});

test('Payment Collections derives classifications and totals from live Salesforce dates and payments', async () => {
  const [server, page, methodology] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pageMethodologies.js', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /'ETA_Start_Date__c'/);
  assert.match(server, /'ETA_End_Date__c'/);
  assert.match(server, /'Delivery_Date__c'/);
  assert.match(server, /summarizeBuyerPaymentEvidence/);
  assert.match(server, /paymentCollectionBalanceIsSettled\(decision\.balance, thresholdPolicy\)/);
  assert.match(server, /paymentEvidenceSummary,/);
  assert.match(page, /PAYMENT_EVIDENCE_FILTERS/);
  assert.match(page, /Earliest ETA/);
  assert.match(page, /CIA \{fmtMoney\(summary\.ciaReceivedAmount\)\}/);
  assert.match(methodology, /on or before either the earliest available Salesforce ETA date or the actual delivery date/);
});
