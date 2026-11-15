import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { fcunoContractDirectory } from '../scripts/lib/rapid-release/fcuno-contract-input.mjs';

const controllerDirectory = fileURLToPath(new URL('..', import.meta.url));
const config = join('config', 'fcosConnections.js');
const verifier = join('scripts', 'verify-fcuno-federation-contract.mjs');
const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;

test('snapshot requires the same literal FCUNO provider pin despite unrelated candidate configuration differences', async t => {
  const candidateDirectory = await mkdtemp(join(tmpdir(), 'rapid-fcuno-candidate-'));
  t.after(() => rm(candidateDirectory, { recursive: true, force: true }));
  await mkdir(join(candidateDirectory, 'config'));
  const source = await readFile(join(controllerDirectory, config), 'utf8');
  const writeCandidate = contents => writeFile(join(candidateDirectory, config), contents);
  const locate = () => fcunoContractDirectory({ controllerDirectory, candidateDirectory });

  const modified = source.replace("profile: 'fcos-production'", "profile: 'unrelated-profile'");
  assert.notEqual(modified, source);
  await writeCandidate(modified);
  assert.match(locate(), new RegExp(`${pin.providerCommit}$`));
  for (const [field, replacement] of [
    ['providerRepository', 'other/repo'],
    ['providerCommit', 'a'.repeat(40)],
    ['contractPath', 'contracts/other/v1'],
    ['protocolVersion', '2.0'],
    ['contractSha256', 'a'.repeat(64)],
  ]) {
    await writeCandidate(source.replace(`${field}: '${pin[field]}'`, `${field}: '${replacement}'`));
    assert.throws(locate, { code: 'QUALITY_FCUNO_CONTRACT_PIN_CHANGED' }, field);
  }
  await writeCandidate(source.replace('fcunoIdentityFederation: {', 'fcunoIdentityFederation: { ...anotherPin,'));
  assert.throws(locate, { code: 'QUALITY_FCUNO_CONTRACT_PIN_CHANGED' });
});

test('the unchanged verifier checks the local bytes offline and rejects corrupted or unavailable snapshots', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'rapid-fcuno-snapshot-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const snapshot = fcunoContractDirectory({ controllerDirectory, candidateDirectory: controllerDirectory });
  const copy = join(scratch, 'scripts', 'lib', 'rapid-release', 'fcuno-contract', pin.providerCommit);
  await cp(snapshot, copy, { recursive: true });
  const offline = new URL('data:text/javascript,globalThis.fetch=()=>%7Bthrow%20new%20Error(%22Unexpected%20network%20read%22)%7D');
  const locate = () => fcunoContractDirectory({ controllerDirectory: scratch, candidateDirectory: controllerDirectory });
  const verify = () => spawnSync(process.execPath, ['--import', offline.href, verifier], {
    cwd: controllerDirectory,
    env: { FCOS_FCUNO_CONTRACT_DIRECTORY: locate(), CI: '1' },
    encoding: 'utf8',
  });
  const intact = verify();
  assert.equal(intact.status, 0, intact.stderr);
  assert.equal(intact.stdout.trim(), `FCOS verified FCUNO contract ${pin.protocolVersion} at ${pin.providerCommit}: ${pin.contractSha256}`);

  const schema = join(copy, 'oidc-claims.schema.json');
  await writeFile(schema, '{}\n');
  const corrupted = verify();
  assert.equal(corrupted.status, 1);
  assert.match(corrupted.stderr, /Pinned FCUNO contract schema digest mismatch: oidc-claims\.schema\.json/);
  await rm(schema);
  assert.throws(locate, { code: 'QUALITY_FCUNO_CONTRACT_SNAPSHOT_REQUIRED' });
  await symlink(join(snapshot, 'oidc-claims.schema.json'), schema);
  assert.throws(locate, { code: 'QUALITY_FCUNO_CONTRACT_SNAPSHOT_REQUIRED' });
});
