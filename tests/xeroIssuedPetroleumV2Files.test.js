import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { ISSUED_PETROLEUM_V2_POLICY } from '../config/xeroIssuedPreservationPolicies.js';
import {
  collectIssuedPetroleumV2Files,
  issuedPetroleumV2ReviewHash,
  validateIssuedPetroleumV2Packet,
} from '../api/_xeroIssuedPetroleumV2Files.js';

const invalid = { code: 'XERO_ISSUED_PETROLEUM_EVIDENCE_INVALID', status: 409 };
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const complete = records => ({ records, totalSize: records.length, done: true });
const id = (prefix, number) => `${prefix}${String(number).padStart(12, '0')}`;
const invoiceBytes = Buffer.from('%PDF-1.7\nOriginal petroleum invoice fixture\n%%EOF');

// Real source/document/counterparty fixture; every provider operation below is
// injected and in memory. The production documentary registry is never edited.
function fixture(roles = ['issued_invoice', 'delivery_receipt', 'order_confirmation', 'terms']) {
  const f = issuedPetroleumFixture();
  f.packet.policyVersion = ISSUED_PETROLEUM_V2_POLICY;
  const record = f.packet.records[0];
  record.sha256 = digest(invoiceBytes, 'sha256');
  const binaries = new Map();
  record.attachments = roles.map((role, i) => {
    const bytes = role === 'issued_invoice' || role === 'duplicate_selected_invoice'
      ? invoiceBytes : Buffer.from(`%PDF-1.7\nReviewed support ${role} ${i}\n%%EOF`);
    const versionId = id('068', i + 1);
    binaries.set(versionId, bytes);
    return { linkId: id('06A', i + 1), documentId: id('069', i + 1), versionId,
      sha256: digest(bytes, 'sha256'), checksum: digest(bytes, 'md5'), contentSize: bytes.length,
      fileType: 'PDF', fileExtension: 'pdf', role, reviewRecordHash: record.review.reviewRecordHash };
  });
  const links = record.attachments.map(e => ({ Id: e.linkId, LinkedEntityId: record.sourceId,
    ContentDocumentId: e.documentId, ContentDocument: { LatestPublishedVersionId: e.versionId } }));
  const versions = record.attachments.map(e => ({ Id: e.versionId, ContentDocumentId: e.documentId,
    IsLatest: true, Checksum: e.checksum, ContentSize: e.contentSize, FileType: 'PDF', FileExtension: 'pdf' }));
  const calls = { queries: [], downloads: [] };
  const options = { tenantId: f.ids.tenant, approvedReviewHashes: [issuedPetroleumV2ReviewHash(record)],
    query: async (soql, queryOptions) => {
      calls.queries.push({ soql, options: queryOptions });
      return complete(soql.includes('FROM Organization') ? [{ Id: f.fileEvidence.orgId, IsSandbox: false }]
        : soql.includes('FROM ContentDocumentLink') ? links : versions);
    },
    download: async filePath => {
      calls.downloads.push(filePath);
      const versionId = filePath.split('/').at(-2);
      return { buffer: binaries.get(versionId), contentType: 'application/octet-stream; charset=binary' };
    } };
  return { ...f, record, links, versions, binaries, calls, options,
    approveFixture: () => { options.approvedReviewHashes = [issuedPetroleumV2ReviewHash(record)]; } };
}

test('v2 verifies and returns every reviewed invoice/support PDF without changing literal nullable dates', async () => {
  const f = fixture();
  f.record.review.invoiceDate = null;
  f.record.review.dueDate = null;
  f.record.review.deliveryDate = null;
  f.record.review.lines[0].unit = 'M/T';
  f.approveFixture();
  const before = structuredClone(f.packet);
  const files = await collectIssuedPetroleumV2Files(f.packet, f.options);
  const evidence = files.get(f.ids.source);
  assert.equal(files.size, 1);
  assert.deepEqual(f.packet, before);
  assert.deepEqual(evidence.review, f.record.review);
  assert.equal(evidence.review.invoiceDate, null);
  assert.equal(evidence.review.dueDate, null);
  assert.equal(evidence.review.deliveryDate, null);
  assert.equal(evidence.review.lines[0].unit, 'M/T');
  assert.deepEqual(evidence.attachmentManifest.entries, f.record.attachments);
  assert.equal(evidence.attachmentManifest.complete, true);
  assert.equal(evidence.attachmentManifest.selectedVersionId, f.ids.version);
  assert.equal(evidence.sha256, digest(invoiceBytes, 'sha256'));
  assert.equal(evidence.checksum, digest(invoiceBytes, 'md5'));
  assert.equal(evidence.buffer, undefined);
  assert.equal(f.calls.queries.length, 3);
  assert.equal(f.calls.downloads.length, 4);
  for (const entry of f.record.attachments) {
    assert.equal(f.calls.downloads.filter(p => p.includes(`/${entry.versionId}/`)).length, 1);
    assert.equal(digest(f.binaries.get(entry.versionId), 'sha256'), entry.sha256);
    assert.equal(digest(f.binaries.get(entry.versionId), 'md5'), entry.checksum);
  }
});

for (const count of [1, 20]) test(`v2 supports the complete ${count}-file bounded manifest`, async () => {
  const f = fixture(['issued_invoice', ...Array(count - 1).fill('terms')]);
  const evidence = (await collectIssuedPetroleumV2Files(f.packet, f.options)).get(f.ids.source);
  assert.equal(evidence.attachmentManifest.entries.length, count);
  assert.equal(f.calls.downloads.length, count);
});

test('an independently reviewed exact duplicate invoice is separately downloaded and verified', async () => {
  const f = fixture(['issued_invoice', 'duplicate_selected_invoice', 'delivery_receipt']);
  const result = await collectIssuedPetroleumV2Files(f.packet, f.options);
  assert.equal(result.get(f.ids.source).attachmentManifest.entries.length, 3);
  assert.equal(f.calls.downloads.length, 3);
  assert.notEqual(f.record.attachments[0].documentId, f.record.attachments[1].documentId);
  assert.equal(f.record.attachments[0].sha256, f.record.attachments[1].sha256);
});

for (const [name, change] of [
  ['unregistered packet', f => { delete f.options.approvedReviewHashes; }],
  ['changed nullable date', f => { f.record.review.invoiceDate = null; }],
  ['changed unit literal', f => { f.record.review.lines[0].unit = 'MTS'; }],
  ['changed seller', f => { f.record.review.counterparties.printedSeller = 'OTHER LEGAL PARTY'; }],
  ['changed role', f => { f.record.attachments[1].role = 'terms'; }],
  ['changed support review binding', f => { f.record.attachments[1].reviewRecordHash = 'a'.repeat(64); }],
  ['changed support digest', f => { f.record.attachments[1].sha256 = 'a'.repeat(64); }],
  ['wrong request tenant', f => { f.options.tenantId = f.ids.contact; }],
  ['wrong reviewed tenant', f => { f.record.review.counterparties.tenantId = f.ids.contact; f.approveFixture(); }],
]) test(`v2 rejects ${name} before any native provider reads`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
  assert.equal(f.calls.queries.length, 0);
  assert.equal(f.calls.downloads.length, 0);
});

for (const [name, change] of [
  ['v1 policy', f => { f.packet.policyVersion = 'issued_petroleum_preserve_v1'; }],
  ['extra packet flag', f => { f.packet.approved = true; }],
  ['empty attachment set', f => { f.record.attachments = []; }],
  ['21 attachment entries', f => { f.record.attachments = fixture(['issued_invoice', ...Array(20).fill('terms')]).record.attachments; }],
  ['missing attachments', f => { delete f.record.attachments; }],
  ['unknown role', f => { f.record.attachments[1].role = 'unreviewed'; }],
  ['unreviewed attachment', f => { delete f.record.attachments[1].reviewRecordHash; }],
  ['non-PDF manifest entry', f => { f.record.attachments[1].fileType = 'WORD'; }],
  ['extra verification assertion', f => { f.record.attachments[1].verified = true; }],
  ['repeated link identity', f => { f.record.attachments[1].linkId = f.record.attachments[0].linkId; }],
  ['repeated document identity', f => { f.record.attachments[1].documentId = f.record.attachments[0].documentId; }],
  ['repeated version identity', f => { f.record.attachments[1].versionId = f.record.attachments[0].versionId; }],
  ['no selected invoice', f => { f.record.attachments[0].role = 'terms'; }],
  ['two selected invoices', f => { f.record.attachments[1].role = 'issued_invoice'; }],
  ['selected invoice not equal to record', f => { f.record.attachments[0].documentId = id('069', 22); }],
  ['selected invoice review not bound to facts', f => { f.record.attachments[0].reviewRecordHash = 'f'.repeat(64); }],
  ['unsorted complete link set', f => { f.record.attachments.reverse(); }],
]) test(`v2 packet rejects ${name} with a controlled evidence error`, async () => {
  const f = fixture(); change(f);
  assert.throws(() => validateIssuedPetroleumV2Packet(f.packet), invalid);
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
  assert.equal(f.calls.queries.length, 0);
  assert.equal(f.calls.downloads.length, 0);
});

for (const field of ['sha256', 'checksum', 'contentSize']) test(`duplicate invoice requires identical ${field}`, () => {
  const f = fixture(['issued_invoice', 'duplicate_selected_invoice']);
  f.record.attachments[1][field] = field === 'contentSize' ? invoiceBytes.length + 1 : '0'.repeat(field === 'sha256' ? 64 : 32);
  assert.throws(() => validateIssuedPetroleumV2Packet(f.packet), invalid);
});

for (const [name, change] of [
  ['new current direct link', f => { f.links.push({ ...f.links[0], Id: id('06A', 99), ContentDocumentId: id('069', 99) }); }],
  ['missing direct link', f => { f.links.pop(); }],
  ['different exact link identity', f => { f.links[1].Id = id('06A', 98); }],
  ['reparented support file', f => { f.links[1].LinkedEntityId = id('a06', 2); }],
  ['new latest support version', f => { f.links[1].ContentDocument.LatestPublishedVersionId = id('068', 98); }],
  ['stale selected version', f => { f.versions[0].IsLatest = false; }],
  ['missing support version', f => { f.versions.pop(); }],
  ['duplicate current version row', f => { f.versions.push({ ...f.versions[1] }); }],
  ['support version reparented', f => { f.versions[1].ContentDocumentId = id('069', 98); }],
  ['non-PDF current support', f => { f.versions[1].FileType = 'WORD'; }],
  ['non-PDF current extension', f => { f.versions[1].FileExtension = 'docx'; }],
  ['current MD5 differs from reviewed support', f => { f.versions[1].Checksum = '0'.repeat(32); }],
  ['current size differs from reviewed support', f => { f.versions[1].ContentSize++; }],
]) test(`v2 rejects ${name} while verifying the complete current manifest`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
  assert(f.calls.downloads.length < f.record.attachments.length);
});

for (const [name, response] of [
  ['incomplete page', { records: [], totalSize: 0, done: false }],
  ['mismatched total', { records: [], totalSize: 1, done: true }],
  ['missing total', { records: [], done: true }],
  ['provider error', { records: [], totalSize: 0, done: true, error: 'FAILED' }],
  ['missing response', undefined],
]) test(`v2 rejects ${name} without downloading unchecked files`, async () => {
  const f = fixture(); f.options.query = async () => response;
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
  assert.equal(f.calls.downloads.length, 0);
});

for (const [name, org] of [
  ['different org', { Id: '00D000000000001', IsSandbox: false }],
  ['sandbox', { Id: issuedPetroleumFixture().fileEvidence.orgId, IsSandbox: true }],
]) test(`v2 rejects ${name} before link or binary reads`, async () => {
  const f = fixture(); const seen = [];
  f.options.query = async soql => { seen.push(soql); return complete([org]); };
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
  assert.equal(seen.length, 1);
  assert.equal(f.calls.downloads.length, 0);
});

for (const [name, change] of [
  ['support bytes changed', f => { f.binaries.set(f.record.attachments[1].versionId, Buffer.from('%PDF-1.7\nChanged support\n%%EOF')); }],
  ['reviewed support SHA differs', f => { f.record.attachments[1].sha256 = '0'.repeat(64); f.approveFixture(); }],
  ['reviewed support MD5 differs', f => { f.record.attachments[1].checksum = '0'.repeat(32); f.versions[1].Checksum = '0'.repeat(32); f.approveFixture(); }],
  ['wrong support MIME', f => { f.options.download = async () => ({ buffer: invoiceBytes, contentType: 'text/html' }); }],
  ['non-PDF binary signature', f => {
    const bytes = Buffer.from('HTML document returned by a failed native download');
    f.record.attachments[1].contentSize = bytes.length; f.record.attachments[1].sha256 = digest(bytes, 'sha256');
    f.record.attachments[1].checksum = digest(bytes, 'md5'); f.versions[1].ContentSize = bytes.length;
    f.versions[1].Checksum = digest(bytes, 'md5'); f.binaries.set(f.record.attachments[1].versionId, bytes); f.approveFixture();
  }],
  ['missing binary buffer', f => { f.options.download = async () => ({ contentType: 'application/pdf' }); }],
  ['null download response', f => { f.options.download = async () => null; }],
  ['undefined download response', f => { f.options.download = async () => undefined; }],
]) test(`v2 rejects ${name} with the controlled evidence error`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
});

for (const value of [null, undefined, false, 'packet', {}, [], { policyVersion: ISSUED_PETROLEUM_V2_POLICY, records: [null] }]) {
  test(`v2 malformed ${JSON.stringify(value)} packet fails with controlled evidence error`, () => {
    assert.throws(() => validateIssuedPetroleumV2Packet(value), invalid);
  });
}

for (const [name, change] of [
  ['circular packet', f => { f.record.review.lines[0].productEvidence = f.packet; }],
  ['BigInt fact', f => { f.record.review.total = 1n; }],
]) test(`v2 ${name} fails with controlled evidence error before provider reads`, async () => {
  const f = fixture(); change(f);
  assert.throws(() => validateIssuedPetroleumV2Packet(f.packet), invalid);
  await assert.rejects(collectIssuedPetroleumV2Files(f.packet, f.options), invalid);
  assert.equal(f.calls.queries.length, 0);
  assert.equal(f.calls.downloads.length, 0);
});
