import assert from 'node:assert/strict';
import test from 'node:test';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { paymentSalesSupportRepairPackage } from '../scripts/lib/rapid-release/trading-fx-payment-profile-repair.mjs';
import { applyTradingFxPaymentSuccessor, readTradingFxPaymentSuccessor } from '../scripts/lib/rapid-release/trading-fx-payment-successor.mjs';

const hour = 60 * 60_000;
const sha = char => char.repeat(40);
const hash = char => char.repeat(64);
const bind = fields => ({ ...fields, correctionFingerprint: digest(fields) });

function fixture() {
  const now = Date.now();
  const candidate = { sha: sha('a'), sourceDigest: hash('b'), lockDigest: hash('c') };
  const previous = { deploymentId: 'dpl_older', sha: sha('d'), configurationDigest: hash('e'), schemaDigest: hash('f') };
  const paths = ['force-app/main/default/classes/Payment.cls', 'supabase/migrations/0001_payment.sql'];
  const publicEnvironment = { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` };
  const salesSupportRepair = { viewAllFieldsCorrection: true, sourceCommit: sha('0'), sourceTreeHash: hash('1'), correctionFingerprint: hash('2') };
  const plan = { salesSupportRepair, xeroQualificationDeploymentId: 42, xeroQualificationDigest: hash('3'),
    salesforceFingerprint: hash('4'), mirrorPublication: 'local-collaborator' };
  const original = { candidate, previous, paths, publicEnvironment, controllerSha: sha('4'), releaseId: 'original-payment-pr219',
    prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest: hash('5'), plan }, now: new Date(now - hour).toISOString() };
  const originalManifest = createManifest(original);
  const { profileDigest, manifestDigest } = paymentSalesSupportRepairPackage();
  const repair = bind({ sourceCommit: sha('6'), sourceTreeHash: hash('7'), sourceProfileDigest: hash('8'), profileDigest, manifestDigest });
  const closure = { id: 1234, created_at: new Date(now - hour / 2).toISOString() };
  const successor = { ...original, controllerSha: sha('9'), releaseId: 'payment-profile-successor',
    now: new Date(now - 30_000).toISOString(), prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest: hash('a'),
      plan: { ...plan, tradingFxFinalPosteffectClosureReceiptId: closure.id, paymentRepair: repair } } };
  const originalApproval = { manifestHash: digest(originalManifest), candidateSha: candidate.sha, buildId: originalManifest.build.buildId,
    deploymentId: 'dpl_stage', previousDeploymentId: previous.deploymentId, environment: 'fcos-production-release', reviewer: targets().account,
    nativeReviewVerified: true, runId: 1001, approvedAt: original.now };
  const verified = { manifest: originalManifest, approval: originalApproval, closed: { closure } };
  const github = {};
  const read = manifest => readTradingFxPaymentSuccessor({ manifest, github }, {
    readClosed: async input => { assert.equal(input.github, github); return verified; },
  });
  return { read, verified, github, successor, originalApproval };
}

test('admits only the exact stopped release and the new bound Payment scope', async () => {
  const f = fixture();
  const manifest = createManifest(f.successor);
  assert.equal(await f.read(manifest), f.verified);
  const prior = structuredClone(manifest);
  prior.prerequisites.plan.tradingFxFinalPosteffectClosureReceiptId += 1;
  await assert.rejects(f.read(prior), /TRADING_FX_PAYMENT_SUCCESSOR_SCOPE_CHANGED/);
  delete f.verified.closed;
  await assert.rejects(f.read(manifest), /TRADING_FX_PAYMENT_SUCCESSOR_SCOPE_CHANGED/);
});

test('rejects changes to prior metadata, build inputs and controller boundaries', async () => {
  for (const alter of [
    value => { value.prerequisites.plan.salesforceFingerprint = hash('0'); },
    value => { value.prerequisites.plan.salesSupportRepair = { ...value.prerequisites.plan.salesSupportRepair, sourceTreeHash: hash('0') }; },
    value => { value.prerequisites.plan.extraMetadataWrites = true; },
    value => { value.paths = [...value.paths, 'api/unrelatedMutation.js']; },
    value => { value.previous = { ...value.previous, deploymentId: 'dpl_wrong' }; },
    value => { value.controllerSha = sha('4'); },
    value => { value.prerequisites.adapterDigest = hash('5'); },
    value => { value.releaseId = 'original-payment-pr219'; },
  ]) {
    const f = fixture();
    alter(f.successor);
    await assert.rejects(f.read(createManifest(f.successor)), /TRADING_FX_PAYMENT_SUCCESSOR_SCOPE_CHANGED/);
  }
});

test('rejects original native approval and a rebound original run before opening provider context', async () => {
  const f = fixture();
  const manifest = createManifest(f.successor);
  const input = { manifest, approval: f.originalApproval,
    authorization: { manifestHash: digest(manifest), nativeReview: f.originalApproval },
    salesforce: { correction: {} }, salesforceCandidateDirectory: 'old', correctionDirectory: 'new' };
  await assert.rejects(applyTradingFxPaymentSuccessor({ input, verified: f.verified, github: f.github }),
    { code: 'EXACT_PRODUCTION_AUTHORIZATION_REQUIRED' });
  input.approval = { ...f.originalApproval, approvedAt: manifest.createdAt, manifestHash: digest(manifest) };
  input.authorization.nativeReview = input.approval;
  await assert.rejects(applyTradingFxPaymentSuccessor({ input, verified: f.verified, github: f.github }),
    { code: 'TRADING_FX_PAYMENT_SUCCESSOR_EXACT_AUTHORIZATION_REQUIRED' });
});
