// Observational metadata only. This never supplies issued-file readiness or accounting authority.
const SF_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const REASONS = new Set(['PDF_CANDIDATES_FOUND', 'NO_PDF_CANDIDATES', 'LOOKUP_FAILED', 'LOOKUP_INCOMPLETE', 'INVALID_METADATA', 'PARENT_LIMIT', 'LINK_LIMIT', 'INVALID_SOURCE_ID', 'LOOKUP_STOPPED']);
const key = (value) => typeof value === 'string' && SF_ID.test(value) ? value.slice(0, 15) : null;
const idOf = (value, prefix) => key(value)?.startsWith(prefix) ? value : null;
const text = (value, maximum) => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const timestamp = (value) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function diagnostic(sourceId, capturedAt, status, reasonCode, candidates = []) {
  return { version: 1, sourceId, capturedAt, status, complete: status === 'complete', metadataOnly: true, authoritative: false, contentVerified: false, linkedPdfCount: candidates.length, candidates, reasonCode };
}

function candidate(row) {
  const document = row?.ContentDocument;
  if (!idOf(row?.Id, '06A') || !idOf(row?.ContentDocumentId, '069') || !idOf(document?.Id, '069') || key(document.Id) !== key(row.ContentDocumentId)
    || !idOf(document.LatestPublishedVersionId, '068') || !text(document.Title, 255)
    || !text(document.FileType, 40) || !text(document.FileExtension, 40)
    || !Number.isSafeInteger(document.ContentSize) || document.ContentSize < 0 || !timestamp(document.SystemModstamp)) return null;
  return { linkId: row.Id, documentId: row.ContentDocumentId, latestPublishedVersionId: document.LatestPublishedVersionId, title: document.Title, fileType: document.FileType, fileExtension: document.FileExtension, bytes: document.ContentSize, documentModifiedAt: document.SystemModstamp };
}

export function supplierFileDiscoveryParents(suppliers, classifications) {
  const blockedIds = new Set((classifications || []).filter((row) => row.salesforceObject === 'Supplier_Invoice__c' && (row.status === 'blocked' || row.action === 'blocked')).map((row) => row.salesforceId));
  return (suppliers || []).filter((supplier) => blockedIds.has(supplier.Id));
}

export async function discoverSupplierFileCandidates(suppliers, { querySalesforce, now = Date.now } = {}) {
  const capturedAt = new Date(now()).toISOString();
  const output = new Map();
  const parents = new Map();
  for (const supplier of suppliers || []) {
    if (String(supplier?.Invoice_File__c || '').trim() || String(supplier?.File__c || '').trim()) continue;
    const sourceId = supplier?.Id;
    const parentKey = key(sourceId);
    if (!parentKey) { if (typeof sourceId === 'string') output.set(sourceId, diagnostic(sourceId, capturedAt, 'not_checked', 'INVALID_SOURCE_ID')); continue; }
    if (!parents.has(parentKey)) parents.set(parentKey, []);
    parents.get(parentKey).push(sourceId);
  }
  const ordered = [...parents.keys()].sort();
  for (const parent of ordered.slice(500)) for (const id of parents.get(parent)) output.set(id, diagnostic(id, capturedAt, 'not_checked', 'PARENT_LIMIT'));
  // The hard SOQL limit permits at most 2000 links plus one overflow sentinel globally.
  let consumed = 0;
  let stopped = false;
  for (let offset = 0; offset < Math.min(500, ordered.length); offset += 100) {
    const batch = ordered.slice(offset, Math.min(offset + 100, 500));
    if (stopped || consumed >= 2000) {
      for (const parent of batch) for (const id of parents.get(parent)) output.set(id, diagnostic(id, capturedAt, 'not_checked', stopped ? 'LOOKUP_STOPPED' : 'LINK_LIMIT'));
      continue;
    }
    const remaining = 2000 - consumed;
    const query = `SELECT Id, LinkedEntityId, ContentDocumentId, ContentDocument.Id, ContentDocument.Title, ContentDocument.FileType, ContentDocument.FileExtension, ContentDocument.ContentSize, ContentDocument.LatestPublishedVersionId, ContentDocument.SystemModstamp FROM ContentDocumentLink WHERE LinkedEntityId IN (${batch.map((id) => `'${id}'`).join(',')}) ORDER BY LinkedEntityId, ContentDocumentId, Id LIMIT ${remaining + 1}`;
    let result;
    try { [result] = await querySalesforce([{ soql: query, clean: true, limit: remaining + 1, softFail: true }]); } catch { result = null; }
    if (!result || !Array.isArray(result.records)) {
      stopped = true;
      for (const parent of batch) for (const id of parents.get(parent)) output.set(id, diagnostic(id, capturedAt, 'unavailable', 'LOOKUP_FAILED'));
      continue;
    }
    // Later-page failures may return earlier rows alongside an error. Charge them
    // before interpreting completeness, and stop because further provider work is unknown.
    consumed += result.records.length;
    const complete = !result.error && Number.isSafeInteger(result.totalSize) && result.totalSize >= 0 && result.totalSize === result.records.length && result.records.length <= remaining;
    const records = result.records.slice(0, remaining);
    if (!complete) stopped = true;
    const byParent = new Map(batch.map((id) => [id, []]));
    const invalid = new Set();
    const seen = new Set();
    for (const row of records) {
      const parent = key(row?.LinkedEntityId);
      if (!byParent.has(parent)) { for (const id of batch) invalid.add(id); continue; }
      const parsed = candidate(row);
      const duplicate = parsed && `${parent}:${key(parsed.documentId)}`;
      if (!parsed || seen.has(duplicate)) { invalid.add(parent); continue; }
      seen.add(duplicate);
      if (parsed.fileType.toUpperCase() === 'PDF' && parsed.fileExtension.toLowerCase() === 'pdf') byParent.get(parent).push(parsed);
    }
    for (const parent of batch) {
      const candidates = byParent.get(parent).sort((a, b) => a.documentId.localeCompare(b.documentId));
      const status = !complete ? (result.error && !candidates.length ? 'unavailable' : 'partial') : invalid.has(parent) ? (candidates.length ? 'partial' : 'unavailable') : 'complete';
      const reason = !complete ? (result.error ? 'LOOKUP_FAILED' : 'LOOKUP_INCOMPLETE') : invalid.has(parent) ? 'INVALID_METADATA' : candidates.length ? 'PDF_CANDIDATES_FOUND' : 'NO_PDF_CANDIDATES';
      for (const id of parents.get(parent)) output.set(id, diagnostic(id, capturedAt, status, reason, candidates));
    }
  }
  return output;
}

// Stored previews may predate discovery. Invalid or foreign metadata is never presented as proof.
export function serializeSupplierFileDiscovery(value, sourceId) {
  if (!value || value.version !== 1 || value.sourceId !== sourceId || !timestamp(value.capturedAt)
    || !['complete', 'partial', 'unavailable', 'not_checked'].includes(value.status) || !REASONS.has(value.reasonCode)
    || !Array.isArray(value.candidates) || value.candidates.length > 2000) return null;
  const candidates = value.candidates.map((item) => candidate({ Id: item?.linkId, ContentDocumentId: item?.documentId, ContentDocument: { Id: item?.documentId, Title: item?.title, FileType: item?.fileType, FileExtension: item?.fileExtension, ContentSize: item?.bytes, LatestPublishedVersionId: item?.latestPublishedVersionId, SystemModstamp: item?.documentModifiedAt } }));
  if (candidates.some((item) => !item || item.fileType.toUpperCase() !== 'PDF' || item.fileExtension.toLowerCase() !== 'pdf')) return null;
  if (['unavailable', 'not_checked'].includes(value.status) && candidates.length) return null;
  return diagnostic(sourceId, value.capturedAt, value.status, value.reasonCode, candidates);
}
