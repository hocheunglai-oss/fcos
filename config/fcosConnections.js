const runtimeConnections = [
    { id: 'supabase', provider: 'Supabase', target: { providerId: 'supabase', identifierLabel: 'Project ref' }, environmentKeys: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'], apiOrigins: [] },
    { id: 'salesforce', provider: 'Salesforce', target: { providerId: 'salesforce', environmentKey: 'production' }, environmentKeys: ['SALESFORCE_INSTANCE_URL', 'SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN', 'SALESFORCE_ACCESS_TOKEN'], apiOrigins: [] },
    { id: 'xero', provider: 'Xero', target: { configuredIdentityKeys: ['XERO_TENANT_ID', 'XERO_TENANT_NAME'], storedIdentitySource: 'Approved durable Xero connection' }, environmentKeys: ['XERO_TENANT_ID', 'XERO_TENANT_NAME', 'XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'XERO_REFRESH_TOKEN'], apiOrigins: ['https://api.xero.com', 'https://identity.xero.com'] },
    { id: 'drive', provider: 'Google Drive market reports', target: { integrationKey: 'googleDriveMarketReports' }, environmentKeys: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_MARKET_REFRESH_TOKEN'], apiOrigins: ['https://www.googleapis.com', 'https://oauth2.googleapis.com'] },
    { id: 'identity', provider: 'FCUNO identity federation', target: { integrationKey: 'fcunoIdentityFederation' }, environmentKeys: ['FCUNO_IDENTITY_ISSUER', 'FCUNO_IDENTITY_SYNC_AUDIENCE', 'FCUNO_IDENTITY_JWKS_URI', 'FCUNO_IDENTITY_JWT_ALGORITHMS'], apiOrigins: ['https://fcuno.com'] },
    { id: 'microsoft', provider: 'Microsoft Graph mail', target: { configuredIdentityKeys: ['FCOS_MICROSOFT_TENANT_ID', 'FCOS_MICROSOFT_CLIENT_ID'], storedIdentitySource: 'Approved durable Graph mailbox configuration' }, environmentKeys: ['FCOS_MICROSOFT_TENANT_ID', 'FCOS_MICROSOFT_CLIENT_ID'], apiOrigins: ['https://graph.microsoft.com', 'https://login.microsoftonline.com'] },
    { id: 'microsoft-growth', provider: 'Microsoft Graph growth mailbox', target: { configuredIdentityKeys: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID'] }, environmentKeys: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'], apiOrigins: ['https://graph.microsoft.com', 'https://login.microsoftonline.com'] },
    { id: 'openai', provider: 'OpenAI', target: { configuredIdentityKeys: [], identityVerification: 'Independent provider account and project verification required' }, environmentKeys: ['OPENAI_API_KEY'], apiOrigins: ['https://api.openai.com'] },
  ];

const connectionPolicy = {
  schemaVersion: 1,
  policyVersion: 12,
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
      id: 'cli_first',
      label: 'Use the verified CLI first',
      detail: 'Verify CLI account, organization, project, repository, environment, version and operation permissions before use.',
    },
    {
      id: 'api_fallback',
      label: 'Fall back to the approved API or connector',
      detail: 'If CLI access fails, independently verify API target and permissions.',
    },
    {
      id: 'browser_fallback',
      label: 'Use Chrome only as the final fallback',
      detail: 'Use the pinned Chrome profile only after CLI and API routes fail; return to CLI or API verification.',
    },
  ],
  integrations: {
    fcunoIdentityFederation: {
      issuer: 'https://fcuno.com',
      protocolVersion: '1.0',
      oidcProvider: 'custom:fcuno',
      oidcClientId: 'fcos-production',
      oidcCallbackUrl: 'https://pjforfvchygdyqfcgpmw.supabase.co/auth/v1/callback',
      syncAudience: 'fcos-identity-sync',
      syncEndpoint: 'https://fcos.fcuno.com/api/fcuno/identity-sync',
      syncJwksEndpoint: 'https://fcuno.com/api/fcos-identity-sync/jwks',
      providerRepository: 'hocheunglai-oss/bunker-map',
      providerCommit: '9d8e05cd338e6105b6a495d68512f63692d3a48c',
      contractPath: 'contracts/fcuno-fcos/v1',
      contractSha256: '7fc54e7c3bd79fb014ad81dc6d9190d021549d9428486ef85ed78fdff95d7cc2',
      providerVercelProjectId: 'prj_8OifIFDF7Gcpd2i4VSRJOHjL3A9Q',
      providerSupabaseProjectRef: 'gglyugbrnyvyfktgwert',
    },
    googleDriveMarketReports: {
      accountEmail: 'vince.less@gmail.com',
      browserProfile: 'Vincent',
      rootFolderId: '1wzRycxzPAb42EvfhjPV22mkFwliXZv8d',
      syncSchedule: '0 * * * *',
      secondaryMopsCsv: {
        folderId: '1wzRycxzPAb42EvfhjPV22mkFwliXZv8d',
        filenamePrefix: 'Core_Export_Data',
        mimeType: 'text/csv',
        startDate: '2025-01-01',
      },
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
      requiredPermissions: ['repository.read'],
      writePermissions: ['repository.push', 'workflow.update', 'git.push.authentication'],
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
      persistence: 'OAuth and HTTPS pushes use isolated GH_CONFIG_DIR and a repository-local credential helper.',
      nonBrowserRoute: 'Reject other identities; API fallback must preserve the repository pin.',
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
      requiredPermissions: ['project.read', 'deployment.read'],
      writePermissions: ['deployment.create', 'configuration.write'],
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
      persistence: 'Keychain token; local files contain safe target metadata.',
      nonBrowserRoute: 'Verify account, team, project and operation permissions.',
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
      requiredPermissions: ['project.read'],
      writePermissions: ['project.link', 'database.write'],
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
      persistence: 'Dedicated Keychain token; pinned CLI and project link remain repo-local.',
      nonBrowserRoute: 'Verify the project ref and visibility before API fallback.',
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
      writePermissions: ['shared.repository.push', 'metadata.deploy', 'data.write'],
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
      persistence: 'Verify protected org sessions, username, sandbox and query access. DEVEE owns source; the mirror uses isolated GitHub authorization.',
      nonBrowserRoute: 'Verify each org. Promote verified DEVEE source through the byte-equivalent shared mirror, QAT, then Production.',
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
        { key: 'production', label: 'Production', alias: 'source-salesforce', username: 'vincent@cosulich.com.hk', instanceUrl: 'https://fratellicosulich.my.salesforce.com', orgId: '00D2x000000Ei4oEAC', isSandbox: false, browserProfile: 'Vincent' },
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
  if (!value || typeof value !== 'object') throw new Error('Invalid connection policy.');
  requirePositiveInteger(value.schemaVersion, 'schemaVersion');
  requirePositiveInteger(value.policyVersion, 'policyVersion');
  requireString(value.profile, 'profile');
  requireString(value.browserProfile, 'browserProfile');
  const expectedSequence = ['cli_first', 'api_fallback', 'browser_fallback'];
  if (!Array.isArray(value.sequence)
      || value.sequence.map(({ id }) => id).join(',') !== expectedSequence.join(',')) {
    throw new Error('Order must be CLI, API, Chrome.');
  }
  for (const [index, step] of value.sequence.entries()) {
    requireString(step.label, `sequence.${index}.label`);
    requireString(step.detail, `sequence.${index}.detail`);
  }
  const approvedBrowserProfiles = new Set(['Otto', 'Vincent', 'vincexai']);
  if (!approvedBrowserProfiles.has(value.browserProfile)) throw new Error('Unapproved browserProfile.');
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
  const federation = value.integrations?.fcunoIdentityFederation;
  requireString(federation?.issuer, 'integrations.fcunoIdentityFederation.issuer');
  requireString(federation?.protocolVersion, 'integrations.fcunoIdentityFederation.protocolVersion');
  requireString(federation?.oidcProvider, 'integrations.fcunoIdentityFederation.oidcProvider');
  requireString(federation?.oidcClientId, 'integrations.fcunoIdentityFederation.oidcClientId');
  requireString(federation?.oidcCallbackUrl, 'integrations.fcunoIdentityFederation.oidcCallbackUrl');
  requireString(federation?.syncAudience, 'integrations.fcunoIdentityFederation.syncAudience');
  requireString(federation?.syncEndpoint, 'integrations.fcunoIdentityFederation.syncEndpoint');
  requireString(federation?.syncJwksEndpoint, 'integrations.fcunoIdentityFederation.syncJwksEndpoint');
  requireString(federation?.providerRepository, 'integrations.fcunoIdentityFederation.providerRepository');
  requireString(federation?.providerCommit, 'integrations.fcunoIdentityFederation.providerCommit');
  requireString(federation?.contractPath, 'integrations.fcunoIdentityFederation.contractPath');
  requireString(federation?.contractSha256, 'integrations.fcunoIdentityFederation.contractSha256');
  requireString(federation?.providerVercelProjectId, 'integrations.fcunoIdentityFederation.providerVercelProjectId');
  requireString(federation?.providerSupabaseProjectRef, 'integrations.fcunoIdentityFederation.providerSupabaseProjectRef');
  if (federation.issuer !== 'https://fcuno.com'
      || federation.oidcProvider !== 'custom:fcuno'
      || federation.syncJwksEndpoint !== 'https://fcuno.com/api/fcos-identity-sync/jwks'
      || federation.providerRepository !== 'hocheunglai-oss/bunker-map') {
    throw new Error('FCUNO identity federation authority is not pinned to the approved provider.');
  }
  if (!/^[0-9a-f]{40}$/.test(federation.providerCommit)
      || !/^[0-9a-f]{64}$/.test(federation.contractSha256)) {
    throw new Error('FCUNO identity federation requires exact provider commit and contract SHA-256 pins.');
  }
  if (federation.providerSupabaseProjectRef === 'pjforfvchygdyqfcgpmw') {
    throw new Error('FCUNO and FCOS must retain separate Supabase projects.');
  }
  requireString(value.integrations?.googleDriveMarketReports?.browserProfile, 'integrations.googleDriveMarketReports.browserProfile');
  if (value.integrations.googleDriveMarketReports.browserProfile !== 'Vincent') {
    throw new Error('Google Drive market-report browser authentication must use Vincent.');
  }
  requireString(value.integrations?.googleDriveMarketReports?.rootFolderId, 'integrations.googleDriveMarketReports.rootFolderId');
  requireString(value.integrations?.googleDriveMarketReports?.syncSchedule, 'integrations.googleDriveMarketReports.syncSchedule');
  const secondaryMopsCsv = value.integrations?.googleDriveMarketReports?.secondaryMopsCsv;
  requireString(secondaryMopsCsv?.folderId, 'integrations.googleDriveMarketReports.secondaryMopsCsv.folderId');
  requireString(secondaryMopsCsv?.filenamePrefix, 'integrations.googleDriveMarketReports.secondaryMopsCsv.filenamePrefix');
  requireString(secondaryMopsCsv?.mimeType, 'integrations.googleDriveMarketReports.secondaryMopsCsv.mimeType');
  requireString(secondaryMopsCsv?.startDate, 'integrations.googleDriveMarketReports.secondaryMopsCsv.startDate');
  if (secondaryMopsCsv.folderId !== value.integrations.googleDriveMarketReports.rootFolderId
      || secondaryMopsCsv.mimeType !== 'text/csv'
      || secondaryMopsCsv.startDate !== '2025-01-01') {
    throw new Error('Invalid MOPS root or cutover.');
  }
  if (!Array.isArray(value.integrations?.googleDriveMarketReports?.folders)
      || value.integrations.googleDriveMarketReports.folders.length !== 2) {
    throw new Error('Drive requires two source folders.');
  }
  const expectedMarketDocumentTypes = ['bunkerwire', 'european_marketscan'];
  for (const [index, folder] of value.integrations.googleDriveMarketReports.folders.entries()) {
    if (folder.documentType !== expectedMarketDocumentTypes[index]) {
      throw new Error('Invalid Drive folder order.');
    }
    requireString(folder.folderId, `integrations.googleDriveMarketReports.folders.${index}.folderId`);
    requireString(folder.label, `integrations.googleDriveMarketReports.folders.${index}.label`);
  }
  const expectedProviders = ['github', 'vercel', 'supabase', 'salesforce'];
  if (!Array.isArray(value.providers) || value.providers.length !== expectedProviders.length) {
    throw new Error('Exactly four providers required.');
  }
  if (value.providers.map(({ id }) => id).join(',') !== expectedProviders.join(',')) {
    throw new Error('Invalid provider order or IDs.');
  }
  for (const provider of value.providers) {
    for (const field of ['provider', 'cli', 'executable', 'configPath', 'profileName', 'credentialStorage']) requireString(provider[field], `${provider.id}.${field}`);
    requirePositiveInteger(provider.rotationWarningDays, `${provider.id}.rotationWarningDays`);
    requirePositiveInteger(provider.expiryWarningDays, `${provider.id}.expiryWarningDays`);
    if (!Array.isArray(provider.identifiers) || !provider.identifiers.length) throw new Error(`${provider.id} identifiers are required.`);
    if (!Array.isArray(provider.requiredPermissions) || !provider.requiredPermissions.length) throw new Error(`${provider.id} permissions are required.`);
    if (!provider.cliVersion?.exact && !provider.cliVersion?.minimum) throw new Error(`${provider.id} CLI version policy is required.`);
    if (provider.credentialStorage === 'macos_keychain') requireString(provider.keychainService, `${provider.id}.keychainService`);
    if (provider.id === 'salesforce') {
      if (!Array.isArray(provider.environments) || provider.environments.length !== 3) throw new Error('Salesforce requires DEVEE, QAT, Production.');
      if (provider.environments.map(({ key }) => key).join(',') !== 'devee,qat,production') {
        throw new Error('Salesforce order: DEVEE, QAT, Production.');
      }
      const expectedSalesforceBrowserProfiles = { devee: 'Otto', qat: 'Otto', production: 'Vincent' };
      for (const environment of provider.environments) {
        for (const field of ['key', 'label', 'alias', 'username', 'instanceUrl', 'orgId', 'browserProfile']) requireString(environment[field], `salesforce.${environment.key}.${field}`);
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
        throw new Error('Invalid publication account ID.');
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
        throw new Error('Unapproved publication browserProfile.');
      }
      if (provider.publication.browserProfile !== 'vincexai') {
        throw new Error('Publication profile must be vincexai.');
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
export function fcosConnectionProvider(providerId) {
  const provider = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === providerId);
  if (!provider) throw new Error(`Unknown FCOS connection provider: ${providerId || '(missing)'}.`);
  return provider;
}

export function fcosConnectionIdentifier(providerId, label) {
  const value = fcosConnectionProvider(providerId).identifiers.find((entry) => entry.label === label)?.value;
  if (!value) throw new Error(`FCOS connection policy is missing ${providerId}.${label}.`);
  return value;
}

export function fcosSalesforceEnvironment(environmentKey) {
  const environment = fcosConnectionProvider('salesforce').environments.find(({ key }) => key === environmentKey);
  if (!environment) throw new Error(`Unknown FCOS Salesforce environment: ${environmentKey || '(missing)'}.`);
  return environment;
}

export default FCOS_CONNECTION_POLICY;

// This inventory reports only presence of known keys. It never attests authentication,
// deployed configuration, an account ID derived from a secret, or write authority.
export function validateFcosRuntimeConnectionCatalogue(value = runtimeConnections) {
  if (!Array.isArray(value) || value.length !== 8) throw new Error('Runtime connection catalogue must retain all configured integrations.');
  if (value.map(({ id }) => id).join(',') !== 'supabase,salesforce,xero,drive,identity,microsoft,microsoft-growth,openai') throw new Error('Runtime connection catalogue identifiers are invalid.');
  for (const runtime of value) {
    requireString(runtime.provider, `runtime.${runtime.id}.provider`);
    if (!runtime.target || typeof runtime.target !== 'object') throw new Error('Runtime connection target is required.');
    if (!Array.isArray(runtime.environmentKeys) || runtime.environmentKeys.some((key) => !/^[A-Z][A-Z0-9_]+$/.test(key))) throw new Error('Runtime environment key names are invalid.');
    if (!Array.isArray(runtime.apiOrigins) || runtime.apiOrigins.some((origin) => { try { return new URL(origin).origin !== origin || !origin.startsWith('https://'); } catch { return true; } })) throw new Error('Runtime API origins must use exact HTTPS origins.');
  }
  return true;
}

export function fcosRuntimeConnectionCatalogue(environment = {}) {
  validateFcosRuntimeConnectionCatalogue();
  return runtimeConnections.map((entry) => {
    const { target } = entry;
    let identityPins;
    if (target.providerId === 'salesforce') {
      const org = fcosSalesforceEnvironment(target.environmentKey);
      identityPins = { orgId: org.orgId, username: org.username, instanceUrl: org.instanceUrl, isSandbox: org.isSandbox };
    } else if (target.providerId) identityPins = { projectRef: fcosConnectionIdentifier(target.providerId, target.identifierLabel) };
    else if (target.integrationKey === 'googleDriveMarketReports') {
      const drive = FCOS_CONNECTION_POLICY.integrations.googleDriveMarketReports;
      identityPins = { accountEmail: drive.accountEmail, rootFolderId: drive.rootFolderId, browserProfile: drive.browserProfile };
    } else if (target.integrationKey === 'fcunoIdentityFederation') {
      const federation = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
      identityPins = { issuer: federation.issuer, audience: federation.syncAudience, jwksEndpoint: federation.syncJwksEndpoint };
    } else identityPins = { status: 'requires_independent_verification', configuredIdentityKeys: [...(target.configuredIdentityKeys || [])] };
    return { id: entry.id, provider: entry.provider, connectionKind: 'application_runtime', identityPins,
      configuredEnv: Object.fromEntries(entry.environmentKeys.map((key) => [key, typeof environment[key] === 'string' && Boolean(environment[key].trim())])),
      apiOrigins: [...entry.apiOrigins], authenticationStatus: 'unknown', writePermission: 'unknown', humanAuthorization: 'not_granted' };
  });
}

// Release mode is reviewed source, never a CLI flag or environment override.
export const FCOS_RELEASE_APPROVAL_POLICY = /* @__PURE__ */ Object.freeze({
  schemaVersion: 1,
  mode: 'single_operator',
  operatorProvider: 'github',
  operatorIdentifier: 'Required account',
  requiredChecks: /* @__PURE__ */ Object.freeze(['code-and-database', 'dependency-review', 'authenticated-browser']),
  statusCheckAppId: 15368,
});
