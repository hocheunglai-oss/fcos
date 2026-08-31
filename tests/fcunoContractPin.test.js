import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FCOS_CONNECTION_POLICY, validateFcosConnectionPolicy } from '../config/fcosConnections.js';

test('FCOS pins the exact public FCUNO provider contract and keeps projects separate', () => {
  const federation = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
  assert.equal(federation.providerRepository, 'hocheunglai-oss/bunker-map');
  assert.match(federation.providerCommit, /^[0-9a-f]{40}$/);
  assert.match(federation.contractSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(federation.providerSupabaseProjectRef, 'pjforfvchygdyqfcgpmw');
});

test('connection policy rejects an unpinned or cross-connected federation', () => {
  const unpinned = structuredClone(FCOS_CONNECTION_POLICY);
  unpinned.integrations.fcunoIdentityFederation.providerCommit = 'main';
  assert.throws(() => validateFcosConnectionPolicy(unpinned), /exact provider commit/);

  const crossConnected = structuredClone(FCOS_CONNECTION_POLICY);
  crossConnected.integrations.fcunoIdentityFederation.providerSupabaseProjectRef = 'pjforfvchygdyqfcgpmw';
  assert.throws(() => validateFcosConnectionPolicy(crossConnected), /separate Supabase projects/);
});

test('the consumer verifier fetches only immutable contract JSON through the GitHub Contents API', async () => {
  const source = await readFile(new URL('../scripts/verify-fcuno-federation-contract.mjs', import.meta.url), 'utf8');
  assert.match(source, /api\.github\.com/);
  assert.match(source, /\/contents\//);
  assert.match(source, /application\/vnd\.github\.raw\+json/);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com/);
  assert.match(source, /pin\.providerCommit/);
  assert.match(source, /pin\.contractPath/);
  assert.match(source, /\.schema\.json/);
  assert.doesNotMatch(source, /eval\(|import\(.*provider|child_process/);
});
