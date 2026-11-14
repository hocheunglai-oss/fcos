import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { requireCondition, targets } from './contract.mjs';
import { cliSalesforceProvider } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';

export function tradingFxSigningProbeSource(origin, sandboxOrgId) {
  requireCondition(origin === targets().origin && sandboxOrgId === fcosSalesforceEnvironment('devee').orgId,
    'TRADING_FX_SIGNING_PROBE_TARGET_CHANGED');
  return `
    Id orgId = UserInfo.getOrganizationId();
    List<Fcos_Trading_FX_Setting__c> scopedSettings = [
      SELECT Enabled__c, Cash_Enabled__c FROM Fcos_Trading_FX_Setting__c WHERE SetupOwnerId = :orgId
    ];
    System.assert(scopedSettings.isEmpty() || (scopedSettings.size()==1 &&
      scopedSettings[0].Enabled__c==false && scopedSettings[0].Cash_Enabled__c==false));
    System.assertEquals(false, FcosCompanyFxRateService.enabled());
    System.assertEquals(false, FcosTradeCashService.enabled());
    Integer initialDml = Limits.getDmlStatements();
    String payload = '{"purpose":"preview"}';
    String canonicalDigest;
    List<Integer> statuses = new List<Integer>{200,401,403};
    for(Integer probe=0; probe<3; probe++) {
      String stamp = Datetime.now().formatGmt('yyyy-MM-dd\\'T\\'HH:mm:ss.SSS\\'Z\\'');
      String ref = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
      Blob signingInput = Blob.valueOf(stamp+'.'+ref+'.'+payload);
      String signature = EncodingUtil.base64Encode(Crypto.signWithCertificate('RSA-SHA256',signingInput,'FCOS_Company_FX_Signing'));
      if(probe==1) signature=(signature.startsWith('A')?'B':'A')+signature.substring(1);
      HttpRequest request = new HttpRequest();
      request.setEndpoint('${origin}/api/salesforce/company-fx');
      request.setMethod('POST');
      request.setTimeout(12000);
      request.setHeader('Content-Type','application/json');
      request.setHeader('x-salesforce-org-id',probe==2?'${sandboxOrgId}':UserInfo.getOrganizationId());
      request.setHeader('x-salesforce-event-id',ref);
      request.setHeader('x-salesforce-timestamp',stamp);
      request.setHeader('x-salesforce-signature','rsa-sha256='+signature);
      request.setBody(payload);
      HttpResponse response = new Http().send(request);
      System.assertEquals(statuses[probe],response.getStatusCode());
      Map<String,Object> body=(Map<String,Object>)JSON.deserializeUntyped(response.getBody());
      System.assertEquals(ref,body.get('requestId'));
      if(probe==0) {
        System.assertEquals(true,body.get('ok'));
        System.assertEquals('preview',body.get('purpose'));
        System.assertEquals('production',body.get('environment'));
        Map<String,Object> rate=(Map<String,Object>)body.get('rate');
        System.assert(String.isNotBlank((String)rate.get('rateId')));
        Decimal numberRate=Decimal.valueOf(String.valueOf(rate.get('usdHkdRate')));
        System.assert(numberRate>0 && numberRate<=100);
        System.assert(rate.get('revision')!=null && rate.get('effectiveAt')!=null);
        canonicalDigest=EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(
          String.valueOf(rate.get('rateId'))+'|'+String.valueOf(rate.get('revision'))+'|'+
          String.valueOf(numberRate.setScale(6))+'|'+String.valueOf(rate.get('effectiveAt')))));
      } else {
        System.assertEquals(probe==1?'SALESFORCE_COMPANY_FX_INVALID_SIGNATURE':'SALESFORCE_COMPANY_FX_ORG_MISMATCH',body.get('code'));
      }
    }
    System.assertEquals(initialDml,Limits.getDmlStatements());
    System.debug(LoggingLevel.ERROR,'FCOS_SIGNED_PREVIEW_OK='+canonicalDigest+':'+
      (scopedSettings.isEmpty()?'absent_disabled':'explicit_disabled'));
  `;
}

export async function verifyTradingFxCanonicalSigning({ manifest, staged, provider, env = process.env,
  expectedRateDigest, execute = execFileSync, makeSalesforce = cliSalesforceProvider,
  authenticate = authenticateHostedSalesforce, fetchImpl = fetch }) {
  requireCondition(/^[a-f0-9]{64}$/u.test(expectedRateDigest || ''), 'TRADING_FX_SIGNING_RATE_EVIDENCE_REQUIRED');
  const org = fcosSalesforceEnvironment('production'), origin = targets().origin;
  const aliases = async () => {
    const live = await provider.currentProduction();
    requireCondition(live.id === staged.id && live.sha === manifest.candidate.sha && live.buildId === manifest.build.buildId,
      'TRADING_FX_SIGNING_LIVE_ALIAS_CHANGED');
  };
  const candidateUrl = new URL(staged.url);
  requireCondition(candidateUrl.protocol === 'https:' && /^[a-z0-9.-]+\.vercel\.app$/u.test(candidateUrl.host)
    && candidateUrl.pathname === '/' && !candidateUrl.search && !candidateUrl.hash, 'TRADING_FX_SIGNING_STAGE_URL_CHANGED');
  await aliases();
  const stagingResponse = await fetchImpl(new URL('/api/salesforce/company-fx', candidateUrl), {
    method: 'POST', body:'{"purpose":"preview"}', redirect:'error', signal:AbortSignal.timeout(12000),
    headers: { 'content-type':'application/json',
      ...(env.FCOS_E2E_VERCEL_BYPASS ? {'x-vercel-protection-bypass':env.FCOS_E2E_VERCEL_BYPASS} : {}) },
  });
  requireCondition(stagingResponse.status === 404 && (await stagingResponse.json()).code === 'SALESFORCE_COMPANY_FX_UNAVAILABLE',
    'TRADING_FX_SIGNING_UNALIASED_HOST_NOT_DENIED');
  const directory = mkdtempSync(join(tmpdir(),'fcos-trading-fx-signing-read-'));
  let output;
  try {
    const cliEnv = authenticate({ directory, cwd:process.cwd(), env, requireMirrorCredential:false, onlyProductionForSigningRead:true });
    await makeSalesforce({ commandEnvironment:cliEnv }).verifyIdentity(org);
    const file = join(directory,'probe.apex');
    writeFileSync(file,tradingFxSigningProbeSource(origin,fcosSalesforceEnvironment('devee').orgId),{flag:'wx',mode:0o600});
    output = JSON.parse(execute('sf',['apex','run','--target-org',org.alias,'--file',file,'--json'],
      {env:cliEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:4*1024*1024}));
  } catch { requireCondition(false, 'TRADING_FX_SIGNING_ORG_PROBE_FAILED'); }
  finally { rmSync(directory,{recursive:true,force:true}); }
  const receipt = String(output?.result?.logs ?? '').match(/USER_DEBUG[^\r\n]*FCOS_SIGNED_PREVIEW_OK=([a-f0-9]{64}):(absent_disabled|explicit_disabled)\s*$/mu);
  requireCondition(output?.status === 0 && output.result.compiled === true && output.result.success === true && receipt,
    'TRADING_FX_SIGNING_ORG_PROBE_FAILED');
  requireCondition(receipt[1] === expectedRateDigest, 'TRADING_FX_SIGNING_RATE_MISMATCH');
  await aliases();
  return { verified:true, deploymentId:staged.id, buildId:staged.buildId, orgId:org.orgId,
    rateEnvelopeDigest:receipt[1], salesforceSettings:receipt[2],
    rejectedStatuses:[401,403,404], businessWrites:0 };
}
