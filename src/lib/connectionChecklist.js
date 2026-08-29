import { FCOS_CONNECTION_POLICY, validateFcosConnectionPolicy } from '../../config/fcosConnections.js';

validateFcosConnectionPolicy(FCOS_CONNECTION_POLICY);

export const APPROVED_CONNECTION_BROWSER_PROFILE = FCOS_CONNECTION_POLICY.browserProfile;
export const CONNECTION_PROFILE_NAME = FCOS_CONNECTION_POLICY.profile;
export const CONNECTION_LOCAL_STATE_DIRECTORY = FCOS_CONNECTION_POLICY.localStateDirectory;
export const CONNECTION_VERIFY_COMMAND = FCOS_CONNECTION_POLICY.verifyCommand;
export const CONNECTION_DOCTOR_COMMAND = FCOS_CONNECTION_POLICY.doctorCommand;
export const CONNECTION_CHECKLIST_SEQUENCE = FCOS_CONNECTION_POLICY.sequence;
export const CONNECTION_TARGETS = FCOS_CONNECTION_POLICY.providers;
export const CONNECTION_POLICY_VERSION = FCOS_CONNECTION_POLICY.policyVersion;
export const CONNECTION_ATTESTATION_POLICY = FCOS_CONNECTION_POLICY.attestation;
export const CONNECTION_INTEGRATIONS = FCOS_CONNECTION_POLICY.integrations;

const PROVIDER_IDS = new Set(CONNECTION_TARGETS.map(({ id }) => id));
const IDENTITY_STATES = new Set(['verified', 'mismatch', 'authentication_blocked', 'unavailable', 'error']);
const PIN_STATES = new Set(['verified', 'missing', 'mismatch', 'pending']);
const VERSION_STATES = new Set(['approved', 'warning', 'incompatible', 'unavailable']);
const PERMISSION_STATES = new Set(['verified', 'missing', 'unavailable', 'error']);
const LIFECYCLE_STATES = new Set(['current', 'rotation_due', 'expiring', 'expired', 'unknown']);
const WARNING_CODES = new Set([
  'cli_version_warning',
  'cli_version_incompatible',
  'credential_rotation_due',
  'credential_expiring',
  'credential_expired',
  'credential_expiry_unknown',
  'permission_probe_failed',
  'shared_metadata_out_of_date',
  'target_pin_missing',
  'salesforce_auth_not_isolated',
]);

function finiteInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function isoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function safeString(value, maximum = 80) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export function sanitizeConnectionProviderReport(value, providerId) {
  const provider = CONNECTION_TARGETS.find(({ id }) => id === providerId);
  if (!provider || !value || typeof value !== 'object') return null;
  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter((permission) => provider.requiredPermissions.includes(permission))
    : [];
  const warningCodes = Array.isArray(value.warningCodes)
    ? [...new Set(value.warningCodes.filter((code) => WARNING_CODES.has(code)))]
    : [];
  return {
    provider: providerId,
    cliAvailable: value.cliAvailable === true,
    cliVersion: safeString(value.cliVersion, 40) || null,
    cliVersionStatus: VERSION_STATES.has(value.cliVersionStatus) ? value.cliVersionStatus : 'unavailable',
    identityStatus: IDENTITY_STATES.has(value.identityStatus) ? value.identityStatus : 'error',
    identityVerified: value.identityVerified === true,
    targetPin: PIN_STATES.has(value.targetPin) ? value.targetPin : 'pending',
    permissionStatus: PERMISSION_STATES.has(value.permissionStatus) ? value.permissionStatus : 'error',
    permissions,
    latencyMs: finiteInteger(value.latencyMs),
    credentialStorage: provider.credentialStorage,
    authorizedAt: isoTimestamp(value.authorizedAt),
    expiresAt: isoTimestamp(value.expiresAt),
    credentialAgeDays: finiteInteger(value.credentialAgeDays),
    credentialLifecycle: LIFECYCLE_STATES.has(value.credentialLifecycle) ? value.credentialLifecycle : 'unknown',
    lastVerifiedAt: isoTimestamp(value.lastVerifiedAt),
    warningCodes,
  };
}

export function sanitizeConnectionAttestation(value) {
  if (!value || typeof value !== 'object') return null;
  const providers = Object.fromEntries(CONNECTION_TARGETS.map(({ id }) => [
    id,
    sanitizeConnectionProviderReport(value.providers?.[id], id),
  ]));
  if (Object.values(providers).some((provider) => !provider)) return null;
  const verifiedAt = isoTimestamp(value.verifiedAt);
  const expiresAt = isoTimestamp(value.expiresAt);
  if (
    value.schemaVersion !== 1
    || value.policyVersion !== CONNECTION_POLICY_VERSION
    || value.profile !== CONNECTION_PROFILE_NAME
    || value.keyId !== CONNECTION_ATTESTATION_POLICY.keyId
    || !verifiedAt
    || !expiresAt
  ) return null;
  return {
    schemaVersion: 1,
    policyVersion: CONNECTION_POLICY_VERSION,
    profile: CONNECTION_PROFILE_NAME,
    keyId: CONNECTION_ATTESTATION_POLICY.keyId,
    verifiedAt,
    expiresAt,
    durationMs: finiteInteger(value.durationMs),
    providers,
  };
}

export function connectionAttestationState(value, now = new Date()) {
  const attestation = sanitizeConnectionAttestation(value);
  if (!attestation) return { status: 'unavailable', ageSeconds: null, verifiedCount: 0, warningCount: 0 };
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const verifiedMs = new Date(attestation.verifiedAt).getTime();
  const expiresMs = new Date(attestation.expiresAt).getTime();
  const ageSeconds = Math.max(0, Math.floor((nowMs - verifiedMs) / 1000));
  const verifiedCount = Object.values(attestation.providers).filter((provider) => (
    provider.identityVerified
    && provider.targetPin === 'verified'
    && provider.permissionStatus === 'verified'
    && provider.cliVersionStatus !== 'incompatible'
  )).length;
  const warningCount = Object.values(attestation.providers).reduce((count, provider) => count + provider.warningCodes.length, 0);
  let status = 'verified';
  if (nowMs > expiresMs || ageSeconds > CONNECTION_ATTESTATION_POLICY.staleSeconds) status = 'expired';
  else if (ageSeconds > CONNECTION_ATTESTATION_POLICY.freshnessSeconds || warningCount) status = 'warning';
  if (verifiedCount !== CONNECTION_TARGETS.length) status = 'failed';
  return { status, ageSeconds, verifiedCount, warningCount };
}

export function canonicalConnectionAttestation(value) {
  const attestation = sanitizeConnectionAttestation(value);
  if (!attestation) throw new Error('Connection attestation payload is invalid.');
  return JSON.stringify(attestation);
}

export function connectionProviderById(providerId) {
  if (!PROVIDER_IDS.has(providerId)) throw new Error(`Unknown connection provider: ${providerId || '(missing)'}`);
  return CONNECTION_TARGETS.find(({ id }) => id === providerId);
}
