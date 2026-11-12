import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertInventoryUnchanged,
  expectedManifest,
  publicationReport,
  selectPublicationTarget,
  sourceInventory,
  syncCheckout,
  validateFetchedPullRequestHead,
  validatePublicationPullRequest,
  verifyCheckout,
} from '../scripts/sync-salesforce-shared-repository.mjs';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { SALESFORCE_RELEASE_MODE } from '../scripts/salesforce-workflow-state.mjs';

const publication = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce').publication;

test('mirror CLI accepts only one exact mode before checking shared-repository credentials', () => {
  const script = fileURLToPath(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url));
  const env = { ...process.env, GITHUB_ACTIONS: 'true', FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: '' };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', timeout: 5000 });
  for (const mode of ['--check', '--publish']) {
    const result = run(mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /shared-repository GitHub authorization is unavailable/);
  }
  for (const args of [[], ['--unknown'], ['--check', '--publish'], ['--publish', '--unknown'], ['--check', '--check']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose exactly one mode: --check or --publish/);
  }
});

test('mirror source cannot change beneath a previously verified deployment hash', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fcos-mirror-frozen-'));
  try {
    writeFileSync(path.join(directory, 'SameSize.cls'), 'before');
    const inventory = sourceInventory(directory);
    assert.doesNotThrow(() => assertInventoryUnchanged(inventory, directory));
    writeFileSync(path.join(directory, 'SameSize.cls'), 'change');
    assert.throws(() => assertInventoryUnchanged(inventory, directory), /changed after its deployment proof/);
    assert.throws(() => syncCheckout(directory, inventory, expectedManifest(inventory), directory), /changed after its deployment proof/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function pullRequest(overrides = {}) {
  return {
    number: 42,
    state: 'OPEN',
    isDraft: true,
    baseRefName: publication.defaultBranch,
    headRefName: publication.activeBranch,
    headRefOid: 'a'.repeat(40),
    headRepository: { nameWithOwner: publication.repository },
    url: 'https://github.com/ivanyk20/fcbhk/pull/42',
    ...overrides,
  };
}

test('Salesforce mirror inventory owns the complete authoritative metadata tree', () => {
  const inventory = sourceInventory();
  assert.ok(inventory.files.length >= 162);
  assert.equal(inventory.sourceTreeHash.length, 64);
  assert.ok(inventory.files.includes('classes/ShipAgentInvoiceReadinessService.cls'));
  assert.ok(inventory.files.includes('classes/ShipAgentInvoiceReadinessServiceTest.cls'));
  assert.ok(inventory.files.includes('objects/STEM__c/fields/Ship_Agent_Charges_Confirmed__c.field-meta.xml'));
  assert.ok(inventory.files.includes('permissionsets/FCOS_Ship_Agent_Integration.permissionset-meta.xml'));
  assert.ok(inventory.files.includes('classes/VariableChargeInvoiceReadinessService.cls'));
  assert.ok(inventory.files.includes('objects/Account/fields/Is_Agent__c.field-meta.xml'));
  assert.ok(inventory.files.includes('objects/STEM__c/fields/Variable_Charges_Confirmed__c.field-meta.xml'));
  assert.ok(inventory.files.includes('permissionsets/FCOS_Variable_Charges_Integration.permissionset-meta.xml'));
  assert.ok(inventory.files.includes('triggers/InvoiceTrigger.trigger'));
});

test('Salesforce mirror manifest contains identifiers and no credentials', () => {
  const manifest = expectedManifest(sourceInventory());
  assert.equal(manifest.sourceRepository, 'hocheunglai-oss/fcos');
  assert.equal(manifest.sourceRoot, 'force-app/main/default/');
  assert.equal(manifest.targetRoot, 'src/');
  assert.ok(manifest.files.includes('objects/Xero_Contact_Sync_Setting__c/fields/Signing_Secret__c.field-meta.xml'));
  assert.doesNotMatch(JSON.stringify({ ...manifest, files: [] }), /token|password|credential|secret/i);
  assert.doesNotMatch(JSON.stringify(manifest.files.filter((file) => !['objects/Xero_Contact_Sync_Setting__c/fields/Signing_Secret__c.field-meta.xml', 'objects/Fcos_Trading_FX_Setting__c/fields/Signing_Secret__c.field-meta.xml'].includes(file))), /token|password|credential|secret/i);
});

test('FCOS pushes with Salesforce changes require a current shared mirror', async () => {
  const source = await readFile(new URL('../.githooks/pre-push', import.meta.url), 'utf8');
  assert.match(source, /force-app\/main\/default\//);
  assert.match(source, /salesforce:mirror:verify/);
  assert.match(source, /ivanyk20\/fcbhk/);
});

test('closed shared pull requests cannot be silently reused for later Salesforce publication', async () => {
  const source = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  assert.match(source, /'pr', 'list'.*'--state', 'open'/s);
  assert.match(source, /No matching open draft shared Salesforce pull request exists/);
  assert.doesNotMatch(source, /remoteBranchHead\(PUBLICATION\.activeBranch\).*PUBLICATION\.activeBranch/s);
});

test('mirror verification requires one matching open draft pull request', () => {
  assert.throws(
    () => selectPublicationTarget([], { mode: 'check' }),
    /No matching open draft shared Salesforce pull request exists/,
  );
  for (const invalid of [
    pullRequest({ state: 'CLOSED' }),
    pullRequest({ isDraft: false }),
    pullRequest({ baseRefName: 'release' }),
    pullRequest({ headRepository: { nameWithOwner: 'someone/fork' } }),
  ]) {
    assert.throws(
      () => selectPublicationTarget([invalid], { mode: 'check' }),
      /must be open, draft, repository-owned, and target the configured base branch/,
    );
  }
});

test('mirror publication selects the configured draft and rejects ambiguous generated drafts', () => {
  const configured = pullRequest();
  const selected = selectPublicationTarget([configured], { mode: 'publish' });
  assert.equal(selected.branch, publication.activeBranch);
  assert.equal(selected.pullRequest, configured);
  assert.equal(selectPublicationTarget([pullRequest({
    headRepository: { name: 'fcbhk' },
    headRepositoryOwner: { login: 'ivanyk20' },
  })], { mode: 'check' }).branch, publication.activeBranch);

  const generated = [1, 2].map((number) => pullRequest({
    number,
    headRefName: `${publication.branchPrefix}-20260911-01020${number}`,
  }));
  assert.throws(
    () => selectPublicationTarget(generated, { mode: 'publish' }),
    /Multiple shared Salesforce draft pull requests/,
  );

  const created = selectPublicationTarget([], {
    mode: 'publish',
    now: new Date('2026-09-11T01:02:03.004Z'),
  });
  assert.equal(created.branch, `${publication.branchPrefix}-20260911-010203004`);
  assert.equal(created.pullRequest, null);
});

test('refetched draft pull request must bind the exact repository branch and commit', () => {
  const expected = pullRequest();
  assert.equal(validatePublicationPullRequest(expected, {
    branch: expected.headRefName,
    headOid: expected.headRefOid,
  }), expected);
  assert.throws(
    () => validatePublicationPullRequest(pullRequest({ headRefOid: 'b'.repeat(40) }), {
      branch: expected.headRefName,
      headOid: expected.headRefOid,
    }),
    /verified commit/,
  );
  assert.throws(
    () => validatePublicationPullRequest(pullRequest({ headRefName: `${publication.branchPrefix}-other` }), {
      branch: expected.headRefName,
      headOid: expected.headRefOid,
    }),
    /configured branch/,
  );
  assert.equal(validateFetchedPullRequestHead(expected.headRefOid, expected), true);
  assert.throws(
    () => validateFetchedPullRequestHead('c'.repeat(40), expected),
    /branch changed after pull request verification/,
  );
});

test('mirror command refetches and validates the PR before verifying immutable remote bytes', async () => {
  const source = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  const refetch = source.indexOf('const pullRequest = refetchPullRequest(');
  const validate = source.indexOf('validatePublicationPullRequest(pullRequest', refetch);
  const verifyRemote = source.indexOf('verifyImmutableRemoteHead(checkout, pullRequest', validate);
  const report = source.indexOf('publicationReport({', verifyRemote);
  assert.ok(refetch >= 0);
  assert.ok(validate > refetch);
  assert.ok(verifyRemote > validate);
  assert.ok(report > verifyRemote);
  assert.match(source, /checkout', '--detach', pullRequest\.headRefOid/);
});

test('hosted mirror preflight uses only its dedicated token for the pinned repository', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fcos-mirror-auth-test-'));
  try {
    const draft = pullRequest();
    const { repository, requiredAccount, requiredAccountId, defaultBranch } = publication;
    const repositoryId = 12345;
    const responses = {
      'api user': { login: requiredAccount, id: requiredAccountId },
      ['api repos/' + repository]: { id: repositoryId, full_name: repository, default_branch: defaultBranch, permissions: { pull: true, push: true } },
      'api user/installations': { total_count: 1, installations: [{
        id: 42, suspended_at: null, repository_selection: 'selected', account: { login: repository.split('/')[0] },
        permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
      }] },
      'api user/installations/42/repositories': { total_count: 1, repositories: [{ id: repositoryId, full_name: repository }] },
      'pr list': [draft],
      ['api repos/' + repository + '/git/ref/' + encodeURIComponent('heads/' + draft.headRefName)]: {
        ref: 'refs/heads/' + draft.headRefName, object: { sha: draft.headRefOid },
      },
    };
    writeFileSync(path.join(directory, 'gh'), [
      '#!/usr/bin/env node',
      'if (process.env.GH_TOKEN !== "ghu_mirror_fixture" || process.env.GITHUB_TOKEN || process.env.FCOS_RAPID_SALESFORCE_MIRROR_TOKEN) process.exit(11);',
      'const args = process.argv.slice(2);',
      'const response = ' + JSON.stringify(responses) + '[args.slice(0, 2).join(" ")];',
      'if (response === undefined) process.exit(12);',
      'if (process.env.FIXTURE_SCOPE_MISMATCH && args[1] === "user/installations/42/repositories") response.total_count = 2;',
      'console.log(JSON.stringify(response));',
    ].join('\n'), { mode: 0o700 });
    const moduleUrl = new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url).href;
    const command = ['--input-type=module', '-e', 'import { preflightSharedMirrorPublication } from ' +
      JSON.stringify(moduleUrl) + '; preflightSharedMirrorPublication();'];
    const env = { ...process.env, PATH: directory + path.delimiter + process.env.PATH,
      GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'workflow-fixture', GH_TOKEN: 'ambient-fixture' };
    const missing = spawnSync(process.execPath, command, { env: { ...env, FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: '' }, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /isolated shared-repository GitHub authorization is unavailable/);
    const supplied = spawnSync(process.execPath, command, { env: { ...env, FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: 'ghu_mirror_fixture' }, encoding: 'utf8' });
    assert.equal(supplied.status, 0, supplied.stderr);
    const broad = spawnSync(process.execPath, command, { env: { ...env, FIXTURE_SCOPE_MISMATCH: 'true',
      FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: 'ghu_mirror_fixture' }, encoding: 'utf8' });
    assert.notEqual(broad.status, 0);
    assert.match(broad.stderr, /must access only the pinned repository/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('hosted Salesforce checks mirror access and draft state before granting its first write receipt', async () => {
  const mirror = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  const preflight = mirror.slice(mirror.indexOf('export function preflightSharedMirrorPublication('), mirror.indexOf('function cloneBranch('));
  assert.match(preflight, /assertIdentity\(\)[\s\S]*publicationBranch\('publish'\)[\s\S]*remoteBranchHead\(selected\.branch\)/);
  assert.doesNotMatch(preflight, /cloneBranch\(|executeSharedMirror\(|publish\(/);
  const branchLookup = mirror.slice(mirror.indexOf('function remoteBranchHead('), mirror.indexOf('function openPullRequests('));
  assert.match(branchLookup, /HTTP 404/);
  assert.match(branchLookup, /throw error;/);
  assert.match(branchLookup, /result\?\.ref !== `refs\/heads\//);
  const adapter = await readFile(new URL('../scripts/lib/rapid-release/salesforce-reviewed-adapter.mjs', import.meta.url), 'utf8');
  assert.match(adapter, /if \(!mirrorPreflightPassed\) \{\s*preflightSharedMirrorPublication\(\);\s*mirrorPreflightPassed = true;\s*\}\s*return salesforce\.ownership\.assert\(binding\)/);
  assert.match(adapter, /runReviewedSalesforceRelease\(\{[\s\S]*?\n\s*ownership, externalJournal:/);
});

test('hosted mirror uses the exact candidate tree throughout publication and remote verification', async () => {
  const source = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  const entrypoint = source.slice(source.indexOf('export function executeSharedMirror('));
  assert.match(entrypoint, /sourceInventory\(metadataRoot\)/);
  assert.match(entrypoint, /syncCheckout\(checkout, inventory, manifest, metadataRoot\)/);
  assert.match(entrypoint, /verifyCheckout\(checkout, inventory, manifest, metadataRoot\)/);
  assert.match(entrypoint, /publish\(checkout, selected\.branch, initialRemoteHead, selected\.pullRequest, inventory, assertPublicationCurrent, metadataRoot\)/);
  assert.match(entrypoint, /verifyImmutableRemoteHead\(checkout, pullRequest, inventory, manifest, metadataRoot\)/);
  const publish = source.slice(source.indexOf('function publish('), source.indexOf('export function executeSharedMirror('));
  assert.match(publish, /assertInventoryUnchanged\(inventory, metadataRoot\)/);
  const remoteReadback = source.slice(source.indexOf('function verifyImmutableRemoteHead('), source.indexOf('export function publicationReport('));
  assert.match(remoteReadback, /verifyCheckout\(checkout, inventory, manifest, metadataRoot\)/);
});

test('mirror synchronization changes only manifest-owned paths and verifies exact bytes', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'fcos-mirror-test-'));
  const authoritative = path.join(temporary, 'authoritative');
  const checkout = path.join(temporary, 'checkout');
  try {
    mkdirSync(path.join(authoritative, 'classes'), { recursive: true });
    mkdirSync(path.join(checkout, publication.targetRoot), { recursive: true });
    writeFileSync(path.join(authoritative, 'classes', 'Owned.cls'), 'public class Owned {}\n');
    writeFileSync(path.join(checkout, publication.targetRoot, 'obsolete.cls'), 'old\n');
    writeFileSync(path.join(checkout, publication.targetRoot, 'unrelated.txt'), 'keep\n');
    writeFileSync(path.join(checkout, publication.manifestPath), `${JSON.stringify({ files: ['obsolete.cls'] })}\n`);

    const inventory = sourceInventory(authoritative);
    const manifest = expectedManifest(inventory);
    syncCheckout(checkout, inventory, manifest, authoritative);
    verifyCheckout(checkout, inventory, manifest, authoritative);

    assert.equal(existsSync(path.join(checkout, publication.targetRoot, 'obsolete.cls')), false);
    assert.equal(readFileSync(path.join(checkout, publication.targetRoot, 'unrelated.txt'), 'utf8'), 'keep\n');
    writeFileSync(path.join(checkout, publication.targetRoot, 'classes', 'Owned.cls'), 'changed\n');
    assert.throws(
      () => verifyCheckout(checkout, inventory, manifest, authoritative),
      /differs from FCOS in 1 owned file/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('mirror manifest cannot remove a path outside its target tree', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'fcos-mirror-path-test-'));
  const authoritative = path.join(temporary, 'authoritative');
  const checkout = path.join(temporary, 'checkout');
  try {
    mkdirSync(authoritative, { recursive: true });
    mkdirSync(path.join(checkout, publication.targetRoot), { recursive: true });
    writeFileSync(path.join(authoritative, 'Owned.cls'), 'public class Owned {}\n');
    writeFileSync(path.join(checkout, publication.manifestPath), `${JSON.stringify({ files: ['../outside.txt'] })}\n`);
    const inventory = sourceInventory(authoritative);
    assert.throws(
      () => syncCheckout(checkout, inventory, expectedManifest(inventory), authoritative),
      /Unsafe shared mirror manifest path/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('publication report identifies the immutable reviewed source and pull request head', () => {
  const reviewedPullRequest = pullRequest();
  const report = publicationReport({
    mode: 'check',
    inventory: { files: ['classes/Owned.cls'], sourceTreeHash: 'd'.repeat(64) },
    deveeDeployment: { deploymentJobId: '0Af000000000001', releaseMode: SALESFORCE_RELEASE_MODE },
    publication: {
      changed: false,
      branch: reviewedPullRequest.headRefName,
      commit: reviewedPullRequest.headRefOid,
    },
    pullRequest: reviewedPullRequest,
  });
  assert.deepEqual({
    repository: report.repository,
    pullRequestNumber: report.pullRequestNumber,
    pullRequestBase: report.pullRequestBase,
    pullRequestHead: report.pullRequestHead,
    pullRequestIsDraft: report.pullRequestIsDraft,
    pullRequestHeadOid: report.pullRequestHeadOid,
    sourceTreeHash: report.sourceTreeHash,
    releaseMode: report.releaseMode,
  }, {
    repository: publication.repository,
    pullRequestNumber: 42,
    pullRequestBase: publication.defaultBranch,
    pullRequestHead: publication.activeBranch,
    pullRequestIsDraft: true,
    pullRequestHeadOid: 'a'.repeat(40),
    sourceTreeHash: 'd'.repeat(64),
    releaseMode: SALESFORCE_RELEASE_MODE,
  });
  assert.deepEqual(report.pullRequest, {
    number: 42,
    url: reviewedPullRequest.url,
    state: 'OPEN',
    isDraft: true,
    baseRefName: publication.defaultBranch,
    headRefName: publication.activeBranch,
    headRefOid: 'a'.repeat(40),
  });
});

test('existing shared publication branches are resumed without corrupting the JSON promotion contract', async () => {
  const source = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  assert.match(source, /mode === 'publish' && !existsRemotely \? PUBLICATION\.defaultBranch : branch/);
  assert.match(source, /mode === 'publish' && !existsRemotely\) run\('git', \['switch', '-c', branch\]/);
  assert.match(source, /run\('git', pushArgs, \{ cwd: checkout, env: ghEnvironment \}\)/);
  assert.doesNotMatch(source, /run\('git', pushArgs, \{ cwd: checkout, inherit: true \}\)/);
});

test('shared Salesforce commits are permanently attributed to the approved GitHub identity', async () => {
  const source = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  const publication = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce').publication;
  assert.equal(publication.requiredAccount, 'vincelessxai');
  assert.equal(publication.requiredAccountId, 304336732);
  assert.match(source, /requiredAccountId.*requiredAccount.*users\.noreply\.github\.com/);
  assert.match(source, /configurePushIdentity\(checkout\)[\s\S]*git', \['add'/);
  assert.match(source, /force-with-lease=refs\/heads\/\$\{branch\}:\$\{expectedRemoteHead\}/);
  assert.match(source, /assertCommitAttribution\(commit\)/);
  assert.doesNotMatch(source, /user\.name', 'Codex'|noreply@openai\.com/);
});

test('shared Salesforce publication requires fresh proof from the exact DEVEE source deployment', async () => {
  const mirror = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  assert.match(mirror, /assertDeveeDeploymentProof\(inventory\)/);
  assert.match(mirror, /allowStaleVerification: true/);
  assert.match(mirror, /refreshDeveeSourceVerification\(currentWorkflow/);
  assert.match(mirror, /const currentWorkflow = readSalesforceWorkflowState\(\)/);
  assert.match(mirror, /currentRecord\.releaseMode !== record\.releaseMode/);
  assert.match(mirror, /currentRecord\.validationJobId !== record\.validationJobId/);
  assert.match(mirror, /currentRecord\.deploymentJobId !== record\.deploymentJobId/);
  assert.match(mirror, /immutable DEVEE deployment proof changed during live verification/);
  assert.match(mirror, /writeSalesforceWorkflowState\(refreshedWorkflow, verifiedAt\)/);
  assert.match(mirror, /deveeSourceProof\(savedWorkflow, verifiedAt\)/);
  assert.match(mirror, /record\?\.schemaVersion !== SALESFORCE_WORKFLOW_SCHEMA_VERSION/);
  assert.match(mirror, /record\?\.deploymentScope !== COMPLETE_SALESFORCE_SCOPE/);
  assert.match(mirror, /record\?\.testLevel !== FULL_SALESFORCE_TEST_LEVEL/);
  assert.match(mirror, /deployment\?\.result\?\.status !== 'Succeeded'/);
  assert.doesNotMatch(mirror, /project', 'deploy', 'validate/);
  assert.match(mirror, /main\(\{ proofResolver = assertDeveeDeploymentProof, assertPublicationCurrent = \(\) => \{\} \} = \{\}\)/);
  assert.match(mirror, /assertPublicationCurrent\(\);\s+run\('git', pushArgs/);
  assert.match(mirror, /assertPublicationCurrent\(\);\s+const url = run\('gh'/);
  assert.match(mirror, /const deveeDeployment = proofResolver\(inventory\)/);
});
