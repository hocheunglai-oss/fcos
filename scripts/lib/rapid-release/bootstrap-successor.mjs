import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, isSha, isDigest, requireCondition as check, targets, sourceSnapshot } from './contract.mjs';
import { assertHandoverConnection, assertHandoverDatabaseIdentity } from './handover.mjs';
import { verifyLockedBootstrap, verifyBootstrapRootProof, verifyBootstrapBrowserProof, bootstrapNativeFile } from './bootstrap-admission.mjs';
import { execFileSync } from 'node:child_process';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';

export const BOOTSTRAP_SUCCESSOR_REVIEW_ENVIRONMENT='fcos-bootstrap-successor-review-v1';
export const BOOTSTRAP_SUCCESSOR_AUTH_ENVIRONMENT='fcos-bootstrap-successor-auth-v1';
export const BOOTSTRAP_SUCCESSOR_ABORT_ENVIRONMENT='fcos-bootstrap-successor-abort-v1';
const kind='fcos_initial_bootstrap_successor',base=()=>`/repos/${targets().repository}`;
const same=(a,b)=>canonical(a)===canonical(b),positive=n=>Number.isSafeInteger(n)&&n>0;
const phases=['claimed','vercel_intent','vercel_observed','qualified','failed','aborted'],writePermits=new WeakMap(),transportKinds=new WeakMap();
export const bootstrapSuccessorRef=plan=>`refs/heads/codex/rapid-bootstrap-successor-${plan.rootPlanHash.slice(0,24)}`;
function pullRequestNumber(plan) {
  const number=Object.hasOwn(plan||{},'pullRequestNumber')?plan.pullRequestNumber:124;
  check(positive(number),'BOOTSTRAP_SUCCESSOR_PLAN_INVALID');return number;
}
// The frozen bootstrap predates the recovery workflow installed by protected PR 126.
const installedRecovery = Object.freeze({
  rootPlanHash: 'be974ea4298298621c773eef34d9bba15e64c9d64403ed7161c5a413ba80b3ef',
  mergeSha: '821aacbbb86a4c3db2dc692e02f69fd014c506b0',
  path: '.github/workflows/fcos-rapid-handover-recovery.yml',
  blobSha: '63e66ae28f30fe2a4bd2f2e8de40ed6018449f93',
});
function inheritsInstalledRecovery(plan, patch) {
  return plan.rootPlanHash === installedRecovery.rootPlanHash && patch.path === installedRecovery.path
    && patch.oldSha === null && patch.oldMode === null
    && patch.newSha === installedRecovery.blobSha && patch.newMode === '100644';
}
function assertPlan(plan,root) {
  const {operationId,...body}=plan||{},hasPullRequest=Object.hasOwn(plan||{},'pullRequestNumber');
  check(plan?.schemaVersion===1 && plan.kind===kind && positive(plan.revision) && isSha(plan.controllerSha) && plan.controllerSha!==root.controllerSha
    && plan.rootPlanHash===digest(root) && plan.branch===root.branch && isDigest(plan.sourceDigest) && isDigest(plan.lockDigest) && isDigest(plan.configurationDigest)
    && plan.inventoryDigest===root.inventoryDigest && plan.previousProductionId===root.previousProductionId
    && (!hasPullRequest||positive(plan.pullRequestNumber))
    && same(Object.keys(plan).sort(),['schemaVersion','kind','revision','rootPlanHash','controllerSha','sourceDigest','lockDigest','configurationDigest','branch','quality','patch','inventoryDigest','previousProductionId','operationId',...(hasPullRequest?['pullRequestNumber']:[])].sort())
    && operationId===`fcos-bootstrap-successor-${digest(body).slice(0,40)}` && Array.isArray(plan.patch) && plan.patch.length>0 && plan.patch.length<=100
    && same(plan.patch.map(x=>x.path),[...new Set(plan.patch.map(x=>x.path))].sort())
    && plan.patch.every(x=>typeof x.path==='string' && /^[A-Za-z0-9_.@()[\]/ -]{1,250}$/.test(x.path) && !x.path.split('/').includes('..')
      && (!/^(?:\.github\/workflows\/|force-app\/|supabase\/migrations\/|vercel\.json$|config\/fcosConnections\.js$|package(?:-lock)?\.json$|scripts\/rapid-release\/(?:bootstrap|handover)-guard\.sql$)/.test(x.path) || inheritsInstalledRecovery(plan,x))
      && same(Object.keys(x).sort(),['path','oldSha','newSha','oldMode','newMode'].sort())
      && [x.oldSha,x.newSha].every(v=>v===null||isSha(v)) && [x.oldMode,x.newMode].every(v=>v===null||['100644','100755'].includes(v))
      && (x.oldSha!==x.newSha || x.oldMode!==x.newMode) && (x.oldSha===null)===(x.oldMode===null) && (x.newSha===null)===(x.newMode===null))
    && same(Object.keys(plan.quality||{}).sort(),['checkRunId','runId','jobId'].sort()) && Object.values(plan.quality).every(positive), 'BOOTSTRAP_SUCCESSOR_PLAN_INVALID');
}
/** A plan is data, never authority. Claim verifies every blob and the owner review natively. */
export function createBootstrapSuccessorPlan({bootstrapPlan,controllerSha,sourceDigest,lockDigest,configurationDigest,quality,patch,revision=1,pullRequestNumber}) {
  const body={schemaVersion:1,kind,revision,rootPlanHash:digest(bootstrapPlan),controllerSha,sourceDigest,lockDigest,configurationDigest,branch:bootstrapPlan.branch,quality,patch,
    inventoryDigest:bootstrapPlan.inventoryDigest,previousProductionId:bootstrapPlan.previousProductionId,...(pullRequestNumber===undefined?{}:{pullRequestNumber})};
  const plan={...body,operationId:`fcos-bootstrap-successor-${digest(body).slice(0,40)}`};assertPlan(plan,bootstrapPlan);return plan;
}
/** Only public allowlisted values + version metadata are retained. Never hash secret values. */
export function bootstrapSuccessorConfiguration({project,rows,branch}) {
  check(project?.id===targets().projectId&&project.accountId===targets().teamId&&project.autoAssignCustomDomains===false&&Array.isArray(rows),'BOOTSTRAP_SUCCESSOR_NATIVE_CONFIGURATION_REQUIRED');
  const values={VITE_FCOS_ENABLE_FCUNO_OIDC:'true',FCOS_ENABLE_FCUNO_FEDERATION:'true',FCUNO_IDENTITY_ISSUER:FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer,FCOS_ENABLE_READ_ONLY_CI:'true'};
  for(const[key,value]of Object.entries(values)){const matches=rows.filter(r=>r.key===key&&r.gitBranch===branch);
    check(matches.length===1&&matches[0].value===value&&matches[0].type==='plain'&&same(matches[0].target,['preview']),'BOOTSTRAP_SUCCESSOR_PUBLIC_CONFIGURATION_REQUIRED');}
  const relevant=rows.filter(r=>r.target?.includes('preview')&&(!r.gitBranch||r.gitBranch===branch));
  check(relevant.every(r=>typeof r.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r.id)&&typeof r.key==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key)
    &&['plain','encrypted','sensitive','secret','system'].includes(r.type)&&r.updatedAt!==undefined&&['number','string'].includes(typeof r.updatedAt))
    &&new Set(relevant.map(r=>r.id)).size===relevant.length,'BOOTSTRAP_SUCCESSOR_NATIVE_CONFIGURATION_REQUIRED');
  return{projectId:project.id,teamId:project.accountId,branch,publicValues:values,
    build:Object.fromEntries(['nodeVersion','framework','rootDirectory','buildCommand','installCommand','outputDirectory'].map(k=>[k,project[k]??null])),
    environment:relevant.map(r=>({id:r.id,key:r.key,type:r.type,target:r.target.slice().sort(),gitBranch:r.gitBranch||null,updatedAt:r.updatedAt})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function bootstrapSuccessorRequest(plan) {
  return {name:'fcos',project:targets().projectId,gitSource:{type:'github',repoId:1278654816,ref:plan.branch,sha:plan.controllerSha,prId:pullRequestNumber(plan)},
    meta:{fcosBootstrapOperation:plan.operationId,fcosBootstrapPlanHash:digest(plan)}};
}
const read=async(github,path)=>{try{return await (github.read||github.get).call(github,path);}catch{throw Error('BOOTSTRAP_SUCCESSOR_NATIVE_READ_UNKNOWN');}};
async function owner(github) {
  const [repo,user]=await Promise.all([read(github,base()),read(github,'/user')]);
  check(repo.id===1278654816 && repo.full_name===targets().repository && repo.owner?.login===targets().account && positive(repo.owner.id)
    && repo.permissions?.admin===true && !repo.archived && user.login===targets().account && user.id===repo.owner.id,'BOOTSTRAP_SUCCESSOR_NATIVE_OWNER_REQUIRED');return repo;
}
async function quality(github,plan,repo) {
  const q=plan.quality,[c,r,j]=await Promise.all([read(github,`${base()}/check-runs/${q.checkRunId}`),read(github,`${base()}/actions/runs/${q.runId}`),read(github,`${base()}/actions/jobs/${q.jobId}`)]);
  check(c.id===q.checkRunId && c.app?.id===15368 && c.head_sha===plan.controllerSha && c.status==='completed' && c.conclusion==='success'
    && c.details_url===`https://github.com/${targets().repository}/actions/runs/${q.runId}/job/${q.jobId}` && r.id===q.runId && r.head_sha===plan.controllerSha
    && r.repository?.id===repo.id && r.head_repository?.id===repo.id && r.event==='pull_request' && String(r.path).split('@')[0]==='.github/workflows/quality.yml'
    && j.id===q.jobId && j.run_id===r.id && j.head_sha===plan.controllerSha && j.name==='code-and-database' && j.status==='completed' && j.conclusion==='success','BOOTSTRAP_SUCCESSOR_NATIVE_QUALITY_REQUIRED');
}
async function source(github,plan,root,repo,{requireOpen=false}={}) {
  assertPlan(plan,root);await quality(github,plan,repo);
  let gitConfiguration;try{gitConfiguration=JSON.parse(bootstrapNativeFile(await read(github,`${base()}/contents/vercel.json?ref=${root.controllerSha}`)).toString('utf8'));}catch{throw Error('BOOTSTRAP_SUCCESSOR_GIT_AUTODEPLOY_DISABLED_REQUIRED');}
  check(gitConfiguration.git?.deploymentEnabled===false,'BOOTSTRAP_SUCCESSOR_GIT_AUTODEPLOY_DISABLED_REQUIRED');
  const compare=await read(github,`${base()}/compare/${root.controllerSha}...${plan.controllerSha}`);
  check(compare.status==='ahead' && compare.merge_base_commit?.sha===root.controllerSha && compare.base_commit?.sha===root.controllerSha
    && compare.total_commits>0,'BOOTSTRAP_SUCCESSOR_DESCENDANT_REQUIRED');
  const trees=await Promise.all([root.controllerSha,plan.controllerSha].map(async sha=>{
    const commit=await read(github,`${base()}/git/commits/${sha}`);check(commit.sha===sha && isSha(commit.tree?.sha),'BOOTSTRAP_SUCCESSOR_NATIVE_TREE_REQUIRED');
    const tree=await read(github,`${base()}/git/trees/${commit.tree.sha}?recursive=1`);
    check(tree.sha===commit.tree.sha && tree.truncated===false && Array.isArray(tree.tree) && tree.tree.length<=20000
      && tree.tree.every(x=>x.type==='tree'||x.type==='blob'&&['100644','100755'].includes(x.mode)),'BOOTSTRAP_SUCCESSOR_NATIVE_TREE_REQUIRED');
    return new Map(tree.tree.filter(x=>x.type==='blob').map(x=>[x.path,x]));}));
  const patch=[...new Set(trees.flatMap(t=>[...t.keys()]))].sort().flatMap(path=>{const [a,b]=trees.map(t=>t.get(path));return a?.sha===b?.sha&&a?.mode===b?.mode?[]:
    [{path,oldSha:a?.sha||null,newSha:b?.sha||null,oldMode:a?.mode||null,newMode:b?.mode||null}];});
  check(same(patch,plan.patch),'BOOTSTRAP_SUCCESSOR_REVIEWED_PATCH_CHANGED');
  if (patch.some(entry=>inheritsInstalledRecovery(plan,entry))) {
    const installed = await read(github,`${base()}/compare/${installedRecovery.mergeSha}...${plan.controllerSha}`);
    check(installed.status==='ahead' && installed.base_commit?.sha===installedRecovery.mergeSha
      && installed.merge_base_commit?.sha===installedRecovery.mergeSha && installed.total_commits>0,
    'BOOTSTRAP_SUCCESSOR_INSTALLED_RECOVERY_ANCESTRY_REQUIRED');
  }
  if(requireOpen){const number=pullRequestNumber(plan),[pr,ref]=await Promise.all([read(github,`${base()}/pulls/${number}`),read(github,`${base()}/git/ref/heads/${encodeURIComponent(plan.branch)}`)]);
    check(pr.number===number && pr.state==='open' && pr.base?.repo?.id===repo.id && repo.default_branch==='main' && pr.base.ref===repo.default_branch && pr.head?.repo?.id===repo.id
      && pr.head.ref===plan.branch && pr.head.sha===plan.controllerSha && ref.object?.sha===plan.controllerSha,'BOOTSTRAP_SUCCESSOR_EXACT_PR_REQUIRED');}
}
async function review(github,plan,id,repo) {
  check(positive(id),'BOOTSTRAP_SUCCESSOR_OWNER_REVIEW_REQUIRED');const row=await read(github,`${base()}/deployments/${id}`);
  const payload={schemaVersion:1,kind:'fcos_initial_bootstrap_successor_review',planHash:digest(plan),bootstrapPlanHash:plan.rootPlanHash,
    controllerSha:plan.controllerSha,patchDigest:digest(plan.patch)};
  check(row.id===id && row.sha===plan.controllerSha && row.environment===BOOTSTRAP_SUCCESSOR_REVIEW_ENVIRONMENT
    && row.creator?.login===targets().account && row.creator.id===repo.owner.id && same(row.payload,payload),'BOOTSTRAP_SUCCESSOR_OWNER_REVIEW_REQUIRED');return {deploymentId:id,digest:digest(payload)};
}
function persist(directory,plan,event,data) {
  check(typeof directory==='string','BOOTSTRAP_SUCCESSOR_DURABLE_DIRECTORY_REQUIRED');
  const path=join(directory,plan.operationId);mkdirSync(path,{recursive:true,mode:0o700});
  const fd=openSync(join(path,`${event}.json`),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{const b=Buffer.from(`${canonical(data)}\n`);let n=0;while(n<b.length)n+=writeSync(fd,b,n,b.length-n);fsyncSync(fd);}finally{closeSync(fd);}
  const d=openSync(path,constants.O_RDONLY);try{fsyncSync(d);}finally{closeSync(d);}
}
/** Native append-only Git CAS. A missing write ACK is always readback-only. */
async function ledger(github,root,plan) {
  const ref=bootstrapSuccessorRef(plan),rows=await github.pages(`${base()}/git/matching-refs/${ref.slice(5)}?per_page=100`);
  const found=rows.filter(r=>r.ref===ref);check(found.length<=1,'BOOTSTRAP_SUCCESSOR_LANE_INVALID');if(!found.length)return null;
  let sha=found[0].object?.sha,latest,child;const seen=new Set(),sources=new Map();
  while(sha!==root.controllerSha){check(isSha(sha)&&!seen.has(sha)&&seen.size<64,'BOOTSTRAP_SUCCESSOR_LANE_INVALID');seen.add(sha);
    const row=await read(github,`${base()}/git/commits/${sha}`);let state;try{state=JSON.parse(row.message);}catch{throw Error('BOOTSTRAP_SUCCESSOR_LANE_INVALID');}
    assertPlan(state.plan,root);
    check(row.sha===sha && row.message.replace(/\n$/,'')===canonical(state) && row.parents?.length===1 && isSha(row.parents[0].sha)
      && state.kind==='fcos_bootstrap_successor_state' && state.schemaVersion===1 && phases.includes(state.phase)
      && same(Object.keys(state).sort(),['schemaVersion','kind','phase','plan','review','data','parentSha'].sort()) && state.parentSha===row.parents[0].sha
      && positive(state.review?.deploymentId) && isDigest(state.review.digest),'BOOTSTRAP_SUCCESSOR_LANE_INVALID');
    const requestHash=digest(bootstrapSuccessorRequest(state.plan));
    check(state.phase==='aborted' ? same(Object.keys(state.data||{}).sort(),['abortDeploymentId','reason','statementDigest'])&&positive(state.data.abortDeploymentId)&&isDigest(state.data.statementDigest)
      : state.phase==='failed' ? same(Object.keys(state.data||{}).sort(),['deploymentId','failure']) && ['vercel_terminal','authentication_terminal'].includes(state.data.failure?.type)
      : state.phase==='qualified' ? same(Object.keys(state.data||{}).sort(),['deploymentId','githubPreviewDeploymentId','githubPreviewStatusId','authentication'].sort())
      && /^dpl_[A-Za-z0-9]+$/.test(state.data.deploymentId||'') && positive(state.data.githubPreviewDeploymentId) && positive(state.data.githubPreviewStatusId)
      && positive(state.data.authentication?.runId)
      : state.phase==='vercel_observed' ? same(Object.keys(state.data||{}).sort(),['deploymentId','requestHash'])
        && /^dpl_[A-Za-z0-9]+$/.test(state.data.deploymentId||'') && state.data.requestHash===requestHash
        : same(state.data,{requestHash}), 'BOOTSTRAP_SUCCESSOR_LANE_INVALID');
    if(!sources.has(state.plan.controllerSha))sources.set(state.plan.controllerSha,await read(github,`${base()}/git/commits/${state.plan.controllerSha}`));
    const commit=sources.get(state.plan.controllerSha);
    check(row.tree?.sha===commit.tree?.sha && isSha(row.tree?.sha),'BOOTSTRAP_SUCCESSOR_LANE_INVALID');
    if(child){const samePlan=same(state.plan,child.plan);
      check(samePlan?(child.phase==='aborted'?state.phase==='claimed':child.phase==='failed'?['vercel_intent','vercel_observed'].includes(state.phase):phases.indexOf(child.phase)===phases.indexOf(state.phase)+1) && same(state.review,child.review)
        :['qualified','failed','aborted'].includes(state.phase)&&child.phase==='claimed'&&child.plan.revision===state.plan.revision+1,'BOOTSTRAP_SUCCESSOR_LANE_INVALID');}
    if(child&&state.phase==='vercel_observed')check(child.data.deploymentId===state.data.deploymentId,'BOOTSTRAP_SUCCESSOR_LANE_INVALID');
    latest||={sha,state};child=state;sha=row.parents[0].sha;
  }
  check(child.phase==='claimed'&&child.plan.revision===1,'BOOTSTRAP_SUCCESSOR_LANE_INVALID');return latest;
}
async function append(context,previous,phase,data,reviewProof) {
  const {github,bootstrapPlan:root,successorPlan:plan,directory}=context,parentSha=previous?.sha||root.controllerSha;
  const state={schemaVersion:1,kind:'fcos_bootstrap_successor_state',phase,plan,review:reviewProof||previous.state.review,data,parentSha};
  persist(directory,plan,phase,state);
  const sourceCommit=await read(github,`${base()}/git/commits/${plan.controllerSha}`);let commit;
  try{commit=await github.write(`${base()}/git/commits`,{message:canonical(state),tree:sourceCommit.tree.sha,parents:[parentSha]});}catch{throw Error('BOOTSTRAP_SUCCESSOR_COMMIT_ACK_UNKNOWN');}
  check(isSha(commit?.sha),'BOOTSTRAP_SUCCESSOR_COMMIT_ACK_UNKNOWN');
  try{if(previous)await github.patch(`${base()}/git/refs/${bootstrapSuccessorRef(plan).slice(5)}`,{sha:commit.sha,force:false});
    else await github.write(`${base()}/git/refs`,{ref:bootstrapSuccessorRef(plan),sha:commit.sha});}catch{/* GET-only reconciliation below. */}
  const actual=await ledger(github,root,plan);check(actual?.sha===commit.sha && same(actual.state,state),'BOOTSTRAP_SUCCESSOR_CAS_ACK_UNKNOWN');return actual;
}
async function locked(context,work) {
  const {db,connection,bootstrapPlan:root}=context;assertHandoverConnection(connection);
  await db.query('begin isolation level read committed read write');try{
    const identity=(await db.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
    assertHandoverDatabaseIdentity(identity,connection,{readOnly:false});
    await db.query('lock table fcos_release_coordination.control in share row exclusive mode');
    await verifyLockedBootstrap({db,bootstrapPlan:root,controllerSha:root.controllerSha});
    const active=await Promise.all(['FCOS_RAPID_RELEASE_ENABLED','FCOS_RAPID_RELEASE_HANDOVER_ID'].map(name=>read(context.github,`${base()}/actions/variables/${name}`)));
    check(!active[1]&&active[0]?.value!=='true','BOOTSTRAP_SUCCESSOR_HANDOVER_ALREADY_CLAIMED');
    const exists=(await db.query("select to_regclass('fcos_release_coordination.rapid_handover_receipts')::text as name")).rows[0].name;
    if(exists){const receipts=(await db.query('select handover_id,phase from fcos_release_coordination.rapid_handover_receipts order by receipt_id')).rows;
      check(!receipts.some(r=>r.phase==='finalized'||r.phase==='prepared'&&!receipts.some(c=>c.handover_id===r.handover_id&&c.phase==='aborted')),'BOOTSTRAP_SUCCESSOR_HANDOVER_ALREADY_CLAIMED');}
    const result=await work();await db.query('commit');return result;
  }catch(error){await db.query('rollback');throw error;}
}
async function validate(context,{requireOpen=false,configuration=true}={}) {
  const {github,bootstrapPlan,successorPlan,vercel,readDatabase}=context;
  if(configuration)check(transportKinds.get(vercel)!=='reconciliation','BOOTSTRAP_SUCCESSOR_RECONCILIATION_ONLY');
  const root=await verifyBootstrapRootProof({bootstrapPlan,controllerSha:bootstrapPlan.controllerSha,github,vercel,readDatabase});
  const repo=await owner(github);await source(github,successorPlan,bootstrapPlan,repo,{requireOpen});
  if(configuration)check(typeof vercel.configuration==='function'&&digest(await vercel.configuration(successorPlan.branch))===successorPlan.configurationDigest,'BOOTSTRAP_SUCCESSOR_CONFIGURATION_CHANGED');return {root,repo};
}
/** Existing native pg context required; use a fresh lease for each phase. No role issuance here.
 * Owner review is an immutable operator statement, NOT a transferred platform approval.
 * directory is a durable host-local journal; Git CAS, not that directory, serializes hosts.
 */
export async function claimBootstrapSuccessor(context) {
  const {repo}=await validate(context,{requireOpen:true}),proof=await review(context.github,context.successorPlan,context.ownerReviewDeploymentId,repo);
  return locked(context,async()=>{const head=await ledger(context.github,context.bootstrapPlan,context.successorPlan);
    if(head&&same(head.state.plan,context.successorPlan)){check(same(head.state.review,proof),'BOOTSTRAP_SUCCESSOR_OWNER_REVIEW_REQUIRED');return head;}
    check(!head||['qualified','failed','aborted'].includes(head.state.phase),'BOOTSTRAP_SUCCESSOR_PREVIOUS_OUTCOME_UNRESOLVED');
    check(context.successorPlan.revision===(head?head.state.plan.revision+1:1),'BOOTSTRAP_SUCCESSOR_REVISION_REQUIRED');
    if(head?.state.phase==='failed')await terminalProof({...context,successorPlan:head.state.plan},head.state.data.failure,head.state.data.deploymentId);
    if(head?.state.phase==='aborted')await abortProof({...context,successorPlan:head.state.plan},head.state.data,head.state.parentSha);
    return append(context,head,'claimed',{requestHash:digest(bootstrapSuccessorRequest(context.successorPlan))},proof);});
}
async function preview(context,id,{ready=false,terminal=false}={}) {
  const {vercel,successorPlan:plan}=context,request=bootstrapSuccessorRequest(plan);
  const [p,project,production]=await Promise.all([vercel.deployment(id),vercel.project(),vercel.currentProduction()]);
  check(/^dpl_[A-Za-z0-9]+$/.test(id) && p.id===id && p.target===null && p.ownerId===targets().teamId && p.projectId===targets().projectId
    && p.gitSource?.type==='github' && Number(p.gitSource.repoId)===1278654816 && p.gitSource.sha===plan.controllerSha
    && p.gitSource.ref===plan.branch && Number(p.gitSource.prId)===pullRequestNumber(plan) && p.meta?.githubCommitSha===plan.controllerSha
    && p.meta.fcosBootstrapOperation===plan.operationId && p.meta.fcosBootstrapPlanHash===digest(plan)
    && project.id===targets().projectId && project.accountId===targets().teamId && project.autoAssignCustomDomains===false
    && production.id===plan.previousProductionId && production.alias===new URL(targets().origin).hostname && production.projectId===targets().projectId
    && production.teamId===targets().teamId && (terminal?['ERROR','CANCELED'].includes(p.readyState):ready?p.readyState==='READY':!['ERROR','CANCELED'].includes(p.readyState))
    && request.gitSource.sha===plan.controllerSha,'BOOTSTRAP_SUCCESSOR_PREVIEW_OR_ALIAS_CHANGED');return p;
}
export async function submitBootstrapSuccessor(context) {
  await validate(context,{requireOpen:true});
  const reservation=await locked(context,async()=>{const head=await ledger(context.github,context.bootstrapPlan,context.successorPlan);
    check(head&&same(head.state.plan,context.successorPlan),'BOOTSTRAP_SUCCESSOR_CLAIM_REQUIRED');
    if(head.state.phase!=='claimed')return {head,submit:false};
    await review(context.github,context.successorPlan,head.state.review.deploymentId,await owner(context.github));
    const head2=await append(context,head,'vercel_intent',{requestHash:digest(bootstrapSuccessorRequest(context.successorPlan))});return {head:head2,submit:true};});
  if(reservation.submit){
    if(context.cwd){const s=sourceSnapshot(context.cwd);check(s.sha===context.successorPlan.controllerSha&&s.sourceDigest===context.successorPlan.sourceDigest&&s.lockDigest===context.successorPlan.lockDigest,'BOOTSTRAP_SUCCESSOR_SOURCE_CHANGED');}
    writePermits.set(context.vercel,{planHash:digest(context.successorPlan),headSha:reservation.head.sha});
    try{await context.vercel.create(bootstrapSuccessorRequest(context.successorPlan));}catch{/* Original operation GET only, never resubmit. */}
    finally{writePermits.delete(context.vercel);}
  }
  return observeBootstrapSuccessor(context);
}
export async function observeBootstrapSuccessor(context) {
  check(transportKinds.get(context.vercel)!=='reconciliation','BOOTSTRAP_SUCCESSOR_RECONCILIATION_ONLY');
  const {github,bootstrapPlan:root,successorPlan:plan}=context,head=await ledger(github,root,plan);
  check(head&&same(head.state.plan,plan)&&head.state.phase!=='claimed','BOOTSTRAP_SUCCESSOR_INTENT_REQUIRED');
  check(!['failed','aborted'].includes(head.state.phase),'BOOTSTRAP_SUCCESSOR_KNOWN_FAILURE');
  const matches=await context.vercel.find({operationId:plan.operationId,planHash:digest(plan),controllerSha:plan.controllerSha});
  check(Array.isArray(matches)&&matches.length===1,'BOOTSTRAP_SUCCESSOR_PREVIEW_ACK_UNKNOWN');const p=await preview(context,matches[0].id);
  if(head.state.phase!=='vercel_intent'){check(head.state.data.deploymentId===p.id,'BOOTSTRAP_SUCCESSOR_PREVIEW_CHANGED');return {head,deployment:p};}
  return locked(context,async()=>{const current=await ledger(github,root,plan);check(current.sha===head.sha,'BOOTSTRAP_SUCCESSOR_HEAD_CHANGED');
    return {head:await append(context,head,'vercel_observed',{deploymentId:p.id,requestHash:digest(bootstrapSuccessorRequest(plan))}),deployment:p};});
}
async function applicationProof(context,head,repo,{authenticationRunId,githubPreviewDeploymentId,githubPreviewStatusId}) {
  const {github,successorPlan:plan}=context,p=await preview(context,head.state.data.deploymentId,{ready:true});
  check(positive(githubPreviewDeploymentId)&&positive(githubPreviewStatusId),'BOOTSTRAP_SUCCESSOR_GENUINE_PREVIEW_REQUIRED');
  const d=await read(github,`${base()}/deployments/${githubPreviewDeploymentId}`),statuses=await github.pages(`${base()}/deployments/${githubPreviewDeploymentId}/statuses?per_page=100`),s=statuses.find(x=>x.id===githubPreviewStatusId);
  check(d.id===githubPreviewDeploymentId&&d.sha===plan.controllerSha&&d.environment==='Preview'&&d.creator?.login==='vercel[bot]'
    &&s?.creator?.login==='vercel[bot]'&&s.state==='success'&&s.environment_url===`https://${p.url}`
    &&!statuses.some(x=>x.id>s.id&&['error','failure'].includes(x.state)&&x.creator?.login==='vercel[bot]'),'BOOTSTRAP_SUCCESSOR_GENUINE_PREVIEW_REQUIRED');
  const authentication=await verifyBootstrapBrowserProof({github,read:path=>read(github,path),repo,plan,preview:p,authenticationRunId});
  const final=await preview(context,p.id,{ready:true});check(final.url===p.url,'BOOTSTRAP_SUCCESSOR_PREVIEW_CHANGED');
  return {deploymentId:p.id,githubPreviewDeploymentId,githubPreviewStatusId,authentication};
}
/** A failed/queued browser run leaves the existing observed READY Preview intact.
 * Retry this function with a NEW genuine protected run/artifact; it never builds/submits.
 * failBootstrapSuccessor is explicit closure for a newly reviewed version, not auth retry.
 */
export async function qualifyBootstrapSuccessor(context) {
  const {repo}=await validate(context),head=await ledger(context.github,context.bootstrapPlan,context.successorPlan);
  check(head&&same(head.state.plan,context.successorPlan)&&head.state.phase==='vercel_observed','BOOTSTRAP_SUCCESSOR_OBSERVED_PREVIEW_REQUIRED');
  const data=await applicationProof(context,head,repo,context);
  return locked(context,async()=>{const current=await ledger(context.github,context.bootstrapPlan,context.successorPlan);check(current.sha===head.sha,'BOOTSTRAP_SUCCESSOR_HEAD_CHANGED');return append(context,head,'qualified',data);});
}
async function terminalProof(context,failure,deploymentId) {
  const {github,successorPlan:plan}=context,repo=await owner(github);
  if(failure.type==='vercel_terminal'){
    const p=await preview(context,deploymentId,{terminal:true});
    check(same(failure,{type:'vercel_terminal',state:p.readyState}),'BOOTSTRAP_SUCCESSOR_FAILURE_EVIDENCE_CHANGED');return failure;
  }
  check(failure.type==='authentication_terminal'&&positive(failure.intentDeploymentId)&&positive(failure.evidenceDeploymentId)&&positive(failure.runId)&&positive(failure.runAttempt),'BOOTSTRAP_SUCCESSOR_FAILURE_EVIDENCE_REQUIRED');
  const p=await preview(context,deploymentId,{ready:true}),intent=await read(github,`${base()}/deployments/${failure.intentDeploymentId}`),evidence=await read(github,`${base()}/deployments/${failure.evidenceDeploymentId}`);
  const run=await read(github,`${base()}/actions/runs/${failure.runId}/attempts/${failure.runAttempt}`),harnessSha=intent.payload?.harnessSha;
  for(const row of[intent,evidence])check(row.environment===BOOTSTRAP_SUCCESSOR_AUTH_ENVIRONMENT&&row.sha===plan.controllerSha
    &&row.creator?.login===targets().account&&row.creator.id===repo.owner.id,'BOOTSTRAP_SUCCESSOR_FAILURE_EVIDENCE_REQUIRED');
  const intentBody={schemaVersion:1,kind:'fcos_initial_bootstrap_successor_authentication_intent',planHash:digest(plan),controllerSha:plan.controllerSha,
    deploymentId,candidateUrl:`https://${p.url}`,harnessSha};
  const body={schemaVersion:1,kind:'fcos_initial_bootstrap_successor_authentication_failure',provenance:'owner_attested_original_dispatch',
    intentDeploymentId:intent.id,planHash:digest(plan),controllerSha:plan.controllerSha,deploymentId,candidateUrl:`https://${p.url}`,harnessSha,runId:run.id,runAttempt:run.run_attempt};
  check(intent.id===failure.intentDeploymentId&&evidence.id===failure.evidenceDeploymentId&&same(intent.payload,intentBody)&&same(evidence.payload,body)
    &&isSha(harnessSha)&&run.id===failure.runId&&run.head_sha===harnessSha&&run.head_branch===repo.default_branch&&run.event==='workflow_dispatch'
    &&run.repository?.id===repo.id&&run.head_repository?.id===repo.id&&run.status==='completed'&&['failure','cancelled','timed_out'].includes(run.conclusion)
    &&String(run.path).split('@')[0]==='.github/workflows/authenticated-release.yml'&&run.actor?.id===repo.owner.id
    &&positive(run.run_attempt)&&Date.parse(run.created_at)>=Date.parse(intent.created_at)&&Date.parse(evidence.created_at)>=Date.parse(run.updated_at)
    &&Date.parse(intent.created_at)<Date.parse(evidence.created_at),'BOOTSTRAP_SUCCESSOR_FAILURE_EVIDENCE_REQUIRED');
  const expected={type:'authentication_terminal',intentDeploymentId:intent.id,evidenceDeploymentId:evidence.id,runId:run.id,runAttempt:run.run_attempt,
    statementDigest:digest(body),intentDigest:digest(intentBody),conclusion:run.conclusion};
  check(same(failure,expected),'BOOTSTRAP_SUCCESSOR_FAILURE_EVIDENCE_CHANGED');return expected;
}
/** Known terminal failures only. Unknown submissions/queued auth runs cannot free the lane.
 * Authentication dispatch inputs are explicitly OWNER ATTESTED, never native input proof;
 * neither attestation grants successful browser or handover authority.
 */
export async function failBootstrapSuccessor(context) {
  // Recording a known native failure grants no build/admission authority. Configuration
  // drift must not prevent recording it; any new claim still verifies the new digest.
  await validate(context,{configuration:false});const head=await ledger(context.github,context.bootstrapPlan,context.successorPlan);
  check(head&&same(head.state.plan,context.successorPlan)&&['vercel_intent','vercel_observed'].includes(head.state.phase),'BOOTSTRAP_SUCCESSOR_ACTIVE_ATTEMPT_REQUIRED');
  const matches=await context.vercel.find({operationId:context.successorPlan.operationId,planHash:digest(context.successorPlan),controllerSha:context.successorPlan.controllerSha});
  check(matches.length===1,'BOOTSTRAP_SUCCESSOR_PREVIEW_ACK_UNKNOWN');const id=matches[0].id;
  if(head.state.phase==='vercel_observed')check(head.state.data.deploymentId===id,'BOOTSTRAP_SUCCESSOR_PREVIEW_CHANGED');
  const failure=await terminalProof(context,context.failure,id);
  return locked(context,async()=>{check((await ledger(context.github,context.bootstrapPlan,context.successorPlan)).sha===head.sha,'BOOTSTRAP_SUCCESSOR_HEAD_CHANGED');
    await terminalProof(context,failure,id);return append(context,head,'failed',{deploymentId:id,failure});});
}
async function abortProof(context,data,headSha) {
  const {github,successorPlan:plan}=context,repo=await owner(github);
  check(positive(data.abortDeploymentId)&&['source_superseded','configuration_superseded','owner_cancelled_before_submission'].includes(data.reason),'BOOTSTRAP_SUCCESSOR_ABORT_STATEMENT_REQUIRED');
  const row=await read(github,`${base()}/deployments/${data.abortDeploymentId}`),payload={schemaVersion:1,kind:'fcos_initial_bootstrap_successor_abort',planHash:digest(plan),headSha,controllerSha:plan.controllerSha,reason:data.reason};
  check(row.id===data.abortDeploymentId&&row.sha===plan.controllerSha&&row.environment===BOOTSTRAP_SUCCESSOR_ABORT_ENVIRONMENT&&row.creator?.id===repo.owner.id
    &&row.creator.login===targets().account&&same(row.payload,payload)&&data.statementDigest===digest(payload),'BOOTSTRAP_SUCCESSOR_ABORT_STATEMENT_REQUIRED');
  const matches=await context.vercel.find({operationId:plan.operationId,planHash:digest(plan),controllerSha:plan.controllerSha});
  check(Array.isArray(matches)&&matches.length===0,'BOOTSTRAP_SUCCESSOR_ABORT_DISCOVERY_NOT_EMPTY');return data;
}
/** Only an exact still-claimed head can be aborted, under the submission/handover lock.
 * An absent provider ID NEVER permits aborting a vercel_intent or observed attempt.
 */
export async function abortBootstrapSuccessor(context) {
  await verifyBootstrapRootProof({...context,controllerSha:context.bootstrapPlan.controllerSha});assertPlan(context.successorPlan,context.bootstrapPlan);
  return locked(context,async()=>{const head=await ledger(context.github,context.bootstrapPlan,context.successorPlan);
    check(head&&same(head.state.plan,context.successorPlan)&&head.state.phase==='claimed'&&head.sha===context.claimedHeadSha,'BOOTSTRAP_SUCCESSOR_UNSUBMITTED_HEAD_REQUIRED');
    const data={abortDeploymentId:context.abortDeploymentId,reason:context.reason,statementDigest:digest({schemaVersion:1,kind:'fcos_initial_bootstrap_successor_abort',
      planHash:digest(context.successorPlan),headSha:head.sha,controllerSha:context.successorPlan.controllerSha,reason:context.reason})};
    await abortProof(context,data,head.sha);return append(context,head,'aborted',data);});
}
/** Full fresh native verifier. It cannot accept the old failed browser artifact. */
export async function verifyBootstrapSuccessor(context) {
  const {root,repo}=await validate(context),head=await ledger(context.github,context.bootstrapPlan,context.successorPlan);
  check(head&&same(head.state.plan,context.successorPlan)&&head.state.phase==='qualified','BOOTSTRAP_SUCCESSOR_QUALIFIED_HEAD_REQUIRED');
  await review(context.github,context.successorPlan,head.state.review.deploymentId,repo);
  const proof=await applicationProof(context,head,repo,{...head.state.data,authenticationRunId:head.state.data.authentication.runId});
  check(same(proof,head.state.data),'BOOTSTRAP_SUCCESSOR_QUALIFICATION_CHANGED');
  const final=await context.readDatabase(db=>verifyLockedBootstrap({db,bootstrapPlan:context.bootstrapPlan,controllerSha:context.bootstrapPlan.controllerSha}));
  check(final.nativeStateDigest===root.nativeStateDigest&&(await ledger(context.github,context.bootstrapPlan,context.successorPlan)).sha===head.sha,'BOOTSTRAP_SUCCESSOR_HEAD_CHANGED');
  return {root,successor:{plan:context.successorPlan,headSha:head.sha,review:head.state.review,proof},authentication:proof.authentication};
}
/** SELECT + native GET only, called INSIDE handover's existing control lock before guard DDL. */
export async function verifyLockedBootstrapSuccessor({db,github,bootstrapPlan,controllerSha,reference}) {
  check(reference?.schemaVersion===2&&reference.kind==='fcos_initial_bootstrap_successor_reference'&&reference.successor?.plan.controllerSha===controllerSha,'BOOTSTRAP_SUCCESSOR_REFERENCE_REQUIRED');
  await verifyLockedBootstrap({db,bootstrapPlan,controllerSha:bootstrapPlan.controllerSha,reference});
  const head=await ledger(github,bootstrapPlan,reference.successor.plan);
  check(head?.sha===reference.successor.headSha&&head.state.phase==='qualified'&&same(head.state.plan,reference.successor.plan)
    &&same(head.state.data,reference.successor.proof)&&same(head.state.review,reference.successor.review),'BOOTSTRAP_SUCCESSOR_HEAD_CHANGED');return head;
}

/** CLI-first owner transport. The wrapper verifies frozen helper/controller bytes before
 * importing, then calls this BEFORE opening a fresh admin PG session. No role issuance,
 * token export, machine credential changes or secret argv/env/files occur here.
 */
export function createBootstrapSuccessorNative(input) { return nativeTransport(input,false); }
/** New frozen/qualified executing source may reconcile an older terminal attempt.
 * No Preview submission, claim, observation append, qualification or admission capability.
 * executingPlan is freshly bound to current PR/source/quality; target plan stays immutable.
 */
export function createBootstrapSuccessorReconciliationNative(input) { return nativeTransport(input,true); }
async function nativeTransport({bootstrapPlan,successorPlan:plan,executingPlan,cwd},reconciliation) {
  const executing=reconciliation?executingPlan:plan,snapshot=sourceSnapshot(cwd);assertPlan(plan,bootstrapPlan);assertPlan(executing,bootstrapPlan);
  check(snapshot.sha===executing.controllerSha&&snapshot.sourceDigest===executing.sourceDigest&&snapshot.lockDigest===executing.lockDigest,'BOOTSTRAP_SUCCESSOR_SOURCE_CHANGED');
  const pins=targets(),canonicalRoot='/Users/vincex/Documents/FCOS',gh='/Users/vincex/.local/gh/current/bin/gh',vc='/Users/vincex/.local/node-lts/current/bin/vercel';
  const ghEnv={PATH:process.env.PATH,HOME:process.env.HOME,GH_CONFIG_DIR:`${canonicalRoot}/.fcos-cli/github`,GH_REPO:pins.repository,GIT_TERMINAL_PROMPT:'0'};
  const vcEnv={PATH:process.env.PATH,HOME:process.env.HOME,CI:'1',NO_COLOR:'1'};
  const execute=(binary,args,env,input,raw=false)=>{try{return execFileSync(binary,args,{env,input,encoding:raw?undefined:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:raw?2097152:8*1024*1024});}catch{throw Error('BOOTSTRAP_SUCCESSOR_NATIVE_TRANSPORT_UNKNOWN');}};
  const route=path=>check(typeof path==='string'&&!/[\r\n\0]/.test(path)&&!/(?:^|\/)\.\.(?:\/|$|\?)/.test(path)&&(path==='/user'||path===base()||path.startsWith(`${base()}/`)),'BOOTSTRAP_SUCCESSOR_PROVIDER_ROUTE_REFUSED');
  const request=(path,body,method)=>{route(path);const args=['api',path,'--method',method||(body?'POST':'GET'),'-H','X-GitHub-Api-Version: 2022-11-28'];
    if(body)args.push('--input','-');try{return JSON.parse(execFileSync(gh,args,{env:ghEnv,input:body?JSON.stringify(body):undefined,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:8*1024*1024}));}
    catch(error){if(!body&&/\/actions\/variables\/FCOS_RAPID_RELEASE_(?:ENABLED|HANDOVER_ID)$/.test(path)&&/\(HTTP 404\)/.test(String(error.stderr)))return null;
      throw Error('BOOTSTRAP_SUCCESSOR_NATIVE_TRANSPORT_UNKNOWN');}};
  const github={read:async path=>request(path),write:async(path,body)=>request(path,body),patch:async(path,body)=>request(path,body,'PATCH'),
    async pages(path){const all=[];for(let page=1;page<=100;page++){const rows=request(`${path}${path.includes('?')?'&':'?'}page=${page}`);check(Array.isArray(rows),'BOOTSTRAP_SUCCESSOR_DISCOVERY_INCOMPLETE');all.push(...rows);if(rows.length<100)return all;}throw Error('BOOTSTRAP_SUCCESSOR_DISCOVERY_INCOMPLETE');},
    async archive(path){check(new RegExp(`^${base()}/actions/artifacts/[1-9][0-9]*/zip$`).test(path),'BOOTSTRAP_SUCCESSOR_PROVIDER_ROUTE_REFUSED');return execute(gh,['api',path,'--method','GET'],ghEnv,undefined,true);},
  };
  const repo=await owner(github);await source(github,executing,bootstrapPlan,repo,{requireOpen:true});
  if(reconciliation)await source(github,plan,bootstrapPlan,repo);
  const run=args=>execute(vc,[...args,'--scope',pins.team,'--no-color'],vcEnv).trim();
  check(run(['--version']).replace(/^Vercel CLI /,'')==='54.20.1','BOOTSTRAP_SUCCESSOR_VERCEL_VERSION_REQUIRED');
  const api=(path,body)=>{check(/^\/v[0-9]+\//.test(path)&&!/[\r\n\0]/.test(path)&&!path.includes('://'),'BOOTSTRAP_SUCCESSOR_PROVIDER_ROUTE_REFUSED');
    const args=['api',`${path}${path.includes('?')?'&':'?'}teamId=${pins.teamId}`,'--method',body?'POST':'GET'];
    if(body){const directory=join(cwd,'outputs','rapid-bootstrap-successor');persist(directory,plan,'native_request',body);args.push('--input',join(directory,plan.operationId,'native_request.json'));}
    args.push('--raw');try{return JSON.parse(run(args));}catch{throw Error('BOOTSTRAP_SUCCESSOR_NATIVE_TRANSPORT_UNKNOWN');}};
  const vercel={
    async identity(){check(run(['whoami'])===pins.vercelAccount,'BOOTSTRAP_SUCCESSOR_PROVIDER_IDENTITY_REQUIRED');const team=api(`/v2/teams/${pins.teamId}`);
      check(team.id===pins.teamId&&team.slug===pins.team,'BOOTSTRAP_SUCCESSOR_PROVIDER_IDENTITY_REQUIRED');return{user:{username:pins.vercelAccount},team};},
    async project(){const p=api(`/v9/projects/${pins.projectId}`);check(p.id===pins.projectId&&p.accountId===pins.teamId&&p.autoAssignCustomDomains===false
      &&p.link?.type==='github'&&Number(p.link.repoId)===1278654816,'BOOTSTRAP_SUCCESSOR_PROVIDER_IDENTITY_REQUIRED');return p;},
    async deployment(id){check(/^dpl_[A-Za-z0-9]+$/.test(id||''),'BOOTSTRAP_SUCCESSOR_DEPLOYMENT_REQUIRED');const d=api(`/v13/deployments/${id}`);
      check(d.id===id&&d.projectId===pins.projectId&&d.ownerId===pins.teamId,'BOOTSTRAP_SUCCESSOR_PROVIDER_IDENTITY_REQUIRED');return d;},
    async currentProduction(){const a=api(`/v4/aliases/${new URL(pins.origin).hostname}`),id=a.deploymentId||a.deployment?.id;
      check(a.alias===new URL(pins.origin).hostname&&a.projectId===pins.projectId&&!a.redirect,'BOOTSTRAP_SUCCESSOR_PROVIDER_IDENTITY_REQUIRED');const d=await vercel.deployment(id);
      check(d.target==='production'&&d.readyState==='READY','BOOTSTRAP_SUCCESSOR_PROVIDER_IDENTITY_REQUIRED');return{id,alias:a.alias,projectId:d.projectId,teamId:d.ownerId};},
    async find({operationId,controllerSha}){check(/^fcos-bootstrap-successor-[a-f0-9]{40}$/.test(operationId||'')&&isSha(controllerSha),'BOOTSTRAP_SUCCESSOR_PROVIDER_ROUTE_REFUSED');
      const result=[],ids=new Set();let until;for(let page=0;page<100;page++){
        const rows=api(`/v6/deployments?projectId=${pins.projectId}&limit=100${until?`&until=${until}`:''}`);check(Array.isArray(rows.deployments),'BOOTSTRAP_SUCCESSOR_DISCOVERY_INCOMPLETE');
        for(const item of rows.deployments){const id=item.uid||item.id;check(!ids.has(id),'BOOTSTRAP_SUCCESSOR_DISCOVERY_INCOMPLETE');ids.add(id);if(item.meta?.fcosBootstrapOperation===operationId)result.push(await vercel.deployment(id));}
        if(!rows.pagination?.next)return result;const next=Number(rows.pagination.next);check(Number.isFinite(next)&&(!until||next<until),'BOOTSTRAP_SUCCESSOR_DISCOVERY_INCOMPLETE');until=next;
      }throw Error('BOOTSTRAP_SUCCESSOR_DISCOVERY_INCOMPLETE');},
    async create(body){check(!reconciliation,'BOOTSTRAP_SUCCESSOR_RECONCILIATION_ONLY');const permit=writePermits.get(vercel);writePermits.delete(vercel);check(permit?.planHash===digest(plan)&&isSha(permit.headSha)&&same(body,bootstrapSuccessorRequest(plan)),'BOOTSTRAP_SUCCESSOR_PROVIDER_REQUEST_REFUSED');
      const s=sourceSnapshot(cwd);check(s.sha===plan.controllerSha&&s.sourceDigest===plan.sourceDigest&&s.lockDigest===plan.lockDigest,'BOOTSTRAP_SUCCESSOR_SOURCE_CHANGED');
      await owner(github);await vercel.identity();await vercel.project();check(digest(await vercel.configuration(plan.branch))===plan.configurationDigest,'BOOTSTRAP_SUCCESSOR_CONFIGURATION_CHANGED');
      check((await vercel.currentProduction()).id===plan.previousProductionId,'BOOTSTRAP_SUCCESSOR_PREVIEW_OR_ALIAS_CHANGED');return api('/v13/deployments',body);},
    async configuration(branch){check(!reconciliation,'BOOTSTRAP_SUCCESSOR_RECONCILIATION_ONLY');check(branch===plan.branch,'BOOTSTRAP_SUCCESSOR_PROVIDER_ROUTE_REFUSED');
      const project=await vercel.project(),rows=api(`/v10/projects/${pins.projectId}/env?decrypt=false`);
      check(Array.isArray(rows.envs)&&!rows.pagination?.next,'BOOTSTRAP_SUCCESSOR_NATIVE_CONFIGURATION_REQUIRED');return bootstrapSuccessorConfiguration({project,rows:rows.envs,branch});},
  };
  await vercel.identity();await vercel.project();
  if(!reconciliation)check(digest(await vercel.configuration(plan.branch))===plan.configurationDigest,'BOOTSTRAP_SUCCESSOR_CONFIGURATION_CHANGED');
  transportKinds.set(vercel,reconciliation?'reconciliation':'release');return{github,vercel,source:snapshot};
}
