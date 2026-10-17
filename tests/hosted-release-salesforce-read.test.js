import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSalesforceRecipeReader, SALESFORCE_JWT_AUDIENCE, salesforceRecipePath, salesforcePermissionRecipePaths, validateSalesforceReadAcceptance, validateSalesforceReadBinding } from '../scripts/lib/hosted-release/salesforce-read-auth.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { pair, salesforceReaderFixture as fixture } from './helpers/hosted-salesforce-read.mjs';

test('real RS256 JWT has dedicated issuer/user, fixed sandbox audience, short expiry and unique replay ID; API is fixed GET only',async()=>{
  const f=fixture(),reader=createSalesforceRecipeReader(f);await reader.readRecipe(0);await reader.readRecipe(0);
  assert.equal(f.calls.length,15);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  const post=f.calls[0],params=new URLSearchParams(post.options.body),jwt=params.get('assertion'),parts=jwt.split('.');
  assert.equal(post.url,`${SALESFORCE_JWT_AUDIENCE}/services/oauth2/token`);assert.equal(params.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');assert.equal(params.size,2);
  assert.deepEqual(JSON.parse(Buffer.from(parts[0],'base64url')),{alg:'RS256'});
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  assert.equal(claims.iss,f.binding.clientId);assert.equal(claims.sub,f.binding.username);assert.equal(claims.aud,SALESFORCE_JWT_AUDIENCE);assert.equal(claims.exp,Math.floor(f.now()/1000)+120);assert.match(claims.jti,/^[a-f0-9-]{36}$/);
  assert.ok(verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),pair.publicKey,Buffer.from(parts[2],'base64url')));
  assert.ok(f.calls.slice(1).every(c=>c.options.method==='GET'&&c.url.startsWith(`${f.binding.instanceUrl}/services/`)&&c.options.redirect==='error'));
  assert.deepEqual(Object.keys(reader).sort(),['admit','readRecipe']);assert.ok(!JSON.stringify(reader).includes('fixture-access-token'));
});
test('each job creates a new session; current session is reused and expiry renews with fresh identity before next recipe read',async()=>{
  const f=fixture(),reader=createSalesforceRecipeReader(f);await reader.readRecipe(0);f.advance(301000);await reader.readRecipe(0);
  assert.equal(f.calls.length,28);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,2);
  const second=createSalesforceRecipeReader(f);await second.readRecipe(0);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,3);
  const jtis=f.calls.filter(c=>c.options.method==='POST').map(c=>JSON.parse(Buffer.from(new URLSearchParams(c.options.body).get('assertion').split('.')[1],'base64url')).jti);assert.equal(new Set(jtis).size,3);
  const exp=fixture();exp.exchange.expires_in=60;const short=createSalesforceRecipeReader(exp);await short.readRecipe(0);exp.advance(31000);await short.readRecipe(0);assert.equal(exp.calls.filter(c=>c.options.method==='POST').length,2);
});
test('wrong key, setup, protected source, environment and actual job refuse before token exchange',async()=>{
  const wrong=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
  for(const mutate of [f=>f.env.FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY=wrong,f=>f.env.FCOS_HOSTED_ENVIRONMENT='fcos-hosted-preview',f=>f.env.GITHUB_REF='refs/heads/attacker',f=>f.env.GITHUB_REPOSITORY='other/fcos',f=>f.env.GITHUB_JOB='candidate_checks',f=>delete f.env.FCOS_VERIFIED_JOB_ID,f=>f.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256='b'.repeat(64),f=>f.env.FCOS_HOSTED_SALESFORCE_READ_TOKEN='opaque-legacy']){
    const f=fixture();mutate(f);await assert.rejects(createSalesforceRecipeReader(f).readRecipe(0));assert.equal(f.calls.length,0);
  }
});
test('scope, exchange instance, identity URL, org, sandbox, active user and profile drift cannot reach a recipe GET',async()=>{
  for(const mutate of [f=>f.exchange.scope='id api full',f=>f.exchange.instance_url='https://attacker.invalid',f=>f.exchange.id=`https://attacker.invalid/id/${f.binding.orgId}/${f.binding.userId}`,f=>f.exchange.token_type='Other',f=>f.exchange.refresh_token='unexpected',f=>f.info.user_id='005000000000000AAA',f=>f.info.organization_id='00D000000000000AAA',f=>f.org.records[0].IsSandbox=false,f=>f.user.IsActive=false,f=>f.user.ProfileId='00e000000000000AAA',f=>f.profile.Name='System Administrator',f=>f.profile.UserLicenseId='100000000000002AAA',f=>f.licence.Name='Salesforce',f=>f.fixtureUser.ProfileId='00e000000000000AAA',f=>f.fixtureUser.Username='substituted@example.invalid',f=>f.fixtureUser.IsActive=false]){
    const f=fixture();mutate(f);await assert.rejects(createSalesforceRecipeReader(f).readRecipe(0));assert.ok(f.calls.length<=7);assert.ok(!f.calls.some(c=>c.url.includes('FROM%20ApexClass')));
  }
});
test('HTTP failure, redirect, invalid JSON, response bounds and lost authentication response never retry or leak provider details',async()=>{
  for(const response of [()=>new Response('private response canary',{status:401}),()=>new Response('{}',{status:206}),()=>new Response('{}',{status:302,headers:{location:'https://attacker.invalid'}}),()=>new Response('not json'),()=>new Response('{}',{headers:{'content-length':'99999999'}}),()=>({status:200,redirected:true,url:'https://attacker.invalid'})]){
    const f=fixture();let calls=0;f.fetchImpl=async()=>{calls++;return response();};const reader=createSalesforceRecipeReader(f);
    await assert.rejects(reader.readRecipe(0),error=>!JSON.stringify(error).includes('canary'));await assert.rejects(reader.readRecipe(0));assert.equal(calls,1);
  }
  const f=fixture();let calls=0;f.fetchImpl=async()=>{calls++;throw new Error('private access token canary');};const reader=createSalesforceRecipeReader(f);await assert.rejects(reader.admit());await assert.rejects(reader.admit());assert.equal(calls,1);
});
test('public setup and independent root acceptance are exact and have no private substitutions',()=>{
  const f=fixture();validateSalesforceReadAcceptance(f.binding,f.setup);
  for(const mutate of [b=>b.username='other',b=>b.orgId='00D000000000000AAA',b=>b.apiVersion='v68.0',b=>b.audience='https://login.salesforce.com',b=>b.publicKeySha256='b'.repeat(64),b=>b.providerPermissionMode='read_only',b=>b.scopes=['full'],b=>b.notAfter=1,b=>b.privateKey='private']){const b=structuredClone(f.binding);mutate(b);assert.throws(()=>validateSalesforceReadBinding(b));}
  for(const mutate of [s=>s.salesforceReadCredentialAcceptance.sha256='b'.repeat(64),s=>s.salesforceReadCredentialAcceptance.json='{}']){const s=structuredClone(f.setup);mutate(s);assert.throws(()=>validateSalesforceReadAcceptance(f.binding,s));}
});
test('adapter has no arbitrary URL/method/instance and bounds complete recipe reads at sixteen',async()=>{
  for(const read of [{kind:'query',object:'User; DELETE',tooling:false,fields:['Id'],limit:1},{kind:'query',object:'User',tooling:false,fields:['Id'],limit:1,where:{field:'Id',values:["x' OR Id!='"]}},{kind:'describe',object:'User',tooling:false,url:'https://attacker.invalid'},{kind:'POST',object:'User',tooling:false}])assert.throws(()=>salesforceRecipePath(read,'v67.0'));
  const f=fixture(),reader=createSalesforceRecipeReader(f);await assert.rejects(reader.readRecipe('https://attacker.invalid'));assert.equal(f.calls.length,0);
  for(let i=0;i<16;i++)await reader.readRecipe(0);await assert.rejects(reader.readRecipe(0));assert.equal(f.calls.length,29);
});
test('workflow private key slot is forwarded explicitly and exposed only to the two protected dependency producers',()=>{
  const controller=readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8');
  assert.equal((controller.match(/FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY: \$\{\{ secrets\./g)||[]).length,2);
  assert.ok(!controller.includes('FCOS_HOSTED_SALESFORCE_READ_TOKEN'));
  for(const path of ['../.github/workflows/hosted-release.yml','../.github/qualification/hosted-release-bootstrap.yml'])assert.equal((readFileSync(new URL(path,import.meta.url),'utf8').match(/FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY: \$\{\{ secrets\./g)||[]).length,1);
});

test('original recipe bytes and current data must both match the admitted immutable pin before authentication', async()=>{
  for(const mutate of [f=>{f.recipeBytes=Buffer.from('{}');},f=>{f.recipe.observations[0].reads[0].object='User';},f=>{f.recipeBytes=undefined;}]){const f=fixture();mutate(f);assert.throws(()=>createSalesforceRecipeReader(f));assert.equal(f.calls.length,0);}
  const f=fixture(),reader=createSalesforceRecipeReader(f);const results=await Promise.allSettled(Array.from({length:17},()=>reader.readRecipe(0)));assert.equal(results.filter(row=>row.status==='fulfilled').length,16);assert.equal(f.calls.length,29);
});

function refreshPermissionReview(f) {
  f.binding.effectivePermissionsSha256=digest(f.permission);
  f.review.credential.effectivePermissionsSha256=f.binding.effectivePermissionsSha256;
  const json=JSON.stringify(f.review);
  f.binding.rootAcceptanceSha256=digest(json);
  f.setup.salesforceReadCredentialAcceptance={json,sha256:digest(json)};
  f.manifest.setupSha256=digest(f.setup);
  f.env.FCOS_ADMITTED_RELEASE_SETUP=JSON.stringify(f.setup);
  f.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256=digest(f.setup);
}
test('reader authenticates independently and observes the unchanged original fixture user/profile',async()=>{
  const f=fixture(),original=Buffer.from(f.recipeBytes);await createSalesforceRecipeReader(f).readRecipe(0);
  assert.notEqual(f.binding.userId,f.recipe.userId);assert.notEqual(f.binding.profileId,f.recipe.profileId);assert.notEqual(f.binding.username,f.recipe.username);
  assert.ok(f.calls[3].url.includes(`/User/${f.binding.userId}?`));
  assert.ok(f.calls[4].url.includes(`/Profile/${f.binding.profileId}?`));
  assert.ok(f.calls[5].url.includes(`/User/${f.recipe.userId}?`));
  assert.deepEqual(f.recipeBytes,original);
});
test('old admin username/profile and fixture-identity substitution are ineligible before authentication',()=>{
  for(const mutate of [f=>f.binding.username=fcosSalesforceEnvironment('devee').username,
    f=>f.binding.username=fcosSalesforceEnvironment('devee').username.toUpperCase(),
    f=>f.binding.profileName='System Administrator',f=>f.binding.profileName='System Admin',
    f=>f.binding.userId=f.recipe.userId,f=>f.binding.profileId=f.recipe.profileId,
    f=>f.binding.originalFixtureIdentitySha256='b'.repeat(64),f=>f.binding.schemaVersion=1,
    f=>f.binding.providerPermissionMode='pinned_user_permissions']){
    const f=fixture();mutate(f);assert.throws(()=>createSalesforceRecipeReader(f));assert.equal(f.calls.length,0);
  }
});
test('root review cannot accept effective writes, incomplete sources or missing capability readbacks even under matching hashes',async()=>{
  const mutations=[p=>p.businessRecordWrites=true,p=>p.metadataWrites=true,p=>p.administrativePermissions=true,p=>p.executableWritePaths=true,
    p=>p.allPermissionSourcesReviewed=false,p=>p.clientPreauthorizedOnlyForReader=false,p=>p.username='substituted@example.invalid',
    p=>p.profileName='System Administrator',p=>p.userLicenseId='100000000000002AAA',p=>p.capturedAt='2020-01-01T00:00:00Z',p=>p.capturedAt='2999-01-01T00:00:00Z'];
  for(const key of ['profileReadbackSha256','permissionAssignmentsReadbackSha256','permissionSetGroupsReadbackSha256','effectiveSystemPermissionsReadbackSha256','effectiveObjectPermissionsReadbackSha256','effectiveFieldPermissionsReadbackSha256','executableAccessReadbackSha256','licenceReadbackSha256','clientPreauthorizationReadbackSha256'])mutations.push(p=>delete p[key]);
  for(const mutate of mutations){const f=fixture();mutate(f.permission);refreshPermissionReview(f);
    assert.throws(()=>validateSalesforceReadAcceptance(f.binding,f.setup),{code:'SALESFORCE_READ_PROVIDER_READ_ONLY_PROOF_REQUIRED'});
    await assert.rejects(createSalesforceRecipeReader(f).admit());assert.equal(f.calls.length,0);
  }
  const f=fixture();f.binding.effectivePermissionsSha256='b'.repeat(64);f.review.credential.effectivePermissionsSha256=f.binding.effectivePermissionsSha256;
  const json=JSON.stringify(f.review);f.binding.rootAcceptanceSha256=digest(json);f.setup.salesforceReadCredentialAcceptance={json,sha256:digest(json)};
  assert.throws(()=>validateSalesforceReadAcceptance(f.binding,f.setup),{code:'SALESFORCE_READ_PROVIDER_READ_ONLY_PROOF_REQUIRED'});
});

test('changing the caller recipe after construction cannot redirect the original fixture identity read',async()=>{
  const f=fixture(),reader=createSalesforceRecipeReader(f),original=f.recipe.userId;
  f.recipe.userId=f.binding.userId;f.recipe.profileId=f.binding.profileId;f.recipe.username=f.binding.username;
  await reader.admit();assert.ok(f.calls[5].url.includes(`/User/${original}?`));
});

function refreshIntrospectionReview(f) {
  f.binding.permissionRecipeSha256=digest(f.permissionIntrospection);
  f.review.credential.permissionRecipeSha256=f.binding.permissionRecipeSha256;
  refreshPermissionReview(f);
}
test('new assignments, groups and inherited or owned privileges fail with unchanged reader identity before any NomB GET',async()=>{
  const mutations=[f=>{f.permissionValues[1].records.push({...f.permissionValues[1].records[0],Id:'0Pa000000000002AAA',PermissionSetId:'0PS000000000003AAA'});f.permissionValues[1].totalSize++;},
    f=>f.permissionValues[1].records[0].PermissionSetGroupId='0PG000000000001AAA',
    f=>{f.permissionValues[1].records=[];f.permissionValues[1].totalSize=0;},
    f=>f.permissionValues[2].records[0].PermissionsModifyAllData=true,
    f=>f.permissionValues[2].records[1].PermissionsCustomizeApplication=true,
    f=>f.permissionValues[2].records[1].PermissionsChatterInternalUser=true,
    f=>f.permissionValues[2].records[0].ProfileId='00e000000000002AAA',
    f=>delete f.permissionValues[2].records[0].PermissionsAuthorApex,
    f=>f.permissionValues[2].records[1].PermissionsFutureWrite=true,
    f=>f.permissionValues[0].fields.push({name:'PermissionsFutureWrite',type:'boolean'}),
    f=>f.permissionValues[4].records[0].PermissionsEdit=true,
    f=>f.permissionValues[4].records[0].Field='STEM__c.Unapproved__c',
    f=>{f.permissionValues[5].records=[{Id:'0J0000000000001AAA',ParentId:f.permissionIntrospection.permissionSets[1].id,SetupEntityId:'01p000000000001AAA',SetupEntityType:'ApexClass'}];f.permissionValues[5].totalSize=1;}];
  for(const name of ['PermissionsCreate','PermissionsEdit','PermissionsDelete','PermissionsModifyAllRecords','PermissionsFutureWrite'])mutations.push(f=>f.permissionValues[3].records[0][name]=true);
  for(const mutate of mutations){const f=fixture(),identity=structuredClone({user:f.user,profile:f.profile});mutate(f);
    await assert.rejects(createSalesforceRecipeReader(f).readRecipe(0),{code:'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED'});
    assert.deepEqual({user:f.user,profile:f.profile},identity);assert.ok(!f.calls.some(row=>row.url.includes('FROM%20ApexClass')));
  }
});
test('permission recipe is exact setup-bound data and cannot admit arbitrary paths or unsafe system flags under new hashes',async()=>{
  for(const mutate of [f=>f.permissionIntrospection.paths[0]='https://attacker.invalid',
    f=>f.permissionIntrospection.paths[0]='/services/data/v67.0/sobjects/Account/describe',
    f=>f.permissionIntrospection.permissionSets[1].trueSystemPermissions.push('PermissionsModifyAllData'),
    f=>f.permissionIntrospection.permissionSets[1].trueSystemPermissions.push('PermissionsChatterInternalUser'),
    f=>f.permissionIntrospection.permissionReadbackSha256='b'.repeat(64),
    f=>f.permissionIntrospection.maxRows=2000,f=>f.permissionIntrospection.userId='005000000000002AAA',
    f=>f.permissionIntrospection.permissionSets[0].id="0PS000000000001AA' OR",f=>f.permissionIntrospection.systemPermissionFields=[]]){
    const f=fixture();mutate(f);refreshIntrospectionReview(f);await assert.rejects(createSalesforceRecipeReader(f).admit());assert.equal(f.calls.length,0);
  }
});
test('permission projections must be complete bounded non-paginated data and are revalidated on session renewal',async()=>{
  for(const mutate of [f=>f.permissionValues[1].done=false,f=>f.permissionValues[2].nextRecordsUrl='/services/data/v67.0/query/next',
    f=>f.permissionValues[3].totalSize=2,f=>{const row=f.permissionValues[3].records[0];f.permissionValues[3].records=Array.from({length:200},(_,i)=>({...row,Id:String(i)}));f.permissionValues[3].totalSize=200;}]){
    const f=fixture();mutate(f);await assert.rejects(createSalesforceRecipeReader(f).readRecipe(0));assert.ok(!f.calls.some(row=>row.url.includes('FROM%20ApexClass')));
  }
  const f=fixture(),reader=createSalesforceRecipeReader(f);await reader.readRecipe(0);
  f.permissionValues[2].records[1].PermissionsModifyAllData=true;f.advance(301000);
  await assert.rejects(reader.readRecipe(0),{code:'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED'});
  assert.equal(f.calls.filter(row=>row.url.includes('FROM%20ApexClass')).length,1);
  assert.equal(f.calls.filter(row=>row.url.endsWith('/PermissionSet/describe')).length,2);
  const before=f.calls.length;await assert.rejects(reader.readRecipe(0));assert.equal(f.calls.length,before);
  const large=fixture(),fetchOriginal=large.fetchImpl;
  large.fetchImpl=async(url,options)=>url.endsWith('/PermissionSet/describe')?new Response('{}',{headers:{'content-length':String(4*1024*1024+1)}}):fetchOriginal(url,options);
  await assert.rejects(createSalesforceRecipeReader(large).readRecipe(0));assert.ok(!large.calls.some(row=>row.url.includes('FROM%20ApexClass')));
});

test('mandatory Integration profile Chatter baseline is admitted only under explicit business-data scope with declared residuals',async()=>{
  const f=fixture();validateSalesforceReadAcceptance(f.binding,f.setup);await createSalesforceRecipeReader(f).readRecipe(0);
  assert.equal(f.binding.providerPermissionMode,'provider_business_data_read_only');assert.equal(f.binding.providerWideReadOnly,false);
  assert.deepEqual(f.binding.readOnlyScope,['business_records','metadata','administration','executable_grants']);
  assert.deepEqual(f.binding.residualCapabilities,['chatter_collaboration','user_profile_self_service']);
  assert.equal(f.permission.businessRecordWrites,false);assert.ok(!Object.hasOwn(f.permission,'recordWrites'));
  assert.equal(f.permissionValues[2].records[0].PermissionsChatterInternalUser,true);assert.equal(f.permissionValues[2].records[1].PermissionsChatterInternalUser,false);
  assert.ok(f.calls.some(row=>row.url.includes(`/UserLicense/${f.binding.userLicenseId}?fields=Id,Name`)));
  assert.ok(!f.calls.some(row=>row.url.includes('/chatter/')));assert.equal(f.calls.filter(row=>row.options.method!=='GET').length,1);
});
test('wrong licence, direct Chatter privilege, old global modes and provider-wide read-only misclaims remain inadmissible',async()=>{
  for(const mutate of [f=>f.binding.userLicenseName='Salesforce',f=>f.binding.providerPermissionMode='provider_read_only',
    f=>f.binding.providerWideReadOnly=true,f=>f.binding.residualCapabilities=[],f=>f.binding.readOnlyScope=['business_records']]){
    const f=fixture();mutate(f);assert.throws(()=>createSalesforceRecipeReader(f));assert.equal(f.calls.length,0);
  }
  for(const mutate of [p=>p.providerWideReadOnly=true,p=>p.readOnlyScope=['business_records'],p=>p.residualCapabilities=[],p=>p.recordWrites=false]){
    const f=fixture();mutate(f.permission);refreshPermissionReview(f);await assert.rejects(createSalesforceRecipeReader(f).admit());assert.equal(f.calls.length,0);
  }
  const wrong=fixture();wrong.licence.Name='Salesforce';await assert.rejects(createSalesforceRecipeReader(wrong).readRecipe(0));assert.ok(!wrong.calls.some(row=>row.url.includes('FROM%20ApexClass')));
  const direct=fixture();direct.permissionIntrospection.permissionSets[1].trueSystemPermissions.push('PermissionsChatterInternalUser');refreshIntrospectionReview(direct);
  await assert.rejects(createSalesforceRecipeReader(direct).admit());assert.equal(direct.calls.length,0);
});

test('exact nine root-evidenced profile TabSets are admitted while executable, direct, changed and novel grants fail',async()=>{
  const f=fixture();assert.equal(f.permissionIntrospection.nonExecutableSetupEntityGrants.length,9);await createSalesforceRecipeReader(f).readRecipe(0);
  for(const mutate of [f=>f.permissionValues[5].records[0].SetupEntityType='ApexClass',f=>f.permissionValues[5].records[0].SetupEntityType='Flow',
    f=>f.permissionValues[5].records[0].SetupEntityType='ConnectedApplication',f=>f.permissionValues[5].records[0].ParentId=f.permissionIntrospection.permissionSets[1].id,
    f=>f.permissionValues[5].records[0].SetupEntityId='02u000000000999AAA',
    f=>{f.permissionValues[5].records.push({Id:'0J0000000000999AAA',ParentId:f.permissionIntrospection.permissionSets[0].id,SetupEntityId:'02u000000000999AAA',SetupEntityType:'TabSet'});f.permissionValues[5].totalSize++;}]){
    const changed=fixture();mutate(changed);await assert.rejects(createSalesforceRecipeReader(changed).readRecipe(0),{code:'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED'});assert.ok(!changed.calls.some(row=>row.url.includes('FROM%20ApexClass')));
  }
  for(const mutate of [r=>r.nonExecutableSetupEntityGrants[0].setupEntityType='ApexClass',r=>r.nonExecutableSetupEntityGrants[0].setupEntityType='Flow',
    r=>r.nonExecutableSetupEntityGrants[0].setupEntityType='ConnectedApplication',r=>r.nonExecutableSetupEntityGrants[0].parentId=r.permissionSets[1].id,
    r=>r.nonExecutableSetupEntityGrants[0].setupEntityId='01p000000000001AAA',
    r=>r.permissionSets[0].trueSystemPermissions=r.permissionSets[0].trueSystemPermissions.filter(name=>name!=='PermissionsApiUserOnly')]){
    const changed=fixture();mutate(changed.permissionIntrospection);refreshIntrospectionReview(changed);await assert.rejects(createSalesforceRecipeReader(changed).admit());assert.equal(changed.calls.length,0);
  }
});

test('automatic profile-owned assignment and exact admitted direct assignments are mandatory and exhaustive',async()=>{
  const baseline=fixture();baseline.permissionIntrospection.permissionSets.splice(1);
  baseline.permissionIntrospection.paths=salesforcePermissionRecipePaths(baseline.permissionIntrospection);
  baseline.permissionValues[1].records.splice(1);baseline.permissionValues[1].totalSize=1;
  baseline.permissionValues[2].records.splice(1);baseline.permissionValues[2].totalSize=1;
  for(const index of [3,4])baseline.permissionValues[index]={done:true,totalSize:0,records:[]};
  refreshIntrospectionReview(baseline);await createSalesforceRecipeReader(baseline).readRecipe(0);
  assert.equal(baseline.permissionValues[1].records.length,1);
  assert.equal(baseline.permissionValues[1].records[0].PermissionSetId,baseline.permissionIntrospection.permissionSets[0].id);
  for(const mutate of [f=>{f.permissionValues[1].records.splice(0,1);f.permissionValues[1].totalSize--;},
    f=>{f.permissionValues[1].records.splice(1,1);f.permissionValues[1].totalSize--;},
    f=>f.permissionValues[1].records[1].Id=f.permissionValues[1].records[0].Id,
    f=>f.permissionValues[1].records[1].PermissionSetId=f.permissionValues[1].records[0].PermissionSetId,
    f=>f.permissionValues[1].records[0].PermissionSetId='0PS000000000003AAA',
    f=>f.permissionValues[1].records[1].PermissionSetId='0PS000000000003AAA',
    f=>f.permissionValues[1].records[0].PermissionSetGroupId='0PG000000000001AAA',
    f=>f.permissionValues[1].records[0].AssigneeId='005000000000002AAA',
    f=>f.permissionValues[2].records[0].ProfileId='00e000000000002AAA',
    f=>f.permissionValues[2].records[0].IsOwnedByProfile=false]){
    const f=fixture();mutate(f);await assert.rejects(createSalesforceRecipeReader(f).readRecipe(0),{code:'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED'});
    assert.ok(!f.calls.some(row=>row.url.includes('FROM%20ApexClass')));
  }
});

test('root-pinned QueryAllFiles can verify file absence without admitting file or business writes',async()=>{
  const f=fixture();
  await createSalesforceRecipeReader(f).readRecipe(0);
  assert.equal(f.calls.filter(row=>row.options.method==='POST').length,1);
  f.permissionValues[2].records[1].PermissionsModifyAllData=true;
  await assert.rejects(createSalesforceRecipeReader(f).admit(),{code:'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED'});
});

test('file absence cannot qualify from a sharing-filtered reader even under new root setup hashes',async()=>{
  for(const missing of ['PermissionsViewAllData','PermissionsQueryAllFiles']){
    const f=fixture();f.recipe.observations[0].reads[0]={kind:'query',tooling:false,object:'ContentVersion',fields:['Id'],limit:1};
    f.recipeBytes=Buffer.from(JSON.stringify(f.recipe));f.recipeSha256=digest(f.recipeBytes);f.manifest.dependencies.nom_b.recipeSha256=f.recipeSha256;
    f.permissionIntrospection.permissionSets[1].trueSystemPermissions=f.permissionIntrospection.permissionSets[1].trueSystemPermissions.filter(x=>x!==missing);
    f.permissionValues[2].records[1][missing]=false;refreshIntrospectionReview(f);
    await assert.rejects(createSalesforceRecipeReader(f).admit(),{code:'SALESFORCE_READ_FILE_VISIBILITY_REQUIRED'});assert.equal(f.calls.length,0);
  }
});
