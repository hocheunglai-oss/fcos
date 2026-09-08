import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FCOS_READ_ONLY_CI as pin } from '../config/fcosCiIdentity.js';
import {
  ciModuleAccess, isReadOnlyCiProfile, readOnlyCiProfile, requireReadOnlyCiOperation,
  validateCiFederation, READ_ONLY_CI_HANDLERS,
} from '../api/_readOnlyCiAccess.js';
import { enforceFcunoFederatedAccess } from '../api/_fcunoIdentityFederation.js';
import { handleHedgeMarkets } from '../api/_hedgeDeskService.js';
import { workNotificationsList } from '../api/_workNotifications.js';
import { requireEmailRouterUser } from '../api/_emailRouterCore.js';

const authUser = { id: '11111111-1111-4111-8111-111111111111', email: pin.email,
  identities: [{ provider: pin.provider, identity_data: { sub: pin.subject } }] };
const storedProfile = { id: authUser.id, email: pin.email, active: false, user_type: 'administrator', use_type_defaults: true };
const link = { id: 'link-1', auth_user_id: authUser.id, email: pin.email, email_verified: true, source_active: true, use_fcos: true };
const env = { FCOS_ENABLE_READ_ONLY_CI: 'true', FCOS_ENABLE_FCUNO_FEDERATION: 'true', FCUNO_IDENTITY_ISSUER: pin.issuer };

function queryClient() {
  const reads = [];
  return { reads, from(table) {
    reads.push(table);
    const query = { select() { return query; }, eq() { return query; },
      maybeSingle: async () => ({ data: table === 'fcos_external_identity_links' ? link : storedProfile, error: null }) };
    return query;
  } };
}
const ciProfile = () => readOnlyCiProfile(storedProfile);
const assertDenied = (run) => assert.throws(run, (error) => error.status === 403 && error.code.startsWith('FCOS_CI_'));

test('CI requires exact issuer, immutable subject, verified email and live entitlement, not an alias or editable metadata', () => {
  const valid = { authUser, profile: storedProfile, link, issuer: pin.issuer, subject: pin.subject, env };
  assert.equal(validateCiFederation(valid), true);
  for (const patch of [
    { issuer: 'https://elsewhere.example' }, { subject: 'another-person' },
    { authUser: { ...authUser, email: 'vincent@cosulich.com.hk' } },
    { link: { ...link, email_verified: false } }, { link: { ...link, use_fcos: false } },
    { link: { ...link, source_active: false } }, { link: { ...link, auth_user_id: 'different-auth-id' } },
    { env: {} }, { profile: { ...storedProfile, email: 'vincent@cosulich.com.hk' } },
  ]) assertDenied(() => validateCiFederation({ ...valid, ...patch }));
  assert.equal(validateCiFederation({ ...valid, authUser: { email: 'normal@example.com', user_metadata: { sub: pin.subject, read_only_ci: true } }, profile: null }), false);
});

test('live CI admission is read-only and cannot promote its stored zero-permission profile or fall back to a legacy login', async () => {
  const client = queryClient();
  const profile = await enforceFcunoFederatedAccess({ client, authUser, profile: storedProfile, env });
  assert.equal(profile.active, true);
  assert.equal(profile.user_type, 'viewer');
  assert.equal(profile.use_type_defaults, false);
  assert.equal(storedProfile.active, false);
  assert.equal(isReadOnlyCiProfile(profile), true);
  assert.deepEqual(client.reads, ['fcos_external_identity_links', 'user_profiles']);
  for (const disabledEnv of [{}, { ...env, FCOS_ENABLE_FCUNO_FEDERATION: 'false' }, { ...env, FCOS_ENABLE_READ_ONLY_CI: 'false' }]) {
    await assert.rejects(enforceFcunoFederatedAccess({ client, authUser, profile: storedProfile, env: disabledEnv }), { status: 403 });
  }
  await assert.rejects(enforceFcunoFederatedAccess({ client, authUser: { ...authUser, identities: [] }, profile: storedProfile, env }), { status: 403 });
});

test('the CI allowlist admits audited reads and denies financial, admin, email, upload, AI, preference and unknown operations', () => {
  const profile = ciProfile();
  for (const handler of READ_ONLY_CI_HANDLERS) requireReadOnlyCiOperation(profile, handler);
  for (const handler of ['adminUserSave', 'variableChargesBuyerConfirm', 'hedgePhysicalSalesforceApply',
    'marketReportAnalysis', 'dashboardAiSearch', 'marketIntradaySnapshotPreview', 'emailRouterBackgroundSync',
    'collaborationAttachmentPrepare', 'workspacePreferencesSave', 'portalApplicationLaunch', 'futureReadEndpoint']) {
    assertDenied(() => requireReadOnlyCiOperation(profile, handler));
    // An accidental Administrator assignment or copied DB row cannot escape.
    assertDenied(() => requireReadOnlyCiOperation({ ...storedProfile, active: true }, handler));
  }
  assertDenied(() => requireReadOnlyCiOperation(profile, 'authContext', {}, { mutation: true }));
  assert.deepEqual(ciModuleAccess(['dashboard', 'markets', 'admin', 'email_router', 'hedge']), {
    dashboard: true, markets: true, admin: false, email_router: false, hedge: false,
  });
  requireReadOnlyCiOperation({ email: 'ordinary@example.com', user_type: 'viewer' }, 'workspacePreferencesSave');
});

test('mixed Markets actions fail closed before any service client or external operation', async () => {
  for (const action of ['snapshot', 'market_history', 'intelligence_curve']) {
    requireReadOnlyCiOperation(ciProfile(), 'hedgeMarkets', { action });
  }
  for (const action of ['create', 'update', 'delete', 'save_spreads', 'verify_month', 'market_report_preview', 'market_report_import', 'forward_fallback_save', 'future_action']) {
    await assert.rejects(handleHedgeMarkets({ action }, ciProfile(), { client: null, capabilities: { hedge_admin: true, hedge_book_manage: true } }), { code: 'FCOS_CI_READ_ONLY' });
  }
});

test('CI notifications cannot start reconciliation or expose unrelated operational notices', async () => {
  const result = await workNotificationsList({}, { profile: ciProfile(), client: null });
  assert.deepEqual(result.notifications, []);
  assert.equal(result.unreadCount, 0);
  assert.equal(result.restrictedReadOnly, true);
});

test('opening the real Markets snapshot as CI performs reads but no expiry reconciliation writes', async () => {
  const tables = [];
  const client = { from(table) {
    tables.push(table);
    const query = new Proxy({}, { get(_target, method) {
      if (method === 'then') return (resolve) => resolve({ data: [], error: null });
      if (['select', 'eq', 'in', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'neq', 'is', 'range', 'or', 'maybeSingle', 'single'].includes(method)) return () => query;
      throw new Error(`Unexpected database mutation or method: ${String(method)}`);
    } });
    return query;
  } };
  const result = await handleHedgeMarkets({ action: 'snapshot' }, ciProfile(), { client, capabilities: {} });
  assert.equal(result.expiryAutomation.reason, 'read_only_identity');
  assert.ok(tables.includes('hedge_market_prices'));
  assert.equal(tables.includes('hedge_swaps'), false);
});

test('Email Router alternate dependency boundary also denies CI', async () => {
  await assert.rejects(requireEmailRouterUser({}, { client: {}, profile: ciProfile() }), { code: 'FCOS_CI_READ_ONLY' });
});

test('every authenticated dispatcher enforces the CI guard and Markets skips expiry only for CI', async () => {
  const main = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const wrapper = await readFile(new URL('../api/_authenticatedFunction.js', import.meta.url), 'utf8');
  const markets = await readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8');
  assert.match(main, /requireReadOnlyCiOperation\(context\.profile, name/);
  assert.match(main, /requireReadOnlyCiOperation\(accessContext\?\.profile, name, body\)/);
  assert.match(wrapper, /requireReadOnlyCiOperation\(context\.profile, resolvedHandlerName, body/);
  assert.match(main, /readOnlyCi \? \[\] : await listPortalApplicationsForUser/);
  assert.match(main, /if \(!readOnlyCi\) schedulePortalOutboxRetry/);
  assert.match(markets, /isReadOnlyCiProfile\(profile\)\s*\? \{ status: 'not_run', reason: 'read_only_identity' \}\s*: await reconcilePaperHedgeExpiry\(client\)/);
});
