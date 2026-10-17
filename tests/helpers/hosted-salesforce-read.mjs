import { generateKeyPairSync } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../../config/fcosConnections.js';
import { digest, releaseTargets } from '../../scripts/lib/hosted-release/contract.mjs';
import { SALESFORCE_JWT_AUDIENCE, SALESFORCE_READ_ENVIRONMENT } from '../../scripts/lib/hosted-release/salesforce-read-auth.mjs';
export const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }); // Disposable fixture only; never stored.
const privateKey = pair.privateKey.export({ type:'pkcs8',format:'pem' });
const S = 'a'.repeat(40), H = 'a'.repeat(64);
export function salesforceReaderFixture({ recipe: suppliedRecipe, manifest: suppliedManifest } = {}) {
  let clock = Date.now(); const issuedAt = clock - 1000, devee = fcosSalesforceEnvironment('devee');
  const credential = { clientId:'fixture-client-0000000000000000',orgId:devee.orgId,username:devee.username,userId:suppliedRecipe?.userId || '005HF000005Z2yYYAS',profileId:suppliedRecipe?.profileId || '00e2x000000K9I8AAK',instanceUrl:devee.instanceUrl,isSandbox:true,apiVersion:'v67.0',audience:SALESFORCE_JWT_AUDIENCE,
    scopes:['api','id'],publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),publicKeySha256:digest(pair.publicKey.export({type:'spki',format:'der'})),issuedAt,notAfter:clock+3600000,sessionUseSeconds:300,providerPermissionMode:'pinned_user_permissions' };
  const review = {schemaVersion:1,kind:'fcos_root_accepted_salesforce_jwt_setup',accepted:true,reviewerId:'/root',operator:'hocheunglai-oss',reviewedAt:new Date(clock).toISOString(),originalSetupReceiptSha256:H,clientConfigurationReadbackSha256:H,userPermissionsReadbackSha256:H,secretStorageReadbackSha256:H,environment:SALESFORCE_READ_ENVIRONMENT,environmentOnly:true,credential};
  const json = JSON.stringify(review), binding = {schemaVersion:1,kind:'fcos_salesforce_jwt_recipe_reader',...credential,originalSetupReceiptSha256:H,rootAcceptanceSha256:digest(json)};
  const read = {kind:'query',object:'ApexClass',tooling:true,fields:['Id','Name','Body'],limit:100};
  const recipe = suppliedRecipe || {orgId:devee.orgId,username:devee.username,userId:binding.userId,profileId:binding.profileId,origin:devee.instanceUrl,isSandbox:true,apiVersion:'v67.0',observations:[{reads:[read]}]};
  const recipeSha256 = digest(JSON.stringify(recipe));
  const manifest = suppliedManifest || {stage:'compatibility',executionMode:'release',epoch:1,controller:{sha:S},targets:releaseTargets(),verification:{salesforceReadCredential:binding},dependencies:{schemaVersion:1,nom_b:{recipeSha256}}};
  manifest.verification = { ...manifest.verification, salesforceReadCredential:binding };
  manifest.dependencies = { ...manifest.dependencies, schemaVersion:1,nom_b:{...manifest.dependencies?.nom_b,recipeSha256} };
  const setup = {controllerSha:manifest.controller.sha,epoch:1,targetsSha256:digest(manifest.targets),verification:manifest.verification,dependencies:manifest.dependencies,salesforceReadCredentialAcceptance:{json,sha256:digest(json)}};
  manifest.setupSha256=digest(setup);
  const env = {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'hocheunglai-oss/fcos',GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_SHA:manifest.controller.sha,GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'101',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'dependencies_before',FCOS_CONTROLLER_SHA:manifest.controller.sha,FCOS_VERIFIED_JOB_ID:'202',FCOS_VERIFICATION_PHASE:'before',FCOS_HOSTED_ENVIRONMENT:SALESFORCE_READ_ENVIRONMENT,FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(setup),FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY:privateKey};
  const calls = [];
  const f = {manifest,recipe,recipeBytes:Buffer.from(JSON.stringify(recipe)),recipeSha256,env,binding,setup,calls,now:()=>clock,advance:ms=>{clock+=ms;},exchange:{access_token:'fixture-access-token-only',token_type:'Bearer',instance_url:devee.instanceUrl,scope:'id api',id:`${SALESFORCE_JWT_AUDIENCE}/id/${devee.orgId}/${binding.userId}`},
    info:{organization_id:devee.orgId,user_id:binding.userId,preferred_username:devee.username},org:{done:true,totalSize:1,records:[{Id:devee.orgId,IsSandbox:true}]},user:{Id:binding.userId,Username:devee.username,IsActive:true,ProfileId:binding.profileId}};
  f.fetchImpl = async (url,options) => {
    calls.push({url,options});
    if (options.method==='POST') return new Response(JSON.stringify(f.exchange),{status:200});
    if (url.endsWith('/userinfo')) return new Response(JSON.stringify(f.info));
    if (url.includes('Organization%20LIMIT')) return new Response(JSON.stringify(f.org));
    if (url.includes('/sobjects/User/')) return new Response(JSON.stringify(f.user));
    return new Response(JSON.stringify({done:true,totalSize:0,records:[]}));
  };
  return f;
}

