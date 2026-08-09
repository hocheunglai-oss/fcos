export const APPROVED_CONNECTION_BROWSER_PROFILE = 'Otto';
export const CONNECTION_CHECKLIST_STORAGE_KEY = 'fcos:connection-checklist:v2';
export const CONNECTION_PROFILE_NAME = 'fcos-production';
export const CONNECTION_LOCAL_STATE_DIRECTORY = '.fcos-cli';
export const CONNECTION_VERIFY_COMMAND = 'npm run connections:verify';

export const CONNECTION_CHECKLIST_SEQUENCE = Object.freeze([
  {
    id: 'cli_availability',
    label: 'Verify CLI availability',
    detail: 'Confirm the provider CLI is installed before checking any authenticated identity.',
  },
  {
    id: 'target_identity',
    label: 'Verify account, team, and project',
    detail: 'Compare non-secret CLI identity output with the approved identifiers below. Stop on any mismatch.',
  },
  {
    id: 'cli_use',
    label: 'Use the CLI',
    detail: 'Continue through the verified CLI for reads or mutations while it can authenticate to the approved target.',
  },
  {
    id: 'browser_fallback',
    label: 'Use Otto only for blocked authentication',
    detail: 'The browser remains locked unless the CLI explicitly cannot complete authentication. Return to the CLI after browser authentication.',
  },
]);

export const CONNECTION_TARGETS = Object.freeze([
  {
    id: 'github',
    provider: 'GitHub',
    cli: 'gh',
    identifiers: [
      { label: 'Required account', value: 'hocheunglai-oss' },
      { label: 'Repository', value: 'hocheunglai-oss/fcos' },
    ],
    availabilityCommand: 'gh --version',
    identityCommand: 'npm run connections:verify -- github',
    authCommand: 'npm run connections:auth -- github',
    useCommand: 'npm run connections:cli -- github -- <gh arguments>',
    authorizationMode: 'Repo-isolated authorization',
    isolationMechanism: 'GH_CONFIG_DIR',
    configPath: '.fcos-cli/github',
    profileName: 'fcos-github',
    fullyIsolated: true,
    persistence: 'The OAuth session is kept in the OS credential store and selected through the repo-isolated GitHub CLI config.',
    nonBrowserRoute: 'If gh is authenticated to a different account, fail closed and use the approved GitHub connector/API or stop. Never change machine-wide credentials for FCOS.',
  },
  {
    id: 'vercel',
    provider: 'Vercel',
    cli: 'vercel',
    identifiers: [
      { label: 'Account', value: 'hocheunglai-6535' },
      { label: 'Team', value: 'hocheunglai-6535s-projects' },
      { label: 'Team ID', value: 'team_MbKDazzCrou3eKTuausPv4X2' },
      { label: 'Project', value: 'fcos' },
      { label: 'Project ID', value: 'prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs' },
      { label: 'Target', value: 'hocheunglai-6535s-projects/fcos' },
    ],
    availabilityCommand: 'vercel --version',
    identityCommand: 'npm run connections:verify -- vercel',
    authCommand: 'npm run connections:auth -- vercel',
    useCommand: 'npm run connections:cli -- vercel -- <vercel arguments>',
    authorizationMode: 'Repo-isolated authorization',
    isolationMechanism: '--global-config',
    configPath: '.fcos-cli/vercel',
    profileName: 'fcos-vercel',
    fullyIsolated: true,
    persistence: 'Vercel credentials stay under the ignored repo-local global-config directory; the repo link is checked against exact team and project IDs.',
    nonBrowserRoute: 'Use the Vercel API or approved connector when it can complete the operation without an interactive browser sign-in.',
  },
  {
    id: 'supabase',
    provider: 'Supabase',
    cli: 'supabase',
    identifiers: [
      { label: 'Project name', value: 'FCOS' },
      { label: 'Project ref', value: 'pjforfvchygdyqfcgpmw' },
    ],
    availabilityCommand: 'npx --no-install supabase --version',
    identityCommand: 'npm run connections:verify -- supabase',
    authCommand: 'npm run connections:auth -- supabase',
    useCommand: 'npm run connections:cli -- supabase -- <supabase arguments>',
    authorizationMode: 'Repo-isolated authorization',
    isolationMechanism: 'Pinned CLI + SUPABASE_HOME + 0600 token file',
    configPath: '.fcos-cli/supabase',
    profileName: 'fcos-pjforfvchygdyqfcgpmw',
    pinnedCliVersion: '2.113.0',
    fullyIsolated: true,
    persistence: 'The pinned project CLI reads a 0600 access-token file from its ignored local home, avoiding machine-global credentials and environment-token conflicts.',
    nonBrowserRoute: 'Use the approved Supabase connector/API when the CLI lacks the capability but the target identity is verified.',
  },
  {
    id: 'salesforce',
    provider: 'Salesforce',
    cli: 'sf',
    identifiers: [
      { label: 'Environment', value: 'Production' },
      { label: 'Org ID', value: '00D2x000000Ei4oEAC' },
      { label: 'Alias', value: 'source-salesforce' },
    ],
    availabilityCommand: 'sf --version',
    identityCommand: 'npm run connections:verify -- salesforce',
    authCommand: 'npm run connections:auth -- salesforce',
    useCommand: 'npm run connections:cli -- salesforce -- <sf arguments>',
    authorizationMode: 'Repo-pinned target with protected host authorization',
    isolationMechanism: 'Project-local target-org + SF_TARGET_ORG',
    configPath: '.sf',
    profileName: 'source-salesforce',
    fullyIsolated: false,
    persistence: 'Salesforce CLI does not expose an alternate auth-home setting; its protected host session is retained, while FCOS pins and revalidates the exact org for every use.',
    nonBrowserRoute: 'Use Salesforce CLI or the approved API session only after the live organization ID matches exactly.',
  },
]);

const AVAILABILITY_STATES = new Set(['available', 'unavailable']);
const IDENTITY_STATES = new Set(['verified', 'mismatch', 'authentication_blocked']);
const CLI_OUTCOMES = new Set(['completed', 'authentication_blocked']);

function timestamp(now) {
  const value = now instanceof Date ? now : new Date(now || Date.now());
  return value.toISOString();
}

export function emptyConnectionCheck() {
  return {
    cliAvailability: null,
    identityStatus: null,
    cliOutcome: null,
    browserProfile: null,
    browserAuthenticationRecorded: false,
    updatedAt: null,
  };
}

export function sanitizeConnectionCheck(value) {
  const source = value && typeof value === 'object' ? value : {};
  const cliAvailability = AVAILABILITY_STATES.has(source.cliAvailability) ? source.cliAvailability : null;
  const identityStatus = cliAvailability === 'available' && IDENTITY_STATES.has(source.identityStatus)
    ? source.identityStatus
    : null;
  const cliOutcome = identityStatus === 'verified' && CLI_OUTCOMES.has(source.cliOutcome)
    ? source.cliOutcome
    : null;
  const browserAllowed = identityStatus === 'authentication_blocked' || cliOutcome === 'authentication_blocked';
  const browserAuthenticationRecorded = browserAllowed
    && source.browserAuthenticationRecorded === true
    && source.browserProfile === APPROVED_CONNECTION_BROWSER_PROFILE;

  return {
    cliAvailability,
    identityStatus,
    cliOutcome,
    browserProfile: browserAuthenticationRecorded ? APPROVED_CONNECTION_BROWSER_PROFILE : null,
    browserAuthenticationRecorded,
    updatedAt: typeof source.updatedAt === 'string' && !Number.isNaN(Date.parse(source.updatedAt)) ? source.updatedAt : null,
  };
}

export function sanitizeConnectionChecks(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(CONNECTION_TARGETS.map(({ id }) => [id, sanitizeConnectionCheck(source[id])]));
}

export function connectionCheckState(value) {
  const record = sanitizeConnectionCheck(value);
  if (!record.cliAvailability) return { step: 'cli_availability', status: 'pending', browserAllowed: false };
  if (record.cliAvailability === 'unavailable') return { step: 'cli_availability', status: 'stopped', browserAllowed: false };
  if (!record.identityStatus) return { step: 'target_identity', status: 'pending', browserAllowed: false };
  if (record.identityStatus === 'mismatch') return { step: 'target_identity', status: 'stopped', browserAllowed: false };
  if (record.identityStatus === 'authentication_blocked') {
    return {
      step: record.browserAuthenticationRecorded ? 'target_identity' : 'browser_fallback',
      status: record.browserAuthenticationRecorded ? 'return_to_cli' : 'authentication_blocked',
      browserAllowed: true,
    };
  }
  if (!record.cliOutcome) return { step: 'cli_use', status: 'pending', browserAllowed: false };
  if (record.cliOutcome === 'completed') return { step: 'complete', status: 'complete', browserAllowed: false };
  return {
    step: record.browserAuthenticationRecorded ? 'target_identity' : 'browser_fallback',
    status: record.browserAuthenticationRecorded ? 'return_to_cli' : 'authentication_blocked',
    browserAllowed: true,
  };
}

export function updateConnectionCheck(value, action, now = new Date()) {
  const current = sanitizeConnectionCheck(value);
  let next;

  switch (action) {
    case 'cli_available':
      next = { ...emptyConnectionCheck(), cliAvailability: 'available' };
      break;
    case 'cli_unavailable':
      next = { ...emptyConnectionCheck(), cliAvailability: 'unavailable' };
      break;
    case 'identity_verified':
    case 'identity_mismatch':
    case 'identity_authentication_blocked': {
      if (current.cliAvailability !== 'available') throw new Error('Verify CLI availability before recording target identity.');
      const identityStatus = action === 'identity_verified'
        ? 'verified'
        : action === 'identity_mismatch' ? 'mismatch' : 'authentication_blocked';
      next = { ...current, identityStatus, cliOutcome: null, browserProfile: null, browserAuthenticationRecorded: false };
      break;
    }
    case 'cli_completed':
    case 'cli_authentication_blocked': {
      if (current.identityStatus !== 'verified') throw new Error('Verify the approved account, team, and project before using the CLI.');
      next = {
        ...current,
        cliOutcome: action === 'cli_completed' ? 'completed' : 'authentication_blocked',
        browserProfile: null,
        browserAuthenticationRecorded: false,
      };
      break;
    }
    case 'browser_authentication_completed': {
      const state = connectionCheckState(current);
      if (!state.browserAllowed || state.status !== 'authentication_blocked') {
        throw new Error('Chrome is allowed only after the CLI cannot complete authentication.');
      }
      next = {
        ...current,
        browserProfile: APPROVED_CONNECTION_BROWSER_PROFILE,
        browserAuthenticationRecorded: true,
      };
      break;
    }
    case 'return_to_cli': {
      if (!current.browserAuthenticationRecorded) throw new Error('Record approved browser authentication before returning to the CLI.');
      next = {
        ...current,
        identityStatus: null,
        cliOutcome: null,
      };
      break;
    }
    case 'reset':
      return emptyConnectionCheck();
    default:
      throw new Error('Unsupported connection checklist action.');
  }

  return sanitizeConnectionCheck({ ...next, updatedAt: timestamp(now) });
}
