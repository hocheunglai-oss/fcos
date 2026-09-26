import { test, expect } from '@playwright/test';
for (const language of ['en', 'zh-Hant']) test(`saved supplier file observations remain non-authoritative (${language})`, async ({ page }) => {
  await page.goto(`/e2e/fixtures/xero-file-discovery.html?language=${language}`);
  const complete = page.getByRole('row').filter({ hasText: 'BILL-complete' });
  await expect(complete.getByRole('checkbox')).toBeDisabled();
  const before = await page.evaluate(() => window.fileDiscoveryFixture.requests.length);
  await complete.locator('summary').click();
  await expect(complete.locator('time')).toHaveAttribute('datetime', '2026-09-25T18:31:00.000Z');
  await expect(complete.locator('time')).toContainText('26');
  await expect(complete.locator('time')).toContainText('02:31');
  await expect(complete).toContainText(language === 'en' ? 'Hong Kong' : '香港');
  await expect(complete).toContainText(language === 'en' ? 'Showing 5 of 7' : '顯示 7 份');
  await expect(complete.getByText('Issued PDF candidate 5', { exact: false })).toBeVisible();
  await expect(complete.getByText('Issued PDF candidate 6', { exact: false })).toHaveCount(0);
  await expect(complete).toContainText(language === 'en' ? 'invoice contents are unverified' : '發票內容尚未核實');
  await expect(complete.getByRole('link', { name: language === 'en' ? 'Inspect STEM documents' : '查看 STEM 文件' })).toHaveAttribute('href', '/stems/stem-one');
  for (const [kind, english, chinese] of [['partial', 'Incomplete lookup', '查閱不完整'], ['unavailable', 'absence is not established', '不能確定沒有附件'], ['empty', 'found no directly linked PDFs', '未找到直接連結的 PDF'], ['old', 'Not checked in this saved preview', '尚未查閱附件']]) {
    const row = page.getByRole('row').filter({ hasText: `BILL-${kind}` });
    await row.locator('summary').click();
    await expect(row).toContainText(language === 'en' ? english : chinese);
    await expect(row.getByRole('checkbox')).toBeDisabled();
  }
  expect(await page.evaluate(() => window.fileDiscoveryFixture.requests.length)).toBe(before);
});
