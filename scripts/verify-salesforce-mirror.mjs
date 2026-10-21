import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function mirrorVerificationScript(mode = 'generic-bootstrap') {
  if (mode === 'generic-bootstrap') return 'sync-salesforce-shared-repository.mjs';
  if (mode === 'schema-free-complete-owned-tree') return 'sync-salesforce-schema-free-hotfix-repository.mjs';
  throw new Error('Unknown Salesforce mirror proof mode; select a maintained workflow explicitly.');
}

// Select a verifier, never convert its proof or fall back after a refusal.
export function verifySalesforceMirror({ mode = process.env.FCOS_SALESFORCE_MIRROR_MODE ?? 'generic-bootstrap', run = spawnSync } = {}) {
  const script = mirrorVerificationScript(mode);
  const result = run(process.execPath, [path.join(root, 'scripts', script), '--check'], {
    cwd: root, env: process.env, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  if (!Number.isInteger(result.status) || result.status !== 0) {
    throw new Error(`The selected Salesforce mirror verifier failed (${result.status ?? 'no exit status'}); no fallback was attempted.`);
  }
  return { mode, script };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifySalesforceMirror(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
