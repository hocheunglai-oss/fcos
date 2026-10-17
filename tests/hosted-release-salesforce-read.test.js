import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSalesforceRecipeReader, SALESFORCE_JWT_AUDIENCE, SALESFORCE_READ_ENVIRONMENT, salesforceRecipePath, validateSalesforceReadAcceptance, validateSalesforceReadBinding } from '../scripts/lib/hosted-release/salesforce-read-auth.mjs';
import { pair, salesforceReaderFixture as fixture } from './helpers/hosted-salesforce-read.mjs';

test('real RS256 JWT has dedicated issuer/user, fixed sandbox audience, short expiry and unique replay ID; API is fixed GET only',async()=>{
  const f=fixture(),reader=createSalesforceRecipeReader(f);await reader.readRecipe(0);await reader.readRecipe(0);
  assert.equal(f.calls.length,6);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
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
  assert.equal(f.calls.length,10);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,2);
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
  for(const mutate of [f=>f.exchange.scope='id api full',f=>f.exchange.instance_url='https://attacker.invalid',f=>f.exchange.id=`https://attacker.invalid/id/${f.binding.orgId}/${f.binding.userId}`,f=>f.exchange.token_type='Other',f=>f.exchange.refresh_token='unexpected',f=>f.info.user_id='005000000000000AAA',f=>f.info.organization_id='00D000000000000AAA',f=>f.org.records[0].IsSandbox=false,f=>f.user.IsActive=false,f=>f.user.ProfileId='00e000000000000AAA']){
    const f=fixture();mutate(f);await assert.rejects(createSalesforceRecipeReader(f).readRecipe(0));assert.ok(f.calls.length<=4);assert.ok(!f.calls.some(c=>c.url.includes('FROM%20ApexClass')));
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
  for(let i=0;i<16;i++)await reader.readRecipe(0);await assert.rejects(reader.readRecipe(0));assert.equal(f.calls.length,20);
});
test('workflow private key slot is forwarded explicitly and exposed only to the two protected dependency producers',()=>{
  const controller=readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8');
  assert.equal((controller.match(/FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY: \$\{\{ secrets\./g)||[]).length,2);
  assert.ok(!controller.includes('FCOS_HOSTED_SALESFORCE_READ_TOKEN'));
  for(const path of ['../.github/workflows/hosted-release.yml','../.github/qualification/hosted-release-bootstrap.yml'])assert.equal((readFileSync(new URL(path,import.meta.url),'utf8').match(/FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY: \$\{\{ secrets\./g)||[]).length,1);
});

test('original recipe bytes and current data must both match the admitted immutable pin before authentication', async()=>{
  for(const mutate of [f=>{f.recipeBytes=Buffer.from('{}');},f=>{f.recipe.observations[0].reads[0].object='User';},f=>{f.recipeBytes=undefined;}]){const f=fixture();mutate(f);assert.throws(()=>createSalesforceRecipeReader(f));assert.equal(f.calls.length,0);}
  const f=fixture(),reader=createSalesforceRecipeReader(f);const results=await Promise.allSettled(Array.from({length:17},()=>reader.readRecipe(0)));assert.equal(results.filter(row=>row.status==='fulfilled').length,16);assert.equal(f.calls.length,20);
});
