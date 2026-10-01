import { createHash } from 'node:crypto';

const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const digest = value => createHash('sha256').update(value).digest('hex');
const additions = new Set(['api/connection-runtime.js', 'api/_connectionRuntime.js', 'api/_runtime-build-receipt.json', 'tests/connectionRuntime.test.js']);
const modified = new Set(['config/fcosConnections.js', 'scripts/write-app-version.mjs', 'scripts/lib/build-provenance.mjs', 'eslint.config.js']);
const guardFiles = new Set(['api/_hedgeDeskService.js', 'api/_xeroPortal.js', 'api/functions/[name].js']);
const guardHelper = 'api/_hedgeDeskReadOnly.js';
const expectedGuardHelper = "// Snapshot reads skip expiry using trusted server deployment configuration.\nconst READ_ACTIONS = new Set(['list', 'filter', 'get', 'snapshot']);\n\nexport function isReadOnlyHedgeDeskAction(body = {}) {\n  return READ_ACTIONS.has(String(body?.action || 'list'));\n}\n";
const guardTests = new Set(['tests/runtimeReadOnlySnapshots.test.js', 'tests/xeroPortal.test.js']);
const controls = new Set(['AGENTS.md', '.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs', '.codex/control-policy.json', '.codex/README.md', '.codex/environments/environment.toml', '.codex/environments/environment-2.toml']);

// The only permitted business-source change is this exact reviewed transformation.
// Any extra edit in either financial module still fails closed.
function expectedReadOnlyGuard(path, original) {
  const replaceOnce = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error('Read-only compatibility guard baseline differs.');
    return text.replace(before, after);
  };
  if (path === 'api/_hedgeDeskService.js') {
    let result = replaceOnce(original,
      "import { isReadOnlyCiProfile, requireReadOnlyCiOperation } from './_readOnlyCiAccess.js';\n",
      "import { isReadOnlyCiProfile, requireReadOnlyCiOperation } from './_readOnlyCiAccess.js';\nimport { isDeploymentReadOnly, requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';\nimport { isReadOnlyHedgeDeskAction } from './_hedgeDeskReadOnly.js';\n");
    result = replaceOnce(result,
      'export async function loadHedgeDeskSnapshot({ client, capabilities }) {\n  const expiryAutomation = await reconcilePaperHedgeExpiry(client);',
      "export async function loadHedgeDeskSnapshot({ client, capabilities }) {\n  const expiryAutomation = isDeploymentReadOnly()\n    ? { status: 'not_run', reason: 'deployment_read_only' }\n    : await reconcilePaperHedgeExpiry(client);");
    result = replaceOnce(result, 'export async function handleHedgeDeskEntity(body, profile, { client, capabilities }) {',
      'export async function handleHedgeDeskEntity(body, profile, { client, capabilities }) {\n  requireDeploymentMutationAllowed(!isReadOnlyHedgeDeskAction(body));');
    return replaceOnce(result, '    const expiryAutomation = isReadOnlyCiProfile(profile)',
      "    const expiryAutomation = isDeploymentReadOnly()\n      ? { status: 'not_run', reason: 'deployment_read_only' }\n      : isReadOnlyCiProfile(profile)");
  }
  if (path === 'api/functions/[name].js') {
    let result = replaceOnce(original,
      "import { ciModuleAccess, isReadOnlyCiProfile, isReadOnlyMarketAction, requireReadOnlyCiOperation } from '../_readOnlyCiAccess.js';\n",
      "import { ciModuleAccess, isReadOnlyCiProfile, isReadOnlyMarketAction, requireReadOnlyCiOperation } from '../_readOnlyCiAccess.js';\nimport { isReadOnlyHedgeDeskAction } from '../_hedgeDeskReadOnly.js';\n");
    result = replaceOnce(result, "  requireDeploymentMutationAllowed(policy.mutation && name !== 'hedgeMarkets');",
      "  // Mixed handlers classify the authenticated request body at dispatch.\n  requireDeploymentMutationAllowed(policy.mutation && !['hedgeMarkets', 'hedgeDeskEntity'].includes(name));");
    return replaceOnce(result,
      "        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (name !== 'hedgeMarkets' || !isReadOnlyMarketAction(body)));",
      "        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (\n          name === 'hedgeMarkets' ? !isReadOnlyMarketAction(body)\n            : name === 'hedgeDeskEntity' ? !isReadOnlyHedgeDeskAction(body)\n              : true\n        ));");
  }
  let result = replaceOnce(original, "import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';\n",
    "import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';\nimport { isDeploymentReadOnly } from './_deploymentReadOnly.js';\n");
  return replaceOnce(result, '  if (shouldRefresh && (stored?.refreshToken || env.XERO_REFRESH_TOKEN)) {',
    '  if (!isDeploymentReadOnly(env) && shouldRefresh && (stored?.refreshToken || env.XERO_REFRESH_TOKEN)) {');
}

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
    if (!controls.has(path) && !guardTests.has(path) && !(path === guardHelper && !before) && !(guardFiles.has(path) && before) && !(additions.has(path) && !before) && !(modified.has(path) && before)) throw new Error(`Compatibility rollout changes protected application scope: ${path}.`);
    changes.push({ path, before: before?.sha || null, after: after.sha });
  }
  const guards = changes.filter(row => guardFiles.has(row.path));
  if (guards.length && guards.length !== guardFiles.size) throw new Error('Complete read-only compatibility guards are required.');
  if (guards.length && (!candidate.has(guardHelper) || base.has(guardHelper) || readBlob(candidate.get(guardHelper).sha) !== expectedGuardHelper)) throw new Error('Exact reviewed read-action helper required.');
  if (!guards.length && candidate.has(guardHelper) !== base.has(guardHelper)) throw new Error('Read-action helper requires complete reviewed guards.');
  for (const guard of guards) {
    if (readBlob(guard.after) !== expectedReadOnlyGuard(guard.path, readBlob(guard.before))) throw new Error('Read-only compatibility guard changes protected financial scope.');
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
    readOnlyGuards: guards.map(({ path }) => path),
    reviewedException: guards.length ? 'Suppress implicit expiry and token refresh only in deployment read-only mode; ordinary Production logic is preserved.' : null,
    scopeVerified: true, productionAuthorized: false,
    limitation: 'Scope proof does not waive missing runtime, provider, quality, protected workflow or human approval evidence.' };
}
