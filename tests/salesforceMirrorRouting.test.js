import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorVerificationScript, verifySalesforceMirror } from '../scripts/verify-salesforce-mirror.mjs';

test('normal mirror verification retains the generic proof workflow', () => {
  assert.equal(mirrorVerificationScript(), 'sync-salesforce-shared-repository.mjs');
});

test('explicit complete-source mode runs only its maintained read-only verifier', () => {
  const calls = [];
  const result = verifySalesforceMirror({ mode: 'schema-free-complete-owned-tree', run: (...args) => {
    calls.push(args); return { status: 0 };
  } });
  assert.equal(result.script, 'sync-salesforce-schema-free-hotfix-repository.mjs');
  assert.equal(calls.length, 1);
  assert.match(calls[0][1][0], /\/scripts\/sync-salesforce-schema-free-hotfix-repository\.mjs$/);
  assert.deepEqual(calls[0][1].slice(1), ['--check']);
  assert.equal(calls[0][2].shell, false);
});

test('unknown or injected modes refuse before starting any verifier', () => {
  for (const mode of ['', 'schema-free', '--publish', 'generic-bootstrap; echo unsafe']) {
    let called = false;
    assert.throws(() => verifySalesforceMirror({ mode, run: () => { called = true; } }), /Unknown Salesforce mirror proof mode/);
    assert.equal(called, false);
  }
});

test('a selected verifier refusal, signal or process error never tries the other workflow', () => {
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { error: new Error('spawn refused') }]) {
    let count = 0;
    assert.throws(() => verifySalesforceMirror({ mode: 'schema-free-complete-owned-tree', run: () => { count += 1; return result; } }));
    assert.equal(count, 1);
  }
});
