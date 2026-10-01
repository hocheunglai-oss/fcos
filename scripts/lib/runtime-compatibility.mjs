import { createHash } from 'node:crypto';

const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const digest = value => createHash('sha256').update(value).digest('hex');
const additions = new Set(['api/connection-runtime.js', 'api/_connectionRuntime.js', 'api/_runtime-build-receipt.json', 'tests/connectionRuntime.test.js']);
const modified = new Set(['config/fcosConnections.js', 'scripts/write-app-version.mjs', 'scripts/lib/build-provenance.mjs', 'eslint.config.js']);
const controls = new Set(['AGENTS.md', '.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs', '.codex/control-policy.json', '.codex/README.md', '.codex/environments/environment.toml', '.codex/environments/environment-2.toml']);

/** Scope proof, never release authority. Both trees must be read from immutable
 * Git objects, and Production identity must be independently checked again at
 * deployment. No environment values, provider rows or credentials are accepted.
 */
export function runtimeCompatibilityScope({ baseCommit, candidateCommit, baseTree, candidateTree, readBlob }) {
  if (!sha(baseCommit) || !sha(candidateCommit) || baseCommit === candidateCommit || !Array.isArray(baseTree) || !Array.isArray(candidateTree)) throw new Error('Exact distinct compatibility Git identities are required.');
  const tree = entries => {
    const map = new Map();
    for (const row of entries) {
      if (!row || typeof row.path !== 'string' || /[\x00-\x1f\x7f]/.test(row.path) || row.path.startsWith('/') || row.path.split('/').some(part => !part || part === '..')
        || !sha(row.sha) || !['100644', '100755'].includes(row.mode) || row.type !== 'blob' || map.has(row.path)) throw new Error('Compatibility scope requires regular immutable Git files.');
      map.set(row.path, row);
    }
    return map;
  };
  const base = tree(baseTree), candidate = tree(candidateTree), changes = [];
  for (const path of [...new Set([...base.keys(), ...candidate.keys()])].sort()) {
    const before = base.get(path), after = candidate.get(path);
    if (before?.sha === after?.sha && before?.mode === after?.mode) continue;
    if (!after || after.mode !== '100644' || before && before.mode !== after.mode) throw new Error('Compatibility rollout cannot delete files or change executable modes.');
    if (!controls.has(path) && !(additions.has(path) && !before) && !(modified.has(path) && before)) throw new Error(`Compatibility rollout changes protected application scope: ${path}.`);
    changes.push({ path, before: before?.sha || null, after: after.sha });
  }
  for (const path of additions) if (base.has(path) || !candidate.has(path)) throw new Error('Compatibility rollout must add the complete diagnostic endpoint.');
  for (const path of modified) if (!changes.some(row => row.path === path)) throw new Error('Compatibility diagnostic dependencies are incomplete.');
  const oldPolicy = readBlob(base.get('config/fcosConnections.js').sha);
  const newPolicy = readBlob(candidate.get('config/fcosConnections.js').sha);
  // Existing canonical provider policies/helpers must remain byte-for-byte.
  if (!newPolicy.includes(oldPolicy) || newPolicy.split(oldPolicy).length !== 2) throw new Error('Compatibility rollout must preserve the existing connection policy verbatim.');
  return { schemaVersion: 1, receiptKind: 'fcos_runtime_compatibility_scope', baseCommit, candidateCommit,
    candidateTreeHash: digest(JSON.stringify([...candidate.values()].sort((a, b) => a.path.localeCompare(b.path)))), changes,
    preservation: { existingUi: true, mobile: true, databaseSchema: true, salesforceMetadata: true, financialLogic: true,
      cronSchedules: true, externalActionGates: true, dependencies: true, existingConnectionPolicy: true },
    scopeVerified: true, productionAuthorized: false,
    limitation: 'Scope proof does not waive missing runtime, provider, quality, protected workflow or human approval evidence.' };
}
