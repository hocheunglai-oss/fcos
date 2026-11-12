import { digest, isDigest, isSha, requireCondition, targets } from './contract.mjs';
import { githubClient } from './providers.mjs';
import { TRADING_FX_MIGRATIONS } from './trading-fx-migrations.mjs';

export const XERO_TRADING_FX_QUALIFICATION_ENVIRONMENT = 'fcos-xero-trading-fx-qualification';
export const XERO_TRADING_FX_QUALIFICATION_TASK = 'verify:trading-fx-xero';
export const XERO_TRADING_FX_CHECKS = Object.freeze([
  'buyer_invoice_draft', 'buyer_credit_draft', 'supplier_bill_draft', 'supplier_credit_draft',
  'native_draft_recovery', 'buyer_hkd_payment', 'supplier_hkd_payment', 'native_payment_recovery',
  'prepayment_create', 'prepayment_allocate', 'prepayment_reverse', 'prepayment_refund', 'prepayment_recovery',
  'full_credit_allocate', 'full_credit_recovery',
]);
const fields = [
  'kind', 'schemaVersion', 'repository', 'candidateSha', 'sourceDigest', 'migrationDigest',
  'testCompany', 'organisationEvidenceDigest', 'observedAt', 'checks',
];
const migrationDigest = digest(TRADING_FX_MIGRATIONS);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export async function verifyTradingFxXeroQualification({ manifest, plan, env = process.env }, {
  github = githubClient, now = Date.now,
} = {}) {
  const pins = targets();
  const deploymentId = plan?.xeroQualificationDeploymentId;
  const candidate = manifest?.candidate;
  requireCondition(positiveInteger(deploymentId) && isDigest(plan.xeroQualificationDigest)
    && isSha(candidate?.sha) && isDigest(candidate.sourceDigest), 'TRADING_FX_XERO_QUALIFICATION_LOCATOR_REQUIRED');
  const api = github({ token: env.GITHUB_TOKEN, candidateSha: candidate.sha });
  const path = `/repos/${pins.repository}`;
  const [repo, record] = await Promise.all([api.read(path), api.read(`${path}/deployments/${deploymentId}`)]);
  const proof = record?.payload;
  const createdAt = Date.parse(record?.created_at);
  const observedAt = Date.parse(proof?.observedAt);
  requireCondition(repo?.full_name === pins.repository && repo.archived === false && repo.owner?.login === pins.account
    && positiveInteger(repo.owner.id) && record?.creator?.login === pins.account && record.creator.id === repo.owner.id
    && record.creator.type === 'User' && record.id === deploymentId && record.ref === candidate.sha && record.sha === candidate.sha
    && record.repository_url === `https://api.github.com${path}` && record.environment === XERO_TRADING_FX_QUALIFICATION_ENVIRONMENT
    && record.original_environment === XERO_TRADING_FX_QUALIFICATION_ENVIRONMENT && record.task === XERO_TRADING_FX_QUALIFICATION_TASK
    && record.production_environment === false && record.transient_environment === false
    && Number.isFinite(createdAt) && Number.isFinite(observedAt) && createdAt <= now() && observedAt <= createdAt + 999
    && exact(proof, fields) && proof.kind === 'fcos_trading_fx_xero_qualification' && proof.schemaVersion === 1
    && proof.repository === pins.repository && proof.candidateSha === candidate.sha && proof.sourceDigest === candidate.sourceDigest
    && proof.migrationDigest === migrationDigest && proof.testCompany === true && isDigest(proof.organisationEvidenceDigest)
    && exact(proof.checks, XERO_TRADING_FX_CHECKS) && XERO_TRADING_FX_CHECKS.every(key => isDigest(proof.checks[key]))
    && new Set(Object.values(proof.checks)).size === XERO_TRADING_FX_CHECKS.length && digest(proof) === plan.xeroQualificationDigest,
  'TRADING_FX_XERO_QUALIFICATION_REQUIRED');
  return { verified: true, testCompany: true, candidateSha: candidate.sha, sourceDigest: candidate.sourceDigest,
    migrationDigest, evidenceDigest: plan.xeroQualificationDigest };
}
