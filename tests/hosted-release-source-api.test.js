import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import tarStream from 'tar-stream';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { createVercelSourceArchive, prepareVercelSourceApiRequest, executeVercelSourceApiRequest, safeVercelSourceApiFailure, SOURCE_API_TRANSPORT, prepareVercelProjectActionRequest, executeVercelProjectActionRequest } from '../scripts/lib/hosted-release/vercel-source-api.mjs';
import { createVercelAdapter } from '../scripts/lib/hosted-release/vercel.mjs';
import { preparePreview, reconcilePending, safeFailure, consequential } from '../scripts/lib/hosted-release/controller.mjs';
import { selectionBuildGuard } from '../scripts/lib/hosted-release/configuration-selection.mjs';
import { admitPreviewWriterFixture, admitProductionWriterFixture } from './helpers/hosted-vercel-writer.mjs';
import { vercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { LEGACY_RELEASE_EFFECTS } from '../config/legacyReleaseContainment.js';

const H = 'a'.repeat(64), dummy = 'OfflineDummyCredentialOnly';
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'fcos-source-api-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'fixture', engines: { node: '24.x' }, scripts: { build: 'echo fixture' } }));
  writeFileSync(join(directory, 'package-lock.json'), '{}\n');
  writeFileSync(join(directory, 'vercel.json'), JSON.stringify({ installCommand: 'npm ci', git: { deploymentEnabled: false },
    regions: ['sin1'], rewrites: [{ source: '/fixture', destination: '/index.html' }] }));
  writeFileSync(join(directory, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(directory, '.vercelignore'), 'excluded.txt\n');
  writeFileSync(join(directory, 'excluded.txt'), 'tracked but upload-excluded\n');
  writeFileSync(join(directory, 'binary.bin'), Buffer.from([0, 255, 128, 13, 10]));
  writeFileSync(join(directory, 'executable.sh'), '#!/bin/sh\nexit 0\n'); chmodSync(join(directory, 'executable.sh'), 0o755);
  git(['init', '-q']); git(['remote', 'add', 'origin', 'https://github.com/hocheunglai-oss/fcos.git']);
  const commit = () => { git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']); };
  commit(); git(['checkout', '--detach', '-q']);
  const manifest = fixtureManifest(); manifest.stage = 'qualification'; manifest.executionMode = 'qualification';
  manifest.legacyReleaseContainment = { schemaVersion: 1, policy: 'legacy_control_plane_effects_v1', selection: 'detached_node24_before_candidate_v1',
    effects: LEGACY_RELEASE_EFFECTS.map(effect => ({ ...effect, effectSha256: H })) };
  manifest.verification = { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' },
    vercelSourceTransport: SOURCE_API_TRANSPORT,
    publicBuildEnvironment: { VITE_FCOS_ENABLE_FCUNO_OIDC: 'true' },
    projectSettings: { framework: 'vite', nodeVersion: '24.x', rootDirectory: null, installCommand: 'npm install', buildCommand: 'npm run build', devCommand: null, outputDirectory: null } };
  const refresh = () => {
    const source = collectBuildProvenance({ cwd: directory, env: {}, requireClean: true });
    manifest.candidate.sha = source.commit; manifest.candidate.sourceSha256 = source.sourceDigest;
    manifest.candidate.lockSha256 = digest(readFileSync(join(directory, 'package-lock.json')));
  };
  refresh();
  const read = vercelReadFixture({ targets: manifest.targets }); manifest.verification.vercelReadCredential = read.binding;
  const admitted = admitPreviewWriterFixture(manifest);
  const refreshSetup = (writer = admitted) => {
    writer.setup.legacyReleaseContainment = manifest.legacyReleaseContainment; writer.setup.vercelReadCredentialAcceptance = read.acceptance;
    manifest.setupSha256 = digest(writer.setup); writer.env.FCOS_ADMITTED_RELEASE_SETUP = JSON.stringify(writer.setup);
    writer.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256 = digest(writer.setup); return writer;
  };
  refreshSetup();
  const project = { ...manifest.verification.projectSettings, id: manifest.targets.vercelProject, accountId: manifest.targets.vercelTeam,
    name: 'fcos', autoAssignCustomDomains: false, autoExposeSystemEnvs: true,
    link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos', deployHooks: [] } };
  const prepare = (extra = {}) => prepareVercelSourceApiRequest({ manifest, candidateDirectory: directory, observedProject: project, ...extra });
  return { directory, git, commit, refresh, manifest, project, prepare, refreshSetup };
}
function ack(prepared, patch = {}) {
  const payload = JSON.parse(prepared.body);
  return { id: 'dpl_OFFLINE', url: 'fcos-abcdef123-hocheunglai-6535s-projects.vercel.app', projectId: prepared.receipt.projectId,
    ownerId: prepared.receipt.teamId, readyState: 'BUILDING', source: 'cli', meta: payload.meta, ...patch };
}
function options(f, prepared, extra = {}) {
  return { manifest: f.manifest, prepared, context: { operationId: prepared.receipt.operationId, request: prepared.intent },
    token: dummy, assertWriteContext: () => {}, fetchImpl: async () => Response.json(ack(prepared)), ...extra };
}
async function archiveEntries(payload) {
  assert.equal(payload.files.length, 1); const archive = payload.files[0];
  assert.equal(archive.file, '.vercel/source.tgz.part1'); assert.equal(archive.mode, 438); assert.equal(archive.encoding, 'base64');
  const parser = tarStream.extract(), result = [];
  const finished = new Promise((accept, reject) => { parser.once('finish', accept); parser.once('error', reject); });
  parser.on('entry', (header, stream, next) => {
    const chunks = []; stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => { result.push({ header, bytes: Buffer.concat(chunks) }); next(); }); stream.on('error', error => parser.destroy(error));
  });
  parser.end(gunzipSync(Buffer.from(archive.data, 'base64'))); await finished; return result;
}

test('prepares immutable exact tracked bytes, public build/runtime inputs and honest REST receipt without settings mutation', async t => {
  const f = fixture(t), p = await f.prepare(), payload = JSON.parse(p.body);
  assert.equal(p.kind, SOURCE_API_TRANSPORT); assert.equal(p.method, 'POST');
  assert.equal(p.url, `https://api.vercel.com/v13/deployments?teamId=${f.manifest.targets.vercelTeam}`);
  assert.equal(payload.project, f.manifest.targets.vercelProject); assert.equal(payload.version, 2);
  assert.equal(Object.hasOwn(payload, 'target'), false); assert.equal(Object.hasOwn(payload, 'gitSource'), false);
  assert.equal(Object.hasOwn(payload, 'projectSettings'), false); assert.equal(Object.hasOwn(payload, 'deploymentId'), false);
  assert.equal(payload.source, 'cli'); assert.deepEqual(payload.gitMetadata, { remoteUrl: 'https://github.com/hocheunglai-oss/fcos.git', commitRef: 'HEAD', commitSha: f.manifest.candidate.sha, dirty: false });
  assert.deepEqual(payload.regions, ['sin1']); assert.deepEqual(payload.rewrites, [{ source: '/fixture', destination: '/index.html' }]);
  assert.equal(payload.installCommand, 'npm ci');
  assert.equal(payload.env.FCOS_ENABLE_READ_ONLY_CI, 'true'); assert.equal(payload.build.env.VITE_FCOS_ENABLE_FCUNO_OIDC, 'true');
  assert.equal(payload.build.env.FCOS_EXPECTED_SOURCE_SHA256, f.manifest.candidate.sourceSha256);
  assert.match(payload.build.env.NODE_OPTIONS, /^--import=data:text\/javascript,/);
  const entries = await archiveEntries(payload);
  assert.equal(entries.some(row => row.header.name === 'excluded.txt'), false);
  assert.deepEqual(entries.map(row => row.header.name), entries.map(row => row.header.name).sort());
  assert.deepEqual(entries.find(row => row.header.name === 'binary.bin').bytes, readFileSync(join(f.directory, 'binary.bin')));
  assert.equal(entries.find(row => row.header.name === 'executable.sh').header.mode, 0o755);
  assert.equal(entries.every(row => row.header.type === 'file' && row.header.uid === 0 && row.header.gid === 0 && row.header.mtime.getTime() === 0), true);
  assert.equal(p.receipt.archive.entryCount, entries.length); assert.equal(p.receipt.archive.parts, 1);
  assert.equal(p.receipt.bodyBytes, Buffer.byteLength(p.body)); assert.equal(p.receipt.bodySha256, digest(p.body));
  assert.equal(p.receipt.requestHash, digest(p.intent)); assert.equal(p.receipt.transport, 'rest_api');
  assert.equal(p.receipt.sourceBuildReadyProven, false); assert.equal(Object.hasOwn(p.receipt, 'cliVersion'), false);
  assert.equal(Object.isFrozen(p), true); assert.equal(Object.isFrozen(p.receipt), true); assert.equal(Object.isFrozen(p.intent.candidate), true);
  const repeated = await f.prepare(); assert.equal(p.body, repeated.body); assert.equal(p.receipt.archive.sha256, repeated.receipt.archive.sha256);
});

test('wrong project, settings, source and non-public environment reject before transport preparation', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.prepare({ observedProject: { ...f.project, id: 'prj_foreign' } }), /PROJECT_IDENTITY/);
  await assert.rejects(() => f.prepare({ observedProject: { ...f.project, nodeVersion: '22.x' } }), /PROJECT_CONFIGURATION/);
  await assert.rejects(() => f.prepare({ observedProject: { ...f.project, installCommand: 'npm ci' } }), /PROJECT_CONFIGURATION/);
  await assert.rejects(() => f.prepare({ observedProject: { ...f.project, autoAssignCustomDomains: true } }), /PROJECT_IDENTITY/);
  f.manifest.verification.publicBuildEnvironment.SECRET_VALUE = dummy;
  await assert.rejects(() => f.prepare(), /PUBLIC_BUILD_INPUT/); delete f.manifest.verification.publicBuildEnvironment.SECRET_VALUE;
  f.manifest.candidate.sourceSha256 = H; await assert.rejects(() => f.prepare(), /SOURCE_CHANGED/);
});

test('reviewed npm ci source override preserves the actual-manifest npm install default snapshot and refuses other overrides', async t => {
  const f = fixture(t), p = await f.prepare(), payload = JSON.parse(p.body), defaults = structuredClone(f.manifest.verification.projectSettings);
  assert.equal(defaults.installCommand, 'npm install'); assert.equal(defaults.outputDirectory, null);
  assert.equal(payload.installCommand, 'npm ci'); assert.equal(Object.hasOwn(payload, 'projectSettings'), false);
  assert.equal(p.receipt.configurationSha256, digest(defaults)); assert.equal(p.intent.configurationSha256, digest(defaults));
  assert.equal(payload.meta.fcosSourceConfigurationSha256, digest(defaults));
  assert.notEqual(p.receipt.configurationSha256, digest({ ...defaults, installCommand: 'npm ci' }));
  assert.deepEqual(f.manifest.verification.projectSettings, defaults); assert.equal(f.project.installCommand, 'npm install');
  for (const [key, value] of [['buildCommand', 'npm run other'], ['devCommand', 'npm run dev'], ['outputDirectory', 'dist'], ['framework', 'nextjs']]) {
    const current = fixture(t), config = JSON.parse(readFileSync(join(current.directory, 'vercel.json'), 'utf8'));
    writeFileSync(join(current.directory, 'vercel.json'), JSON.stringify({ ...config, [key]: value })); current.commit(); current.refresh();
    await assert.rejects(() => current.prepare(), /CONFIGURATION_OVERRIDE|SOURCE_CHANGED/);
  }
});

test('attached checkout, assumed-unchanged edits and untracked source refuse before intent', async t => {
  const f = fixture(t); f.git(['checkout', '-qb', 'attached']);
  await assert.rejects(() => f.prepare(), /SOURCE_CHANGED/); f.git(['checkout', '--detach', '-q']);
  f.git(['update-index', '--assume-unchanged', 'package.json']); writeFileSync(join(f.directory, 'package.json'), '{}\n');
  await assert.rejects(() => f.prepare(), /SOURCE_CHANGED/);
});

test('tracked private names and symlinks never become source payload', async t => {
  const f = fixture(t); writeFileSync(join(f.directory, '.env.private'), dummy); f.commit();
  // Existing provenance skips credential bytes. New transport rejects the name before opening it.
  f.refresh(); await assert.rejects(() => f.prepare(), /PRIVATE_OR_INVALID_PATH/);
});

test('regular files and payload byte ceiling are enforced locally', async t => {
  const f = fixture(t); symlinkSync('package.json', join(f.directory, 'linked.json')); f.commit();
  await assert.rejects(() => f.prepare(), /SOURCE_CHANGED|REGULAR_FILES/);
  rmSync(join(f.directory, 'linked.json')); writeFileSync(join(f.directory, 'large.bin'), randomBytes(13 * 1024 * 1024)); f.commit(); f.refresh();
  await assert.rejects(() => f.prepare(), /PAYLOAD_TOO_LARGE/);
});

test('archive utility rejects duplicate/private/traversal paths and non-regular modes before packing', async () => {
  const regular = { file: 'safe.txt', bytes: Buffer.from('safe'), mode: 0o100644 };
  for (const entries of [[regular, regular], ...['../outside', '/absolute', '.env.private', '.vercel/source.tgz.part1', 'x\\y', 'a/../b'].map(file => [{ ...regular, file }]),
    [{ ...regular, mode: 0o120777 }], [{ ...regular, bytes: 'not-a-buffer' }]]) await assert.rejects(createVercelSourceArchive(entries), /ARCHIVE_ENTRIES/);
});

test('all extracted file bytes/modes reproduce the exact source digest and execute the initial Node guard before candidate code', async t => {
  const f = fixture(t), p = await f.prepare(), payload = JSON.parse(p.body), entries = await archiveEntries(payload);
  const extracted = realpathSync(mkdtempSync(join(tmpdir(), 'fcos-source-archive-extracted-')));
  t.after(() => rmSync(extracted, { recursive: true, force: true }));
  for (const entry of entries) {
    const file = join(extracted, entry.header.name); mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, entry.bytes); chmodSync(file, entry.header.mode);
    const original = join(f.directory, entry.header.name); assert.deepEqual(readFileSync(file), readFileSync(original));
  }
  const evidence = collectBuildProvenance({ cwd: extracted, requireClean: true, env: {
    FCOS_BUILD_COMMIT_SHA: f.manifest.candidate.sha, FCOS_EXPECTED_SOURCE_SHA256: f.manifest.candidate.sourceSha256 } });
  assert.equal(evidence.sourceDigest, f.manifest.candidate.sourceSha256); assert.equal(evidence.releaseEligible, true);
  const env = { PATH: process.env.PATH, NODE_OPTIONS: payload.build.env.NODE_OPTIONS, VERCEL_GIT_COMMIT_REF: 'HEAD', VERCEL_GIT_COMMIT_SHA: f.manifest.candidate.sha };
  const output = spawnSync(process.execPath, ['-e', "process.stderr.write('CANDIDATE_MARKER\\n')"], { cwd: extracted, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(output.status, 0); assert.equal(output.stdout, '');
  assert.equal(output.stderr, `FCOS_CONFIGURATION_SELECTION:${digest(f.manifest)}:HEAD:${f.manifest.candidate.sha}\nCANDIDATE_MARKER\n`);
  let refused;
  try { execFileSync(process.execPath, ['-e', "process.stderr.write('CANDIDATE_MARKER\\n')"], { cwd: extracted, env: { ...env, VERCEL_GIT_COMMIT_REF: 'foreign' }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { refused = error; }
  assert.equal(refused.status, 1); assert.equal(refused.stderr.toString().includes('FCOS_CONFIGURATION_SELECTION_REFUSED'), true);
  assert.equal(refused.stderr.toString().includes('CANDIDATE_MARKER\n'), false);
});

test('qualification cannot prepare Production stage, actions, or arbitrary operation IDs', async t => {
  const f = fixture(t);
  for (const phase of ['production.stage', 'production.promote', 'production.rollback']) await assert.rejects(() => f.prepare({ phase }), /SOURCE_API_PHASE/);
  await assert.rejects(() => f.prepare({ operationId: 'different-operation' }), /OPERATION_BINDING/);
});

test('source configuration cannot inject transport, inherited source, settings or build-environment overrides', async t => {
  const f = fixture(t), original = JSON.parse(readFileSync(join(f.directory, 'vercel.json'), 'utf8'));
  for (const [key, value] of [['projectSettings', {}], ['gitSource', {}], ['deploymentId', 'dpl_other'], ['env', { SECRET: dummy }],
    ['build', { env: { SECRET: dummy } }], ['source', 'git'], ['target', 'production'], ['meta', {}], ['installCommand', 'npm install']]) {
    writeFileSync(join(f.directory, 'vercel.json'), JSON.stringify({ ...original, [key]: value })); f.commit(); f.refresh();
    await assert.rejects(() => f.prepare(), /CONFIGURATION_OVERRIDE|SOURCE_CHANGED/);
  }
});

test('one known ACK requires final synchronous write-context guard, carries only whitelisted fields, and proves no READY source build', async t => {
  const f = fixture(t), p = await f.prepare(), calls = [];
  const result = await executeVercelSourceApiRequest(options(f, p, { assertWriteContext: () => { calls.push('guard'); }, fetchImpl: async (url, request) => {
    calls.push('post'); assert.equal(url, p.url); assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error');
    assert.equal(request.body, p.body); assert.equal(request.headers.authorization, `Bearer ${dummy}`);
    return Response.json(ack(p, { rawProviderValue: dummy, env: { secret: dummy } }));
  } }));
  assert.deepEqual(calls, ['guard', 'post']); assert.equal(result.id, 'dpl_OFFLINE'); assert.equal(result.state, 'BUILDING');
  assert.equal(result.sourceApi.sourceBuildReadyProven, false); assert.equal(result.sourceApi.transport, 'rest_api');
  assert.equal(JSON.stringify(result).includes(dummy), false); assert.equal(Object.hasOwn(result, 'env'), false);
  await assert.rejects(executeVercelSourceApiRequest(options(f, p)), /SUBMISSION_CONTEXT/);
});

test('forged or changed prepared payload, context, manifest, and source refuse before any fetch', async t => {
  const f = fixture(t), p = await f.prepare(); let calls = 0;
  const fetchImpl = () => { calls++; return Response.json(ack(p)); };
  await assert.rejects(executeVercelSourceApiRequest(options(f, { ...p }, { fetchImpl })), /SUBMISSION_CONTEXT/);
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { fetchImpl, context: { operationId: p.receipt.operationId, request: { ...p.intent, bodySha256: H } } })), /SUBMISSION_CONTEXT/);
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { fetchImpl, manifest: { ...f.manifest, targets: { ...f.manifest.targets, vercelProject: 'prj_other' } } })), /TARGET_MISMATCH/);
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { fetchImpl, assertWriteContext: () => { throw Error(dummy); } })), /SOURCE_API_WRITER_CONTEXT/);
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { fetchImpl, assertWriteContext: () => false })), /SYNCHRONOUS_CONTEXT_REQUIRED/);
  writeFileSync(join(f.directory, 'new-source.js'), 'changed');
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { fetchImpl })), /SOURCE_CHANGED/); assert.equal(calls, 0);
});

test('explicit transport admission and unchanged manifest are required across archive preparation and the final synchronous guard', async t => {
  const f = fixture(t); delete f.manifest.verification.vercelSourceTransport;
  await assert.rejects(f.prepare(), /TRANSPORT_NOT_ADMITTED/);
  f.manifest.verification.vercelSourceTransport = SOURCE_API_TRANSPORT;
  const pending = f.prepare(); f.manifest.changes.push('changed during archive preparation');
  await assert.rejects(pending, /MANIFEST_CHANGED/);
  const p = await f.prepare(); let calls = 0;
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { assertWriteContext: () => { f.manifest.changes.push('changed at guard'); },
    fetchImpl: async () => { calls++; return Response.json(ack(p)); } })), /SUBMISSION_CONTEXT/);
  assert.equal(calls, 0);
});

test('failure projection rejects added headers/raw fields and malformed provider-derived values', () => {
  const safe = { schemaVersion: 1, kind: 'fcos_source_api_submission_failure_v1', outcome: 'unknown', operationId: 'qualification-example-001-preview-create',
    phase: 'preview.create', requestHash: H, manifestHash: H, bodySha256: H, status: 500, reason: 'HTTP_ERROR' };
  assert.deepEqual(safeVercelSourceApiFailure(safe), safe);
  for (const patch of [{ headers: { authorization: dummy } }, { rawOutput: dummy }, { reason: dummy }, { status: 600 }, { operationId: dummy }, { bodySha256: dummy }])
    assert.equal(safeVercelSourceApiFailure({ ...safe, ...patch }), undefined);
});

for (const [name, response] of [
  ['500', () => new Response(dummy, { status: 500, headers: { 'x-secret': dummy } })],
  ['307', () => new Response(dummy, { status: 307, headers: { location: 'https://foreign.invalid/' } })],
  ['lost ACK', () => { throw Error(`authorization Bearer ${dummy}`); }],
  ['malformed ACK', () => new Response(dummy, { status: 200 })],
  ['oversized ACK', () => new Response(' '.repeat(128 * 1024 + 1), { status: 200 })],
  ['wrong project ACK', p => Response.json(ack(p, { projectId: 'prj_other' }))],
  ['missing owner ACK', p => Response.json(ack(p, { ownerId: undefined }))],
  ['conflicting team ACK', p => Response.json(ack(p, { teamId: 'team_other' }))],
  ['production ACK', p => Response.json(ack(p, { target: 'production' }))],
  ['wrong source ACK', p => Response.json(ack(p, { source: 'git' }))],
  ['forged metadata ACK', p => Response.json(ack(p, { meta: { ...ack(p).meta, githubCommitSha: 'f'.repeat(40) } }))]
]) test(`${name} stays unknown after exactly one POST, without a raw response or credential in its report`, async t => {
  const f = fixture(t), p = await f.prepare(); let calls = 0, caught;
  try { await executeVercelSourceApiRequest(options(f, p, { fetchImpl: async () => { calls++; return response(p); } })); } catch (error) { caught = error; }
  assert.equal(calls, 1); assert.equal(caught.code, 'VERCEL_SOURCE_API_OUTCOME_UNKNOWN');
  assert.equal(caught.detail.providerSubmissionStarted, true); assert.equal(caught.detail.sourceApiFailure.outcome, 'unknown');
  assert.equal(JSON.stringify(caught).includes(dummy), false); assert.equal(JSON.stringify(caught).includes('foreign.invalid'), false);
  assert.equal(Object.isFrozen(caught.detail.sourceApiFailure), true);
  assert.deepEqual(Object.keys(caught.detail.sourceApiFailure).sort(), ['schemaVersion', 'kind', 'outcome', 'operationId', 'phase', 'requestHash', 'manifestHash', 'bodySha256', 'status', 'reason'].sort());
  await assert.rejects(executeVercelSourceApiRequest(options(f, p)), /SUBMISSION_CONTEXT/); assert.equal(calls, 1);
});

test('timeout is bounded even if the transport ignores abort and never resubmits', async t => {
  const f = fixture(t), p = await f.prepare(); let calls = 0, signal;
  await assert.rejects(executeVercelSourceApiRequest(options(f, p, { timeoutMs: 5, fetchImpl: (_, request) => {
    calls++; signal = request.signal; return new Promise(() => {});
  } })), error => error.code === 'VERCEL_SOURCE_API_OUTCOME_UNKNOWN' && error.detail.sourceApiFailure.reason === 'TIMEOUT');
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

function integrated(t, { outcome = 'ack', uncertaintyThrows = false, native = false, production = false, deploymentProjectSettings } = {}) {
  const f = fixture(t), events = [], admitted = (() => {
    if(production)asRelease(f);
    if (native) delete f.manifest.verification.vercelSourceTransport;
    const preview=admitPreviewWriterFixture(f.manifest);return f.refreshSetup(production?admitProductionWriterFixture(f.manifest,{previewFixture:preview}):preview);
  })();
  const phase=production?'production.stage':'preview.create';
  const env = { ...admitted.env }, id = 'dpl_OFFLINE'; let operation, payload, discoverable = false, state = 'BUILDING', begins = 0, posts = 0, uncertainty, afterBegin;
  const registration = () => ({ release_id: f.manifest.releaseId, epoch: f.manifest.epoch, manifest_hash: digest(f.manifest), manifest: structuredClone(f.manifest) });
  const coordinator = {
    register: async () => { events.push('register'); },
    snapshot: async () => ({ status: 'active', registration: registration(), operations: operation ? { [phase]: operation } : {} }),
    begin: async value => {
      begins++; events.push('begin');
      if (operation) { assert.equal(value.requestHash, operation.request_hash); return operation.state === 'complete' ? { disposition: 'complete', evidence: operation.evidence } : { disposition: 'readback' }; }
      operation = { release_id: f.manifest.releaseId, epoch: f.manifest.epoch, phase, manifest_hash: digest(f.manifest),
        operationId: value.operationId, operation_id: value.operationId, requestHash: value.requestHash, request_hash: value.requestHash, state: 'intent' };
      afterBegin?.(); return { disposition: 'execute' };
    },
    complete: async value => { events.push('complete'); operation = { ...operation, state: 'complete', evidence: value.evidence }; },
    uncertain: async value => { events.push('uncertain'); uncertainty = value; operation = { ...operation, state: 'uncertain', evidence: value.evidence };
      if (uncertaintyThrows) throw Error(dummy); },
    readback: async value => { events.push('readback'); operation = { ...operation, state: 'complete', evidence: value.evidence }; },
    appendEvidence: async () => { events.push('append'); }
  };
  const nativeMetadata = () => ({ githubCommitRef: 'HEAD', githubCommitSha: f.manifest.candidate.sha,
    fcosHostedOperation: `${f.manifest.releaseId}-${phase.replaceAll('.','-')}`, fcosHostedManifest: digest(f.manifest), fcosSourceSha256: f.manifest.candidate.sourceSha256,
    fcosVerificationSha256: digest(f.manifest.verification), fcosConfigurationSelectionSha256: digest(selectionBuildGuard(f.manifest).nodeOptions) });
  const raw = () => ({ id, url: 'fcos-abcdef123-hocheunglai-6535s-projects.vercel.app', projectId: f.manifest.targets.vercelProject,
    ownerId: f.manifest.targets.vercelTeam, readyState: state, source: 'cli', ...(production?{target:'production'}:{}), projectSettings: deploymentProjectSettings ?? f.manifest.verification.projectSettings,
    meta: payload?.meta || nativeMetadata() });
  const fetchImpl = async (value, request = {}) => {
    const url = new URL(value), route = url.pathname; events.push(`${request.method || 'GET'} ${route}`);
    if (request.method === 'POST') {
      posts++; assert.equal(route, '/v13/deployments'); assert.equal(url.searchParams.get('teamId'), f.manifest.targets.vercelTeam);
      assert.equal(request.redirect, 'error'); payload = JSON.parse(request.body); assert.equal(payload.project, f.manifest.targets.vercelProject);
      if (outcome === 'lost') throw Error(`Bearer ${dummy}`);
      if (outcome === '500') return new Response(dummy, { status: 500 });
      return Response.json(raw());
    }
    if (route === '/v2/user') return new Response('', { status: 404 });
    if (route.startsWith('/v2/teams/')) return new Response('', { status: 403 });
    if (route === '/v9/projects') return Response.json({ projects: [{ id: f.project.id }], pagination: { count: 1, next: null } });
    if (route === '/v1/env') return Response.json({ data: [], pagination: { count: 0, next: null } });
    if (route.endsWith('/env')) return Response.json({ envs: [], pagination: { count: 0, next: null } });
    if (route === '/v6/deployments') return Response.json({ deployments: discoverable ? [{ uid: id, meta: raw().meta }] : [], pagination: { next: null } });
    if (route === `/v13/deployments/${id}`) return Response.json(raw());
    if (route.endsWith('/events')) return Response.json([{ text: 'Running "vercel build"' }, { text: 'Running "install" command: `npm ci`...' },
      { text: selectionBuildGuard(f.manifest).proof }, { text: '> fixture build' }]);
    if (url.host.endsWith('.vercel.app')) return new Response('', { status: 503 });
    assert.equal(route, `/v9/projects/${f.project.id}`); return Response.json(f.project);
  };
  return { ...f, env, events, coordinator, raw, fetchImpl,
    adapter: () => createVercelAdapter({ manifest: f.manifest, candidateDirectory: f.directory, env, fetchImpl, coordinator,
      execute: (_, args) => { assert.deepEqual(args.slice(0, 1), ['--version']); return '54.20.1'; } }),
    get operation() { return operation; }, set operation(value) { operation = value; }, get posts() { return posts; }, get begins() { return begins; },
    get uncertainty() { return uncertainty; }, set afterBegin(value) { afterBegin = value; },
    discover() { discoverable = true; }, ready() { state = 'READY'; },
    seedOriginalUnknown() { const operationId = `${f.manifest.releaseId}-preview-create`, requestHash = digest({ candidate: f.manifest.candidate, target: 'preview' });
      operation = { release_id: f.manifest.releaseId, epoch: f.manifest.epoch, phase, manifest_hash: digest(f.manifest),
        operationId, operation_id: operationId, requestHash, request_hash: requestHash, state: 'uncertain' }; }
  };
}

test('controller prepares admitted archive before intent, cold project scope sends one POST, completes ACK before separate READY read', async t => {
  const f = integrated(t), result = await preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() });
  assert.equal(result.status, 'waiting_dependency'); assert.equal(f.begins, 1); assert.equal(f.posts, 1);
  const post = f.events.indexOf('POST /v13/deployments'), complete = f.events.indexOf('complete'), ready = f.events.indexOf('GET /v13/deployments/dpl_OFFLINE');
  assert.equal(post > f.events.indexOf('begin'), true); assert.equal(complete > post, true); assert.equal(ready > complete, true);
  assert.equal(f.operation.evidence.result.sourceApi.kind, SOURCE_API_TRANSPORT); assert.equal(f.operation.evidence.result.sourceApi.sourceBuildReadyProven, false);
  assert.equal(Object.hasOwn(f.operation.evidence.result, 'sourceDeploy'), false);
  assert.equal(f.operation.request_hash, f.operation.evidence.result.sourceApi.requestHash);
});

test('bad hosted context, credential and source reject before any intent or POST', async t => {
  for (const change of [f => { f.env.GITHUB_REF_PROTECTED = 'false'; }, f => { f.env.FCOS_HOSTED_VERCEL_TOKEN = dummy; },
    f => { writeFileSync(join(f.directory, 'package.json'), '{}\n'); }]) {
    const f = integrated(t); change(f);
    await assert.rejects(preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() }));
    assert.equal(f.begins, 0); assert.equal(f.posts, 0);
  }
});

test('final source and credential guards after the claim prevent POST without releasing the consumed intent', async t => {
  for (const change of [f => { f.env.FCOS_HOSTED_VERCEL_TOKEN = dummy; }, f => { writeFileSync(join(f.directory, 'new-source.js'), 'changed'); }]) {
    const f = integrated(t); f.afterBegin = () => change(f);
    await assert.rejects(preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() }), /PROVIDER_OUTCOME_UNKNOWN/);
    assert.equal(f.begins, 1); assert.equal(f.posts, 0); assert.equal(f.operation.state, 'uncertain');
  }
});

test('lost/500 submissions stop without inline discovery and preserve sealed diagnostics when uncertainty RPC throws', async t => {
  for (const outcome of ['lost', '500']) for (const uncertaintyThrows of [false, true]) {
    const f = integrated(t, { outcome, uncertaintyThrows }); let caught;
    try { await preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() }); } catch (error) { caught = error; }
    assert.equal(f.posts, 1); assert.equal(f.operation.state, 'uncertain');
    const later = f.events.slice(f.events.indexOf('POST /v13/deployments') + 1);
    assert.deepEqual(later, ['uncertain']); assert.equal(f.uncertainty.evidence.sourceApiFailure.outcome, 'unknown');
    assert.deepEqual(safeFailure(caught).sourceApiFailure, f.uncertainty.evidence.sourceApiFailure);
    assert.equal(JSON.stringify(safeFailure(caught)).includes(dummy), false);
  }
});

test('separate archive recovery reconstructs exact old request hash and performs GET-only readback without resubmission', async t => {
  const f = integrated(t, { outcome: 'lost' });
  await assert.rejects(preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() }), /PROVIDER_OUTCOME_UNKNOWN/);
  const originalHash = f.operation.request_hash; f.discover(); f.events.length = 0;
  const snapshot = await reconcilePending({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() });
  assert.equal(f.posts, 1); assert.equal(f.events.some(event => event.startsWith('POST')), false);
  assert.equal(f.events.includes('begin'), false); assert.equal(f.operation.request_hash, originalHash);
  assert.equal(snapshot.operations['preview.create'].evidence.result.sourceApi.acknowledgement, 'authenticated_provider_owner_readback');
});

test('original CLI consumed operation retains original request hash and GET-only recovery under the new controller', async t => {
  const f = integrated(t, { native: true }); f.seedOriginalUnknown(); const originalHash = f.operation.request_hash;
  f.discover(); const result = await preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider: f.adapter() });
  assert.equal(result.status, 'waiting_dependency'); assert.equal(f.operation.request_hash, originalHash); assert.equal(f.posts, 0);
  assert.equal(f.operation.evidence.result.sourceApi, undefined);
});

test('archive READY requires actual metadata, consumed REST receipt and ordered provider build logs without a fabricated CLI ACK', async t => {
  const f = integrated(t), provider = f.adapter(); await preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider }); f.ready();
  await assert.rejects(provider.verifyArtifact({ id: 'dpl_OFFLINE' }, f.manifest, 'preview'), { code: 'ARTIFACT_READ_FAILED' });
  const saved = structuredClone(f.operation);
  for (const mutate of [o => { o.evidence.result.sourceApi.bodySha256 = H; }, o => { o.evidence.result.sourceApi.archive.sha256 = H; },
    o => { o.evidence.result.sourceApi.inventorySha256 = H; }, o => { o.evidence.result.sourceApi.cliVersion = '54.20.1'; }]) {
    f.operation = structuredClone(saved); mutate(f.operation);
    await assert.rejects(provider.verifyArtifact({ id: 'dpl_OFFLINE' }, f.manifest, 'preview'), /SOURCE_BUILD_UNPROVEN/);
  }
  assert.equal(f.posts, 1);
});

test('READY keeps project-default snapshot strict while separate native build evidence requires the effective npm ci command', async t => {
  const f = integrated(t), provider = f.adapter(); await preparePreview({ manifest: f.manifest, coordinator: f.coordinator, provider }); f.ready();
  assert.equal(f.raw().projectSettings.installCommand, 'npm install');
  await assert.rejects(provider.verifyArtifact({ id: 'dpl_OFFLINE' }, f.manifest, 'preview'), { code: 'ARTIFACT_READ_FAILED' });
  assert.equal(f.events.some(event => event.includes('/events')), true);
  const changed = integrated(t, { deploymentProjectSettings: { ...f.manifest.verification.projectSettings, installCommand: 'npm ci' } }), changedProvider = changed.adapter();
  await preparePreview({ manifest: changed.manifest, coordinator: changed.coordinator, provider: changedProvider }); changed.ready();
  await assert.rejects(changedProvider.verifyArtifact({ id: 'dpl_OFFLINE' }, changed.manifest, 'preview'), { code: 'VERCEL_BUILD_CONFIGURATION_CHANGED' });
  assert.equal(changed.events.some(event => event.includes('/events')), false);
});

function asRelease(f) {
  f.manifest.stage='application';f.manifest.executionMode='release';
  f.manifest.scope.compatibilityProductionObservationSha256=H;
  f.manifest.scope.handoffs=[{kind:'status19',sha256:H},{kind:'supplier16',sha256:H}];
  f.manifest.requiredChecks.push('compatibility_production_observation');
  return f;
}
function staged(f) { return {id:'dpl_OFFLINE',sha:f.manifest.candidate.sha,sourceSha256:f.manifest.candidate.sourceSha256,
  target:'production',state:'READY',projectId:f.manifest.targets.vercelProject,teamId:f.manifest.targets.vercelTeam,manifestHash:digest(f.manifest)}; }
function action(f,phase='production.promote',extra={}) { return prepareVercelProjectActionRequest({manifest:f.manifest,candidateDirectory:f.directory,
  phase,operationId:`${f.manifest.releaseId}-${phase.replaceAll('.','-')}`,staged:staged(f),...extra}); }
function compatible(f) {return {compatible:true,deploymentId:f.manifest.previousProduction.deploymentId,schemaSha256:f.manifest.migration.expectedSchemaSha256,runtimeSha256:f.manifest.runtime.expectedSha256};}

test('qualification still cannot acquire Production authority or prepare aliases',async t=>{
  const f=integrated(t),provider=f.adapter();
  await assert.rejects(provider.admit(f.manifest,'production.stage'),/SOURCE_API_PRODUCTION_CONTEXT/);
  assert.throws(()=>action(f),/SOURCE_API_ACTION_CONTEXT/);
  f.env.FCOS_HOSTED_CREDENTIAL_CLASS='production';assert.throws(()=>provider.assertWriteCapability());
  assert.equal(f.posts,0);assert.equal(f.begins,0);
});

test('Production stage prepares exact archive and alias hold before intent; cold restricted scope creates once with no follow-on GET',async t=>{
  const f=integrated(t,{production:true}),provider=f.adapter();
  await provider.admit(f.manifest,'production');
  const request=await provider.prepareStageRequest(f.manifest,{operationId:`${f.manifest.releaseId}-production-stage`});
  assert.equal(f.begins,0);assert.equal(f.posts,0);assert.equal(request.skipDomain,true);assert.equal(request.target,'production');
  f.events.length=0;
  const result=await consequential({manifest:f.manifest,coordinator:f.coordinator,phase:'production.stage',request,submit:context=>provider.stage(f.manifest,context)});
  assert.equal(result.target,'production');assert.equal(result.sourceApi.phase,'production.stage');assert.equal(result.sourceApi.requestHash,digest(request));
  assert.deepEqual(f.events,['begin','POST /v13/deployments','complete']);
  const prepared=await f.prepare({phase:'production.stage',operationId:`${f.manifest.releaseId}-production-stage`}),body=JSON.parse(prepared.body);
  assert.equal(body.target,'production');assert.equal(body.autoAssignCustomDomains,false);assert.equal(Object.hasOwn(body.env,'FCOS_ENABLE_READ_ONLY_CI'),false);
  assert.equal(body.env.FCOS_BUILD_COMMIT_SHA,f.manifest.candidate.sha);assert.equal(body.build.env.NODE_OPTIONS,selectionBuildGuard(f.manifest).nodeOptions);
  assert.equal(Object.hasOwn(body,'projectSettings'),false);assert.equal(body.installCommand,'npm ci');assert.equal(f.project.installCommand,'npm install');
});

test('Production credential/source/context final refusals prevent POST without converting intent into a retry',async t=>{
  for(const change of [f=>{f.env.FCOS_HOSTED_CREDENTIAL_CLASS='preview';},f=>{f.env.FCOS_HOSTED_VERCEL_TOKEN=dummy;},
    f=>{f.env.GITHUB_REF='refs/heads/other';},f=>{writeFileSync(join(f.directory,'package.json'),'{}');}]){
    const f=integrated(t,{production:true}),provider=f.adapter();await provider.admit(f.manifest,'production');
    const request=await provider.prepareStageRequest(f.manifest,{operationId:`${f.manifest.releaseId}-production-stage`});change(f);
    await assert.rejects(consequential({manifest:f.manifest,coordinator:f.coordinator,phase:'production.stage',request,submit:context=>provider.stage(f.manifest,context)}),/PROVIDER_OUTCOME_UNKNOWN/);
    assert.equal(f.posts,0);assert.equal(f.operation.state,'uncertain');
  }
});

test('Production archive READY proof binds stage receipt and native build logs with no fabricated CLI argv',async t=>{
  const f=integrated(t,{production:true}),provider=f.adapter();await provider.admit(f.manifest,'production');
  const request=await provider.prepareStageRequest(f.manifest,{operationId:`${f.manifest.releaseId}-production-stage`});
  await consequential({manifest:f.manifest,coordinator:f.coordinator,phase:'production.stage',request,submit:context=>provider.stage(f.manifest,context)});f.ready();
  await assert.rejects(provider.verifyArtifact({id:'dpl_OFFLINE'},f.manifest,'staged'),{code:'ARTIFACT_READ_FAILED'});
  assert.equal(f.events.some(e=>e.includes('/events')),true);
  f.operation=structuredClone(f.operation);f.operation.evidence.result.sourceApi.target='preview';
  await assert.rejects(provider.verifyArtifact({id:'dpl_OFFLINE'},f.manifest,'staged'),/SOURCE_BUILD_UNPROVEN/);
});

test('separate Production archive recovery preserves original hash and performs only GETs',async t=>{
  const f=integrated(t,{production:true,outcome:'lost'}),provider=f.adapter();await provider.admit(f.manifest,'production');
  const request=await provider.prepareStageRequest(f.manifest,{operationId:`${f.manifest.releaseId}-production-stage`});
  await assert.rejects(consequential({manifest:f.manifest,coordinator:f.coordinator,phase:'production.stage',request,submit:context=>provider.stage(f.manifest,context)}),/PROVIDER_OUTCOME_UNKNOWN/);
  const hash=f.operation.request_hash;f.discover();f.events.length=0;
  await reconcilePending({manifest:f.manifest,coordinator:f.coordinator,provider:f.adapter()});
  assert.equal(f.posts,1);assert.equal(f.operation.request_hash,hash);assert.equal(f.events.some(e=>e==='begin'||e.startsWith('POST')),false);
  assert.equal(f.operation.evidence.result.sourceApi.target,'production');
});

test('exact promote and rollback prepared bodies use only native fixed endpoints and receipts do not claim applied',async t=>{
  const f=integrated(t,{production:true});
  for(const phase of ['production.promote','production.rollback']){
    const p=action(f,phase,{compatible:compatible(f)});let calls=0;
    const result=await executeVercelProjectActionRequest({...options(f,p),fetchImpl:async(url,request)=>{calls++;assert.equal(new URL(url).origin,'https://api.vercel.com');
      assert.equal(new URL(url).pathname,phase==='production.promote'?`/v10/projects/${f.project.id}/promote/dpl_OFFLINE`:`/v9/projects/${f.project.id}/rollback/${f.manifest.previousProduction.deploymentId}`);
      assert.equal(new URL(url).searchParams.get('teamId'),f.manifest.targets.vercelTeam);assert.equal(request.body,'{}');assert.equal(request.redirect,'error');return new Response(null,{status:204});}});
    assert.equal(calls,1);assert.equal(result.accepted,true);assert.equal(result.sourceAction.appliedProven,false);assert.equal(result.sourceAction.requestHash,digest(p.intent));
    assert.equal(JSON.stringify(result).includes(dummy),false);
    await assert.rejects(executeVercelProjectActionRequest(options(f,p)),/SOURCE_API_ACTION_CONTEXT/);
  }
});

test('Preview/custom/wrong-project stage and incompatible rollback reject before fetch or any rebuild fallback',async t=>{
  const f=integrated(t,{production:true});
  for(const change of [{target:'preview'},{target:'custom'},{state:'ERROR'},{projectId:'other'},{manifestHash:H}])
    assert.throws(()=>action(f,'production.promote',{staged:{...staged(f),...change}}),/STAGED_IDENTITY/);
  for(const change of [{compatible:false},{deploymentId:'dpl_other'},{schemaSha256:'b'.repeat(64)}])
    assert.throws(()=>action(f,'production.rollback',{compatible:{...compatible(f),...change}}),/ROLLBACK_COMPATIBILITY/);
});

test('each project-action 500/redirect/lost/queued202 result is consumed UNKNOWN with one POST and no following GET',async t=>{
  const f=integrated(t,{production:true});
  for(const phase of ['production.promote','production.rollback'])for(const outcome of ['500','redirect','lost','queued']){
    const p=action(f,phase,{compatible:compatible(f)}),calls=[];let caught;
    try{await executeVercelProjectActionRequest({...options(f,p),fetchImpl:async(url,request)=>{calls.push(request.method);
      if(outcome==='lost')throw Error(dummy);return new Response(dummy,{status:outcome==='500'?500:outcome==='redirect'?307:202});}});}catch(e){caught=e;}
    assert.deepEqual(calls,['POST']);assert.equal(caught.detail.sourceApiFailure.phase,phase);assert.equal(caught.detail.sourceApiFailure.outcome,'unknown');
    assert.equal(safeFailure(caught).sourceApiFailure.reason,outcome==='queued'?'QUEUED':outcome==='lost'?'TRANSPORT_ERROR':outcome==='redirect'?'REDIRECT':'HTTP_ERROR');
    assert.equal(JSON.stringify(safeFailure(caught)).includes(dummy),false);
  }
});

test('project-action timeout aborts once and context/refusal paths issue zero calls',async t=>{
  const f=integrated(t,{production:true}),p=action(f);let calls=0,signal;
  await assert.rejects(executeVercelProjectActionRequest({...options(f,p),timeoutMs:5,fetchImpl:async(_,r)=>{calls++;signal=r.signal;return new Promise(()=>{});}}),/OUTCOME_UNKNOWN/);
  assert.equal(calls,1);assert.equal(signal.aborted,true);
  for(const change of [{context:{operationId:p.receipt.operationId,request:{wrong:true}}},{assertWriteContext:()=>{throw Error(dummy);}}]){
    const fresh=action(f);await assert.rejects(executeVercelProjectActionRequest({...options(f,fresh),...change,fetchImpl:async()=>{calls++;}}));
  }assert.equal(calls,1);
});


test('Production stage rejects Preview ACK and preserves known ERROR as a created deployment, not READY',async t=>{
  const f=integrated(t,{production:true});
  for(const outcome of ['preview','ERROR']){
    const p=await f.prepare({phase:'production.stage',operationId:`${f.manifest.releaseId}-production-stage`});let calls=0;
    const run=executeVercelSourceApiRequest({...options(f,p),fetchImpl:async()=>{calls++;return Response.json(ack(p,{target:outcome==='preview'?'preview':'production',readyState:outcome==='ERROR'?'ERROR':'BUILDING'}));}});
    if(outcome==='preview')await assert.rejects(run,/OUTCOME_UNKNOWN/);else {const result=await run;assert.equal(result.state,'ERROR');assert.equal(result.sourceApi.sourceBuildReadyProven,false);}
    assert.equal(calls,1);
  }
});

test('Production stage HTTP/redirect/lost ACK failures retain phase diagnostics and do not read after submission',async t=>{
  for(const outcome of ['500','redirect','lost']){
    const f=integrated(t,{production:true}),p=await f.prepare({phase:'production.stage',operationId:`${f.manifest.releaseId}-production-stage`}),calls=[];let caught;
    try{await executeVercelSourceApiRequest({...options(f,p),fetchImpl:async(_,r)=>{calls.push(r.method);if(outcome==='lost')throw Error(dummy);return new Response(dummy,{status:outcome==='500'?500:307});}});}catch(e){caught=e;}
    assert.deepEqual(calls,['POST']);assert.equal(safeFailure(caught).sourceApiFailure.phase,'production.stage');assert.equal(JSON.stringify(safeFailure(caught)).includes(dummy),false);
  }
});

test('adapter alias submission requires preparation/exact Production credential and has no implicit reads after its known ACK',async t=>{
  const f=integrated(t,{production:true}),posts=[];
  const provider=createVercelAdapter({manifest:f.manifest,candidateDirectory:f.directory,env:f.env,coordinator:f.coordinator,fetchImpl:async(url,r={})=>{
    if(r.method==='POST'){posts.push(new URL(url).pathname);assert.equal(r.body,'{}');return new Response(null,{status:204});}return f.fetchImpl(url,r);}});
  await provider.admit(f.manifest,'production.promote');
  const operationId=`${f.manifest.releaseId}-production-promote`;
  await assert.rejects(provider.promote(staged(f),{operationId,request:{}}),/ACTION_CONTEXT/);assert.equal(posts.length,0);
  const request=provider.preparePromoteRequest(f.manifest,{operationId,staged:staged(f)});f.events.length=0;
  const result=await provider.promote(staged(f),{operationId,request});assert.equal(result.sourceAction.appliedProven,false);assert.equal(posts.length,1);assert.deepEqual(f.events,[]);
  const operationRollback=`${f.manifest.releaseId}-production-rollback`,rollbackRequest=provider.prepareRollbackRequest(f.manifest,{operationId:operationRollback,staged:staged(f),compatible:compatible(f)});
  f.env.FCOS_HOSTED_CREDENTIAL_CLASS='preview';await assert.rejects(provider.rollback(f.manifest.previousProduction,{operationId:operationRollback,request:rollbackRequest}),/WRITER_CONTEXT/);assert.equal(posts.length,1);
});

test('current Production is canonical alias-bound even when project target metadata points at a staged build',async t=>{
  const f=integrated(t,{production:true});let wrong=false;const reads=[];
  const provider=createVercelAdapter({manifest:f.manifest,candidateDirectory:f.directory,env:f.env,fetchImpl:async(url,r={})=>{
    const path=new URL(url).pathname;reads.push(path);
    if(path.startsWith('/v4/aliases/'))return Response.json({alias:new URL(f.manifest.targets.productionOrigin).hostname,projectId:wrong?'other':f.project.id,
      deploymentId:'dpl_actual',deployment:{id:'dpl_actual',url:'fcos-actual123-hocheunglai-6535s-projects.vercel.app'}});
    if(path==='/v13/deployments/dpl_actual')return Response.json({...f.raw(),readyState:'READY',id:'dpl_actual',url:'fcos-actual123-hocheunglai-6535s-projects.vercel.app',meta:{githubCommitSha:f.manifest.previousProduction.sha}});
    if(path===`/v9/projects/${f.project.id}`)return Response.json({...f.project,targets:{production:{id:'dpl_staged'}}});
    return f.fetchImpl(url,r);}});
  const current=await provider.currentProduction();assert.equal(current.id,'dpl_actual');assert.equal(current.sha,f.manifest.previousProduction.sha);
  wrong=true;reads.length=0;await assert.rejects(provider.currentProduction(),/PRODUCTION_ALIAS_BINDING/);assert.equal(reads.includes('/v13/deployments/dpl_actual'),false);
});


test('alias recovery validates original authenticated journal request before owner GET and never invents a POST ACK',async t=>{
  const f=integrated(t,{production:true}),provider=f.adapter();
  const prepared=await f.prepare({phase:'production.stage',operationId:`${f.manifest.releaseId}-production-stage`});
  const sourceStage=await executeVercelSourceApiRequest({...options(f,prepared),fetchImpl:async()=>Response.json(ack(prepared,{target:'production'}))});
  const registration={release_id:f.manifest.releaseId,epoch:f.manifest.epoch,manifest_hash:digest(f.manifest),manifest:f.manifest};
  for(const phase of ['production.promote','production.rollback']){
    const p=action(f,phase,{compatible:compatible(f)}),operation={operationId:p.receipt.operationId,operation_id:p.receipt.operationId,phase,
      release_id:f.manifest.releaseId,epoch:f.manifest.epoch,manifest_hash:digest(f.manifest),requestHash:digest(p.intent),request_hash:digest(p.intent),state:'uncertain'};
    f.events.length=0;
    const receipt=provider.verifyProjectActionRecoveryRequest(f.manifest,{phase,operation,registration,staged:sourceStage});
    assert.deepEqual(f.events,[]);assert.equal(receipt.requestHash,digest(p.intent));assert.equal(receipt.acknowledgement,'authenticated_provider_owner_readback');
    assert.equal(Object.hasOwn(receipt,'status'),false);assert.equal(receipt.appliedProven,false);
    for(const change of [{request_hash:H},{operation_id:'another'},{state:'complete'}])
      assert.throws(()=>provider.verifyProjectActionRecoveryRequest(f.manifest,{phase,operation:{...operation,...change},registration,staged:sourceStage}),/ACTION_RECOVERY_REQUEST/);
    assert.throws(()=>provider.verifyProjectActionRecoveryRequest(f.manifest,{phase,operation,registration,staged:{...sourceStage,sourceApi:undefined}}),/ACTION_RECOVERY_REQUEST/);
    assert.deepEqual(f.events,[]);
  }
});


test('project action rechecks operation binding after its synchronous final guard and rejects unbounded/unknown ACKs',async t=>{
  const f=integrated(t,{production:true});let calls=0;
  const p=action(f),context={operationId:p.receipt.operationId,request:p.intent};
  await assert.rejects(executeVercelProjectActionRequest({...options(f,p),context,assertWriteContext:()=>{context.operationId='other';},fetchImpl:async()=>{calls++;}}),/ACTION_CONTEXT/);
  assert.equal(calls,0);
  for(const response of [()=>new Response('x'.repeat(128*1024+1),{status:200}),()=>new Response('',{status:206})]){
    const prepared=action(f);await assert.rejects(executeVercelProjectActionRequest({...options(f,prepared),fetchImpl:async()=>{calls++;return response();}}),e=>e.detail.sourceApiFailure.reason==='ACK_INVALID');
  }assert.equal(calls,2);
});
