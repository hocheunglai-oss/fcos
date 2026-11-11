import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, git, isSha, isDigest, requireCondition as check, targets } from './contract.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { MANAGED_DATABASE_ROLE_SQL, isManagedDatabaseRole } from './database-connection.mjs';

const ENVIRONMENT = 'fcos-database-auth-journal-v1', KIND = 'fcos_native_database_auth';
const STATE_KIND = 'fcos_native_database_auth_state', REF = 'refs/heads/codex/rapid-database-auth-journal';
const ISSUER = 'https://api.supabase.com', ROLE = 'cli_login_postgres';
export const DATABASE_SCOPE_EVIDENCE_ENVIRONMENT = 'fcos-database-auth-scope-evidence-v1';
export const DATABASE_UNSUBMITTED_EVIDENCE_ENVIRONMENT = 'fcos-database-auth-unsubmitted-evidence-v1';
// Metadata only. Include every CLI login, including a provider-created unique role.
export const DATABASE_AUTH_RECONCILIATION_SQL = MANAGED_DATABASE_ROLE_SQL.replace("r.rolname='cli_login_postgres'", "starts_with(r.rolname,'cli_login') order by r.rolname");
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value > 0;
const purposeValid = value => typeof value === 'string' && /^[a-z_]{8,64}$/.test(value);
const idValid = value => /^fcos-db-auth-[a-f0-9-]{36}$/.test(value || '');
const same = (a, b) => canonical(a) === canonical(b);
// Git commit APIs may retain the conventional final line feed. No other
// noncanonical message content is accepted as journal state.
const messageText = row => typeof row.message==='string' ? row.message.replace(/\n$/,'') : null;
const binding = value => ({ intentId:value.intentId,requestDigest:value.requestDigest,sourceSha:value.sourceSha,purpose:value.purpose,actorId:value.actorId });
const pendingKeys = ['schemaVersion','kind','phase','intentId','requestDigest','sourceSha','purpose','actorId','request','preflightDigest','claimedAtMs','parentSha','treeSha'];
const recordKeys = ['intentId','requestDigest','sourceSha','purpose','actorId','event','claimCommitSha','claimDigest','observedAt'];

function requestValid(request) {
  if (!exact(request, ['operation','issuer','projectRef','organizationId','host','port','database','role','method','path','body','requestDigest'])) return false;
  const {requestDigest,...body}=request;
  return request.operation==='supabase_cli_login_role' && request.issuer===ISSUER && request.projectRef===targets().supabaseProject
    && /^[a-z0-9]{20}$/.test(request.organizationId) && request.host===fcosConnectionIdentifier('supabase','Database session host')
    && request.port===5432 && request.database==='postgres' && request.role===ROLE && request.method==='POST'
    && request.path===`/v1/projects/${targets().supabaseProject}/cli/login-role`
    && exact(request.body,['read_only']) && request.body.read_only===false && isDigest(requestDigest) && digest(body)===requestDigest;
}
function pendingValid(value, actorId) {
  return exact(value,pendingKeys) && value.schemaVersion===1 && value.kind===STATE_KIND && value.phase==='pending'
    && idValid(value.intentId) && isDigest(value.requestDigest) && isSha(value.sourceSha) && purposeValid(value.purpose)
    && value.actorId===actorId && requestValid(value.request) && value.requestDigest===value.request.requestDigest
    && isDigest(value.preflightDigest) && integer(value.claimedAtMs) && isSha(value.parentSha) && isSha(value.treeSha);
}
function receiptValid(receipt, claim) {
  return exact(receipt,['intentId','requestDigest','outcome','issuer','projectRef','role','ttlSeconds','issuedAtMs','expiresAtMs'])
    && receipt.intentId===claim.intentId && receipt.requestDigest===claim.requestDigest && receipt.outcome==='received'
    && receipt.issuer===ISSUER && receipt.projectRef===targets().supabaseProject && receipt.role===ROLE
    && integer(receipt.ttlSeconds) && receipt.ttlSeconds<=3600 && integer(receipt.issuedAtMs) && integer(receipt.expiresAtMs)
    && receipt.issuedAtMs>=claim.claimedAtMs && receipt.issuedAtMs-claim.claimedAtMs<=60000
    && receipt.expiresAtMs===receipt.issuedAtMs+receipt.ttlSeconds*1000;
}
function terminalReceiptValid(receipt, claim) {
  const common=['intentId','requestDigest','outcome','issuer','projectRef','observedAtMs'];
  if (!receipt || receipt.intentId!==claim.intentId || receipt.requestDigest!==claim.requestDigest || receipt.issuer!==ISSUER
    || receipt.projectRef!==targets().supabaseProject || !integer(receipt.observedAtMs) || receipt.observedAtMs<claim.claimedAtMs) return false;
  if(receipt.outcome==='rejected') return exact(receipt,[...common,'httpStatus']) && [401,403].includes(receipt.httpStatus);
  return ['denied_by_scope','unsubmitted'].includes(receipt.outcome)
    && exact(receipt,[...common,'httpOutcome','evidenceDeploymentId','evidenceDigest','roleReadbackDigest','reconciliationSourceSha'])
    && receipt.httpOutcome==='unobserved' && integer(receipt.evidenceDeploymentId) && isDigest(receipt.evidenceDigest)
    && isDigest(receipt.roleReadbackDigest) && isSha(receipt.reconciliationSourceSha);
}
function scopeObservationValid(p, claim, claimCommitSha, sourceSha, now) {
  return exact(p,['schemaVersion','kind','provenance','intentId','requestDigest','claimCommitSha','claimDigest','originalSourceSha','reconciliationSourceSha','projectRef','organizationId','observedAt','evidenceDigest','token'])
    && p.schemaVersion===1 && p.kind==='fcos_database_auth_scope_observation' && p.provenance==='owner_attested_native_dashboard'
    && p.intentId===claim.intentId && p.requestDigest===claim.requestDigest && p.claimCommitSha===claimCommitSha && p.claimDigest===digest(claim)
    && p.originalSourceSha===claim.sourceSha && p.reconciliationSourceSha===sourceSha && p.projectRef===claim.request.projectRef
    && p.organizationId===claim.request.organizationId && isDigest(p.evidenceDigest)
    && typeof p.observedAt==='string' && Number.isFinite(Date.parse(p.observedAt)) && new Date(Date.parse(p.observedAt)).toISOString()===p.observedAt
    && Date.parse(p.observedAt)>=claim.claimedAtMs && now>=Date.parse(p.observedAt) && now-Date.parse(p.observedAt)<=86400000
    && exact(p.token,['name','existence','credentialHistory','projectRefs','permissions','scopeHistory','originalCredentialMatch'])
    && typeof p.token.name==='string' && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(p.token.name)
    && p.token.existence==='verified_at_original_request' && p.token.credentialHistory==='unchanged_since_original_request'
    && same(p.token.projectRefs,[targets().supabaseProject]) && same(p.token.permissions,['database_read','project_settings_read'])
    && p.token.scopeHistory==='immutable_since_creation' && p.token.originalCredentialMatch==='private_keychain_mask_match';
}
function unsubmittedObservationValid(p, claim, claimCommitSha, sourceSha, now) {
  const keys=['schemaVersion','kind','provenance','intentId','requestDigest','claimCommitSha','claimDigest',
    'originalSourceSha','reconciliationSourceSha','projectRef','organizationId','observedAt','evidenceDigest','roleExpiresAtMs'];
  const observed=Date.parse(p?.observedAt);
  return exact(p,keys) && p.schemaVersion===1 && p.kind==='fcos_database_auth_unsubmitted_observation'
    && p.provenance==='owner_attested_terminal_before_intent'
    && p.intentId===claim.intentId && p.requestDigest===claim.requestDigest && p.claimCommitSha===claimCommitSha
    && p.claimDigest===digest(claim) && p.originalSourceSha===claim.sourceSha && p.reconciliationSourceSha===sourceSha
    && p.projectRef===claim.request.projectRef && p.organizationId===claim.request.organizationId && isDigest(p.evidenceDigest)
    && integer(p.roleExpiresAtMs) && p.roleExpiresAtMs<claim.claimedAtMs
    && Number.isFinite(observed) && new Date(observed).toISOString()===p.observedAt
    && observed>=claim.claimedAtMs && now>=observed && now-observed<=86400000;
}
const terminalRecordFields = event => [...recordKeys,'receipt',...(event==='unsubmitted'?['claim']:[])];

function preflightValid(value) {
  const roleKeys=['session_user','current_user','database','read_only','server_now_ms','login_role','can_login','is_superuser','inherits',
    'creates_roles','creates_databases','replicates','bypasses_rls','role_valid_until_ms','memberships'];
  return exact(value,['projectRef','observedAtMs','role']) && value.projectRef===targets().supabaseProject && integer(value.observedAtMs)
    && exact(value.role,roleKeys) && value.role.session_user==='supabase_read_only_user' && value.role.current_user==='supabase_read_only_user'
    && value.role.database==='postgres' && value.role.read_only==='on' && Number.isFinite(value.role.server_now_ms)
    && (value.role.role_valid_until_ms===null || Number.isFinite(value.role.role_valid_until_ms))
    && isManagedDatabaseRole(value.role) && exact(value.role.memberships[0],['role','grantor','set','inherit','admin']);
}
async function boundedJson(response) {
  check(response.body?.getReader,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');
  const reader=response.body.getReader(),chunks=[];let size=0,bytes;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    check(size<=16384,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');chunks.push(Buffer.from(part.value));}
    bytes=Buffer.concat(chunks);try{return JSON.parse(bytes.toString('utf8'));}catch{throw Error('DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');}
  }finally{chunks.forEach(chunk=>chunk.fill(0));bytes?.fill(0);try{await reader.cancel();}catch{/* Fixed codes only. */}}
}

// Owner-only local bootstrap/protected handover. No ordinary GITHUB_TOKEN fallback.
// The fixed Git branch is an append-only CAS ledger, never executable input.
export async function createDatabaseCredentialIntentStore({credential,directory,source,purpose,github,fetchImpl=fetch,now=Date.now}) {
  check(credential?.kind==='supabase_management' && typeof credential.token==='string' && typeof directory==='string'
    && isSha(source?.sha) && purposeValid(purpose),'DATABASE_AUTH_CONTEXT_REQUIRED');
  check(git(directory,['rev-parse','HEAD'])===source.sha && !git(directory,['status','--porcelain','--untracked-files=no']), 'DATABASE_AUTH_FROZEN_SOURCE_REQUIRED');
  if(!github){const token=process.env.FCOS_RAPID_HANDOVER_GITHUB_TOKEN || process.env.FCOS_RELEASE_GH_TOKEN;
    check(process.env.GITHUB_ACTIONS==='true' && typeof token==='string' && token.length>10,'DATABASE_AUTH_OWNER_GITHUB_REQUIRED');
    const {githubClient}=await import('./providers.mjs');github=githubClient({token});}
  check(['read','pages','write','patch'].every(name=>typeof github[name]==='function'),'DATABASE_AUTH_NATIVE_CAS_REQUIRED');
  const base=`/repos/${targets().repository}`,refPath=`${base}/git/refs/${REF.slice(5)}`;
  const read=async path=>{try{return await github.read(path);}catch{throw Error('DATABASE_AUTH_NATIVE_READ_UNAVAILABLE');}};
  const [repository,actor]=await Promise.all([read(base),read('/user')]);
  check(repository?.full_name===targets().repository && !repository.archived && repository.permissions?.push===true
    && actor?.login===targets().account && integer(actor.id),'DATABASE_AUTH_OWNER_GITHUB_REQUIRED');
  const output=join(directory,'outputs','rapid-database-credentials');mkdirSync(output,{recursive:true,mode:0o700});
  const persist=record=>{const file=join(output,`${record.intentId}-${record.event}.json`);
    const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{const bytes=Buffer.from(`${canonical(record)}\n`);let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);}finally{closeSync(fd);}
    const parent=openSync(output,constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}};
  const sourceTrees=new Map();
  const commit=async sha=>{check(isSha(sha),'DATABASE_AUTH_NATIVE_COMMIT_INVALID');const row=await read(`${base}/git/commits/${sha}`);
    check(row?.sha===sha && isSha(row.tree?.sha) && Array.isArray(row.parents),'DATABASE_AUTH_NATIVE_COMMIT_INVALID');return row;};
  const sourceTree=async sha=>{if(!sourceTrees.has(sha))sourceTrees.set(sha,(await commit(sha)).tree.sha);return sourceTrees.get(sha);};
  const parseState=async row=>{let state;try{check(typeof row.message==='string' && row.message.length<=32768,'DATABASE_AUTH_NATIVE_STATE_INVALID');state=JSON.parse(row.message);}catch{throw Error('DATABASE_AUTH_NATIVE_STATE_INVALID');}
    check(state && Object.getPrototypeOf(state)===Object.prototype && canonical(state)===messageText(row),'DATABASE_AUTH_NATIVE_STATE_INVALID');
    const pending=state.phase==='pending'?state:state.pending;
    check(pendingValid(pending,actor.id) && row.tree.sha===pending.treeSha && await sourceTree(pending.sourceSha)===pending.treeSha,'DATABASE_AUTH_NATIVE_STATE_INVALID');
    if(state.phase==='pending')check(row.parents.length===1 && row.parents[0]?.sha===pending.parentSha,'DATABASE_AUTH_NATIVE_STATE_INVALID');
    else if(state.phase==='received') check(exact(state,['schemaVersion','kind','phase','pending','claimCommitSha','receipt','receivedDeploymentId','recordDigest'])
      && state.schemaVersion===1 && state.kind===STATE_KIND && state.phase==='received' && isSha(state.claimCommitSha)
      && integer(state.receivedDeploymentId) && isDigest(state.recordDigest) && receiptValid(state.receipt,pending)
      && row.parents.length===1 && row.parents[0]?.sha===state.claimCommitSha,'DATABASE_AUTH_NATIVE_STATE_INVALID');
    else check(exact(state,['schemaVersion','kind','phase','pending','claimCommitSha','receipt','recordDigest','record'])
      && state.schemaVersion===1 && state.kind===STATE_KIND && ['rejected','denied_by_scope','unsubmitted'].includes(state.phase)
      && terminalReceiptValid(state.receipt,pending) && state.phase===state.receipt.outcome && isSha(state.claimCommitSha)
      && exact(state.record,terminalRecordFields(state.phase))
      && (state.phase!=='unsubmitted'||same(state.record.claim,pending))
      && row.parents.length===1 && row.parents[0]?.sha===state.claimCommitSha && same(state.record.receipt,state.receipt)
      && state.record.event===state.phase && same(binding(state.record),binding(pending)) && state.record.claimCommitSha===state.claimCommitSha
      && state.record.claimDigest===digest(pending) && digest({kind:KIND,...state.record})===state.recordDigest,'DATABASE_AUTH_NATIVE_STATE_INVALID');
    return state;};
  const head=async()=>{let rows;try{rows=await github.pages(`${base}/git/matching-refs/${REF.slice(5)}?per_page=100`);}catch{throw Error('DATABASE_AUTH_NATIVE_READ_UNAVAILABLE');}
    check(Array.isArray(rows),'DATABASE_AUTH_NATIVE_REF_INVALID');const found=rows.filter(row=>row?.ref===REF);
    check(found.length<=1,'DATABASE_AUTH_NATIVE_REF_INVALID');if(!found.length)return null;
    check(found[0].object?.type==='commit' && isSha(found[0].object.sha),'DATABASE_AUTH_NATIVE_REF_INVALID');
    const row=await commit(found[0].object.sha);return {sha:row.sha,state:await parseState(row)};};
  const validateJournal=rows=>{const intents=new Map(),received=new Map(),terminal=new Map();
    for(const row of rows){const p=row?.payload;check(integer(row?.id) && row.environment===ENVIRONMENT && row.creator?.id===actor.id
      && row.creator.login===targets().account && p?.kind===KIND && row.sha===p.sourceSha,'DATABASE_AUTH_JOURNAL_INVALID');
      const fields=p.event==='intent'?[...recordKeys,'kind','claim','preflight']:[...terminalRecordFields(p.event),'kind'];
      check(exact(p,fields) && idValid(p.intentId) && isDigest(p.requestDigest) && isSha(p.sourceSha) && purposeValid(p.purpose)
        && p.actorId===actor.id && isSha(p.claimCommitSha) && isDigest(p.claimDigest) && typeof p.observedAt==='string'
        && Number.isFinite(Date.parse(p.observedAt)) && new Date(Date.parse(p.observedAt)).toISOString()===p.observedAt,'DATABASE_AUTH_JOURNAL_INVALID');
      if(p.event==='intent'){check(!intents.has(p.intentId) && pendingValid(p.claim,actor.id) && same(binding(p),binding(p.claim))
        && digest(p.claim)===p.claimDigest && preflightValid(p.preflight) && digest(p.preflight)===p.claim.preflightDigest
        && p.claim.claimedAtMs>=p.preflight.observedAtMs && p.claim.claimedAtMs-p.preflight.observedAtMs<=60000,'DATABASE_AUTH_JOURNAL_INVALID');intents.set(p.intentId,row);}
      else{check(['received','rejected','denied_by_scope','unsubmitted'].includes(p.event) && !received.has(p.intentId) && !terminal.has(p.intentId),'DATABASE_AUTH_JOURNAL_INVALID');
        (p.event==='received'?received:terminal).set(p.intentId,row);}}
    for(const [id,row]of [...received,...terminal]){const p=row.payload,original=intents.get(id)?.payload;
      if(p.event==='unsubmitted'){
        check(!original && pendingValid(p.claim,actor.id) && same(binding(p),binding(p.claim))
          && digest(p.claim)===p.claimDigest && p.receipt?.outcome===p.event && terminalReceiptValid(p.receipt,p.claim),
        'DATABASE_AUTH_JOURNAL_CLOSURE_INVALID');
        continue;
      }
      check(original && same(binding(p),binding(original)) && p.claimCommitSha===original.claimCommitSha && p.claimDigest===original.claimDigest
        && (p.event==='received'?receiptValid(p.receipt,original.claim):p.event===p.receipt.outcome && terminalReceiptValid(p.receipt,original.claim)),'DATABASE_AUTH_JOURNAL_CLOSURE_INVALID');}
    return {intents,received,terminal};};
  const journal=async()=>{let rows;try{rows=await github.pages(`${base}/deployments?environment=${ENVIRONMENT}&per_page=100`);}catch{throw Error('DATABASE_AUTH_NATIVE_READ_UNAVAILABLE');}
    check(Array.isArray(rows),'DATABASE_AUTH_JOURNAL_INVALID');return {rows,...validateJournal(rows)};};
  let current;
  const publish=async record=>{persist(record);const payload={kind:KIND,...record};let row;
    try{row=await github.write(`${base}/deployments`,{ref:record.sourceSha,environment:ENVIRONMENT,auto_merge:false,required_contexts:[],
      production_environment:false,transient_environment:false,description:'FCOS temporary database authentication journal',payload});}catch{/* Original record readback only. */}
    if(row){validateJournal(current.intentDeployment&&record.event!=='intent'?[current.intentDeployment,row]:[row]);check(same(row.payload,payload),'DATABASE_AUTH_JOURNAL_ACK_REQUIRED');return row;}
    const saved=await journal(),found=saved.rows.filter(value=>same(value.payload,payload));check(found.length===1,'DATABASE_AUTH_JOURNAL_ACK_UNKNOWN');return found[0];};
  const createCommit=async(state,parentSha)=>{let row;try{row=await github.write(`${base}/git/commits`,{message:canonical(state),tree:state.phase==='pending'?state.treeSha:state.pending.treeSha,parents:[parentSha]});}
    catch{throw Error('DATABASE_AUTH_COMMIT_ACK_UNKNOWN');}
    check(isSha(row?.sha),'DATABASE_AUTH_COMMIT_ACK_UNKNOWN');const native=await commit(row.sha);
    check(messageText(native)===canonical(state) && native.parents.length===1 && native.parents[0]?.sha===parentSha
      && native.tree.sha===(state.phase==='pending'?state.treeSha:state.pending.treeSha),'DATABASE_AUTH_NATIVE_COMMIT_INVALID');return row.sha;};
  const moveRef=async(sha,previous)=>{
    try {
      if(previous)await github.patch(refPath,{sha,force:false});
      else await github.write(`${base}/git/refs`,{ref:REF,sha});
    } catch { /* Never retry a ref write. */ }
    const exactPath=`${base}/git/ref/${REF.slice(5)}`;
    // The commit has already been read back by hash. Here only the exact ref
    // needs acknowledgement, and the list endpoint can lag the mutation.
    for(const wait of [0,150,400]){
      if(wait)await delay(wait);
      let actual;
      try { actual=await read(exactPath); } catch { continue; }
      check(actual?.ref===REF && actual.object?.type==='commit' && isSha(actual.object.sha),'DATABASE_AUTH_NATIVE_REF_INVALID');
      if(actual.object.sha===sha)return;
      if(actual.object.sha!==previous?.sha)break;
    }
    throw Error('DATABASE_AUTH_CLAIM_ACK_UNKNOWN');
  };
  const received=async receipt=>{
    check(current?.claim && receiptValid(receipt,current.claim),'DATABASE_AUTH_RECEIPT_REFUSED');
    const owned=await head();check(owned?.sha===current.claimCommitSha && same(owned.state,current.claim),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
    if(current.receivedDeployment){check(same(current.receivedDeployment.payload.receipt,receipt),'DATABASE_AUTH_RECEIPT_REFUSED');return current.receivedDeployment;}
    current.receivedDeployment=await publish({...binding(current),event:'received',claimCommitSha:current.claimCommitSha,claimDigest:current.claimDigest,receipt,observedAt:new Date(now()).toISOString()});
    return current.receivedDeployment;
  };
  // Reserve the sole terminal child by native CAS BEFORE publishing its Deployment.
  // A crash leaves an exact recoverable record; an uncertain Deployment ACK is never resubmitted.
  const closeTerminal=async(receipt,owned)=>{
    const record={...binding(current),event:receipt.outcome,claimCommitSha:current.claimCommitSha,claimDigest:current.claimDigest,
      receipt,...(receipt.outcome==='unsubmitted'?{claim:current.claim}:{}),observedAt:new Date(now()).toISOString()};
    persist({...binding(current),event:`${receipt.outcome}_prepared`,record});
    const state={schemaVersion:1,kind:STATE_KIND,phase:receipt.outcome,pending:current.claim,claimCommitSha:current.claimCommitSha,receipt,recordDigest:digest({kind:KIND,...record}),record};
    const sha=await createCommit(state,current.claimCommitSha);await moveRef(sha,owned);
    await publish(record);return {state:receipt.outcome,intentId:receipt.intentId,recordDigest:state.recordDigest};
  };
  const readRecoveryEvidence=async({id,phase,claim,claimCommitSha,recoverySha,at})=>{
    const evidence=await read(`${base}/deployments/${id}`);
    const unsubmitted=phase==='unsubmitted';
    const environment=unsubmitted?DATABASE_UNSUBMITTED_EVIDENCE_ENVIRONMENT:DATABASE_SCOPE_EVIDENCE_ENVIRONMENT;
    const validate=unsubmitted?unsubmittedObservationValid:scopeObservationValid;
    check(evidence?.id===id && evidence.creator?.id===actor.id && evidence.creator.login===targets().account
      && evidence.environment===environment && evidence.sha===recoverySha
      && validate(evidence.payload,claim,claimCommitSha,recoverySha,at),
    unsubmitted?'DATABASE_AUTH_UNSUBMITTED_EVIDENCE_REQUIRED':'DATABASE_AUTH_SCOPE_EVIDENCE_REQUIRED');
    return evidence.payload;
  };
  const assertTerminalEvidence=async state=>{
    if(!['denied_by_scope','unsubmitted'].includes(state.phase))return;
    const receipt=state.receipt;
    const payload=await readRecoveryEvidence({id:receipt.evidenceDeploymentId,phase:state.phase,claim:state.pending,
      claimCommitSha:state.claimCommitSha,recoverySha:receipt.reconciliationSourceSha,at:receipt.observedAtMs});
    check(digest(payload)===receipt.evidenceDigest,state.phase==='unsubmitted'
      ?'DATABASE_AUTH_UNSUBMITTED_EVIDENCE_REQUIRED':'DATABASE_AUTH_SCOPE_EVIDENCE_REQUIRED');
  };
  const resumeTerminal=async(owned,history)=>{
    const state=owned.state,original=history.intents.get(state.pending.intentId);
    check(state.phase==='unsubmitted'?!original:original && same(original.payload.claim,state.pending)
      && original.payload.claimCommitSha===state.claimCommitSha,'DATABASE_AUTH_NATIVE_CLOSURE_INVALID');
    check(same(await parseState(await commit(state.claimCommitSha)),state.pending),'DATABASE_AUTH_NATIVE_CLOSURE_INVALID');
    await assertTerminalEvidence(state);
    current={...binding(state.pending),claim:state.pending,claimCommitSha:state.claimCommitSha,claimDigest:digest(state.pending),intentDeployment:original};
    const saved=history.terminal.get(state.pending.intentId);
    check(saved && digest(saved.payload)===state.recordDigest,'DATABASE_AUTH_TERMINAL_PUBLICATION_UNCERTAIN');
    return {state:state.phase,intentId:state.pending.intentId,recordDigest:state.recordDigest,reused:true};
  };
  const readExpiredRoles=async claim=>{
    const projectUrl=`${ISSUER}/v1/projects/${targets().supabaseProject}`,headers={Authorization:`Bearer ${credential.token}`,'Content-Type':'application/json',Accept:'application/json'};
    let rows;
    try {
      const projectResponse=await fetchImpl(projectUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers});
      check(projectResponse.status===200 && projectResponse.url===projectUrl && !projectResponse.redirected,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');
      const project=await boundedJson(projectResponse);
      check(project.id===targets().supabaseProject && project.name===fcosConnectionIdentifier('supabase','Project name')
        && project.status==='ACTIVE_HEALTHY' && project.organization_id===claim.request.organizationId,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');
      const url=`${projectUrl}/database/query`,response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers,body:JSON.stringify({query:DATABASE_AUTH_RECONCILIATION_SQL,read_only:true})});
      check(response.status===201 && response.url===url && !response.redirected,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');rows=await boundedJson(response);
    } catch { throw Error('DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE'); }
    const managed=Array.isArray(rows)?rows.filter(row=>row.login_role===ROLE):[];
    check(managed.length===1 && rows.every(row=>preflightValid({projectRef:targets().supabaseProject,observedAtMs:now(),role:{...row,login_role:ROLE}}))
      && rows.every(row=>Number.isFinite(row.role_valid_until_ms) && row.role_valid_until_ms<=row.server_now_ms)
      && rows.every(row=>Math.abs(now()-row.server_now_ms)<=60000),'DATABASE_AUTH_ACTIVE_OR_UNKNOWN_LOGIN_ROLE');
    return {rows,managed};
  };
  return {
    async begin(request){check(!current && requestValid(request),'DATABASE_AUTH_REQUEST_REFUSED');current={preparing:true};
      const previous=await head();check(previous?.state.phase!=='pending','DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const history=await journal();check(!history.rows.length || previous,'DATABASE_AUTH_NATIVE_CLAIM_MISSING');
      check([...history.intents.keys()].every(id=>history.received.has(id)||history.terminal.has(id)),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      if(previous){const state=previous.state,receipt=(state.phase==='received'?history.received:history.terminal).get(state.pending.intentId),original=await commit(state.claimCommitSha);
        check(receipt && same(await parseState(original),state.pending) && (state.phase!=='received'||receipt.id===state.receivedDeploymentId)
          && digest(receipt.payload)===state.recordDigest && same(receipt.payload.receipt,state.receipt),'DATABASE_AUTH_NATIVE_CLOSURE_INVALID');}
      if(previous)await assertTerminalEvidence(previous.state);
      const url=`${ISSUER}/v1/projects/${targets().supabaseProject}/database/query`;let response;
      try{response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${credential.token}`,
        'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query:MANAGED_DATABASE_ROLE_SQL,read_only:true})});}
      catch{throw Error('DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');}
      check(response.status===201 && response.url===url && !response.redirected,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');
      const roleRows=await boundedJson(response),preflight={projectRef:targets().supabaseProject,observedAtMs:now(),role:Array.isArray(roleRows)&&roleRows.length===1?roleRows[0]:null};
      check(preflightValid(preflight),'DATABASE_AUTH_ROLE_PREFLIGHT_INVALID');
      const intentId=`fcos-db-auth-${randomUUID()}`,claim={schemaVersion:1,kind:STATE_KIND,phase:'pending',intentId,requestDigest:request.requestDigest,
        sourceSha:source.sha,purpose,actorId:actor.id,request,preflightDigest:digest(preflight),claimedAtMs:now(),parentSha:previous?.sha || source.sha,treeSha:await sourceTree(source.sha)};
      check(pendingValid(claim,actor.id),'DATABASE_AUTH_NATIVE_STATE_INVALID');persist({...binding(claim),event:'claim_prepared',claim});
      const claimCommitSha=await createCommit(claim,claim.parentSha);await moveRef(claimCommitSha,previous);
      current={...binding(claim),claim,claimCommitSha,claimDigest:digest(claim)};
      current.intentDeployment=await publish({...binding(claim),event:'intent',claimCommitSha,claimDigest:current.claimDigest,claim,preflight,observedAt:new Date(now()).toISOString()});
      return {state:'fresh',...binding(claim),preflight};
    },
    received,
    async rejected(receipt){
      check(current?.claim && receipt?.outcome==='rejected' && terminalReceiptValid(receipt,current.claim),'DATABASE_AUTH_RECEIPT_REFUSED');
      const owned=await head();check(owned?.sha===current.claimCommitSha && same(owned.state,current.claim),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      return closeTerminal(receipt,owned);
    },
    /** Owner-only explicit recovery. The evidence is fetched from GitHub, never accepted as a JSON authorization flag. */
    async reconcileDeniedByScope({intentId,evidenceDeploymentId}){
      check(!current && idValid(intentId) && integer(evidenceDeploymentId),'DATABASE_AUTH_SCOPE_RECONCILIATION_REFUSED');
      const owned=await head(),history=await journal();
      check(owned && (owned.state.phase==='pending'?owned.state.intentId:owned.state.pending.intentId)===intentId,'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      check((owned.state.phase==='pending'?owned.state:owned.state.pending).purpose===purpose,'DATABASE_AUTH_SCOPE_RECONCILIATION_REFUSED');
      if(owned.state.phase==='denied_by_scope'){
        check(owned.state.receipt.evidenceDeploymentId===evidenceDeploymentId,'DATABASE_AUTH_SCOPE_RECONCILIATION_REFUSED');return resumeTerminal(owned,history);
      }
      check(owned.state.phase==='pending' && !history.received.has(intentId) && !history.terminal.has(intentId),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const claim=owned.state,original=history.intents.get(intentId);
      check(original && same(original.payload.claim,claim) && original.payload.claimCommitSha===owned.sha,'DATABASE_AUTH_NATIVE_CLOSURE_INVALID');
      const p=await readRecoveryEvidence({id:evidenceDeploymentId,phase:'denied_by_scope',claim,claimCommitSha:owned.sha,
        recoverySha:source.sha,at:now()});
      const {rows,managed}=await readExpiredRoles(claim);
      const relevant=({server_now_ms,...rest})=>rest;
      check(same(relevant(managed[0]),relevant(original.payload.preflight.role)),'DATABASE_AUTH_ORIGINAL_ROLE_CHANGED');
      const fresh=await head();check(fresh?.sha===owned.sha,'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      current={...binding(claim),claim,claimCommitSha:owned.sha,claimDigest:digest(claim),intentDeployment:original};
      const receipt={intentId,requestDigest:claim.requestDigest,outcome:'denied_by_scope',issuer:ISSUER,projectRef:targets().supabaseProject,observedAtMs:now(),httpOutcome:'unobserved',
        evidenceDeploymentId,evidenceDigest:digest(p),roleReadbackDigest:digest(rows),reconciliationSourceSha:source.sha};
      return closeTerminal(receipt,owned);
    },
    async reconcileUnsubmitted({intentId,evidenceDeploymentId}){
      check(!current && idValid(intentId) && integer(evidenceDeploymentId),'DATABASE_AUTH_UNSUBMITTED_RECONCILIATION_REFUSED');
      const [owned,history]=await Promise.all([head(),journal()]);
      const claim=owned?.state.phase==='pending'?owned.state:owned?.state.pending;
      check(claim?.intentId===intentId && claim.purpose===purpose && !history.intents.has(intentId)
        && !history.received.has(intentId),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      if(owned.state.phase==='unsubmitted'){
        check(owned.state.receipt.evidenceDeploymentId===evidenceDeploymentId,'DATABASE_AUTH_UNSUBMITTED_RECONCILIATION_REFUSED');
        return resumeTerminal(owned,history);
      }
      check(owned.state.phase==='pending' && !history.terminal.has(intentId),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const evidence=await readRecoveryEvidence({id:evidenceDeploymentId,phase:'unsubmitted',claim,
        claimCommitSha:owned.sha,recoverySha:source.sha,at:now()});
      const prior=await parseState(await commit(claim.parentSha));
      const priorRecord=prior.phase==='received'?history.received.get(prior.pending.intentId):null;
      check(priorRecord && priorRecord.id===prior.receivedDeploymentId && digest(priorRecord.payload)===prior.recordDigest
        && prior.receipt.expiresAtMs<claim.claimedAtMs,'DATABASE_AUTH_UNSUBMITTED_PARENT_REQUIRED');
      const {rows,managed}=await readExpiredRoles(claim);
      const expiry=managed[0].role_valid_until_ms;
      // The observation uses ISO millisecond precision. PostgreSQL retains
      // fractional milliseconds in its timestamp-to-epoch projection.
      check(rows.length===1 && Math.floor(expiry)===evidence.roleExpiresAtMs
        && Math.abs(expiry-prior.receipt.expiresAtMs)<=30000,
        'DATABASE_AUTH_ORIGINAL_ROLE_CHANGED');
      const [fresh,currentJournal]=await Promise.all([head(),journal()]);
      check(fresh?.sha===owned.sha && !currentJournal.intents.has(intentId) && !currentJournal.received.has(intentId)
        && !currentJournal.terminal.has(intentId),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      current={...binding(claim),claim,claimCommitSha:owned.sha,claimDigest:digest(claim)};
      const receipt={intentId,requestDigest:claim.requestDigest,outcome:'unsubmitted',issuer:ISSUER,projectRef:targets().supabaseProject,
        observedAtMs:now(),httpOutcome:'unobserved',evidenceDeploymentId,evidenceDigest:digest(evidence),
        roleReadbackDigest:digest(rows),reconciliationSourceSha:source.sha};
      return closeTerminal(receipt,owned);
    },
    async complete(receipt){check(current?.claim && receiptValid(receipt,current.claim),'DATABASE_AUTH_RECEIPT_REFUSED');
      const owned=await head();check(owned?.sha===current.claimCommitSha && same(owned.state,current.claim),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const row=current.receivedDeployment || await received(receipt);
      check(same(row.payload.receipt,receipt),'DATABASE_AUTH_RECEIPT_REFUSED');
      const state={schemaVersion:1,kind:STATE_KIND,phase:'received',pending:current.claim,claimCommitSha:current.claimCommitSha,
        receipt,receivedDeploymentId:row.id,recordDigest:digest(row.payload)};
      const sha=await createCommit(state,current.claimCommitSha);await moveRef(sha,owned);
    },
    async uncertain(receipt){check(current?.claim && receipt.intentId===current.intentId && receipt.requestDigest===current.requestDigest,'DATABASE_AUTH_RECEIPT_REFUSED');
      if(receipt.diagnostics)check(exact(receipt.diagnostics,['httpStatus','responseSchema'])
        && (receipt.diagnostics.httpStatus===null || Number.isInteger(receipt.diagnostics.httpStatus)&&receipt.diagnostics.httpStatus>=100&&receipt.diagnostics.httpStatus<=599)
        && ['unobserved','issuer_mismatch','invalid_json','unexpected_keys','role_mismatch','password_invalid','ttl_invalid','valid'].includes(receipt.diagnostics.responseSchema),'DATABASE_AUTH_RECEIPT_REFUSED');
      persist({...binding(current),event:'unknown',code:'SUPABASE_LOGIN_ROLE_OUTCOME_UNKNOWN',...(receipt.diagnostics?{diagnostics:receipt.diagnostics}:{}),observedAt:new Date(now()).toISOString()});},
  };
}

/** Source-owned local operator entrypoint. The immutable owner Deployment is an
 * explicit operator attestation of observed scope/unchanged credential history,
 * never token introspection or a reconstructed HTTP response. Only auth CAS can
 * close; no coordinator, release fence, role issuance or Production authority changes.
 * Missing terminal publication remains uncertain across hosts and is never retried.
 */
export async function reconcileDatabaseCredentialDeniedByScope({intentId,evidenceDeploymentId,...context}) {
  return (await createDatabaseCredentialIntentStore(context)).reconcileDeniedByScope({intentId,evidenceDeploymentId});
}

/** Closes only an owner-attested terminal claim that never published an issuer intent. */
export async function reconcileUnsubmittedDatabaseCredential({intentId,evidenceDeploymentId,...context}) {
  return (await createDatabaseCredentialIntentStore(context)).reconcileUnsubmitted({intentId,evidenceDeploymentId});
}
