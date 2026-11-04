// This adapter belongs only to the fully source-bound ordinary be6 candidate.
// It is not a fallback for a future application or the frozen first rollout.
export const BE6_NORMAL_BROWSER_SHA = 'be6daf6162480ca77ec8d4f04fe5aaa5b228a22c';
export const BE6_NORMAL_BROWSER_CONTRACT = 'be6_normal_read_v1';
// The admitted application harness shares these UI contracts, but never joins
// the immutable be6 compatibility profile or its candidate/source admission.
export const REVIEW_REPAIR_NORMAL_BROWSER_CONTRACT = 'review_repaired_normal_read_v1';
export const APPLICATION_NORMAL_UI_CONTRACT = 'application_v2_current_read_v1';
export const isCurrentNormalSpec = spec => [BE6_NORMAL_BROWSER_CONTRACT, REVIEW_REPAIR_NORMAL_BROWSER_CONTRACT, APPLICATION_NORMAL_UI_CONTRACT].includes(spec?.sourceContract);
export const BE6_EMAIL_ROUTER_FAILURE_CODES = Object.freeze([
  'EMAIL_ROUTER_STORAGE_NOT_CONFIGURED', 'EMAIL_ROUTER_USER_INACTIVE', 'EMAIL_ROUTER_SIGN_IN_REQUIRED',
  'EMAIL_ROUTER_SESSION_INVALID', 'EMAIL_ROUTER_MAILBOX_UNRESOLVED', 'EMAIL_ROUTER_CONNECTION_UNAVAILABLE',
  'EMAIL_ROUTER_GRAPH_CONFIG_MISSING', 'EMAIL_ROUTER_OIDC_MISSING', 'EMAIL_ROUTER_GRAPH_AUTH_FAILED',
  'EMAIL_ROUTER_GRAPH_TOKEN_MISSING', 'EMAIL_ROUTER_GRAPH_REQUEST_FAILED', 'EMAIL_ROUTER_STORAGE_NOT_READY',
  'EMAIL_ROUTER_FOLDER_INVALID', 'EMAIL_ROUTER_CURSOR_INVALID', 'EMAIL_ROUTER_ERROR',
]);
export const be6EmailRouterFailureCode = payload => BE6_EMAIL_ROUTER_FAILURE_CODES.includes(payload?.code) ? payload.code : undefined;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
export const isBe6NormalSpec = spec => spec?.sourceContract === BE6_NORMAL_BROWSER_CONTRACT;

export function be6BuyerInvoicesDueRead(body) {
  return object(body) && Object.getPrototypeOf(body) === Object.prototype && Object.keys(body).length === 1
    && Number.isSafeInteger(body.daysAhead) && body.daysAhead >= 0 && body.daysAhead <= 365;
}

// Match the shared endpoint's request, not just its URL. AppConfig.list is a
// separate mandatory settings read and cannot supply or poison snapshot rows.
export function be6HedgeResponseKind(response) {
  let body;
  try {
    const request = response.request();
    if (request.method() !== 'POST') return 'invalid';
    body = request.postDataJSON();
  } catch { return 'invalid'; }
  if (!object(body)) return 'invalid';
  if (Object.keys(body).length === 1 && body.action === 'snapshot') return 'snapshot';
  if (Object.keys(body).length === 4 && body.action === 'list' && body.entity === 'AppConfig'
    && body.sort === '-created_date' && body.limit === 1000) return 'settings';
  return 'invalid';
}

export function be6NormalDataLoaded(spec, payload) {
  const data = payload?.data ?? payload;
  if (!object(data) || data.error || data.cancelled || data.status === 'unavailable') return { loaded: false, rows: null };
  if (spec.module === 'markets') {
    const keys = ['hsfo380', 'vlsfo', 'lsmgo'];
    const products = data.products;
    const loaded = data.complete === true && date(data.asOfDate) && date(data.latestMopsPublicationDate)
      && data.reportCompleteness?.complete === true && Array.isArray(products) && products.length === keys.length
      && new Set(products.map(row => row?.productKey)).size === keys.length
      && keys.every(key => products.some(row => row?.productKey === key && number(row.latestMops?.value)
        && date(row.latestMops?.publicationDate) && ['USD/MT', 'USD/BBL'].includes(row.unit)));
    return { loaded, rows: loaded ? products.length : null };
  }
  if (spec.module === 'hedge_desk') {
    const fields = ['physicals', 'swaps', 'mops', 'clearing', 'counterparties', 'invoices'];
    const loaded = fields.every(key => Array.isArray(data[key])) && object(data.capabilities);
    return { loaded, rows: loaded ? data.physicals.length + data.swaps.length : null };
  }
  return null;
}

export async function be6NormalOpenSurface(spec, page) {
  if (spec.module === 'review') {
    await page.getByRole('button', { name: 'All exceptions', exact: true }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
  } else if (spec.module === 'buyer_invoices') await page.getByRole('button', { name: 'All Open', exact: true }).click();
}

// Visible request failures remain fatal. Plain business-cell placeholders and
// accurate read-only notices are not an assertion that a successful read failed.
export async function be6NormalSurfaceUnavailable(page, observe) {
  // DashboardSettings.ErrorBlock uses this exact source-owned combination;
  // text-destructive alone also styles legitimate negative business amounts.
  const errors = await page.locator('[role="alert"]:visible, [class~="border-destructive/20"][class~="bg-destructive/10"]:visible').count();
  if (errors) {
    const detail = { origin: 'VISIBLE_ERROR', matchedErrorCount: errors };
    if (observe) {
      // The existing combined fatal predicate has already matched. Additional
      // scalar observations cannot clear it, even if their own reads fail.
      const counts = await Promise.allSettled([
        Promise.resolve().then(() => page.locator('[role="alert"]:visible').count()),
        Promise.resolve().then(() => page.locator('[class~="border-destructive/20"][class~="bg-destructive/10"]:visible').count()),
      ]);
      if (counts[0].status === 'fulfilled') detail.visibleAlertCount = counts[0].value;
      if (counts[1].status === 'fulfilled') detail.requestErrorBlockCount = counts[1].value;
    }
    observe?.(detail); return true;
  }
  const fixed = page.getByText(/^(?:Something went wrong|Unable to load (?:incoming payments|buyer invoices)|Access denied)$/i);
  for (let index = 0; index < await fixed.count(); index += 1) if (await fixed.nth(index).isVisible()) { observe?.({ origin: 'FIXED_FAILURE_NOTICE' }); return true; }
  const unavailable = await page.locator('[aria-label]:visible').filter({ hasText: /(?:Data|Salesforce) · Unavailable/ }).count();
  if (unavailable) observe?.({ origin: 'DATA_UNAVAILABLE_BADGE', matchedErrorCount: unavailable });
  return Boolean(unavailable);
}

export async function be6NormalSurfaceReason(spec, page, loaded, observe) {
  if (spec.module === 'dashboard') {
    const panel = page.getByRole('tabpanel', { name: 'STEMs', exact: true });
    if (!await panel.isVisible()) { observe?.({ origin: 'DASHBOARD_PANEL_HIDDEN', panelVisible: false }); return 'UNAVAILABLE_SURFACE'; }
    if (loaded.rows === 0) {
      // Responsive mobile/desktop copies share this exact message. The first
      // DOM copy can be hidden while the real desktop empty state is visible.
      const emptyStateVisible = await panel.getByText('No STEMs match these filters. Reset a filter or select a wider period.', { exact: true }).filter({ visible: true }).first().isVisible();
      if (!emptyStateVisible) observe?.({ origin: 'DASHBOARD_EMPTY_STATE_MISSING', panelVisible: true, emptyStateVisible });
      return emptyStateVisible ? null : 'EMPTY_STATE_MISSING';
    }
    const rows = await panel.locator('table tbody tr[data-stem-group]:visible').count();
    if (!rows) observe?.({ origin: 'DASHBOARD_ROWS_MISSING', panelVisible: true, matchedRows: rows });
    return rows ? null : 'MISSING_ROWS';
  }
  if (spec.module === 'markets') {
    const board = page.getByRole('region', { name: 'Market price board', exact: true });
    if (!await board.isVisible()) return 'UNAVAILABLE_SURFACE';
    const table = board.getByRole('table', { name: 'Primary market price comparison', exact: true });
    if (!await table.isVisible()) return 'UNAVAILABLE_SURFACE';
    for (const label of ['HSFO 380', 'S0.5%', 'LSMGO']) {
      const value = table.getByRole('button', { name: `Show details for ${label} latest MOPS`, exact: true });
      if (!await value.isVisible() || !/\d[\d,.]*\s+USD\/(?:MT|BBL)/.test(await value.innerText())) return 'MISSING_ROWS';
    }
    return null;
  }
  if (spec.module === 'review') {
    // recentStems is the scanned universe; the actual classifier can correctly
    // render zero exceptions. Require the real scan count and explicit UI state.
    if (!await page.getByText(`${loaded.rows.toLocaleString()} STEMs scanned`, { exact: true }).isVisible()) return 'MISSING_ROWS';
    const shell = page.locator('div.material-panel').filter({ has: page.getByRole('heading', { name: 'Exception List', exact: true }) });
    if (!await shell.isVisible()) return 'UNAVAILABLE_SURFACE';
    if (await shell.locator('table tbody tr:visible').count()) return null;
    return await shell.getByText('No exceptions found', { exact: true }).isVisible()
      && await shell.getByText('0 matching items', { exact: true }).isVisible() ? null : 'EMPTY_STATE_MISSING';
  }
  if (spec.module === 'hedge_desk') {
    const panel = page.locator('.app-overview-exposure');
    if (!await panel.isVisible()) return 'UNAVAILABLE_SURFACE';
    if (await panel.locator('table tbody tr:visible').count()) return null;
    return await panel.getByText('No position exposure', { exact: true }).isVisible() ? null : 'EMPTY_STATE_MISSING';
  }
  if (spec.module === 'buyer_invoices') {
    const shell = page.locator('div.material-panel').filter({ has: page.getByRole('heading', { name: 'Open Collections', exact: true }) });
    if (!await shell.isVisible()) return 'UNAVAILABLE_SURFACE';
    if (await shell.locator('table tbody tr:visible').count()) return null;
    return await shell.getByText('No buyer invoices found', { exact: true }).isVisible() ? null : 'EMPTY_STATE_MISSING';
  }
  return undefined;
}
