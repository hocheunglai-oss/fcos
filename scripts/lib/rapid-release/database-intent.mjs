import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, git, isSha, isDigest, requireCondition as check, targets } from './contract.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { MANAGED_DATABASE_ROLE_SQL, isManagedDatabaseRole } from './database-connection.mjs';

const ENVIRONMENT = 'fcos-database-auth-journal-v1', KIND = 'fcos_native_database_auth';
const STATE_KIND = 'fcos_native_database_auth_state', REF = 'refs/heads/codex/rapid-database-auth-journal';
const ISSUER = 'https://api.supabase.com', ROLE = 'cli_login_postgres';
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
    else check(exact(state,['schemaVersion','kind','phase','pending','claimCommitSha','receipt','receivedDeploymentId','recordDigest'])
      && state.schemaVersion===1 && state.kind===STATE_KIND && state.phase==='received' && isSha(state.claimCommitSha)
      && integer(state.receivedDeploymentId) && isDigest(state.recordDigest) && receiptValid(state.receipt,pending)
      && row.parents.length===1 && row.parents[0]?.sha===state.claimCommitSha,'DATABASE_AUTH_NATIVE_STATE_INVALID');
    return state;};
  const head=async()=>{let rows;try{rows=await github.pages(`${base}/git/matching-refs/${REF.slice(5)}?per_page=100`);}catch{throw Error('DATABASE_AUTH_NATIVE_READ_UNAVAILABLE');}
    check(Array.isArray(rows),'DATABASE_AUTH_NATIVE_REF_INVALID');const found=rows.filter(row=>row?.ref===REF);
    check(found.length<=1,'DATABASE_AUTH_NATIVE_REF_INVALID');if(!found.length)return null;
    check(found[0].object?.type==='commit' && isSha(found[0].object.sha),'DATABASE_AUTH_NATIVE_REF_INVALID');
    const row=await commit(found[0].object.sha);return {sha:row.sha,state:await parseState(row)};};
  const validateJournal=rows=>{const intents=new Map(),received=new Map();
    for(const row of rows){const p=row?.payload;check(integer(row?.id) && row.environment===ENVIRONMENT && row.creator?.id===actor.id
      && row.creator.login===targets().account && p?.kind===KIND && row.sha===p.sourceSha,'DATABASE_AUTH_JOURNAL_INVALID');
      const fields=p.event==='intent'?[...recordKeys,'kind','claim','preflight']:[...recordKeys,'kind','receipt'];
      check(exact(p,fields) && idValid(p.intentId) && isDigest(p.requestDigest) && isSha(p.sourceSha) && purposeValid(p.purpose)
        && p.actorId===actor.id && isSha(p.claimCommitSha) && isDigest(p.claimDigest) && typeof p.observedAt==='string'
        && Number.isFinite(Date.parse(p.observedAt)) && new Date(Date.parse(p.observedAt)).toISOString()===p.observedAt,'DATABASE_AUTH_JOURNAL_INVALID');
      if(p.event==='intent'){check(!intents.has(p.intentId) && pendingValid(p.claim,actor.id) && same(binding(p),binding(p.claim))
        && digest(p.claim)===p.claimDigest && preflightValid(p.preflight) && digest(p.preflight)===p.claim.preflightDigest
        && p.claim.claimedAtMs>=p.preflight.observedAtMs && p.claim.claimedAtMs-p.preflight.observedAtMs<=60000,'DATABASE_AUTH_JOURNAL_INVALID');intents.set(p.intentId,row);}
      else{check(p.event==='received' && !received.has(p.intentId),'DATABASE_AUTH_JOURNAL_INVALID');received.set(p.intentId,row);}}
    for(const [id,row]of received){const p=row.payload,original=intents.get(id)?.payload;
      check(original && same(binding(p),binding(original)) && p.claimCommitSha===original.claimCommitSha && p.claimDigest===original.claimDigest
        && receiptValid(p.receipt,original.claim),'DATABASE_AUTH_JOURNAL_CLOSURE_INVALID');}
    return {intents,received};};
  const journal=async()=>{let rows;try{rows=await github.pages(`${base}/deployments?environment=${ENVIRONMENT}&per_page=100`);}catch{throw Error('DATABASE_AUTH_NATIVE_READ_UNAVAILABLE');}
    check(Array.isArray(rows),'DATABASE_AUTH_JOURNAL_INVALID');return {rows,...validateJournal(rows)};};
  let current;
  const publish=async record=>{persist(record);const payload={kind:KIND,...record};let row;
    try{row=await github.write(`${base}/deployments`,{ref:source.sha,environment:ENVIRONMENT,auto_merge:false,required_contexts:[],
      production_environment:false,transient_environment:false,description:'FCOS temporary database authentication journal',payload});}catch{/* Original record readback only. */}
    if(row){validateJournal(record.event==='intent'?[row]:[current.intentDeployment,row]);check(same(row.payload,payload),'DATABASE_AUTH_JOURNAL_ACK_REQUIRED');return row;}
    const saved=await journal(),found=saved.rows.filter(value=>same(value.payload,payload));check(found.length===1,'DATABASE_AUTH_JOURNAL_ACK_UNKNOWN');return found[0];};
  const createCommit=async(state,parentSha)=>{let row;try{row=await github.write(`${base}/git/commits`,{message:canonical(state),tree:state.phase==='pending'?state.treeSha:state.pending.treeSha,parents:[parentSha]});}
    catch{throw Error('DATABASE_AUTH_COMMIT_ACK_UNKNOWN');}
    check(isSha(row?.sha),'DATABASE_AUTH_COMMIT_ACK_UNKNOWN');const native=await commit(row.sha);
    check(messageText(native)===canonical(state) && native.parents.length===1 && native.parents[0]?.sha===parentSha
      && native.tree.sha===(state.phase==='pending'?state.treeSha:state.pending.treeSha),'DATABASE_AUTH_NATIVE_COMMIT_INVALID');return row.sha;};
  const moveRef=async(sha,previous)=>{try{if(previous)await github.patch(refPath,{sha,force:false});
    else await github.write(`${base}/git/refs`,{ref:REF,sha});}catch{/* Never retry a ref write. */}
    const actual=await head();check(actual?.sha===sha,'DATABASE_AUTH_CLAIM_ACK_UNKNOWN');return actual;};
  return {
    async begin(request){check(!current && requestValid(request),'DATABASE_AUTH_REQUEST_REFUSED');current={preparing:true};
      const previous=await head();check(previous?.state.phase!=='pending','DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const history=await journal();check(!history.rows.length || previous,'DATABASE_AUTH_NATIVE_CLAIM_MISSING');
      check([...history.intents.keys()].every(id=>history.received.has(id)),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      if(previous){const state=previous.state,receipt=history.received.get(state.pending.intentId),original=await commit(state.claimCommitSha);
        check(same(await parseState(original),state.pending) && receipt?.id===state.receivedDeploymentId
          && digest(receipt.payload)===state.recordDigest && same(receipt.payload.receipt,state.receipt),'DATABASE_AUTH_NATIVE_CLOSURE_INVALID');}
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
    async complete(receipt){check(current?.claim && receiptValid(receipt,current.claim),'DATABASE_AUTH_RECEIPT_REFUSED');
      const owned=await head();check(owned?.sha===current.claimCommitSha && same(owned.state,current.claim),'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const row=await publish({...binding(current),event:'received',claimCommitSha:current.claimCommitSha,claimDigest:current.claimDigest,receipt,observedAt:new Date(now()).toISOString()});
      const state={schemaVersion:1,kind:STATE_KIND,phase:'received',pending:current.claim,claimCommitSha:current.claimCommitSha,
        receipt,receivedDeploymentId:row.id,recordDigest:digest(row.payload)};
      const sha=await createCommit(state,current.claimCommitSha);await moveRef(sha,owned);
    },
    async uncertain(receipt){check(current?.claim && receipt.intentId===current.intentId && receipt.requestDigest===current.requestDigest,'DATABASE_AUTH_RECEIPT_REFUSED');
      persist({...binding(current),event:'unknown',code:'SUPABASE_LOGIN_ROLE_OUTCOME_UNKNOWN',observedAt:new Date(now()).toISOString()});},
  };
}
