import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
export const ACTIONS = Object.freeze(['snapshot','register','claim','begin','approve','resume','complete','uncertain','readback','appendEvidence','finish']);
export class CoordinatorError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export function need(value, code, status) { if (!value) throw new CoordinatorError(code, status); }
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { need(Number.isFinite(value), 'COORDINATION_INVALID_JSON', 400); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  need(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'COORDINATION_INVALID_JSON', 400);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
}
export function validateEnvelope(body) {
  need(body && typeof body === 'object' && !Array.isArray(body) && ACTIONS.includes(body.action), 'COORDINATION_ACTION_UNKNOWN', 400);
  const p = body.payload;
  need(p && typeof p === 'object' && !Array.isArray(p) && Number.isSafeInteger(p.epoch) && p.epoch > 0
    && p.owner && ['release','financial'].includes(p.owner.kind) && /^[a-zA-Z0-9._:-]{1,160}$/.test(p.owner.id)
    && /^[a-zA-Z0-9._:-]{1,200}$/.test(p.releaseId)
    && /^[a-f0-9]{64}$/.test(p.manifestHash), 'COORDINATION_SCOPE_INVALID', 400);
  // Server-authored authentication/approval material cannot be supplied through the API.
  need(!Object.hasOwn(p,'approvalReceipt') && !Object.hasOwn(p,'resumeReceipt') && !Object.hasOwn(p,'principal') && !Object.hasOwn(p,'notificationDelivery') && !Object.hasOwn(p,'notificationChallenge') && !Object.hasOwn(p,'qualificationOnly') && !Object.hasOwn(p,'qualificationAdmission'), 'COORDINATION_SERVER_FIELD_FORBIDDEN',400);
  return {action:body.action, payload:p};
}
export function createSqlStore(query) {
  need(typeof query === 'function','COORDINATION_DATABASE_REQUIRED',500);
  return { async request(action,payload,principal) {
    const result = await query('select fcos_release_coordination.dispatch($1::text,$2::jsonb,$3::jsonb) as result', [action,JSON.stringify(payload),JSON.stringify(principal)]);
    return result.rows[0].result;
  }};
}

// These local setup helpers validate integrity and exact identity only. The
// privileged operator must independently authenticate the actual human reply.
export function createNotificationChallenge({now=Date.now}={}) {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return {challenge:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),issuedAt:new Date(now()).toISOString(),
    repository:fcosConnectionIdentifier('github','Repository'),
    operator:fcosConnectionIdentifier(FCOS_RELEASE_APPROVAL_POLICY.operatorProvider,FCOS_RELEASE_APPROVAL_POLICY.operatorIdentifier)};
}
export function assertNotificationChallenge(challenge,{now=Date.now()}={}) {
  need(challenge&&/^[a-f0-9]{64}$/.test(challenge.challenge)&&Number.isFinite(Date.parse(challenge.issuedAt))
    &&Date.parse(challenge.issuedAt)<=now+30000&&challenge.repository===fcosConnectionIdentifier('github','Repository')
    &&challenge.operator===fcosConnectionIdentifier(FCOS_RELEASE_APPROVAL_POLICY.operatorProvider,FCOS_RELEASE_APPROVAL_POLICY.operatorIdentifier),
    'COORDINATION_NOTIFICATION_CHALLENGE_REQUIRED',400);
  return challenge;
}
export async function createNotificationDeliveryProof({receiptJson,challenge,now=Date.now()}={}) {
  assertNotificationChallenge(challenge,{now});
  need(typeof receiptJson==='string'&&new TextEncoder().encode(receiptJson).length<=8192,'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED',400);
  let receipt;try{receipt=JSON.parse(receiptJson);}catch{need(false,'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED',400);}
  const receivedAt=Date.parse(receipt?.receivedAt);
  need(receipt&&receipt.challenge===challenge.challenge&&receipt.repository===challenge.repository&&receipt.operator===challenge.operator
    &&receipt.device==='iphone'&&receipt.confirmedByHuman===true&&Number.isFinite(receivedAt)
    &&receivedAt>=Date.parse(challenge.issuedAt)&&receivedAt<=now+30000,'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED',400);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(receiptJson));
  return {receiptJson,receiptSha256:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')};
}

export function assertQualificationScope(principal,payload,action) {
  if(principal.qualificationOnly!==true) return;
  need(principal.kind==='github'&&payload.owner.kind==='release'&&!['approve','admitApproval','resume'].includes(action),
    'COORDINATION_QUALIFICATION_ONLY',403);
  if(action!=='register') return;
  const m=payload.manifest,q=principal.qualificationAdmission;
  const expected={ref:q.ref,bootstrapSha:q.bootstrapSha,callerWorkflowRef:q.callerWorkflowRef,controllerSha:q.jobWorkflowSha,candidateSha:q.candidateSha};
  need(m?.stage==='qualification'&&m.executionMode==='qualification'&&m.setupSha256===q.setupSha256
    &&m.controller?.sha===q.jobWorkflowSha&&m.controller.workflow==='.github/workflows/hosted-release-controller.yml'
    &&m.candidate?.sha===q.candidateSha&&m.qualificationSource&&canonicalJson(m.qualificationSource)===canonicalJson(expected),
    'COORDINATION_QUALIFICATION_SCOPE_INVALID',403);
}

/** Shared only within one configured service process; unrelated/financial calls are independent.
 * Full bundles remain charged until all queued reads settle, then for one minute. */
export function createMetadataAdmission({now=Date.now}={}) {
  let reservations=[],active=0;const pending=[];
  const runRead=async read=>{
    await new Promise(resolve=>{const start=()=>{active++;resolve();};if(active<2) start();else pending.push(start);});
    try{return await read();}finally{active--;pending.shift()?.();}
  };
  return {
    admit(weight) {
      need(Number.isSafeInteger(weight)&&weight>0&&weight<=45,'COORDINATION_METADATA_WEIGHT_INVALID',500);
      const at=now();reservations=reservations.filter(row=>row.pending||at-row.at<60000);
      const used=reservations.reduce((sum,row)=>sum+row.weight,0);
      if(used+weight>45) {
        let needed=used+weight-45,recovery=at+60000;
        for(const row of reservations.filter(row=>!row.pending).sort((a,b)=>a.at-b.at)) {
          needed-=row.weight;if(needed<=0){recovery=row.at+60000;break;}
        }
        const error=new CoordinatorError('COORDINATION_METADATA_PENDING',429);
        error.retryAfterSeconds=Math.max(1,Math.min(60,Math.ceil((recovery-at)/1000)));throw error;
      }
      const reservation={at,weight,pending:true};reservations.push(reservation);
      let outstanding=0,dispatched=0,finished=false;
      const settle=()=>{if(finished&&outstanding===0){reservation.pending=false;reservation.at=now();}};
      return {
        async runRead(read) {
          need(!finished,'COORDINATION_METADATA_RESERVATION_FINISHED',500);
          need(dispatched<weight,'COORDINATION_METADATA_RESERVATION_EXHAUSTED',500);dispatched++;outstanding++;
          try{return await runRead(read);}finally{outstanding--;settle();}
        },
        finish(){finished=true;settle();},
      };
    },
    runRead,
  };
}
