import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MIGRATION_SERVER_IDENTITY_SQL, MIGRATION_STANDARD_ROLES, validateMigrationParentProof,
  verifyLocalMigrationServer } from './lib/migration-verification.mjs';
import { validateManifest } from './lib/hosted-release/contract.mjs';

export const DISPOSABLE_MIGRATION_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const hash = value => createHash('sha256').update(value).digest('hex');

// The trusted parent owns Docker access. The candidate receives public identity
// data through its existing read-only controller mount, never the Docker socket.
export async function captureMigrationFixture({ client, controllerDirectory, controllerSha, candidateSha,
  verifyServer = verifyLocalMigrationServer, environment = process.env }) {
  if (environment.FCOS_MIGRATION_PARENT_PROOF_FILE !== undefined
    || environment.FCOS_MIGRATION_PARENT_PROOF_SHA256 !== undefined) throw new Error('The parent requires direct local Docker inspection.');
  const before = (await client.query(MIGRATION_SERVER_IDENTITY_SQL)).rows[0];
  const transport = verifyServer({ address: before.address, databaseUrl: DISPOSABLE_MIGRATION_URL,
    cwd: join(controllerDirectory, 'output/disposable-migration-project'), env: { ...environment, FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1',
      FCOS_MIGRATION_DOCKER_CONTAINER: 'supabase_db_fcos', FCOS_MIGRATION_PROJECT_ID: 'fcos' } });
  if (transport.transport !== 'local-docker' || transport.project !== 'fcos'
    || transport.container !== 'supabase_db_fcos' || !/^[a-f0-9]{64}$/.test(transport.containerId || '')) {
    throw new Error('Trusted disposable Docker identity is required.');
  }
  const roles = (await client.query('select rolname from pg_roles where rolname=any($1::text[]) order by rolname',
    [MIGRATION_STANDARD_ROLES])).rows.map(row => row.rolname);
  const identity = (await client.query(MIGRATION_SERVER_IDENTITY_SQL)).rows[0];
  if (!isDeepStrictEqual(identity, before)) throw new Error('Disposable server identity changed during inspection.');
  const proof = { kind: 'fcos_disposable_migration_parent_proof_v1', schemaVersion: 1, projectId: 'fcos',
    container: { name: 'supabase_db_fcos', id: transport.containerId },
    url: { hostname: '127.0.0.1', port: 54322, username: 'postgres', database: 'postgres' },
    identity, roles, source: { controllerSha, candidateSha } };
  validateMigrationParentProof(proof, { identity, roles, databaseUrl: DISPOSABLE_MIGRATION_URL,
    projectId: 'fcos', controllerSha, candidateSha });
  return proof;
}

async function main() {
  if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.GITHUB_REPOSITORY !== 'hocheunglai-oss/fcos') throw new Error('Trusted workflow context required.');
  const manifest = JSON.parse(process.env.FCOS_RELEASE_MANIFEST || 'null');
  validateManifest(manifest);
  const controllerDirectory = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
  const candidateDirectory = realpathSync(resolve(process.env.FCOS_CANDIDATE_DIRECTORY || 'candidate'));
  const head = cwd => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (head(controllerDirectory) !== manifest.controller.sha || head(candidateDirectory) !== manifest.candidate.sha
    || process.env.FCOS_CONTROLLER_SHA !== manifest.controller.sha) throw new Error('Fixture source binding changed.');
  const output = join(controllerDirectory, 'output/disposable-migration-server.json');
  if (existsSync(output)) throw new Error('Existing fixture proof cannot be replaced.');
  const githubEnvironment = process.env.GITHUB_ENV;
  if (!githubEnvironment || !isAbsolute(githubEnvironment) || realpathSync(githubEnvironment) !== githubEnvironment
    || !lstatSync(githubEnvironment).isFile() || lstatSync(githubEnvironment).isSymbolicLink()) {
    throw new Error('Actual workflow environment file required.');
  }
  const client = new pg.Client({ connectionString: DISPOSABLE_MIGRATION_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  await client.connect();
  let proof;
  try { proof = await captureMigrationFixture({ client, controllerDirectory,
    controllerSha: manifest.controller.sha, candidateSha: manifest.candidate.sha }); }
  finally { await client.end(); }
  mkdirSync(dirname(output), { recursive: true });
  // This allowlisted proof is public. Read-only access must not depend on the
  // host runner and isolated candidate having the same UID.
  writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o444 });
  chmodSync(output, 0o444);
  const sha256 = hash(readFileSync(output));
  appendFileSync(githubEnvironment, `FCOS_HOSTED_MIGRATION_PARENT_PROOF_SHA256=${sha256}\n`);
  console.log(JSON.stringify({ kind: proof.kind, fixtureProofSha256: sha256, source: proof.source }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Trusted disposable migration fixture inspection refused.'); process.exitCode = 1; });
}
