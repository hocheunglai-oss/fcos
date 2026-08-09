const connectionPolicy = {
  schemaVersion: 1,
  policyVersion: 2,
  profile: 'fcos-production',
  browserProfile: 'Otto',
  localStateDirectory: '.fcos-cli',
  verifyCommand: 'npm run connections:verify',
  doctorCommand: 'npm run connections:doctor',
  keychainAccount: 'fcos-production',
  keychainHelper: '.fcos-cli/bin/fcos-keychain',
  attestation: {
    endpoint: 'https://fcos.fcuno.com/api/connection-attestation',
    keyId: '83547b3ca6f2741f',
    publicKeySpkiBase64: 'MCowBQYDK2VwAyEAn6IEjZjpSdJ38z0lO+Exk0/hGG7ojmy24PUp+CYUdFY=',
    privateKeyService: 'com.fcos.connections.attestation.ed25519',
    maxClockSkewSeconds: 300,
    freshnessSeconds: 900,
    staleSeconds: 86400,
  },
  sequence: [
    {
      id: 'cli_availability',
      label: 'Verify CLI availability and version',
      detail: 'Confirm the approved provider CLI is installed and compatible before checking any authenticated identity.',
    },
    {
      id: 'target_identity',
      label: 'Verify account, team, project, and permissions',
      detail: 'Compare live CLI identity and read-only capability probes with the exact approved identifiers. Stop on any mismatch.',
    },
    {
      id: 'cli_use',
      label: 'Use the verified CLI',
      detail: 'Continue through the target-locked wrapper while the identity, target pin, version, and required permissions remain valid.',
    },
    {
      id: 'browser_fallback',
      label: 'Use Otto only for blocked authentication',
      detail: 'Chrome remains locked unless the CLI cannot authenticate. Return to the CLI and publish a signed verification afterward.',
    },
  ],
  providers: [
    {
      id: 'github',
      provider: 'GitHub',
      cli: 'gh',
      executable: 'gh',
      identifiers: [
        { label: 'Required account', value: 'hocheunglai-oss' },
        { label: 'Repository', value: 'hocheunglai-oss/fcos' },
      ],
      cliVersion: { minimum: '2.96.0', maximumExclusive: '3.0.0' },
      requiredPermissions: ['repository.read', 'repository.push', 'workflow.update'],
      availabilityCommand: 'gh --version',
      identityCommand: 'npm run connections:verify -- github',
      authCommand: 'npm run connections:auth -- github',
      useCommand: 'npm run connections:cli -- github -- <gh arguments>',
      authorizationMode: 'Repo-isolated OAuth authorization',
      isolationMechanism: 'GH_CONFIG_DIR + OS credential protection',
      configPath: '.fcos-cli/github',
      profileName: 'fcos-github',
      fullyIsolated: true,
      credentialStorage: 'provider_secure_store',
      rotationWarningDays: 180,
      expiryWarningDays: 30,
      persistence: 'GitHub OAuth is selected only through the ignored repo-local GH_CONFIG_DIR and the provider-supported secure credential store.',
      nonBrowserRoute: 'Fail closed on any other GitHub identity. Use the approved GitHub connector/API only when it can preserve the same repository boundary.',
    },
    {
      id: 'vercel',
      provider: 'Vercel',
      cli: 'vercel',
      executable: 'vercel',
      identifiers: [
        { label: 'Account', value: 'hocheunglai-6535' },
        { label: 'Team', value: 'hocheunglai-6535s-projects' },
        { label: 'Team ID', value: 'team_MbKDazzCrou3eKTuausPv4X2' },
        { label: 'Project', value: 'fcos' },
        { label: 'Project ID', value: 'prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs' },
        { label: 'Target', value: 'hocheunglai-6535s-projects/fcos' },
      ],
      cliVersion: { exact: '54.20.1' },
      requiredPermissions: ['project.read', 'deployment.read', 'deployment.create'],
      availabilityCommand: 'vercel --version',
      identityCommand: 'npm run connections:verify -- vercel',
      authCommand: 'npm run connections:auth -- vercel',
      useCommand: 'npm run connections:cli -- vercel -- <vercel arguments>',
      authorizationMode: 'Keychain-backed repo-isolated authorization',
      isolationMechanism: 'Pinned CLI + macOS Keychain + --global-config',
      configPath: '.fcos-cli/vercel',
      profileName: 'fcos-vercel',
      fullyIsolated: true,
      credentialStorage: 'macos_keychain',
      keychainService: 'com.fcos.connections.vercel',
      rotationWarningDays: 90,
      expiryWarningDays: 30,
      persistence: 'The Vercel token is retrieved from a dedicated macOS Keychain item; only target pins and non-secret metadata remain in ignored local files.',
      nonBrowserRoute: 'Use the scoped Vercel CLI or API only after the exact account, team ID, project ID, and deployment access probes pass.',
    },
    {
      id: 'supabase',
      provider: 'Supabase',
      cli: 'supabase',
      executable: 'node_modules/.bin/supabase',
      identifiers: [
        { label: 'Project name', value: 'FCOS' },
        { label: 'Project ref', value: 'pjforfvchygdyqfcgpmw' },
      ],
      cliVersion: { exact: '2.113.0' },
      requiredPermissions: ['project.read', 'project.link'],
      availabilityCommand: 'npx --no-install supabase --version',
      identityCommand: 'npm run connections:verify -- supabase',
      authCommand: 'npm run connections:auth -- supabase',
      useCommand: 'npm run connections:cli -- supabase -- <supabase arguments>',
      authorizationMode: 'Keychain-backed repo-isolated authorization',
      isolationMechanism: 'Pinned CLI + macOS Keychain + SUPABASE_HOME',
      configPath: '.fcos-cli/supabase',
      profileName: 'fcos-pjforfvchygdyqfcgpmw',
      fullyIsolated: true,
      credentialStorage: 'macos_keychain',
      keychainService: 'com.fcos.connections.supabase',
      rotationWarningDays: 90,
      expiryWarningDays: 14,
      persistence: 'The Supabase personal access token is retrieved from a dedicated macOS Keychain item; the pinned CLI and exact project link remain repo-local.',
      nonBrowserRoute: 'Use the approved Supabase connector/API only after the exact project ref and project visibility probe pass.',
    },
    {
      id: 'salesforce',
      provider: 'Salesforce',
      cli: 'sf',
      executable: 'sf',
      identifiers: [
        { label: 'Environment', value: 'Production' },
        { label: 'Org ID', value: '00D2x000000Ei4oEAC' },
        { label: 'Alias', value: 'source-salesforce' },
      ],
      cliVersion: { minimum: '2.145.6', maximumExclusive: '3.0.0' },
      requiredPermissions: ['organization.read', 'data.query'],
      availabilityCommand: 'sf version --json',
      identityCommand: 'npm run connections:verify -- salesforce',
      authCommand: 'npm run connections:auth -- salesforce',
      useCommand: 'npm run connections:cli -- salesforce -- <sf arguments>',
      authorizationMode: 'Repo-pinned target with protected host authorization',
      isolationMechanism: 'Project-local target-org + SF_TARGET_ORG',
      configPath: '.sf',
      profileName: 'source-salesforce',
      fullyIsolated: false,
      credentialStorage: 'protected_host_store',
      rotationWarningDays: 90,
      expiryWarningDays: 30,
      persistence: 'Salesforce CLI has no alternate auth home. FCOS retains its protected host session, pins the alias locally, and revalidates the production org and query capability live.',
      nonBrowserRoute: 'Use Salesforce CLI or the approved API only after both the production Organization record and data-query capability match.',
    },
  ],
};

function requireString(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Connection policy requires ${path}.`);
}

function requirePositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Connection policy requires positive integer ${path}.`);
}

export function validateFcosConnectionPolicy(value = connectionPolicy) {
  if (!value || typeof value !== 'object') throw new Error('Connection policy must be an object.');
  requirePositiveInteger(value.schemaVersion, 'schemaVersion');
  requirePositiveInteger(value.policyVersion, 'policyVersion');
  requireString(value.profile, 'profile');
  requireString(value.browserProfile, 'browserProfile');
  requireString(value.localStateDirectory, 'localStateDirectory');
  requireString(value.keychainHelper, 'keychainHelper');
  requireString(value.attestation?.endpoint, 'attestation.endpoint');
  requireString(value.attestation?.keyId, 'attestation.keyId');
  requireString(value.attestation?.publicKeySpkiBase64, 'attestation.publicKeySpkiBase64');
  requirePositiveInteger(value.attestation?.freshnessSeconds, 'attestation.freshnessSeconds');
  requirePositiveInteger(value.attestation?.staleSeconds, 'attestation.staleSeconds');
  if (value.attestation.staleSeconds <= value.attestation.freshnessSeconds) {
    throw new Error('Connection policy staleSeconds must exceed freshnessSeconds.');
  }
  const expectedProviders = ['github', 'vercel', 'supabase', 'salesforce'];
  if (!Array.isArray(value.providers) || value.providers.length !== expectedProviders.length) {
    throw new Error('Connection policy must define exactly four providers.');
  }
  if (value.providers.map(({ id }) => id).join(',') !== expectedProviders.join(',')) {
    throw new Error('Connection policy provider order or identifiers are invalid.');
  }
  for (const provider of value.providers) {
    requireString(provider.provider, `${provider.id}.provider`);
    requireString(provider.cli, `${provider.id}.cli`);
    requireString(provider.executable, `${provider.id}.executable`);
    requireString(provider.configPath, `${provider.id}.configPath`);
    requireString(provider.profileName, `${provider.id}.profileName`);
    requireString(provider.credentialStorage, `${provider.id}.credentialStorage`);
    requirePositiveInteger(provider.rotationWarningDays, `${provider.id}.rotationWarningDays`);
    requirePositiveInteger(provider.expiryWarningDays, `${provider.id}.expiryWarningDays`);
    if (!Array.isArray(provider.identifiers) || !provider.identifiers.length) throw new Error(`${provider.id} identifiers are required.`);
    if (!Array.isArray(provider.requiredPermissions) || !provider.requiredPermissions.length) throw new Error(`${provider.id} permissions are required.`);
    if (!provider.cliVersion?.exact && !provider.cliVersion?.minimum) throw new Error(`${provider.id} CLI version policy is required.`);
    if (provider.credentialStorage === 'macos_keychain') requireString(provider.keychainService, `${provider.id}.keychainService`);
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

validateFcosConnectionPolicy(connectionPolicy);

export const FCOS_CONNECTION_POLICY = deepFreeze(connectionPolicy);
export default FCOS_CONNECTION_POLICY;
