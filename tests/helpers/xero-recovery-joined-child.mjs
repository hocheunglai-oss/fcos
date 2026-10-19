import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { createJoinedHostFixture } from './xero-recovery-joined-host.mjs';
import { createJoinedBrowserBoundary } from './xero-recovery-joined-browser.mjs';
import { materialZip } from './runtimeMaterialTransport.mjs';
import { FIRST_RUNTIME } from '../../scripts/lib/hosted-release/first-runtime.mjs';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { xeroHostPackageSourcePins } from '../../scripts/package-xero-recovery-host.mjs';
import { createNativeXeroRecoveryRelay, parseCourierTemplate, courierPrefix, courierPublicationStatus,
  canonicalCourierStateDirectory, nativeCourierSourcePins, FEATURES_OWNER, REPOSITORY,
  RUNTIME_MATERIAL_FILENAME, canonical, hash } from '../../scripts/lib/hosted-release/xero-recovery-native-relay.mjs';

const GUARD_SHA = '8ed4eda312b62c3b02c3a0a768ddd024a2a819af5f0f1194da47ef2a2d62fd38';
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const json = value => Response.json(value);

// The only module mocks are external browser and artifact SDK boundaries.
// Host/actor/login/protocol/SQL, package reconstruction, status validation,
// Python claim/assert, JS guards and native archive consumption remain real.
test('joined preflight succeeds once without Xero or overall release qualification', { timeout: 90000 }, async t => {
  const host = await createJoinedHostFixture(t, { planVersion: process.env.XERO_JOINED_PLAN_VERSION === '3' ? 3 : 2 });
  const v3 = process.env.XERO_JOINED_PLAN_VERSION === '3';
  const now = v3 ? Date.now : () => host.at;
  const runId = host.options.caller.runId;
  const jobId = 22;
  const lateRunway = v3 && process.env.XERO_JOINED_LATE_RUNWAY === '1';
  const jobStartedAt = host.at - (lateRunway ? 900001 : 1000);
  const browser = createJoinedBrowserBoundary({ now: host.at, id: host.binding.actorId,
    email: host.email, subject: host.subject,
    token: host.headers['x-fcos-owner-bearer'],
    providerAccessToken: host.headers['x-fcos-provider-access-token'] });
  let protectionDisposed = 0;
  mock.module('@playwright/test', { namedExports: {
    chromium: browser.options.browserType,
    request: { newContext: async () => ({
      get: async url => {
        assert.equal(url, `${FIRST_RUNTIME.previousUrl}/app-version.json`);
        return { status: () => 307, headers: () => ({ location: '/app-version.json' }) };
      },
      storageState: async () => browser.options.protectionState,
      dispose: async () => { protectionDisposed++; },
    }) },
  } });

  const controlRoot = realpathSync(mkdtempSync(join(tmpdir(), 'xero-joined-native-')));
  t.after(() => rmSync(controlRoot, { recursive: true, force: true }));
  t.after(() => mock.restoreAll());
  const gitEnvironment = { PATH: process.env.PATH, HOME: controlRoot,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Inert joined fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Inert joined fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (args, input) => {
    const value = spawnSync('/usr/bin/git', args, { cwd: controlRoot, env: gitEnvironment,
      input, encoding: 'utf8' });
    assert.equal(value.status, 0, value.stderr);
    return value.stdout.trim();
  };
  git(['init', '--initial-branch=codex/joined-fixture']);

  const caller = Object.fromEntries(Object.entries(host.options.caller)
    .filter(([key]) => !['runId', 'audience'].includes(key)));
  const sourcePins = xeroHostPackageSourcePins();
  const teamId = fcosConnectionIdentifier('vercel', 'Team ID');
  const projectId = fcosConnectionIdentifier('vercel', 'Project ID');
  const readToken = 'FIXTURE_PRIVATE_APPROVED_READ_TOKEN'.repeat(3);
  const readCredential = { bearerSha256: hash(readToken), clientId: 'cl_fixture',
    integrationId: 'oac_fixture', configurationId: 'icfg_fixture', teamId, projectId,
    scopes: ['read:deployment', 'read:integration-configuration', 'read:project'],
    issuedAt: host.at - 1000, notAfter: host.at + 3600000 };
  const readerReview = JSON.stringify({ schemaVersion: 1,
    kind: 'fcos_root_accepted_vercel_oauth_exchange', accepted: true, reviewerId: '/root',
    operator: 'hocheunglai-oss', reviewedAt: new Date(host.at).toISOString(),
    originalExchangeReceiptSha256: 'a'.repeat(64), configurationReadbackSha256: 'a'.repeat(64),
    credential: readCredential });
  const template = {
    schemaVersion: v3 ? 3 : 2, kind: `fcos_xero_recovery_carrier_template_v${v3 ? 3 : 2}`, planJson: host.planJson,
    controllerSha: caller.jobWorkflowSha, caller: { ...caller, jobName: 'xero-recovery-carrier' },
    hostConfiguration: { schemaVersion: 1, kind: 'fcos_compiled_xero_vercel_host_v1',
      target: { teamId, projectId, customEnvironment: 'fcos-xero-recovery-111111111111',
        controllerSha: caller.jobWorkflowSha, hostSourceSha256: hash(JSON.stringify(sourcePins)) },
      planJson: host.planJson, actorBinding: host.options.actorBinding,
      ownership: host.options.ownership, caller: { ...caller, runId: null },
      requestNonceSha256: host.options.requestNonceSha256 },
    readCredential: { schemaVersion: 1, kind: 'fcos_vercel_read_integration', ...readCredential,
      oauthExchangeReceiptSha256: 'a'.repeat(64), rootAcceptanceSha256: hash(readerReview) },
    readAcceptance: { vercelReadCredentialAcceptance: { json: readerReview, sha256: hash(readerReview) } },
    login: { origin: FIRST_RUNTIME.previousUrl, publicAuth: browser.publicAuth },
    issuedAt: v3 ? host.binding.preparedAt : host.binding.issuedAt, notAfter: v3 ? host.binding.absoluteNotAfter : host.binding.notAfter,
    artifactCaptureAuthoritySha256: 'b'.repeat(64),
  };
  const templateJson = JSON.stringify(template);
  const parsed = parseCourierTemplate(templateJson);
  const prefix = courierPrefix(template, runId);
  const statuses = new Map();
  const publishedRefs = new Map();
  const executionPreflightJson = canonical({ schemaVersion: 1, kind: 'fcos_xero_execution_preflight_v1', operationId: host.binding.operationId, planSha256: parsed.planSha256, preflight: browser.publicAuth.preflight });
  const locator = { schemaVersion: v3 ? 3 : 1, kind: `fcos_xero_host_locator_v${v3 ? 3 : 1}`, ...(v3 ? { executionPreflightSha256: hash(executionPreflightJson) } : {}),
    deploymentId: 'dpl_joinedfixture', url: 'https://fixed.vercel.app' };
  const makePublicCommit = (filename, raw) => {
    const blob = git(['hash-object', '-w', '--stdin'], raw);
    let treeInput = `100644 blob ${blob}\t${filename}\n`;
    if (v3 && filename === 'locator.json') { const metadataBlob = git(['hash-object','-w','--stdin'],executionPreflightJson); treeInput = `100644 blob ${metadataBlob}\texecution-preflight.json\n` + treeInput; }
    const tree = git(['mktree'], treeInput);
    return git(['commit-tree', tree], 'Inert exact public courier fixture\n');
  };
  const publishStatus = (ref, commitSha, raw, kind) => {
    const expected = courierPublicationStatus({ templateJson, runId, ref, commitSha, raw, kind });
    const value = { ...expected.body, id: statuses.size + 1,
      url: `https://api.github.com/${expected.route}`,
      creator: { id: 265701760, login: 'hocheunglai-oss' },
      created_at: new Date(host.at).toISOString(), updated_at: new Date(host.at).toISOString() };
    statuses.set(commitSha, value);
    return { expected, value };
  };
  // The already published locator is synthetic provider input in this test.
  // Its new native publication entrypoint is covered by a separate focused test.
  const locatorRaw = v3 ? canonical(locator) : JSON.stringify(locator);
  const locatorCommit = makePublicCommit('locator.json', locatorRaw);
  publishedRefs.set(`${prefix}/locator`, locatorCommit);
  publishStatus(`${prefix}/locator`, locatorCommit, locatorRaw, 'locator');

  let artifact, artifactBytes, uploadedAck;
  let releaseArtifact;
  const artifactReady = new Promise(resolve => { releaseArtifact = resolve; });
  mock.module('@actions/artifact', { namedExports: { DefaultArtifactClient: class {
    async uploadArtifact(name, paths, directory, options) {
      assert.equal(paths.length, 1);
      assert.equal(paths[0], join(directory, RUNTIME_MATERIAL_FILENAME));
      assert.deepEqual(options, { retentionDays: 7, compressionLevel: 0 });
      const exactCapturedBytes = readFileSync(paths[0]);
      uploadedAck = JSON.parse(exactCapturedBytes);
      assert.doesNotMatch(exactCapturedBytes.toString('utf8'), /FIXTURE_PRIVATE_|access_token|refresh_token|providerAccessToken|authorization|bearer/);
      // The payload comes ONLY from the carrier's actual validated HTTP result.
      artifactBytes = materialZip(undefined, { bytes: exactCapturedBytes });
      artifact = { id: 91, name, expired: false, digest: `sha256:${hash(artifactBytes)}`,
        size_in_bytes: artifactBytes.length, created_at: new Date(host.at).toISOString(),
        workflow_run: { id: Number(runId), head_sha: caller.sha,
          repository_id: 1278654816, head_repository_id: 1278654816 } };
      releaseArtifact();
      return { id: artifact.id, digest: hash(artifactBytes) };
    }
  } } });
  const { runWarmXeroRecoveryCarrier, prepareWarmXeroRecoveryCarrier, buildCourierExpectedFiles } = await import('../../scripts/hosted-xero-recovery-carrier.mjs');
  const expectedFiles = await buildCourierExpectedFiles({ t: template, runId });
  const inventory = [], sourceByUid = new Map();
  const directories = parts => {
    let rows = inventory;
    for (const name of parts) {
      let entry = rows.find(row => row.name === name);
      if (!entry) { entry = { name, type: 'directory', mode: 16749, children: [] }; rows.push(entry); }
      rows = entry.children;
    }
    return rows;
  };
  for (const file of expectedFiles) {
    const bytes = Buffer.from(file.contentBase64, 'base64'), uid = sha1(bytes);
    const parts = `src/${file.path}`.split('/');
    directories(parts.slice(0, -1)).push({ name: parts.at(-1), type: 'file', mode: 33152, uid });
    sourceByUid.set(uid, bytes);
  }
  directories(['out']).push({ name: 'xero-recovery', type: 'lambda', mode: 49590,
    uid: `${teamId}-${'f'.repeat(34)}` });

  const repository = { id: 1278654816, full_name: REPOSITORY };
  const run = { id: Number(runId), run_attempt: 1, repository, head_repository: repository,
    actor: { id: 265701760, login: 'hocheunglai-oss' }, event: 'workflow_dispatch',
    head_sha: caller.sha, head_branch: caller.ref.slice('refs/heads/'.length),
    path: '.github/workflows/authenticated-release.yml', status: 'in_progress',
    display_title: `FCOS original Xero carrier ${randomUUID()}` };
  const jobs = { total_count: 1, jobs: [{ id: jobId, run_id: Number(runId),
    name: 'xero-recovery-carrier', labels: ['ubuntu-24.04'], status: 'in_progress',
    started_at: new Date(jobStartedAt).toISOString() }] };
  if (v3) { jobs.jobs.push({ id: 21, run_id: Number(runId), name: 'xero-recovery-preparation', labels: ['ubuntu-24.04'], status: 'completed', conclusion: 'success' }); jobs.total_count = 2; }
  const githubRead = route => {
    if (route === 'user') return { id: 265701760, login: 'hocheunglai-oss' };
    if (route === `repos/${REPOSITORY}`) return repository;
    if (route.endsWith(`/actions/runs/${runId}`)) return run;
    if (route.endsWith('/attempts/1/jobs?per_page=100')) return jobs;
    if (route.endsWith('/artifacts?per_page=100')) return { total_count: artifact ? 1 : 0, artifacts: artifact ? [artifact] : [] };
    if (route.includes('/git/matching-refs/')) {
      const match = 'refs/' + route.split('/git/matching-refs/')[1];
      return [...publishedRefs].filter(([ref]) => ref.startsWith(match)).map(([ref, sha]) => ({ ref, object: { type: 'commit', sha } }));
    }
    if (route.includes('/git/ref/')) {
      const ref = 'refs/' + route.split('/git/ref/')[1], sha = publishedRefs.get(ref);
      return sha ? { ref, object: { type: 'commit', sha } } : null;
    }
    if (route.includes('/git/commits/')) {
      const sha = route.split('/').at(-1);
      assert.equal(git(['rev-list', '--parents', '-n', '1', sha]), sha);
      return { sha, parents: [], tree: { sha: git(['show', '-s', '--format=%T', sha]) } };
    }
    if (route.includes('/git/trees/')) {
      const sha = route.split('/').at(-1), rows = git(['ls-tree',sha]).split('\n').map(line => { const match = /^(\d+) (\w+) ([a-f0-9]{40})\t([^\n]+)$/.exec(line); assert.ok(match); return { mode:match[1],type:match[2],sha:match[3],path:match[4] }; });
      return { sha, truncated: false, tree: rows };
    }
    if (route.includes('/git/blobs/')) {
      const sha = route.split('/').at(-1), bytes = Buffer.from(git(['cat-file', 'blob', sha]));
      return { sha, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length };
    }
    if (route.includes('/commits/') && route.endsWith('/statuses?per_page=100')) {
      const sha = route.split('/commits/')[1].split('/')[0];
      return statuses.has(sha) ? [statuses.get(sha)] : [];
    }
    assert.fail(`Unexpected synthetic GitHub route ${route}`);
  };
  const calls = [];
  const controller = new AbortController();
  t.after(() => controller.abort());
  const hostPost = (url, init) => new Promise((resolve, reject) => {
    const request = httpsRequest({ hostname: '127.0.0.1', port: host.server.address().port,
      path: new URL(url).pathname, method: init.method, rejectUnauthorized: false,
      signal: init.signal, headers: { ...init.headers, host: 'fixed.vercel.app',
        'content-length': Buffer.byteLength(init.body) } }, response => {
      const parts = [];
      response.on('data', chunk => parts.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(parts), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject);
    request.end(init.body);
  });
  const fetchImpl = async (url, init) => {
    const u = new URL(url); calls.push({ origin: u.origin, path: u.pathname, method: init.method });
    if (u.origin === 'https://api.github.com') {
      assert.equal(init.method, 'GET');
      const value = githubRead(u.pathname.slice(1) + u.search);
      return value === null ? new Response(null, { status: 404 }) : json(value);
    }
    if (u.origin === 'https://token.actions.githubusercontent.com') return json(host.githubKeys);
    if (u.hostname === 'pipelines.actions.githubusercontent.com') return json({ value: host.headers.authorization.slice(7) });
    if (u.origin === 'https://api.vercel.com') {
      assert.equal(init.method, 'GET');
      if (u.pathname.startsWith('/v1/')) return json({ id: 'icfg_fixture', integrationId: 'oac_fixture',
        teamId, ownerId: teamId, projectSelection: 'selected', projects: [projectId], scopes: readCredential.scopes });
      if (u.pathname === '/v13/deployments/dpl_joinedfixture') return json({ id: locator.deploymentId,
        projectId, ownerId: teamId, readyState: 'READY', url: 'fixed.vercel.app',
        customEnvironment: { slug: template.hostConfiguration.target.customEnvironment } });
      if (u.pathname.endsWith('/files')) return json(inventory);
      const bytes = sourceByUid.get(u.pathname.split('/').at(-1));
      assert.ok(bytes);
      // Actual observed Vercel file-content response uses this exact envelope.
      return json({ data: bytes.toString('base64') });
    }
    if (u.origin === locator.url) { assert.equal(init.method, 'POST'); return hostPost(url, init); }
    const headers = { ...init.headers };
    if (headers.apikey === browser.publicAuth.publicAnonKey) headers.apikey = host.secret;
    return host.options.fetchImpl(url, { ...init, headers });
  };

  const stateDirectory = canonicalCourierStateDirectory(host.binding.operationId, controlRoot);
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const save = (name, value) => {
    const path = join(stateDirectory, name), bytes = JSON.stringify(value);
    writeFileSync(path, bytes, { mode: 0o600 });
    return { path, sha256: hash(bytes) };
  };
  const coordinatorRoot = join(controlRoot, 'coordinator');
  const guardPath = join(coordinatorRoot, 'features-reconciliation-owner-transition-v1/coordinator_guard.py');
  mkdirSync(dirname(guardPath), { recursive: true });
  const guardBytes = readFileSync(new URL('./xero-recovery-joined-coordinator.fixture.py', import.meta.url));
  assert.equal(hash(guardBytes), GUARD_SHA);
  writeFileSync(guardPath, guardBytes);
  const guardReview = save('synthetic-guard-source-review.json', { fixture: 'INERT_NO_LIVE_AUTHORITY' });
  const workflowPath = join(controlRoot, 'workflow.json');
  writeFileSync(workflowPath, JSON.stringify({ unifiedCoordinator: {
    epoch: 'joined-fixture-epoch', status: 'active', ownerThreadId: FEATURES_OWNER,
    reconciliationExecutionOwnerThreadId: FEATURES_OWNER,
    objectives: { reconciliation: { ownerThreadId: FEATURES_OWNER, status: 'active', retired: false } },
    writeLeasePath: join(coordinatorRoot, 'live-provider-write-lease.json'),
    writeLeaseHelper: { path: guardPath, sha256: GUARD_SHA,
      localCoordinationGuardAccepted: true, independentReviewPending: false, providerAuthority: false,
      rootAcceptance: guardReview, independentRevisionReview: guardReview, independentFinalScopeAddendum: guardReview },
  } }));
  const workboard = join(controlRoot, 'workboard.json');
  writeFileSync(workboard, JSON.stringify({ checkpointPaths: { workflow: workflowPath } }));
  mkdirSync(join(controlRoot, '.fcos-cli'), { recursive: true });
  writeFileSync(join(controlRoot, '.fcos-cli/release-state.json'), JSON.stringify({ workboardPath: workboard }));
  const binding = { runId, jobId, hostOrigin: locator.url, deploymentId: locator.deploymentId, rootAdmissionSha256: '', ...(v3 ? { executionPreflightSha256: hash(executionPreflightJson), executionJobStartedAt: jobStartedAt } : {}) };
  const target = { epoch: 'joined-fixture-epoch', featuresOwnerThreadId: FEATURES_OWNER,
    artifactCaptureAuthoritySha256: template.artifactCaptureAuthoritySha256,
    runId, jobId, hostOrigin: locator.url, deploymentId: locator.deploymentId,
    ownerThreadId: host.binding.ownerThreadId, actorId: host.binding.actorId,
    approvalSha256: host.binding.approvalSha256, sourceSha256: host.binding.sourceSha256,
    controllerSha: template.controllerSha, ...(v3 ? { executionPreflightSha256: hash(executionPreflightJson), executionJobStartedAt: jobStartedAt } : {}) };
  const evidence = {};
  for (const name of ['originalAuthority', 'artifactCaptureAuthority', 'hostDeploymentSourceReceipt']) evidence[name] = save(`synthetic-${name}.json`, { fixture: 'INERT_NO_LIVE_AUTHORITY' });
  evidence.coordinationQuota = save('synthetic-coordination-quota.json', {
    kind: 'fcos_actual_xero_courier_shared_get_quota_v1', accepted: true, repository: REPOSITORY,
    nativeGetsPerMinute: 20, carrierGetsPerMinute: 20, sharedMaximum: 45,
    maximumConcurrentClients: 2, actualSharedPreflightReviewed: true });
  if (v3) { const path = join(stateDirectory,'execution-preflight.json'); writeFileSync(path,executionPreflightJson,{mode:0o600}); evidence.executionPreflight = {path,sha256:hash(executionPreflightJson)}; }
  const nativeSourcePins = nativeCourierSourcePins();
  const scopeSha256 = hash(canonical({ templateSha256: parsed.templateSha256, planSha256: parsed.planSha256,
    target, sourcePins: nativeSourcePins, evidence }));
  for (const [name, role, reviewerId] of [['rootReview', 'root', '/root'], ['independentReview', 'independent', '/root/synthetic_fixture_peer']]) evidence[name] = save(`synthetic-${name}.json`, {
    kind: 'fcos_actual_native_xero_courier_action_review_v1', accepted: true, role, reviewerId, scopeSha256,
    originalHumanAuthorityProvenanceReviewed: true, actualDeploymentSourceProvenanceReviewed: true,
    actualSharedCoordinationQuotaReviewed: true, actualPublisherStatusScopeAndConsumersReviewed: true, ...(v3 ? { actualExecutionPreflightReviewed: true } : {}) });
  binding.rootAdmissionSha256 = save('root-native-admission.json', {
    schemaVersion: 1, kind: 'fcos_root_admitted_native_xero_courier_v1', reviewerId: '/root', accepted: true,
    templateSha256: parsed.templateSha256, planSha256: parsed.planSha256, target,
    sourcePins: nativeSourcePins, evidence, scopeSha256 }).sha256;

  const nativeCalls = [];
  const capture = (command, args, options) => {
    nativeCalls.push({ command, args, pythonMode: command === '/usr/bin/python3' ? JSON.parse(options.input).mode : null });
    if (command === '/usr/bin/python3') return spawnSync(command, args, options);
    if (command === '/usr/bin/git') {
      if (!args.includes('push')) return spawnSync(command, args, options);
      const [commitSha, ref] = args.at(-1).split(':');
      assert.equal(args.at(-2), `https://github.com/${REPOSITORY}.git`);
      assert.equal(publishedRefs.has(ref), false);
      assert.equal(git(['cat-file', '-t', commitSha]), 'commit');
      publishedRefs.set(ref, commitSha);
      return { status: 0, stdout: '' };
    }
    assert.equal(command, 'fixture-gh');
    const route = args[1];
    if (args.includes('POST')) {
      const commitSha = route.split('/').at(-1);
      const [ref] = [...publishedRefs].find(([, sha]) => sha === commitSha);
      const raw = git(['show', `${commitSha}:request.json`]);
      const published = publishStatus(ref, commitSha, raw, 'request');
      assert.deepEqual(JSON.parse(options.input), published.expected.body);
      return { status: 0, stdout: `HTTP/2.0 201 Created\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(published.value)}` };
    }
    assert.ok(args.includes('GET'));
    return { status: 0, stdout: route.endsWith('/actions/artifacts/91/zip') ? artifactBytes : JSON.stringify(githubRead(route)) };
  };
  const native = await createNativeXeroRecoveryRelay({ templateJson, binding, stateDirectory,
    cwd: controlRoot, controlRoot, capture, now,
    nativeRuntime: { credentialAvailable: true, command: 'fixture-gh',
      env: { PATH: process.env.PATH, HOME: controlRoot, GH_CONFIG_DIR: controlRoot } },
    wait: async () => Promise.race([artifactReady, carrierStopped.then(error => { throw error; })]) });
  if (lateRunway) {
    await assert.rejects(native.submit(host.request('preflight',null)),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});
    assert.equal(nativeCalls.length,0);assert.ok(!readdirSync(stateDirectory).some(name=>name.includes('claim-attempt')||name.includes('.prepared.')));
    assert.equal((await host.db.query('select count(*)::int n from public.xero_recovery_step_attempts')).rows[0].n,0);
    return;
  }
  if (v3) {
    const executionJob=jobs.jobs[0],prepJob=jobs.jobs[1];
    jobs.jobs=[{...prepJob,status:'in_progress',conclusion:null}];jobs.total_count=1;
    const prepared=await prepareWarmXeroRecoveryCarrier({templateJson,fetchImpl,now,signal:controller.signal,
      env:{GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:runId,GITHUB_RUN_ATTEMPT:'1',GITHUB_TOKEN:'FIXTURE_PRIVATE_GITHUB_TOKEN_12345'},wait:async()=>assert.fail('Already published fixture locator')});
    assert.equal(prepared.status,'actual_publisher_preparation_complete');
    assert.equal(calls.filter(call=>call.origin===locator.url || call.origin==='https://api.vercel.com').length,0);
    assert.equal((await host.db.query('select count(*)::int n from public.xero_recovery_step_attempts')).rows[0].n,0);
    jobs.jobs=[executionJob,prepJob];jobs.total_count=2;
  }
  const carrier = runWarmXeroRecoveryCarrier({ templateJson, fetchImpl, now, signal: controller.signal,
    env: { GITHUB_REPOSITORY: REPOSITORY, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '1',
      GITHUB_TOKEN: 'FIXTURE_PRIVATE_GITHUB_TOKEN_12345', FCOS_HOSTED_VERCEL_READ_TOKEN: readToken,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/fixture',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'FIXTURE_PRIVATE_OIDC_REQUEST',
      FCOS_HOSTED_RUNTIME_EMAIL: host.email, FCOS_HOSTED_RUNTIME_PASSWORD: 'PRIVATE_APPROVED_PASSWORD',
      FCOS_PRODUCTION_VERIFICATION_BYPASS: 'FIXTURE_PRIVATE_BYPASS', FCOS_XERO_RECOVERY_REQUEST_NONCE: host.nonce },
    wait: async () => new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true })),
  });
  // Observe rejection immediately; explicit cancellation happens only after
  // the successful native consumer below has persisted its real ACK.
  const carrierStopped = carrier.then(() => assert.fail('Only one step is requested'), error => error);
  const rawRequest = host.request('preflight', null);
  const nativeSubmission = native.submit(rawRequest);
  const result = await Promise.race([nativeSubmission, carrierStopped.then(error => { throw error; })]);
  assert.equal(result.status, 'submitted_acknowledged');
  assert.equal(result.result.step, 'preflight');
  if (v3) { assert.equal(result.result.kind,'fcos_xero_recovery_step_result_v3'); assert.ok(result.result.execution.firstStartedAt > host.binding.preparedAt + 3500000); assert.equal(result.result.execution.executionDeadlineAt,result.result.execution.firstStartedAt+1800000); }
  assert.equal(result.result.nextStep, 'custodyPrepare');
  assert.equal(result.result.executionAuthorityGranted, false);
  assert.equal(result.result.qualificationAccepted, false);
  assert.equal(uploadedAck.resultJson, JSON.parse(readFileSync(join(stateDirectory, `${host.binding.operationId}.preflight.ack.json`))).envelope.resultJson);
  assert.equal((await host.db.query('select count(*)::int n from public.xero_recovery_step_acknowledgements')).rows[0].n, 1);
  assert.equal(host.calls.filter(call => call.path.endsWith('/xero_recovery_step_claim')).length, 1);
  assert.equal(host.calls.filter(call => call.path.endsWith('/xero_recovery_step_complete')).length, 1);
  assert.equal(calls.filter(call => call.origin === locator.url && call.method === 'POST').length, 1);
  assert.equal(nativeCalls.filter(call => call.args.includes('push')).length, 1);
  assert.equal(nativeCalls.filter(call => call.command === 'fixture-gh' && call.args.includes('POST')).length, 1);
  assert.equal(calls.filter(call => call.origin === 'https://api.vercel.com' && call.path.startsWith('/v8/')).length, 3);
  assert.equal(nativeCalls.filter(call => call.pythonMode === 'claim').length, 1);
  const heldLease = JSON.parse(readFileSync(join(coordinatorRoot, 'live-provider-write-lease.json')));
  assert.equal(heldLease.ownerThreadId, FEATURES_OWNER);
  assert.equal(heldLease.operationId, `xero-recovery-${host.binding.operationId}`);
  assert.equal(heldLease.providerAuthorityGranted, false);
  assert.equal(protectionDisposed, 1);
  assert.deepEqual(browser.calls.slice(-2), ['context-close', 'browser-close']);
  assert.ok(calls.every(call => call.origin !== 'https://api.xero.com' && !call.path.includes('/events')));
  assert.ok(!readdirSync(stateDirectory).some(name => name.includes('.custodyPrepare.')));
  const before = nativeCalls.length;
  await assert.rejects(native.submit(rawRequest), { code: 'XERO_COURIER_CONSUMED_GET_ONLY' });
  assert.equal(nativeCalls.length, before);
  controller.abort();
  assert.equal((await carrierStopped).code, 'XERO_COURIER_AUTHORITY_EXPIRED');
});
