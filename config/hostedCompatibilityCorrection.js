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
export function isFirstRuntimeCandidateSha(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha || value === COMPATIBILITY_CORRECTION.candidateSha;
}
export function firstRuntimeCandidateProfile(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha ? 'frozen_04ee'
    : value === COMPATIBILITY_CORRECTION.candidateSha ? COMPATIBILITY_CORRECTION.sourceProfile : null;
}
