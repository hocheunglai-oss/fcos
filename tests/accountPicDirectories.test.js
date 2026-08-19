import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ACCOUNT_PIC_CSV_HEADERS,
  ACCOUNT_PIC_MAX_CSV_BYTES,
  accountPicCsv,
  accountPicDirectoryProjection,
  accountPicPayloadHash,
  normalizeAccountPicRows,
  parseAccountPicCsv,
} from '../api/_accountPicDirectories.js';

const migrationUrl = new URL('../supabase/migrations/20260819092105_account_pic_directories.sql', import.meta.url);
const flexibleMigrationUrl = new URL('../supabase/migrations/20260819103109_account_pic_flexible_schema.sql', import.meta.url);
const handlerUrl = new URL('../api/functions/[name].js', import.meta.url);
const policyUrl = new URL('../api/_handlerPolicyRegistry.js', import.meta.url);

function syntheticCsv() {
  const lines = [ACCOUNT_PIC_CSV_HEADERS.join(',')];
  for (let index = 1; index <= 9; index += 1) {
    lines.push([
      `Region ${index}`,
      `Person ${index}\nDeputy ${index}`,
      `Team ${index}`,
      index % 2 ? '' : `Lead ${index}`,
      index % 2 ? 'Container' : 'Tanker',
    ].map((value) => `"${value}"`).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

test('parses a BOM CSV with exactly five headers, preserving internal lines and normalizing outer whitespace', () => {
  const rows = parseAccountPicCsv(syntheticCsv());
  assert.equal(rows.length, 9);
  assert.deepEqual(rows[0], {
    position: 1,
    portRegion: 'Region 1',
    responsiblePersonnel: 'Person 1\nDeputy 1',
    team: 'Team 1',
    reportingSupervision: '',
    vesselTypesCovered: 'Container',
  });

  const normalized = normalizeAccountPicRows([{
    portRegion: '  Region X  ',
    responsiblePersonnel: '  First\r\nSecond  ',
    team: ' Team X ',
    reportingSupervision: '  ',
    vesselTypesCovered: ' Container ',
  }]);
  assert.deepEqual(normalized[0], {
    position: 1,
    portRegion: 'Region X',
    responsiblePersonnel: 'First\nSecond',
    team: 'Team X',
    reportingSupervision: '',
    vesselTypesCovered: 'Container',
  });
});

test('CSV round-trips multiline values without changing the five reference columns', () => {
  const original = parseAccountPicCsv(syntheticCsv());
  const roundTrip = parseAccountPicCsv(accountPicCsv(original));
  assert.deepEqual(roundTrip, original);
});

test('rejects malformed CSV, wrong headers, blank Port / Region, and unsafe oversized rows', () => {
  assert.throws(() => parseAccountPicCsv('Port / Region,Team\nA,B'), /headers must be exactly/i);
  assert.throws(() => parseAccountPicCsv(`${ACCOUNT_PIC_CSV_HEADERS.join(',')}\n"unterminated`), /unterminated/i);
  assert.throws(() => parseAccountPicCsv(`${ACCOUNT_PIC_CSV_HEADERS.join(',')}\n"Hong Kong"unexpected,,,,`), /after a closing quote/i);
  assert.throws(() => parseAccountPicCsv('x'.repeat(ACCOUNT_PIC_MAX_CSV_BYTES + 1)), /smaller than 2 MB/i);
  assert.throws(() => normalizeAccountPicRows([{
    portRegion: ' ',
    responsiblePersonnel: '',
    team: '',
    reportingSupervision: '',
    vesselTypesCovered: '',
  }]), /Port \/ Region/i);
  assert.throws(() => normalizeAccountPicRows(Array.from({ length: 501 }, () => ({
    portRegion: 'Region',
    responsiblePersonnel: '',
    team: '',
    reportingSupervision: '',
    vesselTypesCovered: '',
  }))), /at most 500/i);
});

test('hashes the exact normalized revision without exposing it in the directory projection', () => {
  const rows = normalizeAccountPicRows([{
    portRegion: 'Region',
    responsiblePersonnel: 'Person',
    team: 'Team',
    reportingSupervision: '',
    vesselTypesCovered: 'Container',
  }]);
  assert.match(accountPicPayloadHash({ accountId: '0012x00000A1B2CAA0', rows }), /^[a-f0-9]{64}$/);
  assert.notEqual(
    accountPicPayloadHash({ accountId: '0012x00000A1B2CAA0', rows }),
    accountPicPayloadHash({ accountId: '0012x00000A1B2CAA0', rows: [{ ...rows[0], team: 'Other team' }] }),
  );
  const projection = accountPicDirectoryProjection({
    salesforce_account_id: '0012x00000A1B2CAA0',
    account_name: 'Example Buyer',
    cl_key: 'EXAMPLE',
    account_role: 'buyer',
    row_count: 1,
    column_count: 5,
    revision: 2,
    updated_at: '2026-08-19T00:00:00Z',
    updated_by_email: 'editor@example.test',
  }, [{ id: 'a', sequence: 1, port_region: 'Region', responsible_personnel: 'Person', team: 'Team', reporting_supervision: '', vessel_types_covered: 'Container' }]);
  assert.equal(projection.rows[0].position, 1);
  assert.equal(projection.rowCount, 1);
  assert.equal(projection.columnCount, 5);
  assert.equal(projection.rows[0].responsiblePersonnel, 'Person');
});

test('migration is atomic, revision-protected, service-role-only, and audits no PIC cell contents', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create table if not exists public\.account_pic_directories/i);
  assert.match(sql, /create table if not exists public\.account_pic_directory_rows/i);
  assert.match(sql, /create table if not exists public\.account_pic_directory_operations/i);
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /revoke all on table public\.account_pic_directories from public, anon, authenticated/i);
  assert.match(sql, /grant all on table public\.account_pic_directory_rows to service_role/i);
  assert.match(sql, /create or replace function public\.save_account_pic_directory/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /changed after it was opened/i);
  assert.match(sql, /idempotency_key/i);
  assert.match(sql, /account_pic_directory_imported/i);
  assert.match(sql, /row_count/i);
  assert.match(sql, /Every Buyer PIC row requires Port \/ Region/i);
  assert.match(sql, /port_region text not null default '' check \(btrim\(port_region\) <> ''/i);
  assert.match(sql, /revoke all on function public\.save_account_pic_directory[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.save_account_pic_directory[\s\S]*to service_role/i);

  const auditBlock = sql.match(/insert into public\.admin_audit_logs[\s\S]*?return jsonb_build_object/s)?.[0] || '';
  assert.doesNotMatch(auditBlock, /responsible_personnel|reporting_supervision|vessel_types_covered|port_region|team/i);
  assert.doesNotMatch(auditBlock, /account_name|cl_key/i);
});

test('flexible schema is typed, service-only, revision-protected, and redacts cell contents', async () => {
  const sql = await readFile(flexibleMigrationUrl, 'utf8');
  assert.match(sql, /account_pic_directory_columns/);
  assert.match(sql, /input_type in \('text', 'multiline_text', 'checkbox', 'number', 'buyer_trader', 'supplier_trader'\)/);
  assert.match(sql, /column_kind in \('field', 'vessel_type'\)/);
  assert.match(sql, /add column if not exists row_label/);
  assert.match(sql, /add column if not exists cells jsonb/);
  assert.match(sql, /create or replace function public\.save_account_pic_directory_v2/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /revoke all on table public\.account_pic_directory_columns from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.account_pic_directory_columns to service_role/);
  assert.match(sql, /column_count/);
  assert.match(sql, /cell_count/);
  const auditBlock = sql.match(/insert into public\.admin_audit_logs[\s\S]*?return jsonb_build_object/s)?.[0] || '';
  assert.doesNotMatch(auditBlock, /v_cell|v_cells|v_label|row_label/);
});

test('handlers are module-gated, revalidate Salesforce, return current detail after every mutation, and fail closed', async () => {
  const source = await readFile(handlerUrl, 'utf8');
  const policies = await readFile(policyUrl, 'utf8');
  for (const name of ['accountPicDirectoryList', 'accountPicAccountOptions', 'accountPicTraderOptions', 'accountPicDirectoryDetail', 'accountPicDirectorySave', 'accountPicDirectoryImport']) {
    assert.match(source, new RegExp(`${name}: \\['buyers_administrator'\\]`));
    assert.match(policies, new RegExp(`${name}:`));
  }
  assert.match(source, /currentAccountPicAccount\(body\.accountId\)/);
  assert.match(source, /Inactive_Suspended__c !== false \|\| record\.Is_Broker__c === true/);
  assert.match(source, /RecordType\?\.Name.*group/);
  assert.match(source, /Buyer_Payment_Term__c/);
  assert.match(source, /parseAccountPicCsv\(body\.csvText\)/);
  assert.match(source, /save_account_pic_directory_v2/);
  assert.match(source, /One or more selected trader profiles are no longer active/);
  assert.match(source, /Buffer\.byteLength\(body\.csvText, 'utf8'\) > ACCOUNT_PIC_MAX_CSV_BYTES/);
  assert.match(source, /appError\('CSV is too large\. Use a file smaller than 2 MB\.', 413\)/);
  assert.match(source, /accountId: account\.id[\s\S]*accountName: account\.name/);
  assert.match(source, /loadAccountPicDirectory\(client, account\.id, \{ revalidate: false \}\)/);
  assert.match(source, /account_name: currentAccount\.name/);
  assert.match(source, /cl_key: currentAccount\.clKey/);
  assert.match(source, /account_role: currentAccount\.role/);
  assert.match(source, /const currentAccount = activeById\.get\(directory\.salesforce_account_id\)/);
  assert.match(source, /rowCount: directory\.rowCount,[\s\S]*columnCount: directory\.columnCount/);
});
