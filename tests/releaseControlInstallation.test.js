import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { FCOS_RELEASE_APPROVAL_POLICY } from '../config/fcosConnections.js';
import { collectTrustedReleaseEvidence, RELEASE_REPOSITORY } from '../scripts/lib/release-evidence.mjs';
import { releaseHash } from '../scripts/lib/release-readiness.mjs';
import { collectPreviewParity } from '../scripts/collect-preview-parity.mjs';
import { normalRoleReadRequest } from '../scripts/lib/normal-role-read-requests.mjs';

test('control installation retains frozen quality history and limits current change to the reviewed artifact consumer', () => {
  const current = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./fixtures/release-workflows/quality-72d.yml', import.meta.url), 'utf8');
  assert.equal(releaseHash(source), '92bdff9c8ab1d7c49b2a87b4ab82f2ecb683e927259d3e10fde6e6e1d8d290c5');
  const block = value => value.slice(value.indexOf('  authenticated-browser:'), value.indexOf('  dependency-review:'));
  assert.equal(releaseHash(block(current)), 'fbe438b2b5362c068f7db5922ff53a23f8783c2a9a958aa373d1ec4d22058e95');
  assert.equal(current.replace(block(current), block(source)).replace('python3 -B -m unittest tests.preview_email_coordination_ledger_test tests.release_coordination_ledger_test', 'python3 -m unittest tests.preview_email_coordination_ledger_test'), source);
  assert.match(current, /python3 -B -m unittest tests\.preview_email_coordination_ledger_test tests\.release_coordination_ledger_test/);
  const workflow = load(source), steps = workflow.jobs['code-and-database'].steps;
  const checkout = steps.find(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with['fetch-depth'], 0);
  const history = '          # Verify immutable retained Production and compatibility Git objects.\n          fetch-depth: 0\n';
  const pythonBlock = '      - name: Verify isolated Python coordination ledger\n        run: python3 -m unittest tests.preview_email_coordination_ledger_test\n';
  assert.equal(source.split(pythonBlock).length, 2);
  const pythonIndex = steps.findIndex(step => step.name === 'Verify isolated Python coordination ledger');
  assert.equal(pythonIndex, steps.findIndex(step => step.run === 'npm test') + 1);
  assert.deepEqual(steps[pythonIndex], {
    name: 'Verify isolated Python coordination ledger',
    run: 'python3 -m unittest tests.preview_email_coordination_ledger_test',
  });

  assert.equal(source.split(history).length, 2);
  const recordIndex = steps.findIndex(step => step.name === 'Record exact tested source');
  assert.equal(recordIndex, steps.length - 2);
  assert.equal(steps[recordIndex].if, undefined);
  assert.equal(steps[recordIndex].continueOnError, undefined);
  assert.match(steps[recordIndex].run, /candidateSha !== process\.env\.CANDIDATE_SHA/);
  const upload = steps.at(-1);
  assert.equal(upload.uses, 'actions/upload-artifact@v4');
  assert.equal(upload.with.name, 'fcos-quality-source-${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(upload.with['if-no-files-found'], 'error');
  const start = source.indexOf('      - name: Record exact tested source');
  const end = source.indexOf('\n  authenticated-browser:', start);
  const restored = (source.slice(0, start).replace(/\n+$/, '\n') + '\n' + source.slice(end + 1))
    .replace(history, '')
    .replace(pythonBlock, '')
    .replace(/^          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\n/m, '');
  assert.equal(releaseHash(restored), 'cf40aa3a2515b2f48990a2f1031944aa6d1a5d8a04eec7232e9bc6c9e013c5dc');
});

test('both installed workflows remain manual, disabled by default and behind their exact protected environments', () => {
  for (const [filename, jobName, environment, flag] of [
    ['production-release.yml', 'production', 'fcos-production-release', 'FCOS_PRODUCTION_RELEASE_ENABLED'],
    ['normal-role-release.yml', 'normal-role', 'fcos-normal-role-verification', 'FCOS_NORMAL_ROLE_E2E_ENABLED'],
  ]) {
    const workflow = load(readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    const job = workflow.jobs[jobName];
    assert.equal(job.environment, environment);
    assert.match(job.if, new RegExp(`vars\\.${flag} == 'true'`));
    assert.match(job.if, /github\.event\.repository\.default_branch/);
    assert.equal(job.permissions.contents, 'read');
    assert.equal(job.permissions.deployments, 'read');
  }
});

test('release read guard rejects unknown, execution and nested mutation requests without application dispatch imports', () => {
  for (const [name, body] of [
    ['authContext', {}], ['dashboardStemList', { from: '2026-09-01', to: '2026-10-01' }],
    ['navigationPreferencesGet', {}], ['exceptionReviewWorkflowList', { stemIds: ['stem'] }],
    ['hedgeDeskEntity', { action: 'snapshot' }], ['hedgeMarkets', { action: 'snapshot' }],
  ]) assert.equal(normalRoleReadRequest(name, body), true);
  for (const [name, body] of [
    ['unknownRead', {}], ['emailRouterBackgroundSync', {}], ['missingNomBUpload', {}],
    ['xeroFinancialSyncRun', {}], ['hedgeDeskEntity', { action: 'save' }],
    ['dashboardStemList', { action: 'apply' }], ['dashboardStemList', { filter: { operation: 'delete' } }],
    ['dashboardStemList', { upload: true }], ['dashboardStemList', { approveAll: true }], ['dashboardStemList', { SYNC: true }],
    ['authContext', []], ['authContext', null], ['authContext', 'ignored'],
  ]) assert.equal(normalRoleReadRequest(name, body), false);
  const harness = readFileSync(new URL('../scripts/normal-role-release.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(harness, /from ['"]\.\.\/(?:api|src)\//);
  const collector = readFileSync(new URL('../scripts/collect-preview-parity.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(collector, /from ['"]\.\/fcos-connections\.mjs/);
});

test('parity collection fails before any provider work unless a verified adapter is explicitly supplied', async () => {
  await assert.rejects(collectPreviewParity({ candidateUrl: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app',
    expectedCommit: 'a'.repeat(40), cwd: '/nonexistent-directory' }), /explicitly supplied verified/);
});

test('normal-role reads reject nested execution flags and action aliases while keeping actual module filters', () => {
  const flags = ['refresh', 'forceRefresh', 'FORCE_REFRESH', 'autoSync', 'auto_sync', 'reconcile',
    'retry', 'resume', 'recover', 'finalize', 'publish', 'process', 'backgroundProcess', 'repair', 'reset', 'invalidate'];
  for (const flag of flags) {
    for (const value of [true, false, 'yes']) {
      assert.equal(normalRoleReadRequest('dashboardStemList', { [flag]: value }), false, flag);
      assert.equal(normalRoleReadRequest('dashboardStemList', { filters: [{ options: { [flag]: value } }] }), false, flag);
    }
  }
  for (const alias of ['action', 'actionType', 'ACTION_NAME', 'operation', 'operation_type', 'command',
    'commandType', 'op', 'verb', 'method', 'intent', 'mode', 'request_action']) {
    assert.equal(normalRoleReadRequest('dashboardStemList', { [alias]: 'refresh' }), false, alias);
    assert.equal(normalRoleReadRequest('dashboardStemList', { filters: { [alias]: 'process' } }), false, alias);
  }
  for (const [handler, body] of [
    ['dashboardStemList', { search: 'TEST', from: '2026-09-01', to: '2026-10-01', deliveryDateFrom: '2026-09-01', page: 1, currency: 'USD' }],
    ['workNotificationsList', { source: 'all', state: 'active', type: 'all' }],
    ['emailRouterList', { search: 'sent', sender: 'trader@example.test', folder: 'Inbox', page: 1, pageSize: 25 }],
    ['buyerInvoiceCollectionList', { status: 'Processing', accountId: 'account', from: '2026-09-01' }],
    ['exceptionReviewWorkflowList', { stemIds: ['stem'] }],
  ]) assert.equal(normalRoleReadRequest(handler, body), true, handler);
});

test('Hedge Desk reads retain intended entity and parameter scope rather than authorizing an action alone', () => {
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'snapshot' }), true);
  assert.equal(normalRoleReadRequest('hedgeMarkets', { action: 'snapshot' }), true);
  const entities = ['PhysicalTrade', 'SwapHedge', 'MopsPrice', 'ClearingAccount', 'Invoice', 'Counterparty', 'AppConfig'];
  for (const entity of entities) {
    assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'list', entity, sort: '-created_date', limit: 1000 }), true);
    assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'filter', entity, params: { id: ['record-1'] }, limit: 25 }), true);
    assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'get', entity, id: 'record-1' }), true);
  }
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { entity: 'AppConfig' }), true);
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'filter', entity: 'AppConfig', params: { key: 'assistant_model' }, sort: '-updated_date', limit: 1 }), true);
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'filter', entity: 'Invoice', params: { created_date: '2026-09-01' } }), true);
  for (const body of [
    {}, { action: 'list' }, { action: 'future_read', entity: 'Invoice' }, { action: 'list', entity: 'Profile' },
    { action: 'get', entity: 'Invoice', id: '' }, { action: 'get', entity: 'Invoice', id: 'record-1', payload: {} },
    { action: 'list', entity: 'Invoice', table: 'profiles' }, { action: 'snapshot', table: 'profiles' },
    { action: 'snapshot', entity: 'Profile' }, { action: 'snapshot', env: { VERCEL_ENV: 'production' } },
    { action: 'list', entity: 'Invoice', limit: -1 }, { action: 'list', entity: 'Invoice', limit: 10001 },
    { action: 'list', entity: 'Invoice', sort: 'status; delete' },
    { action: 'filter', entity: 'Invoice', params: { table: 'profiles' } },
    { action: 'filter', entity: 'Invoice', params: { options: { refresh: true } } },
    { action: 'filter', entity: 'Invoice', params: { id: [{ action: 'get' }] } },
    { action: 'filter', entity: 'Invoice', params: { created_date: { refresh: true } } },
    { action: 'snapshot', skipExpiry: false }, { action: 'snapshot', forceRefresh: false },
  ]) assert.equal(normalRoleReadRequest('hedgeDeskEntity', body), false, JSON.stringify(body));
  assert.equal(normalRoleReadRequest('hedgeMarkets', { action: 'snapshot', options: { refresh: false } }), false);
  assert.equal(normalRoleReadRequest('hedgeMarkets', { action: 'snapshot', table: 'profiles' }), false);
});

test('quality source evidence binds archive content, workflow bytes and actual tested commit and lock', async () => {
  const now = Date.parse('2026-10-01T01:00:00Z'), capturedAt = new Date(now).toISOString();
  const candidateSha = 'a'.repeat(40), harnessSha = 'b'.repeat(40), lockHash = 'c'.repeat(64);
  const archive = Buffer.from('controlled archive transport fixture');
  const binding = { sha: candidateSha, lockHash, sourceDigest: 'd'.repeat(64), configurationRevision: 'e'.repeat(64),
    deploymentId: 'dpl_candidate', candidateUrl: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app' };
  const repository = { full_name: RELEASE_REPOSITORY, default_branch: 'main' };
  const branch = { name: 'main', protected: true, commit: { sha: harnessSha } };
  const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
    checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
  const run = { id: 7, repository, head_repository: repository, head_sha: candidateSha,
    conclusion: 'success', status: 'completed', path: '.github/workflows/quality.yml', updated_at: capturedAt };
  const artifact = { id: 8, name: `fcos-quality-source-${candidateSha}`, expired: false,
    digest: `sha256:${releaseHash(archive)}`, workflow_run: { id: 7, head_sha: candidateSha } };
  const payload = { schemaVersion: 1, candidateSha, lockSha256: lockHash, capturedAt };
  async function collect(changes = {}) {
    const reads = {
      archive: () => archive,
      json: path => {
        if (path === `repos/${RELEASE_REPOSITORY}`) return repository;
        if (path.endsWith('/branches/main')) return branch;
        if (path.endsWith('/protection')) return protection;
        if (path.includes('/contents/')) return { encoding: 'base64', content: Buffer.from(
          changes.workflowMismatch && path.endsWith(candidateSha) ? 'different workflow' : 'protected workflow').toString('base64') };
        if (path.includes('/quality.yml/runs')) return { workflow_runs: [{ ...run, ...changes.run }] };
        if (path.includes('/runs?')) return { workflow_runs: [] };
        if (path.includes('/artifacts?')) return { artifacts: [{ ...artifact, ...changes.artifact }] };
        throw new Error('Unexpected read');
      },
    };
    return collectTrustedReleaseEvidence({ reads, binding, now, unpack: () => ({ ...payload, ...changes.payload }) });
  }
  assert.equal((await collect()).quality.archiveDigest, releaseHash(archive));
  for (const changes of [
    { payload: { candidateSha: harnessSha } }, { payload: { lockSha256: '0'.repeat(64) } },
    { payload: { capturedAt: '2026-09-30T01:00:00Z' } }, { artifact: { digest: `sha256:${'0'.repeat(64)}` } },
    { run: { conclusion: 'failure' } }, { run: { head_sha: harnessSha } }, { workflowMismatch: true },
  ]) assert.equal((await collect(changes)).quality, null);
});
