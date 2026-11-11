import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { loadReviewedSalesforcePlan, assertReviewedInputsUnchanged, cliSalesforceProvider } from './deploy-salesforce-reviewed-manifest.mjs';
import { executeSharedMirror } from './sync-salesforce-shared-repository.mjs';
import { INVENTORY_BASELINE_MODE, REVIEWED_SALESFORCE_MODE, assertReviewedJobReport, reviewedCheckpointInventory, safeProjectFile, verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';
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
  const expected = reviewedCheckpointInventory(plan, stage, environment.key);
  const receipt = await verifyReviewedOrgInventory({ provider, environment, plan, expected, now });
  await assertUnchanged();
  const deveeBaseline = plan.binding.orgBaselines?.devee;
  return { releaseMode: REVIEWED_SALESFORCE_MODE, baselineMode: plan.binding.baselineMode,
    proofKind: plan.binding.baselineMode === INVENTORY_BASELINE_MODE ? 'verified-native-inventory-plus-covered-manifest' : 'verified-complete-baseline-plus-covered-manifest',
    sourceTreeHash: plan.binding.sourceTreeHash, baselineSourceTreeHash: deveeBaseline?.sourceTreeHash || plan.binding.baselineSourceTreeHash,
    baselineInventoryHash: deveeBaseline?.inventoryHash || plan.binding.baselineInventoryHash, manifestSha256: plan.binding.manifestSha256,
    fingerprint: plan.fingerprint, deploymentJobId: stage.deployment.jobId, verifiedAt: receipt.verifiedAt,
    ...(expected.nativeExport ? { nativeInventoryHash: receipt.inventoryHash, nativeSourceTreeHash: receipt.nativeSourceTreeHash,
      nativeEvidenceSha256: receipt.evidenceSha256 } : {}) };
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
  const report = await runReviewedMirror({ mode: modes[0].slice(2), cwd, plan, state, policy, provider, ownership: adapter.ownership });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function runReviewedMirror({ mode, cwd, plan, state, policy = POLICY, provider, ownership }) {
  if (!['check', 'publish'].includes(mode)) throw new Error('Reviewed mirror mode is invalid.');
  const proof = await reviewedDeveePublicationProof({ plan, state, policy, provider, assertUnchanged: () => assertReviewedInputsUnchanged(plan, { cwd, policy }) });
  let assertPublicationCurrent;
  if (mode === 'publish') {
    const intent = state.stages?.shared_mirror?.publication;
    const orgId = policy.environments[0].orgId;
    const receipt = await ownership?.assert?.({ fingerprint: plan.fingerprint, stage: 'devee', orgId, operation: 'shared-publication' });
    assertPublicationCurrent = () => {
      if (intent?.status !== 'submitting' || !intent.receiptId || receipt?.receiptId !== intent.receiptId
        || receipt.fingerprint !== plan.fingerprint || receipt.orgId !== orgId || receipt.stage !== 'devee' || receipt.operation !== 'shared-publication'
        || !(Math.min(Date.parse(intent.receiptExpiresAt), Date.parse(receipt.expiresAt)) > Date.now())) {
        throw new Error('Reviewed mirror publication requires the original durable intent and unexpired ownership.');
      }
      assertReviewedInputsUnchanged(plan, { cwd, policy });
    };
    assertPublicationCurrent();
  }
  assertReviewedInputsUnchanged(plan, { cwd, policy });
  return executeSharedMirror({ mode, metadataRoot: path.join(cwd, policy.publication.sourceRoot), assertPublicationCurrent, proofResolver(inventory) {
    assertReviewedInputsUnchanged(plan, { cwd, policy });
    if (inventory.sourceTreeHash !== proof.sourceTreeHash) throw new Error('Derived DEVEE source changed before byte-for-byte publication.');
    return proof;
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
