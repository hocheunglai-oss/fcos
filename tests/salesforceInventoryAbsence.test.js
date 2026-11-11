import assert from 'node:assert/strict';
import test from 'node:test';
import { proveSalesforceInventoryAbsence } from '../scripts/lib/salesforce-inventory-absence.mjs';

const expectedAbsentComponents = ['ApexClass:Missing', 'CustomObject:Missing__c', 'CustomField:Missing__c.Amount__c',
  'CustomField:Known__c.Amount__c', 'ValidationRule:Known__c.MissingRule', 'PermissionSet:Missing'];
const presentComponents = ['ApexClass:Present', 'CustomObject:Known__c', 'CustomField:Known__c.Control__c',
  'ValidationRule:Known__c.ControlRule', 'PermissionSet:Present'];
const parent = '01I000000000001AAA';

function fixture({ catalog = {}, truncated = false } = {}) {
  const calls = [];
  const query = (soql, tooling) => {
    calls.push({ soql, tooling });
    const [, type] = / FROM (\w+) WHERE /u.exec(soql);
    const records = catalog[type] || {
      ApexClass: [{ Name: 'Present' }],
      CustomObject: [{ Id: parent, DeveloperName: 'Known' }],
      CustomField: [{ DeveloperName: 'Control', TableEnumOrId: parent }],
      ValidationRule: [{ ValidationName: 'ControlRule', EntityDefinitionId: parent.slice(0, 15) },
        { ValidationName: 'MissingRule', EntityDefinitionId: '01I000000000002' }],
      PermissionSet: [{ Name: 'Present' }],
    }[type];
    return { records, totalSize: records.length, done: !truncated };
  };
  return { calls, verify: () => proveSalesforceInventoryAbsence({ expectedAbsentComponents, presentComponents, query }) };
}

test('native catalog proves absence by exact parent and name with positive controls', () => {
  const f = fixture();
  const proof = f.verify();
  assert.deepEqual(proof.absentComponents, expectedAbsentComponents);
  assert.equal(proof.absenceVerificationMethod, 'native-metadata-catalog');
  assert.match(proof.absenceEvidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls.find(({ soql }) => soql.includes(' FROM PermissionSet ')).tooling, false);
  const field = f.calls.find(({ soql }) => soql.includes(' FROM CustomField ')).soql;
  assert.match(field, /TableEnumOrId IN \('01I000000000001AAA'\)/u);
  assert.match(field, /'Amount','Control'/u);
});

test('catalog blocks metadata drift, an inaccessible control, and incomplete provider responses', () => {
  assert.throws(() => fixture({ catalog: { ValidationRule: [
    { ValidationName: 'ControlRule', EntityDefinitionId: parent.slice(0, 15) },
    { ValidationName: 'MissingRule', EntityDefinitionId: parent },
  ] } }).verify(), /expected absent metadata is present: ValidationRule:Known__c.MissingRule/);
  assert.throws(() => fixture({ catalog: { CustomField: [] } }).verify(), /failed its CustomField control/);
  assert.throws(() => fixture({ truncated: true }).verify(), /catalog response is incomplete/);
});
