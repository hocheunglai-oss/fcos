import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createGithubAuthenticator, GITHUB_ISSUER, COORDINATOR_AUDIENCE } from '../supabase/functions/release-coordinator/auth.mjs';
import { createCoordinatorHandler } from '../supabase/functions/release-coordinator/index.ts';
import { RETAINED_PREVIEW as old } from '../supabase/functions/release-coordinator/core.mjs';

const now=Date.now(), q=old.admission;
const pair=await generateKeyPair('RS256'), key=await exportJWK(pair.publicKey);
key.kid='retained-owner-test';key.alg='RS256';
const policy={repository:q.repository,repositoryId:q.repositoryId,ref:'refs/heads/main',
  workflows:[{callerWorkflowRef:`${q.repository}/.github/workflows/authenticated-release.yml@refs/heads/main`,
    jobWorkflowRef:`${q.repository}/.github/workflows/hosted-release-controller.yml@${'a'.repeat(40)}`,jobWorkflowSha:'a'.repeat(40)}],
  registrationJob:'release / prepare',approvalJobPrefix:'release / production / ',resumeJobPrefix:'release / execute / ',
  qualificationAdmission:{...q,ref:'refs/heads/codex/fresh-qualified-successor',bootstrapSha:'b'.repeat(40),callerWorkflowSha:'b'.repeat(40),
    callerWorkflowRef:`${q.repository}/.github/workflows/authenticated-release.yml@refs/heads/codex/fresh-qualified-successor`,
    candidateSha:'c'.repeat(40),setupSha256:'d'.repeat(64)}};
const authenticate=createGithubAuthenticator({policy,jwks:createLocalJWKSet({keys:[key]}),now:()=>now});
async function token(overrides={}) {
  const seconds=Math.floor(now/1000);
  return new SignJWT({repository:q.repository,repository_id:q.repositoryId,ref:q.ref,sha:q.bootstrapSha,workflow_sha:q.callerWorkflowSha,
    workflow_ref:q.callerWorkflowRef,job_workflow_ref:q.jobWorkflowRef,job_workflow_sha:q.jobWorkflowSha,
    run_id:old.runId,run_attempt:'1',actor:old.actor,actor_id:old.actorId,environment:old.environment,
    ref_protected:'true',ref_type:'branch',event_name:'workflow_dispatch',runner_environment:'github-hosted',...overrides})
    .setProtectedHeader({alg:'RS256',kid:key.kid}).setIssuer(GITHUB_ISSUER).setAudience(COORDINATOR_AUDIENCE)
    .setSubject(`repo:${q.repository}:environment:${overrides.environment??old.environment}`).setJti('retained-owner-jwt')
    .setIssuedAt(seconds).setNotBefore(seconds-1).setExpirationTime(seconds+120).sign(pair.privateKey);
}
const payload={epoch:old.epoch,owner:{kind:'release',id:'features'},releaseId:old.releaseId,manifestHash:old.manifestHash,
  phase:'preview.create',operationId:old.operationId,evidence:{outcome:'applied',result:{id:'dpl_exactOwnerReadback'}}};
function handler(onRequest) {return createCoordinatorHandler({store:{request:onRequest},authenticateGithub:authenticate});}
async function call(h,action,p=payload,bearer) {return h(new Request('https://coordinator.invalid/coordinate',{
  method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer??await token()}`},body:JSON.stringify({action,payload:p})}));}

test('original JWT retains only exact readback after successor policy replaces writer tuple',async()=>{
  const principal=await authenticate(await token());
  assert.equal(principal.retainedPreviewReadbackOnly,true);assert.equal(principal.qualificationOnly,true);
  assert.deepEqual(principal.qualificationAdmission,q);assert.equal(principal.runId,old.runId);
  const calls=[],h=handler(async(action,p,actor)=>{calls.push(action);assert.equal(actor.retainedPreviewReadbackOnly,true);return {observed:true};});
  for(const action of ['snapshot','readback'])assert.equal((await call(h,action)).status,200);
  assert.deepEqual(calls,['snapshot','readback']);
  const verification=await authenticate(await token({environment:'fcos-hosted-verification',run_id:'39811703825'}));
  assert.equal(verification.retainedPreviewReadbackOnly,true);assert.equal(verification.runId,'39811703825');
});
test('old identity cannot register, begin, complete or grant itself fresh authority',async()=>{
  const h=handler(async()=>assert.fail('must refuse before storage'));
  for(const action of ['register','claim','begin','complete','uncertain','appendEvidence','finish','approve','resume']) {
    const r=await call(h,action);assert.equal(r.status,403,action);
    assert.equal((await r.json()).error,'COORDINATION_RETAINED_PREVIEW_READBACK_ONLY');
  }
});
test('retained owner cannot cross release, epoch, manifest, phase or operation boundary',async()=>{
  const h=handler(async()=>assert.fail('must refuse before storage'));
  for(const patch of [{releaseId:'another-release'},{epoch:2},{manifestHash:'f'.repeat(64)},
    {phase:'production.stage'},{operationId:'another-operation'},{owner:{kind:'financial',id:old.releaseId}}])
    assert.equal((await call(h,'readback',{...payload,...patch})).status,403,JSON.stringify(patch));
});
test('invalid run, rerun, actor or source cannot inherit the retired readback admission',async()=>{
  for(const patch of [{run_id:'not-a-run'},{run_attempt:'2'},{actor_id:'1'},{actor:'another'},
    {sha:'f'.repeat(40)},{workflow_sha:'f'.repeat(40)},{job_workflow_sha:'f'.repeat(40)},
    {job_workflow_ref:q.jobWorkflowRef.replace(q.jobWorkflowSha,'f'.repeat(40))},{environment:'fcos-production-release'},
    {ref_protected:'false'},{repository_id:'1'},{workflow_ref:q.callerWorkflowRef+'wrong'}])
    await assert.rejects(authenticate(await token(patch)),undefined,JSON.stringify(patch));
});
test('same retired branch cannot become a new writer even while old tuple remains active',async()=>{
  const oldPolicyAuth=createGithubAuthenticator({policy:{...policy,qualificationAdmission:q},jwks:createLocalJWKSet({keys:[key]}),now:()=>now});
  const bearer=await token({run_id:'39811703825'}),principal=await oldPolicyAuth(bearer);
  assert.equal(principal.runId,'39811703825');assert.equal(principal.retainedPreviewReadbackOnly,true);
  const h=handler(async()=>assert.fail('new readback run cannot become writer'));
  assert.equal((await call(h,'begin',payload,bearer)).status,403);
  assert.equal((await oldPolicyAuth(await token())).retainedPreviewReadbackOnly,true);
});
test('existing current successor writer keeps its normal qualification scope',async()=>{
  const next=policy.qualificationAdmission;
  const principal=await authenticate(await token({ref:next.ref,sha:next.bootstrapSha,workflow_sha:next.callerWorkflowSha,
    workflow_ref:next.callerWorkflowRef,run_id:'99999999999'}));
  assert.equal(principal.qualificationOnly,true);assert.equal(principal.retainedPreviewReadbackOnly,undefined);
  assert.deepEqual(principal.qualificationAdmission,next);
});
