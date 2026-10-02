import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';

const projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const teamId = fcosConnectionIdentifier('vercel', 'Team ID');
const [owner, repository] = fcosConnectionIdentifier('github', 'Repository').split('/');
const MAX_TOKEN_LIFETIME = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => (typeof value === 'number' || typeof value === 'string' && /^[1-9][0-9]*$/.test(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const inactive = value => value === undefined || value === null || value === 0 || value === '0';

function assertToken(token, reviewedTokenId, now) {
  if (!timestamp(now) || !/^[A-Za-z0-9_-]{1,200}$/.test(reviewedTokenId || '') || !record(token)
    || token.id !== reviewedTokenId || !inactive(token.revokedAt) || !inactive(token.leakedAt)
    || !timestamp(token.createdAt) || !timestamp(token.expiresAt)
    || Number(token.createdAt) > now || Number(token.expiresAt) <= now
    || Number(token.expiresAt) - Number(token.createdAt) > MAX_TOKEN_LIFETIME
    || Number(token.expiresAt) <= Number(token.createdAt)
    || !Array.isArray(token.scopes) || token.scopes.length !== 1
    || token.scopes[0]?.type !== 'team' || token.scopes[0].teamId !== teamId
    || token.scopes[0].expiresAt !== undefined && token.scopes[0].expiresAt !== null
      && (!timestamp(token.scopes[0].expiresAt) || Number(token.scopes[0].expiresAt) <= now)) {
    throw new Error('Preview requires current metadata for the exact reviewed, live, at-most-24-hour token in the pinned team.');
  }
}

function assertProjectList(list) {
  // The access-token guide uses v9. Do not treat the v10 reference's bare array,
  // absent pagination, a filtered lookup, or a partial page as scope evidence.
  if (!record(list) || !Array.isArray(list.projects) || list.projects.length !== 1
    || !record(list.pagination) || list.pagination.count !== 1 || list.pagination.next !== null
    || list.pagination.prev !== undefined && list.pagination.prev !== null
    || list.hasMore !== undefined && list.hasMore !== false
    || list.projects[0]?.id !== projectId || list.projects[0].accountId !== teamId
    || list.projects[0].name !== fcosConnectionIdentifier('vercel', 'Project')) {
    throw new Error('The complete unfiltered Preview token project list must contain only the pinned FCOS project.');
  }
}

export function assertVercelPreviewAuthority({ token, reviewedTokenId, projects, userStatus, teamStatus,
  project, deploymentConfiguration, now = Date.now() } = {}) {
  assertToken(token, reviewedTokenId, now);
  assertProjectList(projects);
  // A successful exact-project GET alone cannot establish project confinement.
  // The provider documents user/team resource denial for project-scoped tokens.
  if (userStatus !== 403 || teamStatus !== 403) throw new Error('Preview project confinement requires confirmed user and team resource denial.');
  if (project?.id !== projectId || project.name !== fcosConnectionIdentifier('vercel', 'Project')
    || project.accountId !== teamId || project.link?.type !== 'github'
    || project.link.org !== owner || project.link.repo !== repository) {
    throw new Error('Preview Vercel project, team, or GitHub repository identity mismatch.');
  }
  const branch = project.link.productionBranch;
  const enabled = deploymentConfiguration?.git?.deploymentEnabled;
  const disabled = enabled === false || typeof branch === 'string' && branch && record(enabled)
    && (enabled[branch] === false || !Object.hasOwn(enabled, branch) && enabled['*'] === false);
  const hooks = project.link.deployHooks;
  if (!disabled || project.autoAssignCustomDomains !== false || !Array.isArray(hooks) || hooks.length !== 0) {
    throw new Error('Automatic Production Git deployment, domain assignment, or deployment hooks could bypass the human gate.');
  }
  return { reviewedTokenBinding: 'verified', projectScopeEvidence: 'observed', projectId, teamId,
    tokenExpiresAt: Number(token.expiresAt), productionAuthorized: false };
}

async function read(path, { token, fetchImpl }) {
  try {
    const url = `https://api.vercel.com${path}`;
    const response = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${token}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.redirected !== false || response.url && response.url !== url
      || !Number.isInteger(response.status) || response.status < 200 || response.status > 599) throw new Error('response');
    if (response.status !== 200) {
      await response.body?.cancel();
      return { status: response.status };
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('content');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('body');
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new Error('size');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return { status: 200, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch { throw new Error('Pinned Preview Vercel authority GET failed; private diagnostics suppressed.'); }
}

/** A single fixed current-token read, with no account identity fallback or
 * locally supplied metadata. Denial cannot substitute for a token-ID proof. */
export async function readPreviewVercelTokenMetadata({ token, reviewedTokenId, fetchImpl = globalThis.fetch,
  now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token) throw new Error('The existing protected Preview credential is required.');
  const response = await read('/v5/user/tokens/current', { token, fetchImpl });
  if (response.status !== 200) throw new Error('Preview current token metadata is unavailable; no credential identity fallback is permitted.');
  const metadata = response.body?.token;
  assertToken(metadata, reviewedTokenId, now);
  return metadata;
}

/** The pinned CLI injects currentTeam and throws non-OK responses before its
 * --include formatter. Fixed REST GETs are required for team-free metadata and
 * reliable denial statuses. Project-resource reads use a verified same-token
 * pinned callback after the CLI capability check; scoped CLI startup also
 * requires user/team reads and its API client retries requests. This collector
 * never creates credentials or claims Production authority. */
export async function collectPreviewVercelAuthority({ token, reviewedTokenId, deploymentConfiguration,
  readProject, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (typeof readProject !== 'function') throw new Error('A verified same-credential pinned project reader is required.');
  const metadata = await readPreviewVercelTokenMetadata({ token, reviewedTokenId, fetchImpl, now: now() });
  const options = { token, fetchImpl };
  const listed = await read('/v9/projects?limit=100', options);
  if (listed.status !== 200) throw new Error('The unfiltered Preview token project list is unavailable.');
  assertProjectList(listed.body);
  const user = await read('/v2/user', options);
  if (user.status !== 403) throw new Error('The Preview token unexpectedly has user access or its denial is unverified.');
  const team = await read(`/v2/teams/${teamId}`, options);
  if (team.status !== 403) throw new Error('The Preview token unexpectedly has team access or its denial is unverified.');
  const project = await readProject(`/v9/projects/${projectId}`);
  const authority = assertVercelPreviewAuthority({ token: metadata, reviewedTokenId, projects: listed.body,
    userStatus: user.status, teamStatus: team.status, project, deploymentConfiguration, now: now() });
  return { project, authority };
}
