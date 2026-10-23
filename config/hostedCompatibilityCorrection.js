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
// Explicit diagnostic-only child: failure metadata changes, while source hashing,
// executable-mode attestation and refusal behavior remain mandatory and unchanged.
export const COMPATIBILITY_DIAGNOSTIC_CORRECTION = Object.freeze({
  baseSha: '2ef733d17dd12314c72971c2220b2b09903a6bf0',
  candidateSha: '160edcccc3347596ac18bb5c9dcb34ecc26df02b',
  sourceProfile: 'compat_source_diagnostics_20261023',
  kind: 'explicit_bounded_source_attestation_diagnostics',
  files: [{
    path: 'scripts/lib/build-provenance.mjs',
    sha256: '96ec0600534ad64a81a617960cb7a712aea9355c801c12b07232881e184b69b8',
    gitBlob: '3d2b1e68123b5f57eec35a5bb57c84aca7df3f42',
  }],
  existingUi: false,
  handoffs: [],
  salesforceMetadataChanged: false,
  cronSchedulesChanged: false,
});
// Verification-only successor; runtime, XLS format, financial scope and historical pins are unchanged.
export const COMPATIBILITY_VERIFICATION_CORRECTION = Object.freeze({
  "baseSha": "160edcccc3347596ac18bb5c9dcb34ecc26df02b",
  "candidateSha": "bf517a8ba86f8c210eacd2b9dd859ca7c4d48e3d",
  "sourceProfile": "compat_verification_harness_20261024",
  "kind": "explicit_isolated_verification_harness_correction",
  "files": [
    {
      "path": "scripts/lib/migration-verification.mjs",
      "sha256": "6a5bbe04c986ffab9672297f11f9feb2c1cb2afba78b04aedd79bc267b38643e",
      "gitBlob": "2db452c81d4de8285c06716b3429661908302960"
    },
    {
      "path": "scripts/verify-migrations.mjs",
      "sha256": "6a99e018d669a446df5143aeabc92dbb5b86783b1207a481b1493c41b2509ea3",
      "gitBlob": "8f77552aeee560f7565da0fcbe9feaf903fc4927"
    },
    {
      "path": "tests/clientSessionIsolation.test.js",
      "sha256": "f9da5ac531cd1cc1ecd7ea0636ae79c45fbc3d87c63da2faf0f630ed49c5648a",
      "gitBlob": "e17ee1d1a96d36eadbe729cbf9b305527a356aa1"
    },
    {
      "path": "tests/dashboardStemExport.test.js",
      "sha256": "974e1a371a088984a206bc1066730bdefc680150ef17caac49186145d14e9cb8",
      "gitBlob": "17ff6810b23549e18b04b2570f6597485b5e2abb"
    },
    {
      "path": "tests/migrationVerification.test.js",
      "sha256": "5a13af05a4fd8761f38d7fd5aa312689673fb49d631744063bb141c06a8f7cb7",
      "gitBlob": "e4f5471de746150bf21fd72150c488fbfa6792d9"
    },
    {
      "path": "tests/readOnlyCiAccess.test.js",
      "sha256": "eee8ab2fb11dcdd77f0e15861c977b11641dae0d857df45437a17631a4b94c55",
      "gitBlob": "bf65f0d549b860ea7118fe711aa60304a3d29947"
    }
  ],
  "existingUi": false,
  "handoffs": [],
  "salesforceMetadataChanged": false,
  "cronSchedulesChanged": false
});
// Measurement-only child: backend RSS crosses the verified parent boundary; business/runtime source and historical pins stay unchanged.
export const COMPATIBILITY_MEASUREMENT_CORRECTION = Object.freeze({
  "baseSha": "bf517a8ba86f8c210eacd2b9dd859ca7c4d48e3d",
  "candidateSha": "8d4cb87391c55de6debab92b9ab34827af17bea3",
  "sourceProfile": "compat_database_measurement_20261024",
  "kind": "explicit_native_database_measurement_harness_correction",
  "files": [
    {
      "path": "scripts/lib/hosted-release/backend-rss.mjs",
      "sha256": "e0393d24af2ddd88f7525d122b498c17ab7bfb9f0c5f7de4d85d6c5638bffcd2",
      "gitBlob": "724178822ef017aba994f2677778bb0582dcab44"
    },
    {
      "path": "tests/helpers/backendRss.mjs",
      "sha256": "1a6ca017469978a7be8090e1b0efd2933cf00c3b9a555f119e1ffc65456f949c",
      "gitBlob": "2fff36aa6b4c5c66a66b6cc064ccb49b82c8f8f2"
    },
    {
      "path": "tests/xeroPreviewCheckpointChunksDatabase.test.js",
      "sha256": "15eb234c8d2d5b5b3b9b5e0d5b7fa5c538ac0125608cb1f9ddaea6343bc70880",
      "gitBlob": "8c3866c508e893525ab884bddab7ca7b067a7562"
    },
    {
      "path": "tests/xeroPreviewPaymentsReferenceDatabase.test.js",
      "sha256": "d87fb429750125741760749453b13206cf3f84c217ec30cc0481e3cf2dcf8078",
      "gitBlob": "064403100ab0a8d320ce6ebe074cf26320a4aa10"
    }
  ],
  "existingUi": false,
  "handoffs": [],
  "salesforceMetadataChanged": false,
  "cronSchedulesChanged": false
});
export function isFirstRuntimeCandidateSha(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha || value === COMPATIBILITY_CORRECTION.candidateSha
    || value === COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha || value === COMPATIBILITY_DIAGNOSTIC_CORRECTION.candidateSha || value === COMPATIBILITY_VERIFICATION_CORRECTION.candidateSha || value === COMPATIBILITY_MEASUREMENT_CORRECTION.candidateSha;
}
export function firstRuntimeCandidateProfile(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha ? 'frozen_04ee'
    : value === COMPATIBILITY_CORRECTION.candidateSha ? COMPATIBILITY_CORRECTION.sourceProfile
      : value === COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha ? COMPATIBILITY_CONFIGURATION_CORRECTION.sourceProfile
        : value === COMPATIBILITY_DIAGNOSTIC_CORRECTION.candidateSha ? COMPATIBILITY_DIAGNOSTIC_CORRECTION.sourceProfile
          : value === COMPATIBILITY_VERIFICATION_CORRECTION.candidateSha ? COMPATIBILITY_VERIFICATION_CORRECTION.sourceProfile
            : value === COMPATIBILITY_MEASUREMENT_CORRECTION.candidateSha ? COMPATIBILITY_MEASUREMENT_CORRECTION.sourceProfile : null;
}
