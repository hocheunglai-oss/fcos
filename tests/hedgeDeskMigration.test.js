import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  extractIceMargin,
  validateIceMarginChanges,
} from '../api/_hedgeMaintenance.js';

test('native Hedge Desk migration is private, revisioned, and source traceable', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260801191655_native_hedge_desk_graph_mail.sql', import.meta.url),
    'utf8',
  );

  const tables = [
    'hedge_physical_trades',
    'hedge_swap_hedges',
    'hedge_swap_physical_links',
    'hedge_market_prices',
    'hedge_clearing_entries',
    'hedge_counterparties',
    'hedge_invoices',
    'hedge_invoice_lines',
    'hedge_invoice_swaps',
    'hedge_invoice_physicals',
    'hedge_settings',
    'hedge_month_closes',
    'hedge_report_deliveries',
    'hedge_documents',
    'hedge_integration_operations',
    'hedge_health_history',
    'hedge_migration_runs',
    'hedge_events',
    'hedge_ai_usage_events',
    'email_sender_mailboxes',
    'email_sender_purposes',
    'email_sender_routes',
    'email_sender_events',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`'${table}'`));
  }

  assert.match(sql, /alter table public\.%I enable row level security/);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.%I to service_role/);
  assert.match(sql, /legacy_source_id text unique/);
  assert.match(sql, /function public\.hedge_touch_revision\(\)/);
  assert.match(sql, /create trigger %I_touch_revision/);
  assert.match(sql, /insert into storage\.buckets[\s\S]*'hedge-documents'[\s\S]*false[\s\S]*20971520/);
  assert.match(sql, /'general_manager'[\s\S]*'hedge_close_approve'[\s\S]*'hedge_admin'/);
  assert.match(sql, /'administrator'[\s\S]*'hedge_close_approve'[\s\S]*'hedge_admin'/);
  assert.match(sql, /'manager'[\s\S]*'hedge_book_manage'/);
  assert.match(sql, /'finance'[\s\S]*'hedge_settlement_manage'/);
});

test('invoice deletion removes linked documents atomically before storage cleanup', async () => {
  const [sql, service, settlement, actions] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260803120000_delete_hedge_invoice_documents.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/hedge/views/SettlementView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/hedge/data/ActionsContext.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /create or replace function public\.delete_hedge_invoice_with_documents/i);
  assert.match(sql, /from public\.hedge_invoices[\s\S]*for update/i);
  assert.match(sql, /delete from public\.hedge_documents[\s\S]*delete from public\.hedge_invoices/i);
  assert.match(sql, /revoke all on function public\.delete_hedge_invoice_with_documents\(uuid, bigint\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.delete_hedge_invoice_with_documents\(uuid, bigint\)[\s\S]*to service_role/i);
  assert.match(service, /client\.rpc\('delete_hedge_invoice_with_documents'/);
  assert.match(service, /storage\.from\('hedge-documents'\)\.remove\(storagePaths\)/);
  assert.match(settlement, /undoable: false/);
  assert.match(actions, /undoable = true/);
});

test('Graph mailbox purposes are independent and service controlled', async () => {
  const [sql, graphServer, hedgeDocuments, packageJson] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260801191655_native_hedge_desk_graph_mail.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/_graphEmail.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDocuments.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);

  for (const purpose of [
    'payment_reminders',
    'outstanding_invoice_reports',
    'incoming_payment_reports',
    'growth_coaching',
    'fcos_updates',
    'hedge_settlement',
    'hedge_sfs_reports',
  ]) {
    assert.match(sql, new RegExp(`'${purpose}'`));
    assert.match(graphServer, new RegExp(`'${purpose}'`));
  }

  assert.match(graphServer, /\/users\/\$\{encodeURIComponent\(config\.mailbox\)\}\/sendMail|createMicrosoftGraphMailTransport/);
  assert.match(graphServer, /resolveGraphEmailSender/);
  assert.match(graphServer, /senderSnapshot/);
  assert.match(graphServer, /from\('email_sender_routes'\)/);
  assert.doesNotMatch(graphServer, /FCOS_GRAPH_BOOTSTRAP_|bootstrapGraphEmailRegistry/);
  assert.doesNotMatch(graphServer, /nodemailer|createSmtpTransport|SMTP_/i);
  assert.match(sql, /create table if not exists public\.hedge_integration_operations[\s\S]*created_date timestamptz/);
  assert.match(hedgeDocuments, /\.order\('created_date', \{ ascending: false \}\)/);
  assert.doesNotMatch(hedgeDocuments, /hedge_integration_operations'[\s\S]{0,500}\.order\('created_at'/);
  assert.doesNotMatch(packageJson, /nodemailer/i);
});

test('Hedge migration blocks unmatched identities and preserves normalized relationships', async () => {
  const source = await readFile(new URL('../scripts/migrate-hedge-desk.mjs', import.meta.url), 'utf8');

  assert.match(source, /Multiple active FCOS profiles use/);
  assert.match(source, /Active Hedge Desk users do not match active FCOS profiles/);
  assert.match(source, /HEDGE_SOURCE_IDENTITY_MAP_JSON/);
  assert.match(source, /reviewedIdentityOverrideCount/);
  assert.match(source, /is not one unique active profile/);
  assert.match(source, /legacy_source_id/);
  assert.match(source, /hedge_swap_physical_links/);
  assert.match(source, /hedge_invoice_lines/);
  assert.match(source, /hedge_invoice_swaps/);
  assert.match(source, /hedge_invoice_physicals/);
  assert.match(source, /table === 'hedge_events'[\s\S]*ignoreDuplicates: true/);
  assert.match(source, /sha256/);
  assert.match(source, /SOURCE_BUCKET = 'invoice-pdfs'/);
  assert.match(source, /TARGET_BUCKET = 'hedge-documents'/);
  assert.match(source, /--verify-only/);
  assert.match(source, /--delta/);
  assert.match(source, /cleanLegacySetting/);
  assert.doesNotMatch(source, /service_role[^\n]*['"][A-Za-z0-9._-]{20,}/i);
});

test('ICE margin parsing and change guard reject unsafe automated updates', () => {
  const parsed = extractIceMargin(
    'IFEU MF4 MONTH M2 Sep-26 USD 64,765.00 65,100.00',
    { code: 'MF4', relativePeriod: 'M2' },
  );
  assert.equal(parsed.im, 65_100);
  assert.equal(parsed.expiry, 'Sep-26');

  const allowed = validateIceMarginChanges(
    { S05_FULL: { im: 64_765 } },
    { S05_FULL: { im: 65_100 } },
  );
  assert.equal(allowed.blocked.length, 0);
  assert.equal(allowed.changes.length, 1);

  const blocked = validateIceMarginChanges(
    { S05_FULL: { im: 64_765 } },
    { S05_FULL: { im: 100_000 } },
  );
  assert.equal(blocked.blocked.length, 1);
  assert.match(blocked.blocked[0], /safety threshold/);
});

test('scheduled Hedge maintenance prepares SFS approval and never sends email', async () => {
  const [maintenance, sfs, functions, vercel] = await Promise.all([
    readFile(new URL('../api/_hedgeMaintenance.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeSfsService.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  ]);

  assert.match(maintenance, /evaluateHedgeSfsCandidates/);
  assert.doesNotMatch(maintenance, /sendGraphPurposeMail|sendMail\(/);
  assert.match(sfs, /status: 'pending_approval'/);
  assert.match(sfs, /purposeKey: 'hedge_sfs_reports'/);
  assert.match(functions, /hedgeDeskMaintenanceCron/);
  assert.match(vercel, /hedgeDeskMaintenanceCron/);
});
