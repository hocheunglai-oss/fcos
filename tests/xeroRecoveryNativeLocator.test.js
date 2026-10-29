import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeRelayMain,prepareNativeXeroLocatorPublication,courierPublicationStatus,canonical,hash,REPOSITORY,FEATURES_OWNER} from '../scripts/lib/hosted-release/xero-recovery-native-relay.mjs';
import {createJoinedBrowserBoundary} from './helpers/xero-recovery-joined-browser.mjs';
import {fcosConnectionIdentifier} from '../config/fcosConnections.js';
const T=Date.now(),H='a'.repeat(64),S='1'.repeat(40),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Actual CLI parser, physical Git objects and5818 guards; provider/Python
// commands are explicit inert fixtures, never actual credentials/authority.
function fixture(mode='success',version=2){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'fcos-native-locator-'))),calls=[];
 const gitEnv={PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Synthetic fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Synthetic fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=args=>{const r=spawnSync('/usr/bin/git',args,{cwd:root,env:gitEnv,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','--initial-branch=codex/fixture']);git(['commit','--allow-empty','-m','synthetic controller']);const controller=git(['rev-parse','HEAD']);
 const planBinding={operationId:hash('synthetic-locator-operation'),ownerThreadId:id(1),tenantId:id(2),actorId:id(3),expectedVersion:449,refreshLeaseId:id(4),probeId:id(5),requestId:id(6),approvalSha256:H,sourceSha256:H,bindingSha256:H,organisationIdentitySha256:null,issuedAt:T-1000,notAfter:T+1799000,credentialPreservationCompositeApproved:true};
 if(version===3){delete planBinding.issuedAt;delete planBinding.notAfter;Object.assign(planBinding,{preparedAt:T-3600000,armBefore:T+600000,absoluteNotAfter:T+3600000,executionWindowMs:1800000});}
 const t={schemaVersion:version,kind:`fcos_xero_recovery_carrier_template_v${version}`,planJson:canonical({schemaVersion:version,kind:`fcos_xero_recovery_step_plan_v${version}`,binding:planBinding}),controllerSha:controller,
 caller:{ref:'refs/heads/codex/fixture-caller',sha:S,workflowRef:`${REPOSITORY}/.github/workflows/authenticated-release.yml@refs/heads/codex/fixture-caller`,workflowSha:S,jobWorkflowRef:`${REPOSITORY}/.github/workflows/hosted-xero-recovery-carrier.yml@${controller}`,jobWorkflowSha:controller,jobName:'xero-recovery-carrier',environment:'fcos-hosted-verification',subject:`repo:${REPOSITORY}:environment:fcos-hosted-verification`},
 hostConfiguration:{target:{teamId:fcosConnectionIdentifier('vercel','Team ID'),projectId:fcosConnectionIdentifier('vercel','Project ID'),customEnvironment:'fcos-xero-recovery-abcdef123456',controllerSha:controller,hostSourceSha256:H}},readCredential:{},readAcceptance:{},login:{origin:'https://legacy.vercel.app',publicAuth:{}},issuedAt:T-1000,notAfter:T+1799000,artifactCaptureAuthoritySha256:H};
 let executionPreflightJson;
 if(version===3){const browser=createJoinedBrowserBoundary({now:T,id:id(3),email:'owner@example.invalid',subject:'fixture-subject'});t.login.publicAuth=browser.publicAuth;t.login.origin=browser.publicAuth.preflight.origin;t.hostConfiguration.actorBinding={accessRevision:5};t.issuedAt=planBinding.preparedAt;t.notAfter=planBinding.absoluteNotAfter;
  executionPreflightJson=canonical({schemaVersion:1,kind:'fcos_xero_execution_preflight_v1',operationId:planBinding.operationId,planSha256:hash(t.planJson),preflight:browser.publicAuth.preflight});}
 const templateJson=JSON.stringify(t),binding={runId:'123',jobId:22,hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',...(version===3?{executionPreflightSha256:hash(executionPreflightJson)}:{})},prepared=prepareNativeXeroLocatorPublication({templateJson,binding,epoch:'production-reconciliation-20261005',executionPreflightJson,now:T});
 const lease={...prepared.expected,leaseId:id(9),coordinationOnly:true,providerAuthorityGranted:false,uncertainOutcomeRequiresReadback:true};
 mkdirSync(join(root,'.fcos-cli/outputs/hosted-xero-recovery-courier'),{recursive:true,mode:0o700});const workflow=join(root,'workflow.json'),board=join(root,'board.json');
 writeFileSync(workflow,JSON.stringify({unifiedCoordinator:{epoch:lease.epoch}}));writeFileSync(board,JSON.stringify({checkpointPaths:{workflow}}));writeFileSync(join(root,'.fcos-cli/release-state.json'),JSON.stringify({workboardPath:board}));
 const inputPath=join(root,'input.json'),input={templateJson,binding,lease,...(version===3?{executionPreflightJson}:{})};writeFileSync(inputPath,JSON.stringify(input));
 const team=fcosConnectionIdentifier('vercel','Team ID'),project=fcosConnectionIdentifier('vercel','Project ID');let commitSha,status;
 const repository={id:1278654816,full_name:REPOSITORY};
 const capture=(command,args,options={})=>{
  calls.push({command,args,input:options.input});
  if(command==='/usr/bin/python3'){const v=JSON.parse(options.input);assert.equal(v.mode,'assert');assert.equal(v.expected.objective,'production');assert.equal(v.expected.ownerThreadId,FEATURES_OWNER);assert.deepEqual(v.lease,lease);assert.ok(args[2].includes('8ed4eda312b62c3b02c3a0a768ddd024a2a819af5f0f1194da47ef2a2d62fd38'));assert.ok(!args[2].includes('.claim('));return{status:mode==='lease-refused'?1:0,stdout:JSON.stringify(lease)};}
  if(command==='/usr/bin/git'){
   if(args.includes('push')){commitSha=args.at(-1).split(':')[0];assert.match(commitSha,/^[a-f0-9]{40}$/);assert.ok(args.includes(`--force-with-lease=${prepared.ref}:`));if(mode==='lost-push')return{status:0,session_id:7,stdout:'PRIVATE_PENDING'};return{status:0,stdout:''};}
   if(mode==='wrong-controller'&&args.join(' ')==='rev-parse HEAD')return{status:0,stdout:'f'.repeat(40)};
   return spawnSync(command,args,options);
  }
  const route=args[args.indexOf('api')+1];let value;
  if(command==='fixture-vercel'){
   assert.equal(args.at(-1),'--raw');assert.deepEqual(args.slice(0,args.indexOf('api')),['--global-config',join(root,'.fcos-cli/vercel'),'--scope',fcosConnectionIdentifier('vercel','Team'),'--cwd',root,'--no-color']);assert.deepEqual(args.slice(-3),['--method','GET','--raw']);
   if(route==='/v2/user')value={user:{username:fcosConnectionIdentifier('vercel','Account')}};
   else if(route.startsWith('/v2/teams/'))value={id:team,slug:fcosConnectionIdentifier('vercel','Team'),membership:{role:'OWNER'}};
   else if(route.startsWith('/v9/projects/'))value={id:project,accountId:team,name:fcosConnectionIdentifier('vercel','Project')};
   else {assert.ok(route.startsWith('/v13/deployments/dpl_fixture?'));value={id:'dpl_fixture',projectId:mode==='foreign-host'?'foreign':project,ownerId:team,readyState:'READY',url:'fixed.vercel.app',customEnvironment:{slug:t.hostConfiguration.target.customEnvironment}};}
  }else{
   assert.equal(command,'fixture-gh');assert.equal(args[0],'api');assert.equal(options.env.GH_CONFIG_DIR,join(root,'.fcos-cli/github'));assert.equal(options.env.GH_TOKEN,undefined);assert.equal(options.env.GITHUB_TOKEN,undefined);assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.env.VERCEL_TOKEN,undefined);
   if(args.includes('POST')){
    const expected=courierPublicationStatus({templateJson,runId:'123',ref:prepared.ref,commitSha,raw:prepared.locatorJson,kind:'locator'});assert.equal(route,expected.route);assert.deepEqual(JSON.parse(options.input),expected.body);assert.deepEqual(Object.keys(JSON.parse(options.input)).sort(),['context','description','state','target_url']);
    if(mode==='lost-status')return{status:0,session_id:8,stdout:'PRIVATE_PENDING'};
    if(mode==='rejected-status')return{status:1,stdout:'HTTP/2.0 422\r\n\r\nPRIVATE_ERROR'};
    status={id:91,url:'https://api.github.com/'+route,creator:{id:mode==='foreign-creator'?1:265701760,login:'hocheunglai-oss'},...expected.body,created_at:new Date(T).toISOString(),updated_at:new Date(T).toISOString()};return{status:0,stdout:'HTTP/2.0 201 Created\r\ncontent-type: application/json\r\n\r\n'+JSON.stringify(status)};
   }
   if(route==='user')value={id:265701760,login:mode==='foreign-actor'?'foreign':'hocheunglai-oss'};
   else if(route===`repos/${REPOSITORY}`)value=repository;
   else if(route.endsWith('/actions/runs/123'))value={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:S,head_branch:'codex/fixture-caller',path:'.github/workflows/authenticated-release.yml',status:'in_progress'};
   else if(route.endsWith('/attempts/1/jobs?per_page=100'))value={total_count:1,jobs:[{id:mode==='foreign-job'?23:22,run_id:123,name:version===3?'xero-recovery-preparation':'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress'}]};
   else if(route.endsWith('/git/ref/'+t.caller.ref.slice(5)))value={ref:t.caller.ref,object:{type:'commit',sha:S}};
   else if(route.endsWith('/git/ref/'+prepared.ref.slice(5)))value={ref:prepared.ref,object:{type:'commit',sha:commitSha}};
   else if(route.includes('/statuses?per_page=100')){assert.ok(status);const list=mode==='duplicate-status'?[status,status]:[{context:'unrelated'},status];return{status:0,stdout:'HTTP/2.0 200 OK\r\n'+(mode==='pagination'?'Link: <https://api.github.com/next>; rel="next"\r\n':'')+'content-type: application/json\r\n\r\n'+JSON.stringify(list)};}
   else assert.fail('Unexpected route '+route);
  }
  return{status:0,stdout:JSON.stringify(value)};
 };
 const runtime={credentialAvailable:true,command:'fixture-gh',env:{PATH:'/usr/bin:/bin',HOME:root,GH_CONFIG_DIR:join(root,'.fcos-cli/github'),GH_TOKEN:'INERT_MUST_NOT_REACH_CHILD',GITHUB_TOKEN:'INERT_MUST_NOT_REACH_CHILD',NODE_OPTIONS:'--inspect',VERCEL_TOKEN:'INERT_MUST_NOT_REACH_CHILD'}};
 const options={controlRoot:root,cwd:root,capture,nativeRuntime:runtime,vercelRuntime:{credentialAvailable:true,command:'fixture-vercel',injectedArgs:['--global-config',join(root,'.fcos-cli/vercel'),'--scope',fcosConnectionIdentifier('vercel','Team'),'--cwd',root,'--no-color'],env:{}},now:()=>T};
 const state=join(root,'.fcos-cli/outputs/hosted-xero-recovery-courier',planBinding.operationId),file=name=>join(state,planBinding.operationId+'.'+name+'.json');
 return{inputPath,input,options,root,calls,t,file,state,prepared,git,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('actual publish-locator CLI sends only generated status.body after one guarded ref push and returns typed201 proof',async()=>{
 const f=fixture();try{const ack=await nativeRelayMain(['publish-locator',f.inputPath],f.options);assert.equal(ack.kind,'fcos_native_xero_locator_publication_ack_v1');assert.equal(ack.httpStatus,201);assert.equal(ack.statusId,91);assert.equal(ack.completeStatusListRows,2);assert.equal(ack.financialAuthorityGranted,false);
  assert.equal(f.calls.filter(c=>c.args.includes('push')).length,1);assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);assert.equal(f.calls.filter(c=>c.args[1]?.includes('/statuses?')).length,1);
  const tree=f.git(['ls-tree',ack.commitSha]);assert.match(tree,/locator.json$/);assert.equal(f.git(['show',ack.commitSha+':locator.json']),f.prepared.locatorJson);assert.equal(JSON.parse(readFileSync(f.file('locator.ack'))).statusId,91);
  const before=f.calls.length;await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options),{code:'XERO_COURIER_LOCATOR_CONSUMED'});assert.equal(f.calls.length,before);
 }finally{f.cleanup();}
});
for(const mode of ['foreign-actor','foreign-job','foreign-host','wrong-controller','lease-refused'])test(mode+' refuses before any push or POST',async()=>{const f=fixture(mode);try{await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));assert.equal(f.calls.filter(c=>c.args.includes('push')||c.args.includes('POST')).length,0);}finally{f.cleanup();}});
for(const mode of ['lost-push','lost-status','rejected-status','foreign-creator'])test(mode+' stops without later provider calls, replay or financial ACK',async()=>{const f=fixture(mode);try{await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));const last=f.calls.at(-1);assert.ok(mode==='lost-push'?last.args.includes('push'):last.args.includes('POST'));assert.ok(readdirSync(f.state).some(n=>n.endsWith('.stopped.json')));assert.ok(!readdirSync(f.state).some(n=>n.endsWith('.locator.ack.json')));assert.equal(f.calls.filter(c=>c.args[1]?.includes('/statuses?')).length,0);const before=f.calls.length;await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));assert.equal(f.calls.length,before);}finally{f.cleanup();}});
for(const mode of ['pagination','duplicate-status'])test(mode+' blocks final ACK after known201 without another write',async()=>{const f=fixture(mode);try{await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);assert.ok(!readdirSync(f.state).some(n=>n.endsWith('.locator.ack.json')));}finally{f.cleanup();}});
test('caller-selected raw body, wrong lease binding and insufficient v2 runway refuse before credentials/provider commands',async()=>{
 for(const change of [i=>i.body={state:'success'},i=>i.lease.bindingSha256=H]){const f=fixture();try{change(f.input);writeFileSync(f.inputPath,JSON.stringify(f.input));await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));assert.equal(f.calls.length,0);}finally{f.cleanup();}}
 const f=fixture();try{await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],{...f.options,now:()=>f.t.notAfter-899999}),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});assert.equal(f.calls.length,0);}finally{f.cleanup();}
});

test('foreign GitHub config is refused before any GitHub or Vercel read',async()=>{const f=fixture();try{f.options.nativeRuntime.env.GH_CONFIG_DIR=f.root;await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options),{code:'XERO_COURIER_LOCATOR_TARGET_MISMATCH'});assert.ok(f.calls.every(c=>c.command==='/usr/bin/python3'));}finally{f.cleanup();}});

test('missing, malformed, foreign or mismatched custom-environment target is refused before native calls',async()=>{for(const change of [t=>delete t.hostConfiguration.target,t=>delete t.hostConfiguration.target.customEnvironment,t=>t.hostConfiguration.target.customEnvironment='production',t=>t.hostConfiguration.target.projectId='foreign',t=>t.hostConfiguration.target.controllerSha='f'.repeat(40)]){const f=fixture();try{const t=JSON.parse(f.input.templateJson);change(t);f.input.templateJson=JSON.stringify(t);writeFileSync(f.inputPath,JSON.stringify(f.input));await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options),{code:'XERO_COURIER_LOCATOR_TARGET_MISMATCH'});assert.equal(f.calls.length,0);}finally{f.cleanup();}}});


test('v3 actual locator CLI publishes both exact public files in the same single guarded push/status',async()=>{
 const f=fixture('success',3);try{
  const ack=await nativeRelayMain(['publish-locator',f.inputPath],f.options);
  assert.equal(ack.httpStatus,201);assert.equal(ack.financialAuthorityGranted,false);
  const tree=f.git(['ls-tree','--name-only',ack.commitSha]).split('\n');
  assert.deepEqual(tree,['execution-preflight.json','locator.json']);
  assert.equal(f.git(['show',ack.commitSha+':execution-preflight.json']),f.input.executionPreflightJson);
  assert.equal(JSON.parse(f.git(['show',ack.commitSha+':locator.json'])).executionPreflightSha256,hash(f.input.executionPreflightJson));
  assert.equal(f.calls.filter(c=>c.args.includes('push')).length,1);assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);
 }finally{f.cleanup();}
});
test('v3 lost status result remains consumed with no readback/next write or fabricated ACK',async()=>{
 const f=fixture('lost-status',3);try{
  await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));
  assert.equal(f.calls.filter(c=>c.args.includes('push')).length,1);assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);
  assert.ok(!f.calls.some(c=>c.args[1]?.includes('/statuses?')));
  const before=f.calls.length;await assert.rejects(nativeRelayMain(['publish-locator',f.inputPath],f.options));assert.equal(f.calls.length,before);
 }finally{f.cleanup();}
});
