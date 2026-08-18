import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FCOS_CONNECTION_POLICY, validateFcosConnectionPolicy } from '../config/fcosConnections.js';
import {
  APPROVED_CONNECTION_BROWSER_PROFILE,
  CONNECTION_ATTESTATION_POLICY,
  CONNECTION_CHECKLIST_SEQUENCE,
  CONNECTION_LOCAL_STATE_DIRECTORY,
  CONNECTION_POLICY_VERSION,
  CONNECTION_PROFILE_NAME,
  CONNECTION_TARGETS,
  CONNECTION_VERIFY_COMMAND,
  canonicalConnectionAttestation,
  connectionAttestationState,
  sanitizeConnectionAttestation,
} from '../src/lib/connectionChecklist.js';
import { resolveSalesforceBrowserAuthentication } from '../scripts/fcos-connections.mjs';

const VERIFIED_AT = '2026-08-09T08:00:00.000Z';
const EXPIRES_AT = '2026-08-10T08:00:00.000Z';

function providerReport(provider, overrides = {}) {
  return {
    provider,
    cliAvailable: true,
    cliVersion: provider === 'vercel' ? '54.20.1' : provider === 'supabase' ? '2.113.0' : provider === 'salesforce' ? '2.145.6' : '2.96.0',
    cliVersionStatus: 'approved',
    identityStatus: 'verified',
    identityVerified: true,
    targetPin: 'verified',
    permissionStatus: 'verified',
    permissions: [...CONNECTION_TARGETS.find(({ id }) => id === provider).requiredPermissions],
    latencyMs: 42,
    authorizedAt: VERIFIED_AT,
    expiresAt: null,
    credentialAgeDays: 0,
    credentialLifecycle: 'current',
    lastVerifiedAt: VERIFIED_AT,
    warningCodes: [],
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    schemaVersion: 1,
    policyVersion: CONNECTION_POLICY_VERSION,
    profile: CONNECTION_PROFILE_NAME,
    keyId: CONNECTION_ATTESTATION_POLICY.keyId,
    verifiedAt: VERIFIED_AT,
    expiresAt: EXPIRES_AT,
    durationMs: 100,
    providers: Object.fromEntries(CONNECTION_TARGETS.map(({ id }) => [id, providerReport(id)])),
    ...overrides,
  };
}

test('one schema-validated policy owns the approved targets and CLI-first order', () => {
  assert.equal(validateFcosConnectionPolicy(FCOS_CONNECTION_POLICY), true);
  assert.deepEqual(CONNECTION_CHECKLIST_SEQUENCE.map(({ id }) => id), [
    'cli_availability',
    'target_identity',
    'cli_use',
    'browser_fallback',
  ]);
  assert.equal(APPROVED_CONNECTION_BROWSER_PROFILE, 'Otto');
  assert.equal(CONNECTION_PROFILE_NAME, 'fcos-production');
  assert.equal(CONNECTION_LOCAL_STATE_DIRECTORY, '.fcos-cli');
  assert.equal(CONNECTION_VERIFY_COMMAND, 'npm run connections:verify');

  const targets = Object.fromEntries(CONNECTION_TARGETS.map((target) => [
    target.id,
    Object.fromEntries(target.identifiers.map(({ label, value }) => [label, value])),
  ]));
  assert.equal(targets.github.Repository, 'hocheunglai-oss/fcos');
  assert.equal(targets.github['Browser fallback profile'], 'Otto');
  assert.equal(targets.vercel['Team ID'], 'team_MbKDazzCrou3eKTuausPv4X2');
  assert.equal(targets.vercel['Project ID'], 'prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs');
  assert.equal(targets.supabase['Project ref'], 'pjforfvchygdyqfcgpmw');
  assert.equal(targets.salesforce['Production Org ID'], '00D2x000000Ei4oEAC');
  assert.equal(targets.salesforce['Devee Org ID'], '00D1m0000008kioEAA');
  assert.equal(targets.salesforce['QAT Org ID'], '00D1s0000008lFEEAY');
  assert.equal(targets.salesforce['Devee username'], 'vincent@cosulich.com.hk.devee');
  assert.equal(targets.salesforce['QAT username'], 'vincent@cosulich.com.hk.qat');
  assert.equal(targets.salesforce['DEVEE browser authentication profile'], 'Otto');
  assert.equal(targets.salesforce['QAT browser authentication profile'], 'Otto');
  assert.equal(targets.salesforce['Production browser authentication profile'], 'Vincent');
  assert.equal(targets.salesforce['Shared GitHub account'], 'vincelessxai');
  assert.equal(targets.salesforce['Shared Salesforce repository'], 'ivanyk20/fcbhk');
  assert.equal(targets.salesforce['Shared browser fallback profile'], 'vincexai');
  assert.equal(targets.salesforce['Development source'], 'DEVEE only');
  assert.equal(targets.salesforce['Promotion order'], 'DEVEE → GitHub → QAT → Production');
  const salesforce = CONNECTION_TARGETS.find(({ id }) => id === 'salesforce');
  assert.deepEqual(salesforce.environments.map(({ key }) => key), ['devee', 'qat', 'production']);
  assert.deepEqual(salesforce.environments.map(({ browserProfile }) => browserProfile), ['Otto', 'Otto', 'Vincent']);
  assert.equal(salesforce.profileName, 'fcos-devee');
  assert.equal(salesforce.publication.browserProfile, 'vincexai');
  assert.equal(salesforce.publication.sourceEnvironmentKey, 'devee');
  assert.deepEqual(CONNECTION_TARGETS.map(({ id, credentialStorage }) => [id, credentialStorage]), [
    ['github', 'provider_secure_store'],
    ['vercel', 'macos_keychain'],
    ['supabase', 'macos_keychain'],
    ['salesforce', 'protected_host_store'],
  ]);
});

test('Salesforce browser authentication is environment-specific and fails closed on profile drift', () => {
  assert.equal(resolveSalesforceBrowserAuthentication(['--environment', 'devee', '--browser-profile', 'Otto']).alias, 'fcos-devee');
  assert.equal(resolveSalesforceBrowserAuthentication(['--environment=qat', '--browser-profile=Otto']).alias, 'fcos-qat');
  assert.equal(resolveSalesforceBrowserAuthentication(['--environment', 'production', '--browser-profile', 'Vincent']).alias, 'source-salesforce');
  assert.throws(
    () => resolveSalesforceBrowserAuthentication(['--environment', 'production', '--browser-profile', 'Otto']),
    /restricted to Chrome profile Vincent/,
  );
  assert.throws(
    () => resolveSalesforceBrowserAuthentication(['--environment', 'devee', '--browser-profile', 'Vincent']),
    /restricted to Chrome profile Otto/,
  );
  assert.throws(() => resolveSalesforceBrowserAuthentication([]), /requires --environment/);

  const invalid = JSON.parse(JSON.stringify(FCOS_CONNECTION_POLICY));
  invalid.providers.find(({ id }) => id === 'salesforce').environments[2].browserProfile = 'Otto';
  assert.throws(() => validateFcosConnectionPolicy(invalid), /does not match the approved environment mapping/);
  assert.doesNotMatch(JSON.stringify(FCOS_CONNECTION_POLICY), /passkey/i);
});

test('attestation sanitization retains only fixed non-secret fields', () => {
  const value = attestation();
  value.providers.supabase.accessToken = 'do-not-store';
  value.providers.github.cliOutput = 'do-not-store';
  value.providers.vercel.permissions.push('unapproved.permission');
  value.notes = 'do-not-store';
  const safe = sanitizeConnectionAttestation(value);
  const serialized = JSON.stringify(safe);
  assert.ok(safe);
  assert.doesNotMatch(serialized, /do-not-store|accessToken|cliOutput|notes|unapproved\.permission/);
  assert.deepEqual(safe.providers.github.permissions, CONNECTION_TARGETS[0].requiredPermissions);
  assert.equal(safe.providers.supabase.credentialStorage, 'macos_keychain');
});

test('live attestation state handles freshness, warnings, failures, and expiry', () => {
  assert.deepEqual(connectionAttestationState(attestation(), new Date('2026-08-09T08:10:00.000Z')), {
    status: 'verified',
    ageSeconds: 600,
    verifiedCount: 4,
    warningCount: 0,
  });

  const warned = attestation();
  warned.providers.vercel = providerReport('vercel', { warningCodes: ['credential_rotation_due'] });
  assert.equal(connectionAttestationState(warned, new Date('2026-08-09T08:10:00.000Z')).status, 'warning');

  const failed = attestation();
  failed.providers.supabase = providerReport('supabase', { identityVerified: false, identityStatus: 'authentication_blocked' });
  assert.equal(connectionAttestationState(failed, new Date('2026-08-09T08:10:00.000Z')).status, 'failed');
  assert.equal(connectionAttestationState(attestation(), new Date('2026-08-10T09:00:00.000Z')).status, 'expired');
});

test('canonical attestation output is stable after sanitization', () => {
  const first = canonicalConnectionAttestation(attestation());
  const second = canonicalConnectionAttestation(JSON.parse(first));
  assert.equal(first, second);
  assert.throws(() => canonicalConnectionAttestation({ accessToken: 'secret' }), /invalid/);
});

test('Salesforce promotions fail closed and enforce DEVEE, GitHub, QAT, Production order', async () => {
  const source = await readFile(new URL('../scripts/deploy-salesforce-environments.mjs', import.meta.url), 'utf8');
  assert.match(source, /display\?\.username === environment\.username/);
  assert.match(source, /display\?\.connectedStatus !== 'Connected'/);
  assert.match(source, /organization\?\.IsSandbox !== environment\.isSandbox/);
  assert.match(source, /sync-salesforce-shared-repository\.mjs/);
  assert.match(source, /promotion requires an explicit reviewed manifest/);
  assert.match(source, /manifestTestClasses/);
  assert.match(source, /Apex promotion manifest must include at least one \*Test Apex class/);
  assert.match(source, /EXPECTED_ORDER = \['devee', 'qat', 'production'\]/);
  assert.match(source, /writeDeveeSourceState/);
  assert.match(source, /FCOS_SALESFORCE_TEST_LEVEL/);
  assert.match(source, /manifestHasApex \? 'RunLocalTests' : 'RunRelevantTests'/);
  assert.match(source, /\['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'\]\.includes\(TEST_LEVEL\)/);
  assert.match(source, /deploymentMode: !manifestHasApex && MANIFEST \? 'all-or-none-metadata' : 'validated-quick-deploy'/);
  assert.match(source, /--schema-cutover/);
  assert.match(source, /--schema-bootstrap/);
  assert.match(source, /all-or-none-schema-bootstrap/);
  assert.match(source, /'project', 'deploy', 'start'/);
  assert.match(source, /FCOS_Variable_Charges_Integration/);
  assert.match(source, /FCOS_Variable_Charges_API/);
  assert.match(source, /assignPermission\(environment, VARIABLE_CHARGE_DATA_PERMISSION\)/);
  assert.match(source, /environment\.isSandbox \? 'NoTestRun' : 'RunRelevantTests'/);
  assert.match(source, /Salesforce source must use LF line endings/);
  assert.ok(
    source.indexOf('const deveeDeployment = deploy(deveeValidation)') < source.indexOf("['scripts/sync-salesforce-shared-repository.mjs', '--publish']"),
    'DEVEE must be deployed successfully before shared publication.',
  );
  assert.ok(
    source.indexOf("['scripts/sync-salesforce-shared-repository.mjs', '--publish']") < source.indexOf('salesforce.environments.slice(1)'),
    'Shared publication must succeed before QAT and Production promotion.',
  );
});
