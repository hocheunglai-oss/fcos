import { ACTIONS, CoordinatorError, createSqlStore, digest, need, validateEnvelope } from './core.mjs';
import { createGithubAuthenticator, createFinancialAuthenticator, validatePolicy } from './auth.mjs';
import { assertIsolatedEnvironment, verifyDatabaseIdentity } from './runtime.mjs';
import { createGithubApprovalValidator, createGithubResumeValidator } from './approval.mjs';
export { createSqlStore } from './core.mjs';
export { createGithubAuthenticator, createFinancialAuthenticator } from './auth.mjs';
export { createGithubApprovalValidator, createGithubResumeValidator, validateGithubApproval, validateGithubResume } from './approval.mjs';

/** The same request entrypoint runs in an isolated host and disposable database tests. */
export function createCoordinatorHandler({store,authenticateGithub,authenticateFinancial,validateApproval,validateResume}) {
  need(store&&typeof store.request==='function'&&typeof authenticateGithub==='function','COORDINATION_CONFIGURATION_REQUIRED',500);
  return async request=>{
    try {
      need(request.method==='POST','COORDINATION_METHOD_FORBIDDEN',405);
      need(request.headers.get('content-type')?.split(';')[0]==='application/json','COORDINATION_CONTENT_TYPE_REQUIRED',415);
      const declared=request.headers.get('content-length');
      need(!declared||/^[0-9]+$/.test(declared)&&Number(declared)<=262144,'COORDINATION_REQUEST_TOO_LARGE',413);
      const chunks=[];let size=0;const reader=request.body?.getReader();
      if(reader) {try {while(true) {const {value,done}=await reader.read();if(done) break;size+=value.byteLength;
        if(size>262144) {await reader.cancel();throw new CoordinatorError('COORDINATION_REQUEST_TOO_LARGE',413);}chunks.push(value);}}finally{reader.releaseLock();}}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const text=new TextDecoder().decode(bytes);
      let body; try {body=JSON.parse(text);} catch {throw new CoordinatorError('COORDINATION_INVALID_JSON',400);}
      const {action,payload:input}=validateEnvelope(body), payload={...input};
      const authorization=request.headers.get('authorization')??'';
      need(/^Bearer [^\s]+$/.test(authorization),'COORDINATION_AUTHENTICATION_REQUIRED',401);
      const financial=request.headers.get('x-fcos-coordination-adapter')==='financial';
      need(!financial||typeof authenticateFinancial==='function','COORDINATION_FINANCIAL_ADAPTER_DISABLED',403);
      const principal=await (financial?authenticateFinancial:authenticateGithub)(authorization.slice(7));
      need(principal?.kind===(financial?'financial':'github'),'COORDINATION_AUTHENTICATION_REQUIRED',401);
      need(payload.owner.kind===(financial?'financial':'release')&&(!financial||payload.owner.id===principal.ownerId),'COORDINATION_OWNER_MISMATCH',403);
      if(action==='register') {
        need(payload.manifest&&await digest(payload.manifest)===payload.manifestHash,'COORDINATION_MANIFEST_HASH_MISMATCH',400);
        need(payload.manifest.epoch===payload.epoch,'COORDINATION_STALE_EPOCH');
        if(!financial) need(!principal.environment||principal.environment==='fcos-hosted-preview','COORDINATION_REGISTER_BEFORE_APPROVAL_REQUIRED');
      }
      if(action==='approve') {
        need(principal.environment==='fcos-production-release','COORDINATION_APPROVAL_ENVIRONMENT_REQUIRED',403);
        need(!financial&&typeof validateApproval==='function','COORDINATION_APPROVAL_UNAVAILABLE',403);
        await store.request('admitApproval',payload,principal);
        const current=await store.request('snapshot',payload,principal);
        const valid=current.approval&&Date.parse(current.approval.expires_at)>Date.now();
        if(valid) payload.approvalReceipt=current.approval.receipt;
        // Snapshot and final RPC bind immutable registration; network reads hold no DB transaction.
        if(!valid) payload.approvalReceipt=await validateApproval({principal,registration:current.registration,registrationRun:current.registrationRun,manifestHash:payload.manifestHash});
      }
      if(action==='resume') {
        need(!financial&&principal.environment==='fcos-hosted-production-resume'&&typeof validateResume==='function','COORDINATION_RESUME_FORBIDDEN',403);
        const current=await store.request('snapshot',payload,principal);
        need(current.approval&&Date.parse(current.approval.expires_at)>Date.now()&&current.registrationRun,'COORDINATION_RESUME_FORBIDDEN',403);
        payload.resumeReceipt={...await validateResume({principal,registration:current.registration,registrationRun:current.registrationRun,manifestHash:payload.manifestHash}),authorizationEventId:current.approval.authorization_event_id};
      }
      if(['complete','uncertain','readback','appendEvidence','finish'].includes(action)) {
        need(payload.evidence&&typeof payload.evidence==='object'&&!Array.isArray(payload.evidence),'COORDINATION_EVIDENCE_REQUIRED',400);
        payload.evidenceHash=await digest(payload.evidence);
      }
      const result=await store.request(action,payload,principal);
      return Response.json(result,{status:200,headers:{'cache-control':'no-store'}});
    } catch(error) {
      const databaseCode=/^COORDINATION_[A-Z_]+$/.test(error?.message??'')?error.message:null;
      const code=error instanceof CoordinatorError?error.code:databaseCode??'COORDINATION_UNAVAILABLE';
      return Response.json({error:code},{status:error instanceof CoordinatorError?error.status:databaseCode?409:503,headers:{'cache-control':'no-store'}});
    }
  };
}
export function createConfiguredCoordinator({env,query,fetchImpl=globalThis.fetch}) {
  const get=name=>typeof env.get==='function'?env.get(name):env[name];
  let policy; try { policy=JSON.parse(get('FCOS_COORDINATOR_POLICY')); } catch {throw new CoordinatorError('COORDINATION_POLICY_INVALID',500);}
  validatePolicy(policy);
  let financialPolicy; if(get('FCOS_FINANCIAL_COORDINATOR_POLICY')) financialPolicy=JSON.parse(get('FCOS_FINANCIAL_COORDINATOR_POLICY'));
  return createCoordinatorHandler({store:createSqlStore(query),authenticateGithub:createGithubAuthenticator({policy}),
    authenticateFinancial:financialPolicy?createFinancialAuthenticator({policy:financialPolicy}):undefined,
    validateApproval:createGithubApprovalValidator({policy,token:get('FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'),fetchImpl}),
    validateResume:createGithubResumeValidator({policy,token:get('FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'),fetchImpl})});
}
// Deno entrypoint uses only a narrowly privileged DB login and read-only GitHub metadata token.
if(typeof Deno!=='undefined'&&import.meta.main) {
  const connectionString=assertIsolatedEnvironment(Deno.env);
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:10000});
  const query=(sql,values)=>pool.query(sql,values);
  await verifyDatabaseIdentity(query);
  Deno.serve(createConfiguredCoordinator({env:Deno.env,query}));
}
export const supportedActions=ACTIONS;
