import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fcosSalesforceEnvironment, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { NOM_B_PRINCIPAL_SCHEMA_KIND, validateNomBPrincipalSchemaContract, compareNomBPrincipalSchema } from '../scripts/lib/hosted-release/nom-b-principal-schema.mjs';

const clone = value => structuredClone(value), hash = value => createHash('sha256').update(value).digest('hex');
const originalRecipeSha256 = 'a'.repeat(64), permissionRecipeSha256 = 'b'.repeat(64), devee = fcosSalesforceEnvironment('devee');
const readerBinding = { orgId: devee.orgId, username: fcosConnectionIdentifier('salesforce', 'Hosted DEVEE read-only username'),
  userId: '005000000000001AAA', profileId: '00e000000000001AAA', instanceUrl: devee.instanceUrl, isSandbox: true, apiVersion: 'v67.0',
  providerPermissionMode: 'provider_business_data_read_only', authenticationProtocol: 'client_credentials', permissionRecipeSha256 };
const identityKeys = ['orgId', 'username', 'userId', 'profileId', 'instanceUrl', 'isSandbox', 'apiVersion'];
const contract = { schemaVersion: 1, kind: NOM_B_PRINCIPAL_SCHEMA_KIND,
  readerIdentity: Object.fromEntries(identityKeys.map(key => [key, readerBinding[key]])), originalRecipeSha256, permissionRecipeSha256 };
const baseline = () => ({ name: 'Nomination__c', createable: true, updateable: true, deletable: true, undeletable: true,
  queryable: true, label: 'Nomination', fields: [
    { name: 'Name', type: 'string', createable: true, updateable: true, referenceTo: [], length: 80 },
    { name: 'Link__c', type: 'reference', createable: true, updateable: true, referenceTo: ['STEM__c', 'Nomination__c'], relationshipName: 'Link__r' },
    { name: 'Formula__c', type: 'string', createable: false, updateable: false, referenceTo: [], calculated: true },
  ], childRelationships: [{ childSObject: 'STEM__c', field: 'Nomination__c', restrictedDelete: false }],
  recordTypeInfos: [{ name: 'Master', available: true, defaultRecordTypeMapping: true }], nested: { createable: true } });
const readonly = original => ({ ...clone(original), createable: false, updateable: false, deletable: false, undeletable: false });
const compare = (originalDescriptor = baseline(), currentDescriptor = readonly(originalDescriptor), options = {}) =>
  compareNomBPrincipalSchema({ contract, readerBinding, originalRecipeSha256, originalDescriptor, currentDescriptor, ...options });
const refuses = (callback, code) => assert.throws(callback, error => error.code === code);

test('explicit versioned opt-in and separate immutable identity/recipe pins are required', () => {
  assert.deepEqual(validateNomBPrincipalSchemaContract(contract, { readerBinding, originalRecipeSha256 }), contract);
  for (const mutate of [c => { c.schemaVersion = 2; }, c => { c.kind += '-other'; }, c => { c.allowedPaths = ['/**']; }, c => { c.fresh = true; }]) {
    const changed = clone(contract); mutate(changed);
    refuses(() => compare(undefined, undefined, { contract: changed }), 'NOM_B_PRINCIPAL_CONTRACT_REQUIRED');
  }
  for (const mutate of [c => { c.originalRecipeSha256 = 'c'.repeat(64); }, c => { c.permissionRecipeSha256 = 'c'.repeat(64); }]) {
    const changed = clone(contract); mutate(changed);
    refuses(() => compare(undefined, undefined, { contract: changed }), 'NOM_B_PRINCIPAL_RECIPE_BINDING_REQUIRED');
  }
  refuses(() => compare(undefined, undefined, { originalRecipeSha256: 'c'.repeat(64) }), 'NOM_B_PRINCIPAL_RECIPE_BINDING_REQUIRED');
  assert.throws(() => compareNomBPrincipalSchema());
});

test('admin, other user/profile/org, different protocol and permission mode cannot replace the bound reader', () => {
  for (const [key, value] of [['username', devee.username], ['userId', '005000000000002AAA'], ['profileId', '00e000000000002AAA'],
    ['orgId', '00D000000000002AAA'], ['instanceUrl', 'https://example.invalid'], ['apiVersion', 'v68.0'], ['isSandbox', false],
    ['authenticationProtocol', 'jwt-bearer'], ['providerPermissionMode', 'provider_wide_read_only']]) {
    refuses(() => compare(undefined, undefined, { readerBinding: { ...readerBinding, [key]: value } }), 'NOM_B_PRINCIPAL_IDENTITY_REQUIRED');
  }
});

test('root CRUD downgrade is allowed while equal field FLS edit flags remain visible and unchanged', () => {
  const original = baseline(), current = readonly(original), result = compare(original, current);
  assert.equal(current.fields[0].updateable, true);
  assert.equal(result.currentDescriptor.fields[0].updateable, true);
  assert.deepEqual(result.allowedChangedPaths, ['/createable', '/deletable', '/undeletable', '/updateable']);
  assert.deepEqual(result.legacyComparableDescriptor, original);
  assert.notEqual(result.currentDescriptorSha256, result.originalDescriptorSha256);
  assert.equal(result.legacyComparableDescriptorSha256, result.originalDescriptorSha256);
  assert.notEqual(result.comparisonSha256, result.originalDescriptorSha256);
  assert.equal(result.authorityGranted, false); assert.equal(result.qualificationProven, false);
  assert.equal(result.freshPrincipalValidationPerformed, false); assert.equal(result.requiresVerifiedFreshReadOnlyPrincipalContext, true);
});

test('only exact direct field capability paths can additionally downgrade true to false', () => {
  const original = baseline(), current = readonly(original); current.fields[0].createable = false; current.fields[1].updateable = false;
  const result = compare(original, current);
  assert.deepEqual(result.allowedChangedPaths, ['/createable', '/deletable', '/fields/0/createable', '/fields/1/updateable', '/undeletable', '/updateable']);
  assert.deepEqual(result.legacyComparableDescriptor, original);
  assert.equal(result.currentDescriptor.fields[0].createable, false);
});

test('a fully unchanged descriptor is comparable only when all object CRUD flags are already false', () => {
  const original = readonly(baseline()), result = compare(original, clone(original));
  assert.deepEqual(result.allowedChangedPaths, []); assert.equal(result.originalDescriptorSha256, result.currentDescriptorSha256);
  for (const key of ['createable', 'updateable', 'deletable', 'undeletable']) {
    const current = readonly(baseline()); current[key] = true;
    refuses(() => compare(baseline(), current), 'NOM_B_SCHEMA_OBJECT_WRITES_FORBIDDEN');
  }
});

test('false to true field capability changes are never normalized away', () => {
  for (const key of ['createable', 'updateable']) {
    const original = baseline(), current = readonly(original); current.fields[2][key] = true;
    refuses(() => compare(original, current), 'NOM_B_SCHEMA_CAPABILITY_CHANGE_FORBIDDEN');
  }
});

test('schema omissions/additions/type, relationships, order, record types and unknown changes all refuse', () => {
  const mutations = [
    d => { d.fields.pop(); }, d => { d.fields.push({ ...d.fields[0], name: 'Additional__c' }); },
    d => { d.fields[0].type = 'textarea'; }, d => { d.fields[0].length = 81; }, d => { d.fields.reverse(); },
    d => { d.fields[1].referenceTo.reverse(); }, d => { d.fields[1].relationshipName = 'Other__r'; },
    d => { d.childRelationships[0].field = 'Other__c'; }, d => { d.recordTypeInfos[0].available = false; },
    d => { d.queryable = false; }, d => { d.unreviewed = true; }, d => { delete d.label; },
    d => { d.nested.createable = false; }, d => { d.fields[0].nested = { updateable: false }; },
  ];
  for (const mutate of mutations) { const original = baseline(), current = readonly(original); mutate(current);
    refuses(() => compare(original, current), 'NOM_B_SCHEMA_STRUCTURE_CHANGED'); }
});

test('all arrays retain exact ordering, including child relationships and record types', () => {
  for (const key of ['childRelationships', 'recordTypeInfos']) {
    const original = baseline(); original[key].push({ ...clone(original[key][0]), name: 'Second', field: 'Other__c' });
    const current = readonly(original); current[key].reverse();
    refuses(() => compare(original, current), 'NOM_B_SCHEMA_STRUCTURE_CHANGED');
  }
});

test('invalid/missing capability types, duplicate fields and unsupported objects refuse', () => {
  for (const mutate of [d => { delete d.undeletable; }, d => { d.createable = 0; }, d => { delete d.fields[0].updateable; },
    d => { d.fields[0].createable = 'false'; }, d => { d.fields[1].name = d.fields[0].name; }, d => { d.name = 'Other__c'; }]) {
    const current = readonly(baseline()); mutate(current);
    refuses(() => compare(baseline(), current), 'NOM_B_SCHEMA_DESCRIPTOR_REQUIRED');
  }
});

test('non-JSON values, accessors, cycles, holes and oversized descriptors cannot evade hashing', () => {
  for (const mutate of [d => { d.extra = undefined; }, d => { d.extra = NaN; }, d => { d.extra = d; },
    d => { delete d.fields[0]; }, d => { Object.defineProperty(d, 'getter', { enumerable: true, get() { throw Error('SHOULD_NOT_RUN'); } }); }]) {
    const current = readonly(baseline()); mutate(current);
    refuses(() => compare(baseline(), current), 'NOM_B_SCHEMA_JSON_REQUIRED');
  }
  const current = readonly(baseline()); current.extra = 'x'.repeat(4 * 1024 * 1024);
  refuses(() => compare(baseline(), current), 'NOM_B_SCHEMA_DATA_LIMIT');
});

test('input descriptors and contract are immutable in success/failure; outputs cannot alias or mutate them', () => {
  const original = baseline(), current = readonly(original), before = JSON.stringify({ original, current, contract, readerBinding });
  const result = compare(original, current);
  assert.equal(JSON.stringify({ original, current, contract, readerBinding }), before);
  assert.notStrictEqual(result.originalDescriptor, original); assert.notStrictEqual(result.currentDescriptor, current);
  assert.notStrictEqual(result.legacyComparableDescriptor.fields, original.fields);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.currentDescriptor.fields[0]));
  assert.throws(() => { result.currentDescriptor.fields[0].type = 'changed'; });
  const invalid = readonly(original); invalid.label = 'changed'; const snapshot = JSON.stringify(invalid);
  assert.throws(() => compare(original, invalid)); assert.equal(JSON.stringify(invalid), snapshot);
});

test('comparison is deterministic and does not accept a caller freshness boolean as authentication', () => {
  assert.deepEqual(compare(), compare());
  const result = compareNomBPrincipalSchema({ contract, readerBinding, originalRecipeSha256,
    originalDescriptor: baseline(), currentDescriptor: readonly(baseline()), verifiedFreshReadOnlyPrincipal: true });
  assert.equal(result.freshPrincipalValidationPerformed, false); assert.equal(result.requiresVerifiedFreshReadOnlyPrincipalContext, true);
});

// Private full admin receipts are retained outside public test fixtures. These
// tests never call a provider and explicitly make no hosted-reader observation.
const privateDirectory = process.env.FCOS_NOM_B_SCHEMA_FIXTURE_DIRECTORY
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '../outputs/nomb-principal-contract-PREPARED/private-fixtures');
for (const name of ['Nomination__c', 'STEM__c', 'ContentVersion']) test(`preserved full ${name} descriptor: exact comparison and raw-history immutability`, t => {
  const inventory = path.join(privateDirectory, 'inventory.json');
  if (!fs.existsSync(inventory)) { t.skip('Private preserved receipts require the reviewed local fixture directory'); return; }
  const row = JSON.parse(fs.readFileSync(inventory)).receipts.find(item => item.objectName === name);
  assert.ok(row); const receiptPath = path.join(privateDirectory, row.file), raw = fs.readFileSync(receiptPath);
  assert.equal(hash(raw), row.sha256); const original = JSON.parse(raw).body; assert.equal(original.name, name);
  const current = readonly(original), rootOnly = compare(original, current);
  assert.equal(rootOnly.originalDescriptorSha256, row.observedDescriptorSha256);
  assert.deepEqual(rootOnly.originalDescriptor, original); assert.deepEqual(rootOnly.currentDescriptor, current);
  assert.deepEqual(rootOnly.legacyComparableDescriptor, original);
  const expected = ['createable', 'deletable', 'undeletable', 'updateable'].filter(key => original[key]).map(key => '/' + key);
  assert.deepEqual(rootOnly.allowedChangedPaths, expected);
  const fieldIndex = original.fields.findIndex(field => field.createable === true || field.updateable === true);
  assert.ok(fieldIndex >= 0); const flag = original.fields[fieldIndex].createable ? 'createable' : 'updateable';
  current.fields[fieldIndex][flag] = false; const reduced = compare(original, current);
  assert.ok(reduced.allowedChangedPaths.includes(`/fields/${fieldIndex}/${flag}`));
  const invalid = readonly(original); invalid.fields[0].type = 'UNREVIEWED'; assert.throws(() => compare(original, invalid));
  assert.equal(hash(fs.readFileSync(receiptPath)), row.sha256); assert.equal(hash(raw), row.sha256);
  assert.equal(reduced.qualificationProven, false); assert.equal(reduced.authorityGranted, false);
});
