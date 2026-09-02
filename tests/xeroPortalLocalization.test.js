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

function structure(value) {
  if (typeof value === 'function') return 'function';
  if (Array.isArray(value)) return ['array'];
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, structure(child)]));
  }
  return typeof value;
}

test('Xero Portal UI copy has complete parallel English and Traditional Chinese structures', () => {
  assert.deepEqual(XERO_PORTAL_UI_LANGUAGES.map((language) => language.id), ['en', 'zh-Hant']);
  assert.deepEqual(structure(XERO_PORTAL_UI_COPY['zh-Hant']), structure(XERO_PORTAL_UI_COPY.en));
  assert.equal(normalizeXeroPortalLanguage('zh-Hant'), 'zh-Hant');
  assert.equal(normalizeXeroPortalLanguage('zh-TW'), 'en');
  assert.equal(xeroPortalUiCopy('unknown'), XERO_PORTAL_UI_COPY.en);
  assert.equal(XERO_PORTAL_LANGUAGE_STORAGE_KEY, 'fcos:xero-portal-language:v1');
});

test('Traditional Chinese UI uses the same critical labels as the manual', () => {
  const copy = XERO_PORTAL_UI_COPY['zh-Hant'];
  assert.equal(copy.header.refresh, '重新整理');
  assert.equal(copy.header.connect, '連接 Xero');
  assert.equal(copy.tabs.accounting, '會計同步');
  assert.equal(copy.contacts.preview, '預覽');
  assert.equal(copy.contacts.applySelected, '套用所選項目');
  assert.equal(copy.financial.preview, '建立唯讀預覽');
  assert.equal(copy.financial.authorise, '授權批次');
  assert.equal(copy.financial.applyPayments, '套用精確付款');
  assert.equal(copy.receipts.createBill, '建立 Xero 草稿供應商帳單');
});

test('Xero Portal owns one persisted language and passes it to every lazy workspace', async () => {
  const page = await readFile(new URL('../src/pages/XeroPortal.jsx', import.meta.url), 'utf8');
  const financial = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  const manual = await readFile(new URL('../src/components/xero/XeroPortalManual.jsx', import.meta.url), 'utf8');

  assert.match(page, /localStorage\.getItem\(XERO_PORTAL_LANGUAGE_STORAGE_KEY\)/);
  assert.match(page, /localStorage\.setItem\(XERO_PORTAL_LANGUAGE_STORAGE_KEY, language\)/);
  assert.match(page, /<XeroFinancialSync portalStatus=\{status\} language=\{language\} \/>/);
  assert.match(page, /<XeroPortalManual language=\{language\} onLanguageChange=\{setLanguage\} \/>/);
  assert.match(financial, /xeroPortalUiCopy\(language\)/);
  assert.match(manual, /controlledLanguage/);
});
