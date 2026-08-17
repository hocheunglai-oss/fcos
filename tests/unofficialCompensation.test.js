import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildUnofficialCompensationWorkspace, canManageUnofficialCompensationStatus, unofficialCompensationAmount } from '../api/_unofficialCompensation.js';

const account = {
  Id: '0012x00000ABCDEAAA',
  Name: 'Ocean Buyer',
  Company_Code__c: 'CL-1001',
  Inactive_Suspended__c: false,
  Compensation_Status__c: 'Opened',
  Agreed_Compensation_Total__c: 150,
  Unofficial_Compensation_Total__c: -40,
  CurrencyIsoCode: 'USD',
};

test('UOC recovery uses fixed price or delivered quantity before ordered quantity', () => {
  assert.equal(unofficialCompensationAmount({ fixed: true, lumpSumPrice: 75, quantity: 100, deliveredQuantity: 80, unitPrice: 2 }), -75);
  assert.equal(unofficialCompensationAmount({ fixed: false, quantity: 100, deliveredQuantity: 80, unitPrice: 2 }), -160);
  assert.equal(unofficialCompensationAmount({ fixed: false, quantity: 100, deliveredQuantity: 0, unitPrice: 2 }), -200);
});

test('only Finance, Administrators and the General Manager may change Salesforce compensation status', () => {
  assert.equal(canManageUnofficialCompensationStatus('administrator'), true);
  assert.equal(canManageUnofficialCompensationStatus('finance'), true);
  assert.equal(canManageUnofficialCompensationStatus('general_manager'), true);
  assert.equal(canManageUnofficialCompensationStatus('manager'), false);
  assert.equal(canManageUnofficialCompensationStatus('interoffice'), false);
  assert.equal(canManageUnofficialCompensationStatus(''), false);
});

test('claims and recoveries group by Account, Contact and currency without cross-currency netting', () => {
  const result = buildUnofficialCompensationWorkspace({
    accounts: [account],
    claims: [
      { Id: 'a011', Account__c: account.Id, Contact__c: '0031', Contact__r: { Name: 'Amy' }, Amount__c: 150, CurrencyIsoCode: 'USD', Deadline_Date__c: '2026-07-20', Status__c: 'Opened', Buyer_Supplier_Trader__c: 'Vincent', LastModifiedDate: '2026-07-01T00:00:00Z' },
      { Id: 'a012', Account__c: account.Id, Contact__c: '0031', Contact__r: { Name: 'Amy' }, Amount__c: 80, CurrencyIsoCode: 'EUR', Deadline_Date__c: '2026-08-05', Status__c: 'Closed', Buyer_Supplier_Trader__c: 'Vincent' },
    ],
    recoveries: [
      { Id: 'a021', Account__c: account.Id, Contact__c: '0031', Contact__r: { Name: 'Amy' }, Amount__c: -40, CurrencyIsoCode: 'USD', STEM__c: 'a031', STEM__r: { Name: 'HK260001T' }, CreatedDate: '2026-07-25T00:00:00Z' },
      { Id: 'a022', Account__c: account.Id, Contact__c: '0031', Contact__r: { Name: 'Amy' }, Amount__c: -100, CurrencyIsoCode: 'EUR', STEM__c: 'a032', STEM__r: { Name: 'HK260002T' } },
    ],
    today: '2026-08-01',
  });

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].groups.length, 2);
  assert.deepEqual(result.accounts[0].currencyTotals.map((row) => [row.currencyIsoCode, row.outstandingAmount]), [['EUR', 0], ['USD', 110]]);
  assert.deepEqual(result.accounts[0].currencyTotals.map((row) => [row.currencyIsoCode, row.netAmount]), [['EUR', -20], ['USD', 110]]);
  assert.equal(result.accounts[0].balanceState, 'outstanding');
  assert.equal(result.accounts[0].overdueDays, 12);
  assert.equal(result.summary.outstandingAccountCount, 1);
  assert.equal(result.accounts[0].groups.find((row) => row.currencyIsoCode === 'USD').recoveredAmount, 40);
  assert.equal(result.accounts[0].groups.find((row) => row.currencyIsoCode === 'EUR').claims[0].amount, 80);
  assert.equal(result.accounts[0].groups.find((row) => row.currencyIsoCode === 'EUR').claims[0].status, 'Closed');
  assert.deepEqual(result.summary.currencyTotals.map((row) => [row.currencyIsoCode, row.outstandingAmount]), [['EUR', 0], ['USD', 110]]);
});

test('incomplete and mismatched historical records stay visible as data issues', () => {
  const result = buildUnofficialCompensationWorkspace({
    accounts: [{ ...account, Compensation_Status__c: 'Closed', Agreed_Compensation_Total__c: 0, Unofficial_Compensation_Total__c: 0 }],
    claims: [{ Id: 'a011', Account__c: account.Id, Amount__c: 50, CurrencyIsoCode: 'USD', Status__c: 'Opened' }],
    recoveries: [],
    today: '2026-08-01',
  });
  assert.equal(result.summary.dataIssueCount, 1);
  assert.match(result.accounts[0].issues.join(' '), /deadline is missing/i);
  assert.match(result.accounts[0].issues.join(' '), /PIC is missing/i);
  assert.match(result.accounts[0].issues.join(' '), /status does not match/i);
  assert.match(result.accounts[0].issues.join(' '), /roll-up totals do not match/i);
});

test('inactive Accounts and their related compensation history stay hidden', () => {
  const result = buildUnofficialCompensationWorkspace({
    accounts: [{ ...account, Inactive_Suspended__c: true }],
    claims: [{ Id: 'a011', Account__c: account.Id, Account__r: { ...account, Inactive_Suspended__c: true }, Amount__c: 50, CurrencyIsoCode: 'USD', Status__c: 'Opened' }],
    recoveries: [],
    today: '2026-08-01',
  });
  assert.equal(result.accounts.length, 0);
});

test('Unofficial Compensation is service-only, permissioned, navigable and dispute-linked', async () => {
  const [migration, server, service, page, layout, app, authModules, disputePage] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260801092222_unofficial_compensation_monitoring.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_unofficialCompensationService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/UnofficialCompensation.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/authModules.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/DisputeWorkflow.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /'unofficial_compensation'/);
  assert.match(migration, /where source\.module_id = 'buyer_invoices'/i);
  assert.match(migration, /create table public\.unofficial_compensation_operations/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.unofficial_compensation_operations from public, anon, authenticated/);
  assert.match(migration, /linked_agreed_compensation_id/);
  assert.match(server, /unofficialCompensationRecoveryCreate: \['unofficial_compensation'\]/);
  assert.match(server, /assertDisputeUocClaimsReadyForClosure/);
  assert.match(server, /requireOpen: false/);
  assert.match(service, /\['Buyers_Broker__c', 'Buyer_Broker__c'\]/);
  assert.match(service, /schema\.lineBuyerBrokerFields\.map/);
  assert.match(page, /Outstanding Accounts/);
  assert.match(page, /Closed \/ Settled/);
  assert.match(page, /Data Issues/);
  assert.match(page, /accountClKeyLabel/);
  assert.match(page, /Record UOC Recovery/);
  assert.match(page, /Manage Agreed Compensation/);
  assert.match(page, /Open New Claim/);
  assert.match(page, /canChangeStatus/);
  assert.doesNotMatch(page, /onClick=\{\(\) => openClaim\(account\.accountId\)\}/);
  assert.match(server, /canChangeSalesforceStatus: canManageUnofficialCompensationStatus/);
  assert.match(server, /Only Finance, an Administrator, or the General Manager can change Unofficial Compensation status in Salesforce/);
  assert.match(page, /claimDisplayLabel\(claim\)/);
  assert.match(page, /recoveryDisplayLabel\(recovery\)/);
  assert.doesNotMatch(page, />\{claim\.name \|\|/);
  assert.doesNotMatch(page, />\{recovery\.name \|\|/);
  assert.match(layout, /id: 'cross_functions'[\s\S]*payment_collections[\s\S]*disputes[\s\S]*unofficial_compensation[\s\S]*brokers/);
  assert.match(app, /path="\/unofficial-compensation"/);
  assert.match(authModules, /id: 'unofficial_compensation'/);
  assert.match(disputePage, /CompensationClaimLinkModal/);
  assert.match(disputePage, /Agreed Compensation claim required before closure/);
});
