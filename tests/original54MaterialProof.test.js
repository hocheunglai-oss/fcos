import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOriginal54MaterialProof } from '../scripts/lib/original54-material-proof.mjs';
const digest = x => createHash('sha256').update(x).digest('hex');
test('private54 material requires exact candidate/source/proof and complete local success', t => {
  const dir = mkdtempSync(join(tmpdir(), 'fcos-private54-proof-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourceFiles = [{ path: 'test-source', mode: '100644', blob: 'c'.repeat(40), sha256: 'd'.repeat(64) }];
  const proof = { kind: 'actual_private_original54_source_material_test_proof_v1', accepted: true,
    sourceUnchanged: true, sourceCommit: 'a'.repeat(40), tree: 'b'.repeat(40), sourceFiles,
    seedSha256: 'bb1347c0917102e5ea1917446d6b5970865403c6f2d63931d7451246e90dfb82', originalRecords: 54,
    command: ['node', '--test', '--test-reporter=tap', 'tests/xeroExistingDraftAuthorisationDatabase.private54.test.mjs', 'tests/xeroExistingDraftQuotaDatabase.private54.test.mjs'],
    exitCode: 0, counts: { tests: 80, pass: 80, fail: 0, skipped: 0, cancelled: 0 },
    hostedCheck: false, providerCalls: 0, financialActions: 0, privateSeedExported: false,
    postgresVersion: 'postgres (PostgreSQL) 17.11 (Homebrew)', startedAt: '2026-10-21T12:00:00Z', completedAt: '2026-10-21T12:01:00Z' };
  const verify = p => {
    const bytes = JSON.stringify(p), proofPath = join(dir, 'proof.json'); writeFileSync(proofPath, bytes);
    return assertOriginal54MaterialProof({ proofPath, proofSha256: digest(bytes), candidateCommit: proof.sourceCommit, candidateTree: proof.tree, sourceFiles });
  };
  assert.equal(verify(proof).hostedCheck, false);
  for (const change of [p => p.accepted = false, p => p.sourceUnchanged = false, p => p.sourceCommit = 'e'.repeat(40),
    p => p.tree = 'e'.repeat(40), p => p.sourceFiles = [], p => p.seedSha256 = 'e'.repeat(64),
    p => p.counts.skipped = 1, p => p.counts.fail = 1, p => p.counts.pass--, p => p.exitCode = 1,
    p => p.command.pop(), p => p.hostedCheck = true, p => p.providerCalls++, p => p.financialActions++, p => p.privateSeedExported = true]) {
    const changed = structuredClone(proof); change(changed); assert.throws(() => verify(changed));
  }
  assert.throws(() => assertOriginal54MaterialProof({}));
});
test('release verification checks private material before running tests/build/browser actions', () => {
  const source = readFileSync(new URL('../scripts/verify-release.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('verifyPrivateMaterial({') < source.indexOf('for (const [label, args] of checks)'));
  assert.match(source, /FCOS_ORIGINAL54_PROOF_SHA256/);
});
