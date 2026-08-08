import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260807163729_ship_agent_final_charges.sql', import.meta.url);
const triggerPrivilegesMigrationUrl = new URL('../supabase/migrations/20260808043932_ship_agent_trigger_function_privileges.sql', import.meta.url);

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

async function triggerPrivilegesMigration() {
  return readFile(triggerPrivilegesMigrationUrl, 'utf8');
}

test('Ship-Agent charges migration keeps workflow data service-only and excludes mirrored financial records', async () => {
  const sql = await migration();
  for (const table of [
    'ship_agent_charge_cases',
    'ship_agent_charge_confirmations',
    'ship_agent_charge_events',
    'ship_agent_charge_operations',
    'ship_agent_charge_notification_states',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(sql, /source_fingerprint text not null/);
  assert.match(sql, /supplier_fingerprint text not null/);
  assert.match(sql, /salesforce_stem_last_modified_at timestamptz/);
  assert.match(sql, /charge_to_buyer boolean not null/);
  assert.match(sql, /evidence_present boolean not null/);
  assert.doesNotMatch(sql, /charge_amount|unit_price|total_amount|line_item_amount|payment_term_amount/i);
});

test('Ship-Agent workflow functions are security-invoker, revision-protected, immutable, and browser-revoked', async () => {
  const sql = await migration();
  for (const rpc of [
    'sync_ship_agent_charge_case',
    'confirm_ship_agent_charge_case',
    'override_ship_agent_charge_assignment',
    'resolve_ship_agent_post_invoice_change',
    'reserve_ship_agent_charge_operation',
    'complete_ship_agent_charge_operation',
    'set_ship_agent_charge_notification_state',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\(`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}\\([^\\n]+from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}\\([^\\n]+to service_role`));
  }
  assert.match(sql, /security invoker/g);
  assert.match(sql, /ship_agent_charge_cases_revision_guard/);
  assert.match(sql, /Ship-Agent case revision is managed by the database/);
  assert.match(sql, /ship_agent_charge_confirmations_immutable/);
  assert.match(sql, /ship_agent_charge_events_protect/);
  assert.match(sql, /Ship-Agent operations? identity is immutable/);
  assert.match(sql, /where role_row\.role = 'general_manager'/);
  assert.match(sql, /coalesce\(cardinality\(v_general_manager_ids\), 0\) <> 1/);
});

test('Ship-Agent trigger helpers revoke implicit browser execution', async () => {
  const sql = await triggerPrivilegesMigration();
  for (const helper of [
    'ship_agent_charge_case_before_update',
    'ship_agent_charge_confirmation_immutable',
    'ship_agent_charge_event_protect',
    'ship_agent_charge_operation_before_update',
    'ship_agent_charge_notification_before_update',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${helper}\\(\\) from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${helper}\\(\\) to service_role`));
  }
});

test('Ship-Agent operations and audit events have deterministic idempotency and redaction controls', async () => {
  const sql = await migration();
  assert.match(sql, /operation_id uuid primary key/);
  assert.match(sql, /request_fingerprint text not null/);
  assert.match(sql, /already used for a different request/);
  assert.match(sql, /unique \(case_id, event_key\)/);
  assert.match(sql, /Ship-Agent event metadata may contain only redacted workflow fields/);
  assert.match(sql, /Ship-Agent operation results may contain only redacted workflow fields/);
  assert.match(sql, /Review every current Ship-Agent row and make a buyer-charge decision before confirming/);
  assert.match(sql, /requires a reference or note, or Salesforce File evidence/);
  assert.match(sql, /General Manager confirmation override requires a reason/);
  assert.match(sql, /General Manager reason are required/);
  assert.match(sql, /post_invoice_resolution text null/);
  assert.match(sql, /'no_adjustment', 'revised_invoice', 'credit_note'/);
});
