import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { disposableDatabaseUrl, migrationSha256, planMigrationVerification } from '../scripts/lib/migration-verification.mjs';

const first = { name: '20260930000000_baseline.sql', sql: 'select 1;' };
const second = { name: '20260930100000_pending.sql', sql: 'select 2;' };
const baseline = { schemaVersion: 1, version: 'fixture', commit: 'a'.repeat(40), migrations: [{ name: first.name, sha256: migrationSha256(first.sql) }] };

test('release ledger derives every pending migration and orders the entire upgrade chronologically', () => {
  const third = { name: '20261001000000_future.sql', sql: 'select 3;' };
  const plan = planMigrationVerification([third, second, first], baseline);
  assert.deepEqual(plan.baseline, [first]); assert.deepEqual(plan.pending, [second, third]);
  assert.deepEqual(plan.ordered, [first, second, third]);
});

test('changed or removed baseline history and retroactive pending migrations fail closed', () => {
  assert.throws(() => planMigrationVerification([{ ...first, sql: 'select 9;' }, second], baseline), /removed or changed/);
  assert.throws(() => planMigrationVerification([second], baseline), /removed or changed/);
  assert.throws(() => planMigrationVerification([first, { name: '20260929000000_backdated.sql', sql: '' }], baseline), /predates/);
  assert.throws(() => planMigrationVerification([first, { ...second, name: '20260930000000_duplicate.sql' }], baseline), /Duplicate/);
  assert.throws(() => planMigrationVerification([first], { ...baseline, migrations: [...baseline.migrations, ...baseline.migrations] }), /Invalid baseline/);
});

test('recorded Production ledger matches all committed migration contents', async () => {
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const migrations = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).map(async name => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })));
  const recorded = JSON.parse(await readFile(new URL('../config/migration-verification-baseline.json', import.meta.url), 'utf8'));
  const plan = planMigrationVerification(migrations, recorded);
  assert.equal(recorded.commit, '382f0329ebb5c3a28cd20d89c653db86309ef425');
  assert.equal(plan.baseline.length, 186);
  assert.ok(plan.pending.some(item => item.name.endsWith('_email_router_learning_recovery.sql')));
});

test('database gate accepts explicit loopback targets and rejects connection-string overrides', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(disposableDatabaseUrl(`postgresql://postgres@${host}:54322/postgres`).hostname, host);
  for (const url of [
    'postgresql://postgres@db.example.invalid/postgres',
    'postgresql://postgres@127.0.0.1/postgres?host=db.example.invalid',
    'postgresql://postgres@localhost/postgres?service=production',
    'postgresql://postgres@localhost/postgres#override',
    'https://postgres@localhost/postgres', 'postgresql://localhost/postgres',
    'postgresql://postgres@localhost/', 'not a URL',
  ]) assert.throws(() => disposableDatabaseUrl(url), /local|loopback/);
});
