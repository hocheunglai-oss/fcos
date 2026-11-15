import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { verifyReviewedOrgInventory } from '../salesforce-reviewed-release.mjs';
import { authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';
import { reconcileHostedSalesforceJob } from './salesforce-reviewed-adapter.mjs';
import { digest, requireCondition, sourceSnapshot } from './contract.mjs';
import { verifySalesSupportRepairSource } from './trading-fx-sales-support-source.mjs';
import {
  verifyTradingFxFinalPaymentGrantDrift, verifyTradingFxSalesSupportSandboxJob,
} from './trading-fx-sales-support-transport.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const check = (value, code) => requireCondition(value, 'TRADING_FX_FINAL_POSTEFFECT_' + code);

function readOnlySalesforce(program, args, cwd, { env, timeout = 180000 }) {
  const prefix = args.slice(0, args[0] === 'project' ? 3 : 2).join(' ');
  check(program === 'sf' && ['org display', 'data query', 'project retrieve start', 'project deploy report'].includes(prefix)
    && policy.environments.some(environment => args[args.indexOf('--target-org') + 1] === environment.alias)
    && args.at(-1) === '--json', 'READ_ONLY_COMMAND_REQUIRED');
  let raw;
  try {
    raw = execFileSync(program, args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const { result, status } = JSON.parse(raw);
    check(status === 0, 'NATIVE_READ_FAILED');
    return result;
  } catch (error) {
    error.stdout?.fill?.(0);
    error.stderr?.fill?.(0);
    throw new Error('TRADING_FX_FINAL_POSTEFFECT_NATIVE_READ_FAILED');
  } finally { raw?.fill(0); }
}

export async function verifyTradingFxFinalPosteffectSalesforce({ verified, cwd, correctionDirectory, env }) {
  const { manifest } = verified;
  const candidate = sourceSnapshot(cwd);
  check(candidate.sha === manifest.candidate.sha && candidate.sourceDigest === manifest.candidate.sourceDigest
    && candidate.lockDigest === manifest.candidate.lockDigest, 'APPLICATION_CHANGED');
  const { salesforceFingerprint, salesforceManifestPath, salesforceReviewPath, salesSupportRepair } = manifest.prerequisites.plan;
  verifySalesSupportRepairSource({ cwd: correctionDirectory, repair: salesSupportRepair });
  const plan = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: salesforceManifestPath, reviewPath: salesforceReviewPath });
  check(plan.fingerprint === salesforceFingerprint && salesSupportRepair.viewAllFieldsCorrection === true, 'REVIEW_CHANGED');
  const saved = verified.records.filter(row => row.payload.event === 'salesforce.checkpoint'
    && row.payload.data.outcome === 'resolved').map(row => row.payload.data);
  const checkpoint = (fingerprint, stage, operation) => saved.findLast(row =>
    row.fingerprint === fingerprint && row.stage === stage && row.operation === operation);
  const directory = mkdtempSync(join(tmpdir(), 'fcos-final-posteffect-'));
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory, cwd,
      env: { ...env, HOME: directory }, requireMirrorCredential: false });
    const run = (program, args, dir, options = {}) =>
      readOnlySalesforce(program, args, dir, { ...options, env: commandEnvironment });
    const provider = cliSalesforceProvider({ cwd, policy, run, commandEnvironment });
    const report = provider.report.bind(provider);
    const reports = new Map();
    provider.report = (environment, jobId) => {
      const key = environment.key + ':' + jobId;
      if (!reports.has(key)) reports.set(key, report(environment, jobId));
      return reports.get(key);
    };
    const inventory = {};
    for (const environment of policy.environments) {
      const stage = environment.key;
      const final = plan.nativeInventories[stage].final;
      for (const operation of ['bootstrap', 'validation', 'deployment']) {
        const initial = checkpoint(plan.fingerprint, stage, operation);
        check(initial?.job, 'ORIGINAL_JOB_REQUIRED');
        const { id: jobId, submittedAt, validationId: validationJobId, packageSha256 } = initial.job;
        await reconcileHostedSalesforceJob({ environment, jobId, reviewed: plan, operation,
          submittedAt, validationJobId, packageSha256, provider, journal: { readCheckpoints: () => saved } });
      }
      const proof = await verifyReviewedOrgInventory({ provider, environment, plan, expected: final,
        profileRecovery: stage === 'production' ? 'after-final-view-all-fields-correction' : undefined });
      for (const permission of plan.binding.permissionSets) {
        check(await provider.permissionAssigned(environment, permission) === true, 'ORIGINAL_PERMISSION_NOT_PRESENT');
      }
      if (stage !== 'production') {
        const original = checkpoint(salesSupportRepair.correctionFingerprint, stage, 'sales-support-correction');
        check(original?.job, 'ORIGINAL_JOB_REQUIRED');
        await verifyTradingFxSalesSupportSandboxJob({ stage, cwd: correctionDirectory,
          commandEnvironment, job: original.job, repair: salesSupportRepair, run });
      }
      inventory[stage] = proof;
    }
    const production = policy.environments.find(environment => environment.key === 'production');
    const catalog = verifyTradingFxFinalPaymentGrantDrift({ cwd, commandEnvironment, repair: salesSupportRepair, run });
    const productionCorrection = checkpoint(salesSupportRepair.correctionFingerprint, 'production', 'sales-support-correction');
    const reportOf = operation => provider.report(production, checkpoint(plan.fingerprint, 'production', operation).job.id);
    const correctionReport = provider.report(production, productionCorrection.job.id);
    check(correctionReport?.id === productionCorrection.job.id && correctionReport.done === true && correctionReport.success === true
      && correctionReport.status === 'Succeeded' && correctionReport.checkOnly === false && correctionReport.rollbackOnError === true
      && correctionReport.numberComponentsDeployed === 1 && correctionReport.numberComponentErrors === 0
      && correctionReport.numberTestErrors === 0, 'ORIGINAL_CORRECTION_CHANGED');
    return { orgId: production.orgId, inventoryHash: inventory.production.inventoryHash,
      inventoryEvidenceDigest: digest(Object.fromEntries(Object.entries(inventory).map(([stage, proof]) => [stage, proof.evidenceSha256]))),
      nativeProfileDigest: inventory.production.rawProfileDigest, ...catalog,
      validationReportDigest: digest(reportOf('validation')), deploymentReportDigest: digest(reportOf('deployment')) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
