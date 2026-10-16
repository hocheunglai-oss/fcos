import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { collectFinancialPreservation, dependencyHash } from '../scripts/lib/hosted-release/dependencies.mjs';
import { hostedDependencies } from '../scripts/hosted-release-dependencies.mjs';
import { loadDependencySetup, measureHostedNomBInputs, NOM_B_LEGACY_HISTORY, publishDependencies, validateNomBMeasurementReceipt } from '../scripts/lib/hosted-release/dependency-publisher.mjs';

const H = 'a'.repeat(64), S = 'b'.repeat(40), now = Date.parse('2026-10-17T03:00:00Z');
const commonRoot = process.env.FCOS_DEPENDENCY_COMMON_ROOT;
const common = await import(commonRoot ? pathToFileURL(join(commonRoot, 'scripts/lib/hosted-release/publisher.mjs')) : '../scripts/lib/hosted-release/publisher.mjs');
const contract = await import(commonRoot ? pathToFileURL(join(commonRoot, 'scripts/lib/hosted-release/contract.mjs')) : '../scripts/lib/hosted-release/contract.mjs');
function manifest() { return { schemaVersion: 2, contract: 'fcos-hosted-release/v2', releaseId: 'dependency-test-001', stage: 'compatibility', executionMode: 'release', epoch: 1,
  candidate: { sha: contract.FROZEN_COMPATIBILITY_SHA, branch: 'codex/frozen', sourceSha256: H, lockSha256: H, configurationSha256: H, salesforceSourceSha256: H },
  controller: { sha: S, workflow: contract.CONTROLLER_WORKFLOW, checkManifestSha256: H, configurationSha256: H }, targets: contract.releaseTargets(),
  scope: { sha256: H, handoffs: [], existingUi: false, financialAuthority: false }, previousProduction: { deploymentId: 'dpl_previous', sha: 'c'.repeat(40), sourceSha256: H, schemaSha256: H, runtimeSha256: H },
  requiredChecks: [...contract.REQUIRED_LIVE_CHECKS], authorization: { validitySeconds: 86400, actions: [...contract.WRITE_PHASES], rollback: { mode: 'compatible_previous_only', schemaRollback: false } },
  migration: { mode: 'none', expectedSchemaSha256: H }, runtime: { expectedSha256: dependencyHash({ safety: true }), expectedProduction: { safety: true }, expectedPreview: { safety: true } }, changes: ['offline dependency test'] }; }
function temporary(t) { const directory = mkdtempSync(join(tmpdir(), 'fcos-hosted-dependencies-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; }
function recipeFixture(t) {
  const directory = temporary(t), devee = fcosSalesforceEnvironment('devee');
  for (const file of ['source.js','harness.js','fixture.json']) writeFileSync(join(directory, file), file);
  const file = (root, path) => ({ root, path, sha256: dependencyHash(readFileSync(join(directory, path))) });
  const query = { kind: 'query', object: 'ApexClass', tooling: true, fields: ['Id','Name','Body'], where: { field: 'Name', values: ['NominationController'] }, limit: 2 };
  const describe = { kind: 'describe', object: 'Nomination__c', tooling: false };
  const response = { done: true, totalSize: 1, records: [{ Id: '01pExample', Name: 'NominationController', Body: 'reviewed body' }] }, metadata = { fields: [{ name: 'Id', type: 'id' }] };
  const recipe = { schemaVersion: 1, kind: 'fcos_nom_b_readonly_measurement_recipe', originalAcceptanceSha256: NOM_B_LEGACY_HISTORY.acceptance,
    origin: devee.instanceUrl, orgId: devee.orgId, username: devee.username, isSandbox: true, apiVersion: 'v67.0', userId: `005${'1'.repeat(15)}`, profileId: `00e${'2'.repeat(15)}`,
    observations: [
      { input: 'sourceSha256', files: [file('candidate','source.js')], reads: [] },
      { input: 'harnessSha256', files: [file('controller','harness.js')], reads: [] },
      { input: 'salesforceSourceSha256', files: [], reads: [query] },
      { input: 'fixtureSha256', files: [file('setup','fixture.json')], reads: [] },
      { input: 'environmentSha256', files: [], reads: [describe] },
    ] };
  for (const observation of recipe.observations) { observation.originalInputSha256 = H;
    observation.expectedSha256 = dependencyHash({ files: observation.files, reads: observation.reads.map(read => ({ recipe: read, sha256: dependencyHash(read.kind === 'query' ? response : metadata) })) }); }
  const recipeSha256 = dependencyHash(JSON.stringify(recipe));
  const handoff = { relevantInputs: Object.fromEntries(recipe.observations.map(row => [row.input, H])), measurementRecipeSha256: recipeSha256 };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); let body;
    if (url.endsWith('/userinfo')) body = { organization_id: devee.orgId, user_id: recipe.userId, preferred_username: devee.username };
    else if (url.includes('Organization%20LIMIT')) body = { done: true, totalSize: 1, records: [{ Id: devee.orgId, IsSandbox: true }] };
    else if (url.includes('/sobjects/User/')) body = { Id: recipe.userId, Username: devee.username, IsActive: true, ProfileId: recipe.profileId };
    else body = url.includes('/describe') ? metadata : response;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { directory, manifest: manifest(), handoff, recipe, recipeSha256, candidateDirectory: directory, controllerDirectory: directory, setupDirectory: directory,
    env: { FCOS_HOSTED_SALESFORCE_READ_TOKEN: 'private-read-token' }, fetchImpl, calls, response, now: () => now };
}

test('GET-only recipe measures actual files, org/user/profile and bounded metadata before mapping legacy fingerprints', async t => {
  const f = recipeFixture(t), measured = await measureHostedNomBInputs(f);
  assert.deepEqual(measured.inputs, f.handoff.relevantInputs); assert.equal(f.calls.length, 5);
  assert.ok(f.calls.every(call => call.options.method === 'GET' && call.url.startsWith(`${f.recipe.origin}/services/`) && call.options.redirect === 'error'));
  assert.deepEqual(validateNomBMeasurementReceipt({ ...f, receipt: measured.receipt, job: { started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now + 1000).toISOString() } }).inputs, measured.inputs);
  assert.ok(!JSON.stringify(measured).includes('private-read-token')); assert.ok(!JSON.stringify(measured).includes('reviewed body'));
});
test('NomB recipe missing credential waits; malicious queries, identity/metadata/file drift cannot yield fingerprints', async t => {
  assert.equal((await measureHostedNomBInputs({ ...recipeFixture(t), env: {} })).status, 'waiting_dependency');
  for (const mutate of [f => { f.recipe.origin = 'https://attacker.invalid'; }, f => { f.recipe.observations[2].reads[0].where.values = ["x' OR Id!='"]; },
    f => { f.recipe.observations[2].reads[0].kind = 'executeAnonymous'; }, f => { f.response.done = false; },
    f => { writeFileSync(join(f.directory, 'source.js'), 'changed'); }, f => { f.recipe.profileId = `00e${'9'.repeat(15)}`; f.fetchImpl = async () => new Response('{}'); }]) {
    const f = recipeFixture(t); mutate(f); await assert.rejects(measureHostedNomBInputs(f), { code: 'NOM_B_READONLY_REVALIDATION_REQUIRED' });
    assert.ok(f.calls.every(call => call.options.method === 'GET'));
  }
});
test('independent receipt validator rejects changed digest, foreign recipe and time outside actual producer job', async t => {
  const f = recipeFixture(t), measured = await measureHostedNomBInputs(f), job = { started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now + 1000).toISOString() };
  for (const mutate of [r => { r.observations[0].sha256 = 'c'.repeat(64); }, r => { r.recipeSha256 = 'c'.repeat(64); }, r => { r.capturedAt = new Date(now - 3600000).toISOString(); }]) {
    const receipt = structuredClone(measured.receipt); mutate(receipt); assert.throws(() => validateNomBMeasurementReceipt({ ...f, receipt, job }));
  }
});

function preservationSetup(t) {
  const directory = temporary(t), m = manifest(), rows = [{ id: '1', amount: '123.45', lines: [{ quantity: 1 }], payments: [] }];
  const original = { schemaVersion: 1, kind: 'fcos_release_preservation_membership', project: m.targets.supabaseProject,
    tables: [{ table: 'invoices', keyColumn: 'id', keys: ['1'], expectedRowsSha256: dependencyHash(rows) }] };
  const bytes = Buffer.from(JSON.stringify(original)), file = join(directory, 'membership.json'); writeFileSync(file, bytes);
  m.dependencies = { schemaVersion: 1, preservation: { membershipSha256: dependencyHash(bytes) } };
  const env = { FCOS_RELEASE_MANIFEST: JSON.stringify(m), FCOS_VERIFICATION_PHASE: 'before', FCOS_HOSTED_PRESERVATION_MEMBERSHIP_FILE: file,
    FCOS_HOSTED_PRESERVATION_DATABASE_URL: `postgresql://fcos_release_observer:private@db.${m.targets.supabaseProject}.supabase.co/postgres?sslmode=verify-full` };
  class Client { async connect() {} async end() {} async query(sql) {
    if (sql.startsWith('select current_user')) return { rows: [{ role: 'fcos_release_observer', database: 'postgres', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, memberships: false, table_writes: false, definer_access: false }] };
    return { rows: sql.startsWith('select to_jsonb') ? rows.map(row => ({ row })) : [] };
  } }
  const sessionFactory = async options => { assert.equal(options.requireOidc, false); assert.equal(options.jobName, 'release / dependencies / before'); return { admission: {} }; };
  return { manifest: m, original, file, env, Client, sessionFactory, readManifest: JSON.parse, now: () => now, preserve: options => collectFinancialPreservation({ ...options, Client }) };
}
test('actual producer entrypoint collects preservation with no OIDC, retains pending NomB and exposes no values', async t => {
  const f = preservationSetup(t), report = await hostedDependencies(f);
  assert.equal(report.status, 'waiting_dependency'); assert.equal(report.checks.find(row => row.checkId === 'preservation').status, 'passed');
  assert.equal(report.checks.find(row => row.checkId === 'nom_b').status, 'waiting_dependency'); assert.ok(!JSON.stringify(report).includes('123.45'));
  assert.equal(loadDependencySetup(f).preservation.membership.manifestHash, dependencyHash(f.manifest));
  await assert.rejects(hostedDependencies({ ...f, env: { ...f.env, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'forbidden' } }), { code: 'DEPENDENCY_PRODUCER_CREDENTIAL_FORBIDDEN' });
  rmSync(f.file); assert.equal((await hostedDependencies(f)).status, 'waiting_dependency');
});
test('manifest pins cannot self-authorize substituted historical acceptance or modified setup bytes', t => {
  const f = preservationSetup(t); writeFileSync(f.file, '{}'); assert.throws(() => loadDependencySetup(f));
  const directory = temporary(t), handoff = { artifacts: { ...NOM_B_LEGACY_HISTORY, acceptance: H }, measurementRecipeSha256: H };
  const files = { handoff: Buffer.from(JSON.stringify(handoff)), artifacts: Buffer.from('{}'), recipe: Buffer.from('{}') };
  const m = manifest(); m.dependencies = { schemaVersion: 1, nom_b: { handoffSha256: dependencyHash(files.handoff), artifactsSha256: dependencyHash(files.artifacts), recipeSha256: dependencyHash(files.recipe) } };
  for (const [key, bytes] of Object.entries(files)) writeFileSync(join(directory, key), bytes);
  assert.throws(() => loadDependencySetup({ manifest: m, env: { FCOS_HOSTED_NOM_B_HANDOFF_FILE: join(directory,'handoff'), FCOS_HOSTED_NOM_B_ARTIFACTS_FILE: join(directory,'artifacts'), FCOS_HOSTED_NOM_B_RECIPE_FILE: join(directory,'recipe') } }));
});

function hostedArtifact(m, report) {
  const started_at = new Date(now - 1000).toISOString(), completed_at = new Date(now + 1000).toISOString();
  return { report, run: { id: 101, run_attempt: 1, repository: { full_name: m.targets.repository }, head_repository: { full_name: m.targets.repository }, head_branch: 'main', head_sha: S, event: 'workflow_dispatch',
    referenced_workflows: [{ path: `${m.targets.repository}/${contract.CONTROLLER_WORKFLOW}@${S}`, sha: S }] },
    job: { id: 202, name: 'release / dependencies / before', run_id: 101, run_attempt: 1, head_sha: S, status: 'completed', conclusion: 'success', started_at, completed_at,
      steps: [{ name: 'Run admitted checks', status: 'completed', conclusion: 'success' }] },
    artifact: { id: 303, expired: false, workflow_run: { id: 101, head_sha: S }, digest: `sha256:${H}`, archiveSha256: H, created_at: completed_at } };
}
test('dependency publisher uses actual strict common publisher and independently recomputes preservation baseline digest', async t => {
  const f = preservationSetup(t), report = await hostedDependencies(f), collected = hostedArtifact(f.manifest, report), saved = [];
  const args = { manifest: f.manifest, env: f.env, runId: 101, phase: 'before', now: f.now, collectArtifact: async () => collected,
    publish: common.publishChecks, coordinator: { appendEvidence: async proof => saved.push(proof) } };
  assert.equal((await publishDependencies(args)).status, 'waiting_dependency'); assert.equal(saved.length, 1); assert.equal(saved[0].evidence.checkId, 'preservation');
  report.checks.find(row => row.checkId === 'preservation').result.snapshotSha256 = 'd'.repeat(64);
  await assert.rejects(publishDependencies(args)); assert.equal(saved.length, 1);
  collected.job.conclusion = 'failure'; await assert.rejects(publishDependencies(args)); assert.equal(saved.length, 1);
});
test('historical timestamp permission is exact NomB deterministic and cannot waive ordinary proof job times', async () => {
  const m = manifest(), collected = hostedArtifact(m, {}), saved = [], old = new Date(now - 86400000).toISOString();
  const args = { manifest: m, ...collected, coordinator: { appendEvidence: async row => saved.push(row) }, expectedJobName: collected.job.name,
    validateReport: async () => [{ id: 'nom_b', kind: 'deterministic', status: 'passed', inputsSha256: H, completedAt: old, result: { actualExecution: true } }] };
  await assert.rejects(common.publishChecks(args)); assert.equal(saved.length, 0);
  await common.publishChecks({ ...args, validateHistoricalCheck: async () => true }); assert.equal(saved[0].evidence.capturedAt, old);
  await assert.rejects(common.publishChecks({ ...args, validateReport: async () => [{ id: 'normal_role', kind: 'volatile', status: 'passed', inputsSha256: H, completedAt: old, result: {} }], validateHistoricalCheck: async () => true }));
  assert.equal(saved.length, 1);
});


test('actual CLI process writes waiting report and calls no-OIDC hosted entrypoint without executing candidate code', t => {
  const directory = temporary(t), sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  for (const relative of ['scripts/hosted-release-dependencies.mjs','scripts/lib/hosted-release/dependencies.mjs','scripts/lib/hosted-release/dependency-publisher.mjs','config/fcosConnections.js','config/runtime-compatibility-successor-live.json']) {
    const destination = join(directory, relative); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(join(sourceRoot, relative), destination);
  }
  writeFileSync(join(directory,'package.json'), JSON.stringify({ type: 'module' })); symlinkSync(join(sourceRoot,'node_modules'),join(directory,'node_modules'));
  writeFileSync(join(directory,'scripts/lib/hosted-release/session.mjs'), `import {writeFileSync} from 'node:fs'; export const readManifest=JSON.parse; export async function hostedSession(options){writeFileSync(process.env.FCOS_TEST_SESSION_FILE,JSON.stringify({requireOidc:options.requireOidc,jobName:options.jobName}));return{admission:{}};}`);
  mkdirSync(join(directory,'candidate')); const canary=join(directory,'executed');
  writeFileSync(join(directory,'candidate/canary.mjs'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(canary)},'unexpected');`);
  const output=join(directory,'dependencies.json'), sessionFile=join(directory,'session.json');
  const child=spawnSync(process.execPath,[join(directory,'scripts/hosted-release-dependencies.mjs')],{cwd:directory,encoding:'utf8',timeout:10000,env:{
    FCOS_RELEASE_MANIFEST:JSON.stringify(manifest()),FCOS_RELEASE_OUTPUT:output,FCOS_TEST_SESSION_FILE:sessionFile,FCOS_VERIFICATION_PHASE:'before',
    FCOS_CANDIDATE_DIRECTORY:join(directory,'candidate'),FCOS_CONTROLLER_DIRECTORY:directory}});
  assert.equal(child.status,0,child.stderr); assert.equal(JSON.parse(readFileSync(output)).status,'waiting_dependency');
  assert.deepEqual(JSON.parse(readFileSync(sessionFile)),{requireOidc:false,jobName:'release / dependencies / before'});assert.equal(existsSync(canary),false);
});
