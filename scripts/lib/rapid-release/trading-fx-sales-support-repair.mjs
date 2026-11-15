import { digest, requireCondition } from './contract.mjs';

export const salesSupportProfile = 'Sales Support';
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

// The native caller must pin the org and confirm ParentId is the single
// PermissionSet Salesforce generates for the Sales Support profile.
export function salesSupportFieldSnapshot({ rows, done, parentId }) {
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
