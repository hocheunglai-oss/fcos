import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectBuildProvenance, deploymentSourceFilter } from '../scripts/lib/build-provenance.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'fcos-provenance-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  writeFileSync(join(cwd, 'source.js'), 'export const answer = 42;\n');
  writeFileSync(join(cwd, '.gitignore'), '.env*\n');
  mkdirSync(join(cwd, 'public'));
  writeFileSync(join(cwd, 'public/app-version.json'), '{}\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  return { cwd, git, collect: options => collectBuildProvenance({ cwd, env: {}, ...options }) };
}

test('clean release receipt binds source content and validates supplied commit identity', t => {
  const f = fixture(t); const head = f.git('rev-parse', 'HEAD');
  const receipt = f.collect({ requireClean: true, env: { VERCEL_GIT_COMMIT_SHA: head } });
  assert.equal(receipt.commit, head); assert.equal(receipt.commitVerified, true);
  assert.equal(receipt.gitDirty, false); assert.equal(receipt.releaseEligible, true);
  assert.match(receipt.sourceDigest, /^[0-9a-f]{64}$/);
  assert.throws(() => f.collect({ env: { VERCEL_GIT_COMMIT_SHA: 'f'.repeat(40) } }), /does not match/);
  assert.throws(() => f.collect({ env: { VERCEL_GIT_COMMIT_SHA: head.slice(0, 8) } }), /full 40/);
});

test('dirty validation builds record actual content, while release and Vercel builds fail closed', t => {
  const f = fixture(t); const before = f.collect();
  writeFileSync(join(f.cwd, 'source.js'), 'export const answer = 43;\n');
  const after = f.collect();
  assert.equal(after.gitDirty, true); assert.equal(after.releaseEligible, false);
  assert.equal(after.commit, before.commit); assert.notEqual(after.sourceDigest, before.sourceDigest);
  assert.throws(() => f.collect({ requireClean: true }), /clean Git checkout/);
  assert.throws(() => f.collect({ env: { VERCEL: '1' } }), /clean Git checkout/);
  f.git('checkout', '--', 'source.js');
  writeFileSync(join(f.cwd, 'new-source.js'), 'untracked source');
  assert.equal(f.collect().gitDirty, true);
  assert.notEqual(f.collect().sourceDigest, before.sourceDigest);
});

test('generated receipts are non-circular and credential files are never hashed or serialized', t => {
  const f = fixture(t); const before = f.collect();
  writeFileSync(join(f.cwd, 'public/app-version.json'), JSON.stringify(before));
  writeFileSync(join(f.cwd, '.env.local'), 'SECRET=do-not-read-this\n');
  assert.deepEqual(f.collect(), before);
  f.git('add', '-f', '.env.local');
  const trackedSecret = f.collect();
  assert.equal(trackedSecret.sourceDigest, before.sourceDigest);
  assert.equal(trackedSecret.gitDirty, true);
  assert.doesNotMatch(JSON.stringify(trackedSecret), /do-not-read-this|\.env/);
});

test('deleted, staged, renamed files and executable mode affect provenance', t => {
  const f = fixture(t); const before = f.collect();
  f.git('mv', 'source.js', 'renamed.js');
  assert.equal(f.collect().gitDirty, true);
  assert.notEqual(f.collect().sourceDigest, before.sourceDigest);
  rmSync(join(f.cwd, 'renamed.js'));
  assert.equal(f.collect().sourceFileCount, before.sourceFileCount - 1);
});

test('source archives report unknown Git state and cannot produce release receipts', t => {
  const f = fixture(t); rmSync(join(f.cwd, '.git'), { recursive: true });
  const receipt = f.collect({ env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) } });
  assert.equal(receipt.commitVerified, false); assert.equal(receipt.gitDirty, null);
  assert.equal(receipt.releaseEligible, false);
  assert.throws(() => f.collect({ requireClean: true }), /clean Git checkout/);
  assert.throws(() => f.collect({ env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), FCOS_BUILD_COMMIT_SHA: 'b'.repeat(40) } }), /disagree/);
});

test('trusted archive attestation requires exact digest and full supplied SHA', t => {
  const f = fixture(t); const clean = f.collect(); rmSync(join(f.cwd, '.git'), { recursive: true });
  const env = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: clean.commit, FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest };
  const receipt = f.collect({ env });
  assert.equal(receipt.sourceAttested, true); assert.equal(receipt.releaseEligible, true);
  assert.equal(receipt.gitDirty, null); assert.equal(receipt.commitVerified, false);
  writeFileSync(join(f.cwd, 'source.js'), 'tampered');
  assert.throws(() => f.collect({ env }), /source digest does not match/);
});

test('source symlinks fail closed instead of reading a possible credential target', t => {
  const f = fixture(t);
  symlinkSync('/never/read/credentials', join(f.cwd, 'unsafe.js'));
  assert.throws(() => f.collect(), /symlinks/);
});

test('release gate compares actual source bytes even when Git status hides a change', t => {
  const f = fixture(t);
  f.git('update-index', '--assume-unchanged', 'source.js');
  writeFileSync(join(f.cwd, 'source.js'), 'hidden changed source');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.collect().gitDirty, true);
  assert.throws(() => f.collect({ requireClean: true }), /source content differs from HEAD/);
});

test('Vercel archive and clean Git source share a digest after default and custom upload exclusions', t => {
  const f = fixture(t);
  for (const directory of ['api', 'src', 'tests', 'force-app', '.github']) mkdirSync(join(f.cwd, directory));
  for (const file of ['api/runtime.js', 'src/main.js', 'tests/fixture.js', 'force-app/source.xml', '.github/check.yml', 'private.docx', '.dockerignore']) {
    writeFileSync(join(f.cwd, file), `fixture for ${file}`);
  }
  writeFileSync(join(f.cwd, '.vercelignore'), 'tests/\nforce-app/\n.github/\n*.docx\n');
  f.git('add', '.'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'upload rules');
  const clean = f.collect({ requireClean: true });
  const archive = mkdtempSync(join(tmpdir(), 'fcos-source-archive-'));
  t.after(() => rmSync(archive, { recursive: true, force: true }));
  const included = deploymentSourceFilter(f.cwd);
  cpSync(f.cwd, archive, { recursive: true, filter: source => source === f.cwd || included(source.slice(f.cwd.length + 1)) });
  const archiveReceipt = collectBuildProvenance({ cwd: archive, env: {
    VERCEL: '1', FCOS_BUILD_COMMIT_SHA: clean.commit, FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest,
  } });
  assert.equal(archiveReceipt.sourceDigest, clean.sourceDigest);
  assert.equal(archiveReceipt.sourceFileCount, clean.sourceFileCount);
  assert.equal(archiveReceipt.releaseEligible, true);
  writeFileSync(join(archive, 'api/runtime.js'), 'tampered deployed input');
  assert.throws(() => collectBuildProvenance({ cwd: archive, env: { VERCEL: '1', FCOS_BUILD_COMMIT_SHA: clean.commit, FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest } }), /source digest does not match/);
  f.git('update-index', '--assume-unchanged', 'tests/fixture.js');
  writeFileSync(join(f.cwd, 'tests/fixture.js'), 'hidden excluded-file change');
  assert.throws(() => f.collect({ requireClean: true }), /source content differs from HEAD/);
});

test('upload negation rules retain included files and Git-ignored deployable input cannot escape provenance', t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, '.vercelignore'), '*.txt\n!keep.txt\n');
  writeFileSync(join(f.cwd, 'drop.txt'), 'excluded'); writeFileSync(join(f.cwd, 'keep.txt'), 'included');
  f.git('add', '.'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'negated upload rule');
  assert.equal(deploymentSourceFilter(f.cwd)('drop.txt'), false);
  assert.equal(deploymentSourceFilter(f.cwd)('keep.txt'), true);
  const clean = f.collect();
  writeFileSync(join(f.cwd, '.gitignore'), '.env*\nhidden-source.js\n');
  f.git('add', '.gitignore'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'local ignored source');
  writeFileSync(join(f.cwd, 'hidden-source.js'), 'included by Vercel despite Git ignore');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.notEqual(f.collect().sourceDigest, clean.sourceDigest);
  assert.throws(() => f.collect({ requireClean: true }), /source content differs from HEAD/);
});

test('attested Vercel hybrid checkout permits only missing upload-excluded tracked files', t => {
  const f = fixture(t); const clean = f.collect();
  const env = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: clean.commit, FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest };
  rmSync(join(f.cwd, '.gitignore'));
  const receipt = f.collect({ env });
  assert.equal(receipt.gitDirty, true); assert.equal(receipt.sanitizedCheckout, true);
  assert.equal(receipt.sourceAttested, true); assert.equal(receipt.releaseEligible, true);
  assert.equal(receipt.sourceDigest, clean.sourceDigest);
  assert.throws(() => f.collect({ requireClean: true }), /clean Git checkout/);
  assert.throws(() => f.collect({ env: { ...env, VERCEL: '0' }, requireClean: true }), /clean Git checkout/);
  assert.throws(() => f.collect({ env: { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: clean.commit } }), /clean Git checkout/);
  assert.throws(() => f.collect({ env: { VERCEL: '1', FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest } }), /clean Git checkout/);
  assert.throws(() => f.collect({ env: { ...env, FCOS_EXPECTED_SOURCE_SHA256: '0'.repeat(64) } }), /source digest does not match/);
  f.git('add', '-u');
  assert.throws(() => f.collect({ env }), /clean Git checkout/);
});

test('attested hybrid checkouts reject changed excluded files and any uploaded extra file', t => {
  const f = fixture(t); const clean = f.collect();
  const env = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: clean.commit, FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest };
  f.git('update-index', '--assume-unchanged', '.gitignore');
  writeFileSync(join(f.cwd, '.gitignore'), 'changed excluded input');
  assert.throws(() => f.collect({ env }), /source content differs from HEAD/);
  f.git('update-index', '--no-assume-unchanged', '.gitignore');
  rmSync(join(f.cwd, '.gitignore'));
  writeFileSync(join(f.cwd, 'extra.js'), 'unexpected uploaded source');
  assert.throws(() => f.collect({ env }), /source digest does not match/);
  // Even a supplied digest of the dirty content cannot bless an uploaded extra file.
  const dirty = f.collect();
  assert.throws(() => f.collect({ env: { ...env, FCOS_EXPECTED_SOURCE_SHA256: dirty.sourceDigest } }), /clean Git checkout/);
});

test('dirty failure diagnostics contain paths only and redact credential paths', t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'source.js'), 'source-content-must-not-be-logged');
  writeFileSync(join(f.cwd, '.env.local'), 'SECRET=credential-content-must-not-be-logged');
  f.git('add', '-f', '.env.local');
  assert.throws(() => f.collect({ requireClean: true }), error => {
    assert.match(error.message, /source\.js/);
    assert.doesNotMatch(error.message, /\.env|source-content|credential-content|SECRET=/);
    return true;
  });
});

test('attested sanitized builds permit only the two known untracked build-state directories', t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, '.gitignore'), '.env*\nnode_modules/\n.vercel/\n');
  writeFileSync(join(f.cwd, '.vercelignore'), 'tmp/\nreports/\n');
  f.git('add', '.'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'build-state rules');
  const clean = f.collect();
  const env = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: clean.commit, FCOS_EXPECTED_SOURCE_SHA256: clean.sourceDigest };
  rmSync(join(f.cwd, '.gitignore'));
  mkdirSync(join(f.cwd, 'node_modules')); writeFileSync(join(f.cwd, 'node_modules/dependency.js'), 'installed dependency');
  mkdirSync(join(f.cwd, '.vercel')); writeFileSync(join(f.cwd, '.vercel/project.json'), '{"fixture":true}');
  assert.equal(f.collect({ env }).sanitizedCheckout, true);
  assert.throws(() => f.collect({ requireClean: true }), /clean Git checkout/);
  for (const directory of ['tmp', 'reports']) {
    mkdirSync(join(f.cwd, directory)); writeFileSync(join(f.cwd, directory, 'unexpected.txt'), 'excluded but unapproved state');
    assert.throws(() => f.collect({ env }), error => {
      assert.match(error.message, /clean Git checkout/); assert.doesNotMatch(error.message, /\.vercel/); return true;
    });
    rmSync(join(f.cwd, directory), { recursive: true });
  }
  mkdirSync(join(f.cwd, 'api')); writeFileSync(join(f.cwd, 'api/unexpected.js'), 'uploaded extra API');
  assert.throws(() => f.collect({ env }), /source digest does not match/);
  rmSync(join(f.cwd, 'api'), { recursive: true });
  writeFileSync(join(f.cwd, 'source.js'), 'tampered application source');
  assert.throws(() => f.collect({ env }), /source digest does not match/);
});
