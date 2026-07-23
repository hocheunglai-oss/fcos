import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountClKeyLabel,
  accountSearchDisplayText,
  normalizeAccountClKeys,
} from '../src/lib/accountDisplay.js';

test('Account search labels always pair the Account name with its CL Key', () => {
  assert.equal(
    accountSearchDisplayText('SINANEN CO LTD', 'HKSINANEN'),
    'SINANEN CO LTD · CL Key: HKSINANEN',
  );
  assert.equal(
    accountSearchDisplayText('GROUP - SINANEN CO LTD', ''),
    'GROUP - SINANEN CO LTD · CL Key not set',
  );
});

test('Account CL Key labels normalize duplicate grouped Account values', () => {
  assert.deepEqual(
    normalizeAccountClKeys([' HK-002 ', 'HK-001', 'HK-002', null]),
    ['HK-001', 'HK-002'],
  );
  assert.equal(accountClKeyLabel(['HK-002', 'HK-001']), 'CL Keys: HK-001, HK-002');
});
