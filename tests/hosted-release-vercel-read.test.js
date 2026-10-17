import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { digest, validateManifest } from '../scripts/lib/hosted-release/contract.mjs';
import { assertHostedSetup } from '../scripts/lib/hosted-release/admission.mjs';
import { createVercelIntegrationReader, VERCEL_READ_SCOPES } from '../scripts/lib/hosted-release/vercel-read-auth.mjs';
import { createVercelAdapter, createVercelReadAdapter } from '../scripts/lib/hosted-release/vercel.mjs';
import { createLiveCollector } from '../scripts/lib/hosted-release/live-collector.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';

const response=value=>({ok:true,redirected:false,json:async()=>value});
function fixture(){const manifest=fixtureManifest(),credential=admitVercelReadFixture(manifest);return {manifest,...credential};}
function repin(f){f.manifest.setupSha256=digest(f.setup);f.env.FCOS_ADMITTED_RELEASE_SETUP=JSON.stringify(f.setup);f.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256=digest(f.setup);}

test('qualification refuses absent binding and unreviewed or invalid original OAuth proof before provider reads',async()=>{
  const missing=fixtureManifest();missing.stage='qualification';missing.executionMode='qualification';assert.throws(()=>validateManifest(missing),{code:'VERCEL_READ_CREDENTIAL_BINDING'});
  for(const mutate of [f=>{delete f.setup.vercelReadCredentialAcceptance;},f=>{f.setup.vercelReadCredentialAcceptance={source:'helper',verified:true};},f=>{f.setup.vercelReadCredentialAcceptance.json+=' ';},f=>{
    const review=JSON.parse(f.acceptance.json);review.accepted=false;const json=JSON.stringify(review);f.acceptance.json=json;f.acceptance.sha256=digest(json);f.binding.rootAcceptanceSha256=f.acceptance.sha256;
  },f=>{
    const review=JSON.parse(f.acceptance.json);review.originalExchangeReceiptSha256='0'.repeat(64);const json=JSON.stringify(review);f.acceptance.json=json;f.acceptance.sha256=digest(json);f.binding.rootAcceptanceSha256=f.acceptance.sha256;
  },...['invalid',null,0,'2999-01-01T00:00:00Z','1970-01-01T00:00:00Z'].map(reviewedAt=>f=>{
    const review=JSON.parse(f.acceptance.json);review.reviewedAt=reviewedAt;const json=JSON.stringify(review);f.acceptance.json=json;f.acceptance.sha256=digest(json);f.binding.rootAcceptanceSha256=f.acceptance.sha256;
  })]) {
    const f=fixture();f.manifest.stage='qualification';f.manifest.executionMode='qualification';mutate(f);repin(f);let calls=0;
    const reader=createVercelIntegrationReader({...f,fetchImpl:async()=>{calls++;return response(f.configuration);}});
    await assert.rejects(reader.admit(),{code:'VERCEL_READ_OAUTH_PROOF_REQUIRED'});assert.equal(calls,0);
  }
});

test('private bearer fingerprint substitution and writer/client secrets refuse before any request',()=>{
  const f=fixture();let calls=0;
  for(const env of [{...f.env,FCOS_HOSTED_VERCEL_READ_TOKEN:'vcp_BROADER_PROJECT_WRITER_'+ 'z'.repeat(43)},
    {...f.env,FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITE'},{...f.env,VERCEL_TOKEN:'PRIVATE_MANAGER'},
    {...f.env,FCOS_HOSTED_VERCEL_CLIENT_SECRET:'PRIVATE_CLIENT'},{...f.env,OAUTH_CLIENT_SECRET:'PRIVATE_CLIENT'}]) {
    assert.throws(()=>createVercelIntegrationReader({...f,env,fetchImpl:async()=>{calls++;}}),error=>{
      assert.ok(['VERCEL_READ_CREDENTIAL_SUBSTITUTED','VERCEL_READ_WRITE_CREDENTIAL_FORBIDDEN'].includes(error.code));assert.doesNotMatch(error.message,/PRIVATE|BROADER|vcp_/);return true;
    });
  }
  assert.equal(calls,0);
});

test('provider live installation checks exact identity, selected project, scopes and active state',async()=>{
  for(const change of [{id:'icfg_wrong'},{integrationId:'oac_wrong'},{ownerId:'wrong'},{teamId:'wrong'},{projectSelection:'all'},
    {projects:[]},{projects:['prj_wrong']},{projects:[fixture().binding.projectId,'prj_extra']},{scopes:[...VERCEL_READ_SCOPES,'write:deployment']},
    {scopes:['read:project','read:deployment']},{scopes:[...VERCEL_READ_SCOPES,'read:user']},{disabledAt:1},{deletedAt:1},{deleteRequestedAt:1},{status:'error'},{status:null}]) {
    const f=fixture(),calls=[];
    const reader=createVercelIntegrationReader({...f,fetchImpl:async(url,options)=>{calls.push(url.href);assert.equal(options.method,'GET');return response({...f.configuration,...change});}});
    await assert.rejects(reader.get(`/v9/projects/${f.binding.projectId}`),{code:'VERCEL_READ_CONFIGURATION_CHANGED'});assert.equal(calls.length,1);assert.ok(calls[0].includes(`/configuration/${f.binding.configurationId}`));
  }
});

test('each read boundary rechecks configuration and permits only fixed pinned GET routes',async()=>{
  const f=fixture(),calls=[];let changed=false;
  const reader=createVercelIntegrationReader({...f,fetchImpl:async(url,options)=>{
    assert.equal(url.origin,'https://api.vercel.com');assert.equal(url.searchParams.get('teamId'),f.binding.teamId);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);
    calls.push(url.pathname);return response(url.pathname.startsWith('/v1/integrations/')?{...f.configuration,scopes:changed?[...VERCEL_READ_SCOPES,'write:project']:[...VERCEL_READ_SCOPES]}:{id:f.binding.projectId});
  }});
  await reader.get(`/v9/projects/${f.binding.projectId}`);assert.equal(calls.length,2);changed=true;
  await assert.rejects(reader.get('/v13/deployments/dpl_fixture'),{code:'VERCEL_READ_CONFIGURATION_CHANGED'});assert.equal(calls.length,3);
  for(const path of ['/v9/projects/prj_wrong','https://foreign.invalid/','/v5/user/tokens/current','/v2/user',`/v9/projects/${f.binding.projectId}/env`])await assert.rejects(reader.get(path),{code:'VERCEL_READ_ROUTE_FORBIDDEN'});
  assert.equal(calls.length,3);
});

test('setup pin, root acceptance identity and finite reusable local admission horizon remain bound',async()=>{
  const f=fixture();assert.deepEqual(assertHostedSetup({manifest:f.manifest,env:f.env}),JSON.parse(f.env.FCOS_ADMITTED_RELEASE_SETUP));
  assert.throws(()=>createVercelIntegrationReader({...f,now:()=>f.binding.notAfter+1}),{code:'VERCEL_READ_CREDENTIAL_BINDING'});
  f.setup.verification.vercelReadCredential.clientId='oac_substituted';assert.throws(()=>assertHostedSetup({manifest:f.manifest,env:f.env}),{code:'ADMITTED_SETUP_CHANGED'});
});

test('reader cannot bypass the admitted hosted source context',async()=>{
  const f=fixture();f.env.GITHUB_REF='refs/heads/candidate';let calls=0;
  const reader=createVercelIntegrationReader({...f,fetchImpl:async()=>{calls++;return response(f.configuration);}});
  await assert.rejects(reader.admit(),{code:'HOSTED_CONTROLLER_REQUIRED'});assert.equal(calls,0);
});

test('hosted read jobs keep the Integration bearer distinct from unchanged writer PAT slots',()=>{
  const yaml=createRequire(import.meta.url)('js-yaml'),workflow=yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8'));
  for(const job of ['reconcile','observe_before','observe_after']) {
    const env=workflow.jobs[job].steps.find(step=>step.id==='run').env;assert.ok(env.FCOS_HOSTED_VERCEL_READ_TOKEN);assert.equal(env.FCOS_HOSTED_VERCEL_TOKEN,undefined);assert.equal(env.FCOS_HOSTED_VERCEL_TOKEN_ID,undefined);
  }
  const preview=workflow.jobs.preview.steps.find(step=>step.id==='run').env;assert.ok(preview.FCOS_HOSTED_VERCEL_TOKEN);assert.ok(preview.FCOS_HOSTED_VERCEL_TOKEN_ID);assert.equal(preview.FCOS_HOSTED_VERCEL_READ_TOKEN,undefined);
  for(const path of ['../.github/workflows/hosted-release.yml','../.github/qualification/hosted-release-bootstrap.yml']) {
    const caller=yaml.load(readFileSync(new URL(path,import.meta.url),'utf8')),env=caller.jobs.manifest.steps.find(step=>step.id==='manifest').env;
    assert.ok(env.FCOS_HOSTED_VERCEL_READ_TOKEN);assert.equal(env.FCOS_HOSTED_VERCEL_TOKEN,undefined);assert.equal(env.FCOS_HOSTED_VERCEL_TOKEN_ID,undefined);
  }
});

test('restricted workflow selects complete dedicated or existing repository pairs together without normal/runtime exposure',()=>{
  const yaml=createRequire(import.meta.url)('js-yaml'),controller=yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8'));
  const fallback={FCOS_HOSTED_RESTRICTED_FALLBACK_EMAIL:'existing-ci@example.invalid',FCOS_HOSTED_RESTRICTED_FALLBACK_PASSWORD:'EXISTING_PAIR'};
  for(const path of ['../.github/workflows/hosted-release.yml','../.github/qualification/hosted-release-bootstrap.yml']) {
    const caller=yaml.load(readFileSync(new URL(path,import.meta.url),'utf8'));assert.notEqual(caller.jobs.release.secrets,'inherit');
    assert.equal(caller.jobs.release.secrets.FCOS_HOSTED_RESTRICTED_FALLBACK_EMAIL,'${{ secrets.FCOS_E2E_EMAIL }}');
    assert.equal(caller.jobs.release.secrets.FCOS_HOSTED_RESTRICTED_FALLBACK_PASSWORD,'${{ secrets.FCOS_E2E_PASSWORD }}');
  }
  const evaluate=(expression,secrets,mode)=>Function('secrets','matrix',`return (${expression.slice(3,-2)});`)(new Proxy(secrets,{get:(object,key)=>object[key]??''}),{mode});
  for(const id of ['browser_before','browser_after']) {
    const env=controller.jobs[id].steps.find(step=>step.id==='run').env;
    const pair=(secrets,mode='restricted')=>[evaluate(env.FCOS_HOSTED_RESTRICTED_EMAIL,secrets,mode),evaluate(env.FCOS_HOSTED_RESTRICTED_PASSWORD,secrets,mode)];
    assert.deepEqual(pair(fallback),[fallback.FCOS_HOSTED_RESTRICTED_FALLBACK_EMAIL,fallback.FCOS_HOSTED_RESTRICTED_FALLBACK_PASSWORD]);
    for(const partial of [{FCOS_HOSTED_RESTRICTED_EMAIL:'partial@example.invalid'},{FCOS_HOSTED_RESTRICTED_PASSWORD:'PARTIAL'}])assert.deepEqual(pair({...fallback,...partial}),pair(fallback));
    const dedicated={...fallback,FCOS_HOSTED_RESTRICTED_EMAIL:'dedicated-ci@example.invalid',FCOS_HOSTED_RESTRICTED_PASSWORD:'DEDICATED_PAIR'};
    assert.deepEqual(pair(dedicated),[dedicated.FCOS_HOSTED_RESTRICTED_EMAIL,dedicated.FCOS_HOSTED_RESTRICTED_PASSWORD]);
    for(const incomplete of [{FCOS_HOSTED_RESTRICTED_FALLBACK_EMAIL:'partial@example.invalid'},{FCOS_HOSTED_RESTRICTED_FALLBACK_PASSWORD:'PARTIAL'},{}])assert.deepEqual(pair(incomplete),['','']);
    assert.deepEqual(pair(dedicated,'normal_role'),['','']);assert.equal(Object.keys(env).some(key=>key.includes('RESTRICTED_FALLBACK')),false);
    assert.doesNotMatch(env.FCOS_HOSTED_RESTRICTED_EMAIL+env.FCOS_HOSTED_RESTRICTED_PASSWORD,/HOSTED_NORMAL|HOSTED_RUNTIME/);
  }
  for(const [id,job] of Object.entries(controller.jobs))if(!['browser_before','browser_after'].includes(id))assert.doesNotMatch(JSON.stringify(job),/RESTRICTED_FALLBACK|secrets\.FCOS_E2E_(?:EMAIL|PASSWORD)/);
  assert.equal(controller.on.workflow_call.secrets.FCOS_HOSTED_FCUNO_READ_TOKEN.required,false);
});

test('read adapter exposes no write operations and live collector uses it outside writer jobs',async()=>{
  const f=fixture(),options={...f,candidateDirectory:'/tmp/not-executed',execute:()=>assert.fail('Reader cannot run Vercel CLI'),fetchImpl:async(url)=>response(url.pathname.startsWith('/v1/integrations/')?f.configuration:{id:f.binding.projectId})};
  const reader=createVercelReadAdapter(options);for(const method of ['createPreview','stage','promote','rollback','rollbackCompatibility','verifyRollback'])assert.equal(reader[method],undefined);
  await reader.admit(f.manifest,'read');const live=createLiveCollector({session:{manifest:f.manifest,env:f.env},candidateDirectory:options.candidateDirectory,fetchImpl:options.fetchImpl});assert.equal(live.provider.createPreview,undefined);
  const writer=createVercelAdapter({...options,env:{FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITER',FCOS_HOSTED_VERCEL_TOKEN_ID:'writer-id'}});assert.equal(typeof writer.createPreview,'function');assert.equal(typeof writer.stage,'function');
});

test('transport refusal, redirect and malformed JSON never expose provider/private diagnostics',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('PRIVATE_PROVIDER_SECRET');},async()=>({ok:false,redirected:false,status:403,json:async()=>({secret:'PRIVATE'})}),async()=>({ok:true,redirected:true,json:async()=>({secret:'PRIVATE'})}),async()=>({ok:true,redirected:false,json:async()=>{throw new Error('PRIVATE_JSON');}})]) {
    const f=fixture(),reader=createVercelIntegrationReader({...f,fetchImpl});await assert.rejects(reader.admit(),error=>{assert.equal(error.code,'VERCEL_READ_UNAVAILABLE');assert.doesNotMatch(error.message,/PRIVATE/);return true;});
  }
});

test('writer PAT admission still proves finite team/project authority with no integration credential dependency',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'fcos-writer-admission-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  writeFileSync(join(directory,'package-lock.json'),'{}\n');writeFileSync(join(directory,'.gitignore'),'.vercel/\n');writeFileSync(join(directory,'vercel.json'),JSON.stringify({git:{deploymentEnabled:false}}));
  const git=args=>execFileSync('git',args,{cwd:directory,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const source=collectBuildProvenance({cwd:directory,env:{},requireClean:true}),manifest=fixtureManifest(),H='a'.repeat(64),now=Date.now();
  manifest.stage='application';manifest.candidate.sha=source.commit;manifest.candidate.sourceSha256=source.sourceDigest;manifest.candidate.lockSha256=digest('{}\n');manifest.scope.handoffs=[{kind:'status19',sha256:H},{kind:'supplier16',sha256:H}];manifest.scope.compatibilityProductionObservationSha256=H;manifest.requiredChecks.push('compatibility_production_observation');
  const settings={framework:'vite',buildCommand:'npm run build',devCommand:null,installCommand:'npm ci',outputDirectory:'dist',rootDirectory:null,nodeVersion:'24.x'};
  manifest.verification={runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:settings};
  let token={id:'writer-id',expiresAt:now+86400000,scopes:[{type:'team',teamId:manifest.targets.vercelTeam}]};const calls=[];
  const provider=createVercelAdapter({manifest,candidateDirectory:directory,env:{FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITER',FCOS_HOSTED_VERCEL_TOKEN_ID:token.id,FCOS_HOSTED_CREDENTIAL_CLASS:'preview'},now:()=>now,execute:(_command,args)=>{assert.deepEqual(args.slice(0,1),['--version']);return 'Vercel CLI54.20.1'.replace('CLI54','CLI 54');},fetchImpl:async url=>{
    calls.push(url.pathname);if(url.pathname==='/v5/user/tokens/current')return response({token});if(url.pathname==='/v9/projects')return response({projects:[{id:manifest.targets.vercelProject}],pagination:{next:null,count:1}});
    if(url.pathname==='/v2/user'||url.pathname.startsWith('/v2/teams/'))return {status:403};return response({id:manifest.targets.vercelProject,accountId:manifest.targets.vercelTeam,name:'fcos',link:{type:'github',org:'hocheunglai-oss',repo:'fcos',productionBranch:'main',deployHooks:[]},autoAssignCustomDomains:false,...settings});
  }});
  await provider.admit(manifest,'preview');assert.ok(calls.includes('/v5/user/tokens/current'));assert.ok(!calls.some(path=>path.includes('/integrations/')));
  for(const change of [{expiresAt:undefined},{expiresAt:now-1},{scopes:[{type:'team',teamId:'wrong'}]}]){token={...token,...change};await assert.rejects(provider.admit(manifest,'preview'),{code:'VERCEL_TOKEN_AUTHORITY'});token={id:'writer-id',expiresAt:now+86400000,scopes:[{type:'team',teamId:manifest.targets.vercelTeam}]};}
});
