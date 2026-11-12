import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/lib/appVersionMeta.js';
import { APP_VERSION_HISTORY } from '../src/lib/appVersion.js';
import { assertCurrentReleaseHistory } from './lib/app-version-history-guard.mjs';
import { collectBuildProvenance } from './lib/build-provenance.mjs';

const outputUrl = new URL('../public/app-version.json', import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const builtAt = new Date().toISOString();

assertCurrentReleaseHistory(APP_VERSION, APP_VERSION_HISTORY);

const provenance = collectBuildProvenance({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
const commit = provenance.commit;
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;
const rapidBuildId = process.env.FCOS_RAPID_BUILD_ID || null;
const sourceDigest = process.env.FCOS_RAPID_SOURCE_DIGEST || provenance.sourceDigest;
if (rapidBuildId && (!/^[a-f0-9]{64}$/.test(rapidBuildId) || !/^[a-f0-9]{64}$/.test(sourceDigest) || !provenance.releaseEligible)) {
  throw new Error('Rapid release build requires verified immutable source and build identity.');
}
const buildId = rapidBuildId || deploymentId || `${commit || APP_VERSION}-${builtAt}`;

mkdirSync(dirname(outputPath), { recursive: true });
const receipt = {
  schemaVersion: 2,
  version: APP_VERSION,
  buildId,
  commit,
  deploymentId,
  builtAt,
  gitDirty: provenance.gitDirty,
  provenance,
  sourceDigest,
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
// Embedded in server function bundles; its digest is excluded from its own input closure.
writeFileSync(fileURLToPath(new URL('../api/_runtime-build-receipt.json', import.meta.url)), `${JSON.stringify(receipt, null, 2)}\n`);
