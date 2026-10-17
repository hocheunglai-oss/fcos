import { createHash, timingSafeEqual } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const VERCEL_READ_SCOPES = Object.freeze(['read:deployment', 'read:integration-configuration', 'read:project']);
/** notAfter is the admitted local use horizon, not a claim of provider expiry.
 * @typedef {{schemaVersion:1,kind:'fcos_vercel_read_integration',bearerSha256:string,clientId:string,integrationId:string,configurationId:string,teamId:string,projectId:string,scopes:string[],issuedAt:number,notAfter:number,oauthExchangeReceiptSha256:string,rootAcceptanceSha256:string}} VercelReadCredentialBinding */
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
function refuse(code) { const error = new Error(code); error.code=code; error.phase='vercel.read'; throw error; }
const need = (value, code='VERCEL_READ_CREDENTIAL_BINDING') => { if (!value) refuse(code); };
const fields = ['bearerSha256','clientId','integrationId','configurationId','teamId','projectId','scopes','issuedAt','notAfter'];
const scopesMatch = scopes => Array.isArray(scopes) && scopes.length === VERCEL_READ_SCOPES.length && JSON.stringify([...scopes].sort()) === JSON.stringify(VERCEL_READ_SCOPES);

/** Public reference to the ORIGINAL exchange and its independently reviewed
 * privileged-setup acceptance. These hashes never constitute acceptance alone. */
export function validateVercelReadBinding(binding, { targets, now=Date.now() } = {}) {
  need(exact(binding,['schemaVersion','kind',...fields,'oauthExchangeReceiptSha256','rootAcceptanceSha256'])
    && binding.schemaVersion===1 && binding.kind==='fcos_vercel_read_integration'
    && hash(binding.bearerSha256) && hash(binding.oauthExchangeReceiptSha256) && hash(binding.rootAcceptanceSha256)
    && /^(?:oac|cl)_[A-Za-z0-9_-]{3,128}$/.test(binding.clientId)
    && /^oac_[A-Za-z0-9_-]{3,128}$/.test(binding.integrationId)
    && /^icfg_[A-Za-z0-9_-]{3,128}$/.test(binding.configurationId)
    && binding.teamId===targets?.vercelTeam && binding.projectId===targets?.vercelProject
    && binding.teamId===fcosConnectionIdentifier('vercel','Team ID') && binding.projectId===fcosConnectionIdentifier('vercel','Project ID') && scopesMatch(binding.scopes)
    && Number.isSafeInteger(binding.issuedAt) && binding.issuedAt>0 && binding.issuedAt<=now+30000
    && Number.isSafeInteger(binding.notAfter) && binding.notAfter>binding.issuedAt && binding.notAfter>now);
  return binding;
}

/** The existing admitted-setup hash/source boundary authenticates this review.
 * A candidate/helper-authored review or fingerprint outside that setup fails. */
export function validateVercelReadAcceptance(binding, setup, options) {
  validateVercelReadBinding(binding,options);
  const reference=setup?.vercelReadCredentialAcceptance;
  need(exact(reference,['json','sha256']) && typeof reference.json==='string' && Buffer.byteLength(reference.json)<=32768
    && reference.sha256===binding.rootAcceptanceSha256 && digest(reference.json)===reference.sha256,'VERCEL_READ_OAUTH_PROOF_REQUIRED');
  let review; try { review=JSON.parse(reference.json); } catch { refuse('VERCEL_READ_OAUTH_PROOF_REQUIRED'); }
  need(exact(review,['schemaVersion','kind','accepted','reviewerId','operator','reviewedAt','originalExchangeReceiptSha256','configurationReadbackSha256','credential'])
    && review.schemaVersion===1 && review.kind==='fcos_root_accepted_vercel_oauth_exchange' && review.accepted===true
    && review.reviewerId==='/root' && review.operator===fcosConnectionIdentifier('github','Required account')
    && typeof review.reviewedAt==='string' && Number.isFinite(Date.parse(review.reviewedAt))
    && Date.parse(review.reviewedAt)>=binding.issuedAt-30000 && Date.parse(review.reviewedAt)<=(options?.now??Date.now())+30000
    && review.originalExchangeReceiptSha256===binding.oauthExchangeReceiptSha256
    && hash(review.configurationReadbackSha256) && exact(review.credential,fields)
    && fields.every(key => key==='scopes' ? scopesMatch(review.credential.scopes) : review.credential[key]===binding[key]),'VERCEL_READ_OAUTH_PROOF_REQUIRED');
  return review;
}

export function assertVercelReadConfiguration(configuration,binding) {
  need(configuration?.type==='integration-configuration' && configuration.id===binding.configurationId
    && configuration.integrationId===binding.integrationId && configuration.teamId===binding.teamId && configuration.ownerId===binding.teamId
    && configuration.projectSelection==='selected' && Array.isArray(configuration.projects)
    && configuration.projects.length===1 && configuration.projects[0]===binding.projectId && scopesMatch(configuration.scopes)
    && [undefined,'ready'].includes(configuration.status)
    && ['disabledAt','deletedAt','deleteRequestedAt','customerDeleteRequestedAt'].every(key => configuration[key]==null || configuration[key]===0),
  'VERCEL_READ_CONFIGURATION_CHANGED');
  return {configurationId:configuration.id,integrationId:configuration.integrationId,teamId:configuration.teamId,projectId:binding.projectId,scopes:[...VERCEL_READ_SCOPES]};
}

/** Only a previously admitted ORIGINAL exchange credential can reach these GETs.
 * No OAuth client secret, write credential, caller URL or arbitrary API route. */
export function createVercelIntegrationReader({ manifest,env=process.env,fetchImpl=fetch,now=Date.now }) {
  const binding=validateVercelReadBinding(manifest?.verification?.vercelReadCredential,{targets:manifest?.targets,now:now()});
  need(!['FCOS_HOSTED_VERCEL_TOKEN','VERCEL_TOKEN','VERCEL_OIDC_TOKEN'].some(key=>env[key])
    && !Object.entries(env).some(([key,value])=>value && /(?:VERCEL|OAUTH|INTEGRATION).*(?:CLIENT_SECRET|PRIVATE_KEY)/.test(key)),'VERCEL_READ_WRITE_CREDENTIAL_FORBIDDEN');
  const token=env.FCOS_HOSTED_VERCEL_READ_TOKEN;
  need(typeof token==='string' && token.length>=32 && token.length<=4096 && !/\s/.test(token),'VERCEL_READ_CREDENTIAL_REQUIRED');
  need(timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(binding.bearerSha256,'hex')),'VERCEL_READ_CREDENTIAL_SUBSTITUTED');
  const fixedGet=async path=>{
    const url=new URL(`https://api.vercel.com${path}`);url.searchParams.set('teamId',binding.teamId);
    let response;try { response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`}}); }
    catch { refuse('VERCEL_READ_UNAVAILABLE'); }
    need(response.ok && !response.redirected && (!response.url || response.url===url.href),'VERCEL_READ_UNAVAILABLE');
    try { return await response.json(); } catch { refuse('VERCEL_READ_UNAVAILABLE'); }
  };
  const admit=async()=>{
    const { assertHostedSetup, assertHostedSourceContext }=await import('./admission.mjs');
    assertHostedSetup({manifest,env});
    assertHostedSourceContext({manifest,env});
    validateVercelReadBinding(binding,{targets:manifest.targets,now:now()});
    return assertVercelReadConfiguration(await fixedGet(`/v1/integrations/configuration/${binding.configurationId}`),binding);
  };
  return {admit,get:async path=>{
    const project=`/v9/projects/${binding.projectId}`;
    need(path===project || path===`/v9/projects?limit=100`
      || /^\/v13\/deployments\/(?:dpl_[A-Za-z0-9]+|[a-z0-9-]+\.vercel\.app)$/.test(path)
      || new RegExp(`^/v6/deployments\\?projectId=${binding.projectId}&limit=100(?:&until=[0-9]+)?$`).test(path),'VERCEL_READ_ROUTE_FORBIDDEN');
    await admit();return fixedGet(path);
  }};
}
