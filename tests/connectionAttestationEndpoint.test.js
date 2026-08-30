import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validatedEnvelope } from '../api/connection-attestation.js';
import {
  CONNECTION_ATTESTATION_POLICY,
  CONNECTION_POLICY_VERSION,
  CONNECTION_PROFILE_NAME,
  CONNECTION_TARGETS,
  canonicalConnectionAttestation,
} from '../src/lib/connectionChecklist.js';

function payload(verifiedAt = '2026-08-09T08:00:00.000Z') {
  const providers = Object.fromEntries(CONNECTION_TARGETS.map((provider) => [provider.id, {
    provider: provider.id,
    cliAvailable: true,
    cliVersion: provider.cliVersion.exact || provider.cliVersion.minimum,
    cliVersionStatus: 'approved',
    identityStatus: 'verified',
    identityVerified: true,
    targetPin: 'verified',
    permissionStatus: 'verified',
    permissions: provider.requiredPermissions,
    latencyMs: 10,
    authorizedAt: verifiedAt,
    expiresAt: null,
    credentialAgeDays: 0,
    credentialLifecycle: 'current',
    lastVerifiedAt: verifiedAt,
    warningCodes: [],
  }]));
  return {
    schemaVersion: 1,
    policyVersion: CONNECTION_POLICY_VERSION,
    profile: CONNECTION_PROFILE_NAME,
    keyId: CONNECTION_ATTESTATION_POLICY.keyId,
    verifiedAt,
    expiresAt: new Date(new Date(verifiedAt).getTime() + 86_400_000).toISOString(),
    durationMs: 40,
    providers,
  };
}

test('attestation endpoint accepts only a current valid Ed25519 signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const attestation = payload();
  const signature = sign(null, Buffer.from(canonicalConnectionAttestation(attestation)), privateKey).toString('base64url');
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const accepted = validatedEnvelope({ attestation, signature }, new Date('2026-08-09T08:02:00.000Z'), publicKeySpki);
  assert.equal(accepted.profile, CONNECTION_PROFILE_NAME);
  assert.equal(accepted.providers.vercel.credentialStorage, 'macos_keychain');
  assert.throws(
    () => validatedEnvelope({ attestation: { ...attestation, durationMs: 41 }, signature }, new Date('2026-08-09T08:02:00.000Z'), publicKeySpki),
    /signature is invalid/,
  );
  assert.throws(
    () => validatedEnvelope({ attestation, signature }, new Date('2026-08-09T09:00:00.000Z'), publicKeySpki),
    /timestamp/,
  );
});

test('connection attestation migration is service-only and atomic', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260809160614_connection_attestations.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.connection_attestations from public, anon, authenticated/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /current_user <> 'service_role'/i);
  assert.match(sql, /before update or delete on public\.connection_attestations/i);
});
