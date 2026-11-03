import { clientSessionState, isCurrentClientSession } from './clientSessionState.js';

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

// The caller owns this in-memory ref. Keep an uncertain completion bound to its
// original file, fields, financial intent, and browser session until readback.
export async function saveReceiptWithDirectUpload({ file, fields, autoSync = false, pending }, {
  invoke, fetchImpl = fetch, cryptoImpl = globalThis.crypto, now = Date.now,
} = {}) {
  const session = clientSessionState();
  const assertSession = () => {
    if (!isCurrentClientSession(session)) throw new Error('Your account changed. Refresh this view.');
  };
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_RECEIPT_BYTES) {
    throw new Error('Choose a non-empty receipt up to 10 MiB.');
  }
  const fileType = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[file.name.split('.').pop().toLowerCase()]);
  if (!TYPES.has(fileType)) throw new Error('Choose a JPEG, PNG, WebP, or PDF receipt.');
  const fingerprint = JSON.stringify({ fields, autoSync });
  if (pending.current?.session !== session) pending.current = null;
  // Before completion has started, expiry cannot hide a database write.
  if (pending.current && !pending.current.completionStarted && pending.current.expiresAt <= now()) pending.current = null;
  if (pending.current && (pending.current.file !== file || pending.current.fingerprint !== fingerprint)) {
    if (pending.current.completionStarted) {
      throw new Error('The previous save may have completed. Reload this page and inspect receipts before changing the file or details.');
    }
    pending.current = null;
  }
  if (!pending.current) {
    const digest = await cryptoImpl.subtle.digest('SHA-256', await file.arrayBuffer());
    assertSession();
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const result = await invoke('xeroPortalReceiptUploadPrepare', {
      file: { fileName: file.name, fileType, size: file.size, sha256 }, fields, autoSync,
    }, { force: true, invalidateCache: true });
    assertSession();
    if (result.data?.error) return result;
    if (!result.data?.upload?.uploadTicket || !result.data.upload.signedUrl) throw new Error('Receipt upload is unavailable.');
    pending.current = { ...result.data.upload, session, file, fileType, fingerprint, uploaded: false, completionStarted: false };
  }
  const upload = pending.current;
  if (!upload.uploaded) {
    assertSession();
    const response = await fetchImpl(upload.signedUrl, {
      method: 'PUT', body: file, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': upload.fileType, 'Cache-Control': 'max-age=0', 'x-upsert': 'false' },
    });
    assertSession();
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      // A previous upload can succeed while its response is lost. Completion
      // verifies the exact object/hash before treating this conflict as success.
      if (response.status !== 409 && !['Duplicate', 'ResourceAlreadyExists'].includes(failure.error || failure.code)) {
        throw new Error('Receipt upload failed. Retry saving the same file.');
      }
    }
    upload.uploaded = true;
  }
  assertSession();
  upload.completionStarted = true;
  const result = await invoke('xeroPortalReceiptCreate', {
    uploadTicket: upload.uploadTicket, fields: upload.fields,
  }, { force: true, invalidateCache: true });
  assertSession();
  if (result.data?.receipt) pending.current = null;
  return result;
}
