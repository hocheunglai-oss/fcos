import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { XERO_PORTAL_MANUAL_LANGUAGES, XERO_PORTAL_MANUALS } from '../src/lib/xeroPortalManual.js';

const REQUIRED_CONTROLS = [
  'Refresh',
  'Connect Xero',
  'Reconnect scopes',
  'Disconnect',
  'Preview',
  'Apply selected',
  'Build read-only preview',
  'Approve mapping',
  'Authorise batch',
  'Run selected',
  'Preview payments',
  'Apply exact payments',
  'OCR image',
  'Save draft',
  'Create Xero draft bill',
  'Sync',
  'JSON audit',
  'CSV audit',
];

test('Xero Portal manual keeps complete parallel English and Traditional Chinese structures', () => {
  assert.deepEqual(XERO_PORTAL_MANUAL_LANGUAGES.map((language) => language.id), ['en', 'zh-Hant']);
  const english = XERO_PORTAL_MANUALS.en;
  const traditionalChinese = XERO_PORTAL_MANUALS['zh-Hant'];
  assert.deepEqual(traditionalChinese.sections.map((section) => section.id), english.sections.map((section) => section.id));
  assert.equal(english.workflow.length, 6);
  assert.equal(traditionalChinese.workflow.length, english.workflow.length);

  for (const manual of [english, traditionalChinese]) {
    assert.ok(manual.title);
    assert.ok(manual.subtitle);
    assert.equal(manual.important.length, 3);
    assert.equal(manual.sections.reduce((sum, section) => sum + section.controls.length, 0), 49);
    for (const section of manual.sections) {
      assert.ok(section.title);
      assert.ok(section.purpose);
      assert.ok(section.steps.length);
      for (const control of section.controls) {
        assert.equal(control.length, 4);
        assert.ok(control[0]);
        assert.ok(control[1]);
        assert.ok(control[2]);
        assert.ok(['read', 'fcos', 'xero', 'navigation'].includes(control[3]));
      }
    }
  }
});

test('Xero Portal manual explains every critical write and review control', () => {
  const labels = XERO_PORTAL_MANUALS.en.sections.flatMap((section) => section.controls.map((control) => control[0]));
  for (const label of REQUIRED_CONTROLS) assert.ok(labels.includes(label), `${label} must be documented`);

  const xeroWrites = XERO_PORTAL_MANUALS.en.sections.flatMap((section) => section.controls).filter((control) => control[3] === 'xero').map((control) => control[0]);
  assert.deepEqual(xeroWrites.sort(), ['Apply exact payments', 'Apply selected', 'Create Xero draft bill', 'Run selected', 'Sync'].sort());
});

test('Xero Portal exposes the bilingual manual from both the header and tabs', async () => {
  const page = await readFile(new URL('../src/pages/XeroPortal.jsx', import.meta.url), 'utf8');
  const manual = await readFile(new URL('../src/components/xero/XeroPortalManual.jsx', import.meta.url), 'utf8');
  assert.match(page, /setTab\('manual'\)/);
  assert.match(page, /TabsTrigger value="manual">User Manual<\/TabsTrigger>/);
  assert.match(page, /<XeroPortalManual \/>/);
  assert.match(manual, /XERO_PORTAL_MANUAL_LANGUAGES\.map/);
  assert.match(manual, /Buttons and controls/);
  assert.match(manual, /按鈕及控制項/);
});
