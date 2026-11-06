import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { loadReviewedSalesforcePlan, assertReviewedInputsUnchanged, cliSalesforceProvider } from './deploy-salesforce-reviewed-manifest.mjs';
import { main as syncSharedRepository } from './sync-salesforce-shared-repository.mjs';
import { INVENTORY_BASELINE_MODE, REVIEWED_SALESFORCE_MODE, assertReviewedJobReport, safeProjectFile, verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';
import { salesforcePromotionHash } from './lib/salesforce-promotion-journal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');

export async function reviewedDeveePublicationProof({ plan, state, policy = POLICY, provider, assertUnchanged, now = () => new Date() }) {
  if (state?.fingerprint !== plan.fingerprint || salesforcePromotionHash(state.binding) !== plan.fingerprint
    || state.binding.releaseMode !== REVIEWED_SALESFORCE_MODE) throw new Error('Incremental publication state does not match the reviewed baseline-plus-manifest fingerprint.');
  const environment = policy.environments[0], stage = state.stages?.devee;
  if (environment.key !== 'devee' || stage?.validation?.status !== 'Succeeded' || stage?.deployment?.status !== 'Succeeded'
    || stage.deployment.validationJobId !== stage.validation.jobId || stage.validation.fingerprint !== plan.fingerprint
    || stage.deployment.fingerprint !== plan.fingerprint || stage.validation.orgId !== environment.orgId || stage.deployment.orgId !== environment.orgId) throw new Error('Publication requires verified DEVEE incremental validation and deployment jobs.');
  await assertUnchanged(); await provider.verifyIdentity(environment);
  const baseline = plan.binding.baselineJobs?.devee;
  for (const [validation, jobId] of [...(baseline ? [[true, baseline.validationJobId], [false, baseline.deploymentJobId]] : []), [true, stage.validation.jobId], [false, stage.deployment.jobId]]) {
    assertReviewedJobReport(await provider.report(environment, jobId), { environment, jobId, validation,
      testPlan: jobId === baseline?.validationJobId || jobId === baseline?.deploymentJobId ? { level: 'RunLocalTests', tests: [], minimumTests: 1 } : plan.binding.testPlan,
      expectedComponents: jobId === baseline?.validationJobId || jobId === baseline?.deploymentJobId ? [] : plan.manifest });
  }
  await verifyReviewedOrgInventory({ provider, environment, plan, expected: plan.finalInventory, now });
  await assertUnchanged();
  return { releaseMode: REVIEWED_SALESFORCE_MODE, baselineMode: plan.binding.baselineMode,
    proofKind: plan.binding.baselineMode === INVENTORY_BASELINE_MODE ? 'verified-native-inventory-plus-covered-manifest' : 'verified-complete-baseline-plus-covered-manifest',
    sourceTreeHash: plan.binding.sourceTreeHash, baselineSourceTreeHash: plan.binding.baselineSourceTreeHash,
    baselineInventoryHash: plan.binding.baselineInventoryHash, manifestSha256: plan.binding.manifestSha256,
    fingerprint: plan.fingerprint, deploymentJobId: stage.deployment.jobId, verifiedAt: new Date().toISOString() };
}

export async function main(argv = process.argv.slice(2), { cwd = ROOT, policy = POLICY } = {}) {
  const values = {}, modes = [];
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (['--check', '--publish'].includes(name)) modes.push(name);
    else if (['--manifest', '--review', '--state', '--adapter'].includes(name) && !values[name] && argv[index + 1] && !argv[index + 1].startsWith('-')) values[name] = argv[++index];
    else throw new Error('Unknown or incomplete reviewed mirror option.');
  }
  if (modes.length !== 1 || ['--manifest', '--review', '--state', '--adapter'].some(name => !values[name])) throw new Error('Reviewed mirror requires one mode and exact manifest/review/state/adapter paths.');
  const plan = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: values['--manifest'], reviewPath: values['--review'] });
  const state = JSON.parse(readFileSync(safeProjectFile(cwd, values['--state']), 'utf8'));
  const module = await import(pathToFileURL(safeProjectFile(cwd, values['--adapter'])).href);
  const adapter = await module.createSalesforceAdapter({ cwd, plan, policy });
  const provider = cliSalesforceProvider({ cwd, policy, adapter });
  const proof = await reviewedDeveePublicationProof({ plan, state, policy, provider, assertUnchanged: () => assertReviewedInputsUnchanged(plan, { cwd, policy }) });
  if (modes[0] === '--publish') {
    const receipt = await adapter?.ownership?.assert?.({ fingerprint: plan.fingerprint, stage: 'devee', orgId: policy.environments[0].orgId, operation: 'shared-publication' });
    if (!receipt?.receiptId || receipt.fingerprint !== plan.fingerprint || receipt.orgId !== policy.environments[0].orgId
      || receipt.stage !== 'devee' || receipt.operation !== 'shared-publication' || !(Date.parse(receipt.expiresAt) > Date.now()) || typeof adapter?.journal?.checkpoint !== 'function') throw new Error('Reviewed mirror publication requires fresh external release ownership and durable intent.');
    await adapter.journal.checkpoint({ fingerprint: plan.fingerprint, stage: 'shared_mirror', operation: 'publication', record: { status: 'submitting', receiptId: receipt.receiptId } });
  }
  assertReviewedInputsUnchanged(plan, { cwd, policy });
  return syncSharedRepository({ proofResolver(inventory) {
    assertReviewedInputsUnchanged(plan, { cwd, policy });
    if (inventory.sourceTreeHash !== proof.sourceTreeHash) throw new Error('Derived DEVEE source changed before byte-for-byte publication.');
    return proof;
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
