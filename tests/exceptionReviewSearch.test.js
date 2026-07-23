import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchesExceptionReviewSearch } from '../src/lib/exceptionReviewSearch.js';

const row = {
  Name: 'HK2627001T - SAMPLE VESSEL',
  KeyStem__c: 'HK2627001T',
  Buyer_Name__c: 'SAMPLE BUYER',
  Delivery_Date__c: '2026-07-24',
  _Port_Name: 'Busan',
  _Port_Country: 'South Korea',
};

test('Exception Review search matches existing STEM, buyer, and date fields', () => {
  assert.equal(matchesExceptionReviewSearch(row, 'hk2627001'), true);
  assert.equal(matchesExceptionReviewSearch(row, 'sample buyer'), true);
  assert.equal(matchesExceptionReviewSearch(row, '2026-07-24'), true);
});

test('Exception Review search matches port name and port country', () => {
  assert.equal(matchesExceptionReviewSearch(row, 'busan'), true);
  assert.equal(matchesExceptionReviewSearch(row, 'south korea'), true);
  assert.equal(matchesExceptionReviewSearch(row, 'singapore'), false);
});

test('Exception Review search supports raw Salesforce port relationship data', () => {
  assert.equal(matchesExceptionReviewSearch({
    Name: 'HK2627002T',
    Port__r: { Name: 'Rotterdam', Country__c: 'Netherlands' },
  }, 'netherlands'), true);
});

test('live dashboard route selects and normalizes Salesforce port identity', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const liveFunction = source.slice(
    source.indexOf('async function salesforceDashboardFilteredFull'),
    source.indexOf('async function stemPnlFull'),
  );

  assert.match(liveFunction, /plFields\.push\('Port__c', 'Port__r\.Name', 'Port__r\.Country__c'\)/);
  assert.match(liveFunction, /_Port_Name: port\.Name \|\| null/);
  assert.match(liveFunction, /_Port_Country: port\.Country__c \|\| null/);
});
