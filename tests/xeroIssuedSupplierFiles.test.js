import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { collectIssuedSupplierFiles, collectIssuedSupplierVessels, validateIssuedSupplierPacket } from '../api/_xeroIssuedSupplierFiles.js';
import { issuedSupplierHash } from '../api/_xeroIssuedSupplierPreservation.js';

const hash = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const bytes = Buffer.from('%PDF-1.7\nPrivate issued invoice fixture\n%%EOF');
const sourceId = 'a01000000000001AAA';
const documentId = '069000000000001AAA';
const versionId = '068000000000001AAA';
const xeroDocumentId = '12345678-1234-1234-1234-123456789abc';
const record = () => ({ sourceId, documentId, versionId, xeroDocumentId, sha256: hash(bytes, 'sha256'), review: { sourceNumber: 'SUP-1', lines: [{ description: 'Fuel', amount: 100 }] } });
const invalid = { code: 'XERO_ISSUED_EVIDENCE_INVALID', status: 409 };
const complete = (records) => ({ records, done: true, totalSize: records.length });

function fixture({ organisation, links, versions, file, queryTransform } = {}) {
  const calls = [];
  const directLinks = links || [{ Id: '06A000000000001AAA', LinkedEntityId: sourceId, ContentDocumentId: documentId, ContentDocument: { LatestPublishedVersionId: versionId } }];
  const currentVersions = versions || [{ Id: versionId, ContentDocumentId: documentId, IsLatest: true,
    Checksum: hash(bytes, 'md5'), ContentSize: bytes.length, FileType: 'PDF', FileExtension: 'pdf' }];
  return { calls, directLinks, currentVersions, options: {
    approvedReviewHashes: [issuedSupplierHash(record())],
    query: async (soql, options) => {
      calls.push({ type: 'query', soql, options });
      const table = soql.includes('FROM Organization') ? 'org' : soql.includes('FROM ContentDocumentLink') ? 'links' : 'versions';
      const rows = table === 'org' ? organisation || [{ Id: fcosSalesforceEnvironment('production').orgId, IsSandbox: false }]
        : table === 'links' ? directLinks : currentVersions;
      return queryTransform ? queryTransform(table, complete(rows)) : complete(rows);
    },
    download: async (path) => { calls.push({ type: 'download', path }); return file || { buffer: bytes, contentType: 'application/pdf' }; },
  } };
}

test('collector verifies native direct PDF, latest version, checksum and SHA using bounded reads', async () => {
  const stub = fixture();
  const result = await collectIssuedSupplierFiles({ records: [record()] }, stub.options);
  const evidence = result.get(sourceId);
  assert.equal(result.size, 1);
  assert.equal(evidence.orgId, fcosSalesforceEnvironment('production').orgId);
  assert.equal(evidence.sha256, hash(bytes, 'sha256'));
  assert.equal(evidence.checksum, hash(bytes, 'md5'));
  assert.equal(evidence.link.documentId, documentId);
  assert.equal(evidence.version.latestPublishedVersionId, versionId);
  assert.equal(evidence.version.isLatest, true);
  assert.equal(evidence.contentSize, bytes.length);
  assert.equal(evidence.buffer, undefined, 'private PDF bytes are not exported into review evidence');
  assert.deepEqual(stub.calls.map((call) => call.type), ['query', 'query', 'query', 'download']);
  assert.deepEqual(stub.calls.filter((call) => call.type === 'query').map((call) => call.options),
    [{ clean: true, limit: 2 }, { clean: true, limit: 2000 }, { clean: true, limit: 25 }]);
  assert.equal(stub.calls.at(-1).path, `/sobjects/ContentVersion/${versionId}/VersionData`);
  const octet = fixture({ file: { buffer: bytes, contentType: 'application/octet-stream; charset=binary' } });
  assert.equal((await collectIssuedSupplierFiles({ records: [record()] }, octet.options)).get(sourceId).contentType, 'application/pdf');
});

test('unapproved or amended paper facts cannot use a genuine reviewed PDF to clear a hold', async () => {
  const approved = record();
  for (const amended of [
    { ...approved, review: { ...approved.review, vessel: 'OTHER VESSEL' } },
    { ...approved, review: { ...approved.review, lines: [{ description: 'Fuel', amount: 99 }] } },
    { ...approved, review: { ...approved.review, lines: [{ description: 'Changed', amount: 100 }] } },
    { ...approved, review: { ...approved.review, reviewRecordHash: '0'.repeat(64) } },
    { ...approved, sourceId: 'a01000000000002AAA' },
    { ...approved, xeroDocumentId: '12345678-1234-1234-1234-123456789abd' },
    { ...approved, documentId: '069000000000002AAA' },
    { ...approved, versionId: '068000000000002AAA' },
    { ...approved, sha256: '0'.repeat(64) },
  ]) {
    const stub = fixture();
    await assert.rejects(collectIssuedSupplierFiles({ records: [amended] }, stub.options), invalid);
    assert.equal(stub.calls.length, 0, 'unapproved claims fail before any provider read');
  }
  const stub = fixture();
  delete stub.options.approvedReviewHashes;
  await assert.rejects(collectIssuedSupplierFiles({ records: [approved] }, stub.options), invalid);
  assert.equal(stub.calls.length, 0, 'default production registry does not approve arbitrary uploaded reviews');
});

test('packet validation rejects malformed or duplicate identities before Salesforce reads', async () => {
  for (const packet of [null, {}, { records: [] }, { records: [null] }, { records: [{ ...record(), sourceId: 5 }] },
    { records: [record(), record()] }, { records: [record(), { ...record(), sourceId: 'a01000000000002AAA' }] },
    { records: [record(), { ...record(), sourceId: sourceId.slice(0, 15), xeroDocumentId: '12345678-1234-1234-1234-123456789abd' }] },
    { records: [{ ...record(), documentId: versionId }] }, { records: [{ ...record(), sha256: 'wrong' }] },
    { records: [{ ...record(), review: [] }] }, { records: Array(26).fill(record()) },
    { records: [{ ...record(), review: { note: 'a'.repeat(200000) } }] }]) {
    const stub = fixture();
    assert.throws(() => validateIssuedSupplierPacket(packet), invalid);
    await assert.rejects(collectIssuedSupplierFiles(packet, stub.options), invalid);
    assert.equal(stub.calls.length, 0);
  }
});

test('collector fails closed on org mismatch and sandbox before file reads', async () => {
  for (const organisation of [[{ Id: '00D000000000001AAA', IsSandbox: false }],
    [{ Id: fcosSalesforceEnvironment('production').orgId, IsSandbox: true }], [],
    [{ Id: fcosSalesforceEnvironment('production').orgId, IsSandbox: false }, { Id: fcosSalesforceEnvironment('production').orgId, IsSandbox: false }]]) {
    const stub = fixture({ organisation });
    await assert.rejects(collectIssuedSupplierFiles({ records: [record()] }, stub.options), invalid);
    assert.equal(stub.calls.length, 1);
  }
});

test('every org, file-link and version query must be complete', async () => {
  for (const table of ['org', 'links', 'versions']) {
    for (const patch of [{ done: false }, { totalSize: 99 }, { totalSize: undefined }, { records: null }, { error: 'query failed' }]) {
      const stub = fixture({ queryTransform: (name, result) => name === table ? { ...result, ...patch } : result });
      await assert.rejects(collectIssuedSupplierFiles({ records: [record()] }, stub.options), invalid);
      assert.equal(stub.calls.some((call) => call.type === 'download'), false);
    }
  }
});

test('changed, missing and duplicate file links or version metadata prevent downloads', async () => {
  const base = fixture();
  const link = base.directLinks[0]; const version = base.currentVersions[0];
  for (const patch of [{ links: [] }, { links: [link, link] }, { versions: [] }, { versions: [version, version] },
    { links: [{ ...link, LinkedEntityId: 'a01000000000002AAA' }] },
    { links: [{ ...link, ContentDocument: { LatestPublishedVersionId: '068000000000002AAA' } }] },
    { versions: [{ ...version, ContentDocumentId: '069000000000002AAA' }] },
    ...[{ IsLatest: false }, { FileType: 'WORD' }, { FileExtension: 'docx' }, { Checksum: 'wrong' },
      { ContentSize: 4 }, { ContentSize: 5000001 }, { ContentSize: 6.5 }].map((change) => ({ versions: [{ ...version, ...change }] }))]) {
    const stub = fixture(patch);
    await assert.rejects(collectIssuedSupplierFiles({ records: [record()] }, stub.options), invalid);
    assert.equal(stub.calls.some((call) => call.type === 'download'), false);
  }
});

test('changed bytes, MD5, SHA, PDF signature, MIME, byte count and buffer type are rejected', async () => {
  const version = fixture().currentVersions[0];
  const changed = Buffer.from(bytes); changed[changed.length - 1] = 0;
  for (const patch of [{ file: { buffer: changed, contentType: 'application/pdf' } },
    { file: { buffer: Buffer.from('x'.repeat(bytes.length)), contentType: 'application/pdf' } },
    { file: { buffer: bytes, contentType: 'text/html' } }, { file: { buffer: bytes, contentType: undefined } },
    { file: { buffer: bytes.subarray(0, -1), contentType: 'application/pdf' } },
    { file: { buffer: new Uint8Array(bytes), contentType: 'application/pdf' } },
    { versions: [{ ...version, Checksum: '0'.repeat(32) }] }]) {
    const stub = fixture(patch);
    await assert.rejects(collectIssuedSupplierFiles({ records: [record()] }, stub.options), invalid);
  }
  await assert.rejects(collectIssuedSupplierFiles({ records: [{ ...record(), sha256: '0'.repeat(64) }] }, fixture().options), invalid);
});

test('authoritative vessel retrieval requires complete unique source records and accounting scope', async () => {
  const rows = [{ Id: sourceId, STEM__c: 'stem', STEM__r: { Vessel__r: { Name: 'VESSEL ONE' } } },
    { Id: 'a01000000000002AAA', STEM__c: 'stem-two', STEM__r: null }];
  let query;
  const vessels = await collectIssuedSupplierVessels('2026-01-01', { query: async (soql, options) => { query = { soql, options }; return complete(rows); } });
  assert.deepEqual(vessels.get(sourceId), { stemId: 'stem', vessel: 'VESSEL ONE' });
  assert.deepEqual(vessels.get(rows[1].Id), { stemId: 'stem-two', vessel: null });
  assert.match(query.soql, /STEM__r\.Vessel__r\.Name FROM Supplier_Invoice__c WHERE Invoice_Date__c >= 2026-01-01 ORDER BY Id/);
  assert.deepEqual(query.options, { clean: true, limit: 100000 });
  for (const result of [{ ...complete(rows), done: false }, { ...complete(rows), totalSize: 5 }, { error: 'failed' },
    complete([rows[0], rows[0]]), { ...complete(rows), records: null }]) {
    await assert.rejects(collectIssuedSupplierVessels('2026-01-01', { query: async () => result }), invalid);
  }
  let called = false;
  await assert.rejects(collectIssuedSupplierVessels('2026-01-01 OR Id != null', { query: async () => { called = true; return complete(rows); } }), invalid);
  assert.equal(called, false);
});
