import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertRuntimeMaterialProducer, collectRuntimeSuccessorMaterials, parseRuntimeMaterialPack, runtimeMaterialPayload,
  runtimeMaterialHash, decodeRuntimeMaterialArchive, assertRuntimeMaterialPublicationFresh, reconcileRuntimeMaterialPublication, RUNTIME_MATERIAL_INPUT,
  RUNTIME_MATERIAL_FILENAME } from '../scripts/lib/runtime-compatibility-material-transport.mjs';
import { materialTransportFixture, materialZip } from './helpers/runtimeMaterialTransport.mjs';
import { createZipUploadStream } from '../node_modules/@actions/artifact/lib/internal/upload/zip.js';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES } from '../scripts/lib/preview-email-build-controls.mjs';
import { SUCCESSOR_LIVE_HARNESS_FILES } from '../scripts/lib/runtime-compatibility-successor-live.mjs';

const now = Date.parse('2026-10-11T09:00:00.000Z'), expected = { harnessSha: 'a'.repeat(40), sha: 'b'.repeat(40), sourceDigest: 'c'.repeat(64),
  lockHash: 'd'.repeat(64), candidateTreeHash: 'e'.repeat(64), previewControlRevision: 'f'.repeat(64), configurationRevision: '1'.repeat(64), runId: 99 };
const workflows = ['preview-email-proof-build.yml', 'runtime-compatibility-normal-role.yml', 'runtime-compatibility-release.yml'].map(name => `.github/workflows/${name}`);
const fixture = workflow => materialTransportFixture({ expected, workflow, now });
const collect = value => collectRuntimeSuccessorMaterials({ reads: value.reads, expected: value.expected, run: value.run, now });
const producer = value => assertRuntimeMaterialProducer({ ...value, now });
const repack = value => { value.payload.materialPackText = value.variables.find(row => row.name === RUNTIME_MATERIAL_INPUT).value;
  value.payload.materialPackSha256 = runtimeMaterialHash(value.payload.materialPackText); value.archive = materialZip(value.payload);
  value.artifacts[0].digest = `sha256:${runtimeMaterialHash(value.archive)}`; value.artifacts[0].size_in_bytes = value.archive.length; };

test('all three exact protected producer routes admit data only, preserve original bytes, and require current first-run bindings', async () => {
  for (const workflow of workflows) {
    const value = fixture(workflow), before = value.pack.materials.context;
    const admitted = await collect(value);
    assert.equal(admitted.rows.context.body.toString(), before);
    assert.equal(admitted.transport.binding.workflow, workflow); assert.equal(admitted.transport.binding.runAttempt, 1);
    assert.equal(value.payload.grantsAuthority, false); assert.equal(value.archiveCalls, 1);
    assert.equal(JSON.stringify(admitted).includes('credentialAuthority'), false);
  }
});

test('producer publication requires verified OIDC and the actual protected job, actor, approval, current source and terminal step', () => {
  const mutations = [v => { v.run.actor.id++; }, v => { v.run.triggering_actor.login = 'other'; }, v => { v.run.run_attempt = 2; },
    v => { v.expected.runId++; }, v => { v.expected.harnessSha = 'f'.repeat(40); }, v => { v.branch.commit.sha = '0'.repeat(40); },
    v => { v.run.head_repository = { full_name: 'fork/repo' }; }, v => { v.run.repository = { ...v.run.repository, id: 123 }; },
    v => { v.run.event = 'push'; }, v => { v.run.path = '.github/workflows/other.yml'; }, v => { v.run.workflow_id++; },
    v => { v.workflowDefinition.state = 'disabled_manually'; }, v => { v.workflowDefinition.path = '.github/workflows/other.yml'; },
    v => { v.run.run_started_at = new Date(now - 1800001).toISOString(); }, v => { v.jobs[0].started_at = new Date(now - 1800001).toISOString(); },
    v => { v.environment.can_admins_bypass = true; }, v => { v.environment.deployment_branch_policy.protected_branches = false; },
    v => { v.environment.protection_rules[0].reviewers[0].reviewer.id++; }, v => { v.approvals[0].state = 'rejected'; },
    v => { v.approvals.push(structuredClone(v.approvals[0])); }, v => { v.jobs.push(structuredClone(v.jobs[0])); },
    v => { v.jobs[0].name = 'other'; }, v => { v.jobs[0].run_id++; }, v => { v.jobs[0].run_attempt = 2; },
    v => { v.jobs[0].steps[0].status = 'in_progress'; }, v => { v.jobs[0].steps[0].conclusion = 'failure'; },
    v => { v.jobs[0].steps.push(structuredClone(v.jobs[0].steps[0])); }, v => { v.jobs[0].steps[0].completed_at = new Date(now + 1).toISOString(); }];
  for (const workflow of workflows) for (const mutate of mutations) { const value = fixture(workflow); value.expected = { ...expected }; mutate(value); assert.throws(() => producer(value)); }
  for (const field of ['iss', 'aud', 'repository', 'repository_id', 'run_id', 'run_attempt', 'workflow_sha', 'sha', 'ref', 'event_name', 'sub', 'workflow_ref', 'actor', 'actor_id']) {
    const value = fixture(); value.oidcClaims[field] = 'WRONG'; assert.throws(() => producer(value));
  }
  const value = fixture(); value.jobs[0].steps[0] = { ...value.jobs[0].steps[0], status: 'in_progress', conclusion: null, completed_at: null };
  assert.equal(assertRuntimeMaterialProducer({ ...value, now, requireCompletedStep: false }).binding.runId, 99);
  assert.throws(() => assertRuntimeMaterialProducer({ ...value, oidcClaims: undefined, now, requireCompletedStep: false }));
});

test('runtime present never falls back: missing, malformed, duplicate, wrong scope and unproved material fail closed', async () => {
  for (const workflow of workflows) for (const mutate of [v => { v.artifacts = []; }, v => { v.artifacts.push({ ...v.artifacts[0], id: 102 }); },
    v => { v.variables = [v.variables[0]]; }, v => { v.variables = [v.variables[1]]; }, v => { v.variables[0].value = ''; },
    v => { v.variables[1].value = '{'; }, v => { v.repositoryVariables = [v.variables[0]]; }, v => { v.repositoryVariables = [v.variables[1]]; },
    v => { v.variables.push({ ...v.variables[1] }); }, v => { v.jobs[0].steps = []; }, v => { v.jobs[0].steps[0].conclusion = 'failure'; },
    v => { v.variables = []; }]) {
    const value = fixture(workflow); mutate(value); await assert.rejects(() => collect(value));
    assert.equal(value.calls.some(path => path.includes('/contents/')), false);
  }
  const absent = fixture(); absent.variables = []; absent.artifacts = []; assert.equal(await collect(absent), null); assert.equal(absent.archiveCalls, 0);
});

test('collector independently rejects artifact, pack, source, environment, current run, hashes and schema tampering', async () => {
  const mutations = [v => { v.artifacts[0].expired = true; }, v => { v.artifacts[0].workflow_run.id++; }, v => { v.artifacts[0].workflow_run.head_repository_id++; },
    v => { v.artifacts[0].workflow_run.repository_id++; }, v => { v.artifacts[0].workflow_run.head_sha = '0'.repeat(40); },
    v => { v.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; }, v => { v.artifacts[0].size_in_bytes++; },
    v => { v.artifacts[0].created_at = new Date(now - 9001).toISOString(); }, v => { v.artifacts[0].created_at = new Date(now).toISOString(); },
    v => { v.payload.grantsAuthority = true; repack(v); }, v => { v.payload.producerJobId++; repack(v); },
    v => { v.payload.binding.runId++; repack(v); }, v => { v.payload.extra = 'unreviewed'; repack(v); },
    v => { v.payload.capturedAt = new Date(now).toISOString(); repack(v); }, v => { v.payload.materialPackSha256 = '0'.repeat(64); v.archive = materialZip(v.payload); v.artifacts[0].digest = `sha256:${runtimeMaterialHash(v.archive)}`; },
    v => { v.pack.binding.configurationRevision = '0'.repeat(64); v.variables[1].value = JSON.stringify(v.pack); repack(v); },
    v => { v.pack.binding.sourceDigest = '0'.repeat(64); v.variables[1].value = JSON.stringify(v.pack); repack(v); },
    v => { v.pack.materials.context = '{}'; v.variables[1].value = JSON.stringify(v.pack); },
    v => { v.pack.materials.unknown = '{}'; v.variables[1].value = JSON.stringify(v.pack); repack(v); }];
  for (const workflow of workflows) for (const mutate of mutations) { const value = fixture(workflow); mutate(value); await assert.rejects(() => collect(value)); }
});

test('bounded fixed ZIP refuses extra files, links, path changes, corrupt data, invalid UTF8 and oversized input', () => {
  const value = fixture(); assert.deepEqual(decodeRuntimeMaterialArchive(value.archive), value.payload);
  assert.deepEqual(decodeRuntimeMaterialArchive(materialZip(value.payload, { compressed: true, descriptor: true })), value.payload);
  for (const archive of [Buffer.alloc(0), Buffer.alloc(131073), materialZip(value.payload, { filename: '../escape.json' }),
    materialZip(value.payload, { mode: 0o120777 }), materialZip(value.payload, { bytes: Buffer.from([0xc0, 0xaf]) }),
    materialZip(value.payload, { bytes: Buffer.alloc(65537, 65), compressed: true }),
    Buffer.concat([value.archive, Buffer.from('trailing')])]) assert.throws(() => decodeRuntimeMaterialArchive(archive));
  for (const mutate of [a => { a[40] ^= 1; }, a => { a.writeUInt16LE(2, a.length - 22 + 10); }, a => { a.writeUInt16LE(1, 6); }]) {
    const archive = Buffer.from(value.archive); mutate(archive); assert.throws(() => decodeRuntimeMaterialArchive(archive));
  }
  assert.throws(() => parseRuntimeMaterialPack('x'.repeat(49153), value.payload.binding));
  assert.throws(() => runtimeMaterialPayload(JSON.stringify({ ...value.pack, extra: true }), producer(value), now));
});

test('locked official SDK archive codec is accepted without invoking any upload or hosted client', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-material-sdk-codec-')), payload = fixture().payload;
  try {
    const sourcePath = join(directory, RUNTIME_MATERIAL_FILENAME); writeFileSync(sourcePath, JSON.stringify(payload), { mode: 0o600 });
    for (const compression of [0, 6]) {
      const stream = await createZipUploadStream([{ sourcePath, destinationPath: RUNTIME_MATERIAL_FILENAME, stats: lstatSync(sourcePath) }], compression);
      const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      assert.deepEqual(decodeRuntimeMaterialArchive(Buffer.concat(chunks)), payload);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('installed artifact SDK rejects absent native runtime variables before any network attempt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-material-sdk-runtime-'));
  const script = `
    import net from 'node:net';
    import tls from 'node:tls';
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    let networkCalls = 0;
    const blocked = () => { networkCalls++; throw new Error('Synthetic network transport forbidden'); };
    net.Socket.prototype.connect = blocked; tls.connect = blocked;
    http.request = blocked; http.get = blocked; https.request = blocked; https.get = blocked;
    globalThis.fetch = blocked; syncBuiltinESMExports();
    const stdout = process.stdout.write, stderr = process.stderr.write;
    process.stdout.write = process.stderr.write = () => true;
    const results = [];
    try {
      const { DefaultArtifactClient } = await import('@actions/artifact');
      const token = ['e30', Buffer.from(JSON.stringify({ scp: 'Actions.Results:synthetic-run:synthetic-job' })).toString('base64url'), 'synthetic-signature'].join('.');
      for (const missing of ['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_RESULTS_URL']) {
        delete process.env.ACTIONS_RUNTIME_TOKEN; delete process.env.ACTIONS_RESULTS_URL;
        if (missing === 'ACTIONS_RESULTS_URL') process.env.ACTIONS_RUNTIME_TOKEN = token;
        let rejectedForMissingRuntime = false;
        try { await new DefaultArtifactClient().uploadArtifact('synthetic-runtime-check', [${JSON.stringify(join(directory, RUNTIME_MATERIAL_FILENAME))}], ${JSON.stringify(directory)}, { retentionDays: 7, compressionLevel: 0 }); }
        catch (error) { rejectedForMissingRuntime = error?.message === 'Unable to get the ' + missing + ' env variable'; }
        results.push({ missing, rejectedForMissingRuntime, networkCalls });
      }
    } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
    process.stdout.write(JSON.stringify(results));
  `;
  try {
    writeFileSync(join(directory, RUNTIME_MATERIAL_FILENAME), '{}', { mode: 0o600 });
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, HOME: directory, GITHUB_SERVER_URL: 'https://github.com' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 0); assert.equal(child.stderr, '');
    assert.deepEqual(JSON.parse(child.stdout), ['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_RESULTS_URL'].map(missing => ({ missing, rejectedForMissingRuntime: true, networkCalls: 0 })));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function publicationFixture() {
  const row = value => ({ body: Buffer.from(JSON.stringify(value)) });
  const rows = { context: row({ provisionedAt: new Date(now - 60000).toISOString() }),
    root: row({ reviewedAt: new Date(now - 30000).toISOString() }), independent: row({ reviewedAt: new Date(now - 30000).toISOString() }) };
  const value = materialTransportFixture({ expected, rows, now });
  value.producer = producer(value); value.created = { id: value.artifacts[0].id, size: value.archive.length, digest: runtimeMaterialHash(value.archive) };
  value.clock = now; value.sleeps = 0; value.uploadCalls = 0;
  value.reconcile = () => reconcileRuntimeMaterialPublication({ reads: value.reads, producer: value.producer, created: value.created, payload: value.payload,
    now: () => value.clock, sleep: async ms => { value.sleeps++; value.clock += ms; } });
  return value;
}

test('fresh pre-write gate rejects clocks that expire during authentication without renewing original evidence', () => {
  const mutations = [v => { v.producer.oidcExpiresAt = now + 500; },
    v => { v.producer.dispatchedAt = new Date(now - 1800000 + 500).toISOString(); },
    v => { v.producer.job.started_at = new Date(now - 1800000 + 500).toISOString(); },
    v => { v.producer.step.started_at = new Date(now - 1800000 + 500).toISOString(); },
    ...['context', 'root', 'independent'].map(role => v => {
      const pack = JSON.parse(v.payload.materialPackText), record = JSON.parse(pack.materials[role]);
      record[role === 'context' ? 'provisionedAt' : 'reviewedAt'] = new Date(now - (role === 'context' ? 2700000 : 1800000) + 500).toISOString();
      pack.materials[role] = JSON.stringify(record); v.payload = runtimeMaterialPayload(JSON.stringify(pack), v.producer, now);
    })];
  for (const mutate of mutations) {
    const value = publicationFixture(); mutate(value); const original = JSON.stringify({ producer: value.producer, payload: value.payload });
    const options = { producer: value.producer, payload: value.payload };
    assert.equal(assertRuntimeMaterialPublicationFresh({ ...options, now }), now + 500);
    assert.throws(() => assertRuntimeMaterialPublicationFresh({ ...options, now: now + 500 }));
    assert.throws(() => assertRuntimeMaterialPublicationFresh({ ...options, now: now + 501 }));
    assert.equal(JSON.stringify({ producer: value.producer, payload: value.payload }), original);
    assert.equal(value.calls.length, 0); assert.equal(value.uploadCalls, 0);
  }
  const value = publicationFixture(); delete value.producer.oidcExpiresAt;
  assert.throws(() => assertRuntimeMaterialPublicationFresh({ producer: value.producer, payload: value.payload, now }));
  const source = readFileSync(new URL('../scripts/runtime-compatibility-materials.mjs', import.meta.url), 'utf8');
  const gate = 'assertRuntimeMaterialPublicationFresh({ producer: current, payload, now: Date.now() });';
  assert.equal(source.split(gate).length - 1, 2);
  assert.ok(source.indexOf(gate) < source.indexOf('fd = openSync('));
  assert.match(source, /assertRuntimeMaterialPublicationFresh\(\{ producer: current, payload, now: Date\.now\(\) \}\);\n\s+phase\('artifact_upload'\);\n\s+created = await new DefaultArtifactClient\(\)\.uploadArtifact/);
});

test('actual data-only reconciliation tolerates lag then exact visibility with one archive read and no upload callback', async () => {
  const value = publicationFixture(), original = value.reads.json; let lists = 0;
  value.reads.uploadArtifact = () => { value.uploadCalls++; assert.fail('Reconciliation cannot upload.'); };
  value.reads.json = endpoint => endpoint.endsWith('/artifacts?per_page=100&page=1') && ++lists < 3 ? { total_count: 0, artifacts: [] } : original(endpoint);
  const result = await value.reconcile();
  assert.equal(result.artifactId, value.created.id); assert.equal(result.archiveSha256, value.created.digest);
  assert.equal(lists, 3); assert.equal(value.sleeps, 2); assert.equal(value.archiveCalls, 1); assert.equal(value.uploadCalls, 0);
  assert.ok(value.calls.some(endpoint => endpoint.endsWith(`/actions/artifacts/${value.created.id}`)));
});

test('actual publication reconciliation bounds permanent absence and original expiry without restamping or retrying upload', async () => {
  const value = publicationFixture(), original = value.reads.json; let lists = 0;
  value.reads.json = endpoint => endpoint.endsWith('/artifacts?per_page=100&page=1') ? (++lists, { total_count: 0, artifacts: [] }) : original(endpoint);
  const before = JSON.stringify(value.payload); await assert.rejects(() => value.reconcile());
  assert.equal(lists, 10); assert.equal(value.sleeps, 9); assert.equal(value.clock - now, 4500);
  assert.equal(value.archiveCalls, 0); assert.equal(value.uploadCalls, 0); assert.equal(JSON.stringify(value.payload), before);
  value.producer.oidcExpiresAt = now + 500; value.clock = now; lists = 0; value.sleeps = 0;
  await assert.rejects(() => value.reconcile()); assert.equal(lists, 1); assert.equal(value.clock, now + 500);
});

test('publication duplicates, wrong SDK identity, digest, schema, corrupt archives and unclassified read errors fail immediately', async () => {
  for (const mutate of [v => { v.artifacts.push({ ...v.artifacts[0], id: 102 }); }, v => { v.created.id++; },
    v => { v.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; }, v => { v.artifacts[0].size_in_bytes++; },
    v => { v.artifacts[0].workflow_run.id++; }, v => { v.archive = Buffer.from(v.archive); v.archive[40] ^= 1; },
    v => { const changed = { ...v.payload, grantsAuthority: true }; v.archive = materialZip(changed);
      v.created.digest = runtimeMaterialHash(v.archive); v.created.size = v.archive.length;
      v.artifacts[0].digest = `sha256:${v.created.digest}`; v.artifacts[0].size_in_bytes = v.created.size; },
    v => { v.reads.json = () => { throw new Error('Unclassified public read failure.'); }; }]) {
    const value = publicationFixture(); mutate(value); await assert.rejects(() => value.reconcile());
    assert.equal(value.sleeps, 0); assert.equal(value.uploadCalls, 0); assert.ok(value.archiveCalls <= 1);
  }
});

test('escaping-heavy pack is bounded by serialized wrapper before any durable attempt marker or upload', () => {
  const value = fixture(); value.pack.materials.context = `{"synthetic":true}${'\t'.repeat(22500)}`;
  const text = JSON.stringify(value.pack); assert.ok(Buffer.byteLength(text) <= 49152);
  assert.doesNotThrow(() => parseRuntimeMaterialPack(text, value.payload.binding));
  assert.throws(() => runtimeMaterialPayload(text, producer(value), now));
  const source = readFileSync(new URL('../scripts/runtime-compatibility-materials.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const payload = runtimeMaterialPayload(') < source.indexOf('fd = openSync('));
  assert.equal(source.split('.uploadArtifact(').length - 1, 1);
});

test('same invocation caches only authenticated immutable archive; mutable review, run and input boundaries remain fresh', async t => {
  const value = fixture(), start = performance.now();
  await collect(value); const first = value.calls.length;
  await collect(value); const second = value.calls.length - first;
  assert.equal(value.archiveCalls, 1); assert.equal(second, first);
  value.artifacts[0].size_in_bytes++; await assert.rejects(() => collect(value)); value.artifacts[0].size_in_bytes--;
  value.approvals[0].state = 'rejected'; await assert.rejects(() => collect(value)); assert.equal(value.archiveCalls, 1);
  value.approvals[0].state = 'approved'; value.run.actor.id = 2; await assert.rejects(() => collect(value));
  value.run.actor.id = 1; value.branch.commit.sha = '0'.repeat(40); await assert.rejects(() => collect(value));
  value.branch.commit.sha = expected.harnessSha; value.variables[1].value += ' '; await assert.rejects(() => collect(value));
  const separate = fixture(); await collect(separate); assert.equal(separate.archiveCalls, 1);
  t.diagnostic(JSON.stringify({ fixtureAdmissions: 2, firstPublicCalls: first, repeatedPublicCalls: second, archiveReads: 1,
    elapsedMs: +(performance.now() - start).toFixed(3), allMutableBoundariesRechecked: true, providerCalls: 0 }));
});

test('workflow producer remains data-only and verify-authority does not invoke runtime publication', () => {
  const action = '.github/actions/runtime-compatibility-materials/action.yml';
  assert.equal(PREVIEW_EMAIL_BUILD_CONTROL_FILES.filter(path => path === action).length, 1);
  assert.equal(SUCCESSOR_LIVE_HARNESS_FILES.filter(path => path === action).length, 1);
  const source = readFileSync(new URL('../scripts/runtime-compatibility-materials.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env\.(?:FCOS_RELEASE_VERCEL_TOKEN|FCOS_RELEASE_VERCEL_ENROLLMENT)|collectSuccessorLive(?:Operation)?Admission|successorLiveSelection|privateKey|issueGrant/);
  for (const name of workflows) { const workflow = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.equal(workflow.split('name: Persist immutable exact04ee runtime materials').length - 1, 1);
    const materialStep = workflow.split('      - name: Persist immutable exact04ee runtime materials\n')[1].split('\n      - ')[0];
    const prefix = name.endsWith('runtime-compatibility-normal-role.yml') ? './' : './trusted/';
    assert.match(materialStep, new RegExp('^        uses: ' + prefix.replaceAll('.', '\\.') + '\\.github/actions/runtime-compatibility-materials$', 'm'));
    assert.doesNotMatch(materialStep, /^        (?:run|with|working-directory):/m);
    assert.match(materialStep, /GH_TOKEN: \$\{\{ secrets.FCOS_RELEASE_GH_TOKEN \}\}/);
    assert.match(workflow, /id-token: write/); assert.match(workflow, /GH_TOKEN: \$\{\{ secrets.FCOS_RELEASE_GH_TOKEN \}\}/);
    if (name.endsWith('preview-email-proof-build.yml')) assert.match(workflow, /inputs\.operation == 'create' \|\| inputs\.operation == 'readback'[^\n]*FCOS_RUNTIME_COMPATIBILITY_MATERIAL_TRANSPORT/);
  }
});
