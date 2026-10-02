import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { OBSERVATION_BASE_SHA, OBSERVATION_CANDIDATE_SHA, OBSERVATION_DECLARATIONS,
  assertObservationDeclarationBytes, verifyCompatibilityObservationSources,
  isDeploymentReadOnly, externalActionGates, fcunoFederationConfig, serverSupabaseConfig,
  supabaseDiagnosticCredentialMode } from '../scripts/lib/runtime-compatibility-observation.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(new URL('../scripts/lib/runtime-compatibility-observation.mjs', import.meta.url), 'utf8');

test('pure observation proof binds immutable full sources, dependency declarations and reviewed local bytes', () => {
  const proof = verifyCompatibilityObservationSources({ cwd, baseSha: OBSERVATION_BASE_SHA, candidateSha: OBSERVATION_CANDIDATE_SHA });
  assert.equal(proof.sourceVerified, true); assert.equal(proof.observationKind, 'independent_provider_probe_and_verified_deployment_configuration');
  assert.match(proof.helperRevision, /^[0-9a-f]{64}$/); assert.match(proof.declarationsSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(proof, 'authenticated'), false); assert.equal(Object.hasOwn(proof, 'runtime'), false);
  assert.ok(OBSERVATION_DECLARATIONS.every(row => Object.isFrozen(row) && Object.isFrozen(row.ranges)));
  assert.throws(() => verifyCompatibilityObservationSources({ cwd: '/missing', baseSha: OBSERVATION_BASE_SHA, candidateSha: '33d97ea74439e27128fd148df78a1e6be6a2f844' }), /Exact immutable/);
  assert.throws(() => verifyCompatibilityObservationSources({ cwd: '/missing', baseSha: OBSERVATION_BASE_SHA, candidateSha: 'f3d4cadfbaad7c25c83205350bb9be572493f47c' }), /Exact immutable/);
});

test('the email-safe candidate retains every prior interpreter hash, legacy Xero binding and pure declaration byte', () => {
  assert.equal(OBSERVATION_CANDIDATE_SHA, 'ff8859b287009e20462c5c0cceff89ae12f13010');
  const prior = execFileSync('git', ['show', '4b421c736541058d62fc4541aa8bff041567b009:scripts/lib/runtime-compatibility-observation.mjs'], { cwd, encoding: 'utf8' });
  assert.deepEqual(source.match(/"(?:sourceSha256|declarationSha256)": "[0-9a-f]{64}"/g), prior.match(/"(?:sourceSha256|declarationSha256)": "[0-9a-f]{64}"/g));
  const unchangedStart = 'export const LEGACY_XERO_READ_BINDING';
  assert.equal(source.slice(source.indexOf(unchangedStart)), prior.slice(prior.indexOf(unchangedStart)));
  for (const record of OBSERVATION_DECLARATIONS) {
    const get = ref => execFileSync('git', ['show', `${ref}:${record.file}`], { cwd, encoding: 'utf8' });
    assert.equal(get(OBSERVATION_CANDIDATE_SHA), get('f3d4cadfbaad7c25c83205350bb9be572493f47c'), record.file);
  }
});

test('changed pure dependency nodes, interpretations or boundaries cannot inherit the immutable declaration proof', () => {
  assert.equal(assertObservationDeclarationBytes(source), true);
  for (const [before, after] of [
    ["=== 'preview'", "=== 'production'"], ['defaultEnabled: true', 'defaultEnabled: false'],
    ['const MAX_TEXT = 500;', 'const MAX_TEXT = 501;'], ['env.SUPABASE_SECRET_KEY', 'env.SUPABASE_ANON_KEY'],
    ["claims.role !== 'service_role'", "claims.role !== 'anon'"],
    ['// BEGIN IMMUTABLE PURE 0\n', '// BEGIN UNVERIFIED PURE 0\n'],
  ]) {
    const offset = source.indexOf('// BEGIN IMMUTABLE PURE 0\n');
    const declarations = source.slice(offset);
    assert.ok(declarations.includes(before));
    assert.throws(() => assertObservationDeclarationBytes(source.slice(0, offset) + declarations.replace(before, after)));
  }
});

test('pure flags preserve baseline Production behavior and disable every external action in actual read-only configuration', () => {
  assert.equal(isDeploymentReadOnly({ VERCEL_ENV: 'production' }), false);
  assert.equal(externalActionGates({}).salesforce_write.enabled, true);
  assert.equal(externalActionGates({ FCOS_DISABLE_SALESFORCE_WRITE: 'true' }).salesforce_write.enabled, false);
  for (const env of [{ VERCEL_ENV: 'preview', FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: ' TRUE ' }]) {
    assert.equal(isDeploymentReadOnly(env), true); assert.ok(Object.values(externalActionGates(env)).every(row => row.enabled === false));
  }
  const flags = fcunoFederationConfig({ FCOS_ENABLE_FCUNO_FEDERATION: ' true ', FCOS_ENABLE_FCUNO_IDENTITY_SYNC: 'false', FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN: 'TRUE' });
  assert.equal(flags.federationEnabled, true); assert.equal(flags.syncEnabled, false); assert.equal(flags.legacyPasswordEnabled, true);
});

test('private config selection and recognized Supabase mode remain pure classification rather than authentication', () => {
  const config = serverSupabaseConfig({ SUPABASE_URL: ' https://pinned.example ', VITE_SUPABASE_URL: 'https://legacy.example', SUPABASE_SECRET_KEY: ' sb_secret_marker ', SUPABASE_SERVICE_ROLE_KEY: 'legacy-marker' });
  assert.equal(config.url, 'https://pinned.example'); assert.equal(config.key, 'sb_secret_marker');
  assert.equal(config.keyEnv, 'SUPABASE_SECRET_KEY'); assert.equal(supabaseDiagnosticCredentialMode(config.key), 'secret_key');
  assert.equal(serverSupabaseConfig({}).configured, false);
  const now = Date.now(), jwt = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.unsigned`;
  const claims = { role: 'service_role', ref: fcosConnectionIdentifier('supabase', 'Project ref'), exp: Math.floor(now / 1000) + 600 };
  assert.equal(supabaseDiagnosticCredentialMode(jwt(claims), now), 'service_role');
  for (const changed of [{ ...claims, ref: 'foreign-project' }, { ...claims, role: 'anon' }, { ...claims, exp: Math.floor(now / 1000) + 89 }]) assert.equal(supabaseDiagnosticCredentialMode(jwt(changed), now), null);
});

test('trusted release closure avoids application auth/probe modules and candidate code execution', () => {
  const declarations = source.slice(source.indexOf('// BEGIN IMMUTABLE PURE 0\n'), source.indexOf('export function assertObservationDeclarationBytes'));
  assert.doesNotMatch(declarations, /^export function requireDeploymentMutationAllowed|jwtVerify|new Function|\beval\(|\bfetch\(|(?:client|supabase)\.from\(|\.rpc\(/m);
  for (const file of ['runtime-compatibility-release.mjs', 'runtime-compatibility-normal-role.mjs']) {
    const script = readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(script, /from ['"]\.\.\/api\//);
  }
  const normal = readFileSync(new URL('../scripts/runtime-compatibility-normal-role.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(normal, /registeredHandlerBehavior/); assert.match(normal, /normalRoleReadRequest/);
});
