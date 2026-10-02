import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { disposableDatabaseUrl, migrationSha256, planMigrationVerification, verifyLocalMigrationServer } from '../scripts/lib/migration-verification.mjs';

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

function dockerFixture(overrides = {}) {
  const container = { name: '/supabase_db_fcos', running: true, project: 'fcos',
    ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '54322' }] },
    networks: { supabase_network_fcos: { IPAddress: '172.18.0.2', GlobalIPv6Address: '' } }, ...overrides };
  const calls = [];
  const args = { address: '172.18.0.2', databaseUrl: 'postgresql://postgres@127.0.0.1:54322/postgres', cwd: '/fixture/fcos',
    env: { FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1', FCOS_MIGRATION_DOCKER_CONTAINER: 'supabase_db_fcos' },
    runDocker(command, env) { calls.push({ command, env }); return command[0] === 'context' ? '"unix:///var/run/docker.sock"' : JSON.stringify(container); } };
  return { args, calls };
}

test('local Docker bridge address requires exact project, published port, address and a forced local socket', () => {
  const { args, calls } = dockerFixture();
  assert.deepEqual(verifyLocalMigrationServer(args), { transport: 'local-docker', container: 'supabase_db_fcos', project: 'fcos' });
  assert.deepEqual(calls[1].command.slice(0, 5), ['--host', 'unix:///var/run/docker.sock', 'inspect', '--type', 'container']);
  assert.doesNotMatch(calls[1].command.join(' '), /\.Config\.Env/);
  assert.equal(calls[1].env.DOCKER_HOST, undefined); assert.equal(calls[1].env.DOCKER_CONTEXT, undefined);
  assert.deepEqual(verifyLocalMigrationServer({ ...args, address: '127.0.0.1', env: { FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1' } }), { transport: 'loopback' });
});

test('remote, unrelated or ambiguous Docker targets fail closed before any migration', () => {
  const { args } = dockerFixture();
  for (const container of [
    { name: '/supabase_db_other' }, { running: false }, { project: 'other' },
    { ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '6543' }] } },
    { ports: { '5432/tcp': [{ HostIp: '192.168.1.20', HostPort: '54322' }] } },
    { networks: { network: { IPAddress: '172.18.0.3' } } },
  ]) assert.throws(() => verifyLocalMigrationServer(dockerFixture(container).args), /does not match/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: { FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1' } }), /explicitly verified/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: { ...args.env, FCOS_MIGRATION_DISPOSABLE_CLUSTER: '0' } }), /explicitly disposable/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: { ...args.env, FCOS_MIGRATION_DOCKER_CONTAINER: 'supabase_db_other' } }), /does not match/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, cwd: '/fixture/FCOS' }), /does not match/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, address: null }), /address could not be verified/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: { ...args.env, DOCKER_HOST: 'tcp://remote.invalid:2375' } }), /remote Docker host/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, runDocker: () => '"ssh://remote.invalid"' }), /could not be verified/);
});
