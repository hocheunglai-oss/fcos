import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
// This candidate changes only bounded source-attestation diagnostics. Historical
// encrypted dependencies retain their original candidate/AAD and immutable bytes.
export const DIAGNOSTIC_DEPENDENCY_CONTEXT = freeze({
  "candidate": {
    "sha": "160edcccc3347596ac18bb5c9dcb34ecc26df02b",
    "sourceProfile": "compat_source_diagnostics_20261023",
    "sourceSha256": "9f8b01198784d1e222f96f726207ef9c980f9ab5d2536e7a156ca97b2f307912",
    "lockSha256": "9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378",
    "configurationSha256": "331e9f360dd8fa0f9e1e2cafb8f0d5f50ecf26e2ac76323972e9bb7ff742a866",
    "salesforceSourceSha256": "4c2594c9986269e492487448d402334f43db35b06cb9c409377e728482739c64",
    "sourceInputsSha256": "a6bc646c45bdc92232cebb0f85fbb6a5104222aaf0493fba8ec03ebf79c73c0c",
    "branch": "codex/hosted-release-consolidation-20261017"
  },
  "contextCandidateSha": "2ef733d17dd12314c72971c2220b2b09903a6bf0",
  "dependenciesSha256": "e0e2debcd48c8575a63ecd316a5853f9815625ce7224c2f31ef808ee57fe3067",
  "seedSha256": "39dd8056e12b276ce31f08e0f9534fc7083b4cb0020ad4805c229d40e49297bf",
  "handoffSha256": "0e5c9447a34c13f2c5d746f36ce2077f8eefa7778e0601095ff4bd9dc3885e3d"
});

// Exact verification-only successor retains the unchanged sealed dependency context.
export const VERIFICATION_DEPENDENCY_CONTEXT = freeze({
  "candidate": {
    "sha": "bf517a8ba86f8c210eacd2b9dd859ca7c4d48e3d",
    "sourceProfile": "compat_verification_harness_20261024",
    "sourceSha256": "5e623f0cd15c2965901246089140af1fae2a0f1e0beea5500acdc26ef9f9af51",
    "lockSha256": "9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378",
    "configurationSha256": "331e9f360dd8fa0f9e1e2cafb8f0d5f50ecf26e2ac76323972e9bb7ff742a866",
    "salesforceSourceSha256": "4c2594c9986269e492487448d402334f43db35b06cb9c409377e728482739c64",
    "sourceInputsSha256": "cad0d4dfef0075a6c1a32e4885696b954369032601843c42d0136a705ef633e5",
    "branch": "codex/hosted-release-consolidation-20261017"
  },
  "contextCandidateSha": "2ef733d17dd12314c72971c2220b2b09903a6bf0",
  "dependenciesSha256": "e0e2debcd48c8575a63ecd316a5853f9815625ce7224c2f31ef808ee57fe3067",
  "seedSha256": "39dd8056e12b276ce31f08e0f9534fc7083b4cb0020ad4805c229d40e49297bf",
  "handoffSha256": "0e5c9447a34c13f2c5d746f36ce2077f8eefa7778e0601095ff4bd9dc3885e3d"
});

// Exact measurement-only child preserves the original sealed dependency AAD and objects.
export const MEASUREMENT_DEPENDENCY_CONTEXT = freeze({
  "candidate": {
    "sha": "8d4cb87391c55de6debab92b9ab34827af17bea3",
    "sourceProfile": "compat_database_measurement_20261024",
    "sourceSha256": "62a61819c54f54986b19918a44f5e69d5ae947129775a7a12520b5ebaec82dfb",
    "lockSha256": "9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378",
    "configurationSha256": "331e9f360dd8fa0f9e1e2cafb8f0d5f50ecf26e2ac76323972e9bb7ff742a866",
    "salesforceSourceSha256": "4c2594c9986269e492487448d402334f43db35b06cb9c409377e728482739c64",
    "sourceInputsSha256": "ca8a858fbbe7cfb46f2fa4a7823bbb7b71e6d16aac997bbd8f207388cf78a858",
    "branch": "codex/hosted-release-consolidation-20261017"
  },
  "contextCandidateSha": "2ef733d17dd12314c72971c2220b2b09903a6bf0",
  "dependenciesSha256": "e0e2debcd48c8575a63ecd316a5853f9815625ce7224c2f31ef808ee57fe3067",
  "seedSha256": "39dd8056e12b276ce31f08e0f9534fc7083b4cb0020ad4805c229d40e49297bf",
  "handoffSha256": "0e5c9447a34c13f2c5d746f36ce2077f8eefa7778e0601095ff4bd9dc3885e3d"
});

// Exact metered-runtime child retains only the original immutable dependency AAD and objects.
export const RUNTIME_METERING_DEPENDENCY_CONTEXT = freeze({
  "candidate": {
    "sha": "1e25147dc9fc9ba008096f1200b681993d49d428",
    "sourceProfile": "compat_runtime_metering_20261024",
    "sourceSha256": "5317444c5e3c732aa19642f9602db5301c1312fcc34cc7144811a42e7e31fb90",
    "lockSha256": "9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378",
    "configurationSha256": "1f65465122dc42cbf259c6dfb719591c8835357f0d8271b845c08323d632878c",
    "salesforceSourceSha256": "4c2594c9986269e492487448d402334f43db35b06cb9c409377e728482739c64",
    "sourceInputsSha256": "3c261f5040a2f97964fb6a0a02c48423f1b9f27bb5d7669cd0e6c494462f5def",
    "branch": "codex/hosted-release-consolidation-20261017"
  },
  "contextCandidateSha": "2ef733d17dd12314c72971c2220b2b09903a6bf0",
  "dependenciesSha256": "e0e2debcd48c8575a63ecd316a5853f9815625ce7224c2f31ef808ee57fe3067",
  "seedSha256": "39dd8056e12b276ce31f08e0f9534fc7083b4cb0020ad4805c229d40e49297bf",
  "handoffSha256": "0e5c9447a34c13f2c5d746f36ce2077f8eefa7778e0601095ff4bd9dc3885e3d"
});

export function dependencyContextCandidate(manifest, { seed, handoff } = {}) {
  const candidate = manifest?.candidate;
  const pin = [DIAGNOSTIC_DEPENDENCY_CONTEXT, VERIFICATION_DEPENDENCY_CONTEXT, MEASUREMENT_DEPENDENCY_CONTEXT, RUNTIME_METERING_DEPENDENCY_CONTEXT].find(value =>
    candidate?.sha === value.candidate.sha || candidate?.sourceProfile === value.candidate.sourceProfile);
  if (!pin) return candidate?.sha;
  const need = value => { if (!value) throw Object.assign(new Error('DEPENDENCY_CONTEXT_REQUIRED'), { code: 'DEPENDENCY_CONTEXT_REQUIRED' }); };
  need(candidate && canonical(candidate) === canonical(pin.candidate)
    && manifest.dependencies && typeof manifest.dependencies === 'object'
    && digest(manifest.dependencies) === pin.dependenciesSha256);
  if (seed !== undefined) need(digest(seed) === pin.seedSha256);
  if (handoff !== undefined) {
    const historical = { ...handoff }; delete historical.manifestHash;
    need(digest(historical) === pin.handoffSha256);
  }
  return pin.contextCandidateSha;
}
