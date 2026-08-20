import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBuyerPaymentDelayModels,
  buyerPaymentDelayModel,
  normalizeBuyerPaymentConservativeness,
  recencyWeightedPercentile,
  selectBuyerPaymentDelayModel,
} from '../api/_buyerPaymentPerformance.js';
import {
  adjustCreditForecastBusinessDay,
  buildStemCreditRelease,
  resolveGroupCreditAuthority,
} from '../api/_dashboardAccountCreditStatement.js';

const today = '2026-08-20';
const datedSamples = [0, 10, 20, 40].map((delayDays, index) => ({
  paymentId: `payment-${index}`,
  paymentDate: '2026-08-10',
  delayDays,
}));

test('normalizes the three governed conservativeness levels', () => {
  assert.equal(normalizeBuyerPaymentConservativeness('TYPICAL'), 'typical');
  assert.equal(normalizeBuyerPaymentConservativeness('cautious'), 'cautious');
  assert.equal(normalizeBuyerPaymentConservativeness('invalid'), 'cautious');
  assert.equal(normalizeBuyerPaymentConservativeness('invalid', null), null);
});

test('calculates recency-weighted P50, P75, and P90 delays', () => {
  assert.equal(recencyWeightedPercentile(datedSamples, 0.5, today), 10);
  assert.equal(recencyWeightedPercentile(datedSamples, 0.75, today), 20);
  assert.equal(recencyWeightedPercentile(datedSamples, 0.9, today), 40);
  const model = buyerPaymentDelayModel(datedSamples, 'Buyer', 3, { today });
  assert.deepEqual(model.percentiles, { typical: 10, cautious: 20, severe: 40 });
  assert.equal(model.sampleCount, 4);
});

test('selects exact Buyer, exact GROUP, then global models', () => {
  const samples = [
    ...[3, 4, 5].map((delayDays, index) => ({ buyerAccountId: 'buyer-a', buyerGroupId: 'group-a', paymentDate: '2026-08-01', delayDays, paymentId: `a-${index}` })),
    ...[10, 11, 12, 13, 14].map((delayDays, index) => ({ buyerAccountId: `buyer-${index}`, buyerGroupId: 'group-a', paymentDate: '2026-08-01', delayDays, paymentId: `g-${index}` })),
  ];
  const settings = { minBuyerSamples: 3, minGroupSamples: 5 };
  const models = buildBuyerPaymentDelayModels(samples, settings, { today });
  const buyer = selectBuyerPaymentDelayModel({ buyerAccountId: 'buyer-a', buyerGroupId: 'group-a' }, models, settings, { conservativeness: 'cautious' });
  const group = selectBuyerPaymentDelayModel({ buyerAccountId: 'missing', buyerGroupId: 'group-a' }, models, settings, { conservativeness: 'cautious' });
  const global = selectBuyerPaymentDelayModel({ buyerAccountId: 'missing', buyerGroupId: 'missing' }, models, settings, { conservativeness: 'cautious' });
  assert.equal(buyer.level, 'Buyer');
  assert.equal(group.level, 'Buyer Group');
  assert.equal(global.level, 'Global');
  assert.equal(buyer.percentileLabel, 'P75');
});

test('resolves COSCO GROUP credit authority from the exact active hierarchy', () => {
  const group = { Id: '001000000000001AAA', Name: 'GROUP - COSCO', Inactive_Suspended__c: false, CL_Category__c: 'Group', CL_Group__c: 0, CL_Used_Group__c: 0 };
  const petroleum = {
    Id: '001000000000002AAA',
    Name: 'COSCO SHIPPING (SINGAPORE) PETROLEUM PTE LTD',
    Company_Code__c: 'HKCOSCO PETROLEUM',
    Inactive_Suspended__c: false,
    CL_Category__c: 'Group',
    CL_Group__c: 20_000_000,
    CL_Special_Group__c: 0,
    CL_Used_Group__c: 8_187_257,
    CL_Available_Credit__c: 11_812_743,
  };
  const openStems = [{ Id: 'a0H000000000001AAA', Account__c: petroleum.Id, QLIK_Receivable_Balance__c: 8_187_257, CurrencyIsoCode: 'USD' }];
  const result = resolveGroupCreditAuthority({ group, members: [group, petroleum], openStems, complete: true });
  assert.equal(result.status, 'resolved');
  assert.equal(result.candidate.Id, petroleum.Id);
  assert.equal(result.candidate.CL_Group__c, 20_000_000);
  assert.equal(result.reconciliation.matches, true);
});

test('accepts identical authority snapshots and rejects conflicting ones', () => {
  const group = { Id: '001000000000001AAA', Name: 'GROUP - TEST' };
  const base = { Inactive_Suspended__c: false, CL_Category__c: 'Group', CL_Group__c: 1000, CL_Special_Group__c: 0, CL_Used_Group__c: 400, CL_Available_Credit__c: 600 };
  const first = { ...base, Id: '001000000000002AAA', Name: 'FIRST' };
  const second = { ...base, Id: '001000000000003AAA', Name: 'SECOND' };
  const stems = [{ Id: 'a0H000000000001AAA', Account__c: first.Id, QLIK_Receivable_Balance__c: 400, CurrencyIsoCode: 'USD' }];
  assert.equal(resolveGroupCreditAuthority({ group, members: [first, second], openStems: stems, complete: true }).status, 'resolved');
  assert.equal(resolveGroupCreditAuthority({ group, members: [first, { ...second, CL_Group__c: 1200 }], openStems: stems, complete: true }).status, 'ambiguous');
});

test('floors overdue modeled dates and applies business-day blocks', () => {
  assert.deepEqual(adjustCreditForecastBusinessDay('2026-08-15', today, ['2026-08-20']), {
    date: '2026-08-21',
    originalDate: '2026-08-20',
    adjusted: true,
  });
  const release = buildStemCreditRelease({
    stem: { Id: 'a0H000000000001AAA', Account__c: '001000000000002AAA', QLIK_Receivable_Balance__c: 500, Invoice_Due_Date__c: '2026-08-15', CurrencyIsoCode: 'USD' },
    today,
    paymentModel: { predictedDelayDays: 0, level: 'Buyer', sampleCount: 6, confidence: 'High', conservativeness: 'cautious', percentileLabel: 'P75' },
    blockedDates: ['2026-08-20'],
  });
  assert.equal(release.releaseDate, '2026-08-21');
  assert.equal(release.forecastEvents[0].contractualDate, '2026-08-15');
  assert.equal(release.forecastEvents[0].modelLevel, 'Buyer');
  assert.equal(release.forecastEvents[0].percentileLabel, 'P75');
});
