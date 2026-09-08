import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clientSessionState, setClientSessionOwner, isCurrentClientSession } from '../src/lib/clientSessionState.js';
import { readPageState, writePageState } from '../src/lib/pageStateCache.js';
import { readDraft, writeDraft } from '../src/lib/draftAutosave.js';

function storage() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: (i) => [...entries.keys()][i], getItem: (k) => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: (k) => entries.delete(k) };
}

test('page data and drafts survive same-user navigation but not logout or another identity', () => {
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  setClientSessionOwner(null);
  window.localStorage.setItem('fcos:draft:collection', JSON.stringify({ data: 'legacy unowned' }));
  window.sessionStorage.setItem('fcos:page_state:incoming', JSON.stringify({ payment: 'legacy unowned' }));
  window.localStorage.setItem('fcos:appearance', 'light');
  // A scoped same-user draft survives startup/reload; unowned legacy data cannot.
  window.localStorage.setItem('fcos:draft:user-a:resumable', JSON.stringify({ data: 'A draft', updatedAt: new Date().toISOString() }));
  setClientSessionOwner('user-a');
  assert.equal(readDraft('resumable').data, 'A draft');
  assert.equal(readDraft('collection'), null);
  assert.deepEqual(readPageState('incoming', {}), {});
  const a = clientSessionState();
  writePageState('incoming', { payment: 'A payment' }, a);
  writeDraft('collection', { note: 'A note' }, a);
  setClientSessionOwner('user-a');
  assert.equal(clientSessionState(), a);
  assert.equal(readPageState('incoming').payment, 'A payment');
  assert.equal(readDraft('collection').data.note, 'A note');
  setClientSessionOwner('user-b');
  assert.equal(isCurrentClientSession(a), false);
  assert.deepEqual(readPageState('incoming', {}), {});
  assert.equal(readDraft('collection'), null);
  // Old component effects/autosave timers must not repopulate B's state.
  writePageState('incoming', { payment: 'late A payment' }, a);
  assert.equal(writeDraft('collection', { note: 'late A note' }, a), null);
  assert.deepEqual(readPageState('incoming', {}), {});
  writeDraft('collection', { note: 'B note' });
  setClientSessionOwner(null);
  assert.equal(readDraft('collection'), null);
  assert.equal(window.localStorage.getItem('fcos:draft:user-b:collection'), null);
  assert.equal(window.localStorage.getItem('fcos:appearance'), 'light');
  assert.equal(writeDraft('anonymous', 'not stored'), null);
});

test('storage-denied browsers still isolate in-memory state', () => {
  setClientSessionOwner(null);
  globalThis.window = Object.defineProperties({}, {
    localStorage: { get() { throw new Error('Blocked'); } },
    sessionStorage: { get() { throw new Error('Blocked'); } },
  });
  setClientSessionOwner('user-a');
  writePageState('incoming', { value: 'private' });
  assert.equal(readPageState('incoming').value, 'private');
  setClientSessionOwner('user-b');
  assert.deepEqual(readPageState('incoming', {}), {});
  setClientSessionOwner(null);
});

test('prefetch rejects a previous identity response and cannot evict a replacement', async () => {
  const source = await readFile(new URL('../src/lib/specialTermDetailPrefetch.js', import.meta.url), 'utf8');
  const pending = [];
  globalThis.__prefetchClient = { functions: { invoke: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } };
  const transformed = source.replace("import { appClient } from '@/api/appClient';", 'const appClient = globalThis.__prefetchClient;')
    .replace("'./clientSessionState.js'", JSON.stringify(new URL('../src/lib/clientSessionState.js', import.meta.url).href));
  const api = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
  setClientSessionOwner('user-a');
  const a = api.prefetchSpecialTermDetail('term');
  setClientSessionOwner('user-b');
  const b = api.prefetchSpecialTermDetail('term');
  pending[0].resolve({ data: { private: 'A' } });
  await assert.rejects(a, /account changed/);
  assert.equal(api.prefetchSpecialTermDetail('term'), b);
  pending[1].resolve({ data: { private: 'B' } });
  assert.equal((await b).private, 'B');
  api.invalidateSpecialTermDetail('term');
  const old = api.prefetchSpecialTermDetail('term');
  api.invalidateSpecialTermDetail('term');
  const replacement = api.prefetchSpecialTermDetail('term');
  pending[2].reject(new Error('old network error'));
  await assert.rejects(old, /old network/);
  assert.equal(api.prefetchSpecialTermDetail('term'), replacement);
  pending[3].resolve({ data: { private: 'fresh B' } });
  await replacement;
  setClientSessionOwner(null);
  delete globalThis.__prefetchClient;
});

test('auth lifecycle remounts users, rejects stale auth and captures page/autosave sessions', async () => {
  const [auth, draft, incoming, cashflow, query, client] = await Promise.all([
    'src/lib/AuthContext.jsx', 'src/lib/draftAutosave.js', 'src/pages/IncomingPayments.jsx', 'src/pages/CashflowForecast.jsx', 'src/lib/query-client.js', 'src/api/appClient.js',
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  assert.match(auth, /request !== authRequest.current \|\| !isCurrentClientSession\(session\)/);
  assert.match(auth, /React.Fragment key=\{user\?\.id \|\| 'signed-out'\}/);
  assert.match(auth, /setClientSessionOwner\(null\);\s*setUser\(null\);\s*setIsAuthenticated\(false\)/);
  assert.match(draft, /writeDraft\(key, valueRef.current, sessionRef.current\)/);
  assert.match(incoming, /writePageState\(PAGE_STATE_KEY, pageState, pageSession.current\)/);
  assert.match(cashflow, /view: activeView \}, pageSession\)/);
  assert.match(query, /onClientSessionReset\(\(\) => queryClientInstance.clear\(\)\)/);
  assert.match(client, /backgroundRequest.then\(\(result\) => \{\s*if \(!isCurrentClientSession\(session\)\) return;/);
});
