import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';
import { appendBootstrapClosure } from '../scripts/rapid-release-bootstrap-failure-recovery.mjs';

const owner = 265701760;
const candidateSha = 'a'.repeat(40);
function fixture({ loseAcknowledgement = false, suppressWrite = false } = {}) {
  const original = { stage: 'production', operation: 'bootstrap', fingerprint: 'b'.repeat(64), outcome: 'pending',
    job: { id: '0Affu000001ACSLCA4' } };
  const historical = [
    { payload: { event: 'prerequisites.intent', data: { operationId: 'original' } } },
    { payload: { event: 'salesforce.checkpoint', data: original, sequence: 1, recordHash: 'c'.repeat(64) } },
  ];
  const evidence = { job: original.job, terminalStatus: 'Failed', rollbackOnError: true };
  const records = [...historical];
  const writes = [];
  const input = { candidateSha, base: '/repos/hocheunglai-oss/fcos', historical, existing: [],
    fresh: { result: { operationId: 'original', evidenceDigest: digest(evidence) },
      checkpoint: { ...original, outcome: 'resolved', terminalOutcome: 'failed_rolled_back', evidence, evidenceDigest: digest(evidence) } },
    github: { async pages() { return records; } },
    journal: {
      async read() { return records; },
      async append(event, data, { expectedPreviousHash }) {
        assert.equal(records.at(-1).payload.recordHash, expectedPreviousHash);
        writes.push(event);
        if (!suppressWrite) {
          const content = { ...records.at(-1).payload, recordHash: undefined, event, data, sequence: records.length,
            previousHash: expectedPreviousHash };
          records.push({ id: 100 + writes.length, creator: { id: owner }, sha: candidateSha,
            payload: { ...content, recordHash: digest(content) } });
        }
        if (loseAcknowledgement || suppressWrite) throw new Error('lost acknowledgement');
      },
    },
  };
  return { input, writes, records };
}

test('closure verifies the original native acknowledgement before advancing to the next receipt', async () => {
  const { input, writes, records } = fixture({ loseAcknowledgement: true });
  const result = await appendBootstrapClosure(input);
  assert.deepEqual(result.receiptIds, [101, 102]);
  assert.deepEqual(writes, ['prerequisites.result', 'salesforce.checkpoint']);
  assert.deepEqual(pendingOperations(records), []);
});

test('unobserved receipt acknowledgement stops without submitting a second receipt', async () => {
  const { input, writes, records } = fixture({ suppressWrite: true });
  await assert.rejects(appendBootstrapClosure(input), /BOOTSTRAP_CLOSURE_ACKNOWLEDGEMENT_UNCERTAIN/);
  assert.deepEqual(writes, ['prerequisites.result']);
  assert.equal(pendingOperations(records).length, 2);
});
