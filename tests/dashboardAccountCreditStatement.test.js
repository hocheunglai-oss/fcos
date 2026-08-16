import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  accountCreditBalances,
  buildAccountCreditStatement,
  buildStemCreditRelease,
  decodeAccountCreditCursor,
  encodeAccountCreditCursor,
  reconcileCreditExposure,
  selectUltimateCreditGroup,
} from '../api/_dashboardAccountCreditStatement.js';

const accountId = '001000000000001AAA';
const groupId = '001000000000002AAA';
const otherAccountId = '001000000000003AAA';

test('credit category formulas preserve Salesforce individual, group, and special constraints', () => {
  assert.deepEqual(accountCreditBalances({ category: 'Individual', individualLimit: 100, usedCustomer: 30 }), {
    individualCapacity: 100, groupCapacity: null, individualBalance: 70, groupBalance: null, calculatedAvailable: 70,
  });
  assert.equal(accountCreditBalances({ category: 'Group', groupLimit: 500, usedGroup: 125 }).calculatedAvailable, 375);
  assert.equal(accountCreditBalances({
    category: 'Special', specialIndividualLimit: 175, groupLimit: 500, specialGroupLimit: 50, usedCustomer: 20, usedGroup: 420,
  }).calculatedAvailable, 130);
  assert.equal(accountCreditBalances({ category: 'Special', groupLimit: 500, usedCustomer: 20, usedGroup: 100 }).calculatedAvailable, null);
});

test('credit exposure reconciliation uses a one-unit tolerance and suppresses incomplete scopes', () => {
  assert.equal(reconcileCreditExposure(100, 101).matches, true);
  assert.equal(reconcileCreditExposure(100, 101.01).matches, false);
  assert.deepEqual(reconcileCreditExposure(100, 100, { complete: false }), {
    complete: false, matches: false, expected: 100, reconstructed: 100, difference: null, tolerance: 1,
  });
});

test('ultimate GROUP ancestry chooses the highest named GROUP parent', () => {
  assert.equal(selectUltimateCreditGroup([
    { Id: accountId, Name: 'BUYER A' },
    { Id: '001000000000004AAA', Name: 'GROUP - LOCAL' },
    { Id: groupId, Name: 'GROUP - GLOBAL' },
  ]).Id, groupId);
});

test('release evidence applies payment, scheduled cashflow, invoice due, and overdue precedence', () => {
  const release = buildStemCreditRelease({
    accountId,
    today: '2026-08-16',
    stem: {
      Id: 'a01000000000001AAA', Name: 'STEM-1', Account__c: accountId,
      QLIK_Receivable_Balance__c: 100, Invoice_Due_Date__c: '2026-10-01',
    },
    payments: [
      { Id: 'a02000000000001AAA', Date__c: '2026-08-01', Amount__c: 40 },
      { Id: 'a02000000000002AAA', Date__c: '2026-08-20', Amount__c: 25 },
    ],
    cashflows: [{ Id: 'a03000000000001AAA', Scheduled_Payment_Date__c: '2026-09-01', Scheduled_Payment_Amount__c: 30 }],
  });
  assert.deepEqual(release.actualReleases.map(({ date, amount }) => ({ date, amount })), [{ date: '2026-08-01', amount: 40 }]);
  assert.deepEqual(release.forecastEvents.map(({ date, amount, source }) => ({ date, amount, source })), [
    { date: '2026-08-20', amount: 25, source: 'confirmed_payment' },
    { date: '2026-09-01', amount: 30, source: 'scheduled_payment' },
    { date: '2026-10-01', amount: 45, source: 'stem_invoice_due' },
  ]);

  const overdue = buildStemCreditRelease({
    today: '2026-08-16', accountId,
    stem: { Id: 'a01000000000002AAA', Account__c: accountId, QLIK_Receivable_Balance__c: 50, Invoice_Due_Date__c: '2026-08-01' },
  });
  assert.equal(overdue.releaseDate, null);
  assert.equal(overdue.releaseSource, 'past_due_unknown');
  assert.equal(overdue.missedReleaseDate, '2026-08-01');
});

test('expected delivery plus payment term is the final dated forecast fallback', () => {
  const release = buildStemCreditRelease({
    today: '2026-08-16', accountId,
    stem: { Id: 'a01000000000003AAA', Account__c: accountId, QLIK_Receivable_Balance__c: 70, Expected_Delivery_Date__c: '2026-08-20', Payment_Term_Number__c: 30 },
  });
  assert.equal(release.releaseDate, '2026-09-19');
  assert.equal(release.releaseSource, 'expected_delivery_term');
});

test('signed negative receivables remain signed in exposure and projected balance movement', () => {
  const statement = buildAccountCreditStatement({
    today: '2026-08-16',
    account: { Id: accountId, Name: 'BUYER A', CL_Category__c: 'Individual', CL_Individual__c: 100, CL_Used_Customer__c: -25 },
    openStems: [{ Id: 'a01000000000004AAA', Account__c: accountId, QLIK_Receivable_Balance__c: -25, Invoice_Due_Date__c: '2026-09-01' }],
  });
  assert.equal(statement.reconciliation.individual.matches, true);
  assert.equal(statement.chart.points[0].individualBalance, 125);
  assert.equal(statement.chart.points.at(-1).individualBalance, 100);
  assert.equal(statement.releases[0].forecastEvents[0].amount, -25);
});

test('statement separates selected-account and other-group releases and independently suppresses mismatches', () => {
  const statement = buildAccountCreditStatement({
    today: '2026-08-16',
    account: {
      Id: accountId, Name: 'BUYER A', CL_Category__c: 'Special', CL_Individual__c: 200,
      CL_Special__c: 200, CL_Group__c: 500, CL_Special_Group__c: 0,
      CL_Used_Customer__c: 100, CL_Used_Group__c: 251, CL_Available_Credit__c: 100,
    },
    group: { Id: groupId, Name: 'GROUP - GLOBAL' },
    groupMembers: [{ Id: groupId }, { Id: accountId }, { Id: otherAccountId }],
    openStems: [
      { Id: 'a01000000000001AAA', Name: 'A', Account__c: accountId, QLIK_Receivable_Balance__c: 100, Invoice_Due_Date__c: '2026-09-01' },
      { Id: 'a01000000000002AAA', Name: 'B', Account__c: otherAccountId, QLIK_Receivable_Balance__c: 150, Invoice_Due_Date__c: '2026-09-02' },
    ],
    statementStems: [],
  });
  assert.equal(statement.reconciliation.individual.matches, true);
  assert.equal(statement.reconciliation.group.matches, true);
  assert.equal(statement.chart.points.at(-1).individualBalance, 200);
  assert.equal(statement.chart.points.at(-1).groupBalance, 499);

  const mismatched = buildAccountCreditStatement({
    today: '2026-08-16', account: { Id: accountId, Name: 'BUYER A', CL_Category__c: 'Individual', CL_Individual__c: 200, CL_Used_Customer__c: 90 },
    openStems: [{ Id: 'a01000000000001AAA', Account__c: accountId, QLIK_Receivable_Balance__c: 100, Invoice_Due_Date__c: '2026-09-01' }],
  });
  assert.equal(mismatched.reconciliation.individual.matches, false);
  assert.equal(mismatched.chart.points[0].individualBalance, null);
});

test('mixed currencies stay separate by row and suppress all combined projections', () => {
  const statement = buildAccountCreditStatement({
    today: '2026-08-16',
    account: { Id: accountId, Name: 'BUYER A', CurrencyIsoCode: 'USD', CL_Category__c: 'Individual', CL_Individual__c: 200, CL_Used_Customer__c: 100 },
    group: { Id: groupId, Name: 'GROUP - GLOBAL' },
    openStems: [
      { Id: 'a01000000000001AAA', Account__c: accountId, CurrencyIsoCode: 'USD', QLIK_Receivable_Balance__c: 60, Invoice_Due_Date__c: '2026-09-01' },
      { Id: 'a01000000000002AAA', Account__c: otherAccountId, CurrencyIsoCode: 'EUR', QLIK_Receivable_Balance__c: 40, Invoice_Due_Date__c: '2026-09-01' },
    ],
    statementStems: [],
  });
  assert.deepEqual(statement.currencies, ['EUR', 'USD']);
  assert.deepEqual(statement.exposureByCurrency, { EUR: { individual: 0, group: 40 }, USD: { individual: 60, group: 60 } });
  assert.equal(statement.reconciliation.individual.reconstructed, null);
  assert.equal(statement.chart.exactEventCount, 0);
});

test('credit cursors reject malformed values and round-trip directory and statement state', () => {
  const directory = encodeAccountCreditCursor({ kind: 'directory', name: 'BUYER A', id: accountId });
  assert.deepEqual(decodeAccountCreditCursor(directory), { kind: 'directory', name: 'BUYER A', id: accountId });
  const statement = encodeAccountCreditCursor({ kind: 'statement', scope: 'open_recent', offset: 50 });
  assert.deepEqual(decodeAccountCreditCursor(statement), { kind: 'statement', scope: 'open_recent', offset: 50 });
  assert.equal(decodeAccountCreditCursor('bad'), null);
});

test('Salesforce loader is buyer-leg only and does not use supplier child relationships', async () => {
  const source = await readFile(new URL('../api/_dashboardAccountCreditStatementService.js', import.meta.url), 'utf8');
  assert.match(source, /Account__c IN \(\$\{ids/);
  assert.match(source, /Id IN \(SELECT Account__c FROM STEM__c WHERE Account__c != null\)/);
  assert.doesNotMatch(source, /STEM_Line_Item__c|STEM_Extra_Cost__c|Buyer_Broker__c|Supplier_Broker__c/);
  assert.match(source, /QLIK_Receivable_Balance__c != 0/);
});

test('credit statement handlers are authenticated server-cached reads and the UI stays lazy', async () => {
  const [api, policies, dashboard, insight, directory, statement] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlerPolicyRegistry.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountInsightModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountCreditDirectory.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountCreditStatement.jsx', import.meta.url), 'utf8'),
  ]);
  for (const handler of ['dashboardAccountCreditDirectory', 'dashboardAccountCreditStatement']) {
    assert.equal(api.includes(`${handler}: ['dashboard']`), true);
    assert.match(api, new RegExp(`\\b${handler},`));
    assert.match(policies, new RegExp(`${handler}: readPolicy\\(\\{\"cache\":\"server\"`));
  }
  assert.match(dashboard, /lazy\(\(\) => import\('@\/components\/dashboard\/AccountCreditDirectory'\)\)/);
  assert.match(insight, /lazy\(\(\) => import\('@\/components\/dashboard\/AccountCreditStatement'\)\)/);
  assert.match(insight, /account\.initialTab === 'credit'/);
  assert.match(dashboard, /role: 'buyer', initialTab: 'credit'/);
  assert.match(directory, /dashboardAccountCreditDirectory/);
  assert.match(statement, /Open \+ 12 months settled/);
  assert.match(statement, /aria-pressed=\{series\.account\}/);
  assert.match(statement, /aria-pressed=\{series\.group\}/);
});
