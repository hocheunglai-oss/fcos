import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeCompatibilityScope } from '../scripts/lib/runtime-compatibility.mjs';

const row = (path, sha = 'a'.repeat(40)) => ({ path, sha, type: 'blob', mode: '100644' });
function fixture() {
  const dependencies = ['config/fcosConnections.js', 'scripts/write-app-version.mjs', 'scripts/lib/build-provenance.mjs', 'eslint.config.js'];
  const preserved = ['src/pages/Dashboard.jsx', 'src/pages/XeroPortal.jsx', 'vercel.json', 'api/functions/[name].js', 'api/_externalActionGates.js', 'package-lock.json', 'supabase/migrations/existing.sql', 'force-app/main/default/classes/Existing.cls'];
  const baseTree = [...dependencies, ...preserved].map(path => row(path));
  const candidateTree = baseTree.map(item => ({ ...item, ...(dependencies.includes(item.path) ? { sha: 'b'.repeat(40) } : {}) }));
  candidateTree.push(...['api/connection-runtime.js', 'api/_connectionRuntime.js', 'api/_runtime-build-receipt.json', 'tests/connectionRuntime.test.js'].map(path => row(path, 'c'.repeat(40))));
  return { baseCommit: 'd'.repeat(40), candidateCommit: 'e'.repeat(40), baseTree, candidateTree,
    readBlob: sha => sha === 'a'.repeat(40) ? 'original policy\n' : 'catalogue\noriginal policy\nexports\n' };
}
test('compatibility scope preserves all existing business sources and never authorizes Production', () => {
  const proof = runtimeCompatibilityScope(fixture());
  assert.equal(proof.scopeVerified, true); assert.equal(proof.productionAuthorized, false);
  assert.ok(Object.values(proof.preservation).every(Boolean)); assert.equal(proof.changes.length, 8);
});
test('UI, cron, schema, financial, metadata and dependency changes fail compatibility scope', () => {
  for (const path of ['src/pages/Dashboard.jsx', 'src/pages/XeroPortal.jsx', 'vercel.json', 'api/_externalActionGates.js', 'package-lock.json', 'supabase/migrations/new.sql', 'force-app/main/default/classes/Existing.cls']) {
    const input = fixture(), entry = input.candidateTree.find(item => item.path === path);
    if (entry) entry.sha = 'f'.repeat(40); else input.candidateTree.push(row(path));
    assert.throws(() => runtimeCompatibilityScope(input), /protected application/);
  }
});
test('deletion, symlinks, mode changes, duplicate entries and incomplete dependencies fail', () => {
  const variants = [
    input => { input.candidateTree.shift(); },
    input => { input.candidateTree[0].mode = '120000'; },
    input => { input.candidateTree[0].mode = '100755'; },
    input => { input.candidateTree.push(input.candidateTree[0]); },
    input => { input.candidateTree = input.candidateTree.filter(row => row.path !== 'api/connection-runtime.js'); },
    input => { input.candidateTree.find(row => row.path === 'scripts/write-app-version.mjs').sha = 'a'.repeat(40); },
  ];
  for (const alter of variants) { const input = fixture(); alter(input); assert.throws(() => runtimeCompatibilityScope(input)); }
});
test('existing connection policy must remain verbatim; malformed identities and paths fail', () => {
  assert.throws(() => runtimeCompatibilityScope({ ...fixture(), readBlob: sha => sha === 'a'.repeat(40) ? 'old' : 'reclassified' }), /verbatim/);
  assert.throws(() => runtimeCompatibilityScope({ ...fixture(), candidateCommit: 'd'.repeat(40) }), /distinct/);
  assert.throws(() => runtimeCompatibilityScope({ ...fixture(), baseCommit: 'main' }), /identities/);
  const input = fixture(); input.candidateTree.push(row('../secrets')); assert.throws(() => runtimeCompatibilityScope(input), /regular immutable/);
});

function guardFixture() {
  const input = fixture();
  const hedgeOriginal = "import { isReadOnlyCiProfile, requireReadOnlyCiOperation } from './_readOnlyCiAccess.js';\nexport async function loadHedgeDeskSnapshot({ client, capabilities }) {\n  const expiryAutomation = await reconcilePaperHedgeExpiry(client);\n}\nexport async function handleHedgeDeskEntity(body, profile, { client, capabilities }) {\n}\n    const expiryAutomation = isReadOnlyCiProfile(profile)";
  const xeroOriginal = "import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';\n  if (shouldRefresh && (stored?.refreshToken || env.XERO_REFRESH_TOKEN)) {";
  const hedgeAfter = hedgeOriginal.replace("from './_readOnlyCiAccess.js';\n", "from './_readOnlyCiAccess.js';\nimport { isDeploymentReadOnly, requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';\nimport { isReadOnlyHedgeDeskAction } from './_hedgeDeskReadOnly.js';\n")
    .replace('  const expiryAutomation = await reconcilePaperHedgeExpiry(client);', "  const expiryAutomation = isDeploymentReadOnly()\n    ? { status: 'not_run', reason: 'deployment_read_only' }\n    : await reconcilePaperHedgeExpiry(client);")
    .replace('export async function handleHedgeDeskEntity(body, profile, { client, capabilities }) {', 'export async function handleHedgeDeskEntity(body, profile, { client, capabilities }) {\n  requireDeploymentMutationAllowed(!isReadOnlyHedgeDeskAction(body));')
    .replace('    const expiryAutomation = isReadOnlyCiProfile(profile)', "    const expiryAutomation = isDeploymentReadOnly()\n      ? { status: 'not_run', reason: 'deployment_read_only' }\n      : isReadOnlyCiProfile(profile)");
  const xeroAfter = xeroOriginal.replace("from 'node:crypto';\n", "from 'node:crypto';\nimport { isDeploymentReadOnly } from './_deploymentReadOnly.js';\n")
    .replace('if (shouldRefresh', 'if (!isDeploymentReadOnly(env) && shouldRefresh');
  const wrapperOriginal = "import { ciModuleAccess, isReadOnlyCiProfile, isReadOnlyMarketAction, requireReadOnlyCiOperation } from '../_readOnlyCiAccess.js';\n  requireDeploymentMutationAllowed(policy.mutation && name !== 'hedgeMarkets');\n        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (name !== 'hedgeMarkets' || !isReadOnlyMarketAction(body)));";
  const wrapperAfter = wrapperOriginal.replace("from '../_readOnlyCiAccess.js';\n", "from '../_readOnlyCiAccess.js';\nimport { isReadOnlyHedgeDeskAction } from '../_hedgeDeskReadOnly.js';\n")
    .replace("  requireDeploymentMutationAllowed(policy.mutation && name !== 'hedgeMarkets');", "  // Mixed handlers classify the authenticated request body at dispatch.\n  requireDeploymentMutationAllowed(policy.mutation && !['hedgeMarkets', 'hedgeDeskEntity'].includes(name));")
    .replace("        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (name !== 'hedgeMarkets' || !isReadOnlyMarketAction(body)));", "        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (\n          name === 'hedgeMarkets' ? !isReadOnlyMarketAction(body)\n            : name === 'hedgeDeskEntity' ? !isReadOnlyHedgeDeskAction(body)\n              : true\n        ));");
  input.baseTree.find(row => row.path === 'api/functions/[name].js').sha = '5'.repeat(40);
  input.candidateTree.find(row => row.path === 'api/functions/[name].js').sha = '6'.repeat(40);
  input.candidateTree.push(row('api/_hedgeDeskReadOnly.js', '7'.repeat(40)));
  const contactOriginal = "import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';\n  if (stored?.accessToken && stored?.tenantId && Date.parse(stored.expiresAt || '') > Date.now() + 90_000) return stored;";
  const contactAfter = contactOriginal.replace("from 'node:crypto';\n", "from 'node:crypto';\nimport { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';\n") + '\n  requireDeploymentMutationAllowed(true, env);';
  input.baseTree.push(row('api/_xeroContactSync.js', '8'.repeat(40)));
  input.candidateTree.push(row('api/_xeroContactSync.js', '9'.repeat(40)));
  input.baseTree.push(row('api/_hedgeDeskService.js', '1'.repeat(40)), row('api/_xeroPortal.js', '2'.repeat(40)));
  input.candidateTree.push(row('api/_hedgeDeskService.js', '3'.repeat(40)), row('api/_xeroPortal.js', '4'.repeat(40)));
  const emailOriginal = "import { requireReadOnlyCiOperation } from './_readOnlyCiAccess.js';\n  await syncEmailRouterMetadata({ client, mailbox, folder, messages });\n  if (indexed) {\n    const metadataJob = synchronizeEmailRouterAttachmentMetadata(client, indexed, attachments).catch(() => null);\n  }\n";
  const emailAfter = emailOriginal.replace("from './_readOnlyCiAccess.js';\n", "from './_readOnlyCiAccess.js';\nimport { isDeploymentReadOnly } from './_deploymentReadOnly.js';\n")
    .replace('  await syncEmailRouterMetadata({ client, mailbox, folder, messages });', '  if (!isDeploymentReadOnly(dependencies.env || process.env)) await syncEmailRouterMetadata({ client, mailbox, folder, messages });')
    .replace('  if (indexed) {', '  if (indexed && !isDeploymentReadOnly(dependencies.env || process.env)) {');
  input.baseTree.push(row('api/_emailRouterCore.js', '0'.repeat(40)));
  input.candidateTree.push(row('api/_emailRouterCore.js', 'f'.repeat(40)), row('tests/emailRouterReadOnly.test.js', 'c'.repeat(40)));
  const blobs = { ['0'.repeat(40)]: emailOriginal, ['f'.repeat(40)]: emailAfter, ['8'.repeat(40)]: contactOriginal, ['9'.repeat(40)]: contactAfter, ['1'.repeat(40)]: hedgeOriginal, ['2'.repeat(40)]: xeroOriginal, ['3'.repeat(40)]: hedgeAfter, ['4'.repeat(40)]: xeroAfter, ['5'.repeat(40)]: wrapperOriginal, ['6'.repeat(40)]: wrapperAfter, ['7'.repeat(40)]: "// Snapshot reads skip expiry using trusted server deployment configuration.\nconst READ_ACTIONS = new Set(['list', 'filter', 'get', 'snapshot']);\n\nexport function isReadOnlyHedgeDeskAction(body = {}) {\n  return READ_ACTIONS.has(String(body?.action || 'list'));\n}\n" };
  const originalRead = input.readBlob;
  input.readBlob = sha => blobs[sha] ?? originalRead(sha);
  return { input, blobs };
}

test('only the complete five exact read-only guard transformations are allowed in protected modules', () => {
  const { input } = guardFixture();
  const proof = runtimeCompatibilityScope(input);
  assert.deepEqual(proof.readOnlyGuards, ['api/_emailRouterCore.js', 'api/_hedgeDeskService.js', 'api/_xeroContactSync.js', 'api/_xeroPortal.js', 'api/functions/[name].js']);
  assert.match(proof.reviewedException, /ordinary Production logic is preserved/);
  for (const target of ['3'.repeat(40), '4'.repeat(40), '6'.repeat(40), '9'.repeat(40), 'f'.repeat(40)]) {
    const { input, blobs } = guardFixture();
    blobs[target] += '\n// additional business edit';
    assert.throws(() => runtimeCompatibilityScope(input), /protected application scope/);
  }
  const missing = guardFixture().input;
  missing.candidateTree.find(row => row.path === 'api/_xeroPortal.js').sha = '2'.repeat(40);
  assert.throws(() => runtimeCompatibilityScope(missing), /Complete read-only/);
});

test('each of the five guards is mandatory once read-only guard scope is present', () => {
  for (const path of runtimeCompatibilityScope(guardFixture().input).readOnlyGuards) {
    const { input } = guardFixture();
    input.candidateTree.find(row => row.path === path).sha = input.baseTree.find(row => row.path === path).sha;
    assert.throws(() => runtimeCompatibilityScope(input), /Complete read-only/, path);
  }
});

test('Email Router guard proof rejects either missing persistence guard, changed environment authority and extra business edits', () => {
  for (const alter of [
    text => text.replace('if (!isDeploymentReadOnly(dependencies.env || process.env)) await syncEmailRouterMetadata', 'await syncEmailRouterMetadata'),
    text => text.replace('indexed && !isDeploymentReadOnly(dependencies.env || process.env)', 'indexed'),
    text => text.replaceAll('dependencies.env || process.env', 'body.env'),
    text => text.replace('synchronizeEmailRouterAttachmentMetadata(client, indexed, attachments)', 'synchronizeEmailRouterAttachmentMetadata(client, indexed, [])'),
  ]) {
    const { input, blobs } = guardFixture();
    blobs['f'.repeat(40)] = alter(blobs['f'.repeat(40)]);
    assert.throws(() => runtimeCompatibilityScope(input), /protected application scope/);
  }
});

test('the Email Router regression file is allowed only as the reviewed new test addition', () => {
  assert.ok(runtimeCompatibilityScope(guardFixture().input).changes.some(row => row.path === 'tests/emailRouterReadOnly.test.js' && row.before === null));
  const extra = guardFixture().input;
  extra.candidateTree.push(row('tests/emailRouterOtherReadOnly.test.js', 'c'.repeat(40)));
  assert.throws(() => runtimeCompatibilityScope(extra), /protected application scope/);
  const existing = guardFixture().input;
  existing.baseTree.push(row('tests/emailRouterReadOnly.test.js', 'a'.repeat(40)));
  assert.throws(() => runtimeCompatibilityScope(existing), /protected application scope/);
});
