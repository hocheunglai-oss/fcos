import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';

// These static declarations interpret private deployed configuration only.
// They cannot authenticate a provider, refresh a session, or execute Git code.
// The original complete source and each dependency declaration are verified
// against immutable Git; the local reviewed declaration bytes must also match.
export const OBSERVATION_BASE_SHA = 'f3472492ff4d0b0c70248a3c8e5c0012981a94b3';
export const OBSERVATION_CANDIDATE_SHA = 'ff8859b287009e20462c5c0cceff89ae12f13010';
export const OBSERVATION_DECLARATIONS = Object.freeze([
  {
    "file": "api/_deploymentReadOnly.js",
    "ref": "f3472492ff4d0b0c70248a3c8e5c0012981a94b3",
    "sourceSha256": "672a6ac5bafc9cb138ae1d1985ec70f0e7bfc2763a3880009ff8a5016625ba6b",
    "declarationSha256": "9b54831b9be4760b494713b4ff06f151ebe1ff177d58f6f2d5af9439fd57a520",
    "ranges": [
      {
        "start": "export function isDeploymentReadOnly",
        "end": "\nexport function requireDeploymentMutationAllowed"
      }
    ]
  },
  {
    "file": "api/_externalActionGates.js",
    "ref": "f3472492ff4d0b0c70248a3c8e5c0012981a94b3",
    "sourceSha256": "bebc1da74985b790929ff6171012942416bf6c45099a439eef1c897fb6787677",
    "declarationSha256": "edc8610dca172a9334b8136d5a2886c730c2bdc4d0631518a829817bb07425ee",
    "ranges": [
      {
        "start": "const GATE_DEFINITIONS",
        "end": "\nexport function isExternalActionEnabled"
      }
    ]
  },
  {
    "file": "api/_fcunoIdentityFederation.js",
    "ref": "f3472492ff4d0b0c70248a3c8e5c0012981a94b3",
    "sourceSha256": "961abbe772891d29cd5067a73e2e7a4f22aa5544d3029516a148061359c36202",
    "declarationSha256": "1faf9fd4c50288183c8ce61b291ad6b0ca0ab5db775d92038780bf7c676b99ba",
    "ranges": [
      {
        "start": "const MAX_TEXT = 500;",
        "end": "\nconst jwksByUri"
      },
      {
        "start": "function text(",
        "end": "\nfunction optionalTimestamp"
      },
      {
        "start": "export function fcunoFederationConfig",
        "end": "\nfunction requireSyncConfiguration"
      }
    ]
  },
  {
    "file": "api/_supabaseConfig.js",
    "ref": "f3472492ff4d0b0c70248a3c8e5c0012981a94b3",
    "sourceSha256": "4313704adf8c6a6c891c7226775fbfdbe439de8a615d490b900da379b562187f",
    "declarationSha256": "4313704adf8c6a6c891c7226775fbfdbe439de8a615d490b900da379b562187f",
    "ranges": [
      {
        "start": "function nonBlank",
        "end": null
      }
    ]
  },
  {
    "file": "api/_connectionRuntime.js",
    "ref": "ff8859b287009e20462c5c0cceff89ae12f13010",
    "sourceSha256": "e52aa950fb59083a7735c9b7893619920c6dbd0026decaae101a865ad969b226",
    "declarationSha256": "b1270d34e475304ad7969653398d575a5db1ce8c825ef513e8f1d1cd2b049a4b",
    "ranges": [
      {
        "start": "export function supabaseDiagnosticCredentialMode",
        "end": "\nexport function runtimeDeploymentBinding"
      }
    ]
  }
].map(record => Object.freeze({ ...record, ranges: Object.freeze(record.ranges.map(range => Object.freeze(range))) })));
export const LEGACY_XERO_READ_BINDING = Object.freeze({ sourceSha256: '45d649e5b6732f78773b8fb8086e80d2e08567bd2ec69112547a1f9a0265f87e', lines: Object.freeze([
  "  xeroPortalStatus: readPolicy({\"cache\":\"none\",\"externalAction\":false,\"capability\":null}),",
  "  xeroPortalReceiptsList: readPolicy({\"cache\":\"none\",\"externalAction\":false,\"capability\":null}),",
  "  xeroPortalContactLifecycleLatest: readPolicy({\"cache\":\"none\",\"externalAction\":false,\"capability\":null}),",
  "  xeroPortalContactAutoCreateLatest: readPolicy({\"cache\":\"none\",\"externalAction\":false,\"capability\":null}),",
  "  xeroFinancialMappingsGet: readPolicy({\"cache\":\"none\",\"externalAction\":true,\"capability\":\"xero_portal_manage\"}),",
  "  xeroFinancialSyncLatest: readPolicy({\"cache\":\"none\",\"externalAction\":false,\"capability\":\"xero_portal_manage\"}),"
]) });
// This one empty-body legacy read retains its honest externalAction:true policy.
// Immutable reviewed mappings code performs stored mapping SELECTs and two GETs;
// the guarded existing-session path cannot claim/refresh a token. Existing GET
// request admission/quota observation RPCs are operational controls, preserved.
export const LEGACY_XERO_MAPPING_READ_BINDING = Object.freeze([
  {
    "file": "api/_xeroFinancialSync.js",
    "sourceSha256": "09e501326eb410683408192e43d3ec28d87ff6f78e6eb09be1aa672121c18964",
    "declarationSha256": "83b76f024d2e7a2b206bf1a063ab0ba4cd3d2b3ab12cf3e404ad7f513fe155ae",
    "start": "export async function xeroFinancialMappingsGet",
    "end": "\nexport async function xeroFinancialMappingsSave",
    "unchangedFromBaseline": true
  },
  {
    "file": "api/_xeroContactSync.js",
    "sourceSha256": "f68dfa50bf8f13671d081509cf1c35c3c339f226534b5ed650f96501cf633893",
    "declarationSha256": "497b757ffad294ce28427b5890f644bd216e9bd51b3222b0626ec229c5e00a61",
    "start": "export async function getFreshXeroConnection",
    "end": "\nexport async function readStoredXeroConnection",
    "unchangedFromBaseline": false
  },
  {
    "file": "api/_xeroContactSync.js",
    "sourceSha256": "f68dfa50bf8f13671d081509cf1c35c3c339f226534b5ed650f96501cf633893",
    "declarationSha256": "b9577abee5163682873cb20867aeec45b4d88dd9e29a6779cff494bc4a3849a4",
    "start": "export async function xeroAccountingFetch",
    "end": "\nfunction applyCreateOutcomes",
    "unchangedFromBaseline": false
  },
  {
    "file": "api/_xeroSharedControl.js",
    "sourceSha256": "58e3d63ebafb1567b1b65419d8c92249ea380dbaa2103f84a43951bfb2fcb932",
    "declarationSha256": "edb5a8f758f1b41ca744bff7732917c160002ce73e5a061e1aea89c8ece747f8",
    "start": "export function createXeroSharedControl",
    "end": "\nexport function readXeroSharedStatus",
    "unchangedFromBaseline": true
  }
].map(row => Object.freeze(row)));
const digest = value => createHash('sha256').update(value).digest('hex');

// BEGIN IMMUTABLE PURE 0
export function isDeploymentReadOnly(env = process.env) {
  return String(env.VERCEL_ENV || '').trim().toLowerCase() === 'preview'
    || String(env.FCOS_ENABLE_READ_ONLY_CI || '').trim().toLowerCase() === 'true';
}
// END IMMUTABLE PURE 0

// BEGIN IMMUTABLE PURE 1
const GATE_DEFINITIONS = Object.freeze({
  salesforce_write: {
    envName: 'FCOS_DISABLE_SALESFORCE_WRITE',
    defaultEnabled: true,
    label: 'Salesforce writeback',
    description: 'Live Salesforce record and file creation, update, and deletion.',
  },
  google_drive: {
    envName: 'FCOS_DISABLE_GOOGLE_DRIVE',
    defaultEnabled: true,
    label: 'Google Drive reports',
    description: 'Licensed market-report synchronization and complete-triple MOPS settlement publication.',
  },
  email_delivery: {
    envName: 'FCOS_DISABLE_EMAIL_DELIVERY',
    defaultEnabled: true,
    label: 'Email delivery',
    description: 'Manual and scheduled server email delivery.',
  },
  missing_nom_b_reminders: {
    envName: 'FCOS_ENABLE_MISSING_NOM_B_REMINDERS',
    defaultEnabled: false,
    label: 'Missing Nom B reminders',
    description: 'One automatic buyer-trader filing reminder per STEM after a final buyer invoice PDF is saved.',
  },
  outlook_calendar: {
    envName: 'FCOS_ENABLE_OUTLOOK_CALENDAR',
    defaultEnabled: false,
    label: 'Outlook calendar synchronization',
    description: 'Microsoft Graph creation, update, and cancellation of coaching calendar events.',
  },
  growth_coaching_email: {
    envName: 'FCOS_ENABLE_GROWTH_COACHING_EMAIL',
    defaultEnabled: false,
    label: 'Growth & Coaching email notifications',
    description: 'Immediate and digest email notifications generated by Growth & Coaching.',
  },
  bank_execution: {
    envName: 'FCOS_ENABLE_BANK_EXECUTION',
    defaultEnabled: false,
    label: 'Bank execution',
    description: 'External bank instruction or execution.',
  },
  payment_promotion: {
    envName: 'FCOS_ENABLE_PAYMENT_PROMOTION',
    defaultEnabled: false,
    label: 'Payment promotion',
    description: 'Promotion of reviewed drafts into authoritative payment records.',
  },
  xero_contact_sync: {
    envName: 'FCOS_ENABLE_XERO_CONTACT_SYNC',
    defaultEnabled: false,
    expectedState: 'live',
    label: 'Xero portal synchronization',
    description: 'Xero contact creation, contact rename/archive, and receipt draft-bill synchronization.',
  },
  xero_financial_sync: {
    envName: 'FCOS_ENABLE_XERO_FINANCIAL_SYNC',
    defaultEnabled: false,
    label: 'Salesforce-to-Xero financial synchronization',
    description: 'Finance-authorised creation or update of Xero accounting transactions and exact payment allocations.',
  },
});

function enabledValue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function definitionEnabled(definition, env) {
  if (isDeploymentReadOnly(env)) return false;
  return definition.defaultEnabled
    ? !enabledValue(env[definition.envName])
    : enabledValue(env[definition.envName]);
}

export function externalActionGates(env = process.env) {
  return Object.fromEntries(Object.entries(GATE_DEFINITIONS).map(([key, definition]) => [key, {
    key,
    label: definition.label,
    description: definition.description,
    enabled: definitionEnabled(definition, env),
    expectedState: definition.expectedState || (definition.defaultEnabled ? 'live' : 'uat_gated'),
    control: isDeploymentReadOnly(env) ? 'deployment_read_only' : definition.defaultEnabled ? 'emergency_kill_switch' : 'explicit_enablement',
  }]));
}
// END IMMUTABLE PURE 1

// BEGIN IMMUTABLE PURE 2
const MAX_TEXT = 500;
function text(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function emailSet(value) {
  return new Set(String(value || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

export function fcunoFederationConfig(env = process.env) {
  const federationEnabled = enabled(env.FCOS_ENABLE_FCUNO_FEDERATION);
  const syncEnabled = enabled(env.FCOS_ENABLE_FCUNO_IDENTITY_SYNC);
  const issuer = text(env.FCUNO_IDENTITY_ISSUER, 2000);
  const audience = text(env.FCUNO_IDENTITY_SYNC_AUDIENCE, 500);
  const jwksUri = text(env.FCUNO_IDENTITY_JWKS_URI, 2000);
  const algorithms = String(env.FCUNO_IDENTITY_JWT_ALGORITHMS || 'ES256')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return {
    federationEnabled,
    syncEnabled,
    issuer,
    audience,
    jwksUri,
    algorithms,
    legacyPasswordEnabled: enabled(env.FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN),
    legacyPilotEmails: emailSet(env.FCOS_FCUNO_LEGACY_PILOT_EMAILS),
    breakGlassEmails: emailSet(env.FCOS_FCUNO_BREAK_GLASS_EMAILS),
  };
}
// END IMMUTABLE PURE 2

// BEGIN IMMUTABLE PURE 3
function nonBlank(value) {
  return String(value || '').trim();
}

/** Resolve one server-only Supabase credential contract. Never serialize the returned key. */
export function serverSupabaseConfig(env = process.env) {
  const canonicalUrl = nonBlank(env.SUPABASE_URL);
  const legacyBrowserUrl = nonBlank(env.VITE_SUPABASE_URL);
  const secretKey = nonBlank(env.SUPABASE_SECRET_KEY);
  const legacyServiceRoleKey = nonBlank(env.SUPABASE_SERVICE_ROLE_KEY);
  const url = canonicalUrl || legacyBrowserUrl;
  const key = secretKey || legacyServiceRoleKey;

  return {
    url,
    key,
    configured: Boolean(url && key),
    urlEnv: canonicalUrl ? 'SUPABASE_URL' : legacyBrowserUrl ? 'VITE_SUPABASE_URL' : null,
    keyEnv: secretKey ? 'SUPABASE_SECRET_KEY' : legacyServiceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    keyType: secretKey ? 'secret' : legacyServiceRoleKey ? 'legacy_service_role' : null,
    missingEnv: [
      ...(!url ? ['SUPABASE_URL or VITE_SUPABASE_URL'] : []),
      ...(!key ? ['SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'] : []),
    ],
  };
}
// END IMMUTABLE PURE 3

// BEGIN IMMUTABLE PURE 4
export function supabaseDiagnosticCredentialMode(key, now = Date.now()) {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key || '')) return 'secret_key';
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.role !== 'service_role' || claims.ref !== fcosConnectionIdentifier('supabase', 'Project ref')
      || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now + 90000) return null;
    return 'service_role';
  } catch { return null; }
}
// END IMMUTABLE PURE 4

export function assertObservationDeclarationBytes(localText) {
  for (let index = 0; index < OBSERVATION_DECLARATIONS.length; index++) {
    const begin = `// BEGIN IMMUTABLE PURE ${index}\n`, end = `// END IMMUTABLE PURE ${index}\n`;
    if (localText.split(begin).length !== 2 || localText.split(end).length !== 2) throw new Error('Pure observation declaration boundary changed.');
    const section = localText.slice(localText.indexOf(begin) + begin.length, localText.indexOf(end));
    if (digest(section) !== OBSERVATION_DECLARATIONS[index].declarationSha256) throw new Error('Reviewed pure observation declaration changed.');
  }
  return true;
}

export function verifyCompatibilityObservationSources({ cwd, baseSha, candidateSha }) {
  if (baseSha !== OBSERVATION_BASE_SHA || candidateSha !== OBSERVATION_CANDIDATE_SHA) throw new Error('Exact immutable observation source pair required.');
  const repository = fcosConnectionIdentifier('github', 'Repository');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (![`https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git`].includes(git(['remote', 'get-url', 'origin']).trim())) throw new Error('Observation source repository mismatch.');
  const localText = readFileSync(new URL(import.meta.url), 'utf8');
  assertObservationDeclarationBytes(localText);
  for (const record of OBSERVATION_DECLARATIONS) {
    const source = git(['show', `${record.ref}:${record.file}`]);
    if (digest(source) !== record.sourceSha256) throw new Error('Immutable pure observation source hash changed.');
    const declarations = record.ranges.map(({ start, end }) => {
      if (source.split(start).length !== 2 || end && source.split(end).length !== 2) throw new Error('Immutable pure declaration is ambiguous.');
      const offset = source.indexOf(start); return source.slice(offset, end ? source.indexOf(end, offset) : source.length);
    }).join('\n');
    if (digest(declarations) !== record.declarationSha256) throw new Error('Immutable pure declaration hash changed.');
    if (record.ref === baseSha && git(['show', `${candidateSha}:${record.file}`]) !== source) throw new Error('Candidate changed baseline configuration interpreter.');
  }
  const registry = git(['show', `${candidateSha}:api/_handlerPolicyRegistry.js`]);
  if (digest(registry) !== LEGACY_XERO_READ_BINDING.sourceSha256 || git(['show', `${baseSha}:api/_handlerPolicyRegistry.js`]) !== registry
    || LEGACY_XERO_READ_BINDING.lines.some(line => registry.split(line).length !== 2)) throw new Error('Exact saved Xero read policy source binding changed.');
  for (const row of LEGACY_XERO_MAPPING_READ_BINDING) {
    const source = git(['show', `${candidateSha}:${row.file}`]);
    if (digest(source) !== row.sourceSha256 || source.split(row.start).length !== 2 || source.split(row.end).length !== 2
      || digest(source.slice(source.indexOf(row.start), source.indexOf(row.end, source.indexOf(row.start)))) !== row.declarationSha256
      || row.unchangedFromBaseline && git(['show', `${baseSha}:${row.file}`]) !== source) throw new Error('Exact existing-session legacy Xero GET source binding changed.');
  }
  return { sourceVerified: true, baseSha, candidateSha, declarationsSha256: digest(JSON.stringify({ pure: OBSERVATION_DECLARATIONS, legacyRead: LEGACY_XERO_MAPPING_READ_BINDING })),
    helperRevision: digest(localText), observationKind: 'independent_provider_probe_and_verified_deployment_configuration' };
}
