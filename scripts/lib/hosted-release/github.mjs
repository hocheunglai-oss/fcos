import { createRemoteJWKSet, jwtVerify } from 'jose';
import { fail, sha, CONTROLLER_WORKFLOW, releaseTargets } from './contract.mjs';

const issuer = 'https://token.actions.githubusercontent.com';
export async function requestGitHubIdentity({ env = process.env, fetchImpl = fetch, audience = 'fcos-release-coordinator' } = {}) {
  let url;
  try { url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); } catch { fail('HOSTED_IDENTITY_REQUIRED'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com') || url.username || url.password || url.port
    || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) fail('HOSTED_IDENTITY_REQUEST');
  url.searchParams.set('audience', audience);
  let response;
  try { response = await fetchImpl(url, { headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { fail('HOSTED_IDENTITY_UNAVAILABLE', 'identity', 'Resume when GitHub OIDC is available; do not replace identity with local JSON.'); }
  if (!response.ok || response.redirected) fail('HOSTED_IDENTITY_UNAVAILABLE');
  const token = (await response.json()).value;
  if (typeof token !== 'string' || token.length > 32768) fail('HOSTED_IDENTITY_INVALID');
  return token;
}

export async function validateHostedIdentity(token, { controllerSha, repositoryId, runId, environment, audience = 'fcos-release-coordinator', keySet, now = Date.now() } = {}) {
  if (!sha(controllerSha) || !/^[1-9][0-9]*$/.test(String(repositoryId)) || !/^[1-9][0-9]*$/.test(String(runId))) fail('HOSTED_ADMISSION_CONFIG');
  let claims;
  try { ({ payload: claims } = await jwtVerify(token, keySet || createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`)), {
    issuer, audience, algorithms: ['RS256'], maxTokenAge: '5m', currentDate: new Date(now), clockTolerance: 30,
  })); } catch { fail('HOSTED_IDENTITY_INVALID'); }
  const repository = releaseTargets().repository;
  if (claims.repository !== repository || claims.repository_id !== String(repositoryId)
    || claims.repository_owner !== repository.split('/')[0] || claims.ref !== 'refs/heads/main'
    || ![true, 'true'].includes(claims.ref_protected) || claims.event_name !== 'workflow_dispatch'
    || claims.run_id !== String(runId) || claims.run_attempt !== '1'
    || claims.job_workflow_sha !== controllerSha
    || claims.job_workflow_ref !== `${repository}/${CONTROLLER_WORKFLOW}@${controllerSha}`
    || environment && (claims.environment !== environment || claims.sub !== `repo:${repository}:environment:${environment}`)) fail('HOSTED_IDENTITY_BINDING');
  return claims;
}

export function githubClient({ token, fetchImpl = fetch, repositoryId } = {}) {
  if (!token) fail('GITHUB_METADATA_CREDENTIAL_MISSING');
  const repository = releaseTargets().repository;
  async function read(path, { bytes = false } = {}) {
    if (!path.startsWith(`/repos/${repository}/`) && path !== `/repos/${repository}`) fail('GITHUB_TARGET_MISMATCH');
    let response;
    try { response = await fetchImpl(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
    catch { fail('GITHUB_READ_UNAVAILABLE', 'github.read', 'Retry this target-locked read; no provider write was attempted.'); }
    if (bytes && response.status === 302) {
      let location;
      try { location = new URL(response.headers.get('location')); } catch { fail('ARTIFACT_REDIRECT_INVALID'); }
      if (location.protocol !== 'https:' || location.username || location.password || location.port
        || !['.blob.core.windows.net', '.actions.githubusercontent.com'].some(suffix => location.hostname.endsWith(suffix))) fail('ARTIFACT_REDIRECT_INVALID');
      // GitHub's signed download URL receives no repository bearer credential.
      try { response = await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(30000) }); }
      catch { fail('ARTIFACT_DOWNLOAD_UNAVAILABLE'); }
    }
    if (!response.ok || !bytes && response.redirected) fail(`GITHUB_READ_HTTP_${response.status}`, 'github.read');
    const data = bytes ? Buffer.from(await response.arrayBuffer()) : await response.json();
    if (bytes && data.length > 32 * 1024 * 1024) fail('ARTIFACT_TOO_LARGE');
    return data;
  }
  return {
    read,
    async identity() {
      const repo = await read(`/repos/${repository}`);
      if (repo.full_name !== repository || String(repo.id) !== String(repositoryId) || repo.default_branch !== 'main' || repo.archived) fail('GITHUB_TARGET_MISMATCH');
      return repo;
    },
    async pages(path, field) {
      const rows = [];
      for (let page = 1; page <= 20; page++) {
        const result = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`), items = field ? result[field] : result;
        if (!Array.isArray(items)) fail('GITHUB_RESPONSE_INVALID'); rows.push(...items);
        if (items.length < 100) return rows;
      }
      fail('GITHUB_PAGINATION_LIMIT');
    },
  };
}
