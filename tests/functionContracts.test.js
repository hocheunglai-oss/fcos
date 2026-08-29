import test from 'node:test';
import assert from 'node:assert/strict';
import { functionContractNames, validateFunctionRequest } from '../src/api/functionContracts.js';

test('critical function contracts fail closed before invalid requests reach the server', () => {
  assert.deepEqual(functionContractNames().sort(), [
    'dashboardAccountCreditStatement',
    'dashboardCounterpartySearch',
    'systemErrorVerify',
    'workNotificationsRead',
    'workNotificationsState',
  ]);
  assert.equal(validateFunctionRequest('systemErrorVerify', {}).ok, false);
  assert.equal(validateFunctionRequest('workNotificationsState', { notificationIds: ['n1'], state: 'handled' }).ok, true);
  assert.equal(validateFunctionRequest('dashboardAccountCreditStatement', { accountId: '001xx', side: 'both', entityType: 'group' }).ok, true);
  assert.equal(validateFunctionRequest('dashboardAccountCreditStatement', { accountId: '001xx', side: 'net' }).ok, false);
});

test('unregistered handlers retain compatibility while the registry expands by domain', () => {
  assert.deepEqual(validateFunctionRequest('legacyCompatibleHandler', { value: 1 }), { ok: true, registered: false, issues: [] });
});
