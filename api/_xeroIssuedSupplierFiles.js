import { createHash } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { sfDownload, sfQuery } from './_salesforce.js';
import { APPROVED_ISSUED_SUPPLIER_REVIEW_HASHES } from '../config/xeroIssuedSupplierReviews.js';
import { issuedSupplierHash } from './_xeroIssuedSupplierPreservation.js';

const SF = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const failure = (message) => Object.assign(new Error(message), { code: 'XERO_ISSUED_EVIDENCE_INVALID', status: 409 });
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.slice(0, 15) === right.slice(0, 15);

export function validateIssuedSupplierPacket(packet) {
  if (!packet || !Array.isArray(packet.records) || !packet.records.length || packet.records.length > 25
    || Buffer.byteLength(JSON.stringify(packet)) > 200000) throw failure('Select a bounded issued-evidence packet containing 1–25 records.');
  const rows = packet.records;
  const fields = ['sourceId', 'xeroDocumentId', 'documentId', 'versionId', 'sha256', 'review'];
  const reviewFields = ['reviewer', 'reviewedAt', 'reviewRecordHash', 'sourceNumber', 'printedNumber', 'sellerName', 'buyerName', 'invoiceDate', 'dueDate', 'currency', 'total', 'totalTax', 'vessel', 'lines'];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !fields.includes(key))
      || ![row.sourceId, row.documentId, row.versionId].every((id) => typeof id === 'string' && SF.test(id))
      || !row.documentId.startsWith('069') || !row.versionId.startsWith('068')
      || typeof row.xeroDocumentId !== 'string' || !UUID.test(row.xeroDocumentId) || !/^[a-f0-9]{64}$/.test(row.sha256 || '')
      || !row.review || typeof row.review !== 'object' || Array.isArray(row.review)
      || Object.keys(row.review).some((key) => !reviewFields.includes(key)) || !Array.isArray(row.review.lines)
      || row.review.lines.some((line) => !line || typeof line !== 'object' || Array.isArray(line) || Object.keys(line).some((key) => !['description', 'amount'].includes(key)))) throw failure('Each issued-evidence row requires exact source, file, Xero and reviewed content identities.');
  }
  if (new Set(rows.map((r) => r.sourceId.slice(0, 15))).size !== rows.length
    || new Set(rows.map((r) => r.xeroDocumentId.toLowerCase())).size !== rows.length) throw failure('The evidence packet contains repeated source or Xero identities.');
  // This is a review assertion, never a browser-supplied verification result.
  return rows.map(({ sourceId, xeroDocumentId, documentId, versionId, sha256, review }) => ({ sourceId, xeroDocumentId, documentId, versionId, sha256, review }));
}

export async function collectIssuedSupplierFiles(packet, { query = sfQuery, download = sfDownload,
  approvedReviewHashes = APPROVED_ISSUED_SUPPLIER_REVIEW_HASHES } = {}) {
  const records = validateIssuedSupplierPacket(packet);
  if (records.some((row) => !approvedReviewHashes.includes(issuedSupplierHash(row)))) throw failure('This packet differs from the independently approved documentary review. New or amended paper facts require a separate verified review.');
  const complete = async (soql, limit = 100000) => {
    const result = await query(soql, { clean: true, limit });
    if (result?.error || result?.done === false || !Array.isArray(result?.records)
      || !Number.isSafeInteger(result.totalSize) || result.totalSize !== result.records.length) throw failure('Salesforce issued-evidence retrieval was incomplete.');
    return result.records;
  };
  const production = fcosSalesforceEnvironment('production');
  const orgs = await complete('SELECT Id, IsSandbox FROM Organization', 2);
  if (orgs.length !== 1 || !same(orgs[0].Id, production.orgId) || orgs[0].IsSandbox !== false) throw failure('Issued-evidence verification requires the pinned Salesforce Production organisation.');
  const quote = (ids) => ids.map((id) => `'${id}'`).join(',');
  const links = await complete(`SELECT Id, LinkedEntityId, ContentDocumentId, ContentDocument.LatestPublishedVersionId FROM ContentDocumentLink WHERE LinkedEntityId IN (${quote(records.map((r) => r.sourceId))})`, 2000);
  const versions = await complete(`SELECT Id, ContentDocumentId, IsLatest, Checksum, ContentSize, FileType, FileExtension FROM ContentVersion WHERE Id IN (${quote(records.map((r) => r.versionId))})`, 25);
  const result = new Map();
  // Bounded sequential reads keep memory and Salesforce concurrency predictable.
  for (const row of records) {
    const direct = links.filter((link) => same(link.LinkedEntityId, row.sourceId) && same(link.ContentDocumentId, row.documentId));
    const current = versions.filter((version) => same(version.Id, row.versionId));
    if (links.filter((link) => same(link.LinkedEntityId, row.sourceId)).length !== 1
      || direct.length !== 1 || current.length !== 1 || !same(direct[0].ContentDocument?.LatestPublishedVersionId, row.versionId)
      || !same(current[0].ContentDocumentId, row.documentId) || current[0].IsLatest !== true
      || current[0].FileType !== 'PDF' || String(current[0].FileExtension).toLowerCase() !== 'pdf'
      || !/^[a-f0-9]{32}$/i.test(current[0].Checksum || '')
      || !Number.isSafeInteger(current[0].ContentSize) || current[0].ContentSize < 5 || current[0].ContentSize > 5000000) throw failure(`${row.review.sourceNumber || row.sourceId}: the current direct PDF link or latest version differs from the reviewed evidence.`);
    const file = await download(`/sobjects/ContentVersion/${row.versionId}/VersionData`);
    const bytes = file.buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length !== current[0].ContentSize || bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
      || !['application/pdf', 'application/octet-stream'].includes(String(file.contentType).split(';')[0].trim().toLowerCase())
      || digest(bytes, 'sha256') !== row.sha256 || digest(bytes, 'md5') !== current[0].Checksum.toLowerCase()) throw failure(`${row.review.sourceNumber || row.sourceId}: the current issued PDF bytes differ from the reviewed file.`);
    result.set(row.sourceId, { orgId: production.orgId, parentId: row.sourceId, documentId: row.documentId,
      versionId: row.versionId, sha256: row.sha256, checksum: current[0].Checksum.toLowerCase(), contentSize: bytes.length,
      contentType: 'application/pdf', link: { id: direct[0].Id, parentId: direct[0].LinkedEntityId, documentId: direct[0].ContentDocumentId },
      version: { id: current[0].Id, documentId: current[0].ContentDocumentId, isLatest: true,
        latestPublishedVersionId: direct[0].ContentDocument.LatestPublishedVersionId, checksum: current[0].Checksum.toLowerCase(), contentSize: bytes.length }, review: row.review });
  }
  return result;
}

export async function collectIssuedSupplierVessels(cutoff, { query = sfQuery } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '')) throw failure('A complete accounting-date scope is required.');
  const result = await query(`SELECT Id, STEM__c, STEM__r.Vessel__r.Name FROM Supplier_Invoice__c WHERE Invoice_Date__c >= ${cutoff} ORDER BY Id`, { clean: true, limit: 100000 });
  if (result?.error || result?.done === false || !Array.isArray(result?.records) || result.totalSize !== result.records.length
    || new Set(result.records.map((r) => r.Id)).size !== result.records.length) throw failure('Complete current supplier vessel evidence is unavailable.');
  return new Map(result.records.map((row) => [row.Id, { stemId: row.STEM__c, vessel: row.STEM__r?.Vessel__r?.Name || null }]));
}
