import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { userInfo } from 'node:os';
import { digest, requireCondition, sourceSnapshot, targets } from './contract.mjs';
import { validateAdministratorApplicationInventory } from './handover.mjs';
import { createDatabaseCredentialIntentStore } from './database-intent.mjs';
import { readBootstrapDatabase } from './bootstrap.mjs';

const CANONICAL = '/Users/vincex/Documents/FCOS';
const VERCEL = '/Users/vincex/.local/node-lts/current/bin/vercel';
const GITHUB = '/Users/vincex/.local/gh/current/bin/gh';
const requireValue = requireCondition;
export function githubBootstrapPath(path) {
  const base = `/repos/${targets().repository}`;
  requireValue(typeof path === 'string' && !/[\r\n\0]/.test(path) && !path.includes('..')
    && (path === '/user' || path === base || path.startsWith(`${base}/`)), 'BOOTSTRAP_GITHUB_ROUTE_REFUSED');
  return path;
}
export function decodeBootstrapPrivateInput(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 65536, 'BOOTSTRAP_PRIVATE_INPUT_REQUIRED');
  let input;try { input = JSON.parse(bytes.toString('utf8')); } catch { throw Error('BOOTSTRAP_PRIVATE_INPUT_INVALID'); }
  requireValue(input && Object.keys(input).sort().join(',') === 'credential,inventoryPath'
    && typeof input.inventoryPath === 'string' && input.credential && input.credential.kind === 'supabase_management'
    && Object.keys(input.credential).sort().join(',') === 'kind,token'
    && typeof input.credential.token === 'string' && input.credential.token.length >= 20
    && !/[\r\n\0]/.test(input.credential.token), 'BOOTSTRAP_PRIVATE_INPUT_INVALID');
  return input;
}

// Credential issuance is itself effectful: require native exact-source quality
// before opening the delegated database connection, not only before Preview.
export async function assertBootstrapQualityBeforeCredential({github,source}) {
  const base=`/repos/${targets().repository}`;
  const [pr,ref,checks]=await Promise.all([github.read(`${base}/pulls/124`),
    github.read(`${base}/git/ref/heads/${encodeURIComponent('codex/rapid-controller-install-20261106')}`),
    github.read(`${base}/commits/${source.sha}/check-runs?check_name=code-and-database&filter=latest&per_page=100`)]);
  requireValue(pr.state==='open' && pr.base?.repo?.full_name===targets().repository && pr.base.ref==='main'
    && pr.head?.repo?.full_name===targets().repository && pr.head.ref==='codex/rapid-controller-install-20261106'
    && pr.head.sha===source.sha && ref.object?.sha===source.sha,'BOOTSTRAP_EXACT_PR_REQUIRED');
  const check=checks.check_runs?.filter(row=>row.name==='code-and-database' && row.head_sha===source.sha
    && row.app?.id===15368).sort((a,b)=>b.id-a.id)[0];
  requireValue(checks.total_count<=100 && check?.status==='completed' && check.conclusion==='success','BOOTSTRAP_NATIVE_QUALITY_REQUIRED');
  const match=check.details_url?.match(new RegExp(`^https://github.com/${targets().repository}/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)$`));
  requireValue(match,'BOOTSTRAP_NATIVE_QUALITY_REQUIRED');
  const [run,job]=await Promise.all([github.read(`${base}/actions/runs/${match[1]}`),github.read(`${base}/actions/jobs/${match[2]}`)]);
  requireValue(run.id===Number(match[1]) && job.id===Number(match[2]) && run.head_sha===source.sha && job.head_sha===source.sha
    && run.event==='pull_request' && run.repository?.full_name===targets().repository && run.head_repository?.full_name===targets().repository
    && String(run.path).split('@')[0]==='.github/workflows/quality.yml' && job.run_id===run.id
    && job.name==='code-and-database' && job.status==='completed' && job.conclusion==='success','BOOTSTRAP_NATIVE_QUALITY_REQUIRED');
}

// This is a local, source-pinned bootstrap transport. It never receives candidate
// code, exports credentials, changes auth profiles, or manufactures Preview proof.
export async function createBootstrapNative({ plan, cwd, privateInput }) {
  requireValue(userInfo().username === 'vincex' && process.version === 'v24.18.0', 'BOOTSTRAP_LOCAL_CONTEXT_REQUIRED');
  const pins = targets(), root = realpathSync(cwd), source = sourceSnapshot(root);
  if (plan) requireValue(plan.controllerSha === source.sha, 'BOOTSTRAP_SOURCE_CHANGED');
  const input = decodeBootstrapPrivateInput(privateInput);
  const report = validateAdministratorApplicationInventory(JSON.parse(readFileSync(resolve(input.inventoryPath), 'utf8')));
  const ghEnv = { PATH:process.env.PATH, HOME:process.env.HOME, GH_CONFIG_DIR:`${CANONICAL}/.fcos-cli/github`, GH_REPO:pins.repository, GIT_TERMINAL_PROMPT:'0' };
  const cliEnv = { PATH:process.env.PATH, HOME:process.env.HOME, CI:'1', NO_COLOR:'1' };
  const execute = (binary,args,env,body) => {
    try { return execFileSync(binary,args,{env,input:body,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:8*1024*1024}).trim(); }
    catch { throw Error('BOOTSTRAP_NATIVE_TRANSPORT_UNCERTAIN'); }
  };
  const ghRequest = (path, body) => {
    githubBootstrapPath(path);
    const args=['api',path,'--method',body === undefined ? 'GET':'POST','-H','X-GitHub-Api-Version: 2022-11-28'];
    if(body !== undefined) args.push('--input','-');
    return JSON.parse(execute(GITHUB,args,ghEnv,body === undefined ? undefined:JSON.stringify(body)));
  };
  const base=`/repos/${pins.repository}`;
  const github = {
    read:path=>Promise.resolve(ghRequest(path)),
    write:(path,body)=>Promise.resolve(ghRequest(path,body)),
    async pages(path) {
      const all=[];
      for(let page=1;page<=100;page++) {
        const data=ghRequest(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
        const rows=Array.isArray(data)?data:data.workflows || data.workflow_runs || data.check_runs;
        requireValue(Array.isArray(rows),'BOOTSTRAP_NATIVE_PAGE_INVALID');all.push(...rows);
        if(rows.length<100)return all;
      }
      throw Error('BOOTSTRAP_NATIVE_PAGINATION_INCOMPLETE');
    },
    async inventory() {
      validateAdministratorApplicationInventory(report);
      const [hooks,workflows]=await Promise.all([github.pages(`${base}/hooks`),github.pages(`${base}/actions/workflows`)]);
      return {repositoryId:repository.id,
        installations:report.entries.map(row=>({installationId:row.installationId,appId:row.appId,name:row.name,events:row.events,permissions:row.permissions,repositoryScope:row.repositoryScope,configurationState:row.configurationState,disposition:row.disposition})).sort((a,b)=>a.installationId-b.installationId),
        hooks:hooks.map(row=>({id:row.id,active:row.active,events:row.events.slice().sort(),host:new URL(row.config.url).hostname})).sort((a,b)=>a.id-b.id),
        workflows:workflows.map(row=>({id:row.id,path:row.path,state:row.state})).sort((a,b)=>a.id-b.id)};
    },
  };
  const operator=await github.read('/user'),repository=await github.read(base);
  requireValue(operator.login===pins.account && repository.full_name===pins.repository && repository.permissions?.admin===true,'BOOTSTRAP_GITHUB_IDENTITY_MISMATCH');
  const vercelRun=args=>execute(VERCEL,[...args,'--scope',pins.team,'--no-color'],cliEnv);
  requireValue(vercelRun(['--version']).replace(/^Vercel CLI /,'')==='54.20.1','BOOTSTRAP_VERCEL_VERSION_REQUIRED');
  const vget = path => {
    requireValue(/^\/v\d+\//.test(path) && !path.includes('://') && !/[\r\n\0]/.test(path),'BOOTSTRAP_VERCEL_ROUTE_REFUSED');
    return JSON.parse(vercelRun(['api',`${path}${path.includes('?')?'&':'?'}teamId=${pins.teamId}`,'--method','GET','--raw']));
  };
  let database;
  const vercel = {
    async identity() {
      requireValue(vercelRun(['whoami'])===pins.vercelAccount,'BOOTSTRAP_VERCEL_ACCOUNT_MISMATCH');
      const team=vget(`/v2/teams/${pins.teamId}`);
      requireValue(team.id===pins.teamId && team.slug===pins.team,'BOOTSTRAP_VERCEL_TEAM_MISMATCH');
      return {user:{username:pins.vercelAccount},team:{id:team.id,slug:team.slug}};
    },
    async project() {const p=vget(`/v9/projects/${pins.projectId}`);requireValue(p.id===pins.projectId && p.accountId===pins.teamId && p.autoAssignCustomDomains===false,'BOOTSTRAP_VERCEL_PROJECT_MISMATCH');return p;},
    async currentProduction() {
      const alias=vget(`/v4/aliases/${new URL(pins.origin).host}`),id=alias.deploymentId || alias.deployment?.id;
      const d=await vercel.deployment(id);
      requireValue(d.target==='production' && d.readyState==='READY','BOOTSTRAP_PRODUCTION_READBACK_REQUIRED');
      return {id:d.id,alias:new URL(pins.origin).host,projectId:d.projectId,teamId:d.ownerId};
    },
    async deployment(id) {
      requireValue(/^dpl_[A-Za-z0-9]+$/.test(id || ''),'BOOTSTRAP_DEPLOYMENT_ID_REFUSED');
      const d=vget(`/v13/deployments/${id}`);
      requireValue(d.projectId===pins.projectId && d.ownerId===pins.teamId,'BOOTSTRAP_DEPLOYMENT_TARGET_MISMATCH');return d;
    },
    async findDeployments({operationId,controllerSha,since}) {
      const all=[];let until;
      const after=typeof since==='number'?since:Date.parse(since);
      requireValue(Number.isFinite(after),'BOOTSTRAP_DISCOVERY_TIME_REQUIRED');
      for(let page=0;page<100;page++) {
        const list=vget(`/v6/deployments?projectId=${pins.projectId}&limit=100&since=${after}${until?`&until=${until}`:''}`);
        requireValue(Array.isArray(list.deployments),'BOOTSTRAP_DEPLOYMENT_LIST_INVALID');
        for(const d of list.deployments.filter(d=>d.meta?.fcosBootstrapOperation===operationId && d.meta?.githubCommitSha===controllerSha)) {
          all.push(await vercel.deployment(d.id || d.uid));
        }
        if(!list.pagination?.next)return all;
        until=Number(list.pagination.next);requireValue(Number.isFinite(until),'BOOTSTRAP_DISCOVERY_CURSOR_INVALID');
      }
      throw Error('BOOTSTRAP_DEPLOYMENT_DISCOVERY_INCOMPLETE');
    },
    async create(request) {
      requireValue(plan && database,'BOOTSTRAP_WRITE_ADMISSION_REQUIRED');
      requireValue(Object.keys(request).sort().join(',')==='gitSource,meta,name,project'
        && request.project===pins.projectId && request.name==='fcos'
        && request.gitSource?.type==='github' && request.gitSource.repoId===repository.id
        && request.gitSource.sha===source.sha && request.gitSource.ref===plan.branch
        && request.gitSource.prId===124 && request.meta?.fcosBootstrapOperation===plan.operationId
        && request.meta.fcosBootstrapPlanHash===digest(plan),
      'BOOTSTRAP_REQUEST_REFUSED');
      requireValue(sourceSnapshot(root).sourceDigest===source.sourceDigest,'BOOTSTRAP_SOURCE_CHANGED');
      const currentOperator=await github.read('/user');requireValue(currentOperator.login===pins.account,'BOOTSTRAP_GITHUB_IDENTITY_MISMATCH');
      await vercel.identity();await vercel.project();
      requireValue((await readBootstrapDatabase(database)).control.mode==='frozen','BOOTSTRAP_WRITE_ADMISSION_REQUIRED');
      requireValue((await vercel.currentProduction()).id===plan.previousProductionId,'BOOTSTRAP_PRODUCTION_BASELINE_CHANGED');
      const admission=(await database.db.query("select c.mode,c.epoch,c.operation_id,c.bootstrap_id,c.recovery_id,c.source_upgrade_id,c.plan_completion_id,r.evidence from fcos_release_coordination.control c join fcos_release_coordination.rapid_bootstrap_receipts r on r.operation_id=$1 and r.plan_hash=$2 and r.controller_sha=$3 and r.phase='vercel_intent' where c.singleton",[plan.operationId,digest(plan),source.sha])).rows;
      requireValue(admission.length===1 && admission[0].mode==='frozen' && Number(admission[0].epoch)===1
        && ['operation_id','bootstrap_id','recovery_id','source_upgrade_id','plan_completion_id'].every(k=>admission[0][k]===null)
        && admission[0].evidence.requestHash===digest(request),'BOOTSTRAP_WRITE_ADMISSION_REQUIRED');
      const output=join(root,'outputs','rapid-bootstrap',plan.operationId);mkdirSync(output,{recursive:true,mode:0o700});
      const file=join(output,'native-vercel-request.json');writeFileSync(file,JSON.stringify(request),{mode:0o600});
      return JSON.parse(vercelRun(['api',`/v13/deployments?teamId=${pins.teamId}`,'--method','POST','--input',file,'--raw']));
    },
  };
  await vercel.identity();await vercel.project();
  await assertBootstrapQualityBeforeCredential({github,source});
  const {openPinnedDatabase}=await import('./database-connection.mjs');
  const intentStore=await createDatabaseCredentialIntentStore({credential:input.credential,directory:root,source,
    purpose:'controller_preview_bootstrap',github});
  database=await openPinnedDatabase({credential:input.credential,intentStore,
    caFile:join(CANONICAL,'outputs/rapid-release-implementation-20261106-01a1b035/supabase-project-ca.crt')});
  return {github,vercel,db:database.db,connection:database.connection};
}
