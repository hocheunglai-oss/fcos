import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('credit forecast settings remain service-only and atomically revision protected', async () => {
  const migration = await read('supabase/migrations/20260820020859_credit_statement_conservativeness.sql');
  assert.match(migration, /credit_statement_conservativeness text not null default 'cautious'/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /p_expected_updated_at/i);
  assert.match(migration, /revoke all on function .* from public, anon, authenticated/is);
  assert.match(migration, /grant execute on function .* to service_role/is);
});

test('handler and UI expose a fail-closed company setting with temporary previews', async () => {
  const [api, policy, control, buyer, combined] = await Promise.all([
    read('api/functions/[name].js'),
    read('api/_handlerPolicyRegistry.js'),
    read('src/components/dashboard/CreditForecastConservativenessControl.jsx'),
    read('src/components/dashboard/AccountCreditStatement.jsx'),
    read('src/components/dashboard/CombinedAccountStatement.jsx'),
  ]);
  assert.match(api, /dashboardCreditForecastSettingsSave/);
  assert.match(api, /Only an Administrator or the active General Manager/);
  assert.match(api, /Reload the Credit Statement before changing the company forecast setting/);
  assert.match(api, /save_credit_statement_conservativeness/);
  assert.match(policy, /dashboardCreditForecastSettingsSave: mutationPolicy/);
  for (const label of ['Typical', 'Cautious', 'Severe', 'Company default', 'Set as company default']) assert.match(control, new RegExp(label));
  assert.match(buyer, /CreditForecastConservativenessControl/);
  assert.match(combined, /CreditForecastConservativenessControl/);
});
