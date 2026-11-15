import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { changedPaths, createManifest, digest, sourceSnapshot, validateManifest } from '../scripts/lib/rapid-release/contract.mjs';
import { baselineGitInventory, loadReviewedSalesforcePlan } from '../scripts/deploy-salesforce-reviewed-manifest.mjs';
import { readReviewedInventory } from '../scripts/lib/salesforce-reviewed-release.mjs';
import { verifySalesforceReviewSource } from '../scripts/verify-salesforce-review-source.mjs';

test('candidate admission binds reviewed files and retrieval manifests to the tracked source', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'fcos-review-source-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, data) => {
    const absolute = join(cwd, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, data);
  };
  const commit = message => {
    git('add', '--all');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet');
  git('remote', 'add', 'origin', 'https://github.com/hocheunglai-oss/fcos.git');
  write('.gitignore', '.fcos-cli/\n');
  write('vercel.json', '{"git":{"deploymentEnabled":false}}\n');
  write('package-lock.json', '{}\n');
  write('sfdx-project.json', '{"namespace":"","packageDirectories":[{"path":"force-app","default":true}]}\n');
  const adapterPath = 'scripts/adapter.mjs';
  const adapter = 'export const test = true;\n';
  const adapterDigest = digest(adapter);
  write(adapterPath, adapter);
  write('config/rapid-release-adapters.json', JSON.stringify({ adapters: [{
    id: 'trading-fx-prerequisites', status: 'qualified', salesforce: true, database: true, path: adapterPath, sourceDigest: adapterDigest,
  }] }));
  const metadataRoot = 'force-app/main/default';
  const files = ['classes/Example.cls', 'classes/Example.cls-meta.xml'];
  write(metadataRoot + '/' + files[0], 'class Example {}\n');
  write(metadataRoot + '/' + files[1], '<ApexClass/>\n');
  const baselineCommit = commit('baseline');
  const baseline = baselineGitInventory(cwd, baselineCommit);
  write(metadataRoot + '/' + files[0], 'class Example { String value; }\n');
  write('supabase/migrations/20261113000000_fixture.sql', 'select 1;\n');
  const xml = '<Package><types><members>Example</members><name>ApexClass</name></types><version>67.0</version></Package>\n';
  const manifestPath = 'manifest/release.xml';
  const reviewPath = 'manifest/review.json';
  const retrievalPath = 'manifest/inventory.xml';
  write(manifestPath, xml);
  write(retrievalPath, xml);
  const final = readReviewedInventory(join(cwd, metadataRoot));
  const review = { schemaVersion: 1, releaseMode: 'reviewed-manifest-incremental-v1', baselineMode: 'read-only-owned-tree-inventory',
    baselineCommit, baselineSourceTreeHash: baseline.sourceTreeHash, baselineInventoryHash: baseline.inventoryHash,
    sourceTreeHash: final.sourceTreeHash, manifestSha256: digest(xml), components: [{ id: 'ApexClass:Example', files, dependsOn: [] }],
    dependencyReview: { complete: true, reviewer: 'fixture', evidence: 'exact package' }, testPlan: { level: 'RunLocalTests', tests: [], minimumTests: 1 },
    inventoryManifests: { [baseline.inventoryHash]: { path: retrievalPath, sha256: digest(xml) } },
  };
  write(reviewPath, JSON.stringify(review));
  commit('candidate');
  const check = (path = reviewPath, locator = {}, ref) => {
    const reviewed = loadReviewedSalesforcePlan({ cwd, manifestPath, reviewPath: path });
    const candidate = sourceSnapshot(cwd);
    const paths = git('diff', '--name-only', baselineCommit, 'HEAD').split('\n');
    const manifest = createManifest({ candidate, controllerSha: baselineCommit, paths, releaseId: 'review-source-fixture',
      previous: { sha: baselineCommit, deploymentId: 'dpl_fixture', configurationDigest: 'a'.repeat(64), schemaDigest: 'b'.repeat(64) },
      publicEnvironment: { VITE_SUPABASE_URL: 'https://pjforfvchygdyqfcgpmw.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_fixture_key_0000000000000' },
      prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest, plan: { salesforceManifestPath: manifestPath, salesforceReviewPath: path,
        salesforceFingerprint: reviewed.fingerprint, salesforceSourceTreeHash: reviewed.binding.sourceTreeHash, backwardCompatible: true, ...locator } },
    }, { sourcePublicationOnly: true });
    if (Object.keys(locator).length === 0) {
      assert.throws(() => validateManifest(manifest), { code: 'TRADING_FX_XERO_QUALIFICATION_LOCATOR_REQUIRED' });
    } else {
      assert.equal(validateManifest(manifest), digest(manifest));
    }
    return verifySalesforceReviewSource({ cwd, candidateSha: ref ?? candidate.sha, manifest, verifierDirectory: cwd });
  };
  assert.equal(check().candidateSha, git('rev-parse', 'HEAD'));
  assert.throws(() => check(reviewPath, { xeroQualificationDeploymentId: 1 }), { code: 'TRADING_FX_XERO_QUALIFICATION_LOCATOR_REQUIRED' });
  assert.equal(check(reviewPath, { xeroQualificationDeploymentId: 1, xeroQualificationDigest: 'a'.repeat(64) }).candidateSha, git('rev-parse', 'HEAD'));
  assert.throws(() => check(reviewPath, {}, 'c'.repeat(40)), { code: 'SALESFORCE_REVIEW_CORRECTION_SCOPE_MISMATCH' });
  const ignoredReview = '.fcos-cli/review.json';
  write(ignoredReview, JSON.stringify(review));
  assert.throws(() => check(ignoredReview), { code: 'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT' });
  const ignoredRetrieval = '.fcos-cli/inventory.xml';
  write(ignoredRetrieval, xml);
  review.inventoryManifests[baseline.inventoryHash].path = ignoredRetrieval;
  write(reviewPath, JSON.stringify(review));
  commit('reference untracked retrieval');
  assert.throws(check, { code: 'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT' });
});

test('Trading FX correction review ref verifies both the unchanged application and the exact Profile child', t => {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const applicationSha = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
  const repair = {
    sourceCommit: '25378405c465c987ca9ae6e13744dbd887009d7f',
    sourceTreeHash: '73bd85d8b22a81bcb32666272ea4d58701c02b509757eb8c2ab7983180c61cef',
    sourceProfileDigest: '0d9d02cb5ca267b1f797756ed63f9d25c4e2d68df26248a930f5c2834ce9011c',
    profileDigest: '03b415858374db416c71f81783c7880ba2f23d4952937b12cc09e9dedc7f4d9c',
    manifestDigest: '85ea97f7edebcc629d9c8615b44bc169df7a11247a57d8d4725bb433ebd6453a',
    correctionFingerprint: 'ce998bb10706f91b13e79f19c6dd9456ee411e8557a01cf1cbff1bc3da008e4c',
  };
  try {
    git('cat-file', '-e', `${repair.sourceCommit}^{commit}`);
    git('cat-file', '-e', `${applicationSha}^{commit}`);
  } catch {
    t.skip('Requires the Trading FX application and Profile review refs in local Git history');
    return;
  }
  const folder = mkdtempSync(join(tmpdir(), 'fcos-real-review-source-test-'));
  const worktrees = [];
  t.after(() => {
    for (const directory of worktrees.toReversed()) git('worktree', 'remove', directory);
    rmSync(folder, { recursive: true, force: true });
  });
  const checkout = (name, sha) => {
    const directory = join(folder, name);
    git('worktree', 'add', '--detach', directory, sha);
    worktrees.push(directory);
    return directory;
  };
  const controllerSha = git('rev-parse', 'HEAD');
  const verifierDirectory = checkout('controller', controllerSha);
  const application = checkout('app', applicationSha);
  const cwd = checkout('correction', repair.sourceCommit);
  const candidate = sourceSnapshot(application);
  const previous = { sha: 'd2e5f1f94898ae99c6188831d071a77c337f31ae', deploymentId: 'dpl_previous',
    configurationDigest: digest('configuration'), schemaDigest: digest('schema') };
  const previousPaths = changedPaths(application, previous.sha);
  const manifestPath = 'manifest/trading-fx-certificate-release.xml';
  const reviewPath = 'manifest/trading-fx-certificate-reviewed-release.json';
  const reviewed = loadReviewedSalesforcePlan({ cwd: application, manifestPath, reviewPath });
  const adapter = 'trading-fx-prerequisites';
  const { sourceDigest: adapterDigest } = JSON.parse(git('show', controllerSha + ':config/rapid-release-adapters.json')).adapters.find(item => item.id === adapter);
  const plan = { salesforceManifestPath: manifestPath, salesforceReviewPath: reviewPath, salesforceFingerprint: reviewed.fingerprint,
    salesforceSourceTreeHash: reviewed.binding.sourceTreeHash, backwardCompatible: true, salesSupportRepair: repair };
  const manifestFor = ({ candidatePatch = {}, planPatch = {}, digestPatch = adapterDigest } = {}) =>
    createManifest({ candidate: { ...candidate, ...candidatePatch }, controllerSha, previous, paths: previousPaths,
      publicEnvironment: { VITE_SUPABASE_URL: 'https://pjforfvchygdyqfcgpmw.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_fixture_key_0000000000000' },
      releaseId: 'trading-fx-profile-source-review', prerequisites: { adapter, adapterDigest: digestPatch, plan: { ...plan, ...planPatch } },
    }, { sourcePublicationOnly: true });
  const check = (patch, candidateSha = repair.sourceCommit) => verifySalesforceReviewSource({
    cwd, candidateSha, manifest: manifestFor(patch), verifierDirectory,
  });
  const result = check();
  assert.equal(result.candidateSha, repair.sourceCommit);
  assert.equal(result.applicationCandidateSha, applicationSha);
  assert.equal(result.salesforceFingerprint, reviewed.fingerprint);
  assert.equal(result.correctionSourceTreeHash, repair.sourceTreeHash);
  assert.equal(result.correctionFingerprint, repair.correctionFingerprint);
  assert.throws(() => check({ candidatePatch: { sourceDigest: digest('different app bytes') } }), { code: 'SALESFORCE_REVIEW_SOURCE_MISMATCH' });
  assert.throws(() => check({ digestPatch: digest('different adapter') }), { code: 'SALESFORCE_REVIEW_SOURCE_ADAPTER_MISMATCH' });
  assert.throws(() => check({ planPatch: { salesSupportRepair: { ...repair, sourceTreeHash: digest('different overlay bytes') } } }),
    { code: 'TRADING_FX_SALES_SUPPORT_SOURCE_BINDING_CHANGED' });
  assert.throws(() => check({}, '1'.repeat(40)), { code: 'SALESFORCE_REVIEW_CORRECTION_SCOPE_MISMATCH' });
  const ignored = join(cwd, 'force-app/main/default/.DS_Store');
  try {
    writeFileSync(ignored, 'ignored metadata');
    assert.throws(check, { code: 'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT' });
  } finally {
    rmSync(ignored, { force: true });
  }
});
