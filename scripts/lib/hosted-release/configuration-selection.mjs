import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonical, digest, fail } from './contract.mjs';

export const CONFIGURATION_SELECTION = 'detached_node24_before_candidate_v1';
const forbidden = /^(?:NODE_OPTIONS|BASH_ENV|ENV|PATH|SHELL|SHELLOPTS|BASHOPTS|BASH_FUNC_.*|LD_.*|DYLD_.*|VERCEL_GIT_.*|GIT_.*|NPM_CONFIG_.*|npm_config_.*|HUGO_VERSION|ZOLA_VERSION|GUTENBERG_VERSION)$/;
/** Only public hashes enter the build. The first Node/npm entry fails before any
 * candidate lifecycle script when Vercel selected another branch or source. */
export function selectionBuildGuard(manifest) {
  if(!/^[a-f0-9]{40}$/.test(manifest?.candidate?.sha||'')) fail('CONFIGURATION_SELECTION_SOURCE_INVALID');
  const proof = `FCOS_CONFIGURATION_SELECTION:${digest(manifest)}:HEAD:${manifest.candidate.sha}`;
  // Inherited Node version probes parse stdout. Keep the proof synchronous and
  // on stderr so the guard cannot become a framework/package version value.
  const source = `import{writeSync}from'node:fs';if(process.versions.node.split('.')[0]!=='24'||process.env.VERCEL_GIT_COMMIT_REF!=='HEAD'||process.env.VERCEL_GIT_COMMIT_SHA!==${JSON.stringify(manifest.candidate.sha)})throw Error('FCOS_CONFIGURATION_SELECTION_REFUSED');writeSync(2,${JSON.stringify(proof+'\n')});`;
  return { proof, nodeOptions: `--import=data:text/javascript,${encodeURIComponent(source)}` };
}
/** No execution of repository code here. No shell before the pinned npm entry. */
export function assertSelectionSource(directory, manifest, { git = (args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore','pipe','pipe'] }).trim() } = {}) {
  let detached = false;
  try { git(['symbolic-ref','-q','HEAD']); } catch (error) { detached = error.status === 1; }
  if (!detached || git(['rev-parse','--show-toplevel']) !== resolve(directory) || git(['rev-parse','--abbrev-ref','HEAD']) !== 'HEAD'
    || git(['rev-parse','HEAD']) !== manifest.candidate.sha || git(['status','--porcelain','--untracked-files=no'])
    || ![`https://github.com/${manifest.targets.repository}.git`, `https://github.com/${manifest.targets.repository}`].includes(git(['remote','get-url','origin']))) fail('CONFIGURATION_SELECTION_SOURCE_INVALID');
  const config = JSON.parse(readFileSync(join(directory,'vercel.json'),'utf8'));
  const pkg = JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
  const settings = manifest.verification.projectSettings;
  // npm itself is the first untrusted-build entry. Preinstall/install/postinstall
  // hooks cannot run until Node has passed the guard. Do not allow a shell prefix.
  const install = config.installCommand ?? settings.installCommand ?? 'npm install';
  const build = config.buildCommand ?? settings.buildCommand ?? 'npm run build';
  if (![null,''].includes(settings.rootDirectory??null) || install !== 'npm ci' || build !== 'npm run build' || settings.nodeVersion !== '24.x'
    || config.framework && config.framework !== 'vite' || settings.framework !== 'vite'
    || config.services || config.experimental || config.bunVersion || pkg.engines?.bun || pkg.engines?.node !== '24.x' || config.builds || config.functions && Object.values(config.functions).some(row => row.runtime)
    || config.build?.env || config.env || config.git?.deploymentEnabled === true
    || pkg.packageManager && !/^npm@\d+\.\d+\.\d+$/.test(pkg.packageManager)
    || ['vercel.ts','vercel.toml','now.json','.npmrc','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb','.pnp.cjs'].some(file => existsSync(join(directory,file)))) fail('CONFIGURATION_SELECTION_ENTRY_INVALID');
  return { strategy: CONFIGURATION_SELECTION, branch: 'HEAD', candidateSha: manifest.candidate.sha, installCommand: install, buildCommand: build };
}
/** Inspect names/scope only; never persist or report provider values. Complete
 * records are mandatory so an entrypoint override cannot be hidden by paging. */
export function assertSelectionEnvironment(project, records, manifest) {
  if (project.bunVersion || ![null,''].includes(project.rootDirectory??null) || ![null,''].includes(manifest.verification.projectSettings.rootDirectory??null) || project.autoExposeSystemEnvs !== true || !Array.isArray(records)) fail('CONFIGURATION_SELECTION_SYSTEM_ENV_REQUIRED');
  for (const record of records) {
    if (typeof record.key !== 'string' || !Array.isArray(record.target)) fail('CONFIGURATION_SELECTION_ENV_INCOMPLETE');
    if (forbidden.test(record.key)) fail('CONFIGURATION_SELECTION_ENV_OVERRIDE');
  }
  if (canonical(project.rootDirectory ?? null) !== canonical(manifest.verification.projectSettings.rootDirectory ?? null)) fail('CONFIGURATION_SELECTION_ROOT_CHANGED');
  return true;
}

export async function collectSelectionEnvironment({read, project, manifest}) {
  const records=[];
  const routes=[{path:`/v10/projects/${manifest.targets.vercelProject}/env?decrypt=false`,field:'envs'},
    {path:`/v1/env?projectId=${manifest.targets.vercelProject}`,field:'data'}];
  for(const route of routes){let until;const seen=new Set();for(let page=0;page<20;page++){
    const response=await read(`${route.path}${until===undefined?'':`&until=${until}`}`);
    const rows=response?.[route.field],pagination=response?.pagination;
    if(!Array.isArray(rows)||pagination&&(!Number.isSafeInteger(pagination.count)||pagination.count!==rows.length)
      ||route.field==='data'&&(!pagination||!Object.hasOwn(pagination,'next')))fail('CONFIGURATION_SELECTION_ENV_INCOMPLETE');
    for(const row of rows){if(typeof row?.key!=='string'||route.field==='data'&&(!Array.isArray(row.projectId)||!row.projectId.includes(manifest.targets.vercelProject))
      ||row.ownerId&&row.ownerId!==manifest.targets.vercelTeam)fail('CONFIGURATION_SELECTION_ENV_INCOMPLETE');
      records.push({key:row.key,target:typeof row.target==='string'?[row.target]:row.target});}
    const next=pagination?.next;
    if(next===undefined||next===null)break;
    if(!Number.isSafeInteger(next)||next<0||seen.has(next)||page===19)fail('CONFIGURATION_SELECTION_ENV_INCOMPLETE');seen.add(next);until=next;
  }}
  assertSelectionEnvironment(project,records,manifest);
  return {strategy:CONFIGURATION_SELECTION,recordCount:records.length,complete:true};
}

/** Preserve the provider's field presence. Absence is not a provider false.
 * GitHub is the native CLI metadata namespace; conflicting generic metadata denies. */
export function selectionDeploymentMetadata(value) {
  const meta=value?.meta||{};
  const choose=(native,generic)=>{
    if(Object.hasOwn(meta,native)&&Object.hasOwn(meta,generic)&&meta[native]!==meta[generic])fail('CONFIGURATION_SELECTION_METADATA_CONFLICT');
    return Object.hasOwn(meta,native)?meta[native]:meta[generic];
  };
  return {gitCommitRef:choose('githubCommitRef','gitCommitRef'),gitCommitSha:choose('githubCommitSha','gitCommitSha'),
    source:value?.source??null,prebuiltFieldPresent:Object.hasOwn(value||{},'prebuilt'),prebuiltRaw:Object.hasOwn(value||{},'prebuilt')?value.prebuilt:null};
}
const same=(a,b)=>a===undefined||b===undefined?a===b:canonical(a)===canonical(b);
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
// Exact existing controller requests, including the staged Production alias hold.
export function selectionSourceDeployRequest(manifest,production) {
  return production?{candidate:manifest.candidate,previous:manifest.previousProduction,target:'production',skipDomain:true}
    :{candidate:manifest.candidate,target:'preview'};
}
function sourceArguments(args,manifest,hosted) {
  if(!Array.isArray(args)||args.some(v=>typeof v!=='string')||args.filter(v=>v==='deploy').length!==1
    ||args.some(v=>/^--prebuilt(?:=|$)/.test(v)||/^--token(?:=|$)/.test(v)||/^--(?:target|prod|build-env|env|meta)=/.test(v)))fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
  const values=flag=>args.flatMap((v,i)=>v===flag?[args[i+1]]:[]);
  const exactly=(flag,value)=>values(flag).length===1&&values(flag)[0]===value;
  const guard=selectionBuildGuard(manifest),meta=values('--meta'),build=values('--build-env');
  const unique=(list,key,value)=>list.filter(v=>v?.startsWith(key+'=')).length===1&&list.includes(key+'='+value);
  if(!unique(meta,'githubCommitSha',manifest.candidate.sha)
    ||!unique(meta,'fcosConfigurationSelectionSha256',digest(guard.nodeOptions))
    ||!unique(meta,hosted?'fcosHostedManifest':'fcosSelectionObservation',digest(manifest))
    ||!unique(build,'NODE_OPTIONS',guard.nodeOptions)||!unique(build,'FCOS_BUILD_COMMIT_SHA',manifest.candidate.sha)
    ||!unique(build,'FCOS_EXPECTED_SOURCE_SHA256',manifest.candidate.sourceSha256)
    ||(!args.includes('--prod')&&!exactly('--target','preview'))
    ||(!hosted&&args.includes('--prod')))fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
  return digest(args);
}
/** Pure integrity validation only. Hosted callers must read their authenticated
 * coordinator; native operators must authenticate original local journal/ACK
 * provenance. A hash or this function never authenticates those providers. */
export function assertSelectionSourceBuildEvidence(evidence,deployment,manifest) {
  const bad=()=>fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
  const hosted=evidence?.kind==='fcos_hosted_selection_source_build_v1';
  if(!hosted&&evidence?.kind!=='fcos_native_selection_source_build_v1')bad();
  const argsHash=sourceArguments(evidence.arguments,manifest,hosted),bound=digest(manifest);
  if(hosted){
    const {registration:r,operation:o}=evidence,result=o?.evidence?.result;
    const phase=deployment.target==='preview'?'preview.create':'production.stage',operationId=`${manifest.releaseId}-${phase.replaceAll('.','-')}`;
    const requestHash=digest(selectionSourceDeployRequest(manifest,deployment.target!=='preview'));
    if(!r||r.release_id!==manifest.releaseId||r.manifest_hash!==bound||r.epoch!==manifest.epoch||!same(r.manifest,manifest)
      ||!o||o.operationId!==operationId||o.operation_id!==operationId||o.release_id!==manifest.releaseId||o.epoch!==manifest.epoch
      ||o.phase!==phase||o.manifest_hash!==bound||o.requestHash!==requestHash||o.request_hash!==requestHash
      ||o.state!=='complete'||o.evidence?.outcome!=='applied'||result?.id!==deployment.id)bad();
    const receipt={schemaVersion:1,kind:'fcos_hosted_vercel_source_deploy_v1',operationId,phase,requestHash,manifestHash:bound,
      controllerSha:manifest.controller.sha,candidateSha:manifest.candidate.sha,argumentsSha256:argsHash,cliVersion:'54.20.1'};
    const readback={...receipt,kind:'fcos_hosted_vercel_source_deploy_readback_v1',basis:'authenticated_provider_owner_readback',deploymentId:deployment.id};
    const ack=Object.hasOwn(result,'sourceDeploy'),recovered=Object.hasOwn(result,'sourceDeployReadback'),fresh=Object.hasOwn(evidence,'providerReadback');
    if(Number(ack)+Number(recovered)+Number(fresh)!==1||ack&&!same(result.sourceDeploy,receipt)
      ||recovered&&!same(result.sourceDeployReadback,readback)||fresh&&!same(evidence.providerReadback,readback))bad();
    return {kind:evidence.kind,operationId,argumentsSha256:argsHash,basis:ack?'cli_ack':'authenticated_provider_owner_readback'};
  }
  if(![null,undefined,'preview'].includes(deployment.target))bad();
  const {attempt,prepared,submitting,submitted,guardedNative}=evidence,lease=prepared?.lease,native=guardedNative?.native;
  const at=[prepared?.at,submitting?.at,attempt?.at,submitted?.at].map(v=>Date.parse(v));
  if(!lease||lease.epoch!=='production-reconciliation-20261005'||lease.objective!=='production'||lease.ownerThreadId!=='01a0f08b-7fcb-7870-9edc-343e16052b62'
    ||lease.coordinationOnly!==true||lease.providerAuthorityGranted!==false||lease.uncertainOutcomeRequiresReadback!==true
    ||!validHash(lease.bindingSha256)||!lease.operationId||!lease.leaseId
    ||!same(lease,submitting?.lease)||!same(lease,submitted?.lease)||!same(lease,guardedNative?.guarded?.lease)
    ||prepared?.state!=='prepared'||submitting?.state!=='submitting'||submitted?.state!=='submitted'
    ||[prepared,submitting,submitted].some(v=>v?.durable!==true)||at.some(v=>!Number.isFinite(v))||at.some((v,i)=>i>0&&v<at[i-1])
    ||attempt?.operationId!==lease.operationId||attempt.leaseId!==lease.leaseId||attempt.packetSha256!==bound
    ||!validHash(attempt.scriptSha256)||attempt.argsSha256!==argsHash||attempt.consequentialCreateAttempts!==1||attempt.uncertainOutcomeReadbackOnly!==true
    ||guardedNative?.guarded?.status!=='submitted_acknowledged'||!native||native.exit_code!==0||native.error||native.signal
    ||Object.hasOwn(native,'session_id')||Object.hasOwn(native,'sessionId')||typeof native.output!=='string'
    ||!same(guardedNative.guarded.providerResult,native))bad();
  const action=evidence.actionAdmission;
  if(typeof action?.json!=='string'||Buffer.byteLength(action.json)>65536||!validHash(action.sha256)
    ||digest(action.json)!==action.sha256||lease.bindingSha256!==action.sha256)bad();
  let admission;try{admission=JSON.parse(action.json);}catch{bad();}
  if(admission.kind!=='root_ordinary_preview_observation_action_acceptance_v1'||admission.accepted!==true||admission.reviewerId!=='/root'
    ||admission.operationId!==lease.operationId||admission.planPacketSha256!==bound||admission.scriptSha256!==attempt.scriptSha256
    ||admission.guardedByActualAcceptedJsPythonSequence!==true||admission.existingManagerCredentialOnly!==true
    ||admission.productionAuthorityGranted!==false||admission.financialAuthorityGranted!==false||admission.hostedQualificationAccepted!==false)bad();
  let ack;try{ack=JSON.parse(native.output);}catch{bad();}
  if(ack.kind!=='actual_native_preview_create_ack_v1'||ack.completedNativeExitCode!==0||ack.packetSha256!==bound
    ||ack.url!==deployment.url||ack.readyProven!==false)bad();
  return {kind:evidence.kind,operationId:lease.operationId,argumentsSha256:argsHash};
}
/** Native logs remain in memory. Persist public marker/order and source-build
 * provenance only. Neither missing prebuilt metadata nor candidate output proves
 * a source build. Actual READY remains required independently of these logs. */
export function assertSelectionBuildEvidence(events, deployment, manifest, sourceBuildEvidence) {
  const {proof}=selectionBuildGuard(manifest);
  if(!Array.isArray(events)||!events.length||deployment.state!=='READY'
    ||deployment.sha!==manifest.candidate.sha||deployment.customEnvironment!==null
    ||deployment.gitCommitRef!=='HEAD'||deployment.gitCommitSha!==manifest.candidate.sha||deployment.source!=='cli'
    ||typeof deployment.prebuiltFieldPresent!=='boolean'||deployment.prebuiltFieldPresent&&deployment.prebuiltRaw!==false
    ||!deployment.prebuiltFieldPresent&&deployment.prebuiltRaw!==null
    ||deployment.selectionGuardSha256!==digest(selectionBuildGuard(manifest).nodeOptions))fail('CONFIGURATION_SELECTION_BUILD_UNPROVEN');
  const provenance=assertSelectionSourceBuildEvidence(sourceBuildEvidence,deployment,manifest);
  const lines=events.map(event=>event?.payload?.text??event?.text??'');
  const build=lines.findIndex(text=>text.trim()==='Running "vercel build"');
  const install=lines.findIndex(text=>text.trim()==='Running "install" command: `npm ci`...');
  const marker=lines.findIndex(text=>text.trim()===proof);
  if(build<0||install<=build||marker<=install||lines.some(text=>text.includes('FCOS_CONFIGURATION_SELECTION:')&&text.trim()!==proof)
    ||lines.slice(0,marker).some(text=>/^>\s/.test(text)||/FORGED_SELECTION_SUCCESS/.test(text)))fail('CONFIGURATION_SELECTION_BUILD_UNPROVEN');
  return {strategy:CONFIGURATION_SELECTION,deploymentId:deployment.id,manifestHash:digest(manifest),candidateSha:manifest.candidate.sha,
    guardSha256:digest(selectionBuildGuard(manifest).nodeOptions),marker:proof,markerIndex:marker,nativeBuildLogVerified:true,
    buildKind:'provider_source_build',prebuiltFieldPresent:deployment.prebuiltFieldPresent,prebuiltRaw:deployment.prebuiltRaw,sourceBuild:provenance};
}
