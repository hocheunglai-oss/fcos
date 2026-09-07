import { appendFile } from 'node:fs/promises';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const VERCEL_PROJECT = fcosConnectionIdentifier('vercel', 'Project');
const VERCEL_TEAM = fcosConnectionIdentifier('vercel', 'Team');
const GITHUB_REPOSITORY = fcosConnectionIdentifier('github', 'Repository');
const SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GITHUB_API = 'https://api.github.com';
const MAX_CANDIDATE_WAIT_MS = 5 * 60 * 1000;
const CANDIDATE_POLL_MS = 10 * 1000;

function valueOrThrow(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  if (value !== value.trim()) throw new Error(`${name} must not include leading or trailing whitespace.`);
  return value;
}

export function canonicalFcosE2eCandidateUrl(value, { project = VERCEL_PROJECT, team = VERCEL_TEAM } = {}) {
  const candidate = valueOrThrow(value, 'FCOS_E2E_CANDIDATE_URL');
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('FCOS_E2E_CANDIDATE_URL must be a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('FCOS_E2E_CANDIDATE_URL must use HTTPS.');
  if (url.username || url.password) throw new Error('FCOS_E2E_CANDIDATE_URL must not contain userinfo.');
  if (url.port) throw new Error('FCOS_E2E_CANDIDATE_URL must not contain a port.');
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('FCOS_E2E_CANDIDATE_URL must be the canonical deployment origin without a path, query, or fragment.');
  }
  const hostname = url.hostname.toLowerCase();
  const deploymentToken = `${project}-`;
  const teamSuffix = `-${team}.vercel.app`;
  if (!hostname.startsWith(deploymentToken) || !hostname.endsWith(teamSuffix)) {
    throw new Error(`FCOS_E2E_CANDIDATE_URL must target an immutable ${project} deployment in Vercel team ${team}.`);
  }
  const deploymentLabel = hostname.slice(deploymentToken.length, -teamSuffix.length);
  if (!/^[a-z0-9]{9}$/.test(deploymentLabel)) {
    throw new Error('FCOS_E2E_CANDIDATE_URL must use the immutable Vercel deployment hostname, not a branch or other alias.');
  }
  const canonical = `https://${hostname}`;
  if (candidate !== canonical) {
    throw new Error('FCOS_E2E_CANDIDATE_URL must use the exact lowercase canonical deployment origin.');
  }
  return canonical;
}

// Checks artifact consistency only. Authentication callers must use the
// resolver below, which first binds this URL/SHA to independent provider proof.
export async function verifyFcosE2eCandidate({
  candidateUrl,
  expectedCommit,
  protectionBypass,
  fetchImpl = globalThis.fetch,
  project = VERCEL_PROJECT,
  team = VERCEL_TEAM,
} = {}) {
  const canonicalUrl = canonicalFcosE2eCandidateUrl(candidateUrl, { project, team });
  const commit = valueOrThrow(expectedCommit, 'FCOS_E2E_EXPECTED_COMMIT');
  if (!SHA.test(commit)) throw new Error('FCOS_E2E_EXPECTED_COMMIT must be a full lowercase Git commit SHA.');
  if (protectionBypass && !/^[a-zA-Z0-9]{32}$/.test(protectionBypass)) throw new Error('The dedicated candidate protection credential is invalid.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required to verify the candidate.');
  const metadataUrl = `${canonicalUrl}/app-version.json`;
  let response;
  try {
    response = await fetchImpl(metadataUrl, {
      ...(protectionBypass ? { headers: { 'x-vercel-protection-bypass': protectionBypass } } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // A transport/provider error can echo request headers. Never log it.
    throw new Error('FCOS_E2E_CANDIDATE_URL must serve app-version.json without redirects.');
  }
  if (response.redirected || (response.url && response.url !== metadataUrl)) {
    throw new Error('Candidate app-version.json must not redirect.');
  }
  if (!response.ok) throw new Error(`Candidate app-version.json returned HTTP ${response.status}.`);
  let metadata;
  try {
    metadata = await response.json();
  } catch {
    throw new Error('Candidate app-version.json must contain valid JSON.');
  }
  if (metadata?.commit !== commit) {
    throw new Error('Candidate commit does not match the checked-out commit.');
  }
  const deploymentId = metadata?.deploymentId ?? null;
  if (deploymentId !== null && !DEPLOYMENT_ID.test(String(deploymentId))) {
    throw new Error('Candidate app-version.json deployment ID must be an immutable Vercel deployment ID when present.');
  }
  return { candidateUrl: canonicalUrl, commit, deploymentId };
}

function githubApiRepository(repository) {
  const [owner, name, ...extra] = String(repository || '').split('/');
  if (!owner || !name || extra.length) throw new Error('FCOS GitHub repository policy is invalid.');
  return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function isVercelBot(value) {
  return value?.creator?.login === 'vercel[bot]';
}

function newest(items) {
  return [...items].sort((left, right) => {
    const rightTime = Date.parse(right?.created_at || right?.updated_at || '') || 0;
    const leftTime = Date.parse(left?.created_at || left?.updated_at || '') || 0;
    return rightTime - leftTime || Number(right?.id || 0) - Number(left?.id || 0);
  })[0] || null;
}

function exactPreviewDeployment(deployments, expectedCommit, repositoryApi) {
  return newest((Array.isArray(deployments) ? deployments : []).filter((deployment) => (
    deployment?.sha === expectedCommit
    && deployment?.environment === 'Preview'
    && isVercelBot(deployment)
    && Number.isSafeInteger(deployment?.id)
    && deployment.id > 0
    && (!deployment.repository_url || deployment.repository_url === repositoryApi)
  )));
}

function latestVercelStatus(statuses) {
  return newest((Array.isArray(statuses) ? statuses : []).filter(isVercelBot));
}

async function githubJson(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('GitHub deployment lookup failed.');
  }
  if (response.redirected || (response.url && response.url !== url)) {
    throw new Error('GitHub deployment lookup must not redirect.');
  }
  if (!response.ok) throw new Error(`GitHub deployment lookup returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error('GitHub deployment lookup returned invalid JSON.');
  }
}

export async function resolveFcosE2eCandidate({
  candidateUrl,
  expectedCommit,
  protectionBypass,
  githubToken,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  maxWaitMs = MAX_CANDIDATE_WAIT_MS,
  pollMs = CANDIDATE_POLL_MS,
  repository = GITHUB_REPOSITORY,
  project = VERCEL_PROJECT,
  team = VERCEL_TEAM,
} = {}) {
  const commit = valueOrThrow(expectedCommit, 'FCOS_E2E_EXPECTED_COMMIT');
  if (!SHA.test(commit)) throw new Error('FCOS_E2E_EXPECTED_COMMIT must be a full lowercase Git commit SHA.');
  const requestedUrl = candidateUrl != null && String(candidateUrl) !== ''
    ? canonicalFcosE2eCandidateUrl(candidateUrl, { project, team }) : null;
  const token = valueOrThrow(githubToken, 'GITHUB_TOKEN');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required to resolve the candidate.');
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('Candidate wait policy is invalid.');
  }
  const repositoryApi = githubApiRepository(repository);
  const deploymentsUrl = `${repositoryApi}/deployments?sha=${encodeURIComponent(commit)}&environment=Preview&per_page=20`;
  const deadline = now() + maxWaitMs;
  while (true) {
    const deployment = exactPreviewDeployment(await githubJson(fetchImpl, deploymentsUrl, token), commit, repositoryApi);
    if (deployment) {
      const statusesUrl = `${repositoryApi}/deployments/${deployment.id}/statuses?per_page=20`;
      const status = latestVercelStatus(await githubJson(fetchImpl, statusesUrl, token));
      if (status?.state === 'error' || status?.state === 'failure') {
        throw new Error(`Newest FCOS Vercel Preview deployment ${deployment.id} reported ${status.state}.`);
      }
      if (status?.state === 'success' && typeof status.environment_url === 'string' && status.environment_url) {
        const providerUrl = canonicalFcosE2eCandidateUrl(status.environment_url, { project, team });
        if (requestedUrl && requestedUrl !== providerUrl) {
          throw new Error('Requested candidate URL does not match the newest successful Vercel Preview deployment for this commit.');
        }
        const artifact = await verifyFcosE2eCandidate({
          candidateUrl: providerUrl,
          expectedCommit: commit,
          protectionBypass,
          fetchImpl,
          project,
          team,
        });
        return { ...artifact, githubDeploymentId: deployment.id };
      }
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error('No successful immutable FCOS Preview deployment was available for the checked-out commit within five minutes.');
    }
    await sleep(Math.min(pollMs, remaining));
  }
}

export async function main({ env = process.env, fetchImpl = globalThis.fetch, append = appendFile } = {}) {
  const verified = await resolveFcosE2eCandidate({
    candidateUrl: env.FCOS_E2E_CANDIDATE_URL,
    expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT,
    protectionBypass: env.FCOS_E2E_VERCEL_BYPASS,
    githubToken: env.GITHUB_TOKEN,
    fetchImpl,
  });
  if (env.GITHUB_ENV) await append(env.GITHUB_ENV, `FCOS_E2E_BASE_URL=${verified.candidateUrl}\n`, 'utf8');
  console.log(`Verified FCOS candidate ${verified.candidateUrl} for ${verified.commit} (GitHub deployment ${verified.githubDeploymentId}).`);
  return verified;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
