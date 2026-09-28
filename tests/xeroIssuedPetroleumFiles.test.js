import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { collectIssuedPetroleumFiles, validateIssuedPetroleumPacket, issuedPetroleumReviewHash } from '../api/_xeroIssuedPetroleumFiles.js';

const bytes = Buffer.from('%PDF-1.7\nNative petroleum fixture\n%%EOF');
const hash = (data, algorithm) => createHash(algorithm).update(data).digest('hex');
const complete = (records) => ({ records, totalSize: records.length, done: true });
const invalid = { code: 'XERO_ISSUED_PETROLEUM_EVIDENCE_INVALID' };
function fixture() {
  const f = issuedPetroleumFixture(); const record = f.packet.records[0]; record.sha256 = hash(bytes, 'sha256');
  const links = [{ Id: f.ids.link, LinkedEntityId: f.ids.source, ContentDocumentId: f.ids.document, ContentDocument: { LatestPublishedVersionId: f.ids.version } }];
  const versions = [{ Id: f.ids.version, ContentDocumentId: f.ids.document, IsLatest: true, Checksum: hash(bytes, 'md5'), ContentSize: bytes.length, FileType: 'PDF', FileExtension: 'pdf' }];
  const calls = []; const options = { tenantId: f.ids.tenant, approvedReviewHashes: [issuedPetroleumReviewHash(record)],
    query: async (soql) => { calls.push(soql); return complete(soql.includes('FROM Organization') ? [{ Id: f.fileEvidence.orgId, IsSandbox: false }] : soql.includes('FROM ContentDocumentLink') ? links : versions); },
    download: async (path) => { calls.push(path); return { buffer: bytes, contentType: 'application/octetstream' }; } };
  return { ...f, record, links, versions, options, calls };
}

test('petroleum native collector binds explicit policy, independent hash, tenant, latest direct file and actual binary MIME', async () => {
  const f = fixture(); const files = await collectIssuedPetroleumFiles(f.packet, f.options);
  const evidence = files.get(f.ids.source); assert.equal(files.size, 1); assert.equal(evidence.contentType, 'application/pdf');
  assert.equal(evidence.sha256, hash(bytes, 'sha256')); assert.equal(evidence.checksum, hash(bytes, 'md5'));
  assert.equal(evidence.review.totalTax, null); assert.deepEqual(evidence.review, f.record.review); assert.equal(evidence.buffer, undefined);
  assert.equal(f.calls.length, 4);
});

test('production registry rejects unregistered reviews and changed literals/tenant before native provider reads', async () => {
  const f = fixture(); delete f.options.approvedReviewHashes; await assert.rejects(collectIssuedPetroleumFiles(f.packet, f.options), invalid); assert.equal(f.calls.length, 0);
  for (const change of [g => { g.record.review.lines[0].quantity = '1'; }, g => { g.record.review.counterparties.printedSeller = 'OTHER'; },
    g => { g.record.review.totalTax = '0'; }, g => { g.record.review.deliveryDate = '2026-03-17'; }, g => { g.options.tenantId = g.ids.contact; }]) {
    const g = fixture(); change(g); await assert.rejects(collectIssuedPetroleumFiles(g.packet, g.options), invalid); assert.equal(g.calls.length, 0);
  }
});

for (const [name, change] of [
  ['trustee policy', f => { f.packet.policyVersion = 'issued_supplier_preserve_v1'; }],
  ['missing policy', f => { delete f.packet.policyVersion; }],
  ['client verified flag', f => { f.record.verified = true; }],
  ['unrecognized paper line property', f => { f.record.review.lines[0].approved = true; }],
  ['unrecognized counterparty authority', f => { f.record.review.counterparties.authorized = true; }],
  ['duplicate source', f => { f.packet.records.push({ ...f.record, xeroDocumentId: f.ids.contact }); }],
]) test(`packet rejects ${name}`, () => { const f = fixture(); change(f); assert.throws(() => validateIssuedPetroleumPacket(f.packet), invalid); });

for (const [name, change] of [
  ['extra link', f => f.links.push({ ...f.links[0], Id: '06A000000000002', ContentDocumentId: '069000000000002' })],
  ['reparented file', f => { f.links[0].LinkedEntityId = 'a06000000000002'; }],
  ['latest changed', f => { f.links[0].ContentDocument.LatestPublishedVersionId = '068000000000002'; }],
  ['checksum changed', f => { f.versions[0].Checksum = '0'.repeat(32); }],
  ['wrong MIME', f => { f.options.download = async () => ({ buffer: bytes, contentType: 'text/html' }); }],
  ['wrong bytes', f => { f.options.download = async () => ({ buffer: Buffer.from('%PDF-changed'), contentType: 'application/pdf' }); }],
  ['incomplete query', f => { f.options.query = async () => ({ ...complete([]), totalSize: 99 }); }],
  ['wrong org', f => { f.options.query = async () => complete([{ Id: '00D000000000001', IsSandbox: false }]); }],
  ['sandbox', f => { f.options.query = async () => complete([{ Id: f.fileEvidence.orgId, IsSandbox: true }]); }],
]) test(`native ${name} holds the petroleum record`, async () => { const f = fixture(); change(f); await assert.rejects(collectIssuedPetroleumFiles(f.packet, f.options), invalid); });
