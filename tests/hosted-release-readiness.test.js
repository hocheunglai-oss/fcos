import { retainedQualitySteps } from './helpers/retainedQualitySteps.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { digest, NORMAL_MODULES } from '../scripts/lib/hosted-release/contract.mjs';
import { admittedReadiness, consumeHostedReadiness, createReadinessReader, READINESS_JOB, readinessArtifactName,
  readinessDigest, validateReadinessBinding, verifyReadinessBrowsers, verifyReadinessDeterministic, waitForHostedReadiness } from '../scripts/lib/hosted-release/readiness.mjs';
import { hostedReadinessEntrypoint, produceHostedReadiness } from '../scripts/hosted-release-readiness.mjs';

const require = createRequire(import.meta.url), H = 'a'.repeat(64);
test('failed Preview keeps its exact result artifact without changing the failed run outcome', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml', import.meta.url), 'utf8'));
  const preview = workflow.jobs.preview, run = preview.steps.find(step => step.id === 'run');
  const upload = preview.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(run.run, 'node controller/scripts/hosted-release.mjs preview');
  assert.notEqual(run['continue-on-error'], true);
  assert.equal(preview.env.FCOS_RELEASE_OUTPUT, 'preview.json');
  assert.equal(upload.if, "${{ always() && steps.run.outcome != 'skipped' && steps.run.outcome != '' }}");
  assert.equal(upload.with.path, 'preview.json');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 30);
  assert.equal(upload.with.overwrite, false);
});
function zip(filename, payload) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-readiness-zip-'));
  try { writeFileSync(join(directory, filename), JSON.stringify(payload)); execFileSync('zip', ['-q','proof.zip',filename], { cwd: directory }); return readFileSync(join(directory, 'proof.zip')); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
function fixture() {
  const now = Date.now(), iso = offset => new Date(now + offset).toISOString(), manifest = fixtureManifest();
  manifest.candidate.sourceProfile = 'frozen_04ee';
  manifest.candidate.sourceInputsSha256 = H;
  manifest.verification = { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' }, publicBuildEnvironment: {}, projectSettings: {} };
  manifest.requiredChecks.push('unit');
  const setup = { schemaVersion: 2, controllerSha: manifest.controller.sha, epoch: manifest.epoch, targetsSha256: digest(manifest.targets), verification: manifest.verification };
  manifest.setupSha256 = digest(setup);
  const activation = { schemaVersion: 1, mode: 'active', controllerSha: manifest.controller.sha, epoch: manifest.epoch,
    setupSha256: manifest.setupSha256, activationReceiptSha256: 'd'.repeat(64) };
  const repository = { id: 1278654816, full_name: manifest.targets.repository, default_branch: 'main', owner: { id: 265701760, login: 'hocheunglai-oss' } };
  const admission = admittedReadiness({ enabled: 'true', setupJson: JSON.stringify(setup), setupSha256: digest(setup), activationJson: JSON.stringify(activation), repository: repository.full_name, repositoryId: repository.id });
  const run = id => ({ id, run_attempt: 1, event: 'workflow_dispatch', path: '.github/workflows/hosted-release.yml', head_branch: 'main', head_sha: 'e'.repeat(40),
    status: 'in_progress', conclusion: null, repository, head_repository: repository, actor: repository.owner, triggering_actor: repository.owner,
    referenced_workflows: [{ path: `${repository.full_name}/${manifest.controller.workflow}@${manifest.controller.sha}`, sha: manifest.controller.sha }] });
  const originalRun = run(13), readyRun = run(17);
  const job = (id, name, start, end) => ({ id, name, run_id: originalRun.id, run_attempt: 1, head_sha: originalRun.head_sha,
    status: 'completed', conclusion: 'success', started_at: iso(start), completed_at: iso(end), steps: [{ name: 'Run admitted checks', status: 'completed', conclusion: 'success' }] });
  const jobs = { total_count: 3, jobs: [job(21,'release / browser / before / restricted',-20000,-10000),
    job(22,'release / browser / before / normal_role',-20000,-10000), job(23,'release / checks / code',-30000,-21000)] };
  const readyJob = { ...job(27,READINESS_JOB,-3000,-2000), run_id: readyRun.id, head_sha: readyRun.head_sha };
  const readyJobs = { total_count: 1, jobs: [readyJob] };
  const preview = { id: 'dpl_preview', sha: manifest.candidate.sha, state: 'READY', target: 'preview', projectId: manifest.targets.vercelProject,
    teamId: manifest.targets.vercelTeam, url: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app' };
  const checks = Object.fromEntries(manifest.requiredChecks.map(checkId => [checkId, { schemaVersion: 2, checkId, status: 'passed', kind: 'volatile',
    manifestHash: digest(manifest), candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha, inputsSha256: H, artifactSha256: H,
    capturedAt: iso(-11000), maxAgeSeconds: 1800, publisher: { trust: 'hosted_controller', runId: 13, jobId: 21, artifactId: 31 },
    result: { identity: 'restricted', modules: ['dashboard','markets','api_denials'], actualData: true, unexpectedWrites: 0, serverBundlesRequired: true } }]));
  checks.normal_role.result = { identity: 'normal_role', modules: [...NORMAL_MODULES], actualData: true, unexpectedWrites: 0 };
  checks.normal_role.publisher = { trust: 'hosted_controller', runId: 13, jobId: 22, artifactId: 32 };
  const browserReports = ['restricted','normal_role'].map(mode => {
    const id = mode === 'restricted' ? 'restricted_browser' : mode, proof = checks[id];
    return { schemaVersion: 2, kind: 'fcos_hosted_browser_raw', status: 'passed', checkId: id, manifestHash: digest(manifest),
      candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha, sourceSha256: manifest.candidate.sourceSha256,
      deploymentId: preview.id, candidateUrl: preview.url, inputsSha256: H, completedAt: proof.capturedAt, capturedAt: proof.capturedAt, result: proof.result };
  });
  const rawBinding = { candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha, sourceProfile: manifest.candidate.sourceProfile,
    sourceInputsSha256: manifest.candidate.sourceInputsSha256, lockSha256: manifest.candidate.lockSha256, configurationSha256: manifest.candidate.configurationSha256,
    manifestSha256: manifest.controller.checkManifestSha256, buildConfigurationSha256: digest(manifest.verification), runtime: manifest.verification.runtime };
  const rawChecks = ['unit','server_bundles','server_performance'].map(checkId => ({ schemaVersion: 2, checkId, status: 'passed',
    startedAt: iso(-29000), completedAt: iso(-22000), binding: rawBinding, commands: [{ program: 'node', args: ['--test'], exitCode: 0 }] }));
  for (const rawCheck of rawChecks) Object.assign(checks[rawCheck.checkId], { kind: 'deterministic', capturedAt: rawCheck.completedAt,
    inputsSha256: digest(rawBinding), publisher: { trust: 'hosted_controller', runId: 13, jobId: 23, artifactId: 33 }, result: { rawCheck, binding: rawBinding, serverBundlesRequired: true } });
  const deterministicReport = { schemaVersion: 2, kind: 'fcos_hosted_release_checks', status: 'failed', candidateSha: manifest.candidate.sha,
    controllerSha: manifest.controller.sha, runtime: manifest.verification.runtime, checks: [...rawChecks, { checkId: 'unrelated_failed', status: 'failed' }] };
  const artifacts = { total_count: 3, artifacts: ['restricted','normal_role','code'].map((mode, i) => ({ id: 31 + i,
    name: i < 2 ? `fcos-${manifest.releaseId}-before-${mode}` : `fcos-${manifest.releaseId}-code`, expired: false,
    workflow_run: { id: originalRun.id, head_sha: originalRun.head_sha }, created_at: iso(i < 2 ? -10500 : -21500) })) };
  const readyArtifact = { id: 37, name: readinessArtifactName(manifest.candidate.sha), expired: false, workflow_run: { id: readyRun.id, head_sha: readyRun.head_sha }, created_at: iso(-2500) };
  const snapshot = { mode: 'active', epoch: manifest.epoch, checks: { ...checks, 'preview.ready': { result: preview } } };
  const f = { now, iso, manifest, setup, activation, admission, repository, originalRun, readyRun, jobs, readyJobs, preview, checks,
    browserReports, deterministicReport, artifacts, readyArtifact, snapshot, calls: [], archives: new Map() };
  f.repack = () => {
    for (const [i, report] of [...f.browserReports,f.deterministicReport].entries()) {
      const id = 31 + i, bytes = zip(i === 0 ? 'restricted.json' : i === 1 ? 'normal-role.json' : 'code.json', report);
      f.archives.set(id, bytes); f.artifacts.artifacts[i].digest = `sha256:${digest(bytes)}`;
      for (const proof of Object.values(f.checks)) if (proof.publisher.artifactId === id) proof.artifactSha256 = digest(bytes);
    }
    f.receipt = { schemaVersion: 1, kind: 'fcos_hosted_preview_readiness', manifest: f.manifest, manifestHash: digest(f.manifest), mode: f.snapshot.mode,
      epoch: f.snapshot.epoch, setupSha256: f.manifest.setupSha256, activationReceiptSha256: f.activation.activationReceiptSha256,
      readyAt: f.iso(-2800), preview: f.preview, checks: f.checks };
    const bytes = zip('hosted-readiness.json',f.receipt); f.archives.set(37,bytes); f.readyArtifact.digest = `sha256:${digest(bytes)}`;
  };
  f.repack();
  f.read = async (path, options = {}) => {
    f.calls.push({ path, bytes: !!options.bytes }); const prefix = `/repos/${f.repository.full_name}`;
    if (path === prefix) return f.repository;
    if (path === `${prefix}/branches/main`) return { name: 'main', protected: true, commit: { sha: 'f'.repeat(40) } };
    if (path.includes('/actions/artifacts?name=')) return { total_count: f.noReadyArtifact ? 0 : 1, artifacts: f.noReadyArtifact ? [] : [f.readyArtifact] };
    if (path === `${prefix}/actions/runs/13`) return f.originalRun;
    if (path === `${prefix}/actions/runs/17`) return f.readyRun;
    if (path.includes('/runs/13/attempts/1/jobs')) return f.jobs;
    if (path.includes('/runs/17/attempts/1/jobs')) return f.readyJobs;
    if (path.includes('/runs/13/artifacts')) return f.artifacts;
    if (path.includes('/environments/')) return { id: path.includes('restricted') ? 51 : 52, name: path.split('/').at(-1), can_admins_bypass: false,
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }, protection_rules: f.reviewers || [] };
    const match = path.match(/\/artifacts\/([0-9]+)\/zip$/); if (match) { assert.equal(options.bytes, true); return f.archives.get(Number(match[1])); }
    assert.fail(`Unexpected read ${path}`);
  };
  f.github = { identity: async () => f.repository, read: f.read };
  f.coordinator = { snapshot: async binding => { assert.equal(binding.manifestHash, digest(f.manifest)); return f.snapshot; } };
  return f;
}

test('exact entrypoint publishes active Preview readiness before final approval with unchanged original proof clocks', async t => {
  const f = fixture(), directory = mkdtempSync(join(tmpdir(), 'fcos-readiness-cli-')); t.after(() => rmSync(directory,{recursive:true,force:true}));
  const output = join(directory,'receipt.json'), githubOutput = join(directory,'github-output');
  const env = { FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest), FCOS_HOSTED_READINESS_ENABLED: 'true', FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(f.setup),
    FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(f.setup), FCOS_HOSTED_READINESS_ACTIVATION: JSON.stringify(f.activation),
    GITHUB_REPOSITORY: f.repository.full_name, GITHUB_REPOSITORY_ID: String(f.repository.id), GITHUB_OUTPUT: githubOutput, FCOS_RELEASE_OUTPUT: output };
  let sessions = 0;
  const result = await hostedReadinessEntrypoint({ env, now: () => f.now, sessionFactory: async args => { sessions++; assert.equal(args.jobName,READINESS_JOB); return f; } });
  assert.equal(result.accepted,true); assert.equal(sessions,1);
  assert.equal(JSON.parse(readFileSync(output)).checks.normal_role.capturedAt,f.checks.normal_role.capturedAt);
  assert.match(readFileSync(githubOutput,'utf8'),/ready=true/);
  assert.equal(f.readyRun.status,'in_progress'); assert.equal(f.snapshot.approval,undefined);
  assert.ok(f.calls.every(call => !call.path.includes('approvals')));
});

test('actual CLI stays inactive without touching credentials or emitting a merge receipt', t => {
  const f = fixture(), directory = mkdtempSync(join(tmpdir(), 'fcos-readiness-disabled-')); t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output = execFileSync(process.execPath,['scripts/hosted-release-readiness.mjs'],{ cwd:process.cwd(), env:{ PATH:process.env.PATH,
    FCOS_RELEASE_MANIFEST:JSON.stringify(f.manifest), FCOS_HOSTED_READINESS_ENABLED:'false', FCOS_RELEASE_OUTPUT:join(directory,'receipt.json') },encoding:'utf8' });
  assert.deepEqual(JSON.parse(output),{status:'inactive',ready:false});
});

test('both active required statuses consume one genuine readiness receipt despite unrelated main tip drift and a pending Production gate',async()=>{
  const f=fixture(),result=await consumeHostedReadiness({admission:f.admission,candidateSha:f.manifest.candidate.sha,read:f.read,now:f.now});
  assert.equal(result.accepted,true);assert.equal(result.artifactId,37);assert.equal(result.artifactSha256,digest(f.archives.get(37)));
  assert.equal(f.readyRun.conclusion,null);assert.equal(f.deterministicReport.status,'failed');
  assert.equal(f.calls.filter(x=>x.bytes).length,4);
});

for(const[label,change]of[
 ['stale original browser',f=>{f.checks.normal_role.capturedAt=f.iso(-1801000);f.browserReports[1].capturedAt=f.checks.normal_role.capturedAt;f.browserReports[1].completedAt=f.checks.normal_role.capturedAt;}],
 ['qualification receipt',f=>{f.manifest.stage='qualification';f.manifest.executionMode='qualification';}],
 ['qualification epoch',f=>{f.snapshot.mode='qualification';}],
 ['stale epoch',f=>{f.snapshot.epoch++;}],
 ['different candidate',f=>{f.manifest.candidate.sha='1'.repeat(40);}],
 ['changed controller',f=>{f.manifest.controller.sha='2'.repeat(40);}],
 ['changed setup',f=>{f.manifest.setupSha256='3'.repeat(64);}],
 ['other activation receipt',f=>{f.activation.activationReceiptSha256='4'.repeat(64);}],
 ['failed restricted job',f=>{f.jobs.jobs[0].conclusion='failure';}],
 ['skipped normal job',f=>{f.jobs.jobs[1].conclusion='skipped';}],
 ['wrong producer step',f=>{f.jobs.jobs[1].steps[0].name='other';}],
 ['wrong producer run',f=>{f.checks.normal_role.publisher.runId=17;}],
 ['wrong admitted reusable controller',f=>{f.originalRun.referenced_workflows[0].sha='4'.repeat(40);}],
 ['untrusted caller workflow',f=>{f.originalRun.path='.github/workflows/arbitrary.yml';}],
 ['wrong repository',f=>{f.originalRun.repository={...f.repository,id:1};}],
 ['rerun',f=>{f.originalRun.run_attempt=2;}],
 ['missing normal module',f=>{f.browserReports[1].result.modules.pop();}],
 ['unexpected browser write',f=>{f.browserReports[1].result.unexpectedWrites=1;}],
 ['different Preview build',f=>{f.browserReports[1].deploymentId='dpl_other';}],
 ['raw browser source changed',f=>{f.browserReports[0].sourceSha256='5'.repeat(64);}],
 ['incomplete producer jobs page',f=>{f.jobs.total_count++;}],
 ['duplicate browser archive',f=>{f.artifacts.artifacts.push({...f.artifacts.artifacts[0],id:41});f.artifacts.total_count++;}],
 ['archive before producer',f=>{f.artifacts.artifacts[0].created_at=f.iso(-40000);}],
 ['bypassable or intermediate reviewer gate',f=>{f.reviewers=[{type:'required_reviewers'}];}],
 ['forged deterministic raw record',f=>{f.deterministicReport.checks[0]={...f.deterministicReport.checks[0],commands:[{exitCode:1}]};}],
 ['missing deterministic producer',f=>{f.jobs.jobs[2].conclusion='failure';}],
 ['deterministic source binding changed',f=>{f.checks.unit.inputsSha256='9'.repeat(64);}],
])test(`shared consumer rejects ${label}`,async()=>{
 const f=fixture(),candidate=f.manifest.candidate.sha;change(f);f.repack();
 const result=await consumeHostedReadiness({admission:f.admission,candidateSha:candidate,read:f.read,now:f.now});assert.equal(result.accepted,false);
});

test('immutable archive digest mismatch and fake check name cannot substitute for actual trusted jobs',async()=>{
 const f=fixture();f.artifacts.artifacts[0].digest=`sha256:${'0'.repeat(64)}`;
 await assert.rejects(verifyReadinessBrowsers({receipt:f.receipt,admission:f.admission,repository:f.repository,read:f.read,now:f.now}));
 f.repack();f.jobs.jobs[2].name='code-and-database';
 await assert.rejects(verifyReadinessDeterministic({receipt:f.receipt,admission:f.admission,repository:f.repository,read:f.read}));
});

test('pending receipt remains waiting through bounded list polling, without resubmission or repeated immutable archive reads',async()=>{
 const f=fixture();f.noReadyArtifact=true;let clock=f.now,waits=0;
 const result=await waitForHostedReadiness({admission:f.admission,candidateSha:f.manifest.candidate.sha,read:f.read,now:()=>clock,attempts:3,
   wait:async ms=>{waits++;clock+=ms;}});
 assert.equal(result.status,'waiting_dependency');assert.equal(result.code,'HOSTED_READINESS_TIMEOUT');assert.equal(result.dependencyCode,'HOSTED_READINESS_PENDING');assert.equal(waits,2);
 assert.equal(f.calls.filter(x=>x.path.includes('/actions/artifacts?')).length,3);assert.equal(f.calls.filter(x=>x.bytes).length,0);
 const read=createReadinessReader({read:f.read});await read('/repos/'+f.repository.full_name+'/actions/artifacts/31/zip',{bytes:true});await read('/repos/'+f.repository.full_name+'/actions/artifacts/31/zip',{bytes:true});
 assert.equal(f.calls.filter(x=>x.bytes).length,1);
});

test('reader bounds concurrency to two and leaves provider budget for bootstrap reads',async()=>{
 let running=0,maximum=0,clock=0;const starts=[],waits=[];
 const read=createReadinessReader({now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},read:async()=>{running++;maximum=Math.max(maximum,running);starts.push(clock);await new Promise(resolve=>setImmediate(resolve));running--;return{};}});
 await Promise.all(Array.from({length:45},(_,i)=>read(`/read/${i}`)));
 assert.ok(maximum<=2);assert.ok(waits.some(ms=>ms>=60000));assert.equal(starts.filter(x=>x<60000).length,40);
});

test('activation is administrator-bound and original receipt clocks cannot be refreshed by a new artifact',async()=>{
 const f=fixture();assert.equal(admittedReadiness({enabled:'false'}),null);
 assert.throws(()=>admittedReadiness({enabled:'true',setupJson:JSON.stringify(f.setup),setupSha256:digest(f.setup),activationJson:JSON.stringify({...f.activation,epoch:3}),repository:f.repository.full_name,repositoryId:f.repository.id}));
 f.receipt.readyAt=f.iso(0);f.receipt.checks.normal_role.capturedAt=f.iso(-1801000);
 assert.throws(()=>validateReadinessBinding({receipt:f.receipt,admission:f.admission,candidateSha:f.manifest.candidate.sha,now:f.now}),{code:'HOSTED_READINESS_EXPIRED'});
 f.snapshot.mode='qualification';assert.equal((await produceHostedReadiness({manifest:f.manifest,coordinator:f.coordinator,github:f.github,admission:f.admission,now:()=>f.now})).accepted,false);
});

test('actual read-only quality entrypoint loads only admitted immutable controller bytes and emits the shared receipt outputs',async()=>{
 const f=fixture(),quality=load(readFileSync(new URL('../.github/workflows/quality.yml',import.meta.url),'utf8'));
 const script=quality.jobs['hosted-readiness'].steps[0].with.script;
 const execute=new(Object.getPrototypeOf(async function(){}).constructor)('github','context','core','require',script);
 const source=readFileSync(new URL('../scripts/lib/hosted-release/readiness.mjs',import.meta.url));
 const outputs={},errors=[],old={};
 const env={FCOS_HOSTED_READINESS_ENABLED:'true',FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(f.setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(f.setup),FCOS_HOSTED_READINESS_ACTIVATION:JSON.stringify(f.activation)};
 for(const[key,value]of Object.entries(env)){old[key]=process.env[key];process.env[key]=value;}
 try{
 await execute({rest:{repos:{getContent:async args=>{assert.equal(args.ref,f.manifest.controller.sha);return{data:{type:'file',path:args.path,encoding:'base64',size:source.length,content:source.toString('base64'),sha:createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${source.length}\0`),source])).digest('hex')}};}}},
   request:async(route)=>{assert.match(route,/^GET \/repos\//);const path=route.slice(4);return{data:await f.read(path,{bytes:path.endsWith('/zip')})};}},
 {repo:{owner:'hocheunglai-oss',repo:'fcos'},payload:{repository:f.repository,pull_request:{head:{sha:f.manifest.candidate.sha}}}},
 {setOutput:(key,value)=>{outputs[key]=value;},setFailed:value=>errors.push(value)},require);
 }finally{for(const[key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 assert.deepEqual(errors,[]);assert.equal(outputs.accepted,'true');assert.equal(outputs.artifact_id,'37');assert.equal(outputs.artifact_sha256,readinessDigest(f.archives.get(37)));
 for(const name of ['code-and-database','authenticated-browser']){
  const job=quality.jobs[name];assert.equal(job.needs,'hosted-readiness');assert.match(job.if,/always\(\)/);
  assert.match(job.steps[0].run,/READINESS_RESULT/);assert.match(job.steps[0].env.READINESS_ARTIFACT_SHA256,/needs.hosted-readiness.outputs/);
 }
 assert.deepEqual(quality.jobs['hosted-readiness'].permissions,{actions:'read',contents:'read'});assert.equal(quality.jobs['hosted-readiness'].environment,undefined);
 assert.doesNotMatch(JSON.stringify(quality.jobs['hosted-readiness']),/secrets\.|actions\/checkout|id-token/);
});

test('readiness publication precedes final approval and legacy scripts remain unchanged while disabled',()=>{
 const quality=load(readFileSync(new URL('../.github/workflows/quality.yml',import.meta.url),'utf8'));
 const hosted=load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8'));
 const baseline=load(execFileSync('git',['show','b02a1220b0db06823f03be0f9150871728ec9204:.github/workflows/quality.yml'],{encoding:'utf8'}));
 const legacy=quality.jobs['authenticated-browser'].steps.find(step=>step.name==='Require trusted authenticated-candidate evidence artifact');
 assert.equal(digest(legacy.with.script),'cdd837e4341a2b6890e4ed42fd2a883cd06fa849e8a52cc2af8725d4f73d0e92');
 const code=retainedQualitySteps(quality);
 assert.deepEqual(code,baseline.jobs['code-and-database'].steps);
 assert.ok(hosted.jobs.production.needs.includes('merge_readiness'));assert.match(hosted.jobs.production.if,/needs.merge_readiness.outputs.ready/);
 const job=hosted.jobs.merge_readiness;assert.equal(job.environment,undefined);assert.doesNotMatch(JSON.stringify(job),/secrets\./);
 assert.match(job.steps.find(step=>step.id==='run').run,/hosted-release-readiness\.mjs$/);
 assert.match(job.steps.at(-1).if,/outputs.ready == 'true'/);
});


test('normal readiness arriving after two minutes stays pending and then succeeds without manual recheck',async()=>{
 const f=fixture();f.noReadyArtifact=true;let clock=f.now,waits=0;
 const result=await waitForHostedReadiness({admission:f.admission,candidateSha:f.manifest.candidate.sha,read:f.read,now:()=>clock,
   wait:async ms=>{clock+=ms;waits++;if(clock-f.now>=180000)f.noReadyArtifact=false;}});
 assert.equal(result.accepted,true);assert.equal(waits,6);assert.equal(clock-f.now,180000);
 assert.equal(f.calls.filter(x=>x.bytes).length,4);
 assert.equal(f.checks.normal_role.capturedAt,f.iso(-11000));
});

test('terminal dispatch skips every executable hosted stage while preserving the always-run report',()=>{
 const hosted=load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8'));
 assert.equal(hosted.jobs.prepare.outputs.terminal,'${{ steps.run.outputs.terminal }}');
 assert.equal(hosted.jobs.prepare.outputs.terminal_status,'${{ steps.run.outputs.terminal_status }}');
 for(const[name,job]of Object.entries(hosted.jobs))if(!['prepare','report'].includes(name))assert.match(job.if,/needs\.prepare\.outputs\.terminal != 'true'/,name);
 assert.match(hosted.jobs.report.if,/always\(\)/);assert.doesNotMatch(hosted.jobs.report.if,/terminal/);
 assert.ok(hosted.jobs.report.needs.includes('merge_readiness'));
 const upload=hosted.jobs.execute.steps.at(-1);assert.match(upload.if,/always\(\)/);assert.match(upload.if,/steps.run.outcome/);
 const download=hosted.jobs.report.steps.find(step=>step.uses?.startsWith('actions/download-artifact@'));assert.equal(download['continue-on-error'],true);assert.match(download.if,/success.*failure.*cancelled/);assert.match(download.if,/always\(\)/);
 const report=hosted.jobs.report.steps.find(step=>step.name==='Report observed outcome');assert.match(report.env.FCOS_RELEASE_RESULT_FILE,/success.*failure.*cancelled/);
});


test('new shared validator action is immutable while the legacy consumer action remains unchanged',()=>{
 const quality=load(readFileSync(new URL('../.github/workflows/quality.yml',import.meta.url),'utf8'));
 assert.equal(quality.jobs['hosted-readiness'].steps[0].uses,'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b');
 assert.equal(quality.jobs['authenticated-browser'].steps.at(-1).uses,'actions/github-script@v7');
});


function nearExpiryFixture() {
  const f = fixture(), capturedAt = f.iso(-1790000);
  f.checks.normal_role.capturedAt = capturedAt;
  f.browserReports[1].capturedAt = capturedAt; f.browserReports[1].completedAt = capturedAt;
  Object.assign(f.jobs.jobs[1], { started_at: f.iso(-1800000), completed_at: f.iso(-1780000) });
  f.artifacts.artifacts[1].created_at = f.iso(-1780500); f.repack();
  let clock = f.now;
  return { ...f, clock: () => clock, delayedRead: async (path, options) => {
    const value = await f.read(path, options);
    if (options?.bytes && path.endsWith('/artifacts/32/zip')) clock += 15000;
    return value;
  } };
}

test('consumer rechecks original proof expiry at acceptance after delayed archive download', async () => {
  const f = nearExpiryFixture(), capturedAt = f.checks.normal_role.capturedAt;
  const result = await waitForHostedReadiness({ admission: f.admission, candidateSha: f.manifest.candidate.sha,
    read: f.delayedRead, now: f.clock, attempts: 1 });
  assert.equal(f.clock() - f.now, 15000); assert.equal(result.accepted, false);
  assert.equal(result.status, 'waiting_dependency'); assert.equal(result.code, 'HOSTED_READINESS_TIMEOUT');
  assert.equal(result.dependencyCode, 'HOSTED_READINESS_INVALID');
  assert.equal(f.checks.normal_role.capturedAt, capturedAt);
});

test('producer withholds receipt and final-gate readiness when an original proof expires during downloads', async t => {
  const f = nearExpiryFixture(), root = mkdtempSync(join(tmpdir(), 'fcos-readiness-clock-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'receipt.json'), githubOutput = join(root, 'github-output'), capturedAt = f.checks.normal_role.capturedAt;
  const env = { FCOS_RELEASE_MANIFEST: JSON.stringify(f.manifest), FCOS_HOSTED_READINESS_ENABLED: 'true', FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(f.setup),
    FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(f.setup), FCOS_HOSTED_READINESS_ACTIVATION: JSON.stringify(f.activation),
    GITHUB_REPOSITORY: f.repository.full_name, GITHUB_REPOSITORY_ID: String(f.repository.id), GITHUB_OUTPUT: githubOutput, FCOS_RELEASE_OUTPUT: output };
  const result = await hostedReadinessEntrypoint({ env, now: f.clock,
    sessionFactory: async () => ({ coordinator: f.coordinator, github: { ...f.github, read: f.delayedRead } }) });
  assert.equal(result.accepted, false); assert.equal(result.status, 'waiting_dependency'); assert.deepEqual(result.missing, ['normal_role']);
  assert.match(readFileSync(githubOutput, 'utf8'), /ready=false/);
  assert.equal(existsSync(output), false); assert.equal(f.checks.normal_role.capturedAt, capturedAt);
});
