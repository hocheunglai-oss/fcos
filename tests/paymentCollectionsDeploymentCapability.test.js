import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { deploymentCapabilities, requireDeploymentMutationAllowed } from '../api/_deploymentReadOnly.js';
import { listPortalApplicationsForUser, processPortalOutbox } from '../api/_portal.js';
import { clientSessionState, setClientSessionOwner } from '../src/lib/clientSessionState.js';

const source = async (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const withoutImports = (value) => value.replace(/^import[\s\S]*?;\n/gm, '');
async function execute(value) {
  const compiled = ts.transpileModule(value, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

function reactHarness() {
  const states = [], refs = [], callbacks = [], effects = [];
  let stateIndex, refIndex, callbackIndex, effectIndex;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    render(fn) { stateIndex = refIndex = callbackIndex = effectIndex = 0; return fn(); },
    runEffect(index) { effects[index].fn(); },
    async flush() {
      for (const effect of effects) {
        if (!effect?.pending) continue;
        effect.pending = false;
        effect.fn();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    react: {
      createContext: () => ({ Provider: 'provider' }),
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      Fragment: 'fragment',
      useContext: () => null,
      useMemo: (fn) => fn(),
      useRef: (initial) => { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useCallback: (fn, deps) => {
        const index = callbackIndex++;
        if (!same(callbacks[index]?.deps, deps)) callbacks[index] = { fn, deps };
        return callbacks[index].fn;
      },
      useEffect: (fn, deps) => {
        const index = effectIndex++;
        const pending = !same(effects[index]?.deps, deps);
        effects[index] = { fn, deps, pending };
      },
    },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('server declares the same deployment restriction it enforces, including the read-only CI profile', async () => {
  for (const env of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' }]) {
    assert.deepEqual(deploymentCapabilities(env), { mutationsAllowed: false });
    assert.throws(() => requireDeploymentMutationAllowed(true, env), { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  }
  assert.deepEqual(deploymentCapabilities({ VERCEL_ENV: 'production' }), { mutationsAllowed: true });
  assert.deepEqual(deploymentCapabilities({ VERCEL_ENV: 'production' }, { readOnlyProfile: true }), { mutationsAllowed: false });

  // Execute the actual authenticated response builder with provider-free dependencies.
  const server = ts.createSourceFile('server.js', await source('../api/functions/[name].js'), ts.ScriptTarget.ES2022, true);
  const authFunction = server.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'authContext');
  assert.ok(authFunction);
  const declaration = authFunction.getText(server).replace('async function authContext', 'export async function authContext');
  let scheduled = 0;
  globalThis.__deploymentResponseHarness = {
    isReadOnlyCiProfile: (profile) => profile.user_type === 'ci_read_only',
    loadAuthBootstrapPreferences: async () => null,
    ADMIN_APP_MODULES: [{ id: 'buyer_invoices' }], ADMIN_CAPABILITY_IDS: ['financial_report_settings_manage'],
    ciModuleAccess: () => ({ buyer_invoices: true }), isAdministratorUserType: (type) => type === 'administrator',
    ADMIN_FULL_ACCESS: { buyer_invoices: true }, ADMIN_FULL_CAPABILITIES: { financial_report_settings_manage: true },
    loadEffectiveGroupAccess: async () => ({ permissions: { buyer_invoices: true }, capabilities: {} }),
    permissionCanView: (_id, value) => value === true, listPortalApplicationsForUser: async () => [],
    schedulePortalOutboxRetry() { scheduled += 1; }, REPORT_ARCHIVE_MODULE_ID: 'report_archive', reportArchiveAccessLevel: () => 'none',
  };
  const { authContext } = await execute(`
    import { deploymentCapabilities } from ${JSON.stringify(new URL('../api/_deploymentReadOnly.js', import.meta.url).href)};
    const { isReadOnlyCiProfile, loadAuthBootstrapPreferences, ADMIN_APP_MODULES, ADMIN_CAPABILITY_IDS,
      ciModuleAccess, isAdministratorUserType, ADMIN_FULL_ACCESS, ADMIN_FULL_CAPABILITIES,
      loadEffectiveGroupAccess, permissionCanView, listPortalApplicationsForUser, schedulePortalOutboxRetry,
      REPORT_ARCHIVE_MODULE_ID, reportArchiveAccessLevel } = globalThis.__deploymentResponseHarness;
    ${declaration}
  `);
  const oldEnv = { VERCEL_ENV: process.env.VERCEL_ENV, FCOS_ENABLE_READ_ONLY_CI: process.env.FCOS_ENABLE_READ_ONLY_CI };
  try {
    delete process.env.FCOS_ENABLE_READ_ONLY_CI;
    for (const [environment, userType, expected] of [['preview', 'administrator', false], ['production', 'ci_read_only', false], ['production', 'administrator', true]]) {
      process.env.VERCEL_ENV = environment;
      const result = await authContext({}, null, { client: {}, authUser: {}, profile: { id: 'fixture', active: true, user_type: userType } });
      assert.deepEqual(result.deploymentCapabilities, { mutationsAllowed: expected });
      assert.equal(result.moduleAccess.buyer_invoices, true, 'deployment restrictions preserve authorized reads');
    }
    assert.equal(scheduled, 1, 'only writable Production schedules implicit portal work');
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    delete globalThis.__deploymentResponseHarness;
  }
});

test('AuthProvider fails closed for missing or malformed declarations and clears capability after auth failure or logout', async () => {
  const harness = reactHarness();
  let response = { data: { user: { id: 'fixture', user_type: 'administrator' } } };
  let failure = false;
  let pause = false, finishRequest, authEvent;
  const supabase = { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'fixture' } } } }),
    signOut: async () => {},
    onAuthStateChange: (callback) => { authEvent = callback; return { data: { subscription: { unsubscribe() {} } } }; },
  } };
  globalThis.__deploymentAuthHarness = {
    react: harness.react, supabase,
    appClient: { functions: { clearCache() {}, invoke: async () => {
      if (failure) throw new Error('Unavailable');
      if (pause) return new Promise((resolve) => { finishRequest = resolve; });
      return response;
    } } },
  };
  const oldWindow = globalThis.window;
  globalThis.window = { sessionStorage: { removeItem() {}, setItem() {} }, setTimeout };
  const authSource = withoutImports(await source('../src/lib/AuthContext.jsx')).replaceAll('import.meta.env.', 'testEnv.');
  const { AuthProvider } = await execute(`
    const { react: React, supabase, appClient } = globalThis.__deploymentAuthHarness;
    const { createContext, useCallback, useContext, useEffect, useRef, useState } = React;
    const FULL_ACCESS = {}, FULL_CAPABILITIES = {}, isAdministratorUserType = (type) => type === 'administrator';
    const isSupabaseConfigured = true, isLocalAdminAllowed = false, authConfigurationError = 'blocked', testEnv = {};
    const subscribeAccessRefresh = () => () => {};
    import { clientSessionState, isCurrentClientSession, setClientSessionOwner } from ${JSON.stringify(new URL('../src/lib/clientSessionState.js', import.meta.url).href)};
    ${authSource}
  `);
  const render = () => harness.render(() => AuthProvider({ children: null })).props.value;
  try {
    setClientSessionOwner(null);
    let auth = render();
    assert.equal(auth.deploymentMutationAllowed, false);
    for (const declaration of [undefined, {}, { mutationsAllowed: 'true' }, { mutationsAllowed: 1 }, { mutationsAllowed: false }, { mutationsAllowed: true }]) {
      response = { data: { user: { id: 'fixture', user_type: 'administrator' }, deploymentCapabilities: declaration } };
      await auth.checkUserAuth();
      auth = render();
      assert.equal(auth.deploymentMutationAllowed, declaration?.mutationsAllowed === true);
      assert.equal(auth.hasCapability('financial_report_settings_manage'), true, 'administrator permissions do not override deployment capability');
    }
    pause = true;
    const pendingRefresh = auth.checkUserAuth({ showLoader: false });
    await new Promise((resolve) => setImmediate(resolve));
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, false, 'a pending server refresh invalidates the prior true declaration');
    finishRequest(response);
    await pendingRefresh;
    pause = false;
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, true);
    harness.runEffect(1);
    pause = true;
    authEvent('SIGNED_IN', { user: { id: 'replacement' } });
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, false, 'session replacement clears the old user declaration immediately');
    await new Promise((resolve) => setTimeout(resolve, 5));
    finishRequest({ data: { user: { id: 'replacement' }, deploymentCapabilities: { mutationsAllowed: false } } });
    await new Promise((resolve) => setImmediate(resolve));
    pause = false;
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, false);
    response = { data: { user: { id: 'replacement' }, deploymentCapabilities: { mutationsAllowed: true } } };
    failure = true;
    await auth.checkUserAuth();
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, false);
    assert.equal(auth.deploymentCapabilities, null);
    failure = false;
    await auth.checkUserAuth();
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, true);
    await auth.logout();
    auth = render();
    assert.equal(auth.deploymentMutationAllowed, false);
    assert.equal(clientSessionState().ownerId, null);
  } finally {
    setClientSessionOwner(null);
    globalThis.window = oldWindow;
    delete globalThis.__deploymentAuthHarness;
  }
});

function portalClient() {
  const reads = [], writes = [];
  const entitlement = { id: 'entitlement', user_id: 'fixture', application_id: 'external', explicit_active: true,
    explicit_role_id: 'operator', effective_active: true, effective_role_id: 'operator', effective_source: 'explicit', revision: 4, sync_status: 'synced' };
  const tables = {
    portal_applications: [
      { id: 'fcos', name: 'FCOS', application_kind: 'internal', status: 'active', launch_path: '/' },
      { id: 'external', name: 'Existing app', application_kind: 'external', status: 'active', protocol: 'portal', administrator_default_role: 'owner', target_base_url: 'https://fixture.example' },
    ],
    portal_application_roles: [{ application_id: 'external', id: 'operator', label: 'Operator' }],
    portal_user_app_entitlements: [entitlement],
    portal_entitlement_outbox: [],
  };
  return {
    reads, writes, entitlement,
    from(table) {
      let operation = 'read', payload, single = false;
      const query = {
        select() { return query; }, order() { return query; }, eq() { return query; }, in() { return query; }, lt() { return query; }, lte() { return query; }, limit() { return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        insert(value) { operation = 'insert'; payload = value; return query; },
        upsert(value) { operation = 'upsert'; payload = value; return query; },
        maybeSingle() { single = true; return query; }, single() { single = true; return query; },
        then(resolve, reject) {
          if (operation === 'read') reads.push(table); else writes.push({ table, operation, payload });
          const data = operation === 'read' ? structuredClone(tables[table] || []) : [{ ...entitlement, ...payload }];
          return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('read-only portal listing returns existing data without entitlement repairs, and outbox fails before database access', async () => {
  for (const env of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' }]) {
    const client = portalClient(), before = structuredClone(client.entitlement);
    const applications = await listPortalApplicationsForUser({ client, profile: { id: 'fixture', active: true, user_type: 'administrator' }, moduleAccess: { buyer_invoices: true }, env });
    assert.deepEqual(client.writes, []);
    assert.deepEqual(client.reads.sort(), ['portal_applications', 'portal_application_roles', 'portal_user_app_entitlements'].sort());
    assert.deepEqual(client.entitlement, before);
    assert.equal(applications.find((app) => app.id === 'fcos').available, true, 'internal navigation remains available');
    const existing = applications.find((app) => app.id === 'external');
    assert.equal(existing.roleId, 'operator', 'listing does not invent a repaired role');
    assert.equal(existing.revision, 4);
    assert.equal(existing.available, false);
    assert.match(existing.blockingReason, /read-only/);
    const outboxClient = portalClient();
    await assert.rejects(processPortalOutbox({ client: outboxClient, env }), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' });
    assert.deepEqual(outboxClient.reads, []);
    assert.deepEqual(outboxClient.writes, []);
  }
  const production = portalClient();
  const applications = await listPortalApplicationsForUser({ client: production, profile: { id: 'fixture', active: true, user_type: 'administrator' }, env: { VERCEL_ENV: 'production' } });
  assert.equal(applications.find((app) => app.id === 'external').roleId, 'owner');
  assert.deepEqual(production.writes.map(({ table, operation }) => [table, operation]), [
    ['portal_user_app_entitlements', 'update'], ['portal_entitlement_outbox', 'upsert'],
  ], 'writable Production retains reconciliation and queued synchronization');
  const outboxClient = portalClient();
  const result = await processPortalOutbox({ client: outboxClient, env: { VERCEL_ENV: 'production' } });
  assert.ok(result);
  assert.deepEqual(outboxClient.writes.map(({ table, operation }) => [table, operation]), [['portal_entitlement_outbox', 'update']], 'writable Production retains stale-lock recovery');
});

test('Payment Collections issues no reconciliation mutation until declared writable, while collection and incoming pages stay mounted', async () => {
  const harness = reactHarness(), calls = [];
  let tab = 'collections';
  const auth = { hasModuleAccess: () => true, user: { id: 'fixture', user_type: 'administrator' }, deploymentCapabilities: null, deploymentMutationAllowed: false };
  const result = { summary: { checked: 1 }, exceptions: [], items: [], capabilities: { canOverridePostingReminder: true } };
  globalThis.__deploymentCollectionsHarness = {
    react: harness.react, auth, useSearchParams: () => [new URLSearchParams({ tab }), () => {}],
    appClient: { functions: { clearCache() {}, invoke: async (...args) => { calls.push(args); return { data: result, meta: {} }; } } },
  };
  const componentSource = withoutImports(await source('../src/pages/PaymentCollections.jsx'));
  const components = ['AlertTriangle', 'Banknote', 'CheckCircle2', 'ClipboardCheck', 'ListChecks', 'Loader2', 'RefreshCw', 'Scale', 'ShieldCheck', 'BuyerInvoices', 'IncomingPayments', 'Badge', 'Button', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'Label', 'Textarea', 'StateBlock', 'TableShell', 'PageMethodology', 'PageUserManual', 'DataStatus', 'SalesforceSyncBadge', 'StemDetailLink', 'WorkspaceViewBar', 'StemDetailModal', 'VariableCharges', 'LegacyPaymentDataAudit', 'PaymentDataReliabilityBadge'];
  const { default: PaymentCollections } = await execute(`
    const { react: React, auth, useSearchParams, appClient } = globalThis.__deploymentCollectionsHarness;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const useAuth = () => auth, PAYMENT_COLLECTIONS_METHODOLOGIES = { collections: {} }, VARIABLE_CHARGES_USER_MANUAL = {};
    ${components.map((name) => `const ${name} = ${JSON.stringify(name)};`).join('\n')}
    ${componentSource}
  `);
  const render = () => harness.render(() => PaymentCollections());
  try {
    for (const capability of [null, { mutationsAllowed: false }]) {
      auth.deploymentCapabilities = capability;
      auth.deploymentMutationAllowed = false;
      let tree = render();
      await harness.flush();
      assert.equal(calls.length, 0);
      assert.ok(nodes(tree).some((node) => node.type === 'BuyerInvoices'));
      tab = 'incoming';
      tree = render();
      assert.ok(nodes(tree).some((node) => node.type === 'IncomingPayments'));
      tab = 'reconciliation';
      tree = render();
      const refresh = nodes(tree).find((node) => node.type === 'Button' && node.props.children.includes(' Refresh Salesforce'));
      assert.ok(refresh);
      assert.equal(refresh.props.disabled, true);
      await refresh.props.onClick();
      const saveControl = nodes(tree).find((node) => node.type === 'Button' && node.props.children.includes('Save control'));
      assert.ok(saveControl);
      await saveControl.props.onClick();
      assert.equal(calls.length, 0, 'disabled handlers also fail closed if called directly');
      tab = 'collections';
    }
    auth.deploymentCapabilities = { mutationsAllowed: true };
    auth.deploymentMutationAllowed = true;
    render();
    await harness.flush();
    assert.deepEqual(calls, [['paymentCollectionsReconcile', { force: false }, { force: false }]], 'writable Production retains automatic reconciliation');
    tab = 'reconciliation';
    let tree = render();
    const refresh = nodes(tree).find((node) => node.type === 'Button' && node.props.children.includes(' Refresh Salesforce'));
    assert.equal(refresh.props.disabled, false);
    await refresh.props.onClick();
    assert.deepEqual(calls[1], ['paymentCollectionsReconcile', { force: true }, { force: true }]);
    auth.deploymentCapabilities = { mutationsAllowed: false };
    auth.deploymentMutationAllowed = false;
    tree = render();
    await harness.flush();
    assert.equal(calls.length, 2, 'losing capability never starts another automatic mutation');
    auth.deploymentCapabilities = { mutationsAllowed: true };
    auth.deploymentMutationAllowed = true;
    render();
    await harness.flush();
    assert.equal(calls.length, 2, 'an auth refresh does not repeat automatic reconciliation for the same user');
  } finally {
    delete globalThis.__deploymentCollectionsHarness;
  }
});
