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
  '20260904160812_variable_charge_resolution_optional_reference.sql',
  '20260905105308_account_insight_report_presets.sql',
  '20260905111234_account_insight_report_preset_indexes.sql',
  '20260906161240_restrict_browser_role_admin_grants.sql',
  '20260908074607_fcbs_own_account_settlement.sql',
]);
const baseline = migrationSources.filter((migration) => !releaseMigrationNames.has(migration.name));
const upgrade = migrationSources.filter((migration) => releaseMigrationNames.has(migration.name));
if (upgrade.length !== releaseMigrationNames.size) {
  throw new Error('The release migration fixture is incomplete. Update verify-migrations.mjs when release migrations change.');
}
const client = new pg.Client({ connectionString: databaseUrl });

async function resetPublicSchema() {
  await client.query('drop schema if exists emailrouter cascade; drop schema if exists public cascade; create schema public;');
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
  const releaseTables = ['account_insight_report_presets', 'account_insight_report_preset_events', 'hedge_fcbs_settlement_operations'];
  await assertRows(
    `select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[]) and c.relrowsecurity`,
    releaseTables.length, `${label} report presets and FCBS operations RLS`, [releaseTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     where has_table_privilege(r, 'public.' || t, p)`,
    0, `${label} report presets and FCBS operations deny browser grants`, [releaseTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) t cross join unnest(array['SELECT','INSERT']) p
     where has_table_privilege('service_role', 'public.' || t, p)`,
    releaseTables.length * 2, `${label} report presets and FCBS service-role access`, [releaseTables],
  );
  const releaseFunctions = [
    'save_account_insight_report_preset', 'resolve_variable_charge_post_invoice_change',
    'hedge_fcbs_settlement_month', 'hedge_fcbs_settlement_evidence',
    'validate_hedge_fcbs_document', 'protect_hedge_fcbs_issued', 'protect_hedge_fcbs_link_identity',
    'assert_hedge_fcbs_document', 'set_hedge_fcbs_settlement_status', 'save_hedge_fcbs_settlement',
  ];
  await assertRows(
    `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=any($1::text[]) and not p.prosecdef
       and has_function_privilege('service_role',p.oid,'EXECUTE')
       and not has_function_privilege('anon',p.oid,'EXECUTE')
       and not has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    releaseFunctions.length, `${label} release RPCs retain service-only invoker execution`, [releaseFunctions],
  );
  await assertRows(
    `select count(*)::int from pg_indexes where schemaname='public' and indexname=any($1::text[])`,
    3, `${label} report preset reference and active FCBS indexes`,
    [['account_insight_report_preset_events_preset', 'account_insight_report_presets_editor', 'hedge_fcbs_one_active_month']],
  );
  const adminTables = ['app_modules', 'user_profiles', 'user_module_permissions',
    'user_types', 'user_type_module_permissions', 'admin_audit_logs'];
  await assertRows(
    `select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[]) and c.relrowsecurity`,
    adminTables.length, `${label} administration RLS retained`, [adminTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) t cross join
     unnest(array['anon','authenticated']) r cross join
     unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     where has_table_privilege(r, 'public.' || t, p)`,
    0, `${label} browser administration writes denied`, [adminTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) t where has_table_privilege('authenticated', 'public.' || t, 'SELECT')`,
    adminTables.length - 1, `${label} existing RLS-filtered browser reads retained`, [adminTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) t where has_table_privilege('anon', 'public.' || t, 'SELECT')`,
    0, `${label} anonymous administration reads denied`, [adminTables],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
     where has_table_privilege('service_role', 'public.' || t, p)`,
    adminTables.length * 4, `${label} service-role administration retained`, [adminTables],
  );
  const internalHelpers = ['collaboration_item_key', 'variable_charge_side_confirmation_immutable', 'variable_charge_side_state_before_update'];
  await assertRows(
    `select count(*)::int from unnest($1::text[]) f cross join unnest(array['anon','authenticated']) r
     where has_function_privilege(r, 'public.' || f || '()', 'EXECUTE')`,
    0, `${label} internal helpers are not browser RPCs`, [internalHelpers],
  );
  await assertRows(
    `select count(*)::int from unnest($1::text[]) f where has_function_privilege('service_role', 'public.' || f || '()', 'EXECUTE')`,
    internalHelpers.length, `${label} service-role internal helper execution retained`, [internalHelpers],
  );
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
    insert into public.hedge_invoices (legacy_source_id, invoice_number, counterparty, status, subtotal)
    values ('release-upgrade-fixture', 'fixture-legacy-invoice', 'FCBS', 'Sent', 123.45);
  `);
  await applyMigrations(upgrade, 'Upgrade fixture');
  await verifyRuntimeObjects('Upgrade fixture');
  await assertRows(
    `select count(*)::int from public.hedge_invoices where legacy_source_id='release-upgrade-fixture'
     and settlement_basis='counterparty' and source_fingerprint is null and status='Sent' and subtotal=123.45`,
    1, 'Upgrade fixture preserves legacy FCBS invoice basis and amount',
  );
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
