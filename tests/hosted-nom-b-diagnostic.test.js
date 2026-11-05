import test from 'node:test';
import assert from 'node:assert/strict';
import {safeNomBMeasurementDiagnostic} from '../scripts/lib/hosted-release/nom-b-diagnostic.mjs';

test('Nom B diagnostics retain a closed stage and cause, never private exception content', () => {
  const value = safeNomBMeasurementDiagnostic({ stage: 'METADATA_VALIDATION', cause: 'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED',
    object: 'STEM__c', readIndex: 6, message: 'private-token', url: 'https://private.invalid', body: { password: 'secret' } });
  assert.deepEqual(value, { stage: 'METADATA_VALIDATION', cause: 'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED', readIndex: 6, object: 'STEM__c' });
  assert.doesNotMatch(JSON.stringify(value), /private|password|secret/);
});

test('Unknown diagnostic names and out-of-range reads cannot enter a release artifact', () => {
  for (const readIndex of [-1, 16, 1.5, '0', Infinity]) assert.deepEqual(safeNomBMeasurementDiagnostic({
    stage: 'PRIVATE_TOKEN', cause: 'TOKEN_SECRET_ABC', object: 'private-account', readIndex }), { stage: 'RECIPE', cause: 'VALIDATION_REFUSED' });
  for (const stage of ['RECIPE','LEGACY_ARTIFACTS','SOURCE_BINDING','READER_SETUP','READER_ADMISSION','FILES','METADATA_READ','METADATA_VALIDATION','OBSERVATION_FINGERPRINT','RECEIPT']) {
    assert.equal(safeNomBMeasurementDiagnostic({ stage }).stage, stage);
  }
});
