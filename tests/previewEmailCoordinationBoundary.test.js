import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodePreviewCoordinationArchive } from '../scripts/lib/preview-email-coordination-archive.mjs';
import { PREVIEW_COORDINATION_FILENAME } from '../scripts/lib/preview-email-coordination.mjs';
import { collectHostedPreviewCoordinationStatus, collectHostedPreviewCoordinationClaim,
  consumeHostedPreviewCoordinationClaim } from '../scripts/lib/preview-email-coordination-collector.mjs';
import { previewCoordinationMain, assertPreviewCoordinationApproval } from '../scripts/preview-email-coordinator-local.mjs';
import { runPreviewEmailProofBuild } from '../scripts/preview-email-proof-build.mjs';
import { createZipUploadStream } from '../node_modules/@actions/artifact/lib/internal/upload/zip.js';

test('fixed decoder accepts the locked official SDK actual archive stream without contacting its service', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-coordination-sdk-zip-'));
  try {
    const sourcePath = join(directory, PREVIEW_COORDINATION_FILENAME), expected = { kind: 'OFFLINE SDK ARCHIVE', possibleSubmission: true };
    writeFileSync(sourcePath, JSON.stringify(expected), { mode: 0o600 });
    for (const compression of [0, 6]) {
      const stream = await createZipUploadStream([{ sourcePath, destinationPath: PREVIEW_COORDINATION_FILENAME, stats: lstatSync(sourcePath) }], compression);
      const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      const archive = Buffer.concat(chunks);
      assert.deepEqual(decodePreviewCoordinationArchive(archive), expected);
      const changed = Buffer.from(archive); changed.writeUInt16LE(2, changed.length - 12);
      assert.throws(() => decodePreviewCoordinationArchive(changed));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('fixed archive decoder accepts an actual one-file ZIP and rejects links, duplicate/extra files, corruption and foreign names', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-coordination-zip-'));
  try {
    const expected = { kind: 'OFFLINE CLAIM DATA', providerAuthorityGranted: false };
    writeFileSync(join(directory, PREVIEW_COORDINATION_FILENAME), JSON.stringify(expected));
    execFileSync('/usr/bin/zip', ['-q', 'valid.zip', PREVIEW_COORDINATION_FILENAME], { cwd: directory });
    const valid = readFileSync(join(directory, 'valid.zip'));
    assert.deepEqual(decodePreviewCoordinationArchive(valid), expected);
    const corrupt = Buffer.from(valid); corrupt[45] ^= 1;
    assert.throws(() => decodePreviewCoordinationArchive(corrupt));
    const link = Buffer.from(valid), end = link.length - 22, central = link.readUInt32LE(end + 16);
    link.writeUInt32LE(0xa1ff0000, central + 38);
    assert.throws(() => decodePreviewCoordinationArchive(link));
    for (const field of [central + 8, central + 34, central + 42]) {
      const changed = Buffer.from(valid); changed[field] ^= 1; assert.throws(() => decodePreviewCoordinationArchive(changed));
    }
    writeFileSync(join(directory, 'foreign.json'), '{}');
    execFileSync('/usr/bin/zip', ['-q', 'extra.zip', PREVIEW_COORDINATION_FILENAME, 'foreign.json'], { cwd: directory });
    execFileSync('/usr/bin/zip', ['-q', 'foreign.zip', 'foreign.json'], { cwd: directory });
    for (const name of ['extra.zip', 'foreign.zip']) assert.throws(() => decodePreviewCoordinationArchive(readFileSync(join(directory, name))));
    assert.throws(() => decodePreviewCoordinationArchive(Buffer.concat([valid, Buffer.from('trailing bytes')])));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('fixture callbacks, clocks, SDK IDs and signed data cannot mint production claims', async () => {
  let accesses = 0;
  const forbidden = new Proxy({}, { get() { accesses++; assert.fail('Caller supplied production capability'); } });
  for (const supplied of [true, {}, forbidden, { reads: forbidden, unpack: forbidden, now: () => 1, publicKeySpkiBase64: 'fixture', artifactId: 1 }]) {
    await assert.rejects(() => collectHostedPreviewCoordinationStatus(supplied));
    await assert.rejects(() => collectHostedPreviewCoordinationClaim(supplied));
    assert.throws(() => consumeHostedPreviewCoordinationClaim(supplied));
  }
  await assert.rejects(() => collectHostedPreviewCoordinationClaim(), error => error.code === 'PREVIEW_COORDINATION_PROTECTED_ACTIONS_NOT_INSTALLED');
  assert.equal(accesses, 0);
});
test('new local coordinator remains a zero-call plan and rejects nonfixed approval surfaces', async () => {
  const plan = await previewCoordinationMain(['--plan']);
  assert.equal(plan.protectedActionsInstalled, false); assert.equal(plan.privateReads, 0); assert.equal(plan.leaseClaims, 0);
  for (const args of [['--enroll'], ['--issue-approved', 'bad'], ['--enable'], ['--issue-approved', 'x', '--force']]) {
    await assert.rejects(() => previewCoordinationMain(args));
  }
  assert.throws(() => assertPreviewCoordinationApproval({ approval: { authorized: true, purpose: plan.purpose } }));
});
test('source-wired exact04ee coordination fails at its disabled gate before credentials/collectors and preserves a safe journal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-coordination-entry-'));
  try {
    await assert.rejects(() => runPreviewEmailProofBuild({ mode: 'coordinate', candidateSha: '04ee3425aac7a49089eda781eb3c976aea1f6785',
      trustedCwd: process.cwd(), candidateCwd: process.cwd(), env: { GITHUB_RUN_ID: '99', RUNNER_TEMP: directory } }), /coordination_claim/);
    const rows = readFileSync(join(directory, 'fcos-preview-email-journal-99.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => [row.phase, row.status]), [['coordination_claim', 'started'], ['coordination_claim', 'failed']]);
    assert.ok(rows.every(row => !JSON.stringify(row).includes('token')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
