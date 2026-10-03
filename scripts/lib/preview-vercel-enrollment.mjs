import { createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';

export const ENROLLED_AUTHORITY_MODE = 'issuance-bound-v1';
export const ENROLLED_AUTHORITY_MODE_VARIABLE = 'FCOS_PREVIEW_VERCEL_AUTHORITY_MODE';
export const ENROLLED_AUTHORITY_ENABLE = 'FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED';
export const ENROLLED_AUTHORITY_RECEIPT = 'FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT';
export const ENROLLED_AUTHORITY_SECRET = 'FCOS_RELEASE_VERCEL_ENROLLMENT';
export const ENROLLED_AUTHORITY_FILENAME = 'fcos-preview-enrolled-authority.json';
export const ENROLLED_AUTHORITY_MAX_AGE_MS = 10 * 60_000;
export const ENROLLMENT_KEYCHAIN_SERVICE = 'com.fcos.preview.vercel.enrollment.v1';
const BINDING_DOMAIN = 'FCOS-PREVIEW-VERCEL-ISSUANCE-BINDING-V1\0';
const RECEIPT_DOMAIN = 'FCOS-PREVIEW-VERCEL-RUN-AUTHORITY-V1\0';
const repository = fcosConnectionIdentifier('github', 'Repository');
const teamId = fcosConnectionIdentifier('vercel', 'Team ID');
const projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const environment = 'fcos-runtime-compatibility-release';
const workflow = '.github/workflows/preview-email-proof-build.yml';
const MAX_LIFETIME = 24 * 60 * 60_000;
const fail = () => { throw new Error('Enrolled Preview authority failed; private evidence suppressed.'); };
const timestamp = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const inactive = value => value === undefined || value === null || value === 0 || value === '0';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = ['schemaVersion', 'enrollmentId', 'repository', 'environment', 'teamId', 'projectId', 'tokenId', 'createdAt', 'expiresAt'];
const contextKeys = ['repositoryId', 'environmentId', 'runId', 'runAttempt', 'harnessSha', 'controlRevision', 'contractSha256', 'candidateSha', 'operation'];
function ordered(value, fields) { if (!exact(value, fields)) fail(); return Object.fromEntries(fields.map(key => [key, value[key]])); }
function metadataValue(value) { return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? Number(value) : value; }
function enrollmentData(value, now) {
  const data = ordered(value, keys);
  if (data.schemaVersion !== 1 || !uuid(data.enrollmentId) || data.repository !== repository || data.environment !== environment
    || data.teamId !== teamId || data.projectId !== projectId || !id(data.tokenId) || !timestamp(now)
    || !timestamp(data.createdAt) || !timestamp(data.expiresAt) || data.createdAt > now || data.expiresAt <= now
    || data.expiresAt <= data.createdAt || data.expiresAt - data.createdAt > MAX_LIFETIME) fail();
  return data;
}
function contextData(value) {
  const data = ordered(value, contextKeys);
  if (![data.repositoryId, data.environmentId, data.runId].every(timestamp) || data.runAttempt !== 1
    || !commit(data.harnessSha) || !hash(data.controlRevision) || !hash(data.contractSha256) || !commit(data.candidateSha)
    || !['verify-authority', 'create', 'readback'].includes(data.operation)) fail();
  return data;
}
function decode(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) fail();
  return bytes;
}
function privateBinding(token, enrollment) {
  if (typeof token !== 'string' || !token.startsWith('vcp_') || /\s/.test(token) || token.length > 4096) fail();
  return createHmac('sha256', token).update(BINDING_DOMAIN).update(JSON.stringify(enrollment)).digest();
}

export function assertEnrollmentMetadata(raw, enrollment, now = Date.now()) {
  try {
    const data = enrollmentData(enrollment, now);
    if (!record(raw) || raw.id !== data.tokenId || raw.projectId !== projectId || raw.type !== 'token' || raw.prefix !== 'vcp_'
      || metadataValue(raw.createdAt) !== data.createdAt || metadataValue(raw.expiresAt) !== data.expiresAt
      || !inactive(raw.revokedAt) || !inactive(raw.leakedAt) || !Array.isArray(raw.scopes) || raw.scopes.length !== 1
      || raw.scopes[0]?.type !== 'team' || raw.scopes[0].teamId !== teamId
      || raw.scopes[0].expiresAt != null && (!timestamp(metadataValue(raw.scopes[0].expiresAt)) || metadataValue(raw.scopes[0].expiresAt) < data.expiresAt)) fail();
    return data;
  } catch { fail(); }
}

// The bearer and ID must come from ONE successful issuance response. This
// function does not enroll an arbitrary existing runtime bearer by assertion.
export function createPrivateEnrollment({ issuance, metadata, enrollmentId, requestedExpiresAt, now = Date.now() } = {}) {
  try {
    const enrollment = { schemaVersion: 1, enrollmentId, repository, environment, teamId, projectId,
      tokenId: issuance.token.id, createdAt: metadataValue(metadata.createdAt), expiresAt: metadataValue(metadata.expiresAt) };
    const data = assertEnrollmentMetadata(metadata, enrollment, now);
    if (data.expiresAt !== requestedExpiresAt || now - data.createdAt > 60_000) fail();
    return { enrollment: data, binding: privateBinding(issuance.bearerToken, data).toString('base64url') };
  } catch { fail(); }
}
function privateRecord(raw, now) {
  if (typeof raw === 'string' && Buffer.byteLength(raw) > 4096) fail();
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!exact(value, ['enrollment', 'binding'])) fail();
  return { enrollment: enrollmentData(value.enrollment, now), binding: decode(value.binding, 32) };
}
function receiptMessage(receipt, binding) {
  // Unlike the existing connection-health JSON signature, this fixed binary
  // domain commits to private enrollment binding WITHOUT publishing its tag.
  return Buffer.concat([Buffer.from(RECEIPT_DOMAIN), Buffer.from(JSON.stringify(receipt)), Buffer.from('\0'), binding]);
}
export function signEnrollmentReceipt({ privateEnrollment, metadata, context, privateKey, now = Date.now(), expiresAt } = {}) {
  try {
    const value = privateRecord(privateEnrollment, now);
    assertEnrollmentMetadata(metadata, value.enrollment, now);
    const receipt = { schemaVersion: 1, kind: 'fcos_preview_vercel_run_authority', keyId: FCOS_CONNECTION_POLICY.attestation.keyId,
      enrollment: value.enrollment, context: contextData(context), observedAt: now, issuedAt: now,
      expiresAt: expiresAt ?? Math.min(now + ENROLLED_AUTHORITY_MAX_AGE_MS, value.enrollment.expiresAt),
      projectOnly: true, revoked: false, leaked: false, productionAuthorized: false };
    if (!timestamp(receipt.expiresAt) || receipt.expiresAt <= now || receipt.expiresAt - now > ENROLLED_AUTHORITY_MAX_AGE_MS || receipt.expiresAt > value.enrollment.expiresAt) fail();
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519') fail();
    return { receipt, signature: sign(null, receiptMessage(receipt, value.binding), key).toString('base64url') };
  } catch { fail(); }
}

export function verifyEnrollmentReceipt({ envelope, privateEnrollment, token, reviewedTokenId, enrollmentId, context,
  now = Date.now(), publicKeySpkiBase64 = FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64 } = {}) {
  try {
    const value = privateRecord(privateEnrollment, now);
    if (!timingSafeEqual(privateBinding(token, value.enrollment), value.binding) || value.enrollment.tokenId !== reviewedTokenId
      || value.enrollment.enrollmentId !== enrollmentId) fail();
    if (typeof envelope === 'string' && Buffer.byteLength(envelope) > 16384) fail();
    const wrapped = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    if (!exact(wrapped, ['receipt', 'signature'])) fail();
    const receipt = ordered(wrapped.receipt, ['schemaVersion', 'kind', 'keyId', 'enrollment', 'context', 'observedAt', 'issuedAt', 'expiresAt', 'projectOnly', 'revoked', 'leaked', 'productionAuthorized']);
    receipt.enrollment = enrollmentData(receipt.enrollment, now);
    receipt.context = contextData(receipt.context);
    if (receipt.schemaVersion !== 1 || receipt.kind !== 'fcos_preview_vercel_run_authority' || receipt.keyId !== FCOS_CONNECTION_POLICY.attestation.keyId
      || !same(receipt.enrollment, value.enrollment) || !same(receipt.context, contextData(context))
      || receipt.projectOnly !== true || receipt.revoked !== false || receipt.leaked !== false || receipt.productionAuthorized !== false
      || ![receipt.observedAt, receipt.issuedAt, receipt.expiresAt].every(timestamp) || receipt.observedAt !== receipt.issuedAt
      || receipt.issuedAt > now + 30_000 || receipt.expiresAt <= now || now - receipt.observedAt > ENROLLED_AUTHORITY_MAX_AGE_MS
      || receipt.expiresAt <= receipt.issuedAt || receipt.expiresAt - receipt.issuedAt > ENROLLED_AUTHORITY_MAX_AGE_MS
      || receipt.expiresAt > value.enrollment.expiresAt) fail();
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiBase64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, receiptMessage(receipt, value.binding), key, decode(wrapped.signature, 64))) fail();
    return { credentialBindingVerified: true, metadataFreshnessVerified: true, enrollmentId,
      tokenExpiresAt: value.enrollment.expiresAt, receiptExpiresAt: receipt.expiresAt, productionAuthorized: false };
  } catch { fail(); }
}

export function enrolledProjectListShape(body) {
  try {
    const projects = record(body) ? body.projects : undefined;
    const pagination = record(body) ? body.pagination : undefined;
    const fieldKind = value => value === undefined ? 'missing' : value === null ? 'null' : timestamp(metadataValue(value)) ? 'timestamp' : 'invalid';
    const array = Array.isArray(projects), nonempty = array && projects.length > 0;
    return { bodyKind: Array.isArray(body) ? 'array' : record(body) ? 'record' : 'other',
      projectsKind: array ? 'array' : projects === undefined ? 'missing' : 'other',
      projectCountClass: !array ? 'unknown' : projects.length === 0 ? 'zero' : projects.length === 1 ? 'one' : 'multiple',
      everyProjectIdMatchesPinned: nonempty && projects.every(row => row?.id === projectId),
      everyAccountIdMatchesPinned: nonempty && projects.every(row => row?.accountId === teamId),
      everyNameMatchesPinned: nonempty && projects.every(row => row?.name === fcosConnectionIdentifier('vercel', 'Project')),
      paginationKind: record(pagination) ? 'record' : pagination === undefined ? 'missing' : 'other',
      paginationCountMatchesArrayLength: array && record(pagination) && Number.isSafeInteger(pagination.count) && pagination.count === projects.length,
      paginationNextKind: fieldKind(pagination?.next), paginationPrevKind: fieldKind(pagination?.prev),
      hasMoreKind: body?.hasMore === undefined ? 'missing' : body.hasMore === false ? 'false' : body.hasMore === true ? 'true' : 'invalid' };
  } catch { fail(); }
}
function completePinnedList(body) {
  const shape = enrolledProjectListShape(body);
  return shape.bodyKind === 'record' && shape.projectCountClass === 'one' && shape.everyProjectIdMatchesPinned
    && shape.everyAccountIdMatchesPinned && shape.everyNameMatchesPinned && shape.paginationKind === 'record'
    && shape.paginationCountMatchesArrayLength && shape.paginationNextKind === 'null'
    // The fixed no-cursor v9 first page is complete when next is null; the
    // pinned provider CLI uses this same next-only completion contract.
    && ['null', 'missing', 'timestamp'].includes(shape.paginationPrevKind) && ['false', 'missing'].includes(shape.hasMoreKind);
}
function projectConfiguration(project, configuration) {
  const [owner, repo] = repository.split('/');
  const branch = project?.link?.productionBranch, enabled = configuration?.git?.deploymentEnabled;
  return project?.id === projectId && project.accountId === teamId && project.name === fcosConnectionIdentifier('vercel', 'Project')
    && project.link?.type === 'github' && project.link.org === owner && project.link.repo === repo && branch === 'main'
    && (enabled === false || record(enabled) && (enabled[branch] === false || !Object.hasOwn(enabled, branch) && enabled['*'] === false))
    && project.autoAssignCustomDomains === false && Array.isArray(project.link.deployHooks) && project.link.deployHooks.length === 0;
}
export async function enrolledAuthorityGet(path, { token, fetchImpl = globalThis.fetch } = {}) {
  try {
    const permitted = ['/v9/projects?limit=100', '/v2/user', `/v2/teams/${teamId}`, `/v9/projects/${projectId}?teamId=${teamId}`];
    if (!permitted.includes(path) || typeof token !== 'string' || !token) fail();
    const url = `https://api.vercel.com${path}`;
    const response = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.redirected !== false || response.url && response.url !== url || !Number.isInteger(response.status)
      || response.status < 200 || response.status > 599 || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail();
    const reader = response.body?.getReader(); if (!reader) fail();
    const chunks = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength;
      if (length > 8 * 1024 * 1024) fail(); chunks.push(value); } } finally { await reader.cancel(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return response.status === 200 ? { status: 200, body } : { status: response.status, notFound: body?.error?.code === 'not_found' };
  } catch { fail(); }
}

export async function collectEnrolledPreviewAuthority({ verifyOnly = false, deploymentConfiguration, fetchImpl = globalThis.fetch,
  now = () => Date.now(), ...binding } = {}) {
  try {
    const authority = verifyEnrollmentReceipt({ ...binding, now: now() });
    const options = { token: binding.token, fetchImpl };
    const list = await enrolledAuthorityGet('/v9/projects?limit=100', options);
    const user = await enrolledAuthorityGet('/v2/user', options);
    const team = await enrolledAuthorityGet(`/v2/teams/${teamId}`, options);
    const project = await enrolledAuthorityGet(`/v9/projects/${projectId}?teamId=${teamId}`, options);
    // User 404/not_found is accepted ONLY in this explicitly enrolled mode,
    // with independently signed project scope plus matching runtime bytes.
    const report = { schemaVersion: 1, kind: 'fcos_preview_enrolled_authority_verification', readOnly: true,
      credentialBindingVerified: true, metadataFreshnessVerified: true,
      checks: { projectListCompletePinnedOnly: list.status === 200 && completePinnedList(list.body),
        userDenied: user.status === 403 || user.status === 404 && user.notFound === true,
        teamDenied: team.status === 403, pinnedProjectConfigurationVerified: project.status === 200 && projectConfiguration(project.body, deploymentConfiguration) },
      projectListShape: enrolledProjectListShape(list.body), previewAuthorized: false, productionAuthorized: false };
    report.authorityVerified = Object.values(report.checks).every(value => value === true);
    verifyEnrollmentReceipt({ ...binding, now: now() });
    if (!verifyOnly && !report.authorityVerified) fail();
    return { authority, project: project.body, report };
  } catch { fail(); }
}

export function enrolledAuthorityContext({ repositoryId, environmentId, runId, harnessSha, controlRevision, contractSha256, candidateSha, operation }) {
  return contextData({ repositoryId, environmentId, runId, runAttempt: 1, harnessSha, controlRevision, contractSha256, candidateSha, operation });
}
export const ENROLLMENT_FIXED_TARGET = Object.freeze({ repository, environment, projectId, teamId, workflow });
