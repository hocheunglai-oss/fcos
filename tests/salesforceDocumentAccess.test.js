import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { downloadAuthorizedSalesforceDocument as download, scopeCollectionDocumentMetadata, stemDocumentDownloadUrl } from '../api/_salesforceDocumentAccess.js';

const stem = 'a0H000000000001AAA';
const parent = 'a0N000000000002AAA';
const unrelated = 'a0H000000000003AAA';
const version = '068000000000001AAA';
const document = '069000000000001AAA';
const attachment = '00P000000000001AAA';
const context = { profile: { user_type: 'Interoffice' } };
function harness(overrides = {}) {
  let calls = 0;
  const input = { id: version, kind: 'contentVersion', stemId: stem, accessContext: context, interoffice: true };
  const deps = {
    loadGraph: async (id, access) => { assert.equal(id, stem); assert.equal(access, context); return { relatedRecords: [{ id: stem }, { id: parent }] }; },
    query: async (sql) => sql.includes('FROM ContentVersion') ? [{ Id: version, ContentDocumentId: document }]
      : sql.includes('FROM Attachment') ? [{ Id: attachment, ParentId: parent }]
        : [{ ContentDocumentId: document, LinkedEntityId: parent }],
    download: async (path) => { calls++; return { buffer: Buffer.from('document bytes'), path }; },
    ...overrides,
  };
  return { input, deps, calls: () => calls };
}

test('download preserves live graph authorization and permits linked historical ContentVersions', async () => {
  for (const kind of ['contentVersion', 'attachment']) {
    const h = harness();
    const result = await download({ ...h.input, kind, id: kind === 'attachment' ? attachment : version }, h.deps);
    assert.equal(result.buffer.toString(), 'document bytes');
    assert.equal(h.calls(), 1);
  }
});

test('interoffice missing scope, malformed inputs, and missing auth deny before byte fetch', async () => {
  for (const change of [{ stemId: null }, { stemId: 'not-an-id' }, { id: "x' OR 1=1" }, { kind: 'garbage' }, { accessContext: null }]) {
    const h = harness();
    await assert.rejects(download({ ...h.input, ...change }, h.deps), (error) => [400, 401, 403].includes(error.status));
    assert.equal(h.calls(), 0);
  }
});

test('allowed STEM cannot authorize a document belonging only to an excluded or unrelated parent', async () => {
  for (const kind of ['contentVersion', 'attachment']) {
    const h = harness({ query: async (sql) => sql.includes('FROM ContentVersion') ? [{ Id: version, ContentDocumentId: document }]
      : sql.includes('FROM Attachment') ? [{ Id: attachment, ParentId: unrelated }]
        : [{ ContentDocumentId: document, LinkedEntityId: unrelated }] });
    await assert.rejects(download({ ...h.input, kind, id: kind === 'attachment' ? attachment : version }, h.deps), { status: 403 });
    assert.equal(h.calls(), 0);
  }
});

test('missing metadata, mismatched identity, removed links, and failed scope reads fail closed', async () => {
  for (const overrides of [
    { query: async () => [] },
    { query: async () => [{ Id: unrelated, ContentDocumentId: document, LinkedEntityId: parent }] },
    { query: async (sql) => sql.includes('FROM ContentVersion') ? [{ Id: version, ContentDocumentId: document }] : [] },
    { loadGraph: async () => { throw new Error('access/schema unavailable'); } },
    { query: async () => { throw new Error('metadata unavailable'); } },
  ]) {
    const h = harness(overrides);
    await assert.rejects(download(h.input, h.deps));
    assert.equal(h.calls(), 0);
  }
});

test('one verified link is sufficient and all supported graph parents use the same membership proof', async () => {
  for (const sourceObject of ['stem__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c', 'STEM_Buyer_Broker__c', 'Supplier_Invoice__c', 'Invoice__c', 'Nomination__c', 'EmailMessage']) {
    const h = harness({ loadGraph: async () => ({ relatedRecords: [{ id: stem }, { id: parent, sourceObject }] }),
      query: async (sql) => sql.includes('FROM ContentVersion') ? [{ Id: version, ContentDocumentId: document }]
        : [{ ContentDocumentId: document, LinkedEntityId: unrelated }, { ContentDocumentId: document, LinkedEntityId: parent }] });
    await download(h.input, h.deps);
    assert.equal(h.calls(), 1);
  }
});

test('unrestricted legacy links remain compatible but explicit scope still requires actual linkage', async () => {
  const h = harness({ query: async () => [] });
  await download({ ...h.input, interoffice: false, stemId: null }, h.deps);
  await assert.rejects(download({ ...h.input, interoffice: false }, h.deps));
  assert.equal(h.calls(), 1);
});

test('saved payment advice URLs gain trusted STEM context without mutating stored history', () => {
  const metadata = { note: 'retained', document: { versionId: version, fileName: 'Advice & receipt.pdf', downloadUrl: 'https://untrusted.example/' } };
  const scoped = scopeCollectionDocumentMetadata(metadata, stem);
  const url = new URL(scoped.document.downloadUrl, 'https://fcos.fcuno.com');
  assert.equal(url.searchParams.get('stemId'), stem);
  assert.equal(url.searchParams.get('filename'), 'Advice & receipt.pdf');
  assert.equal(metadata.document.downloadUrl, 'https://untrusted.example/');
  assert.equal(stemDocumentDownloadUrl({ id: version, stemId: 'bad' }), null);
});

test('dispatcher retains verified context and listing/download share the same live graph', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  assert.match(source, /const accessContext = await requireHandlerAccess\(name, req\);\s*return await salesforceDocumentDownload\(req, res, accessContext\)/);
  assert.match(source, /loadGraph: loadSalesforceStemDocumentGraph/);
  assert.match(source, /loadSalesforceStemDocumentGraph\(body.stemId, accessContext\)/);
  assert.match(source, /query: \(soql\) => queryRows\(soql, \{ limit: 1, softFail: false \}\)/);
});
