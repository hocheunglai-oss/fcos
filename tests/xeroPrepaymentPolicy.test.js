import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePrepaymentPostingPolicy,
  validatePrepaymentPostingEvidence,
  xeroPrepaymentPolicyGet,
  xeroPrepaymentPolicySave,
} from '../api/_xeroPrepaymentPolicy.js';

const ids = {
  tenant: '10000000-0000-4000-8000-000000000001',
  otherTenant: '10000000-0000-4000-8000-000000000002',
  account: '10000000-0000-4000-8000-000000000003',
  bank: '10000000-0000-4000-8000-000000000004',
  actor: '10000000-0000-4000-8000-000000000005',
};
const profile = { id: ids.actor, email: 'finance@example.com' };
const connection = { tenantId: ids.tenant, scope: 'accounting.settings.read' };
const account = { AccountID: ids.account, Code: 'DEPOSITS', Name: 'Customer deposits', Type: 'CURRENT', Status: 'ACTIVE' };
const zeroTax = {
  TaxType: 'ZERORATED', Name: 'Zero rated', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0,
  TaxComponents: [{ Name: 'Zero', Rate: 0 }],
};
const storedPolicy = {
  tenant_id: ids.tenant, direction: 'Sell', currency: 'HKD', enabled: true,
  account_id: ids.account, account_code: 'DEPOSITS', tax_type: 'ZERORATED', revision: 3,
  reason: 'Finance reviewed customer deposits', reviewed_by: ids.actor, reviewed_at: '2026-09-10T10:00:00.000Z',
};

function xeroFetch(_connection, path) {
  if (path === '/Accounts') {
    return Promise.resolve({ Accounts: [
      account,
      { AccountID: ids.bank, Code: 'BANK', Name: 'Operating bank', Type: 'BANK', Status: 'ACTIVE' },
      { ...account, AccountID: ids.otherTenant, Code: '', Name: 'No code' },
      { ...account, AccountID: ids.otherTenant, Code: 'OLD', Status: 'ARCHIVED' },
    ] });
  }
  return Promise.resolve({ TaxRates: [
    zeroTax,
    { ...zeroTax, TaxType: 'OUTPUT', DisplayTaxRate: 5, EffectiveRate: 5 },
    { ...zeroTax, TaxType: 'BADCOMPONENT', TaxComponents: [{ Rate: 1 }] },
  ] });
}

function clientFor({ rows = [storedPolicy], rpcResult = null, rpcError = null } = {}) {
  const calls = { tables: [], rpc: [] };
  return {
    calls,
    from(table) {
      calls.tables.push(table);
      return {
        select() {
          return {
            eq(column, value) {
              calls.filter = { column, value };
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return { data: rpcResult || { ...storedPolicy, revision: 4 }, error: rpcError };
    },
  };
}

const dependencies = (client) => ({
  accessContext: { profile },
  client,
  getConnection: async () => connection,
  xeroFetch,
});

test('resolver binds the exact tenant, direction and currency to live posting evidence', () => {
  const result = resolvePrepaymentPostingPolicy(
    [storedPolicy],
    { Direction__c: 'Sell', Currency__c: 'HKD' },
    [account],
    [zeroTax],
    ids.tenant,
  );
  assert.equal(result.policy.revision, 3);
  assert.equal(result.depositAccount, account);
  assert.equal(result.zeroTaxRate, zeroTax);

  for (const [policies, event, tenantId] of [
    [[{ ...storedPolicy, enabled: false }], { Direction__c: 'Sell', Currency__c: 'HKD' }, ids.tenant],
    [[storedPolicy], { Direction__c: 'Buy', Currency__c: 'HKD' }, ids.tenant],
    [[storedPolicy], { Direction__c: 'Sell', Currency__c: 'USD' }, ids.tenant],
    [[storedPolicy], { Direction__c: 'Sell', Currency__c: 'HKD' }, ids.otherTenant],
    [[storedPolicy, { ...storedPolicy }], { Direction__c: 'Sell', Currency__c: 'HKD' }, ids.tenant],
  ]) {
    assert.throws(
      () => resolvePrepaymentPostingPolicy(policies, event, [account], [zeroTax], tenantId),
      error => error.code === 'XERO_PREPAYMENT_POLICY_REQUIRED',
    );
  }
});

test('posting evidence requires exact active non-bank ID and code plus every zero-tax rate', () => {
  const policy = { accountId: ids.account, accountCode: 'DEPOSITS', taxType: 'ZERORATED' };
  validatePrepaymentPostingEvidence(policy, [account], [zeroTax]);
  for (const changedAccount of [
    { ...account, Code: 'OTHER' },
    { ...account, Status: 'ARCHIVED' },
    { ...account, Type: 'BANK' },
    { ...account, BankAccountNumber: '123' },
  ]) {
    assert.throws(() => validatePrepaymentPostingEvidence(policy, [changedAccount], [zeroTax]),
      error => error.code === 'XERO_PREPAYMENT_POLICY_ACCOUNT_INVALID');
  }
  for (const changedTax of [
    { ...zeroTax, Status: 'DELETED' },
    { ...zeroTax, DisplayTaxRate: null },
    { ...zeroTax, EffectiveRate: 1 },
    { ...zeroTax, TaxComponents: [{ Rate: 0 }, { Rate: 0.1 }] },
  ]) {
    assert.throws(() => validatePrepaymentPostingEvidence(policy, [account], [changedTax]),
      error => error.code === 'XERO_PREPAYMENT_POLICY_TAX_INVALID');
  }
});

test('get requires a profile and returns safe choices plus all disabled-by-default slots', async () => {
  const client = clientFor();
  const result = await xeroPrepaymentPolicyGet({}, dependencies(client));
  assert.equal(result.tenantId, ids.tenant);
  assert.equal(result.policies.length, 4);
  assert.deepEqual(result.policies.map((row) => `${row.direction}:${row.currency}`), ['Buy:USD', 'Buy:HKD', 'Sell:USD', 'Sell:HKD']);
  assert.equal(result.policies.find((row) => row.direction === 'Sell' && row.currency === 'HKD').revision, 3);
  assert.deepEqual(result.policies.find((row) => row.direction === 'Buy' && row.currency === 'USD'), {
    tenantId: ids.tenant, direction: 'Buy', currency: 'USD', enabled: false, accountId: null,
    accountCode: null, taxType: null, revision: 0, reason: null, reviewedBy: null, reviewedAt: null, configured: false,
  });
  assert.deepEqual(result.accountOptions.map((row) => row.code), ['DEPOSITS']);
  assert.deepEqual(result.taxOptions.map((row) => row.taxType), ['ZERORATED']);
  assert.deepEqual(client.calls.filter, { column: 'tenant_id', value: ids.tenant });

  await assert.rejects(
    xeroPrepaymentPolicyGet({}, { ...dependencies(client), accessContext: null }),
    error => error.status === 400 && /profile/i.test(error.message),
  );
});

test('save rechecks tenant, scope, account and zero tax before the local optimistic mutation', async () => {
  const client = clientFor();
  const body = {
    tenantId: ids.tenant,
    direction: 'Sell',
    currency: 'HKD',
    enabled: true,
    accountId: ids.account,
    accountCode: 'DEPOSITS',
    taxType: 'ZERORATED',
    reason: 'Finance reviewed customer deposits',
    expectedRevision: 3,
  };
  const result = await xeroPrepaymentPolicySave(body, dependencies(client));
  assert.equal(result.policy.revision, 4);
  assert.equal(client.calls.rpc.length, 1);
  assert.deepEqual(client.calls.rpc[0], {
    name: 'save_xero_prepayment_posting_policy_v1',
    args: {
      p_tenant_id: ids.tenant,
      p_direction: 'Sell',
      p_currency: 'HKD',
      p_enabled: true,
      p_account_id: ids.account,
      p_account_code: 'DEPOSITS',
      p_tax_type: 'ZERORATED',
      p_expected_revision: 3,
      p_reason: 'Finance reviewed customer deposits',
      p_actor_id: ids.actor,
    },
  });

  for (const [changed, changedDependencies, code] of [
    [{ ...body, tenantId: ids.otherTenant }, dependencies(client), 'XERO_PREPAYMENT_POLICY_TENANT_CHANGED'],
    [body, { ...dependencies(client), getConnection: async () => ({ ...connection, scope: 'accounting.transactions' }) }, 'XERO_PREPAYMENT_POLICY_SCOPE_MISSING'],
    [{ ...body, accountCode: 'CHANGED' }, dependencies(client), 'XERO_PREPAYMENT_POLICY_ACCOUNT_INVALID'],
    [body, { ...dependencies(client), xeroFetch: async (_c, path) => path === '/Accounts' ? { Accounts: [account] } : { TaxRates: [{ ...zeroTax, EffectiveRate: 5 }] } }, 'XERO_PREPAYMENT_POLICY_TAX_INVALID'],
  ]) {
    const isolated = clientFor();
    const deps = { ...changedDependencies, client: isolated };
    await assert.rejects(xeroPrepaymentPolicySave(changed, deps), error => error.code === code);
    assert.equal(isolated.calls.rpc.length, 0);
  }
});

test('disabled saves are explicit and stale revisions return a refresh conflict', async () => {
  const disabledClient = clientFor({ rpcResult: {
    ...storedPolicy, direction: 'Buy', currency: 'USD', enabled: false, account_id: null,
    account_code: null, tax_type: null, revision: 1,
  } });
  const body = {
    tenantId: ids.tenant, direction: 'Buy', currency: 'USD', enabled: false,
    reason: 'Finance keeps supplier USD deposits disabled', expectedRevision: 0,
  };
  const result = await xeroPrepaymentPolicySave(body, dependencies(disabledClient));
  assert.equal(result.policy.enabled, false);
  assert.equal(disabledClient.calls.rpc[0].args.p_account_id, null);
  await assert.rejects(
    xeroPrepaymentPolicySave({ ...body, accountId: ids.account }, dependencies(clientFor())),
    error => error.status === 400,
  );

  const staleClient = clientFor({ rpcError: { code: '40001', message: 'revision changed' } });
  await assert.rejects(
    xeroPrepaymentPolicySave(body, dependencies(staleClient)),
    error => error.code === 'XERO_PREPAYMENT_POLICY_STALE_WRITE' && error.status === 409,
  );
});

test('rejects duplicate provider choices and incomplete tax evidence', () => {
  for (const duplicate of [account, { ...account, AccountID: ids.otherTenant }, { ...account, Code: 'CHANGED' }]) {
    assert.throws(() => validatePrepaymentPostingEvidence(storedPolicy, [account, duplicate], [zeroTax]),
      { code: 'XERO_PREPAYMENT_POLICY_ACCOUNT_INVALID' });
  }
  assert.throws(() => validatePrepaymentPostingEvidence(storedPolicy, [account], [zeroTax, zeroTax]),
    { code: 'XERO_PREPAYMENT_POLICY_TAX_INVALID' });
  assert.throws(() => validatePrepaymentPostingEvidence(storedPolicy, [account], [{ ...zeroTax, TaxComponents: undefined }]),
    { code: 'XERO_PREPAYMENT_POLICY_TAX_INVALID' });
});

test('blocks staged policy calls before Xero connection or database access', async () => {
  const client = clientFor();
  const options = { ...dependencies(client), env: { VERCEL_ENV: 'preview' },
    getConnection: async () => assert.fail('staging must not open the live connection') };
  await assert.rejects(xeroPrepaymentPolicyGet({}, options), { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  await assert.rejects(xeroPrepaymentPolicySave({}, options), { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  assert.deepEqual(client.calls, { tables: [], rpc: [] });
});

test('disable saves use zero Xero settings calls and an unknown acknowledgement is never replayed', async () => {
  const client = clientFor({ rpcResult: { ...storedPolicy, enabled: false, account_id: null, account_code: null, tax_type: null, revision: 9 } });
  await assert.rejects(xeroPrepaymentPolicySave({
    tenantId: ids.tenant, direction: 'Sell', currency: 'HKD', enabled: false, expectedRevision: 3, reason: 'Suspend deposit posting',
  }, { ...dependencies(client), xeroFetch: () => assert.fail('disabling requires no posting settings') }),
  { code: 'XERO_PREPAYMENT_POLICY_ACK_UNVERIFIED' });
  assert.equal(client.calls.rpc.length, 1);
});

test('incomplete Xero settings and daily reserve responses hold an enabled save before RPC', async () => {
  const body = {
    tenantId: ids.tenant, direction: 'Sell', currency: 'HKD', enabled: true,
    accountId: ids.account, accountCode: account.Code, taxType: zeroTax.TaxType, reason: 'Reviewed exact settings', expectedRevision: 3,
  };
  const client = clientFor();
  await assert.rejects(xeroPrepaymentPolicySave(body, {
    ...dependencies(client), xeroFetch: async () => ({}),
  }), { code: 'XERO_PREPAYMENT_POLICY_SETTINGS_INCOMPLETE' });
  await assert.rejects(xeroPrepaymentPolicySave(body, {
    ...dependencies(client), xeroFetch: async (current, path, options) => {
      options.onResponse({ headers: new Headers({ 'x-daylimit-remaining': '1' }) });
      return xeroFetch(current, path);
    },
  }), { status: 429 });
  assert.deepEqual(client.calls.rpc, []);
});
