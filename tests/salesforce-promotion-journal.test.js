import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSalesforcePromotionJournal, assertSuccessfulSalesforceReport } from '../scripts/lib/salesforce-promotion-journal.mjs';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = FCOS_CONNECTION_POLICY.providers.find(p => p.id === 'salesforce');
function file(root, name, data) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), data); }
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fcos-sf-journal-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const p of ['scripts/deploy-salesforce-environments.mjs', 'scripts/lib/salesforce-promotion-journal.mjs', 'scripts/salesforce-workflow-state.mjs', 'config/fcosConnections.js']) file(root, p, readFileSync(join(repository, p)));
  file(root, 'package.json', '{"type":"module"}');
  file(root, 'manifest/change.xml', '<Package><types><members>ExampleTest</members><name>ApexClass</name></types></Package>');
  file(root, 'manifest/bootstrap.xml', '<Package><types><members>Example__c</members><name>CustomObject</name></types></Package>');
  file(root, 'force-app/main/default/classes/Example.cls', 'class Example {}\n');
  const statePath = join(root, 'stub-state.json');
  file(root, 'stub-state.json', JSON.stringify({ jobs: {}, calls: [], next: 1 }));
  file(root, 'scripts/sync-salesforce-shared-repository.mjs', `import {createHash} from 'node:crypto'; import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs'; import {join,resolve} from 'node:path'; import {fileURLToPath} from 'node:url'; import {FCOS_CONNECTION_POLICY} from '../config/fcosConnections.js'; const p=FCOS_CONNECTION_POLICY.providers.find(p=>p.id==='salesforce'); export function sourceInventory(root=join(process.cwd(),p.publication.sourceRoot)){ const files=[];function walk(dir,rel=''){for(const n of readdirSync(dir).sort()){const r=rel?rel+'/'+n:n;if(statSync(join(dir,n)).isDirectory())walk(join(dir,n),r);else files.push(r);}}walk(root);const h=createHash('sha256');for(const f of files){const b=readFileSync(join(root,f));h.update(f);h.update(b);}return {files,sourceTreeHash:h.digest('hex')};} if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const s=JSON.parse(readFileSync(process.env.FCOS_TEST_STATE));s.calls.push({program:'mirror',args:process.argv.slice(2)});writeFileSync(process.env.FCOS_TEST_STATE,JSON.stringify(s));console.log(JSON.stringify({repository:p.publication.repository,account:p.publication.requiredAccount,sourceTreeHash:sourceInventory().sourceTreeHash,sourceEnvironment:'devee',pullRequest:{isDraft:process.env.FCOS_TEST_BAD_MIRROR!=='1',url:'https://github.com/ivanyk20/fcbhk/pull/123'}}));}`);
  file(root, 'bin/sf', `#!${process.execPath}\nimport {readFileSync,writeFileSync} from 'node:fs';import {FCOS_CONNECTION_POLICY} from '../config/fcosConnections.js';const p=FCOS_CONNECTION_POLICY.providers.find(p=>p.id==='salesforce');const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],alias=value('--target-org'),e=p.environments.find(e=>e.alias===alias),s=JSON.parse(readFileSync(process.env.FCOS_TEST_STATE));s.calls.push({program:'sf',args});let result;if(args[0]==='org'&&args[1]==='display') result={id:process.env.FCOS_TEST_MISMATCH===e.key?'wrong':e.orgId,username:e.username||'production@example.invalid',connectedStatus:'Connected'};else if(args[0]==='data')result={records:value('--query').includes('FROM Organization')?[{Id:e.orgId,IsSandbox:e.isSandbox}]:[{Id:'permission'}]};else if(args[2]==='report'){const j=s.jobs[value('--job-id')];if(!j)throw Error('unknown job');result={id:j.id,status:j.status||'Succeeded',success:true,done:true,checkOnly:j.validation,rollbackOnError:true,numberComponentErrors:0,numberTestErrors:0};if(process.env.FCOS_TEST_CRASH_STAGE===e.key&&j.validation&&!s.crashed){s.crashed=true;writeFileSync(process.env.FCOS_TEST_STATE,JSON.stringify(s));process.kill(process.ppid,'SIGKILL');process.exit(0);}}else if(['validate','quick','start'].includes(args[2])){if(args[2]==='quick'&&!s.jobs[value('--job-id')]?.validation)throw Error('quick deploy must consume validation');const id='0Af'+String(s.next++).padStart(12,'0');s.jobs[id]={id,validation:args[2]==='validate',environment:e.key};result=process.env.FCOS_TEST_NO_RECEIPT===e.key?{}:{id};}else throw Error('unexpected sf command '+args.join(' '));writeFileSync(process.env.FCOS_TEST_STATE,JSON.stringify(s));console.log(JSON.stringify({status:0,result}));`);
  chmodSync(join(root, 'bin/sf'), 0o755);
  const invoke = (env = {}, extra = []) => spawnSync(process.execPath, ['scripts/deploy-salesforce-environments.mjs', '--manifest', 'manifest/change.xml', ...extra], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, FCOS_TEST_STATE: statePath, ...env }, timeout: 30000,
  });
  const state = () => JSON.parse(readFileSync(statePath));
  const submissions = () => state().calls.filter(c => c.program === 'sf' && ['validate', 'quick', 'start'].includes(c.args[2]));
  return { root, statePath, invoke, state, submissions };
}

test('actual promotion entrypoint persists jobs, survives crash and resumes downstream without redeploying DEVEE', t => {
  const f = fixture(t);
  const first = f.invoke({ FCOS_TEST_CRASH_STAGE: 'qat' });
  assert.equal(first.signal, 'SIGKILL', first.stdout + first.stderr);
  const files = readdirSync(join(f.root, '.fcos-cli/salesforce-promotions')).filter(p => p.endsWith('.json'));
  const partial = JSON.parse(readFileSync(join(f.root, '.fcos-cli/salesforce-promotions', files[0])));
  assert.equal(partial.stages.devee.deployment.status, 'succeeded');
  assert.equal(partial.stages.qat.validation.status, 'submitted');
  assert.ok(partial.stages.qat.validation.jobId);
  const resumed = f.invoke();
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.deepEqual(f.submissions().map(c => c.args[2]), ['validate', 'quick', 'validate', 'quick', 'validate', 'quick']);
  assert.deepEqual(f.submissions().map(c => c.args[c.args.indexOf('--target-org') + 1]), policy.environments.flatMap(e => [e.alias, e.alias]));
  assert.equal(f.state().calls.filter(c => c.program === 'mirror' && c.args[0] === '--publish').length, 1);
  const again = f.invoke(); assert.equal(again.status, 0, again.stderr); assert.equal(f.submissions().length, 6);
  assert.ok(f.state().calls.some(c => c.program === 'mirror' && c.args[0] === '--check'));
});

test('changed source starts a fresh DEVEE journal while unrelated script edits preserve successful stages', t => {
  const f = fixture(t); assert.equal(f.invoke().status, 0);
  file(f.root, 'unrelated-script.mjs', '// unrelated orchestration edit');
  assert.equal(f.invoke().status, 0); assert.equal(f.submissions().length, 6);
  file(f.root, 'force-app/main/default/classes/Example.cls', 'class Example { /* changed */ }\n');
  assert.equal(f.invoke().status, 0); assert.equal(f.submissions().length, 12);
  assert.equal(f.submissions()[6].args[f.submissions()[6].args.indexOf('--target-org') + 1], policy.environments[0].alias);
});

test('identity mismatch and failed upstream report stop every later promotion mutation', t => {
  const mismatch = fixture(t); const result = mismatch.invoke({ FCOS_TEST_MISMATCH: 'qat' });
  assert.equal(result.status, 1); assert.match(result.stderr, /identity mismatch/); assert.equal(mismatch.submissions().length, 0);
  const f = fixture(t); assert.equal(f.invoke({ FCOS_TEST_CRASH_STAGE: 'qat' }).signal, 'SIGKILL');
  const state = f.state(); const devee = Object.values(state.jobs).find(j => j.environment === 'devee' && !j.validation); state.jobs[devee.id].status = 'Failed'; writeFileSync(f.statePath, JSON.stringify(state));
  const resumed = f.invoke(); assert.equal(resumed.status, 1); assert.match(resumed.stderr, /all-or-none proof/); assert.equal(f.submissions().length, 3);
});

test('shared publication must be byte-equivalent DEVEE source with draft PR before QAT', t => {
  const f = fixture(t); const result = f.invoke({ FCOS_TEST_BAD_MIRROR: '1' });
  assert.equal(result.status, 1); assert.match(result.stderr, /open draft PR/);
  assert.deepEqual(f.submissions().map(c => c.args[2]), ['validate', 'quick']);
});

test('schema bootstrap is small, precedes full package in every org, and full validation uses RunLocalTests', t => {
  const f = fixture(t); const result = f.invoke({}, ['--schema-cutover', '--schema-bootstrap', 'manifest/bootstrap.xml']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.submissions().map(c => c.args[2]), ['start', 'validate', 'quick', 'start', 'validate', 'quick', 'start', 'validate', 'quick']);
  for (const c of f.submissions().filter(c => c.args[2] === 'validate')) assert.equal(c.args[c.args.indexOf('--test-level') + 1], 'RunLocalTests');
  assert.deepEqual(f.submissions().filter(c => c.args[2] === 'start').map(c => c.args[c.args.indexOf('--test-level') + 1]), ['NoTestRun', 'NoTestRun', 'RunRelevantTests']);
  assert.ok(f.submissions().every(c => c.args.includes('--async') && !c.args.includes('--ignore-errors')));
});

test('actual uncertain submission cannot be duplicated on resume', t => {
  const f = fixture(t);
  const first = f.invoke({ FCOS_TEST_NO_RECEIPT: 'devee' });
  assert.equal(first.status, 1); assert.match(first.stderr, /no job ID/); assert.equal(f.submissions().length, 1);
  const resumed = f.invoke();
  assert.equal(resumed.status, 1); assert.match(resumed.stderr, /uncertain submission/); assert.equal(f.submissions().length, 1);
});

test('uncertain submission without job ID refuses duplicate execution and report proofs are strict', t => {
  const root = mkdtempSync(join(tmpdir(), 'fcos-journal-unit-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const binding = { sourceTreeHash: 'a'.repeat(64) };
  const journal = openSalesforcePromotionJournal({ directory: root, binding });
  journal.update('devee', 'validation', { status: 'submitting' }); journal.close();
  const resumed = openSalesforcePromotionJournal({ directory: root, binding });
  assert.equal(resumed.state.stages.devee.validation.status, 'submitting'); resumed.close();
  const valid = { id: 'job', status: 'Succeeded', success: true, done: true, checkOnly: true, rollbackOnError: true };
  assert.equal(assertSuccessfulSalesforceReport(valid, { validation: true, jobId: 'job', environment: policy.environments[0] }).jobId, 'job');
  for (const change of [{ checkOnly: false }, { rollbackOnError: false }, { done: false }, { id: 'other' }, { numberTestErrors: 1 }]) assert.throws(() => assertSuccessfulSalesforceReport({ ...valid, ...change }, { validation: true, jobId: 'job', environment: policy.environments[0] }), /proof/);
});
