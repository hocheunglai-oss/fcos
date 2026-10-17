import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { nomBFixture } from './fixtures/hosted-nom-b.mjs';
import { collectFinancialPreservation, dependencyHash, importAcceptedNomB, measureDependencyFiles } from '../scripts/lib/hosted-release/dependencies.mjs';

const H = 'a'.repeat(64), S = 'b'.repeat(40), now = Date.parse('2026-10-17T01:00:00Z');
const manifest = () => ({ candidate: { sha: '04ee3425aac7a49089eda781eb3c976aea1f6785', salesforceSourceSha256: H }, controller: { sha: S }, targets: { supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref') } });
const nomFixture = () => nomBFixture({ manifest: manifest(), now });

test('actual accepted NomB import retains original time and restricted synthetic coverage, with no paths or writes', async () => {
  const f = await nomFixture(), result = await importAcceptedNomB(f);
  assert.equal(result.status, 'passed'); assert.equal(result.capturedAt, f.live.completedAt);
  assert.equal(result.result.deployedPreviewProved, false); assert.equal(result.result.financialAuthority, false);
  assert.equal(result.result.coverage, 'disposable_devee_nom_b_synthetic'); assert.ok(!JSON.stringify(result).includes('/untrusted/'));
});
test('NomB missing setup waits; tampered/unaccepted, changed or stale dependencies cannot reuse', async () => {
  assert.equal((await importAcceptedNomB({ manifest: manifest() })).status, 'waiting_dependency');
  for (const mutate of [f => { f.verifyHandoff = async () => ({ verified: false }); }, f => { f.artifacts.set(f.handoff.artifacts.liveEvidence, Buffer.from('{}')); },
    f => { f.measureInputs = async () => ({ readOnly: true, capturedAt: new Date(now).toISOString(), inputs: { ...f.handoff.relevantInputs, environmentSha256: 'c'.repeat(64) } }); },
    f => { f.measureInputs = async () => ({ readOnly: true, capturedAt: '2026-10-01T00:00:00Z', inputs: f.handoff.relevantInputs }); },
    f => { f.handoff.artifacts.liveEvidence = f.put({ ...f.live, postsTotal: 2 }); }]) {
    const f = await nomFixture(); mutate(f); await assert.rejects(importAcceptedNomB(f), { code: 'NOM_B_DEPENDENCY_REVALIDATION_REQUIRED' });
  }
});

test('unchanged relevant assumptions can reuse original NomB proof for a new separately admitted candidate', async () => {
  const f = await nomFixture(); f.manifest.candidate.sha = 'c'.repeat(40); f.handoff.candidateSha = f.manifest.candidate.sha; f.handoff.manifestHash = dependencyHash(f.manifest);
  const result = await importAcceptedNomB(f); assert.equal(result.candidateSha, f.manifest.candidate.sha); assert.equal(result.capturedAt, f.live.completedAt);
});

test('candidate repository binding remains separate from original live Salesforce assumptions', async () => {
  const f = await nomFixture(); assert.notEqual(f.manifest.candidate.salesforceSourceSha256, f.handoff.relevantInputs.salesforceSourceSha256);
  const proof = await importAcceptedNomB(f); assert.equal(proof.result.candidateSalesforceSourceSha256, f.manifest.candidate.salesforceSourceSha256);
  assert.equal(proof.result.originalRelevantSalesforceSha256, f.handoff.relevantInputs.salesforceSourceSha256); assert.equal(proof.capturedAt, f.live.completedAt);
  f.manifest.candidate.salesforceSourceSha256 = 'c'.repeat(64); f.handoff.manifestHash = dependencyHash(f.manifest);
  await assert.rejects(importAcceptedNomB(f), { code: 'NOM_B_DEPENDENCY_REVALIDATION_REQUIRED' });
  f.handoff.candidateSalesforceSourceSha256 = f.manifest.candidate.salesforceSourceSha256;
  assert.equal((await importAcceptedNomB(f)).status, 'passed');
  f.handoff.sourceMapping = { candidateSalesforceSourceSha256: f.manifest.candidate.salesforceSourceSha256 };
  await assert.rejects(importAcceptedNomB(f), { code: 'NOM_B_DEPENDENCY_REVALIDATION_REQUIRED' });
});
test('original live inputs are derived from loaded original bytes, not self-asserted hashes', async () => {
  for (const key of ['salesforceSourceSha256','fixtureSha256','environmentSha256']) {
    const f = await nomFixture(); f.handoff.relevantInputs[key] = 'c'.repeat(64);
    await assert.rejects(importAcceptedNomB(f), { code: 'NOM_B_DEPENDENCY_REVALIDATION_REQUIRED' });
  }
  const f = await nomFixture(); const original = f.artifacts.get(f.handoff.artifacts.dependencies);
  f.artifacts.set(f.handoff.artifacts.dependencies, Buffer.from(original.toString().replace('v67.0', 'v68.0')));
  await assert.rejects(importAcceptedNomB(f), { code: 'NOM_B_DEPENDENCY_REVALIDATION_REQUIRED' });
});

test('relevant file measurement rejects traversal and symlinks and changes only with measured bytes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-dependency-files-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src')); writeFileSync(join(directory, 'src/file.js'), 'a'); writeFileSync(join(directory, 'unrelated.md'), 'x');
  const first = measureDependencyFiles({ directory, paths: ['src/file.js'] }); writeFileSync(join(directory, 'unrelated.md'), 'y');
  assert.equal(measureDependencyFiles({ directory, paths: ['src/file.js'] }).sha256, first.sha256);
  writeFileSync(join(directory, 'src/file.js'), 'b'); assert.notEqual(measureDependencyFiles({ directory, paths: ['src/file.js'] }).sha256, first.sha256);
  symlinkSync(join(directory, 'src'), join(directory, 'link')); assert.throws(() => measureDependencyFiles({ directory, paths: ['link/file.js'] }));
  assert.throws(() => measureDependencyFiles({ directory, paths: ['../outside'] }));
});

function preservationFixture() {
  const m = manifest(), rows = [{ id: '1', amount: '123.45', lines: [{ quantity: 1, account: '41100' }], payments: [] }], calls = [];
  const membership = { schemaVersion: 1, kind: 'fcos_release_preservation_membership', project: m.targets.supabaseProject, manifestHash: dependencyHash(m),
    tables: [{ table: 'invoices', keyColumn: 'id', keys: ['1'], expectedRowsSha256: dependencyHash(rows) }] };
  const identity = { role: 'fcos_release_observer', database: 'postgres', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, memberships: false, table_writes: false, definer_access: false };
  class Client {
    async connect() { calls.push('connect'); }
    async query(sql, parameters) { calls.push({ sql, parameters }); if (sql.startsWith('select current_user')) return { rows: [identity] };
      if (sql.startsWith('select to_jsonb')) return { rows: rows.map(row => ({ row })) }; return { rows: [] }; }
    async end() { calls.push('end'); }
  }
  return { manifest: m, membership, Client, rows, identity, calls, now: () => now,
    env: { FCOS_HOSTED_PRESERVATION_DATABASE_URL: `postgresql://fcos_release_observer:private@db.${m.targets.supabaseProject}.supabase.co/postgres?sslmode=verify-full` },
    verifyMembership: async ({ membershipSha256 }) => ({ verified: true, membershipSha256, manifestHash: dependencyHash(m), financialAuthority: false }) };
}
test('preservation collector verifies readonly role, full keyed rows and baseline with no exported financial values', async () => {
  const f = preservationFixture(), report = await collectFinancialPreservation(f);
  assert.equal(report.status, 'passed'); assert.equal(report.evidenceKind, 'volatile'); assert.equal(report.capturedAt, new Date(now).toISOString());
  assert.equal(report.result.rowCount, 1); assert.equal(report.result.financialAuthority, false);
  assert.ok(f.calls.some(c => c.sql === 'begin isolation level repeatable read read only'));
  assert.deepEqual(f.calls.find(c => c.sql?.startsWith('select to_jsonb')).parameters, [['1']]);
  assert.equal(f.calls.at(-1), 'end'); assert.ok(!JSON.stringify(report).includes('123.45')); assert.ok(!JSON.stringify(report).includes('private'));
});
test('preservation setup waits and authority/target/SQL/baseline/key drift fails closed with cleanup', async () => {
  assert.equal((await collectFinancialPreservation({ manifest: manifest(), env: {} })).status, 'waiting_dependency');
  for (const mutate of [f => { f.identity.table_writes = true; }, f => { f.identity.definer_access = true; }, f => { f.rows[0].amount = '123.46'; },
    f => { f.rows.length = 0; }, f => { f.membership.tables[0].table = 'invoices; delete from invoices'; }, f => { f.env.FCOS_HOSTED_PRESERVATION_DATABASE_URL = 'postgresql://postgres:private@wrong/postgres'; },
    f => { f.verifyMembership = async () => ({ verified: false }); }]) {
    const f = preservationFixture(); mutate(f); await assert.rejects(collectFinancialPreservation(f), { code: 'PRESERVATION_REVALIDATION_REQUIRED' });
    if (f.calls.includes('connect')) assert.equal(f.calls.at(-1), 'end');
  }
});
