import assert from 'node:assert/strict';
import test from 'node:test';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { appendReminderClosure, assertClosureApproval, closureResult, original, productionEnvironment,
  reminderClosureJournal, verifyJournalBoundary } from '../scripts/lib/rapid-release/invoice-reminders-qat-closure.mjs';
import { assertTerminalQatReport, readTerminalQatReport, verifyFreshEvidence }
  from '../scripts/rapid-release-invoice-reminders-qat-closure.mjs';

const evidenceDigest = 'a'.repeat(64);
const closureRunId = 44910000000;
const owner = { id: original.ownerId, login: 'hocheunglai-oss' };
const bot = { id: original.botId, login: 'github-actions[bot]' };
const completedAt = '2026-11-21T13:54:23Z';
const result = closureResult({ evidenceDigest, closureRunId });

const event = (name, data, creator = bot) => ({
  sha: original.candidate, ref: original.candidate, task: 'fcos-release-journal', environment: 'fcos-release-journal-v1',
  creator, payload: { event: name, data },
});
function terminalChain() {
  const chain = Array.from({ length: 23 }, () => event('obstacle.detected', {}));
  chain[6] = event('prerequisites.intent', { operationId: result.operationId });
  chain[22].payload.recordHash = original.head;
  return chain;
}
function savedReceipt(data = result) {
  const saved = event('prerequisites.result', data, owner);
  saved.payload.previousHash = original.head;
  saved.created_at = '2026-11-21T14:00:00Z';
  saved.id = 7965000000;
  return saved;
}

test('the exact original Production environment and owner approval are required', () => {
  const approved = { state: 'approved', user: owner, environments: [productionEnvironment] };
  assert.doesNotThrow(() => assertClosureApproval([approved]));
  for (const invalid of [[], [approved, approved], [{ ...approved, state: 'rejected' }],
    [{ ...approved, user: { ...owner, id: owner.id + 1 } }],
    [{ ...approved, environments: [{ ...productionEnvironment, id: 1 }] }]]) {
    assert.throws(() => assertClosureApproval(invalid), /REMINDER_CLOSURE_NATIVE_APPROVAL_REQUIRED/u);
  }
});

test('requires the original head, candidate, and only the known pending prerequisite', () => {
  assert.equal(verifyJournalBoundary(terminalChain(), completedAt).receipt, undefined);
  const wrongHead = terminalChain();
  wrongHead[22].payload.recordHash = evidenceDigest;
  assert.throws(() => verifyJournalBoundary(wrongHead, completedAt), /REMINDER_CLOSURE_JOURNAL_HEAD_CHANGED/u);
  const wrongCandidate = terminalChain();
  wrongCandidate[6].sha = 'f'.repeat(40);
  assert.throws(() => verifyJournalBoundary(wrongCandidate, completedAt), /REMINDER_CLOSURE_JOURNAL_HEAD_CHANGED/u);
  const unknown = terminalChain();
  unknown[20] = event('promote.intent', { operationId: 'unknown-promotion' });
  assert.throws(() => verifyJournalBoundary(unknown, completedAt), /REMINDER_CLOSURE_PENDING_SCOPE_CHANGED/u);
});

test('a stored terminal closure preserves native jobs and refuses fabricated success', () => {
  const receipt = savedReceipt();
  assert.equal(verifyJournalBoundary([...terminalChain(), receipt], completedAt).receipt, receipt);
  assert.deepEqual([receipt.payload.data.deveeValidationJobId, receipt.payload.data.deveeDeploymentJobId,
    receipt.payload.data.qatValidationJobId, receipt.payload.data.mirrorReceiptId],
  [original.deveeValidationId, original.deveeDeploymentId, original.qatValidationId, original.mirrorReceiptId]);
  assert.throws(() => verifyJournalBoundary([...terminalChain(), savedReceipt({ ...result, outcome: 'applied' })], completedAt),
    /REMINDER_CLOSURE_RECEIPT_MISMATCH/u);
  assert.throws(() => verifyJournalBoundary([...terminalChain(), savedReceipt({ ...result, qatDeploymentSubmitted: true })], completedAt),
    /REMINDER_CLOSURE_RECEIPT_MISMATCH/u);
});

test('two native Deployment objects cannot be mistaken for one journal result', async () => {
  const row = { payload: { releaseId: original.releaseId, recordHash: evidenceDigest } };
  const journal = reminderClosureJournal({ candidateSha: original.candidate, pages: async () => [row, { ...row, id: 12 }] });
  await assert.rejects(journal.read(), /REMINDER_CLOSURE_DUPLICATE_NATIVE_RECORD/u);
});

test('preflight must still bind the exact approved live schema and be recent', () => {
  const baseline = { sha: 'b'.repeat(40), deploymentId: 'dpl_previous', configurationDigest: 'c'.repeat(64), schemaDigest: 'd'.repeat(64) };
  const stamp = { runId: closureRunId, attempt: 1, source: 'e'.repeat(40), journalHead: original.head };
  const evidence = { baseline, observedAt: new Date().toISOString(), stagedDeploymentId: original.stagedDeploymentId,
    stagedArtifactDigest: original.stagedArtifactDigest, handoverEvidence: { evidenceDigest },
    mirror: { commit: original.mirrorCommit, pullRequest: original.mirrorPullRequest, tree: 'f'.repeat(40), sourceTreeHash: original.sourceTreeHash },
    salesforce: { deveeValidationDigest: evidenceDigest, deveeDeploymentDigest: evidenceDigest,
      failure: { jobId: original.qatValidationId, status: 'Failed', checkOnly: true, reportSha256: evidenceDigest },
      inventory: Object.fromEntries(['devee', 'qat', 'production'].map(name => [name, {
        orgId: fcosSalesforceEnvironment(name).orgId, sha256: evidenceDigest,
      }])) },
  };
  const preflight = { stamp, evidence };
  assert.doesNotThrow(() => verifyFreshEvidence(preflight, stamp, { previous: baseline }));
  assert.throws(() => verifyFreshEvidence(preflight, stamp, { previous: { ...baseline, schemaDigest: evidenceDigest } }),
    /REMINDER_CLOSURE_FRESH_PREFLIGHT_REQUIRED/u);
  assert.throws(() => verifyFreshEvidence({ stamp, evidence: { ...evidence, observedAt: '2020-01-01T00:00:00Z' } }, stamp,
    { previous: baseline }), /REMINDER_CLOSURE_FRESH_PREFLIGHT_REQUIRED/u);
});

const nativeFailure = {
  id: original.qatValidationId, status: 'Failed', done: true, checkOnly: true, numberComponentErrors: 0,
  numberTestsTotal: 100, numberTestErrors: 1, completedDate: '2026-11-21T13:54:15.000Z',
  details: { runTestResult: { failures: [{ name: 'InvoiceControllerTest',
    methodName: 'restrictedSalesSupportCanReadInvoiceBlockerAndCaptureOneReminder' }] } },
};

test('only the exact native terminal check-only failure qualifies', () => {
  const timing = { submittedAt: '2026-11-21T13:52:46.250Z', completedBy: completedAt };
  const proof = assertTerminalQatReport(nativeFailure, timing);
  assert.deepEqual([proof.jobId, proof.status, proof.checkOnly], [original.qatValidationId, 'Failed', true]);
  for (const changed of [{ checkOnly: false }, { done: false }, { status: 'InProgress' }, { status: 'Succeeded' },
    { numberTestErrors: 2 }, { completedDate: '2026-11-21T13:59:00Z' }]) {
    assert.throws(() => assertTerminalQatReport({ ...nativeFailure, ...changed }, timing), /REMINDER_CLOSURE_QAT_TERMINAL_REPORT_MISMATCH/u);
  }
});

test('Salesforce CLI can return the terminal report with a nonzero exit code', () => {
  const run = (command, args) => {
    assert.equal(command, 'sf');
    assert.deepEqual(args.slice(0, 3), ['project', 'deploy', 'report']);
    assert.equal(args[args.indexOf('--job-id') + 1], original.qatValidationId);
    return { status: 1, stdout: JSON.stringify({ status: 1, result: nativeFailure }) };
  };
  assert.deepEqual(readTerminalQatReport({ run }), nativeFailure);
  assert.throws(() => readTerminalQatReport({ run: () => ({ status: 1, stdout: '{"status":1}' }) }),
    /REMINDER_CLOSURE_QAT_REPORT_UNAVAILABLE/u);
});

test('readback resolves a lost append acknowledgement and a later call is idempotent', async () => {
  let receipt;
  let writes = 0;
  const read = async () => ({ receipt });
  const journal = { append: async (name, data, options) => {
    writes += 1;
    assert.equal(name, 'prerequisites.result');
    assert.deepEqual(options, { expectedPreviousHash: original.head });
    receipt = savedReceipt(data);
    throw new Error('transport dropped the acknowledgement');
  } };
  assert.equal(await appendReminderClosure({ read, journal, evidenceDigest, closureRunId }), receipt);
  assert.equal(await appendReminderClosure({ read, journal, evidenceDigest, closureRunId }), receipt);
  assert.equal(writes, 1);
});

test('an unknown append is reported after one readback and is never submitted twice', async () => {
  let reads = 0;
  let writes = 0;
  const read = async () => {
    reads += 1;
    return {};
  };
  const journal = { append: async () => {
    writes += 1;
    throw new Error('transport failed');
  } };
  await assert.rejects(appendReminderClosure({ read, journal, evidenceDigest, closureRunId }),
    /REMINDER_CLOSURE_APPEND_OUTCOME_UNCERTAIN/u);
  assert.deepEqual([reads, writes], [2, 1]);
});

test('an advanced journal head stops the closure without a second append', async () => {
  let reads = 0;
  let writes = 0;
  const read = async () => {
    reads += 1;
    return {};
  };
  const journal = { append: async () => {
    writes += 1;
    throw new Error('JOURNAL_ADVANCED');
  } };
  await assert.rejects(appendReminderClosure({ read, journal, evidenceDigest, closureRunId }), /JOURNAL_ADVANCED/u);
  assert.deepEqual([reads, writes], [1, 1]);
});
