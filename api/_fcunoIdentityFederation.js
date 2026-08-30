import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PROVIDER = 'fcuno';
const SUPABASE_PROVIDER = 'custom:fcuno';
const SYNC_EVENT_TYPE = 'fcuno.identity.v1';
const SYNC_TOKEN_TYPE = 'fcuno.identity-sync+jwt';
const MAX_SYNC_TOKEN_AGE_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_TEXT = 500;
const jwksByUri = new Map();

export function fcunoFederationError(message, status = 400, code = 'FCUNO_IDENTITY_REJECTED', expose = status < 500) {
  return Object.assign(new Error(message), { status, code, expose });
}

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function emailSet(value) {
  return new Set(String(value || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function optionalTimestamp(value) {
  const candidate = text(value, 80);
  if (!candidate) return null;
  const epoch = Date.parse(candidate);
  if (!Number.isFinite(epoch)) throw fcunoFederationError('FCUNO identity update timestamp is invalid.', 400, 'FCUNO_IDENTITY_TIMESTAMP_INVALID');
  return new Date(epoch).toISOString();
}

function exactHttpsUrl(value, label) {
  const candidate = text(value, 2000);
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw fcunoFederationError(`${label} must be an HTTPS URL.`, 500, 'FCUNO_IDENTITY_CONFIG_INVALID', true);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw fcunoFederationError(`${label} must be an HTTPS URL without credentials or a fragment.`, 500, 'FCUNO_IDENTITY_CONFIG_INVALID', true);
  }
  return candidate;
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

function requireSyncConfiguration(config) {
  if (!config.federationEnabled || !config.syncEnabled) {
    throw fcunoFederationError('FCUNO identity synchronization is not enabled.', 404, 'FCUNO_IDENTITY_SYNC_DISABLED');
  }
  if (!config.issuer || !config.audience || !config.jwksUri || !config.algorithms.length) {
    throw fcunoFederationError('FCUNO identity synchronization is not configured.', 503, 'FCUNO_IDENTITY_CONFIG_MISSING', true);
  }
  exactHttpsUrl(config.issuer, 'FCUNO_IDENTITY_ISSUER');
  exactHttpsUrl(config.jwksUri, 'FCUNO_IDENTITY_JWKS_URI');
  if (config.algorithms.length !== 1 || config.algorithms[0] !== 'ES256') {
    throw fcunoFederationError('FCUNO identity synchronization must use ES256.', 503, 'FCUNO_IDENTITY_CONFIG_INVALID', true);
  }
  return config;
}

function jwksFor(uri) {
  if (!jwksByUri.has(uri)) jwksByUri.set(uri, createRemoteJWKSet(new URL(uri)));
  return jwksByUri.get(uri);
}

function bearer(headers = {}) {
  const value = headers.authorization || headers.Authorization || '';
  return String(value).match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

export async function verifyFcunoIdentitySyncToken({ headers = {}, env = process.env, now = undefined, jwks = null } = {}) {
  const config = requireSyncConfiguration(fcunoFederationConfig(env));
  const token = bearer(headers);
  if (!token) throw fcunoFederationError('Signed FCUNO identity token is required.', 401, 'FCUNO_IDENTITY_TOKEN_MISSING');
  try {
    const verified = await jwtVerify(token, jwks || jwksFor(config.jwksUri), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
      ...(now == null ? {} : { currentDate: new Date(now) }),
    });
    const currentSeconds = Math.floor((now == null ? Date.now() : Number(now)) / 1000);
    const issuedAt = Number(verified.payload.iat);
    const expiresAt = Number(verified.payload.exp);
    if (!Number.isSafeInteger(issuedAt)
      || !Number.isSafeInteger(expiresAt)
      || issuedAt > currentSeconds + MAX_CLOCK_SKEW_SECONDS
      || currentSeconds - issuedAt > MAX_SYNC_TOKEN_AGE_SECONDS
      || expiresAt - issuedAt > MAX_SYNC_TOKEN_AGE_SECONDS) {
      throw fcunoFederationError('FCUNO identity token lifetime is invalid.', 401, 'FCUNO_IDENTITY_TOKEN_LIFETIME_INVALID');
    }
    if (verified.payload.typ !== SYNC_TOKEN_TYPE) {
      throw fcunoFederationError('FCUNO identity token type is invalid.', 401, 'FCUNO_IDENTITY_TOKEN_TYPE_INVALID');
    }
    return { payload: verified.payload, protectedHeader: verified.protectedHeader, config };
  } catch (error) {
    if (error?.code === 'ERR_JWT_EXPIRED') throw fcunoFederationError('FCUNO identity token has expired.', 401, 'FCUNO_IDENTITY_TOKEN_EXPIRED');
    throw fcunoFederationError('FCUNO identity token verification failed.', 401, 'FCUNO_IDENTITY_TOKEN_INVALID');
  }
}

export function normalizeFcunoIdentitySyncClaims(payload) {
  const identity = payload?.identity && typeof payload.identity === 'object' ? payload.identity : {};
  const subject = text(payload?.sub, 500);
  const identitySubject = text(identity.sub, 500);
  const eventId = text(payload?.event_id, 500);
  const tokenId = text(payload?.jti, 500);
  const revision = Number(identity.identity_revision);
  const credentialRevision = Number(identity.credential_revision);
  const email = text(identity.email, 320).toLowerCase();
  const username = text(identity.username, 320);
  const fullName = text(identity.display_name, 200);
  const occurredAt = optionalTimestamp(payload?.occurred_at);
  const revokedBefore = optionalTimestamp(identity.revoked_before);
  if (payload?.event_type !== SYNC_EVENT_TYPE) throw fcunoFederationError('FCUNO identity event type is invalid.', 400, 'FCUNO_IDENTITY_EVENT_TYPE_INVALID');
  if (!subject || !identitySubject || subject !== identitySubject) throw fcunoFederationError('FCUNO identity subject is invalid.', 400, 'FCUNO_IDENTITY_SUBJECT_INVALID');
  if (!eventId || eventId !== tokenId) throw fcunoFederationError('FCUNO identity event ID is invalid.', 400, 'FCUNO_IDENTITY_EVENT_ID_INVALID');
  if (!Number.isSafeInteger(revision) || revision < 1) throw fcunoFederationError('FCUNO identity revision is invalid.', 400, 'FCUNO_IDENTITY_REVISION_INVALID');
  if (!Number.isSafeInteger(credentialRevision) || credentialRevision < 1) throw fcunoFederationError('FCUNO credential revision is invalid.', 400, 'FCUNO_CREDENTIAL_REVISION_INVALID');
  if (identity.email_verified !== true || !email) throw fcunoFederationError('FCUNO requires a verified email.', 400, 'FCUNO_IDENTITY_EMAIL_UNVERIFIED');
  if (!username || !fullName || !occurredAt || !revokedBefore) throw fcunoFederationError('FCUNO identity metadata is incomplete.', 400, 'FCUNO_IDENTITY_METADATA_INCOMPLETE');
  if (typeof identity.is_active !== 'boolean'
    || typeof identity.use_fcos !== 'boolean'
    || typeof identity.use_spc !== 'boolean') {
    throw fcunoFederationError('FCUNO identity access flags are required.', 400, 'FCUNO_IDENTITY_ACCESS_FLAGS_INVALID');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fcunoFederationError('FCUNO identity email is invalid.', 400, 'FCUNO_IDENTITY_EMAIL_INVALID');
  return {
    subject,
    eventId,
    revision,
    credentialRevision,
    sourceActive: identity.is_active,
    useFcos: identity.use_fcos,
    useSpc: identity.use_spc,
    email,
    username,
    fullName,
    sourceUpdatedAt: occurredAt,
    revokedBefore,
  };
}

function requestHash(claims) {
  return createHash('sha256').update(JSON.stringify(claims)).digest('hex');
}

async function writeAudit(client, row) {
  const { error } = await client.from('fcos_external_identity_audit').insert(row);
  if (error) throw error;
}

async function transactionByEvent(client, issuer, eventId) {
  const { data, error } = await client.from('fcos_external_identity_sync_transactions')
    .select('id,status,request_hash').eq('provider', PROVIDER).eq('issuer', issuer).eq('event_id', eventId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function reserveTransaction(client, { issuer, claims, jti }) {
  const hash = requestHash(claims);
  const row = { provider: PROVIDER, issuer, event_id: claims.eventId, subject: claims.subject, revision: claims.revision, status: 'received', request_jti: jti || null, request_hash: hash };
  const { data, error } = await client.from('fcos_external_identity_sync_transactions').insert(row).select().maybeSingle();
  if (!error) return { transaction: data, duplicate: false, requestHash: hash };
  if (error.code !== '23505') throw error;
  const transaction = await transactionByEvent(client, issuer, claims.eventId);
  if (!transaction || transaction.request_hash !== hash) throw fcunoFederationError('FCUNO identity event conflicts with an existing request.', 409, 'FCUNO_IDENTITY_EVENT_CONFLICT');
  return { transaction, duplicate: true, requestHash: hash };
}

async function completeTransaction(client, id, status, errorCode = null) {
  const { error } = await client.from('fcos_external_identity_sync_transactions')
    .update({ status, error_code: errorCode, completed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

async function identityLink(client, issuer, subject) {
  const { data, error } = await client.from('fcos_external_identity_links')
    .select('id,auth_user_id,source_active,use_fcos,use_spc,revision,credential_revision,revoked_before,email,email_verified,username,full_name')
    .eq('provider', PROVIDER).eq('issuer', issuer).eq('subject', subject).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function projectBoundProfile(client, link, claims) {
  if (!link?.auth_user_id) return;
  const patch = {
    email: claims.email || link.email || '',
    full_name: claims.fullName || link.full_name || '',
    updated_at: new Date().toISOString(),
  };
  if (!patch.email) return;
  const { error } = await client.from('user_profiles').update(patch).eq('id', link.auth_user_id);
  if (error) throw error;
}

function sameInstant(left, right) {
  return Date.parse(left || '') === Date.parse(right || '');
}

function linkMatchesClaims(link, claims) {
  return link?.source_active === claims.sourceActive
    && link?.use_fcos === claims.useFcos
    && link?.use_spc === claims.useSpc
    && Number(link?.credential_revision) === claims.credentialRevision
    && String(link?.email || '').toLowerCase() === claims.email
    && link?.email_verified === true
    && String(link?.username || '') === claims.username
    && String(link?.full_name || '') === claims.fullName
    && sameInstant(link?.source_updated_at, claims.sourceUpdatedAt)
    && Date.parse(link?.revoked_before || '') >= Date.parse(claims.revokedBefore || '');
}

/** Process a signed FCUNO envelope. Only signed claims are projected; request body is intentionally ignored. */
/**
 * @param {{headers?: Record<string, unknown>, env?: NodeJS.ProcessEnv, client?: any, now?: number, jwks?: any}} options
 */
export async function processFcunoIdentitySync({ headers = {}, env = process.env, client, now = Date.now(), jwks = null } = {}) {
  if (!client) throw new TypeError('FCUNO identity sync requires a service-role Supabase client.');
  const verified = await verifyFcunoIdentitySyncToken({ headers, env, now, jwks });
  const claims = normalizeFcunoIdentitySyncClaims(verified.payload);
  const reservation = await reserveTransaction(client, { issuer: verified.config.issuer, claims, jti: text(verified.payload.jti, 500) });
  if (reservation.duplicate && ['applied', 'ignored'].includes(reservation.transaction.status)) {
    return { ok: true, duplicate: true, eventId: claims.eventId, revision: claims.revision };
  }

  try {
    const existing = await identityLink(client, verified.config.issuer, claims.subject);
    if (existing && claims.revision < Number(existing.revision)) {
      await completeTransaction(client, reservation.transaction.id, 'ignored');
      await writeAudit(client, { identity_link_id: existing.id, provider: PROVIDER, issuer: verified.config.issuer, subject: claims.subject, transaction_id: reservation.transaction.id, action: 'sync_ignored_stale_revision', revision: claims.revision, metadata: { current_revision: existing.revision } });
      return { ok: true, ignored: true, eventId: claims.eventId, revision: claims.revision };
    }
    if (existing && claims.revision === Number(existing.revision) && !linkMatchesClaims(existing, claims)) {
      throw fcunoFederationError('FCUNO identity revision conflicts with the synchronized identity.', 409, 'FCUNO_IDENTITY_REVISION_CONFLICT');
    }

    const permitted = claims.sourceActive && claims.useFcos;
    const providerRevocation = Date.parse(claims.revokedBefore);
    const localRevocation = existing?.revoked_before ? Date.parse(existing.revoked_before) : Number.NaN;
    const deniedAt = permitted ? Number.NaN : Number(now);
    const revokedBefore = new Date(Math.max(
      Number.isFinite(providerRevocation) ? providerRevocation : 0,
      Number.isFinite(localRevocation) ? localRevocation : 0,
      Number.isFinite(deniedAt) ? deniedAt : 0,
    )).toISOString();
    const linkPatch = {
      provider: PROVIDER,
      issuer: verified.config.issuer,
      subject: claims.subject,
      auth_user_id: existing?.auth_user_id || null,
      source_active: claims.sourceActive,
      use_fcos: claims.useFcos,
      use_spc: claims.useSpc,
      revision: claims.revision,
      credential_revision: claims.credentialRevision,
      email: claims.email,
      email_verified: true,
      username: claims.username,
      full_name: claims.fullName,
      source_updated_at: claims.sourceUpdatedAt,
      revoked_before: revokedBefore,
      last_synced_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    };
    let resolvedLink = existing;
    if (!existing || claims.revision > Number(existing.revision)) {
      const { data: link, error: linkError } = await client.from('fcos_external_identity_links')
        .upsert(linkPatch, { onConflict: 'provider,issuer,subject' }).select().maybeSingle();
      if (linkError) {
        const concurrent = await identityLink(client, verified.config.issuer, claims.subject);
        if (!concurrent || claims.revision > Number(concurrent.revision)) throw linkError;
        if (claims.revision < Number(concurrent.revision)) {
          await completeTransaction(client, reservation.transaction.id, 'ignored');
          await writeAudit(client, { identity_link_id: concurrent.id, provider: PROVIDER, issuer: verified.config.issuer, subject: claims.subject, transaction_id: reservation.transaction.id, action: 'sync_ignored_concurrent_stale_revision', revision: claims.revision, metadata: { current_revision: concurrent.revision } });
          return { ok: true, ignored: true, eventId: claims.eventId, revision: claims.revision };
        }
        if (claims.revision === Number(concurrent.revision) && !linkMatchesClaims(concurrent, claims)) {
          throw fcunoFederationError('FCUNO identity revision conflicts with the synchronized identity.', 409, 'FCUNO_IDENTITY_REVISION_CONFLICT');
        }
        resolvedLink = concurrent;
      } else {
        resolvedLink = link || { ...existing, ...linkPatch };
      }
    }
    await projectBoundProfile(client, resolvedLink, claims);
    await completeTransaction(client, reservation.transaction.id, 'applied');
    await writeAudit(client, { identity_link_id: resolvedLink.id || existing?.id || null, provider: PROVIDER, issuer: verified.config.issuer, subject: claims.subject, transaction_id: reservation.transaction.id, action: permitted ? 'sync_access_projected' : 'sync_access_revoked', revision: claims.revision, metadata: { source_active: claims.sourceActive, use_fcos: claims.useFcos, use_spc: claims.useSpc, credential_revision: claims.credentialRevision, profile_projected: Boolean(resolvedLink.auth_user_id) } });
    return { ok: true, duplicate: false, eventId: claims.eventId, revision: claims.revision, access: permitted ? 'active' : 'revoked' };
  } catch (error) {
    await completeTransaction(client, reservation.transaction.id, 'failed', String(error?.code || 'FCUNO_IDENTITY_SYNC_FAILED').slice(0, 120)).catch(() => {});
    throw error;
  }
}

function linkedFcunoSubject(authUser) {
  const identity = (authUser?.identities || []).find((item) => item?.provider === SUPABASE_PROVIDER);
  const subject = text(identity?.identity_data?.sub || identity?.provider_id, 500);
  return subject || null;
}

function accessTokenIssuedAt(token) {
  try {
    const part = String(token || '').split('.')[1];
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number.isSafeInteger(payload.iat) ? payload.iat * 1000 : null;
  } catch {
    return null;
  }
}

function legacyAccessAllowed(profile, config) {
  const email = text(profile?.email, 320).toLowerCase();
  return config.legacyPasswordEnabled || config.legacyPilotEmails.has(email) || config.breakGlassEmails.has(email);
}

async function provisionZeroPermissionProfile(client, authUser, link) {
  const email = text(link.email || authUser?.email, 320).toLowerCase();
  if (!email) throw fcunoFederationError('FCUNO identity does not provide an email for FCOS profile projection.', 403, 'FCUNO_IDENTITY_EMAIL_REQUIRED');
  const { error } = await client.from('user_profiles').upsert({
    id: authUser.id,
    email,
    full_name: text(link.full_name || authUser?.user_metadata?.full_name, 500),
    user_type: 'viewer',
    active: false,
    use_type_defaults: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

/** Enforce FCUNO link ownership for every authenticated FCOS server boundary. */
/**
 * @param {{client?: any, authUser?: any, profile?: any, accessToken?: string | null, env?: NodeJS.ProcessEnv}} options
 */
export async function enforceFcunoFederatedAccess({ client, authUser, profile = null, accessToken = null, env = process.env } = {}) {
  const config = fcunoFederationConfig(env);
  if (!config.federationEnabled) return profile;
  if (!config.issuer) throw fcunoFederationError('FCUNO identity federation is not configured.', 503, 'FCUNO_IDENTITY_CONFIG_MISSING', true);
  const subject = linkedFcunoSubject(authUser);
  if (!subject) {
    if (profile && legacyAccessAllowed(profile, config)) return profile;
    throw fcunoFederationError('FCUNO-linked sign-in is required for FCOS.', 403, 'FCUNO_IDENTITY_LINK_REQUIRED');
  }
  const link = await identityLink(client, config.issuer, subject);
  if (!link || (link.auth_user_id && link.auth_user_id !== authUser.id)) {
    throw fcunoFederationError('This FCUNO identity is not linked to the FCOS account.', 403, 'FCUNO_IDENTITY_LINK_REQUIRED');
  }
  if (!link.auth_user_id) {
    const { data: claimed, error } = await client.from('fcos_external_identity_links')
      .update({ auth_user_id: authUser.id, updated_at: new Date().toISOString() })
      .eq('id', link.id).is('auth_user_id', null).select().maybeSingle();
    if (error) throw error;
    if (!claimed) throw fcunoFederationError('This FCUNO identity was linked concurrently. Sign in again.', 409, 'FCUNO_IDENTITY_LINK_RACE');
    link.auth_user_id = authUser.id;
  }
  if (link.source_active !== true || link.use_fcos !== true) {
    throw fcunoFederationError('FCUNO has not authorized this account for FCOS.', 403, 'FCUNO_IDENTITY_ACCESS_REVOKED');
  }
  const issuedAt = accessTokenIssuedAt(accessToken);
  if (link.revoked_before && (!issuedAt || issuedAt <= Date.parse(link.revoked_before))) {
    throw fcunoFederationError('This FCOS session was revoked. Sign in again.', 401, 'FCUNO_IDENTITY_SESSION_REVOKED');
  }
  if (!profile) await provisionZeroPermissionProfile(client, authUser, link);
  const { data: resolvedProfile, error: profileError } = await client.from('user_profiles')
    .select('id,email,full_name,user_type,active,use_type_defaults').eq('id', authUser.id).maybeSingle();
  if (profileError) throw profileError;
  return resolvedProfile || profile;
}
