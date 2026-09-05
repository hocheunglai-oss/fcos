import path from 'node:path';

const PREVIEW_HOST = /^fcos-[a-z0-9-]+-hocheunglai-6535s-projects\.vercel\.app$/;
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const SAFE_STORAGE_STATE = /^\/tmp\/fcos-e2e-[A-Za-z0-9._-]+\.json$/;

function required(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`${name} is required for strict release verification.`);
  return value;
}

function requiredFullSha(environment, name) {
  const value = required(environment, name).toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error(`${name} must be a full 40-character Git SHA for strict release verification.`);
  return value;
}

function releaseSha(environment) {
  const name = String(environment.FCOS_RELEASE_SHA || '').trim() ? 'FCOS_RELEASE_SHA' : 'GITHUB_SHA';
  return requiredFullSha(environment, name);
}

function safeStorageState(environment) {
  const storageState = required(environment, 'FCOS_E2E_STORAGE_STATE');
  if (!path.isAbsolute(storageState) || path.dirname(storageState) !== '/tmp' || !SAFE_STORAGE_STATE.test(storageState)) {
    throw new Error('FCOS_E2E_STORAGE_STATE must be a dedicated /tmp/fcos-e2e-*.json file for strict release verification.');
  }
  return storageState;
}

function previewUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('FCOS_E2E_BASE_URL must be an absolute HTTPS FCOS Vercel preview URL for strict release verification.');
  }
  if (
    url.protocol !== 'https:'
    || !PREVIEW_HOST.test(url.hostname)
    || url.port
    || url.username
    || url.password
    || !['', '/'].includes(url.pathname)
    || url.search
    || url.hash
  ) {
    throw new Error('FCOS_E2E_BASE_URL must be the supplied root HTTPS FCOS Vercel preview URL with no credentials, path, query, or fragment.');
  }
  return url;
}

export function assertReleaseBrowserEnvironment(environment = process.env) {
  const baseUrl = previewUrl(required(environment, 'FCOS_E2E_BASE_URL'));
  const previewSha = requiredFullSha(environment, 'FCOS_E2E_PREVIEW_SHA');
  const expectedReleaseSha = releaseSha(environment);
  const storageState = safeStorageState(environment);
  const email = required(environment, 'FCOS_E2E_EMAIL');
  const password = required(environment, 'FCOS_E2E_PASSWORD');
  if (previewSha !== expectedReleaseSha) {
    throw new Error(`FCOS_E2E_PREVIEW_SHA (${previewSha}) must match FCOS_RELEASE_SHA (${expectedReleaseSha}).`);
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    previewSha,
    releaseSha: expectedReleaseSha,
    storageState,
    email,
    password,
    protectionBypass: String(environment.FCOS_VERCEL_AUTOMATION_BYPASS_SECRET || '').trim(),
  };
}

export async function verifyReleasePreviewArtifact(environment, { fetchImpl = fetch } = {}) {
  // Validate again at the credential boundary, including injected test callers.
  const artifactUrl = `${previewUrl(environment.baseUrl).origin}/app-version.json`;
  let response;
  try {
    response = await fetchImpl(artifactUrl, {
      headers: {
        accept: 'application/json',
        ...(environment.protectionBypass ? { 'x-vercel-protection-bypass': environment.protectionBypass } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('FCOS preview app-version artifact could not be fetched without redirects before browser authentication.');
  }
  if (!response?.ok || response.url && response.url !== artifactUrl) {
    throw new Error('FCOS preview app-version artifact was unavailable or redirected before browser authentication.');
  }
  let artifact;
  try {
    artifact = await response.json();
  } catch {
    throw new Error('FCOS preview app-version artifact is not valid JSON.');
  }
  const commit = String(artifact?.commit || '').toLowerCase();
  if (!FULL_GIT_SHA.test(commit) || commit !== environment.releaseSha) {
    throw new Error(`FCOS preview app-version commit (${commit || 'missing'}) does not match the expected release SHA (${environment.releaseSha}).`);
  }
  return { artifactUrl, commit };
}

export async function verifyReleaseBrowserPreview(environment, request) {
  // Context-bound request cookies are retained in the auth storage state. Never
  // install global headers: FCOS also requests Supabase and other origins.
  return verifyReleasePreviewArtifact(environment, {
    fetchImpl: async (url, options) => {
      const response = await request.get(url, {
        headers: {
          ...options.headers,
          ...(environment.protectionBypass ? { 'x-vercel-set-bypass-cookie': 'true' } : {}),
        },
        maxRedirects: 0,
        timeout: 10_000,
      });
      return { ok: response.ok(), url: response.url(), json: () => response.json() };
    },
  });
}
