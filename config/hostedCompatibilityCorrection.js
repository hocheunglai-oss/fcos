// Explicit reviewed-source proposal. This pin grants no deployment authority.
// Frozen04ee remains immutable; final Production approval must name the selected SHA.
export const COMPATIBILITY_CORRECTION = Object.freeze({
  "baseSha": "04ee3425aac7a49089eda781eb3c976aea1f6785",
  "candidateSha": "8f39dde6a6885292ce3b70cb61a78f8b86b947c3",
  "sourceProfile": "compat_application_auth_20261018",
  "kind": "explicit_application_owned_salesforce_auth_correction",
  "files": [
    {
      "path": "api/_connectionRuntime.js",
      "sha256": "ffd83414f5bbe61af5e97315035d03e11baf35b3986bd6fbf093f62bdc6c8eb8",
      "gitBlob": "993ce8a4009acb5b7db407ffcfde78a9f1134eba"
    },
    {
      "path": "tests/connectionRuntime.test.js",
      "sha256": "c5bc7702f244a5d01b5cb7c8ff1d4b00f84ff301f7a7ddf3de6f454ba15a29b5",
      "gitBlob": "37104b5a419bab39ca47d73a281476ccc088dc74"
    },
    {
      "path": "tests/connectionRuntimeAppOwnedSalesforce.test.js",
      "sha256": "d6c76fec4bf0149f6a4cbb3551b4cbfcc70346a92e2ca170b6ed2ae2a3dccae9",
      "gitBlob": "10441e922c505cc5dc7e86cb1f6fe207508beb3b"
    }
  ],
  "existingUi": false,
  "handoffs": [],
  "salesforceMetadataChanged": false,
  "cronSchedulesChanged": false
});
// Explicit one-file successor of the application-auth correction. Actual native
// build evidence showed Vercel materializing these same legacy name/version
// fields in vercel.json. Pin their idempotent source bytes; never substitute a
// remote digest under the immutable 8f39 source or omit configuration hashing.
export const COMPATIBILITY_CONFIGURATION_CORRECTION = Object.freeze({
  baseSha: '8f39dde6a6885292ce3b70cb61a78f8b86b947c3',
  candidateSha: '2ef733d17dd12314c72971c2220b2b09903a6bf0',
  sourceProfile: 'compat_source_config_20261020',
  kind: 'explicit_vercel_configuration_canonicalization',
  files: [{
    path: 'vercel.json',
    sha256: 'c577e95c03bc74142ecacad231c64b166b95ce30b4498d64b0c18b133689d6d7',
    gitBlob: 'f17dde99d5c9a6152011a53cf05d1164b1d78a77',
  }],
  existingUi: false,
  handoffs: [],
  salesforceMetadataChanged: false,
  cronSchedulesChanged: false,
});
export function isFirstRuntimeCandidateSha(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha || value === COMPATIBILITY_CORRECTION.candidateSha
    || value === COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha;
}
export function firstRuntimeCandidateProfile(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha ? 'frozen_04ee'
    : value === COMPATIBILITY_CORRECTION.candidateSha ? COMPATIBILITY_CORRECTION.sourceProfile
      : value === COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha ? COMPATIBILITY_CONFIGURATION_CORRECTION.sourceProfile : null;
}
