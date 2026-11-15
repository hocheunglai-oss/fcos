import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSalesSupportRepair, salesSupportFieldSnapshot, salesSupportRepairFields, salesSupportRepairPackage,
} from '../scripts/lib/rapid-release/trading-fx-sales-support-repair.mjs';

const parentId = '0PS123456789012ABC';
const row = (Field, PermissionsRead, PermissionsEdit = false) =>
  ({ Field, PermissionsRead, PermissionsEdit, ParentId: parentId });
const unrelated = row('Account.Other__c', true, true);
const snapshot = (...rows) => salesSupportFieldSnapshot({ rows, done: true, parentId });

test('the scoped package matches the native check-only submission byte for byte', () => {
  const packet = salesSupportRepairPackage();
  assert.equal(packet.profileDigest, '03b415858374db416c71f81783c7880ba2f23d4952937b12cc09e9dedc7f4d9c');
  assert.equal(packet.manifestDigest, '85ea97f7edebcc629d9c8615b44bc169df7a11247a57d8d4725bb433ebd6453a');
  assert.equal(salesSupportRepairFields.length, 23);
});

test('accepts exact removal, including omitted or explicit false native rows', () => {
  const before = snapshot(unrelated, ...salesSupportRepairFields.map(field => row(field, true)));
  const after = snapshot(unrelated, row(salesSupportRepairFields[0], false));
  assert.equal(assertSalesSupportRepair({ before, after, expectedPreimage: 'unexpected-projected-reads' }).fields, 23);
});

test('rejects retained access, unrelated changes, and an unexpected preimage', () => {
  const before = snapshot(unrelated, ...salesSupportRepairFields.map(field => row(field, true)));
  const accept = after => assertSalesSupportRepair({ before, after, expectedPreimage: 'unexpected-projected-reads' });
  assert.throws(() => accept(snapshot(unrelated, row(salesSupportRepairFields[0], true))), /DENY_UNVERIFIED/u);
  assert.throws(() => accept(snapshot(row(unrelated.Field, false))), /UNRELATED_GRANTS_CHANGED/u);
  assert.throws(() => assertSalesSupportRepair({ before, after: snapshot(unrelated), expectedPreimage: 'denied' }), /DENY_UNVERIFIED/u);
});
