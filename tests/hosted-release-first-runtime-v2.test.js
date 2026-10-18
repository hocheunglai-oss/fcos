import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { typedFirstRuntimeFixture,typedOwnerRefreshFixture } from './helpers/hosted-first-runtime-v2.mjs';
import { admittedFirstRuntimeBaseline,validateFirstRuntimeOwnerRefresh,captureFirstRuntimeOriginalOwnerRefresh,firstRuntimePrevious,firstRuntimeDigest,assertFirstRuntimeSetup,firstRuntimeLegacyBinding,firstRuntimeSourceAbsence,FIRST_RUNTIME } from '../scripts/lib/hosted-release/first-runtime.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { vercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { createVercelAdapter } from '../scripts/lib/hosted-release/vercel.mjs';
import { buildReleaseManifest } from '../scripts/lib/hosted-release/manifest.mjs';
import { digest,releaseTargets } from '../scripts/lib/hosted-release/contract.mjs';
import { createPreviousProductionObserver,createSetupDiscoveryCollector } from '../scripts/lib/hosted-release/live-collector.mjs';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
function manifest(first) {
  const m=fixtureManifest();m.candidate.sha=first.value.candidateSha;m.candidate.sourceProfile=first.value.candidateSourceProfile;
  m.previousProduction=firstRuntimePrevious(first.reference,{now:first.now});m.runtime={expectedProduction:first.desiredRuntime,expectedPreview:first.desiredRuntime,expectedSha256:firstRuntimeDigest(first.desiredRuntime)};
  m.migration.expectedSchemaSha256=first.value.schema.sha256;return m;
}
const validates=(first,refresh,now=first.now)=>validateFirstRuntimeOwnerRefresh(refresh.reference,{baselineReference:first.reference,expectedSha256:refresh.reference.sha256,now});
test('typed baseline preserves historical unknowns, separate desired expectations and immutable exception marker',()=>{
  const f=typedFirstRuntimeFixture(),m=manifest(f),b=admittedFirstRuntimeBaseline(f.reference,{now:f.now});
  assert.equal(b.runtime.auth.salesforce.state,'unknown');assert.equal(b.desiredRuntime.auth.salesforce.mode,'application');
  assert.notEqual(m.previousProduction.runtimeSha256,m.runtime.expectedSha256);assert.equal(m.previousProduction.firstRuntime.desiredRuntimeSha256,m.runtime.expectedSha256);
  assert.equal(m.previousProduction.firstRuntime.rollbackEligible,false);assert.doesNotThrow(()=>assertFirstRuntimeSetup({setup:{firstRuntimeBaseline:f.reference},manifest:m,now:f.now}));
  for(const mutate of [v=>v.stage='application',v=>v.candidate.sourceProfile='frozen_04ee',v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19'}],v=>v.previousProduction.firstRuntime.rollbackEligible=true,v=>v.candidate.sha='b'.repeat(40),v=>v.previousProduction.firstRuntime.desiredRuntimeSha256='b'.repeat(64)]) {
    const copy=structuredClone(m);mutate(copy);assert.throws(()=>assertFirstRuntimeSetup({setup:{firstRuntimeBaseline:f.reference},manifest:copy,now:f.now}));
  }
});
test('typed historical data never admits copied values as old deployed state or invented diagnostic facts',()=>{
  const f=typedFirstRuntimeFixture();
  for(const mutate of [v=>v.runtime.flags[Object.keys(v.runtime.flags)[0]]={state:'known',value:true},v=>v.runtime.safety.readOnly=false,v=>v.runtime.auth.supabase={state:'authenticated',target:v.targets.supabaseProject,mode:'service_role'},
    v=>v.configurationCopy.deployedHistoricalValuesObserved=true,v=>v.configurationCopy.projectRecordCount=57,v=>v.configurationCopy.projectRecordKeys[1]=v.configurationCopy.projectRecordKeys[0],
    v=>v.configurationCopy.diagnostic.projectId='prj_foreign',v=>v.configurationCopy.diagnostic.target='production',v=>v.configurationCopy.diagnostic.httpStatus=401,v=>v.configurationCopy.diagnostic.notAfter=v.configurationCopy.diagnostic.issuedAt,
    v=>v.configurationCopy.diagnostic.observedAt=new Date(v.configurationCopy.diagnostic.notAfter).toISOString(),v=>v.configurationCopy.diagnostic.operationId='b'.repeat(64),v=>v.configurationCopy.diagnostic.baselineAccepted=true,
    v=>v.publicEvidence.diagnosticObservation={sha256:'a'.repeat(64)},v=>v.endpointAbsence.httpStatus=200,v=>v.previous.sha='b'.repeat(40),v=>v.candidateSourceProfile='frozen_04ee']) {
    const value=structuredClone(f.value);mutate(value);assert.throws(()=>admittedFirstRuntimeBaseline(f.referenceFor(value),{now:f.now}));
  }
  for(const mutate of [r=>r.accepted=false,r=>r.evidenceSha256='b'.repeat(64),r=>r.originalObservationTimesSha256='b'.repeat(64),r=>r.firstCutoverException.accepted=false,r=>r.firstCutoverException.scopeSha256='b'.repeat(64),r=>r.finalManifestApprovalRequired=false,r=>r.reviewedAt=new Date(f.now-1).toISOString()])
    assert.throws(()=>admittedFirstRuntimeBaseline(f.referenceFor(f.value,mutate),{now:f.now}));
  const changed=structuredClone(f.value);changed.publicEvidence.legacySalesforceIdentity.capturedAt=new Date(f.now-1000).toISOString();
  const json=JSON.stringify(changed);assert.throws(()=>admittedFirstRuntimeBaseline({...f.reference,json,sha256:firstRuntimeDigest(json)},{now:f.now}));
});
test('typed original-owner refresh requires fresh real targets, owner evidence and finite Xero session horizon',async()=>{
  const f=typedFirstRuntimeFixture(),r=typedOwnerRefreshFixture(f);assert.doesNotThrow(()=>validates(f,r));assert.doesNotThrow(()=>validates(f,r,f.now+1000));
  const direct=structuredClone(r.value);direct.observations.salesforce.identity.provenance='authenticated_organization_read';direct.observations.salesforce.identity.rawOrganizationFieldsObserved=true;
  assert.doesNotThrow(()=>validates(f,{reference:r.referenceFor(direct)}));
  for(const mutate of [v=>v.observations.xero.state='unknown',v=>v.observations.salesforce.validUntilKind='credential_expiry',v=>v.observations.salesforce.mode='oauth',v=>v.observations.salesforce.identity.isSandbox=true,v=>v.observations.salesforce.identity.orgId='00Dwrong',
    v=>v.observations.salesforce.identity.instanceUrl='https://foreign.my.salesforce.com',v=>v.observations.salesforce.identity.authModeObserved=true,v=>v.observations.salesforce.identity.rawOrganizationFieldsObserved=true,v=>v.observations.supabase.target='foreign',v=>v.observations.xero.target='11111111-1111-1111-1111-111111111111',
    v=>v.observations.xero.ownerId='another-owner',v=>v.observations.xero.authoritySha256='b'.repeat(64),v=>v.observations.xero.sessionExpiresAt=new Date(f.now+299999).toISOString(),
    v=>v.observations.supabase.validUntil=new Date(f.now+299999).toISOString(),v=>v.observations.salesforce.capturedAt=new Date(f.now-1800001).toISOString(),v=>v.configurationSha256='b'.repeat(64),v=>v.desiredRuntimeSha256='b'.repeat(64),
    v=>v.observations.xero.proof.capturedAt=new Date(f.now-1).toISOString(),v=>v.nativeEvidence.version.sha256='b'.repeat(64)]) {
    const value=structuredClone(r.value);mutate(value);const bad={reference:r.referenceFor(value)};assert.throws(()=>validates(f,bad));
  }
  assert.throws(()=>validates(f,r,f.now+300001));
  const late=typedOwnerRefreshFixture(f,{now:f.now+1800001});assert.doesNotThrow(()=>validates(f,late,f.now+1800001));
  const captured=await captureFirstRuntimeOriginalOwnerRefresh({baselineReference:f.reference,configuration:{valuesSha256:f.value.configurationCopy.valuesSha256},schema:r.value.schema,
    identityCapturedAt:r.value.identityCapturedAt,nativeEvidence:r.value.nativeEvidence,observations:r.value.observations,now:f.now,fetchImpl:()=>assert.fail('no provider calls'),clientFactory:()=>assert.fail('no credential access')});
  assert.deepEqual(captured,r.value);assert.doesNotMatch(JSON.stringify(captured),/access_token|refresh_token|PRIVATE_/);
});
function provider(f,read,m) {
  const t=m.targets,id=FIRST_RUNTIME.previousDeploymentId,url=FIRST_RUNTIME.previousUrl;
  const deployment={id,url:new URL(url).hostname,projectId:t.vercelProject,ownerId:t.vercelTeam,target:'production',readyState:'READY',createdAt:f.now-86400000,meta:{githubCommitSha:FIRST_RUNTIME.previousSha}};
  const project={id:t.vercelProject,accountId:t.vercelTeam,name:'fcos',link:{type:'github',org:'hocheunglai-oss',repo:'fcos'},targets:{production:{id}}};
  const alias={alias:new URL(t.productionOrigin).hostname,projectId:t.vercelProject,deploymentId:id,deployment:{id,url:deployment.url},redirect:null,deletedAt:null};
  return async(input,options)=>{const u=new URL(input);assert.equal(options.method||'GET','GET');
    if(u.origin==='https://api.vercel.com') {
      if(u.pathname.startsWith('/v1/integrations/configuration/'))return Response.json(read.configuration);
      if(u.pathname==='/v9/projects/'+t.vercelProject)return Response.json(project);
      if(u.pathname.startsWith('/v4/aliases/'))return Response.json(alias);
      if(u.pathname==='/v13/deployments/'+id)return Response.json(deployment);
    }
    if([t.productionOrigin,url].includes(u.origin)&&u.pathname==='/app-version.json')return Response.json(f.version);
    assert.fail('No runtime endpoint or new live probe: '+u.href);
  };
}
test('actual previous-production observer and discovery consume v2 without disguising desired runtime as historical',async()=>{
  const f=typedFirstRuntimeFixture(),m=manifest(f),read=vercelReadFixture({now:f.now,targets:m.targets});m.verification={vercelReadCredential:read.binding};
  const setup={firstRuntimeBaseline:f.reference,targets:m.targets,candidateSha:m.candidate.sha,vercelReadCredential:read.binding,legacyProductionBinding:firstRuntimeLegacyBinding(f.reference,{now:f.now})};
  const env={FCOS_HOSTED_VERCEL_READ_TOKEN:read.token},fetchImpl=provider(f,read,m);
  const result=await createPreviousProductionObserver({context:m,setup,env,fetchImpl,now:()=>f.now,schemaObservation:async()=>({sha256:f.value.schema.sha256}),login:()=>assert.fail('no login'),protection:()=>assert.fail('no protection')}).observePreviousProduction();
  assert.deepEqual(result.previousProduction,m.previousProduction);assert.equal(result.originalBaselineCapturedAt,f.value.runtime.capturedAt);
  let sourceCandidate;const collector=createSetupDiscoveryCollector({setup,env,fetchImpl,now:()=>f.now,verifyLegacySource:(_cwd,candidate)=>{sourceCandidate=candidate;}});
  const production=await collector.production(),discovery=await collector.runtime(production);
  assert.equal(sourceCandidate,f.value.candidateSha);assert.equal(discovery.historicalRuntimeUnobserved,true);assert.equal(discovery.baselineRequired,true);
  assert.equal(discovery.qualificationAccepted,false);assert.equal(discovery.automaticRollbackEligible,false);assert.equal(discovery.runtime.auth.xero.state,'unknown');
  assert.deepEqual(discovery.desiredRuntime,f.desiredRuntime);
});
test('source absence resolves only exact reviewed candidate pair and preserves the legacy default',()=>{
  const f=typedFirstRuntimeFixture();assert.equal(firstRuntimeSourceAbsence(ROOT).candidateSha,FIRST_RUNTIME.candidateSha);
  assert.equal(firstRuntimeSourceAbsence(ROOT,f.value.candidateSha).candidateSha,f.value.candidateSha);
  assert.throws(()=>firstRuntimeSourceAbsence(ROOT,'e'.repeat(40)),{code:'FIRST_RUNTIME_SOURCE_CAPABILITY'});
});

test('real Production adapter rejects missing or exhausted typed owner proof before provider/credential work',async()=>{
  const f=typedFirstRuntimeFixture();f.value.candidateSha=FIRST_RUNTIME.candidateSha;f.value.candidateSourceProfile='frozen_04ee';f.reference=f.referenceFor();
  const m=manifest(f),H='a'.repeat(64),setup={schemaVersion:2,controllerSha:m.controller.sha,targetsSha256:digest(releaseTargets()),epoch:m.epoch,firstRuntimeBaseline:f.reference,
    verification:{runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:{}}};
  const plan={...m,branch:m.candidate.branch};delete plan.previousProduction;
  const full=buildReleaseManifest({plan,setup,controllerSha:m.controller.sha,candidateSha:m.candidate.sha,
    collectSource:()=>({candidate:m.candidate,controller:m.controller,checks:[{id:'unit'}]}),previousProduction:m.previousProduction,now:()=>f.now});
  const env={FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(setup),
    GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:m.targets.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'17',FCOS_CONTROLLER_SHA:m.controller.sha,
    FCOS_HOSTED_CREDENTIAL_CLASS:'production',FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_FIXTURE_WRITER',FCOS_HOSTED_VERCEL_TOKEN_ID:'id'};
  let current=f.now;const adapter=createVercelAdapter({manifest:full,candidateDirectory:ROOT,env,now:()=>current,execute:()=>assert.fail('no CLI'),fetchImpl:()=>assert.fail('no provider read')});
  await assert.rejects(adapter.admit(full,'production'),{code:'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'});
  const refresh=typedOwnerRefreshFixture(f);env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH=JSON.stringify(refresh.reference);env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256=refresh.reference.sha256;
  current+=300001;await assert.rejects(adapter.admit(full,'production.promote'),{code:'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'});
});
