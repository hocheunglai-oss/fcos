// Private originals never enter public CI. A successful public test run is not
// evidence for these cases; Production material must retain this separate proof.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCredentialPath } from './lib/build-provenance.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const seedSha256 = 'bb1347c0917102e5ea1917446d6b5970865403c6f2d63931d7451246e90dfb82';
const sourceCommit = process.env.FCOS_ORIGINAL54_EXPECTED_COMMIT;
const seedPath = process.env.FCOS_EXISTING_DRAFT_APPROVED_SEED;
const fail = code => { throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (!seedPath || !path.isAbsolute(seedPath)) fail('ORIGINAL54_EXACT_PRIVATE_SEED_REQUIRED');
if (!lstatSync(seedPath).isFile() || lstatSync(seedPath).isSymbolicLink()) fail('ORIGINAL54_PRIVATE_SEED_REGULAR_FILE_REQUIRED');
if (hash(readFileSync(seedPath)) !== seedSha256) fail('ORIGINAL54_PRIVATE_SEED_HASH_MISMATCH');
if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) fail('ORIGINAL54_EXACT_CANDIDATE_COMMIT_REQUIRED');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const tree = git(['rev-parse', `${sourceCommit}^{tree}`]).trim();
const sourceFiles = [];
for (const row of git(['ls-tree', '-r', '-z', sourceCommit]).split('\0').filter(Boolean)) {
  const separator = row.indexOf('\t');
  const [mode, type, blob] = row.slice(0, separator).split(' ');
  const name = row.slice(separator + 1);
  if (type !== 'blob' || isCredentialPath(name)) fail('ORIGINAL54_UNSUPPORTED_CANDIDATE_PATH');
  const absolute = path.resolve(root, name);
  if (!absolute.startsWith(`${root}${path.sep}`)) fail('ORIGINAL54_CANDIDATE_PATH_ESCAPE');
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('ORIGINAL54_CANDIDATE_REGULAR_SOURCE_REQUIRED');
  const bytes = readFileSync(absolute);
  const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (actualBlob !== blob || mode !== (stat.mode & 0o111 ? '100755' : '100644')) fail('ORIGINAL54_CANDIDATE_SOURCE_MISMATCH');
  sourceFiles.push({ path: name, mode, blob, sha256: hash(bytes) });
}
const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
const postgresVersion = execFileSync(path.join(bin, 'postgres'), ['--version'], { encoding: 'utf8' }).trim();
if (!/^postgres \(PostgreSQL\) 17\.11(?:\s|$)/.test(postgresVersion)) fail('ORIGINAL54_POSTGRES_17_11_REQUIRED');
const output = process.env.FCOS_ORIGINAL54_OUTPUT_DIR
  ? path.resolve(process.env.FCOS_ORIGINAL54_OUTPUT_DIR)
  : path.join(root, '.fcos-cli', 'outputs', `original54-private-${randomUUID()}`);
mkdirSync(output, { recursive: true, mode: 0o700 });
const command = ['--test', '--test-reporter=tap',
  'tests/xeroExistingDraftAuthorisationDatabase.private54.test.mjs',
  'tests/xeroExistingDraftQuotaDatabase.private54.test.mjs'];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const stdout = result.stdout || '', stderr = result.stderr || '';
writeFileSync(path.join(output, 'private-tests.actual.tap'), stdout, { flag: 'wx', mode: 0o600 });
writeFileSync(path.join(output, 'private-tests.actual.stderr'), stderr, { flag: 'wx', mode: 0o600 });
const count = key => Number([...stdout.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].at(-1)?.[1] ?? -1);
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(key => [key, count(key)]));
const sourceUnchanged = sourceFiles.every(row => {
  const target = path.resolve(root, row.path), stat = lstatSync(target);
  return stat.isFile() && !stat.isSymbolicLink() && hash(readFileSync(target)) === row.sha256
    && row.mode === (stat.mode & 0o111 ? '100755' : '100644');
});
const passed = sourceUnchanged && result.status === 0 && counts.tests > 0 && counts.pass === counts.tests
  && counts.fail === 0 && counts.skipped === 0 && counts.cancelled === 0;
const proof = {
  kind: 'actual_private_original54_source_material_test_proof_v1', accepted: passed,
  sourceCommit, tree, sourceFiles, sourceUnchanged, seedSha256, originalRecords: 54,
  startedAt, completedAt: new Date().toISOString(), command: [process.execPath, ...command],
  runtime: process.version, platform: process.platform, architecture: process.arch,
  postgresVersion, packageLockSha256: hash(readFileSync(path.join(root, 'package-lock.json'))),
  exitCode: result.status, counts, topLevelTests: [...stdout.matchAll(/^# Subtest: (.+)$/gm)].map(m => m[1]), stdoutSha256: hash(stdout), stderrSha256: hash(stderr),
  hostedCheck: false, providerCalls: 0, financialActions: 0, privateSeedExported: false,
  optionalSealedPolicyCapsuleExecuted: Boolean(process.env.FCOS_EXISTING_DRAFT_POLICY_MODULE && process.env.FCOS_DRAFT_AUTHORISATION_TEST_FIXTURE),
};
writeFileSync(path.join(output, 'proof.actual.json'), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ kind: proof.kind, accepted: passed, sourceCommit, counts, exitCode: result.status,
  runtime: proof.runtime, postgresVersion, hostedCheck: false, providerCalls: 0, financialActions: 0 }));
process.exitCode = passed ? 0 : 1;
