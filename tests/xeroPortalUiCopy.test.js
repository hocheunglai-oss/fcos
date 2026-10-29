import assert from 'node:assert/strict';
import test from 'node:test';
import { XERO_PORTAL_UI_COPY, XERO_PORTAL_UI_LANGUAGES, normalizeXeroPortalLanguage, xeroPortalUiCopy } from '../src/lib/xeroPortalUiCopy.js';

test('every English portal label and dynamic message remains defined', () => {
  const summary = { created: 1, existing: 2, blocked: 3, uncertain: 4, updated: 5, linked: 6, applied: 7, failed: 8 };
  let strings = 0, functions = 0;
  function check(value, path) {
    if (typeof value === 'function') {
      functions++;
      for (const args of [[1, 2, 3, 4], [summary, 'basis', 'status', 4]]) {
        const text = value(...args);
        assert.equal(typeof text, 'string', path); assert.ok(text.trim(), path); assert.ok(!text.includes('undefined'), path);
        assert.doesNotMatch(text, /\p{Script=Han}/u, path);
      }
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) check(value[key], `${path}.${key}`);
    } else {
      strings++;
      assert.equal(typeof value, 'string', path); assert.ok(value.trim(), path);
      assert.doesNotMatch(value, /\p{Script=Han}/u, path);
    }
  }
  check(XERO_PORTAL_UI_COPY.en, 'copy');
  assert.ok(strings > 400); assert.ok(functions > 20);
});

test('Chinese saved preferences and unsupported languages resolve to English', () => {
  assert.deepEqual(XERO_PORTAL_UI_LANGUAGES, [{ id: 'en', label: 'English' }]);
  assert.deepEqual(Object.keys(XERO_PORTAL_UI_COPY), ['en']);
  for (const language of ['en', 'zh-Hant', 'zh-HK', 'zh', 'fr', '', null, undefined]) {
    assert.equal(normalizeXeroPortalLanguage(language), 'en');
    assert.equal(xeroPortalUiCopy(language), XERO_PORTAL_UI_COPY.en);
  }
});
