import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from "node:fs";

import test from 'node:test';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { TRADING_FX_SIGNING_ENVIRONMENT, TRADING_FX_SIGNING_TASK, verifyTradingFxSigningConfig } from '../scripts/lib/rapid-release/trading-fx-signing-config.mjs';

const signingKey = 'SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY';
const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
const pins = targets();
const time = Date.parse('2026-11-14T11:10:00.000Z');
const fake = {
  FCOS_ENABLE_SALESFORCE_COMPANY_FX: 'true',
  SALESFORCE_COMPANY_FX_ENVIRONMENT: 'production',
  [signingKey]: publicKey,
};

function fixture() {
  const ownerId = 77;
  const row = (key, id) => ({ key, id, target: ['production'], type: 'plain', updatedAt: time - 3000 });
  const base = { projectId: pins.projectId, accountId: pins.teamId,
    environment: [row('FCOS_ENABLE_XERO_FINANCIAL_SYNC', 'original-env')] };
  const changed = Object.keys(fake).sort().map((key, index) => row(key, 'callback-var-' + index));
  const native = { ...base, environment: [...base.environment, ...changed] };
  const sha = 'a'.repeat(40), sourceDigest = 'b'.repeat(64), controllerSha = 'c'.repeat(40);
  const before = { deploymentId: 'dpl_previous', sha: 'd'.repeat(40), configurationDigest: digest(base) };
  const proof = {kind:'fcos_trading_fx_signing_config', schemaVersion:1, repository:pins.repository,
    candidateSha:sha, sourceDigest, controllerSha, previousDeploymentId:before.deploymentId, previousSha:before.sha,
    previousConfigurationDigest:before.configurationDigest, configurationDigest:digest(native),
    projectId:pins.projectId, teamId:pins.teamId, productionOrgId:fcosSalesforceEnvironment('production').orgId,
    certificateName:'FCOS_Company_FX_Signing', certificatePublicKeyDigest:digest(publicKey), privateKeyExportable:false,
    isSandbox:false, certificateExpiresAt:new Date(time+86_400_000).toISOString(), possessionProofDigest:'e'.repeat(64),
    changed, observedAt:new Date(time-1000).toISOString()};
  const record = { id:3, sha, ref:sha, creator:{ id:ownerId, login:pins.account, type:'User' },
    repository_url:'https://api.github.com/repos/'+pins.repository, environment:TRADING_FX_SIGNING_ENVIRONMENT,
    original_environment:TRADING_FX_SIGNING_ENVIRONMENT, task:TRADING_FX_SIGNING_TASK, production_environment:false,
    transient_environment:false, created_at:new Date(time-1000).toISOString(), payload:proof };
  const manifest = { candidate:{sha,sourceDigest}, controllerSha, previous:{...before, configurationDigest:digest(native)},
    prerequisites:{plan:{tradingFxSigningConfigReceiptId:3,tradingFxSigningConfigReceiptDigest:digest(proof)}} };
  const values = { ...fake };
  const calls = [];
  return { record, manifest, native, values, calls, context:{ manifest, previous:before, ownerId, now:()=>time,
    github:{ read:async path=>{ calls.push(path); return record; } },
    provider:{ nativeConfiguration:async()=>{ calls.push('catalog'); return native; },
      tradingFxSigningEnvironment:async request=>{ calls.push('effective'); assert.equal(request.rows.length,3); return values; } } } };
}

test('Trading FX binds exact owner evidence to a fresh native signing configuration and unchanged original digest', async () => {
  const data = fixture();
  const proof = await verifyTradingFxSigningConfig(data.context);
  assert.equal(proof.verified, true);
  assert.equal(proof.configurationDigest,data.manifest.previous.configurationDigest);
  assert.deepEqual(data.calls,['/repos/'+pins.repository+'/deployments/3','catalog','effective']);
});

test('Trading FX refuses stale or misbound signing receipts before any native configuration reads', async () => {
  for (const alter of [
    data=>data.record.creator.id++,
    data=>data.record.payload.previousDeploymentId='dpl_different',
    data=>data.record.payload.controllerSha='f'.repeat(40),
    data=>data.record.payload.observedAt=new Date(time+1000).toISOString(),
    data=>data.record.payload.certificateExpiresAt=new Date(time+1000).toISOString(),
    data=>data.record.payload.privateKeyExportable=true,
    data=>data.record.payload.isSandbox=true,
  ]) {
    const data=fixture(); alter(data);
    data.manifest.prerequisites.plan.tradingFxSigningConfigReceiptDigest=digest(data.record.payload);
    await assert.rejects(verifyTradingFxSigningConfig(data.context),/RECEIPT_CHANGED/);
    assert.equal(data.calls.length,1);
  }
});

test('Trading FX refuses unrelated native changes and drift in effective non-secret values', async () => {
  const drift=fixture();
  drift.native.environment[0].updatedAt++;
  await assert.rejects(verifyTradingFxSigningConfig(drift.context),/CONFIGURATION_DRIFT/);
  const flag=fixture();
  flag.values.FCOS_ENABLE_SALESFORCE_COMPANY_FX='false';
  await assert.rejects(verifyTradingFxSigningConfig(flag.context),/VALUES_CHANGED/);
  const key=fixture();
  key.values[signingKey]=generateKeyPairSync('rsa',{ modulusLength:2048 }).publicKey.export({type:'spki',format:'pem'});
  await assert.rejects(verifyTradingFxSigningConfig(key.context),/KEY_INVALID/);
});

test('Trading FX observes canonical signing only after the exact alias and keeps Salesforce business flags disabled', async () => {
  const { verifyTradingFxCanonicalSigning } = await import('../scripts/lib/rapid-release/trading-fx-signing-probe.mjs');
  const manifest = { candidate:{sha:'a'.repeat(40)}, build:{buildId:'b'.repeat(64)} };
  const staged = { id:'dpl_staged', url:'https://fcos-unaliased.vercel.app/', buildId:manifest.build.buildId };
  const calls = [];
  let wrongAlias = false;
  let wrongDenial = false;
  let salesforceFlags = 'absent_disabled';
  const context = { manifest, staged, env:{}, expectedRateDigest:'b'.repeat(64), provider:{ async currentProduction() {
    calls.push('alias');
    return { id:wrongAlias ? 'dpl_other' : staged.id, sha:manifest.candidate.sha, buildId:staged.buildId };
  } }, async fetchImpl(url, options) {
    calls.push('staging');
    assert.equal(url.href,staged.url+'api/salesforce/company-fx');
    assert.equal(options.method,'POST');
    return new Response(JSON.stringify({code:'SALESFORCE_COMPANY_FX_UNAVAILABLE'}),{status:wrongDenial ? 200 : 404});
  }, authenticate(options) {
    calls.push('authenticate');
    assert.equal(options.onlyProductionForSigningRead,true);
    return {};
  }, makeSalesforce() {
    return { verifyIdentity(org) { calls.push(org.key); } };
  }, execute(_program, args) {
    calls.push('probe');
    const source=readFileSync(args[args.indexOf('--file')+1],'utf8');
    assert.match(source,/Crypto\.signWithCertificate/);
    assert.match(source,/Cash_Enabled__c==false/);
    assert.doesNotMatch(source,/System\.debug[^\n]*signature/);
    return JSON.stringify({status:0,result:{compiled:true,success:true,logs:
      'USER_DEBUG [1]|ERROR|FCOS_SIGNED_PREVIEW_OK='+'b'.repeat(64)+':'+salesforceFlags+'\n'}});
  } };
  const receipt=await verifyTradingFxCanonicalSigning(context);
  assert.equal(receipt.salesforceSettings,'absent_disabled');
  assert.deepEqual(receipt.rejectedStatuses,[401,403,404]);
  assert.equal(receipt.businessWrites,0);
  assert.deepEqual(calls,['alias','staging','authenticate','production','probe','alias']);
  salesforceFlags='explicit_disabled';
  assert.equal((await verifyTradingFxCanonicalSigning(context)).salesforceSettings,salesforceFlags);
  salesforceFlags='enabled';
  await assert.rejects(verifyTradingFxCanonicalSigning(context),/ORG_PROBE_FAILED/);
  wrongDenial=true;
  await assert.rejects(verifyTradingFxCanonicalSigning(context),/UNALIASED_HOST_NOT_DENIED/);
  wrongAlias=true;
  await assert.rejects(verifyTradingFxCanonicalSigning(context),/ALIAS_CHANGED/);
});

test('Trading FX digest uses the unique current Company FX revision and exact time and rate', async () => {
  const { tradingFxCurrentRateDigest } = await import('../scripts/lib/rapid-release/smoke.mjs');
  const settings={revision:2,usdHkdRate:7.8,updatedAt:'2026-11-14T11:10:00.000+00:00',canSave:true};
  const current={rateId:'test-current-rate',revision:2,usdHkdRate:7.8,effectiveAt:'2026-11-14T11:10:00.000Z'};
  const history={canSave:true,rows:[{...current,rateId:'historical',revision:null},current]};
  assert.equal(tradingFxCurrentRateDigest(settings,history),digest('test-current-rate|2|7.800000|2026-11-14T11:10:00.000Z'));
  for(const rows of [[current,current],[{...current,usdHkdRate:7.81}],[{...current,effectiveAt:'2026-11-14T11:11:00.000Z'}]]) {
    assert.throws(()=>tradingFxCurrentRateDigest(settings,{...history,rows}),/CURRENT_RATE_UNVERIFIED/);
  }
  assert.throws(()=>tradingFxCurrentRateDigest({...settings,canSave:false},history),/CURRENT_RATE_UNVERIFIED/);
});
