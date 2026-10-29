import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { canonical,digest,fail } from './json-contract.mjs';

export const BOOTSTRAP_SOURCE=Object.freeze({controllerSha:'64aa338b04cee7e05bde0ca9bfd10b81ac001a65',
  bootstrapSha:'12bee4edb7fc459162efb6a35571731c8fe5beb5',candidateSha:'2ef733d17dd12314c72971c2220b2b09903a6bf0',
  ref:'refs/heads/codex/hosted-qualification-dependency-setup-20261020'});
const repository=fcosConnectionIdentifier('github','Repository'),prefix=`/repos/${repository}`;
const flag='FCOS_HOSTED_QUALIFICATION_ADMITTED';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=(v,code='BOOTSTRAP_BINDING_CHANGED')=>{if(!v)fail(code,'cutover.bootstrap','Retain the original journal and use authenticated owner readback; never resubmit a consumed action.');};

/** Public input preparation only. No clock, principal, registration or authority. */
export function bootstrapActions({plan,candidateSha=BOOTSTRAP_SOURCE.candidateSha,ref=BOOTSTRAP_SOURCE.ref}) {
  need(candidateSha===BOOTSTRAP_SOURCE.candidateSha&&ref===BOOTSTRAP_SOURCE.ref&&plan?.stage==='qualification'&&plan.executionMode==='qualification'
    &&/^[A-Za-z0-9._:-]{1,200}$/.test(plan.releaseId||''));
  return [{id:'enable_qualification',request:{method:'PATCH',route:`${prefix}/actions/variables/${flag}`,body:{name:flag,value:'true'}}},
    {id:'dispatch_qualification',request:{method:'POST',route:`${prefix}/actions/workflows/authenticated-release.yml/dispatches`,
      body:{ref:ref.slice('refs/heads/'.length),inputs:{bootstrap_phase:'qualification',candidate_sha:candidateSha,plan:canonical(plan),xero_recovery_mode:'disabled'}}}}];
}
export function validateBootstrapProof(p) {
  need(p&&Object.getPrototypeOf(p)===Object.prototype&&p.schemaVersion===1&&Number.isSafeInteger(p.epoch)&&p.epoch>0
    &&/^[A-Za-z0-9._:-]{1,200}$/.test(p.bootstrapId||'')&&p.repository===repository&&p.repositoryId==='1278654816'
    &&p.operatorLogin==='hocheunglai-oss'&&p.operatorId==='265701760'&&p.ownerThreadId==='01a0f08b-7fcb-7870-9edc-343e16052b62'
    &&Object.entries(BOOTSTRAP_SOURCE).every(([k,v])=>p[k]===v)
    &&['setupSha256','planSha256','sentinelSha256','inventorySha256','rootReviewSha256','independentReviewSha256'].every(k=>hash(p[k]))
    &&digest(p.setup)===p.setupSha256&&digest(p.plan)===p.planSha256&&p.setup.epoch===p.epoch
    &&canonical(p.actions)===canonical(bootstrapActions(p)), 'BOOTSTRAP_PROOF_INVALID');
  return p;
}
/** The operator uses the existing verified Supabase admin connector. These are
 * parameterized SQL plans, not a new admin credential or public HTTP action. */
export function bootstrapSql(command,p,{actionId,evidence}={}) {
  validateBootstrapProof(p);const id=p.bootstrapId,h=digest(p);
  const plans={admit:['admit_cutover_bootstrap($1::jsonb)',[p]],
    intent:['cutover_bootstrap_intent($1::text,$2::text,$3::text)',[id,actionId,h]],
    record:['record_cutover_bootstrap($1::text,$2::text,$3::text,$4::jsonb)',[id,actionId,h,evidence]],
    finish:['finish_cutover_bootstrap($1::text,$2::text)',[id,h]],
    snapshot:[`cutover_bootstrap_snapshot($1::text,$2::text)`,[id,h]]};
  need(Object.hasOwn(plans,command),'BOOTSTRAP_COMMAND_INVALID');
  if(['intent','record'].includes(command))need(p.actions.some(a=>a.id===actionId),'BOOTSTRAP_ACTION_INVALID');
  const [call,parameters]=plans[command];return {projectRef:fcosConnectionIdentifier('supabase','Project ref'),query:`select fcos_release_coordination.${call} as result`,parameters};
}

/** Trusted operator integration: admin.query must be the existing target-locked
 * privileged connector, github.request the existing authenticated native API.
 * There is no arbitrary route/body callback input, retry, lease or TTL here. */
export function createCutoverBootstrapOperator({proof,admin,github}) {
  const p=structuredClone(validateBootstrapProof(proof));
  need(admin?.projectRef===fcosConnectionIdentifier('supabase','Project ref')&&typeof admin.query==='function'
    &&typeof github?.request==='function','BOOTSTRAP_TRANSPORT_REQUIRED');
  const sql=async(command,extra)=>{const q=bootstrapSql(command,p,extra);return (await admin.query(q.query,q.parameters)).rows[0].result;};
  const get=route=>github.request({method:'GET',route});
  const preflight=async actionId=>{
    const user=await get('/user');need(String(user.id)===p.operatorId&&user.login===p.operatorLogin,'BOOTSTRAP_GITHUB_IDENTITY');
    const repo=await get(prefix);need(String(repo.id)===p.repositoryId&&repo.full_name===repository&&!repo.archived,'BOOTSTRAP_GITHUB_REPOSITORY');
    const branch=await get(`${prefix}/branches/${encodeURIComponent(p.ref.slice(11))}`);
    need(branch.protected===true&&branch.commit?.sha===p.bootstrapSha,'BOOTSTRAP_SOURCE_CHANGED');
    const setup=await get(`${prefix}/actions/variables/FCOS_ADMITTED_RELEASE_SETUP`);
    const sha=await get(`${prefix}/actions/variables/FCOS_ADMITTED_RELEASE_SETUP_SHA256`);
    let parsed;try{parsed=JSON.parse(setup.value);}catch{fail('BOOTSTRAP_SETUP_CHANGED');}
    need(setup.name==='FCOS_ADMITTED_RELEASE_SETUP'&&canonical(parsed)===canonical(p.setup)
      &&sha.name==='FCOS_ADMITTED_RELEASE_SETUP_SHA256'&&sha.value===p.setupSha256,'BOOTSTRAP_SETUP_CHANGED');
    const currentFlag=await get(`${prefix}/actions/variables/${flag}`);
    need(currentFlag.name===flag&&currentFlag.value===(actionId==='enable_qualification'?'false':'true'),'BOOTSTRAP_GATE_CHANGED');
  };
  return Object.freeze({admit:()=>sql('admit'),snapshot:()=>sql('snapshot'),finish:()=>sql('finish'),
    async execute(actionId,{rootReviewSha256}) {
      need(hash(rootReviewSha256),'BOOTSTRAP_REVIEW_REQUIRED');
      const action=p.actions.find(a=>a.id===actionId);need(action,'BOOTSTRAP_ACTION_INVALID');
      const snapshot=await sql('snapshot');
      if(snapshot.actions.some(a=>a.action_id===actionId))return {disposition:'readback',actionId};
      await preflight(actionId);
      const intent=await sql('intent',{actionId});
      if(intent.disposition!=='execute')return intent; // Never submit twice.
      need(canonical(intent.request)===canonical(action.request)&&intent.requestSha256===digest(action.request),'BOOTSTRAP_INTENT_CHANGED');
      let response;
      try {response=await github.request(action.request);}catch {
        const evidence={basis:'native_ack',outcome:'unknown',requestSha256:intent.requestSha256,
          providerEvidenceSha256:digest({code:'BOOTSTRAP_PROVIDER_RESPONSE_UNKNOWN'}),rootReviewSha256};
        await sql('record',{actionId,evidence});fail('BOOTSTRAP_PROVIDER_RESPONSE_UNKNOWN');
      }
      // The trusted native transport returns only a sanitized fixed projection.
      const known=action.request.method==='PATCH'?response?.status===204:response?.status===204;
      const evidence={basis:'native_ack',outcome:known?'applied':'unknown',requestSha256:intent.requestSha256,
        providerEvidenceSha256:digest(response),rootReviewSha256};
      await sql('record',{actionId,evidence});
      need(known,'BOOTSTRAP_PROVIDER_RESPONSE_UNKNOWN');
      return {disposition:'applied',actionId,requestSha256:intent.requestSha256,providerEvidenceSha256:evidence.providerEvidenceSha256};
    },
    // The original administrator separately authenticates exact owner readback.
    // Absence of a newly dispatched run is never proof of not_applied.
    readback:(actionId,evidence)=>sql('record',{actionId,evidence}),
  });
}
