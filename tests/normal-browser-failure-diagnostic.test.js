import test from 'node:test';
import assert from 'node:assert/strict';
import { be6NormalSurfaceUnavailable, be6NormalSurfaceReason, REVIEW_REPAIR_NORMAL_BROWSER_CONTRACT } from '../scripts/lib/be6-normal-browser-contract.mjs';
import { compatibilityNormalSurfaceReason, compatibilityNormalModuleTerminalReason, compatibilityNormalDiagnosticError,
  normalizeCompatibilityNormalDiagnostic } from '../scripts/runtime-compatibility-normal-role.mjs';
import { createNormalBrowserModuleDiagnostic, safeNormalBrowserObservation } from '../scripts/lib/normal-browser-diagnostic.mjs';
import { safeHostedBrowserDiagnostic, safeHostedBrowserResultFields } from '../scripts/lib/hosted-release/failure.mjs';
import { ReleaseError } from '../scripts/lib/hosted-release/json-contract.mjs';

const dashboard = { module: 'dashboard', handler: 'dashboardStemList', sourceContract: REVIEW_REPAIR_NORMAL_BROWSER_CONTRACT };
function page({ panel = true, rows = 2, empty = false, error = false, requestError = false, notice = false, unavailable = false, paint } = {}) {
  return {
    locator(selector) {
      if (selector.includes(', ')) return { count: async () => Number(error) + Number(requestError) };
      if (selector === '[role="alert"]:visible') return { count: async () => Number(error) };
      if (selector === '[class~="border-destructive/20"][class~="bg-destructive/10"]:visible') return { count: async () => Number(requestError) };
      assert.equal(selector, '[aria-label]:visible');
      return { filter: () => ({ count: async () => Number(unavailable) }) };
    },
    getByText: () => ({ count: async () => Number(notice), nth: () => ({ isVisible: async () => notice }) }),
    getByRole(role, options) {
      assert.equal(role, 'tabpanel'); assert.deepEqual(options, { name: 'STEMs', exact: true });
      return { isVisible: async () => typeof panel === 'function' ? panel() : panel,
        getByText(text, opts) { assert.equal(text, 'No STEMs match these filters. Reset a filter or select a wider period.'); assert.equal(opts.exact, true); return { filter(visible) { assert.deepEqual(visible, { visible: true }); return { first: () => ({ isVisible: async () => empty }) }; } }; },
        locator(selector) { assert.equal(selector, 'table tbody tr[data-stem-group]:visible'); return { count: async () => rows }; } };
    },
    waitForTimeout: async () => { paint?.(); },
  };
}

test('visible errors, fixed notices and unavailable badges retain their existing failure predicates', async () => {
  for (const [option, origin] of [['error', 'VISIBLE_ERROR'], ['notice', 'FIXED_FAILURE_NOTICE'], ['unavailable', 'DATA_UNAVAILABLE_BADGE']]) {
    const seen = [];
    assert.equal(await be6NormalSurfaceUnavailable(page({ [option]: true }), value => seen.push(value)), true);
    assert.equal(seen[0].origin, origin);
  }
  const seen = []; assert.equal(await be6NormalSurfaceUnavailable(page(), value => seen.push(value)), false); assert.deepEqual(seen, []);
});

test('visible role alert and source-owned request error block retain separate scalar counts end to end', async () => {
  for (const [options, alert, request] of [[{ error: true }, 1, 0], [{ requestError: true }, 0, 1], [{ error: true, requestError: true }, 1, 1]]) {
    const diagnostic = createNormalBrowserModuleDiagnostic(() => ({ primaryLoaded: true, dashboardSummaryLoaded: true, dashboardFiltersLoaded: true }));
    assert.equal(await be6NormalSurfaceUnavailable(page(options), value => diagnostic.fail({ ...value, step: 'UNAVAILABLE_CHECK', reason: 'UNAVAILABLE_SURFACE' })), true);
    const normalRole = normalizeCompatibilityNormalDiagnostic({ stage: 'COVERAGE', reason: 'COVERAGE_INCOMPLETE', modules: [{ ...dashboard, reason: 'UNAVAILABLE_SURFACE', surface: diagnostic.snapshot() }] });
    const safe = safeHostedBrowserResultFields({ status: 'failed', errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED', diagnosticCode: 'HOSTED_NORMAL_ROLE_FAILED', stage: 'browser.normal', normalRole });
    const observed = safe.normalRole.modules[0].surface.firstFailure;
    assert.equal(observed.visibleAlertCount, alert); assert.equal(observed.requestErrorBlockCount, request);
    assert.equal(observed.primaryLoaded, true); assert.equal(observed.dashboardSummaryLoaded, true); assert.equal(observed.dashboardFiltersLoaded, true);
  }
});

test('failed scalar sub-observation cannot conceal the original fatal visible-error predicate', async () => {
  const seen = [], p = { locator(selector) { if (selector.includes(', ')) return { count: async () => 1 }; throw Error('PRIVATE_DOM'); } };
  assert.equal(await be6NormalSurfaceUnavailable(p, value => seen.push(value)), true);
  assert.deepEqual(seen, [{ origin: 'VISIBLE_ERROR', matchedErrorCount: 1 }]);
});

test('actual Dashboard selectors retain nonempty and honest-empty acceptance and distinguish hidden/empty/rows failures', async () => {
  for (const [options, loadedRows, reason, origin] of [
    [{ panel: false }, 2, 'UNAVAILABLE_SURFACE', 'DASHBOARD_PANEL_HIDDEN'],
    [{ rows: 0 }, 2, 'MISSING_ROWS', 'DASHBOARD_ROWS_MISSING'],
    [{ rows: 0, empty: false }, 0, 'EMPTY_STATE_MISSING', 'DASHBOARD_EMPTY_STATE_MISSING'],
  ]) { const seen = []; assert.equal(await be6NormalSurfaceReason(dashboard, page(options), { rows: loadedRows }, x => seen.push(x)), reason); assert.equal(seen[0].origin, origin); }
  assert.equal(await be6NormalSurfaceReason(dashboard, page(), { rows: 2 }), null);
  assert.equal(await be6NormalSurfaceReason(dashboard, page({ rows: 0, empty: true }), { rows: 0 }), null);
});

test('bounded paint polling does not record a transient hidden panel as a terminal failure', async () => {
  let visible = false; const seen = [];
  assert.equal(await compatibilityNormalSurfaceReason(dashboard, page({ panel: () => visible, paint: () => { visible = true; } }), { rows: 2 }, '', { timeoutMs: 100, observe: x => seen.push(x) }), null);
  assert.deepEqual(seen, []);
  assert.equal(await compatibilityNormalSurfaceReason(dashboard, page({ panel: false }), { rows: 2 }, '', { timeoutMs: 0, observe: x => seen.push(x) }), 'UNAVAILABLE_SURFACE');
  assert.equal(seen[0].origin, 'DASHBOARD_PANEL_HIDDEN'); assert.ok(seen[0].waitElapsedMs >= 0);
  await assert.rejects(compatibilityNormalSurfaceReason(dashboard, page(), { rows: 2 }, '', { timeoutMs: 5001 }), /UNAVAILABLE_SURFACE/);
});

test('first surface failure and later close failure both survive the actual hosted sanitizer and raw-result projection', () => {
  const diagnostic = createNormalBrowserModuleDiagnostic(() => ({ primaryLoaded: true, primaryRows: 2, dashboardSummaryLoaded: true, dashboardFiltersLoaded: true, pendingResponses: 0 }));
  diagnostic.fail({ origin: 'DASHBOARD_PANEL_HIDDEN', step: 'SURFACE_CHECK', reason: 'UNAVAILABLE_SURFACE', panelVisible: false });
  diagnostic.fail({ origin: 'BROWSER_ACTION_ERROR', step: 'WORKFLOW' });
  diagnostic.close(new TypeError('PRIVATE_COOKIE_AND_DOM'));
  const terminal = compatibilityNormalModuleTerminalReason({ reason: 'MISSING_ROWS', closeFailed: true });
  assert.equal(terminal, 'UNAVAILABLE_SURFACE');
  const thrown = compatibilityNormalDiagnosticError('COVERAGE', 'COVERAGE_INCOMPLETE', { modules: [{ ...dashboard, reason: terminal, surface: diagnostic.snapshot() }] });
  const hosted = safeHostedBrowserDiagnostic(new ReleaseError('HOSTED_NORMAL_ROLE_FAILED', 'browser.normal', 'LOCAL', { normalRole: thrown.normalRoleDiagnostic }));
  const result = safeHostedBrowserResultFields({ status: 'failed', errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED', ...hosted });
  const row = result.normalRole.modules.find(x => x.module === 'dashboard');
  assert.equal(row.reason, 'UNAVAILABLE_SURFACE');
  assert.equal(row.surface.firstFailure.origin, 'DASHBOARD_PANEL_HIDDEN'); assert.equal(row.surface.firstFailure.primaryRows, 2);
  assert.deepEqual(row.surface.cleanupFailure, { origin: 'PAGE_CLOSE_ERROR', step: 'PAGE_CLOSE', reason: 'UNAVAILABLE_SURFACE', errorKind: 'TypeError' });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Cookie|DOM/);
});

test('browser action error and close-only failure remain distinct without exposing exception strings', () => {
  const d = createNormalBrowserModuleDiagnostic();
  d.close({ name: 'PRIVATE_TOKEN', message: 'PRIVATE_BODY' });
  assert.equal(d.snapshot().firstFailure.origin, 'PAGE_CLOSE_ERROR'); assert.equal(d.snapshot().cleanupFailure.errorKind, 'OTHER');
  const raw = { stage: 'COVERAGE', reason: 'COVERAGE_INCOMPLETE', modules: [{ ...dashboard, reason: 'UNAVAILABLE_SURFACE',
    surface: { firstFailure: { origin: 'BROWSER_ACTION_ERROR', step: 'OPEN_SURFACE', errorKind: 'TimeoutError', body: 'PRIVATE_BODY' } } }] };
  assert.equal(normalizeCompatibilityNormalDiagnostic(raw).modules[0].surface.firstFailure.errorKind, 'TimeoutError');
  assert.doesNotMatch(JSON.stringify(normalizeCompatibilityNormalDiagnostic(raw)), /PRIVATE/);
});

test('closed diagnostic schema rejects arbitrary labels, strings and unbounded scalars and snapshots getters once', () => {
  assert.equal(safeNormalBrowserObservation({ origin: 'PRIVATE_URL', step: 'SURFACE_CHECK' }), undefined);
  let reads = 0;
  const result = safeNormalBrowserObservation({ get origin() { return ++reads === 1 ? 'VISIBLE_ERROR' : 'PRIVATE'; }, step: 'UNAVAILABLE_CHECK', matchedErrorCount: Infinity, primaryRows: -1, pendingResponses: 'PRIVATE', panelVisible: 'true', raw: 'PRIVATE' });
  assert.deepEqual(result, { origin: 'VISIBLE_ERROR', step: 'UNAVAILABLE_CHECK' }); assert.equal(reads, 1);
  const old = normalizeCompatibilityNormalDiagnostic({ stage: 'COVERAGE', reason: 'COVERAGE_INCOMPLETE', modules: [{ ...dashboard, reason: 'UNAVAILABLE_SURFACE' }] });
  assert.deepEqual(old.modules[0], { module: 'dashboard', handler: 'dashboardStemList', reason: 'UNAVAILABLE_SURFACE' });
});
