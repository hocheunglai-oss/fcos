import { readFileSync } from 'node:fs';
import { FIRST_RUNTIME, firstRuntimeDigest, firstRuntimeTargets,firstRuntimeConfigurationDependencies } from '../../scripts/lib/hosted-release/first-runtime.mjs';
import { OBSERVATION_DECLARATIONS, LEGACY_XERO_MAPPING_READ_BINDING } from '../../scripts/lib/runtime-compatibility-observation.mjs';
import { PREVIEW_PARITY_POLICY } from '../../scripts/lib/preview-parity.mjs';
import { fcosSalesforceEnvironment } from '../../config/fcosConnections.js';
export function firstRuntimeFixture({now=Date.now()}={}) {
  const time=new Date(now).toISOString(),H='a'.repeat(64),targets=firstRuntimeTargets(),tenant='12345678-1234-1234-1234-123456789abc';
  const version={commit:FIRST_RUNTIME.previousSha,deploymentId:null,gitDirty:false,provenance:{commit:FIRST_RUNTIME.previousSha,gitDirty:false,releaseEligible:true,sourceAttested:false,
    sourceDigest:FIRST_RUNTIME.sourceSha256,sourceDigestAlgorithm:'sha256:fcos-vercel-source-v1'}};
  const runtime={capturedAt:time,deploymentId:FIRST_RUNTIME.previousDeploymentId,sha:FIRST_RUNTIME.previousSha,
    flags:Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(k=>[k,{state:'known',value:false}])),safety:{readOnly:false,externalActions:Object.fromEntries(PREVIEW_PARITY_POLICY.externalActions.map(k=>[k,false]))},
    auth:{supabase:{state:'authenticated',target:targets.supabaseProject,mode:'secret_key'},salesforce:{state:'authenticated',target:fcosSalesforceEnvironment('production').orgId,mode:'oauth'},xero:{state:'authenticated',target:tenant,mode:'oauth'},
      ...Object.fromEntries(['drive','fcuno','microsoft','openai'].map(k=>[k,{state:'unknown',target:'',mode:''}]))}};
  const value={schemaVersion:1,kind:'fcos_first_runtime_baseline_v1',candidateSha:FIRST_RUNTIME.candidateSha,targets,
    previous:{deploymentId:FIRST_RUNTIME.previousDeploymentId,sha:FIRST_RUNTIME.previousSha,url:FIRST_RUNTIME.previousUrl,sourceSha256:FIRST_RUNTIME.sourceSha256,createdAt:new Date(now-86400000).toISOString()},
    source:{helperRevision:firstRuntimeDigest(readFileSync(new URL('../../scripts/lib/runtime-compatibility-observation.mjs',import.meta.url))),declarationsSha256:firstRuntimeDigest(JSON.stringify({pure:OBSERVATION_DECLARATIONS,legacyRead:LEGACY_XERO_MAPPING_READ_BINDING})),observationKind:'independent_provider_probe_and_verified_deployment_configuration'},
    configuration:{complete:true,deploymentId:FIRST_RUNTIME.previousDeploymentId,sha:FIRST_RUNTIME.previousSha,capturedAt:time,reader:`/v10/projects/${targets.vercelProject}/env?target=production&decrypt=true`,updatedAt:new Date(now-90000000).toISOString(),
      keys:['FIXTURE_SETTING','VERCEL_ENV','VERCEL_DEPLOYMENT_KEY'],recordKeys:['FIXTURE_SETTING'],observedKeys:['FIXTURE_SETTING','VERCEL_ENV'],unobservedKeys:['VERCEL_DEPLOYMENT_KEY'],
      absentDependencies:firstRuntimeConfigurationDependencies().keys.filter(k=>k!=='VERCEL_ENV'),dependencySha256:firstRuntimeConfigurationDependencies().sha256,valuesSha256:H},
    endpointAbsence:{url:FIRST_RUNTIME.previousUrl+'/api/connection-runtime',method:'GET',httpStatus:404,redirected:false,sourceAbsent:true,capturedAt:time},
    schema:{projectRef:targets.supabaseProject,sha256:H,capturedAt:time,readOnly:true},nativeEvidence:Object.fromEntries(['identitySha256','projectSha256','deploymentSha256','aliasBeforeSha256','aliasAfterSha256','versionSha256','environmentInventorySha256','environmentValuesSha256','endpointAbsenceSha256','schemaSha256'].map(k=>[k,k==='versionSha256'?firstRuntimeDigest(version):H])),runtime};
  const referenceFor=(v=value)=>{
    const json=JSON.stringify(v),sha256=firstRuntimeDigest(json),review={schemaVersion:1,kind:'fcos_root_accepted_first_runtime_baseline_v1',accepted:true,reviewerId:'/root',repository:targets.repository,
      baselineSha256:sha256,nativeEvidenceSha256:firstRuntimeDigest(v.nativeEvidence),reviewedAt:time},reviewJson=JSON.stringify(review);
    return {json,sha256,acceptance:{json:reviewJson,sha256:firstRuntimeDigest(reviewJson)}};
  };
  return {value,reference:referenceFor(),referenceFor,runtime,version,now,tenant};
}
export function firstRuntimeOwnerRefreshFixture(first,{now=first.now,runtime=first.runtime}={}) {
  const time=new Date(now).toISOString(),value={schemaVersion:1,kind:'fcos_first_runtime_original_owner_refresh_v1',baselineSha256:first.reference.sha256,targets:first.value.targets,previous:first.value.previous,
    configurationSha256:first.value.configuration.valuesSha256,identityCapturedAt:time,schema:{...first.value.schema,capturedAt:time},runtime:{...runtime,capturedAt:time},nativeEvidence:first.value.nativeEvidence};
  const referenceFor=(v=value)=>{const json=JSON.stringify(v),sha256=firstRuntimeDigest(json),review={schemaVersion:1,kind:'fcos_root_accepted_first_runtime_owner_refresh_v1',accepted:true,reviewerId:'/root',repository:first.value.targets.repository,
    baselineSha256:first.reference.sha256,observationSha256:sha256,nativeEvidenceSha256:firstRuntimeDigest(v.nativeEvidence),reviewedAt:time},reviewJson=JSON.stringify(review);
    return {json,sha256,acceptance:{json:reviewJson,sha256:firstRuntimeDigest(reviewJson)}};};
  return {value,reference:referenceFor(),referenceFor};
}
