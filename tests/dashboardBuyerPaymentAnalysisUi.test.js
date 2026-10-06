import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
async function component() {
  const source = await readFile(new URL('../src/components/dashboard/BuyerPaymentAnalysis.jsx', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports.default;
}
test('desktop results expose sample size, full settlement, sample warning and exclusions', async () => {
  const Component = await component();
  const html = renderToStaticMarkup(createElement(Component, { periodLabel: '2026 · Sep', result: { buyers: [
    { accountId: 'buyer', name: 'Buyer A', currency: 'USD', invoiceCount: 5, earlyPaidCount: 4, earlyPaymentRate: 0.8, medianDaysPaidBeforeDue: 3, usuallyPaysEarly: true },
    { accountId: 'small', name: 'Buyer B', currency: 'EUR', invoiceCount: 1, earlyPaidCount: 1, earlyPaymentRate: 1, medianDaysPaidBeforeDue: 1, usuallyPaysEarly: false },
  ], exclusions: { multiple_invoices: 2 } } }));
  for (const text of ['Buyer A','80.0%','3.0 days','Usually pays early','Insufficient history','multiple invoices: 2','at least 7 calendar days','Partial payments','CreatedDate in Hong Kong']) assert.ok(html.includes(text), text);
});
test('no eligible evidence gives a clear empty result', async () => {
  const html = renderToStaticMarkup(createElement(await component(), { result: { buyers: [] } }));
  assert.match(html, /No buyers have eligible/);
  assert.doesNotMatch(html, /<table/);
});
