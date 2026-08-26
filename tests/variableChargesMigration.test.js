import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buyerCaseBackfillStatus, requiredSupplierIds } from '../scripts/backfill-variable-charge-paired-sides.mjs';

const migration = readFile(new URL('../supabase/migrations/20260818145155_variable_charges_two_stage_cutover.sql', import.meta.url), 'utf8');
const pairedMigration = readFile(new URL('../supabase/migrations/20260826125205_variable_charge_side_by_side_workflow.sql', import.meta.url), 'utf8');
const pairedBackfill = readFile(new URL('../scripts/backfill-variable-charge-paired-sides.mjs', import.meta.url), 'utf8');

test('Variable Charges renames the existing workflow ledger without losing rollback compatibility', async () => {
  const sql = await migration;
  for (const table of ['cases', 'confirmations', 'events', 'operations', 'notification_states']) {
    assert.match(sql, new RegExp(`alter table public\\.ship_agent_charge_${table} rename to variable_charge_${table}`));
    assert.match(sql, new RegExp(`create view public\\.ship_agent_charge_${table}[^;]+public\\.variable_charge_${table}`));
  }
  assert.match(sql, /supplier_verify/);
  assert.match(sql, /buyer_confirm/);
  assert.match(sql, /replace\(v_definition, 'ship_agent_charge', 'variable_charge'\)/);
  assert.ok(
    sql.indexOf("replace(v_definition, 'ship_agent_charge', 'variable_charge')")
      < sql.indexOf("replace(v_definition, 'ship_agent', 'variable_charge')"),
    'the complete legacy domain must be replaced before the shorter prefix',
  );
});

test('paired side states and immutable confirmations remain service-only and contain no financial values', async () => {
  const sql = await pairedMigration;
  assert.match(sql, /create table public\.variable_charge_side_states/);
  assert.match(sql, /create table public\.variable_charge_side_confirmations/);
  assert.match(sql, /side in \('cost', 'buyer_charge'\)/);
  assert.match(sql, /variable_charge_side_state_revision_guard/);
  assert.match(sql, /variable_charge_side_confirmation_guard/);
  assert.match(sql, /operation_id uuid null references public\.variable_charge_operations/);
  assert.match(sql, /variable_charge_side_confirmations_operation_idx/);
  assert.match(sql, /revoke all on table public\.variable_charge_side_states,[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.variable_charge_side_states,[\s\S]+to service_role/);
  assert.match(sql, /security invoker/g);
  assert.doesNotMatch(sql, /unit_price|lumpsum_price|line_total|payment_term|document_content/i);
});

test('paired assignment and confirmation enforce revisions, exact assignees, fingerprints, and atomic multi-side calls', async () => {
  const sql = await pairedMigration;
  const assignment = sql.slice(sql.indexOf('create or replace function public.assign_variable_charge_sides'), sql.indexOf('create or replace function public.record_variable_charge_side_confirmations'));
  const confirmation = sql.slice(sql.indexOf('create or replace function public.record_variable_charge_side_confirmations'), sql.indexOf('-- Additive backfill'));
  assert.match(assignment, /v_state\.revision <> coalesce\(\(p_expected_revisions->>v_side\)::bigint, -1\)/);
  assert.match(assignment, /v_state\.status = 'verified'/);
  assert.match(assignment, /v_operation\.status <> 'reserved'/);
  assert.match(assignment, /set status = 'succeeded'/);
  assert.match(confirmation, /v_state\.assigned_user_id is distinct from v_actor\.id and not v_override/);
  assert.match(confirmation, /v_state\.source_fingerprint <> v_fingerprint/);
  assert.match(confirmation, /v_operation\.status <> 'salesforce_written'/);
  assert.match(confirmation, /v_state\.status = 'verified'/);
  assert.match(confirmation, /p_operation_id/);
  assert.match(confirmation, /jsonb_array_length\(p_sides\) > 1/);
});

test('paired historical backfill is service-only, idempotent, and preserves historical actors', async () => {
  const sql = await pairedMigration;
  const backfill = sql.slice(
    sql.indexOf('create or replace function public.reconcile_variable_charge_paired_backfill'),
    sql.indexOf('alter table public.variable_charge_side_states enable row level security'),
  );
  assert.match(backfill, /perform public\.sync_variable_charge_side_states/);
  assert.match(backfill, /v_supplier_confirmation\.confirmed_by/);
  assert.match(backfill, /v_buyer_confirmation\.confirmed_by/);
  assert.match(backfill, /where not exists/);
  assert.match(sql, /revoke all on function public\.reconcile_variable_charge_paired_backfill[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reconcile_variable_charge_paired_backfill[\s\S]+to service_role/);
});

test('paired backfill selects exact required suppliers and preserves only authoritative buyer confirmations', () => {
  assert.deepEqual(requiredSupplierIds({
    lineItems: [
      { Original_Supplier__c: 'agent' },
      { Original_Supplier__c: 'manual' },
      { Original_Supplier__c: 'ordinary' },
    ],
    extraCosts: [{ Supplier__c: 'inactive' }],
    accounts: [
      { Id: 'agent', Is_Agent__c: true, Inactive_Suspended__c: false },
      { Id: 'manual', Is_Agent__c: false, Inactive_Suspended__c: false },
      { Id: 'ordinary', Is_Agent__c: false, Inactive_Suspended__c: false },
      { Id: 'inactive', Is_Agent__c: true, Inactive_Suspended__c: true },
    ],
    supplierStages: [{ Supplier__c: 'manual', Manual_Review_Required__c: true }],
  }), ['agent', 'manual']);
  assert.equal(buyerCaseBackfillStatus({
    caseRow: { confirmation_status: 'confirmed' },
    stem: { Variable_Charges_Confirmed__c: true },
    hasHistoricalConfirmation: true,
  }), 'confirmed');
  assert.equal(buyerCaseBackfillStatus({
    caseRow: { confirmation_status: 'confirmed' },
    stem: { Variable_Charges_Confirmed__c: false },
    hasHistoricalConfirmation: true,
  }), 'invalidated');
  assert.equal(buyerCaseBackfillStatus({
    caseRow: { confirmation_status: 'pending' },
    stem: { Variable_Charges_Confirmed__c: false },
    hasHistoricalConfirmation: false,
  }), 'pending');
});

test('paired backfill uses the current Salesforce REST CLI contract', async () => {
  const script = await pairedBackfill;
  const restHelper = script.slice(script.indexOf('function sfRest'), script.indexOf('function staleHeader'));
  assert.match(restHelper, /'api', 'request', 'rest'/);
  assert.match(restHelper, /'--method', method/);
  assert.doesNotMatch(restHelper, /--json/);
});

test('Variable Charges supplier stages are service-only, revision protected, and contain no financial mirror', async () => {
  const sql = await migration;
  assert.match(sql, /create table public\.variable_charge_supplier_stages/);
  assert.match(sql, /create table public\.variable_charge_supplier_confirmations/);
  assert.match(sql, /variable_charge_supplier_stage_revision_guard/);
  assert.match(sql, /variable_charge_supplier_confirmation_guard/);
  assert.match(sql, /revoke all on table[\s\S]+variable_charge_supplier_stages[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant all on table[\s\S]+variable_charge_supplier_confirmations[\s\S]+to service_role/);
  assert.doesNotMatch(sql, /unit_price|line_total|payment_term|clause_text|reference_note/i);
});

test('supplier confirmation requires a reference and stores only hashes and workflow identifiers', async () => {
  const sql = await migration;
  const fn = sql.slice(sql.indexOf('create or replace function public.record_variable_charge_supplier_confirmation'), sql.indexOf('alter table public.variable_charge_cases enable row level security'));
  assert.match(fn, /coalesce\(p_reference_recorded, false\) is false/);
  assert.match(fn, /encode\(digest\(lower\(btrim\(v_actor\.email\)\), 'sha256'\), 'hex'\)/);
  assert.doesNotMatch(fn, /p_reference_text|p_note|p_message_body/);
  assert.match(fn, /security invoker/);
});
