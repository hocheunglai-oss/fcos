import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expectedManifest, sourceInventory } from '../scripts/sync-salesforce-shared-repository.mjs';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

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
  assert.doesNotMatch(JSON.stringify(manifest.files.filter((file) => file !== 'objects/Xero_Contact_Sync_Setting__c/fields/Signing_Secret__c.field-meta.xml')), /token|password|credential|secret/i);
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
  assert.match(source, /MODE === 'check'.*PUBLICATION\.defaultBranch/s);
  assert.doesNotMatch(source, /remoteBranchHead\(PUBLICATION\.activeBranch\).*PUBLICATION\.activeBranch/s);
});

test('existing shared publication branches are resumed without corrupting the JSON promotion contract', async () => {
  const source = await readFile(new URL('../scripts/sync-salesforce-shared-repository.mjs', import.meta.url), 'utf8');
  assert.match(source, /MODE === 'publish' && !existsRemotely \? PUBLICATION\.defaultBranch : branch/);
  assert.match(source, /MODE === 'publish' && !existsRemotely\) run\('git', \['switch', '-c', branch\]/);
  assert.match(source, /run\('git', pushArgs, \{ cwd: checkout \}\)/);
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
  const workflow = await readFile(new URL('../scripts/salesforce-workflow-state.mjs', import.meta.url), 'utf8');
  assert.match(mirror, /assertDeveeDeploymentProof\(inventory\)/);
  assert.match(mirror, /deployment\?\.result\?\.status !== 'Succeeded'/);
  assert.match(workflow, /record\?\.environment !== 'devee'/);
  assert.match(workflow, /record\?\.sourceTreeHash !== sourceTreeHash/);
  assert.match(workflow, /sourceStateMaximumAgeSeconds/);
});
