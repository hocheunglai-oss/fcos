import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = readFile(new URL('../supabase/migrations/20260818145155_variable_charges_two_stage_cutover.sql', import.meta.url), 'utf8');

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
