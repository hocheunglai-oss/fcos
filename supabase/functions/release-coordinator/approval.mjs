import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { digest, need } from './core.mjs';
const initialEnvironment='fcos-production-release', resumeEnvironment='fcos-hosted-production-resume';
const positive=v=>Number.isSafeInteger(v)&&v>0;
/** Current protection must remain intact; unrelated main commits do not replace the admitted reusable controller. */
async function validateProtectedRun({principal,registration,registrationRun,manifestHash,policy,repository,branch,protection,environment,run,jobs,approvals},resuming) {
  const operator=fcosConnectionIdentifier(FCOS_RELEASE_APPROVAL_POLICY.operatorProvider,FCOS_RELEASE_APPROVAL_POLICY.operatorIdentifier);
  const environmentName=resuming?resumeEnvironment:initialEnvironment;
  need(FCOS_RELEASE_APPROVAL_POLICY.mode==='single_operator'&&repository.full_name===policy.repository
    &&String(repository.id)===policy.repositoryId&&repository.default_branch==='main'
    &&branch.name==='main'&&branch.protected===true&&/^[a-f0-9]{40}$/.test(branch.commit?.sha)
    &&protection.enforce_admins?.enabled===true&&protection.allow_force_pushes?.enabled===false
    &&protection.allow_deletions?.enabled===false&&protection.required_status_checks?.strict===true
    &&Array.isArray(protection.required_status_checks.checks)
    &&FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.every(name=>protection.required_status_checks.checks.some(row=>row.context===name&&row.app_id===FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId)),
    'COORDINATION_PROTECTED_REF_INVALID');
  need(principal.environment===environmentName&&environment.name===environmentName&&positive(environment.id)
    &&environment.can_admins_bypass===false&&environment.deployment_branch_policy?.protected_branches===true
    &&environment.deployment_branch_policy?.custom_branch_policies===false,'COORDINATION_ENVIRONMENT_REVIEW_INVALID');
  const rules=environment.protection_rules?.filter(r=>r.type==='required_reviewers')??[];
  if(resuming) need(rules.length===0,'COORDINATION_RESUME_ENVIRONMENT_INVALID');
  else {
    const reviewer=rules[0]?.reviewers?.[0];
    need(rules.length===1&&rules[0].prevent_self_review===false&&rules[0].reviewers.length===1
      &&reviewer.type==='User'&&reviewer.reviewer?.login===operator&&positive(reviewer.reviewer?.id),'COORDINATION_ENVIRONMENT_REVIEW_INVALID');
    const reviews=Array.isArray(approvals)?approvals.filter(r=>r.environments?.some(e=>e.id===environment.id&&e.name===environmentName)):[];
    need(reviews.length===1&&reviews[0].state==='approved'&&reviews[0].user?.id===reviewer.reviewer.id&&reviews[0].user.login===operator,
      'COORDINATION_APPROVAL_AMBIGUOUS');
    need([run.actor,run.triggering_actor].every(a=>a?.id===reviewer.reviewer.id&&a.login===operator),'COORDINATION_APPROVAL_RUN_INVALID');
  }
  const prepareActor=registrationRun?.actor;
  need(run.id===Number(principal.runId)&&run.run_attempt===1&&run.status==='in_progress'&&run.conclusion===null
    &&run.event==='workflow_dispatch'&&run.repository?.id===repository.id&&run.repository.full_name===policy.repository
    &&run.head_repository?.id===repository.id&&run.head_repository.full_name===policy.repository
    &&run.head_sha===principal.sha&&run.head_sha===principal.workflowSha&&run.head_branch==='main'
    &&principal.workflowRef===`${policy.repository}/${run.path.split('@')[0]}@refs/heads/main`
    &&principal.ref===policy.ref&&policy.workflows.some(p=>p.jobWorkflowRef===principal.jobWorkflowRef&&p.jobWorkflowSha===principal.jobWorkflowSha)
    &&(registration.manifest.controller?.sha===undefined||registration.manifest.controller.sha===principal.jobWorkflowSha)
    &&prepareActor?.runId===principal.runId&&prepareActor?.runAttempt===principal.runAttempt
    &&prepareActor.jobWorkflowRef===principal.jobWorkflowRef&&prepareActor.jobWorkflowSha===principal.jobWorkflowSha
    &&prepareActor.sha===principal.sha&&registration.manifest_hash===manifestHash,'COORDINATION_APPROVAL_RUN_INVALID');
  need(jobs&&Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.total_count<=100
    &&new Set(jobs.jobs.map(j=>j.id)).size===jobs.jobs.length,'COORDINATION_APPROVAL_JOBS_INCOMPLETE');
  const prepares=jobs.jobs.filter(j=>j.name===policy.registrationJob),protectedJobs=jobs.jobs.filter(j=>j.name===`${resuming?policy.resumeJobPrefix:policy.approvalJobPrefix}${manifestHash}`);
  need(prepares.length===1&&protectedJobs.length===1,'COORDINATION_APPROVAL_JOB_AMBIGUOUS');
  const prepare=prepares[0],job=protectedJobs[0];
  need(prepare.status==='completed'&&prepare.conclusion==='success'&&job.status==='in_progress'&&job.conclusion===null
    &&[prepare,job].every(j=>positive(j.id)&&j.run_id===run.id&&j.run_attempt===1&&j.head_sha===run.head_sha)
    &&Number.isFinite(Date.parse(prepare.completed_at))&&Number.isFinite(Date.parse(job.started_at))
    &&Date.parse(prepare.completed_at)<=Date.parse(job.started_at)
    &&Date.parse(registrationRun.registered_at)<=Date.parse(prepare.completed_at),'COORDINATION_PREAPPROVAL_REGISTRATION_REQUIRED');
  return {schemaVersion:1,manifestHash,epoch:registration.epoch,runId:principal.runId,runAttempt:principal.runAttempt,
    repositoryId:policy.repositoryId,environmentId:environment.id,registrationJobId:prepare.id,approvedJobId:job.id,
    jobWorkflowRef:principal.jobWorkflowRef,jobWorkflowSha:principal.jobWorkflowSha,
    actualEvidenceHash:await digest({repository,branch,protection,environment,run,jobs,approvals:approvals??null}),
    ...(resuming?{reusesOriginalAuthorization:true}:{reviewer:operator,reviewerId:rules[0].reviewers[0].reviewer.id})};
}
export async function validateGithubApproval(context) {
  const receipt=await validateProtectedRun(context,false),m=context.registration.manifest;
  need(m.executionMode==='release'&&m.authorization?.validitySeconds===86400
    &&Array.isArray(m.authorization.actions)&&m.authorization.actions.includes('production.stage')
    &&m.authorization.rollback?.mode==='compatible_previous_only','COORDINATION_APPROVAL_SCOPE_INVALID');
  return {...receipt,scope:m.scope,executionMode:m.executionMode,actions:m.authorization.actions,rollback:m.authorization.rollback};
}
export async function validateGithubResume(context) {return validateProtectedRun(context,true);}
function githubMetadataCollector({policy,token,fetchImpl=globalThis.fetch},resuming) {
  need(typeof token==='string'&&token.length>0,'COORDINATION_METADATA_TOKEN_REQUIRED',500);
  const base=`https://api.github.com/repos/${policy.repository}`;
  const read=async(path,user=false)=>{
    let response;
    try {response=await fetchImpl(user?'https://api.github.com/user':`${base}${path}`,{method:'GET',headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)});}
    catch {need(false,'COORDINATION_GITHUB_METADATA_UNAVAILABLE',503);}
    need(response.ok&&!response.redirected,'COORDINATION_GITHUB_METADATA_UNAVAILABLE',503);return response.json();
  };
  return async context=>{
    const user=await read('',true);need(user.login===fcosConnectionIdentifier('github','Required account')&&positive(user.id),'COORDINATION_METADATA_ACCOUNT_MISMATCH',403);
    const runId=context.principal.runId,environmentName=resuming?resumeEnvironment:initialEnvironment;
    const [repository,branch,protection,environment,run,jobs,approvals]=await Promise.all([read(''),read('/branches/main'),read('/branches/main/protection'),
      read(`/environments/${environmentName}`),read(`/actions/runs/${runId}`),read(`/actions/runs/${runId}/attempts/1/jobs?per_page=100`),
      ...(resuming?[]:[read(`/actions/runs/${runId}/approvals`)])]);
    return (resuming?validateGithubResume:validateGithubApproval)({...context,policy,repository,branch,protection,environment,run,jobs,approvals});
  };
}
export const createGithubApprovalValidator=options=>githubMetadataCollector(options,false);
export const createGithubResumeValidator=options=>githubMetadataCollector(options,true);
