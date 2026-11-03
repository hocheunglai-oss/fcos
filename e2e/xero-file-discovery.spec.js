import { test, expect } from '@playwright/test';
for (const language of ['en', 'zh-Hant']) test(`English supplier file observations remain non-authoritative with saved language (${language})`, async ({ page }) => {
  await page.goto(`/e2e/fixtures/xero-file-discovery.html?language=${language}`);
  const complete = page.getByRole('row').filter({ hasText: 'BILL-complete' });
  await expect(complete.getByRole('checkbox')).toBeDisabled();
  await expect(complete).toContainText('Attached PDF found; issued-document verification pending.');
  const before = await page.evaluate(() => window.fileDiscoveryFixture.requests.length);
  await complete.locator('summary').click();
  await expect(complete.locator('time')).toHaveAttribute('datetime', '2026-09-25T18:31:00.000Z');
  await expect(complete.locator('time')).toContainText('26');
  await expect(complete.locator('time')).toContainText('02:31');
  await expect(complete).toContainText('Hong Kong');
  await expect(complete).toContainText('Showing 5 of 7');
  await expect(complete.getByText('Issued PDF candidate 5', { exact: false })).toBeVisible();
  await expect(complete.getByText('Issued PDF candidate 6', { exact: false })).toHaveCount(0);
  await expect(complete).toContainText('invoice contents are unverified');
  await expect(complete.getByRole('link', { name: 'Inspect STEM documents' })).toHaveAttribute('href', '/stems/stem-one');
  for (const [kind, english] of [['partial', 'attachment lookup is incomplete', '附件查閱不完整'], ['unavailable', 'attachment lookup is unavailable', '未能查閱附件'], ['empty', 'No directly attached PDF found', '未找到直接附加的 PDF'], ['not_checked', 'attachments not checked', '尚未查閱附件'], ['old', 'attachments not checked', '尚未查閱附件']]) {
    const row = page.getByRole('row').filter({ hasText: `BILL-${kind}` });
    await row.locator('summary').click();
    await expect(row).toContainText(english);
    await expect(row.getByRole('checkbox')).toBeDisabled();
  }
  expect(await page.evaluate(() => window.fileDiscoveryFixture.requests.length)).toBe(before);
});
