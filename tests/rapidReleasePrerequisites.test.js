import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { verifyBeforeBootstrap, runPrerequisites } from '../scripts/lib/rapid-release/prerequisites.mjs';
function fixture() {
 const directory=mkdtempSync(join(tmpdir(),'rapid-prerequisite-')),source='// Tracked, reviewed adapter fixture.\n',h='b'.repeat(64);
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
 mkdirSync(join(directory,'scripts'));mkdirSync(join(directory,'config'));
 writeFileSync(join(directory,'scripts/adapter.mjs'),source);
 writeFileSync(join(directory,'config/rapid-release-adapters.json'),JSON.stringify({schemaVersion:1,adapters:[{id:'schema-fixture',status:'qualified',sourceDigest:digest(Buffer.from(source)),salesforce:false,database:true,supportsDeferredStage:true,path:'scripts/adapter.mjs'}]}));
 git(['add','.']);git(['commit','-m','fixture']);
 const manifest=createManifest({candidate:{sha:'a'.repeat(40),sourceDigest:h,lockDigest:h},controllerSha:git(['rev-parse','HEAD']),previous:{deploymentId:'dpl_old',sha:'d'.repeat(40),configurationDigest:h,schemaDigest:h},paths:['supabase/migrations/20990101000000_fixture.sql'],
 publicEnvironment:{VITE_SUPABASE_URL:`https://${targets().supabaseProject}.supabase.co`,VITE_SUPABASE_PUBLISHABLE_KEY:`sb_publishable_${'p'.repeat(25)}`},releaseId:'rapid-schema-fixture',
 prerequisites:{adapter:'schema-fixture',adapterDigest:digest(Buffer.from(source)),plan:{deferSchemaDependentSmoke:true,bootstrapFingerprint:h}}});
 const staged={id:'dpl_new',buildId:manifest.build.buildId};
 const proof={passed:true,mode:'pre_bootstrap',deploymentId:staged.id,buildId:staged.buildId,manifestHash:digest(manifest),isolationVerified:true,businessWrites:0,completedChecks:['runtime_identity','authentication_denials'],deferredChecks:manifest.selection.modules,bootstrapFingerprint:h};
 const approval={manifestHash:digest(manifest),candidateSha:manifest.candidate.sha,buildId:staged.buildId,deploymentId:staged.id,previousDeploymentId:'dpl_old',environment:'fcos-production-release',reviewer:targets().account,nativeReviewVerified:true,runId:1,approvedAt:new Date().toISOString()};
 return{directory,manifest,staged,proof,approval,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
test('deferred schema evidence must bind the actual verified bootstrap, never substitute the planned fingerprint',async()=>{
 const f=fixture();try{
  await assert.rejects(verifyBeforeBootstrap({manifest:f.manifest,staged:f.staged,controllerDirectory:f.directory,load:async()=>({verifyPreBootstrapStage:async()=>({...f.proof,bootstrapFingerprint:'f'.repeat(64)})})}),/PREBOOTSTRAP_STAGE_PROOF_REQUIRED/);
  const proof=await verifyBeforeBootstrap({manifest:f.manifest,staged:f.staged,controllerDirectory:f.directory,load:async()=>({verifyPreBootstrapStage:async()=>f.proof})});
  assert.equal(proof.mode,'pre_bootstrap');assert.deepEqual(proof.deferredChecks,f.manifest.selection.modules);
 }finally{f.cleanup();}
});
test('qualified prerequisite results publish typed recovery receipts and keep private evidence private',async()=>{
 const f=fixture();try{
  const result=await runPrerequisites({manifest:f.manifest,staged:f.staged,approval:f.approval,controllerDirectory:f.directory,
   load:async()=>({applyReviewedPrerequisites:async()=>({passed:true,manifestHash:digest(f.manifest),backwardCompatible:true,
    completedOperations:[{operationId:'schema-bootstrap-1',verified:true,intentRecorded:true,evidenceDigest:'e'.repeat(64),customerPayments:'PRIVATE_EVIDENCE'}],
    database:{destructiveRollback:false,readbackVerified:true,customerPayments:'PRIVATE_EVIDENCE'},financialRecords:'PRIVATE_EVIDENCE'})})});
  assert.equal(result.completedOperations.length,1);assert.equal(JSON.stringify(result).includes('PRIVATE_EVIDENCE'),false);
 }finally{f.cleanup();}
});
