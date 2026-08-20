const connectionPolicy = {
  schemaVersion: 1,
  policyVersion: 7,
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
      label: 'Use only the pinned browser profile for blocked authentication',
      detail: 'Chrome remains locked unless the CLI cannot authenticate. Use Otto for FCOS, DEVEE, and QAT; Vincent for Salesforce Production; or vincexai only for the shared Salesforce GitHub account. Then return to the CLI and publish a signed verification.',
    },
  ],
  integrations: {
    googleDriveMarketReports: {
      accountEmail: 'vince.less@gmail.com',
      browserProfile: 'Vincent',
      rootFolderId: '1wzRycxzPAb42EvfhjPV22mkFwliXZv8d',
      syncSchedule: '0 * * * *',
      folders: [
        { documentType: 'bunkerwire', folderId: '19ACtDV2U9_JrV_AmRJuHL7A29-Yxini7', label: 'Bunkerwire' },
        { documentType: 'european_marketscan', folderId: '14uXNTTleIO2K78gTEVDEAl8IfJZH4Aj1', label: 'European Marketscan' },
      ],
    },
  },
  providers: [
    {
      id: 'github',
      provider: 'GitHub',
      cli: 'gh',
      executable: 'gh',
      identifiers: [
        { label: 'Required account', value: 'hocheunglai-oss' },
        { label: 'Repository', value: 'hocheunglai-oss/fcos' },
        { label: 'Browser fallback profile', value: 'Otto' },
      ],
      cliVersion: { minimum: '2.96.0', maximumExclusive: '3.0.0' },
      requiredPermissions: ['repository.read', 'repository.push', 'workflow.update', 'git.push.authentication'],
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
      persistence: 'GitHub OAuth and plain Git HTTPS pushes both resolve through the ignored repo-local GH_CONFIG_DIR. A repository-local credential helper resets inherited helpers without changing machine-wide Git configuration.',
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
        { label: 'Production Org ID', value: '00D2x000000Ei4oEAC' },
        { label: 'Production alias', value: 'source-salesforce' },
        { label: 'Devee Org ID', value: '00D1m0000008kioEAA' },
        { label: 'Devee alias', value: 'fcos-devee' },
        { label: 'Devee username', value: 'vincent@cosulich.com.hk.devee' },
        { label: 'QAT Org ID', value: '00D1s0000008lFEEAY' },
        { label: 'QAT alias', value: 'fcos-qat' },
        { label: 'QAT username', value: 'vincent@cosulich.com.hk.qat' },
        { label: 'DEVEE browser authentication profile', value: 'Otto' },
        { label: 'QAT browser authentication profile', value: 'Otto' },
        { label: 'Production browser authentication profile', value: 'Vincent' },
        { label: 'Shared GitHub account', value: 'vincelessxai' },
        { label: 'Shared GitHub account ID', value: '304336732' },
        { label: 'Shared Salesforce repository', value: 'ivanyk20/fcbhk' },
        { label: 'Shared repository path', value: 'src/' },
        { label: 'Shared browser fallback profile', value: 'vincexai' },
        { label: 'Development source', value: 'DEVEE only' },
        { label: 'Promotion order', value: 'DEVEE → GitHub → QAT → Production' },
      ],
      cliVersion: { minimum: '2.145.6', maximumExclusive: '3.0.0' },
      requiredPermissions: ['production.organization.read', 'production.data.query', 'devee.organization.read', 'devee.data.query', 'qat.organization.read', 'qat.data.query', 'shared.repository.read', 'shared.repository.push', 'shared.metadata.current'],
      availabilityCommand: 'sf version --json',
      identityCommand: 'npm run connections:verify -- salesforce',
      authCommand: 'npm run connections:auth -- salesforce',
      useCommand: 'npm run connections:cli -- salesforce -- <sf arguments>',
      authorizationMode: 'Repo-pinned target with protected host authorization',
      isolationMechanism: 'Project-local target-org + SF_TARGET_ORG',
      configPath: '.sf',
      profileName: 'fcos-devee',
      fullyIsolated: false,
      credentialStorage: 'protected_host_store',
      rotationWarningDays: 90,
      expiryWarningDays: 30,
      persistence: 'Salesforce CLI retains protected host sessions for DEVEE, QAT, and Production. FCOS pins DEVEE as the development/source target and revalidates every exact org ID, username, environment type, and query capability before use. The shared Salesforce mirror uses a separate ignored GitHub CLI profile.',
      nonBrowserRoute: 'Use Salesforce CLI only after DEVEE, QAT, and Production match their exact identities. Deploy and verify in DEVEE, publish the byte-equivalent DEVEE source to the shared repository, then promote the same source to QAT and Production in order.',
      publication: {
        requiredAccount: 'vincelessxai',
        requiredAccountId: 304336732,
        repository: 'ivanyk20/fcbhk',
        defaultBranch: 'main',
        activeBranch: 'codex/special-term-clause-bank-migration',
        branchPrefix: 'codex/salesforce-metadata-sync',
        sourceRoot: 'force-app/main/default',
        targetRoot: 'src',
        manifestPath: '.fcos-salesforce-mirror.json',
        configPath: '.fcos-cli/github-vincelessxai',
        browserProfile: 'vincexai',
        sourceEnvironmentKey: 'devee',
        sourceStatePath: '.fcos-cli/salesforce/devee-source-state.json',
        sourceStateMaximumAgeSeconds: 14400,
        verifyCommand: 'npm run salesforce:mirror:verify',
        publishCommand: 'npm run salesforce:mirror:publish',
      },
      environments: [
        { key: 'devee', label: 'Devee', alias: 'fcos-devee', username: 'vincent@cosulich.com.hk.devee', instanceUrl: 'https://fratellicosulich--devee.sandbox.my.salesforce.com', orgId: '00D1m0000008kioEAA', isSandbox: true, browserProfile: 'Otto' },
        { key: 'qat', label: 'QAT', alias: 'fcos-qat', username: 'vincent@cosulich.com.hk.qat', instanceUrl: 'https://fratellicosulich--qat.sandbox.my.salesforce.com', orgId: '00D1s0000008lFEEAY', isSandbox: true, browserProfile: 'Otto' },
        { key: 'production', label: 'Production', alias: 'source-salesforce', orgId: '00D2x000000Ei4oEAC', isSandbox: false, browserProfile: 'Vincent' },
      ],
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
  const approvedBrowserProfiles = new Set(['Otto', 'Vincent', 'vincexai']);
  if (!approvedBrowserProfiles.has(value.browserProfile)) throw new Error('Connection policy browserProfile is not approved.');
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
  requireString(value.integrations?.googleDriveMarketReports?.accountEmail, 'integrations.googleDriveMarketReports.accountEmail');
  requireString(value.integrations?.googleDriveMarketReports?.browserProfile, 'integrations.googleDriveMarketReports.browserProfile');
  if (value.integrations.googleDriveMarketReports.browserProfile !== 'Vincent') {
    throw new Error('Google Drive market-report browser authentication must use Vincent.');
  }
  requireString(value.integrations?.googleDriveMarketReports?.rootFolderId, 'integrations.googleDriveMarketReports.rootFolderId');
  requireString(value.integrations?.googleDriveMarketReports?.syncSchedule, 'integrations.googleDriveMarketReports.syncSchedule');
  if (!Array.isArray(value.integrations?.googleDriveMarketReports?.folders)
      || value.integrations.googleDriveMarketReports.folders.length !== 2) {
    throw new Error('Google Drive market reports require exactly two source folders.');
  }
  const expectedMarketDocumentTypes = ['bunkerwire', 'european_marketscan'];
  for (const [index, folder] of value.integrations.googleDriveMarketReports.folders.entries()) {
    if (folder.documentType !== expectedMarketDocumentTypes[index]) {
      throw new Error('Google Drive market-report source folders are not in the approved order.');
    }
    requireString(folder.folderId, `integrations.googleDriveMarketReports.folders.${index}.folderId`);
    requireString(folder.label, `integrations.googleDriveMarketReports.folders.${index}.label`);
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
    if (provider.id === 'salesforce') {
      if (!Array.isArray(provider.environments) || provider.environments.length !== 3) throw new Error('Salesforce requires Devee, QAT, and Production targets.');
      if (provider.environments.map(({ key }) => key).join(',') !== 'devee,qat,production') {
        throw new Error('Salesforce environment order must be Devee, QAT, then Production.');
      }
      const expectedSalesforceBrowserProfiles = { devee: 'Otto', qat: 'Otto', production: 'Vincent' };
      for (const environment of provider.environments) {
        requireString(environment.key, `salesforce.${environment.key}.key`);
        requireString(environment.label, `salesforce.${environment.key}.label`);
        requireString(environment.alias, `salesforce.${environment.key}.alias`);
        if (environment.isSandbox) {
          requireString(environment.username, `salesforce.${environment.key}.username`);
          requireString(environment.instanceUrl, `salesforce.${environment.key}.instanceUrl`);
        }
        requireString(environment.orgId, `salesforce.${environment.key}.orgId`);
        requireString(environment.browserProfile, `salesforce.${environment.key}.browserProfile`);
        if (!approvedBrowserProfiles.has(environment.browserProfile)) {
          throw new Error(`Salesforce ${environment.key} browserProfile is not approved.`);
        }
        if (environment.browserProfile !== expectedSalesforceBrowserProfiles[environment.key]) {
          throw new Error(`Salesforce ${environment.key} browserProfile does not match the approved environment mapping.`);
        }
        if (typeof environment.isSandbox !== 'boolean') throw new Error(`Salesforce ${environment.key} isSandbox must be Boolean.`);
      }
      requireString(provider.publication?.requiredAccount, 'salesforce.publication.requiredAccount');
      if (!Number.isSafeInteger(provider.publication?.requiredAccountId) || provider.publication.requiredAccountId <= 0) {
        throw new Error('salesforce.publication.requiredAccountId must be a positive integer.');
      }
      requireString(provider.publication?.repository, 'salesforce.publication.repository');
      requireString(provider.publication?.defaultBranch, 'salesforce.publication.defaultBranch');
      requireString(provider.publication?.activeBranch, 'salesforce.publication.activeBranch');
      requireString(provider.publication?.branchPrefix, 'salesforce.publication.branchPrefix');
      requireString(provider.publication?.sourceRoot, 'salesforce.publication.sourceRoot');
      requireString(provider.publication?.targetRoot, 'salesforce.publication.targetRoot');
      requireString(provider.publication?.manifestPath, 'salesforce.publication.manifestPath');
      requireString(provider.publication?.configPath, 'salesforce.publication.configPath');
      requireString(provider.publication?.browserProfile, 'salesforce.publication.browserProfile');
      if (!approvedBrowserProfiles.has(provider.publication.browserProfile)) {
        throw new Error('Salesforce publication browserProfile is not approved.');
      }
      if (provider.publication.browserProfile !== 'vincexai') {
        throw new Error('Salesforce publication browserProfile must remain vincexai.');
      }
      requireString(provider.publication?.sourceEnvironmentKey, 'salesforce.publication.sourceEnvironmentKey');
      requireString(provider.publication?.sourceStatePath, 'salesforce.publication.sourceStatePath');
      requirePositiveInteger(provider.publication?.sourceStateMaximumAgeSeconds, 'salesforce.publication.sourceStateMaximumAgeSeconds');
      requireString(provider.publication?.verifyCommand, 'salesforce.publication.verifyCommand');
      requireString(provider.publication?.publishCommand, 'salesforce.publication.publishCommand');
    }
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
