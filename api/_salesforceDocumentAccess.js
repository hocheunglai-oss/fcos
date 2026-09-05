const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const key = (value) => String(value || '').slice(0, 15);

function denied(message = 'This document is not available for the selected STEM.', status = 403) {
  return Object.assign(new Error(message), { status, expose: true, code: 'SALESFORCE_DOCUMENT_ACCESS' });
}

export function stemDocumentDownloadUrl({ kind = 'contentVersion', id, fileName, stemId }) {
  if (!ID.test(String(id || '')) || !ID.test(String(stemId || ''))) return null;
  if (!['attachment', 'contentVersion'].includes(kind)) return null;
  return `/api/functions/salesforceDocumentDownload?${new URLSearchParams({ kind, id, stemId, filename: fileName || 'salesforce-document' })}`;
}

export function scopeCollectionDocumentMetadata(metadata, stemId) {
  if (!metadata || typeof metadata !== 'object') return {};
  const document = metadata.document;
  if (!document || typeof document !== 'object') return metadata;
  const downloadUrl = stemDocumentDownloadUrl({ id: document.versionId, fileName: document.fileName, stemId });
  // Do not trust or replay a stored arbitrary URL when rebuilding the known advice document.
  return { ...metadata, document: { ...document, downloadUrl } };
}

/** The caller must pass the context returned by requireHandlerAccess, never request data. */
export async function downloadAuthorizedSalesforceDocument(
  { kind, id, stemId, accessContext, interoffice },
  { loadGraph, query, download },
) {
  if (!accessContext) throw denied('Authentication is required.', 401);
  if (!['attachment', 'contentVersion'].includes(kind) || !ID.test(String(id || ''))) {
    throw denied('A valid document kind and id are required.', 400);
  }
  // Preserve unscoped legacy links for existing unrestricted roles only. Interoffice
  // must prove the actual document relationship, not just supply an allowed STEM.
  if (interoffice && !stemId) throw denied('Open this document from its STEM to verify access.');
  if (stemId) {
    if (!ID.test(String(stemId))) throw denied('A valid STEM id is required.', 400);
    const { relatedRecords } = await loadGraph(stemId, accessContext);
    const relatedIds = [...new Set((relatedRecords || []).map((row) => row.id).filter((value) => ID.test(value)))];
    const allowed = new Set(relatedIds.map(key));
    if (!allowed.has(key(stemId))) throw denied();
    if (kind === 'attachment') {
      const records = await query(`SELECT Id, ParentId FROM Attachment WHERE Id = '${id}' LIMIT 1`);
      const row = records[0];
      if (key(row?.Id) !== key(id) || !allowed.has(key(row?.ParentId))) throw denied();
    } else {
      const records = await query(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${id}' LIMIT 1`);
      const row = records[0];
      if (key(row?.Id) !== key(id) || !ID.test(String(row?.ContentDocumentId || ''))) throw denied();
      let linked = false;
      for (let start = 0; start < relatedIds.length && !linked; start += 150) {
        const inList = relatedIds.slice(start, start + 150).map((value) => `'${value}'`).join(',');
        const links = await query(`SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE ContentDocumentId = '${row.ContentDocumentId}' AND LinkedEntityId IN (${inList}) LIMIT 1`);
        linked = links.some((link) => key(link.ContentDocumentId) === key(row.ContentDocumentId) && allowed.has(key(link.LinkedEntityId)));
      }
      if (!linked) throw denied();
    }
  }
  const path = kind === 'attachment' ? `/sobjects/Attachment/${id}/Body` : `/sobjects/ContentVersion/${id}/VersionData`;
  return download(path);
}
