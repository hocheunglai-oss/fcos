import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { canonical,digest,fail } from './json-contract.mjs';
import { BOOTSTRAP_SOURCE,bootstrapActions,validateBootstrapProof } from './cutover-bootstrap.mjs';
import { admittedFirstRuntimeBaseline } from './first-runtime.mjs';

export const SCHEMA_RECOVERY=Object.freeze({epoch:1,recoveryId:'qualification-schema-recovery-epoch1-39653018028-v1',
  originalBootstrapId:'qualification-bootstrap-epoch1-3527fbf5-v1',releaseId:'fcos-qualification-64aa338b-2ef733d1-schema-20261022',
  failedRunId:'39653018028',schemaSha256:'84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'});
export const SCHEMA_RECOVERY_CONFIGURATION=Object.freeze({teamId:fcosConnectionIdentifier('vercel','Team ID'),projectId:'prj_RSs4qXdrK6MQVOqB0N1FRVMVxDwi',
  serverSourceSha:'0d996205a754320f620342194c31b27b06ab4d0c',serverSourceManifestSha256:'e002efe339bcdb30f32a55803c1de4ad7cb544263824dc232807e437285bfe5a',
  policySha256:'5775ea59999f87e2198c415f1827f5816e458debf4aab69a7c6f9a70af9beb2d'});
const repository=fcosConnectionIdentifier('github','Repository'),prefix=`/repos/${repository}`;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(v,code='SCHEMA_RECOVERY_PROOF_INVALID')=>{if(!v)fail(code,'qualification.schema_recovery','Preserve the consumed journal; authenticated owner readback is required.');};
const without=(v,...keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const refused=v=>['refused','pending','unknown','uncertain','busy'].includes(v?.disposition)||v?.ok===false
  ||Object.hasOwn(v||{},'exitCode')&&v.exitCode!==0||['refused','pending','unknown','uncertain','timedOut'].some(k=>v?.[k]===true);
const keys=['schemaVersion','kind','epoch','recoveryId','originalBootstrapId','originalBootstrapSha256','setup','setupSha256','plan','planSha256',
  'terminalFailure','actions','rootReview','independentReview'];

export function schemaRecoveryActions({setup,setupSha256,plan}) {
  return [{id:'replace_setup',request:{method:'PATCH',route:`${prefix}/actions/variables/FCOS_ADMITTED_RELEASE_SETUP`,
    body:{name:'FCOS_ADMITTED_RELEASE_SETUP',value:canonical(setup)}}},
  {id:'replace_setup_sha',request:{method:'PATCH',route:`${prefix}/actions/variables/FCOS_ADMITTED_RELEASE_SETUP_SHA256`,
    body:{name:'FCOS_ADMITTED_RELEASE_SETUP_SHA256',value:setupSha256}}},
  {id:'dispatch_qualification',request:bootstrapActions({plan})[1].request}];
}
export const schemaRecoverySubject=p=>without(p,'rootReview','independentReview');
/** Integrity checks only. Actual postgres and independently inspected reviews
 * are the authority boundary; a reviewer string or hash is not authentication. */
export function validateSchemaRecoveryProof(p,{originalProof,now=Date.now()}={}) {
  need(exact(p,keys)&&p.schemaVersion===1&&p.kind==='fcos_qualification_schema_recovery_v1'
    &&p.epoch===SCHEMA_RECOVERY.epoch&&p.recoveryId===SCHEMA_RECOVERY.recoveryId&&p.originalBootstrapId===SCHEMA_RECOVERY.originalBootstrapId
    &&p.setup?.epoch===SCHEMA_RECOVERY.epoch&&p.plan?.releaseId===SCHEMA_RECOVERY.releaseId&&p.plan?.migration?.expectedSchemaSha256===SCHEMA_RECOVERY.schemaSha256
    &&hash(p.originalBootstrapSha256)&&hash(p.setupSha256)&&hash(p.planSha256)&&digest(p.setup)===p.setupSha256&&digest(p.plan)===p.planSha256
    &&canonical(p.actions)===canonical(schemaRecoveryActions(p)));
  const f=p.terminalFailure;
  need(exact(f,['runId','runAttempt','status','conclusion','failedStep','code','beforeRegistration','providerEvidenceSha256'])
    &&f.runId===SCHEMA_RECOVERY.failedRunId&&f.runAttempt==='1'&&f.status==='completed'&&f.conclusion==='failure'
    &&f.failedStep==='Prepare actual qualification manifest'&&f.code==='LIVE_SCHEMA_CHANGED'&&f.beforeRegistration===true&&hash(f.providerEvidenceSha256));
  const subjectSha256=digest(schemaRecoverySubject(p));
  for(const [role,reviewerId,k] of [['root','/root','rootReview'],['independent','/root/canonical_publication_review','independentReview']]) {
    const r=p[k];need(exact(r,['kind','role','reviewerId','accepted','subjectSha256','sourceEvidenceSha256','reviewedAt'])
      &&r.kind==='fcos_qualification_schema_recovery_review_v1'&&r.role===role&&r.reviewerId===reviewerId&&r.accepted===true
      &&r.subjectSha256===subjectSha256&&hash(r.sourceEvidenceSha256)&&typeof r.reviewedAt==='string'
      &&Number.isFinite(Date.parse(r.reviewedAt))&&Date.parse(r.reviewedAt)<=now+30000);
  }
  if(originalProof) {
    const old=validateBootstrapProof(originalProof);need(old.bootstrapId===p.originalBootstrapId&&digest(old)===p.originalBootstrapSha256&&old.epoch===p.epoch);
    need(canonical(without(p.setup,'firstRuntimeBaseline'))===canonical(without(old.setup,'firstRuntimeBaseline')));
    const before=admittedFirstRuntimeBaseline(old.setup.firstRuntimeBaseline,{now}),after=admittedFirstRuntimeBaseline(p.setup.firstRuntimeBaseline,{now});
    need(before.schemaVersion===2&&after.schemaVersion===2&&canonical(without(before,'schema','nativeEvidence'))===canonical(without(after,'schema','nativeEvidence'))
      &&canonical(without(before.nativeEvidence,'schema'))===canonical(without(after.nativeEvidence,'schema'))
      &&after.schema.sha256===SCHEMA_RECOVERY.schemaSha256&&after.schema.sha256!==before.schema.sha256
      &&after.schema.projectRef===fcosConnectionIdentifier('supabase','Project ref')&&after.schema.readOnly===true
      &&Date.parse(after.schema.capturedAt)>Date.parse(before.schema.capturedAt));
    need(p.plan.releaseId===SCHEMA_RECOVERY.releaseId&&p.plan.releaseId!==old.plan.releaseId
      &&canonical(without(p.plan,'releaseId','migration'))===canonical(without(old.plan,'releaseId','migration'))
      &&canonical(without(p.plan.migration,'expectedSchemaSha256'))===canonical(without(old.plan.migration,'expectedSchemaSha256'))
      &&p.plan.migration.expectedSchemaSha256===after.schema.sha256);
  }
  return p;
}
export function schemaRecoverySql(command,p,{actionId,evidence}={}) {
  validateSchemaRecoveryProof(p);const id=p.recoveryId,h=digest(p);
  const plans={admit:['admit_qualification_schema_recovery($1::jsonb)',[p]],
    intent:['qualification_schema_recovery_intent($1::text,$2::text,$3::text)',[id,actionId,h]],
    record:['record_qualification_schema_recovery($1::text,$2::text,$3::text,$4::jsonb)',[id,actionId,h,evidence]],
    finish:['finish_qualification_schema_recovery($1::text,$2::text)',[id,h]],
    snapshot:['qualification_schema_recovery_snapshot($1::text,$2::text)',[id,h]]};
  need(Object.hasOwn(plans,command),'SCHEMA_RECOVERY_COMMAND_INVALID');
  if(['intent','record'].includes(command))need(p.actions.some(a=>a.id===actionId),'SCHEMA_RECOVERY_ACTION_INVALID');
  const [call,parameters]=plans[command];return {projectRef:fcosConnectionIdentifier('supabase','Project ref'),query:`select fcos_release_coordination.${call} as result`,parameters};
}
export function validateSchemaRecoveryConfiguration(value,p,{now=Date.now()}={}) {
  need(exact(value,['kind','accepted','recoveryId','teamId','projectId','deploymentId','coordinatorUrl','serverSourceSha','serverSourceManifestSha256',
    'policySha256','setupSha256','publicCoordinatorUrlMatches','credentialsPreserved','defaultProductionPreserved','readbackEvidenceSha256','reviewedAt'])
    &&value.kind==='fcos_qualification_schema_recovery_configuration_verified_v1'&&value.accepted===true&&value.recoveryId===p.recoveryId&&value.setupSha256===p.setupSha256
    &&Object.entries(SCHEMA_RECOVERY_CONFIGURATION).every(([k,v])=>value[k]===v)&&/^dpl_[A-Za-z0-9]+$/.test(value.deploymentId||'')
    &&value.publicCoordinatorUrlMatches===true&&value.credentialsPreserved===true&&value.defaultProductionPreserved===true&&hash(value.readbackEvidenceSha256)
    &&typeof value.reviewedAt==='string'&&Number.isFinite(Date.parse(value.reviewedAt))&&Date.parse(value.reviewedAt)<=now+30000,'SCHEMA_RECOVERY_CONFIGURATION_REQUIRED');
  let url;try{url=new URL(value.coordinatorUrl);}catch{need(false,'SCHEMA_RECOVERY_CONFIGURATION_REQUIRED');}
  need(url.protocol==='https:'&&url.hostname.endsWith('.vercel.app')&&url.pathname==='/coordinate'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash,'SCHEMA_RECOVERY_CONFIGURATION_REQUIRED');
  return value;
}
export function createQualificationSchemaRecoveryOperator({proof,originalProof,admin,github,verifyConfiguration,verifyOwnerReadback}) {
  const p=structuredClone(validateSchemaRecoveryProof(proof,{originalProof}));
  need(originalProof&&admin?.projectRef===fcosConnectionIdentifier('supabase','Project ref')&&typeof admin.query==='function'&&typeof github?.request==='function'
    &&typeof verifyConfiguration==='function'&&typeof verifyOwnerReadback==='function','SCHEMA_RECOVERY_TRANSPORT_REQUIRED');
  let stopped=false;
  const active=()=>need(!stopped,'SCHEMA_RECOVERY_OWNER_READBACK_REQUIRED');
  const sql=async(command,extra)=>{const q=schemaRecoverySql(command,p,extra),result=(await admin.query(q.query,q.parameters))?.rows?.[0]?.result;
    need(result&&!refused(result),'SCHEMA_RECOVERY_SQL_REFUSED');return result;};
  const get=async route=>{const response=await github.request({method:'GET',route});
    need(!(typeof response?.status==='number'&&response.status!==200)&&!refused(response),'SCHEMA_RECOVERY_READ_REFUSED');return response;};
  const preflight=async actionId=>{
    const user=await get('/user');need(user.login===originalProof.operatorLogin&&String(user.id)===originalProof.operatorId,'SCHEMA_RECOVERY_GITHUB_IDENTITY');
    const repo=await get(prefix);need(repo.full_name===repository&&String(repo.id)===originalProof.repositoryId&&!repo.archived,'SCHEMA_RECOVERY_GITHUB_REPOSITORY');
    const branch=await get(`${prefix}/branches/${encodeURIComponent(BOOTSTRAP_SOURCE.ref.slice(11))}`);
    need(branch.protected===true&&branch.commit?.sha===BOOTSTRAP_SOURCE.bootstrapSha,'SCHEMA_RECOVERY_SOURCE_CHANGED');
    const setup=await get(`${prefix}/actions/variables/FCOS_ADMITTED_RELEASE_SETUP`),sha=await get(`${prefix}/actions/variables/FCOS_ADMITTED_RELEASE_SETUP_SHA256`);
    const flag=await get(`${prefix}/actions/variables/FCOS_HOSTED_QUALIFICATION_ADMITTED`);
    let current;try{current=JSON.parse(setup.value);}catch{need(false,'SCHEMA_RECOVERY_SETUP_CHANGED');}
    need(setup.name==='FCOS_ADMITTED_RELEASE_SETUP'&&sha.name==='FCOS_ADMITTED_RELEASE_SETUP_SHA256'
      &&flag.name==='FCOS_HOSTED_QUALIFICATION_ADMITTED'&&flag.value==='true'
      &&canonical(current)===canonical(actionId==='replace_setup'?originalProof.setup:p.setup)
      &&sha.value===(actionId==='dispatch_qualification'?p.setupSha256:originalProof.setupSha256),'SCHEMA_RECOVERY_SETUP_CHANGED');
    const run=await get(`${prefix}/actions/runs/${SCHEMA_RECOVERY.failedRunId}`);
    need(String(run.id)===SCHEMA_RECOVERY.failedRunId&&run.status==='completed'&&run.conclusion==='failure'&&run.run_attempt===1
      &&run.head_sha===BOOTSTRAP_SOURCE.bootstrapSha&&run.head_branch===BOOTSTRAP_SOURCE.ref.slice(11),'SCHEMA_RECOVERY_FAILURE_CHANGED');
  };
  const unresolved=s=>s.actions.some(a=>{const events=s.events.filter(e=>e.action_id===a.action_id);return events.at(-1)?.state!=='applied';});
  const guarded=fn=>async(...args)=>{active();try{return await fn(...args);}catch(e){stopped=true;throw e;}};
  return Object.freeze({admit:guarded(()=>sql('admit')),snapshot:guarded(async()=>{const s=await sql('snapshot');if(unresolved(s))stopped=true;return s;}),finish:guarded(()=>sql('finish')),
    async execute(actionId,{rootReviewSha256}={}) {
      active();try {
      need(rootReviewSha256===digest(p.rootReview),'SCHEMA_RECOVERY_REVIEW_REQUIRED');
      const action=p.actions.find(a=>a.id===actionId);need(action,'SCHEMA_RECOVERY_ACTION_INVALID');
      const snapshot=await sql('snapshot');
      if(unresolved(snapshot)){stopped=true;return {disposition:'readback',actionId};}
      if(snapshot.actions.some(a=>a.action_id===actionId))return {disposition:'readback',actionId};
      await preflight(actionId);
      const configuration=await verifyConfiguration({recoveryId:p.recoveryId,setupSha256:p.setupSha256,actionId});
      validateSchemaRecoveryConfiguration(configuration,p);
      const intent=await sql('intent',{actionId});
      if(intent.disposition!=='execute'){if(intent.disposition!=='readback')stopped=true;return intent;}
      need(canonical(intent.request)===canonical(action.request)&&intent.requestSha256===digest(action.request),'SCHEMA_RECOVERY_INTENT_CHANGED');
      let response;try{response=await github.request(action.request);}catch{fail('SCHEMA_RECOVERY_RESPONSE_UNKNOWN');}
      // After any uncertain/refused/absent native outcome, stop locally. Even a
      // journal RPC is forbidden until separately admitted original-owner readback.
      need(response?.status===204&&!refused(response),'SCHEMA_RECOVERY_RESPONSE_UNKNOWN');
      const evidence={basis:'native_ack',outcome:'applied',requestSha256:intent.requestSha256,providerEvidenceSha256:digest(response),rootReviewSha256};
      const recorded=await sql('record',{actionId,evidence});need(recorded.state==='applied','SCHEMA_RECOVERY_RECORD_REFUSED');
      return {disposition:'applied',actionId,requestSha256:intent.requestSha256,providerEvidenceSha256:evidence.providerEvidenceSha256};
      }catch(e){stopped=true;throw e;}
    },async readback(actionId,evidence) {try {
      need(p.actions.some(a=>a.id===actionId)&&evidence?.basis==='owner_readback','SCHEMA_RECOVERY_OWNER_READBACK_REQUIRED');
      const admission=await verifyOwnerReadback({recoveryId:p.recoveryId,actionId,evidenceSha256:digest(evidence)});
      need(exact(admission,['kind','accepted','recoveryId','actionId','evidenceSha256','admissionReceiptSha256'])
        &&admission.kind==='fcos_qualification_schema_recovery_owner_readback_admitted_v1'&&admission.accepted===true
        &&admission.recoveryId===p.recoveryId&&admission.actionId===actionId&&admission.evidenceSha256===digest(evidence)&&hash(admission.admissionReceiptSha256),'SCHEMA_RECOVERY_OWNER_READBACK_REQUIRED');
      const result=await sql('record',{actionId,evidence});stopped=result.state!=='applied';return result;
    }catch(e){stopped=true;throw e;}}});
}
