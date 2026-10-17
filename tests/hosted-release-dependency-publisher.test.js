import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { salesforceReaderFixture } from './helpers/hosted-salesforce-read.mjs';
import { nomBFixture } from './fixtures/hosted-nom-b.mjs';
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
async function recipeFixture(t, options = {}) {
  const directory = temporary(t), devee = fcosSalesforceEnvironment('devee'), f = await nomBFixture({ manifest: manifest(), now, ...options });
  if (options.contentVersionOriginalBytes) f.schemas.ContentVersion = structuredClone(f.legacy.schema.ContentVersion);
  for (const file of ['source.js','harness.js','fixture.json']) writeFileSync(join(directory, file), file);
  const file = (root, path) => ({ root, path, sha256: dependencyHash(readFileSync(join(directory, path))) });
  const query = (object, fields, field, values, tooling = false) => ({ kind: 'query', object, tooling, fields, limit: 100, ...(field ? { where: { field, values } } : {}) });
  const sf = [query('ApexClass',['Id','Name','Body','LastModifiedDate'],'Name',f.legacy.indexes.ApexClass.scope,true),
    query('ApexTrigger',['Id','Name','TableEnumOrId','Status','Body','LastModifiedDate'],'TableEnumOrId',f.legacy.indexes.ApexTrigger.scope,true),
    query('ValidationRule',['Id','ValidationName','Active','EntityDefinitionId','LastModifiedDate'],'EntityDefinitionId',f.legacy.indexes.ValidationRule.scope,true),
    query('WorkflowRule',['Id','Name','TableEnumOrId','LastModifiedDate'],'TableEnumOrId',f.legacy.indexes.WorkflowRule.scope,true),
    query('FlowDefinitionView',['Id','ApiName','IsActive','ActiveVersionId','TriggerType','TriggerObjectOrEventId','RecordTriggerType'],'TriggerObjectOrEventId',f.legacy.indexes.FlowDefinitionView.scope),
    ...Object.keys(f.schemas).map(object => ({ kind: 'describe', object, tooling: false }))];
  const fixtureReads = [...Object.entries(f.fixtureIds).map(([object,id])=>query(object,['Id'],'Id',[id])),
    query('ContentDocumentLink',['Id','ContentDocumentId','LinkedEntityId'],'ContentDocumentId',[f.fixtureIds.ContentDocument])];
  const profileId = `00e${'2'.repeat(15)}`;
  f.responses.User = [{ Id: f.environment.userId, Username: devee.username, IsActive: true, ProfileId: profileId }];
  const envReads = [query('User',['Id','Username','IsActive','ProfileId'],'Id',[f.environment.userId]), query('Xero_Contact_Sync_Setting__c',['Id','SetupOwnerId','Enabled__c'])];
  const responseFor = read => read.kind === 'describe' ? f.schemas[read.object] : { done: true, totalSize: (f.responses[read.object] || []).length,
    records: (f.responses[read.object] || []).map(row => Object.fromEntries(read.fields.map(field => [field,row[field]]))) };
  const recipe = { schemaVersion: 1, kind: 'fcos_nom_b_readonly_measurement_recipe', originalAcceptanceSha256: NOM_B_LEGACY_HISTORY.acceptance,
    origin: devee.instanceUrl, orgId: devee.orgId, username: devee.username, isSandbox: true, apiVersion: 'v67.0', userId: f.environment.userId, profileId,
    observations: [{ input: 'sourceSha256', files: [file('candidate','source.js')], reads: [] },{ input: 'harnessSha256', files: [file('controller','harness.js')], reads: [] },
      { input: 'salesforceSourceSha256', files: [], reads: sf },{ input: 'fixtureSha256', files: [file('setup','fixture.json')], reads: fixtureReads },{ input: 'environmentSha256', files: [], reads: envReads }] };
  const refreshRecipe = () => { for (const observation of recipe.observations) { observation.originalInputSha256 = f.handoff.relevantInputs[observation.input];
    observation.expectedSha256 = dependencyHash({ files: observation.files, reads: observation.reads.map(read => ({ recipe: read, sha256: dependencyHash(responseFor(read)) })) }); }
    f.recipeSha256 = dependencyHash(JSON.stringify(recipe)); f.handoff.measurementRecipeSha256 = f.recipeSha256; };
  const calls = [], fetchImpl = async (url, options) => {
    calls.push({url,options}); let body;
    if(url.endsWith('/userinfo')) body={organization_id:devee.orgId,user_id:recipe.userId,preferred_username:devee.username};
    else if(url.includes('Organization%20LIMIT'))body={done:true,totalSize:1,records:[{Id:devee.orgId,IsSandbox:true}]};
    else if(url.includes('/sobjects/User/'))body=f.responses.User[0];
    else { const decoded=decodeURIComponent(url), read=recipe.observations.flatMap(row=>row.reads).find(read=>read.kind==='describe'?decoded.includes(`/sobjects/${read.object}/describe`):decoded.includes(` FROM ${read.object} `)); body=responseFor(read); }
    return new Response(JSON.stringify(body),{status:200});
  };
  Object.assign(f,{directory,recipe,candidateDirectory:directory,controllerDirectory:directory,setupDirectory:directory,env:{FCOS_HOSTED_SALESFORCE_LEGACY_BEARER_ALLOWED:'true',FCOS_HOSTED_SALESFORCE_READ_TOKEN:'private-read-token'},fetchImpl,calls,refreshRecipe});refreshRecipe();return f;
}

test('GET-only recipe measures actual files, org/user/profile and bounded metadata before mapping legacy fingerprints', async t => {
  const f = await recipeFixture(t), measured = await measureHostedNomBInputs(f);
  assert.deepEqual(measured.inputs, f.handoff.relevantInputs); assert.equal(f.calls.length, 19);
  assert.ok(f.calls.every(call => call.options.method === 'GET' && call.url.startsWith(`${f.recipe.origin}/services/`) && call.options.redirect === 'error'));
  assert.deepEqual(validateNomBMeasurementReceipt({ ...f, receipt: measured.receipt, job: { started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now + 1000).toISOString() } }).inputs, measured.inputs);
  assert.ok(!JSON.stringify(measured).includes('private-read-token')); assert.ok(!JSON.stringify(measured).includes('reviewed body'));
});
test('NomB recipe missing credential waits; malicious queries, identity/metadata/file drift cannot yield fingerprints', async t => {
  assert.equal((await measureHostedNomBInputs({ ...await recipeFixture(t), env: {} })).status, 'waiting_dependency');
  for (const mutate of [f => { f.recipe.origin = 'https://attacker.invalid'; }, f => { f.recipe.observations[2].reads[0].where.values = ["x' OR Id!='"]; },
    f => { f.recipe.observations[2].reads[0].kind = 'executeAnonymous'; }, f => { f.responses.ApexClass.push({...f.responses.ApexClass[0],Id:'extra'}); },
    f => { writeFileSync(join(f.directory, 'source.js'), 'changed'); }, f => { f.recipe.profileId = `00e${'9'.repeat(15)}`; f.fetchImpl = async () => new Response('{}'); }]) {
    const f = await recipeFixture(t); mutate(f); await assert.rejects(measureHostedNomBInputs(f), { code: 'NOM_B_READONLY_REVALIDATION_REQUIRED' });
    assert.ok(f.calls.every(call => call.options.method === 'GET'));
  }
});
test('live original Apex checks cannot be waived by changing the admitted expected response hash', async t => {
  for (const object of ['ApexClass','ApexTrigger']) for (let i=0;i<(object==='ApexClass'?6:5);i++) {
    const f=await recipeFixture(t);f.responses[object][i].Body='changed deployed behavior';f.refreshRecipe();
    await assert.rejects(measureHostedNomBInputs(f),{code:'NOM_B_READONLY_REVALIDATION_REQUIRED'});
  }
  for (const mutate of [f=>f.responses.ApexTrigger.push({...f.responses.ApexTrigger[0],Id:'01q999999999999999',Name:'NewActive'}),
    f=>f.responses.ValidationRule.push({...f.responses.ValidationRule[0],Id:'03d999999999999999'}),
    f=>f.responses.FlowDefinitionView.push({Id:'301999999999999999',IsActive:true}),f=>{f.schemas.Nomination__c.fields[0].type='changed';}]) {
    const f=await recipeFixture(t);mutate(f);f.refreshRecipe();await assert.rejects(measureHostedNomBInputs(f),{code:'NOM_B_READONLY_REVALIDATION_REQUIRED'});
  }
});
const contentVersionOriginalBytes = readFileSync(new URL('./fixtures/hosted-nom-b-content-version-original.json', import.meta.url));
test('exact ContentVersion successor is freshly measured while original input fingerprints remain intact', async t => {
  const f = await recipeFixture(t, { contentVersionOriginalBytes }), measured = await measureHostedNomBInputs(f);
  assert.deepEqual(measured.inputs, f.handoff.relevantInputs);
  assert.notEqual(dependencyHash(f.legacy.originalSchema.ContentVersion), dependencyHash(f.schemas.ContentVersion));
  assert.equal(dependencyHash(f.schemas.ContentVersion), '6e568b9cdd62603c2f7ad41956933c0d2cf76c41920ff15362598883dcdd6855');
  assert.deepEqual(validateNomBMeasurementReceipt({ ...f, receipt: measured.receipt,
    job: { started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now + 1000).toISOString() } }).inputs, measured.inputs);
});
test('ContentVersion successor cannot admit changed targets, permissions, relationships or other fields by replacing expected hashes', async t => {
  const field = f => f.schemas.ContentVersion.fields.find(row => row.name === 'FirstPublishLocationId');
  const child = f => f.schemas.ContentVersion.childRelationships.find(row => row.childSObject === 'LiveChatTranscriptFeed');
  for (const mutate of [f => { field(f).referenceTo = field(f).referenceTo.filter(v => v !== 'Nomination__c'); },
    f => { field(f).referenceTo.push('Unapproved__c'); }, f => { field(f).createable = false; },
    f => { f.schemas.ContentVersion.createable = false; }, f => { child(f).field = 'OtherId'; },
    f => { child(f).relationshipName = 'Unexpected'; }, f => { child(f).cascadeDelete = true; },
    f => { f.schemas.ContentVersion.childRelationships[0].restrictedDelete = true; },
    f => { f.schemas.ContentVersion.fields.find(row => row.name === 'Checksum').type = 'changed'; },
    f => { f.schemas.ContentVersion = structuredClone(f.legacy.originalSchema.ContentVersion); },
    f => { f.schemas.ContentVersion.fields.reverse(); }, f => { f.recipe.orgId = '00D222222222222222'; },
    f => { f.recipe.username = 'other@example.invalid'; }, f => { f.recipe.apiVersion = 'v68.0'; }]) {
    const f = await recipeFixture(t, { contentVersionOriginalBytes }); mutate(f); f.refreshRecipe();
    await assert.rejects(measureHostedNomBInputs(f), { code: 'NOM_B_READONLY_REVALIDATION_REQUIRED' });
  }
});

test('cleaned fixture must stay absent and coverage cannot omit original objects or bodies', async t => {
  for(const object of ['STEM__c','Nomination__c','Stem_Status__c','ContentDocument','ContentVersion','ContentDocumentLink']) {
    const f=await recipeFixture(t);f.responses[object]=[{Id:f.fixtureIds[object]||'link'}];f.refreshRecipe();
    await assert.rejects(measureHostedNomBInputs(f),{code:'NOM_B_READONLY_REVALIDATION_REQUIRED'});
  }
  for(const mutate of [f=>f.recipe.observations[2].reads.pop(),f=>{f.recipe.observations[2].reads[0].fields=f.recipe.observations[2].reads[0].fields.filter(x=>x!=='Body');},
    f=>{f.recipe.observations[3].reads=[];},f=>{f.handoff.candidateSalesforceSourceSha256='c'.repeat(64);}]) {
    const f=await recipeFixture(t);mutate(f);f.refreshRecipe();await assert.rejects(measureHostedNomBInputs(f),{code:'NOM_B_READONLY_REVALIDATION_REQUIRED'});
  }
});

test('current ProfileId is a fresh separate binding, never an invented historical identity field', async t => {
  const f=await recipeFixture(t), original=f.handoff.relevantInputs.environmentSha256;
  f.recipe.profileId=`00e${'3'.repeat(15)}`;f.responses.User[0].ProfileId=f.recipe.profileId;f.refreshRecipe();
  const measured=await measureHostedNomBInputs(f);assert.equal(measured.inputs.environmentSha256,original);
});
test('new Xero setting, malformed active flag, saturated limit and narrowed trigger scope fail closed', async t => {
  for(const mutate of [f=>f.responses.Xero_Contact_Sync_Setting__c.push({Id:'a00111111111111111',SetupOwnerId:'org',Enabled__c:true}),
    f=>f.responses.FlowDefinitionView.push({Id:'301111111111111111',IsActive:'true'}),
    f=>{f.recipe.observations[2].reads[0].limit=6;},f=>{f.recipe.observations[2].reads[1].where={field:'Id',values:[f.responses.ApexTrigger[0].Id]};}]) {
    const f=await recipeFixture(t);mutate(f);f.refreshRecipe();await assert.rejects(measureHostedNomBInputs(f),{code:'NOM_B_READONLY_REVALIDATION_REQUIRED'});
  }
});

test('independent receipt validator rejects changed digest, foreign recipe and time outside actual producer job', async t => {
  const f = await recipeFixture(t), measured = await measureHostedNomBInputs(f), job = { started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now + 1000).toISOString() };
  for (const mutate of [r => { r.observations[0].sha256 = 'c'.repeat(64); }, r => { r.recipeSha256 = 'c'.repeat(64); }, r => { r.capturedAt = new Date(now - 3600000).toISOString(); },r=>{r.candidateSalesforceSourceSha256='c'.repeat(64);},r=>{r.legacyInputsSha256='c'.repeat(64);}]) {
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
  for (const relative of ['scripts/hosted-release-dependencies.mjs','scripts/lib/hosted-release/dependencies.mjs','scripts/lib/hosted-release/observer-target.mjs','scripts/lib/hosted-release/dependency-publisher.mjs','scripts/lib/hosted-release/salesforce-read-auth.mjs','config/fcosConnections.js','config/runtime-compatibility-successor-live.json']) {
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


test('renewable JWT collector preserves all sixteen NomB reads and independent receipt binding; no opaque fallback can qualify', async t => {
  const f=await recipeFixture(t), auth=salesforceReaderFixture({recipe:f.recipe,manifest:f.manifest});
  const legacyFetch=f.fetchImpl;
  const fetched=[];
  const fetchImpl=async(url,options)=>{fetched.push({url,options});return options.method==='POST'?auth.fetchImpl(url,options):legacyFetch(url,options);};
  const measured=await measureHostedNomBInputs({...f,env:auth.env,fetchImpl,now:auth.now,recipeBytes:auth.recipeBytes});
  assert.deepEqual(measured.inputs,f.handoff.relevantInputs);assert.equal(fetched.length,20);assert.equal(fetched[0].options.method,'POST');assert.ok(fetched.slice(1).every(row=>row.options.method==='GET'));
  assert.deepEqual(measured.receipt.authentication,{kind:'fcos_salesforce_jwt_recipe_reader',credentialBindingSha256:dependencyHash(auth.binding)});
  const job={started_at:new Date(auth.now()-1000).toISOString(),completed_at:new Date(auth.now()+1000).toISOString()};
  validateNomBMeasurementReceipt({...f,receipt:measured.receipt,job});
  const old=structuredClone(measured.receipt);delete old.authentication;assert.throws(()=>validateNomBMeasurementReceipt({...f,receipt:old,job}));
  assert.ok(!JSON.stringify(measured).includes('fixture-access-token'));assert.ok(!JSON.stringify(measured).includes('BEGIN PRIVATE'));
  assert.equal((await measureHostedNomBInputs({...f,env:{FCOS_HOSTED_SALESFORCE_READ_TOKEN:'opaque',FCOS_HOSTED_SALESFORCE_LEGACY_BEARER_ALLOWED:'true'}})).status,'waiting_dependency');
  const local=await recipeFixture(t);assert.equal((await measureHostedNomBInputs({...local,env:{...local.env,GITHUB_ACTIONS:'true'}})).status,'waiting_dependency');
  local.manifest.stage='qualification';assert.equal((await measureHostedNomBInputs(local)).status,'waiting_dependency');
});
