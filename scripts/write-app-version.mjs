import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/lib/appVersion.js';

const outputUrl = new URL('../public/app-version.json', import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const builtAt = new Date().toISOString();

function readGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

const commit = process.env.VERCEL_GIT_COMMIT_SHA || readGitCommit();
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;
const buildId = deploymentId || `${commit || APP_VERSION}-${builtAt}`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({
  version: APP_VERSION,
  buildId,
  commit,
  deploymentId,
  builtAt,
}, null, 2)}\n`);
