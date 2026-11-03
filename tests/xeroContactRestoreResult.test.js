import test from 'node:test';
import assert from 'node:assert/strict';
import { canRestoreContactRow, confirmedContactRestore } from '../src/lib/xeroContactRestoreResult.js';

const row = (id = 'row1') => ({ id, salesforceAccountId: `account-${id}`, action: 'exception', status: 'blocked',
  reason: 'archived-only-match', restoration: { eligible: true, targetContactId: `contact-${id}` } });
function response(rows, statuses = rows.map(() => 'restored')) {
  const outcomes = rows.map((r, i) => ({ rowId: r.id, salesforceAccountId: r.salesforceAccountId,
    xeroContactId: r.restoration.targetContactId, status: statuses[i] }));
  return { runId: 'run', refreshPreview: true, outcomes,
    summary: { total: rows.length, restored: statuses.filter((s) => s === 'restored').length,
      alreadyActive: statuses.filter((s) => s === 'already_active').length,
      blocked: statuses.filter((s) => s === 'blocked').length, uncertain: statuses.filter((s) => s === 'uncertain').length } };
}

test('only explicit archived restoration markers may be selected', () => {
  assert.equal(canRestoreContactRow(row()), true);
  for (const change of [{ restoration: undefined }, { restoration: { eligible: false, targetContactId: 'c' } },
    { restoration: { eligible: true } }, { action: 'rename' }, { action: 'archive' }, { status: 'eligible' },
    { reason: 'missing-xero-contact' }, { salesforceAccountId: '' }, { id: '' }, { id: true },
    { restoration: { eligible: true, targetContactId: true } }]) {
    assert.equal(canRestoreContactRow({ ...row(), ...change }), false);
  }
});

test('validates exact identities and tallies for every outcome without treating uncertainty as success', () => {
  const rows = ['1', '2', '3', '4'].map(row);
  const data = response(rows, ['restored', 'already_active', 'blocked', 'uncertain']);
  assert.equal(confirmedContactRestore(data, 'run', rows), true);
  assert.equal(data.summary.uncertain, 1);
  assert.equal(confirmedContactRestore({ ...data, outcomes: [...data.outcomes].reverse() }, 'run', rows), true);
});

test('rejects malformed, wrong-run, duplicate, missing and unrelated outcomes', () => {
  const rows = [row('1'), row('2')];
  const data = response(rows);
  for (const altered of [undefined, { error: 'network' }, { ...data, error: 'network' }, { ...data, runId: 'another' },
    { ...data, refreshPreview: false }, { ...data, outcomes: [] },
    { ...data, outcomes: [data.outcomes[0], data.outcomes[0]] },
    { ...data, outcomes: [...data.outcomes, data.outcomes[0]] },
    { ...data, outcomes: [{ ...data.outcomes[0], rowId: 'other' }, data.outcomes[1]] },
    { ...data, outcomes: [{ ...data.outcomes[0], status: 'created' }, data.outcomes[1]] },
    { ...data, summary: { ...data.summary, restored: 1 } },
    { ...data, summary: { ...data.summary, total: '2' } }]) {
    assert.equal(confirmedContactRestore(altered, 'run', rows), false);
  }
});

test('rejects mismatched account or Contact IDs, including blocked and uncertain outcomes', () => {
  const rows = [row()];
  for (const status of ['restored', 'already_active', 'blocked', 'uncertain']) {
    const data = response(rows, [status]);
    for (const field of ['salesforceAccountId', 'xeroContactId']) {
      assert.equal(confirmedContactRestore({ ...data, outcomes: [{ ...data.outcomes[0], [field]: 'other' }] }, 'run', rows), false);
      assert.equal(confirmedContactRestore({ ...data, outcomes: [{ ...data.outcomes[0], [field]: undefined }] }, 'run', rows), false);
    }
  }
});

test('requires an explicit unique selection of one to 25 eligible rows', () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(String(i)));
  assert.equal(confirmedContactRestore(response(rows), 'run', rows), true);
  const tooMany = [...rows, row('26')];
  assert.equal(confirmedContactRestore(response(tooMany), 'run', tooMany), false);
  assert.equal(confirmedContactRestore(response([]), 'run', []), false);
  assert.equal(confirmedContactRestore(response([row(), row()]), 'run', [row(), row()]), false);
  assert.equal(confirmedContactRestore(response([row()]), '', [row()]), false);
  assert.equal(confirmedContactRestore(response([row()]), 'run', [{ ...row(), reason: 'missing-xero-contact' }]), false);
});
