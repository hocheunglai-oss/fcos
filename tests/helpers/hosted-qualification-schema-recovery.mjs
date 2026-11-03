import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from '../../scripts/lib/hosted-release/json-contract.mjs';
import {BOOTSTRAP_SOURCE,bootstrapActions} from '../../scripts/lib/hosted-release/cutover-bootstrap.mjs';
import {SCHEMA_RECOVERY,SCHEMA_RECOVERY_CONFIGURATION,schemaRecoveryActions,schemaRecoverySubject} from '../../scripts/lib/hosted-release/qualification-schema-recovery.mjs';
import {typedFirstRuntimeFixture} from './hosted-first-runtime-v2.mjs';
const H='a'.repeat(64),J='b'.repeat(64),OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62',ID='replacement-template-7dc21331fe45';
const raw=v=>createHash('sha256').update(v).digest('hex');
export function schemaRecoveryFixture() {
 const first=typedFirstRuntimeFixture({now:Date.parse('2026-10-18T12:00:00Z')}),time='2026-10-21T18:42:32.995955+00:00',reviewedAt='2026-10-21T18:45:00Z';
 const effects=[{importId:'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29',kind:'legacy_preview_env_row',effectSha256:digest('synthetic preview')},
  {importId:'production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0',kind:'production_resume_environment_policy',effectSha256:digest('synthetic policy')}];
 const unknowns=effects.map(e=>({operationId:e.importId,evidenceHash:H,ownerThreadId:OWNER,ownerReadbackHash:J}));
 const policy={schemaVersion:1,policy:'legacy_control_plane_effects_v1',selection:'detached_node24_before_candidate_v1',effects};
 const source={ref:BOOTSTRAP_SOURCE.ref,bootstrapSha:BOOTSTRAP_SOURCE.bootstrapSha,callerWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@${BOOTSTRAP_SOURCE.ref}`,controllerSha:BOOTSTRAP_SOURCE.controllerSha,candidateSha:BOOTSTRAP_SOURCE.candidateSha};
 const setup={epoch:1,controllerSha:BOOTSTRAP_SOURCE.controllerSha,firstRuntimeBaseline:first.reference,qualificationSource:source,legacyReleaseContainment:policy};
 const plan={releaseId:'synthetic-original-qualification',stage:'qualification',executionMode:'qualification',scope:{financialAuthority:false},migration:{mode:'none',expectedSchemaSha256:first.value.schema.sha256},runtime:{expectedSha256:H},changes:['synthetic qualification only']};
 const original={schemaVersion:1,bootstrapId:SCHEMA_RECOVERY.originalBootstrapId,epoch:1,ownerThreadId:OWNER,repository:'hocheunglai-oss/fcos',repositoryId:'1278654816',operatorId:'265701760',operatorLogin:'hocheunglai-oss',...BOOTSTRAP_SOURCE,
  setup,setupSha256:digest(setup),plan,planSha256:digest(plan),sentinelSha256:H,inventorySha256:H,rootReviewSha256:H,independentReviewSha256:J,
  containmentProofs:effects.map((e,i)=>({schemaVersion:1,...e,importedEvidenceSha256:digest(unknowns[i]),originalIntentSha256:H,originalSourceSha256:H,confinementEvidenceSha256:H,controllerPolicySha256:digest(policy),rootReviewSha256:H,independentReviewSha256:J,originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false}))};
 original.actions=bootstrapActions(original);
 const next=structuredClone(first.value);next.schema={...next.schema,sha256:SCHEMA_RECOVERY.schemaSha256,capturedAt:time};next.nativeEvidence.schema={sha256:J,capturedAt:time};
 const newSetup={...setup,firstRuntimeBaseline:first.referenceFor(next,r=>r.reviewedAt=reviewedAt)};
 const newPlan={...plan,releaseId:SCHEMA_RECOVERY.releaseId,migration:{...plan.migration,expectedSchemaSha256:SCHEMA_RECOVERY.schemaSha256}};
 const recovery={schemaVersion:1,kind:'fcos_qualification_schema_recovery_v1',epoch:1,recoveryId:SCHEMA_RECOVERY.recoveryId,originalBootstrapId:original.bootstrapId,originalBootstrapSha256:digest(original),
  setup:newSetup,setupSha256:digest(newSetup),plan:newPlan,planSha256:digest(newPlan),terminalFailure:{runId:SCHEMA_RECOVERY.failedRunId,runAttempt:'1',status:'completed',conclusion:'failure',failedStep:'Prepare actual qualification manifest',code:'LIVE_SCHEMA_CHANGED',beforeRegistration:true,providerEvidenceSha256:H}};
 recovery.actions=schemaRecoveryActions(recovery);
 const manifest={schemaVersion:2,releaseId:newPlan.releaseId,epoch:1,stage:'qualification',executionMode:'qualification',scope:newPlan.scope,runtime:newPlan.runtime,migration:newPlan.migration,changes:newPlan.changes,
  controller:{sha:source.controllerSha,workflow:'.github/workflows/hosted-release-controller.yml'},candidate:{sha:source.candidateSha},setupSha256:recovery.setupSha256,qualificationSource:source,legacyReleaseContainment:policy};
 const principal={kind:'github',qualificationOnly:true,repositoryId:original.repositoryId,actorId:original.operatorId,actor:original.operatorLogin,ref:source.ref,sha:source.bootstrapSha,workflowSha:source.bootstrapSha,workflowRef:source.callerWorkflowRef,
  jobWorkflowSha:source.controllerSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,runId:'102',runAttempt:'1',
  qualificationAdmission:{repository:original.repository,repositoryId:original.repositoryId,ref:source.ref,bootstrapSha:source.bootstrapSha,callerWorkflowRef:source.callerWorkflowRef,callerWorkflowSha:source.bootstrapSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,jobWorkflowSha:source.controllerSha,candidateSha:source.candidateSha,setupSha256:recovery.setupSha256}};
 return {H,J,original,recovery:reviewRecovery(recovery),unknowns,manifest,principal,scope:{epoch:1,owner:{kind:'release',id:'features'},releaseId:manifest.releaseId,manifestHash:digest(manifest)}};
}
export function reviewRecovery(p) {
 p=structuredClone(p);delete p.rootReview;delete p.independentReview;
 const common={kind:'fcos_qualification_schema_recovery_review_v1',accepted:true,subjectSha256:digest(schemaRecoverySubject(p)),sourceEvidenceSha256:H,reviewedAt:'2026-10-21T18:50:00Z'};
 return {...p,rootReview:{...common,role:'root',reviewerId:'/root'},independentReview:{...common,role:'independent',reviewerId:'/root/canonical_publication_review'}};
}
export const schemaConfigurationFixture=p=>({kind:'fcos_qualification_schema_recovery_configuration_verified_v1',accepted:true,recoveryId:p.recoveryId,
 ...SCHEMA_RECOVERY_CONFIGURATION,deploymentId:'dpl_SyntheticOnly',coordinatorUrl:'https://synthetic-only.vercel.app/coordinate',setupSha256:p.setupSha256,
 publicCoordinatorUrlMatches:true,credentialsPreserved:true,defaultProductionPreserved:true,readbackEvidenceSha256:H,reviewedAt:'2026-10-21T18:50:00Z'});
/** Reuse the exact historical PUBLIC literal bytes from the existing incident
 * fixture. New database rows/reviews remain synthetic; no saved private proof. */
export function schemaQuarantineFixture() {
 const source=readFileSync(new URL('../hosted-exact-7dc-public-metadata-quarantine-postgres.test.js',import.meta.url),'utf8');
 const literal=name=>JSON.parse(source.match(new RegExp(`^const ${name}=(.*);$`,'m'))[1]);
 const originalIntentJson=literal('originalIntentJson'),originalRequestJson=literal('originalRequestJson');
 const incident={operationId:ID,evidenceHash:raw(originalIntentJson),ownerThreadId:OWNER,ownerReadbackHash:J};
 const lease=JSON.parse(originalIntentJson).lease;
 const p={schemaVersion:1,kind:'exact_7dc_public_metadata_quarantine_v1',epoch:1,importId:ID,ownerThreadId:OWNER,
  originalLease:Object.fromEntries(['epoch','objective','ownerThreadId','operationId','bindingSha256','leaseId'].map(k=>[k,lease[k]])),importedEvidenceSha256:digest(incident),originalIntentJson,originalRequestJson,
  originalGuardedResultSha256:'45bce1f5843c638ad6e9c5fa052efc7a0ecc207533a35141382f23a12c9adb88',localCancellationReceiptSha256:'518a39b00abc6ee876d9e8aa9324bc3436431588acbd055759ebcbcb86bb1330',localCancellationResolutionSha256:'8184bca0e5512cf4c7720eee619f2931de8e141b5327bb9a794e98dfed352695',
  sourceAcceptanceSha256:'5ccc27b86d0d2e203191df41491e9d2e5412543936a2b270d205c7e111f9c4e1',templateSha256:'ed2b7b44d4b1c8a6b5e7df33b6ead2f2d1bd830d9589e83df47cb844cf354556',valueSha256:'8a65468047b4c2c6266ab2539472405eab210381c46470e207e5eca4e80bb69f',templateNotAfter:1792522490726,
  expiryGuards:{nativeRelaySha256:'a8f15ea0e0610a5fee84dfa5e23aec3ab09ac3f8224d5d0e2db2f0ad13da25be',carrierSha256:'f1083979827e85fe8b933bea1cc0f80aa245ba5a9889e5165db17af2a61743d3',stepProtocolSha256:'e3ebeb7a1ae02c0ad5bdf2b854f6258d2f2a93a0e5c26b0cbcfc3b99e4e71922'},
  possibleLateMetadataEffect:true,originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false,hostCreationAllowed:false,warmDispatchAllowed:false,allOriginalMarkersPreserved:true,noOriginalHostOrWarmDispatchProofSha256:H,inventorySha256:H,legacyFenceSha256:H};
 const common={kind:'fcos_exact_7dc_public_metadata_quarantine_review_v1',accepted:true,scopeSha256:digest(p),reviewedAt:'2026-10-21T19:00:00Z',exactOriginalEvidenceReviewed:true,expiredMetadataConfinementReviewed:true};
 return {incident,proof:{...p,rootReview:{...common,role:'root',reviewerId:'/root'},independentReview:{...common,role:'independent',reviewerId:'/root/test_peer'}}};
}
