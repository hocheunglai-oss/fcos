import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  XERO_PORTAL_LANGUAGE_STORAGE_KEY,
  XERO_PORTAL_UI_COPY,
  XERO_PORTAL_UI_LANGUAGES,
  normalizeXeroPortalLanguage,
  xeroPortalUiCopy,
} from '../src/lib/xeroPortalUiCopy.js';

test('Xero Portal active UI uses English and normalizes old saved language choices', () => {
  assert.deepEqual(XERO_PORTAL_UI_LANGUAGES.map((language) => language.id), ['en']);
  assert.equal(XERO_PORTAL_UI_COPY['zh-Hant'], undefined);
  assert.equal(normalizeXeroPortalLanguage('zh-Hant'), 'en');
  assert.equal(normalizeXeroPortalLanguage('zh-TW'), 'en');
  assert.equal(xeroPortalUiCopy('unknown'), XERO_PORTAL_UI_COPY.en);
  assert.equal(XERO_PORTAL_LANGUAGE_STORAGE_KEY, 'fcos:xero-portal-language:v1');
});

test('English UI retains review and explicit payment labels', () => {
  const copy = xeroPortalUiCopy('zh-Hant');
  assert.equal(copy, XERO_PORTAL_UI_COPY.en);
  assert.equal(copy.header.refresh, 'Refresh');
  assert.equal(copy.financial.applyPayments, 'Apply exact payments');
});

test('saved-report portal removes financial workspaces while retained manual loads English lazily', async () => {
  const page = await readFile(new URL('../src/pages/XeroPortal.jsx', import.meta.url), 'utf8');
  const financial = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  const manual = await readFile(new URL('../src/components/xero/XeroPortalManual.jsx', import.meta.url), 'utf8');

  assert.match(page, /xeroIntegrityReport/);
  assert.doesNotMatch(page, /<XeroFinancialSync|xeroPortalConnectStart|xeroFinancialPaymentApply/);
  assert.match(financial, /xeroPortalUiCopy\(language\)/);
  assert.match(manual, /setManual\(data\.en\)/);
  assert.doesNotMatch(manual, /controlledLanguage|XERO_PORTAL_MANUAL_LANGUAGES/);
  assert.doesNotMatch(page, /<XeroPortalManual/);
});
