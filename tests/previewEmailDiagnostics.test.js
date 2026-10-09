import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync, chmodSync } from 'node:fs';
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

test('exact successor entrypoint reaches the genuine admission collector and rejects ambient Git substitution before provider access', async () => temporary(async directory => {
  // The actual collector rejects inherited Git selection before its first
  // GitHub read. This uses no injected collector or provider adapter.
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = join(directory, 'forged-repository');
  try {
    await assert.rejects(() => runPreviewEmailProofBuild({ mode: 'prepare',
      candidateSha: '04ee3425aac7a49089eda781eb3c976aea1f6785', trustedCwd: root, candidateCwd: root,
      env: { RUNNER_TEMP: directory, GITHUB_RUN_ID: String(runId), GH_TOKEN: privateMarker, VERCEL_TOKEN: privateMarker } }),
    /successor_admission failed/);
    const serialized = readFileSync(file(directory), 'utf8');
    assert.deepEqual(serialized.trim().split('\n').map(row => { const value = JSON.parse(row); return [value.phase, value.status]; }),
      [['runner_context', 'started'], ['runner_context', 'passed'], ['successor_admission', 'started'], ['successor_admission', 'failed']]);
    assert.ok(!serialized.includes(privateMarker));
    for (const name of ['fcos-preview-email-intent.json', `fcos-preview-email-execution-${runId}.lock`]) {
      assert.throws(() => readFileSync(join(directory, name)));
    }
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous;
  }
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

test('authority writer records only its distinct fixed schema, observed status and optional boolean binding', async () => temporary(async directory => {
  const diagnostics = fixture(directory);
  try {
    const inputs = [
      { substage: 'current_metadata', status: 'failed', failureCategory: 'http_status_rejected', httpStatus: 403 },
      { substage: 'current_metadata', status: 'failed', failureCategory: 'token_id_mismatch', httpStatus: 200, reviewedTokenIdMatches: false },
      { substage: 'configuration', status: 'passed' },
    ];
    for (const row of inputs) diagnostics.authority(row);
    const serialized = readFileSync(file(directory), 'utf8');
    assert.deepEqual(serialized.trim().split('\n').map(row => JSON.parse(row)), inputs.map(row => ({
      schemaVersion: 1, kind: 'fcos_preview_email_authority_diagnostic', mode: 'prepare', ...row,
      capturedAt: new Date(now()).toISOString(),
    })));
    assert.ok(!serialized.includes(privateMarker));
    assert.throws(() => readFileSync(join(directory, `fcos-preview-email-execution-${runId}.lock`)));
  } finally { diagnostics.close(); }
}));

test('authority writer rejects unknown fields, invalid values, symbols and getters before reading row values', async () => temporary(async directory => {
  const diagnostics = fixture(directory), valid = { substage: 'current_metadata', status: 'passed', httpStatus: 200, reviewedTokenIdMatches: true };
  let getterReads = 0;
  try {
    const hostile = key => Object.defineProperty({ ...valid }, key, { enumerable: true, get() { getterReads++; throw new Error(privateMarker); } });
    const symbolRow = { ...valid, [Symbol(privateMarker)]: privateMarker };
    const rows = [
      { ...valid, token: privateMarker }, { ...valid, url: privateMarker }, { ...valid, error: { message: privateMarker } },
      { ...valid, kind: privateMarker }, { ...valid, capturedAt: privateMarker },
      { ...valid, substage: privateMarker }, { ...valid, status: privateMarker },
      { ...valid, failureCategory: 'token_id_mismatch' },
      { substage: 'current_metadata', status: 'failed' },
      { substage: 'current_metadata', status: 'failed', failureCategory: privateMarker },
      { ...valid, httpStatus: privateMarker }, { ...valid, httpStatus: 199 }, { ...valid, httpStatus: 600 },
      { ...valid, httpStatus: NaN }, { ...valid, reviewedTokenIdMatches: privateMarker },
      { substage: 'configuration', status: 'passed', httpStatus: 200 },
      { substage: 'project_list', status: 'passed', reviewedTokenIdMatches: true },
      Object.create(valid), Object.assign(Object.create({ privateValue: privateMarker }), valid),
      symbolRow, hostile('substage'), hostile('httpStatus'), hostile('privateValue'),
      new Proxy({}, { ownKeys() { throw new Error(privateMarker); } }),
    ];
    for (const row of rows) assert.throws(() => diagnostics.authority(row), error =>
      /authority_journal/.test(error.message) && !error.message.includes(privateMarker));
    assert.equal(getterReads, 0);
    assert.equal(readFileSync(file(directory), 'utf8'), '');
  } finally { diagnostics.close(); }
}));

test('authority writes retain private file, size and hardlink checks', async () => {
  for (const change of [
    directory => chmodSync(file(directory), 0o644),
    directory => writeFileSync(file(directory), 'x'.repeat(256 * 1024 + 1), { mode: 0o600 }),
    directory => linkSync(file(directory), join(directory, 'hardlink')),
  ]) await temporary(async directory => {
    const diagnostics = fixture(directory);
    try {
      change(directory);
      const before = readFileSync(file(directory), 'utf8');
      assert.throws(() => diagnostics.authority({ substage: 'configuration', status: 'passed' }), /authority_journal/);
      assert.equal(readFileSync(file(directory), 'utf8'), before);
    } finally { diagnostics.close(); }
  });
});

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
