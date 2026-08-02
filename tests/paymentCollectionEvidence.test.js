import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { classifyBuyerPaymentEvidence, earliestEtaDate } from '../src/lib/paymentCollectionEvidence.js';

test('classifies a partial payment before the earliest ETA as Partial CIA', () => {
  assert.deepEqual(
    classifyBuyerPaymentEvidence({
      paymentDate: '2026-07-05',
      etaStartDate: '2026-07-06',
      etaEndDate: '2026-07-08',
      isPartial: true,
    }),
    {
      code: 'partial_cia',
      label: 'Partial CIA',
      receivedDate: '2026-07-05',
      earliestEtaDate: '2026-07-06',
      receivedBeforeEarliestEta: true,
    },
  );
});

test('classifies equal, later, or missing ETA dates as Partial Payment', () => {
  for (const input of [
    { paymentDate: '2026-07-06', etaStartDate: '2026-07-06' },
    { paymentDate: '2026-07-07', etaStartDate: '2026-07-06' },
    { paymentDate: '2026-07-05', etaStartDate: null },
  ]) {
    const result = classifyBuyerPaymentEvidence({ ...input, isPartial: true });
    assert.equal(result.code, 'partial_payment');
    assert.equal(result.label, 'Partial Payment');
    assert.equal(result.receivedBeforeEarliestEta, false);
  }
});

test('uses the earliest available ETA boundary and leaves non-partial evidence as Buyer payment', () => {
  assert.equal(earliestEtaDate('2026-07-08', '2026-07-06'), '2026-07-06');
  assert.equal(classifyBuyerPaymentEvidence({
    paymentDate: '2026-07-05',
    etaStartDate: '2026-07-06',
    isPartial: false,
  }).label, 'Buyer payment');
});

test('Payment Collections derives the classification from live Salesforce payment and ETA dates', async () => {
  const [server, page, methodology] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pageMethodologies.js', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /'ETA_Start_Date__c'/);
  assert.match(server, /'ETA_End_Date__c'/);
  assert.match(server, /isPartial: decision\.state === 'partial_payment'/);
  assert.match(server, /paymentEvidence,/);
  assert.match(page, /paymentEvidence\?\.label \|\| 'Buyer payment'/);
  assert.match(methodology, /received before the earliest available Salesforce ETA date is labelled Partial CIA/);
});
