import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/lib/appVersionMeta.js';
import { APP_VERSION_HISTORY } from '../src/lib/appVersion.js';
import { assertCurrentReleaseHistory } from './lib/app-version-history-guard.mjs';
import { collectBuildProvenance, writeBuildReceipts } from './lib/build-provenance.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const builtAt = new Date().toISOString();

assertCurrentReleaseHistory(APP_VERSION, APP_VERSION_HISTORY);

const provenance = collectBuildProvenance({ cwd });
const commit = provenance.commit;
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;
const buildId = deploymentId || `${commit || APP_VERSION}-${builtAt}`;

const receipt = {
  version: APP_VERSION,
  buildId,
  commit,
  deploymentId,
  builtAt,
  gitDirty: provenance.gitDirty,
  provenance,
};
// Static JSON imports make the same receipt traceable in Node function packages.
writeBuildReceipts({ cwd, receipt });
