import assert from 'node:assert/strict';
import test from 'node:test';
import { projectTradingFxSalesSupportProfile, normalizeTradingFxDeniedProfile } from '../scripts/lib/rapid-release/trading-fx-production-inventory.mjs';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import {
  salesSupportFieldSnapshot, salesSupportFinalFormulaFields, salesSupportRepairFields, salesSupportViewAllFieldsRepairPackage,
} from '../scripts/lib/rapid-release/trading-fx-sales-support-repair.mjs';

const mode = 'after-final-view-all-fields-correction';
const fieldRow = field => '    <fieldPermissions>\n        <editable>false</editable>\n'
  + '        <field>' + field + '</field>\n        <readable>false</readable>\n    </fieldPermissions>\n';

test('only the final projection accounts for two exact serialized formula denials', () => {
  const xml = salesSupportViewAllFieldsRepairPackage().profile;
  const added = salesSupportFinalFormulaFields.map(fieldRow).join('');
  const native = Buffer.from(xml.replace('    <objectPermissions>', added + '    <objectPermissions>'));
  const projected = projectTradingFxSalesSupportProfile(native, mode);
  assert.ok(projected);
  assert.equal(projected.toString(), projectTradingFxSalesSupportProfile(Buffer.from(xml),
    'after-view-all-fields-correction').toString());
  assert.equal(projectTradingFxSalesSupportProfile(Buffer.from(xml), mode), null);
  const grant = native.toString().replace(fieldRow(salesSupportFinalFormulaFields[0]),
    fieldRow(salesSupportFinalFormulaFields[0]).replace('<readable>false', '<readable>true'));
  assert.equal(projectTradingFxSalesSupportProfile(Buffer.from(grant), mode), null);
  assert.equal(normalizeTradingFxDeniedProfile(native, { sha256: digest(projected), size: projected.length }, mode), null);
});

test('native final catalog verifies both new formulas and retains any other new grant in the ordinary comparison', () => {
  const parentId = '0PS123456789012ABC';
  const row = (Field, PermissionsRead = false, PermissionsEdit = false) => ({ Field, PermissionsRead, PermissionsEdit, ParentId: parentId });
  const original = [row(salesSupportRepairFields[0]), row('Payment__c.Other__c', true)];
  const snapshot = rows => salesSupportFieldSnapshot({ rows, done: true, parentId, finalPackageApplied: true });
  assert.deepEqual(snapshot(original), snapshot([...original, ...salesSupportFinalFormulaFields.map(field => row(field))]));
  assert.throws(() => snapshot([...original, row(salesSupportFinalFormulaFields[0], true)]), /FINAL_FORMULA_DENIAL_UNVERIFIED/u);
  const changed = snapshot([...original, row('Payment__c.Carrying_Adjustment_USD__c', true)]);
  assert.equal(changed.unrelatedCount, snapshot(original).unrelatedCount + 1);
  assert.notEqual(changed.unrelatedDigest, snapshot(original).unrelatedDigest);
  const payment = rows => salesSupportFieldSnapshot({ rows, done: true, parentId, paymentAdjustmentDenied: true });
  assert.deepEqual(payment([...original, row('Payment__c.Carrying_Adjustment_USD__c')]), payment(original));
  assert.throws(() => payment([...original, row('Payment__c.Carrying_Adjustment_USD__c', true)]), /PAYMENT_DENIAL_UNVERIFIED/u);
});
