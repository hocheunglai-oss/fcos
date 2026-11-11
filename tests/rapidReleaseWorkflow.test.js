import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { handoverDigest } from '../scripts/lib/rapid-release/handover.mjs';
const workflow = load(readFileSync(new URL('../.github/workflows/fcos-rapid-release.yml', import.meta.url), 'utf8'));
const handoverWorkflow = load(readFileSync(new URL('../.github/workflows/fcos-rapid-handover.yml', import.meta.url), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
function configuredActivation() {
 const saved={enabled:process.env.FCOS_RAPID_RELEASE_ENABLED,pointer:process.env.FCOS_RAPID_RELEASE_HANDOVER_ID};
 process.env.FCOS_RAPID_RELEASE_ENABLED='true';
 process.env.FCOS_RAPID_RELEASE_HANDOVER_ID='12';
 return ()=>{
  for(const [key,value] of [['FCOS_RAPID_RELEASE_ENABLED',saved.enabled],['FCOS_RAPID_RELEASE_HANDOVER_ID',saved.pointer]]) {
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 };
}
function setup({ forgedPlan = false, changedWorkflow = false, successful = true, botClone = false } = {}) {
 const owner='hocheunglai-oss',repo='fcos',controllerSha='c'.repeat(40),dispatcherSha='d'.repeat(40),candidateSha='a'.repeat(40);
 const plan={controllerSha,candidateSha},review={state:'approved',user:{login:owner},environments:[{id:1}]};
 const payload={kind:'fcos_rapid_release_handover',repository:`${owner}/${repo}`,controllerSha,plan,planHash:handoverDigest(plan),candidateSha,
  attestationContract:'fcos-owner-recorded-handover/v1',qualificationPublisher:{account:owner,method:'protected_controller_api'},
  nativeReview:{runId:7,jobId:8,reviewDigest:handoverDigest(review),planHash:handoverDigest(plan),reviewer:owner,reviewerId:7,state:successful?'approved':'rejected',environment:'fcos-production-release',environmentId:1,protectionDigest:'b'.repeat(64),workflowPath:'.github/workflows/fcos-rapid-handover.yml',workflowBlobSha:'b'.repeat(40)}};
 if(forgedPlan)payload.plan={...plan,controllerSha:'f'.repeat(40)};
 const github={rest:{actions:{getWorkflowRun:async()=>({data:{id:7,conclusion:successful?'success':'failure',event:'workflow_dispatch',actor:{login:owner},path:'.github/workflows/fcos-rapid-handover.yml@main',display_title:`FCOS rapid handover ${payload.planHash} ${candidateSha}`,head_sha:controllerSha}}),
  listJobsForWorkflowRun:async()=>({data:{jobs:[{id:8,name:'handover-apply',conclusion:'success'}]}})},
  repos:{getDeployment:async()=>({data:{id:12,creator:{login:botClone?'github-actions[bot]':owner},payload}}),getContent:async({ref})=>({data:{type:'file',sha:changedWorkflow&&ref===dispatcherSha?'e'.repeat(40):'b'.repeat(40)}})}},
  request:async()=>({data:[review]})};
 return{github,context:{repo:{owner,repo},actor:owner,sha:dispatcherSha},manifest:{targets:{repository:`${owner}/${repo}`,account:owner},controllerSha}};
}
test('three ordinary jobs keep credential-free preparation independent and serialize only provider execution',()=>{
 assert.deepEqual(Object.keys(workflow.jobs),['quality','stage-and-smoke','go-live']);assert.equal(workflow.concurrency,undefined);
 assert.equal(workflow.jobs.quality.permissions.deployments,undefined);
 for(const name of ['stage-and-smoke','go-live']){
  const job=workflow.jobs[name];assert.equal(job.concurrency.group,'fcos-production-release');assert.equal(job.concurrency['cancel-in-progress'],false);assert.equal(job.concurrency.queue,'max');
  const admission=job.steps.findIndex(step=>step.id==='admit-controller');const checkout=job.steps.findIndex(step=>step.uses?.startsWith('actions/checkout@'));
  assert.ok(admission>=0&&checkout>admission);assert.match(job.steps[checkout].with.ref,/admit-controller.outputs.controller_sha/);
  for(const [index,step] of job.steps.entries())if(step.env?.VERCEL_TOKEN)assert.ok(index>checkout);
 }
 assert.match(workflow.jobs.quality.steps.find(step=>step.with?.path==='controller').with.ref,/controllerSha/);
});
test('deferred Salesforce staging reads the exact candidate without installing Salesforce CLI or granting Salesforce credentials',()=>{
 const steps=workflow.jobs['stage-and-smoke'].steps;
 const index=steps.findIndex(step=>step.with?.path==='salesforce-candidate');
 const checkout=steps[index],stage=steps.find(step=>step.env?.VERCEL_TOKEN);
 assert.ok(index>steps.findIndex(step=>step.id==='admit-controller')&&index<steps.indexOf(stage));
 assert.match(checkout.if,/selection\.salesforce.*deferSchemaDependentSmoke/);
 assert.match(checkout.with.ref,/candidate\.sha/);
 assert.equal(checkout.with['persist-credentials'],false);
 assert.equal(checkout.with['fetch-depth'],0);
 assert.match(stage.env.FCOS_RAPID_SALESFORCE_CANDIDATE,/salesforce-candidate/);
 assert.ok(!steps.some(step=>String(step.run).includes('@salesforce/cli')||
  Object.keys(step.env||{}).some(name=>/^FCOS_RAPID_SALESFORCE_.*(?:KEY|CLIENT_ID|TOKEN)$/.test(name))));
});
test('GitHub-only admission accepts an unchanged frozen workflow on a newer application dispatcher',async()=>{
 const fixture=setup(),step=workflow.jobs['stage-and-smoke'].steps.find(step=>step.id==='admit-controller'),outputs={};
 const restore=configuredActivation();const original=process.env.RELEASE_MANIFEST;process.env.RELEASE_MANIFEST=JSON.stringify(fixture.manifest);
 try{await new AsyncFunction('require','github','context','core',step.with.script)(await import('node:module').then(m=>m.createRequire(import.meta.url)),fixture.github,fixture.context,{setOutput:(key,value)=>outputs[key]=value});}
 finally{restore();if(original===undefined)delete process.env.RELEASE_MANIFEST;else process.env.RELEASE_MANIFEST=original;}
 assert.equal(outputs.controller_sha,fixture.manifest.controllerSha);
 assert.equal(outputs.handover_id,'12');
});
test('forged source under an old plan hash, changed dispatcher, and failed qualification stop before credentialed checkout',async()=>{
 const step=workflow.jobs['go-live'].steps.find(step=>step.id==='admit-controller');const original=process.env.RELEASE_MANIFEST;const restore=configuredActivation();
 try{
  for(const options of [{forgedPlan:true},{changedWorkflow:true},{successful:false},{botClone:true}]){
   const fixture=setup(options);process.env.RELEASE_MANIFEST=JSON.stringify(fixture.manifest);let outputs=0;
   await assert.rejects(new AsyncFunction('require','github','context','core',step.with.script)(await import('node:module').then(m=>m.createRequire(import.meta.url)),fixture.github,fixture.context,{setOutput:()=>outputs++}),/QUALIFIED_FROZEN_CONTROLLER_REQUIRED/);
   assert.equal(outputs,0);
  }
 }finally{restore();if(original===undefined)delete process.env.RELEASE_MANIFEST;else process.env.RELEASE_MANIFEST=original;}
});

for(const [adapter,prefix] of [['company-fx-history','COMPANY_FX'],['supplier-bucket-migrations','SUPPLIER_BUCKET']]){
 test(`${adapter} writer credentials are limited to the protected exact database adapter`, () => {
 const names=[`FCOS_RAPID_${prefix}_DB_ACCESS_TOKEN`,`FCOS_RAPID_${prefix}_GH_OWNER_TOKEN`];
 for(const [name,job] of Object.entries(workflow.jobs)){
  const matches=job.steps.filter(step=>names.some(key=>Object.hasOwn(step.env||{},key)));
  if(name!=='go-live'){assert.equal(matches.length,0);continue;}
  assert.equal(job.environment.name,'fcos-production-release');
  assert.equal(matches.length,1);
  const [step]=matches;
  assert.match(step.run,/scripts\/rapid-release\.mjs promote/);
  assert.ok(job.steps.indexOf(step)>job.steps.findIndex(item=>item.id==='admit-controller'));
  for(const key of names)assert.match(step.env[key],new RegExp(`selection\\.database && !.*selection\\.salesforce && .*prerequisites\\.adapter == '${adapter}'`));
 }
 });
}

test('ordinary promotion retains staging browsers and installs go-live browsers only for prerequisite smoke', () => {
 const stage=workflow.jobs['stage-and-smoke'].steps.find(step=>step.name==='Install governed browser');
 const promotion=workflow.jobs['go-live'].steps.find(step=>step.name==='Install governed browser for conditional prerequisite smoke');
 const qualification=workflow.jobs.quality.steps.find(step=>step.name==='Qualify governed browser without deployment credentials');
 const handover=Object.values(handoverWorkflow.jobs).flatMap(job=>job.steps).find(step=>step.name==='Install governed browser');
 assert.equal(stage.run,'bash scripts/rapid-release-browser.sh');
 assert.equal(stage['timeout-minutes'],4);
 assert.equal(stage['working-directory'],'controller');
 assert.equal(stage.if,undefined);
 assert.equal(promotion.run,stage.run);
 assert.equal(promotion['timeout-minutes'],stage['timeout-minutes']);
 assert.equal(promotion['working-directory'],stage['working-directory']);
 assert.equal(promotion.if,'fromJSON(inputs.manifest_json).selection.salesforce || fromJSON(inputs.manifest_json).selection.database');
 assert.equal(qualification.if,"inputs.mode == 'qualify'");
 assert.equal(qualification['working-directory'],stage['working-directory']);
 for(const step of [stage,promotion,qualification,handover]){
  assert.equal(step.run,stage.run);
  assert.equal(step['timeout-minutes'],stage['timeout-minutes']);
  assert.equal(step.env,undefined);
 }
});
