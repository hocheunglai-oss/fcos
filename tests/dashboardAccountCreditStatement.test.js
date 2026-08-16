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
  resolveCreditSnapshotCandidate,
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
  assert.equal(statement.chart.points[0].individualExposure, -25);
  assert.equal(statement.chart.points.at(-1).individualExposure, 0);
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
  assert.equal(statement.chart.points[0].individualExposure, 100);
  assert.equal(statement.chart.points[0].groupExposure, 250);
  assert.equal(statement.chart.points.at(-1).individualExposure, 0);
  assert.equal(statement.chart.points.at(-1).groupExposure, 0);

  const mismatched = buildAccountCreditStatement({
    today: '2026-08-16', account: { Id: accountId, Name: 'BUYER A', CL_Category__c: 'Individual', CL_Individual__c: 200, CL_Used_Customer__c: 90 },
    openStems: [{ Id: 'a01000000000001AAA', Account__c: accountId, QLIK_Receivable_Balance__c: 100, Invoice_Due_Date__c: '2026-09-01' }],
  });
  assert.equal(mismatched.reconciliation.individual.matches, false);
  assert.equal(mismatched.chart.points[0].individualExposure, null);
});

test('Achieve Bunker unique same-name snapshot produces the confirmed five-step exposure forecast', () => {
  const selected = {
    Id: accountId,
    Name: 'Achieve  Bunker Ltd',
    CreatedDate: '2021-04-06T00:00:00.000Z',
    Company_Code__c: 'HKACHIEVE BUNKER',
    CL_Category__c: 'Individual',
    CL_Individual__c: 500_000,
    CL_Group__c: null,
    CL_Special__c: null,
    CL_Special_Group__c: null,
    CL_Used_Customer__c: 39_600,
    CL_Used_Group__c: 39_600,
  };
  const creditRecord = {
    Id: '001000000000005AAA',
    Name: 'ACHIEVE BUNKER LTD',
    CreatedDate: '2026-01-07T00:00:00.000Z',
    Company_Code__c: 'HKACHIEVE BUNKER LTD',
    CL_Category__c: 'Individual',
    CL_Individual__c: 500_000,
    CL_Group__c: null,
    CL_Special__c: null,
    CL_Special_Group__c: null,
    CL_Used_Customer__c: 1_348_401.87,
    CL_Used_Group__c: 1_348_401.87,
  };
  const openStems = [
    { Id: 'a01000000000011AAA', Name: 'AUG RELEASE', CreatedDate: '2026-02-01T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 231_441.19, Invoice_Due_Date__c: '2026-08-20' },
    { Id: 'a01000000000012AAA', Name: 'SEP 10 RELEASE', CreatedDate: '2026-03-01T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 256_800, Invoice_Due_Date__c: '2026-09-10' },
    { Id: 'a01000000000013AAA', Name: 'SEP 11 RELEASE', CreatedDate: '2026-04-01T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 214_125, Invoice_Due_Date__c: '2026-09-11' },
    { Id: 'a01000000000014AAA', Name: 'SEP 22 RELEASE', CreatedDate: '2026-05-01T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 641_980, Invoice_Due_Date__c: '2026-09-22' },
    { Id: 'a01000000000015AAA', Name: 'HELGOLAND', CreatedDate: '2026-06-01T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 4_055.68, Invoice_Due_Date__c: '2026-08-01' },
    { Id: 'a01000000000016AAA', Name: 'LEGACY WINDOW', CreatedDate: '2025-12-01T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 3_314_331.79, Invoice_Due_Date__c: '2026-09-30' },
  ];
  const resolution = resolveCreditSnapshotCandidate({
    selectedAccount: selected,
    candidates: [
      creditRecord,
      { ...creditRecord, Id: '001000000000006AAA', Company_Code__c: 'INCOMPATIBLE', CL_Individual__c: 300_000 },
    ],
    openStems,
  });
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.candidate.Id, creditRecord.Id);
  assert.equal(resolution.windowStart, '2026-01-07');
  assert.equal(resolution.windowStems.length, 5);

  const statement = buildAccountCreditStatement({
    today: '2026-08-17',
    account: selected,
    creditAccount: creditRecord,
    creditResolution: { mode: 'same_name_fallback', accountId: creditRecord.Id, clKey: creditRecord.Company_Code__c, reconciliationWindowStart: resolution.windowStart },
    openStems: resolution.windowStems,
    statementStems: resolution.windowStems,
  });
  const exposureByDate = Object.fromEntries(statement.chart.points
    .filter((point) => !point.residualPlateau)
    .map((point) => [point.date, point.individualExposure]));
  assert.deepEqual(exposureByDate, {
    '2026-08-17': 1_348_401.87,
    '2026-08-20': 1_116_960.68,
    '2026-09-10': 860_160.68,
    '2026-09-11': 646_035.68,
    '2026-09-22': 4_055.68,
  });
  assert.equal(statement.chart.points.at(-1).individualExposure, 4_055.68);
  assert.equal(statement.chart.undatedExposure.individual, 4_055.68);
  assert.equal(statement.chart.undatedStemCount, 1);
  assert.equal(statement.chart.undatedStems[0].stemName, 'HELGOLAND');
});

test('same-name credit fallback fails closed when more than one compatible snapshot reconciles', () => {
  const selected = { Id: accountId, Name: 'Buyer A', CL_Category__c: 'Individual', CL_Individual__c: 100 };
  const openStems = [{ Id: 'a01000000000021AAA', CreatedDate: '2026-01-10T00:00:00Z', Account__c: accountId, QLIK_Receivable_Balance__c: 50 }];
  const candidate = { Name: ' buyer   a ', CreatedDate: '2026-01-01T00:00:00Z', CL_Category__c: 'Individual', CL_Individual__c: 100, CL_Used_Customer__c: 50, CL_Used_Group__c: 50 };
  const resolution = resolveCreditSnapshotCandidate({
    selectedAccount: selected,
    candidates: [{ ...candidate, Id: '001000000000007AAA' }, { ...candidate, Id: '001000000000008AAA' }],
    openStems,
  });
  assert.equal(resolution.status, 'ambiguous');
  assert.equal(resolution.matches.length, 2);
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
  assert.match(statement, /data\.group && series\.group && data\.reconciliation\.group\.matches/);
  assert.match(statement, /\{result\.group \? <button type="button" aria-pressed=\{series\.group\}/);
  assert.match(statement, /\{result\.group \? <ReconciliationBadge label="GROUP"/);
});
