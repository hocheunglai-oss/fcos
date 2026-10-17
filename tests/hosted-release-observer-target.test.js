import test from 'node:test';
import assert from 'node:assert/strict';
import { observerEndpoint, assertObserverConnection, observerClientConfiguration } from '../scripts/lib/hosted-release/observer-target.mjs';
import { assertObserverTarget } from '../scripts/lib/hosted-release/observations.mjs';
import pg from 'pg';
import { readFileSync } from 'node:fs';

test('observer accepts only explicit canonical direct or session endpoints with verified TLS', () => {
  for (const mode of ['direct', 'session']) {
    const e = observerEndpoint(mode);
    const url = `postgresql://${e.username}:test-only@${e.host}:5432/postgres?sslmode=verify-full`;
    assert.equal(assertObserverConnection(url, e.project).hostname, e.host);
    assert.equal(assertObserverTarget(url, e.project).username, e.username);
  }
  assert.throws(() => observerEndpoint('transaction'));
});

test('both collector admission boundaries reject project, role, host, port and TLS override drift', () => {
  const e = observerEndpoint('session');
  const original = `postgresql://${e.username}:test-only@${e.host}:5432/postgres?sslmode=verify-full`;
  const changes = [u => { u.hostname = 'unapproved.pooler.supabase.com'; }, u => { u.username = 'postgres.' + e.project; },
    u => { u.username = 'fcos_release_observer.otherproject'; }, u => { u.port = '6543'; },
    u => { u.pathname = '/other'; }, u => { u.password = ''; }, u => { u.hash = '#fragment'; },
    u => { u.searchParams.set('sslmode', 'require'); }, u => { u.searchParams.append('sslmode', 'disable'); },
    u => { u.searchParams.set('host', 'other.example'); }, u => { u.searchParams.set('options', '-c role=postgres'); },
    u => { u.searchParams.set('sslrootcert', '/unapproved/ca'); }, u => { u.searchParams.set('sslcert', '/unapproved/client'); }];
  for (const mutate of changes) {
    const u = new URL(original); mutate(u);
    assert.throws(() => assertObserverConnection(u.href, e.project));
    assert.throws(() => assertObserverTarget(u.href, e.project), { code: 'SCHEMA_OBSERVER_TARGET' });
  }
  assert.throws(() => assertObserverConnection(original, 'otherproject'));
  assert.throws(() => assertObserverTarget(undefined, e.project), { code: 'SCHEMA_OBSERVER_SETUP_REQUIRED' });
});

test('native pg configuration pins port and CA even without URL port/rootcert and with hostile PG defaults', () => {
  const e = observerEndpoint('session'), original = { PGPORT: process.env.PGPORT, PGHOST: process.env.PGHOST, PGOPTIONS: process.env.PGOPTIONS };
  try {
    process.env.PGPORT = '6543'; process.env.PGHOST = 'unapproved.example'; process.env.PGOPTIONS = '-c role=postgres';
    const config = observerClientConfiguration(`postgresql://${e.username}:test%3Aonly@${e.host}/postgres?sslmode=verify-full`, e.project);
    const client = new pg.Client(config), actual = client.connectionParameters;
    assert.equal(config.connectionString, undefined); assert.equal(actual.host, e.host); assert.equal(actual.port, 5432);
    assert.equal(actual.user, e.username); assert.equal(actual.password, 'test:only');
    assert.equal(actual.ssl.rejectUnauthorized, true); assert.equal(actual.ssl.servername, e.host);
    assert.deepEqual(actual.ssl.ca, readFileSync(new URL('../supabase/functions/release-coordinator/supabase-root-2021.crt', import.meta.url)));
    assert.equal(actual.options, '-c default_transaction_read_only=on -c search_path=pg_catalog');
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
