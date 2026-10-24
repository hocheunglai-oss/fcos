import { createHash } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { issuedSupplierSfId as sf, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';

// Mechanical server-owned complete reads shared by fixed policy collectors.
// Callers own authorization/scope; these helpers grant no financial authority.
const AGGREGATE_COLLECTOR_LIMITS = Object.freeze({ controlRows: 10000, fileBytes: 5000000, totalFileBytes: 100000000 });
const uid = value => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value || '') ? value.toLowerCase() : null;
const unique = values => [...new Set(values)].sort();
const quote = ids => ids.map(id => `'${id}'`).join(',');
const same = (a, b) => Boolean(sf(a) && sf(a) === sf(b));
const fail = message => Object.assign(new Error(message), { code: 'XERO_AGGREGATE_COLLECTION_INCOMPLETE', status: 409 });
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');

export async function readSupplierControlRows(client, table, configure, matches, evidence) {
  const rows = []; const seen = new Set();
  for (let offset = 0; offset <= AGGREGATE_COLLECTOR_LIMITS.controlRows; offset += 500) {
    const response = await configure(client.from(table).select('*')).order('id').range(offset, offset + 499);
    if (response?.error || !Array.isArray(response?.data) || response.data.length > 500) throw fail(`Complete ${table} evidence is unavailable.`);
    for (const row of response.data) {
      if (!uid(row?.id) || seen.has(uid(row.id)) || !matches(row)) throw fail(`Duplicate or out-of-scope ${table} evidence.`);
      seen.add(uid(row.id)); rows.push(row);
    }
    if (rows.length > AGGREGATE_COLLECTOR_LIMITS.controlRows) throw fail(`The ${table} scope exceeds its complete bound.`);
    if (response.data.length < 500) { evidence.push({ table, count: rows.length, fingerprint: hash(rows) }); return rows; }
  }
  throw fail(`The ${table} scope has no terminal page.`);
}
export async function collectSupplierNativeFiles(records, read, download) {
  const links = await read(`SELECT Id, LinkedEntityId, ContentDocumentId, ContentDocument.LatestPublishedVersionId FROM ContentDocumentLink WHERE LinkedEntityId IN (${quote(records.map(row => row.sourceId))})`, 501, false);
  const ids = unique(records.flatMap(row => row.attachments.map(entry => entry.versionId)));
  const versions = await read(`SELECT Id, ContentDocumentId, IsLatest, Checksum, ContentSize, FileType, FileExtension FROM ContentVersion WHERE Id IN (${quote(ids)})`, 501, false);
  if (links.some(row => !records.some(record => same(record.sourceId, row.LinkedEntityId)))
    || versions.some(row => !ids.some(id => same(id, row.Id)))) throw fail('Native file metadata returned foreign identities.');
  const result = new Map(); let totalBytes = 0;
  for (const record of records) {
    const direct = links.filter(row => same(row.LinkedEntityId, record.sourceId));
    if (direct.length !== record.attachments.length) throw fail('The complete direct attachment inventory changed.');
    let selected; const currentFiles = [];
    for (const entry of record.attachments) {
      const link = direct.filter(row => same(row.Id, entry.linkId) && same(row.ContentDocumentId, entry.documentId));
      const version = versions.filter(row => same(row.Id, entry.versionId));
      if (link.length !== 1 || version.length !== 1 || !same(link[0].ContentDocument?.LatestPublishedVersionId, entry.versionId)
        || !same(version[0].ContentDocumentId, entry.documentId) || version[0].IsLatest !== true
        || version[0].FileType !== 'PDF' || String(version[0].FileExtension).toLowerCase() !== 'pdf'
        || String(version[0].Checksum).toLowerCase() !== entry.checksum || version[0].ContentSize !== entry.contentSize) throw fail('A latest native version or checksum changed.');
      totalBytes += entry.contentSize;
      if (totalBytes > AGGREGATE_COLLECTOR_LIMITS.totalFileBytes) throw fail('The native byte scope exceeds its complete bound.');
      const file = await download(`/sobjects/ContentVersion/${entry.versionId}/VersionData`);
      if (!Buffer.isBuffer(file?.buffer) || file.buffer.length !== entry.contentSize || file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
        || !['application/pdf', 'application/octet-stream', 'application/octetstream'].includes(String(file.contentType).split(';')[0].trim().toLowerCase())
        || digest(file.buffer, 'sha256') !== entry.sha256 || digest(file.buffer, 'md5') !== entry.checksum) throw fail('Native attachment bytes differ from their approved documentary record.');
      currentFiles.push({ parentId: record.sourceId, linkId: entry.linkId, latestPublishedVersionId: entry.versionId,
        isLatest: true, nativeBytesVerified: true, entryHash: hash(entry) });
      if (entry.role === 'issued_invoice') selected = { orgId: fcosSalesforceEnvironment('production').orgId, parentId: record.sourceId,
        documentId: record.documentId, versionId: record.versionId, sha256: record.sha256, checksum: entry.checksum,
        contentSize: entry.contentSize, contentType: 'application/pdf', link: { id: link[0].Id, parentId: link[0].LinkedEntityId, documentId: link[0].ContentDocumentId },
        version: { id: version[0].Id, documentId: version[0].ContentDocumentId, isLatest: true, latestPublishedVersionId: link[0].ContentDocument.LatestPublishedVersionId,
          checksum: entry.checksum, contentSize: entry.contentSize }, review: record.review,
        attachmentManifest: { complete: true, selectedDocumentId: record.documentId, selectedVersionId: record.versionId, entries: record.attachments } };
    }
    result.set(sf(record.sourceId), { fileEvidence: selected, currentFiles });
  }
  return result;
}

export function createSupplierSalesforceReader({ query, queryAll, evidence }) {
  return async (soql, limit, all = true) => {
    const response = await (all ? queryAll : query)(soql, { clean: true, limit }); const rows = response?.records;
    if (response?.error || response?.done === false || response?.nextRecordsUrl || !Array.isArray(rows) || !Number.isSafeInteger(response.totalSize)
      || response.totalSize !== rows.length || rows.length > limit || rows.some(row => !sf(row?.Id))
      || unique(rows.map(row => sf(row.Id))).length !== rows.length) throw fail('The complete raw Salesforce scope is unavailable or duplicated.');
    evidence.push({ soql, queryAll: all, count: rows.length, fingerprint: hash(rows) }); return rows;
  };
}
