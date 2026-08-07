import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
const invalidNames = names.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
const timestamps = names.map((name) => name.slice(0, 14));
const duplicates = timestamps.filter((value, index) => timestamps.indexOf(value) !== index);

if (!names.length) throw new Error('No Supabase migrations were found.');
if (invalidNames.length) throw new Error(`Invalid migration filenames: ${invalidNames.join(', ')}`);
if (duplicates.length) throw new Error(`Duplicate migration timestamps: ${[...new Set(duplicates)].join(', ')}`);

const databaseUrl = String(process.env.FCOS_MIGRATION_DATABASE_URL || '').trim();
const requireLive = process.env.FCOS_REQUIRE_LIVE_MIGRATION_CHECK === '1';
if (!databaseUrl) {
  if (requireLive) throw new Error('FCOS_MIGRATION_DATABASE_URL is required for the release migration gate.');
  process.stdout.write(`Verified ${names.length} ordered Supabase migration files. Runtime database verification was not requested.\n`);
  process.exit(0);
}

const parsedUrl = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error('Migration verification may run only against a disposable local Supabase database.');
}

const migrationSources = await Promise.all(names.map(async (name) => ({
  name,
  sql: await readFile(new URL(name, migrationDirectory), 'utf8'),
})));
const releaseMigrationNames = new Set([
  '20260806090000_financial_report_settings_and_currency_thresholds.sql',
  '20260806100000_dispute_external_closure_reconciliation.sql',
  '20260807120000_email_router_forward_file_learning.sql',
]);
const baseline = migrationSources.filter((migration) => !releaseMigrationNames.has(migration.name));
const upgrade = migrationSources.filter((migration) => releaseMigrationNames.has(migration.name));
if (upgrade.length !== releaseMigrationNames.size) {
  throw new Error('The release migration fixture is incomplete. Update verify-migrations.mjs when release migrations change.');
}
const client = new pg.Client({ connectionString: databaseUrl });

async function resetPublicSchema() {
  await client.query('drop schema if exists public cascade; create schema public;');
  await client.query('grant usage on schema public to postgres, anon, authenticated, service_role; grant create on schema public to postgres, service_role;');
}

async function applyMigrations(migrations, label) {
  for (const migration of migrations) {
    try {
      await client.query(migration.sql);
    } catch (error) {
      throw new Error(`${label} failed at ${migration.name}: ${error.message}`, { cause: error });
    }
  }
}

async function assertRows(sql, expected, label, values = []) {
  const result = await client.query(sql, values);
  const actual = Number(result.rows[0]?.count ?? result.rowCount ?? 0);
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}.`);
}

async function verifyRuntimeObjects(label) {
  const serviceOnlyTables = [
    'financial_report_settings',
    'financial_report_setting_events',
    'payment_collection_currency_thresholds',
    'payment_collection_threshold_events',
  ];
  await assertRows(
    `select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[]) and c.relrowsecurity`,
    serviceOnlyTables.length,
    `${label} RLS verification`,
    [serviceOnlyTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) table_name where has_table_privilege('anon', 'public.' || table_name, 'select') or has_table_privilege('authenticated', 'public.' || table_name, 'select')`,
    0,
    `${label} browser-role grant verification`,
    [serviceOnlyTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) table_name where has_table_privilege('service_role', 'public.' || table_name, 'select,insert,update,delete')`,
    serviceOnlyTables.length,
    `${label} service-role grant verification`,
    [serviceOnlyTables],
  );
  await assertRows(
    `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[]) and not p.prosecdef`,
    3,
    `${label} security-invoker RPC verification`,
    [['save_financial_report_settings', 'save_payment_collection_currency_threshold', 'save_payment_collection_currency_thresholds']],
  );
  await assertRows(
    `select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'dispute_beta_cases' and column_name = any($1::text[])`,
    5,
    `${label} external-closure columns`,
    [['external_closure_detected_at', 'external_closure_salesforce_status', 'external_closure_accepted_at', 'external_closure_accepted_by', 'external_closure_acceptance_reason']],
  );
  const emailRouterTables = [
    'routing_folders',
    'advisor_recommendations',
    'advisor_learning_outcomes',
    'advisor_learning_outcome_destinations',
    'advisor_learning_jobs',
    'advisor_feedback',
  ];
  await assertRows(
    `select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'emailrouter' and c.relname = any($1::text[]) and c.relrowsecurity`,
    emailRouterTables.length,
    `${label} Email Router RLS verification`,
    [emailRouterTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) table_name where has_table_privilege('anon', 'emailrouter.' || table_name, 'select') or has_table_privilege('authenticated', 'emailrouter.' || table_name, 'select')`,
    0,
    `${label} Email Router browser-role grant verification`,
    [emailRouterTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) table_name where has_table_privilege('service_role', 'emailrouter.' || table_name, 'select,insert,update,delete')`,
    emailRouterTables.length,
    `${label} Email Router service-role grant verification`,
    [emailRouterTables],
  );
  await assertRows(
    `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[]) and not p.prosecdef`,
    3,
    `${label} Email Router security-invoker RPC verification`,
    [['save_emailrouter_routing_folders', 'forget_emailrouter_learning_outcome', 'forget_emailrouter_learning_pattern']],
  );
  await assertRows(
    `select count(*)::int from information_schema.columns where table_schema = 'emailrouter' and table_name = 'mail_actions' and column_name = any($1::text[])`,
    11,
    `${label} Email Router post-action columns`,
    [[
      'post_action_mode', 'post_action_folder_id', 'post_action_folder_provider_id_snapshot',
      'post_action_folder_path_snapshot', 'post_action_state', 'post_action_attempt_count',
      'post_action_failure_code', 'post_action_confirmed_at', 'learning_state',
      'learning_recipients_complete', 'advisor_recommendation_id',
    ]],
  );
}

await client.connect();
try {
  await resetPublicSchema();
  await applyMigrations(migrationSources, 'Empty-database migration chain');
  await verifyRuntimeObjects('Empty database');

  await resetPublicSchema();
  await applyMigrations(baseline, 'Upgrade baseline');
  await client.query(`
    update public.buyer_invoice_email_settings
    set settings = jsonb_set(jsonb_set(settings - 'from', '{to}', '["finance-fixture@example.invalid"]'::jsonb, true), '{cc}', '[]'::jsonb, true),
        updated_by_email = 'migration-fixture',
        updated_at = created_at + interval '1 minute'
    where id = 'default';
    update public.incoming_payment_settings set fully_paid_threshold = 50 where id = 'default';
  `);
  await applyMigrations(upgrade, 'Upgrade fixture');
  await verifyRuntimeObjects('Upgrade fixture');
  await assertRows(
    `select count(*)::int from public.financial_report_settings where purpose_key = 'outstanding_invoice_reports' and configured and settings->'to' = '["finance-fixture@example.invalid"]'::jsonb and not settings ? 'from'`,
    1,
    'Upgrade fixture preserved approved report recipients without a sender override',
  );
  await assertRows(
    `select count(*)::int from public.incoming_payment_settings where id = 'default' and legacy_fully_paid_threshold = 50`,
    1,
    'Upgrade fixture retained the old global threshold only as audit history',
  );
  await assertRows(
    `select count(*)::int from public.payment_collection_currency_thresholds`,
    0,
    'Upgrade fixture did not copy the legacy threshold into every currency',
  );
} finally {
  await client.end();
}

process.stdout.write(`Verified ${names.length} migrations against empty and upgrade Supabase fixtures, including constraints, RPC security, grants, and RLS.\n`);
