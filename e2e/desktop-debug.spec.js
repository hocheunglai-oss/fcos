import { expect, test } from '@playwright/test';
const last = (page, name) => page.evaluate((handler) => window.desktopDebug.requests.findLastIndex((request) => request.name === handler), name);
const resolve = (page, index, data) => page.evaluate(({ index, data }) => window.desktopDebug.resolve(index, data), { index, data });
const notification = (id, extra = {}) => ({ id: `market_intelligence:${id}`, title: id, message: 'Synthetic alert', source: 'markets', createdAt: new Date().toISOString(), link: '/markets', ...extra });
const list = (id, extra = {}) => ({ notifications: [notification(id, extra)], unreadCount: 1, unavailableSources: [] });
test.beforeEach(async ({ page, baseURL }) => {
  page.fixtureErrors = [];
  page.on('pageerror', (error) => page.fixtureErrors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FCOS desktop regression fixture' })).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(page.fixtureErrors).toEqual([]); });

test('notification filters reject slower old responses and mark-read retains source/state', async ({ page }) => {
  await resolve(page, await last(page, 'workNotificationsList'), list('initial'));
  await page.getByRole('button', { name: '1 unread work notifications' }).click();
  await resolve(page, await last(page, 'workNotificationsList'), list('active'));
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  const old = await last(page, 'workNotificationsList');
  await page.getByRole('button', { name: 'Handled', exact: true }).click();
  const fresh = await last(page, 'workNotificationsList');
  await resolve(page, fresh, list('handled-new', { handledAt: new Date().toISOString() }));
  await resolve(page, old, list('unread-old'));
  await expect(page.getByText('handled-new', { exact: true })).toBeVisible();
  await expect(page.getByText('unread-old', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filter notification source' }).click();
  await page.getByRole('option', { name: 'Markets', exact: true }).click();
  await resolve(page, await last(page, 'workNotificationsList'), list('market-handled', { handledAt: new Date().toISOString() }));
  await page.getByRole('button', { name: 'Mark all read' }).click();
  const read = await last(page, 'workNotificationsRead');
  expect(await page.evaluate((index) => window.desktopDebug.requests[index].body, read)).toEqual({ listState: 'handled', source: 'markets', limit: 40 });
  await resolve(page, read, list('market-handled-read', { handledAt: new Date().toISOString(), readAt: new Date().toISOString() }));
  await expect(page.getByText('market-handled-read', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-debug-notifications.png' });
});

test('notification events coalesce and late mutation results cannot replace a changed filter', async ({ page }) => {
  await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.dispatchEvent(new Event('fcos:work-notifications-changed')); });
  expect(await page.evaluate(() => window.desktopDebug.requests.filter((request) => request.name === 'workNotificationsList').length)).toBe(1);
  await resolve(page, await last(page, 'workNotificationsList'), list('initial'));
  await page.getByRole('button', { name: '1 unread work notifications' }).click();
  await resolve(page, await last(page, 'workNotificationsList'), list('active'));
  await page.getByRole('button', { name: 'Mark all read' }).click();
  const mutation = await last(page, 'workNotificationsRead');
  await page.getByRole('button', { name: 'Handled', exact: true }).click();
  await resolve(page, await last(page, 'workNotificationsList'), list('handled-current', { handledAt: new Date().toISOString() }));
  await resolve(page, mutation, list('active-old-mutation'));
  await expect(page.getByText('handled-current', { exact: true })).toBeVisible();
  await expect(page.getByText('active-old-mutation', { exact: true })).toHaveCount(0);
});

test('notification actions serialize and a round-trip filter change rejects the old mutation snapshot', async ({ page }) => {
  await resolve(page, await last(page, 'workNotificationsList'), { notifications: [notification('first'), notification('second')], unreadCount: 2, unavailableSources: [] });
  await page.getByRole('button', { name: '2 unread work notifications' }).click();
  await resolve(page, await last(page, 'workNotificationsList'), { notifications: [notification('first'), notification('second')], unreadCount: 2, unavailableSources: [] });
  await page.getByRole('button', { name: 'Mark all read' }).click();
  const mutation = await last(page, 'workNotificationsRead');
  await expect(page.getByRole('button', { name: /first.*Synthetic alert/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /second.*Synthetic alert/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Handled', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await resolve(page, await last(page, 'workNotificationsList'), list('active-current'));
  await resolve(page, mutation, list('active-stale-mutation'));
  await expect(page.getByText('active-stale-mutation', { exact: true })).toHaveCount(0);
  await resolve(page, await last(page, 'workNotificationsList'), list('active-readback'));
  await expect(page.getByText('active-readback', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.desktopDebug.requests.filter((request) => request.name === 'workNotificationsRead').length)).toBe(1);
});

test('Hedge Desk latest refresh wins, stale background responses and cancellation preserve data', async ({ page }) => {
  const initial = await last(page, 'hedgeDeskEntity');
  await resolve(page, initial, { data: { physicals: [{ id: 'initial-desk' }] } });
  await page.getByRole('button', { name: 'Refresh fixture desk' }).click();
  const old = await last(page, 'hedgeDeskEntity');
  await page.getByRole('button', { name: 'Refresh fixture desk' }).click();
  const fresh = await last(page, 'hedgeDeskEntity');
  await resolve(page, fresh, { data: { physicals: [{ id: 'fresh-desk' }] } });
  await resolve(page, old, { data: { physicals: [{ id: 'old-desk' }] } });
  await page.evaluate((index) => window.desktopDebug.background(index, { data: { physicals: [{ id: 'old-background' }] } }), initial);
  await expect(page.getByTestId('desk-value')).toHaveText('fresh-desk');
  await page.getByRole('button', { name: 'Refresh fixture desk' }).click();
  await resolve(page, await last(page, 'hedgeDeskEntity'), { cancelled: true });
  await expect(page.getByTestId('desk-value')).toHaveText('fresh-desk');
  await expect(page.getByTestId('desk-loading')).toHaveText('false');
  await expect(page.getByTestId('desk-error')).toBeEmpty();
  await page.getByRole('button', { name: 'Unmount fixture' }).click();
  await page.evaluate((index) => window.desktopDebug.background(index, { data: { physicals: [{ id: 'unmounted' }] } }), fresh);
});
