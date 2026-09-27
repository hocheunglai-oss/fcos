import { expect, test } from '@playwright/test';

async function assertInsideViewport(locator, page) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
}

test('Contacts shows Reason and long messages within the workspace for all actions and filtered actions', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name.startsWith('mobile');
  await page.setViewportSize(isMobile
    ? { width: 390, height: 844 }
    : { width: 1600, height: 900 });
  await page.goto('/e2e/fixtures/xero-contacts.html');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();

  const section = page.locator('.xero-contacts-review');
  const wide = section.locator('.xero-contacts-review__wide');
  const compact = section.locator('.xero-contacts-review__compact');
  await expect(isMobile ? compact : wide).toBeVisible();
  await expect(isMobile ? wide : compact).toBeHidden();
  const row = isMobile
    ? compact.getByRole('article', { name: /PacificMarineFuelTrading/ })
    : wide.getByRole('row').filter({ hasText: 'PacificMarineFuelTrading' });
  await expect(isMobile ? row.getByText('Reason', { exact: true }) : wide.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
  await expect(row).toContainText('The contact is protected because');
  await expect(row).toContainText('Invoices and bills: 12');
  await expect(row).toContainText('2025: 9');
  await expect(row).toContainText('2026: 3');
  await assertInsideViewport(row, page);
  await assertInsideViewport(row.getByText('The contact is protected because', { exact: false }), page);
  await page.screenshot({ path: testInfo.outputPath(isMobile ? 'contacts-mobile.png' : 'contacts-wide.png'), fullPage: true });

  const actionFilter = section.locator('select').first();
  await expect(actionFilter).toHaveValue('all');
  await expect(isMobile ? compact.getByRole('article') : wide.getByRole('row')).toHaveCount(isMobile ? 5 : 6);
  await actionFilter.selectOption('exception');
  await expect(isMobile ? compact.getByRole('article') : wide.getByRole('row')).toHaveCount(isMobile ? 1 : 2);
  const exception = isMobile
    ? compact.getByRole('article', { name: /Shared Marine Buyer/ })
    : wide.getByRole('row').filter({ hasText: 'Shared Marine Buyer' });
  await expect(exception).toContainText('Xero contact is protected by an ambiguous Salesforce match');
  await expect(exception).toContainText('Two Salesforce accounts match this contact');
  await expect(exception).toContainText('Credit notes: 2');
  await expect(exception).toContainText('2026: 2');
  await expect(exception).not.toContainText('2025:');
  await assertInsideViewport(exception, page);
  await actionFilter.selectOption('all');

  const activeRows = isMobile ? compact : wide;
  const kept = isMobile
    ? activeRows.getByRole('article', { name: /Active Ocean Carrier/ })
    : activeRows.getByRole('row').filter({ hasText: 'Active Ocean Carrier' });
  await expect(kept).toContainText('Payments: 3');
  await expect(kept).toContainText('2025: 1');
  await expect(kept).toContainText('Year unavailable: 2');
  const legacy = isMobile
    ? activeRows.getByRole('article', { name: /Deferred Contact Audit/ })
    : activeRows.getByRole('row').filter({ hasText: 'Deferred Contact Audit' });
  await expect(legacy).toContainText('Prepayments: 4');
  await expect(legacy).toContainText('Year breakdown not yet scanned. Refresh Preview.');
  await expect(legacy).not.toContainText('2026:');

  const rename = isMobile
    ? compact.getByRole('article', { name: /PacificMarineFuelTrading/ })
    : wide.getByRole('row').filter({ hasText: 'PacificMarineFuelTrading' });
  const checkbox = rename.getByRole('checkbox');
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await section.getByRole('button', { name: 'Select visible eligible' }).click();
  await expect(checkbox).toBeChecked();
  if (!isMobile) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(compact).toBeVisible();
    const narrowRow = compact.getByRole('article', { name: /PacificMarineFuelTrading/ });
    await expect(narrowRow.getByRole('checkbox')).toBeChecked();
    await expect(narrowRow).toContainText('The contact is protected because');
    await expect(narrowRow).toContainText('2025: 9');
    await expect(narrowRow).toContainText('2026: 3');
    await assertInsideViewport(narrowRow, page);
    await page.screenshot({ path: testInfo.outputPath('contacts-narrow.png'), fullPage: true });
  }
  await page.getByRole('button', { name: '繁體中文' }).click();
  const chineseRows = compact;
  const chineseMixed = chineseRows.getByRole('article', { name: /PacificMarineFuelTrading/ });
  await expect(chineseMixed).toContainText('發票及帳單：12');
  await expect(chineseMixed).toContainText('2025: 9');
  await expect(chineseMixed).toContainText('2026: 3');
  const chineseOneYear = chineseRows.getByRole('article', { name: /Shared Marine Buyer/ });
  await expect(chineseOneYear).toContainText('貸項通知單：2');
  await expect(chineseOneYear).toContainText('2026: 2');
  await expect(chineseOneYear).not.toContainText('2025:');
  await expect(chineseRows.getByRole('article', { name: /Active Ocean Carrier/ })).toContainText('年份不明：2');
  await expect(chineseRows.getByRole('article', { name: /Deferred Contact Audit/ })).toContainText('尚未掃描年份分布。請重新按「預覽」。');
  await page.screenshot({ path: testInfo.outputPath(isMobile ? 'contacts-mobile-zh.png' : 'contacts-narrow-zh.png'), fullPage: true });
  expect(await page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name.includes('Apply')))).toEqual([]);
});

test('Contacts table cells fit without overlap just above the wide-view threshold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Threshold layout is verified in the desktop project.');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/e2e/fixtures/xero-contacts.html');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  const section = page.locator('.xero-contacts-review');
  const containerWidth = () => section.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  const initialWidth = await containerWidth();
  await page.setViewportSize({ width: 1600 + Math.round(1104 - initialWidth), height: 900 });
  const actualWidth = await containerWidth();
  expect(actualWidth).toBeGreaterThanOrEqual(1100);
  expect(actualWidth).toBeLessThanOrEqual(1110);

  const wide = section.locator('.xero-contacts-review__wide');
  await expect(wide).toBeVisible();
  await expect(wide.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
  const measureOverflow = () => wide.locator('table').evaluate((table) => {
    const frame = table.parentElement;
    const cells = [...table.querySelectorAll('th, td')];
    return {
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      cellOverflow: cells.map((cell) => ({ text: cell.textContent.trim().slice(0, 45), excess: cell.scrollWidth - cell.clientWidth }))
        .filter((cell) => cell.excess > 1),
      badgeOverflow: [...table.querySelectorAll('tbody td > div.rounded-full')].map((badge) => {
        const cellRect = badge.parentElement.getBoundingClientRect();
        const badgeRect = badge.getBoundingClientRect();
        return { text: badge.textContent.trim(), excess: badgeRect.right - cellRect.right };
      }).filter((badge) => badge.excess > 1),
    };
  });
  const measured = await measureOverflow();
  expect(measured.frameOverflow).toBeLessThanOrEqual(1);
  expect(measured.cellOverflow).toEqual([]);
  expect(measured.badgeOverflow).toEqual([]);
  await expect(wide.getByRole('row').filter({ hasText: 'PacificMarineFuelTrading' })).toContainText('2025: 9');
  await page.screenshot({ path: testInfo.outputPath('contacts-threshold.png'), fullPage: true });

  await page.getByRole('button', { name: '繁體中文' }).click();
  await expect(wide.getByRole('row').filter({ hasText: 'PacificMarineFuelTrading' })).toContainText('發票及帳單：12');
  const measuredZh = await measureOverflow();
  expect(measuredZh.frameOverflow).toBeLessThanOrEqual(1);
  expect(measuredZh.cellOverflow).toEqual([]);
  expect(measuredZh.badgeOverflow).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('contacts-threshold-zh.png'), fullPage: true });
});

test('reviewed Xero-only verification and revocation use the current fingerprint and audited revision', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-contacts.html?resolution=1');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review Xero-only identity' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Review Xero-only identity' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('No decision recorded');
  await expect(dialog.getByRole('button', { name: 'Verify Xero-only' })).toBeDisabled();
  await dialog.getByLabel('Evidence reference').fill('Contact registry case 31');
  await dialog.getByLabel('Evidence note').fill('Confirmed this Xero counterparty has no Salesforce Account.');
  await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button', { name: 'Verify Xero-only' }).click();
  await expect(dialog).toBeHidden();
  const saves = await page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name === 'xeroContactIdentitySave'));
  expect(saves[0].body).toMatchObject({ tenantId: 'f0a97252-7bc7-47b6-a8cf-ef381671aeca',
    contactId: '0cb5d302-8f2d-4b08-8902-0553d01df644', decision: 'verified_xero_only',
    expectedRevision: 0, expectedFingerprint: 'a'.repeat(64), reviewed: true });
  await page.getByRole('button', { name: 'Review Xero-only identity' }).click();
  await expect(dialog).toContainText('Verified Xero-only');
  await expect(dialog).toContainText('Contact registry case 31');
  await dialog.getByLabel('Evidence reference').fill('Contact registry case 32');
  await dialog.getByLabel('Evidence note').fill('Revoking the prior identity verification after review.');
  await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button', { name: 'Revoke verification' }).click();
  const second = await page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name === 'xeroContactIdentitySave'));
  expect(second[1].body).toMatchObject({ decision: 'revoked', expectedRevision: 1, reviewed: true });
  await page.getByRole('button', { name: '繁體中文' }).click();
  await expect(page.getByRole('button', { name: '檢閱 Xero 獨有身分' })).toBeVisible();
});

test('missing-contact repair is separately reviewed and sends only explicit selected rows', async ({ page }) => {
  const isMobile = (page.viewportSize()?.width || 0) < 1200;
  if (!isMobile) await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/e2e/fixtures/xero-contacts.html?resolution=1');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  const row = isMobile
    ? page.locator('.xero-contacts-review__compact').getByRole('article', { name: /No Xero match/ }).filter({ hasText: 'Missing Harbour Buyer' })
    : page.locator('.xero-contacts-review__wide').getByRole('row').filter({ hasText: 'Missing Harbour Buyer' });
  await row.getByRole('checkbox').click();
  await expect(page.getByText('1 missing contacts selected separately')).toBeVisible();
  const create = page.getByRole('button', { name: 'Create selected missing contacts' });
  await expect(create).toBeDisabled();
  await page.getByText('I reviewed these missing Salesforce contacts').click();
  await expect(create).toBeEnabled();
  await row.getByRole('checkbox').click();
  await row.getByRole('checkbox').click();
  await expect(create).toBeDisabled();
  await page.getByText('I reviewed these missing Salesforce contacts').click();
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name === 'xeroContactRepairApply').length)).toBe(1);
  const repairs = await page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name === 'xeroContactRepairApply'));
  expect(repairs).toHaveLength(1);
  expect(repairs[0].body).toEqual({ runId: 'contacts-layout-fixture', rowIds: ['missing-contact-row'], reviewed: true });
  await expect(page.getByText('0 missing contacts selected separately')).toBeVisible();
});

test('unconfirmed identity and repair responses do not close review or report created contacts', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-contacts.html?resolution=1&identityMalformed=1&repairMalformed=1');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await page.getByRole('button', { name: 'Review Xero-only identity' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Evidence reference').fill('Contact registry case 31');
  await dialog.getByLabel('Evidence note').fill('Confirmed this Xero counterparty has no Salesforce Account.');
  await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button', { name: 'Verify Xero-only' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('result is uncertain');
  await expect(dialog.getByRole('button', { name: 'Verify Xero-only' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const isMobile = (page.viewportSize()?.width || 0) < 1200;
  if (!isMobile) await page.setViewportSize({ width: 1600, height: 900 });
  const row = isMobile
    ? page.locator('.xero-contacts-review__compact').getByRole('article', { name: /No Xero match/ }).filter({ hasText: 'Missing Harbour Buyer' })
    : page.locator('.xero-contacts-review__wide').getByRole('row').filter({ hasText: 'Missing Harbour Buyer' });
  await row.getByRole('checkbox').click();
  await page.getByText('I reviewed these missing Salesforce contacts').click();
  await page.getByRole('button', { name: 'Create selected missing contacts' }).click();
  await expect.poll(() => page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name === 'xeroContactRepairApply').length)).toBe(1);
  await expect(page.getByText('0 missing contacts selected separately')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create selected missing contacts' })).toBeDisabled();
  const previews = await page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name === 'xeroPortalContactLifecyclePreview'));
  expect(previews).toHaveLength(0);
});

test('ordinary contact apply review resets when the selected rows change', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/xero-contacts.html');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await page.getByText('Reviewed', { exact: true }).click();
  const apply = page.getByRole('button', { name: 'Apply selected' });
  await expect(apply).toBeEnabled();
  const row = page.getByRole('article', { name: /PacificMarineFuelTrading/ });
  await row.getByRole('checkbox').click();
  await expect(apply).toBeDisabled();
});

async function openRestoration(page, testInfo, query = '') {
  const mobile = testInfo.project.name.startsWith('mobile');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/e2e/fixtures/xero-contacts.html?restoration=1&resolution=1${query}`);
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const scope = page.locator(mobile ? '.xero-contacts-review__compact' : '.xero-contacts-review__wide');
  const row = (name) => scope.getByRole(mobile ? 'article' : 'row').filter({ hasText: name });
  const panel = page.getByRole('region', { name: 'Restore verified contacts', exact: true });
  await expect(panel).toBeVisible();
  return { panel, row, errors, mobile };
}

test('verified archived restoration has explicit separate selection/review and re-previews exact successful outcomes', async ({ page }, testInfo) => {
  const { panel, row, errors, mobile } = await openRestoration(page, testInfo);
  const first = row('Verified Archived Harbour Buyer');
  const second = row('Verified Archived Marine Supplier');
  const held = row('Archived Contact With Unresolved Ownership');
  const restore = panel.getByRole('button', { name: 'Restore verified contacts', exact: true });
  await expect(first.getByRole('checkbox')).not.toBeChecked();
  await expect(second.getByRole('checkbox')).not.toBeChecked();
  await expect(held.getByRole('checkbox')).toBeDisabled();
  await expect(held).toContainText('Ownership is unresolved');
  await expect(first).toContainText('613830f6-c5ce-4469-a2ac-1aa4b89fc1c1');
  await expect(panel).toContainText('preserves bills, payments and contact details');
  await expect(panel).toContainText('Document holds are not cleared automatically');
  await expect(restore).toBeDisabled();
  await first.getByRole('checkbox').click();
  await expect(restore).toBeDisabled();
  await panel.getByRole('checkbox').click();
  await expect(restore).toBeEnabled();
  await second.getByRole('checkbox').click();
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await expect(restore).toBeDisabled();
  await panel.getByRole('checkbox').click();
  // A missing-contact repair selection and ordinary review must never enter this request.
  await row('Missing Harbour Buyer').getByRole('checkbox').click();
  await page.getByText('Reviewed', { exact: true }).click();
  await restore.click();
  await expect(panel).toContainText('2 restored · 0 already active · 0 blocked · 0 uncertain');
  await expect.poll(() => page.evaluate(() => window.contactsFixture.requests.filter((r) => r.name === 'xeroPortalContactLifecyclePreview').length)).toBe(1);
  const writes = await page.evaluate(() => window.contactsFixture.requests.filter((r) => r.name.includes('Apply')));
  expect(writes).toEqual([{ name: 'xeroContactRestoreApply', body: { runId: 'contacts-layout-fixture', rowIds: ['restore-row-1', 'restore-row-2'], reviewed: true } }]);
  await expect(first).toContainText('ACTIVE');
  await expect(first.getByRole('checkbox')).toBeDisabled();
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await assertInsideViewport(panel, page);
  await assertInsideViewport(held, page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`contacts-restoration-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
});

test('restoration is read-only when the Contact write gate is disabled', async ({ page }, testInfo) => {
  const { panel, row, errors } = await openRestoration(page, testInfo, '&restoreGateDisabled=1');
  await expect(row('Verified Archived Harbour Buyer').getByRole('checkbox')).toBeDisabled();
  await expect(panel.getByRole('checkbox')).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Restore verified contacts', exact: true })).toBeDisabled();
  await expect(panel).toContainText('Contact writes are disabled');
  expect(await page.evaluate(() => window.contactsFixture.requests.filter((r) => r.name === 'xeroContactRestoreApply'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('mismatched, network and uncertain restoration responses require a fresh preview and never repeat POST', async ({ page }, testInfo) => {
  for (const mode of ['mismatch', 'network', 'uncertain']) {
    const { panel, row, errors } = await openRestoration(page, testInfo, `&restoreOutcome=${mode}`);
    const selected = row('Verified Archived Harbour Buyer').getByRole('checkbox');
    await selected.click();
    await panel.getByRole('checkbox').click();
    const restore = panel.getByRole('button', { name: 'Restore verified contacts', exact: true });
    await restore.click();
    await expect(panel.getByRole('alert')).toContainText('outcome is uncertain');
    await expect(panel).toContainText('001000000000011AAA');
    await expect(panel).toContainText('613830f6-c5ce-4469-a2ac-1aa4b89fc1c1');
    await expect(restore).toBeDisabled();
    await expect(selected).not.toBeChecked();
    await expect(selected).toBeDisabled();
    await expect(panel.getByRole('checkbox')).not.toBeChecked();
    const requests = await page.evaluate(() => window.contactsFixture.requests);
    expect(requests.filter((r) => r.name === 'xeroContactRestoreApply')).toHaveLength(1);
    expect(requests.filter((r) => r.name === 'xeroPortalContactLifecyclePreview')).toHaveLength(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(selected).toBeEnabled();
    await expect(selected).not.toBeChecked();
    await expect(restore).toBeDisabled();
    // A new explicit selection still requires a new review and produces no automatic retry.
    await selected.click();
    await expect(restore).toBeDisabled();
    expect(await page.evaluate(() => window.contactsFixture.requests.filter((r) => r.name === 'xeroContactRestoreApply').length)).toBe(1);
    expect(errors).toEqual([]);
  }
});
