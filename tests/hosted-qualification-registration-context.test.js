import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { sourceUpgradeFixture } from './helpers/hosted-qualification-source-upgrade.mjs';
import { nativeAvailable, contextDatabase, contextMigration, oldBody, newBody, signature } from './helpers/hosted-qualification-registration-context.mjs';

test('native registration repair preserves immutable run authority across legitimate job contexts',
  { skip: !nativeAvailable && process.env.FCOS_REQUIRE_NATIVE_COORDINATOR_DATABASE !== '1' }, async t => {
    const start = performance.now(), d = await contextDatabase(t), migration = await contextMigration();
    const initial = await d.state(), initialMetadata = await d.metadata();
    assert.equal(initialMetadata.body, oldBody);
    assert.equal(initial.control.epoch, null); assert.equal(initial.control.mode, 'frozen');

    await t.test('complete private pristine chain remains NULL/frozen with all40 tables unchanged', () => d.transaction(async () => {
      await d.db.query(migration.body);
      assert.deepEqual(await d.state(), initial);
      const { body, definition, ...identity } = await d.metadata();
      const { body: _old, definition: _definition, ...oldIdentity } = initialMetadata;
      assert.equal(body, newBody); assert.deepEqual(identity, oldIdentity);
      assert.ok(definition.includes('qualification_source_upgrade_principal(u.proof,x.actor)'));
    }));
    await t.test('pristine control cannot conceal prior authority/history', () => d.transaction(async () => {
      await d.db.query('select fcos_release_coordination.install_epoch(1,$1)', [sourceUpgradeFixture().activation]);
      await d.db.query("update fcos_release_coordination.control set epoch=null,mode='frozen'");
      await d.fails(migration.body, [], /REGISTRATION_CONTEXT_NONPRISTINE/);
    }));
    for (const [label, mutate] of [
      ['source', () => d.db.query(initialMetadata.definition.replace('AS $function$', 'AS $function$\n-- SYNTHETIC source drift'))],
      ['security definer', () => d.db.query(initialMetadata.definition.replace('LANGUAGE plpgsql', 'LANGUAGE plpgsql SECURITY DEFINER'))],
      ['ACL', () => d.db.query(`grant execute on function ${signature} to anon`)],
      ['unexpected private relation', () => d.db.query('create table fcos_release_coordination.SYNTHETIC_unreviewed(id int)')],
    ]) await t.test(label + ' drift refuses the correction transaction', () => d.transaction(async () => {
      await mutate(); await d.fails(migration.body, [], /REGISTRATION_CONTEXT_(?:SOURCE|CATALOG)_DRIFT/);
    }));
    assert.deepEqual(await d.state(), initial); assert.deepEqual(await d.metadata(), initialMetadata);

    const f = await d.fixture();
    assert.equal((await f.register()).registered, true);
    const preview = { ...f.principal, environment: 'fcos-hosted-preview', subject: `repo:${f.upgrade.policy.repository}:environment:fcos-hosted-preview` };
    const verification = { ...f.principal, environment: 'fcos-hosted-verification', subject: `repo:${f.upgrade.policy.repository}:environment:fcos-hosted-verification` };
    const before = await d.state(), oldRegistration = (await d.db.query('select to_jsonb(r) v from fcos_release_coordination.registrations r where release_id=$1', [f.newScope.releaseId])).rows[0].v;
    assert.equal(before.history.qualification_source_upgrade_intents.count, 6);
    assert.equal(before.history.qualification_source_upgrade_events.count, 6);
    assert.equal(before.history.qualification_source_upgrade_milestones.count, 2);
    assert.equal(before.history.imported_uncertainty.count, 3); assert.equal(before.history.import_resolutions.count, 0);
    await t.test('old installed hook reproduces same-run Preview refusal, before any operation', async () => {
      await assert.rejects(f.register(preview), /SOURCE_UPGRADE_REGISTRATION_INVALID/);
      assert.deepEqual(await d.state(), before);
    });
    await t.test('active source hold blocks migration without data or authority changes', () => d.transaction(async () => {
      await d.db.query('update fcos_release_coordination.control set source_upgrade_id=$1', [f.upgrade.operationId]);
      await d.fails(migration.body, [], /REGISTRATION_CONTEXT_IN_USE/);
    }));
    await t.test('uncompleted runtime operation blocks correction', () => d.transaction(async () => {
      const boundary = { validatedBy: 'trusted_coordinator', manifestHash: f.newScope.manifestHash,
        controllerSha: f.upgrade.setup.controllerSha, setupSha256: f.upgrade.setupSha256, policySha256: digest(f.upgrade.setup.legacyReleaseContainment) };
      const result = await d.store.request('begin', { ...f.newScope, phase: 'preview.create', operationId: 'SYNTHETIC-inflight-preview', requestHash: f.H }, { ...f.principal, legacyContainmentBoundary: boundary });
      assert.equal(result.disposition, 'execute'); await d.fails(migration.body, [], /REGISTRATION_CONTEXT_IN_USE/);
    }));
    await t.test('free qualification repair changes only function body; historical proof and40 tables remain valid', async () => {
      assert.equal((await d.db.query('select fcos_release_coordination.qualification_source_upgrade_proof_valid($1) v', [f.upgrade])).rows[0].v, true);
      await d.db.query(migration.sql);
      assert.deepEqual(await d.state(), before);
      const afterMetadata = await d.metadata(); assert.equal(afterMetadata.body, newBody);
      for (const key of ['oid', 'owner', 'acl', 'proconfig', 'prosecdef']) assert.deepEqual(afterMetadata[key], initialMetadata[key]);
      assert.equal((await d.db.query('select fcos_release_coordination.qualification_source_upgrade_proof_valid($1) v', [f.upgrade])).rows[0].v, true);
    });
    await t.test('Preview and admitted verification context keep the original stored run actor', async () => {
      assert.equal((await f.register(preview)).registered, true);
      assert.equal((await f.register(verification)).registered, true);
      assert.equal((await f.register()).registered, true);
      assert.deepEqual(await d.state(), before);
    });

    const authorityMutations = [
      actor => { actor.actor = 'other'; }, actor => { actor.actorId = '99'; },
      actor => { actor.repositoryId = '99'; }, actor => { actor.kind = 'financial'; },
      actor => { actor.sha = 'c'.repeat(40); }, actor => { actor.workflowSha = 'c'.repeat(40); },
      actor => { actor.workflowRef += '-wrong'; }, actor => { actor.jobWorkflowSha = 'c'.repeat(40); },
      actor => { actor.jobWorkflowRef += '-wrong'; }, actor => { actor.ref = 'refs/heads/main'; },
      actor => { actor.runAttempt = '2'; }, actor => { actor.qualificationOnly = false; },
      actor => { actor.qualificationAdmission.setupSha256 = 'c'.repeat(64); }, actor => { actor.extraAuthority = true; },
    ];
    await t.test('every immutable actor/source/run/admission field and unknown-key drift refuses atomically', async () => {
      for (const mutate of authorityMutations) {
        const actor = structuredClone(preview); mutate(actor);
        await assert.rejects(f.register(actor), /COORDINATION_/);
      }
      assert.deepEqual(await d.state(), before);
    });
    const contextMutations = [
      actor => { delete actor.environment; }, actor => { delete actor.subject; },
      actor => { actor.environment = 'null'; }, actor => { actor.environment = {}; },
      actor => { actor.environment = 1; }, actor => { actor.subject = {}; },
      actor => { actor.subject = null; }, actor => { actor.subject += ':wrong'; },
      actor => { actor.environment = 'fcos-production-release'; actor.subject = `repo:${f.upgrade.policy.repository}:environment:${actor.environment}`; },
      actor => { actor.environment = 'fcos-hosted-production-resume'; actor.subject = `repo:${f.upgrade.policy.repository}:environment:${actor.environment}`; },
      actor => { actor.environment = 'unexpected'; actor.subject = `repo:${f.upgrade.policy.repository}:environment:${actor.environment}`; },
      actor => { actor.environment = null; },
    ];
    await t.test('current context must have exact JSON type and non-Production subject form', async () => {
      for (const mutate of contextMutations) {
        const actor = structuredClone(preview); mutate(actor);
        await assert.rejects(f.register(actor), /SOURCE_UPGRADE_REGISTRATION_INVALID/);
      }
      assert.deepEqual(await d.state(), before);
    });
    await t.test('stored actor is independently validated, including malformed contexts and admission', () => d.transaction(async () => {
      let runId = 9500;
      for (const mutate of [...contextMutations, authorityMutations.at(-2), authorityMutations.at(-1)]) {
        const current = { ...preview, runId: String(++runId) }, stored = structuredClone(current); mutate(stored);
        await d.db.query('insert into fcos_release_coordination.registration_runs(release_id,run_id,run_attempt,actor) values($1,$2,$3,$4)', [f.newScope.releaseId, current.runId, '1', stored]);
        await assert.rejects(d.store.request('register', { ...f.newScope, manifest: f.upgrade.manifest }, current), /SOURCE_UPGRADE_REGISTRATION_INVALID/);
      }
    }));
    await t.test('a changed run without its own exact registration row cannot use the hook', () => d.transaction(async () => {
      await d.fails(`select ${signature.split('(')[0]}($1,$2)`, [{ ...f.newScope, manifest: f.upgrade.manifest }, { ...preview, runId: '9999' }], /SOURCE_UPGRADE_REGISTRATION_INVALID/);
    }));
    await t.test('a genuine fresh attempt1 registration is separate and preserves the original registration actor', () => d.transaction(async () => {
      const next = { ...f.principal, runId: '9002' };
      assert.equal((await d.store.request('register', { ...f.newScope, manifest: f.upgrade.manifest }, next)).registered, true);
      assert.equal((await d.store.request('register', { ...f.newScope, manifest: f.upgrade.manifest }, { ...preview, runId: '9002' })).registered, true);
      const row = (await d.db.query('select to_jsonb(r) v from fcos_release_coordination.registrations r where release_id=$1', [f.newScope.releaseId])).rows[0].v;
      assert.deepEqual(row, oldRegistration);
      assert.equal((await d.db.query('select count(*)::int n from fcos_release_coordination.registration_runs where release_id=$1', [f.newScope.releaseId])).rows[0].n, 2);
    }));
    await t.test('runtime/admin ACL and append-only original actors remain enforced', () => d.transaction(async () => {
      for (const role of ['anon', 'authenticated', 'service_role', 'fcos_coordinator_runtime']) {
        await assert.rejects(d.role(role, `select ${signature.split('(')[0]}('{}','{}')`), /permission denied/);
      }
      await d.fails('update fcos_release_coordination.registration_runs set actor=actor', [], /APPEND_ONLY/);
      await d.fails('update fcos_release_coordination.registrations set registration_actor=registration_actor', [], /APPEND_ONLY/);
    }));
    await t.test('consumed source intents remain readback-only, and migration itself cannot replay', async () => {
      for (const a of f.upgrade.actions) assert.equal((await f.q('intent', { actionId: a.id, ready: a.id === 'url_patch' ? f.ready : undefined })).disposition, 'readback');
      await d.transaction(() => d.fails(migration.body, [], /REGISTRATION_CONTEXT_SOURCE_DRIFT/));
      assert.deepEqual(await d.state(), before);
    });
    const output = new URL('../outputs/qualification-registration-context-PREPARED/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL('native-catalog.actual.json', output), JSON.stringify({ kind: 'local_native_registration_context_proof_v1',
      postgres: d.postgres, node: process.version, platform: process.platform, architecture: process.arch,
      elapsedMs: performance.now() - start, localDatabaseQueries: d.queryCount(), migration: { name: migration.name, sha256: digest(migration.sql) },
      oldMetadata: initialMetadata, newMetadata: await d.metadata(), before, after: await d.state(),
      localProofSha256: digest(f.upgrade), localProofValid: true,
      fixtureScope: 'Public historical seeds; synthetic new source/run/reviews/ACKs. Catalog observation prerequisite explicitly doubled after real-query equality check. Not live proof924 acceptance.',
      actualProof924PostInstallReadbackRequired: true, publicCatalogChanged: false, providerCalls: 0, liveSqlCalls: 0,
      financialAuthority: false, sourceUpgradeReplayAllowed: false }, null, 2) + '\n');
  });
