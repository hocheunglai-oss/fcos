import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

import { SOURCE_ROOT, FIXTURE_ROOT, hash, manifestBytes, manifest, pack,
  validatePublicManifest, assertBoundSource, copyBoundSource, cleanGitEnvironment } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';

const temporary = fs.mkdtempSync(join(tmpdir(), 'fcos-v2-negative-'));
const root = join(temporary, 'public-checkout'), store = join(temporary, 'objects');
const exact = '04ee3425aac7a49089eda781eb3c976aea1f6785', old = 'ff8859b287009e20462c5c0cceff89ae12f13010', base = 'f3472492ff4d0b0c70248a3c8e5c0012981a94b3';
const origin = 'https://fcos-cksvmk1wf-hocheunglai-6535s-projects.vercel.app';
const cleanEnv = cleanGitEnvironment();
const nativeGit = (directory, args, input) => execFileSync('git', ['--no-replace-objects', '--git-dir', directory, ...args], { env: cleanEnv, input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
const rawGit = (args, input) => nativeGit(store, args, input);
const init = directory => execFileSync('git', ['-c', 'init.templateDir=', 'init', '--bare', '--quiet', directory], { env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] });
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
for (const row of manifest.members.filter(row => row.path.startsWith('checkout/'))) copyBoundSource(root, row.path.slice('checkout/'.length));
init(store); rawGit(['index-pack', '--stdin'], pack);
assert.equal(rawGit(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).toString().trim().split('\n').length, 272);
for (const row of manifest.objects) {
  const bytes = rawGit(['cat-file', row.type, row.oid]);
  assert.equal(bytes.length, row.byteLength); assert.equal(hash(bytes), row.sha256);
}
fs.mkdirSync(join(root, 'candidate'), { recursive: true });
fs.writeFileSync(join(root, 'candidate/package-lock.json'), rawGit(['show', `${exact}:package-lock.json`]));
const currentFiles = ['scripts/lib/runtime-compatibility-release.mjs', 'scripts/lib/preview-email-build.mjs', 'scripts/lib/preview-email-signer.mjs', 'scripts/lib/release-readiness.mjs', 'config/fcosConnections.js', 'config/legacy-email-baseline-proof.json'];
for (const file of currentFiles) {
  const target = join(root, 'current', file); fs.mkdirSync(dirname(target), { recursive: true }); copyBoundSource(root, file, `current/${file}`);
}
const policy = JSON.parse(fs.readFileSync(join(SOURCE_ROOT, 'config/preview-parity-policy.json')));
fs.mkdirSync(join(root, 'scripts/nested'), { recursive: true });
const sourceRows = ref => rawGit(['ls-tree', '-rz', '--full-tree', ref]).toString().split('\0').filter(Boolean).map(line => {
  const separator = line.indexOf('\t'), [mode, type, sha] = line.slice(0, separator).split(' ');
  return { mode, type, sha, path: line.slice(separator + 1) };
});

// Execute exact actual integrated repository source plus four unchanged old consumers.
// Git root/origin and clean provenance are explicitly synthetic metadata.
// Source/object/evidence reads are real; every external authority is a tripwire.
async function modules({ objectOverride, localReadOverride, provenanceOverride, forgedEnv = {} } = {}) {
  const counts = { provider: 0, fetch: 0, browser: 0, credential: 0, write: 0, gitReads: 0, historicalSource: 0 };
  const trip = kind => () => { counts[kind]++; throw Error(`TRIPWIRE_${kind}`); };
  const allowed = { PATH: cleanEnv.PATH, FCOS_E2E_EXPECTED_COMMIT: exact, ...forgedEnv };
  const env = new Proxy(allowed, { get(target, key) {
    if (/TOKEN|SECRET|PASSWORD|STORAGE|APPROVED_EMAIL|ACCESS_KEY|ANON_KEY|SERVICE_ROLE/.test(String(key))) return trip('credential')();
    return target[key];
  } });
  const context = createContext({ Buffer, URL, console, structuredClone, setTimeout, clearTimeout, AbortSignal,
    fetch: trip('fetch'), process: { env, argv: ['node', 'portable-hermetic.test.mjs'], exitCode: 0 } });
  const cache = new Map();
  const real = new Set(['scripts/verify-runtime-compatibility-successor.mjs', 'scripts/lib/runtime-compatibility-successor.mjs', 'scripts/lib/runtime-compatibility.mjs',
    'scripts/lib/runtime-compatibility-observation.mjs', 'config/fcosConnections.js', 'scripts/runtime-compatibility-release.mjs',
    'scripts/runtime-compatibility-normal-role.mjs', 'scripts/preview-email-proof-build.mjs', ...currentFiles.filter(x => x.endsWith('.mjs') || x.endsWith('.js')).map(x => `current/${x}`)]);
  const synthetic = (id, values) => {
    if (!cache.has(id)) cache.set(id, new SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context, identifier: id }));
    return cache.get(id);
  };
  const child = { execFileSync(binary, args, options = {}) {
    assert.equal(binary, 'git', 'Only offline Git reads are allowed.'); counts.gitReads++;
    const clean = args.filter(x => x !== '--no-replace-objects'); let bytes;
    if (clean.join(' ') === 'rev-parse --show-toplevel') bytes = Buffer.from((options.cwd.startsWith(join(root, 'candidate')) ? join(root, 'candidate') : root) + '\n');
    else if (clean.join(' ') === 'remote get-url origin') bytes = Buffer.from('https://github.com/hocheunglai-oss/fcos.git\n');
    else {
      assert.ok(['cat-file', 'ls-tree', 'show'].includes(clean[0]), 'No fetch/config/write/shared-store command allowed.');
      if (clean[0] === 'ls-tree') assert.ok(clean.includes('--full-tree'), 'Canonical inventory must request full tree.');
      bytes = rawGit(clean); if (objectOverride) bytes = objectOverride(clean, bytes);
    }
    return options.encoding ? bytes.toString(options.encoding) : bytes;
  } };
  const stub = name => {
    if (name === 'collectBuildProvenance') return ({ cwd }) => provenanceOverride ? provenanceOverride(cwd) : cwd === root ? { commit: 'a'.repeat(40), releaseEligible: true } : { commit: exact, releaseEligible: true, sourceDigest: 'b4d9709f53e031e19920d1630c1730a2aa9f349fe8bb035de3c05b4627a8f52e' };
    if (name === 'verifyRuntimeCompatibility') return () => { counts.historicalSource++; throw Error('HISTORICAL_SOURCE_SENTINEL'); };
    if (name === 'createRuntimeCompatibilityPreflight') return () => ({ historicalDryRun: true });
    if (name === 'canonicalFcosE2eCandidateUrl') return value => { assert.equal(value, origin); return value; };
    if (name === 'FIRST_RUNTIME_ROLLOUT') return { candidateSha: old, previousSha: base };
    if (name === 'PREVIEW_PARITY_POLICY') return policy;
    if (name === 'RELEASE_MAX_AGE_MS') return 1800000;
    if (name === 'RELEASE_REPOSITORY') return 'hocheunglai-oss/fcos';
    if (name === 'chromium') return { launch: trip('browser') };
    if (/SUBSTAGES|FAILURES|BLOCKED_REASONS|REQUEST_CATEGORIES/.test(name)) return [];
    if (/^[A-Z_]+$/.test(name)) return name;
    return trip('provider');
  };
  async function load(relative) {
    const filename = join(root, relative), id = pathToFileURL(filename).href;
    if (cache.has(id)) return cache.get(id);
    const source = fs.readFileSync(filename, 'utf8');
    const mod = new SourceTextModule(source, { context, identifier: id, initializeImportMeta(meta) { meta.url = id; }, importModuleDynamically: trip('provider') }); cache.set(id, mod);
    await mod.link(async (specifier, referring) => {
      if (specifier === 'node:child_process') return synthetic('offline-child', child);
      if (specifier === 'node:fs') {
        const values = { ...fs }; const rawRead = fs.readFileSync;
        values.readFileSync = (...args) => { const bytes = rawRead(...args); return localReadOverride ? localReadOverride(args[0], bytes) : bytes; };
        for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'openSync', 'renameSync', 'unlinkSync', 'symlinkSync', 'chmodSync', 'copyFileSync', 'cpSync']) values[name] = trip('write');
        return synthetic('read-only-fs', values);
      }
      if (specifier.startsWith('node:')) return synthetic(specifier, { ...await import(specifier) });
      const dependency = specifier.startsWith('.') ? fileURLToPath(new URL(specifier, referring.identifier)).slice(root.length + 1) : specifier;
      if (real.has(dependency)) return load(dependency);
      const referringText = fs.readFileSync(fileURLToPath(referring.identifier), 'utf8'), names = [];
      for (const match of referringText.matchAll(/import\s+(?:\{([\s\S]*?)\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/g)) {
        if (match[3] !== specifier) continue;
        if (match[2]) names.push('default'); else for (const entry of match[1].split(',')) names.push(entry.trim().split(/\s+as\s+/)[0]);
      }
      return synthetic(`stub:${dependency}`, Object.fromEntries(names.filter(Boolean).map(name => [name, stub(name)])));
    }); return mod;
  }
  const api = async file => { const mod = await load(file); if (mod.status !== 'evaluated') await mod.evaluate(); return mod.namespace; };
  const zeroAuthority = () => { for (const kind of ['provider', 'fetch', 'browser', 'credential', 'write']) assert.equal(counts[kind], 0, `${kind} authority reached`); };
  return { api, counts, env, zeroAuthority };
}

test('H01 actual observation declaration bytes reject body replacement and duplicate boundary', async () => {
  const h = await modules(), obs = await h.api('scripts/lib/runtime-compatibility-observation.mjs');
  const source = fs.readFileSync(join(root, 'scripts/lib/runtime-compatibility-observation.mjs'), 'utf8');
  assert.throws(() => obs.assertObservationDeclarationBytes(source.replace("=== 'preview'", "=== 'production'")), /declaration changed/);
  assert.throws(() => obs.assertObservationDeclarationBytes(source + '// BEGIN IMMUTABLE PURE 0\n'), /boundary changed/); h.zeroAuthority();
});
test('H02 actual observation checker rejects local declaration mutation before Git source reads', async () => {
  const h = await modules({ localReadOverride: (path, bytes) => String(path).includes('runtime-compatibility-observation.mjs') ? String(bytes).replace("=== 'preview'", "=== 'production'") : bytes });
  const obs = await h.api('scripts/lib/runtime-compatibility-observation.mjs');
  assert.throws(() => obs.verifyCompatibilityObservationSources({ cwd: root, baseSha: base, candidateSha: old }), /declaration changed/);
  assert.equal(h.counts.gitReads, 1); h.zeroAuthority();
});
test('H03 actual adapter rejects displaced successor deployment helper/interpreter boundary', async () => {
  const h = await modules({ objectOverride: (args, bytes) => args[0] === 'show' && args[1] === `${exact}:api/_deploymentReadOnly.js` ? Buffer.from(bytes.toString().replace("\n/** Deployment permission is separate from a user's financial or module permissions. */", '\n// displaced declaration boundary')) : bytes });
  const adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  assert.throws(() => adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd: root, candidateCommit: exact }), /deployment source differs/); h.zeroAuthority();
});
test('H04 actual adapter rejects missing pinned public review path', async () => {
  const file = join(root, 'tests/fixtures/runtime-compatibility-successor/root-application-review.json'), saved = file + '.saved'; fs.renameSync(file, saved);
  try { const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs'); assert.throws(() => adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd: root, candidateCommit: exact }), /ENOENT/); h.zeroAuthority(); }
  finally { fs.renameSync(saved, file); }
});
test('H05 actual adapter rejects public review path with symlink ancestor', async () => {
  const directory = join(root, 'tests'), saved = join(root, 'retained-tests'); fs.renameSync(directory, saved); fs.symlinkSync(saved, directory);
  try { const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs'); assert.throws(() => adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd: root, candidateCommit: exact }), /regular paths/); h.zeroAuthority(); }
  finally { fs.unlinkSync(directory); fs.renameSync(saved, directory); }
});
test('H06 actual validator rejects untrusted malformed tree paths before any blob reader', async () => {
  const h = await modules(), validator = await h.api('scripts/lib/runtime-compatibility.mjs');
  const baseline = sourceRows(base), original = sourceRows(old); let reads = 0;
  for (const path of ['/api/forged.js', 'api/../forged.js', 'api//forged.js', 'api/forged\u0000.js', 'api/forged\n.js']) {
    const rows = original.map(row => ({ ...row })); rows[0].path = path;
    assert.throws(() => validator.runtimeCompatibilityScope({ baseCommit: base, candidateCommit: old, baseTree: baseline, candidateTree: rows, readBlob: () => { reads++; throw Error('unexpected blob read'); } }), /regular immutable Git files/);
  }
  assert.equal(reads, 0); h.zeroAuthority();
});
test('H07 actual validator rejects symlink/submodule tree modes and nonblob entries', async () => {
  const h = await modules(), validator = await h.api('scripts/lib/runtime-compatibility.mjs'); const baseline = sourceRows(base), original = sourceRows(old);
  for (const change of [{ mode: '120000' }, { mode: '160000', type: 'commit' }, { mode: '100644', type: 'tree' }]) {
    const rows = original.map(row => ({ ...row })); Object.assign(rows[0], change);
    assert.throws(() => validator.runtimeCompatibilityScope({ baseCommit: base, candidateCommit: old, baseTree: baseline, candidateTree: rows, readBlob: () => { throw Error('unexpected blob read'); } }), /regular immutable Git files/);
  } h.zeroAuthority();
});
test('H08 actual validator rejects executable mode change and duplicate tree path', async () => {
  const h = await modules(), validator = await h.api('scripts/lib/runtime-compatibility.mjs'); const baseline = sourceRows(base), original = sourceRows(old);
  const rows = original.map(row => ({ ...row })); rows.find(row => row.path === 'api/_hedgeDeskService.js').mode = '100755';
  assert.throws(() => validator.runtimeCompatibilityScope({ baseCommit: base, candidateCommit: old, baseTree: baseline, candidateTree: rows, readBlob: () => { throw Error('unexpected blob read'); } }), /change executable modes/);
  assert.throws(() => validator.runtimeCompatibilityScope({ baseCommit: base, candidateCommit: old, baseTree: baseline, candidateTree: [...original, original[0]], readBlob: () => { throw Error('unexpected blob read'); } }), /regular immutable Git files/); h.zeroAuthority();
});
test('H09 authenticated raw tree cannot be replaced with forged symlink-mode bytes', async () => {
  const h = await modules({ objectOverride: (args, bytes) => args[0] === 'cat-file' && args[1] === 'tree' && bytes.includes(Buffer.from('100644 ')) ? Buffer.from(bytes.toString('binary').replace('100644 ', '120000 '), 'binary') : bytes });
  const adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  assert.throws(() => adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd: root, candidateCommit: exact }), /tree object identity differs/); h.zeroAuthority();
});
test('H10 forged approval/source receipt/environment flags cannot activate new actual callers', async () => {
  const forgedEnv = { FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'true', FCOS_PREVIEW_EMAIL_BUILD_ENABLED: 'true', FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true', FCOS_SUCCESSOR_ADMISSION_INSTALLED: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: 'hocheunglai-oss/fcos', GITHUB_SHA: 'a'.repeat(40) };
  const h = await modules({ forgedEnv }), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  const forged = { ...adapter.compatibilitySuccessorPreparationPlan(), sourceVerified: true, ready: true, approved: true, installedAdmission: true, previewAuthorized: true, productionAuthorized: true };
  const release = await h.api('scripts/runtime-compatibility-release.mjs'), preview = await h.api('scripts/preview-email-proof-build.mjs');
  // Each caller has its own provider dependency surface. Keep the normal caller
  // in a separate VM so the synthetic module export set cannot hide its imports.
  const normalHarness = await modules({ forgedEnv });
  const normal = await normalHarness.api('scripts/runtime-compatibility-normal-role.mjs');
  const common = { trustedCwd: root, candidateCwd: join(root, 'candidate'), env: h.env, receipt: forged, preflight: forged, readiness: forged, sourceVerified: true, approved: true, installedAdmission: true };
  await assert.rejects(release.runRuntimeCompatibilityRelease({ ...common, mode: 'execute', expectedCommit: exact, candidateUrl: origin }), /does not install/);
  await assert.rejects(preview.runPreviewEmailProofBuild({ ...common, mode: 'create', candidateSha: exact }), /does not install/);
  await assert.rejects(normal.verifyRuntimeCompatibilityNormalRole({ ...common, env: normalHarness.env, signerEvidence: forged, normalEvidence: forged }), error => error.normalRoleDiagnostic?.reason === 'SUCCESSOR_ADMISSION_DEFERRED'); h.zeroAuthority(); normalHarness.zeroAuthority();
});
test('H11 actual unchanged old readiness normal Preview signer and executor reject source-preparation receipts', async () => {
  const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  const source = { ...adapter.compatibilitySuccessorPreparationPlan(), sourceVerified: true, ready: true, approved: true, installedAdmission: true, capturedAt: new Date().toISOString(), blockers: [], productionAuthorized: false };
  const readiness = await h.api('current/scripts/lib/release-readiness.mjs'), compatibility = await h.api('current/scripts/lib/runtime-compatibility-release.mjs'), preview = await h.api('current/scripts/lib/preview-email-build.mjs'), signer = await h.api('current/scripts/lib/preview-email-signer.mjs');
  assert.throws(() => readiness.assertReleaseReceiptBinding(source, { sha: exact }), /stale, blocked/);
  assert.throws(() => readiness.assertReleaseReceiptBinding({ ...source, receiptKind: 'fcos_release_readiness' }, { sha: exact }), /stale, blocked/);
  assert.equal(compatibility.compatibilityReadOnlyGuardsVerified(source), false);
  assert.equal(compatibility.compatibilityNormalCoverageVerified(source), false);
  assert.throws(() => preview.assertPreviewEmailBuildReceipt({ receipt: source, binding: { sha: exact } }), /invalid or stale/);
  assert.throws(() => preview.previewEmailBuildCandidate(exact), /exact reviewed Preview/);
  assert.equal(signer.previewEmailSignerEnabled(exact), false);
  assert.throws(() => signer.previewEmailSignerEvidenceVerified({ ...source, kind: 'fcos_preview_email_signer_evidence' }, { deployment: { id: 'dpl_fixture', sha: exact }, sourceDigest: '0'.repeat(64) }));
  await assert.rejects(compatibility.executeRuntimeCompatibilityRelease({ preflight: source, readiness: source, authority: () => { throw Error('unexpected authority'); } }), /prerequisites/);
  await assert.rejects(compatibility.executeRuntimeCompatibilityRelease({ preflight: { ...source, receiptKind: 'fcos_runtime_compatibility_preflight', binding: { sha: exact }, checks: { source: true }, proposedException: { appliesOnlyTo: 'previous_runtime_endpoint', endpointAbsenceObserved: true, environmentPinAndApprovalObserved: true } }, readiness: source }), /prerequisites/);
  h.zeroAuthority();
});
test('H12 native Git fixture consumption rejects corrupted pack trailer and truncated pack', () => {
  for (const [name, changed] of [['trailer', Buffer.from(pack)], ['truncated', pack.subarray(0, pack.length - 12)]]) {
    if (name === 'trailer') changed[changed.length - 1] ^= 1;
    const directory = join(temporary, `corrupt-${name}`); init(directory);
    assert.throws(() => nativeGit(directory, ['index-pack', '--stdin'], changed), error => error.status !== 0 && /pack|checksum|EOF|inflate|end/i.test(String(error.stderr)));
    assert.equal(fs.readdirSync(join(directory, 'objects/pack')).filter(name => name.endsWith('.pack') || name.endsWith('.idx')).length, 0);
  }
});

// These new portable checks cover moved source and caller preparation behavior.
// They are not a replay of the historical old33 or V2 old15 proofs.
test('I01 actual integrated source resolves immutable root/full-tree/observation closure with zero authority', async () => {
  const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  const proof = adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd: root, candidateCommit: exact });
  assert.equal(proof.candidateCanonicalTreeSha256, '1a3b7416c376b57c3bd67ac60eb5bb79cf6ae33375aa3bb0cac4fa7d8c2ca0e9');
  assert.equal(proof.scope.stages[0].candidateTreeHash, '4493c413dec871255d8aa32ee554a625e268dcc0d972b34c15b87b5b5fdd66f5');
  assert.equal(proof.scope.preservation.existingUi, false);
  assert.equal(proof.observationSources.sourceVerified, true); assert.equal(proof.sourceVerified, true);
  assert.equal(proof.mutations, 0);
  for (const field of ['installedAdmission', 'liveProof', 'previewAuthorized', 'productionAuthorized', 'credentialAuthority']) assert.equal(proof[field], false);
  assert.equal(h.counts.historicalSource, 0); h.zeroAuthority();
});
test('I02 portable source adapter rejects shallow and nested subdirectory roots', async () => {
  const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  for (const cwd of [join(root, 'scripts'), join(root, 'scripts/nested')]) {
    assert.throws(() => adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd, candidateCommit: exact }), /canonical repository root/);
  } h.zeroAuthority();
});
test('I03 actual adapter release and Preview plans remain explicitly unready after portable integration', async () => {
  const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  const release = await h.api('scripts/runtime-compatibility-release.mjs'), preview = await h.api('scripts/preview-email-proof-build.mjs');
  const plans = [adapter.compatibilitySuccessorPreparationPlan(),
    await release.runRuntimeCompatibilityRelease({ expectedCommit: exact, env: h.env }),
    await preview.runPreviewEmailProofBuild({ candidateSha: exact, env: h.env })];
  for (const plan of plans) {
    for (const field of ['ready', 'existingUi', 'sourceVerified', 'installedAdmission', 'liveProof', 'previewAuthorized', 'productionAuthorized', 'credentialAuthority']) assert.equal(plan[field], false);
    assert.equal(plan.mutations, 0); assert.equal(plan.blockers.length, 4);
  } h.zeroAuthority();
});
test('I04 actual release preflight provides source-only proof while all non-dry execution paths stop', async () => {
  const h = await modules(), release = await h.api('scripts/runtime-compatibility-release.mjs'), preview = await h.api('scripts/preview-email-proof-build.mjs');
  const common = { trustedCwd: root, candidateCwd: join(root, 'candidate'), env: h.env };
  const receipt = await release.runRuntimeCompatibilityRelease({ ...common, mode: 'preflight', expectedCommit: exact, candidateUrl: origin });
  assert.equal(receipt.sourceVerified, true); assert.equal(receipt.sourcePreparationOnly, true); assert.equal(receipt.ready, false);
  for (const field of ['installedAdmission', 'liveProof', 'previewAuthorized', 'productionAuthorized', 'credentialAuthority']) assert.equal(receipt[field], false);
  for (const mode of ['execute', 'collect-quality']) await assert.rejects(release.runRuntimeCompatibilityRelease({ ...common, mode, expectedCommit: exact, candidateUrl: origin }), /does not install/);
  for (const mode of ['prepare', 'create', 'readback', 'diagnose-authority', 'verify-authority']) await assert.rejects(preview.runPreviewEmailProofBuild({ ...common, mode, candidateSha: exact }), /does not install/);
  h.zeroAuthority();
});
test('I05 actual normal caller preserves 15 module gates and defers before private or browser authority', async () => {
  const h = await modules(), normal = await h.api('scripts/runtime-compatibility-normal-role.mjs');
  assert.equal(normal.COMPATIBILITY_NORMAL_MODULES.length, 15);
  await assert.rejects(normal.verifyRuntimeCompatibilityNormalRole({ env: h.env }), error => error.normalRoleDiagnostic?.reason === 'SUCCESSOR_ADMISSION_DEFERRED');
  h.zeroAuthority();
});
test('I06 actual portable preparation rejects wrong candidate and unready synthetic provenance metadata', async () => {
  const h = await modules(), adapter = await h.api('scripts/verify-runtime-compatibility-successor.mjs');
  for (const candidate of [old, '0e6b77cee1b76b7ebaa213b7ac13a3ba019a841a', '2f4bca02e94105681dedf674985e052169602492', '0'.repeat(40)]) {
    assert.throws(() => adapter.verifyRuntimeCompatibilitySuccessorSource({ cwd: root, candidateCommit: candidate }));
  } h.zeroAuthority();
  for (const changed of [{ commit: old, releaseEligible: true }, { commit: exact, releaseEligible: false }, { commit: exact, releaseEligible: true, sourceDigest: '0'.repeat(64) }]) {
    const changedHarness = await modules({ provenanceOverride: cwd => cwd === root ? { commit: 'a'.repeat(40), releaseEligible: true } : changed });
    const a = await changedHarness.api('scripts/verify-runtime-compatibility-successor.mjs');
    assert.throws(() => a.collectCompatibilitySuccessorPreparation({ candidateCwd: join(root, 'candidate'), trustedCwd: root }));
    changedHarness.zeroAuthority();
  }
});
test('I07 portable actual callers retain unchanged historical dry-run and source-selection branches', async () => {
  const h = await modules(), release = await h.api('scripts/runtime-compatibility-release.mjs'), preview = await h.api('scripts/preview-email-proof-build.mjs');
  assert.equal((await release.runRuntimeCompatibilityRelease({ expectedCommit: old })).historicalDryRun, true);
  assert.equal((await preview.runPreviewEmailProofBuild({ candidateSha: old })).kind, 'fcos_preview_email_build_plan');
  h.zeroAuthority();
  const normalHarness = await modules({ forgedEnv: { FCOS_E2E_EXPECTED_COMMIT: old,
    FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true',
    GITHUB_REPOSITORY: 'hocheunglai-oss/fcos', GITHUB_SHA: 'a'.repeat(40) } });
  const normal = await normalHarness.api('scripts/runtime-compatibility-normal-role.mjs');
  await assert.rejects(normal.verifyRuntimeCompatibilityNormalRole({ env: normalHarness.env }), error => error.normalRoleDiagnostic?.stage === 'SOURCE_SCOPE');
  assert.equal(normalHarness.counts.historicalSource, 1); normalHarness.zeroAuthority();
});
test('I08 portable actual source/member hashes and immutable carrier manifest reject changed review inputs', () => {
  const changed = JSON.parse(manifestBytes); changed.pack.count++;
  assert.throws(() => validatePublicManifest(Buffer.from(JSON.stringify(changed))), /manifest differs/);
  for (const file of ['config/runtime-compatibility-successor-source.json', 'scripts/verify-runtime-compatibility-successor.mjs',
    'scripts/runtime-compatibility-release.mjs', 'scripts/runtime-compatibility-normal-role.mjs', 'scripts/preview-email-proof-build.mjs']) {
    const bytes = fs.readFileSync(join(SOURCE_ROOT, file));
    assertBoundSource(file, bytes);
    assert.throws(() => assertBoundSource(file, Buffer.concat([bytes, Buffer.from('x')])), /length differs/);
  }
});
