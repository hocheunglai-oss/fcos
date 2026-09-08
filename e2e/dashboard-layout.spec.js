import { expect, test } from '@playwright/test';

const FIXTURE_PATH = '/e2e/fixtures/dashboard-preview.html';
const FIXTURE_ORIGIN = new URL(process.env.FCOS_E2E_BASE_URL || 'http://127.0.0.1:5173').origin;
const VIEWPORTS = [390, 768, 1280, 1600, 2560];

test.describe('synthetic dashboard layout fixture', () => {
  test.skip(process.env.FCOS_E2E_DASHBOARD_FIXTURE !== '1', 'Opt-in local Vite fixture; not a deployed application route.');
  test('keeps dashboard geometry contained across target viewports without external requests', async ({ page }) => {
    const externalRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== FIXTURE_ORIGIN) externalRequests.push(request.url());
    });

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(FIXTURE_PATH);
      await expect(page.getByText('Synthetic UI fixture — not live Salesforce data').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
      expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const [header, filters, kpis] = await Promise.all(['.app-page-header', '[aria-label="Dashboard filters"]', '[aria-label="Dashboard KPIs"]'].map((selector) => page.locator(selector).boundingBox()));
      for (const edge of [header, filters, kpis]) { expect(edge).not.toBeNull(); expect(edge.x).toBeGreaterThanOrEqual(86); expect(edge.x + edge.width).toBeLessThanOrEqual(width + 1); }
      for (const edge of [filters, kpis]) { expect(Math.abs(edge.x - header.x)).toBeLessThanOrEqual(1); expect(Math.abs(edge.x + edge.width - (header.x + header.width))).toBeLessThanOrEqual(1); }

      const mobileFilters = page.getByRole('button', { name: /^Filters/ });
      if (await mobileFilters.isVisible()) await mobileFilters.click();
      await expect(page.getByLabel('Period')).toBeVisible();
      await page.getByLabel('Period').selectOption('year_to_date');
      await expect(page.getByLabel('Period')).toHaveValue('year_to_date');
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(FIXTURE_PATH);
    await page.getByRole('button', { name: 'Prior year · Hidden' }).click();
    await expect(page.getByRole('button', { name: 'Prior year · Shown' })).toBeVisible();
    await page.getByLabel('How monthly chart values are calculated').click();
    await expect(page.getByText('Monthly chart methodology')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Trading perspective' })).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });
});
