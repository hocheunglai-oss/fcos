import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTROL_FILES = Object.freeze(['.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs']);
export function verifyCodexControls(root) {
  if (!lstatSync(join(root, '.codex')).isDirectory()) throw new Error('FCOS control directory must be a regular directory.');
  const read = (file) => {
    if (!lstatSync(join(root, file)).isFile()) throw new Error('FCOS controls must be regular files.');
    return readFileSync(join(root, file));
  };
  const policy = JSON.parse(read('.codex/control-policy.json'));
  if (policy.schemaVersion !== 1 || !Number.isInteger(policy.revision) || policy.revision < 1 || policy.nodeMajor !== 24) throw new Error('FCOS control policy is invalid.');
  const config = read('.codex/config.toml').toString('utf8');
  // The hashes bind the complete TOML rather than a partial hand-written parser.
  for (const [key, expected] of [['sandbox_mode', 'workspace-write'], ['approval_policy', 'on-request'], ['approvals_reviewer', 'auto_review']]) {
    const firstSection = config.split(/^\[/m)[0];
    const values = [...firstSection.matchAll(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, 'gm'))];
    if (values.length !== 1 || values[0][1] !== expected) throw new Error('FCOS control defaults are invalid.');
  }
  if (!/\[agents\]\s*max_concurrent_threads_per_session\s*=\s*2\b/.test(config)) throw new Error('FCOS agent limit must remain two.');
  if (/^\s*(?:password|access_token|refresh_token|api_key|client_secret)\s*=/im.test(config)) throw new Error('Credential assignments are forbidden in FCOS controls.');
  if (Object.keys(policy.files || {}).length !== CONTROL_FILES.length) throw new Error('FCOS control file inventory is invalid.');
  for (const file of CONTROL_FILES) {
    if (createHash('sha256').update(read(file)).digest('hex') !== policy.files[file]) throw new Error(`FCOS control revision mismatch: ${file}.`);
  }
  return { schemaVersion: 1, revision: policy.revision, nodeMajor: policy.nodeMajor, verified: true };
}
