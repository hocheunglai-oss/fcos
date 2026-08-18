import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  accountCreditBalances,
  buildAccountCreditStatement,
  buildStemCreditRelease,
  CREDIT_EXPOSURE_DELIVERY_START,
  creditExposureDeliveryDate,
  decodeAccountCreditCursor,
  encodeAccountCreditCursor,
  expectedBuyerInvoiceEstimate,
  isCreditExposureStemEligible,
  normalizeAccountCreditScope,
  reconcileCreditExposure,
  resolveCreditSnapshotCandidate,
  selectUltimateCreditGroup,
} from '../api/_dashboardAccountCreditStatement.js';
import { dashboardAccountCreditStatementServiceInternals } from '../api/_dashboardAccountCreditStatementService.js';

const accountId = '001000000000001AAA';
const groupId = '001000000000002AAA';
const otherAccountId = '001000000000003AAA';
const { compareStatementStems } = dashboardAccountCreditStatementServiceInternals;

test('credit category formulas preserve Salesforce individual, group, and special constraints', () => {
  const individual = accountCreditBalances({ category: 'Individual', individualLimit: 100, usedCustomer: 30 });
  assert.equal(individual.individualCapacity, 100);
  assert.equal(individual.individualBalance, 70);
  assert.equal(individual.groupCapacity, null);
  assert.equal(individual.calculatedAvailable, 70);
  assert.equal(individual.policy.code, 'individual_only');
  assert.deepEqual(individual.referenceLimits, [{ key: 'individual_limit', scope: 'account', label: 'Individual limit', value: 100 }]);

  const group = accountCreditBalances({ category: 'Group', individualLimit: 0, specialIndividualLimit: 0, groupLimit: 500, usedCustomer: 30, usedGroup: 125 });
  assert.equal(group.individualCapacity, null);
  assert.equal(group.individualBalance, null);
  assert.equal(group.groupCapacity, 500);
  assert.equal(group.calculatedAvailable, 375);
  assert.equal(group.policy.code, 'group_shared_uncapped');
  assert.deepEqual(group.referenceLimits, [{ key: 'group_limit', scope: 'group', label: 'GROUP limit', value: 500 }]);

  const special = accountCreditBalances({
    category: 'Special', specialIndividualLimit: 175, groupLimit: 500, specialGroupLimit: 50, usedCustomer: 20, usedGroup: 420,
  });
  assert.equal(special.calculatedAvailable, 130);
  assert.equal(special.policy.code, 'group_shared_special_cap');
  assert.deepEqual(special.referenceLimits, [
    { key: 'special_account_cap', scope: 'account', label: 'Special Account cap', value: 175 },
    { key: 'special_group_capacity', scope: 'group', label: 'GROUP capacity', value: 550 },
  ]);

  const legacyFallback = accountCreditBalances({ category: 'Special', individualLimit: 80, groupLimit: 500, usedCustomer: 20, usedGroup: 100 });
  assert.equal(legacyFallback.calculatedAvailable, 80);
  assert.equal(legacyFallback.policy.code, 'special_legacy_fallback');
});

test('calculated availability comparison uses the one-dollar tolerance', () => {
  const matching = accountCreditBalances({ category: 'Group', groupLimit: 500, usedGroup: 125, salesforceAvailable: 374 });
  assert.equal(matching.calculatedAvailable, 375);
  assert.equal(matching.availableComparison.difference, 1);
  assert.equal(matching.availableComparison.materiallyDifferent, false);

  const different = accountCreditBalances({ category: 'Group', groupLimit: 500, usedGroup: 125, salesforceAvailable: 373.99 });
  assert.equal(different.availableComparison.difference, 1.01);
  assert.equal(different.availableComparison.materiallyDifferent, true);
});

test('COSCO Group policy ignores zero individual and special limits', () => {
  const cosco = accountCreditBalances({
    category: 'Group', individualLimit: 0, specialIndividualLimit: 0,
    groupLimit: 20_000_000, specialGroupLimit: 0,
    usedCustomer: 6_495_272, usedGroup: 8_187_257, salesforceAvailable: 11_812_743,
  });
  assert.equal(cosco.policy.code, 'group_shared_uncapped');
  assert.equal(cosco.individualCapacity, null);
  assert.equal(cosco.groupCapacity, 20_000_000);
  assert.equal(cosco.calculatedAvailable, 11_812_743);
  assert.equal(cosco.availableComparison.materiallyDifferent, false);
  assert.deepEqual(cosco.referenceLimits, [{ key: 'group_limit', scope: 'group', label: 'GROUP limit', value: 20_000_000 }]);
});

test('credit exposure reconciliation uses a one-unit tolerance and suppresses incomplete scopes', () => {
  assert.equal(reconcileCreditExposure(100, 101).matches, true);
  assert.equal(reconcileCreditExposure(100, 101.01).matches, false);
  assert.deepEqual(reconcileCreditExposure(100, 100, { complete: false }), {
    complete: false, matches: false, expected: 100, reconstructed: 100, difference: null, tolerance: 1,
  });
});

test('credit exposure defaults to open only and starts from the 2026 delivery cutoff', () => {
  assert.equal(normalizeAccountCreditScope(), 'open');
  assert.equal(normalizeAccountCreditScope('unexpected'), 'open');
  assert.equal(normalizeAccountCreditScope('open_recent'), 'open_recent');
  assert.equal(CREDIT_EXPOSURE_DELIVERY_START, '2026-01-01');
  assert.equal(creditExposureDeliveryDate({ Delivery_Date__c: '2025-12-31', Expected_Delivery_Date__c: '2026-01-02' }), '2025-12-31');
  assert.equal(creditExposureDeliveryDate({ Expected_Delivery_Date__c: '2026-01-02' }), '2026-01-02');
  assert.equal(isCreditExposureStemEligible({ Delivery_Date__c: '2025-12-31' }), false);
  assert.equal(isCreditExposureStemEligible({ Delivery_Date__c: '2026-01-01' }), true);
  assert.equal(isCreditExposureStemEligible({ Expected_Delivery_Date__c: '2026-01-02' }), true);
  assert.equal(isCreditExposureStemEligible({}), false);
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
  assert.equal(statement.chart.undatedAccountStemCount, 1);
  assert.equal(statement.chart.undatedGroupStemCount, 1);
  assert.equal(statement.chart.undatedStems[0].stemName, 'HELGOLAND');
});

test('COSCO SHIPPING resolves a split same-name snapshot and lineage window without including stale residuals', () => {
  const coscoGroup = { Id: '001000000000044AAA', Name: 'GROUP - COSCO' };
  const selected = {
    Id: '001000000000041AAA',
    Name: 'COSCO SHIPPING (SINGAPORE) PETROLEUM PTE LTD',
    CreatedDate: '2023-10-23T07:57:37.000Z',
    Company_Code__c: 'HKCOSCO ACTIVE',
    CL_Category__c: 'Group',
    CL_Individual__c: 0,
    CL_Special__c: 0,
    CL_Group__c: 10_000,
    CL_Special_Group__c: 0,
    CL_Used_Customer__c: 700,
    CL_Used_Group__c: 800,
  };
  const creditSnapshot = {
    ...selected,
    Id: '001000000000042AAA',
    CreatedDate: '2023-10-20T12:43:14.000Z',
    Company_Code__c: 'HKCOSCO SNAPSHOT',
    Inactive_Suspended__c: true,
    CL_Used_Customer__c: 600,
    CL_Used_Group__c: 600,
  };
  const lineageBoundary = {
    ...selected,
    Id: '001000000000043AAA',
    CreatedDate: '2025-12-12T03:32:29.000Z',
    Company_Code__c: 'COSCO LINEAGE BOUNDARY',
    Inactive_Suspended__c: true,
    CL_Used_Customer__c: 0,
    CL_Used_Group__c: 600,
  };
  const staleStem = { Id: 'a01000000000041AAA', Name: 'LEGACY RESIDUAL', CreatedDate: '2024-11-26T09:58:01.000Z', Account__c: selected.Id, QLIK_Receivable_Balance__c: 40, Invoice_Due_Date__c: '2025-01-05' };
  const currentStems = [
    { Id: 'a01000000000042AAA', Name: 'CURRENT ONE', CreatedDate: '2026-08-13T10:44:49.000Z', Account__c: selected.Id, QLIK_Receivable_Balance__c: 100, Invoice_Due_Date__c: '2026-09-18' },
    { Id: 'a01000000000043AAA', Name: 'CURRENT TWO', CreatedDate: '2026-08-11T10:51:01.000Z', Account__c: selected.Id, QLIK_Receivable_Balance__c: 200, Invoice_Due_Date__c: '2026-09-23' },
    { Id: 'a01000000000044AAA', Name: 'CURRENT THREE', CreatedDate: '2026-01-02T00:00:00.000Z', Account__c: selected.Id, QLIK_Receivable_Balance__c: 300.09, Invoice_Due_Date__c: '2026-09-30' },
  ];
  const groupByCandidate = Object.fromEntries([creditSnapshot, lineageBoundary].map((candidate) => [candidate.Id.slice(0, 15), coscoGroup]));
  const resolution = resolveCreditSnapshotCandidate({
    selectedAccount: selected,
    selectedGroup: coscoGroup,
    candidates: [selected, creditSnapshot, lineageBoundary],
    candidateGroupsById: groupByCandidate,
    openStems: [staleStem, ...currentStems],
  });
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.candidate.Id, creditSnapshot.Id);
  assert.equal(resolution.windowSource.Id, lineageBoundary.Id);
  assert.equal(resolution.windowStart, '2025-12-12');
  assert.deepEqual(resolution.windowStems.map((stem) => stem.Id), currentStems.map((stem) => stem.Id));

  const statement = buildAccountCreditStatement({
    today: '2026-08-17',
    account: selected,
    creditAccount: creditSnapshot,
    group: coscoGroup,
    groupMembers: [coscoGroup, selected],
    openStems: resolution.windowStems,
    statementStems: [staleStem, ...currentStems],
  });
  assert.equal(statement.reconciliation.individual.matches, true);
  assert.equal(statement.reconciliation.group.matches, true);
  assert.equal(statement.chart.points[0].individualExposure, 600.09);
  assert.equal(statement.chart.points[0].groupExposure, 600.09);
  assert.equal(statement.rows.find((row) => row.stemId === staleStem.Id).inCreditProjection, false);
  assert.equal(statement.rows.find((row) => row.stemId === currentStems[0].Id).inCreditProjection, true);
  assert.equal(statement.warnings.some((warning) => /does not reconcile/i.test(warning)), false);
  assert.deepEqual(statement.projectionWarnings, []);
});

test('COSCO SHIPPING collapses equivalent lineage windows to the latest unique boundary', () => {
  const coscoGroup = { Id: '001000000000054AAA', Name: 'GROUP - COSCO' };
  const selected = {
    Id: '001000000000051AAA', Name: 'COSCO SHIPPING (SINGAPORE) PETROLEUM PTE LTD', CreatedDate: '2023-10-23T07:57:37.000Z',
    CL_Category__c: 'Group', CL_Individual__c: 0, CL_Special__c: 0, CL_Group__c: 20_000_000, CL_Special_Group__c: 0,
    CL_Used_Customer__c: 6_495_272, CL_Used_Group__c: 8_187_257,
  };
  const creditSnapshot = {
    ...selected, Id: '001000000000052AAA', CreatedDate: '2023-10-20T12:43:14.000Z', Inactive_Suspended__c: true,
    CL_Used_Customer__c: 6_111_903, CL_Used_Group__c: 6_111_903,
  };
  const latestBoundary = {
    ...selected, Id: '001000000000053AAA', CreatedDate: '2025-12-12T03:32:29.000Z', Inactive_Suspended__c: true,
    CL_Used_Customer__c: 0, CL_Used_Group__c: 6_111_903,
  };
  const currentStems = [
    { Id: 'a01000000000051AAA', CreatedDate: '2026-01-10T00:00:00.000Z', Account__c: selected.Id, QLIK_Receivable_Balance__c: 3_000_000 },
    { Id: 'a01000000000052AAA', CreatedDate: '2026-08-10T00:00:00.000Z', Account__c: selected.Id, QLIK_Receivable_Balance__c: 3_111_903.09 },
  ];
  const candidateGroupsById = Object.fromEntries([creditSnapshot, latestBoundary].map((candidate) => [candidate.Id.slice(0, 15), coscoGroup]));
  const resolution = resolveCreditSnapshotCandidate({
    selectedAccount: selected,
    selectedGroup: coscoGroup,
    candidates: [selected, creditSnapshot, latestBoundary],
    candidateGroupsById,
    openStems: currentStems,
  });
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.candidate.Id, creditSnapshot.Id);
  assert.equal(resolution.windowSource.Id, latestBoundary.Id);
  assert.equal(resolution.windowStart, '2025-12-12');
  assert.deepEqual(resolution.windowStems.map((stem) => stem.Id), currentStems.map((stem) => stem.Id));
});

test('undated residual counts keep selected Account and GROUP STEMs distinct', () => {
  const statement = buildAccountCreditStatement({
    today: '2026-08-17',
    account: { Id: accountId, Name: 'BUYER A', CL_Category__c: 'Group', CL_Group__c: 500, CL_Used_Customer__c: 100, CL_Used_Group__c: 250 },
    group: { Id: groupId, Name: 'GROUP - GLOBAL' },
    openStems: [
      { Id: 'a01000000000031AAA', Name: 'ACCOUNT UNDATED', Account__c: accountId, QLIK_Receivable_Balance__c: 100, Invoice_Due_Date__c: '2026-08-01' },
      { Id: 'a01000000000032AAA', Name: 'GROUP UNDATED', Account__c: otherAccountId, QLIK_Receivable_Balance__c: 150, Invoice_Due_Date__c: '2026-08-02' },
    ],
  });
  assert.equal(statement.chart.undatedExposure.individual, 100);
  assert.equal(statement.chart.undatedExposure.group, 250);
  assert.equal(statement.chart.undatedAccountStemCount, 1);
  assert.equal(statement.chart.undatedGroupStemCount, 2);
  assert.deepEqual(statement.chart.undatedAccountStems.map((stem) => stem.stemName), ['ACCOUNT UNDATED']);
  assert.deepEqual(statement.projectionWarnings, []);
  assert.equal(statement.releaseWarnings.length, 1);
});

test('statement rows expose only complete live final buyer-invoice totals for selection', () => {
  const stem = { Id: 'a01000000000051AAA', Name: 'INVOICED STEM', Account__c: accountId, Account__r: { Name: 'BUYER A' }, CurrencyIsoCode: 'USD', Delivery_Date__c: '2026-08-01', Total_Invoice_Amount__c: 125, QLIK_Receivable_Balance__c: 100 };
  const statement = buildAccountCreditStatement({
    today: '2026-08-17',
    account: { Id: accountId, Name: 'BUYER A', CL_Category__c: 'Individual', CL_Individual__c: 500, CL_Used_Customer__c: 100 },
    openStems: [stem],
    statementStems: [stem],
    buyerInvoicesByStem: {
      [stem.Id]: [
        { Id: 'a04000000000001AAA', Name: 'INV-1', Amount__c: 60, Invoice_Due_Date__c: '2026-09-01', LastModifiedDate: '2026-08-16T01:00:00Z' },
        { Id: 'a04000000000002AAA', Name: 'INV-2', Amount__c: 40, Invoice_Due_Date__c: '2026-09-03', LastModifiedDate: '2026-08-16T02:00:00Z' },
      ],
    },
  });
  const [row] = statement.rows;
  assert.equal(row.hasBuyerInvoice, true);
  assert.equal(row.buyerInvoiceCount, 2);
  assert.equal(row.buyerInvoiceAmount, 100);
  assert.equal(row.buyerInvoiceAmountComplete, true);
  assert.equal(row.buyerInvoiceDueDate, '2026-09-01');
  assert.equal(row.buyerInvoiceDaysUntilDue, 15);
  assert.equal(row.buyerInvoiceLastModifiedAt, '2026-08-16T02:00:00Z');
  assert.equal(row.statementExposureAmount, 100);
  assert.equal(row.statementExposureComplete, true);
  assert.equal(row.statementExposureSource, 'salesforce_qlik_receivable_balance');
  assert.equal(row.statementExposureBasis, 'salesforce_receivable_balance');

  const incomplete = buildAccountCreditStatement({
    today: '2026-08-17', account: { Id: accountId, Name: 'BUYER A' }, statementStems: [stem],
    buyerInvoicesByStem: { [stem.Id]: [{ Id: 'a04000000000003AAA', Name: 'INV-3', Amount__c: null }] },
  });
  assert.equal(incomplete.rows[0].hasBuyerInvoice, true);
  assert.equal(incomplete.rows[0].buyerInvoiceAmountComplete, false);
  assert.equal(incomplete.rows[0].buyerInvoiceAmount, null);

  const notIssued = buildAccountCreditStatement({
    today: '2026-08-17', account: { Id: accountId, Name: 'BUYER A' }, statementStems: [stem],
    cashflowsByStem: { [stem.Id]: [{ Id: 'a03000000000051AAA', Invoice_Due_Date__c: '2026-09-22' }] },
    expectedInvoiceLineItemsByStem: {
      [stem.Id]: [{ Id: 'a05000000000051AAA', STEM__c: stem.Id, Quantity__c: 125, Quantity_Delivered_Per_BDN__c: 0, Price_Per_Unit__c: 1, Total_Price__c: 0, Cancelled__c: false }],
    },
  });
  assert.equal(notIssued.rows[0].hasBuyerInvoice, false);
  assert.equal(notIssued.rows[0].buyerInvoiceDueDate, null);
  assert.equal(notIssued.rows[0].expectedBuyerInvoiceAmount, 125);
  assert.equal(notIssued.rows[0].expectedBuyerInvoiceAmountComplete, true);
  assert.equal(notIssued.rows[0].expectedBuyerInvoiceAmountSource, 'ordered_buyer_lines');
  assert.equal(notIssued.rows[0].expectedBuyerInvoiceAmountBasis, 'ordered_quantity');
  assert.equal(notIssued.rows[0].statementExposureAmount, 125);
  assert.equal(notIssued.rows[0].statementExposureComplete, true);
  assert.equal(notIssued.rows[0].statementExposureSource, 'ordered_buyer_lines');
  assert.equal(notIssued.rows[0].statementExposureBasis, 'ordered_quantity');
  assert.equal(notIssued.rows[0].expectedBuyerInvoiceDueDate, '2026-09-22');
  assert.equal(notIssued.rows[0].buyerInvoiceDaysUntilDue, null);
});

test('Not Issued Statement Evidence uses maximum range exposure while forecast exposure remains QLIK-based', () => {
  const stem = {
    Id: 'a01000000000071AAA', Name: 'RANGE STEM', Account__c: accountId,
    Delivery_Date__c: '2026-08-17', QLIK_Receivable_Balance__c: 165,
  };
  const result = buildAccountCreditStatement({
    today: '2026-08-17',
    account: { Id: accountId, Name: 'BUYER A' },
    openStems: [stem],
    statementStems: [stem],
    expectedInvoiceLineItemsByStem: {
      [stem.Id]: [{ Quantity__c: 50, Quantity_Max__c: 60, Is_Quantity_Range__c: true, Unit_Sell_At__c: 3, Cancelled__c: false }],
    },
  });
  assert.equal(result.rows[0].currentExposure, 165);
  assert.equal(result.rows[0].statementExposureAmount, 180);
  assert.equal(result.rows[0].statementExposureBasis, 'range_max_quantity');
  assert.equal(result.rows[0].statementExposureComplete, true);
  assert.equal(result.releases[0].currentExposure, 165);

  const incomplete = buildAccountCreditStatement({
    today: '2026-08-17',
    account: { Id: accountId, Name: 'BUYER A' },
    statementStems: [stem],
    expectedInvoiceLineItemsByStem: {
      [stem.Id]: [{ Quantity__c: 50, Quantity_Max__c: null, Is_Quantity_Range__c: true, Unit_Sell_At__c: 3, Cancelled__c: false }],
    },
  });
  assert.equal(incomplete.rows[0].statementExposureAmount, null);
  assert.equal(incomplete.rows[0].statementExposureComplete, false);
  assert.match(incomplete.rows[0].statementExposureBlockingReason, /lack an ordered quantity or sell price/i);
});

test('expected buyer invoice uses ordered and maximum range quantities instead of BDN quantities', () => {
  const estimate = expectedBuyerInvoiceEstimate({
    lineItems: [
      { Quantity__c: 100, Quantity_Delivered_Per_BDN__c: 0, Price_Per_Unit__c: 2, Total_Price__c: 0, Cancelled__c: false },
      { Quantity__c: 50, Quantity_Max__c: 60, Quantity_Delivered_Per_BDN__c: 0, Is_Quantity_Range__c: true, Unit_Sell_At__c: 3, Cancelled__c: false },
      { Quantity__c: 999, Price_Per_Unit__c: 999, Cancelled__c: true },
    ],
    extraCosts: [
      { Quantity__c: 1, Quantity_Range_Max__c: 2, Is_Quantity_Range__c: true, Unit_Price__c: 10, Line_Total__c: 0, Cancelled__c: false },
      { Unit_Price__c: null, Line_Total__c: 25, Cancelled__c: false },
    ],
  });
  assert.deepEqual(estimate, {
    amount: 425,
    complete: true,
    source: 'ordered_buyer_lines',
    basis: 'range_max_quantity',
    blockingReason: null,
  });

  const incomplete = expectedBuyerInvoiceEstimate({
    lineItems: [{ Quantity__c: 100, Quantity_Delivered_Per_BDN__c: 0, Price_Per_Unit__c: null, Unit_Sell_At__c: null, Cancelled__c: false }],
  });
  assert.equal(incomplete.amount, null);
  assert.equal(incomplete.complete, false);
  assert.match(incomplete.blockingReason, /lack an ordered quantity or sell price/i);
});

test('HK2627318T expected invoice acceptance calculation is USD 640,460 without a max-quantity basis', () => {
  const estimate = expectedBuyerInvoiceEstimate({
    lineItems: [
      { Quantity__c: 670, Unit_Sell_At__c: 806, Cancelled__c: false },
      { Quantity__c: 90, Unit_Sell_At__c: 1116, Cancelled__c: false },
    ],
    extraCosts: Array.from({ length: 4 }, () => ({ Unit_Price__c: null, Line_Total__c: 0, Cancelled__c: false })),
  });
  assert.deepEqual(estimate, {
    amount: 640460,
    complete: true,
    source: 'ordered_buyer_lines',
    basis: 'ordered_quantity',
    blockingReason: null,
  });
});

test('Statement Evidence delivery sorting uses actual date, expected fallback, nulls last, and stable ties', () => {
  const rows = [
    { Id: 'a01000000000075AAA', CreatedDate: '2026-08-15T00:00:00Z' },
    { Id: 'a01000000000072AAA', Expected_Delivery_Date__c: '2026-09-01', CreatedDate: '2026-08-01T00:00:00Z' },
    { Id: 'a01000000000074AAA', Delivery_Date__c: '2026-08-20', CreatedDate: '2026-08-12T00:00:00Z' },
    { Id: 'a01000000000073AAA', Delivery_Date__c: '2026-08-20', CreatedDate: '2026-08-13T00:00:00Z' },
  ].sort(compareStatementStems);
  assert.deepEqual(rows.map((row) => row.Id), [
    'a01000000000072AAA',
    'a01000000000073AAA',
    'a01000000000074AAA',
    'a01000000000075AAA',
  ]);
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

test('single-currency Salesforce STEMs inherit the corporate currency in combined exposure', () => {
  const statement = buildAccountCreditStatement({
    today: '2026-08-18',
    account: {
      Id: accountId,
      Name: 'ACHIEVE BUNKER LTD',
      CL_Category__c: 'Individual',
      CL_Individual__c: 5_000_000,
      CL_Used_Customer__c: 4_661_214,
    },
    openStems: [
      {
        Id: 'a01000000000091AAA',
        Account__c: accountId,
        QLIK_Receivable_Balance__c: 4_661_214,
        Invoice_Due_Date__c: '2026-09-01',
      },
    ],
    statementStems: [],
  });

  assert.deepEqual(statement.currencies, ['USD']);
  assert.deepEqual(statement.exposureByCurrency, {
    USD: { individual: 4_661_214, group: 4_661_214 },
  });
});

test('credit cursors reject malformed values and round-trip directory and statement state', () => {
  const directory = encodeAccountCreditCursor({ kind: 'directory', name: 'BUYER A', id: accountId });
  assert.deepEqual(decodeAccountCreditCursor(directory), { kind: 'directory', name: 'BUYER A', id: accountId });
  const statement = encodeAccountCreditCursor({ kind: 'statement', scope: 'open_recent', offset: 50 });
  assert.deepEqual(decodeAccountCreditCursor(statement), { kind: 'statement', scope: 'open_recent', offset: 50 });
  assert.equal(decodeAccountCreditCursor('bad'), null);
});

test('Salesforce loader keeps buyer-leg membership Account-only and loads expected invoice children without supplier widening', async () => {
  const source = await readFile(new URL('../api/_dashboardAccountCreditStatementService.js', import.meta.url), 'utf8');
  assert.match(source, /Inactive_Suspended__c = false/);
  assert.match(source, /ACCOUNT_CREDIT_ACCOUNT_INACTIVE/);
  assert.match(source, /Account__c IN \(\$\{ids/);
  assert.match(source, /Id IN \(SELECT Account__c FROM STEM__c WHERE Account__c != null\)/);
  assert.match(source, /queryExpectedInvoiceEvidence\(notIssuedStems/);
  assert.match(source, /FROM \$\{objectName\} WHERE STEM__c IN/);
  assert.match(source, /AND Cancelled__c = false/);
  assert.doesNotMatch(source, /Original_Supplier__c|Supplier__c|Buyer_Broker__c|Supplier_Broker__c/);
  assert.match(source, /QLIK_Receivable_Balance__c != 0/);
  assert.match(source, /Delivery_Date__c >= \$\{CREDIT_EXPOSURE_DELIVERY_START\}/);
  assert.match(source, /Expected_Delivery_Date__c >= \$\{CREDIT_EXPOSURE_DELIVERY_START\}/);
  assert.match(source, /filter\(\(stem\) => isCreditExposureStemEligible\(stem\)\)/);
  assert.match(source, /FROM Invoice__c WHERE STEM__c IN/);
  assert.match(source, /Proforma__c = false AND Deprecated__c = false/);
  assert.match(source, /filter\(finalBuyerInvoice\)/);
  assert.doesNotMatch(source, /Shared__c/);
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
  assert.match(directory, /onOpen\(\{ \.\.\.identity, role: statementRole \}, 'credit'\)/);
  assert.match(dashboard, /navigate\(`\/accounts\/\$\{encodeURIComponent\(account\.accountId\)\}/);
  assert.match(directory, /dashboardAccountCreditDirectory/);
  assert.match(directory, /filters: directoryFilters/);
  assert.match(dashboard, /AccountCreditDirectory counterparty=\{filterPayload\.counterparty\}/);
  assert.match(dashboard, /filters=\{filterPayload\.filters\}/);
  assert.match(api, /dashboardAccountCreditDirectory/);
  const service = await readFile(new URL('../api/_dashboardAccountCreditStatementService.js', import.meta.url), 'utf8');
  assert.match(service, /directoryFilters\(body\.filters\)/);
  assert.match(service, /filters\.accountIds/);
  assert.match(service, /filters\.portIds/);
  assert.match(service, /filters\.countryCodes/);
  assert.match(service, /FROM Port__c WHERE Country__c IN/);
  assert.match(service, /Port__c IN/);
  assert.match(statement, /useState\('open'\)/);
  assert.match(statement, /\{ value: 'open', label: 'Open only' \},\s+\{ value: 'open_recent', label: 'Open \+ 12 months settled' \}/);
  assert.match(statement, /useState\(false\)/);
  assert.match(statement, /Show assumptions/);
  assert.match(statement, /showAssumptions \? <div/);
  assert.match(statement, /showAssumptions && result\.chart\?\.undatedGroupStemCount/);
  assert.match(statement, /CreditPositionPanel title="Selected Account"/);
  assert.match(statement, /CreditPositionPanel title="GROUP"/);
  assert.match(statement, /group_shared_uncapped/);
  assert.match(statement, /No individual cap/);
  assert.match(statement, /availableComparison\.materiallyDifferent/);
  assert.match(statement, /visibleCreditLimitReferences/);
  assert.match(statement, /aria-label="Applicable credit limits"/);
  assert.doesNotMatch(statement, /label=\{\{ value: '(?:Individual base|Special individual|GROUP base|GROUP \+ special)'/);
  assert.doesNotMatch(statement, /Legacy Credit_Limit__c|credit\.legacyLimit/);
  assert.match(statement, /Select all/);
  assert.match(statement, /Total invoice amount/);
  assert.match(statement, /Not Issued/);
  assert.match(statement, /bg-red-50\/70/);
  assert.match(statement, /Expected Due Date/);
  assert.match(statement, /Expected Invoice Amount/);
  assert.doesNotMatch(statement, /Total expected invoice amount/);
  assert.match(statement, /expectedBuyerInvoiceAmount/);
  assert.match(statement, /expectedBuyerInvoiceDueDate/);
  assert.match(statement, /accountStatementInvoiceCopyPayload/);
  assert.match(statement, /expectedBuyerInvoiceAmountComplete/);
  assert.match(statement, /statementExposureAmount/);
  assert.match(statement, /statementExposureComplete/);
  assert.match(statement, /statementExposureBlockingReason/);
  assert.match(statement, /range_max_quantity/);
  assert.match(statement, /BASIS MAX QTY/);
  assert.match(statement, /Basis Max Qty/);
  assert.match(statement, /Un-Invoiced STEMs here use mid-qty if in range/);
  assert.match(statement, /aria-pressed=\{series\.account\}/);
  assert.match(statement, /aria-pressed=\{series\.group\}/);
  assert.match(statement, /data\.group && series\.group && data\.reconciliation\.group\.matches/);
  assert.match(statement, /undatedAccountStemCount/);
  assert.match(statement, /result\?\.projectionWarnings \|\| result\?\.warnings/);
  assert.match(statement, /Outside current credit lineage window/);
  assert.match(statement, /\{result\.group \? <button type="button" aria-pressed=\{series\.group\}/);
  assert.match(statement, /result\.group \? <CreditPositionPanel title="GROUP"/);
});
