import { expect, test } from '@playwright/test';
import { evaluateRemittanceSummary } from '../api/_xeroRemittanceSummary.js';
test.use({ screenshot: 'off', trace: 'off' });

const id = number => `a0S${String(number).padStart(12, '0')}`;
const rawBase = { Account__c: '001000000000001', Date__c: '2026-09-27', CurrencyIsoCode: 'USD',
  Bank__c: 'UBS', Remittance__c: null, STEM__c: null, Supplier_Invoice__c: null,
  Commission_Invoice__c: null, Is_Deposit__c: false, Is_Volume_Discount__c: false };
const rawParents = [
  { ...rawBase, Id: id(1), Amount__c: 100, RecordType: { DeveloperName: 'Payable_Remittance' } },
  { ...rawBase, Id: id(2), Amount__c: 200, RecordType: { DeveloperName: 'Receivable_Remittance' } },
];
const rawChildren = [
  { ...rawBase, Id: id(3), Remittance__c: id(1), Amount__c: 100, Supplier_Invoice__c: 'a06000000000001', RecordType: { DeveloperName: 'Payable' } },
  { ...rawBase, Id: id(4), Remittance__c: id(2), Amount__c: 200, STEM__c: 'a0H000000000001', RecordType: { DeveloperName: 'Receivable' } },
];
const paymentBase = { currency: 'USD', paymentDate: '2026-09-27', bank: 'UBS', proposedPayment: null, xeroPaymentId: null };
const paymentRows = [
  ...rawParents.map((parent, index) => {
    const evaluated = evaluateRemittanceSummary(parent, { siblings: [rawChildren[index]],
      visiblePayments: [...rawParents, ...rawChildren], complete: true, headerUnmapped: true });
    if (!evaluated.eligible) throw new Error('Local remittance fixture family must pass the real structural evaluator.');
    return { ...paymentBase, salesforcePaymentId: parent.Id, salesforcePaymentName: index ? 'HEADER-RECEIVABLE' : 'HEADER-PAYABLE',
      type: parent.RecordType.DeveloperName, amount: parent.Amount__c, action: 'remittance_summary', status: 'informational',
      blockers: [], remittanceSummary: evaluated.evidence };
  }),
  { ...paymentBase, salesforcePaymentId: id(3), salesforcePaymentName: 'CHILD-PAYABLE', type: 'Payable', amount: 100,
    action: 'blocked', status: 'blocked', blockers: ['Named payment bank conflicts with approved allocation evidence.'], blockerCodes: ['finance_exception'] },
  { ...paymentBase, salesforcePaymentId: id(4), salesforcePaymentName: 'CHILD-RECEIVABLE', type: 'Receivable', amount: 200,
    action: 'blocked', status: 'blocked', blockers: ['Existing payment reference requires Finance review.'], blockerCodes: ['finance_exception'] },
  { ...paymentBase, salesforcePaymentId: id(5), salesforcePaymentName: 'HELD-BANK-CHARGE', type: 'Bank_Charge', amount: 10,
    action: 'blocked', status: 'blocked', blockers: ['Bank charge is outside exact invoice allocations.'], blockerCodes: ['finance_exception'] },
  { ...paymentBase, salesforcePaymentId: id(6), salesforcePaymentName: 'MATCHED-CASH', type: 'Payable', amount: 50,
    action: 'payment_link', status: 'linked', blockers: [], xeroPaymentId: 'local-matched-payment' },
];

async function openFixture(page) {
  const violations = []; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    const base = new URL(test.info().project.use.baseURL);
    if (url.origin !== base.origin || request.method() !== 'GET' || /^\/api(?:\/|$)/.test(url.pathname)) {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return;
    }
    if (url.pathname === '/e2e/fixtures/xero-exception.jsx') {
      const response = await route.fetch(); const source = await response.text();
      const marker = 'createRoot(document.getElementById("root")).render(';
      expect(source).toContain(marker);
      const injection = `
        const summaryRequests = [];
        window.remittanceSummaryFixture = { requests: summaryRequests };
        const summaryPreview = {
          run: { id: 'local-remittance-only', revision: 1, status: 'ready_for_review', postingMode: 'draft' },
          postingMode: 'draft', checkedAt: new Date().toISOString(),
          rows: [{ ...row, id: 'matched-document', salesforceId: 'local-invoice', documentNumber: 'MATCHED-DOCUMENT',
            action: 'link', status: 'linked', reviewRequired: false, selected: false, blockers: [], differences: [], warnings: [] }],
          payments: { rows: ${JSON.stringify(paymentRows)}, summary: { total: 6, paymentApply: 0, paymentLink: 1, blocked: 3, remittanceSummary: 2 } },
          products: [], mappingProposals: []
        };
        appClient.functions.invoke = async (name, body) => {
          summaryRequests.push({ name, body });
          if (name === 'xeroFinancialSyncLatest') return { data: { preview: summaryPreview } };
          if (name === 'xeroFinancialMappingsGet') return { data: { productMappings: [], bankMappings: [], accountOptions: [], taxOptions: [] } };
          throw new Error('Unexpected local fixture API: ' + name);
        };
      `;
      await route.fulfill({ response, body: source.replace(marker, injection + marker) }); return;
    }
    await route.continue();
  });
  await page.goto('/e2e/fixtures/xero-exception.html');
  await expect(page.getByRole('button', { name: 'Remittance summaries (2)', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  return { violations, errors };
}

test.describe('offline remittance summary presentation', () => {
  test.skip(process.env.FCOS_E2E_REMITTANCE_SUMMARY_FIXTURE !== '1', 'Opt-in local fixture with fail-closed network interception.');

  test('verified summaries expose allocation names but never become selectable matched or ready payments', async ({ page }, testInfo) => {
    const observations = await openFixture(page);
    await expect(page.getByRole('button', { name: 'Needs attention (3)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Matched (2)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ready to sync (0)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remittance summaries (2)', exact: true }).click();
    for (const [header, child] of [['HEADER-PAYABLE', 'CHILD-PAYABLE'], ['HEADER-RECEIVABLE', 'CHILD-RECEIVABLE']]) {
      const row = page.getByRole('row').filter({ hasText: header });
      await expect(row.getByRole('checkbox')).toBeDisabled(); await expect(row.getByRole('checkbox')).not.toBeChecked();
      await expect(row).toContainText(/Allocation summaries.*(?:not additional payments|no extra payments)/);
      await row.locator('summary').click(); await expect(row).toContainText(child);
    }
    await page.getByRole('button', { name: 'Apply exact payments', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Apply exact payments', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('summary-viewport.png'), animations: 'disabled' });
    await page.screenshot({ path: testInfo.outputPath('summary-full.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Matched (2)', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'HEADER-' })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'MATCHED-CASH' })).toBeVisible();
    await page.getByRole('button', { name: 'Ready to sync (0)', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'HEADER-' })).toHaveCount(0);
    expect(observations.violations).toEqual([]); expect(observations.errors).toEqual([]);
    expect(await page.evaluate(() => window.remittanceSummaryFixture.requests.map(call => call.name).sort())).toEqual(['xeroFinancialMappingsGet', 'xeroFinancialSyncLatest']);
  });

  test('summary headers preserve child attention, classified counts and completion denominator without mobile page overflow', async ({ page }, testInfo) => {
    const observations = await openFixture(page);
    const completion = page.getByText('Verified completion', { exact: true }).locator('..');
    await expect(completion).toContainText('40%');
    await expect(page.getByText('Salesforce records', { exact: true }).locator('..')).toContainText('7');
    await expect(page.getByText('Exceptions', { exact: true }).locator('..')).toContainText('3');
    await expect(page.getByText('6 classified · 0 exact allocations eligible.', { exact: true })).toBeVisible();
    for (const name of ['CHILD-PAYABLE', 'CHILD-RECEIVABLE', 'HELD-BANK-CHARGE']) {
      const row = page.getByRole('row').filter({ hasText: name });
      await expect(row).toBeVisible(); await expect(row.getByRole('checkbox')).toBeDisabled();
    }
    await expect(page.getByRole('row').filter({ hasText: 'HEADER-' })).toHaveCount(0);
    await page.getByRole('button', { name: 'All (7)', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'HEADER-' })).toHaveCount(2);
    for (const row of await page.getByRole('row').filter({ hasText: 'HEADER-' }).all()) await expect(row.getByRole('checkbox')).toBeDisabled();
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, page: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.getByRole('button', { name: 'All (7)', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('all-viewport.png'), animations: 'disabled' });
    await page.screenshot({ path: testInfo.outputPath('all-full.png'), fullPage: true, animations: 'disabled' });
    expect(observations.violations).toEqual([]); expect(observations.errors).toEqual([]);
    expect(await page.evaluate(() => window.remittanceSummaryFixture.requests.map(call => call.name).sort())).toEqual(['xeroFinancialMappingsGet', 'xeroFinancialSyncLatest']);
  });
});
