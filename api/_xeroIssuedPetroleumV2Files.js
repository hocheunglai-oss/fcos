import { createHash } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { ISSUED_PETROLEUM_POLICY, ISSUED_PETROLEUM_V2_POLICY } from '../config/xeroIssuedPreservationPolicies.js';
import { APPROVED_ISSUED_PETROLEUM_V2_REVIEW_HASHES } from '../config/xeroIssuedPetroleumV2Reviews.js';
import { sfDownload, sfQuery } from './_salesforce.js';
import { issuedSupplierHash, issuedSupplierSfId } from './_xeroIssuedSupplierPreservation.js';
import { validateIssuedPetroleumPacket } from './_xeroIssuedPetroleumFiles.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const ROLES = new Set(['issued_invoice', 'duplicate_selected_invoice', 'delivery_receipt', 'order_confirmation', 'terms']);
const ENTRY_FIELDS = ['linkId', 'documentId', 'versionId', 'sha256', 'checksum', 'contentSize', 'fileType', 'fileExtension', 'role', 'reviewRecordHash'];
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const failure = (message) => Object.assign(new Error(message), { code: 'XERO_ISSUED_PETROLEUM_EVIDENCE_INVALID', status: 409 });
const same = (a, b) => Boolean(issuedSupplierSfId(a) && issuedSupplierSfId(a) === issuedSupplierSfId(b));
export const issuedPetroleumV2ReviewHash = (record) => issuedSupplierHash({ policyVersion: ISSUED_PETROLEUM_V2_POLICY, record });

export function validateIssuedPetroleumV2Packet(packet) {
  let serialized;
  try { serialized = JSON.stringify(packet); } catch { throw failure('Select a bounded JSON documentary packet.'); }
  if (!packet || packet.policyVersion !== ISSUED_PETROLEUM_V2_POLICY
    || Object.keys(packet).some(key => !['policyVersion', 'records'].includes(key))
    || !Array.isArray(packet.records) || !packet.records.length || packet.records.length > 25
    || packet.records.some(row => !row || typeof row !== 'object' || Array.isArray(row))
    || typeof serialized !== 'string' || Buffer.byteLength(serialized) > 200000) throw failure('Select a bounded reviewed petroleum packet containing 1–25 records.');
  // Reuse structural validation only. The unchanged literal paper facts are
  // evaluated exclusively by the v2 financial policy, never disguised as v1.
  const records = validateIssuedPetroleumPacket({ policyVersion: ISSUED_PETROLEUM_POLICY,
    records: packet.records.map(({ attachments: _attachments, ...record }) => record) });
  return records.map((record, index) => {
    const entries = packet.records[index].attachments;
    if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw failure('Every current direct attachment requires a reviewed content role.');
    let previous = '';
    for (const entry of entries) {
      const linkId = issuedSupplierSfId(entry?.linkId);
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).length !== ENTRY_FIELDS.length || Object.keys(entry).some(key => !ENTRY_FIELDS.includes(key))
        || !linkId?.startsWith('06A') || linkId <= previous
        || !issuedSupplierSfId(entry.documentId)?.startsWith('069') || !issuedSupplierSfId(entry.versionId)?.startsWith('068')
        || !HASH.test(entry.sha256 || '') || !HASH.test(entry.reviewRecordHash || '') || !/^[a-f0-9]{32}$/.test(entry.checksum || '')
        || !Number.isSafeInteger(entry.contentSize) || entry.contentSize < 5 || entry.contentSize > 5000000
        || entry.fileType !== 'PDF' || entry.fileExtension !== 'pdf' || !ROLES.has(entry.role)) throw failure('The complete reviewed attachment manifest is invalid.');
      previous = linkId;
    }
    if (new Set(entries.map(entry => issuedSupplierSfId(entry.documentId))).size !== entries.length
      || new Set(entries.map(entry => issuedSupplierSfId(entry.versionId))).size !== entries.length) throw failure('Repeated attachment identities are not supported.');
    const selected = entries.filter(entry => entry.role === 'issued_invoice');
    if (selected.length !== 1 || !same(selected[0].documentId, record.documentId) || !same(selected[0].versionId, record.versionId)
      || selected[0].sha256 !== record.sha256 || selected[0].reviewRecordHash !== record.review.reviewRecordHash
      || entries.some(entry => entry.role === 'duplicate_selected_invoice' && (entry.sha256 !== record.sha256
        || entry.checksum !== selected[0].checksum || entry.contentSize !== selected[0].contentSize))) throw failure('Exactly one issued invoice and its complete supporting attachment evidence are required.');
    return { ...record, attachments: entries.map(entry => ({ ...entry })) };
  });
}

export async function collectIssuedPetroleumV2Files(packet, { query = sfQuery, download = sfDownload,
  approvedReviewHashes = APPROVED_ISSUED_PETROLEUM_V2_REVIEW_HASHES, tenantId } = {}) {
  const records = validateIssuedPetroleumV2Packet(packet);
  if (!UUID.test(tenantId || '') || records.some(row => row.review.counterparties.tenantId !== tenantId
    || !approvedReviewHashes.includes(issuedPetroleumV2ReviewHash(row)))) throw failure('The complete attachment facts differ from the independently verified documentary review.');
  const complete = async (soql, limit) => {
    const result = await query(soql, { clean: true, limit });
    if (result?.error || result?.done === false || !Array.isArray(result?.records)
      || !Number.isSafeInteger(result.totalSize) || result.totalSize !== result.records.length || result.records.length > limit) throw failure('The current attachment inventory could not be completely verified.');
    return result.records;
  };
  const production = fcosSalesforceEnvironment('production');
  const orgs = await complete('SELECT Id, IsSandbox FROM Organization', 2);
  if (orgs.length !== 1 || !same(orgs[0].Id, production.orgId) || orgs[0].IsSandbox !== false) throw failure('The pinned Salesforce Production organisation is required.');
  const quote = ids => ids.map(id => `'${id}'`).join(',');
  const links = await complete(`SELECT Id, LinkedEntityId, ContentDocumentId, ContentDocument.LatestPublishedVersionId FROM ContentDocumentLink WHERE LinkedEntityId IN (${quote(records.map(row => row.sourceId))})`, 501);
  const expectedVersions = [...new Set(records.flatMap(row => row.attachments.map(entry => entry.versionId)))];
  const versions = await complete(`SELECT Id, ContentDocumentId, IsLatest, Checksum, ContentSize, FileType, FileExtension FROM ContentVersion WHERE Id IN (${quote(expectedVersions)})`, 501);
  const result = new Map();
  let totalBytes = 0;
  for (const row of records) {
    const parentLinks = links.filter(link => same(link.LinkedEntityId, row.sourceId));
    if (parentLinks.length !== row.attachments.length) throw failure('The complete direct attachment set changed. Review its current contents before linking.');
    let selected;
    const verified = [];
    for (const entry of row.attachments) {
      const direct = parentLinks.filter(link => same(link.Id, entry.linkId) && same(link.ContentDocumentId, entry.documentId));
      const current = versions.filter(version => same(version.Id, entry.versionId));
      if (direct.length !== 1 || current.length !== 1 || !same(direct[0].ContentDocument?.LatestPublishedVersionId, entry.versionId)
        || !same(current[0].ContentDocumentId, entry.documentId) || current[0].IsLatest !== true
        || current[0].FileType !== 'PDF' || String(current[0].FileExtension).toLowerCase() !== 'pdf'
        || String(current[0].Checksum).toLowerCase() !== entry.checksum || current[0].ContentSize !== entry.contentSize) throw failure('A current attachment identity, version or checksum differs from its reviewed contents.');
      totalBytes += entry.contentSize;
      if (totalBytes > 100000000) throw failure('Split this review into smaller batches to verify every attachment completely.');
      const file = await download(`/sobjects/ContentVersion/${entry.versionId}/VersionData`);
      const bytes = file?.buffer;
      if (!Buffer.isBuffer(bytes) || bytes.length !== entry.contentSize || bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
        || !['application/pdf', 'application/octet-stream', 'application/octetstream'].includes(String(file.contentType).split(';')[0].trim().toLowerCase())
        || digest(bytes, 'sha256') !== entry.sha256 || digest(bytes, 'md5') !== entry.checksum) throw failure('An attachment changed after its documentary review.');
      verified.push({ ...entry });
      if (entry.role === 'issued_invoice') selected = { orgId: production.orgId, parentId: row.sourceId,
        documentId: row.documentId, versionId: row.versionId, sha256: row.sha256, checksum: entry.checksum,
        contentSize: entry.contentSize, contentType: 'application/pdf',
        link: { id: direct[0].Id, parentId: direct[0].LinkedEntityId, documentId: direct[0].ContentDocumentId },
        version: { id: current[0].Id, documentId: current[0].ContentDocumentId, isLatest: true,
          latestPublishedVersionId: direct[0].ContentDocument.LatestPublishedVersionId, checksum: entry.checksum, contentSize: entry.contentSize },
        review: row.review };
    }
    result.set(row.sourceId, { ...selected, attachmentManifest: { complete: true, selectedDocumentId: row.documentId,
      selectedVersionId: row.versionId, entries: verified } });
  }
  return result;
}
