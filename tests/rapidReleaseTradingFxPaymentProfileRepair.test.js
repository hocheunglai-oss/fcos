import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import {
  assertPaymentSalesSupportRepairBinding, paymentSalesSupportObjectPermissions,
  paymentSalesSupportRepairPackage, paymentSalesSupportRepairSourceProfile,
} from '../scripts/lib/rapid-release/trading-fx-payment-profile-repair.mjs';
import { salesSupportRepairSourceProfile } from '../scripts/lib/rapid-release/trading-fx-sales-support-source.mjs';
import { parseReviewedPackage } from '../scripts/lib/salesforce-reviewed-release.mjs';

const asBinding = values => ({ ...values, correctionFingerprint: digest(values) });
const profileFile = new URL('../force-app/main/default/profiles/Sales Support.profile-meta.xml', import.meta.url);
const fieldDenial = `    <fieldPermissions>
        <editable>false</editable>
        <field>Payment__c.Carrying_Adjustment_USD__c</field>
        <readable>false</readable>
    </fieldPermissions>
`;
const paymentObject = `    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowDelete>true</allowDelete>
        <allowEdit>true</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>true</modifyAllRecords>
        <object>Payment__c</object>
        <viewAllFields>false</viewAllFields>
        <viewAllRecords>true</viewAllRecords>
    </objectPermissions>
`;

test('Payment correction packet changes only the Sales Support field denial and Payment View All Fields', () => {
  const packet = paymentSalesSupportRepairPackage();
  assert.deepEqual(parseReviewedPackage(packet.manifest, { inventory: true }), ['Profile:Sales Support']);
  assert.equal(packet.profile, '<?xml version="1.0" encoding="UTF-8"?>\n<Profile xmlns="http://soap.sforce.com/2006/04/metadata">\n'
    + fieldDenial + paymentObject + '</Profile>\n');
  assert.equal(packet.profileDigest, '210eb1293d62a9da33e9725c41584dd35277637bf2fcbb7706d8bb648ec9840e');
  assert.equal(packet.manifestDigest, '85ea97f7edebcc629d9c8615b44bc169df7a11247a57d8d4725bb433ebd6453a');
  assert.deepEqual(paymentSalesSupportObjectPermissions, {
    SobjectType: 'Payment__c', PermissionsCreate: true, PermissionsDelete: true, PermissionsEdit: true, PermissionsRead: true,
    PermissionsModifyAllRecords: true, PermissionsViewAllRecords: true,
  });
});

test('preserves the entire original corrected Profile alongside the two new blocks', () => {
  const original = salesSupportRepairSourceProfile(readFileSync(profileFile, 'utf8'), { viewAllFieldsCorrection: true });
  const changed = paymentSalesSupportRepairSourceProfile(original);
  assert.equal(changed.split(fieldDenial).length, 2);
  assert.equal(changed.split(paymentObject).length, 2);
  assert.equal(changed.replace(fieldDenial, '').replace(paymentObject, ''), original);
  assert.throws(() => paymentSalesSupportRepairSourceProfile(changed), /TRADING_FX_PAYMENT_PROFILE_PREIMAGE_CHANGED/);
  assert.throws(() => paymentSalesSupportRepairSourceProfile(original.replace('<viewAllFields>false', '<viewAllFields>true')),
    /TRADING_FX_PAYMENT_PROFILE_PREIMAGE_CHANGED/);
});

test('Payment correction binding rejects different package bytes and expanded plan fields', () => {
  const packet = paymentSalesSupportRepairPackage();
  const fields = { sourceCommit: 'a'.repeat(40), sourceTreeHash: 'b'.repeat(64), sourceProfileDigest: 'c'.repeat(64),
    profileDigest: packet.profileDigest, manifestDigest: packet.manifestDigest };
  const binding = asBinding(fields);
  assert.equal(assertPaymentSalesSupportRepairBinding(binding), binding);
  for (const altered of [asBinding({ ...fields, profileDigest: '1'.repeat(64) }),
    asBinding({ ...fields, manifestDigest: '2'.repeat(64) }), asBinding({ ...fields, secondObject: 'Account' }),
    asBinding({ ...fields, sourceCommit: 'main' }), { ...binding, sourceTreeHash: '3'.repeat(64) }]) {
    assert.throws(() => assertPaymentSalesSupportRepairBinding(altered), /TRADING_FX_PAYMENT_PROFILE_BINDING_CHANGED/);
  }
});
