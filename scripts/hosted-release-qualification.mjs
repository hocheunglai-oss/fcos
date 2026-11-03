import { qualificationSourceBinding } from '../config/hostedReleaseQualification.js';
import { assertHostedSourceContext } from './lib/hosted-release/admission.mjs';
import { consequential, collectAcceptance } from './lib/hosted-release/controller.mjs';
import { assertBoundEvidence, digest, fail, validateManifest } from './lib/hosted-release/contract.mjs';
import { collectWorkflowArtifact } from './lib/hosted-release/artifacts.mjs';
import { assertHostedJob } from './lib/hosted-release/publisher.mjs';
import { requestGitHubIdentity, validateHostedIdentity } from './lib/hosted-release/github.mjs';
const phases=Object.freeze(['qualification.stage','qualification.promote','qualification.rollback']);
const bound=manifest=>({releaseId:manifest.releaseId,manifestHash:digest(manifest)});
function assertSimulationIsolation(env) {
  const forbidden=/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL/i;
  for(const [name,value] of Object.entries(env)) if(value&&forbidden.test(name)
    &&!['ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_RUNTIME_TOKEN','FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'].includes(name)) fail('QUALIFICATION_PROVIDER_CREDENTIAL_FORBIDDEN');
}
/** Fixed coordinator-only simulator. It accepts no delegated Production adapter/function. */
export async function runQualification({manifest,coordinator,simulateProduction,context='hosted',env=process.env,now=Date.now,repositoryId}={}) {
  validateManifest(manifest);
  if(manifest.executionMode!=='qualification'||manifest.stage!=='qualification'||simulateProduction!==true) fail('QUALIFICATION_SCOPE_REQUIRED');
  if(!['hosted','local_rehearsal'].includes(context)) fail('QUALIFICATION_CONTEXT_INVALID');
  if(context==='hosted') {
    assertSimulationIsolation(env);
    const qualificationSource=qualificationSourceBinding(manifest);
    if(qualificationSource) assertHostedSourceContext({manifest,env});
    const token=await requestGitHubIdentity({env});
    const identity=await validateHostedIdentity(token,{controllerSha:manifest.controller.sha,repositoryId,runId:env.GITHUB_RUN_ID,qualificationSource});
    if(['fcos-production-release','fcos-hosted-production-resume'].includes(identity.environment)) fail('QUALIFICATION_PRODUCTION_ENVIRONMENT_FORBIDDEN');
  }
  const snapshot=await coordinator.snapshot(bound(manifest)),preview=snapshot.operations?.['preview.create'];
  const ready=snapshot.checks?.['preview.ready']?.result;
  if(preview?.state!=='complete'||preview.evidence?.outcome!=='applied'||!ready) return {status:'waiting_dependency',phase:'qualification.preview'};
  if(ready.id!==preview.evidence.result?.id||ready.sha!==manifest.candidate.sha||ready.state!=='READY'||ready.target!=='preview'
    ||ready.projectId!==manifest.targets.vercelProject||ready.teamId!==manifest.targets.vercelTeam) fail('QUALIFICATION_REAL_PREVIEW_BINDING');
  try {assertBoundEvidence(snapshot.checks?.preview_binding,manifest,'preview_binding',{now:now()});}
  catch {return{status:'waiting_dependency',phase:'qualification.preview_binding'};}
  const accepted=await collectAcceptance({manifest,coordinator,provider:{},now,refresh:false});
  if(accepted.status!=='ready') return{status:'waiting_dependency',phase:'qualification.acceptance',missing:accepted.missing};
  const results={};
  for(const phase of phases) {
    const effectKey=`qualification.effect.${phase}`;
    results[phase]=await consequential({manifest,phase,coordinator,request:{simulated:true,phase,manifestHash:digest(manifest)},
      submit:async({operationId})=>{
        const result={simulated:true,phase,operationId,manifestHash:digest(manifest),productionProviderMutations:0};
        // This coordinator-only simulated provider effect is durable BEFORE completion.
        await coordinator.appendEvidence({...bound(manifest),key:effectKey,evidence:{result,simulated:true}});return result;
      },
      readback:async({operationId})=>{
        const state=await coordinator.snapshot(bound(manifest)),effect=state.checks?.[effectKey]?.result;
        return effect?.simulated===true&&effect.operationId===operationId&&effect.manifestHash===digest(manifest)
          ?{outcome:'applied',result:effect}:{outcome:'unknown'};
      }});
  }
  const report={schemaVersion:1,kind:context==='hosted'?'fcos_hosted_release_qualification':'fcos_local_release_rehearsal',context,status:'passed',
    manifestHash:digest(manifest),candidateSha:manifest.candidate.sha,controllerSha:manifest.controller.sha,epoch:manifest.epoch,
    preview:{deploymentId:ready.id,sha:ready.sha},checks:Object.fromEntries(Object.entries(accepted.checks).map(([id,e])=>[id,digest(e)])),
    simulations:results,productionProviderMutations:0,hostedQualification:context==='hosted',capturedAt:new Date(now()).toISOString()};
  const key=context==='hosted'?'qualification.pending_artifact':'local.qualification';
  const evidence={status:'passed',...report,artifactSha256:digest(report),simulatedProduction:true};
  await coordinator.appendEvidence({...bound(manifest),key,evidence});
  return{...report,evidenceKey:key,evidenceHash:digest({...evidence,key})};
}
export const qualificationSimulationPhases=phases;


/** Publish only independently collected actual producer metadata and immutable archive readback. */
export async function publishQualificationArtifact({manifest,coordinator,github,runId,jobName='release / qualify',artifactName=`fcos-${manifest.releaseId}-qualification`}={}) {
  validateManifest(manifest);
  if(manifest.executionMode!=='qualification'||manifest.stage!=='qualification') fail('QUALIFICATION_SCOPE_REQUIRED');
  const collected=await collectWorkflowArtifact({github,repository:manifest.targets.repository,runId,artifactName,jobName,fileName:'qualification.json'});
  if(collected.status==='waiting_dependency')return collected;
  assertHostedJob({manifest,...collected,controllerSha:manifest.controller.sha,expectedJobName:jobName});
  const {report,run,job,artifact}=collected,captured=Date.parse(report?.capturedAt);
  if(report?.kind!=='fcos_hosted_release_qualification'||report.context!=='hosted'||report.hostedQualification!==true
    ||report.status!=='passed'||report.manifestHash!==digest(manifest)||report.candidateSha!==manifest.candidate.sha
    ||report.controllerSha!==manifest.controller.sha||report.epoch!==manifest.epoch||report.productionProviderMutations!==0
    ||!Number.isFinite(captured)||captured<Date.parse(job.started_at)||captured>Date.parse(job.completed_at)+30000) fail('QUALIFICATION_ARTIFACT_REPORT_INVALID');
  const snapshot=await coordinator.snapshot(bound(manifest));
  if(snapshot.operations?.['preview.create']?.evidence?.result?.id!==report.preview?.deploymentId
    ||report.preview.sha!==manifest.candidate.sha) fail('QUALIFICATION_REAL_PREVIEW_BINDING');
  for(const phase of phases){const operation=snapshot.operations?.[phase],effect=report.simulations?.[phase];
    if(operation?.state!=='complete'||operation.evidence?.outcome!=='applied'||effect?.simulated!==true
      ||effect.manifestHash!==digest(manifest)||effect.operationId!==operation.operationId
      ||digest(effect)!==digest(operation.evidence.result)) fail('QUALIFICATION_SIMULATION_REPORT_INVALID');}
  for(const id of manifest.requiredChecks) {
    const saved=snapshot.evidence?.find(row=>row.evidence_hash===report.checks?.[id]&&row.evidence?.checkId===id);
    if(!saved) fail('QUALIFICATION_CHECK_REPORT_INVALID');
    assertBoundEvidence(saved.evidence,manifest,id,{now:captured});
  }
  const evidence={status:'passed',context:'hosted',actualGithubArtifactValidated:true,manifestHash:digest(manifest),candidateSha:manifest.candidate.sha,
    controllerSha:manifest.controller.sha,epoch:manifest.epoch,reportSha256:digest(report),artifactSha256:artifact.archiveSha256,
    publisher:{runId:run.id,jobId:job.id,artifactId:artifact.id},capturedAt:report.capturedAt,simulatedProduction:true,productionProviderMutations:0};
  await coordinator.appendEvidence({...bound(manifest),key:'hosted.qualification',evidence});
  return{status:'passed',evidenceKey:'hosted.qualification',evidenceHash:digest({...evidence,key:'hosted.qualification'}),artifactId:artifact.id,reportSha256:digest(report)};
}
