import assert from 'node:assert/strict';
import test from 'node:test';
import { XERO_PORTAL_UI_COPY, XERO_PORTAL_UI_LANGUAGES, xeroPortalUiCopy } from '../src/lib/xeroPortalUiCopy.js';

test('every exported bilingual copy field has a defined nonempty translation and matching structure', () => {
  const summary = { created: 1, existing: 2, blocked: 3, uncertain: 4, updated: 5, linked: 6, applied: 7, failed: 8 };
  let strings = 0, functions = 0;
  function check(english, chinese, path) {
    assert.equal(typeof english, typeof chinese, `${path} translation type`);
    if (typeof english === 'function') {
      functions++;
      for (const args of [[1, 2, 3, 4], [summary, 'basis', 'status', 4]]) {
        for (const value of [english(...args), chinese(...args)]) {
          assert.equal(typeof value, 'string', path); assert.ok(value.trim(), path); assert.ok(!value.includes('undefined'), path);
        }
      }
    } else if (english && typeof english === 'object') {
      assert.deepEqual(Object.keys(english), Object.keys(chinese), `${path} keys`);
      for (const key of Object.keys(english)) check(english[key], chinese[key], `${path}.${key}`);
    } else {
      strings++;
      assert.equal(typeof english, 'string', path); assert.ok(english.trim(), path); assert.ok(chinese.trim(), path);
    }
  }
  check(XERO_PORTAL_UI_COPY.en, XERO_PORTAL_UI_COPY['zh-Hant'], 'copy');
  assert.ok(strings > 400); assert.ok(functions > 20);
  for (const language of XERO_PORTAL_UI_LANGUAGES) assert.equal(xeroPortalUiCopy(language.id), XERO_PORTAL_UI_COPY[language.id]);
});
