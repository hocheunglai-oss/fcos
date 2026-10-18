import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { serverSupabaseConfig } from '../../../api/_supabaseConfig.js';
import { isReservedCiIdentity } from '../../../api/_readOnlyCiAccess.js';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

const FAILURE = 'XERO_RECOVERY_ACTOR_AUTH_REFUSED';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BUDGET_MS = 15_000;
const MAX_BYTES = 65_536;
const SKEW_SECONDS = 60;
const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const projectRef = fcosConnectionIdentifier('supabase', 'Project ref');
const profileFields = 'id,email,active,user_type,access_revision';
const linkFields = 'id,provider,issuer,subject,auth_user_id,source_active,use_fcos,revision,credential_revision,revoked_before,email,email_verified';
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const need = value => { if (!value) throw refusal(); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const refusal = () => Object.assign(new Error(FAILURE), { code: FAILURE });

function exactData(value, fields) {
  if (!plain(value) || Object.keys(value).length !== fields.length) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return fields.every(field => descriptors[field] && Object.hasOwn(descriptors[field], 'value'));
}

function emailHash(value) {
  need(typeof value === 'string' && value.length <= 320);
  const normalized = value.trim().toLowerCase();
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized));
  return hash(normalized);
}

function tokenClaims(value) {
  need(typeof value === 'string' && value.length <= 16_384 && TOKEN.test(value));
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
  need(plain(claims));
  return claims;
}

function sessionClaims(bearer, user, binding, origin, at) {
  // Decoding establishes no trust: the exact bearer must first pass /auth/v1/user.
  const claims = tokenClaims(bearer);
  need(claims.iss === `${origin}/auth/v1` && claims.sub === user.id && user.id === binding.actorId
    && claims.role === 'authenticated' && claims.is_anonymous !== true && user.is_anonymous !== true
    && (claims.aud === 'authenticated' || Array.isArray(claims.aud) && claims.aud.includes('authenticated'))
    && UUID.test(claims.session_id || '') && positive(claims.iat) && positive(claims.exp)
    && claims.exp > claims.iat && claims.exp * 1000 > at && claims.iat * 1000 <= at + SKEW_SECONDS * 1000
    && Array.isArray(claims.amr) && claims.amr.length > 0 && claims.amr.length <= 10
    && claims.amr.every(entry => plain(entry) && ['oauth', 'totp', 'mfa/phone', 'token_refresh'].includes(entry.method)
      && positive(entry.timestamp) && entry.timestamp <= claims.iat + SKEW_SECONDS
      && entry.timestamp * 1000 <= at + SKEW_SECONDS * 1000));
  const oauth = claims.amr.filter(entry => entry.method === 'oauth');
  need(oauth.length === 1);
  return { sessionId: claims.session_id, authenticatedAt: oauth[0].timestamp * 1000, expiresAt: claims.exp * 1000 };
}

function userIdentity(user, binding) {
  need(plain(user) && user.id === binding.actorId && user.is_anonymous !== true
    && emailHash(user.email) === binding.emailSha256 && !isReservedCiIdentity(user));
  need(Array.isArray(user.identities) && user.identities.length <= 30);
  const identities = user.identities.filter(identity => identity?.provider === pin.oidcProvider);
  need(identities.length === 1);
  const identity = identities[0];
  const subject = identity.identity_data?.sub || identity.provider_id;
  need(typeof subject === 'string' && subject.length > 0 && subject.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(subject)
    && (!identity.identity_data?.sub || !identity.provider_id || identity.identity_data.sub === identity.provider_id));
  return subject;
}

function profileIdentity(rows, binding) {
  need(Array.isArray(rows) && rows.length === 1);
  const profile = rows[0];
  need(exactData(profile, profileFields.split(',')) && profile.id === binding.actorId && profile.active === true
    && ['administrator', 'general_manager'].includes(profile.user_type)
    && emailHash(profile.email) === binding.emailSha256 && profile.access_revision === binding.accessRevision
    && !isReservedCiIdentity(null, profile));
  return { id: profile.id, emailSha256: binding.emailSha256, role: profile.user_type, accessRevision: profile.access_revision };
}

function linkIdentity(rows, binding, subject, session, provider) {
  need(Array.isArray(rows) && rows.length === 1);
  const link = rows[0];
  need(exactData(link, linkFields.split(',')) && UUID.test(link.id || '') && link.provider === 'fcuno'
    && link.issuer === pin.issuer && link.subject === subject && link.auth_user_id === binding.actorId
    && link.source_active === true && link.use_fcos === true && link.email_verified === true
    && emailHash(link.email) === binding.emailSha256 && positive(link.revision) && positive(link.credential_revision)
    && link.revision === provider.identity_revision && link.credential_revision === provider.credential_revision);
  const floor = link.revoked_before === null ? 0 : typeof link.revoked_before === 'string' ? Date.parse(link.revoked_before) : NaN;
  need(Number.isFinite(floor) && session.authenticatedAt > floor && provider.iat * 1000 > floor);
  return { id: link.id, identityRevision: link.revision, credentialRevision: link.credential_revision, revokedBefore: floor };
}

function accessIdentity(projection, binding) {
  need(plain(projection) && projection.user_id === binding.actorId && projection.access_revision === binding.accessRevision
    && projection.privileged_access === true && plain(projection.permissions) && plain(projection.capabilities)
    && projection.permissions.xero_portal === true && projection.capabilities.xero_portal_manage === true);
  return { userId: projection.user_id, accessRevision: projection.access_revision, workspace: true, xeroPortalManage: true };
}

/** GET-only admission for an existing, original-owner recovery host. This does
 * not provision/link identities, persist session proof, renew tokens or grant
 * financial authority. Its trusted caller binds the three exact binding fields
 * to the immutable approved source/plan; request data must not choose that plan.
 * authenticate.signal is required and must come from the actual host request
 * lifecycle, never a JSON/body field or a fabricated never-aborted default.
 *
 * jwks is a trusted code/test option only, never a request-supplied key. Without
 * it the only key source is the canonical FCUNO JWKS URI. env reads are limited
 * to the two already-approved Supabase names, with canonical config validation.
 */
export function createXeroRecoveryActorAuthenticator(options = {}) {
  let config, origin, fetchImpl, now, jwks;
  try {
    need(plain(options) && Object.keys(options).every(key => ['env', 'fetchImpl', 'now', 'jwks'].includes(key)));
    let env;
    ({ env = process.env, fetchImpl = fetch, now = Date.now, jwks } = options);
    need(env && typeof fetchImpl === 'function' && typeof now === 'function');
    config = serverSupabaseConfig({ VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
    need(config.configured && typeof config.key === 'string' && config.key.length <= 16_384 && !/\s/.test(config.key));
    origin = new URL(config.url).origin;
    need(new URL(pin.oidcCallbackUrl).origin === origin);
  } catch { throw refusal(); }

  return Object.freeze({
    async authenticate(input = {}) {
      const monotonicStart = performance.now();
      let timer, combinedSignal, onAbort;
      const controller = new AbortController();
      try {
        need(exactData(input, ['bearer', 'providerAccessToken', 'actorId', 'binding', 'signal']));
        need(exactData(input.binding, ['actorId', 'emailSha256', 'accessRevision']));
        const binding = Object.freeze({ ...input.binding });
        const { bearer, providerAccessToken, actorId, signal } = input;
        need(signal instanceof AbortSignal && signal.aborted === false);
        combinedSignal = AbortSignal.any([signal, controller.signal]);
        need(UUID.test(binding.actorId || '') && actorId === binding.actorId && HASH.test(binding.emailSha256 || '') && positive(binding.accessRevision));
        tokenClaims(bearer); tokenClaims(providerAccessToken);
        const startedAt = now();
        need(Number.isSafeInteger(startedAt) && startedAt > 0);
        let lastAt = startedAt;
        const active = () => {
          const at = now();
          need(!combinedSignal.aborted && Number.isSafeInteger(at) && at >= lastAt
            && at - startedAt < BUDGET_MS && performance.now() - monotonicStart < BUDGET_MS);
          lastAt = at;
          return at;
        };
        const read = async (url, authorization, apiKey = config.key) => {
          active();
          need(typeof url === 'string' && url.length <= 4096);
          let response, reader;
          const cancelBody = () => {
            try { Promise.resolve(reader ? reader.cancel() : response?.body?.cancel()).catch(() => {}); } catch { /* No raw errors escape. */ }
          };
          combinedSignal.addEventListener('abort', cancelBody, { once: true });
          try {
            response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json',
              ...(authorization ? { authorization: `Bearer ${authorization}`, apikey: apiKey, 'accept-profile': 'public' } : {}) },
            redirect: 'error', cache: 'no-store', credentials: 'omit', signal: combinedSignal });
            active();
            need(response?.status === 200 && response.ok && !response.redirected && (!response.url || response.url === url)
              && /^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '') && response.body?.getReader);
            const length = response.headers.get('content-length');
            need(length === null || /^\d+$/.test(length) && Number(length) <= MAX_BYTES);
            reader = response.body.getReader();
            const chunks = []; let size = 0;
            for (;;) {
              const chunk = await reader.read(); active();
              if (chunk.done) break;
              need(chunk.value instanceof Uint8Array); size += chunk.value.byteLength;
              need(size <= MAX_BYTES); chunks.push(Buffer.from(chunk.value));
            }
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } finally {
            // Cancellation is best effort and never delays refusal or the deadline.
            combinedSignal.removeEventListener('abort', cancelBody);
            cancelBody();
          }
        };
        const work = async () => {
          const authUrl = `${origin}/auth/v1/user`;
          const user = await read(authUrl, bearer);
          const subject = userIdentity(user, binding);
          const session = sessionClaims(bearer, user, binding, origin, active());
          let key = jwks;
          if (key === undefined) {
            const keys = await read(pin.syncJwksEndpoint);
            need(plain(keys) && Array.isArray(keys.keys) && keys.keys.length > 0 && keys.keys.length <= 8
              && keys.keys.every(jwk => plain(jwk) && jwk.kty === 'EC' && jwk.crv === 'P-256' && !Object.hasOwn(jwk, 'd')));
            key = createLocalJWKSet(keys);
          }
          const { payload: provider } = await jwtVerify(providerAccessToken, key, {
            issuer: pin.issuer, audience: pin.oidcClientId, algorithms: ['ES256'], currentDate: new Date(active()),
          });
          const at = active();
          need(provider.typ === 'at+jwt' && provider.sub === subject && provider.use_fcos === true && provider.email_verified === true
            && typeof provider.jti === 'string' && provider.jti.length > 0 && provider.jti.length <= 500
            && positive(provider.iat) && positive(provider.exp) && provider.iat * 1000 <= at + SKEW_SECONDS * 1000
            && provider.exp * 1000 > at && provider.exp > provider.iat && provider.exp - provider.iat <= 300
            && at - provider.iat * 1000 <= 300_000 && session.authenticatedAt <= (provider.iat + SKEW_SECONDS) * 1000
            && positive(provider.identity_revision) && positive(provider.credential_revision)
            && (provider.email === undefined || emailHash(provider.email) === binding.emailSha256));
          const profileUrl = new URL('/rest/v1/user_profiles', origin);
          profileUrl.search = new URLSearchParams({ select: profileFields, id: `eq.${binding.actorId}`, limit: '2' }).toString();
          const linkUrl = new URL('/rest/v1/fcos_external_identity_links', origin);
          linkUrl.search = new URLSearchParams({ select: linkFields, auth_user_id: `eq.${binding.actorId}`,
            provider: 'eq.fcuno', issuer: `eq.${pin.issuer}`, subject: `eq.${subject}`, limit: '2' }).toString();
          const accessUrl = new URL('/rest/v1/rpc/fcos_effective_access', origin);
          accessUrl.search = new URLSearchParams({ p_user_id: binding.actorId }).toString();
          const snapshot = async () => {
            // Own profile reads retain the actor bearer and its own-row RLS.
            // The link table and pinned STABLE SECURITY INVOKER RPC permit
            // service_role only. That RPC has no auth.uid dependency: isolation
            // is its fixed p_user_id from the immutable approved actor binding,
            // after real getUser, own profile, signed FCUNO proof and owned link
            // all pass. Validate its actual user/revision and both Xero grants;
            // a service credential or local role never supplies those grants.
            const profile = profileIdentity(await read(profileUrl.href, bearer), binding);
            const link = linkIdentity(await read(linkUrl.href, config.key), binding, subject, session, provider);
            const access = accessIdentity(await read(accessUrl.href, config.key), binding);
            return { profile, link, access };
          };
          const initial = await snapshot();
          const finalUser = await read(authUrl, bearer);
          need(userIdentity(finalUser, binding) === subject);
          sessionClaims(bearer, finalUser, binding, origin, active());
          const final = await snapshot();
          need(JSON.stringify(initial) === JSON.stringify(final));
          const capturedAt = active();
          need(session.expiresAt > capturedAt && provider.exp * 1000 > capturedAt);
          // Repeated GETs detect observed drift, but are not one transactional
          // snapshot and cannot prevent revocation immediately after this return.
          // Reauthenticate at each protected operation; never reuse as a lease.
          return Object.freeze({ id: binding.actorId, active: true, role: final.profile.role, readOnlyCi: false,
            workspace: true, xeroPortalManage: true, capturedAt,
            sourceBinding: Object.freeze({ proofMode: 'fresh_provider_jwt_no_session_write', projectRef,
              issuer: pin.issuer, clientId: pin.oidcClientId, ...binding,
              identityRevision: final.link.identityRevision, credentialRevision: final.link.credentialRevision,
              identityLinkId: final.link.id, sessionIdSha256: hash(session.sessionId), subjectSha256: hash(subject),
              authenticatedAt: session.authenticatedAt, supabaseSessionExpiresAt: session.expiresAt, providerIssuedAt: provider.iat * 1000,
              providerExpiresAt: provider.exp * 1000, startedAt, capturedAt, atomicSnapshot: false }) });
        };
        const cancelled = new Promise((_, reject) => {
          onAbort = () => reject(refusal());
          combinedSignal.addEventListener('abort', onAbort, { once: true });
          if (combinedSignal.aborted) onAbort();
        });
        timer = setTimeout(() => controller.abort(), Math.max(0, BUDGET_MS - (performance.now() - monotonicStart)));
        const actor = await Promise.race([cancelled, work()]);
        active();
        return actor;
      } catch { throw refusal(); }
      finally {
        clearTimeout(timer);
        if (onAbort) combinedSignal.removeEventListener('abort', onAbort);
        controller.abort();
      }
    },
  });
}
