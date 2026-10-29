import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require=createRequire(import.meta.url),yaml=require('js-yaml');
const load=path=>yaml.load(readFileSync(new URL(path,import.meta.url),'utf8'));
const controller=load('../.github/workflows/hosted-release-controller.yml');
const main=load('../.github/workflows/hosted-release.yml');
const bootstrap=load('../.github/qualification/hosted-release-bootstrap.yml');
const image='ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:1cb176a00c6224f94a668f76de51186e2d0b3cd95d631af4289467451caf40ef';
const ids=['preview','observe_before','observe_after','browser_before','browser_after','execute'];
const selected=[...ids.map(id=>[id,controller.jobs[id]]),['main manifest',main.jobs.manifest],['bootstrap manifest',bootstrap.jobs.manifest]];
const checker=job=>job.steps.find(step=>step.name==='Verify admitted trusted runtime');
const script=checker(selected[0][1]).run.replace(/^node --input-type=commonjs <<'NODE'\n/,'').replace(/\nNODE\n?$/,'');

// Execute the exact inline check in a hermetic VM; these are deliberately local
// fake tool observations, not evidence that the private image was pulled or run.
function inspect(overrides={}){
  const calls=[],accesses=[],output=[];
  const runtime={version:'v24.18.0',platform:'linux',arch:'x64',getuid:()=>1001,getgid:()=>1001,
    env:{PLAYWRIGHT_BROWSERS_PATH:'/ms-playwright',GITHUB_TOKEN:'OFFLINE_DUMMY_TOKEN'},...overrides.process};
  const fs={constants:{X_OK:1},readFileSync:()=>JSON.stringify({version:overrides.vercel||'54.20.1'}),
    realpathSync:()=>overrides.vercelPath||'/usr/local/lib/node_modules/vercel/dist/vc.js',
    accessSync:path=>{accesses.push(path);if(path===overrides.missing)throw Error('OFFLINE_MISSING_EXECUTABLE');}};
  const child={spawnSync:(program,args,options)=>{calls.push({program,args,options});return program==='/usr/bin/python3'?{status:0,stdout:overrides.python||'Python 3.11.2\n'}:overrides.result||{status:0,stdout:'Chromium 145.0.0.0\n'};}};
  let error;
  try{runInNewContext(script,{process:runtime,console:{log:value=>output.push(JSON.parse(value))},require:name=>{
    if(name==='node:fs')return fs;if(name==='node:child_process')return child;
    if(name==='playwright')return {chromium:{executablePath:()=>overrides.chromium||'/ms-playwright/chromium-1234/chrome-linux64/chrome'}};
    if(name==='playwright/package.json')return {version:overrides.playwright||'1.62.1'};
    throw Error('UNEXPECTED_IMPORT');
  }},{timeout:1000});}catch(e){error=e;}
  return {calls,accesses,output,error};
}

test('only the eight admitted trusted jobs pull the same literal private image with read-only automatic-token credentials',()=>{
  assert.deepEqual(Object.keys(controller.jobs).filter(id=>controller.jobs[id].container).sort(),[...ids].sort());
  for(const [id,job]of selected){
    assert.deepEqual(job.container,{image,credentials:{username:'hocheunglai-oss',password:'${{ secrets.GITHUB_TOKEN }}'},options:'--user 1001:1001'},id);
    assert.equal(job.permissions.packages,'read',id);assert.equal(job.permissions.contents,'read',id);
    assert.equal(job.defaults.run.shell,'bash',id);
    const {container,...rest}=job;assert.equal(container.credentials.password,'${{ secrets.GITHUB_TOKEN }}');
    assert.doesNotMatch(JSON.stringify(rest),/secrets\.GITHUB_TOKEN/,id);
    assert.doesNotMatch(JSON.stringify(job.container),/fromJSON|inputs\.|vars\.|privileged|docker\.sock|volumes|--user (?:0|root)/,id);
    assert.equal(Object.values(job.permissions).some(value=>value==='write'),['preview','observe_before','observe_after','execute'].includes(id),id);
    for(const [name,value]of Object.entries(job.permissions))if(value==='write')assert.equal(name,'id-token');
  }
  assert.equal(main.jobs.manifest.permissions['id-token'],undefined);
  assert.equal(bootstrap.jobs.manifest.permissions['id-token'],undefined);
  assert.equal(controller.permissions&&Object.keys(controller.permissions).length,0);
});

test('trusted image check precedes candidate data and provider commands while replacing all downloads in those jobs',()=>{
  const dockerfile=readFileSync(new URL('../deploy/hosted-checks.Dockerfile',import.meta.url),'utf8');
  assert.match(dockerfile,/FROM node:24\.18\.0-bookworm/);assert.match(dockerfile,/PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright/);
  assert.match(dockerfile,/playwright@1\.62\.1.*install --with-deps chromium chrome/);assert.match(dockerfile,/vercel@54\.20\.1/);assert.match(dockerfile,/USER 1001:1001/);
  for(const [id,job]of selected){
    const check=checker(job),index=job.steps.indexOf(check),install=job.steps.findIndex(step=>step.run==='npm ci --ignore-scripts --no-audit --no-fund');
    assert.equal(check.run,checker(selected[0][1]).run,id);assert.equal(check['working-directory'],'controller');assert.equal(check['timeout-minutes'],1);assert.equal(check.env,undefined);
    assert.ok(index>install&&install>0,id);
    const provider=job.steps.findIndex(step=>step.name==='Run admitted checks'||step.name==='Prepare actual qualification manifest'||step.name==='Prepare actual manifest');
    assert.ok(provider>index,id);
    if(id!=='main manifest')assert.ok(index<job.steps.findIndex(step=>step.with?.path==='candidate'),id);
    assert.doesNotMatch(JSON.stringify(job.steps),/playwright install|npm install --global|actions\/setup-node/,id);
    for(const step of job.steps.filter(step=>step.run)){
      assert.notEqual(step['working-directory'],'candidate',id);assert.doesNotMatch(step.run,/cd candidate|npm (?:run|ci).*candidate|docker run/,id);
    }
  }
  assert.equal(main.jobs.manifest.env.FCOS_CONTROLLER_SHA,'6a3fbd8fd05a76c052e7e380d618aedf43e5b72e');
  assert.equal(bootstrap.jobs.manifest.env.FCOS_CONTROLLER_SHA,'__FCOS_CONTROLLER_SHA__');
  assert.match(bootstrap.jobs.setup_discovery.steps.find(step=>step.name==='Install trusted runtime browser').run,/playwright install/);
});

test('candidate execution keeps its separate credential-free Docker sandbox and unchanged dependencies/approval boundaries',()=>{
  const checks=controller.jobs.checks;
  assert.equal(checks.container,undefined);assert.equal(checks.environment,undefined);assert.deepEqual(checks.permissions,{contents:'read',packages:'read'});
  assert.doesNotMatch(JSON.stringify(checks),/secrets\./);assert.equal(checks.steps.find(step=>step.name==='Run admitted checks').run,'node controller/scripts/hosted-release.mjs checks');
  assert.equal(checks.steps.find(step=>step.name==='Pull admitted credential-free image').env.CHECK_IMAGE,'${{ fromJSON(inputs.manifest).verification.runtime.image }}');
  const isolation=readFileSync(new URL('../scripts/lib/hosted-release/isolation.mjs',import.meta.url),'utf8');
  assert.match(isolation,/CANDIDATE_CREDENTIAL_ENVIRONMENT/);assert.match(isolation,/--cap-drop=ALL/);assert.match(isolation,/--security-opt=no-new-privileges/);
  assert.doesNotMatch(isolation,/docker\.sock/);
  for(const id of ids)assert.ok(controller.jobs[id].needs.includes('prepare'));
  assert.equal(controller.jobs.production.environment.name,'fcos-production-release');
  assert.equal(controller.jobs.execute.environment,'fcos-hosted-production-resume');
  assert.equal(controller.concurrency['cancel-in-progress'],false);
});

test('exact cheap runtime check validates Linux x64 UID/GID Node/PW/Vercel and installed browsers with only three bounded local version commands',()=>{
  const result=inspect();assert.equal(result.error,undefined);assert.equal(result.output.length,1);
  assert.equal(result.output[0].node,'v24.18.0');assert.equal(result.output[0].python,'Python 3.11.2');assert.equal(result.output[0].browserAvailabilityVerified,true);
  assert.deepEqual(result.calls.map(call=>call.program),['/usr/bin/python3','/ms-playwright/chromium-1234/chrome-linux64/chrome','/opt/google/chrome/chrome']);
  assert.ok(result.accesses.includes('/usr/local/bin/vercel'));
  for(const call of result.calls){assert.deepEqual(Array.from(call.args),['--version']);assert.equal(call.options.timeout,5000);assert.equal(call.options.maxBuffer,4096);
    assert.deepEqual(Object.keys(call.options.env),['PATH']);assert.equal(call.options.env.PATH,'/usr/local/bin:/usr/bin:/bin');}
  assert.doesNotMatch(JSON.stringify(result.output),/OFFLINE_DUMMY_TOKEN/);
});

test('runtime/platform/identity/version/path mismatch stops before browser calls without download or fallback',()=>{
  for(const overrides of [{process:{version:'v22.0.0'}},{process:{platform:'darwin'}},{process:{arch:'arm64'}},{process:{getuid:()=>0}},
    {process:{getgid:()=>0}},{process:{env:{PLAYWRIGHT_BROWSERS_PATH:'/unexpected'}}},{playwright:'1.61.0'},{vercel:'54.20.0'},
    {vercelPath:'/other/vercel'},{chromium:'/tmp/untrusted-chromium'},{missing:'/usr/local/bin/vercel'}]){
    const result=inspect(overrides);assert.ok(result.error);assert.equal(result.calls.length,0);assert.equal(result.output.length,0);
  }
});

test('missing or failed browser terminates the check before any later local command',()=>{
  const missing=inspect({missing:'/ms-playwright/chromium-1234/chrome-linux64/chrome'});assert.ok(missing.error);assert.equal(missing.calls.length,1);
  const chromeMissing=inspect({missing:'/opt/google/chrome/chrome'});assert.ok(chromeMissing.error);assert.equal(chromeMissing.calls.length,2);
  for(const result of [{status:1,stdout:''},{status:null,signal:'SIGTERM',stdout:''},{status:0,stdout:'unrecognized'},
    {status:0,stdout:'Chromium 145.0.0.0',error:{code:'ETIMEDOUT'}}]){
    const checked=inspect({result});assert.match(checked.error.message,/HOSTED_TRUSTED_BROWSER_UNAVAILABLE/);assert.equal(checked.calls.length,2);assert.equal(checked.output.length,0);
  }
});

test('the admitted actual Python protocol mismatch stops before either browser command',()=>{const result=inspect({python:'Python 3.12.3'});assert.match(result.error.message,/HOSTED_TRUSTED_PYTHON_MISMATCH/);assert.equal(result.calls.length,1);assert.equal(result.calls[0].program,'/usr/bin/python3');assert.equal(result.output.length,0);});
