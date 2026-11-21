import assert from 'node:assert/strict';
import test from 'node:test';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { appendReminderClosure, assertClosureApproval, closureResult, original, productionEnvironment,
  reminderClosureJournal, schemaPins, verifyJournalBoundary } from '../scripts/lib/rapid-release/invoice-reminders-qat-closure.mjs';
import { assertNoCompetingClosureWork, assertTerminalQatReport, readClosureSchema, readTerminalQatReport, verifyFreshEvidence }
  from '../scripts/rapid-release-invoice-reminders-qat-closure.mjs';

const evidenceDigest = 'a'.repeat(64);
const closureRunId = 44910000000;
const owner = { id: original.ownerId, login: 'hocheunglai-oss' };
const bot = { id: original.botId, login: 'github-actions[bot]' };
const completedAt = '2026-11-21T13:54:23Z';
const unchangedSchema = { approved: schemaPins.approved, observed: schemaPins.approved, historical: schemaPins.approved,
  storageMigrationId: null };
const verifiedStorageDrift = { ...unchangedSchema, observed: schemaPins.storageMigration80, storageMigrationId: 80 };
const closureInputs = { evidenceDigest, closureRunId, schemaProof: unchangedSchema };
const result = closureResult(closureInputs);

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
  const baseline = { sha: 'b'.repeat(40), deploymentId: 'dpl_previous', configurationDigest: 'c'.repeat(64), schemaDigest: schemaPins.approved };
  const stamp = { runId: closureRunId, attempt: 1, source: 'e'.repeat(40), journalHead: original.head };
  const evidence = { baseline, schemaProof: unchangedSchema, observedAt: new Date().toISOString(), stagedDeploymentId: original.stagedDeploymentId,
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
    /REMINDER_CLOSURE_PRODUCTION_PREIMAGE_CHANGED/u);
  assert.throws(() => verifyFreshEvidence({ stamp, evidence: { ...evidence, baseline: { ...baseline, schemaDigest: schemaPins.storageMigration80 } } },
    stamp, { previous: baseline }), /REMINDER_CLOSURE_PRODUCTION_PREIMAGE_CHANGED/u);
  assert.doesNotThrow(() => verifyFreshEvidence({ stamp, evidence: { ...evidence, schemaProof: verifiedStorageDrift,
    baseline: { ...baseline, schemaDigest: schemaPins.storageMigration80 } } }, stamp, { previous: baseline }));
  assert.throws(() => verifyFreshEvidence({ stamp, evidence: { ...evidence, observedAt: '2020-01-01T00:00:00Z' } }, stamp,
    { previous: baseline }), /REMINDER_CLOSURE_FRESH_PREFLIGHT_REQUIRED/u);
});

test('the unchanged approved catalog passes without a Storage migration exception', async () => {
  const db = { query: async () => ({ rows: [{ observed: schemaPins.approved, historical: null }] }) };
  assert.deepEqual(await readClosureSchema(db, schemaPins.approved), unchangedSchema);
});

const storageMigrationReadback = { observed: schemaPins.storageMigration80, historical: schemaPins.approved,
  relation_count: 2, relation_matches: 2, function_count: 2, function_matches: 2 };

test('only the four observed Storage ACL entries reconstruct the exact original catalog', async () => {
  const db = { query: async (sql, inputs) => {
    assert.match(sql, /^with snapshot as materialized \(select jsonb_build_object\(/u);
    assert.match(sql, /storage\.reconcile_lifecycle_state\(text,boolean\)/u);
    assert.match(sql, /storage\.delete_lifecycle_objects\(uuid\[\]\)/u);
    assert.match(sql, /'bucket_lifecycle_states','lifecycle_abandoned_artifacts'/u);
    assert.equal(inputs[0], schemaPins.storageMigration80);
    assert.deepEqual(JSON.parse(inputs[3]), ['supabase_storage_admin=X/supabase_storage_admin', 'service_role=X/supabase_storage_admin']);
    return { rows: [storageMigrationReadback] };
  } };
  assert.deepEqual(await readClosureSchema(db, schemaPins.approved), verifiedStorageDrift);
  assert.deepEqual(closureResult({ ...closureInputs, schemaProof: verifiedStorageDrift }).schemaProof, verifiedStorageDrift);
});

test('an unknown catalog fingerprint, reconstruction, or ACL selector refuses the closure', async () => {
  const changes = [
    [{ observed: evidenceDigest }, /REMINDER_CLOSURE_SCHEMA_LIVE_MISMATCH/u],
    [{ historical: evidenceDigest }, /REMINDER_CLOSURE_SCHEMA_RECONSTRUCTION_MISMATCH/u],
    [{ relation_matches: 1 }, /REMINDER_CLOSURE_STORAGE_ACL_SCOPE_MISMATCH/u],
    [{ function_count: 3 }, /REMINDER_CLOSURE_STORAGE_ACL_SCOPE_MISMATCH/u],
  ];
  for (const [change, failure] of changes) {
    const db = { query: async () => ({ rows: [{ ...storageMigrationReadback, ...change }] }) };
    await assert.rejects(readClosureSchema(db, schemaPins.approved), failure);
  }
  const unreadable = { query: async () => { throw new Error('Unexpected query'); } };
  await assert.rejects(readClosureSchema(unreadable, evidenceDigest), /REMINDER_CLOSURE_SCHEMA_BASELINE_MISMATCH/u);
});

const nativeFailure = {
  id: original.qatValidationId, status: 'Failed', done: true, checkOnly: true, numberComponentErrors: 0,
  numberTestsTotal: 101, numberTestsCompleted: 100, numberTestErrors: 1, completedDate: '2026-11-21T13:54:15.000Z',
  details: { runTestResult: { numTestsRun: 101, numFailures: 1, failures: [{ name: 'InvoiceControllerTest',
    methodName: 'restrictedSalesSupportCanReadInvoiceBlockerAndCaptureOneReminder' }] } },
};

test('only the exact native terminal check-only failure qualifies', () => {
  const timing = { submittedAt: '2026-11-21T13:52:46.250Z', completedBy: completedAt };
  const proof = assertTerminalQatReport(nativeFailure, timing);
  assert.deepEqual([proof.jobId, proof.status, proof.checkOnly], [original.qatValidationId, 'Failed', true]);
  for (const changed of [{ checkOnly: false }, { done: false }, { status: 'InProgress' }, { status: 'Succeeded' },
    { numberTestErrors: 2 }, { numberTestsTotal: 100 }, { numberTestsCompleted: 101 }, { completedDate: '2026-11-21T13:59:00Z' }]) {
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
  assert.equal(await appendReminderClosure({ read, journal, ...closureInputs }), receipt);
  assert.equal(await appendReminderClosure({ read, journal, ...closureInputs }), receipt);
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
  await assert.rejects(appendReminderClosure({ read, journal, ...closureInputs }),
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
  await assert.rejects(appendReminderClosure({ read, journal, ...closureInputs }), /JOURNAL_ADVANCED/u);
  assert.deepEqual([reads, writes], [1, 1]);
});


test('closure can overlap only the exact credential-free quality workflow created by its own merge', async () => {
  const run = { id: 50, head_sha: original.dispatcher };
  const quality = { id: 51, path: '.github/workflows/quality.yml', event: 'push',
    head_sha: run.head_sha, head_branch: 'main', repository: { id: original.repositoryId } };
  const current = { id: run.id };
  const page = (...workflow_runs) => ({ total_count: workflow_runs.length, workflow_runs });
  let reads = 0;
  const github = { read: async path => {
    reads += 1;
    assert.equal(path, '/repos/hocheunglai-oss/fcos/contents/.github/workflows/quality.yml?ref=' + run.head_sha);
    return { type: 'file', sha: '9e9f584381cb4100e5a57a4f03e2cf94de482aa6' };
  } };
  await assertNoCompetingClosureWork({ github, run, active: [page(current)] });
  assert.equal(reads, 0);
  await assertNoCompetingClosureWork({ github, run, active: [page(current), page(quality)] });
  assert.equal(reads, 1);
  for (const change of [
    { path: '.github/workflows/fcos-rapid-release.yml' }, { head_sha: original.candidate },
    { event: 'pull_request' }, { repository: { id: 99 } },
  ]) {
    await assert.rejects(assertNoCompetingClosureWork({ github, run, active: [page(current, { ...quality, ...change })] }),
      /REMINDER_CLOSURE_COMPETING_RUN/u);
  }
  await assert.rejects(assertNoCompetingClosureWork({ github, run, active: [page(current, quality, { ...quality, id: 52 })] }),
    /REMINDER_CLOSURE_COMPETING_RUN/u);
  const alteredWorkflow = { read: async () => ({ type: 'file', sha: original.candidate }) };
  await assert.rejects(assertNoCompetingClosureWork({ github: alteredWorkflow, run, active: [page(current, quality)] }),
    /REMINDER_CLOSURE_COMPETING_RUN/u);
});
