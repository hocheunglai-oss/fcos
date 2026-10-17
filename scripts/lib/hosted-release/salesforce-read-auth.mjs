import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { fcosSalesforceEnvironment, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const SALESFORCE_READ_ENVIRONMENT = 'fcos-hosted-dependency-verification';
export const SALESFORCE_JWT_AUDIENCE = 'https://test.salesforce.com';
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function refuse(code = 'SALESFORCE_READ_AUTHENTICATION_REQUIRED') { const error = new Error(code); error.code = code; error.phase = 'salesforce.read'; throw error; }
const need = (value, code = 'SALESFORCE_READ_CREDENTIAL_BINDING') => { if (!value) refuse(code); };
const credentialFields = ['clientId','orgId','username','userId','profileId','instanceUrl','isSandbox','apiVersion','audience','scopes','publicKeyPem','publicKeySha256','issuedAt','notAfter','sessionUseSeconds','providerPermissionMode'];
const scopesValid = scopes => Array.isArray(scopes) && new Set(scopes).size === scopes.length && scopes.includes('api') && scopes.includes('id') && scopes.every(scope => ['api','id','openid'].includes(scope));
const sameId = (actual, expected) => actual === expected || actual === expected.slice(0, 15);

/** Public pins only. notAfter/sessionUseSeconds are local use limits, never a
 * claim of provider token expiry or that the user's Salesforce profile is read-only. */
export function validateSalesforceReadBinding(binding, { now = Date.now() } = {}) {
  const devee = fcosSalesforceEnvironment('devee');
  need(exact(binding, ['schemaVersion','kind',...credentialFields,'originalSetupReceiptSha256','rootAcceptanceSha256'])
    && binding.schemaVersion === 1 && binding.kind === 'fcos_salesforce_jwt_recipe_reader'
    && typeof binding.clientId === 'string' && /^[A-Za-z0-9_.-]{20,256}$/.test(binding.clientId)
    && binding.orgId === devee.orgId && binding.username === devee.username && binding.instanceUrl === devee.instanceUrl
    && binding.isSandbox === true && binding.audience === SALESFORCE_JWT_AUDIENCE && binding.apiVersion === 'v67.0'
    && /^005[A-Za-z0-9]{15}$/.test(binding.userId || '') && /^00e[A-Za-z0-9]{15}$/.test(binding.profileId || '')
    && scopesValid(binding.scopes) && binding.providerPermissionMode === 'pinned_user_permissions'
    && hash(binding.publicKeySha256) && hash(binding.originalSetupReceiptSha256) && hash(binding.rootAcceptanceSha256)
    && typeof binding.publicKeyPem === 'string' && binding.publicKeyPem.length <= 8192
    && Number.isSafeInteger(binding.issuedAt) && binding.issuedAt > 0 && binding.issuedAt <= now + 30000
    && Number.isSafeInteger(binding.notAfter) && binding.notAfter > binding.issuedAt && binding.notAfter > now
    && Number.isSafeInteger(binding.sessionUseSeconds) && binding.sessionUseSeconds >= 60 && binding.sessionUseSeconds <= 300);
  try {
    const key = createPublicKey(binding.publicKeyPem);
    need(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 2048
      && key.export({ type: 'spki', format: 'pem' }) === binding.publicKeyPem && digest(key.export({ type: 'spki', format: 'der' })) === binding.publicKeySha256);
  } catch { refuse('SALESFORCE_READ_CREDENTIAL_BINDING'); }
  return binding;
}

/** The admitted setup/source hash authenticates this independently reviewed
 * ORIGINAL client, permission, certificate-key and environment-only storage proof. */
export function validateSalesforceReadAcceptance(binding, setup, options) {
  validateSalesforceReadBinding(binding, options);
  const reference = setup?.salesforceReadCredentialAcceptance;
  need(exact(reference, ['json','sha256']) && typeof reference.json === 'string' && Buffer.byteLength(reference.json) <= 32768
    && reference.sha256 === binding.rootAcceptanceSha256 && digest(reference.json) === reference.sha256, 'SALESFORCE_READ_SETUP_PROOF_REQUIRED');
  let review; try { review = JSON.parse(reference.json); } catch { refuse('SALESFORCE_READ_SETUP_PROOF_REQUIRED'); }
  need(exact(review, ['schemaVersion','kind','accepted','reviewerId','operator','reviewedAt','originalSetupReceiptSha256','clientConfigurationReadbackSha256','userPermissionsReadbackSha256','secretStorageReadbackSha256','environment','environmentOnly','credential'])
    && review.schemaVersion === 1 && review.kind === 'fcos_root_accepted_salesforce_jwt_setup' && review.accepted === true
    && review.reviewerId === '/root' && review.operator === fcosConnectionIdentifier('github', 'Required account')
    && Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) >= binding.issuedAt - 30000 && Date.parse(review.reviewedAt) <= (options?.now ?? Date.now()) + 30000
    && review.originalSetupReceiptSha256 === binding.originalSetupReceiptSha256
    && ['clientConfigurationReadbackSha256','userPermissionsReadbackSha256','secretStorageReadbackSha256'].every(key => hash(review[key]))
    && review.environment === SALESFORCE_READ_ENVIRONMENT && review.environmentOnly === true
    && exact(review.credential, credentialFields) && canonical(review.credential) === canonical(Object.fromEntries(credentialFields.map(key => [key, binding[key]]))), 'SALESFORCE_READ_SETUP_PROOF_REQUIRED');
  return review;
}

const field = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value);
/** A recipe is data, never executable SOQL or an arbitrary route. Its complete
 * bytes are separately pinned by the manifest and validated against NomB history. */
export function salesforceRecipePath(read, version) {
  need(version === 'v67.0' && field(read?.object) && typeof read.tooling === 'boolean', 'SALESFORCE_READ_ROUTE_FORBIDDEN');
  if (read.kind === 'describe') {
    need(exact(read, ['kind','object','tooling']) && read.tooling === false, 'SALESFORCE_READ_ROUTE_FORBIDDEN');
    return `/services/data/${version}/sobjects/${read.object}/describe`;
  }
  need(read.kind === 'query' && exact(read, read.where ? ['kind','object','tooling','fields','limit','where'] : ['kind','object','tooling','fields','limit'])
    && Array.isArray(read.fields) && read.fields.length > 0 && read.fields.length <= 40 && new Set(read.fields).size === read.fields.length && read.fields.every(field) && read.fields.includes('Id')
    && Number.isSafeInteger(read.limit) && read.limit >= 1 && read.limit <= 2000
    && (!read.where || exact(read.where, ['field','values']) && field(read.where.field) && Array.isArray(read.where.values) && read.where.values.length > 0 && read.where.values.length <= 100
      && read.where.values.every(value => typeof value === 'string' && /^[A-Za-z0-9 _./:@-]{1,200}$/.test(value))), 'SALESFORCE_READ_ROUTE_FORBIDDEN');
  const where = read.where ? ` WHERE ${read.where.field} IN (${read.where.values.map(value => `'${value}'`).join(',')})` : '';
  return `/services/data/${version}/${read.tooling ? 'tooling/' : ''}query?q=${encodeURIComponent(`SELECT ${read.fields.join(',')} FROM ${read.object}${where} ORDER BY Id LIMIT ${read.limit}`)}`;
}

async function responseJson(response, url, maxBytes) {
  need(response?.status === 200 && !response.redirected && (!response.url || response.url === url), 'SALESFORCE_READ_UNAVAILABLE');
  need(Number(response.headers?.get?.('content-length') || 0) <= maxBytes, 'SALESFORCE_READ_UNAVAILABLE');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > maxBytes) { await reader.cancel(); refuse('SALESFORCE_READ_UNAVAILABLE'); } chunks.push(Buffer.from(chunk.value)); } }
    finally { reader.releaseLock(); }
    bytes = Buffer.concat(chunks);
  } else bytes = Buffer.from(await response.arrayBuffer());
  need(bytes.length <= maxBytes, 'SALESFORCE_READ_UNAVAILABLE');
  try { return JSON.parse(bytes.toString('utf8')); } catch { refuse('SALESFORCE_READ_UNAVAILABLE'); }
}

/** No token/key is returned, persisted or passed to candidate code. One exchange
 * per in-memory session; an HTTP/auth failure is never retried or replayed. */
export function createSalesforceRecipeReader({ manifest, recipe, recipeBytes, recipeSha256, env = process.env, fetchImpl = globalThis.fetch, now = Date.now }) {
  const binding = structuredClone(validateSalesforceReadBinding(manifest?.verification?.salesforceReadCredential, { now: now() }));
  need(recipe && ['orgId','username','userId','profileId','isSandbox','apiVersion'].every(key => recipe[key] === binding[key]) && recipe.origin === binding.instanceUrl
    && hash(recipeSha256) && manifest.dependencies?.nom_b?.recipeSha256 === recipeSha256, 'SALESFORCE_READ_RECIPE_BINDING');
  try {
    need(Buffer.isBuffer(recipeBytes) && recipeBytes.length <= 32 * 1024 * 1024 && digest(recipeBytes) === recipeSha256
      && canonical(JSON.parse(recipeBytes.toString('utf8'))) === canonical(recipe), 'SALESFORCE_READ_RECIPE_BINDING');
  } catch { refuse('SALESFORCE_READ_RECIPE_BINDING'); }
  const reads = structuredClone(recipe.observations.flatMap(row => row.reads)), paths = reads.map(read => salesforceRecipePath(read, binding.apiVersion));
  need(reads.length > 0 && reads.length <= 16, 'SALESFORCE_READ_RECIPE_BINDING');
  let token, usableUntil = 0, authentication, used = 0, failed = false;
  const context = async () => {
    const { assertHostedSetup, assertHostedSourceContext } = await import('./admission.mjs');
    assertHostedSetup({ manifest, env }); assertHostedSourceContext({ manifest, env });
    validateSalesforceReadBinding(binding, { now: now() });
    need(env.FCOS_HOSTED_ENVIRONMENT === SALESFORCE_READ_ENVIRONMENT && ['before','after'].includes(env.FCOS_VERIFICATION_PHASE)
      && env.GITHUB_JOB === `dependencies_${env.FCOS_VERIFICATION_PHASE}` && /^[1-9][0-9]*$/.test(env.FCOS_VERIFIED_JOB_ID || '')
      && !env.FCOS_HOSTED_SALESFORCE_READ_TOKEN, 'SALESFORCE_READ_HOSTED_CONTEXT');
  };
  const request = async (url, options, maxBytes) => {
    try { return await responseJson(await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }), url, maxBytes); }
    catch { token = undefined; failed = true; refuse('SALESFORCE_READ_UNAVAILABLE'); }
  };
  const fixedGet = path => request(`${binding.instanceUrl}${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 4 * 1024 * 1024);
  const authenticate = async () => {
    await context(); need(!failed, 'SALESFORCE_READ_UNAVAILABLE');
    let key;
    try {
      need(typeof env.FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY === 'string' && env.FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY.length <= 16384, 'SALESFORCE_READ_PRIVATE_INPUT_REQUIRED');
      key = createPrivateKey(env.FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY);
      need(key.asymmetricKeyType === 'rsa' && digest(createPublicKey(key).export({ type: 'spki', format: 'der' })) === binding.publicKeySha256, 'SALESFORCE_READ_PRIVATE_KEY_SUBSTITUTED');
    } catch (error) { refuse(error.code?.startsWith('SALESFORCE_') ? error.code : 'SALESFORCE_READ_PRIVATE_KEY_SUBSTITUTED'); }
    const issued = Math.floor(now() / 1000), header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: binding.clientId, sub: binding.username, aud: SALESFORCE_JWT_AUDIENCE, exp: issued + 120, jti: randomUUID() })).toString('base64url');
    const unsigned = `${header}.${claims}`, assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
    key = undefined;
    const exchangedAt = now();
    const response = await request(`${SALESFORCE_JWT_AUDIENCE}/services/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() }, 32768);
    try {
      need(response.token_type === 'Bearer' && typeof response.access_token === 'string' && response.access_token.length >= 16 && response.access_token.length <= 4096 && !/\s/.test(response.access_token)
        && response.instance_url === binding.instanceUrl && !response.refresh_token && typeof response.scope === 'string'
        && canonical(response.scope.split(' ').filter(Boolean).sort()) === canonical([...binding.scopes].sort()), 'SALESFORCE_READ_EXCHANGE_BINDING');
      const id = new URL(response.id);
      need([binding.instanceUrl, SALESFORCE_JWT_AUDIENCE].includes(id.origin) && !id.search && !id.hash && !id.username && !id.password
        && [binding.orgId, binding.orgId.slice(0,15)].some(org => [binding.userId,binding.userId.slice(0,15)].some(user => id.pathname === `/id/${org}/${user}`)), 'SALESFORCE_READ_EXCHANGE_BINDING');
      need(response.expires_in === undefined || Number.isSafeInteger(Number(response.expires_in)) && Number(response.expires_in) > 30, 'SALESFORCE_READ_EXCHANGE_BINDING');
      token = response.access_token;
      usableUntil = Math.min(binding.notAfter, exchangedAt + Math.min(binding.sessionUseSeconds, response.expires_in === undefined ? binding.sessionUseSeconds : Number(response.expires_in) - 30) * 1000);
      const info = await fixedGet('/services/oauth2/userinfo');
      need(sameId(info.organization_id, binding.orgId) && sameId(info.user_id, binding.userId) && (info.preferred_username || info.username) === binding.username, 'SALESFORCE_READ_IDENTITY_CHANGED');
      const org = await fixedGet(`/services/data/${binding.apiVersion}/query?q=${encodeURIComponent('SELECT Id,IsSandbox FROM Organization LIMIT 2')}`);
      need(org.done === true && org.totalSize === 1 && org.records?.length === 1 && org.records[0].Id === binding.orgId && org.records[0].IsSandbox === true, 'SALESFORCE_READ_IDENTITY_CHANGED');
      const user = await fixedGet(`/services/data/${binding.apiVersion}/sobjects/User/${binding.userId}?fields=Id,Username,IsActive,ProfileId`);
      need(user.Id === binding.userId && user.Username === binding.username && user.IsActive === true && user.ProfileId === binding.profileId, 'SALESFORCE_READ_IDENTITY_CHANGED');
    } catch { token = undefined; failed = true; refuse('SALESFORCE_READ_IDENTITY_OR_SCOPE_CHANGED'); }
  };
  const admit = async () => {
    await context(); need(!failed, 'SALESFORCE_READ_UNAVAILABLE');
    if (token && now() < usableUntil) return;
    if (!authentication) authentication = authenticate().finally(() => { authentication = undefined; });
    await authentication; need(now() < usableUntil, 'SALESFORCE_READ_SESSION_EXPIRED');
  };
  return Object.freeze({ admit, readRecipe: async index => {
    need(Number.isSafeInteger(index) && index >= 0 && index < paths.length && used < 16, 'SALESFORCE_READ_ROUTE_FORBIDDEN');
    await admit(); need(used < 16, 'SALESFORCE_READ_ROUTE_FORBIDDEN'); used++; return fixedGet(paths[index]);
  } });
}
