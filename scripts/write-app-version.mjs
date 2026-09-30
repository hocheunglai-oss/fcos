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
const buildId = deploymentId || `${commit || APP_VERSION}-${builtAt}`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({
  version: APP_VERSION,
  buildId,
  commit,
  deploymentId,
  builtAt,
  gitDirty: provenance.gitDirty,
  provenance,
}, null, 2)}\n`);
