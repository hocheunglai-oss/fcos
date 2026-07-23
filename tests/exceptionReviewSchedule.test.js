import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EXCEPTION_REVIEW_DATE_BASIS,
  buildExceptionReviewDateWindows,
  buildExceptionReviewScheduleWhere,
  exceptionScheduleDaysSinceEnd,
  exceptionScheduleSchemaIssues,
  hasUncancelledStemLineProductItem,
  hongKongDateOnly,
  isExceptionPotentialDelay,
  normalizeExceptionSchedule,
} from '../src/lib/exceptionReviewSchedule.js';

test('normalizes ETA and ETB Schedule ranges', () => {
  assert.deepEqual(normalizeExceptionSchedule({
    ETA_ETB__c: 'ETA',
    ETA_Start_Date__c: '2026-07-27',
    ETA_End_Date__c: '2026-07-30',
    CreatedDate: '2026-07-20T00:00:00Z',
  }), {
    type: 'ETA',
    startDate: '2026-07-27',
    endDate: '2026-07-30',
    source: 'schedule',
    displayLabel: 'ETA · 27-30 Jul 2026',
  });

  assert.deepEqual(normalizeExceptionSchedule({
    ETA_ETB__c: 'ETB',
    ETB_Start_Date__c: '2026-08-02',
    ETB_End_Date__c: '2026-08-04',
    CreatedDate: '2026-07-20T00:00:00Z',
  }), {
    type: 'ETB',
    startDate: '2026-08-02',
    endDate: '2026-08-04',
    source: 'schedule',
    displayLabel: 'ETB · 2-4 Aug 2026',
  });
});

test('uses one-sided ranges as one day and reorders reversed ranges', () => {
  const oneSided = normalizeExceptionSchedule({
    ETA_ETB__c: 'ETA',
    ETA_Start_Date__c: '2026-07-27',
    ETA_End_Date__c: null,
    CreatedDate: '2026-07-20T00:00:00Z',
  });
  assert.equal(oneSided.startDate, '2026-07-27');
  assert.equal(oneSided.endDate, '2026-07-27');
  assert.equal(oneSided.displayLabel, 'ETA · 27 Jul 2026');

  const reversed = normalizeExceptionSchedule({
    ETA_ETB__c: 'ETB',
    ETB_Start_Date__c: '2026-08-04',
    ETB_End_Date__c: '2026-08-02',
    CreatedDate: '2026-07-20T00:00:00Z',
  });
  assert.equal(reversed.startDate, '2026-08-02');
  assert.equal(reversed.endDate, '2026-08-04');
});

test('PROMPT and missing Schedule dates use the Hong Kong STEM creation date', () => {
  assert.equal(hongKongDateOnly('2026-07-23T16:30:00Z'), '2026-07-24');

  const prompt = normalizeExceptionSchedule({
    ETA_ETB__c: 'PROMPT',
    ETA_Start_Date__c: '2026-08-01',
    ETA_End_Date__c: '2026-08-02',
    CreatedDate: '2026-07-23T16:30:00Z',
  });
  assert.equal(prompt.source, 'created');
  assert.equal(prompt.startDate, '2026-07-24');
  assert.equal(prompt.displayLabel, 'PROMPT · Created 24 Jul 2026');

  const missing = normalizeExceptionSchedule({
    ETA_ETB__c: 'ETA',
    CreatedDate: '2026-07-23T15:59:59Z',
  });
  assert.equal(missing.source, 'created');
  assert.equal(missing.startDate, '2026-07-23');
  assert.equal(missing.displayLabel, 'Schedule not set · Created 23 Jul 2026');
});

test('Potential Delay begins on the third Hong Kong day after the effective range end', () => {
  const row = {
    Delivery_Date__c: null,
    _Has_Uncancelled_Line_Product_Item: true,
    _Exception_Schedule: {
      type: 'ETA',
      startDate: '2026-07-20',
      endDate: '2026-07-21',
      source: 'schedule',
      displayLabel: 'ETA · 20-21 Jul 2026',
    },
  };

  assert.equal(exceptionScheduleDaysSinceEnd(row._Exception_Schedule, '2026-07-23T08:00:00Z'), 2);
  assert.equal(isExceptionPotentialDelay(row, '2026-07-23T08:00:00Z'), false);
  assert.equal(exceptionScheduleDaysSinceEnd(row._Exception_Schedule, '2026-07-23T16:00:00Z'), 3);
  assert.equal(isExceptionPotentialDelay(row, '2026-07-23T16:00:00Z'), true);
  assert.equal(isExceptionPotentialDelay({ ...row, Delivery_Date__c: '2026-07-22' }, '2026-07-23T16:00:00Z'), false);
});

test('Potential Delay excludes STEMs without an uncancelled line product item', () => {
  const delayedRow = {
    Delivery_Date__c: null,
    _Exception_Schedule: {
      type: 'ETA',
      startDate: '2026-07-20',
      endDate: '2026-07-20',
      source: 'schedule',
      displayLabel: 'ETA · 20 Jul 2026',
    },
  };

  assert.equal(isExceptionPotentialDelay({
    ...delayedRow,
    _Has_Uncancelled_Line_Product_Item: false,
  }, '2026-07-24T08:00:00Z'), false);
  assert.equal(isExceptionPotentialDelay({
    ...delayedRow,
    _Has_Uncancelled_Line_Product_Item: true,
  }, '2026-07-24T08:00:00Z'), true);
  assert.equal(hasUncancelledStemLineProductItem({
    ...delayedRow,
    _Product_Quantity_List: [{ productName: 'VLSFO' }],
  }), true);
});

test('builds selected-month windows and Schedule-overlap Salesforce filters', () => {
  const windows = buildExceptionReviewDateWindows([2026], [7, 8]);
  assert.deepEqual(windows, [
    { startDate: '2026-07-01', endDate: '2026-07-31' },
    { startDate: '2026-08-01', endDate: '2026-08-31' },
  ]);

  const where = buildExceptionReviewScheduleWhere([windows[0]]);
  assert.match(where, /Delivery_Date__c >= 2026-07-01/);
  assert.match(where, /ETA_Start_Date__c <= 2026-07-31 AND ETA_End_Date__c >= 2026-07-01/);
  assert.match(where, /ETB_Start_Date__c <= 2026-07-31 AND ETB_End_Date__c >= 2026-07-01/);
  assert.match(where, /CreatedDate >= 2026-06-30T16:00:00Z/);
  assert.match(where, /CreatedDate < 2026-07-31T16:00:00Z/);
  assert.doesNotMatch(where, /Expected_Delivery_Date__c/);
});

test('reports every required Salesforce Schedule schema field', () => {
  assert.deepEqual(exceptionScheduleSchemaIssues([
    'CreatedDate',
    'Delivery_Date__c',
    'ETA_ETB__c',
    'ETA_Start_Date__c',
    'ETA_End_Date__c',
  ]), ['ETB_Start_Date__c', 'ETB_End_Date__c']);
});

test('live dashboard route and Exception Review UI use the Schedule interface', async () => {
  const apiSource = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const liveFunction = apiSource.slice(
    apiSource.indexOf('async function salesforceDashboardFilteredFull'),
    apiSource.indexOf('async function stemPnlFull'),
  );
  const pageSource = await readFile(new URL('../src/pages/ReviewQueue.jsx', import.meta.url), 'utf8');

  assert.match(liveFunction, /buildExceptionReviewScheduleWhere\(dateWindows\)/);
  assert.match(liveFunction, /_Exception_Schedule: exceptionScheduleMode \? normalizeExceptionSchedule\(stem\) : null/);
  assert.match(liveFunction, /_Has_Uncancelled_Line_Product_Item: stemsWithUncancelledLineProductItems\.has\(stem\.Id\)/);
  assert.match(pageSource, new RegExp(`dateBasis: EXCEPTION_REVIEW_DATE_BASIS`));
  assert.match(pageSource, /isExceptionPotentialDelay/);
  assert.match(pageSource, /Delivery \/ Schedule/);
  assert.match(pageSource, /Schedule Range/);
  assert.doesNotMatch(pageSource, /Expected_Delivery_Date__c|Expected Delivery/);
  assert.equal(EXCEPTION_REVIEW_DATE_BASIS, 'exception_schedule');
});
