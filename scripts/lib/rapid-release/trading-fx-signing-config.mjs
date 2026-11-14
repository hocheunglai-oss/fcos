import { createPublicKey } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { digest, isDigest, requireCondition, targets } from './contract.mjs';

export const TRADING_FX_SIGNING_ENVIRONMENT = 'fcos-trading-fx-signing-config';
export const TRADING_FX_SIGNING_TASK = 'verify:trading-fx-signing-config';
export const TRADING_FX_SIGNING_BASELINE = Object.freeze({
  configurationDigest: '27635c47f346964ba3e01a966ab18dd5958c4943bf1ca7a57067137f08de5f23',
});
const keyName = 'SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY';
const hmacName = 'SALESFORCE_COMPANY_FX_SIGNING_SECRET';
const values = {
  FCOS_ENABLE_SALESFORCE_COMPANY_FX: 'true',
  SALESFORCE_COMPANY_FX_ENVIRONMENT: 'production',
};
const names = [...Object.keys(values), keyName].sort();
const receiptFields = ['kind', 'schemaVersion', 'repository', 'candidateSha', 'sourceDigest', 'controllerSha',
  'previousDeploymentId', 'previousSha', 'previousConfigurationDigest', 'configurationDigest',
  'projectId', 'teamId', 'productionOrgId', 'certificateName', 'certificatePublicKeyDigest',
  'certificateExpiresAt', 'privateKeyExportable', 'isSandbox', 'possessionProofDigest', 'changed', 'observedAt'];

function exact(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isId = id => Number.isSafeInteger(id) && id > 0;

export function hasTradingFxSigningLocator(plan) {
  return Object.hasOwn(plan ?? {}, 'tradingFxSigningConfigReceiptId')
    || Object.hasOwn(plan ?? {}, 'tradingFxSigningConfigReceiptDigest');
}

export async function verifyTradingFxSigningConfig({ manifest, previous, github, ownerId, provider, now = Date.now }) {
  const pins = targets(), org = fcosSalesforceEnvironment('production');
  const { tradingFxSigningConfigReceiptId: id, tradingFxSigningConfigReceiptDigest: proofDigest } = manifest.prerequisites.plan;
  requireCondition(isId(id) && isDigest(proofDigest) && isId(ownerId) && provider
    && isDigest(previous.configurationDigest) && previous.configurationDigest !== manifest.previous.configurationDigest,
  'TRADING_FX_SIGNING_LOCATOR_REQUIRED');
  const path = '/repos/' + pins.repository;
  const record = await github.read(path + '/deployments/' + id);
  const proof = record?.payload;
  const createdAt = Date.parse(record?.created_at);
  requireCondition(record?.id === id && record.creator?.login === pins.account && record.creator.id === ownerId
    && record.creator.type === 'User' && record.ref === manifest.candidate.sha && record.sha === manifest.candidate.sha
    && record.repository_url === 'https://api.github.com' + path
    && record.environment === TRADING_FX_SIGNING_ENVIRONMENT && record.original_environment === TRADING_FX_SIGNING_ENVIRONMENT
    && record.task === TRADING_FX_SIGNING_TASK && record.production_environment === false && record.transient_environment === false
    && exact(proof, receiptFields) && digest(proof) === proofDigest
    && proof.kind === 'fcos_trading_fx_signing_config' && proof.schemaVersion === 1 && proof.repository === pins.repository
    && proof.candidateSha === manifest.candidate.sha && proof.sourceDigest === manifest.candidate.sourceDigest
    && proof.controllerSha === manifest.controllerSha
    && proof.previousDeploymentId === manifest.previous.deploymentId && proof.previousSha === manifest.previous.sha
    && proof.previousConfigurationDigest === previous.configurationDigest && proof.configurationDigest === manifest.previous.configurationDigest
    && proof.projectId === pins.projectId && proof.teamId === pins.teamId && proof.productionOrgId === org.orgId
    && proof.certificateName === 'FCOS_Company_FX_Signing' && proof.privateKeyExportable === false && proof.isSandbox === false
    && isDigest(proof.certificatePublicKeyDigest) && isDigest(proof.possessionProofDigest)
    && timestamp(proof.certificateExpiresAt) && Date.parse(proof.certificateExpiresAt) > now() + 300_000
    && Number.isFinite(createdAt) && createdAt <= now() && timestamp(proof.observedAt) && Date.parse(proof.observedAt) <= createdAt + 999,
  'TRADING_FX_SIGNING_RECEIPT_CHANGED');
  const configuration = await provider.nativeConfiguration();
  const projected = { ...configuration, environment: configuration.environment.filter(row => !names.includes(row.key)) };
  const rows = configuration.environment.filter(row => names.includes(row.key)).sort((a, b) => a.key.localeCompare(b.key));
  requireCondition(configuration.projectId === pins.projectId && configuration.accountId === pins.teamId
    && digest(configuration) === proof.configurationDigest && digest(projected) === proof.previousConfigurationDigest
    && !configuration.environment.some(row => row.key === hmacName)
    && rows.length === names.length && rows.every((row, index) => row.key === names[index] && /^[A-Za-z0-9_-]{8,}$/u.test(row.id)
      && row.type === 'plain' && row.target?.length === 1 && row.target[0] === 'production')
    && new Set(rows.map(row => row.id)).size === names.length && digest(rows) === digest(proof.changed),
  'TRADING_FX_SIGNING_CONFIGURATION_DRIFT');
  const readback = await provider.tradingFxSigningEnvironment({ rows, keys: [...names, hmacName] });
  requireCondition(exact(readback, names) && Object.entries(values).every(([name, value]) => readback[name] === value)
    && typeof readback[keyName] === 'string' && /^-----BEGIN PUBLIC KEY-----\r?\n/u.test(readback[keyName]),
  'TRADING_FX_SIGNING_VALUES_CHANGED');
  let key;
  try { key = createPublicKey(readback[keyName]); }
  catch { requireCondition(false, 'TRADING_FX_SIGNING_KEY_INVALID'); }
  requireCondition(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 2048
    && digest(key.export({ format:'pem', type:'spki' })) === proof.certificatePublicKeyDigest,
  'TRADING_FX_SIGNING_KEY_INVALID');
  return { verified: true, receiptId: id, proofDigest, configurationDigest: proof.configurationDigest };
}
