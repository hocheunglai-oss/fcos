import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STANDARD_INVOICE_PARTY_SUFFIX,
  buildInvoiceVesselText,
  normalizeInvoiceVesselText,
} from '../force-app/main/default/lwc/fcbInvoiceForm/invoiceVesselText.js';

test('builds the approved invoice vessel heading for every document type', () => {
  const expected = 'M/V TEST VESSEL (IMO: 1234567) & OWNERS, CHARTERERS, MANAGERS &';
  for (const documentType of ['Buyer Invoice', 'Proforma Invoice', 'Credit Note']) {
    assert.equal(buildInvoiceVesselText('TEST VESSEL', '1234567'), expected, documentType);
  }
  assert.equal(STANDARD_INVOICE_PARTY_SUFFIX, '& OWNERS, CHARTERERS, MANAGERS &');
});

test('keeps the missing-IMO placeholder in the approved heading', () => {
  assert.equal(
    buildInvoiceVesselText('TEST VESSEL', 'N/A'),
    'M/V TEST VESSEL (IMO: N/A) & OWNERS, CHARTERERS, MANAGERS &',
  );
});

test('upgrades only the exact legacy standard suffix', () => {
  assert.equal(
    normalizeInvoiceVesselText('M/V TEST VESSEL (IMO: 1234567) & OWNER, CHARTERER &'),
    'M/V TEST VESSEL (IMO: 1234567) & OWNERS, CHARTERERS, MANAGERS &',
  );
  assert.equal(
    normalizeInvoiceVesselText('  M/V TEST VESSEL (IMO: 1234567) & owner, charterer &  '),
    'M/V TEST VESSEL (IMO: 1234567) & OWNERS, CHARTERERS, MANAGERS &',
  );
});

test('normalization is idempotent and does not duplicate managers', () => {
  const value = 'M/V TEST VESSEL (IMO: 1234567) & OWNERS, CHARTERERS, MANAGERS &';
  assert.equal(normalizeInvoiceVesselText(value), value);
  assert.equal(normalizeInvoiceVesselText(normalizeInvoiceVesselText(value)), value);
  assert.equal((normalizeInvoiceVesselText(value).match(/MANAGERS/gu) || []).length, 1);
});

test('preserves genuinely customized vessel text', () => {
  const custom = 'M/V TEST VESSEL (IMO: 1234567) FOR THE ACCOUNT OF SPECIAL BUYER';
  assert.equal(normalizeInvoiceVesselText(custom), custom);
});

test('the invoice form normalizes new, reused, and pre-generation vessel text', async () => {
  const source = await readFile(new URL('../force-app/main/default/lwc/fcbInvoiceForm/fcbInvoiceForm.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ buildInvoiceVesselText, normalizeInvoiceVesselText \} from '\.\/invoiceVesselText';/u);
  assert.match(source, /this\.vesselText = normalizeInvoiceVesselText\(this\.lastInvoiceForm\.Vessel_Text__c\?\.toUpperCase\(\)\);/u);
  assert.match(source, /this\.vesselText = buildInvoiceVesselText\(this\.stem\.Vessel__r\?\.Name\?\.toUpperCase\(\), imo\);/u);
  assert.match(source, /if \(this\.isGenerateDisabled\) return;\s+this\.vesselText = normalizeInvoiceVesselText\(this\.vesselText\);/u);
});
