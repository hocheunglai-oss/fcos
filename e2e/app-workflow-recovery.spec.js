import { expect, test } from '@playwright/test';

async function openNotificationFixture(page, baseURL, testInfo) {
  test.skip(process.env.FCOS_E2E_WORKFLOW_FIXTURE !== '1' || testInfo.project.name !== 'desktop-chrome',
    'Local desktop fixture; all incident and notification operations are synthetic.');
  await page.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await page.goto('/e2e/fixtures/app-workflow-recovery.html?notifications=1');

  const nextRequest = async (name, after = -1) => {
    const find = () => page.evaluate(({ handler, previous }) => window.recoveryFixture.notifications
      .findLastIndex((request, index) => index > previous && request.name === handler), { handler: name, previous: after });
    await expect.poll(find).toBeGreaterThan(after);
    return find();
  };
  const respond = (index, data) => page.evaluate(({ index, data }) => window.recoveryFixture.resolveNotification(index, data), { index, data });
  const list = (title, extra = {}) => ({
    notifications: [{ id: title, title, source: 'markets', createdAt: '2026-11-18T00:00:00Z', ...extra }],
    unreadCount: 1,
  });

  const initial = await nextRequest('workNotificationsList');
  await respond(initial, list('Initial fixture'));
  await page.getByRole('button', { name: '1 unread work notifications' }).click();
  const opened = await nextRequest('workNotificationsList', initial);
  await respond(opened, list('Initial fixture'));
  const source = page.getByRole('combobox', { name: 'Filter notification source' });
  const requestBody = index => page.evaluate(i => window.recoveryFixture.notifications[i].body, index);
  return { nextRequest, respond, list, source, requestBody, opened };
}

test('incident verification refreshes only the current notification view', async ({ page, baseURL }, testInfo) => {
  const { nextRequest, respond, list, source, requestBody, opened } = await openNotificationFixture(page, baseURL, testInfo);
  await source.click();
  await page.getByRole('option', { name: 'System errors', exact: true }).click();
  const incident = await nextRequest('workNotificationsList', opened);
  await respond(incident, list('Fixture incident', { source: 'system_error', incidentSignature: 'fixture-incident', verificationAvailable: true }));
  await page.getByTitle('Verify this exact incident is fixed').click();
  const verification = await nextRequest('systemErrorVerify', incident);
  await page.getByRole('button', { name: 'Handled', exact: true }).click();
  await source.click();
  await page.getByRole('option', { name: 'Markets', exact: true }).click();
  const handled = await nextRequest('workNotificationsList', verification);
  await respond(handled, list('Handled fixture'));
  await respond(verification, { message: 'Verified fixture incident.' });
  const refresh = await nextRequest('workNotificationsList', handled);
  expect(await requestBody(refresh))
    .toEqual({ limit: 40, state: 'handled', source: 'markets' });

  await page.getByRole('button', { name: 'Active', exact: true }).click();
  const active = await nextRequest('workNotificationsList', refresh);
  await respond(active, list('Current Markets fixture'));
  await respond(refresh, list('Stale handled fixture'));
  await expect(page.getByText('Current Markets fixture', { exact: true })).toBeVisible();
  await expect(page.getByText('Stale handled fixture', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Verified fixture incident.' })).toBeVisible();
});

test('a burst of notification change events refreshes the current view once', async ({ page, baseURL }, testInfo) => {
  const { nextRequest, respond, list, opened } = await openNotificationFixture(page, baseURL, testInfo);
  const burst = () => page.evaluate(() => {
    for (let event = 0; event < 10; event += 1) {
      window.dispatchEvent(new Event('fcos:work-notifications-changed'));
    }
  });

  await burst();
  const refresh = await nextRequest('workNotificationsList', opened);
  expect(await page.evaluate(() => window.recoveryFixture.notifications.length)).toBe(opened + 2);
  await respond(refresh, list('First refreshed fixture'));
  await expect(page.getByText('First refreshed fixture', { exact: true })).toBeVisible();

  await burst();
  const laterRefresh = await nextRequest('workNotificationsList', refresh);
  expect(await page.evaluate(() => window.recoveryFixture.notifications.length)).toBe(refresh + 2);
  await respond(laterRefresh, list('Later refreshed fixture'));
  await expect(page.getByText('Later refreshed fixture', { exact: true })).toBeVisible();
});

test('marking notifications read preserves the selected view', async ({ page, baseURL }, testInfo) => {
  const { nextRequest, respond, list, source, requestBody, opened } = await openNotificationFixture(page, baseURL, testInfo);
  await page.getByRole('button', { name: 'Handled', exact: true }).click();
  await source.click();
  await page.getByRole('option', { name: 'Markets', exact: true }).click();
  const markets = await nextRequest('workNotificationsList', opened);
  await respond(markets, list('Handled Markets fixture', { handledAt: '2026-11-18T00:00:00Z' }));
  await page.getByRole('button', { name: 'Mark all read' }).click();
  const read = await nextRequest('workNotificationsRead', markets);
  expect(await requestBody(read)).toEqual({ limit: 40, listState: 'handled', source: 'markets' });
  await respond(read, list('Read handled Markets fixture', { handledAt: '2026-11-18T00:00:00Z', readAt: '2026-11-18T00:00:00Z' }));
  await expect(page.getByText('Read handled Markets fixture', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.recoveryFixture.notifications.length)).toBe(read + 1);
});

test('a delayed notification action refreshes the newly selected view', async ({ page, baseURL }, testInfo) => {
  const { nextRequest, respond, list, source, requestBody, opened } = await openNotificationFixture(page, baseURL, testInfo);
  await page.getByTitle('Mark handled').click();
  const mutation = await nextRequest('workNotificationsState', opened);
  await page.getByRole('button', { name: 'Handled', exact: true }).click();
  await source.click();
  await page.getByRole('option', { name: 'Markets', exact: true }).click();
  const current = await nextRequest('workNotificationsList', mutation);
  await respond(current, list('Current handled Markets fixture'));
  await respond(mutation, list('Stale active fixture'));
  const refresh = await nextRequest('workNotificationsList', current);
  expect(await requestBody(refresh)).toEqual({ limit: 40, state: 'handled', source: 'markets' });
  await respond(refresh, list('Updated handled Markets fixture'));
  await expect(page.getByText('Updated handled Markets fixture', { exact: true })).toBeVisible();
  await expect(page.getByText('Stale active fixture', { exact: true })).toHaveCount(0);
});

test('Hedge Desk keeps the newest book when superseded reads complete', async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.FCOS_E2E_WORKFLOW_FIXTURE !== '1' || testInfo.project.name !== 'desktop-chrome',
    'Local desktop fixture; all Hedge Desk reads are synthetic.');
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await page.goto('/e2e/fixtures/app-workflow-recovery.html?hedge-snapshots=1');
  const count = () => page.evaluate(() => window.recoveryFixture.hedgeRequestCount());
  const resolve = (index, id) => page.evaluate(async ({ index, id }) => {
    window.recoveryFixture.resolveHedgeSnapshot(index, { data: { physicals: [{ id }], swaps: [] } });
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, { index, id });
  const refresh = page.getByRole('button', { name: 'Refresh fixture book' });
  const book = page.getByLabel('Fixture book', { exact: true });
  const refreshing = page.getByLabel('Fixture book refreshing');

  await expect.poll(count).toBe(1);
  await resolve(0, 'Initial book');
  await expect(book).toHaveText('Initial book');
  await refresh.click();
  await refresh.click();
  await expect.poll(count).toBe(3);
  await resolve(1, 'Superseded book');
  await expect(book).toHaveText('Initial book');
  await expect(refreshing).toHaveText('true');
  await resolve(2, 'Current book');
  await expect(book).toHaveText('Current book');
  await expect(refreshing).toHaveText('false');

  await refresh.click();
  await refresh.click();
  await expect.poll(count).toBe(5);
  await resolve(4, 'Latest book');
  await expect(book).toHaveText('Latest book');
  await resolve(3, 'Late book');
  await page.evaluate(async () => {
    window.recoveryFixture.updateHedgeSnapshot(0, {
      data: { physicals: [{ id: 'Late background book' }], swaps: [] },
    });
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  await expect(book).toHaveText('Latest book');
});

test.describe('application draft recovery', () => {
  test.skip(process.env.FCOS_E2E_WORKFLOW_FIXTURE !== '1', 'Local fixture; every external action is stubbed.');
  test.beforeEach(async ({ page }) => { await page.goto('/e2e/fixtures/app-workflow-recovery.html'); });
  test('last keystroke survives navigation, failed save and refresh', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Last keystroke');
    await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Last keystroke');
    await page.getByRole('button', { name: 'Fail save' }).click();
    await expect(page.getByRole('region', { name: 'Save status' })).toContainText('Save failed');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Last keystroke');
  });
  test('changed source requires field review and recovers independent edits only', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Price', exact: true }).fill('125');
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Keep note');
    await page.getByRole('button', { name: 'Change source price' }).click();
    await expect(page.getByRole('region', { name: 'Save status' })).toContainText('125');
    await expect(page.getByRole('region', { name: 'Save status' })).toContainText('150');
    await page.getByRole('button', { name: 'Recover non-conflicting edits' }).click();
    await expect(page.getByRole('textbox', { name: 'Price', exact: true })).toHaveValue('150');
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Keep note');
    await page.getByRole('link', { name: 'Review the price' }).click();
    await expect(page.getByRole('textbox', { name: 'Price', exact: true })).toBeFocused();
  });
  test('draft never crosses a user boundary', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Private draft');
    await page.getByRole('button', { name: 'Switch user' }).click();
    await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('');
  });
  test('Special Terms reason survives closing and a failed server save', async ({ page }) => {
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.locator('#special-term-change-reason').fill('Clarify China delivery conditions');
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await expect(page.locator('#special-term-change-reason')).toHaveValue('Clarify China delivery conditions');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic failure' })).toBeVisible();
    await expect(page.locator('#special-term-change-reason')).toHaveValue('Clarify China delivery conditions');
  });
  test('legacy Special Terms draft recovers after authoritative hydration', async ({ page }) => {
    await page.goto('/e2e/fixtures/app-workflow-recovery.html?legacy=1');
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.locator('#special-term-change-reason').fill('Keep legacy clarification');
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await expect(page.locator('#special-term-change-reason')).toHaveValue('Keep legacy clarification');
    await expect(page.getByText('Preparing all legacy clauses and exact Clause Library matches…')).toHaveCount(0);
  });
  test('methodology loads its full source text on demand', async ({ page }) => {
    let requests = 0;
    await page.route('**/page-methodologies.json', async (route) => { requests += 1; await route.continue(); });
    await expect(page.getByRole('button', { name: 'Open methodology' })).toBeVisible();
    expect(requests).toBe(0);
    await page.getByRole('button', { name: 'Open methodology' }).click();
    await expect(page.getByRole('dialog')).toContainText('Authority and approvals');
    await expect(page.getByRole('dialog')).toContainText('immutable revisions');
    expect(requests).toBe(1);
  });
  test('failed methodology retrieval can be retried', async ({ page }) => {
    await page.route('**/page-methodologies.json', (route) => route.fulfill({ status: 503, body: '' }), { times: 1 });
    await page.getByRole('button', { name: 'Open methodology' }).click();
    await expect(page.getByRole('dialog')).toContainText('could not be loaded');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('immutable revisions');
  });
  test('related reference search retains the STEM and does not attach the message', async ({ page }) => {
    await page.getByText('Find related STEM or invoice', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Related STEM or invoice reference' }).fill('TEST-INV-2026');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByRole('link', { name: 'TEST-INV-2026' })).toHaveAttribute('href', '/stems/a0H000000000001AAA');
    expect(await page.evaluate(() => window.recoveryFixture.calls.map((call) => call.name))).toEqual(['workspaceSearch']);
  });
  test('STEM workspace retains context across related work and reports partial activity', async ({ page }) => {
    await page.getByRole('button', { name: 'Toggle STEM workspace' }).click();
    await expect(page.getByText('STEM workspace', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Related STEM work' }).getByRole('link', { name: 'Variable charges' })).toHaveAttribute('href', '/payment-collections?tab=variable-charges&stemId=a0H000000000001AAA');
    await expect(page.getByText('Collection reviewed')).toBeVisible();
    await expect(page.getByText('Unavailable: Variable charges. Other activity is shown.')).toBeVisible();
  });
  test('document opens metadata before download and refuses an expired session', async ({ page }) => {
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('HKD');
    await expect(dialog).toContainText('Issued');
    await expect(dialog).toContainText('Your session has expired');
    await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
    expect(downloads).toHaveLength(0);
  });
  test('Master Contract draft survives closing the editor', async ({ page }) => {
    await page.getByRole('button', { name: 'Open contract', exact: true }).click();
    const title = page.getByRole('dialog').getByText('Title *', { exact: true }).locator('..').locator('input');
    await title.fill('China contract draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Open contract', exact: true }).click();
    await expect(title).toHaveValue('China contract draft');
  });
});

test('desktop STEM detail shows reviewed native sell price beside the independent USD buy price', async ({ page }, testInfo) => {
  test.skip(process.env.FCOS_E2E_WORKFLOW_FIXTURE !== '1' || testInfo.project.name !== 'desktop-chrome', 'Local desktop fixture only.');
  const violations = [];
  const origin = new URL(testInfo.project.use.baseURL).origin;
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // Vite serves local imports under api/ as modules, including the letterhead asset.
    const localImport = /\.(?:js|mjs)$/.test(url.pathname) || url.pathname === '/api/assets/hedge-letterhead-logo.jpg';
    const apiCall = url.pathname.startsWith('/api/') && !localImport;
    if (url.origin !== origin || request.method() !== 'GET' || apiCall) {
      violations.push(request.method());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/e2e/fixtures/app-workflow-recovery.html?native-prices=1');
  const toggle = page.getByRole('button', { name: 'Toggle STEM workspace' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const native = page.getByRole('row').filter({ hasText: 'Native price fixture' });
  await expect(native.getByText(/HKD\s*7,800/)).toBeVisible();
  await expect(native.getByText(/USD\s*1,000/)).toBeVisible();
  await expect(native.getByText(/confirmed/i)).toBeVisible();
  await expect(native.getByText(/USD\s*600\.12345678/)).toBeVisible();
  const legacy = page.getByRole('row').filter({ hasText: 'Legacy price fixture' });
  await expect(legacy.getByText(/\$777/).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Cancelled price fixture', { exact: true })).toHaveCount(0);
  expect(violations).toEqual([]);
});
