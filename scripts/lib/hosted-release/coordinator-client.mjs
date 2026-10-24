import { createHash } from 'node:crypto';
import { ReleaseError } from './json-contract.mjs';
import { COORDINATOR_REQUEST_BUDGET, COORDINATOR_DEADLINE_HEADER } from '../../../supabase/functions/release-coordinator/core.mjs';
// Literal public protocol codes from the checked-in coordinator and migrations.
// Unknown response text is never copied into a diagnostic.
const safeServerCodes = new Set([
  'COORDINATION_ACTION_UNKNOWN', 'COORDINATION_ACTIVATION_EVIDENCE_REQUIRED', 'COORDINATION_ACTIVATION_STATE_INVALID',
  'COORDINATION_APPEND_ONLY', 'COORDINATION_APPROVAL_ADMISSION_REQUIRED', 'COORDINATION_APPROVAL_AMBIGUOUS',
  'COORDINATION_APPROVAL_ENVIRONMENT_REQUIRED', 'COORDINATION_APPROVAL_EXPIRED', 'COORDINATION_APPROVAL_INVALID',
  'COORDINATION_APPROVAL_JOBS_INCOMPLETE', 'COORDINATION_APPROVAL_JOB_AMBIGUOUS', 'COORDINATION_APPROVAL_RUN_INVALID',
  'COORDINATION_APPROVAL_SCOPE_INVALID', 'COORDINATION_APPROVAL_UNAVAILABLE', 'COORDINATION_AUTHENTICATION_REQUIRED',
  'COORDINATION_BOOTSTRAP_BUSY', 'COORDINATION_BROAD_CREDENTIAL_FORBIDDEN', 'COORDINATION_CONFIGURATION_REQUIRED',
  'COORDINATION_CONTAINMENT_BINDING_CHANGED', 'COORDINATION_CONTAINMENT_METADATA_REQUIRED', 'COORDINATION_CONTAINMENT_PROTECTION_CHANGED',
  'COORDINATION_CONTAINMENT_VALIDATOR_REQUIRED', 'COORDINATION_CONTENT_TYPE_REQUIRED', 'COORDINATION_DATABASE_PRIVILEGES_INVALID',
  'COORDINATION_DATABASE_REQUIRED', 'COORDINATION_DATABASE_ROLE_INVALID', 'COORDINATION_DEFINITIVE_READBACK_REQUIRED',
  'COORDINATION_ENVIRONMENT_REVIEW_INVALID', 'COORDINATION_EPOCH_CONFLICT', 'COORDINATION_EVIDENCE_CONFLICT',
  'COORDINATION_EXACT_PREVIEW_QUARANTINE_SUCCESSOR_REQUIRED',
  'COORDINATION_EVIDENCE_REQUIRED', 'COORDINATION_FINANCIAL_ADAPTER_DISABLED', 'COORDINATION_FINANCIAL_IDENTITY_INVALID',
  'COORDINATION_FINANCIAL_POLICY_INVALID', 'COORDINATION_GITHUB_IDENTITY_INVALID', 'COORDINATION_GITHUB_METADATA_UNAVAILABLE',
  'COORDINATION_GITHUB_SUBJECT_INVALID', 'COORDINATION_HOSTED_QUALIFICATION_REQUIRED', 'COORDINATION_IMPORTED_UNCERTAINTY_UNRESOLVED',
  'COORDINATION_IMPORT_INVALID', 'COORDINATION_INACTIVE', 'COORDINATION_INVALID_JSON',
  'COORDINATION_LOCK_MISMATCH', 'COORDINATION_MAINTENANCE_AUTHORITY_INVALID', 'COORDINATION_MAINTENANCE_BINDING_CHANGED',
  'COORDINATION_MAINTENANCE_CAP_EXHAUSTED', 'COORDINATION_MAINTENANCE_CAP_REQUIRED', 'COORDINATION_MAINTENANCE_DEFINITIVE_READBACK_REQUIRED',
  'COORDINATION_MAINTENANCE_EXPIRED', 'COORDINATION_MAINTENANCE_FENCE_INVALID', 'COORDINATION_MAINTENANCE_FENCE_REQUIRED',
  'COORDINATION_MAINTENANCE_MANIFEST_INVALID', 'COORDINATION_MAINTENANCE_PARENT_REQUIRED', 'COORDINATION_MAINTENANCE_PRINCIPAL_REQUIRED',
  'COORDINATION_MAINTENANCE_RECOVERY_INVALID', 'COORDINATION_MAINTENANCE_RECOVERY_REQUIRED', 'COORDINATION_MAINTENANCE_RESOLUTION_INVALID',
  'COORDINATION_MAINTENANCE_REVOKED', 'COORDINATION_MAINTENANCE_UNRESOLVED', 'COORDINATION_MANIFEST_CONFLICT',
  'COORDINATION_MANIFEST_HASH_MISMATCH', 'COORDINATION_MANIFEST_INVALID', 'COORDINATION_METADATA_ACCOUNT_MISMATCH',
  'COORDINATION_METADATA_PENDING', 'COORDINATION_METADATA_RESERVATION_EXHAUSTED', 'COORDINATION_METADATA_RESERVATION_FINISHED',
  'COORDINATION_METADATA_TOKEN_REQUIRED', 'COORDINATION_METADATA_WEIGHT_INVALID', 'COORDINATION_METHOD_FORBIDDEN',
  'COORDINATION_NOTIFICATION_CHALLENGE_REQUIRED', 'COORDINATION_NOTIFICATION_CHALLENGE_REUSED', 'COORDINATION_NOTIFICATION_DELIVERY_REQUIRED',
  'COORDINATION_OLD_WRITER_NOT_FENCED', 'COORDINATION_OPERATION_CONFLICT', 'COORDINATION_OPERATION_INVALID',
  'COORDINATION_OPERATION_UNKNOWN', 'COORDINATION_OWNER_MISMATCH', 'COORDINATION_PHASE_FORBIDDEN',
  'COORDINATION_POLICY_INVALID', 'COORDINATION_PORT_INVALID', 'COORDINATION_PREAPPROVAL_REGISTRATION_REQUIRED',
  'COORDINATION_PRODUCTION_APPROVAL_REQUIRED', 'COORDINATION_PROTECTED_REF_INVALID', 'COORDINATION_QUALIFICATION_IDENTITY_INVALID',
  'COORDINATION_QUALIFICATION_ONLY', 'COORDINATION_QUALIFICATION_POLICY_INVALID', 'COORDINATION_QUALIFICATION_PROTECTED_REF_INVALID',
  'COORDINATION_QUALIFICATION_REQUIRED', 'COORDINATION_QUALIFICATION_RUN_INVALID', 'COORDINATION_QUALIFICATION_SCOPE_INVALID',
  'COORDINATION_QUALIFICATION_SIMULATIONS_REQUIRED', 'COORDINATION_QUALIFICATION_SIMULATION_ONLY', 'COORDINATION_QUALIFICATION_VALIDATOR_REQUIRED',
  'COORDINATION_REGISTER_BEFORE_APPROVAL_REQUIRED', 'COORDINATION_REGISTRATION_RUN_CONFLICT', 'COORDINATION_REGISTRATION_RUN_INVALID',
  'COORDINATION_REGISTRATION_RUN_REQUIRED', 'COORDINATION_RELEASE_FINISHED', 'COORDINATION_RELEASE_UNKNOWN',
  'COORDINATION_RENEWAL_NEW_RUN_REQUIRED', 'COORDINATION_REQUEST_TOO_LARGE', 'COORDINATION_RESUME_ENVIRONMENT_INVALID',
  'COORDINATION_RESUME_FORBIDDEN', 'COORDINATION_SCOPE_INVALID', 'COORDINATION_SCOPE_MISMATCH',
  'COORDINATION_SERVER_FIELD_FORBIDDEN', 'COORDINATION_SOURCE_UPGRADE_ADMISSION_INVALID', 'COORDINATION_SOURCE_UPGRADE_BINDING_CHANGED',
  'COORDINATION_SOURCE_UPGRADE_CONFIGURATION_UNRESOLVED', 'COORDINATION_SOURCE_UPGRADE_CONFLICT', 'COORDINATION_SOURCE_UPGRADE_CONTAINMENT_CONFLICT',
  'COORDINATION_SOURCE_UPGRADE_CONTAINMENT_INVALID', 'COORDINATION_SOURCE_UPGRADE_CONTAINMENT_REVOKED', 'COORDINATION_SOURCE_UPGRADE_DISPATCH_UNRESOLVED',
  'COORDINATION_SOURCE_UPGRADE_IDENTITY_CHANGED', 'COORDINATION_SOURCE_UPGRADE_KNOWN_ACK_REQUIRED', 'COORDINATION_SOURCE_UPGRADE_LIVE_SCHEMA_CHANGED',
  'COORDINATION_SOURCE_UPGRADE_NOT_ADMITTED', 'COORDINATION_SOURCE_UPGRADE_NOT_HELD', 'COORDINATION_SOURCE_UPGRADE_NOT_HELD_OR_UNRESOLVED',
  'COORDINATION_SOURCE_UPGRADE_PARTIAL_CONTAINMENT', 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_IDENTITY_CHANGED', 'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_IN_USE',
  'COORDINATION_SOURCE_UPGRADE_POLICY_ROUTE_SOURCE_DRIFT', 'COORDINATION_SOURCE_UPGRADE_READY_REQUIRED', 'COORDINATION_SOURCE_UPGRADE_READY_UNEXPECTED',
  'COORDINATION_SOURCE_UPGRADE_REGISTRATION_INVALID', 'COORDINATION_SOURCE_UPGRADE_SOURCE_DRIFT', 'COORDINATION_SOURCE_UPGRADE_TERMINAL',
  'COORDINATION_STALE_EPOCH', 'COORDINATION_TERMINAL_CONFLICT', 'COORDINATION_UNAVAILABLE',
  'COORDINATION_UNRESOLVED_OPERATION', 'COORDINATION_WRITER_NOT_ADMITTED',
  'COORDINATION_DEADLINE_INVALID', 'COORDINATION_DEADLINE_EXCEEDED', 'COORDINATION_REQUEST_CANCELLED',
]);
const actions = ['snapshot','register','claim','begin','approve','resume','complete','uncertain','readback','appendEvidence','finish'];
const refusal = (code, action = 'configuration', detail = {}) => new ReleaseError(code, `coordinator.${action}`,
  'Read the existing coordinator journal before any consequential operation. Do not retry an uncertain submission.', detail);


const metadataWaitLimitMs = 180000;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const metadataPending = () => new ReleaseError('COORDINATION_METADATA_PENDING', 'coordinator.metadata',
  'Coordinator metadata admission is still pending. Resume the unchanged manifest and read its journal before any provider submission.');

/** Retry only the definitive pre-storage metadata-budget response. Lost responses
 * still require readback, never another provider submission. */
export function createCoordinatorClient({url,tokenProvider,fetch:fetchImpl=globalThis.fetch,epoch,owner,adapter='release',now=Date.now,wait=sleep,requestBudgetMs=COORDINATOR_REQUEST_BUDGET.clientMs}) {
  let parsed;try{parsed=new URL(url);}catch{throw refusal('COORDINATION_CONFIGURATION_INVALID');}
  if(!(parsed.protocol==='https:'||parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))
    ||parsed.username||parsed.password||!Number.isSafeInteger(epoch)||epoch<1||!owner||typeof tokenProvider!=='function'||typeof now!=='function'||typeof wait!=='function'||!Number.isSafeInteger(requestBudgetMs)||requestBudgetMs<1||requestBudgetMs>COORDINATOR_REQUEST_BUDGET.clientMs) throw refusal('COORDINATION_CONFIGURATION_INVALID');
  const manifests=new Map();
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const request=async(action,payload={})=>{
    if(!actions.includes(action))throw refusal('COORDINATION_ACTION_UNKNOWN');
    const manifestHash=payload.manifestHash??manifests.get(payload.releaseId);
    if(action==='uncertain'&&!payload.evidence) payload={...payload,evidence:{outcome:'unknown',reason:payload.reason??'PROVIDER_OUTCOME_UNKNOWN'}};
    if(action==='finish'&&!payload.evidence) payload={...payload,evidence:{status:payload.status??'complete'}};
    if(action==='appendEvidence') {
      const evidence=payload.key?{...payload.evidence,key:payload.key}:payload.evidence;
      const evidenceId=payload.evidenceId??createHash('sha256').update(canonical({epoch,owner,releaseId:payload.releaseId,manifestHash,key:payload.key??null,evidence})).digest('hex');
      payload={...payload,evidence,evidenceId};
    }
    // Capture the operation before the first asynchronous call. A caller mutation
    // during a budget wait must never change the admitted request or evidence ID.
    const body=JSON.stringify({action,payload:{...payload,epoch,owner,manifestHash}}),releaseId=payload.releaseId;
    const requestSha256=createHash('sha256').update(canonical(JSON.parse(body))).digest('hex');
    const startedAt=now();let waitedMs=0;
    for(;;) {
      let token;try{token=await tokenProvider({audience:adapter==='financial'?'fcos-financial-coordination':'fcos-release-coordinator'});}
      catch(error){if(error instanceof ReleaseError)throw error;throw refusal('COORDINATION_IDENTITY_UNAVAILABLE',action);}
      if(typeof token!=='string'||!token||/\s/.test(token)) throw refusal('COORDINATION_IDENTITY_UNAVAILABLE',action);
      const attemptStartedAt=now(),signal=AbortSignal.timeout(requestBudgetMs);
      const unknown=stage=>refusal('COORDINATION_RESPONSE_UNKNOWN',action,{coordinatorTransport:{stage,
        elapsedMs:Math.max(0,Math.min(2147483647,Math.round(now()-attemptStartedAt)||0)),timeout:signal.aborted,requestSha256}});
      let response;
      try { response=await fetchImpl(parsed.href,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',[COORDINATOR_DEADLINE_HEADER]:String(attemptStartedAt+requestBudgetMs),
        ...(adapter==='financial'?{'x-fcos-coordination-adapter':'financial'}:{})},body,
        redirect:'error',signal}); }
      catch { throw unknown('fetch'); }
      let result; try { result=await response.json(); } catch {throw unknown('response_body');}
      const retryAfter=response.headers?.get('retry-after');
      if(adapter==='release'&&response.status===429&&!response.redirected&&result&&Object.getPrototypeOf(result)===Object.prototype
        &&Object.keys(result).length===1&&result.error==='COORDINATION_METADATA_PENDING'
        &&/^[1-9][0-9]?$/.test(retryAfter||'')&&Number(retryAfter)<=60) {
        const delayMs=Number(retryAfter)*1000,elapsedMs=now()-startedAt;
        if(!Number.isFinite(elapsedMs)||Math.max(waitedMs,elapsedMs)+delayMs>metadataWaitLimitMs) throw metadataPending();
        await wait(delayMs);waitedMs+=delayMs;
        if(Math.max(waitedMs,now()-startedAt)>metadataWaitLimitMs) throw metadataPending();
        continue;
      }
      if(!response.ok||response.redirected) throw refusal(!response.redirected&&safeServerCodes.has(result?.error)?result.error:'COORDINATION_REQUEST_REJECTED',action);
      if(action==='register'||action==='snapshot') manifests.set(releaseId,manifestHash);
      if(action==='approve'||action==='resume') return {...result,manifestHash:result.approval?.manifest_hash,expiresAt:result.approval?.expires_at};
      return result;
    }
  };
  return Object.freeze({request,...Object.fromEntries(actions.map(action=>[action,payload=>request(action,payload)]))});
}
