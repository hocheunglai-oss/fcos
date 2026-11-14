import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes, verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { signingCertificateDefinition, certificateName } from './trading-fx-signing-setup.mjs';
import { digest, requireCondition as check } from './contract.mjs';

const target = fcosSalesforceEnvironment('production');
const namespace = 'http://soap.sforce.com/2006/04/metadata';
const sfId = value => /^[A-Za-z0-9]{18}$/u.test(value || '');
const timestamp = value => new Date(value).toISOString();
const addResource = async (fetchImpl,url,options) => {
  const response = await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
  check(response.ok && !response.redirected,'SIGNING_SETUP_SALESFORCE_RESPONSE_UNCONFIRMED');
  return response;
};

function xmlElement(name,value) {
  check(/^[A-Za-z]+$/u.test(name) && /^[a-zA-Z0-9! ._-]+$/u.test(String(value)), 'SIGNING_SETUP_SOAP_INPUT_INVALID');
  return '<'+name+'>'+value+'</'+name+'>';
}

async function oneShotMetadataCreate({connection, version, fetchImpl, certificate}) {
  check(connection.instanceUrl === target.instanceUrl && /^\d{2,3}\.0$/u.test(version)
    && /^[a-zA-Z0-9!_.-]+$/u.test(connection.accessToken || ''),'SIGNING_SETUP_SALESFORCE_SESSION_INVALID');
  const body = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '<soapenv:Header xmlns="'+namespace+'"><SessionHeader>'+xmlElement('sessionId',connection.accessToken)+'</SessionHeader></soapenv:Header>'
    + '<soapenv:Body xmlns="'+namespace+'"><createMetadata><metadata xsi:type="Certificate">'
    + Object.entries(certificate).map(([key,value])=>xmlElement(key,value)).join('')
    + '</metadata></createMetadata></soapenv:Body></soapenv:Envelope>';
  const answer = await addResource(fetchImpl,target.instanceUrl+'/services/Soap/m/'+version,{
    method:'POST',headers:{'content-type':'text/xml; charset=UTF-8',soapaction:'""'},body,
  });
  // Only fresh native discovery can resolve the original operation, even when
  // this response is HTTP 2xx or indicates an application-level SOAP failure.
  await answer.body?.cancel();
}

export function createSigningSalesforceDriver({ cliEnv, authenticateIdentity, verifyPredecessor,
  execute = execFileSync, fetchImpl = fetch, openConnection }) {
  const command = (...args) => {
    const raw = execute('sf',[...args,'--json'],{env:cliEnv,timeout:45000,stdio:['ignore','pipe','pipe'],maxBuffer:5*1024*1024});
    try {
      const response = JSON.parse(raw);
      check(response.status === 0,'SIGNING_SETUP_SALESFORCE_CLI_REFUSED');
      return response.result;
    } finally { raw.fill(0); }
  };
  const open = openConnection ?? (native => {
    const npmRoot = execute('npm',['root','-g'],{env:cliEnv,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}).trim();
    check(npmRoot.startsWith('/') && !/[\r\n]/u.test(npmRoot),'SIGNING_SETUP_SALESFORCE_CLI_MODULE_INVALID');
    const require = createRequire(join(npmRoot,'@salesforce','cli','package.json'));
    check(require('@salesforce/cli/package.json').version === '2.145.6','SIGNING_SETUP_SALESFORCE_CLI_MODULE_INVALID');
    const { Connection } = require('@jsforce/jsforce-node');
    return new Connection({ instanceUrl:target.instanceUrl,accessToken:native.accessToken,version:native.apiVersion });
  });
  const pinned = async plan => {
    await verifyPredecessor(plan);
    const native = await authenticateIdentity(plan);
    check(native?.instanceUrl === target.instanceUrl && native.id === target.orgId
      && native.username === target.username && native.connectedStatus === 'Connected'
      && typeof native.accessToken === 'string' && /^\d{2,3}\.0$/u.test(native.apiVersion || ''), 'SIGNING_SETUP_SALESFORCE_ORG_CHANGED');
    const connection = await open(native);
    const [identity, org] = await Promise.all([connection.identity(),connection.query('SELECT Id, IsSandbox FROM Organization')]);
    check(identity.organization_id === target.orgId && identity.username === target.username
      && identity.user_id === plan.expectedSignerId && org.records.length === 1
      && org.records[0].Id === target.orgId && org.records[0].IsSandbox === false,'SIGNING_SETUP_SALESFORCE_ORG_CHANGED');
    return {connection, identity};
  };

  const catalog = async connection => {
    const report = await connection.tooling.query("SELECT Id, DeveloperName, CreatedDate, ExpirationDate, KeySize, OptionsIsPrivateKeyExportable, CertificateChain FROM Certificate WHERE DeveloperName = '"+certificateName+"'");
    check(report.done === true && report.records.length <= 1,'SIGNING_SETUP_SALESFORCE_CERTIFICATE_AMBIGUOUS');
    return report.records[0];
  };
  const absence = async ({plan}) => {
    const {connection} = await pinned(plan);
    const [report, metadata] = await Promise.all([catalog(connection),connection.metadata.read('Certificate',certificateName)]);
    check(!report && !metadata?.fullName,'SIGNING_SETUP_SALESFORCE_CERTIFICATE_EXISTS');
    return connection;
  };

  async function provePossession(plan, id, originalOperationId, key) {
    const challenge = ['FCOS_SIGNING_SETUP_V1',target.orgId,certificateName,id,originalOperationId,randomBytes(32).toString('hex')].join('|');
    check(/^[A-Za-z0-9_|:-]+$/u.test(challenge),'SIGNING_SETUP_SALESFORCE_CHALLENGE_INVALID');
    const body = "Integer dml=Limits.getDmlStatements(); Blob signInput=Blob.valueOf('"+challenge+"');"
      + "String proof=EncodingUtil.base64Encode(Crypto.signWithCertificate('RSA-SHA256',signInput,'"+certificateName+"'));"
      + "System.assertEquals(dml,Limits.getDmlStatements()); System.debug(LoggingLevel.ERROR,'FCOS_LOCAL_POSSESSION='+proof);\n";
    const directory = mkdtempSync(join(tmpdir(),'fcos-signing-possession-'));
    try {
      const file = join(directory,'possession.apex');
      writeFileSync(file,body,{flag:'wx',mode:0o600});
      const result = command('apex','run','--target-org',target.alias,'--file',file);
      const signature = result?.logs?.match(/USER_DEBUG[^\r\n]*FCOS_LOCAL_POSSESSION=([A-Za-z0-9+/=]+)\s*$/mu)?.[1];
      check(result?.compiled === true && result.success === true && signature
        && verify('RSA-SHA256',Buffer.from(challenge),key,Buffer.from(signature,'base64')),'SIGNING_SETUP_SALESFORCE_POSSESSION_UNVERIFIED');
      return digest({challengeDigest:digest(challenge),signatureDigest:digest(signature),actor:plan.expectedSignerId});
    } finally { rmSync(directory,{recursive:true,force:true}); }
  }

  async function inspect({plan,intent,originalOperationId,evidence}) {
    const definition = signingCertificateDefinition(plan.operationId);
    check(intent.requestDigest === digest(definition),'SIGNING_SETUP_SALESFORCE_REQUEST_CHANGED');
    const {connection,identity} = await pinned(plan);
    const row = await catalog(connection);
    if (!row) return null;
    const createdAt = timestamp(row.CreatedDate), submitted = Date.parse(intent.submittedAt);
    check(sfId(row.Id) && row.DeveloperName === certificateName && row.OptionsIsPrivateKeyExportable === false
      && Number(row.KeySize) === 2048 && Date.parse(createdAt) >= submitted-5000 && Date.parse(createdAt) <= Date.now()+5000,'SIGNING_SETUP_SALESFORCE_CERTIFICATE_PREIMAGE_CHANGED');
    const metadata = await connection.metadata.read('Certificate',certificateName);
    check(metadata?.fullName === certificateName && metadata.masterLabel === definition.masterLabel
      && metadata.privateKeyExportable === false && metadata.caSigned === false
      && Number(metadata.keySize) === 2048,'SIGNING_SETUP_SALESFORCE_CERTIFICATE_CHANGED');
    const certBytes = metadata.content || row.CertificateChain;
    check(typeof certBytes === 'string','SIGNING_SETUP_SALESFORCE_CERTIFICATE_CHANGED');
    const cert = new X509Certificate(certBytes.includes('BEGIN CERTIFICATE') ? certBytes : Buffer.from(certBytes,'base64'));
    const pem = cert.publicKey.export({format:'pem',type:'spki'});
    check(cert.publicKey.asymmetricKeyType === 'rsa' && cert.publicKey.asymmetricKeyDetails.modulusLength === 2048
      && cert.issuer === cert.subject && cert.verify(cert.publicKey) && Date.parse(cert.validFrom) <= Date.now()
      && Date.parse(cert.validTo) > Date.now()+300000 && Date.parse(row.ExpirationDate) === Date.parse(cert.validTo),'SIGNING_SETUP_SALESFORCE_PUBLIC_KEY_CHANGED');
    check(sfId(identity.user_id),'SIGNING_SETUP_SALESFORCE_ORG_CHANGED');
    const from = new Date(submitted-5000).toISOString(), until = new Date(Date.parse(createdAt)+90000).toISOString();
    const trail = await connection.query("SELECT Id, Action, Display, Section, CreatedById, CreatedDate FROM SetupAuditTrail WHERE CreatedById = '"+identity.user_id
      +"' AND CreatedDate >= "+from+" AND CreatedDate <= "+until+" ORDER BY CreatedDate DESC LIMIT 200");
    check(trail.done === true && trail.records.length < 200,'SIGNING_SETUP_SALESFORCE_CREATION_AUDIT_UNAVAILABLE');
    const matches = trail.records.filter(entry => sfId(entry.Id) && entry.CreatedById === plan.expectedSignerId
      && typeof entry.Display === 'string' && entry.Display.includes(definition.masterLabel)
      && entry.Section === 'Certificate and Key Management' && entry.Action === 'insertCertificate'
      && Math.abs(Date.parse(entry.CreatedDate)-Date.parse(createdAt)) <= 90000);
    if (matches.length !== 1) return null;
    const auditEvidenceDigest = digest(matches[0]);
    const observed = {orgId:target.orgId,certificateId:row.Id,certificateName,publicKeyDigest:digest(pem),
      possessionProofDigest:evidence?.possessionProofDigest ?? await provePossession(plan,row.Id,originalOperationId,cert.publicKey),
      expiresAt:timestamp(cert.validTo),privateKeyExportable:false,keySize:2048,isSandbox:false,caSigned:false,createdAt,auditEvidenceDigest};
    return {pem,evidence:observed};
  }

  return {
    async preflight(context) { await absence(context);return digest(signingCertificateDefinition(context.plan.operationId)); },
    async submit(context) {
      const connection = await absence(context);
      const certificate = signingCertificateDefinition(context.plan.operationId);
      check(context.intent.requestDigest === digest(certificate),'SIGNING_SETUP_SALESFORCE_REQUEST_CHANGED');
      await context.assertSubmission();
      await oneShotMetadataCreate({connection,version:connection.version,fetchImpl,certificate});
    },
    async discover(context) { return (await inspect(context))?.evidence; },
    async verify(context) { return digest((await inspect(context))?.evidence ?? null) === digest(context.evidence); },
    async publicKey(context) { return (await inspect(context))?.pem; },
  };
}
