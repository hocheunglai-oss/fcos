import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinatorHandler } from '../supabase/functions/release-coordinator/index.ts';
import { createMetadataAdmission, digest } from '../supabase/functions/release-coordinator/core.mjs';
import { createGithubApprovalValidator, createGithubResumeValidator, createGithubQualificationValidator } from '../supabase/functions/release-coordinator/approval.mjs';

const H='a'.repeat(64),S='b'.repeat(40),B='c'.repeat(40),C='d'.repeat(40),repository='hocheunglai-oss/fcos';
const ref='refs/heads/codex/qualification',jobWorkflowRef=`${repository}/.github/workflows/hosted-release-controller.yml@${S}`;
const qualificationAdmission={repository,repositoryId:'77',ref,bootstrapSha:B,
  callerWorkflowRef:`${repository}/.github/workflows/authenticated-release.yml@${ref}`,callerWorkflowSha:B,
  jobWorkflowRef,jobWorkflowSha:S,candidateSha:C,setupSha256:H};
const qPrincipal={kind:'github',qualificationOnly:true,qualificationAdmission,runId:'101',ref,sha:B,workflowSha:B,
  workflowRef:qualificationAdmission.callerWorkflowRef,jobWorkflowRef,jobWorkflowSha:S};
const manifest={epoch:1,stage:'qualification',executionMode:'qualification',setupSha256:H,candidate:{sha:C},
  controller:{sha:S,workflow:'.github/workflows/hosted-release-controller.yml'},qualificationSource:{ref,bootstrapSha:B,
    callerWorkflowRef:qualificationAdmission.callerWorkflowRef,controllerSha:S,candidateSha:C}};
const scope={epoch:1,owner:{kind:'release',id:'features'},releaseId:'metadata-test',manifestHash:await digest(manifest)};
const request=(action,payload=scope,financial=false)=>new Request('http://localhost/coordinator',{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer fixture',...(financial?{'x-fcos-coordination-adapter':'financial'}:{})},
  body:JSON.stringify({action,payload})});
const pending=error=>error.code==='COORDINATION_METADATA_PENDING'&&error.status===429;

// Reservations are deliberately conservative: they remain charged while any
// bundle read is pending and for a full minute after that bundle settles.
test('metadata admission enforces exact rolling capacity and bounded recovery without refunding failures',()=>{
  let clock=0;const gate=createMetadataAdmission({now:()=>clock});
  gate.admit(8).finish();clock=10000;gate.admit(37).finish();clock=30000;
  assert.throws(()=>gate.admit(8),error=>pending(error)&&error.retryAfterSeconds===30);
  clock=59999;assert.throws(()=>gate.admit(8),error=>pending(error)&&error.retryAfterSeconds===1);
  clock=60000;gate.admit(8).finish();assert.throws(()=>gate.admit(1),pending);
  clock=70000;gate.admit(37).finish();assert.throws(()=>gate.admit(1),pending);
  for(const weight of [0,46,-1,1.5])assert.throws(()=>gate.admit(weight),/METADATA_WEIGHT_INVALID/);
});

test('pending and queued reads cannot age out and bunch into a later rolling window',async()=>{
  let clock=0;const release=[],gate=createMetadataAdmission({now:()=>clock}),bundle=gate.admit(45);
  const reads=Array.from({length:3},()=>bundle.runRead(()=>new Promise(resolve=>{release.push(resolve);})));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(release.length,2,'The third read is queued');
  bundle.finish();clock=180000;assert.throws(()=>gate.admit(1),error=>pending(error)&&error.retryAfterSeconds===60);
  release[0]();await reads[0];await new Promise(resolve=>setImmediate(resolve));assert.equal(release.length,3);
  assert.throws(()=>gate.admit(1),pending);release[1]();release[2]();await Promise.all(reads);
  clock=239999;assert.throws(()=>gate.admit(1),error=>pending(error)&&error.retryAfterSeconds===1);
  clock=240000;gate.admit(45).finish();
  await assert.rejects(bundle.runRead(()=>{}),/RESERVATION_FINISHED/);
});

test('a collector cannot dispatch more GETs than its reserved bundle',async()=>{
  let reads=0;const gate=createMetadataAdmission(),bundle=gate.admit(1);
  await bundle.runRead(()=>{reads++;});await assert.rejects(bundle.runRead(()=>{reads++;}),/RESERVATION_EXHAUSTED/);
  bundle.finish();assert.equal(reads,1);
});

test('actual Request handler returns exact pending before any SQL or metadata dispatch for every admission collector',async()=>{
  for(const [action,principal,payload,weight] of [
    ['approve',{kind:'github',environment:'fcos-production-release'},scope,8],
    ['resume',{kind:'github',environment:'fcos-hosted-production-resume'},scope,7],
    ['register',qPrincipal,{...scope,manifest},5],['begin',qPrincipal,scope,5],['claim',qPrincipal,scope,5],
  ]) {
    let sql=0,metadata=0;const gate=createMetadataAdmission({now:()=>0});gate.admit(45).finish();
    const handler=createCoordinatorHandler({store:{request:()=>{sql++;throw Error('SQL must not run');}},authenticateGithub:()=>principal,
      admitMetadata:({weight:actual,action:actualAction,principal:actualPrincipal})=>{
        assert.equal(actual,weight);assert.equal(actualAction,action);assert.equal(actualPrincipal,principal);return gate.admit(actual);
      },validateApproval:()=>{metadata++;},validateResume:()=>{metadata++;},validateQualification:()=>{metadata++;}});
    const response=await handler(request(action,payload));assert.equal(response.status,429);
    assert.equal(response.headers.get('retry-after'),'60');assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{error:'COORDINATION_METADATA_PENDING'});assert.equal(sql,0);assert.equal(metadata,0);
  }
});

test('qualification recovery and the independent financial adapter never consume service metadata admission',async()=>{
  let reservations=0,metadata=0,sql=0;
  const handler=createCoordinatorHandler({store:{request:()=>{sql++;return {saved:true};}},authenticateGithub:()=>qPrincipal,
    authenticateFinancial:()=>({kind:'financial',ownerId:'finance'}),admitMetadata:()=>{reservations++;throw Error('No reservation allowed');},
    validateQualification:()=>{metadata++;throw Error('No volatile metadata allowed');}});
  for(const action of ['snapshot','complete','uncertain','readback','appendEvidence','finish']) {
    const response=await handler(request(action,{...scope,evidence:{outcome:'unknown'}}));assert.equal(response.status,200,action);
  }
  const financial={...scope,owner:{kind:'financial',id:'finance'}};
  assert.equal((await handler(request('begin',financial,true))).status,200);
  assert.equal(sql,7);assert.equal(reservations,0);assert.equal(metadata,0);
});

test('one shared scheduler bounds approval, resume and qualification GETs through body consumption',async()=>{
  let active=0,maximum=0,reads=0;const gate=createMetadataAdmission();
  const fetchImpl=async(url,options)=>{
    active++;maximum=Math.max(maximum,active);reads++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    return {ok:true,redirected:false,json:async()=>{
      await new Promise(resolve=>setImmediate(resolve));active--;
      return url==='https://api.github.com/user'?{login:'hocheunglai-oss',id:9}:{};
    }};
  };
  const policy={repository,repositoryId:'77',qualificationAdmission};
  const options={policy,token:'readonly-fixture',fetchImpl,metadataAdmission:gate};
  const validators=[createGithubApprovalValidator(options),createGithubResumeValidator(options),createGithubQualificationValidator(options)];
  const weights=[8,7,5],bundles=weights.map(weight=>gate.admit(weight));
  const results=await Promise.allSettled(validators.map((validate,index)=>validate({principal:index===2?qPrincipal:{runId:'101'},metadataReservation:bundles[index]}).finally(()=>bundles[index].finish())));
  assert.ok(results.every(result=>result.status==='rejected'),'Deliberately incomplete metadata must fail closed');
  assert.equal(reads,20);assert.equal(maximum,2);assert.equal(active,0);
  gate.admit(25).finish();assert.throws(()=>gate.admit(1),pending);
});

test('handler supplies reservation to validators and finalizes it after failed metadata reads',async()=>{
  let finalized=0,sql=0;const reservation={finish:()=>{finalized++;}};
  const handler=createCoordinatorHandler({store:{request:()=>{sql++;return {}; }},authenticateGithub:()=>qPrincipal,
    admitMetadata:()=>reservation,validateQualification:context=>{assert.equal(context.metadataReservation,reservation);throw Error('collector failure');}});
  assert.equal((await handler(request('register',{...scope,manifest}))).status,503);assert.equal(finalized,1);assert.equal(sql,0);
});
