import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertConvertedPackage } from '../../deploy-salesforce-reviewed-manifest.mjs';
import { parseReviewedPackage, readReviewedInventory } from '../salesforce-reviewed-release.mjs';
import { digest, requireCondition } from './contract.mjs';
import { fieldBoundDenialDigests, salesSupportRepairFields, salesSupportRepairPackage } from './trading-fx-sales-support-repair.mjs';
import { verifySalesSupportRepairSource } from './trading-fx-sales-support-source.mjs';

const apiVersion = '67.0';
const { fieldBoundPackageSha256: qualifiedPackage, fieldBoundManifestDigest: qualifiedManifest } = fieldBoundDenialDigests;

/**
 * Prepare the exact package accepted in DEVEE check-only job 0AfHF000007H5ld0AC.
 * The caller owns the temporary project and may only supply an offline converter.
 */
export function prepareTradingFxFieldBoundDenialPackage({ cwd, project, repair, convert }) {
  verifySalesSupportRepairSource({ cwd, repair });
  const { manifest, profile, profileDigest } = salesSupportRepairPackage();
  const type = '    <types>\n' + salesSupportRepairFields.map(field => '        <members>' + field + '</members>\n').join('')
    + '        <name>CustomField</name>\n    </types>\n';
  const fieldManifest = manifest.replace(/    <types>[\s\S]+?<\/types>\n/u, type);
  const fullManifest = manifest.replace('    <types>', type + '    <types>');
  const members = new Set(parseReviewedPackage(fieldManifest));
  const sourceRoot = join(cwd, 'force-app/main/default');
  const files = new Set();
  for (const name of salesSupportRepairFields) {
    const [object, field] = name.split('.');
    const file = 'objects/' + object + '/fields/' + field + '.field-meta.xml';
    files.add(file);
    const bytes = readFileSync(join(sourceRoot, file));
    requireCondition(!bytes.includes(13) && !bytes.includes('<required>true</required>'),
      'TRADING_FX_FIELD_DENIAL_DEFINITION_CHANGED');
    const destination = join(project, 'force-app/main/default', file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
  writeFileSync(join(project, 'sfdx-project.json'), readFileSync(join(cwd, 'sfdx-project.json')));
  writeFileSync(join(project, 'fields.xml'), fieldManifest);
  const directory = join(project, 'metadata');
  convert(['project', 'convert', 'source', '--manifest', 'fields.xml', '--output-dir', 'metadata', '--api-version', apiVersion], project);
  convert(['project', 'convert', 'mdapi', '--root-dir', 'metadata', '--output-dir', 'roundtrip'], project);
  assertConvertedPackage(directory, join(project, 'roundtrip/main/default'), members, files, sourceRoot, apiVersion, 'Sales Support fields');

  const profileDirectory = join(directory, 'profiles');
  mkdirSync(profileDirectory);
  writeFileSync(join(profileDirectory, 'Sales Support.profile'), profile);
  writeFileSync(join(directory, 'package.xml'), fullManifest);
  const manifestDigest = digest(fullManifest);
  requireCondition(manifestDigest === qualifiedManifest, 'TRADING_FX_FIELD_DENIAL_MANIFEST_CHANGED');
  function verify() {
    const observed = readReviewedInventory(directory).sourceTreeHash;
    requireCondition(observed === qualifiedPackage, 'TRADING_FX_FIELD_DENIAL_QUALIFIED_PACKAGE_CHANGED');
  }
  verify();
  return { directory, packageSha256: qualifiedPackage, profileDigest, manifestDigest, verify };
}
