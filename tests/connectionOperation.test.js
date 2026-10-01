import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FCOS_CONNECTION_POLICY, fcosRuntimeConnectionCatalogue } from '../config/fcosConnections.js';
import { cachedConnectionProviderReport, collectConnectionDiagnostics, mergeSafeConnectionStatus, parseConnectionDiagnosticArguments, runConnectionOperation, validateProviderArgs } from '../scripts/fcos-connections.mjs';
import { assertConnectionOperationAccess, describeConnectionOperation, sanitizeConnectionOperationOutput, validateConnectionOperation } from '../scripts/lib/connection-operation.mjs';
import { connectionEvidenceFreshness, sanitizeConnectionProviderReport } from '../src/lib/connectionChecklist.js';

const now = new Date('2026-10-01T00:00:00.000Z');
const githubArgs = ['api', 'repos/hocheunglai-oss/fcos/actions/runs/123/artifacts', '--method=GET'];
const context = { provider: 'github', environment: 'tooling', operation: 'github.api.read', capability: 'repository.read' };
function report(provider = 'github', overrides = {}) {
  return { provider, cliAvailable: true, cliVersion: '2.96.0', cliVersionStatus: 'approved', identityVerified: true,
    identityStatus: 'verified', targetPin: 'verified', permissionStatus: 'missing', permissions: ['repository.read'],
    observedAt: now.toISOString(), lastVerifiedAt: now.toISOString(), observationMode: 'live', freshness: 'current', warningCodes: [], ...overrides };
}

test('managed operation context is explicit and cannot understate capability or retarget Salesforce', () => {
  assert.equal(validateConnectionOperation(context, githubArgs).requiredPermission, 'repository.read');
  assert.throws(() => validateConnectionOperation({}, githubArgs), /require provider, environment, operation and capability/);
  assert.throws(() => validateConnectionOperation({ ...context, operation: 'github.repository.read' }, githubArgs), /does not match/);
  assert.throws(() => validateConnectionOperation({ ...context, environment: 'other' }, githubArgs), /Unknown managed connection environment/);
  assert.throws(() => validateConnectionOperation({ provider: 'salesforce', environment: 'devee', operation: 'salesforce.data.read', capability: 'data.query' }, ['data', 'query', '--target-org=fcos-qat']), /does not match operation environment/);
  const sf = validateConnectionOperation({ provider: 'salesforce', environment: 'qat', operation: 'salesforce.data.read', capability: 'data.query' }, ['data', 'query', '--target-org=fcos-qat', '--query=SELECT Id FROM Organization']);
  assert.equal(sf.requiredPermission, 'qat.data.query');
});

test('target overrides are rejected in split and equals forms before command execution', () => {
  for (const args of [['project', 'inspect', 'fcos', '--scope=other'], ['project', 'inspect', 'fcos', '--cwd=/tmp'], ['project', 'inspect', 'fcos', '--team=other'], ['project', 'inspect', 'fcos', '--global-config=/tmp']]) assert.throws(() => validateProviderArgs('vercel', args), /overrides are blocked/);
  for (const args of [['data', 'query', '--target-org=other'], ['data', 'query', '-o=other']]) assert.throws(() => validateProviderArgs('salesforce', args), /unapproved org/);
  for (const args of [['repo', 'view', '--repo=other/repo'], ['repo', 'view', '-R', 'other/repo'], ['repo', 'view', 'other/repo']]) assert.throws(() => validateProviderArgs('github', args), /outside the approved/);
  for (const args of [['projects', 'list', '--profile=other'], ['projects', 'list', '--workdir=/tmp'], ['projects', 'list', '--project-ref=other']]) assert.throws(() => validateProviderArgs('supabase', args));
  assert.throws(() => validateProviderArgs('salesforce', ['data', 'query', '-o', 'fcos-devee', '--target-org=fcos-qat']), /Multiple Salesforce target/);
});

test('unknown commands, private exporters, browser launchers and hidden mutations fail closed', () => {
  for (const [provider, args] of [
    ['github', ['issue', 'delete', '1']], ['github', ['api', 'repos/hocheunglai-oss/fcos', '--method=POST']],
    ['vercel', ['curl', '/api/status']], ['vercel', ['deploy', '--yes']], ['vercel', ['env', 'pull', '/tmp/secret']],
    ['vercel', ['api', '/v10/projects/prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs/env']],
    ['salesforce', ['org', 'open', '--browser', 'chrome']], ['supabase', ['db', 'push']],
  ]) assert.throws(() => describeConnectionOperation(provider, args));
  assert.throws(() => validateProviderArgs('salesforce', ['org', 'open', '--target-org=source-salesforce', '--browser=chrome']), /environment-pinned Chrome profile/);
  assert.throws(() => validateProviderArgs('github', ['api', 'user', '--input=-']), /Unknown command options/);
  assert.throws(() => validateProviderArgs('unknown', ['list']), /Unknown managed connection provider/);
});

test('API reads are restricted to exact relative scoped endpoints and safe query parameters', () => {
  assert.equal(describeConnectionOperation('github', ['api', '/user']).operation, 'github.api.read');
  for (const endpoint of ['https://api.github.com/repos/hocheunglai-oss/fcos', '//other/repos/hocheunglai-oss/fcos', 'repos/hocheunglai-oss/fcos/../other', 'repos/hocheunglai-oss/fcos%2fother', 'repos/other/fcos', 'repos/hocheunglai-oss/fcos/actions/runs?api_url=https://other']) assert.throws(() => describeConnectionOperation('github', ['api', endpoint]));
  const deployments = '/v6/deployments?projectId=prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs&teamId=team_MbKDazzCrou3eKTuausPv4X2';
  assert.equal(describeConnectionOperation('vercel', ['api', deployments, '--method', 'GET']).capability, 'deployment.read');
  for (const endpoint of ['/v6/deployments', `${deployments}&projectId=other`, '/v6/deployments?projectId=other', '/v10/projects/other']) assert.throws(() => describeConnectionOperation('vercel', ['api', endpoint]));
});

test('read capability can execute without unrelated write rights, but stale/mismatched evidence cannot', () => {
  const operation = validateConnectionOperation(context, githubArgs);
  assert.equal(assertConnectionOperationAccess(operation, report(), { now }), true);
  for (const invalid of [report('github', { permissions: [] }), report('github', { identityStatus: 'mismatch' }), report('github', { targetPin: 'mismatch' }), report('github', { credentialLifecycle: 'expired' }), report('github', { observationMode: 'cached' }), report('github', { observedAt: '2026-09-30T23:40:00.000Z' }), report('github', { observedAt: null, lastVerifiedAt: null }), report('github', { observedAt: '2026-10-01T00:06:00.000Z' })]) assert.throws(() => assertConnectionOperationAccess(operation, invalid, { now }));
});

test('managed runner refuses locally asserted write authorization before any verification or execution', async () => {
  let calls = 0;
  await assert.rejects(runConnectionOperation({ provider: 'vercel', environment: 'production', operation: 'vercel.deployment.create', capability: 'deployment.create', authorized: true }, ['deploy', '--yes'], { verifyProvider: async () => { calls += 1; }, execute: () => { calls += 1; } }));
  assert.equal(calls, 0);
});

test('resource ownership is verified before executing a deployment read', async () => {
  let executed = false;
  const args = ['inspect', 'dpl_abc'];
  const op = { provider: 'vercel', environment: 'preview', operation: 'vercel.deployment.read', capability: 'deployment.read' };
  const dependencies = { now, verifyProvider: async () => report('vercel', { permissions: ['deployment.read'] }), verifyResource: async () => false, execute: () => { executed = true; } };
  await assert.rejects(runConnectionOperation(op, args, dependencies), /Resource ownership/);
  assert.equal(executed, false);
  assert.equal(await runConnectionOperation(op, args, { ...dependencies, verifyResource: async () => true, execute: () => 0 }), 0);
});

test('ordinary verify and doctor do not publish; explicit publication requires full verification', () => {
  assert.equal(parseConnectionDiagnosticArguments([]).publish, false);
  assert.equal(parseConnectionDiagnosticArguments(['vercel', '--json']).publish, false);
  assert.equal(parseConnectionDiagnosticArguments(['--publish']).publish, true);
  for (const args of [['vercel', '--publish'], ['--read-only', '--publish'], ['--publish', '--no-publish'], ['--unknown'], ['vercel', 'github']]) assert.throws(() => parseConnectionDiagnosticArguments(args));
});

test('strict read-only diagnostics never invoke persistence or publication dependencies', async () => {
  const calls = [];
  const options = parseConnectionDiagnosticArguments(['vercel', '--read-only', '--json']);
  const diagnostics = await collectConnectionDiagnostics(options, {
    verifyProvider: async (provider, options) => { calls.push({ provider, options }); return cachedConnectionProviderReport(provider, null, now, true); },
    writeSafeStatus: () => assert.fail('Unexpected status write'), publishAttestation: () => assert.fail('Unexpected live publication'), environment: {},
  });
  assert.deepEqual(calls, [{ provider: 'vercel', options: { readOnly: true, persist: false, prepare: false } }]);
  assert.equal(diagnostics.observation, 'cached; not live verified');
  assert.equal(diagnostics.providers.vercel.identityVerified, false);
  assert.equal(diagnostics.providers.vercel.observationMode, 'cached');
  assert.ok(diagnostics.providers.vercel.warningCodes.includes('evidence_missing'));
});

test('cached evidence is never certified as a current live identity', () => {
  const cached = cachedConnectionProviderReport('github', { providers: { github: report() } }, now, true);
  assert.equal(cached.identityVerified, false);
  assert.equal(cached.identityStatus, 'cached');
  assert.equal(cached.freshness, 'current');
  assert.deepEqual(cached.permissions, []);
  assert.equal(connectionEvidenceFreshness(report('github', { observedAt: '2026-09-29T00:00:00.000Z' }), now), 'expired');
  assert.equal(connectionEvidenceFreshness({}, now), 'unknown');
});

test('sanitized reports separate read/write capabilities and strip raw output, auth claims and unknown fields', () => {
  const safe = sanitizeConnectionProviderReport(report('vercel', { permissions: ['project.read', 'deployment.read', 'invented.write'], humanAuthorization: 'approved', stdout: 'secret-token', cliVersion: 'secret-token', warningCodes: ['secret-token'] }), 'vercel');
  assert.equal(safe.capabilities.writePermission, 'unknown');
  assert.equal(safe.capabilities.humanAuthorization, 'not_granted');
  assert.deepEqual(safe.capabilities.write, []);
  assert.doesNotMatch(JSON.stringify(safe), /secret-token|invented.write|humanAuthorization":"approved/);
  const state = mergeSafeConnectionStatus({ providers: { github: { ...report(), stdout: 'secret-token' } }, publication: { status: 'failed', error: 'secret-token' } }, [report('vercel')], undefined, now.toISOString());
  assert.doesNotMatch(JSON.stringify(state), /secret-token|stdout|error/);
});

test('runtime inventory lists configured key names without values or invented account/tenant identities', () => {
  const inventory = fcosRuntimeConnectionCatalogue({ OPENAI_API_KEY: 'secret-token', XERO_TENANT_ID: 'private-tenant', FCOS_MICROSOFT_CLIENT_ID: 'private-client' });
  assert.deepEqual(inventory.map(({ id }) => id), ['supabase', 'salesforce', 'xero', 'drive', 'identity', 'microsoft', 'microsoft-growth', 'openai']);
  assert.equal(inventory.find(({ id }) => id === 'openai').configuredEnv.OPENAI_API_KEY, true);
  assert.equal(inventory.find(({ id }) => id === 'xero').identityPins.status, 'requires_independent_verification');
  assert.doesNotMatch(JSON.stringify(inventory), /secret-token|private-tenant|private-client/);
  assert.ok(inventory.every(({ authenticationStatus, humanAuthorization }) => authenticationStatus === 'unknown' && humanAuthorization === 'not_granted'));
  assert.equal(FCOS_CONNECTION_POLICY.providers.length, 4);
});

function localStateFingerprint(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true }).sort().map((name) => {
    const info = statSync(new URL(name, `${directory.href}/`));
    return [name, info.size, info.mtimeMs];
  });
}

test('actual CLI read-only JSON diagnostics preserve state and return one sanitized JSON document', () => {
  const directory = new URL('../.fcos-cli', import.meta.url);
  const before = localStateFingerprint(directory);
  const result = spawnSync(process.execPath, ['scripts/fcos-connections.mjs', 'doctor', '--read-only', '--json'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 2);
  const value = JSON.parse(result.stdout);
  assert.equal(value.readOnly, true);
  assert.equal(value.observation, 'cached; not live verified');
  assert.ok(Object.values(value.providers).every(({ identityVerified }) => identityVerified === false));
  assert.equal(result.stderr, '');
  assert.deepEqual(localStateFingerprint(directory), before);
});

test('expired failed attestation evidence remains expired and future-dated evidence fails', async () => {
  const { connectionAttestationState } = await import('../src/lib/connectionChecklist.js');
  const payload = { schemaVersion: 1, policyVersion: FCOS_CONNECTION_POLICY.policyVersion, profile: FCOS_CONNECTION_POLICY.profile, keyId: FCOS_CONNECTION_POLICY.attestation.keyId,
    verifiedAt: '2026-09-28T00:00:00.000Z', expiresAt: '2026-09-29T00:00:00.000Z', providers: Object.fromEntries(FCOS_CONNECTION_POLICY.providers.map(({ id }) => [id, report(id, { identityVerified: false })])) };
  assert.equal(connectionAttestationState(payload, now).status, 'expired');
  assert.equal(connectionAttestationState({ ...payload, verifiedAt: '2026-10-01T01:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z' }, now).status, 'failed');
});

test('managed API output projection cannot reveal deployment environment, raw errors or credential fields', () => {
  const operation = validateConnectionOperation({ provider: 'vercel', environment: 'preview', operation: 'vercel.api.read', capability: 'deployment.read' }, ['api', '/v13/deployments/dpl_abc']);
  const projected = sanitizeConnectionOperationOutput(operation, { id: 'dpl_abc', projectId: 'prj_abc', readyState: 'READY', env: { OPENAI_API_KEY: 'test-private-value' }, error: 'test-private-value', meta: { private: 'test-private-value' }, token: 'test-private-value' });
  assert.deepEqual(projected, { id: 'dpl_abc', projectId: 'prj_abc', readyState: 'READY' });
  assert.doesNotMatch(JSON.stringify(projected), /test-private-value|OPENAI_API_KEY|token|error/);
  assert.throws(() => validateProviderArgs('vercel', ['api', '/v13/deployments/dpl_abc', '--jq=.env']), /Unknown command options/);
  assert.throws(() => validateProviderArgs('github', ['run', 'view', '123', '--log']), /Unknown command options/);
  assert.throws(() => validateProviderArgs('vercel', ['inspect', 'dpl_abc', '--json']), /Unknown command options/);
  assert.throws(() => validateProviderArgs('github', ['run', 'download', '123']), /Unknown managed connection operation/);
  assert.throws(() => validateProviderArgs('supabase', ['projects', 'list', '--debug']), /Unknown command options/);
});

test('invalid read-only publication combinations return one sanitized error document without setup', () => {
  const directory = new URL('../.fcos-cli', import.meta.url);
  const before = localStateFingerprint(directory);
  const result = spawnSync(process.execPath, ['scripts/fcos-connections.mjs', 'doctor', '--read-only', '--publish', '--json'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, 'connection_command_failed');
  assert.equal(result.stderr, '');
  assert.deepEqual(localStateFingerprint(directory), before);
});
