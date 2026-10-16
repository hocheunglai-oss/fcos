import { createRemoteJWKSet, jwtVerify } from 'jose';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { need } from './core.mjs';
export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
export const COORDINATOR_AUDIENCE = 'fcos-release-coordinator';
export function validatePolicy(policy) {
  const repository = fcosConnectionIdentifier('github','Repository');
  need(policy?.repository === repository && /^[1-9][0-9]*$/.test(policy.repositoryId)
    && policy.ref === 'refs/heads/main' && Array.isArray(policy.workflows) && policy.workflows.length > 0
    && policy.workflows.every(p => typeof p.callerWorkflowRef === 'string' && p.callerWorkflowRef.startsWith(`${repository}/.github/workflows/`)
      && p.callerWorkflowRef.endsWith('@refs/heads/main') && typeof p.jobWorkflowRef === 'string'
      && p.jobWorkflowRef.startsWith(`${repository}/.github/workflows/`)
      && /^[a-f0-9]{40}$/.test(p.jobWorkflowSha) && p.jobWorkflowRef.endsWith(`@${p.jobWorkflowSha}`))
    && ['prepare','register','release / prepare','release / register'].includes(policy.registrationJob)
    && policy.approvalJobPrefix === (policy.registrationJob.startsWith('release / ')?'release / production / ':'production / '), 'COORDINATION_POLICY_INVALID',500);
  return policy;
}
export function createGithubAuthenticator({policy,jwks,now=()=>Date.now()}) {
  validatePolicy(policy);
  const keys = jwks ?? createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`),{timeoutDuration:10000,cooldownDuration:30000});
  return async token => {
    let claims;
    try {
      ({payload:claims} = await jwtVerify(token,keys,{issuer:GITHUB_ISSUER,audience:COORDINATOR_AUDIENCE,algorithms:['RS256'],
        requiredClaims:['exp','iat','nbf','jti','repository_id','repository','ref','run_id','run_attempt','workflow_ref','job_workflow_ref','job_workflow_sha'],
        maxTokenAge:'5m',clockTolerance:5,currentDate:new Date(now())}));
    } catch { need(false,'COORDINATION_GITHUB_IDENTITY_INVALID',401); }
    const admitted = policy.workflows.find(p=>p.callerWorkflowRef===claims.workflow_ref && p.jobWorkflowRef===claims.job_workflow_ref && p.jobWorkflowSha===claims.job_workflow_sha);
    need(claims.aud===COORDINATOR_AUDIENCE && claims.repository===policy.repository && claims.repository_id===policy.repositoryId
      && claims.ref===policy.ref && claims.ref_type==='branch' && claims.event_name==='workflow_dispatch'
      && claims.run_attempt==='1' && /^[1-9][0-9]*$/.test(claims.run_id)
      && /^[a-f0-9]{40}$/.test(claims.sha) && /^[a-f0-9]{40}$/.test(claims.workflow_sha)
      && claims.runner_environment==='github-hosted' && admitted && claims.exp-claims.iat<=600,
      'COORDINATION_GITHUB_IDENTITY_INVALID',401);
    const expectedSubject = claims.environment ? `repo:${policy.repository}:environment:${claims.environment.replaceAll(':','%3A')}` : `repo:${policy.repository}:ref:${policy.ref}`;
    need(claims.sub===expectedSubject,'COORDINATION_GITHUB_SUBJECT_INVALID',401);
    return {kind:'github',runId:claims.run_id,runAttempt:claims.run_attempt,repositoryId:claims.repository_id,
      ref:claims.ref,sha:claims.sha,workflowSha:claims.workflow_sha,workflowRef:claims.workflow_ref,
      jobWorkflowRef:claims.job_workflow_ref,jobWorkflowSha:claims.job_workflow_sha,
      environment:claims.environment ?? null,actor:claims.actor,actorId:claims.actor_id,subject:claims.sub};
  };
}
/** A separate issuer/key/audience is mandatory. This credential grants serialization only.
 * The adapter does not approve finance, change fingerprints, or carry provider credentials. */
export function createFinancialAuthenticator({policy,jwks,now=()=>Date.now()}) {
  need(policy && new URL(policy.issuer).protocol==='https:' && new URL(policy.jwksUrl).protocol==='https:'
    && policy.issuer!==GITHUB_ISSUER && policy.audience==='fcos-financial-coordination'
    && Array.isArray(policy.owners) && policy.owners.length>0,'COORDINATION_FINANCIAL_POLICY_INVALID',500);
  const keys = jwks ?? createRemoteJWKSet(new URL(policy.jwksUrl),{timeoutDuration:10000});
  return async token => {
    let c;
    try { ({payload:c}=await jwtVerify(token,keys,{issuer:policy.issuer,audience:policy.audience,algorithms:['ES256','EdDSA'],
      requiredClaims:['exp','iat','nbf','jti','sub','owner_id','coordination_only'],maxTokenAge:'5m',clockTolerance:5,currentDate:new Date(now())})); }
    catch { need(false,'COORDINATION_FINANCIAL_IDENTITY_INVALID',401); }
    need(c.coordination_only===true && c.provider_authority===false && policy.owners.includes(c.owner_id)
      && c.sub===`fcos-financial:${c.owner_id}` && c.exp-c.iat<=300,'COORDINATION_FINANCIAL_IDENTITY_INVALID',401);
    return {kind:'financial',ownerId:c.owner_id,subject:c.sub,coordinationOnly:true,providerAuthorityGranted:false};
  };
}
