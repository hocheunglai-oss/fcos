import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createPreviewEmailBuildDiagnostics, runPreviewEmailProofBuild } from '../scripts/preview-email-proof-build.mjs';

const root = process.cwd(), runId = 99, now = () => Date.parse('2026-10-02T08:00:00.000Z');
const privateMarker = 'private-token-url-header-stdout-stderr-marker';
const file = directory => join(directory, `fcos-preview-email-journal-${runId}.jsonl`);
const fixture = (directory, mode = 'prepare') => createPreviewEmailBuildDiagnostics({ mode, runId, directory,
  trustedCwd: root, candidateCwd: root, now });
const temporary = async operation => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-preview-diagnostics-'));
  try { await operation(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};

test('early prepare failure preserves only allowlisted stage diagnostics before any intent or provider request', async () => temporary(async directory => {
  const env = { RUNNER_TEMP: directory, GITHUB_RUN_ID: String(runId), GH_TOKEN: privateMarker, VERCEL_TOKEN: privateMarker };
  await assert.rejects(() => runPreviewEmailProofBuild({ mode: 'prepare', candidateSha: privateMarker,
    trustedCwd: root, candidateCwd: root, env }), error => /candidate_contract/.test(error.message) && !error.message.includes(privateMarker));
  const serialized = readFileSync(file(directory), 'utf8'), rows = serialized.trim().split('\n').map(row => JSON.parse(row));
  assert.ok(!serialized.includes(privateMarker));
  assert.deepEqual(rows.map(row => [row.phase, row.status]), [['runner_context', 'started'], ['runner_context', 'passed'],
    ['candidate_contract', 'started'], ['candidate_contract', 'failed']]);
  assert.equal(rows.at(-1).code, 'FCOS_PREVIEW_CANDIDATE_CONTRACT_FAILED');
  assert.throws(() => readFileSync(join(directory, 'fcos-preview-email-intent.json')));
  assert.throws(() => readFileSync(join(directory, `fcos-preview-email-execution-${runId}.lock`)));
}));

test('arbitrary secret-bearing exceptions, invalid phases and operation rows are never inspected or serialized', async () => temporary(async directory => {
  const diagnostics = fixture(directory);
  try {
    const exception = { stdout: privateMarker, stderr: privateMarker, url: privateMarker, headers: { authorization: privateMarker } };
    for (const field of ['message', 'stack', 'code', 'cause']) Object.defineProperty(exception, field, { get() { assert.fail('Exception properties must never be read.'); } });
    await assert.rejects(() => diagnostics.stage('provider_cli_version', () => { throw exception; }), /provider_cli_version/);
    await assert.rejects(() => diagnostics.stage(privateMarker, () => {}), error => !error.message.includes(privateMarker));
    assert.throws(() => diagnostics.journal({ phase: 'create_requested', operationId: privateMarker, capturedAt: new Date(now()).toISOString() }));
    const serialized = readFileSync(file(directory), 'utf8');
    assert.ok(!serialized.includes(privateMarker));
    assert.deepEqual(serialized.trim().split('\n').map(row => JSON.parse(row)), ['started', 'failed'].map(status => ({
      schemaVersion: 1, kind: 'fcos_preview_email_diagnostic', mode: 'prepare', phase: 'provider_cli_version', status,
      code: `FCOS_PREVIEW_PROVIDER_CLI_VERSION_${status.toUpperCase()}`, capturedAt: new Date(now()).toISOString(),
    })));
  } finally { diagnostics.close(); }
}));

test('CLI output remains redacted when pre-intent source input contains secrets', async () => temporary(async directory => {
  const result = spawnSync(process.execPath, ['scripts/preview-email-proof-build.mjs', '--prepare'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: directory, GITHUB_RUN_ID: String(runId), FCOS_E2E_EXPECTED_COMMIT: privateMarker,
      GH_TOKEN: privateMarker, VERCEL_TOKEN: privateMarker } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes(privateMarker));
  assert.ok(!readFileSync(file(directory), 'utf8').includes(privateMarker));
}));

test('journal directory, file and execution claims fail closed on symlinks, hardlinks or non-private journal files', async () => temporary(async directory => {
  const target = join(directory, 'outside.txt'); writeFileSync(target, privateMarker, { mode: 0o600 });
  const linkedDirectory = join(directory, 'linked'); symlinkSync(directory, linkedDirectory);
  assert.throws(() => fixture(linkedDirectory), /journal_initialization/);
  symlinkSync(target, file(directory));
  assert.throws(() => fixture(directory), /journal_initialization/);
  assert.equal(readFileSync(target, 'utf8'), privateMarker);
  rmSync(file(directory)); linkSync(target, file(directory));
  assert.throws(() => fixture(directory), /journal_initialization/);
  assert.equal(readFileSync(target, 'utf8'), privateMarker);
  rmSync(file(directory)); writeFileSync(file(directory), '', { mode: 0o644 });
  assert.throws(() => fixture(directory), /journal_initialization/);
  rmSync(file(directory));
  const diagnostics = fixture(directory, 'create');
  try {
    symlinkSync(target, join(directory, `fcos-preview-email-execution-${runId}.lock`));
    assert.throws(() => diagnostics.claimExecution(), /execution_claim/);
    assert.equal(readFileSync(target, 'utf8'), privateMarker);
  } finally { diagnostics.close(); }
  for (const invalidRunId of ['../outside', privateMarker, 0, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createPreviewEmailBuildDiagnostics({ mode: 'prepare', runId: invalidRunId, directory,
      trustedCwd: root, candidateCwd: root }), error => !error.message.includes(privateMarker));
  }
}));
