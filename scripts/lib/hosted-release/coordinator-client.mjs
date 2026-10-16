import { createHash } from 'node:crypto';

/** No retries: a lost begin response means readback, never another provider submission. */
export function createCoordinatorClient({url,tokenProvider,fetch:fetchImpl=globalThis.fetch,epoch,owner,adapter='release'}) {
  const parsed=new URL(url);
  if(!(parsed.protocol==='https:'||parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))
    ||parsed.username||parsed.password||!Number.isSafeInteger(epoch)||epoch<1||!owner||typeof tokenProvider!=='function') throw new Error('Invalid hosted coordinator configuration.');
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
    const token=await tokenProvider({audience:adapter==='financial'?'fcos-financial-coordination':'fcos-release-coordinator'});
    if(typeof token!=='string'||!token||/\s/.test(token)) throw new Error('Coordinator identity token unavailable.');
    let response;
    try { response=await fetchImpl(parsed.href,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',
      ...(adapter==='financial'?{'x-fcos-coordination-adapter':'financial'}:{})},body:JSON.stringify({action,payload:{...payload,epoch,owner,manifestHash}}),
      redirect:'error',signal:AbortSignal.timeout(20000)}); }
    catch { throw new Error('COORDINATION_RESPONSE_UNKNOWN: read coordinator state before any provider submission.'); }
    let result; try { result=await response.json(); } catch {throw new Error('COORDINATION_RESPONSE_UNKNOWN: read coordinator state before any provider submission.');}
    if(!response.ok||response.redirected) throw new Error(result?.error??'COORDINATION_REQUEST_FAILED');
    if(action==='register'||action==='snapshot') manifests.set(payload.releaseId,manifestHash);
    if(action==='approve'||action==='resume') return {...result,manifestHash:result.approval?.manifest_hash,expiresAt:result.approval?.expires_at};
    return result;
  };
  return Object.freeze({request,...Object.fromEntries(['snapshot','register','claim','begin','approve','resume','complete','uncertain','readback','appendEvidence','finish'].map(action=>[action,payload=>request(action,payload)]))});
}
