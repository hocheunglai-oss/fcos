import { generateKeyPairSync } from 'node:crypto';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../../config/fcosConnections.js';
import { digest, releaseTargets } from '../../scripts/lib/hosted-release/contract.mjs';
import { SALESFORCE_JWT_AUDIENCE, SALESFORCE_READ_ENVIRONMENT, salesforceFixtureIdentityHash, salesforcePermissionRecipePaths, SALESFORCE_BUSINESS_READ_ONLY_SCOPE, SALESFORCE_READER_RESIDUAL_CAPABILITIES } from '../../scripts/lib/hosted-release/salesforce-read-auth.mjs';
export const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }); // Disposable fixture only; never stored.
const privateKey = pair.privateKey.export({ type:'pkcs8',format:'pem' });
const S = 'a'.repeat(40), H = 'a'.repeat(64);
export function salesforceReaderFixture({ recipe: suppliedRecipe, manifest: suppliedManifest } = {}) {
  let clock = Date.now(); const issuedAt = clock - 1000, devee = fcosSalesforceEnvironment('devee');
  const read = {kind:'query',object:'ApexClass',tooling:true,fields:['Id','Name','Body'],limit:100};
  const recipe = suppliedRecipe || {orgId:devee.orgId,username:devee.username,userId:'005HF000005Z2yYYAS',profileId:'00e2x000000K9I8AAK',origin:devee.instanceUrl,isSandbox:true,apiVersion:'v67.0',observations:[{reads:[read]}]};
  const readerIdentity = {orgId:devee.orgId,username:fcosConnectionIdentifier('salesforce','Hosted DEVEE read-only username'),userId:'005000000000001AAA',profileId:'00e000000000001AAA',profileName:'FCOS Hosted Read Only',userLicenseId:'100000000000001AAA',userLicenseName:fcosConnectionIdentifier('salesforce','Hosted DEVEE read-only licence name')};
  const permission = {schemaVersion:1,kind:'fcos_salesforce_provider_business_data_read_only_acceptance',...readerIdentity,capturedAt:new Date(clock).toISOString(),allPermissionSourcesReviewed:true,businessRecordWrites:false,readOnlyScope:[...SALESFORCE_BUSINESS_READ_ONLY_SCOPE],providerWideReadOnly:false,residualCapabilities:[...SALESFORCE_READER_RESIDUAL_CAPABILITIES],metadataWrites:false,administrativePermissions:false,executableWritePaths:false,clientPreauthorizedOnlyForReader:true,
    profileReadbackSha256:H,permissionAssignmentsReadbackSha256:H,permissionSetGroupsReadbackSha256:H,effectiveSystemPermissionsReadbackSha256:H,effectiveObjectPermissionsReadbackSha256:H,effectiveFieldPermissionsReadbackSha256:H,executableAccessReadbackSha256:H,licenceReadbackSha256:H,clientPreauthorizationReadbackSha256:H};
  const systemPermissionFields=['PermissionsApiEnabled','PermissionsApiUserOnly','PermissionsViewSetup','PermissionsModifyAllData','PermissionsCustomizeApplication','PermissionsChatterInternalUser','PermissionsAuthorApex','PermissionsViewAllData','PermissionsQueryAllFiles','PermissionsViewAllForecasts','PermissionsViewEventLogFiles','PermissionsViewPublicDashboards','PermissionsViewPublicReports','PermissionsViewRoles'];
  const permissionSets=[{id:'0PS000000000001AAA',name:'X00e000000000001AAA',isOwnedByProfile:true,trueSystemPermissions:['PermissionsApiEnabled','PermissionsApiUserOnly','PermissionsChatterInternalUser']},
    {id:'0PS000000000002AAA',name:'FCOS_Hosted_Reader',isOwnedByProfile:false,trueSystemPermissions:['PermissionsViewSetup','PermissionsViewAllData','PermissionsQueryAllFiles','PermissionsViewAllForecasts','PermissionsViewEventLogFiles','PermissionsViewPublicDashboards','PermissionsViewPublicReports','PermissionsViewRoles']}];
  const permissionIntrospection={schemaVersion:1,kind:'fcos_salesforce_fresh_business_data_read_only_permission_recipe',orgId:readerIdentity.orgId,userId:readerIdentity.userId,profileId:readerIdentity.profileId,apiVersion:'v67.0',permissionReadbackSha256:H,maxRows:200,permissionSets,systemPermissionFields,readableObjects:['STEM__c'],readableFields:['STEM__c.Name'],nonExecutableSetupEntityGrants:Array.from({length:9},(_,i)=>({id:`0J0${String(i+1).padStart(12,'0')}AAA`,parentId:permissionSets[0].id,setupEntityId:`02u${String(i+1).padStart(12,'0')}AAA`,setupEntityType:'TabSet'}))};
  permissionIntrospection.paths=salesforcePermissionRecipePaths(permissionIntrospection);
  const queryRows=records=>({done:true,totalSize:records.length,records});
  const permissionValues=[{fields:systemPermissionFields.map(name=>({name,type:'boolean'}))},
    queryRows(permissionSets.map((row,i)=>({Id:`0Pa${String(i+1).padStart(12,'0')}AAA`,AssigneeId:readerIdentity.userId,PermissionSetId:row.id,PermissionSetGroupId:null}))),
    queryRows(permissionSets.map(row=>({Id:row.id,Name:row.name,IsOwnedByProfile:row.isOwnedByProfile,ProfileId:row.isOwnedByProfile?readerIdentity.profileId:null,...Object.fromEntries(systemPermissionFields.map(name=>[name,row.trueSystemPermissions.includes(name)]))}))),
    queryRows([{Id:'110000000000001AAA',ParentId:permissionSets[1].id,SobjectType:'STEM__c',PermissionsRead:true,PermissionsCreate:false,PermissionsEdit:false,PermissionsDelete:false,PermissionsViewAllRecords:false,PermissionsModifyAllRecords:false}]),
    queryRows([{Id:'0FP000000000001AAA',ParentId:permissionSets[1].id,SobjectType:'STEM__c',Field:'STEM__c.Name',PermissionsRead:true,PermissionsEdit:false}]),queryRows(permissionIntrospection.nonExecutableSetupEntityGrants.map(row=>({Id:row.id,ParentId:row.parentId,SetupEntityId:row.setupEntityId,SetupEntityType:row.setupEntityType})))];
  const credential = {clientId:'fixture-client-0000000000000000',...readerIdentity,instanceUrl:devee.instanceUrl,isSandbox:true,apiVersion:'v67.0',audience:SALESFORCE_JWT_AUDIENCE,
    scopes:['api','id'],publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),publicKeySha256:digest(pair.publicKey.export({type:'spki',format:'der'})),issuedAt,notAfter:clock+3600000,sessionUseSeconds:300,providerPermissionMode:'provider_business_data_read_only',readOnlyScope:[...SALESFORCE_BUSINESS_READ_ONLY_SCOPE],providerWideReadOnly:false,residualCapabilities:[...SALESFORCE_READER_RESIDUAL_CAPABILITIES],originalFixtureIdentitySha256:salesforceFixtureIdentityHash(recipe),effectivePermissionsSha256:digest(permission),permissionRecipeSha256:digest(permissionIntrospection)};
  const review = {schemaVersion:2,kind:'fcos_root_accepted_salesforce_jwt_setup',accepted:true,reviewerId:'/root',operator:'hocheunglai-oss',reviewedAt:new Date(clock).toISOString(),originalSetupReceiptSha256:H,clientConfigurationReadbackSha256:H,userPermissionsReadbackSha256:H,secretStorageReadbackSha256:H,environment:SALESFORCE_READ_ENVIRONMENT,environmentOnly:true,credential,providerReadOnlyAcceptance:permission,permissionIntrospection};
  const json = JSON.stringify(review), binding = {schemaVersion:2,kind:'fcos_salesforce_jwt_recipe_reader',...credential,originalSetupReceiptSha256:H,rootAcceptanceSha256:digest(json)};
  const recipeSha256 = digest(JSON.stringify(recipe));
  const manifest = suppliedManifest || {stage:'compatibility',executionMode:'release',epoch:1,controller:{sha:S},targets:releaseTargets(),verification:{salesforceReadCredential:binding},dependencies:{schemaVersion:1,nom_b:{recipeSha256}}};
  manifest.verification = { ...manifest.verification, salesforceReadCredential:binding };
  manifest.dependencies = { ...manifest.dependencies, schemaVersion:1,nom_b:{...manifest.dependencies?.nom_b,recipeSha256} };
  const setup = {controllerSha:manifest.controller.sha,epoch:1,targetsSha256:digest(manifest.targets),verification:manifest.verification,dependencies:manifest.dependencies,salesforceReadCredentialAcceptance:{json,sha256:digest(json)}};
  manifest.setupSha256=digest(setup);
  const env = {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'hocheunglai-oss/fcos',GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_SHA:manifest.controller.sha,GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'101',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'dependencies_before',FCOS_CONTROLLER_SHA:manifest.controller.sha,FCOS_VERIFIED_JOB_ID:'202',FCOS_VERIFICATION_PHASE:'before',FCOS_HOSTED_ENVIRONMENT:SALESFORCE_READ_ENVIRONMENT,FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(setup),FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY:privateKey};
  const calls = [];
  const f = {manifest,recipe,review,permission,permissionIntrospection,permissionValues,recipeBytes:Buffer.from(JSON.stringify(recipe)),recipeSha256,env,binding,setup,calls,now:()=>clock,advance:ms=>{clock+=ms;},exchange:{access_token:'fixture-access-token-only',token_type:'Bearer',instance_url:devee.instanceUrl,scope:'id api',id:`${SALESFORCE_JWT_AUDIENCE}/id/${devee.orgId}/${binding.userId}`},
    info:{organization_id:devee.orgId,user_id:binding.userId,preferred_username:binding.username},org:{done:true,totalSize:1,records:[{Id:devee.orgId,IsSandbox:true}]},user:{Id:binding.userId,Username:binding.username,IsActive:true,ProfileId:binding.profileId},licence:{Id:binding.userLicenseId,Name:binding.userLicenseName},profile:{Id:binding.profileId,Name:binding.profileName,UserLicenseId:binding.userLicenseId},fixtureUser:{Id:recipe.userId,Username:recipe.username,IsActive:true,ProfileId:recipe.profileId}};
  f.fetchImpl = async (url,options) => {
    calls.push({url,options});
    const capabilityIndex=permissionIntrospection.paths.findIndex(path=>url===`${binding.instanceUrl}${path}`);
    if(capabilityIndex>=0)return new Response(JSON.stringify(f.permissionValues[capabilityIndex]));
    if (options.method==='POST') return new Response(JSON.stringify(f.exchange),{status:200});
    if (url.endsWith('/userinfo')) return new Response(JSON.stringify(f.info));
    if (url.includes('Organization%20LIMIT')) return new Response(JSON.stringify(f.org));
    if (url.includes(`/sobjects/User/${binding.userId}?`)) return new Response(JSON.stringify(f.user));
    if (url.includes('/sobjects/UserLicense/')) return new Response(JSON.stringify(f.licence));
    if (url.includes('/sobjects/Profile/')) return new Response(JSON.stringify(f.profile));
    if (url.includes('/sobjects/User/')) return new Response(JSON.stringify(f.fixtureUser));
    return new Response(JSON.stringify({done:true,totalSize:0,records:[]}));
  };
  return f;
}

