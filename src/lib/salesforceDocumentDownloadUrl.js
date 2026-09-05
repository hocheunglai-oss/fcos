const SALESFORCE_DOCUMENT_DOWNLOAD_PATH = '/api/functions/salesforceDocumentDownload';

// Authentication tokens may only be appended to FCOS's document-download route.
// Stored collection metadata is historical input and must not choose a token host.
export function trustedSalesforceDocumentDownloadUrl(url, origin = globalThis.location?.origin) {
  if (!url || !origin) return '';
  try {
    const trustedOrigin = new URL(origin).origin;
    const parsed = new URL(url, trustedOrigin);
    if (parsed.origin !== trustedOrigin || parsed.pathname !== SALESFORCE_DOCUMENT_DOWNLOAD_PATH) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
}
