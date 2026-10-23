import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { disposableDatabaseUrl, migrationSha256, planMigrationVerification, verifyLocalMigrationServer,
  MIGRATION_PARENT_PROOF_PATH, MIGRATION_STANDARD_ROLES, MIGRATION_SERVER_IDENTITY_SQL,
  isReadOnlyMigrationProofMount, loadMigrationParentProof, validateMigrationParentProof } from '../scripts/lib/migration-verification.mjs';

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
  const container = { id: '1'.repeat(64), name: '/supabase_db_fcos', running: true, project: 'fcos',
    ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '54322' }] },
    networks: { supabase_network_fcos: { IPAddress: '172.18.0.2', GlobalIPv6Address: '' } }, ...overrides };
  const calls = [];
  const args = { address: '172.18.0.2', databaseUrl: 'postgresql://postgres@127.0.0.1:54322/postgres', cwd: '/fixture/fcos',
    env: { FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1', FCOS_MIGRATION_PROJECT_ID: 'fcos', FCOS_MIGRATION_DOCKER_CONTAINER: 'supabase_db_fcos' },
    runDocker(command, env) { calls.push({ command, env }); return command[0] === 'context' ? '"unix:///var/run/docker.sock"' : JSON.stringify(container); } };
  return { args, calls };
}

test('local Docker bridge address requires exact project, published port, address and a forced local socket', () => {
  const { args, calls } = dockerFixture();
  assert.deepEqual(verifyLocalMigrationServer(args), { transport: 'local-docker', container: 'supabase_db_fcos', containerId: '1'.repeat(64), project: 'fcos', endpoint: 'unix:///var/run/docker.sock' });
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
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: { ...args.env, FCOS_MIGRATION_PROJECT_ID: 'other' } }), /does not match/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, address: null }), /address could not be verified/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: { ...args.env, DOCKER_HOST: 'tcp://remote.invalid:2375' } }), /remote Docker host/);
  assert.throws(() => verifyLocalMigrationServer({ ...args, runDocker: () => '"ssh://remote.invalid"' }), /could not be verified/);
});

test('archive checkout names do not replace the explicit disposable project identity', () => {
  const { args } = dockerFixture();
  for (const cwd of ['/candidate', '/fixture/FCOS']) {
    assert.deepEqual(verifyLocalMigrationServer({ ...args, cwd }), { transport: 'local-docker', container: 'supabase_db_fcos', containerId: '1'.repeat(64), project: 'fcos', endpoint: 'unix:///var/run/docker.sock' });
  }
  const missingPin = { ...args.env }; delete missingPin.FCOS_MIGRATION_PROJECT_ID;
  assert.throws(() => verifyLocalMigrationServer({ ...args, env: missingPin }), /FCOS_MIGRATION_PROJECT_ID is required/);
  for (const project of ['', '../fcos', 'fcos.example', 123]) {
    assert.throws(() => verifyLocalMigrationServer({ ...args, env: { ...args.env, FCOS_MIGRATION_PROJECT_ID: project } }), /project ID is invalid/);
  }
});

test('both direct quality entrypoints bind their disposable project without checkout-name inference', async () => {
  for (const [file, jobId] of [['quality.yml', 'code-and-database'], ['candidate-quality.yml', 'candidate-tests']]) {
    const workflow = loadYaml(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    const job = workflow.jobs[jobId], migration = job.steps.find(step => step.run?.includes('npm run verify:migrations'));
    assert.equal(job.env.FCOS_MIGRATION_PROJECT_ID, 'fcos');
    assert.match(migration.run, /FCOS_MIGRATION_DOCKER_CONTAINER=supabase_db_fcos/);
    const { args } = dockerFixture();
    assert.equal(verifyLocalMigrationServer({ ...args, cwd: '/SYNTHETIC/renamed-checkout',
      env: { ...args.env, FCOS_MIGRATION_PROJECT_ID: job.env.FCOS_MIGRATION_PROJECT_ID } }).project, 'fcos');
    assert.throws(() => verifyLocalMigrationServer({ ...args,
      env: { ...args.env, FCOS_MIGRATION_PROJECT_ID: 'another-project' } }), /does not match/);
  }
});

function parentFixture() {
  const identity = { address: '172.18.0.2', database: 'postgres', dataDirectory: '/var/lib/postgresql/data',
    serverStartedAt: '2026-10-24T01:02:03.123456Z', systemIdentifier: '1234567890123456789', currentUser: 'postgres', sessionUser: 'postgres', roleSetting: 'none' };
  const args = { identity, databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', projectId: 'fcos',
    controllerSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), roles: [...MIGRATION_STANDARD_ROLES] };
  const proof = { kind: 'fcos_disposable_migration_parent_proof_v1', schemaVersion: 1, projectId: 'fcos',
    container: { name: 'supabase_db_fcos', id: '1'.repeat(64) }, url: { hostname: '127.0.0.1', port: 54322, username: 'postgres', database: 'postgres' },
    identity: { ...identity }, roles: [...MIGRATION_STANDARD_ROLES], source: { controllerSha: args.controllerSha, candidateSha: args.candidateSha } };
  return { proof, args };
}

test('trusted parent proof binds the exact current SQL server, fixed URL, roles and immutable sources', () => {
  const { proof, args } = parentFixture();
  assert.deepEqual(validateMigrationParentProof(proof, args), { transport: 'trusted-parent-docker', container: 'supabase_db_fcos', containerId: '1'.repeat(64), project: 'fcos' });
  for (const key of Object.keys(args.identity)) {
    assert.throws(() => validateMigrationParentProof(proof, { ...args, identity: { ...args.identity, [key]: 'changed' } }), /does not match/);
  }
  for (const patch of [{ projectId: 'other' }, { controllerSha: 'c'.repeat(40) }, { candidateSha: 'c'.repeat(40) },
    { roles: ['postgres'] }, { roles: [...MIGRATION_STANDARD_ROLES, 'service_role'] }, { databaseUrl: 'postgresql://postgres@127.0.0.1:6543/postgres' }]) {
    assert.throws(() => validateMigrationParentProof(proof, { ...args, ...patch }), /does not match/);
  }
  for (const mutate of [p => delete p.source, p => p.extra = true, p => p.container.id = 'invalid', p => p.roles.reverse(),
    p => p.identity.systemIdentifier = '0', p => p.url.hostname = 'localhost', p => p.source.candidateSha = '0'.repeat(40)]) {
    const changed = structuredClone(proof); mutate(changed);
    assert.throws(() => validateMigrationParentProof(changed, args), /does not match/);
  }
  assert.match(MIGRATION_SERVER_IDENTITY_SQL, /pg_control_system\(\)/);
  assert.match(MIGRATION_SERVER_IDENTITY_SQL, /pg_postmaster_start_time\(\)/);
});

test('fixed parent proof loader refuses arbitrary paths and writable or obscured controller mounts', () => {
  for (const path of ['/tmp/proof.json', `${MIGRATION_PARENT_PROOF_PATH}/../proof.json`, undefined]) {
    assert.throws(() => loadMigrationParentProof({ env: { FCOS_MIGRATION_PARENT_PROOF_FILE: path, FCOS_MIGRATION_PARENT_PROOF_SHA256: 'a'.repeat(64) } }), /fixed hash-bound/);
  }
  assert.throws(() => loadMigrationParentProof({ env: { FCOS_MIGRATION_PARENT_PROOF_FILE: MIGRATION_PARENT_PROOF_PATH } }), /fixed hash-bound/);
  const ro = '10 1 0:1 / /controller ro,relatime - ext4 /dev/fixture rw\n';
  assert.equal(isReadOnlyMigrationProofMount(ro), true);
  assert.equal(isReadOnlyMigrationProofMount(ro.replace(' ro,', ' rw,')), false);
  assert.equal(isReadOnlyMigrationProofMount(ro + '11 10 0:2 / /controller/output rw,relatime - ext4 /dev/fixture rw\n'), false);
  assert.equal(isReadOnlyMigrationProofMount('1 0 0:1 / / ro - ext4 /dev/fixture ro\n'), false);
  assert.equal(isReadOnlyMigrationProofMount(ro + `11 10 0:2 / ${MIGRATION_PARENT_PROOF_PATH} ro,relatime - ext4 /dev/fixture rw\n`), true);
});

test('an explicit project pin must agree with an existing local Supabase configuration', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fcos-migration-project-'));
  try {
    mkdirSync(join(cwd, 'supabase'));
    writeFileSync(join(cwd, 'supabase/config.toml'), 'project_id = "fcos"\n');
    const { args } = dockerFixture();
    assert.equal(verifyLocalMigrationServer({ ...args, cwd }).project, 'fcos');
    assert.throws(() => verifyLocalMigrationServer({ ...args, cwd, env: { ...args.env, FCOS_MIGRATION_PROJECT_ID: 'other' } }), /does not match/);
    writeFileSync(join(cwd, 'supabase/config.toml'), 'project_id = "../fcos"\n');
    assert.throws(() => verifyLocalMigrationServer({ ...args, cwd }), /project_id is missing or invalid/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
