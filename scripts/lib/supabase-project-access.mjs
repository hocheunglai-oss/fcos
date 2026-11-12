import { FCOS_CONNECTION_POLICY } from '../../config/fcosConnections.js';

export function shouldProbeScopedSupabaseProject(result, accessToken) {
  if (result.ok || result.unavailable || result.status !== 1 || !accessToken?.startsWith('sbp_fc')) return false;
  const detail = `${result.stdout || ''} ${result.stderr || ''}`;
  return /\bpermission\b|\bforbidden\b|\b403\b/i.test(detail)
    && !/\b401\b|\b429\b|unauthorized|rate limit/i.test(detail);
}

async function boundedProjectBody(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) {
        void reader.cancel().catch(() => {});
        const error = new Error('Project response exceeds 65536 bytes.');
        error.code = 'PROJECT_RESPONSE_TOO_LARGE';
        throw error;
      }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

// The CLI's account-wide `projects list` requires a broader token permission
// than checking the one project this repository is authorized to use.
export async function probeSupabaseProjectAccess({ accessToken, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const provider = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'supabase');
  const pin = (label) => provider.identifiers.find((entry) => entry.label === label)?.value;
  const projectRef = pin('Project ref');
  const projectName = pin('Project name');
  const empty = { identityStatus: 'authentication_blocked', identityVerified: false, httpStatus: null };
  if (typeof accessToken !== 'string' || !accessToken.trim()) return { ...empty, errorCode: 'CREDENTIAL_UNAVAILABLE' };
  const credential = accessToken.trim();
  const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}`;
  try {
    const response = await fetchImpl(url, {
      method: 'GET', headers: { Authorization: `Bearer ${credential}` },
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await boundedProjectBody(response);
    if (!response.ok) {
      return {
        ...empty, identityStatus: response.status === 401 ? 'authentication_blocked' : 'error',
        httpStatus: response.status, errorCode: `HTTP_${response.status}`,
      };
    }
    let project;
    try { project = JSON.parse(text); }
    catch { return { ...empty, identityStatus: 'error', httpStatus: response.status, errorCode: 'INVALID_PROJECT_RESPONSE' }; }
    const idMatches = project?.id === projectRef || project?.ref === projectRef;
    const idsAgree = (!project?.id || project.id === projectRef) && (!project?.ref || project.ref === projectRef);
    const verified = idMatches && idsAgree && project?.name === projectName;
    return {
      identityStatus: verified ? 'verified' : 'mismatch', identityVerified: verified,
      httpStatus: response.status, projectRef: verified ? projectRef : null,
      projectName: verified ? projectName : null,
      organizationId: verified && typeof project.organization_id === 'string' ? project.organization_id : null,
      ...(verified ? {} : { errorCode: 'PROJECT_IDENTITY_MISMATCH' }),
    };
  } catch (error) {
    return {
      ...empty, identityStatus: 'error',
      errorCode: error?.code === 'PROJECT_RESPONSE_TOO_LARGE' ? error.code : 'PROJECT_REQUEST_FAILED',
    };
  }
}
