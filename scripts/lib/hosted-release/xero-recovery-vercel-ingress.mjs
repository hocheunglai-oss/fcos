import { createXeroRecoveryHost } from './xero-recovery-host.mjs';
import { parseXeroRecoveryStepPlan } from './xero-recovery-step-protocol.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const XERO_RECOVERY_PRIVATE_KEYS=Object.freeze(['XERO_CLIENT_ID','XERO_CLIENT_SECRET','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']);
export const VERCEL_INGRESS_PROBE_PATH='/.well-known/fcos-ingress-probe';
const OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62';
const fail=()=>{throw Object.assign(new Error('XERO_VERCEL_INGRESS_REFUSED'),{code:'XERO_VERCEL_INGRESS_REFUSED'});};
const need=v=>{if(!v)fail();};
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
  need(Array.isArray(req.rawHeaders)&&req.rawHeaders.length%2===0&&req.rawHeaders.length<=100);
  const values=new Map();let length=0;
  for(let i=0;i<req.rawHeaders.length;i+=2){const k=req.rawHeaders[i].toLowerCase(),v=req.rawHeaders[i+1];
    need(typeof v==='string'&&!values.has(k)&&!/[\r\n]/.test(v));length+=k.length+v.length;values.set(k,v);}
  need(length<=65536);return values;
}
function consistent(req,target,captured) {
  need(JSON.stringify(platform(target))===JSON.stringify(captured));const h=headers(req),url=captured.VERCEL_URL;
  // Header consistency supplements the explicit trusted Vercel hosting/TLS
  // contract. XFP/deployment headers alone are never transport or action proof.
  need(h.get('host')===url&&h.get('x-forwarded-host')===url&&h.get('x-forwarded-proto')==='https'
    &&h.get('x-vercel-deployment-url')===url);return true;
}
const reply=(res,status,value)=>{if(res.destroyed||res.writableEnded)return;const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(body)});res.end(body);};
// Self-contained by design: the credential-free probe package imports no host,
// provider client, private environment reader, app policy metadata or library.
function credentialFreeProbe(target) {
  const validHost=v=>typeof v==='string'&&/^fcos-[a-z0-9]{5,30}-hocheunglai-6535s-projects\.vercel\.app$/.test(v);
  return async(req,res)=>{
    const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(body)});res.end(body);};
    try {
      if(req.method!=='GET'||req.url!=='/.well-known/fcos-ingress-probe')throw Error();
      const names=['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_URL','VERCEL_DEPLOYMENT_ID','VERCEL_PROJECT_ID'];
      const actual=Object.fromEntries(names.map(k=>[k,process.env[k]]));
      if(actual.VERCEL!=='1'||actual.VERCEL_ENV!=='preview'||actual.VERCEL_TARGET_ENV!==target.customEnvironment||actual.VERCEL_PROJECT_ID!==target.projectId
        ||!validHost(actual.VERCEL_URL)||!/^dpl_[A-Za-z0-9]{1,100}$/.test(actual.VERCEL_DEPLOYMENT_ID||''))throw Error();
      const h=new Map();if(!Array.isArray(req.rawHeaders)||req.rawHeaders.length%2||req.rawHeaders.length>100)throw Error();let size=0;
      for(let i=0;i<req.rawHeaders.length;i+=2){const k=req.rawHeaders[i].toLowerCase(),v=req.rawHeaders[i+1];if(typeof v!=='string'||h.has(k)||/[\r\n]/.test(v))throw Error();size+=k.length+v.length;h.set(k,v);}
      if(size>65536||['authorization','cookie','x-fcos-owner-bearer','x-fcos-provider-access-token','transfer-encoding'].some(k=>h.has(k))||h.has('content-length')&&h.get('content-length')!=='0')throw Error();
      const fields=['host','x-forwarded-host','x-forwarded-proto','x-vercel-deployment-url'];
      const observed=Object.fromEntries(fields.map(k=>{const value=h.get(k);return [k,k==='x-forwarded-proto'?(['http','https'].includes(value)?value:null):validHost(value)?value:null];}));
      send(200,{kind:'fcos_vercel_ingress_shape_probe_v1',capturedAt:new Date().toISOString(),target,platform:actual,observedHeaders:observed,nativeSocketTls:req.socket?.encrypted===true,
        normalHttpsConsistency:fields.every(k=>observed[k]===(k==='x-forwarded-proto'?'https':actual.VERCEL_URL)),providerReceipt:false,ingressQualified:false,executionAuthorityGranted:false});
    }catch{send(403,{error:'XERO_VERCEL_INGRESS_PROBE_REFUSED',executionAuthorityGranted:false});}
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
