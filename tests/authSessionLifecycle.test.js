import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { clientSessionState, setClientSessionOwner } from '../src/lib/clientSessionState.js';

test('executed AuthProvider rejects late auth after logout and after a newer account check', async () => {
  const states = [];
  const effects = [];
  let stateIndex = 0;
  const pending = [];
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: 'fragment',
    useCallback: (fn) => fn,
    useContext: () => null,
    useEffect: (fn) => effects.push(fn),
    useRef: (value) => ({ current: value }),
    useState: (initial) => { const i = stateIndex++; states[i] = initial; return [initial, (value) => { states[i] = value; }]; },
  };
  let authEvent;
  let sessionUser = 'user-a';
  const stored = new Map();
  const supabase = { auth: {
    getSession: async () => ({ data: { session: { user: { id: sessionUser } } } }),
    signOut: async () => { authEvent?.('SIGNED_OUT', null); return { error: null }; },
    onAuthStateChange: (fn) => { authEvent = fn; return { data: { subscription: { unsubscribe() {} } } }; },
  } };
  const client = { functions: { clearCache() {}, invoke: () => new Promise((resolve) => pending.push(resolve)) } };
  globalThis.window = { sessionStorage: { removeItem: (k) => stored.delete(k), setItem: (k, v) => stored.set(k, v) }, localStorage: {}, setTimeout, clearTimeout };
  globalThis.__authHarness = { react, supabase, client };
  let source = await readFile(new URL('../src/lib/AuthContext.jsx', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replaceAll('import.meta.env.', 'testEnv.');
  source = `
    const { react: React, supabase, client: appClient } = globalThis.__authHarness;
    const { createContext, useCallback, useContext, useEffect, useRef, useState } = React;
    const FULL_ACCESS = {}, FULL_CAPABILITIES = {}, isAdministratorUserType = () => false;
    const isSupabaseConfigured = true, isLocalAdminAllowed = false, authConfigurationError = 'blocked';
    const testEnv = {};
    import { clientSessionState, isCurrentClientSession, setClientSessionOwner } from ${JSON.stringify(new URL('../src/lib/clientSessionState.js', import.meta.url).href)};
  ${source}`;
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { AuthProvider } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  setClientSessionOwner(null);
  const tree = AuthProvider({ children: null });
  const auth = tree.props.value;
  // Subscribe without starting the separate mount bootstrap request.
  effects[1]();
  const old = auth.checkUserAuth();
  await Promise.resolve();
  sessionUser = 'user-b';
  const newest = auth.checkUserAuth();
  await Promise.resolve();
  pending[1]({ data: { user: { id: 'user-b', active: true }, moduleAccess: { dashboard: true } } });
  await newest;
  pending[0]({ data: { user: { id: 'user-a', active: true }, moduleAccess: { admin: true } } });
  assert.equal((await old).stale, true);
  assert.equal(states[0].id, 'user-b');
  assert.equal(clientSessionState().ownerId, 'user-b');
  const beforeLogout = auth.checkUserAuth();
  await Promise.resolve();
  let finishSignOut;
  supabase.auth.signOut = () => new Promise((resolve) => { finishSignOut = resolve; });
  const logout = auth.logout();
  assert.equal(states[0], null);
  assert.equal(states[7], true, 'transition loader prevents automatic FCUNO navigation during sign-out');
  assert.equal(states[10], false, 'logout is not yet complete');
  assert.equal((await auth.checkUserAuth()).stale, true);
  finishSignOut({ error: null });
  await logout;
  assert.equal(states[7], false);
  pending[2]({ data: { user: { id: 'user-a' } } });
  assert.equal((await beforeLogout).stale, true);
  assert.equal(states[0], null);
  assert.equal(clientSessionState().ownerId, null);
  // An account-switch check uses showLoader:false but must still finish the
  // transition loader when the new account is inactive or fails verification.
  authEvent('SIGNED_IN', { user: { id: 'inactive-user' } });
  assert.equal(states[7], true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  pending[3]({ data: { error: 'Your account is inactive.' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(states[7], false);
  assert.equal(states[9].type, 'user_inactive');
  assert.equal(states[0], null);
  // A refreshed access token must revalidate authorization instead of silently
  // retaining the preceding session's permissions.
  authEvent('TOKEN_REFRESHED', { user: { id: sessionUser } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  pending[4]({ data: { error: 'Sign in again.', code: 'FCUNO_IDENTITY_SESSION_REVOKED' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(states[0], null);
  assert.equal(states[9].type, 'auth_required');
  assert.equal(stored.get('fcos:fcuno-force-reauth'), 'true');
  for (const user of [{ id: 'foreign-user', active: true }, { id: sessionUser, active: false }]) {
    const check = auth.checkUserAuth();
    await Promise.resolve();
    pending.at(-1)({ data: { user, moduleAccess: { admin: true } } });
    assert.equal((await check).user, null);
    assert.equal(states[0], null);
    assert.deepEqual(states[1], {});
  }
  // Supabase may resolve signOut with an error rather than reject. Keep the
  // current view locked and expose the failure in the returned summary.
  supabase.auth.signOut = async () => ({ error: new Error('revoke failed') });
  const failedLogout = await auth.logout();
  assert.equal(failedLogout.failures[0].applicationId, 'fcos');
  assert.equal((await auth.checkUserAuth()).stale, true);
  delete globalThis.__authHarness;
});

test('the route boundary denies unverified states and preserves the requested login destination', async () => {
  const location = { pathname: '/special-terms/private', search: '?view=details' };
  globalThis.__routeHarness = {
    auth: {}, location,
    createElement: (type, props) => ({ type, props }),
  };
  try {
    let source = await readFile(new URL('../src/components/ProtectedRoute.jsx', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '');
    source = `const React = globalThis.__routeHarness;
      const useEffect = () => {}, useAuth = () => globalThis.__routeHarness.auth, useLocation = () => globalThis.__routeHarness.location;
      const Navigate = 'navigate', Outlet = 'outlet', UserNotRegisteredError = 'unregistered';
      ${source}`;
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext } }).outputText;
    const { default: ProtectedRoute } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
    for (const auth of [
      { isAuthenticated: false, authChecked: true },
      { isAuthenticated: true, authChecked: true, authError: { type: 'user_inactive' } },
    ]) {
      globalThis.__routeHarness.auth = auth;
      const result = ProtectedRoute({});
      assert.equal(result.type, 'navigate');
      assert.equal(result.props.to, '/login');
      assert.equal(result.props.state.from, location);
    }
    globalThis.__routeHarness.auth = { isAuthenticated: true, authChecked: false };
    assert.equal(ProtectedRoute({ fallback: 'pending' }), 'pending');
    globalThis.__routeHarness.auth = { isAuthenticated: true, authChecked: true };
    assert.equal(ProtectedRoute({}).type, 'outlet');
  } finally { delete globalThis.__routeHarness; }
});
