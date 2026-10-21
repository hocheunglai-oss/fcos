import { test, expect } from '@playwright/test';
const open = async (page, suffix = '') => { await page.goto(`/e2e/fixtures/xero-campaign.html${suffix}`); await expect(page.getByRole('heading', { name: '2026 reconciliation campaign' })).toBeVisible(); };

test('read-only launch shows operator decisions, quota observation, and no provider check until requested', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Accounting treatment requires operator decision.')).toBeVisible();
  await expect(page.getByText(/894 remaining · 200 reserved/)).toBeVisible();
  expect(await page.evaluate(() => window.campaignFixture.requests.map((request) => request.name))).toEqual(['xeroReconciliationCampaignRead']);
  await page.getByRole('button', { name: 'Check Xero connection and allowance' }).click();
  await expect(page.getByRole('status')).toContainText('Xero connection verified');
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationConnectionCheck').length)).toBe(1);
});

const approveLoadedLinks = async (page) => {
  await page.getByLabel('Campaign category').selectOption('link_only');
  await expect(page.getByText('50 loaded of 60')).toBeVisible();
  await page.getByRole('button', { name: 'Load next page' }).click();
  await expect(page.getByText('60 loaded of 60')).toBeVisible();
  await page.getByRole('button', { name: 'Select loaded ready' }).click();
  await expect(page.getByText('60 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Preview exact batch' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('exact-batch-fingerprint');
  await expect(dialog).toContainText('60 cases');
  await expect(dialog).toContainText('Full approval forecast: 130 calls');
  await expect(dialog).toContainText('Next run forecast: 20 calls');
  await expect(dialog.getByRole('button', { name: 'Approve reviewed batch' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I reviewed each case/ }).check();
  await dialog.getByRole('button', { name: 'Approve reviewed batch' }).click();
  await expect(dialog.getByRole('button', { name: 'Run approved links' })).toBeEnabled();
  expect(await page.evaluate(() => window.campaignFixture.runs.length)).toBe(0);
  return dialog;
};

test('one explicit start advances five then twenty-five with one final summary read', async ({ page }) => {
  await open(page);
  const dialog = await approveLoadedLinks(page);
  const readCount = await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignRead').length);
  await dialog.getByRole('button', { name: 'Run approved links' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Approved link batch complete.*60 of 60 cases verified/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verified batch outcomes' })).toBeVisible();
  await expect(page.getByText('60 selected')).toBeVisible();
  await expect(page.getByLabel('Campaign category')).toHaveValue('link_only');
  await expect(page.getByLabel('Campaign status')).toHaveValue('ready');
  await expect(page.getByText('Reconciled', { exact: true }).first().locator('..')).toContainText('60');
  expect(await page.evaluate(() => window.campaignFixture.runs.map((run) => run.ids.length))).toEqual([5, 25, 25, 5]);
  const requests = await page.evaluate(() => window.campaignFixture.requests);
  const preview = requests.find((request) => request.name === 'xeroReconciliationCampaignPreview');
  const approval = requests.find((request) => request.name === 'xeroReconciliationCampaignApprove');
  expect(preview.body.category).toBe('link_only'); expect(preview.body.caseIds).toHaveLength(60);
  expect(approval.body.expectedFingerprint).toBe('exact-batch-fingerprint'); expect(approval.body.reviewed).toBe(true);
  expect(requests.filter((request) => request.name === 'xeroReconciliationCampaignApprove')).toHaveLength(1);
  expect(requests.filter((request) => request.name === 'xeroReconciliationCampaignRead')).toHaveLength(readCount + 1);
  expect(requests.slice(requests.findIndex((request) => request.name === 'xeroReconciliationCampaignRun')).map((request) => request.name)).toEqual(['xeroReconciliationCampaignRun', 'xeroReconciliationCampaignRun', 'xeroReconciliationCampaignRun', 'xeroReconciliationCampaignRun', 'xeroReconciliationCampaignRead']);
  const runs = requests.filter((request) => request.name === 'xeroReconciliationCampaignRun');
  expect(runs.map((run) => run.body.expectedRevision)).toEqual([2, 4, 6, 8]);
  expect(runs.every((run) => run.body.batchId === approval.body.batchId && run.body.expectedFingerprint === 'exact-batch-fingerprint')).toBe(true);
  expect(await page.evaluate(() => new Set(window.campaignFixture.runs.flatMap((run) => run.ids)).size)).toBe(60);
  await page.screenshot({ path: 'test-results/xero-reconciliation-campaign-desktop.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Stop finishes the current atomic batch and keeps the exact approval for explicit restart', async ({ page }) => {
  await open(page, '?controlled=1');
  const dialog = await approveLoadedLinks(page);
  const readCount = await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignRead').length);
  await dialog.getByRole('button', { name: 'Run approved links' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.campaignFixture.releaseRun))).toBe(true);
  await expect(dialog.getByRole('heading', { name: 'Running approved links' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop after this batch' }).click();
  await expect(dialog.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
  expect(await page.evaluate(() => window.campaignFixture.runs.map((run) => run.ids.length))).toEqual([5]);
  await page.evaluate(() => window.campaignFixture.releaseRun());
  await expect(dialog).toContainText('Verified cases: 5');
  await expect(dialog.getByRole('button', { name: 'Run approved links' })).toBeEnabled();
  await expect(page.getByText('Stopped after the current atomic batch.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.campaignFixture.runs.map((run) => run.ids.length))).toEqual([5]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open approved batch' }).click();
  expect(await page.evaluate(() => window.campaignFixture.runs.length)).toBe(1);
  await page.evaluate(() => { window.campaignFixture.pauseRuns = false; });
  await dialog.getByRole('button', { name: 'Run approved links' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.campaignFixture.runs.map((run) => run.ids.length))).toEqual([5, 25, 25, 5]);
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignApprove').length)).toBe(1);
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignRead').length)).toBe(readCount + 2);
});

test('missing evidence and financial gate block approval; create campaign is explicit', async ({ page }) => {
  await open(page, '?locked=1');
  await page.getByLabel('Campaign category').selectOption('contact');
  await expect(page.getByRole('button', { name: 'Preview exact batch' })).toBeDisabled();
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name.endsWith('Approve')).length)).toBe(0);
  await open(page, '?empty=1');
  await expect(page.getByRole('button', { name: 'Start from saved check' })).toBeEnabled();
  expect(await page.evaluate(() => window.campaignFixture.requests.some((request) => request.name === 'xeroReconciliationCampaignCreate'))).toBe(false);
  await page.getByRole('button', { name: 'Start from saved check' }).click();
  await expect(page.getByText(/Saved reconciliation campaign created/)).toBeVisible();
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignCreate').length)).toBe(1);
});


test('offline evidence preview and approval remain available; run waits for an explicit verified quota check', async ({ page }) => {
  await open(page, '?noquota=1');
  await page.getByLabel('Campaign category').selectOption('link_only');
  await page.getByRole('checkbox', { name: 'Select HK26201T · Fixture vessel' }).check();
  await expect(page.getByRole('button', { name: 'Preview exact batch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview exact batch' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /I reviewed each case/ }).check();
  await dialog.getByRole('button', { name: 'Approve reviewed batch' }).click();
  await expect(dialog.getByRole('button', { name: 'Run approved links' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check connection before run' }).click();
  await expect(dialog.getByRole('button', { name: 'Run approved links' })).toBeEnabled();
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignRun').length)).toBe(0);
});


test('refresh current evidence keeps the fixed baseline, separates future activity, and invalidates changed approval', async ({ page }) => {
  await open(page);
  const baseline = await page.evaluate(() => window.campaignFixture.campaign.baselineAt);
  await page.getByLabel('Campaign category').selectOption('link_only');
  await page.getByRole('button', { name: 'Select loaded ready' }).click();
  await page.getByRole('button', { name: 'Preview exact batch' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /I reviewed each case/ }).check();
  await dialog.getByRole('button', { name: 'Approve reviewed batch' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByRole('button', { name: 'Refresh current evidence' }).click();
  await expect(page.getByRole('status')).toContainText('changed approvals require a new review');
  await page.getByLabel('Campaign category').selectOption('future_activity');
  await expect(page.getByText('Future delivery after fixed baseline')).toBeVisible();
  expect(await page.evaluate(() => window.campaignFixture.campaign.baselineAt)).toBe(baseline);
  await expect(page.getByRole('button', { name: 'Open approved batch' })).toHaveCount(0);
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignRun'))).toHaveLength(0);
});

test('lost run response preserves exact pending approval and requires explicit claimed-batch readback', async ({ page }) => {
  await open(page, '?uncertain=1');
  await page.getByLabel('Campaign category').selectOption('link_only');
  for (let index = 1; index <= 6; index++) await page.getByRole('checkbox', { name: `Select HK2620${index}T · Fixture vessel` }).check();
  await page.getByRole('button', { name: 'Preview exact batch' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /I reviewed each case/ }).check();
  await dialog.getByRole('button', { name: 'Approve reviewed batch' }).click();
  await dialog.getByRole('button', { name: 'Run approved links' }).click();
  await expect(dialog).toContainText('Outcome uncertain');
  await expect(dialog.getByRole('button', { name: 'Recover claimed batch' })).toBeEnabled();
  expect(await page.evaluate(() => window.campaignFixture.runs)).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByRole('button', { name: 'Refresh saved cases' }).click();
  await page.getByRole('button', { name: 'Open approved batch' }).click();
  await dialog.getByRole('button', { name: 'Recover claimed batch' }).click();
  await expect(dialog).toContainText('Verified cases: 5');
  expect(await page.evaluate(() => window.campaignFixture.runs.map((run) => ({ count: run.ids.length, recovering: run.recovering })))).toEqual([{ count: 5, recovering: false }, { count: 5, recovering: true }]);
  await dialog.getByRole('button', { name: 'Run approved links' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.campaignFixture.runs.map((run) => run.ids.length))).toEqual([5, 5, 1]);
  expect(await page.evaluate(() => window.campaignFixture.requests.filter((request) => request.name === 'xeroReconciliationCampaignApprove'))).toHaveLength(1);
});


test('saved-case readback does not retain an approval that is no longer pending on the server', async ({ page }) => {
  await open(page);
  await page.getByLabel('Campaign category').selectOption('link_only');
  await page.getByRole('checkbox', { name: 'Select HK26201T · Fixture vessel' }).check();
  await page.getByRole('button', { name: 'Preview exact batch' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /I reviewed each case/ }).check();
  await dialog.getByRole('button', { name: 'Approve reviewed batch' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.evaluate(() => { window.campaignFixture.batch.status = 'preview'; });
  await page.getByRole('button', { name: 'Refresh saved cases' }).click();
  await expect(page.getByRole('alert')).toContainText('no longer has a current approval');
  await expect(page.getByRole('button', { name: 'Open approved batch' })).toHaveCount(0);
  expect(await page.evaluate(() => window.campaignFixture.runs)).toHaveLength(0);
});
