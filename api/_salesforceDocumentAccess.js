const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const idKey = (id) => String(id || '').slice(0, 15);
const denied = () => Object.assign(new Error('This document is not available for the selected STEM.'), {
  status: 403, code: 'SALESFORCE_DOCUMENT_FORBIDDEN',
});

/** Scope must come from the server's authorized live STEM relationships, never the request. */
export async function authorizeSalesforceDocument({ kind, id, stemId }, { loadScope, queryRows }) {
  if (!SF_ID.test(id || '') || !['attachment', 'contentVersion'].includes(kind) || !SF_ID.test(stemId || '')) {
    throw Object.assign(new Error('A valid document, kind and STEM are required. Reopen the document from its STEM.'), {
      status: 400, code: 'SALESFORCE_DOCUMENT_INVALID',
    });
  }
  const scope = await loadScope(stemId);
  const relatedIds = [...new Set(scope.relatedRecords.map((record) => record.id).filter((id) => SF_ID.test(id || '')))];
  const allowed = new Set(relatedIds.map(idKey));
  if (!allowed.size) throw denied();
  if (kind === 'attachment') {
    const rows = await queryRows(`SELECT Id, ParentId FROM Attachment WHERE Id = '${id}' LIMIT 1`);
    if (!rows[0] || (rows[0].Id && idKey(rows[0].Id) !== idKey(id)) || !allowed.has(idKey(rows[0].ParentId))) throw denied();
  } else {
    const versions = await queryRows(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${id}' LIMIT 1`);
    if (versions[0]?.Id && idKey(versions[0].Id) !== idKey(id)) throw denied();
    const documentId = versions[0]?.ContentDocumentId;
    if (!SF_ID.test(documentId || '')) throw denied();
    let hasAllowedLink = false;
    // Filter at Salesforce, not after an arbitrary page of this file's links.
    // Broadly shared files must still work when the authorized link is late.
    for (let offset = 0; offset < relatedIds.length; offset += 150) {
      const ids = relatedIds.slice(offset, offset + 150).map((id) => `'${id}'`).join(',');
      const links = await queryRows(`SELECT LinkedEntityId FROM ContentDocumentLink WHERE ContentDocumentId = '${documentId}' AND LinkedEntityId IN (${ids}) LIMIT 1`);
      if (links.some((link) => allowed.has(idKey(link.LinkedEntityId)))) {
        hasAllowedLink = true;
        break;
      }
    }
    if (!hasAllowedLink) throw denied();
  }
  return kind === 'attachment'
    ? `/sobjects/Attachment/${id}/Body`
    : `/sobjects/ContentVersion/${id}/VersionData`;
}

/** Reusable session credentials must only be accepted through Authorization. */
export function headerBearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  return String(header).match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

export function stemDocumentDownloadUrl({ kind = 'contentVersion', id, fileName, stemId }) {
  if (!SF_ID.test(String(id || '')) || !SF_ID.test(String(stemId || ''))) return null;
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


/** Compatibility adapter retains the strict shared authorization boundary. */
export async function downloadAuthorizedSalesforceDocument({ kind, id, stemId, accessContext }, { loadGraph, query, download }) {
  if (!accessContext) throw Object.assign(new Error('Authentication is required.'), { status: 401 });
  const path = await authorizeSalesforceDocument({ kind, id, stemId }, {
    loadScope: (scopeId) => loadGraph(scopeId, accessContext),
    queryRows: query,
  });
  return download(path);
}
