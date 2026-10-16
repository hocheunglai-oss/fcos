import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { collectFinancialPreservation, dependencyHash, importAcceptedNomB, measureDependencyFiles } from '../scripts/lib/hosted-release/dependencies.mjs';

const H = 'a'.repeat(64), S = 'b'.repeat(40), now = Date.parse('2026-10-17T01:00:00Z');
const manifest = () => ({ candidate: { sha: '04ee3425aac7a49089eda781eb3c976aea1f6785', salesforceSourceSha256: H }, controller: { sha: S }, targets: { supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref') } });
function nomFixture() {
  const m = manifest(), artifacts = new Map(), put = value => { const bytes = Buffer.from(JSON.stringify(value)); const sha256 = dependencyHash(bytes); artifacts.set(sha256, bytes); return sha256; };
  const ref = name => ({ path: `/untrusted/path/${name}.json`, sha256: put({ proof: name }) });
  const devee = fcosSalesforceEnvironment('devee');
  const scope = { syntheticFixture: true, candidateSha: m.candidate.sha, orgId: devee.orgId, username: devee.username, stemId: 'stem', nominationId: 'nomination', fileSha256: H, fileSize: 3 };
  const live = { candidateSha: m.candidate.sha, sourceSha256: H, harnessSha256: H, target: { orgId: devee.orgId, username: devee.username, isSandbox: true }, operationId: 'original-operation',
    coreVerified: true, exactReplayVerified: true, freshListAbsent: true, postsTotal: 1, fileSha256: H, fileSize: 3, scopeFingerprint: H,
    startedAt: '2026-10-10T18:35:48.358Z', completedAt: '2026-10-10T18:40:17.837Z',
    result: { stemId: 'stem', nominationId: 'nomination', contentDocumentId: 'document', contentVersionId: 'version', receivedStatus: '🟢', verified: true } };
  const desktop = { ...live, desktopVerified: true, forbiddenRequests: [], pageErrors: [] };
  const dependencies = { kind: 'actual_devee_nom_b_schema_automation_admission', orgId: devee.orgId, username: devee.username, sourceSha256: H, fieldsAndPermissionsVerified: true, automationReviewed: true };
  const a = { scope: put(scope), dependencies: put(dependencies), liveEvidence: put(live), desktopEvidence: put(desktop) };
  a.admission = put({ kind: 'root_admitted_exact04ee_nom_b_devee_filing', candidateSha: m.candidate.sha, sourceSha256: H, harnessSha256: H, scopeSha256: H, dependenciesEvidence: { sha256: a.dependencies } });
  a.cleanup = put({ kind: 'root_actual_owned_devee_document_and_fixture_cleanup_acceptance', accepted: true, ownedDocumentAndVersionDeleted: true, allThreeOwnedFixtureRecordsDeleted: true,
    activeDocumentLinksZero: true, retainedAccountAndPortExactlyPreserved: true, singleAllOrNoneCompositeOnly: true, financialActions: false, productionChanged: false,
    actualReadbacks: Array.from({ length: 5 }, (_, i) => ref(`cleanup${i}`)) });
  a.acceptance = put({ kind: 'root_actual_exact04ee_disposable_nom_b_acceptance', accepted: true, candidateSha: m.candidate.sha, candidateSourceSha256: H, harnessSha256: H,
    operationId: live.operationId, ownedContentDocumentId: 'document', ownedContentVersionId: 'version', singleProviderPost: true, durableLedgerCompleted: true,
    exactReplayNoExtraPost: true, freshMissingListAbsent: true, buyerReceivedGreen: true, buyerSentAndPdfRemainRed: true, allOtherReadFixtureFieldsUnchanged: true,
    documentLinksOnlyOwnedBuyerAndAuthenticatedCreator: true, retainedAccountPortActive: true, localSyntheticDeveeSeamOnly: true, financialChildCategoriesVerifiedZero: 9,
    productionChanged: false, normalRoleSessionProved: false, deployedFifteenModulePreviewAttestation: false,
    scope: { sha256: a.scope }, admission: { sha256: a.admission }, actualTest: [{ sha256: a.liveEvidence }, { sha256: a.desktopEvidence }], actualReadbacks: Array.from({ length: 9 }, (_, i) => ref(`read${i}`)) });
  a.reuseDecision = put({ kind: 'root_accepted_nom_b_relevant_change_reuse_decision', accepted: true, passingProof: { sha256: a.acceptance }, cleanupClosure: { sha256: a.cleanup },
    candidateSha: m.candidate.sha, candidateSourceSha256: H, reuseForUnrelatedWorkflowOrDocumentationChanges: true,
    rerunAffectedBehaviorForRelevantSourceDependencyRuntimeConfigEnvironmentChangeOrFailure: true, freshBoundaryReadsRemainRequiredForNewWrites: true, productionAuthorizedByThisDecision: false });
  const handoff = { kind: 'fcos_reviewed_nom_b_legacy_import', manifestHash: dependencyHash(m), candidateSha: m.candidate.sha, originalCandidateSha: m.candidate.sha, artifacts: a,
    relevantInputs: { sourceSha256: H, harnessSha256: H, salesforceSourceSha256: H, fixtureSha256: H, environmentSha256: H } };
  return { manifest: m, handoff, artifacts, put, live, verifyHandoff: async ({ handoffSha256 }) => ({ verified: true, handoffSha256, manifestHash: dependencyHash(m), financialAuthority: false }),
    readArtifact: async ({ sha256 }) => artifacts.get(sha256), measureInputs: async () => ({ readOnly: true, capturedAt: new Date(now).toISOString(), inputs: handoff.relevantInputs }), now: () => now };
}

test('actual accepted NomB import retains original time and restricted synthetic coverage, with no paths or writes', async () => {
  const f = nomFixture(), result = await importAcceptedNomB(f);
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
    const f = nomFixture(); mutate(f); await assert.rejects(importAcceptedNomB(f), { code: 'NOM_B_DEPENDENCY_REVALIDATION_REQUIRED' });
  }
});

test('unchanged relevant assumptions can reuse original NomB proof for a new separately admitted candidate', async () => {
  const f = nomFixture(); f.manifest.candidate.sha = 'c'.repeat(40); f.handoff.candidateSha = f.manifest.candidate.sha; f.handoff.manifestHash = dependencyHash(f.manifest);
  const result = await importAcceptedNomB(f); assert.equal(result.candidateSha, f.manifest.candidate.sha); assert.equal(result.capturedAt, f.live.completedAt);
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
