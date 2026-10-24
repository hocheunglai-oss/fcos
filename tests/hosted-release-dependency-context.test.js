import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, hkdfSync } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_DEPENDENCY_CONTEXT as PIN, VERIFICATION_DEPENDENCY_CONTEXT as VERIFICATION, MEASUREMENT_DEPENDENCY_CONTEXT as MEASUREMENT, RUNTIME_METERING_DEPENDENCY_CONTEXT as METERED, dependencyContextCandidate } from '../config/hostedDependencyContext.js';
import { DEPENDENCY_SEED_FILES, sealDependencySeed } from '../scripts/hosted-release-dependency-seed.mjs';
import { digest, releaseTargets } from '../scripts/lib/hosted-release/contract.mjs';
import { NOM_B_LEGACY_HISTORY } from '../scripts/lib/hosted-release/dependency-publisher.mjs';
import { sealPreservationMembership } from '../scripts/lib/hosted-release/preservation-preflight.mjs';
import { firstRuntimePrevious } from '../scripts/lib/hosted-release/first-runtime.mjs';
import { nomBFixture } from './fixtures/hosted-nom-b.mjs';
import { typedFirstRuntimeFixture } from './helpers/hosted-first-runtime-v2.mjs';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicFixture = JSON.parse(readFileSync(new URL('./fixtures/hosted-dependency-context.json', import.meta.url)));
const base = PIN.contextCandidateSha, token = 'SYNTHETIC-only-dependency-token-12345';
const candidate = () => structuredClone(PIN.candidate);
const actualManifest = () => ({ candidate: candidate(), dependencies: structuredClone(publicFixture.dependencies) });

test('only the exact admitted diagnostic candidate and immutable dependency objects select parent AAD', () => {
  const m = actualManifest();
  assert.equal(dependencyContextCandidate(m, { seed: publicFixture.seed, handoff: { ...publicFixture.handoff, manifestHash: 'current-manifest' } }), base);
  assert.equal(publicFixture.handoff.candidateSha, base);
  assert.equal(m.candidate.sha, PIN.candidate.sha);
  for (const field of Object.keys(m.candidate)) {
    const changed = structuredClone(m); changed.candidate[field] = field === 'sha' ? 'f'.repeat(40) : 'changed';
    assert.throws(() => dependencyContextCandidate(changed), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  }
  for (const dependencies of [undefined, null, {}, { ...m.dependencies, extra: true }])
    assert.throws(() => dependencyContextCandidate({ ...m, dependencies }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  for (const mutate of [s => { s.files[0].sha256 = 'f'.repeat(64); }, s => { s.files.pop(); },
    s => { s.credentialSha256 = 'f'.repeat(64); }, s => { s.recipientPublicKeySha256 = 'f'.repeat(64); },
    s => { s.envelopeSha256 = 'f'.repeat(64); }, s => { s.extra = true; }]) {
    const seed = structuredClone(publicFixture.seed); mutate(seed);
    assert.throws(() => dependencyContextCandidate(m, { seed }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  }
  for (const field of ['candidateSha', 'originalCandidateSha', 'candidateSalesforceSourceSha256', 'relevantInputs', 'artifacts']) {
    const handoff = structuredClone(publicFixture.handoff); handoff[field] = 'changed';
    assert.throws(() => dependencyContextCandidate(m, { handoff }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  }
});

test('normal candidates retain their own context and unrelated candidates gain no parent mapping', () => {
  for (const sha of [base, '04ee3425aac7a49089eda781eb3c976aea1f6785', 'c'.repeat(40)])
    assert.equal(dependencyContextCandidate({ candidate: { sha } }), sha);
});

test('verification-only successor requires its complete exact candidate and the original immutable dependency objects', () => {
  const m = { candidate: structuredClone(VERIFICATION.candidate), dependencies: structuredClone(publicFixture.dependencies) };
  assert.equal(VERIFICATION.contextCandidateSha, PIN.contextCandidateSha);
  for (const field of ['dependenciesSha256','seedSha256','handoffSha256']) assert.equal(VERIFICATION[field],PIN[field]);
  for (const field of ['configurationSha256','lockSha256','salesforceSourceSha256']) assert.equal(VERIFICATION.candidate[field],PIN.candidate[field]);
  assert.equal(dependencyContextCandidate(m, { seed: publicFixture.seed, handoff: { ...publicFixture.handoff, manifestHash: 'new-manifest' } }), base);
  for (const field of Object.keys(m.candidate)) {
    const changed = structuredClone(m); changed.candidate[field] = field === 'sha' ? PIN.candidate.sha : 'changed';
    assert.throws(() => dependencyContextCandidate(changed), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  }
  for (const patch of [{ sha: PIN.candidate.sha }, { sourceProfile: PIN.candidate.sourceProfile }])
    assert.throws(() => dependencyContextCandidate({ ...m, candidate: { ...m.candidate, ...patch } }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  for (const dependencies of [undefined, null, {}, { ...m.dependencies, extra: true }])
    assert.throws(() => dependencyContextCandidate({ ...m, dependencies }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  assert.throws(() => dependencyContextCandidate(m, { seed: { ...publicFixture.seed, extra: true } }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  assert.throws(() => dependencyContextCandidate(m, { handoff: { ...publicFixture.handoff, candidateSha: m.candidate.sha } }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
});

function temporary(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'fcos-dependency-context-')));
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
function receiver() {
  const e = createECDH('prime256v1'), n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const raw = Buffer.from(hkdfSync('sha256', Buffer.from(token), Buffer.from('fcos-hosted-dependency-recipient-salt-v1'), Buffer.from('fcos-hosted-dependency-recipient-v1'), 32));
  e.setPrivateKey(Buffer.from(((BigInt(`0x${raw.toString('hex')}`) % (n - 1n)) + 1n).toString(16).padStart(64, '0'), 'hex'));
  return e;
}
// Synthetic crypto cannot match the immutable real ciphertext digest. This
// isolated Node loader substitutes only the three public data fingerprints;
// the production selector, opener, crypto and hosted admission code are used.
function syntheticPins(directory, { dependencies, seed, handoff }) {
  const pins = { ...PIN, dependenciesSha256: digest(dependencies), seedSha256: digest(seed), handoffSha256: digest(handoff) };
  const source = readFileSync(join(root, 'config/hostedDependencyContext.js'), 'utf8');
  const start = source.indexOf('freeze({'), end = source.indexOf('\n});', start);
  assert.ok(start > 0 && end > start);
  const module = join(directory, 'synthetic-context.mjs');
  writeFileSync(module, source.slice(0, start) + 'freeze(' + JSON.stringify(pins) + source.slice(end + 2));
  const hook = join(directory, 'synthetic-loader.mjs');
  writeFileSync(hook, `import {registerHooks} from 'node:module';\nregisterHooks({resolve(s,c,next){if(s.endsWith('/config/hostedDependencyContext.js'))return {url:${JSON.stringify(new URL('file://' + module).href)},shortCircuit:true};return next(s,c);}});\n`);
  return hook;
}
function archive(t, diagnostic = true) {
  const directory = temporary(t), controller = join(directory, 'controller'); mkdirSync(controller);
  execFileSync('git', ['init', '-q'], { cwd: controller });
  execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'SYNTHETIC admission fixture'], { cwd: controller });
  const controllerSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: controller, encoding: 'utf8' }).trim();
  const project = releaseTargets().supabaseProject;
  const connection = `postgresql://fcos_release_observer:SYNTHETIC@db.${project}.supabase.co/postgres?sslmode=verify-full`;
  const membership = { schemaVersion: 1, kind: 'fcos_release_preservation_membership', project,
    tables: [{ table: 'invoices', keyColumn: 'id', keys: ['SYNTHETIC'], expectedRowsSha256: digest([]) }] };
  const membershipBytes = Buffer.from(JSON.stringify(membership));
  const sealed = sealPreservationMembership(membershipBytes, { candidateSha: base, project, membershipSha256: digest(membershipBytes), connection });
  const handoff = { kind: 'fcos_reviewed_nom_b_legacy_import', candidateSha: base, originalCandidateSha: '04ee3425aac7a49089eda781eb3c976aea1f6785',
    candidateSalesforceSourceSha256: PIN.candidate.salesforceSourceSha256, measurementRecipeSha256: '', artifacts: NOM_B_LEGACY_HISTORY };
  const recipe = Buffer.from(JSON.stringify({ originalAcceptanceSha256: NOM_B_LEGACY_HISTORY.acceptance }));
  handoff.measurementRecipeSha256 = digest(recipe);
  const values = { 'handoff.json': Buffer.from(JSON.stringify(handoff)), 'artifacts.json': Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'fcos_immutable_dependency_artifacts', artifacts: {} })),
    'recipe.json': recipe, 'membership.encrypted.json': sealed };
  const files = DEPENDENCY_SEED_FILES.map(path => ({ path, bytes: values[path] || Buffer.from('SYNTHETIC ' + path) }));
  const dependencies = { schemaVersion: 1, nom_b: { handoffSha256: digest(values['handoff.json']), artifactsSha256: digest(values['artifacts.json']), recipeSha256: digest(recipe) },
    preservation: { envelopeSha256: digest(sealed), membershipSha256: digest(membershipBytes), tableCount: 1, rowCount: 1,
      snapshotSha256: digest(membership.tables.map(t => ({ table: t.table, count: t.keys.length, rowsSha256: t.expectedRowsSha256 }))) } };
  const e = receiver(), ciphertext = sealDependencySeed({ files, candidateSha: base, recipientPublicKey: e.getPublicKey().toString('base64'), credentialSha256: digest(token) });
  const seed = { envelopeSha256: digest(ciphertext), files: files.map(f => ({ path: f.path, sha256: digest(f.bytes), bytes: f.bytes.length })),
    recipientPublicKeySha256: digest(e.getPublicKey()), credentialSha256: digest(token) };
  const setup = { controllerSha, epoch: 1, targetsSha256: digest(releaseTargets()), verification: {}, dependencies, dependencyArtifact: { seed } };
  const manifest = { stage: 'compatibility', executionMode: 'release', epoch: 1, controller: { sha: controllerSha }, targets: releaseTargets(),
    candidate: diagnostic ? candidate() : { sha: base }, verification: {}, dependencies, setupSha256: digest(setup) };
  const encrypted = join(directory, 'dependency-setup'); mkdirSync(encrypted); writeFileSync(join(encrypted, 'seed.encrypted.json'), ciphertext);
  const hook = diagnostic ? syntheticPins(directory, { dependencies, seed, handoff }) : null;
  const env = { PATH: process.env.PATH, HOME: directory, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'hocheunglai-oss/fcos', GITHUB_REPOSITORY_ID: '1278654816',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '12345', GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
    FCOS_CONTROLLER_SHA: controllerSha, FCOS_CONTROLLER_DIRECTORY: controller, FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(setup),
    FCOS_RELEASE_MANIFEST: JSON.stringify(manifest), FCOS_HOSTED_GITHUB_READ_TOKEN: token, FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY: encrypted,
    FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY: join(directory, 'dependency-setup-opened') };
  return { directory, files, handoff, manifest, env, hook, membership, connection, setup };
}
function cli(f, job, env = {}) {
  return spawnSync(process.execPath, [...(f.hook ? ['--import', f.hook] : []), join(root, 'scripts/hosted-release-dependency-seed.mjs'), '--open'],
    { cwd: f.directory, env: { ...f.env, GITHUB_JOB: job, ...env }, encoding: 'utf8', timeout: 10000 });
}

for (const diagnostic of [false, true]) test(`real CLI opens all four trusted jobs with ${diagnostic ? 'bounded diagnostic parent' : 'unchanged normal'} AAD`, t => {
  for (const job of ['dependencies_before', 'publish_before', 'dependencies_after', 'publish_after']) {
    const f = archive(t, diagnostic), r = cli(f, job);
    assert.equal(r.status, 0, r.stderr);
    for (const file of f.files) assert.deepEqual(readFileSync(join(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY, file.path)), file.bytes);
    assert.equal(f.manifest.candidate.sha, diagnostic ? PIN.candidate.sha : base);
  }
});

function qualificationArchive(t) {
  const f = archive(t), now = Date.now(), first = typedFirstRuntimeFixture({ now });
  first.value.candidateSha = PIN.candidate.sha; first.value.candidateSourceProfile = PIN.candidate.sourceProfile;
  const baseline = first.referenceFor(first.value), m = f.manifest;
  m.stage = 'qualification'; m.executionMode = 'qualification';
  const ref = 'refs/heads/codex/SYNTHETIC-diagnostic-dependency-context';
  m.qualificationSource = { ref, bootstrapSha: 'd'.repeat(40), callerWorkflowRef: `hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@${ref}`,
    controllerSha: m.controller.sha, candidateSha: m.candidate.sha };
  m.previousProduction = firstRuntimePrevious(baseline, { now });
  m.scope = { sha256: 'a'.repeat(64), existingUi: false, handoffs: [], financialAuthority: false };
  m.migration = { mode: 'none', expectedSchemaSha256: first.value.schema.sha256 };
  m.runtime = { expectedSha256: digest(first.desiredRuntime), expectedProduction: first.desiredRuntime, expectedPreview: first.desiredRuntime };
  const read = admitVercelReadFixture(m, { now });
  f.setup = { ...f.setup, ...read.setup, firstRuntimeBaseline: baseline };
  m.setupSha256 = digest(f.setup);
  Object.assign(f.env, { FCOS_RELEASE_MANIFEST: JSON.stringify(m), FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(f.setup),
    FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(f.setup), FCOS_QUALIFICATION_BOOTSTRAP: 'true', FCOS_HOSTED_QUALIFICATION_ADMITTED: 'true',
    GITHUB_REF: ref, GITHUB_SHA: m.qualificationSource.bootstrapSha,
    GITHUB_WORKFLOW_REF: m.qualificationSource.callerWorkflowRef, GITHUB_WORKFLOW_SHA: m.qualificationSource.bootstrapSha });
  return f;
}

test('real diagnostic qualification CLI composes protected source, typed baseline and Vercel read acceptance before decrypting', t => {
  const f = qualificationArchive(t), result = cli(f, 'dependencies_before');
  assert.equal(result.status, 0, result.stderr);
  for (const file of f.files) assert.deepEqual(readFileSync(join(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY, file.path)), file.bytes);
  assert.equal(f.manifest.candidate.sha, PIN.candidate.sha);
  assert.equal(f.setup.qualificationSource.candidateSha, PIN.candidate.sha);
});

test('qualification CLI refuses changed caller, source, admission flag, baseline review and read acceptance before plaintext', t => {
  for (const mutate of [_f => ({ GITHUB_SHA: 'e'.repeat(40) }),
    _f => ({ GITHUB_REF: 'refs/heads/codex/SYNTHETIC-other-caller' }),
    _f => ({ FCOS_HOSTED_QUALIFICATION_ADMITTED: 'false' }),
    f => { f.manifest.qualificationSource.controllerSha = 'e'.repeat(40); return { FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest) }; },
    f => { f.setup.firstRuntimeBaseline.acceptance.sha256 = 'e'.repeat(64); return repinQualification(f); },
    f => { f.setup.vercelReadCredentialAcceptance.sha256 = 'e'.repeat(64); return repinQualification(f); }]) {
    const f = qualificationArchive(t), result = cli(f, 'dependencies_before', mutate(f));
    assert.equal(result.status, 1, result.stderr);
    assert.equal(existsSync(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY), false);
    assert.equal(result.stdout, ''); assert.equal(result.stderr.includes(token), false);
  }
});
function repinQualification(f) {
  f.manifest.setupSha256 = digest(f.setup);
  return { FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest), FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(f.setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(f.setup) };
}

test('real CLI rejects credential, source, descriptor, manifest and ciphertext drift without partial plaintext', t => {
  for (const mutate of [_f => ({ FCOS_HOSTED_GITHUB_READ_TOKEN: 'SYNTHETIC-wrong-token-12345' }),
    f => { f.manifest.candidate.sourceSha256 = 'f'.repeat(64); return { FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest) }; },
    f => { f.manifest.candidate.sha = 'f'.repeat(40); f.manifest.candidate.sourceProfile = 'other'; return { FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest) }; },
    f => { f.setup.dependencyArtifact.seed.files[0].bytes++; f.manifest.setupSha256 = digest(f.setup); return { FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(f.setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(f.setup), FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest) }; },
    _f => ({ FCOS_ADMITTED_RELEASE_SETUP_SHA256: 'f'.repeat(64) }),
    f => { const p = join(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY, 'seed.encrypted.json'); const e = JSON.parse(readFileSync(p)); e.tag = Buffer.alloc(16).toString('base64'); writeFileSync(p, JSON.stringify(e)); return {}; }]) {
    const f = archive(t), r = cli(f, 'dependencies_before', mutate(f));
    assert.equal(r.status, 1, r.stderr); assert.equal(existsSync(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY), false);
    assert.equal(r.stdout, ''); assert.equal(r.stderr.includes(token), false);
  }
});

test('authenticated decryption failure leaves no partially opened archive even with matching synthetic file pins', t => {
  const f = archive(t), path = join(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY, 'seed.encrypted.json');
  const envelope = JSON.parse(readFileSync(path)); envelope.tag = Buffer.alloc(16).toString('base64');
  const changed = Buffer.from(JSON.stringify(envelope)); writeFileSync(path, changed);
  f.setup.dependencyArtifact.seed.envelopeSha256 = digest(changed);
  f.hook = syntheticPins(f.directory, { dependencies: f.manifest.dependencies, seed: f.setup.dependencyArtifact.seed, handoff: f.handoff });
  f.manifest.setupSha256 = digest(f.setup);
  const result = cli(f, 'dependencies_before', { FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(f.setup),
    FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(f.setup), FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest) });
  assert.equal(result.status, 1); assert.equal(result.stderr.trim(), 'DEPENDENCY_SEED_DECRYPT_INVALID');
  assert.equal(existsSync(f.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY), false);
});

test('opened synthetic archive feeds actual inner preservation loader using original AAD and current manifest binding', t => {
  const f = archive(t), r = cli(f, 'dependencies_before'); assert.equal(r.status, 0, r.stderr);
  const script = join(f.directory, 'inner.mjs');
  writeFileSync(script, `import {loadDependencySetup} from ${JSON.stringify(new URL('file://' + join(root, 'scripts/lib/hosted-release/dependency-publisher.mjs')).href)};\nconst m=JSON.parse(process.env.FCOS_RELEASE_MANIFEST);const s=loadDependencySetup({manifest:m});console.log(JSON.stringify({manifestHash:s.preservation.membership.manifestHash,candidateSha:m.candidate.sha,project:s.preservation.membership.project}));\n`);
  const env = { ...f.env, FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY: f.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY, FCOS_HOSTED_PRESERVATION_DATABASE_URL: f.connection };
  const child = spawnSync(process.execPath, ['--import', f.hook, script], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { manifestHash: digest(f.manifest), candidateSha: PIN.candidate.sha, project: f.membership.project });
  const wrong = spawnSync(process.execPath, ['--import', f.hook, script], { env: { ...env, FCOS_HOSTED_PRESERVATION_DATABASE_URL: f.connection.replace('SYNTHETIC', 'WRONG') }, encoding: 'utf8', timeout: 10000 });
  assert.equal(wrong.status, 1); assert.ok(wrong.stderr.includes('PRESERVATION_PRIVATE_HANDOFF_INVALID'));
});

test('NomB historical handoff is validated unchanged while new evidence retains diagnostic candidate and original time', async t => {
  const directory = temporary(t), now = Date.parse('2026-10-17T01:00:00Z');
  const original = '04ee3425aac7a49089eda781eb3c976aea1f6785';
  const f = await nomBFixture({ manifest: { candidate: { sha: original, salesforceSourceSha256: PIN.candidate.salesforceSourceSha256 }, controller: { sha: 'b'.repeat(40) }, targets: releaseTargets() }, now });
  const m = { ...f.manifest, candidate: candidate(), dependencies: { schemaVersion: 1, syntheticFixture: true } };
  f.handoff.candidateSha = base; delete f.handoff.manifestHash;
  const hook = syntheticPins(directory, { dependencies: m.dependencies, seed: {}, handoff: f.handoff });
  const payload = { manifest: m, handoff: { ...f.handoff, manifestHash: digest(m) }, artifacts: [...f.artifacts].map(([k, v]) => [k, v.toString('base64')]), now };
  const input = join(directory, 'input.json'); writeFileSync(input, JSON.stringify(payload));
  const script = join(directory, 'nom.mjs');
  writeFileSync(script, `import {readFileSync} from 'node:fs';import {importAcceptedNomB,dependencyHash} from ${JSON.stringify(new URL('file://' + join(root, 'scripts/lib/hosted-release/dependencies.mjs')).href)};const p=JSON.parse(readFileSync(process.argv[2]));const a=new Map(p.artifacts.map(([k,v])=>[k,Buffer.from(v,'base64')]));const r=await importAcceptedNomB({manifest:p.manifest,handoff:p.handoff,verifyHandoff:async({handoffSha256})=>({verified:true,handoffSha256,manifestHash:dependencyHash(p.manifest),financialAuthority:false}),readArtifact:async({sha256})=>a.get(sha256),measureInputs:async()=>({readOnly:true,capturedAt:new Date(p.now).toISOString(),inputs:p.handoff.relevantInputs}),now:()=>p.now});console.log(JSON.stringify(r));\n`);
  const run = () => spawnSync(process.execPath, ['--import', hook, script, input], { encoding: 'utf8', timeout: 10000 });
  const child = run(); assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout); assert.equal(result.candidateSha, PIN.candidate.sha); assert.equal(result.capturedAt, f.live.completedAt); assert.equal(result.result.financialAuthority, false);
  payload.handoff.artifacts.cleanup = 'f'.repeat(64); writeFileSync(input, JSON.stringify(payload));
  const bad = run(); assert.equal(bad.status, 1); assert.ok(bad.stderr.includes('NOM_B_DEPENDENCY_REVALIDATION_REQUIRED'));
});


test('measurement-only successor retains original AAD only for its complete exact candidate and immutable dependency objects',()=>{
  const m={candidate:structuredClone(MEASUREMENT.candidate),dependencies:structuredClone(publicFixture.dependencies)};
  assert.equal(m.candidate.sha,'8d4cb87391c55de6debab92b9ab34827af17bea3');assert.equal(m.candidate.sourceProfile,'compat_database_measurement_20261024');
  assert.equal(MEASUREMENT.contextCandidateSha,VERIFICATION.contextCandidateSha);
  for(const field of ['dependenciesSha256','seedSha256','handoffSha256'])assert.equal(MEASUREMENT[field],VERIFICATION[field]);
  for(const field of ['configurationSha256','lockSha256','salesforceSourceSha256','branch'])assert.equal(m.candidate[field],VERIFICATION.candidate[field]);
  for(const field of ['sourceSha256','sourceInputsSha256'])assert.notEqual(m.candidate[field],VERIFICATION.candidate[field]);
  assert.equal(dependencyContextCandidate(m,{seed:publicFixture.seed,handoff:{...publicFixture.handoff,manifestHash:'measurement-manifest'}}),base);
  for(const field of Object.keys(m.candidate)){const changed=structuredClone(m);changed.candidate[field]=field==='sha'?VERIFICATION.candidate.sha:'changed';assert.throws(()=>dependencyContextCandidate(changed),{code:'DEPENDENCY_CONTEXT_REQUIRED'});}
  for(const patch of [{sha:VERIFICATION.candidate.sha},{sourceProfile:VERIFICATION.candidate.sourceProfile}])assert.throws(()=>dependencyContextCandidate({...m,candidate:{...m.candidate,...patch}}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
  for(const dependencies of [undefined,null,{}, {...m.dependencies,extra:true}])assert.throws(()=>dependencyContextCandidate({...m,dependencies}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
  assert.throws(()=>dependencyContextCandidate(m,{seed:{...publicFixture.seed,extra:true}}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
  assert.throws(()=>dependencyContextCandidate(m,{handoff:{...publicFixture.handoff,candidateSha:m.candidate.sha}}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
});

test('metered-runtime child retains original dependency AAD only with all exact new source fingerprints',()=>{
  const m={candidate:structuredClone(METERED.candidate),dependencies:structuredClone(publicFixture.dependencies)};
  assert.equal(m.candidate.sha,'1e25147dc9fc9ba008096f1200b681993d49d428');assert.equal(m.candidate.sourceProfile,'compat_runtime_metering_20261024');
  assert.equal(METERED.contextCandidateSha,MEASUREMENT.contextCandidateSha);
  for(const field of ['dependenciesSha256','seedSha256','handoffSha256'])assert.equal(METERED[field],MEASUREMENT[field]);
  for(const field of ['lockSha256','salesforceSourceSha256','branch'])assert.equal(m.candidate[field],MEASUREMENT.candidate[field]);
  for(const field of ['sourceSha256','sourceInputsSha256','configurationSha256'])assert.notEqual(m.candidate[field],MEASUREMENT.candidate[field]);
  assert.equal(dependencyContextCandidate(m,{seed:publicFixture.seed,handoff:{...publicFixture.handoff,manifestHash:'metered-manifest'}}),base);
  for(const field of Object.keys(m.candidate)){const changed=structuredClone(m);changed.candidate[field]=field==='sha'?MEASUREMENT.candidate.sha:'changed';assert.throws(()=>dependencyContextCandidate(changed),{code:'DEPENDENCY_CONTEXT_REQUIRED'});}
  for(const dependencies of [undefined,null,{}, {...m.dependencies,extra:true}])assert.throws(()=>dependencyContextCandidate({...m,dependencies}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
  assert.throws(()=>dependencyContextCandidate(m,{seed:{...publicFixture.seed,extra:true}}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
  assert.throws(()=>dependencyContextCandidate(m,{handoff:{...publicFixture.handoff,candidateSha:m.candidate.sha}}),{code:'DEPENDENCY_CONTEXT_REQUIRED'});
});
