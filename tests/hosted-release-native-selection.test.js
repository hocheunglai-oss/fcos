import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { selectionBuildGuard, selectionDeploymentMetadata, assertSelectionBuildEvidence, selectionSourceDeployRequest } from '../scripts/lib/hosted-release/configuration-selection.mjs';
import { createVercelAdapter, deploymentArguments } from '../scripts/lib/hosted-release/vercel.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { admitPreviewWriterFixture } from './helpers/hosted-vercel-writer.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
import { preparePreview } from '../scripts/lib/hosted-release/controller.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
const H='a'.repeat(64),sha='8f39dde6a6885292ce3b70cb61a78f8b86b947c3';
const originalGuardHash='90db9247fa8ff2744725b3dd7f091c7b9f663c3fba09db6fab903bfe1dbd139f';
// Exact public native projection, captured2026-10-19T18:26:38.776Z. Its terminal
// ERROR must never become READY evidence; only the metadata normalization passes.
const actual={id:'dpl_BHkGtfxU8cDCtskuGUnhpr3GtZie',readyState:'ERROR',source:'cli',builds:[],meta:{githubCommitRef:'HEAD',githubCommitSha:sha,
 fcosSelectionObservation:'036c0dc9b2ef8f37701390c2e7c0be0705b6acf5ccec1c426862037334d317d9',fcosConfigurationSelectionSha256:originalGuardHash}};
function fixture(){
 const m=fixtureManifest();m.candidate.sha=sha;m.candidate.sourceProfile='compat_application_auth_20261018';
 m.verification={runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:{framework:'vite',nodeVersion:'24.x',rootDirectory:null,installCommand:'npm ci',buildCommand:'npm run build',devCommand:null,outputDirectory:'dist'}};
 m.legacyReleaseContainment={schemaVersion:1,policy:'legacy_control_plane_effects_v1',selection:'detached_node24_before_candidate_v1',effects:[
 {importId:'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29',kind:'legacy_preview_env_row',effectSha256:H},
 {importId:'production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0',kind:'production_resume_environment_policy',effectSha256:H}]};
 const guard=selectionBuildGuard(m),url='https://fcos-source123-hocheunglai-6535s-projects.vercel.app',d={id:'dpl_syntheticready',state:'READY',sha,source:'cli',target:'preview',customEnvironment:null,
 gitCommitRef:'HEAD',gitCommitSha:sha,prebuiltFieldPresent:false,prebuiltRaw:null,selectionGuardSha256:digest(guard.nodeOptions),url};
 const logs=[{type:'command',payload:{text:'Running "vercel build"'}},{type:'command',payload:{text:'Running "install" command: `npm ci`...'}},
 {type:'stderr',payload:{text:guard.proof}},{type:'stdout',payload:{text:'> fcos@0.0.0 build'}},{type:'stderr',payload:{text:guard.proof}}];
 const args=['deploy','--target','preview','--yes','--no-wait','--meta','githubCommitSha='+sha,'--meta','fcosSelectionObservation='+digest(m),
 '--meta','fcosConfigurationSelectionSha256='+digest(guard.nodeOptions),'--build-env','NODE_OPTIONS='+guard.nodeOptions,
 '--build-env','FCOS_BUILD_COMMIT_SHA='+sha,'--build-env','FCOS_EXPECTED_SOURCE_SHA256='+m.candidate.sourceSha256];
 const lease={epoch:'production-reconciliation-20261005',objective:'production',ownerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',operationId:'synthetic-local-source-build',leaseId:'10000000-0000-4000-8000-000000000001',bindingSha256:H,coordinationOnly:true,providerAuthorityGranted:false,uncertainOutcomeRequiresReadback:true};
 const actionJson=JSON.stringify({kind:'root_ordinary_preview_observation_action_acceptance_v1',accepted:true,reviewerId:'/root',operationId:lease.operationId,planPacketSha256:digest(m),scriptSha256:H,guardedByActualAcceptedJsPythonSequence:true,existingManagerCredentialOnly:true,productionAuthorityGranted:false,financialAuthorityGranted:false,hostedQualificationAccepted:false});
 lease.bindingSha256=digest(actionJson);
 const native={exit_code:0,output:JSON.stringify({kind:'actual_native_preview_create_ack_v1',completedNativeExitCode:0,packetSha256:digest(m),url,readyProven:false})};
 const proof={kind:'fcos_native_selection_source_build_v1',arguments:args,actionAdmission:{json:actionJson,sha256:digest(actionJson)},
 prepared:{lease,state:'prepared',durable:true,at:'2026-10-19T18:00:00Z'},submitting:{lease,state:'submitting',durable:true,at:'2026-10-19T18:00:01Z'},submitted:{lease,state:'submitted',durable:true,at:'2026-10-19T18:00:03Z'},
 attempt:{operationId:lease.operationId,leaseId:lease.leaseId,packetSha256:digest(m),scriptSha256:H,argsSha256:digest(args),at:'2026-10-19T18:00:02Z',consequentialCreateAttempts:1,uncertainOutcomeReadbackOnly:true},
 guardedNative:{native,guarded:{status:'submitted_acknowledged',providerResult:native,lease}}};
 return {m,d,logs,guard,proof};
}
function hosted(f){const {m,d}=f,production=d.target==='production',phase=production?'production.stage':'preview.create',operationId=`${m.releaseId}-${phase.replaceAll('.','-')}`,requestHash=digest(selectionSourceDeployRequest(m,production)),args=deploymentArguments(m,operationId,production);
 const sourceDeploy={schemaVersion:1,kind:'fcos_hosted_vercel_source_deploy_v1',operationId,phase,requestHash,manifestHash:digest(m),controllerSha:m.controller.sha,candidateSha:m.candidate.sha,argumentsSha256:digest(args),cliVersion:'54.20.1'};
 const operation={operation_id:operationId,operationId,request_hash:requestHash,requestHash,release_id:m.releaseId,epoch:m.epoch,phase,manifest_hash:digest(m),state:'complete',evidence:{outcome:'applied',result:{id:d.id,sourceDeploy}}};
 const registration={release_id:m.releaseId,epoch:m.epoch,manifest_hash:digest(m),manifest:m};
 return {kind:'fcos_hosted_selection_source_build_v1',registration,operation,arguments:args};
}
test('native provider metadata uses actual GitHub namespace, preserves absence, and never upgrades actual ERROR to READY',()=>{
 const normalized=selectionDeploymentMetadata(actual);assert.equal(normalized.gitCommitRef,'HEAD');assert.equal(normalized.gitCommitSha,sha);assert.equal(normalized.prebuiltFieldPresent,false);assert.equal(normalized.prebuiltRaw,null);assert.equal(normalized.source,'cli');
 const f=fixture();assert.throws(()=>assertSelectionBuildEvidence(f.logs,{...f.d,...normalized,state:actual.readyState},f.m,f.proof),/BUILD_UNPROVEN/);
 for(const [key,value] of [['gitCommitRef','foreign'],['gitCommitSha','f'.repeat(40)]])assert.throws(()=>selectionDeploymentMetadata({...actual,meta:{...actual.meta,[key]:value}}),/METADATA_CONFLICT/);
 assert.equal(selectionDeploymentMetadata({...actual,prebuilt:true}).prebuiltRaw,true);assert.equal(selectionDeploymentMetadata({...actual,prebuilt:null}).prebuiltFieldPresent,true);
});
test('native source build requires the original consumed three-state journal, exact argv, completed ACK and ordered provider build sequence',()=>{
 const f=fixture(),result=assertSelectionBuildEvidence(f.logs,f.d,f.m,f.proof);assert.equal(result.buildKind,'provider_source_build');assert.equal(result.prebuiltFieldPresent,false);assert.equal(result.prebuiltRaw,null);assert.equal(result.sourceBuild.operationId,f.proof.prepared.lease.operationId);
 assert.equal(assertSelectionBuildEvidence(f.logs,{...f.d,prebuiltFieldPresent:true,prebuiltRaw:false},f.m,f.proof).nativeBuildLogVerified,true);
 for(const change of [p=>delete p.prepared,p=>delete p.actionAdmission,p=>p.actionAdmission.sha256=H,p=>p.attempt.scriptSha256='b'.repeat(64),p=>p.prepared.state='uncertain',p=>p.submitted.state='uncertain',p=>p.submitted.durable=false,p=>p.submitting.lease={...p.submitting.lease,operationId:'foreign'},p=>p.attempt.packetSha256=H,p=>p.attempt.argsSha256=H,p=>p.attempt.consequentialCreateAttempts=2,p=>p.guardedNative.guarded.status='uncertain',p=>p.guardedNative.native={...p.guardedNative.native,session_id:12},p=>p.guardedNative.native={...p.guardedNative.native,exit_code:1},p=>p.guardedNative.guarded.providerResult={exit_code:0},p=>p.arguments.push('--prebuilt'),p=>p.arguments.push('--prebuilt=false'),p=>p.arguments.push('--build-env','NODE_OPTIONS=foreign'),p=>p.arguments.push('--prod'),p=>p.arguments.push('--target','production'),p=>p.arguments.push('--target=production')]){
  const p=structuredClone(f.proof);change(p);assert.throws(()=>assertSelectionBuildEvidence(f.logs,f.d,f.m,p),/SOURCE_BUILD_UNPROVEN/);
 }
 assert.throws(()=>assertSelectionBuildEvidence(f.logs,f.d,f.m,{providerSourceBuild:true}),/SOURCE_BUILD_UNPROVEN/);
 for(const patch of [{source:'git'},{state:'ERROR'},{state:'BUILDING'},{gitCommitRef:'old-branch'},{prebuiltFieldPresent:true,prebuiltRaw:true},{prebuiltFieldPresent:true,prebuiltRaw:null},{selectionGuardSha256:H},{customEnvironment:{id:'other'}}])assert.throws(()=>assertSelectionBuildEvidence(f.logs,{...f.d,...patch},f.m,f.proof),/BUILD_UNPROVEN/);
 for(const logs of [f.logs.slice(1),f.logs.slice(0,1).concat(f.logs.slice(2)),[f.logs[1],f.logs[0],...f.logs.slice(2)],[f.logs[3],...f.logs],f.logs.filter((_,i)=>i!==2&&i!==4),[...f.logs,{text:'FCOS_CONFIGURATION_SELECTION:foreign'}]])assert.throws(()=>assertSelectionBuildEvidence(logs,f.d,f.m,f.proof),/BUILD_UNPROVEN/);
});
test('hosted proof requires exact existing coordinator registration/consumed operation and adapter-created source-deploy receipt',()=>{
 const f=fixture(),p=hosted(f);assert.equal(assertSelectionBuildEvidence(f.logs,f.d,f.m,p).sourceBuild.kind,p.kind);
 for(const change of [p=>p.operation.state='uncertain',p=>p.operation.evidence.outcome='unknown',p=>p.operation.operation_id='foreign',p=>p.operation.request_hash=H,p=>p.operation.requestHash=H,p=>p.operation.evidence.result.id='dpl_foreign',p=>delete p.operation.evidence.result.sourceDeploy,p=>p.operation.evidence.result.sourceDeploy.argumentsSha256=H,p=>p.registration.manifest_hash=H,p=>p.registration.manifest.controller.sha='f'.repeat(40)]){
  const x=structuredClone(p);change(x);assert.throws(()=>assertSelectionBuildEvidence(f.logs,f.d,f.m,x),/SOURCE_BUILD_UNPROVEN/);
 }
});
test('actual adapter reads the coordinator journal on every verification and never accepts supplied deployment booleans',async()=>{
 const f=fixture(),p=hosted(f),calls=[];let operation=p.operation;
 const raw={...actual,id:f.d.id,url:new URL(f.d.url).hostname,readyState:'READY',projectId:f.m.targets.vercelProject,teamId:f.m.targets.vercelTeam,
 meta:{githubCommitRef:'HEAD',githubCommitSha:sha,fcosHostedManifest:digest(f.m),fcosSourceSha256:f.m.candidate.sourceSha256,
 fcosVerificationSha256:digest(f.m.verification),fcosHostedOperation:p.operation.operationId,fcosConfigurationSelectionSha256:digest(f.guard.nodeOptions)},projectSettings:f.m.verification.projectSettings};
 const adapter=createVercelAdapter({manifest:f.m,candidateDirectory:'.',env:{FCOS_HOSTED_VERCEL_TOKEN:'synthetic',FCOS_HOSTED_VERCEL_TOKEN_ID:'synthetic'},
 coordinator:{snapshot:async binding=>{calls.push('coordinator');assert.deepEqual(binding,{releaseId:f.m.releaseId,manifestHash:digest(f.m)});return{registration:p.registration,operations:{'preview.create':operation}};}},
 fetchImpl:async url=>{const u=new URL(url);calls.push(u.pathname);if(u.pathname==='/v13/deployments/'+raw.id)return Response.json(raw);if(u.pathname.endsWith('/events'))return Response.json(f.logs);return new Response('',{status:503});}});
 // Source proof passes and reaches the unrelated app-version boundary; no live runtime/hosted acceptance is claimed.
 await assert.rejects(adapter.verifyArtifact({...f.d,providerSourceBuild:true},f.m,'preview'),{code:'ARTIFACT_READ_FAILED'});assert.equal(calls.filter(v=>v==='coordinator').length,1);
 operation={...p.operation,state:'uncertain'};calls.length=0;await assert.rejects(adapter.verifyArtifact(f.d,f.m,'preview'),{code:'CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN'});assert.equal(calls.some(v=>v==='/app-version.json'),false);
});
test('generated pre-candidate Node guard pins the reviewed stderr-only successor',()=>{
 const source=readFileSync(new URL('../scripts/lib/hosted-release/configuration-selection.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export function selectionBuildGuard'),source.indexOf('/** No execution of repository code'));
 // Explicit successor changes only proof output; historical native metadata above retains its original guard hash.
 assert.equal(digest(body),'aa4195a744b213701a242f520f23972ce0bc1dfd056f11c6db111ded024df118');
});

function controllerFixture(t,{lostResponse=false}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'fcos-selection-adapter-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',engines:{node:'24.x'},scripts:{build:'echo fixture'}}));
 writeFileSync(join(dir,'package-lock.json'),'{}\n');writeFileSync(join(dir,'.gitignore'),'.vercel/\n');writeFileSync(join(dir,'vercel.json'),JSON.stringify({installCommand:'npm ci',git:{deploymentEnabled:false}}));
 const git=args=>execFileSync('git',args,{cwd:dir,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();
 git(['init','-q']);git(['remote','add','origin','https://github.com/hocheunglai-oss/fcos.git']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','synthetic source']);git(['checkout','--detach','-q']);
 const source=collectBuildProvenance({cwd:dir,env:{},requireClean:true}),m=fixture().m;
 m.stage='application';m.candidate.sha=source.commit;m.candidate.sourceProfile='application_v2';m.candidate.sourceSha256=source.sourceDigest;m.candidate.lockSha256=digest('{}\n');
 m.scope.handoffs=[{kind:'status19',sha256:H},{kind:'supplier16',sha256:H}];m.scope.compatibilityProductionObservationSha256=H;m.requiredChecks.push('compatibility_production_observation');
 const a=admitPreviewWriterFixture(m);a.setup.legacyReleaseContainment=m.legacyReleaseContainment;m.setupSha256=digest(a.setup);a.env.FCOS_ADMITTED_RELEASE_SETUP=JSON.stringify(a.setup);a.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256=digest(a.setup);
 const project={id:m.targets.vercelProject,accountId:m.targets.vercelTeam,name:'fcos',...m.verification.projectSettings,autoExposeSystemEnvs:true,autoAssignCustomDomains:false,link:{type:'github',org:'hocheunglai-oss',repo:'fcos',productionBranch:'main',deployHooks:[]}};
 const guard=selectionBuildGuard(m),url='https://fcos-create123-hocheunglai-6535s-projects.vercel.app',id='dpl_created';let invoked,operation,discoverable=false,deployCalls=0;const uncertainHistory=[];
 const deployment={id,url:new URL(url).hostname,projectId:m.targets.vercelProject,teamId:m.targets.vercelTeam,readyState:'BUILDING',source:'cli',projectSettings:m.verification.projectSettings,
 meta:{githubCommitRef:'HEAD',githubCommitSha:source.commit,fcosHostedOperation:`${m.releaseId}-preview-create`,fcosHostedManifest:digest(m),fcosSourceSha256:m.candidate.sourceSha256,fcosVerificationSha256:digest(m.verification),fcosConfigurationSelectionSha256:digest(guard.nodeOptions)}};
 const registration={release_id:m.releaseId,epoch:m.epoch,manifest_hash:digest(m),manifest:m};
 const coordinator={register:async()=>{},snapshot:async()=>({registration,operations:operation?{'preview.create':operation}:{}}),begin:async p=>{
  if(operation)return{disposition:operation.state==='complete'?'complete':'readback',evidence:operation.evidence};
  operation={...p,operation_id:p.operationId,request_hash:p.requestHash,release_id:m.releaseId,manifest_hash:digest(m),epoch:m.epoch,state:'intent'};return{disposition:'execute'};},
 complete:async p=>{operation={...operation,state:'complete',evidence:p.evidence};},
 uncertain:async p=>{uncertainHistory.push(p);operation={...operation,state:'uncertain'};},
 readback:async p=>{operation={...operation,state:'complete',evidence:p.evidence};}};
 const adapter=()=>createVercelAdapter({manifest:m,candidateDirectory:dir,env:a.env,coordinator,execute:(_binary,args)=>{if(args[0]==='--version')return'54.20.1';invoked=args;deployCalls++;if(lostResponse)throw new Error('synthetic lost response');return url;},fetchImpl:async url=>{
  const u=new URL(url);let v;if(u.pathname.startsWith('/v13/deployments/'))v=deployment;
  else if(u.pathname==='/v6/deployments')v={deployments:discoverable?[{uid:id,meta:deployment.meta}]:[],pagination:{next:null}};
  else if(u.pathname.endsWith('/events'))v=[{text:'Running \"vercel build\"'},{text:'Running \"install\" command: `npm ci`...'},{text:guard.proof}];
  else if(u.pathname==='/app-version.json')return new Response('',{status:503});
  else if(u.pathname.startsWith('/v10/projects/'))v={envs:[]};else if(u.pathname==='/v1/env')v={data:[],pagination:{count:0,next:null}};
  else if(u.pathname==='/v9/projects')v={projects:[{id:project.id}],pagination:{count:1,next:null}};
  else if(u.pathname==='/v2/user')return{status:404};else if(u.pathname.startsWith('/v2/teams/'))return{status:403};else v=project;
  return Response.json(v);
 }});
 return {m,coordinator,adapter,deployment,uncertainHistory,get operation(){return operation;},get invoked(){return invoked;},get deployCalls(){return deployCalls;},makeDiscoverable(){discoverable=true;},removeReadbackReceipt(){delete operation.evidence.result.sourceDeployReadback;}};
}

test('real controller create path journals exact adapter source argv only after native CLI acknowledgement',async t=>{
 const f=controllerFixture(t),{m,coordinator}=f,provider=f.adapter();
 assert.equal((await preparePreview({manifest:m,coordinator,provider})).status,'waiting_dependency');
 assert.ok(f.invoked&&!f.invoked.includes('--prebuilt'));assert.deepEqual(f.invoked.slice(0,-5),deploymentArguments(m,`${m.releaseId}-preview-create`,false));
 assert.equal(f.operation.state,'complete');assert.equal(f.operation.evidence.result.id,f.deployment.id);assert.equal(f.operation.evidence.result.sourceDeploy.argumentsSha256,digest(f.invoked.slice(0,-5)));
 assert.equal(f.operation.evidence.result.prebuiltFieldPresent,false);assert.equal(f.operation.evidence.result.prebuiltRaw,null);
});


test('lost source CLI response remains consumed, then exact owner readback survives controller restart without another deploy',async t=>{
 const f=controllerFixture(t,{lostResponse:true}),{m,coordinator}=f;
 await assert.rejects(preparePreview({manifest:m,coordinator,provider:f.adapter()}),{code:'PROVIDER_OUTCOME_UNKNOWN'});
 assert.equal(f.deployCalls,1);assert.equal(f.operation.state,'uncertain');assert.equal(f.uncertainHistory.length,1);
 assert.equal(f.uncertainHistory[0].reason,'PROVIDER_RESPONSE_LOST');assert.equal(f.operation.evidence,undefined);
 f.makeDiscoverable();f.deployment.readyState='READY';
 // Fresh adapter and controller restart use only the original intent plus actual
 // provider GETs. Selection succeeds; unrelated app-version503 stops qualification.
 await assert.rejects(preparePreview({manifest:m,coordinator,provider:f.adapter()}),{code:'ARTIFACT_READ_FAILED'});
 assert.equal(f.deployCalls,1);assert.equal(f.operation.state,'complete');assert.equal(f.uncertainHistory.length,1);
 const result=f.operation.evidence.result;assert.equal(Object.hasOwn(result,'sourceDeploy'),false);
 assert.equal(result.sourceDeployReadback.basis,'authenticated_provider_owner_readback');
 assert.equal(result.sourceDeployReadback.argumentsSha256,digest(f.invoked.slice(0,-5)));
 assert.equal(Object.hasOwn(result.sourceDeployReadback,'exitCode'),false);
 const p={kind:'fcos_hosted_selection_source_build_v1',registration:(await coordinator.snapshot()).registration,operation:f.operation,arguments:deploymentArguments(m,`${m.releaseId}-preview-create`,false)};
 const logs=[{text:'Running "vercel build"'},{text:'Running "install" command: `npm ci`...'},{text:selectionBuildGuard(m).proof}];
 assert.equal(assertSelectionBuildEvidence(logs,result,m,p).sourceBuild.basis,'authenticated_provider_owner_readback');
 const originalProof=structuredClone(p),freshReadback=structuredClone(result.sourceDeployReadback);
 f.removeReadbackReceipt();
 await assert.rejects(preparePreview({manifest:m,coordinator,provider:f.adapter()}),{code:'ARTIFACT_READ_FAILED'});
 assert.equal(f.deployCalls,1);assert.equal(Object.hasOwn(f.operation.evidence.result,'sourceDeployReadback'),false);
 assert.equal(assertSelectionBuildEvidence(logs,result,m,{...p,providerReadback:freshReadback}).sourceBuild.basis,'authenticated_provider_owner_readback');
 for(const change of [p=>p.operation.state='uncertain',p=>p.operation.request_hash=H,p=>p.operation.evidence.result.sourceDeployReadback.deploymentId='dpl_foreign',p=>p.operation.evidence.result.sourceDeployReadback.controllerSha='f'.repeat(40),p=>p.operation.evidence.result.sourceDeployReadback.basis='cli_ack',p=>p.operation.evidence.result.sourceDeploy={}]){
  const changed=structuredClone(originalProof);change(changed);assert.throws(()=>assertSelectionBuildEvidence(logs,result,m,changed),/SOURCE_BUILD_UNPROVEN/);
 }
});


test('Production stage and live verification bind the real previous/skipDomain request for ACK and authenticated owner readback',async()=>{
 const f=fixture();f.d.target='production';const p=hosted(f),operationId=p.operation.operationId;
 assert.deepEqual(selectionSourceDeployRequest(f.m,true),{candidate:f.m.candidate,previous:f.m.previousProduction,target:'production',skipDomain:true});
 assert.equal(p.operation.requestHash,digest({candidate:f.m.candidate,previous:f.m.previousProduction,target:'production',skipDomain:true}));
 assert.ok(p.arguments.includes('--prod')&&p.arguments.includes('--skip-domain'));assert.equal(p.arguments.includes('FCOS_ENABLE_READ_ONLY_CI=true'),false);
 const raw={...actual,id:f.d.id,url:new URL(f.d.url).hostname,readyState:'READY',target:'production',projectId:f.m.targets.vercelProject,teamId:f.m.targets.vercelTeam,
 meta:{githubCommitRef:'HEAD',githubCommitSha:sha,fcosHostedManifest:digest(f.m),fcosSourceSha256:f.m.candidate.sourceSha256,fcosVerificationSha256:digest(f.m.verification),fcosHostedOperation:operationId,fcosConfigurationSelectionSha256:digest(f.guard.nodeOptions)},projectSettings:f.m.verification.projectSettings};
 let operation=p.operation;
 const adapter=createVercelAdapter({manifest:f.m,candidateDirectory:'.',env:{FCOS_HOSTED_VERCEL_TOKEN:'synthetic',FCOS_HOSTED_VERCEL_TOKEN_ID:'synthetic'},
 coordinator:{snapshot:async()=>({registration:p.registration,operations:{'production.stage':operation}})},fetchImpl:async url=>{
 const u=new URL(url);if(u.pathname.startsWith('/v13/deployments/'))return Response.json(raw);if(u.pathname==='/v6/deployments')return Response.json({deployments:[{uid:raw.id,meta:raw.meta}],pagination:{next:null}});if(u.pathname.endsWith('/events'))return Response.json(f.logs);return new Response('',{status:503});}});
 for(const phase of ['staged','live'])await assert.rejects(adapter.verifyArtifact(f.d,f.m,phase),{code:'ARTIFACT_READ_FAILED'});
 operation={...structuredClone(p.operation),state:'uncertain',evidence:{outcome:'unknown'}};
 await assert.rejects(adapter.discover(f.m,'production',{operationId,request:{candidate:f.m.candidate,target:'production'}}),{code:'CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN'});
 const observed=await adapter.discover(f.m,'production',{operationId,request:selectionSourceDeployRequest(f.m,true)});
 assert.equal(observed.outcome,'applied');assert.equal(observed.result.sourceDeployReadback.requestHash,p.operation.requestHash);
 assert.equal(Object.hasOwn(observed.result,'sourceDeploy'),false);
 operation={...operation,state:'complete',evidence:observed};
 for(const phase of ['staged','live'])await assert.rejects(adapter.verifyArtifact(f.d,f.m,phase),{code:'ARTIFACT_READ_FAILED'});
 delete operation.evidence.result.sourceDeployReadback;
 for(const phase of ['staged','live'])await assert.rejects(adapter.verifyArtifact(f.d,f.m,phase),{code:'ARTIFACT_READ_FAILED'});
 operation.requestHash=operation.request_hash=digest({candidate:f.m.candidate,target:'production'});
 await assert.rejects(adapter.verifyArtifact(f.d,f.m,'staged'),{code:'CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN'});
 for(const target of ['',false,0,{},'staging']){
  raw.target=target;await assert.rejects(adapter.inspect(f.d.id),{code:'DEPLOYMENT_TARGET'});
 }
 for(const target of [undefined,null,'preview','production']){
  raw.target=target;assert.equal((await adapter.inspect(f.d.id)).target,target??'preview');
 }
});
