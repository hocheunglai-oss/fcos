import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { diagnosticSourceUpgradeTransition, SOURCE_UPGRADE, SOURCE_UPGRADE_DIAGNOSTIC as S, sourceUpgradeActions } from '../scripts/lib/hosted-release/qualification-source-upgrade.mjs';
import { diagnosticFixture, projection, migration, repinBaseline } from './helpers/qualification-source-upgrade-diagnostics.mjs';
import { guardDatabase, guardMigration } from './helpers/qualification-source-upgrade-guard.mjs';
import { sourceUpgradeFixture } from './helpers/hosted-qualification-source-upgrade.mjs';

const mutations = [
  ['candidate', p => { p.setup.qualificationSource.candidateSha = 'c'.repeat(40); }],
  ['parent proof', p => { p.parent.proofSha256 = 'e'.repeat(64); }],
  ['parent controller', p => { p.previous.setup.controllerSha = 'c'.repeat(40); }],
  ['parent source', p => { p.previous.manifest.candidate.sha = S.candidateSha; }],
  ['parent policy', p => { p.previousPolicy.qualificationAdmission.candidateSha = S.candidateSha; }],
  ['candidate source', p => { p.manifest.candidate.sourceSha256 = 'e'.repeat(64); }],
  ['candidate inputs', p => { p.manifest.candidate.sourceInputsSha256 = 'e'.repeat(64); }],
  ['candidate lock', p => { p.manifest.candidate.lockSha256 = 'e'.repeat(64); }],
  ['candidate config', p => { p.manifest.candidate.configurationSha256 = 'e'.repeat(64); }],
  ['candidate Salesforce', p => { p.manifest.candidate.salesforceSourceSha256 = 'e'.repeat(64); }],
  ['branch', p => { p.plan.branch = 'codex/unreviewed'; }],
  ['profile', p => { p.plan.sourceProfile = 'arbitrary'; }],
  ['check manifest', p => { p.manifest.controller.checkManifestSha256 = 'e'.repeat(64); }],
  ['checker', p => { p.checkerManifest[0].sha256 = 'e'.repeat(64); }],
  ['baseline evidence', p => repinBaseline(p, b => { b.observedAt = '2026-10-23T00:00:00Z'; })],
  ['baseline accepted evidence', p => repinBaseline(p, () => {}, r => { r.evidenceSha256 = 'e'.repeat(64); })],
  ['baseline original clocks', p => repinBaseline(p, () => {}, r => { r.originalObservationTimesSha256 = 'e'.repeat(64); })],
  ['baseline rejected', p => repinBaseline(p, () => {}, r => { r.accepted = false; })],
  ['baseline future review', p => repinBaseline(p, () => {}, r => { r.reviewedAt = '2999-01-01T00:00:00Z'; })],
  ['baseline extra privilege', p => repinBaseline(p, b => { b.firstCutoverException = true; })],
  ['baseline null reference', p => { p.setup.firstRuntimeBaseline = null; }],
  ['baseline malformed JSON', p => { p.setup.firstRuntimeBaseline.json = '{'; p.setup.firstRuntimeBaseline.sha256 = digest('{'); }],
  ['baseline null review', p => { p.setup.firstRuntimeBaseline.acceptance = null; }],
];
test('diagnostic projection is exact and old candidate/action requests remain historical', () => {
  assert.equal(digest(projection.setup), S.parentSetupSha256); assert.equal(digest(projection.manifest), S.parentManifestSha256);
  assert.equal(SOURCE_UPGRADE.candidateSha, '2ef733d17dd12314c72971c2220b2b09903a6bf0');
  const old = sourceUpgradeFixture().upgrade, p = diagnosticFixture();
  assert.equal(diagnosticSourceUpgradeTransition(p), true);
  assert.equal(sourceUpgradeActions(old)[5].request.body.inputs.candidate_sha, SOURCE_UPGRADE.candidateSha);
  assert.equal(sourceUpgradeActions(p)[5].request.body.inputs.candidate_sha, S.candidateSha);
  assert.deepEqual(p.setup.previousProduction, projection.setup.previousProduction);
  assert.deepEqual(p.plan.scope, projection.plan.scope); assert.deepEqual(p.plan.runtime, projection.plan.runtime);
});
for (const [name, mutate] of mutations) test(`diagnostic projection refuses ${name}`, () => {
  const p = diagnosticFixture(); mutate(p); assert.equal(diagnosticSourceUpgradeTransition(p), false);
});
for (const native of [false, true]) test(`${native ? 'native PG17' : 'PGlite'} exact diagnostic SQL transition and guarded installation`,
  { skip: native && process.env.FCOS_DIAGNOSTIC_SOURCE_NATIVE !== 'docker' }, async t => {
    const d = await guardDatabase(t, native), original = await guardMigration(), sql = await migration();
    await d.exec(original.sql);
    const before = await d.state(), history = await d.history(), metadata = await d.metadata();
    await t.test('source/ACL drift and nonpristine frozen histories refuse atomically', async () => {
      for (const mode of ['body', 'acl', 'history', 'mode']) await d.transaction(async () => {
        if (mode === 'body') {
          const def = (await d.query("select pg_get_functiondef('fcos_release_coordination.qualification_source_upgrade_actions(jsonb)'::regprocedure) v")).rows[0].v;
          await d.exec(def.replace('AS $function$', 'AS $function$\n-- SYNTHETIC drift'));
        } else if (mode === 'acl') await d.exec('grant execute on function fcos_release_coordination.qualification_source_upgrade_actions(jsonb) to anon');
        else if (mode === 'history') await d.query("insert into fcos_release_coordination.epochs(epoch,activation_evidence) values(1,'{}')");
        else await d.query("update fcos_release_coordination.control set mode='active'");
        await d.fails(sql, [], /COORDINATION_DIAGNOSTIC_(SOURCE_DRIFT|IN_USE)/);
        assert.equal((await d.query("select to_regprocedure('fcos_release_coordination.qualification_source_upgrade_diagnostic_transition(jsonb)') v")).rows[0].v, null);
      });
    });
    await d.exec(sql);
    assert.deepEqual(await d.state(), before); assert.deepEqual(await d.history(), history);
    const after = await d.metadata();
    for (const old of metadata) {
      const current = after.find(x => x.oid === old.oid);
      if (['qualification_source_upgrade_proof_valid', 'qualification_source_upgrade_actions'].includes(old.proname))
        assert.deepEqual({ ...current, prosrc: old.prosrc }, old);
      else assert.deepEqual(current, old);
    }
    await t.test('byte-pinned child projection agrees with JS and rejects every forged projection', async () => {
      const p = diagnosticFixture(); assert.equal(await d.call('qualification_source_upgrade_diagnostic_transition', [p]), true);
      for (const [name, mutate] of mutations) {
        const bad = structuredClone(p); mutate(bad);
        assert.equal(await d.call('qualification_source_upgrade_diagnostic_transition', [bad]), false, name);
      }
      assert.deepEqual(await d.call('qualification_source_upgrade_actions', [p]), sourceUpgradeActions(p));
      const old = sourceUpgradeFixture().upgrade;
      assert.deepEqual(await d.call('qualification_source_upgrade_actions', [old]), old.actions);
    });
    await t.test('runtime roles have no new integrity-helper or source authority', () => d.transaction(async () => {
      for (const role of ['anon', 'authenticated', 'service_role', 'fcos_coordinator_runtime']) await d.role(role, () =>
        d.fails('select fcos_release_coordination.qualification_source_upgrade_diagnostic_transition($1)', [diagnosticFixture()], /permission denied/));
    }));
    await d.transaction(() => d.fails(sql, [], /already exists|SOURCE_DRIFT/));
  });
