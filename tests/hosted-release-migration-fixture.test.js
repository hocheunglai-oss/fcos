import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMigrationFixture, DISPOSABLE_MIGRATION_URL } from '../scripts/hosted-release-migration-fixture.mjs';
import { MIGRATION_SERVER_IDENTITY_SQL, MIGRATION_STANDARD_ROLES } from '../scripts/lib/migration-verification.mjs';

const controllerSha = 'a'.repeat(40), candidateSha = 'b'.repeat(40);
const identity = () => ({ address: '172.18.0.2', database: 'postgres', dataDirectory: '/var/lib/postgresql/data',
  serverStartedAt: '2026-10-23T21:00:00.123456Z', systemIdentifier: '1234567890123456789',
  currentUser: 'postgres', sessionUser: 'postgres', roleSetting: 'none' });
function fixture({ before = identity(), after = structuredClone(before), roles = [...MIGRATION_STANDARD_ROLES],
  transport = { transport: 'local-docker', project: 'fcos', container: 'supabase_db_fcos', containerId: '1'.repeat(64) },
  source = {} } = {}) {
  const calls = []; let reads = 0;
  return { calls, input: { controllerDirectory: '/SYNTHETIC/controller', controllerSha, candidateSha, ...source,
    environment: { GITHUB_TOKEN: 'SYNTHETIC_PRIVATE', DOCKER_HOST: 'unix:///SYNTHETIC.sock' },
    client: { query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql === MIGRATION_SERVER_IDENTITY_SQL) return { rows: [structuredClone(++reads === 1 ? before : after)] };
      assert.match(sql, /^select rolname from pg_roles/); assert.deepEqual(values, [MIGRATION_STANDARD_ROLES]);
      return { rows: roles.map(rolname => ({ rolname })) };
    } }, verifyServer: options => { calls.push({ options }); return transport; } } };
}

test('trusted parent captures a stable actual server and emits only public source-bound identity', async () => {
  const f = fixture(), proof = await captureMigrationFixture(f.input);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(proof.identity, identity()); assert.deepEqual(proof.roles, MIGRATION_STANDARD_ROLES);
  assert.deepEqual(proof.source, { controllerSha, candidateSha });
  assert.equal(f.calls[1].options.databaseUrl, DISPOSABLE_MIGRATION_URL);
  assert.equal(f.calls[1].options.cwd, '/SYNTHETIC/controller/output/disposable-migration-project');
  assert.equal(f.calls[1].options.env.FCOS_MIGRATION_PROJECT_ID, 'fcos');
  assert.equal(f.calls[1].options.env.FCOS_MIGRATION_DOCKER_CONTAINER, 'supabase_db_fcos');
  assert.doesNotMatch(JSON.stringify(proof), /SYNTHETIC_PRIVATE|\.sock|password/);
});

for (const field of Object.keys(identity())) test(`parent refuses server drift in ${field}`, async () => {
  const before = identity(), after = { ...before, [field]: 'different' };
  await assert.rejects(captureMigrationFixture(fixture({ before, after }).input), /identity changed/);
});

for (const [name, patch] of [
  ['missing standard roles', { roles: ['postgres'] }],
  ['duplicate standard roles', { roles: [...MIGRATION_STANDARD_ROLES, 'postgres'] }],
  ['wrong project', { transport: { transport: 'local-docker', project: 'other', container: 'supabase_db_fcos', containerId: '1'.repeat(64) } }],
  ['remote transport', { transport: { transport: 'remote' } }],
  ['missing container identity', { transport: { transport: 'local-docker', project: 'fcos', container: 'supabase_db_fcos' } }],
  ['wrong source', { source: { controllerSha: 'not-a-commit' } }],
]) test(`parent refuses ${name}`, async () => assert.rejects(captureMigrationFixture(fixture(patch).input)));

for (const [field, value] of [['database', 'other'], ['currentUser', 'other'], ['sessionUser', 'other'],
  ['roleSetting', 'other'], ['systemIdentifier', 'not-an-identifier']]) test(`parent refuses stable unauthorized ${field}`, async () => {
  await assert.rejects(captureMigrationFixture(fixture({ before: { ...identity(), [field]: value } }).input));
});

test('an identity permission refusal stops before Docker and subsequent SQL', async () => {
  let reads = 0, inspections = 0;
  await assert.rejects(captureMigrationFixture({ controllerDirectory: '/SYNTHETIC/controller', controllerSha, candidateSha,
    client: { query: async () => { reads++; throw new Error('SYNTHETIC_PERMISSION_DENIED'); } },
    verifyServer: () => { inspections++; } }), /SYNTHETIC_PERMISSION_DENIED/);
  assert.equal(reads, 1); assert.equal(inspections, 0);
});

for (const key of ['FCOS_MIGRATION_PARENT_PROOF_FILE', 'FCOS_MIGRATION_PARENT_PROOF_SHA256']) {
  test(`parent refuses inherited child proof ${key} before any inspection`, async () => {
    const f = fixture(); f.input.environment[key] = 'untrusted';
    await assert.rejects(captureMigrationFixture(f.input), /direct local Docker inspection/);
    assert.deepEqual(f.calls, []);
  });
}
