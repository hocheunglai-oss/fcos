import { issuedSupplierSfId as sf } from './_xeroIssuedSupplierPreservation.js';

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const hash = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const roles = new Set(['issued_invoice', 'duplicate_selected_invoice', 'delivery_receipt', 'order_confirmation', 'terms']);
const entryKeys = ['linkId', 'documentId', 'versionId', 'sha256', 'checksum', 'contentSize', 'fileType', 'fileExtension', 'role', 'reviewRecordHash'];
const same = (left, right) => Boolean(sf(left) && sf(left) === sf(right));

// These are explicit notations for metric tonnes, not a general unit converter.
// Callers retain the original literal in the immutable documentary review.
export const issuedPetroleumPaperUnit = (value) => typeof value === 'string'
  && ['MT', 'MTS', 'METRIC TON', 'METRIC TONS', 'METRIC TONNE', 'METRIC TONNES'].includes(value) ? 'MT' : null;

// The trusted collector establishes current completeness and content-reviewed
// roles. This pure boundary independently binds the entire bounded manifest to
// the selected native invoice; a selected filename or client flag is insufficient.
export function validateIssuedPetroleumAttachmentManifest(manifest, file) {
  if (!exactKeys(manifest, ['complete', 'selectedDocumentId', 'selectedVersionId', 'entries'])
    || manifest.complete !== true || !plain(file) || !same(manifest.selectedDocumentId, file.documentId)
    || !same(manifest.selectedVersionId, file.versionId) || !Array.isArray(manifest.entries)
    || manifest.entries.length < 1 || manifest.entries.length > 20) return false;
  const links = new Set(); const documents = new Set(); const versions = new Set();
  let previous = ''; let selected = 0;
  for (const entry of manifest.entries) {
    if (!exactKeys(entry, entryKeys)) return false;
    const linkId = sf(entry.linkId); const documentId = sf(entry.documentId); const versionId = sf(entry.versionId);
    if (!linkId?.startsWith('06A') || !documentId?.startsWith('069') || !versionId?.startsWith('068')
      || linkId <= previous || links.has(linkId) || documents.has(documentId) || versions.has(versionId)
      || !hash(entry.sha256, 64) || !hash(entry.checksum, 32) || !hash(entry.reviewRecordHash, 64)
      || !Number.isSafeInteger(entry.contentSize) || entry.contentSize < 5 || entry.contentSize > 5_000_000
      || entry.fileType !== 'PDF' || entry.fileExtension !== 'pdf' || !roles.has(entry.role)) return false;
    previous = linkId; links.add(linkId); documents.add(documentId); versions.add(versionId);
    if (entry.role === 'issued_invoice') {
      selected++;
      if (!same(entry.linkId, file.link?.id) || !same(entry.documentId, file.documentId) || !same(entry.versionId, file.versionId)
        || entry.sha256 !== file.sha256 || entry.checksum !== file.checksum || entry.contentSize !== file.contentSize
        || entry.reviewRecordHash !== file.review?.reviewRecordHash) return false;
    } else if (same(entry.documentId, file.documentId) || same(entry.versionId, file.versionId)) return false;
    if (entry.role === 'duplicate_selected_invoice'
      && (entry.sha256 !== file.sha256 || entry.checksum !== file.checksum || entry.contentSize !== file.contentSize)) return false;
  }
  return selected === 1;
}
