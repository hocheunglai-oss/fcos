import { createRoot } from 'react-dom/client';
import { appClient } from '@/api/appClient';
import XeroPrepaymentPolicy from '@/components/xero/XeroPrepaymentPolicy';
import '@/index.css';

const tenantId = '10000000-0000-4000-8000-000000000009';
const accountId = '10000000-0000-4000-8000-000000000010';
const policies = ['Buy', 'Sell'].flatMap((direction) => ['USD', 'HKD'].map((currency) => ({
  tenantId, direction, currency, enabled: false, revision: 0, accountId: null, accountCode: null, taxType: null,
})));
const accountOptions = [{ id: accountId, code: 'DEP', name: 'Fixture deposit account' }];
const taxOptions = [{ taxType: 'NONE', name: 'No tax' }];
window.policyFixture = { calls: [], loseAcknowledgement: new URLSearchParams(location.search).has('lost') };
appClient.functions.invoke = async (name, body) => {
  window.policyFixture.calls.push({ name, body });
  if (name === 'xeroPrepaymentPolicyGet') {
    return { data: structuredClone({ tenantId, policies, accountOptions, taxOptions }) };
  }
  if (name === 'xeroPrepaymentPolicySave') {
    const index = policies.findIndex((row) => row.currency === body.currency && row.direction === body.direction);
    if (body.tenantId !== tenantId || policies[index]?.revision !== body.expectedRevision) throw new Error('Fixture revision mismatch.');
    const policy = { ...body, revision: body.expectedRevision + 1 };
    policies[index] = policy;
    if (window.policyFixture.loseAcknowledgement) {
      window.policyFixture.loseAcknowledgement = false;
      throw new Error('The save response was lost.');
    }
    return { data: { tenantId, policy } };
  }
  throw new Error(`Unexpected fixture call ${name}`);
};

createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-6"><XeroPrepaymentPolicy /></main>);
