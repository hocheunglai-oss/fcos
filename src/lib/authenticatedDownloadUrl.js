const SALESFORCE_DOCUMENT_DOWNLOAD_PATH = '/api/functions/salesforceDocumentDownload';

function browserOrigin() {
  return typeof window === 'undefined' ? null : window.location?.origin || null;
}

function resolveOrigin(origin) {
  try {
    return new URL(origin || browserOrigin()).origin;
  } catch {
    return null;
  }
}

export function isSalesforceDocumentDownloadUrl(url, { origin } = {}) {
  const expectedOrigin = resolveOrigin(origin);
  if (!url || !expectedOrigin) return false;

  try {
    const parsed = new URL(url, expectedOrigin);
    return parsed.origin === expectedOrigin && parsed.pathname === SALESFORCE_DOCUMENT_DOWNLOAD_PATH;
  } catch {
    return false;
  }
}

export function salesforceDocumentDownloadUrl(url, stemId, { origin } = {}) {
  const expectedOrigin = resolveOrigin(origin);
  if (!expectedOrigin || !stemId || !isSalesforceDocumentDownloadUrl(url, { origin: expectedOrigin })) {
    throw new Error('This document download link is not valid.');
  }

  const parsed = new URL(url, expectedOrigin);
  // Remove retired full-session transports if a stale response still includes either spelling.
  // Do not remove other endpoint-specific query parameters.
  parsed.searchParams.delete('access_token');
  parsed.searchParams.delete('token');
  parsed.searchParams.set('stemId', stemId);
  parsed.hash = '';
  return parsed.toString();
}

export function documentPreviewKind(document) {
  const extension = String(document?.fileExtension || document?.fileName || '').split('.').pop()?.toLowerCase();
  const contentType = String(document?.contentType || document?.fileType || '').toLowerCase().split(';', 1)[0].trim();
  if (extension === 'pdf' || contentType === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)
    || ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(contentType)) return 'image';
  return null;
}

export function isSafeDocumentPreviewContentType(contentType, kind) {
  const normalized = String(contentType || '').toLowerCase().split(';', 1)[0].trim();
  if (kind === 'pdf') return normalized === 'application/pdf';
  if (kind === 'image') return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(normalized);
  return false;
}

export async function getDownloadAccessToken() {
  const { isSupabaseConfigured, supabase } = await import('@/lib/supabaseClient');
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export async function fetchAuthenticatedDocument(url, {
  stemId,
  signal,
  fetchImpl = globalThis.fetch,
  getAccessToken = getDownloadAccessToken,
  origin,
} = {}) {
  const targetUrl = salesforceDocumentDownloadUrl(url, stemId, { origin });
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Your session has expired. Please sign in again to download this document.');
  if (typeof fetchImpl !== 'function') throw new Error('Document download is unavailable in this browser.');

  let response;
  try {
    response = await fetchImpl(targetUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'same-origin',
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('Unable to download this document securely.');
  }

  const expectedOrigin = resolveOrigin(origin);
  if (response?.redirected || (response?.url && !isSalesforceDocumentDownloadUrl(response.url, { origin: expectedOrigin }))) {
    throw new Error('The document download was redirected and was blocked for your security.');
  }
  if (!response?.ok) throw new Error(`Document download failed${response?.status ? ` (${response.status})` : ''}.`);

  const contentType = response.headers?.get?.('content-type') || '';
  return { blob: await response.blob(), contentType, url: targetUrl };
}

export function downloadBlob(blob, filename = 'salesforce-document') {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
