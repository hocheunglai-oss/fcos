import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';

const validatedProfiles = new WeakSet();
const normalizedEmail = (value) => String(value || '').trim().toLowerCase();
const reject = (code = 'FCOS_CI_READ_ONLY') => Object.assign(
  new Error('This automated test identity is restricted to approved read-only Dashboard and Markets operations.'),
  { status: 403, code },
);

export function isReservedCiIdentity(authUser, profile = null) {
  return normalizedEmail(authUser?.email) === FCOS_READ_ONLY_CI.email
    || normalizedEmail(profile?.email) === FCOS_READ_ONLY_CI.email
    || (authUser?.identities || []).some((identity) => identity.provider === FCOS_READ_ONLY_CI.provider
      && [identity.identity_data?.sub, identity.identity_data?.provider_id].includes(FCOS_READ_ONLY_CI.subject));
}

// Called only after Supabase getUser and the live, signed FCUNO identity-link
// checks. Do not accept browser metadata or an email-only identity match.
export function validateCiFederation({ authUser, profile, link, issuer, subject, env = process.env }) {
  if (!isReservedCiIdentity(authUser, profile)) return false;
  if (env.FCOS_ENABLE_READ_ONLY_CI !== 'true'
    || issuer !== FCOS_READ_ONLY_CI.issuer || subject !== FCOS_READ_ONLY_CI.subject
    || normalizedEmail(authUser?.email) !== FCOS_READ_ONLY_CI.email
    || normalizedEmail(link?.email) !== FCOS_READ_ONLY_CI.email
    || (profile && normalizedEmail(profile.email) !== FCOS_READ_ONLY_CI.email)
    || link?.email_verified !== true || link?.source_active !== true || link?.use_fcos !== true
    || (link?.auth_user_id && link.auth_user_id !== authUser?.id)) {
    throw reject('FCOS_CI_IDENTITY_NOT_READY');
  }
  return true;
}

export function denyCiWithoutFederation(authUser, profile) {
  if (isReservedCiIdentity(authUser, profile)) throw reject('FCOS_CI_IDENTITY_NOT_READY');
}

export function readOnlyCiProfile(profile) {
  if (!profile) throw reject('FCOS_CI_IDENTITY_NOT_READY');
  // The pinned principal is enabled by the deployment flag + live FCUNO
  // entitlement, not ordinary Viewer defaults. Leave its stored profile inactive
  // with zero permissions: a rollback to an older application cannot admit it.
  const restricted = { ...profile, active: true, user_type: 'viewer', use_type_defaults: false };
  validatedProfiles.add(restricted);
  return restricted;
}

export function isReadOnlyCiProfile(profile) {
  return Boolean(profile && (validatedProfiles.has(profile) || normalizedEmail(profile.email) === FCOS_READ_ONLY_CI.email));
}

// Positive, reviewed allowlist. A registry entry marked mutation:false is NOT
// sufficient: some legacy read routes also perform reconciliation or AI calls.
export const READ_ONLY_CI_HANDLERS = Object.freeze([
  'authContext', 'portalApplicationsList', 'navigationPreferencesGet', 'workspacePreferencesGet',
  'workNotificationsList',
  'dashboardFilterOptions', 'dashboardSummary', 'dashboardStemList', 'dashboardAnalytics',
  'dashboardCounterpartySearch', 'dashboardAccountCreditDirectory', 'dashboardAccountExposureBatch',
  'dashboardAccountInsight', 'dashboardAccountCreditStatement', 'dashboardAiSettingsGet',
  'dashboardAccountInsightReportOptions', 'dashboardAccountInsightReportPresetsList',
  'salesforceStemDetail', 'salesforceStemDocuments',
  'marketPulseSnapshot', 'marketIntelligenceBrief', 'marketIntelligenceCurve',
  'marketIntelligenceValuation', 'marketIntelligenceAlertRulesGet', 'marketIntradayTimeline', 'marketReportCatalogue',
]);
const readHandlers = new Set(READ_ONLY_CI_HANDLERS);
const marketReadActions = new Set([
  'snapshot', 'market_history', 'intelligence_brief', 'intelligence_curve',
  'intelligence_valuation', 'intelligence_alert_rules_get',
]);

export function requireReadOnlyCiOperation(profile, name, body = {}, { mutation = false } = {}) {
  if (!isReadOnlyCiProfile(profile)) return;
  if (mutation) throw reject();
  if (readHandlers.has(name)) return;
  if (name === 'hedgeMarkets' && marketReadActions.has(String(body?.action || 'snapshot'))) return;
  throw reject();
}

export function ciModuleAccess(moduleIds) {
  return Object.fromEntries(moduleIds.map((id) => [id, FCOS_READ_ONLY_CI.modules.includes(id)]));
}

export function emptyCiNotifications(body = {}) {
  return { notifications: [], unreadCount: 0, unavailableSources: [],
    filters: { source: body.source || 'all', state: body.state || 'active', type: body.type || 'all' },
    restrictedReadOnly: true };
}
