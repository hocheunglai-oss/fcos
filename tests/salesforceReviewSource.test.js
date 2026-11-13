import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createManifest, digest, sourceSnapshot, validateManifest } from '../scripts/lib/rapid-release/contract.mjs';
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
  const check = (path = reviewPath, locator = {}) => {
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
    return verifySalesforceReviewSource({ cwd, candidateSha: candidate.sha, manifest, verifierDirectory: cwd });
  };
  assert.equal(check().candidateSha, git('rev-parse', 'HEAD'));
  assert.throws(() => check(reviewPath, { xeroQualificationDeploymentId: 1 }), { code: 'TRADING_FX_XERO_QUALIFICATION_LOCATOR_REQUIRED' });
  assert.equal(check(reviewPath, { xeroQualificationDeploymentId: 1, xeroQualificationDigest: 'a'.repeat(64) }).candidateSha, git('rev-parse', 'HEAD'));
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
