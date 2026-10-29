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
// Explicit seven-file runtime observer child; no refresh, business mutation or historical pin substitution.
export const COMPATIBILITY_RUNTIME_METERING_CORRECTION = Object.freeze({
  "baseSha": "8d4cb87391c55de6debab92b9ab34827af17bea3",
  "candidateSha": "1e25147dc9fc9ba008096f1200b681993d49d428",
  "sourceProfile": "compat_runtime_metering_20261024",
  "kind": "explicit_metered_runtime_observation_correction",
  "probeProtocol": "xero_metered_v1",
  "files": [
    {
      "path": "api/_connectionRuntime.js",
      "sha256": "7f70b93d8d827ef996e52572258c201a948fc555613b9b760864321be37c9eb0",
      "gitBlob": "3b5e6d4173f9cf206b5755d323f30cf68d2ec557"
    },
    {
      "path": "api/_xeroRuntimeObservation.js",
      "sha256": "ec86f8f8d7cd5d8d7568889841182e8727e7d47503ca72bb6a94efb0d57c2a51",
      "gitBlob": "8085627320dc80bdb9dfa56506fa5892525e2931"
    },
    {
      "path": "api/connection-runtime.js",
      "sha256": "26d151c0db6c24e9fd36e0860915a52c4f450317dfd8065a6e55ab78d4eb4e7e",
      "gitBlob": "fa5f214be2db2d8529dbec70f6ff1e1bec3dc1b3"
    },
    {
      "path": "eslint.config.js",
      "sha256": "2da40095a69a1059013a93893201f23a0c69ef93eed8bd9e23bef27f3d6f639d",
      "gitBlob": "22e17e5c74eebc2508a4d1b454812c70c3249736"
    },
    {
      "path": "tests/connectionRuntime.test.js",
      "sha256": "312ea3112c8f5a28e49ade91acf924aadbd860b90480c77ff246fd33c5d65be0",
      "gitBlob": "9c341f813ef272b51d551cf0334290bebcb85ca9"
    },
    {
      "path": "tests/connectionRuntimeAppOwnedSalesforce.test.js",
      "sha256": "dc58bd698fd4a2c2c5bdc5751eb88cc4519ff7b6a94320957538b8ce71109072",
      "gitBlob": "82f8cb96691bc15028b9c10b6c9971f7b7af95a5"
    },
    {
      "path": "tests/xeroRuntimeObservation.test.js",
      "sha256": "efbca13682fb36dc19a9adce8b86c99376fd9c07c86ee4478624f2b9fb3c30df",
      "gitBlob": "66668f66f09bb9ac580f03f3702c43c365d5a351"
    }
  ],
  "existingUi": false,
  "handoffs": [],
  "salesforceMetadataChanged": false,
  "cronSchedulesChanged": false
});
// Real child ships the public runtime dependency and narrows only the metadata probe RPC.
export const COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION = Object.freeze({
  "baseSha": "1e25147dc9fc9ba008096f1200b681993d49d428",
  "candidateSha": "9152fa655b6e507a568d773534404843595fe323",
  "sourceProfile": "compat_runtime_dependency_20261024",
  "kind": "explicit_runtime_public_dependency_and_scoped_connections_admission",
  "probeProtocol": "xero_metered_v1",
  "files": [
    {
      "path": "api/_xeroRuntimeObservation.js",
      "sha256": "f22edd5349f39a37b37b1cfd128da55ecf1d6ea5b726f323461cf50752fccf95",
      "gitBlob": "a7008050bbf03e9e7507ba42594a9c897c864d94"
    },
    {
      "path": "api/_xeroSharedControl.js",
      "sha256": "eaad8c82ccf91b367551bcb930339c5dff1cdfbd456279c66e5973889474d289",
      "gitBlob": "a415626003c100c422a1eaee9ca8e4dc38e47a81"
    },
    {
      "path": "config/preview-parity-policy.json",
      "sha256": "fe95da075bca9aa9ae0757a838cbd79752f6db95892c9544dfde1fe6f911c586",
      "gitBlob": "e94ec56ed11798cbe01d771bac9ba9862b749258"
    },
    {
      "path": "tests/xeroSharedControl.test.js",
      "sha256": "d21a6672d250161800e5686ed17c3d36f7d35b3f3b269b41e69540873bae3f60",
      "gitBlob": "27b85300172cff52e244f7e387afc4ea5bbe4b9b"
    }
  ],
  "existingUi": false,
  "handoffs": [],
  "salesforceMetadataChanged": false,
  "cronSchedulesChanged": false
});
// Exact child uses ordinary Connections admission; all legacy financial paths stay unchanged.
export const COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION = Object.freeze({
  "baseSha": "9152fa655b6e507a568d773534404843595fe323",
  "candidateSha": "be6daf6162480ca77ec8d4f04fe5aaa5b228a22c",
  "sourceProfile": "compat_runtime_ordinary_admission_20261025",
  "kind": "explicit_runtime_ordinary_connections_admission",
  "probeProtocol": "xero_metered_v1",
  "files": [
    {
      "path": "api/_xeroRuntimeObservation.js",
      "sha256": "62cab83bf62cdc2711a8aad763c0661a51bdf817b8f6305a555e8f689bf10b0c",
      "gitBlob": "eba1436a1ac86bb74313ba6f26870ff6f712d457"
    },
    {
      "path": "api/_xeroSharedControl.js",
      "sha256": "e42d0c5861fafb1c352f5f6d95341a0a65480a7223f79e7bd1304a621cbd23e8",
      "gitBlob": "7e26e5a2d30ef74724ba4583b7479265108d0220"
    },
    {
      "path": "tests/connectionRuntime.test.js",
      "sha256": "6082e5d61f69db7251d27cc0f6ff6e94a4a7e6c5ae3bfc1b4424fcf129546937",
      "gitBlob": "c7f8bdbe7ee1268fa5bb6146b68e14d316dc2a63"
    },
    {
      "path": "tests/xeroRuntimeObservation.test.js",
      "sha256": "799cbef9938f72cb239d0a564845a848204a32f156a944c5dd872211b7b2c31e",
      "gitBlob": "0e70aed75f526241c6edab16c5cfa242ad223c88"
    },
    {
      "path": "tests/xeroSharedControl.test.js",
      "sha256": "6f94f09092b1fe040a44c9247ff87d9e5dd8c90c47fdaa1fa95216ec2c21dcf2",
      "gitBlob": "dbf94cd5104ed259370022af0619cbb38a82186e"
    }
  ],
  "existingUi": false,
  "handoffs": [],
  "salesforceMetadataChanged": false,
  "cronSchedulesChanged": false
});
export function isFirstRuntimeCandidateSha(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha || value === COMPATIBILITY_CORRECTION.candidateSha
    || value === COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha || value === COMPATIBILITY_DIAGNOSTIC_CORRECTION.candidateSha || value === COMPATIBILITY_VERIFICATION_CORRECTION.candidateSha || value === COMPATIBILITY_MEASUREMENT_CORRECTION.candidateSha || value === COMPATIBILITY_RUNTIME_METERING_CORRECTION.candidateSha || value === COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION.candidateSha || value === COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION.candidateSha;
}
export function firstRuntimeCandidateProfile(value) {
  return value === COMPATIBILITY_CORRECTION.baseSha ? 'frozen_04ee'
    : value === COMPATIBILITY_CORRECTION.candidateSha ? COMPATIBILITY_CORRECTION.sourceProfile
      : value === COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha ? COMPATIBILITY_CONFIGURATION_CORRECTION.sourceProfile
        : value === COMPATIBILITY_DIAGNOSTIC_CORRECTION.candidateSha ? COMPATIBILITY_DIAGNOSTIC_CORRECTION.sourceProfile
          : value === COMPATIBILITY_VERIFICATION_CORRECTION.candidateSha ? COMPATIBILITY_VERIFICATION_CORRECTION.sourceProfile
            : value === COMPATIBILITY_MEASUREMENT_CORRECTION.candidateSha ? COMPATIBILITY_MEASUREMENT_CORRECTION.sourceProfile
              : value === COMPATIBILITY_RUNTIME_METERING_CORRECTION.candidateSha ? COMPATIBILITY_RUNTIME_METERING_CORRECTION.sourceProfile
                : value === COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION.candidateSha ? COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION.sourceProfile
                  : value === COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION.candidateSha ? COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION.sourceProfile : null;
}
// Old immutable compatibility source cannot acquire a new endpoint protocol by
// adding a manifest marker. Other application source may explicitly opt in.
export function runtimeProbeProtocolMatches(candidate, protocol) {
  const pin = [COMPATIBILITY_RUNTIME_METERING_CORRECTION, COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION, COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION]
    .find(value => candidate?.sha === value.candidateSha || candidate?.sourceProfile === value.sourceProfile);
  if (pin)
    return candidate.sha === pin.candidateSha && candidate.sourceProfile === pin.sourceProfile && protocol === pin.probeProtocol;
  if (isFirstRuntimeCandidateSha(candidate?.sha)) return protocol === undefined;
  return protocol === undefined || protocol === COMPATIBILITY_RUNTIME_METERING_CORRECTION.probeProtocol;
}
