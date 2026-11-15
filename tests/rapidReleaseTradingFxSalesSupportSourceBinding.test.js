import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import {
  fieldBoundDenialDigests, salesSupportRepairFields, salesSupportRepairPackage,
  salesSupportViewAllFieldsObjects, salesSupportViewAllFieldsRepairPackage,
} from '../scripts/lib/rapid-release/trading-fx-sales-support-repair.mjs';
import { assertSalesSupportRepairBinding } from '../scripts/lib/rapid-release/trading-fx-sales-support-source.mjs';

const source = {
  sourceCommit: 'b'.repeat(40),
  sourceTreeHash: digest('reviewed Salesforce tree'),
  sourceProfileDigest: digest('reviewed complete profile'),
};

function binding(packet, variant = {}) {
  const { profileDigest, manifestDigest } = packet;
  const body = { ...source, profileDigest, manifestDigest, ...variant };
  return { ...body, correctionFingerprint: digest(body) };
}

test('compiles exactly 23 field denies followed by two View All Fields denials in a Profile-only package', () => {
  const packet = salesSupportViewAllFieldsRepairPackage();
  const legacy = salesSupportRepairPackage();
  const rows = [...packet.profile.matchAll(/    <objectPermissions>\n([\s\S]*?)    <\/objectPermissions>\n/gu)];
  assert.deepEqual(salesSupportViewAllFieldsObjects, ['STEM_Extra_Cost__c', 'STEM__c']);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].index > packet.profile.lastIndexOf('</fieldPermissions>'));
  for (const [index, [, row]] of rows.entries()) {
    const properties = Object.fromEntries([...row.matchAll(/<([A-Za-z]+)>([^<]+)<\/\1>/gu)]
      .map(([, key, value]) => [key, value]));
    assert.deepEqual(properties, {
      allowCreate: 'true', allowDelete: 'true', allowEdit: 'true', allowRead: 'true', modifyAllRecords: 'true',
      object: salesSupportViewAllFieldsObjects[index], viewAllFields: 'false', viewAllRecords: 'true',
    });
  }
  const fields = [...packet.profile.matchAll(/<field>([^<]+)<\/field>/gu)].map(([, field]) => field);
  assert.deepEqual(fields, salesSupportRepairFields);
  assert.equal(fields.length, 23);
  assert.equal(packet.profile.replace(rows.map(([row]) => row).join(''), ''), legacy.profile);
  assert.equal(packet.manifest, legacy.manifest);
  assert.equal(packet.profileDigest, '6e3118491d95f1ef9181cfdbdd1498b41219507c54884380c6b627d0af1355c2');
  assert.equal(packet.manifestDigest, '85ea97f7edebcc629d9c8615b44bc169df7a11247a57d8d4725bb433ebd6453a');
});

test('binds each metadata package to exactly its declared correction variant', () => {
  const original = salesSupportRepairPackage();
  const viewAllFields = salesSupportViewAllFieldsRepairPackage();
  for (const repair of [
    binding(original), binding(original, fieldBoundDenialDigests), binding(viewAllFields, { viewAllFieldsCorrection: true }),
  ]) {
    assert.equal(assertSalesSupportRepairBinding(repair), repair);
  }
  for (const repair of [
    binding(viewAllFields),
    binding(original, { viewAllFieldsCorrection: true }),
    binding(viewAllFields, { viewAllFieldsCorrection: false }),
    binding(viewAllFields, { viewAllFieldsCorrection: 'true' }),
    binding(original, { viewAllFieldsCorrection: undefined }),
    binding(viewAllFields, { viewAllFieldsCorrection: true, ...fieldBoundDenialDigests }),
    binding(viewAllFields, { viewAllFieldsCorrection: true, fieldBoundPackageSha256: undefined }),
    binding(original, { fieldBoundManifestDigest: fieldBoundDenialDigests.fieldBoundManifestDigest }),
    binding(viewAllFields, { viewAllFieldsCorrection: true, additionalObject: 'STEM_Fixture__c' }),
    { ...binding(viewAllFields, { viewAllFieldsCorrection: true }), correctionFingerprint: digest('unbound fingerprint') },
  ]) {
    assert.throws(() => assertSalesSupportRepairBinding(repair), /TRADING_FX_SALES_SUPPORT_SOURCE_BINDING_CHANGED/u);
  }
});
