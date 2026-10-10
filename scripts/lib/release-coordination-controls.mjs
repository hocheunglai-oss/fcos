// Declaration-only closure shared by the release and successor fingerprint collectors.
export const RELEASE_COORDINATION_CONTROL_FILES = Object.freeze([
  '.github/workflows/release-coordination-proof.yml', 'scripts/release-coordination-proof.mjs',
  '.github/actions/release-executor/action.yml', 'scripts/release-action.mjs',
  'scripts/production-release.mjs', 'scripts/lib/release-production.mjs',
  'scripts/release-coordinator-local.mjs', 'scripts/lib/release-coordination-controls.mjs',
  'scripts/lib/release-coordination.mjs', 'scripts/lib/release-coordination-trust.mjs',
  'scripts/lib/release-coordination-transport.mjs', 'scripts/lib/release-coordination-ledger.py',
  'scripts/lib/preview-email-coordination.mjs', 'scripts/lib/preview-email-coordination-archive.mjs',
  'scripts/fcos-keychain-migrate.swift',
]);
