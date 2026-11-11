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
  const previousSessionId = '0d3b6c21-922d-4797-8685-09f42d151537';
  const replacementSessionId = '9dffbefb-61cb-4a69-a5ea-5e46da6d42c4';
  const fakeSession = (id, iat) => ({
    user: { id: 'user-b' },
    access_token: `header.${Buffer.from(JSON.stringify({ session_id: id, iat })).toString('base64url')}.fixture`,
  });
  let browserSession = fakeSession(previousSessionId, 1);
  let sessionReads = 0;
  const supabase = { auth: {
    getSession: async () => {
      sessionReads += 1;
      return { data: { session: browserSession } };
    },
    signOut: async () => { authEvent?.('SIGNED_OUT', null); },
    onAuthStateChange: (fn) => { authEvent = fn; return { data: { subscription: { unsubscribe() {} } } }; },
  } };
  const client = { functions: { clearCache() {}, invoke: () => new Promise((resolve) => pending.push(resolve)) } };
  const sessionStorage = new Map();
  globalThis.window = { sessionStorage: { getItem: (key) => sessionStorage.get(key) ?? null, removeItem: (key) => sessionStorage.delete(key), setItem: (key, value) => sessionStorage.set(key, value) }, localStorage: {}, setTimeout, clearTimeout };
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
  const newest = auth.checkUserAuth();
  await Promise.resolve();
  pending[1]({ data: { user: { id: 'user-b', active: true }, moduleAccess: { dashboard: true } } });
  await newest;
  pending[0]({ data: { code: 'FCUNO_IDENTITY_SESSION_REVOKED', error: 'The older session was revoked.' } });
  assert.equal((await old).stale, true);
  assert.equal(sessionStorage.has('fcos:fcuno-force-reauth'), false);
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
  assert.equal(sessionStorage.get('fcos:failed-sign-out-session'), previousSessionId, 'Reload protection is persisted before provider acknowledgement');
  finishSignOut();
  await logout;
  assert.equal(sessionStorage.has('fcos:failed-sign-out-session'), false);
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
  const mismatched = auth.checkUserAuth();
  await Promise.resolve();
  pending[4]({ data: { user: { id: 'different-account', active: true }, moduleAccess: { admin: true } } });
  assert.equal((await mismatched).user, null);
  assert.equal(states[0], null);
  assert.equal(clientSessionState().ownerId, null);
  const recovered = auth.checkUserAuth();
  await Promise.resolve();
  pending[5]({ data: { user: { id: 'user-b', active: true }, moduleAccess: { dashboard: true } } });
  await recovered;
  authEvent('TOKEN_REFRESHED', { user: { id: 'user-b' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(pending.length, 7, 'a refreshed token must trigger a current server authorization check');
  pending[6]({ data: { code: 'FCUNO_IDENTITY_SESSION_REVOKED', error: 'This FCOS session was revoked. Sign in again.' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(states[0], null);
  assert.deepEqual(states[1], {});
  assert.equal(states[9].type, 'auth_required');
  assert.equal(sessionStorage.get('fcos:fcuno-force-reauth'), 'true');
  const failedSignOut = async () => ({ error: new Error('provider sign-out failed') });
  supabase.auth.signOut = failedSignOut;
  const beforeFailedLogout = sessionReads;
  const failedLogout = await auth.logout();
  assert.equal(sessionReads, beforeFailedLogout, 'Failed sign-out must not attempt a session refresh');
  assert.deepEqual(failedLogout.failures.map(({ applicationId }) => applicationId), ['fcos']);
  assert.equal(JSON.parse(sessionStorage.get('fcos:portal-logout-warning'))[0].applicationId, 'fcos');
  assert.equal(clientSessionState().ownerId, null);
  assert.deepEqual(await auth.checkUserAuth(), { user: null, stale: true });
  authEvent('TOKEN_REFRESHED', { user: { id: 'user-b' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(pending.length, 7);
  assert.equal(states[0], null);

  // A full reload remounts the provider, while this tab and its stored
  // Supabase session survive the failed sign-out.
  assert.equal(sessionStorage.get('fcos:failed-sign-out-session'), previousSessionId);
  browserSession = fakeSession(previousSessionId, 2);
  stateIndex = 0;
  const reloaded = AuthProvider({ children: null }).props.value;
  const invoke = client.functions.invoke;
  let reloadChecks = 0;
  client.functions.invoke = async () => {
    reloadChecks += 1;
    return { data: { user: { id: 'user-b', active: true } } };
  };
  const afterReload = await reloaded.checkUserAuth();
  assert.equal(afterReload.user, null, 'Reload must not revive the prior session after failed sign-out');
  assert.equal(reloadChecks, 0, 'The retained session must not reach authorization');
  assert.equal(states[7], false);
  assert.equal(states[10], true);

  // A different session is still subject to the normal server verification.
  browserSession = fakeSession(replacementSessionId, 3);
  client.functions.invoke = async () => ({ data: {
    code: 'FCUNO_IDENTITY_SESSION_REVOKED', error: 'The replacement is not authorized.',
  } });
  assert.equal((await reloaded.checkUserAuth()).user, null);
  assert.equal(sessionStorage.get('fcos:failed-sign-out-session'), previousSessionId);
  client.functions.invoke = async () => ({ data: { user: { id: 'user-b', active: true } } });
  assert.equal((await reloaded.checkUserAuth()).user.id, 'user-b');
  assert.equal(sessionStorage.has('fcos:failed-sign-out-session'), false);

  // Explicit password sign-in can recover when the old session could not
  // be identified, and still runs normal server verification.
  browserSession = { user: { id: 'user-b' }, access_token: 'malformed' };
  stateIndex = 0;
  const unverified = AuthProvider({ children: null }).props.value;
  await unverified.logout();
  assert.equal(sessionStorage.get('fcos:failed-sign-out-session'), 'unknown');
  browserSession = fakeSession(previousSessionId, 4);
  stateIndex = 0;
  const recovery = AuthProvider({ children: null }).props.value;
  client.functions.invoke = () => assert.fail('Unknown prior session must stay blocked');
  assert.equal((await recovery.checkUserAuth()).user, null);
  assert.equal(sessionStorage.get('fcos:failed-sign-out-session'), previousSessionId);

  client.functions.invoke = invoke;
  supabase.auth.signInWithPassword = async () => {
    browserSession = fakeSession(replacementSessionId, 5);
    return { error: null };
  };
  const newSignIn = recovery.login('test@example.invalid', 'fixture-only');
  await Promise.resolve();
  await Promise.resolve();
  pending[7]({ data: { user: { id: 'user-b', active: true } } });
  await newSignIn;
  assert.equal(states[0].id, 'user-b');
  assert.equal(sessionStorage.has('fcos:failed-sign-out-session'), false);
  delete globalThis.__authHarness;
});

test('the login screen withholds sign-in controls when hosted authentication is unavailable', async () => {
  const source = (await readFile(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  const harness = `
    let state;
    export function render(auth) {
      state = auth;
      return Login();
    }
    const React = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      Fragment: 'fragment',
    };
    const useAuth = () => state;
    const useLocation = () => ({ search: '', hash: '' });
    const useState = (value) => [typeof value === 'function' ? value() : value, () => {}];
    const useEffect = () => {};
    const useRef = (current) => ({ current });
    const window = { sessionStorage: { getItem: () => null } };
    const Boxes = 'boxes', Loader2 = 'loader', LockKeyhole = 'lock', TriangleAlert = 'alert';
    const Navigate = 'navigate';
  `;
  const compiled = ts.transpileModule(harness + source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { render } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const defaults = { authChecked: true, fcunoOidcEnabled: true, legacyPasswordLoginEnabled: true };
  const unavailable = JSON.stringify(render({ ...defaults, authMode: 'unavailable' }));
  assert.match(unavailable, /FCOS sign-in is unavailable/);
  assert.doesNotMatch(unavailable, /"type":"(?:button|form|navigate)"|local administrator mode/);
  const hosted = { ...defaults, authMode: 'supabase', isSupabaseConfigured: true };
  assert.match(JSON.stringify(render(hosted)), /Opening FCUNO sign-in/);
  const manual = JSON.stringify(render({ ...hosted, authError: { type: 'user_inactive' } }));
  assert.match(manual, /"type":"button"/);
  assert.match(manual, /"type":"form"/);
  const local = JSON.stringify(render({ ...defaults, authMode: 'local' }));
  assert.match(local, /"type":"navigate"/);
});
