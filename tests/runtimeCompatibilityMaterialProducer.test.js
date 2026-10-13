import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vm from 'node:vm';
import { githubReleaseReads, assertProtectedDefault, assertReleaseGitHubAccount, RELEASE_REPOSITORY } from '../scripts/lib/release-evidence.mjs';
import { githubReleaseOidc } from '../scripts/lib/release-production.mjs';
import * as transport from '../scripts/lib/runtime-compatibility-material-transport.mjs';
import { materialTransportFixture, materialZip } from './helpers/runtimeMaterialTransport.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const producerPath = join(sourceRoot, 'scripts/runtime-compatibility-materials.mjs');
const secret = 'SYNTHETIC_PRIVATE_TOKEN_DO_NOT_EMIT';
const expected = { harnessSha: 'a'.repeat(40), sha: 'b'.repeat(40), sourceDigest: 'c'.repeat(64),
  lockHash: 'd'.repeat(64), candidateTreeHash: 'e'.repeat(64), previewControlRevision: 'f'.repeat(64), configurationRevision: '1'.repeat(64), runId: 99 };
const markerText = 'data-only immutable material upload attempted\n';

// The discovery wrapper adds the VM flag to this child only. No real process
// credentials, preload settings, provider transports or hosted authority enter
// the child. The actual producer sees an independently mocked native argv.
if (typeof vm.SourceTextModule !== 'function') {
  test('actual runtime material producer executes the local synthetic flow suite', t => {
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)], {
      cwd: sourceRoot, env: { PATH: process.env.PATH, HOME: tmpdir(), NODE_NO_WARNINGS: '1' },
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.diagnostic(result.stdout || 'No inner TAP emitted.');
    if (result.stderr) t.diagnostic(result.stderr);
    assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, 0);
    for (const line of ['# tests 23', '# pass 23', '# fail 0', '# skipped 0', '# todo 0']) assert.ok(result.stdout.split(/\r?\n/).includes(line), `Missing inner result: ${line}`);
  });
} else {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-offline-key', alg: 'RS256', use: 'sig' };
  const record = value => { const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); return { body, value, sha256: transport.runtimeMaterialHash(body) }; };

  // This is a control-flow test, not a replacement for source/material-review
  // validation. Those two dependencies are explicitly synthetic and confer no
  // authority. Collection, OIDC signature verification, pack parsing, payload,
  // original-clock validation and artifact reconciliation use actual helpers.
  async function harness({ fault, workflow = 'preview-email-proof-build.yml', runner, nativeEntry = false } = {}) {
    const temporary = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'fcos-material-producer-test-')));
    const workspace = join(temporary, 'workspace'), normal = workflow === 'runtime-compatibility-normal-role.yml';
    const trusted = normal ? workspace : join(workspace, 'trusted'), candidate = normal ? trusted : join(workspace, 'candidate');
    const ownRunner = runner || join(temporary, 'runner');
    for (const directory of [join(trusted, 'scripts'), candidate, ownRunner]) fs.mkdirSync(directory, { recursive: true });
    const filename = join(trusted, 'scripts/runtime-compatibility-materials.mjs');
    fs.writeFileSync(filename, fs.readFileSync(producerPath));
    const actionDirectory = join(trusted, '.github/actions/runtime-compatibility-materials');
    fs.mkdirSync(actionDirectory, { recursive: true });
    const descriptor = fs.readFileSync(join(sourceRoot, '.github/actions/runtime-compatibility-materials/action.yml'), 'utf8');
    fs.writeFileSync(join(actionDirectory, 'action.yml'), descriptor);
    assert.match(descriptor, /\n  using: node24\n/);
    const actionMain = resolve(actionDirectory, /^  main: (.+)$/m.exec(descriptor)[1]);
    assert.equal(actionMain, filename);
    const now = Date.now(), iso = delta => new Date(now + delta).toISOString();
    const rows = { context: record({ synthetic: true, provisionedAt: iso(-60000), retainedId: 'FIXTURE_ONLY' }),
      root: record({ synthetic: true, role: 'root', reviewedAt: iso(-30000) }),
      independent: record({ synthetic: true, role: 'independent', reviewedAt: iso(fault === 'expires_after_marker' ? -1790000 : -40000) }) };
    const fixture = materialTransportFixture({ expected, rows, workflow: `.github/workflows/${workflow}`, now });
    Object.assign(fixture.jobs[0].steps[0], { status: 'in_progress', conclusion: null, completed_at: null });
    fixture.artifacts = [];
    const originalText = fixture.variables.find(row => row.name === transport.RUNTIME_MATERIAL_INPUT).value;
    const state = { now, fixture, rows, originalText, uploads: [], calls: [], fetches: [], directories: [], materialChecks: [],
      deadlines: [], stdout: [], stderr: [], marker: join(ownRunner, 'fcos-runtime-material-publication-99.lock') };
    const processMock = { env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: RELEASE_REPOSITORY, GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '99',
      GITHUB_JOB: normal ? 'compatibility-normal-role' : workflow === 'runtime-compatibility-release.yml' ? 'preflight' : 'proof',
      FCOS_E2E_EXPECTED_COMMIT: expected.sha, GH_TOKEN: secret, HOME: temporary, GITHUB_WORKSPACE: workspace,
      FCOS_RELEASE_SOURCE_DIRECTORY: candidate, FCOS_RUNTIME_MATERIAL_OPERATION: 'create', RUNNER_TEMP: ownRunner,
      ACTIONS_RUNTIME_TOKEN: secret, ACTIONS_RESULTS_URL: `https://synthetic.results.invalid/private/${secret}`,
      ACTIONS_ID_TOKEN_REQUEST_URL: `https://synthetic.actions.githubusercontent.com/token?private=${secret}`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: secret }, argv: nativeEntry ? ['/synthetic/node24/bin/node', actionMain] : [], execArgv: [], exitCode: 0,
      stdout: { write: bytes => { state.stdout.push(String(bytes)); return true; } },
      stderr: { write: bytes => { state.stderr.push(String(bytes)); return true; } } };
    if (fault === 'missing_runtime_token') delete processMock.env.ACTIONS_RUNTIME_TOKEN;
    if (fault === 'empty_runtime_token') processMock.env.ACTIONS_RUNTIME_TOKEN = '';
    if (fault === 'missing_results_url') delete processMock.env.ACTIONS_RESULTS_URL;
    if (fault === 'empty_results_url') processMock.env.ACTIONS_RESULTS_URL = '';
    if (fault === 'native_extra_argument') processMock.argv.push('--unreviewed');
    if (fault === 'native_exec_argument') processMock.execArgv.push('--inspect');
    if (fault === 'native_wrong_source_path') processMock.env.FCOS_RELEASE_SOURCE_DIRECTORY = trusted;
    if (fault === 'native_wrong_workspace') processMock.env.GITHUB_WORKSPACE = temporary;
    const stdout = processMock.stdout.write, stderr = processMock.stderr.write;
    const consoleMock = { log: (...args) => processMock.stdout.write(`${args.map(String).join(' ')}\n`),
      error: (...args) => processMock.stderr.write(`${args.map(String).join(' ')}\n`) };
    const failCli = (classification = '403') => {
      const stderr = classification === 'oversized' ? `${'\u00e9'.repeat(4097)} PRIVATE_BODY ${secret} (HTTP 403)`
        : classification === 'unrecognized' ? `gh: PRIVATE_BODY ${secret} denial without an HTTP status\n`
          : `gh: PRIVATE_BODY ${secret} (HTTP ${classification === '404' ? 404 : 403})\n`;
      // JSON GETs set encoding:utf8, so real execFileSync failures carry string
      // stdout/stderr. Retain one Buffer case for the binary-adapter boundary.
      throw Object.assign(new Error(`SYNTHETIC_RAW_ERROR ${secret}`), { status: 1,
        stdout: `PRIVATE_RESPONSE ${secret}`, stderr: classification === 'buffer403' ? Buffer.from(stderr) : stderr });
    };
    const execute = (command, args, options) => {
      assert.equal(command, '/usr/bin/gh'); assert.equal(args[0], 'api'); assert.deepEqual(Array.from(args.slice(2)), ['--method', 'GET']);
      assert.equal(options.cwd, trusted); assert.equal(options.env.GH_REPO, RELEASE_REPOSITORY); assert.equal(options.env.GH_HOST, 'github.com');
      assert.equal(options.env.GH_TOKEN, secret); assert.equal(options.timeout, 30000); assert.equal(options.maxBuffer, 4 * 1024 * 1024);
      const endpoint = args[1]; state.calls.push(endpoint);
      if (fault?.startsWith('branch_protection') && endpoint.endsWith('/branches/main/protection')) failCli(fault.slice('branch_protection_'.length) || '403');
      if (fault === 'reconciliation' && endpoint.endsWith('/actions/artifacts/101')) failCli();
      if (endpoint === 'user' && fault === 'wrong_user') return JSON.stringify({ id: 2, login: 'synthetic-wrong-operator' });
      if (endpoint.endsWith('/zip')) return fixture.reads.archive(endpoint);
      return JSON.stringify(fixture.reads.json(endpoint));
    };
    const fetchImpl = async (url, options) => {
      state.fetches.push(String(url)); assert.equal(options.redirect, 'error');
      const keys = String(url) === 'https://token.actions.githubusercontent.com/.well-known/jwks';
      if (!keys) {
        const parsed = new URL(url); assert.equal(parsed.hostname, 'synthetic.actions.githubusercontent.com');
        assert.equal(parsed.searchParams.get('audience'), 'fcos-production-release');
        assert.equal(options.headers.authorization, `Bearer ${secret}`);
      }
      if (fault === (keys ? 'oidc_keys' : 'oidc_token')) return { ok: false, status: keys ? 503 : 403, redirected: false,
        json: async () => { throw new Error(`PRIVATE_OIDC_BODY ${secret}`); } };
      if (keys) return { ok: true, status: 200, redirected: false, json: async () => ({ keys: [publicJwk] }) };
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: publicJwk.kid })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ ...fixture.oidcClaims, iat: Math.floor(state.now / 1000) })).toString('base64url');
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
      return { ok: true, status: 200, redirected: false, json: async () => ({ value: `${header}.${claims}.${signature}` }) };
    };
    const fsMock = { ...fs, mkdtempSync: prefix => { const directory = fs.mkdtempSync(prefix); state.directories.push(directory); return directory; },
      closeSync: fd => { fs.closeSync(fd); if (fault === 'expires_after_marker' && fs.existsSync(state.marker)) state.now = now + 10000; } };
    class FakeArtifactClient {
      async uploadArtifact(name, paths, directory, options) {
        assert.equal(name, transport.runtimeMaterialArtifactName(99)); assert.equal(paths.length, 1);
        assert.equal(basename(paths[0]), transport.RUNTIME_MATERIAL_FILENAME); assert.equal(paths[0], join(directory, transport.RUNTIME_MATERIAL_FILENAME));
        assert.deepEqual({ ...options }, { retentionDays: 7, compressionLevel: 0 });
        const bytes = fs.readFileSync(paths[0]); state.uploads.push({ bytes, name });
        processMock.stdout.write(`PRIVATE_SDK_STDOUT ${secret}`); processMock.stderr.write(`PRIVATE_SDK_STDERR ${secret}`);
        if (fault === 'upload') throw new Error(`PRIVATE_UPLOAD_FAILURE ${secret}`);
        const payload = JSON.parse(bytes), archive = materialZip(payload), digest = transport.runtimeMaterialHash(archive);
        fixture.archive = archive;
        fixture.artifacts = [{ id: 101, name, expired: false, digest: `sha256:${digest}`, size_in_bytes: archive.length,
          created_at: new Date(state.now).toISOString(), workflow_run: { id: 99, head_sha: expected.harnessSha, repository_id: 7, head_repository_id: 7 } }];
        return { id: 101, size: archive.length, digest };
      }
    }
    class Clock extends Date { static now() { return state.now; } }
    const context = vm.createContext({ Buffer, URL, Date: Clock, AbortSignal, setTimeout, clearTimeout, console: consoleMock,
      process: processMock, fetch: fetchImpl });
    const dependencies = {
      'node:fs': fsMock, 'node:path': await import('node:path'), 'node:os': await import('node:os'), 'node:url': await import('node:url'),
      'node:child_process': { execFileSync: execute }, '@actions/artifact': { DefaultArtifactClient: FakeArtifactClient },
      './lib/release-evidence.mjs': { githubReleaseReads, assertProtectedDefault, assertReleaseGitHubAccount, RELEASE_REPOSITORY },
      './lib/release-production.mjs': { githubReleaseOidc: args => githubReleaseOidc({ ...args, now: state.now }) },
      './lib/runtime-compatibility-successor-live.mjs': {
        SUCCESSOR_LIVE_CONTRACT: { candidateSha: expected.sha, sourceDigest: expected.sourceDigest, lockHash: expected.lockHash, candidateTreeHash: expected.candidateTreeHash },
        assertSuccessorLiveSource: value => assert.equal(value.syntheticSourceOnly, true),
        successorLiveControlBinding: value => { assert.equal(value.trustedCwd, trusted); assert.equal(value.sourceCwd, candidate);
          return { harnessSha: expected.harnessSha, previewControlRevision: expected.previewControlRevision, configurationRevision: expected.configurationRevision }; },
        assertSuccessorLiveMaterials: value => { state.materialChecks.push(value); assert.equal(value.context.body.toString(), rows.context.body.toString());
          assert.equal(value.reviews[0].body.toString(), rows.root.body.toString()); assert.equal(value.reviews[1].body.toString(), rows.independent.body.toString()); },
      },
      './verify-runtime-compatibility-successor.mjs': { verifyRuntimeCompatibilitySuccessorSource: value => {
        assert.equal(value.cwd, candidate); assert.equal(value.candidateCommit, expected.sha); return { syntheticSourceOnly: true }; } },
      './lib/runtime-compatibility-material-transport.mjs': { ...transport,
        collectRuntimeMaterialProducer: args => transport.collectRuntimeMaterialProducer({ ...args, now: state.now }),
        runtimeMaterialPayload: (text, producer) => transport.runtimeMaterialPayload(text, producer, state.now),
        assertRuntimeMaterialPublicationFresh: args => { const deadline = transport.assertRuntimeMaterialPublicationFresh(args); state.deadlines.push(deadline); return deadline; },
        reconcileRuntimeMaterialPublication: args => transport.reconcileRuntimeMaterialPublication({ ...args, now: () => state.now,
          sleep: async milliseconds => { state.now += milliseconds; } }),
      },
    };
    const cache = new Map();
    const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: pathToFileURL(filename).href,
      initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; },
      importModuleDynamically() { throw new Error('Synthetic flow must not dynamically load provider code.'); } });
    await module.link(specifier => {
      assert.ok(Object.hasOwn(dependencies, specifier), `Unstubbed producer dependency: ${specifier}`);
      if (!cache.has(specifier)) {
        const values = dependencies[specifier]; cache.set(specifier, new vm.SyntheticModule(Object.keys(values), function () {
          for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context, identifier: `synthetic:${specifier}` }));
      }
      return cache.get(specifier);
    });
    await module.evaluate();
    return { state, namespace: module.namespace, runner: ownRunner, nativeProcess: processMock,
      run: () => module.namespace.produceRuntimeCompatibilityMaterials(),
      restored: () => { assert.equal(processMock.stdout.write, stdout); assert.equal(processMock.stderr.write, stderr);
        for (const directory of state.directories) assert.equal(fs.existsSync(directory), false, 'Transient upload file was not removed.'); },
      cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }) };
  }

  function diagnostic(h, fields) {
    assert.equal(h.state.stdout.join(''), '');
    assert.equal(h.state.stderr.length, 1, 'Exactly one bounded diagnostic should be emitted.');
    const text = h.state.stderr[0]; assert.equal(text.includes(secret), false); assert.equal(text.includes('PRIVATE_'), false);
    assert.equal(text.includes('SYNTHETIC_RAW_ERROR'), false); assert.equal(text.includes('repos/'), false);
    const value = JSON.parse(text);
    assert.deepEqual(Object.keys(value).sort(), ['cliExitCode', 'httpStatus', 'kind', 'phase', 'readClass', 'schemaVersion']);
    assert.deepEqual(value, { schemaVersion: 1, kind: 'fcos_runtime_material_failure', ...fields });
    assert.ok(Buffer.byteLength(text) < 300); return value;
  }
  async function fails(h) { let rejected = false; try { await h.run(); } catch { rejected = true; } assert.equal(rejected, true); h.restored(); }

  for (const workflow of ['preview-email-proof-build.yml', 'runtime-compatibility-release.yml', 'runtime-compatibility-normal-role.yml']) {
    test(`actual producer ${workflow} uploads once and retains exact material bytes and original deadlines`, async () => {
      const h = await harness({ workflow });
      try {
        const result = await h.run(); h.restored();
        assert.equal(result.kind, 'fcos_exact04ee_runtime_material_publication'); assert.equal(result.grantsAuthority, false);
        assert.equal(h.state.uploads.length, 1); assert.equal(h.state.materialChecks.length, 2);
        assert.equal(h.state.stderr.join(''), ''); assert.equal(h.state.stdout.join(''), '');
        const payload = JSON.parse(h.state.uploads[0].bytes); assert.equal(payload.grantsAuthority, false);
        assert.equal(payload.materialPackText, h.state.originalText); assert.equal(payload.materialPackSha256, transport.runtimeMaterialHash(h.state.originalText));
        const parsed = transport.parseRuntimeMaterialPack(payload.materialPackText, payload.binding);
        for (const role of ['context', 'root', 'independent']) {
          assert.ok(parsed[role].body.equals(h.state.rows[role].body)); assert.equal(result.materialHashes[role], h.state.rows[role].sha256);
        }
        assert.equal(payload.capturedAt, new Date(h.state.now).toISOString());
        assert.equal(h.state.deadlines.length, 2); assert.deepEqual(h.state.deadlines, [h.state.fixture.oidcClaims.exp * 1000, h.state.fixture.oidcClaims.exp * 1000]);
        assert.equal(fs.readFileSync(h.state.marker, 'utf8'), markerText); assert.equal(fs.statSync(h.state.marker).mode & 0o777, 0o600);
        assert.equal(h.state.fetches.length, 4); assert.equal(h.state.calls.filter(endpoint => endpoint === 'user').length, 3);
        assert.equal(h.state.calls.filter(endpoint => endpoint.endsWith('/branches/main/protection')).length, 2);
        assert.equal(h.state.calls.filter(endpoint => endpoint.endsWith('/zip')).length, 1);
      } finally { h.cleanup(); }
    });
    test(`native node24 action entry ${workflow} resolves the original producer ROOT and exact argv`, async () => {
      const h = await harness({ workflow, nativeEntry: true });
      try {
        h.restored(); assert.equal(h.nativeProcess.exitCode, 0); assert.equal(h.nativeProcess.argv.length, 2); assert.deepEqual(h.nativeProcess.execArgv, []);
        assert.equal(h.state.uploads.length, 1); assert.equal(h.state.materialChecks.length, 2); assert.equal(h.state.stderr.join(''), '');
        const result = JSON.parse(h.state.stdout.join('')); assert.equal(result.kind, 'fcos_exact04ee_runtime_material_publication'); assert.equal(result.grantsAuthority, false);
        assert.equal(h.state.stdout.join('').includes(secret), false); assert.equal(fs.readFileSync(h.state.marker, 'utf8'), markerText);
      } finally { h.cleanup(); }
    });
  }

  for (const fault of ['missing_runtime_token', 'empty_runtime_token', 'missing_results_url', 'empty_results_url']) {
    test(`actual producer ${fault} stops before provider reads, marker or SDK upload without disclosing runtime values`, async () => {
      const h = await harness({ fault });
      try { await fails(h); assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0); assert.equal(h.state.fetches.length, 0);
        assert.equal(h.state.materialChecks.length, 0); assert.equal(h.state.directories.length, 0); assert.equal(fs.existsSync(h.state.marker), false);
        diagnostic(h, { phase: 'artifact_runtime', readClass: 'none', httpStatus: null, cliExitCode: null });
      } finally { h.cleanup(); }
    });
  }

  test('native action entry refuses extra argv, execution flags and incorrect checkout roots before reads or upload', async () => {
    for (const fault of ['native_extra_argument', 'native_exec_argument', 'native_wrong_source_path', 'native_wrong_workspace']) {
      const h = await harness({ fault, nativeEntry: true });
      try { h.restored(); assert.equal(h.nativeProcess.exitCode, 1); assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0);
        assert.equal(h.state.fetches.length, 0); assert.equal(fs.existsSync(h.state.marker), false); assert.equal(h.state.stderr.join('').includes(secret), false);
      } finally { h.cleanup(); }
    }
  });

  for (const [fault, readClass, httpStatus] of [['oidc_token', 'oidc_token', 403], ['oidc_keys', 'oidc_keys', 503]]) {
    test(`actual producer ${fault} denial emits only bounded status and performs no upload or material reads`, async () => {
      const h = await harness({ fault });
      try { await fails(h); assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0); assert.equal(fs.existsSync(h.state.marker), false);
        diagnostic(h, { phase: 'oidc', readClass, httpStatus, cliExitCode: null });
      } finally { h.cleanup(); }
    });
  }

  for (const [fault, httpStatus, label] of [['branch_protection', 403, 'string HTTP 403'], ['branch_protection_404', 404, 'string HTTP 404'],
    ['branch_protection_buffer403', 403, 'Buffer HTTP 403'], ['branch_protection_oversized', null, 'oversized stderr'],
    ['branch_protection_unrecognized', null, 'unrecognized stderr']]) {
    test(`actual producer identifies its last attempted fixed branch-protection GET with ${label} using redacted primitives`, async () => {
      const h = await harness({ fault });
      try { await fails(h); assert.equal(h.state.uploads.length, 0); assert.equal(fs.existsSync(h.state.marker), false);
        assert.equal(h.state.calls.some(endpoint => endpoint.includes('/variables')), false);
        assert.equal(h.state.calls.at(-1), `repos/${RELEASE_REPOSITORY}/branches/main/protection`);
        diagnostic(h, { phase: 'producer_authentication', readClass: 'branch_protection', httpStatus, cliExitCode: 1 });
      } finally { h.cleanup(); }
    });
  }

  test('actual producer wrong GitHub operator fails closed before repository or material reads', async () => {
    const h = await harness({ fault: 'wrong_user' });
    try { await fails(h); assert.equal(h.state.uploads.length, 0); assert.deepEqual(h.state.calls, ['user']);
      assert.equal(fs.existsSync(h.state.marker), false);
      diagnostic(h, { phase: 'producer_authentication', readClass: 'user', httpStatus: null, cliExitCode: null });
    } finally { h.cleanup(); }
  });

  test('actual producer uncertain upload attempts once and durable marker prevents another native-like invocation', async () => {
    const first = await harness({ fault: 'upload' }); let retry;
    try {
      await fails(first); assert.equal(first.state.uploads.length, 1); assert.equal(fs.readFileSync(first.state.marker, 'utf8'), markerText);
      diagnostic(first, { phase: 'artifact_upload', readClass: 'none', httpStatus: null, cliExitCode: null });
      const retained = fs.readFileSync(first.state.marker), modifiedAt = fs.statSync(first.state.marker).mtimeMs;
      retry = await harness({ runner: first.runner }); await fails(retry);
      assert.equal(retry.state.uploads.length, 0); assert.ok(fs.readFileSync(first.state.marker).equals(retained));
      assert.equal(fs.statSync(first.state.marker).mtimeMs, modifiedAt);
      diagnostic(retry, { phase: 'attempt_marker', readClass: 'none', httpStatus: null, cliExitCode: null });
    } finally { retry?.cleanup(); first.cleanup(); }
  });

  test('actual producer reconciliation read failure retains one attempted upload and marker without retry', async () => {
    const h = await harness({ fault: 'reconciliation' });
    try { await fails(h); assert.equal(h.state.uploads.length, 1); assert.equal(fs.readFileSync(h.state.marker, 'utf8'), markerText);
      assert.equal(h.state.calls.filter(endpoint => endpoint.endsWith('/actions/artifacts/101')).length, 1);
      diagnostic(h, { phase: 'artifact_reconciliation', readClass: 'artifact_metadata', httpStatus: 403, cliExitCode: 1 });
    } finally { h.cleanup(); }
  });

  test('actual producer original review deadline at upload boundary blocks upload without restamping materials or marker', async () => {
    const h = await harness({ fault: 'expires_after_marker' });
    try { await fails(h); assert.equal(h.state.uploads.length, 0); assert.equal(h.state.materialChecks.length, 2);
      assert.equal(fs.readFileSync(h.state.marker, 'utf8'), markerText);
      assert.equal(h.state.fixture.variables.find(row => row.name === transport.RUNTIME_MATERIAL_INPUT).value, h.state.originalText);
      assert.equal(h.state.rows.independent.value.reviewedAt, new Date(h.state.now - 1800000).toISOString());
      assert.deepEqual(h.state.deadlines, [h.state.now]);
      assert.ok(h.state.now < h.state.fixture.oidcClaims.exp * 1000, 'OIDC remains valid while the original review expires.');
      diagnostic(h, { phase: 'publication_freshness', readClass: 'none', httpStatus: null, cliExitCode: null });
    } finally { h.cleanup(); }
  });

  test('actual producer diagnostic serializer collapses arbitrary strings and unbounded status values', async () => {
    const h = await harness();
    try {
      const value = h.namespace.runtimeMaterialDiagnostic({ phase: secret, readClass: secret, httpStatus: `403 ${secret}`, cliExitCode: 999999,
        privateBody: secret, endpoint: `https://example.invalid/${secret}` });
      assert.deepEqual(JSON.parse(JSON.stringify(value)), { schemaVersion: 1, kind: 'fcos_runtime_material_failure',
        phase: 'unknown', readClass: 'unclassified', httpStatus: null, cliExitCode: null });
      assert.equal(JSON.stringify(value).includes(secret), false);
      for (const [endpoint, readClass] of [['user', 'user'], [`repos/${RELEASE_REPOSITORY}`, 'repository'],
        [`repos/${RELEASE_REPOSITORY}/branches/main/protection`, 'branch_protection'],
        [`repos/${RELEASE_REPOSITORY}/actions/artifacts/101/zip`, 'artifact_archive']]) assert.equal(h.namespace.runtimeMaterialReadClass(endpoint), readClass);
    } finally { h.cleanup(); }
  });
}
