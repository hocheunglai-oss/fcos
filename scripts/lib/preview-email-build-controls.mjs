// Declaration-only leaf: the live admission collector and its build consumers
// share this closure without importing each other during ESM initialization.
export const PREVIEW_EMAIL_BUILD_CONTROL_FILES = Object.freeze([
  '.github/workflows/preview-email-proof-build.yml', 'scripts/preview-email-proof-build.mjs', 'scripts/lib/preview-email-build.mjs',
  'scripts/lib/preview-vercel-authority.mjs', 'scripts/lib/preview-vercel-enrollment.mjs', 'scripts/preview-vercel-enrollment.mjs', 'scripts/fcos-keychain-migrate.swift',
  'scripts/lib/release-evidence.mjs', 'scripts/lib/release-workflow.mjs', '.github/workflows/routine-release.yml', 'scripts/lib/release-production.mjs', 'scripts/lib/release-readiness.mjs',
  'scripts/lib/preview-parity.mjs', 'scripts/lib/build-provenance.mjs', 'config/legacy-email-baseline-proof.json',
  'scripts/lib/legacy-email-baseline-proof.mjs', 'scripts/lib/preview-email-signer.mjs', 'scripts/verify-e2e-candidate.mjs',
  'config/preview-parity-policy.json', 'config/fcosConnections.js', 'config/fcosCiIdentity.js', 'package.json', 'package-lock.json',
  '.github/workflows/candidate-quality.yml', '.github/quality-candidates/f4576a8c918acef686f084c505b1715de11deeb8.json',
  'scripts/candidate-quality-receipt.mjs', 'scripts/lib/candidate-quality.mjs',
  'scripts/lib/preview-email-build-controls.mjs', 'scripts/lib/runtime-compatibility-successor-live.mjs',
  'scripts/lib/runtime-compatibility-successor-adapter.mjs', 'config/runtime-compatibility-successor-live.json',
  'scripts/preview-vercel-successor-attest.mjs', 'scripts/lib/preview-vercel-successor-attestation.mjs',
  'scripts/lib/github-provider-timestamp.mjs', 'scripts/lib/preview-email-coordination.mjs',
  'scripts/lib/preview-email-coordination-collector.mjs', 'scripts/lib/preview-email-coordination-ledger.py',
  'scripts/lib/preview-email-coordination-archive.mjs',
  'scripts/preview-email-coordinator-local.mjs', 'docs/preview-email-coordination.md',
]);
