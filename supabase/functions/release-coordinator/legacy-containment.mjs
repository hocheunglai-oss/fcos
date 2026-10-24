import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { validateLegacyReleaseContainment } from '../../../config/legacyReleaseContainment.js';
import { need, digest, readCoordinatorMetadata } from './core.mjs';

export function assertLegacyContainmentEnvironments(resume, final) {
  const operator=fcosConnectionIdentifier(FCOS_RELEASE_APPROVAL_POLICY.operatorProvider,FCOS_RELEASE_APPROVAL_POLICY.operatorIdentifier);
  for(const [environment,name] of [[resume,'fcos-hosted-production-resume'],[final,'fcos-production-release']]) {
    need(environment?.name===name&&Number.isSafeInteger(environment.id)&&environment.id>0&&environment.can_admins_bypass===false
      &&environment.deployment_branch_policy?.protected_branches===true&&environment.deployment_branch_policy?.custom_branch_policies===false
      &&Array.isArray(environment.protection_rules),'COORDINATION_CONTAINMENT_PROTECTION_CHANGED');
    need(environment.protection_rules.filter(row=>row.type==='wait_timer').every(row=>row.wait_timer===0),'COORDINATION_CONTAINMENT_PROTECTION_CHANGED');
  }
  need(resume.protection_rules.every(row=>row.type==='branch_policy'||row.type==='wait_timer'&&row.wait_timer===0),'COORDINATION_CONTAINMENT_PROTECTION_CHANGED');
  const rules=final.protection_rules.filter(row=>row.type==='required_reviewers'),reviewer=rules[0]?.reviewers?.[0];
  need(rules.length===1&&rules[0].prevent_self_review===false&&rules[0].reviewers.length===1
    &&reviewer.type==='User'&&reviewer.reviewer?.login===operator&&Number.isSafeInteger(reviewer.reviewer?.id)&&reviewer.reviewer.id>0,
    'COORDINATION_CONTAINMENT_PROTECTION_CHANGED');
  return true;
}
/** The endpoint has only GitHub metadata credentials. No Vercel/Xero secret or
 * new permission enters the coordinator, and callers cannot supply this proof. */
export function createLegacyContainmentValidator({policy,token,fetchImpl=fetch}={}) {
  return async ({principal,registration,manifestHash,metadataReservation,requestContext})=>{
    const manifest=registration?.manifest;
    need(principal.kind==='github'&&registration?.owner?.kind==='release'&&['qualification','release'].includes(registration.scope)
      &&registration.manifest_hash===manifestHash&&manifest.controller?.sha===principal.jobWorkflowSha
      &&/^[a-f0-9]{64}$/.test(manifest.setupSha256||''),'COORDINATION_CONTAINMENT_BINDING_CHANGED');
    try{validateLegacyReleaseContainment(manifest.legacyReleaseContainment);}catch{need(false,'COORDINATION_CONTAINMENT_BINDING_CHANGED');}
    need(metadataReservation&&typeof metadataReservation.runRead==='function','COORDINATION_CONTAINMENT_METADATA_REQUIRED',503);
    const read=path=>metadataReservation.runRead(()=>readCoordinatorMetadata({
      url:`https://api.github.com${path}`,token,fetchImpl,requestContext,exactUrl:true,
    }),{signal:requestContext?.metadataSignal});
    const user=await read('/user');
    need(user.login===fcosConnectionIdentifier('github','Required account')&&Number.isSafeInteger(user.id)&&user.id>0,'COORDINATION_METADATA_ACCOUNT_MISMATCH',403);
    const base=`/repos/${policy.repository}/environments/`;
    const [resume,final]=await Promise.all([read(base+'fcos-hosted-production-resume'),read(base+'fcos-production-release')]);
    assertLegacyContainmentEnvironments(resume,final);
    return {validatedBy:'trusted_coordinator',manifestHash,controllerSha:manifest.controller.sha,setupSha256:manifest.setupSha256,policySha256:await digest(manifest.legacyReleaseContainment)};
  };
}
