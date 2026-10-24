import {createHash} from 'node:crypto';
import {fcosConnectionIdentifier} from '../../../config/fcosConnections.js';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&Object.getPrototypeOf(v)===Object.prototype?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex');
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const FILES=['.vercel/output/config.json','.vercel/project.json','vercel.json',...['handler.mjs','connections.mjs','collector.mjs','.vc-config.json','index.mjs'].map(p=>`.vercel/output/functions/api/legacy-runtime-observation.func/${p}`)].sort();
const project=()=>fcosConnectionIdentifier('vercel','Project ID');
const team=()=>fcosConnectionIdentifier('vercel','Team ID');
const environmentValid=e=>exact(e,['id','slug','copyFrom'])&&/^env_[A-Za-z0-9_-]+$/.test(e.id||'')&&/^fcos-legacy-diag-[a-f0-9]{12}$/.test(e.slug||'')&&e.copyFrom==='production';

export function prepareDiagnosticEnvironmentCreate({operationId}={}) {
  need(hash(operationId),'DIAGNOSTIC_ENVIRONMENT_INVALID');
  const url=`https://api.vercel.com/v9/projects/${project()}/custom-environments?teamId=${team()}`;
  const body={slug:`fcos-legacy-diag-${operationId.slice(0,12)}`,description:`Owned FCOS legacy configuration diagnostic ${operationId}`,copyEnvVarsFrom:'production'};
  return {url,body,sha256:digest({url,body}),operationId};
}
export function validateDiagnosticEnvironmentAcknowledgement(value,request) {
  const expected=prepareDiagnosticEnvironmentCreate({operationId:request?.operationId});
  need(request.sha256===expected.sha256&&request.url===expected.url&&digest(request.body)===digest(expected.body),'DIAGNOSTIC_ENVIRONMENT_REQUEST_CHANGED');
  // Vercel's creation response omits these optional association arrays. An
  // acknowledgement establishes the returned ID only; native owner readback
  // must still prove project membership, no domains and Production preservation
  // before a diagnostic deployment. Missing fields never prove absence.
  const optionalEmpty=key=>!Object.hasOwn(value||{},key)||(Array.isArray(value[key])&&value[key].length===0);
  need(value&&/^env_[A-Za-z0-9_-]+$/.test(value.id||'')&&value.slug===request.body.slug&&value.type==='preview'
    &&value.description===request.body.description&&!value.branchMatcher&&optionalEmpty('domains')
    &&optionalEmpty('currentDeploymentAliases'),'DIAGNOSTIC_ENVIRONMENT_ACKNOWLEDGEMENT_INCOMPLETE');
  return {id:value.id,slug:value.slug,copyFrom:'production'};
}

/** Offline request construction only. Caller must still have exact action
 * authority, original lease, final identity reads and durable write intents.
 * Inline files avoid the CLI uploader's implicit retries and extra writes. */
export function prepareLegacyDiagnosticRequest({manifest,files}={}) {
  need(manifest?.schemaVersion===1&&manifest.kind==='fcos_legacy_runtime_diagnostic_build_v1'&&manifest.diagnosticOnly===true&&manifest.baselineAccepted===false
    &&hash(manifest.buildSha256)&&manifest.bindingSha256===digest(manifest.binding)&&manifest.outputSha256===digest(manifest.files)
    &&manifest.binding?.buildSha256===manifest.buildSha256&&manifest.binding.targets?.vercelProject===project()&&manifest.binding.targets?.vercelTeam===team()
    &&manifest.binding.allowQuotaMetadata===false&&environmentValid(manifest.binding.customEnvironment)
    &&manifest.binding.customEnvironment.slug===`fcos-legacy-diag-${manifest.binding.operationId.slice(0,12)}`,'DIAGNOSTIC_REQUEST_BINDING_INVALID');
  need(Array.isArray(files)&&files.length===FILES.length&&files.map(f=>f.path).sort().join('\n')===FILES.join('\n')
    &&Array.isArray(manifest.files)&&manifest.files.map(f=>f.path).sort().join('\n')===FILES.join('\n'),'DIAGNOSTIC_FILES_INVALID');
  for(const f of files){
    const expected=manifest.files.find(r=>r.path===f.path);
    need(Buffer.isBuffer(f.bytes)&&f.bytes.length<=262144&&exact(expected,['path','byteLength','sha256'])
      &&f.bytes.length===expected.byteLength&&digest(f.bytes)===expected.sha256,'DIAGNOSTIC_FILES_CHANGED');
  }
  const read=p=>JSON.parse(files.find(f=>f.path===p).bytes.toString('utf8'));
  const config={version:3,routes:[{src:'^/api/legacy-runtime-observation$',dest:'/api/legacy-runtime-observation'}]};
  need(digest(read('.vercel/output/config.json'))===digest(config)&&digest(read('vercel.json'))===digest({version:2,crons:[]})
    &&digest(read('.vercel/project.json'))===digest({orgId:team(),projectId:project()}),'DIAGNOSTIC_CONFIGURATION_CHANGED');
  const body={version:2,name:'fcos',project:project(),customEnvironmentSlugOrId:manifest.binding.customEnvironment.id,source:'cli',autoAssignCustomDomains:false,crons:[],
    meta:{fcosDiagnosticOperation:manifest.binding.operationId,fcosDiagnosticBuild:manifest.buildSha256},
    files:files.filter(f=>f.path!=='.vercel/project.json').sort((a,b)=>a.path.localeCompare(b.path)).map(f=>({file:f.path,data:f.bytes.toString('base64'),encoding:'base64'}))};
  const url=`https://api.vercel.com/v13/deployments?teamId=${team()}&prebuilt=1`;
  return {url,body,sha256:digest({url,body}),manifestSha256:digest(manifest),operationId:manifest.binding.operationId,buildSha256:manifest.buildSha256,customEnvironment:manifest.binding.customEnvironment};
}

export function validateLegacyDiagnosticAcknowledgement(value,request) {
  need(value&&/^dpl_[A-Za-z0-9]+$/.test(value.id||'')&&value.projectId===project()&&(value.ownerId||value.teamId)===team()
    &&(value.target===null||value.target==='preview')&&value.customEnvironment?.id===request.customEnvironment.id
    &&value.customEnvironment.slug===request.customEnvironment.slug&&/^fcos-[a-z0-9-]+\.vercel\.app$/.test(value.url||'')
    &&value.meta?.fcosDiagnosticOperation===request.operationId&&value.meta.fcosDiagnosticBuild===request.buildSha256
    &&Array.isArray(value.alias)&&value.alias.length===0&&!value.aliasAssigned&&!value.aliasError,'DIAGNOSTIC_ACKNOWLEDGEMENT_INCOMPLETE');
  return {id:value.id,url:`https://${value.url}`,target:value.target,projectId:value.projectId,teamId:value.ownerId||value.teamId,
    operationId:request.operationId,buildSha256:request.buildSha256,customEnvironment:request.customEnvironment};
}

/** Exactly one native HTTP attempt. The reviewed guard must call this only
 * from its single provider callback. A lost/invalid acknowledgement is unknown,
 * including HTTP rejection: this function never retries or clears a lease. */
export async function submitLegacyDiagnosticOnce({request,expectedRequestSha256,token,fetchImpl=fetch}={}) {
  need(request?.url===`https://api.vercel.com/v13/deployments?teamId=${team()}&prebuilt=1`&&hash(request.sha256)
    &&request.sha256===expectedRequestSha256&&digest({url:request.url,body:request.body})===request.sha256
    &&exact(request.body,['version','name','project','customEnvironmentSlugOrId','source','autoAssignCustomDomains','crons','meta','files'])
    &&request.body.version===2&&request.body.name==='fcos'&&request.body.project===project()&&environmentValid(request.customEnvironment)
    &&request.body.customEnvironmentSlugOrId===request.customEnvironment.id
    &&request.body.source==='cli'&&request.body.autoAssignCustomDomains===false&&Array.isArray(request.body.crons)&&request.body.crons.length===0
    &&exact(request.body.meta,['fcosDiagnosticOperation','fcosDiagnosticBuild'])&&hash(request.body.meta.fcosDiagnosticOperation)&&hash(request.body.meta.fcosDiagnosticBuild)
    &&request.body.meta.fcosDiagnosticOperation===request.operationId&&request.body.meta.fcosDiagnosticBuild===request.buildSha256
    &&Array.isArray(request.body.files)&&request.body.files.length===FILES.length-1
    &&request.body.files.map(f=>f.file).sort().join('\n')===FILES.filter(p=>p!=='.vercel/project.json').join('\n')
    &&request.body.files.every(f=>exact(f,['file','data','encoding'])&&f.encoding==='base64'&&typeof f.data==='string'&&f.data.length<=350000
      &&Buffer.from(f.data,'base64').toString('base64')===f.data)
    &&typeof token==='string'&&token.length>0,'DIAGNOSTIC_SUBMISSION_INVALID');
  try {
    const response=await fetchImpl(request.url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      body:JSON.stringify(request.body),redirect:'error',signal:AbortSignal.timeout(30000)});
    need(response.ok&&!response.redirected&&(!response.url||response.url===request.url),'DIAGNOSTIC_SUBMISSION_UNCERTAIN');
    const raw=await response.text();need(Buffer.byteLength(raw)<=1048576,'DIAGNOSTIC_SUBMISSION_UNCERTAIN');
    return validateLegacyDiagnosticAcknowledgement(JSON.parse(raw),request);
  } catch {throw Object.assign(Error('DIAGNOSTIC_SUBMISSION_UNCERTAIN'),{code:'DIAGNOSTIC_SUBMISSION_UNCERTAIN',getOnly:true,noReplay:true});}
}

/** Preserve metadata provenance honestly. Matching record identities/times are
 * an inference about old settings, never equality proof for opaque values. */
export function unchangedLegacyDiagnosticConfiguration({before,after,previousCreatedAt}={}) {
  const normalize=rows=>{
    need(Array.isArray(rows)&&rows.length===58&&new Set(rows.map(r=>r.id)).size===58&&new Set(rows.map(r=>r.key)).size===58,'DIAGNOSTIC_CONFIGURATION_RECORDS_CHANGED');
    return rows.map(r=>{
      need(exact(r,['id','key','target','gitBranch','createdAt','updatedAt'])&&typeof r.id==='string'&&/^[A-Z][A-Z0-9_]*$/.test(r.key)
        &&Array.isArray(r.target)&&r.target.includes('production')&&r.target.every(t=>['production','preview','development'].includes(t))&&r.gitBranch===null
        &&Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.updatedAt)&&r.createdAt>0&&r.createdAt<=r.updatedAt&&r.updatedAt<=previousCreatedAt,'DIAGNOSTIC_CONFIGURATION_RECORDS_CHANGED');
      return {...r,target:[...r.target].sort()};
    }).sort((a,b)=>a.id.localeCompare(b.id));
  };
  need(Number.isSafeInteger(previousCreatedAt)&&previousCreatedAt>0,'DIAGNOSTIC_CONFIGURATION_RECORDS_CHANGED');
  const a=normalize(before),b=normalize(after);need(digest(a)===digest(b),'DIAGNOSTIC_CONFIGURATION_RECORDS_CHANGED');
  return {kind:'unchanged_project_records_metadata_only_inference',sha256:digest(a),recordCount:a.length,originalValueEqualityProven:false};
}

/** This does not install credentials in another service: Vercel performs the
 * copy internally. Exact copy/storage scope still requires human authority. */
export async function submitDiagnosticEnvironmentOnce({request,expectedRequestSha256,token,fetchImpl=fetch}={}) {
  const expected=prepareDiagnosticEnvironmentCreate({operationId:request?.operationId});
  need(request.sha256===expectedRequestSha256&&request.sha256===expected.sha256&&digest(request.body)===digest(expected.body)&&request.url===expected.url
    &&typeof token==='string'&&token.length>0,'DIAGNOSTIC_ENVIRONMENT_SUBMISSION_INVALID');
  try {
    const response=await fetchImpl(request.url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(request.body),redirect:'error',signal:AbortSignal.timeout(30000)});
    need(response.ok&&!response.redirected&&(!response.url||response.url===request.url),'DIAGNOSTIC_ENVIRONMENT_SUBMISSION_UNCERTAIN');
    const raw=await response.text();need(Buffer.byteLength(raw)<=65536,'DIAGNOSTIC_ENVIRONMENT_SUBMISSION_UNCERTAIN');
    return validateDiagnosticEnvironmentAcknowledgement(JSON.parse(raw),request);
  }catch{throw Object.assign(Error('DIAGNOSTIC_ENVIRONMENT_SUBMISSION_UNCERTAIN'),{code:'DIAGNOSTIC_ENVIRONMENT_SUBMISSION_UNCERTAIN',getOnly:true,noReplay:true});}
}

/** No broad "delete unassigned variables" option. Delete only positively new,
 * owned records assigned exclusively to this custom environment, then remove
 * the owned environment. A missing/foreign/shared record stops cleanup. */
export function prepareDiagnosticCleanup({environment,beforeVariableIds,ownedVariables,expectedRecordKeys,deployment,noDeploymentSubmission,operationId}={}) {
  need(environmentValid(environment)&&hash(operationId)&&environment.slug===`fcos-legacy-diag-${operationId.slice(0,12)}`
    &&Array.isArray(beforeVariableIds)&&beforeVariableIds.every(x=>typeof x==='string')&&new Set(beforeVariableIds).size===beforeVariableIds.length
    &&Array.isArray(expectedRecordKeys)&&expectedRecordKeys.length===58&&new Set(expectedRecordKeys).size===58&&expectedRecordKeys.every(k=>/^[A-Z][A-Z0-9_]*$/.test(k))
    &&Array.isArray(ownedVariables)&&ownedVariables.length<=58&&new Set(ownedVariables.map(r=>r.id)).size===ownedVariables.length,'DIAGNOSTIC_CLEANUP_OWNERSHIP_REQUIRED');
  for(const row of ownedVariables)need(exact(row,['id','key','target','customEnvironmentIds'])&&typeof row.id==='string'&&row.id.length>0&&!beforeVariableIds.includes(row.id)
    &&expectedRecordKeys.includes(row.key)&&Array.isArray(row.target)&&row.target.length===0&&Array.isArray(row.customEnvironmentIds)
    &&row.customEnvironmentIds.length===1&&row.customEnvironmentIds[0]===environment.id,'DIAGNOSTIC_CLEANUP_OWNERSHIP_REQUIRED');
  need(new Set(ownedVariables.map(r=>r.key)).size===ownedVariables.length,'DIAGNOSTIC_CLEANUP_OWNERSHIP_REQUIRED');
  if(deployment)need(!noDeploymentSubmission&&/^dpl_[A-Za-z0-9]+$/.test(deployment.id||'')&&deployment.projectId===project()
    &&deployment.customEnvironment?.id===environment.id&&deployment.operationId===operationId&&(deployment.target===null||deployment.target==='preview'),'DIAGNOSTIC_CLEANUP_OWNERSHIP_REQUIRED');
  else need(exact(noDeploymentSubmission,['kind','operationId','providerSubmissionStarted','durableIntentSha256','rootAcceptanceSha256'])
    &&noDeploymentSubmission.kind==='root_reviewed_no_diagnostic_deployment_submission_v1'&&noDeploymentSubmission.operationId===operationId
    &&noDeploymentSubmission.providerSubmissionStarted===false&&hash(noDeploymentSubmission.durableIntentSha256)&&hash(noDeploymentSubmission.rootAcceptanceSha256),
    'DIAGNOSTIC_CLEANUP_NO_SUBMISSION_PROOF_REQUIRED');
  const base=`https://api.vercel.com/v9/projects/${project()}`;
  const actions=deployment?[{method:'DELETE',url:`https://api.vercel.com/v13/deployments/${deployment.id}?teamId=${team()}`}]:[];
  for(const row of [...ownedVariables].sort((a,b)=>a.id.localeCompare(b.id)))actions.push({method:'DELETE',url:`${base}/env/${encodeURIComponent(row.id)}?teamId=${team()}`});
  actions.push({method:'DELETE',url:`${base}/custom-environments/${environment.id}?teamId=${team()}`,body:{deleteUnassignedEnvironmentVariables:false}});
  return {operationId,environment,actions,sha256:digest(actions),authorityGranted:false};
}

export function assertDiagnosticProductionPreservation({before,after}={}) {
  const valid=x=>exact(x,['deploymentId','aliasSha256','cronSha256','environmentMetadataSha256'])&&/^dpl_[A-Za-z0-9]+$/.test(x.deploymentId||'')
    &&['aliasSha256','cronSha256','environmentMetadataSha256'].every(k=>hash(x[k]));
  need(valid(before)&&valid(after)&&digest(before)===digest(after),'DIAGNOSTIC_PRODUCTION_PRESERVATION_CHANGED');
  return {unchanged:true,sha256:digest(before)};
}
