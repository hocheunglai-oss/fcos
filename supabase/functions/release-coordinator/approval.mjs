import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { digest, need } from './core.mjs';
const environmentName='fcos-production-release';
const positive = v=>Number.isSafeInteger(v)&&v>0;
/** Pure validator of actual API responses; the collector below is the only production adapter. */
export async function validateGithubApproval({principal,registration,manifestHash,policy,repository,branch,protection,environment,run,jobs,approvals}) {
  const operator = fcosConnectionIdentifier(FCOS_RELEASE_APPROVAL_POLICY.operatorProvider,FCOS_RELEASE_APPROVAL_POLICY.operatorIdentifier);
  need(FCOS_RELEASE_APPROVAL_POLICY.mode==='single_operator' && repository.full_name===policy.repository
    && String(repository.id)===policy.repositoryId && repository.default_branch==='main'
    && branch.name==='main' && branch.protected===true && branch.commit?.sha===principal.workflowSha
    && protection.enforce_admins?.enabled===true && protection.allow_force_pushes?.enabled===false
    && protection.allow_deletions?.enabled===false && protection.required_status_checks?.strict===true
    && Array.isArray(protection.required_status_checks.checks)
    && FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.every(name=>protection.required_status_checks.checks.some(row=>row.context===name&&row.app_id===FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId)),'COORDINATION_PROTECTED_REF_INVALID');
  const reviewRules = environment.protection_rules?.filter(r=>r.type==='required_reviewers');
  const reviewer=reviewRules?.[0]?.reviewers?.[0];
  need(principal.environment===environmentName && environment.name===environmentName && positive(environment.id)
    && environment.can_admins_bypass===false && environment.deployment_branch_policy?.protected_branches===true
    && environment.deployment_branch_policy?.custom_branch_policies===false && reviewRules.length===1
    && reviewRules[0].prevent_self_review===false && reviewRules[0].reviewers.length===1
    && reviewer.type==='User' && reviewer.reviewer?.login===operator && positive(reviewer.reviewer?.id),'COORDINATION_ENVIRONMENT_REVIEW_INVALID');
  const actorId=reviewer.reviewer.id, registered=registration.registration_actor;
  need(run.id===Number(principal.runId) && run.run_attempt===1 && run.status==='in_progress' && run.conclusion===null
    && run.event==='workflow_dispatch' && run.repository?.id===repository.id && run.repository.full_name===policy.repository
    && run.head_repository?.id===repository.id && run.head_repository.full_name===policy.repository
    && run.head_sha===principal.sha && run.head_sha===principal.workflowSha && run.head_branch==='main'
    && principal.workflowRef===`${policy.repository}/${run.path.split('@')[0]}@refs/heads/main`
    && [run.actor,run.triggering_actor].every(a=>a?.id===actorId&&a.login===operator)
    && registered?.runId===principal.runId && registered?.runAttempt===principal.runAttempt
    && registration.manifest_hash===manifestHash,'COORDINATION_APPROVAL_RUN_INVALID');
  need(jobs && Array.isArray(jobs.jobs) && jobs.total_count===jobs.jobs.length && jobs.total_count<=100
    && new Set(jobs.jobs.map(j=>j.id)).size===jobs.jobs.length,'COORDINATION_APPROVAL_JOBS_INCOMPLETE');
  const prepareJobs=jobs.jobs.filter(j=>j.name===policy.registrationJob);
  const protectedJobs=jobs.jobs.filter(j=>j.name===`${policy.approvalJobPrefix}${manifestHash}`);
  need(prepareJobs.length===1&&protectedJobs.length===1,'COORDINATION_APPROVAL_JOB_AMBIGUOUS');
  const prepare=prepareJobs[0], job=protectedJobs[0];
  need(prepare.status==='completed'&&prepare.conclusion==='success'&&job.status==='in_progress'&&job.conclusion===null
    && [prepare,job].every(j=>positive(j.id)&&j.run_id===run.id&&j.run_attempt===1&&j.head_sha===run.head_sha)
    && Number.isFinite(Date.parse(prepare.completed_at))&&Number.isFinite(Date.parse(job.started_at))
    && Date.parse(prepare.completed_at)<=Date.parse(job.started_at)
    && Date.parse(registration.registered_at)<=Date.parse(prepare.completed_at), 'COORDINATION_PREAPPROVAL_REGISTRATION_REQUIRED');
  const reviews = Array.isArray(approvals)?approvals.filter(r=>r.environments?.some(e=>e.id===environment.id&&e.name===environmentName)):[];
  need(reviews.length===1&&reviews[0].state==='approved'&&reviews[0].user?.id===actorId&&reviews[0].user.login===operator,
    'COORDINATION_APPROVAL_AMBIGUOUS');
  const m=registration.manifest;
  need(m.executionMode==='release'&&m.authorization?.validitySeconds===86400
    && Array.isArray(m.authorization.actions)&&m.authorization.actions.includes('production.stage')
    && m.authorization.rollback?.mode==='compatible_previous_only','COORDINATION_APPROVAL_SCOPE_INVALID');
  return {schemaVersion:1,manifestHash,epoch:registration.epoch,scope:m.scope,executionMode:m.executionMode,runId:principal.runId,runAttempt:principal.runAttempt,
    repositoryId:policy.repositoryId,environmentId:environment.id,reviewerId:actorId,reviewer:operator,
    registrationJobId:prepare.id,approvedJobId:job.id,jobWorkflowRef:principal.jobWorkflowRef,jobWorkflowSha:principal.jobWorkflowSha,
    actions:m.authorization.actions,rollback:m.authorization.rollback,
    actualEvidenceHash:await digest({repository,branch,protection,environment,run,jobs,approvals})};
}
export function createGithubApprovalValidator({policy,token,fetchImpl=globalThis.fetch}) {
  need(typeof token==='string'&&token.length>0,'COORDINATION_METADATA_TOKEN_REQUIRED',500);
  const base=`https://api.github.com/repos/${policy.repository}`;
  const read=async(path,user=false)=>{
    let response;
    try { response=await fetchImpl(user?'https://api.github.com/user':`${base}${path}`,{method:'GET',headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)}); }
    catch { need(false,'COORDINATION_GITHUB_METADATA_UNAVAILABLE',503); }
    need(response.ok&&!response.redirected,'COORDINATION_GITHUB_METADATA_UNAVAILABLE',503);
    return response.json();
  };
  return async context=>{
    const user=await read('',true);
    need(user.login===fcosConnectionIdentifier('github','Required account')&&positive(user.id),'COORDINATION_METADATA_ACCOUNT_MISMATCH',403);
    const runId=context.principal.runId;
    const [repository,branch,protection,environment,run,jobs,approvals]=await Promise.all([
      read(''),read('/branches/main'),read('/branches/main/protection'),read(`/environments/${environmentName}`),
      read(`/actions/runs/${runId}`),read(`/actions/runs/${runId}/attempts/1/jobs?per_page=100`),read(`/actions/runs/${runId}/approvals`)]);
    return validateGithubApproval({...context,policy,repository,branch,protection,environment,run,jobs,approvals});
  };
}
