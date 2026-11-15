import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { promoteSalesSupportCorrection } from '../scripts/lib/rapid-release/trading-fx-sales-support-promotion.mjs';

const fingerprint = digest('correction');
const sourceTreeHash = digest('corrected owned tree');
const originalMirror = { commit: 'e'.repeat(40), pullRequest: { number: 9 } };
const corrected = { sourceTreeHash, sourceDeploymentJobId: '0AfHF000007GzzZ0AS',
  commit: 'f'.repeat(40), pullRequest: { number: 9 } };
const evidence = stage => ({ operationId: 'salesforce:' + stage + ':sales-support-correction',
  evidenceDigest: digest(stage), verified: true, intentRecorded: true });

function fixture() {
  const events = [];
  let saved;
  const options = {
    fingerprint, sourceTreeHash, originalMirror,
    verifySource: () => events.push('source'),
    verifySandbox: stage => events.push('inventory:' + stage),
    context: {
      ownership: { assert: () => ({ receiptId: digest('lease'), expiresAt: new Date(Date.now() + 90000).toISOString() }) },
      journal: {
        readCheckpoints: () => saved ? [saved] : [],
        checkpoint({ stage, operation, record }) {
          events.push('journal:' + record.status);
          saved = { stage, operation, evidenceDigest: digest(record), ...record.result
            ? { outcome: 'resolved', mirror: { commit: record.result.commit } } : { outcome: 'pending' } };
        },
      },
    },
    sandbox(stage) {
      events.push(stage);
      return { ...evidence(stage), jobId: corrected.sourceDeploymentJobId };
    },
    mirror(mode) {
      events.push('mirror:' + mode);
      assert.ok(saved?.outcome);
      return corrected;
    },
    production() { events.push('production'); return evidence('production'); },
  };
  return { options, events, preexisting: row => { saved = row; } };
}

test('correction verifies both sandbox inventories and complete mirror before the Production overlay', async () => {
  const { options, events } = fixture();
  const result = await promoteSalesSupportCorrection(options);
  assert.deepEqual(result.operations.map(({operationId}) => operationId),
    ['devee', 'shared_mirror', 'qat', 'production'].map(stage => evidence(stage).operationId));
  await result.verifyMirror();
  assert.deepEqual(events, ['source', 'devee', 'inventory:devee', 'source', 'journal:submitting',
    'mirror:publish', 'journal:Succeeded', 'source', 'qat', 'inventory:qat', 'source', 'production', 'mirror:check']);
});

test('uncertain publication triggers exact readback and never submits another mirror publication', async () => {
  const { options, events, preexisting } = fixture();
  preexisting({ stage: 'shared_mirror', operation: 'publication', outcome: 'pending' });
  await promoteSalesSupportCorrection(options);
  assert.ok(events.includes('mirror:recover'));
  assert.ok(!events.includes('mirror:publish'));
});

test('mirror drift or missing QAT verification prevents the Production overlay', async () => {
  const first = fixture();
  first.options.mirror = () => ({ ...corrected, sourceTreeHash: digest('different files') });
  await assert.rejects(promoteSalesSupportCorrection(first.options), /MIRROR_CHANGED/u);
  assert.ok(!first.events.includes('qat'));
  assert.ok(!first.events.includes('production'));
  const second = fixture();
  second.options.verifySandbox = stage => {
    if (stage === 'qat') throw new Error('unexpected profile drift');
  };
  await assert.rejects(promoteSalesSupportCorrection(second.options), /unexpected profile drift/u);
  assert.ok(!second.events.includes('production'));
});
