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

test('AI results keep pending Production summary and EBIT requests alive', async () => {
  const source = await readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const runAiSearch = useCallback(async (prompt) => {');
  const end = source.indexOf('  }, [filterPayload,', start);
  assert.ok(start >= 0 && end > start);
  const callbackBody = source.slice(start, end).split('async (prompt) => {')[1];
  let summaryAborts = 0;
  let stemAborts = 0;
  let loading = { stems: true, summary: true };
  let analysis = null;
  const ignore = () => {};
  const run = new Function('invoke', 'filterPayload', 'filters', 'aborts', 'setLoading', 'setErrors', 'setAiSearchActive', 'setStemSearch', 'setPaymentAnalysis', 'setStems', 'setNavigation', 'setTab',
    `return async (prompt) => {${callbackBody}};`)(
    async () => ({ result: { data: { aiSearch: { status: 'ready', matchedCount: 1 }, paymentAnalysis: { buyers: [{ name: 'Buyer A' }] } } } }),
    {}, { selectedYears: [2026], selectedMonths: [9] },
    { current: { stems: { abort: () => { stemAborts++; } }, summary: { abort: () => { summaryAborts++; } } } },
    (update) => { loading = update(loading); }, ignore, ignore, ignore,
    (value) => { analysis = value; }, ignore, ignore, ignore,
  );
  await run('buyers paying early');
  assert.equal(stemAborts, 1);
  assert.equal(summaryAborts, 0);
  assert.equal(loading.summary, true);
  assert.equal(loading.stems, false);
  assert.equal(analysis.buyers[0].name, 'Buyer A');
});
