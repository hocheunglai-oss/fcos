import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, git, isDigest, isSha, requireCondition, sourceSnapshot } from './contract.mjs';
import { readReviewedInventory } from '../salesforce-reviewed-release.mjs';
import {
  fieldBoundDenialDigests, salesSupportRepairPackage, salesSupportViewAllFieldsRepairPackage,
} from './trading-fx-sales-support-repair.mjs';

const profilePath = 'force-app/main/default/profiles/Sales Support.profile-meta.xml';
const originalCommit = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
const originalProfileDigest = 'dc7e800589ac018a2aec55346d9734dadace8c3316bd6309b3c4171ad2b86a14';

export function salesSupportRepairSourceProfile(before, { viewAllFieldsCorrection = false } = {}) {
  requireCondition(digest(before) === originalProfileDigest, 'TRADING_FX_SALES_SUPPORT_SOURCE_PREIMAGE_CHANGED');
  const { profile } = viewAllFieldsCorrection ? salesSupportViewAllFieldsRepairPackage() : salesSupportRepairPackage();
  const entries = profile.split('\n').slice(2, -2).join('\n') + '\n';
  const anchor = '    <custom>true</custom>\n';
  requireCondition(before.split(anchor).length === 2, 'TRADING_FX_SALES_SUPPORT_SOURCE_PREIMAGE_CHANGED');
  return before.replace(anchor, anchor + entries);
}

export function assertSalesSupportRepairBinding(repair) {
  const input = repair ?? {};
  const { sourceCommit, sourceTreeHash, sourceProfileDigest, profileDigest, manifestDigest, correctionFingerprint } = input;
  const fieldBound = Object.hasOwn(input, 'fieldBoundPackageSha256') || Object.hasOwn(input, 'fieldBoundManifestDigest');
  const viewAllFields = Object.hasOwn(input, 'viewAllFieldsCorrection');
  requireCondition(!viewAllFields || (input.viewAllFieldsCorrection === true && !fieldBound),
    'TRADING_FX_SALES_SUPPORT_SOURCE_BINDING_CHANGED');
  const packet = viewAllFields ? salesSupportViewAllFieldsRepairPackage() : salesSupportRepairPackage();
  const expected = { sourceCommit, sourceTreeHash, sourceProfileDigest, profileDigest, manifestDigest,
    ...(fieldBound ? fieldBoundDenialDigests : {}),
    ...(viewAllFields ? { viewAllFieldsCorrection: true } : {}) };
  requireCondition(isSha(sourceCommit) && isDigest(sourceTreeHash) && isDigest(sourceProfileDigest)
    && profileDigest === packet.profileDigest && manifestDigest === packet.manifestDigest
    && correctionFingerprint === digest(expected)
    && digest(repair ?? null) === digest({ ...expected, correctionFingerprint }),
  'TRADING_FX_SALES_SUPPORT_SOURCE_BINDING_CHANGED');
  return repair;
}

export function verifySalesSupportRepairSource({ cwd, repair }) {
  assertSalesSupportRepairBinding(repair);
  const { sha: sourceCommit } = sourceSnapshot(cwd);
  requireCondition(!git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'force-app/main/default']),
    'SALESFORCE_REVIEW_SOURCE_UNTRACKED_INPUT');
  requireCondition(sourceCommit === repair.sourceCommit && git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']) === sourceCommit + ' ' + originalCommit
    && git(cwd, ['diff', '--name-only', originalCommit, 'HEAD']) === profilePath,
  'TRADING_FX_SALES_SUPPORT_SOURCE_SCOPE_CHANGED');
  const before = git(cwd, ['show', originalCommit + ':' + profilePath]) + '\n';
  const changed = readFileSync(join(cwd, profilePath), 'utf8');
  requireCondition(changed === salesSupportRepairSourceProfile(before, repair)
    && repair.sourceProfileDigest === digest(changed)
    && repair.sourceTreeHash === readReviewedInventory(join(cwd, 'force-app/main/default')).sourceTreeHash,
  'TRADING_FX_SALES_SUPPORT_SOURCE_BINDING_CHANGED');
  return repair;
}
