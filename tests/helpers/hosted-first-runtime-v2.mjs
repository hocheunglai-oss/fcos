import { firstRuntimeFixture } from './hosted-first-runtime.mjs';
import { COMPATIBILITY_CORRECTION } from '../../config/hostedCompatibilityCorrection.js';
import { FIRST_RUNTIME_CONFIGURATION_COPY,firstRuntimeDigest,firstRuntimeOriginalObservationTimes,firstRuntimeCutoverScope,TYPED_FIRST_RUNTIME_EXCEPTION } from '../../scripts/lib/hosted-release/first-runtime.mjs';
const digest=firstRuntimeDigest,H='a'.repeat(64);
export function typedFirstRuntimeFixture({now=Date.now()}={}) {
  const first=firstRuntimeFixture({now}),time=new Date(now).toISOString(),ref={sha256:H,capturedAt:time};
  const desiredRuntime={flags:first.runtime.flags,safety:first.runtime.safety,auth:{...first.runtime.auth,salesforce:{...first.runtime.auth.salesforce,mode:'application'}}};
  const runtime={...first.runtime,flags:Object.fromEntries(Object.keys(first.runtime.flags).map(k=>[k,{state:'unknown'}])),
    safety:{readOnly:null,externalActions:Object.fromEntries(Object.keys(first.runtime.safety.externalActions).map(k=>[k,null]))},
    auth:Object.fromEntries(Object.keys(first.runtime.auth).map(k=>[k,{state:'unknown',target:'',mode:''}]))};
  const value={schemaVersion:2,kind:'fcos_first_runtime_baseline_v2',candidateSha:COMPATIBILITY_CORRECTION.candidateSha,candidateSourceProfile:COMPATIBILITY_CORRECTION.sourceProfile,
    targets:first.value.targets,previous:first.value.previous,source:{...first.value.source,observationKind:'historical_endpoint_and_current_configuration_copy_separated'},
    configurationCopy:{kind:'current_production_configuration_copy',complete:true,deployedHistoricalValuesObserved:false,projectRecordCount:58,
      projectRecordKeys:Array.from({length:58},(_,i)=>'FIXTURE_'+i),projectRecordsSha256:H,valuesSha256:H,capturedAt:time,
      diagnostic:{...Object.fromEntries(Object.entries(FIRST_RUNTIME_CONFIGURATION_COPY).filter(([k])=>k!=='projectRecordCount')),projectId:first.value.targets.vercelProject,
        target:'preview',copyFrom:'production',httpStatus:200,observedAt:time,issuedAt:now-1000,notAfter:now+86400000-1000,baselineAccepted:false,fullQualificationAccepted:false}},
    endpointAbsence:first.value.endpointAbsence,schema:first.value.schema,
    nativeEvidence:Object.fromEntries(['identity','project','deployment','aliasBefore','aliasAfter','version','endpointAbsence','schema'].map(k=>[k,{...ref,sha256:k==='version'?first.value.nativeEvidence.versionSha256:H}])),
    publicEvidence:Object.fromEntries(['diagnosticObservation','diagnosticAcceptance','preservationPrecision','legacySalesforceIdentity'].map(k=>[k,{...ref}])),
    runtime,desiredRuntime,originalOwners:Object.fromEntries(['supabase','salesforce','xero'].map(k=>[k,{ownerId:'actual-owner-'+k,authority:{...ref}}]))};
  const referenceFor=(v=value,changeReview=()=>{})=>{
    const json=JSON.stringify(v),sha256=digest(json),review={schemaVersion:2,kind:'fcos_root_accepted_first_runtime_baseline_v2',accepted:true,reviewerId:'/root',repository:v.targets.repository,
      baselineSha256:sha256,evidenceSha256:digest({nativeEvidence:v.nativeEvidence,publicEvidence:v.publicEvidence,configurationCopy:v.configurationCopy,originalOwners:v.originalOwners}),
      originalObservationTimesSha256:digest(firstRuntimeOriginalObservationTimes(v)),firstCutoverException:{kind:TYPED_FIRST_RUNTIME_EXCEPTION,accepted:true,scopeSha256:digest(firstRuntimeCutoverScope(v))},
      finalManifestApprovalRequired:true,reviewedAt:time};
    changeReview(review);const reviewJson=JSON.stringify(review);return {json,sha256,acceptance:{json:reviewJson,sha256:digest(reviewJson)}};
  };
  return {...first,value,reference:referenceFor(),referenceFor,desiredRuntime};
}
export function typedOwnerRefreshFixture(first,{now=first.now}={}) {
  const time=new Date(now).toISOString(),later=new Date(now+600000).toISOString(),sf=first.desiredRuntime.auth.salesforce;
  const observations=Object.fromEntries(['supabase','salesforce','xero'].map(k=>[k,{...first.desiredRuntime.auth[k],ownerId:first.value.originalOwners[k].ownerId,
    authoritySha256:first.value.originalOwners[k].authority.sha256,capturedAt:time,validUntil:later,validUntilKind:'observation_admissibility_only',proof:{sha256:H,capturedAt:time},
    ...(k==='salesforce'?{identity:{orgId:sf.target,instanceUrl:'https://fratellicosulich.my.salesforce.com',isSandbox:false,authModeObserved:false,provenance:'source_enforced_organization_guard',rawOrganizationFieldsObserved:false}}:{}),...(k==='xero'?{sessionExpiresAt:later}:{})}]));
  const value={schemaVersion:2,kind:'fcos_first_runtime_original_owner_refresh_v2',baselineSha256:first.reference.sha256,targets:first.value.targets,previous:first.value.previous,
    configurationSha256:first.value.configurationCopy.valuesSha256,desiredRuntimeSha256:digest(first.desiredRuntime),identityCapturedAt:time,schema:{...first.value.schema,capturedAt:time},observations,
    nativeEvidence:Object.fromEntries(Object.entries(first.value.nativeEvidence).map(([k,v])=>[k,{...v,capturedAt:time}]))};
  const referenceFor=(v=value,changeReview=()=>{})=>{const json=JSON.stringify(v),sha256=digest(json),review={schemaVersion:2,kind:'fcos_root_accepted_first_runtime_owner_refresh_v2',accepted:true,reviewerId:'/root',repository:first.value.targets.repository,
    baselineSha256:first.reference.sha256,observationSha256:sha256,evidenceSha256:digest({nativeEvidence:v.nativeEvidence,observations:v.observations}),reviewedAt:time};
    changeReview(review);const reviewJson=JSON.stringify(review);return {json,sha256,acceptance:{json:reviewJson,sha256:digest(reviewJson)}};};
  return {value,reference:referenceFor(),referenceFor};
}
