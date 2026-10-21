import { createXeroRecoveryHost } from './xero-recovery-host.mjs';
import { parseXeroRecoveryStepPlan } from './xero-recovery-step-protocol.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const XERO_RECOVERY_PRIVATE_KEYS=Object.freeze(['XERO_CLIENT_ID','XERO_CLIENT_SECRET','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']);
export const VERCEL_INGRESS_PROBE_PATH='/.well-known/fcos-ingress-probe';
const OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62';
// Only fixed reasons attached to errors minted here may reach transport logs.
// Request values and external exception messages/codes are never diagnostics.
const transportRefusalReasons=new WeakMap();
const fail=reason=>{const error=Object.assign(new Error('XERO_VERCEL_INGRESS_REFUSED'),{code:'XERO_VERCEL_INGRESS_REFUSED'});
  if(reason)transportRefusalReasons.set(error,reason);throw error;};
const need=(v,reason)=>{if(!v)fail(reason);};
const plain=v=>v!==null&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const hostname=v=>typeof v==='string'&&/^fcos-[a-z0-9]{5,30}-hocheunglai-6535s-projects\.vercel\.app$/.test(v);
export function validateVercelIngressTarget(target) {
  need(exact(target,['teamId','projectId','customEnvironment','controllerSha','hostSourceSha256'])
    &&target.teamId===fcosConnectionIdentifier('vercel','Team ID')&&target.projectId===fcosConnectionIdentifier('vercel','Project ID')
    &&/^fcos-xero-recovery-[a-f0-9]{12}$/.test(target.customEnvironment)&&sha(target.controllerSha)&&hash(target.hostSourceSha256));
  return target;
}
export function validateVercelRecoveryCompiled(compiled) {
  need(exact(compiled,['schemaVersion','kind','target','planJson','actorBinding','ownership','caller','requestNonceSha256'])
    &&compiled.schemaVersion===1&&compiled.kind==='fcos_compiled_xero_vercel_host_v1'&&hash(compiled.requestNonceSha256));
  validateVercelIngressTarget(compiled.target);const {plan}=parseXeroRecoveryStepPlan(compiled.planJson);
  const a=compiled.actorBinding,o=compiled.ownership,c=compiled.caller,uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
  need(exact(a,['actorId','emailSha256','accessRevision'])&&a.actorId===plan.binding.actorId&&hash(a.emailSha256)&&Number.isSafeInteger(a.accessRevision)&&a.accessRevision>0
    &&exact(o,['featuresOwnerThreadId','historicalOwnerThreadIds','approvalSha256','sourceSha256','controllerSha'])&&o.featuresOwnerThreadId===OWNER
    &&Array.isArray(o.historicalOwnerThreadIds)&&o.historicalOwnerThreadIds.length>0&&o.historicalOwnerThreadIds.length<=16&&o.historicalOwnerThreadIds.every(uuid)
    &&o.historicalOwnerThreadIds.includes(plan.binding.ownerThreadId)&&o.approvalSha256===plan.binding.approvalSha256&&o.sourceSha256===plan.binding.sourceSha256
    &&o.controllerSha===compiled.target.controllerSha&&exact(c,['ref','sha','workflowRef','workflowSha','jobWorkflowRef','jobWorkflowSha','runId','environment','subject'])
    &&/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]{0,150}$/.test(c.ref)&&!c.ref.includes('..')&&sha(c.sha)&&c.workflowSha===c.sha
    &&c.jobWorkflowSha===compiled.target.controllerSha&&new RegExp('^hocheunglai-oss/fcos/\\.github/workflows/[A-Za-z0-9_-]+\\.yml@').test(c.workflowRef)&&c.workflowRef.endsWith(`@${c.ref}`)
    &&new RegExp('^hocheunglai-oss/fcos/\\.github/workflows/[A-Za-z0-9_-]+\\.yml@').test(c.jobWorkflowRef)&&c.jobWorkflowRef.endsWith(`@${c.jobWorkflowSha}`)
    &&/^[1-9][0-9]{0,19}$/.test(c.runId)&&c.environment==='fcos-hosted-verification'&&c.subject==='repo:hocheunglai-oss/fcos:environment:fcos-hosted-verification');
  return compiled;
}
function platform(target) {
  // Process inputs are trusted hosting infrastructure, never request claims.
  // They do not constitute a native provider receipt or root host admission.
  const value=Object.fromEntries(['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_URL','VERCEL_DEPLOYMENT_ID','VERCEL_PROJECT_ID'].map(k=>[k,process.env[k]]));
  need(value.VERCEL==='1'&&value.VERCEL_ENV==='preview'&&value.VERCEL_TARGET_ENV===target.customEnvironment
    &&value.VERCEL_PROJECT_ID===target.projectId&&hostname(value.VERCEL_URL)&&/^dpl_[A-Za-z0-9]{1,100}$/.test(value.VERCEL_DEPLOYMENT_ID||''));
  return Object.freeze(value);
}
function headers(req) {
  need(Array.isArray(req.rawHeaders),'raw_headers_shape_refused');
  need(req.rawHeaders.length%2===0,'raw_headers_shape_refused');
  // rawHeaders alternates names and values: 200 entries permit 100 fields.
  need(req.rawHeaders.length<=200,'raw_header_count_exceeded');
  const values=new Map();let length=0;
  for(let i=0;i<req.rawHeaders.length;i+=2){let k;
    try{k=req.rawHeaders[i].toLowerCase();}catch{fail('raw_header_name_refused');}
    const v=req.rawHeaders[i+1];
    need(typeof v==='string','raw_header_value_shape_refused');
    need(!values.has(k),'raw_header_duplicate_refused');
    need(!/[\r\n]/.test(v),'raw_header_value_refused');length+=k.length+v.length;values.set(k,v);}
  need(length<=65536,'raw_header_size_exceeded');return values;
}
function consistent(req,target,captured) {
  try{
    let current;try{current=platform(target);}catch{fail('platform_context_refused');}
    need(JSON.stringify(current)===JSON.stringify(captured),'platform_context_changed');const h=headers(req),url=captured.VERCEL_URL;
    // Header consistency supplements the explicit trusted Vercel hosting/TLS
    // contract. XFP/deployment headers alone are never transport or action proof.
    need(h.get('host')===url,'host_mismatch');
    need(h.get('x-forwarded-host')===url,'forwarded_host_mismatch');
    need(h.get('x-forwarded-proto')==='https','forwarded_proto_mismatch');
    need(h.get('x-vercel-deployment-url')===url,'deployment_url_mismatch');return true;
  }catch(error){
    try{console.error(JSON.stringify({kind:'fcos_xero_vercel_ingress_transport_failure_v1',
      reason:transportRefusalReasons.get(error)||'transport_check_failed'}));}catch{/* Diagnostics cannot change the refusal. */}
    throw error;
  }
}
const reply=(res,status,value)=>{if(res.destroyed||res.writableEnded)return;const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(body)});res.end(body);};
// Self-contained by design: the credential-free probe package imports no host,
// provider client, private environment reader, app policy metadata or library.
function credentialFreeProbe(target) {
  const validHost=v=>typeof v==='string'&&/^fcos-[a-z0-9]{5,30}-hocheunglai-6535s-projects\.vercel\.app$/.test(v);
  return async(req,res)=>{
    const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(body)});res.end(body);};
    // Request-local fixed codes only; caught exception properties are untrusted.
    let refusalReason='probe_check_failed';const need=(value,reason)=>{if(!value){refusalReason=reason;throw Error();}};
    try {
      need(['GET','POST'].includes(req.method),'method_refused');need(req.url==='/.well-known/fcos-ingress-probe','path_mismatch');
      const syntheticPost=req.method==='POST',sentinel='fcos-ingress-shape-probe';
      const names=['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_URL','VERCEL_DEPLOYMENT_ID','VERCEL_PROJECT_ID'];
      const actual=Object.fromEntries(names.map(k=>[k,process.env[k]]));
      need(actual.VERCEL==='1'&&actual.VERCEL_ENV==='preview'&&actual.VERCEL_TARGET_ENV===target.customEnvironment&&actual.VERCEL_PROJECT_ID===target.projectId
        &&validHost(actual.VERCEL_URL)&&/^dpl_[A-Za-z0-9]{1,100}$/.test(actual.VERCEL_DEPLOYMENT_ID||''),'platform_context_refused');
      const h=new Map();need(Array.isArray(req.rawHeaders),'raw_headers_shape_refused');need(req.rawHeaders.length%2===0,'raw_headers_shape_refused');
      // Match the recovery ingress's bounded 100-field budget (name/value pairs).
      need(req.rawHeaders.length<=200,'raw_header_count_exceeded');let size=0;
      for(let i=0;i<req.rawHeaders.length;i+=2){let k;
        try{k=req.rawHeaders[i].toLowerCase();}catch{need(false,'raw_header_name_refused');}
        const v=req.rawHeaders[i+1];need(typeof v==='string','raw_header_value_shape_refused');need(!h.has(k),'raw_header_duplicate_refused');
        need(!/[\r\n]/.test(v),'raw_header_value_refused');size+=k.length+v.length;h.set(k,v);}
      need(!(size>65536),'raw_header_size_exceeded');
      if(syntheticPost){
        need(!['cookie','transfer-encoding','proxy-authorization'].some(k=>h.has(k)),'forbidden_header');
        need(h.get('authorization')===`Bearer ${sentinel}`,'sentinel_authorization_refused');
        need(h.get('x-fcos-owner-bearer')===sentinel,'sentinel_owner_refused');
        need(h.get('x-fcos-provider-access-token')===sentinel,'sentinel_provider_refused');
        need(h.get('x-fcos-recovery-nonce')===sentinel,'sentinel_nonce_refused');
        need(h.get('content-type')==='application/json','body_content_type_refused');need(h.get('content-length')==='2','body_length_header_refused');
        // Public sentinels reproduce credential-header presence only. This is
        // never genuine JWT/owner/provider authentication or action admission.
        await new Promise((resolve,reject)=>{
          let size=0,settled=false;const chunks=[];
          const cleanup=()=>{clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('aborted',stop);req.removeListener('error',stop);req.removeListener('close',stop);};
          const finish=(valid,reason)=>{if(settled)return;settled=true;cleanup();req.pause?.();if(valid)resolve();else{refusalReason=reason;reject(Error());}};
          const data=chunk=>{if(!Buffer.isBuffer(chunk))return finish(false,'body_chunk_refused');if(size+chunk.length>2)return finish(false,'body_size_exceeded');size+=chunk.length;chunks.push(Buffer.from(chunk));};
          const end=()=>finish(size===2&&Buffer.concat(chunks).equals(Buffer.from('{}')),size===2?'body_sentinel_mismatch':'body_length_mismatch'),stop=()=>finish(false,'body_cancelled');
          const timer=setTimeout(()=>finish(false,'body_timeout'),1000);req.on('data',data);req.once('end',end);req.once('aborted',stop);req.once('error',stop);req.once('close',stop);
          if(req.aborted)stop();
        });
      }else{
        need(!['authorization','cookie','x-fcos-owner-bearer','x-fcos-provider-access-token','transfer-encoding'].some(k=>h.has(k)),'forbidden_header');
        need(!h.has('content-length')||h.get('content-length')==='0','body_length_header_refused');
      }
      const fields=['host','x-forwarded-host','x-forwarded-proto','x-vercel-deployment-url'];
      const observed=Object.fromEntries(fields.map(k=>{const value=h.get(k);return [k,k==='x-forwarded-proto'?(['http','https'].includes(value)?value:null):validHost(value)?value:null];}));
      send(200,{kind:'fcos_vercel_ingress_shape_probe_v1',capturedAt:new Date().toISOString(),target,platform:actual,observedHeaders:observed,nativeSocketTls:req.socket?.encrypted===true,
        normalHttpsConsistency:fields.every(k=>observed[k]===(k==='x-forwarded-proto'?'https':actual.VERCEL_URL)),providerReceipt:false,ingressQualified:false,executionAuthorityGranted:false,
        ...(syntheticPost?{syntheticPostTransportShape:true,publicSentinelCredentialsOnly:true,genuineAuthenticatedPostQualified:false}:{})});
    }catch{send(403,{error:'XERO_VERCEL_INGRESS_PROBE_REFUSED',reason:refusalReason,executionAuthorityGranted:false});}
  };
}
export function vercelIngressProbeEntrypoint(target) {
  validateVercelIngressTarget(target);return `export default (${credentialFreeProbe.toString()})(${JSON.stringify(target)});\n`;
}
export function createVercelIngressProbe({target}={}) {
  return credentialFreeProbe(Object.freeze({...validateVercelIngressTarget(target)}));
}
export function createVercelRecoveryIngress({compiled,hostOptions={}}={}) {
  validateVercelRecoveryCompiled(compiled);const target=Object.freeze({...compiled.target}),captured=platform(target),publicOrigin=`https://${captured.VERCEL_URL}`;
  need(exact(hostOptions,['fetchImpl','now','githubJwks','fcunoJwks'].filter(k=>Object.hasOwn(hostOptions,k))));
  const privateEnvironment=Object.fromEntries(XERO_RECOVERY_PRIVATE_KEYS.map(k=>[k,process.env[k]]));
  const handler=createXeroRecoveryHost({...hostOptions,publicOrigin,
    planJson:compiled.planJson,actorBinding:compiled.actorBinding,ownership:compiled.ownership,
    caller:{...compiled.caller,audience:`${publicOrigin}/xero-recovery`},requestNonceSha256:compiled.requestNonceSha256,privateEnvironment,
    verifyTransport:req=>consistent(req,target,captured)});
  return async(req,res)=>{try{return await handler(req,res);}catch{reply(res,503,{error:'XERO_VERCEL_INGRESS_STOPPED_OWNER_READBACK_REQUIRED',retryable:false});}};
}
