import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {load} from 'js-yaml';
import {handoverDigest} from '../scripts/lib/rapid-release/handover.mjs';
const workflow=load(readFileSync(new URL('../.github/workflows/fcos-rapid-handover.yml',import.meta.url),'utf8'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
test('handover admits installed frozen workflow and native quality before credentialed source checkout',async()=>{
  const steps=workflow.jobs['handover-apply'].steps,admit=steps.findIndex(step=>step.id==='admit-controller');
  const checkout=steps.findIndex(step=>step.uses?.startsWith('actions/checkout@'));
  assert.ok(admit>=0&&admit<checkout);assert.match(steps[checkout].with.ref,/admit-controller.outputs.controller_sha/);
  const sha='c'.repeat(40),dispatcher='d'.repeat(40),plan={controllerSha:sha,candidateSha:'a'.repeat(40)};
  const previous={...process.env};Object.assign(process.env,{PLAN_JSON:JSON.stringify(plan),PLAN_HASH:handoverDigest(plan),CANDIDATE_SHA:plan.candidateSha});
  let changed=false,quality=true,ancestor=true,outputs=0;
  const github={rest:{repos:{get:async()=>({data:{default_branch:'main'}}),getBranch:async()=>({data:{protected:true,commit:{sha:dispatcher}}}),
    compareCommits:async()=>({data:{status:ancestor?'ahead':'diverged'}}),getContent:async({ref})=>({data:{type:'file',sha:changed&&ref===sha?'f'.repeat(40):'b'.repeat(40)}})},
  checks:{listForRef:async()=>({data:{total_count:1,check_runs:[{id:1,head_sha:sha,name:'code-and-database',app:{id:15368},status:'completed',conclusion:quality?'success':'failure'}]}})}}};
  const run=()=>new AsyncFunction('require','github','context','core',steps[admit].with.script)(createRequire(import.meta.url),github,
    {repo:{owner:'hocheunglai-oss',repo:'fcos'},actor:'hocheunglai-oss',sha:dispatcher},{setOutput:()=>outputs++});
  try {
    await run();assert.equal(outputs,1);
    for(const mutate of [()=>changed=true,()=>{changed=false;quality=false;},()=>{quality=true;ancestor=false;}]){
      mutate();await assert.rejects(run(),/QUALIFIED_INSTALLED_HANDOVER_CONTROLLER_REQUIRED/);assert.equal(outputs,1);
    }
  } finally {for(const key of ['PLAN_JSON','PLAN_HASH','CANDIDATE_SHA'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
