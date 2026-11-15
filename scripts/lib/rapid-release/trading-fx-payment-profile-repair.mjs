import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readReviewedInventory } from '../salesforce-reviewed-release.mjs';
import { digest, git, isDigest, isSha, requireCondition, sourceSnapshot } from './contract.mjs';
import { salesSupportPaymentAdjustmentField, salesSupportRepairPackage } from './trading-fx-sales-support-repair.mjs';

export const paymentSalesSupportRepairParent = 'b5beaefb6abddb861b110e21e07878e25bec940f';
export const paymentSalesSupportObjectPermissions = Object.freeze({
  SobjectType: 'Payment__c', PermissionsCreate: true, PermissionsDelete: true,
  PermissionsEdit: true, PermissionsRead: true, PermissionsModifyAllRecords: true, PermissionsViewAllRecords: true,
});

const metadataRoot = 'force-app/main/default';
const profilePath = `${metadataRoot}/profiles/Sales Support.profile-meta.xml`;
const baselineProfileDigest = '1209612078658de3268f9679bfd3507681f31c0400d8bdc0a27ad8d817255b0d';
const fieldPermissions = `    <fieldPermissions>
        <editable>false</editable>
        <field>${salesSupportPaymentAdjustmentField}</field>
        <readable>false</readable>
    </fieldPermissions>
`;
const objectPermissions = `    <objectPermissions>
        <allowCreate>${paymentSalesSupportObjectPermissions.PermissionsCreate}</allowCreate>
        <allowDelete>${paymentSalesSupportObjectPermissions.PermissionsDelete}</allowDelete>
        <allowEdit>${paymentSalesSupportObjectPermissions.PermissionsEdit}</allowEdit>
        <allowRead>${paymentSalesSupportObjectPermissions.PermissionsRead}</allowRead>
        <modifyAllRecords>${paymentSalesSupportObjectPermissions.PermissionsModifyAllRecords}</modifyAllRecords>
        <object>${paymentSalesSupportObjectPermissions.SobjectType}</object>
        <viewAllFields>false</viewAllFields>
        <viewAllRecords>${paymentSalesSupportObjectPermissions.PermissionsViewAllRecords}</viewAllRecords>
    </objectPermissions>
`;

export function paymentSalesSupportRepairPackage() {
  const { manifest, manifestDigest } = salesSupportRepairPackage();
  const profile = '<?xml version="1.0" encoding="UTF-8"?>\n<Profile xmlns="http://soap.sforce.com/2006/04/metadata">\n'
    + fieldPermissions + objectPermissions + '</Profile>\n';
  return { profile, manifest, profileDigest: digest(profile), manifestDigest };
}

export function paymentSalesSupportRepairSourceProfile(before) {
  requireCondition(typeof before === 'string' && digest(before) === baselineProfileDigest,
    'TRADING_FX_PAYMENT_PROFILE_PREIMAGE_CHANGED');
  const fieldAnchor = '    <fieldPermissions>\n';
  const objectAnchor = '    <objectPermissions>\n';
  return before.replace(fieldAnchor, fieldPermissions + fieldAnchor).replace(objectAnchor, objectPermissions + objectAnchor);
}

export function assertPaymentSalesSupportRepairBinding(repair) {
  const { sourceCommit, sourceTreeHash, sourceProfileDigest, profileDigest, manifestDigest, correctionFingerprint } = repair ?? {};
  const packet = paymentSalesSupportRepairPackage();
  const expected = { sourceCommit, sourceTreeHash, sourceProfileDigest, profileDigest, manifestDigest };
  requireCondition(isSha(sourceCommit) && isDigest(sourceTreeHash) && isDigest(sourceProfileDigest)
    && profileDigest === packet.profileDigest && manifestDigest === packet.manifestDigest && correctionFingerprint === digest(expected)
    && digest(repair ?? null) === digest({ ...expected, correctionFingerprint }), 'TRADING_FX_PAYMENT_PROFILE_BINDING_CHANGED');
  return repair;
}

export function verifyPaymentSalesSupportRepairSource({ cwd, repair }) {
  assertPaymentSalesSupportRepairBinding(repair);
  const { sha } = sourceSnapshot(cwd);
  requireCondition(!git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', metadataRoot]),
    'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT');
  requireCondition(sha === repair.sourceCommit
    && git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']) === `${sha} ${paymentSalesSupportRepairParent}`
    && git(cwd, ['diff', '--name-only', paymentSalesSupportRepairParent, 'HEAD']) === profilePath,
  'TRADING_FX_PAYMENT_PROFILE_SOURCE_SCOPE_CHANGED');
  const before = git(cwd, ['show', `${paymentSalesSupportRepairParent}:${profilePath}`]) + '\n';
  const current = readFileSync(join(cwd, profilePath), 'utf8');
  requireCondition(current === paymentSalesSupportRepairSourceProfile(before)
    && digest(current) === repair.sourceProfileDigest
    && readReviewedInventory(join(cwd, metadataRoot)).sourceTreeHash === repair.sourceTreeHash,
  'TRADING_FX_PAYMENT_PROFILE_BINDING_CHANGED');
  return repair;
}
