import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { issuedPetroleumV2Fixture } from './xeroIssuedPetroleumV2Fixtures.js';
import { PRESERVATION_PACKET_MAX_BYTES, parsePreservationPacket, preservationOutcomes, preservationSelection, validatePreservationPacket } from '../src/lib/xeroIssuedSupplierPreservationUi.js';

const record = { sourceId: 'source', xeroDocumentId: 'xero', documentId: 'document', versionId: 'version', sha256: 'hash',
  review: { reviewer: 'Codex root Astra', sourceNumber: 'SUP-1', currency: 'USD', total: 100, lines: [{ description: 'Fuel', amount: 100 }] } };
const row = { id: 'one', status: 'eligible', fingerprint: 'verified', blockers: [] };
const preview = { run: { id: 'run', revision: 1, status: 'ready_for_review' }, rows: [row, { ...row, id: 'two', status: 'blocked', blockers: ['Mismatch'] }] };

test('v2 packets keep literal null paper dates and complete attachment facts for server review', () => {
  const { packet } = issuedPetroleumV2Fixture();
  assert.deepEqual(parsePreservationPacket(JSON.stringify(packet)), packet);
  assert.equal(packet.records[0].review.invoiceDate, null);
  assert.equal(packet.records[0].review.dueDate, null);
  for (const mutate of [
    (data) => { data.policyVersion = 'issued_petroleum_preserve_v1'; },
    (data) => { delete data.records[0].attachments; },
    (data) => { data.records[0].attachments = []; },
    (data) => { data.records[0].attachments = Array(21).fill(data.records[0].attachments[0]); },
    (data) => { delete data.records[0].attachments[0].reviewRecordHash; },
    (data) => { data.records[0].attachments[0].downloadToken = 'not-allowed'; },
    (data) => { data.records[0].attachments[0].role = { untrusted: true }; },
  ]) {
    const changed = structuredClone(packet); mutate(changed);
    assert.equal(validatePreservationPacket(changed), false);
  }
});

test('evidence packets exclude PDFs, credentials, unsupported nested values and oversized batches', () => {
  assert.equal(validatePreservationPacket({ records: [record] }), true);
  for (const packet of [null, { records: [] }, { records: Array(26).fill(record) }, { records: [record], token: 'secret' },
    { records: [{ ...record, pdf: 'bytes' }] }, { records: [{ ...record, review: { ...record.review, accessToken: 'secret' } }] },
    { records: [{ ...record, review: { ...record.review, lines: [{ description: 'Fuel', amount: { nested: 100 } }] } }] },
    { records: [{ ...record, sourceId: '' }] }]) assert.equal(validatePreservationPacket(packet), false);
});

test('file and pasted JSON share schema validation and the actual UTF8 byte limit', () => {
  const packet = { records: [record] };
  assert.deepEqual(parsePreservationPacket(JSON.stringify(packet)), packet);
  for (const text of ['{', JSON.stringify({ ...packet, credentials: 'forbidden' }),
    JSON.stringify({ records: [{ ...record, review: { ...record.review, token: 'forbidden' } }] })]) {
    assert.throws(() => parsePreservationPacket(text));
  }
  const base = JSON.stringify(packet);
  assert.deepEqual(parsePreservationPacket(base + ' '.repeat(PRESERVATION_PACKET_MAX_BYTES - Buffer.byteLength(base))), packet);
  assert.throws(() => parsePreservationPacket(base + ' '.repeat(PRESERVATION_PACKET_MAX_BYTES - Buffer.byteLength(base) + 1)));
  const multibyte = JSON.stringify({ records: [{ ...record, review: { ...record.review, reviewer: '紙'.repeat(70000) } }] });
  assert.ok(multibyte.length < PRESERVATION_PACKET_MAX_BYTES);
  assert.throws(() => parsePreservationPacket(multibyte), /200 KB/);
});

test('petroleum packets retain literal names and absent paper tax/delivery without changing trustee packets', () => {
  const petroleum = { policyVersion: 'issued_petroleum_preserve_v1', records: [{ ...record, review: {
    ...record.review, numberRule: 'exact', deliveryDate: null, totalTax: null,
    taxEvidence: 'no_tax_line_or_increment_observed', counterparties: { accountId: 'account', contactId: 'contact',
      tenantId: 'tenant', sourceName: 'SUPPLIER LTD', companyCode: 'supplier', printedSeller: 'SUPPLIER LIMITED',
      printedBuyer: 'BUYER LIMITED', basis: 'independently_reviewed_literal_pair' },
    lines: [{ description: 'Fuel', quantity: '79.200', unit: 'MT', unitPrice: '721.00', amount: '57103.20',
      sourceProductId: 'product', sourceProductName: 'Fuel', productEvidence: 'independently reviewed' }],
  } }] };
  assert.equal(validatePreservationPacket(petroleum), true);
  assert.deepEqual(parsePreservationPacket(JSON.stringify(petroleum)), petroleum);
  assert.equal(validatePreservationPacket({ records: [record], policyVersion: 'issued_supplier_preserve_v1' }), true);
  for (const policyVersion of [null, '', 'unknown', 'issued_supplier_preserve_v1']) {
    assert.equal(validatePreservationPacket({ ...petroleum, policyVersion }), false);
  }
  for (const field of ['counterparties', 'lines']) {
    const altered = structuredClone(petroleum);
    const nested = field === 'counterparties' ? altered.records[0].review.counterparties : altered.records[0].review.lines[0];
    nested.credentials = 'unsupported';
    assert.equal(validatePreservationPacket(altered), false);
  }
  const omittedPolicy = structuredClone(petroleum); delete omittedPolicy.policyVersion;
  assert.equal(validatePreservationPacket(omittedPolicy), false);
});

test('exact preservation selection fails closed on blocked, stale, duplicate or unverified rows', () => {
  assert.deepEqual(preservationSelection(preview, new Set(['one'])), ['one']);
  for (const selected of [new Set(), new Set(['two']), new Set(['one', 'missing'])]) assert.deepEqual(preservationSelection(preview, selected), []);
  for (const value of [{ ...preview, run: { id: 'run' } }, { ...preview, rows: [row, row] },
    { ...preview, rows: [{ ...row, fingerprint: '' }] }, { ...preview, rows: [{ ...row, blockers: ['Mismatch'] }] }]) {
    assert.deepEqual(preservationSelection(value, new Set(['one'])), []);
  }
});

test('authorised recovery allows only the complete saved selected scope; processing and partial runs cannot retry', () => {
  const saved = { run: { id: 'run', revision: 2, status: 'authorised' }, rows: [
    { ...row, status: 'selected', selected: true }, { ...row, id: 'two', status: 'selected', selected: true },
    { ...row, id: 'unselected', selected: false }] };
  assert.deepEqual(preservationSelection(saved, new Set(['one', 'two'])), ['one', 'two']);
  for (const selected of [new Set(['one']), new Set(['one', 'two', 'unselected']), new Set(['unselected'])]) {
    assert.deepEqual(preservationSelection(saved, selected), []);
  }
  for (const status of [undefined, 'processing', 'partial', 'failed', 'completed']) {
    assert.deepEqual(preservationSelection({ ...saved, run: { ...saved.run, status } }, new Set(['one', 'two'])), []);
  }
});

test('only unique linked outcomes confirm success while failures and missing outcomes remain visible', () => {
  const failure = { id: 'two', status: 'failed', error: 'Evidence changed' };
  assert.deepEqual(preservationOutcomes(['one', 'two'], [{ id: 'one', status: 'linked' }, failure]), [{ id: 'one', status: 'linked' }, failure]);
  for (const outcomes of [undefined, [], [{ id: 'one', status: 'linked' }, { id: 'one', status: 'linked' }], [{ id: 'one', status: 'processing' }]]) {
    assert.equal(preservationOutcomes(['one'], outcomes)[0].status, 'uncertain');
  }
});

test('link UI sends the exact reviewed selection once and retains uncertain or failed results without retry', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroIssuedSupplierPreservation.jsx', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  async function linkRecords()'), source.indexOf('  return <Dialog'));
  for (const response of ['linked', 'failed', 'missing', 'lost', 'stale']) {
    const calls = []; let outcomes; let attempted = false; let error = ''; const generation = { current: 0 };
    const execute = new Function('appClient', 'generation', 'preservationOutcomes', 'setOutcomes', 'setAttempted', 'setError',
      `const enabled=true,busy='',attempted=false,requestBusy={current:false},selectedIds=['one'],preview={run:{id:'run',revision:1}},OPTIONS={},onAllowance=()=>{},setBusy=()=>{},setPreview=()=>{};
       ${method}; return linkRecords();`);
    await execute({ functions: { invoke: async (name, body) => {
      calls.push({ name, body });
      if (response === 'lost') throw new Error('Connection lost');
      if (response === 'stale') generation.current += 1;
      return { data: { run: preview.run, financialWrites: 0, outcomes: response === 'missing' ? [] : [{ id: 'one', status: response }] } };
    } } }, generation, preservationOutcomes, (value) => { outcomes = value; }, (value) => { attempted = value; }, (value) => { error = value; });
    assert.equal(calls.length, 1); assert.equal(attempted, true);
    assert.equal(calls[0].name, 'xeroFinancialDocumentPreservationRun');
    assert.deepEqual(calls[0].body, { runId: 'run', revision: 1, selectedItemIds: ['one'], reviewed: true });
    assert.equal(outcomes?.[0]?.status, response === 'stale' ? undefined : ['linked', 'failed'].includes(response) ? response : 'uncertain');
    if (response === 'lost') assert.match(error, /No automatic retry/);
  }
});

test('parent lazy-loads preservation and pauses all background scans until an intentional check', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  assert.match(source, /lazy\(\(\) => import\('\.\/XeroIssuedSupplierPreservation'\)\)/);
  assert.match(source, /!reviewOpen && !preservationOpen/);
  assert.match(source, /if \(preservationOpen \|\| requestBusy\.current/);
  assert.match(source, /backgroundCheckStopped\.current = true; setPreservationOpen\(true\)/);
});
