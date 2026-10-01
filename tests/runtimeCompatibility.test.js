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
