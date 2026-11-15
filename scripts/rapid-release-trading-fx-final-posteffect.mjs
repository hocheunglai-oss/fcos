import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, requireCondition, targets } from './lib/rapid-release/contract.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import {
  appendTradingFxFinalPosteffect, buildTradingFxFinalPosteffectClosure, readTradingFxFinalPosteffectCheckpoint,
} from './lib/rapid-release/trading-fx-final-posteffect-checkpoint.mjs';
import { readTradingFxFinalPosteffectRetainedEvidence } from './lib/rapid-release/trading-fx-final-posteffect-history.mjs';
import { verifyTradingFxFinalPosteffectSalesforce } from './lib/rapid-release/trading-fx-final-posteffect-salesforce.mjs';

const appSha = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
const mirrorHead = '389f39aecc6e80da7b57f0b78a1748b456b683a8';
const mirrorEnvironment = 'fcos-trading-fx-final-mirror-readback-v1';
const workflow = '.github/workflows/fcos-rapid-trading-fx-final-posteffect.yml';
const check = (value, code) => requireCondition(value, 'TRADING_FX_FINAL_POSTEFFECT_' + code);

export function verifyFinalPosteffectMirrorEvidence({ receipt, id, manifest, now = Date.now() }) {
  const report = receipt?.payload?.report;
  const created = Date.parse(receipt?.created_at);
  const checked = Date.parse(receipt?.payload?.verifiedAt);
  const { salesSupportRepair } = manifest.prerequisites.plan;
  check(receipt?.id === id && receipt.creator?.id === 265701760 && receipt.creator.login === targets().account
    && receipt.environment === mirrorEnvironment && receipt.sha === manifest.candidate.sha
    && receipt.payload.kind === mirrorEnvironment && receipt.payload.originalRunId === 43747330923
    && receipt.payload.manifestHash === digest(manifest) && receipt.payload.originalCheckReceiptId === 7810512558
    && checked >= now - 20 * 60000 && checked <= created + 1000 && created <= now + 30000
    && report?.mode === 'check' && report.changed === false && report.repository === 'ivanyk20/fcbhk'
    && report.account === targets().account && report.sourceFiles === 976 && report.sourceEnvironment === 'devee'
    && report.sourceDeploymentJobId === '0AfHF000007H9XV0A0' && report.sourceTreeHash === salesSupportRepair.sourceTreeHash
    && report.commit === mirrorHead && report.pullRequestNumber === 9 && report.pullRequestIsDraft === true
    && report.pullRequest?.state === 'OPEN' && report.pullRequest.headRefOid === mirrorHead
    && receipt.payload.reportDigest === digest(report), 'MIRROR_NATIVE_READBACK_INVALID');
  return { receiptId: id, reportDigest: receipt.payload.reportDigest };
}

export async function runFinalPosteffect({ env = process.env } = {}) {
  const { repository, account } = targets();
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === repository
    && env.GITHUB_ACTOR === account && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_REF_PROTECTED === 'true'
    && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && /^[1-9]\d*$/u.test(env.FCOS_FINAL_MIRROR_EVIDENCE_ID || ''),
  'PROTECTED_WORKFLOW_REQUIRED');
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: appSha });
  const base = '/repos/' + repository;
  const run = await github.read(base + '/actions/runs/' + env.GITHUB_RUN_ID);
  check(run.id === Number(env.GITHUB_RUN_ID) && run.repository?.id === 1278654816 && run.actor?.id === 265701760
    && run.head_sha === env.GITHUB_SHA && run.head_branch === 'main' && run.status === 'in_progress'
    && nativeWorkflowPath(run) === workflow, 'PROTECTED_WORKFLOW_REQUIRED');
  const verified = await readTradingFxFinalPosteffectCheckpoint({ github });
  if (verified.closed) return { closureId: verified.closed.closure.id, state: 'original_close_already_observed' };
  const { manifest, staged } = verified;
  const pointer = env.FCOS_RAPID_RELEASE_HANDOVER_ID;
  check(pointer === '7807915751' && env.FCOS_RAPID_RELEASE_ENABLED === 'true', 'CONTROLLER_CHANGED');
  const [record, mirrorReceipt] = await Promise.all([
    github.read(base + '/deployments/' + pointer),
    github.read(base + '/deployments/' + env.FCOS_FINAL_MIRROR_EVIDENCE_ID),
  ]);
  const handover = assertPermanentHandover(record, manifest, 265701760);
  await assertNativeHandoverState({ handover, env });
  const mirror = verifyFinalPosteffectMirrorEvidence({ receipt: mirrorReceipt, id: Number(env.FCOS_FINAL_MIRROR_EVIDENCE_ID), manifest });
  const provider = vercelProvider({ manifest, github, env });
  const [baseline, deployment] = await Promise.all([
    nativeCompatibilityReader({ provider, env })({ manifest }),
    provider.ready(staged.id),
  ]);
  check(baseline.currentDeploymentId === manifest.previous.deploymentId && baseline.sha === manifest.previous.sha
    && baseline.schemaDigest === manifest.previous.schemaDigest && baseline.configurationDigest === manifest.previous.configurationDigest
    && deployment.id === staged.id && deployment.sha === manifest.candidate.sha && deployment.buildId === staged.buildId
    && deployment.artifactDigest === staged.artifactDigest && deployment.state === 'READY', 'LIVE_OR_STAGED_BOUNDARY_CHANGED');
  const retained = await readTradingFxFinalPosteffectRetainedEvidence({
    verified: { ...verified, signingProvider: provider }, github, env, baseline,
  });
  const native = await verifyTradingFxFinalPosteffectSalesforce({
    verified, cwd: resolve(env.GITHUB_WORKSPACE, 'original-application'),
    correctionDirectory: resolve(env.GITHUB_WORKSPACE, 'original-correction'), env,
  });
  const reread = await provider.currentProduction();
  check(reread.id === baseline.currentDeploymentId && reread.sha === baseline.sha, 'LIVE_OR_STAGED_BOUNDARY_CHANGED');
  const result = buildTradingFxFinalPosteffectClosure({ verified, evidence: {
    observedAt: new Date().toISOString(), baseline: manifest.previous, ...native,
    inventoryEvidenceDigest: digest({ native: native.inventoryEvidenceDigest, mirror }),
    databaseOperation: retained.databaseOperation,
  } });
  const { closure } = await appendTradingFxFinalPosteffect({ github, verified, result });
  return { closureId: closure.id, state: 'closed_original_prerequisite' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFinalPosteffect().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^(?:TRADING_FX|SALESFORCE|GITHUB|NATIVE|VERCEL|PRODUCTION|CURRENT)_[A-Z_0-9]+$/u.test(error?.message || '')
      ? error.message : 'TRADING_FX_FINAL_POSTEFFECT_READBACK_FAILED');
    process.exitCode = 1;
  });
}
