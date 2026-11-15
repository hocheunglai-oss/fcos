import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, git, requireCondition } from './contract.mjs';
import { readReviewedInventory } from '../salesforce-reviewed-release.mjs';
import { salesSupportRepairPackage } from './trading-fx-sales-support-repair.mjs';

const profilePath = 'force-app/main/default/profiles/Sales Support.profile-meta.xml';
const originalCommit = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
const originalProfileDigest = 'dc7e800589ac018a2aec55346d9734dadace8c3316bd6309b3c4171ad2b86a14';

export function salesSupportRepairSourceProfile(before) {
  requireCondition(digest(before) === originalProfileDigest, 'TRADING_FX_SALES_SUPPORT_SOURCE_PREIMAGE_CHANGED');
  const { profile } = salesSupportRepairPackage();
  const entries = profile.split('\n').slice(2, -2).join('\n') + '\n';
  const anchor = '    <custom>true</custom>\n';
  requireCondition(before.split(anchor).length === 2, 'TRADING_FX_SALES_SUPPORT_SOURCE_PREIMAGE_CHANGED');
  return before.replace(anchor, anchor + entries);
}

export function verifySalesSupportRepairSource({ cwd, repair }) {
  const sourceCommit = git(cwd, ['rev-parse', 'HEAD']);
  requireCondition(sourceCommit === repair.sourceCommit && git(cwd, ['status', '--porcelain']) === ''
    && git(cwd, ['rev-parse', 'HEAD^']) === originalCommit
    && git(cwd, ['diff', '--name-only', originalCommit, 'HEAD']) === profilePath,
  'TRADING_FX_SALES_SUPPORT_SOURCE_SCOPE_CHANGED');
  const before = git(cwd, ['show', originalCommit + ':' + profilePath]) + '\n';
  const changed = readFileSync(join(cwd, profilePath), 'utf8');
  const { profileDigest, manifestDigest } = salesSupportRepairPackage();
  const observed = { sourceCommit, sourceTreeHash: readReviewedInventory(join(cwd, 'force-app/main/default')).sourceTreeHash,
    sourceProfileDigest: digest(changed), profileDigest, manifestDigest };
  requireCondition(changed === salesSupportRepairSourceProfile(before)
    && digest(repair) === digest({ ...observed, correctionFingerprint: digest(observed) }),
  'TRADING_FX_SALES_SUPPORT_SOURCE_BINDING_CHANGED');
  return repair;
}
