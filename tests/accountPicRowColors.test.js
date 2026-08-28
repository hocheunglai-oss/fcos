import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountPicRowColorOptions,
  accountPicRowColorValue,
  accountPicRowTint,
  initialAccountPicRowColorRules,
  normalizeAccountPicRowColorRules,
} from '../src/lib/accountPicRowColors.js';
import { accountPicRowColorPayloadHash } from '../api/_accountPicDirectories.js';

const columns = [
  { id: '11111111-1111-4111-8111-111111111111', label: 'Team', inputType: 'text' },
  { id: '22222222-2222-4222-8222-222222222222', label: 'Tanker', inputType: 'checkbox' },
  { id: '33333333-3333-4333-8333-333333333333', label: 'Priority', inputType: 'number' },
  { id: '44444444-4444-4444-8444-444444444444', label: 'Supplier Trader', inputType: 'supplier_trader' },
];

const rows = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cells: {
    [columns[0].id]: 'Sylvia Team',
    [columns[1].id]: true,
    [columns[2].id]: 2,
    [columns[3].id]: { profileId: '99999999-9999-4999-8999-999999999999', name: 'Trader One', email: 'one@example.test' },
  } },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cells: {
    [columns[0].id]: 'Marcus Team',
    [columns[1].id]: false,
    [columns[2].id]: 1,
    [columns[3].id]: null,
  } },
];

test('canonical row-colour values support every PIC column condition', () => {
  assert.equal(accountPicRowColorValue(columns[0], '  SYLVIA   TEAM '), 'text:sylvia team');
  assert.equal(accountPicRowColorValue(columns[1], true), 'boolean:true');
  assert.equal(accountPicRowColorValue(columns[1], false), 'boolean:false');
  assert.equal(accountPicRowColorValue(columns[2], '2.0'), 'number:2');
  assert.equal(accountPicRowColorValue(columns[3], rows[0].cells[columns[3].id]), 'profile:99999999-9999-4999-8999-999999999999');
  assert.equal(accountPicRowColorValue(columns[3], null), 'empty');
  assert.deepEqual(accountPicRowColorOptions(columns[1], rows).map((option) => option.label), ['Checked', 'Not checked']);
});

test('ordered rules use first-match precedence across different columns', () => {
  const rules = normalizeAccountPicRowColorRules([
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', columnId: columns[1].id, matchValue: 'boolean:true', matchLabel: 'Checked', color: 'rose' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', columnId: columns[0].id, matchValue: 'text:sylvia team', matchLabel: 'Sylvia Team', color: 'blue' },
  ], columns, { strict: true });
  assert.match(accountPicRowTint(rows[0], columns, rules), /rose/);
  assert.equal(rules[0].position, 1);
  assert.throws(() => normalizeAccountPicRowColorRules([...rules, { ...rules[0], id: 'aaaaaaaa-0000-4000-8000-000000000003' }], columns, { strict: true }), /only one/i);
});

test('legacy Team colours are seeded but any column can replace them', () => {
  assert.match(accountPicRowTint(rows[0], columns, []), /blue/);
  const seeded = initialAccountPicRowColorRules(columns, rows, (() => {
    let index = 0;
    return () => `aaaaaaaa-0000-4000-8000-${String(++index).padStart(12, '0')}`;
  })());
  assert.equal(seeded.length, 2);
  assert.deepEqual(seeded.map((rule) => rule.matchLabel), ['Sylvia Team', 'Marcus Team']);

  const checkboxRule = [{ id: 'aaaaaaaa-0000-4000-8000-000000000010', columnId: columns[1].id, matchValue: 'boolean:false', matchLabel: 'Not checked', color: 'cyan' }];
  assert.match(accountPicRowTint(rows[1], columns, checkboxRule), /cyan/);
  assert.equal(accountPicRowTint(rows[0], columns, checkboxRule), '');
});

test('server payload hash is stable and excludes unsupported rules from projections', () => {
  const rules = [{ id: 'aaaaaaaa-0000-4000-8000-000000000011', columnId: columns[2].id, matchValue: 'number:2', matchLabel: '2', color: 'amber' }];
  const hash = accountPicRowColorPayloadHash({ accountId: '0012x00000A1B2CAA0', rules, columns });
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, accountPicRowColorPayloadHash({ accountId: '0012x00000A1B2CAA0', rules, columns }));
  assert.deepEqual(normalizeAccountPicRowColorRules([{ ...rules[0], columnId: '55555555-5555-4555-8555-555555555555' }], columns), []);
});
