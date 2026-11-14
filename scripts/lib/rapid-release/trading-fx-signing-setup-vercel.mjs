import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { digest, requireCondition as check, targets } from './contract.mjs';
import { publicKeyName, signedCallbackVariables } from './trading-fx-signing-setup.mjs';

const keys = [...Object.keys(signedCallbackVariables), publicKeyName];
const oldHmac = 'SALESFORCE_COMPANY_FX_SIGNING_SECRET';
const allowed = new Set([...keys, oldHmac]);
const byId = (a,b) => a.id.localeCompare(b.id);
const timestamp = value => typeof value === 'number' && Number.isFinite(value);

function normalizeRow(row) {
  check(typeof row?.key === 'string' && /^[A-Za-z0-9_-]{8,}$/u.test(row.id || '')
    && typeof row.type === 'string' && Array.isArray(row.target)
    && row.target.every(value => typeof value === 'string') && timestamp(row.updatedAt),
  'SIGNING_SETUP_VERCEL_CATALOG_INVALID');
  return {id:row.id,key:row.key,type:row.type,target:[...row.target].sort(),updatedAt:row.updatedAt,
    gitBranch:row.gitBranch ?? null,customEnvironmentIds:[...(row.customEnvironmentIds ?? [])].sort(),
    createdAt:row.createdAt ?? null,createdBy:row.createdBy ?? null,comment:row.comment ?? null};
}

export function normalizedSigningEnvironment(project, rows, sharedRows) {
  const pins = targets();
  check(project?.id === pins.projectId && project.accountId === pins.teamId && project.autoAssignCustomDomains === false
    && Array.isArray(rows) && Array.isArray(sharedRows) && sharedRows.length === 0,
  'SIGNING_SETUP_VERCEL_PROJECT_CHANGED');
  const environment = rows.map(normalizeRow).sort(byId);
  check(new Set(environment.map(row => row.id)).size === environment.length,'SIGNING_SETUP_VERCEL_CATALOG_INVALID');
  return {project:{projectId:project.id,accountId:project.accountId,nodeVersion:project.nodeVersion,
    framework:project.framework,rootDirectory:project.rootDirectory,buildCommand:project.buildCommand,
    installCommand:project.installCommand,outputDirectory:project.outputDirectory,
    autoAssignCustomDomains:project.autoAssignCustomDomains},environment,shared:[]};
}

function compatibility(snapshot) {
  const { autoAssignCustomDomains: _auto, ...project } = snapshot.project;
  const environment = snapshot.environment.filter(row => row.target.includes('production'))
    .map(({id,key,type,target,updatedAt}) => ({id,key,type,target,updatedAt}));
  return { ...project, environment };
}

function newKeyValues(key) {
  check(typeof key === 'string' && key.startsWith('-----BEGIN PUBLIC KEY-----\n'),'SIGNING_SETUP_VERCEL_KEY_INVALID');
  const publicKey = createPublicKey(key);
  check(publicKey.asymmetricKeyType === 'rsa' && publicKey.asymmetricKeyDetails.modulusLength === 2048
    && publicKey.export({format:'pem',type:'spki'}) === key,'SIGNING_SETUP_VERCEL_KEY_INVALID');
  return {...signedCallbackVariables,[publicKeyName]:key};
}

export async function readSigningEnvironment({env,vercel,execute = execFileSync}) {
  const pins = targets(), path = '/v10/projects/' + pins.projectId + '/env';
  const commandEnv = {PATH:env.PATH,HOME:env.HOME,CI:'1',VERCEL_TOKEN:env.VERCEL_TOKEN,
    VERCEL_PROJECT_ID:pins.projectId,VERCEL_ORG_ID:pins.teamId};
  const get = route => JSON.parse(execute('vercel',['api',route+(route.includes('?')?'&':'?')+'teamId='+pins.teamId,'--method','GET','--raw','--scope',pins.team,'--no-color'],
    {env:commandEnv,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024}));
  const project = await vercel.project();
  const projectRows = get(path+'?decrypt=false'), shared = get('/v1/env?projectId='+pins.projectId);
  check(projectRows.pagination?.next == null && shared.pagination?.next == null,'SIGNING_SETUP_VERCEL_INCOMPLETE_CATALOG');
  const who = get('/v2/user').user;
  check(who?.username === pins.vercelAccount && /^[A-Za-z0-9_-]{8,64}$/u.test(who.id || ''),'SIGNING_SETUP_VERCEL_ACTOR_CHANGED');
  return {environment:normalizedSigningEnvironment(project,projectRows.envs,shared.data),actorId:who.id};
}


export function signingEnvironmentPreimage(snapshot) {
  check(snapshot.environment.every(row => !allowed.has(row.key)),'SIGNING_SETUP_VERCEL_PREIMAGE_CHANGED');
  return {configurationDigest:digest(compatibility(snapshot)),fullEnvironmentDigest:digest(snapshot)};
}

export function createSigningVercelDriver({ env, vercel, readPublicKey, verifyPredecessor,
  execute = execFileSync, fetchImpl = fetch, readCatalog }) {
  const pins = targets();
  const path = '/v10/projects/' + pins.projectId + '/env';
  const read = readCatalog ?? (() => readSigningEnvironment({env,vercel,execute}));
  const catalog = async plan => {
    const facts = await read();
    check(facts.actorId === plan.expectedVercelActorId,'SIGNING_SETUP_VERCEL_ACTOR_CHANGED');
    return facts.environment;
  };
  const buildRequest = async ({ plan, originalOperationId, receipts, previousSteps }) => {
    const pem = await readPublicKey({plan,...previousSteps[0]});
    check(digest(pem) === receipts[0]?.publicKeyDigest,'SIGNING_SETUP_VERCEL_KEY_CHANGED');
    const values = newKeyValues(pem);
    return keys.map(key => ({ key,value:values[key],type:'plain',target:['production'],comment: originalOperationId }));
  };
  const initial = async ({ plan }) => {
    await verifyPredecessor(plan);
    const snapshot = await catalog(plan);
    const observed = signingEnvironmentPreimage(snapshot);
    check(observed.fullEnvironmentDigest === plan.previous.fullEnvironmentDigest
      && observed.configurationDigest === plan.previous.configurationDigest,'SIGNING_SETUP_VERCEL_PREIMAGE_CHANGED');
  };

  async function readback({ plan, intent, ...context }) {
    await verifyPredecessor(plan);
    const request = await buildRequest({plan,...context});
    check(digest(request) === intent.requestDigest,'SIGNING_SETUP_VERCEL_REQUEST_CHANGED');
    const snapshot = await catalog(plan);
    const rows = snapshot.environment.filter(row => allowed.has(row.key)).sort(byId);
    if (rows.length !== keys.length) return null;
    const projected = { ...snapshot, environment:snapshot.environment.filter(row => !allowed.has(row.key)) };
    check(digest(projected) === plan.previous.fullEnvironmentDigest
      && digest(compatibility(projected)) === plan.previous.configurationDigest
      && new Set(rows.map(row => row.key)).size === keys.length && rows.every(row => keys.includes(row.key)
        && row.type === 'plain' && row.target.length === 1 && row.target[0] === 'production'
        && row.gitBranch === null && !row.customEnvironmentIds.length && row.comment === intent.operationId
        && row.createdBy === plan.expectedVercelActorId && timestamp(row.createdAt)
        && row.createdAt === row.updatedAt && row.createdAt >= Date.parse(intent.submittedAt)-1000)
      && new Set(rows.map(row => row.createdBy)).size === 1,
    'SIGNING_SETUP_VERCEL_POSTIMAGE_CHANGED');
    const compatibilityView = compatibility(snapshot);
    const changed = compatibilityView.environment.filter(row => keys.includes(row.key)).sort((a,b)=>a.key.localeCompare(b.key));
    const read = await vercel.tradingFxSigningEnvironment({rows:changed,keys:[...keys,oldHmac]});
    check(Object.keys(read).length === keys.length && request.every(row => read[row.key] === row.value),'SIGNING_SETUP_VERCEL_VALUES_CHANGED');
    return { changed, evidence: { projectId:pins.projectId,teamId:pins.teamId,
      configurationDigest:digest(compatibilityView),fullEnvironmentDigest:digest(snapshot),rowDigest:digest(changed),
      keyDigest:digest(read[publicKeyName]),previousDeploymentId:plan.previous.deploymentId,
      eventEvidenceDigest:digest(rows.map(({id,createdAt,createdBy,comment})=>({id,createdAt,createdBy,comment}))) } };
  }

  return {
    async assertPreimage(plan) { await initial({plan}); },
    async preflight(context) { await initial(context);return digest(await buildRequest(context)); },
    async submit(context) {
      await initial(context);
      const body = await buildRequest(context);
      check(digest(body) === context.intent.requestDigest && env.VERCEL_TOKEN,'SIGNING_SETUP_VERCEL_REQUEST_CHANGED');
      // The CLI's generic API command retries failed POSTs. Use exactly one
      // create-only, no-redirect request. Catalog readback is authoritative.
      const reply = await context.submitOnce(() => fetchImpl('https://api.vercel.com'+path+'?teamId='+pins.teamId,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{authorization:'Bearer '+env.VERCEL_TOKEN,'content-type':'application/json'},body:JSON.stringify(body),
      }));
      await reply.body?.cancel();
      check(reply.ok && !reply.redirected,'SIGNING_SETUP_VERCEL_ACKNOWLEDGEMENT_UNCERTAIN');
    },
    async discover(context) { return (await readback(context))?.evidence; },
    async verify(context) { return digest((await readback(context))?.evidence ?? null) === digest(context.evidence); },
    async exactPostimage(context) { return readback(context); },
  };
}
