import {createHash,timingSafeEqual} from 'node:crypto';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&Object.getPrototypeOf(v)===Object.prototype?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const diagnosticDigest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(canonical(v))).digest('hex');
const need=(v,code='DIAGNOSTIC_BINDING_INVALID')=>{if(!v)throw Error(code);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&Buffer.from(v,'base64url').length===32&&Buffer.from(v,'base64url').toString('base64url')===v;
const names=v=>Array.isArray(v)&&v.length<=512&&new Set(v).size===v.length&&v.every(k=>/^[A-Z][A-Z0-9_]{0,127}$/.test(k));

/** Compiled public binding, not a release manifest or a legacy-runtime receipt.
 * The builder supplies exact immutable source and independently read metadata.
 * This validator makes no claim that metadata came from a provider. */
export function validateDiagnosticBinding(b) {
  need(b?.schemaVersion===1&&b.kind==='fcos_legacy_runtime_diagnostic_binding_v1'&&hash(b.operationId)&&/^[a-f0-9]{40}$/.test(b.controllerSha||'')
    &&/^[a-f0-9]{40}$/.test(b.candidateSha||'')&&b.previous&&hash(b.previous.sourceSha256)&&Number.isSafeInteger(b.previous.createdAt)
    &&b.targets?.vercelProject&&b.targets?.vercelTeam&&b.targets?.supabaseProject&&b.targets?.salesforceOrigin&&b.targets?.salesforceOrg
    &&Number.isSafeInteger(b.issuedAt)&&b.issuedAt>0&&Number.isSafeInteger(b.notAfter)&&b.notAfter>b.issuedAt&&b.notAfter-b.issuedAt<=86400000
    &&b.customEnvironment&&Object.keys(b.customEnvironment).sort().join(',')==='copyFrom,id,slug'&&/^[A-Za-z0-9_-]{1,128}$/.test(b.customEnvironment.id||'')
    &&b.customEnvironment.slug===`fcos-legacy-diag-${b.operationId.slice(0,12)}`&&b.customEnvironment.copyFrom==='production'
    &&b.allowQuotaMetadata===false&&names(b.projectRecordKeys)&&b.projectRecordKeys.length===58&&names(b.legacyEnvironmentKeys)&&b.legacyEnvironmentKeys.length===190
    &&names(b.dependencyKeys)&&names(b.absentDependencies)&&b.absentDependencies.every(k=>b.dependencyKeys.includes(k)&&!b.legacyEnvironmentKeys.includes(k))
    &&b.projectRecordKeys.every(k=>b.legacyEnvironmentKeys.includes(k))&&b.dependencyKeys.every(k=>b.projectRecordKeys.includes(k)||k==='VERCEL_ENV'||b.absentDependencies.includes(k))
    &&hash(b.projectRecordsSha256)&&hash(b.source?.helperRevision)&&hash(b.source?.declarationsSha256)&&hash(b.source?.collectorSha256)&&hash(b.source?.dependencySha256)
    &&hash(b.buildSha256));
  return b;
}

/** This fixed network seam deliberately denies Xero until reviewed shared quota
 * admission exists. A GET is not a quota exemption. No SDK or token-store read
 * is necessary to report that required authentication honestly as unknown. */
export function diagnosticReadonlyFetch({binding,privateEnvironment,fetchImpl=globalThis.fetch,now=Date.now}) {
  const supabase=`https://${binding.targets.supabaseProject}.supabase.co/rest/v1/user_profiles?select=id&limit=1`;
  const version=/^v\d+\.\d+$/.test(privateEnvironment.SALESFORCE_API_VERSION||'')?privateEnvironment.SALESFORCE_API_VERSION:'v67.0';
  const salesforce=`${binding.targets.salesforceOrigin}/services/data/${version}/query?q=${encodeURIComponent('SELECT Id, IsSandbox FROM Organization LIMIT 1')}`;
  const seen=new Set();
  return async (url,options={})=>{
    need(now()>=binding.issuedAt&&now()<binding.notAfter&&typeof url==='string'&&[supabase,salesforce].includes(url)&&options.method==='GET'&&options.redirect==='error'
      &&options.body===undefined&&!seen.has(url),'DIAGNOSTIC_NETWORK_DENIED');
    const headers=options.headers;
    need(headers&&Object.getPrototypeOf(headers)===Object.prototype,'DIAGNOSTIC_NETWORK_DENIED');
    if(url===supabase){
      const key=String(privateEnvironment.SUPABASE_SECRET_KEY||'').trim()||String(privateEnvironment.SUPABASE_SERVICE_ROLE_KEY||'').trim();
      need(key&&headers.apikey===key&&Object.keys(headers).every(k=>['apikey','authorization'].includes(k))
        &&(!Object.hasOwn(headers,'authorization')||headers.authorization===`Bearer ${key}`),'DIAGNOSTIC_NETWORK_DENIED');
    } else need(privateEnvironment.SALESFORCE_INSTANCE_URL===binding.targets.salesforceOrigin&&privateEnvironment.SALESFORCE_ACCESS_TOKEN
      &&Object.keys(headers).length===1&&headers.authorization===`Bearer ${privateEnvironment.SALESFORCE_ACCESS_TOKEN}`,'DIAGNOSTIC_NETWORK_DENIED');
    seen.add(url);
    const r=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(5000)});
    need(!r.redirected&&(!r.url||r.url===url),'DIAGNOSTIC_NETWORK_DENIED');
    // The collector sees only its exact boolean/identity response, never an
    // unbounded provider body or a diagnostic message containing credentials.
    let body;
    return {ok:r.ok,status:r.status,url:r.url,redirected:false,json:async()=>{
      if(body!==undefined)return body;
      need(r.body?.getReader,'DIAGNOSTIC_NETWORK_RESPONSE_INVALID');const reader=r.body.getReader();let size=0;const chunks=[];
      try{for(;;){const row=await reader.read();if(row.done)break;size+=row.value.length;need(size<=65536,'DIAGNOSTIC_NETWORK_RESPONSE_INVALID');chunks.push(Buffer.from(row.value));}}
      finally{await reader.cancel().catch(()=>{});}
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(url===supabase)need(Array.isArray(body)&&body.length<=1&&body.every(row=>row&&Object.keys(row).every(k=>k==='id')),'DIAGNOSTIC_NETWORK_RESPONSE_INVALID');
      else need(body&&Array.isArray(body.records)&&body.records.length<=1&&body.records.every(row=>row&&Object.keys(row).every(k=>['attributes','Id','IsSandbox'].includes(k))),'DIAGNOSTIC_NETWORK_RESPONSE_INVALID');
      return body;
    }};
  };
}

/** Runtime factory. Only the private ephemeral capability authorizes a caller;
 * Deployment Protection is an additional independent outer boundary. */
export function createLegacyRuntimeDiagnosticHandler({binding,capabilitySha256,collectRuntime,environment=()=>process.env,fetchImpl=globalThis.fetch,now=Date.now}) {
  validateDiagnosticBinding(binding);need(hash(capabilitySha256)&&typeof collectRuntime==='function');
  const expected=Buffer.from(capabilitySha256,'hex');
  return async (req,res)=>{
    const finish=(status,value)=>{res.statusCode=status;res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(value));};
    const denied=()=>finish(404,{error:'NOT_FOUND'});
    let authorized=false;
    try{
      const secret=req.headers?.['x-fcos-legacy-diagnostic-capability'],challenge=req.headers?.['x-fcos-diagnostic-challenge'];
      if(!opaque(secret)||!opaque(challenge)||!timingSafeEqual(createHash('sha256').update(secret).digest(),expected))return denied();
      const at=now(),env=environment();
      if(req.method!=='GET'||req.url!=='/api/legacy-runtime-observation'||req.headers['transfer-encoding']||req.headers['content-length']&&req.headers['content-length']!=='0'
        ||at<binding.issuedAt||at>=binding.notAfter||env.VERCEL_ENV!=='preview'||env.VERCEL_PROJECT_ID!==binding.targets.vercelProject
        ||typeof env.VERCEL_URL!=='string'||!/^fcos-[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL)||req.headers.host!==env.VERCEL_URL
        ||env.VERCEL_TARGET_ENV!==binding.customEnvironment.slug)return denied();
      authorized=true;
      const present=binding.projectRecordKeys.filter(k=>Object.hasOwn(env,k)&&typeof env[k]==='string');
      need(present.length===binding.projectRecordKeys.length&&binding.absentDependencies.every(k=>!Object.hasOwn(env,k)),'DIAGNOSTIC_CONFIGURATION_INCOMPLETE');
      const privateEnvironment=Object.fromEntries(present.map(k=>[k,env[k]]));
      // The physical custom environment is preview. This explicitly evaluates
      // copied application settings using the immutable Production interpreter.
      privateEnvironment.VERCEL_ENV='production';
      const readonly=diagnosticReadonlyFetch({binding,privateEnvironment,fetchImpl,now});
      const runtime=await collectRuntime({deployment:{id:binding.previous.deploymentId,sha:binding.previous.sha,url:binding.previous.url},privateEnvironment,
        baseline:{sha:binding.previous.sha,helperSourceVerified:true},fetchImpl:readonly,now:at,
        clientFactory:()=>{throw Error('DIAGNOSTIC_XERO_SHARED_ADMISSION_REQUIRED');}});
      need(now()<binding.notAfter,'DIAGNOSTIC_EXPIRED');
      need(runtime.auth?.xero?.state==='unknown'&&typeof runtime.auth.xero.target==='string'&&(!runtime.auth.xero.target||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runtime.auth.xero.target)),
        'DIAGNOSTIC_XERO_SHARED_ADMISSION_REQUIRED');
      // Legacy deploymentId/sha in the old evaluator are intentionally dropped.
      // This is evaluation in the new diagnostic, never execution in legacy.
      return finish(200,{schemaVersion:1,kind:'fcos_legacy_runtime_diagnostic_observation_v1',status:'observed',diagnosticOnly:true,baselineAccepted:false,
        authority:{financialWrites:false,salesforceWrites:false,quotaMetadataWrites:false,secretExport:false},operationId:binding.operationId,challenge,
        issuedAt:binding.issuedAt,notAfter:binding.notAfter,capturedAt:runtime.capturedAt,buildSha256:binding.buildSha256,bindingSha256:diagnosticDigest(binding),
        diagnostic:{origin:`https://${env.VERCEL_URL}`,projectId:env.VERCEL_PROJECT_ID,target:env.VERCEL_ENV,targetEnvironment:env.VERCEL_TARGET_ENV,customEnvironment:binding.customEnvironment,
          deploymentId:typeof env.VERCEL_DEPLOYMENT_ID==='string'&&/^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID)?env.VERCEL_DEPLOYMENT_ID:null},
        evaluationContext:{physicalVercelEnv:env.VERCEL_ENV,physicalTargetEnvironment:env.VERCEL_TARGET_ENV,interpretedVercelEnv:'production',copyFrom:'production'},
        evaluatedLegacy:binding.previous,candidateSha:binding.candidateSha,controllerSha:binding.controllerSha,source:binding.source,
        configuration:{kind:'copied_current_production_configuration_with_metadata_only_legacy_inference',complete:true,projectRecordsSha256:binding.projectRecordsSha256,
          projectRecordKeys:binding.projectRecordKeys,legacyEnvironmentKeys:binding.legacyEnvironmentKeys,dependencyKeys:binding.dependencyKeys,absentDependencies:binding.absentDependencies,
          valuesSha256:diagnosticDigest(privateEnvironment)},runtime:{flags:runtime.flags,safety:runtime.safety,auth:runtime.auth},
        dependencies:['required_xero_authentication_needs_existing_shared_quota_admission']});
    }catch{return authorized?finish(503,{schemaVersion:1,kind:'fcos_legacy_runtime_diagnostic_failure_v1',status:'incomplete',diagnosticOnly:true,code:'DIAGNOSTIC_OBSERVATION_INCOMPLETE'}):denied();}
  };
}
