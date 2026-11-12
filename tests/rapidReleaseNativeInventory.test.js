import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { handoverPins, handoverDigest, validateAdministratorApplicationInventory, createHandoverPlan, applyHandover } from '../scripts/lib/rapid-release/handover.mjs';
import { collectReviewedEventSubscribers, createHandoverAdapter } from '../scripts/lib/rapid-release/handover-adapter.mjs';
const pins = handoverPins(), now = Date.parse('2026-11-06T12:00:00.000Z');
// These fixtures substitute administrator observations and protected native review;
// no fixture is actual installation/subscription evidence or authority to activate.
const report = () => ({ schemaVersion: 1, mode: 'administrator-reviewed-native', account: pins.account, repository: pins.repository,
  collectedAt: new Date(now).toISOString(), scope: 'all_repository_installations', source: 'github_repository_settings_and_configure_pages', evidenceDigest: 'a'.repeat(64),
  entries: [{ installationId: 1, appId: 2, name: 'Fixture App', events: ['deployment_status','deployment'], permissions: { metadata: 'read', deployments: 'read' },
    repositoryScope: { selection: 'selected', repository: pins.repository }, configurationState: 'current', disposition: 'read-only', evidenceDigest: 'b'.repeat(64) }] });
const clone = value => JSON.parse(JSON.stringify(value));

test('complete admin reports pin native source, identity, scope, details and bounded collection age', () => {
  const normalized = validateAdministratorApplicationInventory(report(), { now: now + 86400000 });
  assert.deepEqual(normalized.entries[0].events, ['deployment','deployment_status']);
  for (const patch of [{ account: 'other' }, { repository: 'other/repo' }, { source: 'app_visible_api_subset' }, { scope: 'visible_installations' },
    { evidenceDigest: '' }, { collectedAt: new Date(now + 1).toISOString() }, { collectedAt: new Date(now - 86400001).toISOString() }, { entries: [] }]) {
    assert.throws(() => validateAdministratorApplicationInventory({ ...report(), ...patch }, { now }));
  }
});

test('a names-and-IDs list including the three observed installations never proves their subscriptions', () => {
  const listedOnly = { ...report(), entries: [{ installationId: 122263672, name: 'Codex' }, { installationId: 176799667, name: 'Cursor' }, { installationId: 115517942, name: 'Vercel' }] };
  assert.throws(() => validateAdministratorApplicationInventory(listedOnly, { now }), { code: 'HANDOVER_ADMIN_APP_CONFIGURATION_UNVERIFIED' });
  for (const field of ['appId','events','permissions','repositoryScope','disposition','evidenceDigest']) {
    const incomplete = report(); delete incomplete.entries[0][field];
    assert.throws(() => validateAdministratorApplicationInventory(incomplete, { now }));
  }
  const pending = report(); pending.entries[0].configurationState = 'permission-update-pending';
  assert.throws(() => validateAdministratorApplicationInventory(pending, { now }));
  const contradiction = report(); contradiction.entries[0].permissions.deployments = 'write';
  assert.throws(() => validateAdministratorApplicationInventory(contradiction, { now }), { code: 'HANDOVER_ADMIN_APP_DISPOSITION_CONFLICT' });
  const duplicate = report(); duplicate.entries.push(clone(duplicate.entries[0]));
  assert.throws(() => validateAdministratorApplicationInventory(duplicate, { now }));
});

test('workflows and hooks remain automatic while app provenance is explicitly human observed', async () => {
  const paths = [];
  const result = await collectReviewedEventSubscribers({ applicationInventoryReport: report(), now, pages: async path => {
    paths.push(path);
    if (path.endsWith('/actions/workflows')) return [{ id: 3, path: '.github/workflows/fixture.yml' }];
    if (path.endsWith('/hooks')) return [{ id: 4, active: true, events: ['deployment_status'], config: { url: 'https://hooks.example.invalid/receiver' } }];
    throw Error('Unexpected provider route');
  } });
  assert.deepEqual(paths.sort(), [`/repos/${pins.repository}/actions/workflows`, `/repos/${pins.repository}/hooks`].sort());
  assert.equal(result.inventory.length, 3);
  assert.equal(result.applicationInventory.apiVerified, false);
  assert.equal(result.applicationInventory.reportDigest, handoverDigest(validateAdministratorApplicationInventory(report(), { now })));
  assert.equal(result.inventory.find(entry => entry.kind === 'hook').host, 'hooks.example.invalid');
});

test('missing or unverified reports fail before provider calls; app-visible APIs cannot establish completeness', async () => {
  let calls = 0;
  await assert.rejects(collectReviewedEventSubscribers({ applicationInventoryReport: null, now, pages: async () => { calls++; return []; } }), { code: 'HANDOVER_COMPLETE_ADMIN_APP_REPORT_REQUIRED' });
  await assert.rejects(createHandoverAdapter({ env: { FCOS_RAPID_HANDOVER_GITHUB_TOKEN: 'fixture', GITHUB_REPOSITORY: pins.repository } }), { code: 'HANDOVER_COMPLETE_ADMIN_APP_REPORT_REQUIRED' });
  assert.equal(calls, 0);
  const source = await readFile(new URL('../scripts/lib/rapid-release/handover-adapter.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/user\/installations/);
  assert.match(source, /HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED/);
});

const audit = (inventory, at = now) => ({ database: { control: { singleton: true, epoch: 1, mode: 'qualification', operation_id: null, bootstrap_id: null, recovery_id: null, plan_completion_id: null, source_upgrade_id: null }, unresolvedProduction: [], historyDigest: 'c'.repeat(64) },
  providers: { rapidJournal: { digest: 'e'.repeat(64), unresolvedProduction: 0 }, noRunning: true, productionId: 'dpl_old', subscribersDigest: 'd'.repeat(64), applicationInventoryReportDigest: handoverDigest(validateAdministratorApplicationInventory(inventory, { now: at })) } });
const planOptions = (inventory, at = now) => ({ audit: audit(inventory, at), controllerSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), buildId: 'c'.repeat(64), artifactDigest: 'd'.repeat(64), handoverId: 'native-report-fixture', applicationInventoryReport: inventory, now: at });

test('the normalized report is frozen into exact plan identity and must match the audited inventory', () => {
  const options = planOptions(report()), plan = createHandoverPlan(options);
  assert.equal(handoverDigest(plan.applicationInventoryReport), options.audit.providers.applicationInventoryReportDigest);
  assert.throws(() => createHandoverPlan({ ...options, applicationInventoryReport: undefined }), { code: 'HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED' });
  const changed = clone(report()); changed.entries[0].events = [];
  assert.throws(() => createHandoverPlan({ ...options, applicationInventoryReport: changed }), { code: 'HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED' });
  assert.notEqual(handoverDigest(plan), handoverDigest({ ...plan, applicationInventoryReport: changed }));
});

test('an admin inventory report cannot replace the existing protected native owner approval', async () => {
  const current = report(); current.collectedAt = new Date().toISOString();
  const plan = createHandoverPlan(planOptions(current, Date.now()));
  let writes = 0;
  const github = { execution: async () => ({ runId: 1, jobId: 2 }), get: async path => {
    if (path.endsWith('/approvals')) return [];
    if (path.includes('/environments/')) return { id: 3 };
    return {};
  } };
  await assert.rejects(applyHandover({ phase: 'prepare', plan, connection: { host: `db.${pins.projectRef}.supabase.co`, port: 5432, user: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: true } }, github,
    vercel: {}, db: { query: async () => { writes++; throw Error('must not write'); } } }), { code: 'HANDOVER_PROTECTED_NATIVE_REVIEW_REQUIRED' });
  assert.equal(writes, 0);
});

test('handover audits pending rapid chains, preserves staged decisions, and ignores only its exact qualification', async () => {
  const { collectRapidJournalState } = await import('../scripts/lib/rapid-release/handover-adapter.mjs');
  const { digest } = await import('../scripts/lib/rapid-release/contract.mjs');
  const manifest = { releaseId: 'setup-qualification', controllerSha: 'a'.repeat(40) };
  function chain(releaseId, manifestHash, events) {
    let previousHash = null;
    return events.map(([event,data], sequence) => {
      const content = { schemaVersion: 1, kind: 'fcos_rapid_release_event', releaseId, manifestHash, event, data, sequence, previousHash };
      const payload = { ...content, recordHash: digest(content) }; previousHash = payload.recordHash;
      return { creator: { id: 1 }, payload };
    });
  }
  const waiting = chain('older-app-waiting', 'a'.repeat(64), [['stage.intent',{operationId:'original'}], ['stage.result',{operationId:'original',deploymentId:'dpl_waiting'}]]);
  const own = chain(manifest.releaseId, digest(manifest), [['stage.intent',{operationId:'own-stage'}]]);
  let records = [...waiting,...own];
  const input = { manifest, actorIds: [1], pages: async () => records };
  const first = await collectRapidJournalState(input); assert.equal(first.unresolvedProduction, 0);
  assert.deepEqual(records.slice(0,2), waiting); // no fabricated release.complete or provider result.
  records = [...records,...chain('other-release', 'b'.repeat(64), [['promote.intent',{operationId:'uncertain'}]])];
  const pending = await collectRapidJournalState(input); assert.equal(pending.unresolvedProduction, 1); assert.notEqual(pending.digest, first.digest);
  records = chain(manifest.releaseId, 'c'.repeat(64), [['stage.intent',{operationId:'different-manifest'}]]);
  assert.equal((await collectRapidJournalState(input)).unresolvedProduction, 1);
  records[0].creator.id = 2;
  await assert.rejects(collectRapidJournalState(input), /ACTOR_OR_RECORD_INVALID/);
});

test('native active handover requires complete pinned receipt and unambiguous activation variables', async () => {
  const { readActiveHandover } = await import('../scripts/lib/rapid-release/handover-adapter.mjs');
  let enabled = 'true', pointer = '200';
  const record = { id: 200, creator: { login: pins.account }, payload: { kind:'fcos_rapid_release_handover', repository:pins.repository,
    projectId:pins.projectId,teamId:pins.teamId,handoverId:'native-fixture',planHash:'a'.repeat(64),controllerSha:'b'.repeat(40),databaseReceiptId:2,nativeCoordinatorReadbackDigest:'c'.repeat(64) } };
  const get = async path => path.includes('/deployments/') ? record : path.endsWith('_ENABLED') ? enabled === null ? null : {value:enabled} : pointer === null ? null : {value:pointer};
  assert.equal((await readActiveHandover({get})).databaseReceiptId, 2);
  record.payload.projectId = 'wrong'; await assert.rejects(readActiveHandover({get}), /ACTIVE_RECEIPT_INVALID/); record.payload.projectId = pins.projectId;
  enabled = 'false'; await assert.rejects(readActiveHandover({get}), /ACTIVE_POINTER_UNCERTAIN/);
  pointer = null; assert.equal(await readActiveHandover({get}), null);
  enabled = 'true'; await assert.rejects(readActiveHandover({get}), /ACTIVE_POINTER_UNCERTAIN/);
});
