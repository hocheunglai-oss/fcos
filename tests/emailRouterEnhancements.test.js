import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentIntelligence,
  DEFAULT_TRUSTED_EMAIL_IMAGE_DOMAINS,
  emailImageSourceSummary,
  emailRouterClientMetrics,
  emailRouterShortcut,
  recordEmailRouterClientMetric,
  senderDomain,
  summarizeEmailRouterMetrics,
  trustEmailImageDomain,
  trustedEmailImageDomains,
} from '../src/lib/emailRouterEnhancements.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test('Email Router image privacy keeps trusted preferences domain-only and detects tracking images', () => {
  const storage = memoryStorage();
  assert.deepEqual(trustedEmailImageDomains(storage), [...DEFAULT_TRUSTED_EMAIL_IMAGE_DOMAINS]);
  assert.equal(senderDomain({ from: { email: 'OPS@COSULICH.COM.HK' } }), 'cosulich.com.hk');
  assert.ok(trustEmailImageDomain('partner.example', storage).includes('partner.example'));
  assert.equal(storage.getItem('fcos:email-router-trusted-sender-domains'), '["partner.example"]');
  assert.deepEqual(emailImageSourceSummary('<img src="https://example.test/logo.png"><img src="https://track.test/p" width="1" height="1">'), { total: 2, remote: 2, tracking: 1 });
});

test('Email Router attachment intelligence flags unsafe, mismatched, macro, and duplicate evidence', () => {
  const intelligence = attachmentIntelligence([
    { name: 'invoice.pdf', size: 10, contentType: 'text/plain' },
    { name: 'invoice.pdf', size: 10, contentType: 'application/pdf' },
    { name: 'review.xlsm', size: 20, contentType: 'application/vnd.ms-excel' },
    { name: 'run.exe', size: 30, contentType: 'application/octet-stream' },
  ]);
  assert.equal(intelligence[0].mismatch, true);
  assert.equal(intelligence[0].duplicate, true);
  assert.equal(intelligence[2].macroEnabled, true);
  assert.equal(intelligence[3].dangerous, true);
});

test('Email Router session metrics remain redacted and summarize latency', () => {
  const storage = memoryStorage();
  recordEmailRouterClientMetric({ operation: 'detail load', durationMs: 100, outcome: 'success', subject: 'must not persist' }, storage);
  recordEmailRouterClientMetric({ operation: 'detail load', durationMs: 300, outcome: 'failed' }, storage);
  const rows = emailRouterClientMetrics(storage);
  assert.equal(rows.length, 2);
  assert.equal('subject' in rows[0], false);
  assert.deepEqual(summarizeEmailRouterMetrics(rows), [{ operation: 'detail_load', count: 2, failures: 1, averageMs: 200, p95Ms: 300 }]);
});

test('Email Router shortcuts never override typing and require a selected message for actions', () => {
  assert.equal(emailRouterShortcut({ key: 'j', target: {} }), 'next_message');
  assert.equal(emailRouterShortcut({ key: 'r', target: {} }, { hasMessage: false }), null);
  assert.equal(emailRouterShortcut({ key: 'r', target: {} }, { hasMessage: true }), 'focus_route');
  assert.equal(emailRouterShortcut({ key: 'e', target: { closest: () => ({ tagName: 'INPUT' }) } }, { hasMessage: true }), null);
  assert.equal(emailRouterShortcut({ key: 's', metaKey: true, target: {} }), null);
});
