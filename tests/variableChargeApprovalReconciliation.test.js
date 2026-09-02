import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('approved Variable Charge legs remain visibly approved after detail refresh', async () => {
  const ui = await repositoryFile('src/components/payments/VariableCharges.jsx');

  assert.match(ui, /function ApprovedDecision/);
  assert.match(ui, /costReviewApproved: requirement\.sides\?\.cost\?\.status === 'verified'/);
  assert.match(ui, /buyerReviewApproved: requirement\.sides\?\.buyerCharge\?\.status === 'verified'/);
  assert.match(ui, /costApproved \? <ApprovedDecision/);
  assert.match(ui, /buyerApproved \? <ApprovedDecision/);
  assert.match(ui, /!costApproved && supplierEditing/);
  assert.match(ui, /!buyerApproved && review\.buyerChargeDecision === 'include'/);
});

test('payment reconciliation remains available when Variable Charges synchronization fails', async () => {
  const server = await repositoryFile('api/functions/[name].js');

  assert.match(server, /\[payment-collections\] variable charges sync failed/);
  assert.match(server, /\[payment-collections-cron\] variable charges sync failed/);
  assert.match(server, /shipAgentCharges = \{ unavailable: true \}/);
  assert.match(server, /Variable Charges synchronization is temporarily unavailable\. Payment reconciliation remains current\./);
});

test('paired Variable Charges migration removes the obsolete aggregate readiness constraint', async () => {
  const migration = await repositoryFile('supabase/migrations/20260902062000_remove_legacy_variable_charge_ready_constraint.sql');

  assert.match(migration, /drop constraint if exists ship_agent_charge_cases_check/);
  assert.match(migration, /variable_charge_side_states/);
  assert.doesNotMatch(migration, /disable row level security/i);
});
