import { createHash } from 'node:crypto';
import { ReleaseError } from './contract.mjs';

const metadataWaitLimitMs = 180000;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const metadataPending = () => new ReleaseError('COORDINATION_METADATA_PENDING', 'coordinator.metadata',
  'Coordinator metadata admission is still pending. Resume the unchanged manifest and read its journal before any provider submission.');

/** Retry only the definitive pre-storage metadata-budget response. Lost responses
 * still require readback, never another provider submission. */
export function createCoordinatorClient({url,tokenProvider,fetch:fetchImpl=globalThis.fetch,epoch,owner,adapter='release',now=Date.now,wait=sleep}) {
  const parsed=new URL(url);
  if(!(parsed.protocol==='https:'||parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))
    ||parsed.username||parsed.password||!Number.isSafeInteger(epoch)||epoch<1||!owner||typeof tokenProvider!=='function'||typeof now!=='function'||typeof wait!=='function') throw new Error('Invalid hosted coordinator configuration.');
  const manifests=new Map();
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const request=async(action,payload={})=>{
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
    const startedAt=now();let waitedMs=0;
    for(;;) {
      const token=await tokenProvider({audience:adapter==='financial'?'fcos-financial-coordination':'fcos-release-coordinator'});
      if(typeof token!=='string'||!token||/\s/.test(token)) throw new Error('Coordinator identity token unavailable.');
      let response;
      try { response=await fetchImpl(parsed.href,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',
        ...(adapter==='financial'?{'x-fcos-coordination-adapter':'financial'}:{})},body,
        redirect:'error',signal:AbortSignal.timeout(20000)}); }
      catch { throw new Error('COORDINATION_RESPONSE_UNKNOWN: read coordinator state before any provider submission.'); }
      let result; try { result=await response.json(); } catch {throw new Error('COORDINATION_RESPONSE_UNKNOWN: read coordinator state before any provider submission.');}
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
      if(!response.ok||response.redirected) throw new Error(result?.error??'COORDINATION_REQUEST_FAILED');
      if(action==='register'||action==='snapshot') manifests.set(releaseId,manifestHash);
      if(action==='approve'||action==='resume') return {...result,manifestHash:result.approval?.manifest_hash,expiresAt:result.approval?.expires_at};
      return result;
    }
  };
  return Object.freeze({request,...Object.fromEntries(['snapshot','register','claim','begin','approve','resume','complete','uncertain','readback','appendEvidence','finish'].map(action=>[action,payload=>request(action,payload)]))});
}
