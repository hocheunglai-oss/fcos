import { createLegacyContainmentValidator } from './legacy-containment.mjs';
import { ACTIONS, CoordinatorError, createRequestContext, CoordinatorRequestError, createSqlStore, digest, need, validateEnvelope, assertQualificationScope, createMetadataAdmission } from './core.mjs';
import { createGithubAuthenticator, createFinancialAuthenticator, validatePolicy } from './auth.mjs';
import { coordinatorDatabaseOptions, verifyDatabaseIdentity } from './runtime.mjs';
import { createGithubApprovalValidator, createGithubResumeValidator, createGithubQualificationValidator } from './approval.mjs';
export { createSqlStore } from './core.mjs';
export { createGithubAuthenticator, createFinancialAuthenticator } from './auth.mjs';
export { createGithubApprovalValidator, createGithubResumeValidator, validateGithubApproval, validateGithubResume, createGithubQualificationValidator, validateGithubQualification } from './approval.mjs';

/** The same request entrypoint runs in an isolated host and disposable database tests. */
export function createCoordinatorHandler({store,authenticateGithub,authenticateFinancial,validateApproval,validateResume,validateQualification,validateLegacyContainment,admitMetadata,requestContextOptions}) {
  need(store&&typeof store.request==='function'&&typeof authenticateGithub==='function','COORDINATION_CONFIGURATION_REQUIRED',500);
  return async request=>{
    let metadataReservation,bootstrapPendingContext,requestContext;
    try {
      requestContext=createRequestContext(request,requestContextOptions);
      const storeRequest=(stage,action,payload,principal)=>requestContext.run(stage,()=>store.request(action,payload,principal),{storage:true});
      const admissionPending=(action,payload,principal)=>requestContext.run('sql_pending',()=>store.admissionPending(action,payload,principal),{storage:true});
      need(request.method==='POST','COORDINATION_METHOD_FORBIDDEN',405);
      need(request.headers.get('content-type')?.split(';')[0]==='application/json','COORDINATION_CONTENT_TYPE_REQUIRED',415);
      const declared=request.headers.get('content-length');
      need(!declared||/^[0-9]+$/.test(declared)&&Number(declared)<=262144,'COORDINATION_REQUEST_TOO_LARGE',413);
      const chunks=[];let size=0;const reader=request.body?.getReader();
      await requestContext.run('request_body',async()=>{if(reader) {try {while(true) {const {value,done}=await reader.read();if(done) break;size+=value.byteLength;
        if(size>262144) {await reader.cancel();throw new CoordinatorError('COORDINATION_REQUEST_TOO_LARGE',413);}chunks.push(value);}}finally{reader.releaseLock();}}});
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const text=new TextDecoder().decode(bytes);
      let body; try {body=JSON.parse(text);} catch {throw new CoordinatorError('COORDINATION_INVALID_JSON',400);}
      const {action,payload:input}=validateEnvelope(body), payload={...input};
      requestContext.setIdentity(action,await requestContext.run('request_digest',()=>digest(body)));
      const authorization=request.headers.get('authorization')??'';
      need(/^Bearer [^\s]+$/.test(authorization),'COORDINATION_AUTHENTICATION_REQUIRED',401);
      const financial=request.headers.get('x-fcos-coordination-adapter')==='financial';
      need(!financial||typeof authenticateFinancial==='function','COORDINATION_FINANCIAL_ADAPTER_DISABLED',403);
      let principal=await requestContext.run('authenticate',()=>(financial?authenticateFinancial:authenticateGithub)(authorization.slice(7)));
      requestContext.assertActive();
      need(principal?.kind===(financial?'financial':'github'),'COORDINATION_AUTHENTICATION_REQUIRED',401);
      need(payload.owner.kind===(financial?'financial':'release')&&(!financial||payload.owner.id===principal.ownerId),'COORDINATION_OWNER_MISMATCH',403);
      assertQualificationScope(principal,payload,action);
      if(action==='register') {
        need(payload.manifest&&await requestContext.run('manifest_digest',()=>digest(payload.manifest))===payload.manifestHash,'COORDINATION_MANIFEST_HASH_MISMATCH',400);
        need(payload.manifest.epoch===payload.epoch,'COORDINATION_STALE_EPOCH');
        if(!financial) need(!principal.environment||principal.environment==='fcos-hosted-preview','COORDINATION_REGISTER_BEFORE_APPROVAL_REQUIRED');
      }
      let containmentRegistration, consumedPhase=false;
      if(!financial&&['begin','claim'].includes(action)){
        const current=await storeRequest('sql_snapshot','snapshot',payload,principal);
        // A consumed operation is always handled by its original SQL readback path.
        consumedPhase=Boolean(current?.operations?.[payload.phase]);
        if(!consumedPhase&&current?.registration?.manifest?.legacyReleaseContainment)containmentRegistration=current.registration;
      }
      if(!financial&&!consumedPhase&&principal.qualificationOnly===true&&['register','begin','claim'].includes(action)
        &&typeof store.admissionPending==='function')bootstrapPendingContext={action,payload,principal};
      // A definitive pre-storage wait, not a claim or a provider retry. The SQL
      // predicate binds the exact administrator-admitted epoch/source/setup and
      // reviewed containment proofs. Invalid/foreign/revoked inputs never wait.
      if(!financial&&!consumedPhase&&principal.qualificationOnly===true&&['register','begin','claim'].includes(action)
        &&typeof store.admissionPending==='function'&&await admissionPending(action,payload,principal)) {
        const pending=new CoordinatorError('COORDINATION_METADATA_PENDING',429);
        pending.retryAfterSeconds=2;throw pending;
      }
      const qualificationBoundary=!consumedPhase&&principal.qualificationOnly===true&&['register','begin','claim'].includes(action);
      const metadataWeight=(qualificationBoundary?5:!financial&&action==='approve'?8:!financial&&action==='resume'?7:0)+(containmentRegistration?3:0);
      if(metadataWeight)requestContext.assertMetadata();
      if(metadataWeight&&admitMetadata) metadataReservation=await requestContext.run('metadata_admission',()=>admitMetadata({weight:metadataWeight,action,principal}));
      if(qualificationBoundary) {
        need(typeof validateQualification==='function','COORDINATION_QUALIFICATION_VALIDATOR_REQUIRED',403);
        await requestContext.run('qualification',()=>validateQualification({principal,metadataReservation,requestContext}));
      }
      if(containmentRegistration){
        need(typeof validateLegacyContainment==='function','COORDINATION_CONTAINMENT_VALIDATOR_REQUIRED',403);
        principal={...principal,legacyContainmentBoundary:await requestContext.run('containment',()=>validateLegacyContainment({principal,registration:containmentRegistration,manifestHash:payload.manifestHash,metadataReservation,requestContext}))};
      }
      if(action==='approve') {
        need(principal.environment==='fcos-production-release','COORDINATION_APPROVAL_ENVIRONMENT_REQUIRED',403);
        need(!financial&&typeof validateApproval==='function','COORDINATION_APPROVAL_UNAVAILABLE',403);
        await storeRequest('sql_approval_admission','admitApproval',payload,principal);
        const current=await storeRequest('sql_snapshot','snapshot',payload,principal);
        const valid=current.approval&&Date.parse(current.approval.expires_at)>Date.now();
        if(valid) payload.approvalReceipt=current.approval.receipt;
        // Snapshot and final RPC bind immutable registration; network reads hold no DB transaction.
        if(!valid) payload.approvalReceipt=await requestContext.run('approval',()=>validateApproval({principal,registration:current.registration,registrationRun:current.registrationRun,manifestHash:payload.manifestHash,metadataReservation,requestContext}));
      }
      if(action==='resume') {
        need(!financial&&principal.environment==='fcos-hosted-production-resume'&&typeof validateResume==='function','COORDINATION_RESUME_FORBIDDEN',403);
        const current=await storeRequest('sql_snapshot','snapshot',payload,principal);
        need(current.approval&&Date.parse(current.approval.expires_at)>Date.now()&&current.registrationRun,'COORDINATION_RESUME_FORBIDDEN',403);
        payload.resumeReceipt={...await requestContext.run('resume',()=>validateResume({principal,registration:current.registration,registrationRun:current.registrationRun,manifestHash:payload.manifestHash,metadataReservation,requestContext})),authorizationEventId:current.approval.authorization_event_id};
      }
      if(['complete','uncertain','readback','appendEvidence','finish'].includes(action)) {
        need(payload.evidence&&typeof payload.evidence==='object'&&!Array.isArray(payload.evidence),'COORDINATION_EVIDENCE_REQUIRED',400);
        payload.evidenceHash=await requestContext.run('evidence_digest',()=>digest(payload.evidence));
      }
      const result=await storeRequest('sql_dispatch',action,payload,principal);
      return Response.json(result,{status:200,headers:{'cache-control':'no-store'}});
    } catch(error) {
      // The bootstrap can win the singleton lock after the read-only precheck.
      // Only a definitive SQL refusal plus the exact pending tuple may retry.
      if(error?.message==='COORDINATION_BOOTSTRAP_BUSY'&&bootstrapPendingContext) {
        try {
          const {action,payload,principal}=bootstrapPendingContext;
          if(await requestContext.run('sql_pending',()=>store.admissionPending(action,payload,principal),{storage:true})) {
            error=new CoordinatorError('COORDINATION_METADATA_PENDING',429);error.retryAfterSeconds=2;
          }
        } catch(pendingError) {error=pendingError instanceof CoordinatorRequestError?pendingError:new CoordinatorError('COORDINATION_UNAVAILABLE',503);}
      }
      const databaseCode=/^COORDINATION_[A-Z_]+$/.test(error?.message??'')?error.message:null;
      const protocolError=error instanceof CoordinatorError||error instanceof CoordinatorRequestError;
      const code=protocolError?error.code:databaseCode??'COORDINATION_UNAVAILABLE';
      return Response.json({error:code},{status:protocolError?error.status:databaseCode?409:503,headers:{'cache-control':'no-store',
        ...(error instanceof CoordinatorError&&error.code==='COORDINATION_METADATA_PENDING'&&error.status===429?{'retry-after':String(error.retryAfterSeconds)}:{})}});
    } finally {metadataReservation?.finish?.();requestContext?.finish();}
  };
}
export function createConfiguredCoordinator({env,query,fetchImpl=globalThis.fetch,observe=event=>console.info(JSON.stringify(event))}) {
  const get=name=>typeof env.get==='function'?env.get(name):env[name];
  let policy; try { policy=JSON.parse(get('FCOS_COORDINATOR_POLICY')); } catch {throw new CoordinatorError('COORDINATION_POLICY_INVALID',500);}
  validatePolicy(policy);
  let financialPolicy; if(get('FCOS_FINANCIAL_COORDINATOR_POLICY')) financialPolicy=JSON.parse(get('FCOS_FINANCIAL_COORDINATOR_POLICY'));
  const metadataAdmission=createMetadataAdmission();
  return createCoordinatorHandler({requestContextOptions:{observe},store:createSqlStore(query,{bootstrapAdmission:true}),authenticateGithub:createGithubAuthenticator({policy}),
    admitMetadata:({weight})=>metadataAdmission.admit(weight),
    authenticateFinancial:financialPolicy?createFinancialAuthenticator({policy:financialPolicy}):undefined,
    validateLegacyContainment:createLegacyContainmentValidator({policy,token:get('FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'),fetchImpl}),
    validateApproval:createGithubApprovalValidator({policy,token:get('FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'),fetchImpl,metadataAdmission}),
    validateResume:createGithubResumeValidator({policy,token:get('FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'),fetchImpl,metadataAdmission}),
    validateQualification:policy.qualificationAdmission?createGithubQualificationValidator({policy,token:get('FCOS_COORDINATOR_GITHUB_METADATA_TOKEN'),fetchImpl,metadataAdmission}):undefined});
}
// Deno entrypoint uses only a narrowly privileged DB login and read-only GitHub metadata token.
if(typeof Deno!=='undefined'&&import.meta.main) {
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({...coordinatorDatabaseOptions(Deno.env),max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:10000});
  const query=(sql,values)=>pool.query(sql,values);
  await verifyDatabaseIdentity(query);
  Deno.serve(createConfiguredCoordinator({env:Deno.env,query}));
}
export const supportedActions=ACTIONS;
