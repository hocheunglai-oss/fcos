import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildBuyerTraderRows,
  buyerAccountIdKey,
  normalizeBuyerTraderUserIds,
} from '../api/_buyerTraderAdministration.js';

const migrationUrl = new URL('../supabase/migrations/20260722032251_buyer_trader_assignments.sql', import.meta.url);
const functionUrl = new URL('../api/functions/[name].js', import.meta.url);
const pageUrl = new URL('../src/pages/BuyersAdministrator.jsx', import.meta.url);

test('normalizes Salesforce Account IDs to one 15-character identity', () => {
  assert.equal(buyerAccountIdKey('0012x00000AAAAA'), '0012x00000AAAAA');
  assert.equal(buyerAccountIdKey('0012x00000AAAAAABC'), '0012x00000AAAAA');
  assert.equal(buyerAccountIdKey('not-an-account'), '');
});

test('accepts zero to three unique trader users and rejects invalid assignments', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const third = '33333333-3333-4333-8333-333333333333';
  const fourth = '44444444-4444-4444-8444-444444444444';

  assert.deepEqual(normalizeBuyerTraderUserIds([]), []);
  assert.deepEqual(normalizeBuyerTraderUserIds([first, second, third]), [first, second, third]);
  assert.throws(() => normalizeBuyerTraderUserIds([first, first]), /same trader/i);
  assert.throws(() => normalizeBuyerTraderUserIds([first, second, third, fourth]), /at most three/i);
  assert.throws(() => normalizeBuyerTraderUserIds(['local-admin']), /valid FCOS user/i);
});

test('keeps same-name buyer Accounts separate and joins traders by Account ID', () => {
  const firstUserId = '11111111-1111-4111-8111-111111111111';
  const secondUserId = '22222222-2222-4222-8222-222222222222';
  const rows = buildBuyerTraderRows({
    salesforceBuyers: [
      { Id: '0012x00000AAAAAABC', Name: 'Shared Buyer' },
      { Id: '0012x00000BBBBBDEF', Name: 'Shared Buyer' },
    ],
    managedAccounts: [
      { buyer_account_key: '0012x00000AAAAA', buyer_account_id: '0012x00000AAAAAABC', buyer_account_name: 'Shared Buyer' },
      { buyer_account_key: '0012x00000BBBBB', buyer_account_id: '0012x00000BBBBBDEF', buyer_account_name: 'Shared Buyer' },
    ],
    assignments: [
      { buyer_account_key: '0012x00000AAAAA', trader_user_id: firstUserId, assignment_order: 1 },
      { buyer_account_key: '0012x00000BBBBB', trader_user_id: secondUserId, assignment_order: 1 },
    ],
    profiles: [
      { id: firstUserId, full_name: 'First Trader', email: 'first@example.com', active: true },
      { id: secondUserId, full_name: 'Second Trader', email: 'second@example.com', active: true },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].buyerAccountKey, '0012x00000AAAAA');
  assert.equal(rows[0].traders[0].fullName, 'First Trader');
  assert.equal(rows[1].buyerAccountKey, '0012x00000BBBBB');
  assert.equal(rows[1].traders[0].fullName, 'Second Trader');
});

test('migration enforces the assignment limit, RLS, atomic save, and service-role-only writes', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /assignment_order between 1 and 3/i);
  assert.match(sql, /unique \(buyer_account_key, assignment_order\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.buyer_trader_accounts from public, anon, authenticated/i);
  assert.match(sql, /create or replace function public\.save_buyer_trader_account/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /changed after it was opened/i);
  assert.match(sql, /buyer_traders_updated/i);
  assert.match(sql, /grant execute on function public\.save_buyer_trader_account[\s\S]*to service_role/i);
});

test('server revalidates buyer usage in Salesforce before saving', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /buyersAdministratorSave[\s\S]*FROM stem__c[\s\S]*WHERE Account__c =/i);
  assert.match(source, /FROM Account[\s\S]*SELECT Account__c[\s\S]*FROM stem__c/i);
  assert.doesNotMatch(source, /COUNT\(Id\) stemCount/);
  assert.match(source, /buyersAdministratorList: \['buyers_administrator'\]/);
  assert.match(source, /buyersAdministratorSave: \['buyers_administrator'\]/);
});

test('adding a trader requires an explicit active-user selection before save', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /setSelectedTraderIds\(\(current\) => \[\.\.\.current, ''\]\)/);
  assert.match(source, /placeholder="Select a trader"/);
  assert.match(source, /disabled=\{saving \|\| hasInvalidTraderSelection\}/);
});
