import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { createSigningVercelDriver,normalizedSigningEnvironment,signingEnvironmentPreimage } from '../scripts/lib/rapid-release/trading-fx-signing-setup-vercel.mjs';
import { createSigningReceiptDriver } from '../scripts/lib/rapid-release/trading-fx-signing-setup-receipt.mjs';
import { createSigningSalesforceDriver } from '../scripts/lib/rapid-release/trading-fx-signing-setup-salesforce.mjs';
import { certificateName } from '../scripts/lib/rapid-release/trading-fx-signing-setup.mjs';
import { verifyTradingFxSigningConfig } from '../scripts/lib/rapid-release/trading-fx-signing-config.mjs';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

const pins = targets(), org = fcosSalesforceEnvironment('production');
const now = Date.now(), actorId = '005000000000000AAA';
const time = new Date(now).toISOString();
const key = generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'});
const certificate = {certificateName:certificateName,publicKeyDigest:digest(key),
  expiresAt:new Date(now+604800000).toISOString(),possessionProofDigest:digest('possession')};
const project = {id:pins.projectId,accountId:pins.teamId,nodeVersion:'24.x',autoAssignCustomDomains:false};
const unrelated = {id:'unrelated_1',key:'PREVIEW_OTHER',type:'sensitive',target:['preview'],updatedAt:now-5000};
const baseConfig = normalizedSigningEnvironment(project,[unrelated],[]);
const previous = {sha:'a'.repeat(40),deploymentId:'dpl_previous',...signingEnvironmentPreimage(baseConfig)};
const plan = {repository:pins.repository,controllerSha:'c'.repeat(40),candidateSha:'b'.repeat(40),sourceDigest:digest('application'),
  previous,operationId:'trading-fx-signing-test-0001',expectedVercelActorId:'fixture-actor',vercelProject:pins.projectId,vercelTeam:pins.teamId,salesforceOrg:org.orgId};
const verifyPredecessor = async scope => { assert.deepEqual(scope.previous,previous); };

function vercelFixture() {
  let request, values, raw = [unrelated], calls = 0;
  const originalOperationId = plan.operationId+':vercel-config';
  const env = {VERCEL_TOKEN:'REDACTED_TEST_VERCEL_VALUE'};
  const vercel = {async tradingFxSigningEnvironment({rows}) {
    assert.equal(rows.length,3);
    return values;
  }};
  const driver = createSigningVercelDriver({env,vercel,verifyPredecessor,readPublicKey:async()=>key,
    readCatalog:async () => ({actorId:'fixture-actor',environment:normalizedSigningEnvironment(project,raw,[])}),
    async fetchImpl(url,options) {
      calls++;
      assert.equal(url,'https://api.vercel.com/v10/projects/'+pins.projectId+'/env?teamId='+pins.teamId);
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'error');
      request=JSON.parse(options.body);
      values=Object.fromEntries(request.map(({key,value})=>[key,value]));
      raw=[unrelated,...request.map(({value:_value,...rest},index)=>({...rest,id:'vercelrow_'+index,
        updatedAt:now,createdAt:now,createdBy:'fixture-actor'}))];
      throw Error('Lost Vercel response');
    },
  });
  return {driver,context:{plan,originalOperationId,receipts:[certificate],previousSteps:[{evidence:certificate}]},
    calls:()=>calls,clear:()=>raw.splice(2),drift:()=>raw.push({...unrelated,id:'changed_other',key:'PREVIEW_DRIFT'}),
    request:()=>request, readValues:()=>values};
}

test('Vercel submits three exact create-only rows once and reads the original rows by operation marker', async () => {
  const {driver,context,calls,request,drift} = vercelFixture();
  const intent = {submittedAt:time,operationId:context.originalOperationId,requestDigest:await driver.preflight(context)};
  await assert.rejects(driver.submit({...context,intent,submitOnce:async submit=>submit()}),/Lost Vercel response/u);
  assert.equal(calls(),1);
  assert.deepEqual(request().map(({key,value,type,target,comment})=>[key,value,type,target,comment]),[
    ['FCOS_ENABLE_SALESFORCE_COMPANY_FX','true','plain',['production'],intent.operationId],
    ['SALESFORCE_COMPANY_FX_ENVIRONMENT','production','plain',['production'],intent.operationId],
    ['SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY',key,'plain',['production'],intent.operationId],
  ]);
  const found = await driver.discover({...context,intent});
  assert.equal(found.keyDigest,certificate.publicKeyDigest);
  assert.equal(await driver.verify({...context,intent,evidence:found}),true);
  drift();
  await assert.rejects(driver.discover({...context,intent}),{code:'SIGNING_SETUP_VERCEL_POSTIMAGE_CHANGED'});
  assert.equal(calls(),1);
});

test('partial provider result stays unresolved and is never fixed by an attempted upsert', async () => {
  const {driver,context,calls,clear} = vercelFixture();
  const intent = {submittedAt:time,operationId:context.originalOperationId,requestDigest:await driver.preflight(context)};
  await assert.rejects(driver.submit({...context,intent,submitOnce:async submit=>submit()}),/Lost Vercel response/u);
  clear();
  assert.equal(await driver.discover({...context,intent}),undefined);
  await assert.rejects(driver.submit({...context,intent,submitOnce:async submit=>submit()}),{code:'SIGNING_SETUP_VERCEL_PREIMAGE_CHANGED'});
  assert.equal(calls(),1);
});

test('Salesforce writes one exact Metadata request after pinned read-only preflight and never retries SOAP', async () => {
  let callCount=0;
  const credentials = {instanceUrl:org.instanceUrl,id:org.orgId,username:org.username,connectedStatus:'Connected',
    accessToken:'00D000000000000!EXAMPLE_NO_SECRET',apiVersion:'67.0'};
  const cliEnv = {};
  const connection = { instanceUrl:org.instanceUrl, accessToken:credentials.accessToken, version:credentials.apiVersion,
    identity:async()=>({organization_id:org.orgId,username:org.username,user_id:actorId}),
    query:async()=>({records:[{Id:org.orgId,IsSandbox:false}]}), tooling:{ query:async()=>({done:true,records:[]}) },
    metadata:{read:async()=>({})} };
  const sf = createSigningSalesforceDriver({cliEnv,verifyPredecessor,authenticateIdentity:()=>credentials,openConnection:()=>connection,
    async fetchImpl(url,options) {
      callCount++;
      assert.equal(url,org.instanceUrl+'/services/Soap/m/67.0');
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'error');
      assert.match(options.body,/<metadata xsi:type="Certificate">/u);
      assert.match(options.body,/<privateKeyExportable>false<\/privateKeyExportable>/u);
      throw Error('Salesforce response lost');
    },
  });
  const scoped = {...plan,expectedSignerId:actorId};
  const intent = {requestDigest:await sf.preflight({plan:scoped}),submittedAt:time};
  await assert.rejects(sf.submit({plan:scoped,intent,submitOnce:async submit=>submit()}),/Salesforce response lost/u);
  assert.equal(await sf.discover({plan:scoped,intent}),undefined);
  assert.equal(callCount,1);
  connection.metadata.read=async()=>({fullName:certificateName});
  await assert.rejects(sf.submit({plan:scoped,intent,submitOnce:async submit=>submit()}),{code:'SIGNING_SETUP_SALESFORCE_CERTIFICATE_EXISTS'});
  assert.equal(callCount,1);
});

test('owner-created immutable receipt is reused by the existing protected stage consumer', async () => {
  const mock = vercelFixture(), context = mock.context;
  const intent = {submittedAt:time,operationId:context.originalOperationId,requestDigest:await mock.driver.preflight(context)};
  await assert.rejects(mock.driver.submit({...context,intent,submitOnce:async submit=>submit()}));
  const post = await mock.driver.exactPostimage({...context,intent});
  const rows = [];
  const github = {pages:async()=>rows,
    async write(path,request) {
      assert.match(path,/\/deployments$/u);
      rows.push({id:91,creator:{id:90,login:pins.account,type:'User'},sha:request.ref,
        repository_url:'https://api.github.com/repos/'+pins.repository,original_environment:request.environment,
        created_at:time,...request});
      throw Error('lost GitHub response');
    },
    async read(path) {assert.match(path,/\/deployments\/91$/u);return rows[0];},
  };
  const driver = createSigningReceiptDriver({github,ownerId:90,verifyPredecessor,readEnvironment:mock.driver.exactPostimage});
  const contextReceipt = {plan,originalOperationId:plan.operationId+':owner-receipt',receipts:[certificate,post.evidence],
    previousSteps:[...context.previousSteps,{intent,originalOperationId:intent.operationId,evidence:post.evidence}]};
  const receiptIntent = {operationId:contextReceipt.originalOperationId,submittedAt:time,
    requestDigest:await driver.preflight(contextReceipt)};
  await assert.rejects(driver.submit({...contextReceipt,intent:receiptIntent,submitOnce:async submit=>submit()}),/lost GitHub/u);
  const receipt = await driver.discover({...contextReceipt,intent:receiptIntent});
  assert.equal(receipt.deploymentReceiptId,91);
  const proof = await verifyTradingFxSigningConfig({manifest:{candidate:{sha:plan.candidateSha,sourceDigest:plan.sourceDigest},
    controllerSha:plan.controllerSha,previous:{deploymentId:previous.deploymentId,sha:previous.sha,configurationDigest:post.evidence.configurationDigest},
    prerequisites:{plan:{tradingFxSigningConfigReceiptId:91,tradingFxSigningConfigReceiptDigest:receipt.ownerReceiptDigest}}},
  previous,github,ownerId:90,provider:{
    async nativeConfiguration() {
      return {...baseConfig.project,autoAssignCustomDomains:undefined,environment:post.changed.slice().sort((a,b)=>a.id.localeCompare(b.id))};
    }, tradingFxSigningEnvironment:async()=>mock.readValues(),
  }, now:()=>now+500});
  assert.equal(proof.verified,true);
  assert.equal(rows.length,1);
});

test('protected workflow admits a numeric native handover pointer before provider credentials', async () => {
  const {readFileSync} = await import('node:fs');
  const {createRequire} = await import('node:module');
  const {load} = createRequire(import.meta.url)('js-yaml');
  const workflow = load(readFileSync(new URL('../.github/workflows/fcos-rapid-trading-fx-signing-setup.yml',import.meta.url),'utf8'));
  assert.equal(workflow.concurrency.group,'fcos-production-release');
  assert.equal(workflow.permissions.deployments,'read');
  assert.equal(workflow.concurrency['cancel-in-progress'],false);
  assert.equal(workflow.jobs['signing-setup'].environment,'fcos-production-release');
  const [admit,...steps] = workflow.jobs['signing-setup'].steps;
  const controllerSha='c'.repeat(40), candidateSha='b'.repeat(40);
  const plan={financialAuthority:false,controllerSha,candidateSha,repository:pins.repository};
  const env={FCOS_SIGNING_PLAN_JSON:JSON.stringify(plan),FCOS_SIGNING_PLAN_HASH:digest(plan),FCOS_SIGNING_CANDIDATE_SHA:candidateSha,
    FCOS_RAPID_RELEASE_ENABLED:'true',FCOS_RAPID_RELEASE_HANDOVER_ID:'7785743211'};
  const run = Object.getPrototypeOf(async function() {}).constructor('require','process','context','github','core',admit.with.script);
  const context = {repo:{owner:pins.account,repo:'fcos'},sha:'d'.repeat(40)};
  const outputs = {};
  const github = {rest:{repos:{
    async getDeployment({deployment_id}) {
      assert.equal(deployment_id,7785743211);
      return {data:{id:deployment_id,creator:{login:pins.account},payload:{kind:'fcos_rapid_release_handover',
        controllerSha,plan:{controllerSha},oldWritersRetired:true,hostedQualificationPassed:true}}};
    },
    async getContent() {return {data:{type:'file',sha:'e'.repeat(40)}};},
  }}};
  const require = createRequire(import.meta.url), core = {setOutput:(name,value)=>{outputs[name]=value;}};
  await run(require,{env},context,github,core);
  assert.deepEqual(outputs,{controller:controllerSha,candidate:candidateSha});
  await assert.rejects(run(require,{env:{...env,FCOS_RAPID_RELEASE_HANDOVER_ID:'bad'}},context,github,core),/SIGNING_SETUP_NATIVE_WORKFLOW_ADMISSION/u);
  assert.ok(steps.slice(0,-1).every(step=>!step.env?.VERCEL_TOKEN && !step.env?.FCOS_RAPID_SALESFORCE_PRODUCTION_PRIVATE_KEY));
  assert.equal(steps.at(-1).env.FCOS_RAPID_DATABASE_URL,'${{ secrets.FCOS_RAPID_READONLY_DATABASE_URL }}');
});

test('a provider recheck rejection stops the Vercel POST even after the prior staging checks passed', async () => {
  const {driver,context,calls} = vercelFixture();
  const intent = {submittedAt:time,operationId:context.originalOperationId,requestDigest:await driver.preflight(context)};
  await assert.rejects(driver.submit({...context,intent,submitOnce:async()=>{throw Error('exact approval no longer current');}}),
    /exact approval no longer current/u);
  assert.equal(calls(),0);
});
