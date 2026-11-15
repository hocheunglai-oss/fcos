import { digest, requireCondition } from './contract.mjs';

export const salesSupportProfile = 'Sales Support';
export const fieldBoundDenialDigests = Object.freeze({
  fieldBoundPackageSha256: 'a4fdb1289fdc2f76e36e15d0e8953a1fe7d428755bbe633e00388de020bb0527',
  fieldBoundManifestDigest: 'ed26fbb48118795d0e4a5900c6bb24c5d2bfe52712c0a5265eaa6a54a00e33cc',
});
const extraCostFields = [
  ...['Buy', 'Sell'].flatMap(side => [
    'Currency', 'FX_Confirmed_At', 'FX_Rate', 'FX_Revision', 'FX_Side',
    'HKD_Lumpsum', 'HKD_Minimum', 'HKD_Unit_Price', 'USD_Unit_Price_Precise',
  ].map(name => side + '_' + name)),
  'Buy_Agent_Currency_Pending', 'Reissue_Of_Buyer_Invoice', 'Reissue_Of_Supplier_Invoice',
].map(name => 'STEM_Extra_Cost__c.' + name + '__c');

export const salesSupportRepairFields = Object.freeze([
  ...extraCostFields,
  'STEM__c.Sell_Currency__c',
  'STEM__c.Sell_FX_Side__c',
].sort());
export const salesSupportPaymentAdjustmentField = 'Payment__c.Carrying_Adjustment_USD__c';
export const salesSupportFinalFormulaFields = Object.freeze([
  'STEM__c.Payable_FX_Adjustment_USD__c',
  'STEM__c.Receivable_FX_Adjustment_USD__c',
]);
export const salesSupportViewAllFieldsObjects = Object.freeze(['STEM_Extra_Cost__c', 'STEM__c']);

export function salesSupportRepairPackage() {
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const namespace = ' xmlns="http://soap.sforce.com/2006/04/metadata"';
  const permissions = salesSupportRepairFields.map(field =>
    '    <fieldPermissions>\n        <editable>false</editable>\n'
    + '        <field>' + field + '</field>\n        <readable>false</readable>\n    </fieldPermissions>\n').join('');
  const profile = header + '<Profile' + namespace + '>\n' + permissions + '</Profile>\n';
  const manifest = header + '<Package' + namespace + '>\n    <types>\n'
    + '        <members>Sales Support</members>\n        <name>Profile</name>\n'
    + '    </types>\n    <version>67.0</version>\n</Package>\n';
  return { profile, manifest, profileDigest: digest(profile), manifestDigest: digest(manifest) };
}

export function salesSupportViewAllFieldsRepairPackage() {
  const packet = salesSupportRepairPackage();
  const objectPermissions = salesSupportViewAllFieldsObjects.map(object => `    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowDelete>true</allowDelete>
        <allowEdit>true</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>true</modifyAllRecords>
        <object>${object}</object>
        <viewAllFields>false</viewAllFields>
        <viewAllRecords>true</viewAllRecords>
    </objectPermissions>
`).join('');
  const profile = packet.profile.replace('</Profile>', objectPermissions + '</Profile>');
  return { ...packet, profile, profileDigest: digest(profile) };
}

// The native caller must pin the org and confirm ParentId is the single
// PermissionSet Salesforce generates for the Sales Support profile.
export function salesSupportFieldSnapshot({ rows, done, parentId, finalPackageApplied = false }) {
  requireCondition(done === true && Array.isArray(rows) && /^[A-Za-z0-9]{18}$/u.test(parentId),
    'TRADING_FX_SALES_SUPPORT_CATALOG_INCOMPLETE');
  const reviewed = new Set(salesSupportRepairFields);
  const fields = new Map();
  for (const row of rows) {
    requireCondition(row.ParentId === parentId && typeof row.Field === 'string' && !fields.has(row.Field)
      && typeof row.PermissionsRead === 'boolean' && typeof row.PermissionsEdit === 'boolean',
    'TRADING_FX_SALES_SUPPORT_CATALOG_INVALID');
    fields.set(row.Field, { read: row.PermissionsRead, edit: row.PermissionsEdit });
  }
  if (finalPackageApplied) {
    for (const field of salesSupportFinalFormulaFields) {
      const grant = fields.get(field);
      requireCondition(!grant || (grant.read === false && grant.edit === false), 'TRADING_FX_SALES_SUPPORT_FINAL_FORMULA_DENIAL_UNVERIFIED');
      fields.delete(field);
    }
  }
  const unchangedRows = [...fields].filter(([field]) => !reviewed.has(field)).sort(([a], [b]) => a.localeCompare(b));
  const target = salesSupportRepairFields.map(field => ({ field, ...(fields.get(field) || { read: false, edit: false }) }));
  return { target, unrelatedDigest: digest(unchangedRows), unrelatedCount: unchangedRows.length };
}

export function assertSalesSupportRepair({ before, after, expectedPreimage }) {
  requireCondition(['denied', 'unexpected-projected-reads'].includes(expectedPreimage),
    'TRADING_FX_SALES_SUPPORT_PREIMAGE_REQUIRED');
  requireCondition(Array.isArray(before?.target) && Array.isArray(after?.target)
    && before.target.length === salesSupportRepairFields.length && after.target.length === salesSupportRepairFields.length
    && /^[a-f0-9]{64}$/u.test(before.unrelatedDigest) && before.unrelatedDigest === after.unrelatedDigest
    && Number.isSafeInteger(before.unrelatedCount) && before.unrelatedCount >= 0 && before.unrelatedCount === after.unrelatedCount,
  'TRADING_FX_SALES_SUPPORT_UNRELATED_GRANTS_CHANGED');
  const expectedRead = expectedPreimage === 'unexpected-projected-reads';
  requireCondition(salesSupportRepairFields.every((field, i) =>
    before.target[i]?.field === field && before.target[i].read === expectedRead && before.target[i].edit === false
    && after.target[i]?.field === field && after.target[i].read === false && after.target[i].edit === false),
  'TRADING_FX_SALES_SUPPORT_DENY_UNVERIFIED');
  return { fields: salesSupportRepairFields.length, unrelatedDigest: after.unrelatedDigest, verified: true };
}
