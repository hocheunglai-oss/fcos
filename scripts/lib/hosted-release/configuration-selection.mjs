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
  const source = `if(process.versions.node.split('.')[0]!=='24'||process.env.VERCEL_GIT_COMMIT_REF!=='HEAD'||process.env.VERCEL_GIT_COMMIT_SHA!==${JSON.stringify(manifest.candidate.sha)})throw Error('FCOS_CONFIGURATION_SELECTION_REFUSED');console.log(${JSON.stringify(proof)});`;
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

/** Native logs remain in memory. Persist only public marker/order proof, never
 * arbitrary candidate output. The marker is evidence of startup, not a signature. */
export function assertSelectionBuildEvidence(events, deployment, manifest) {
  const {proof}=selectionBuildGuard(manifest);
  if(!Array.isArray(events)||!events.length||deployment.state!=='READY'
    ||deployment.sha!==manifest.candidate.sha||deployment.customEnvironment!==null
    ||deployment.gitCommitRef!=='HEAD'||deployment.gitCommitSha!==manifest.candidate.sha
    ||deployment.prebuilt!==false||deployment.selectionGuardSha256!==digest(selectionBuildGuard(manifest).nodeOptions))fail('CONFIGURATION_SELECTION_BUILD_UNPROVEN');
  const lines=events.map(event=>event?.payload?.text??event?.text??'');
  const marker=lines.findIndex(text=>text.trim()===proof);
  if(marker<0||lines.some(text=>text.includes('FCOS_CONFIGURATION_SELECTION:')&&text.trim()!==proof)
    ||lines.slice(0,marker).some(text=>/^>\s/.test(text)||/FORGED_SELECTION_SUCCESS/.test(text)))fail('CONFIGURATION_SELECTION_BUILD_UNPROVEN');
  return {strategy:CONFIGURATION_SELECTION,deploymentId:deployment.id,manifestHash:digest(manifest),candidateSha:manifest.candidate.sha,
    guardSha256:digest(selectionBuildGuard(manifest).nodeOptions),marker:proof,markerIndex:marker,nativeBuildLogVerified:true};
}
