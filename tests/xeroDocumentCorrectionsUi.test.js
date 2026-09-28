import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectDocumentCorrectionPreview, documentCorrectionInitialSelection, documentCorrectionOutcomes, documentCorrectionPreviewValid,
  documentCorrectionSelectable, documentCorrectionSelection, documentCorrectionValue } from '../src/lib/xeroDocumentCorrectionsUi.js';

const eligible = { id: 'one', outcome: 'eligible', projectionFingerprint: 'verified', changes: [{ field: 'Date', before: null, after: '2026-01-01' }] };
const preview = { policy: 'document_field_correction_v1', previewId: 'preview-one', totalCount: 2, nextOffset: null, items: [eligible,
  { ...eligible, id: 'blocked', outcome: 'blocked', reason: 'Paid date update not supported.' }] };

test('correction selection requires a verified eligible unique item from the current preview', () => {
  assert.equal(documentCorrectionPreviewValid(preview), true);
  assert.deepEqual(documentCorrectionSelection(preview, new Set(['one'])), ['one']);
  assert.deepEqual([...documentCorrectionInitialSelection(preview)], ['one']);
  for (const selected of [new Set(), new Set(['blocked']), new Set(['one', 'missing'])]) {
    assert.deepEqual(documentCorrectionSelection(preview, selected), []);
  }
  for (const value of [{ ...preview, previewId: '' }, { ...preview, policy: 'other' }, { ...preview, items: [eligible, eligible] }]) {
    assert.equal(documentCorrectionPreviewValid(value), false);
    assert.deepEqual(documentCorrectionSelection(value, new Set(['one'])), []);
  }
  for (const item of [{ ...eligible, projectionFingerprint: null }, { ...eligible, changes: [] }, { ...eligible, outcome: 'already_compliant' },
    { ...eligible, outcome: 'legacy_preserved' }]) assert.equal(documentCorrectionSelectable(preview, item), false);
});

test('default selection and apply batches never exceed 25 eligible items', () => {
  const large = { ...preview, totalCount: 26, items: Array.from({ length: 26 }, (_, index) => ({ ...eligible, id: String(index) })) };
  const selected = documentCorrectionInitialSelection(large);
  assert.equal(selected.size, 25);
  assert.equal(documentCorrectionSelection(large, selected).length, 25);
  selected.add('25');
  assert.deepEqual(documentCorrectionSelection(large, selected), []);
});

test('a verified no-op link is selectable only with the explicit server link-only marker', () => {
  const item = { ...eligible, changes: [], linkOnly: true };
  const verified = { ...preview, items: [item, preview.items[1]] };
  assert.equal(documentCorrectionSelectable(verified, item), true);
  assert.deepEqual(documentCorrectionSelection(verified, new Set(['one'])), ['one']);
  assert.equal(documentCorrectionSelectable(verified, { ...item, linkOnly: false }), false);
  assert.equal(documentCorrectionSelectable(verified, { ...item, projectionFingerprint: '' }), false);
});

test('preview page collection requires the stable complete saved inventory before selection', async () => {
  const first = { ...preview, totalCount: 3, nextOffset: 1, items: [eligible] };
  const second = { ...first, items: [{ ...eligible, id: 'two' }], nextOffset: 2 };
  const third = { ...first, items: [{ ...eligible, id: 'three' }], nextOffset: null };
  const calls = []; const progress = [];
  assert.deepEqual(documentCorrectionSelection(first, new Set(['one'])), []);
  const complete = await collectDocumentCorrectionPreview(first, async (previewId, offset) => {
    calls.push({ previewId, offset }); return offset === 1 ? second : third;
  }, (received, total) => progress.push([received, total]));
  assert.deepEqual(calls, [{ previewId: 'preview-one', offset: 1 }, { previewId: 'preview-one', offset: 2 }]);
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.equal(documentCorrectionPreviewValid(complete), true);
  assert.deepEqual(documentCorrectionSelection(complete, new Set(['one', 'three'])), ['one', 'three']);
  for (const page of [{ ...second, previewId: 'other' }, { ...second, totalCount: 4 }, { ...second, nextOffset: 1 },
    { ...second, nextOffset: null }, { ...second, items: [eligible] }, { ...second, items: [], nextOffset: 1 }]) {
    await assert.rejects(collectDocumentCorrectionPreview(first, async () => page), /Incomplete correction preview/);
  }
  await assert.rejects(collectDocumentCorrectionPreview({ ...preview, totalCount: undefined }, async () => third), /Incomplete correction preview/);
});

test('only a unique supported apply result confirms each requested item; unknown or missing outcomes remain uncertain', () => {
  const reasons = ['applied', 'already_compliant', 'legacy_preserved', 'blocked', 'failed', 'uncertain'];
  for (const outcome of reasons) {
    const item = { id: 'one', outcome, reason: `Reason: ${outcome}` };
    assert.deepEqual(documentCorrectionOutcomes(['one'], [item]), [item]);
  }
  for (const items of [undefined, [], [{ id: 'unselected', outcome: 'applied' }], [{ id: 'one', outcome: 'processing' }],
    [{ id: 'one', outcome: 'applied' }, { id: 'one', outcome: 'applied' }]]) {
    const result = documentCorrectionOutcomes(['one'], items);
    assert.equal(result[0].outcome, 'uncertain');
    assert.match(result[0].reason, /not confirmed/);
  }
  assert.equal(documentCorrectionOutcomes(['one'], [{ id: 'one', status: 'applied', reason: 'Confirmed' }])[0].outcome, 'applied');
});

test('differences retain literal empty fields and full before/after values', () => {
  assert.equal(documentCorrectionValue(null), '(empty)');
  assert.equal(documentCorrectionValue(''), '(empty)');
  assert.equal(documentCorrectionValue('2026-01-01'), '2026-01-01');
  assert.equal(documentCorrectionValue(0), '0');
});

test('correction panel calls providers only on user actions, forwards exactly reviewed IDs once and retains uncertain attempts', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroDocumentCorrections.jsx', import.meta.url), 'utf8');
  assert.match(source, /useEffect\(\(\) => \(\) => \{ generation.current \+= 1; \}, \[\]\)/);
  const method = source.slice(source.indexOf('  async function applyCorrections()'), source.indexOf('  return <Dialog'));
  for (const response of ['applied', 'blocked', 'missing', 'lost']) {
    const calls = []; let outcomes; let attempted = false;
    const execute = new Function('appClient', 'documentCorrectionOutcomes', 'setOutcomes', 'setAttempted',
      `const enabled=true,canPreview=true,busy='',attempted=false,requestBusy={current:false},generation={current:0},selectedIds=['one'],preview={previewId:'preview-one'},OPTIONS={},captureAllowance=()=>{},setError=()=>{},setBusy=()=>{};
      ${method}; return applyCorrections();`);
    await execute({ functions: { invoke: async (name, body) => {
      calls.push({ name, body });
      if (response === 'lost') throw new Error('Connection lost');
      return { data: { items: response === 'missing' ? [] : [{ id: 'one', outcome: response, reason: 'Server reason' }] } };
    } } }, documentCorrectionOutcomes, (value) => { outcomes = value; }, (value) => { attempted = value; });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { name: 'xeroFinancialDocumentCorrectionApply', body: { previewId: 'preview-one', itemIds: ['one'] } });
    assert.equal(attempted, true);
    assert.equal(outcomes[0].outcome, ['applied', 'blocked'].includes(response) ? response : 'uncertain');
  }
});

test('uncertain verification uses only original uncertain IDs while preserving other outcomes and does not depend on the write gate', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroDocumentCorrections.jsx', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  async function verifyUncertainResults()'), source.indexOf('  return <Dialog'));
  for (const response of ['applied', 'missing', 'lost']) {
    const calls = []; let outcomes = [{ id: 'one', outcome: 'applied', reason: 'Earlier confirmed' }, { id: 'two', outcome: 'uncertain' }];
    const execute = new Function('appClient', 'documentCorrectionOutcomes', 'setOutcomes',
      `const enabled=false,canPreview=true,busy='',requestBusy={current:false},generation={current:0},uncertainIds=['two'],preview={previewId:'original-preview'},OPTIONS={},captureAllowance=()=>{},setError=()=>{},setBusy=()=>{};
      ${method}; return verifyUncertainResults();`);
    await execute({ functions: { invoke: async (name, body) => {
      calls.push({ name, body });
      if (response === 'lost') throw new Error('Connection lost');
      return { data: { items: response === 'missing' ? [] : [{ id: 'two', outcome: 'applied', reason: 'Exact readback confirmed' }] } };
    } } }, documentCorrectionOutcomes, (update) => { outcomes = update(outcomes); });
    assert.deepEqual(calls, [{ name: 'xeroFinancialDocumentCorrectionVerify', body: { previewId: 'original-preview', itemIds: ['two'] } }]);
    assert.deepEqual(outcomes[0], { id: 'one', outcome: 'applied', reason: 'Earlier confirmed' });
    assert.equal(outcomes[1].outcome, response === 'applied' ? 'applied' : 'uncertain');
  }
});
