import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { disposableDatabaseUrl, LOCAL_PLATFORM_FIXTURE_SQL, migrationSha256, planMigrationVerification } from './lib/migration-verification.mjs';
import { seedUpgradeFixture, verifyUpgradeFixture } from './fixtures/migration-upgrade.mjs';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const names = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
const migrationSources = await Promise.all(names.map(async name => ({ name, sql: await readFile(new URL(name, migrationDirectory), 'utf8') })));
const recordedBaseline = JSON.parse(await readFile(new URL('../config/migration-verification-baseline.json', import.meta.url), 'utf8'));
const plan = planMigrationVerification(migrationSources, recordedBaseline);
const databaseUrl = String(process.env.FCOS_MIGRATION_DATABASE_URL || '').trim();
if (!databaseUrl) {
  if (process.env.FCOS_REQUIRE_LIVE_MIGRATION_CHECK === '1') throw new Error('FCOS_MIGRATION_DATABASE_URL is required for the release migration gate.');
  process.stdout.write(`Verified ${names.length} ordered migration files and ${plan.baseline.length} immutable baseline digests; ${plan.pending.length} pending. Runtime database verification was not requested.\n`);
  process.exit(0);
}
const parsedUrl = disposableDatabaseUrl(databaseUrl);
if (process.env.FCOS_MIGRATION_DISPOSABLE_CLUSTER !== '1') throw new Error('Set FCOS_MIGRATION_DISPOSABLE_CLUSTER=1 only for a disposable local PostgreSQL cluster; historical migrations include role settings.');
const evidenceDirectory = new URL('../output/', import.meta.url);
const evidencePath = new URL('migration-verification.json', evidenceDirectory);
await rm(evidencePath, { force: true });
const owner = new pg.Client({ connectionString: parsedUrl.toString() });
let client;

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
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'missing_nom_b_%'
      and not p.prosecdef and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')`, 7, `${label} Nom B RPCs are server-controlled`);
  await assertRows(`select count(*)::int from public.missing_nom_b_scan_state`, 0, `${label} Nom B activation remains prospective`);
  const accessTables = ['permission_groups', 'user_permission_groups', 'permission_access_events', 'permission_access_migration_snapshots', 'permission_access_catalog'];
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, accessTables.length, `${label} group access RLS`, [accessTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege(r,'public.'||t,p)`, 0, `${label} group access is server-only`, [accessTables]);
  await assertRows(`select count(*)::int from unnest(array['UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('service_role','public.permission_access_events',p)`, 0, `${label} group audit append-only`);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('service_role','public.'||t,p)`, 0, `${label} access service grants exclude inherited ALL privileges`, [accessTables]);
  await assertRows(`select count(*)::int from unnest(array['permission_access_migration_snapshots','permission_access_catalog']) t cross join unnest(array['INSERT','UPDATE','DELETE']) p where has_table_privilege('service_role','public.'||t,p)`, 0, `${label} access migration evidence and catalog read-only`);
  await assertRows(`select count(*)::int from public.permission_access_migration_snapshots s join public.user_profiles u on u.id=s.user_id where u.active and ((public.fcos_effective_access(u.id)->'permissions') is distinct from s.permissions or (public.fcos_effective_access(u.id)->'capabilities') is distinct from s.capabilities)`, 0, `${label} migration exact grant preservation`);

  const campaignTables = ['xero_reconciliation_campaigns','xero_reconciliation_cases','xero_reconciliation_batches','xero_reconciliation_events'];
  await assertRows(`select count(*)::int from pg_proc p where
    p.oid='public.xero_campaign_retry_claim_v1(uuid,uuid,uuid,integer,text,text[])'::regprocedure
    and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=15s']
    and has_function_privilege('service_role',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    1, `${label} bounded original-approved credit retry is server-only`);
  const sharedXeroTables = ['xero_shared_tenant_control','xero_shared_budgets','xero_shared_probe_grants','xero_shared_requests','xero_token_refresh_leases'];
  await assertRows(`select count(*)::int from pg_proc p where
    p.oid='public.xero_campaign_inventory_v1(uuid,uuid,uuid,jsonb)'::regprocedure
    and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=45s']
    and has_function_privilege('service_role',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    1, `${label} complete inventory write has a bounded RPC-local timeout and unchanged execution scope`);
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, 9, `${label} campaign and shared quota RLS`, [[...campaignTables,...sharedXeroTables]]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege(r,'public.'||t,p)`,
    0, `${label} campaign and shared quota browser denial`, [[...campaignTables,...sharedXeroTables]]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('service_role','public.'||t,p)`,0,`${label} campaign mutations restricted to checked RPCs`,[campaignTables]);
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='xero_financial_preview_checkpoints' and c.relrowsecurity and c.relforcerowsecurity`,
    1, `${label} preview checkpoint forced RLS`);
  await assertRows(`select count(*)::int from unnest(array['anon','authenticated']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege(r,'public.xero_financial_preview_checkpoints',p)`,
    0, `${label} preview checkpoint browser denial`);
  await assertRows(`select count(*)::int from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('service_role','public.xero_financial_preview_checkpoints',p)`,
    0, `${label} preview checkpoint mutations require checked RPCs`);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join unnest(array['anon','authenticated']) r where n.nspname='public' and p.proname like 'xero_preview_checkpoint_%'
      and has_function_privilege(r,p.oid,'EXECUTE')`,
    0, `${label} preview checkpoint browser RPC denial`);
  const previewStageTables = ['xero_financial_preview_checkpoint_chunks','xero_financial_preview_builds','xero_financial_preview_build_items'];
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity and c.relforcerowsecurity`,
    previewStageTables.length, `${label} bounded preview forced RLS`, [previewStageTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege(r,'public.'||t,p)`, 0, `${label} bounded preview browser denial`, [previewStageTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('service_role','public.'||t,p)`, 0, `${label} bounded preview mutations require checked RPCs`, [previewStageTables]);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join unnest(array['anon','authenticated']) r where n.nspname='public'
      and p.proname in ('begin_xero_financial_preview_v2','append_xero_financial_preview_v2','finalize_xero_financial_preview_v2')
      and has_function_privilege(r,p.oid,'EXECUTE')`, 0, `${label} staged preview browser RPC denial`);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid='public.finalize_xero_financial_preview_v2(uuid,text)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""','TimeZone=UTC','statement_timeout=45s']
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    1, `${label} complete preview finalization has a bounded RPC-local timeout and unchanged execution scope`);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array['xero_campaign_create_v1','xero_campaign_refresh_v1'])
      and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=45s']
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    2, `${label} complete campaign creation and refresh retain bounded RPC-local timeouts and execution scope`);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid='public.persist_xero_financial_preview_v1(jsonb,jsonb,text)'::regprocedure
      and not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp','statement_timeout=45s']
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    1, `${label} atomic document preview retains bounded timeout and server-only execution`);
  const privatePaymentReaders = ['xero_preview_checkpoint_node_value_v2','xero_preview_payment_rows_v2'];
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[])`,
    privatePaymentReaders.length, `${label} bounded payment checkpoint readers exist`, [privatePaymentReaders]);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='public'
      and p.proname=any($1::text[]) and has_function_privilege(r,p.oid,'EXECUTE')`,
    0, `${label} payment checkpoint readers remain private to checked RPCs`, [privatePaymentReaders]);
  await assertRows(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname=any($1::text[]) and acl.grantee=0 and acl.privilege_type='EXECUTE'`,
    0, `${label} payment checkpoint readers deny PUBLIC execution`, [privatePaymentReaders]);
  const nomBTables = ['dashboard_nom_b_policies', 'dashboard_nom_b_observations', 'dashboard_nom_b_events'];
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, 3, `${label} Nom B RLS`, [nomBTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege(r,'public.'||t,p)`,
  0, `${label} Nom B browser access denied`, [nomBTables]);
  await assertRows(`select count(*)::int from unnest(array['UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('service_role','public.dashboard_nom_b_events',p)`, 0, `${label} Nom B append-only audit`);
  const correctionTables = ['xero_document_field_correction_previews', 'xero_document_field_correction_claims', 'xero_document_field_correction_events'];
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, 3, `${label} correction journal RLS`, [correctionTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,'public.'||t,p)`, 0, `${label} correction browser access denied`, [correctionTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('service_role','public.'||t,p)`, 0, `${label} correction journal append-only`, [correctionTables]);
  const identityTables = ['xero_contact_identity_decisions', 'xero_contact_identity_audit'];
  await assertRows(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, 2, `${label} contact identity RLS`, [identityTables]);
  await assertRows(`select count(*)::int from unnest($1::text[]) t cross join unnest(array['anon','authenticated']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,'public.'||t,p)`, 0, `${label} contact identity browser access denied`, [identityTables]);
  await assertRows(`select count(*)::int from unnest(array['anon','authenticated']) r where has_function_privilege(r,
    'public.save_xero_contact_identity_v1(uuid,uuid,text,text,text,text,integer,uuid,text)','EXECUTE')`, 0, `${label} contact identity browser RPC denied`);
  await assertRows(`select count(*)::int from unnest(array['UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('service_role','public.xero_contact_identity_audit',p)`, 0, `${label} contact identity audit immutable for service`);
  const releaseTables = ['company_finance_settings', 'company_finance_setting_events', 'market_trader_workspaces', 'workflow_daily_metrics', 'collaboration_create_requests', 'account_insight_report_presets', 'account_insight_report_preset_events', 'hedge_fcbs_settlement_operations'];
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
  await assertRows(
    `select count(*)::int from information_schema.columns where table_schema='public'
     and table_name='xero_financial_payment_mappings' and column_name='retained_reference'
     and data_type='jsonb' and is_nullable='NO' and column_default='''{}''::jsonb'`,
    1, `${label} retained payment evidence has a compatible empty default`,
  );
  await assertRows(
    `select count(*)::int from pg_index i join pg_class c on c.oid=i.indexrelid
     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and i.indisunique and i.indisvalid
     and c.relname=any($1::text[])`,
    2, `${label} payment identities have unique canonical ownership`,
    [['xero_financial_payment_mappings_canonical_sf_uidx', 'xero_financial_payment_mappings_canonical_xero_uidx']],
  );
  const releaseFunctions = [
    'fcos_effective_access', 'fcos_has_access', 'fcos_assert_access_administrator', 'fcos_save_user_groups', 'fcos_save_permission_group', 'fcos_delete_permission_group', 'fcos_profile_access_revision', 'fcos_profile_access_change_lock', 'fcos_reject_legacy_permission_write',
    'save_dashboard_nom_b_policy', 'observe_dashboard_nom_b',
    'claim_xero_document_field_correction_v1', 'finish_xero_document_field_correction_v1', 'read_xero_document_field_correction_page_v1',
    'link_xero_issued_petroleum_document_v1',
    'link_xero_issued_petroleum_document_v2', 'xero_issued_petroleum_attachment_manifest_v2',
    'link_xero_issued_supplier_document_v1',
    'link_xero_grouped_document_v1', 'xero_grouped_salesforce_id_v1', 'protect_xero_grouped_mapping_v1',
    'link_xero_payment_references_v1',
    'authorise_xero_financial_sync_run_v1',
    'persist_xero_financial_preview_v1',
    'save_company_finance_settings', 'save_company_finance_settings_v2', 'valid_company_bank_charges',
    'save_market_trader_workspace',
    'save_account_insight_report_preset', 'resolve_variable_charge_post_invoice_change',
    'hedge_fcbs_settlement_month', 'hedge_fcbs_settlement_evidence',
    'validate_hedge_fcbs_document', 'protect_hedge_fcbs_issued', 'protect_hedge_fcbs_link_identity',
    'assert_hedge_fcbs_document', 'set_hedge_fcbs_settlement_status', 'save_hedge_fcbs_settlement',
  ];
  await assertRows(
    `select count(*)::int from pg_index i join pg_class c on c.oid=i.indexrelid
     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
     and c.relname='xero_financial_preview_request_receipt_uidx' and i.indisunique and i.indisvalid`,
    1, `${label} preview retry receipts preserve unique request identity`,
  );
  await assertRows(
    `select count(*)::int from pg_index i join pg_class c on c.oid=i.indexrelid
     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and i.indisunique and i.indisvalid
     and c.relname=any($1::text[])`,
    4, `${label} canonical ownership and one active document batch are enforced`,
    [['xero_financial_documents_canonical_sf_uidx', 'xero_financial_documents_canonical_xero_uidx',
      'xero_financial_products_canonical_sf_uidx', 'xero_financial_one_processing_document_run_uidx']],
  );
  await assertRows(
    `select count(*)::int from pg_trigger where tgrelid='public.xero_financial_document_mappings'::regclass
     and tgname='protect_xero_grouped_mapping' and not tgisinternal and tgenabled='O'`,
    1, `${label} accepted document proof remains protected`,
  );
  await assertRows(
    `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='protect_xero_grouped_mapping_v1'
       and position('issuedSupplierPreservation' in p.prosrc)>0
       and position('groupedPreservation' in p.prosrc)>0`,
    1, `${label} both document preservation policies remain immutable`,
  );
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
    'missing_nom_b_scan_state',
    'missing_nom_b_reminders',
    'missing_nom_b_upload_operations',
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

async function runScenario(label, migrations, upgrade = false) {
  const name = `fcos_migration_verify_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  try {
    await owner.query(`create database "${name}" template template0`);
    created = true;
    const url = new URL(parsedUrl); url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await client.query("set statement_timeout='60s'; set lock_timeout='5s'");
    await client.query(LOCAL_PLATFORM_FIXTURE_SQL);
    await applyMigrations(migrations, label);
    if (upgrade) {
      const evidence = await seedUpgradeFixture(client);
      await applyMigrations(plan.pending, 'Populated release upgrade');
      await verifyUpgradeFixture(client, evidence);
    }
    await verifyRuntimeObjects(label);
  } finally {
    try { if (client) await client.end(); }
    finally {
      client = null;
      if (created) await owner.query(`drop database "${name}" with (force)`);
    }
  }
}

await owner.connect();
let originalSchemaSetting;
let settingsCaptured = false;
try {
  const identity = (await owner.query(`select host(inet_server_addr()) as address, current_database() as database,
    current_setting('data_directory') as data_directory`)).rows[0];
  assert.ok(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(identity.address), 'Migration verification requires a loopback database server.');
  assert.equal(identity.database, decodeURIComponent(parsedUrl.pathname.slice(1)), 'Database target did not match the requested local database.');
  if (process.env.FCOS_MIGRATION_EXPECTED_DATA_DIRECTORY) assert.equal(identity.data_directory, process.env.FCOS_MIGRATION_EXPECTED_DATA_DIRECTORY);
  const roles = (await owner.query("select rolname,rolconfig from pg_roles where rolname=any($1::text[])", [['postgres', 'anon', 'authenticated', 'service_role', 'authenticator']])).rows;
  assert.equal(roles.length, 5, 'Disposable cluster must have the standard Supabase roles.');
  originalSchemaSetting = roles.find(role => role.rolname === 'authenticator').rolconfig?.find(value => value.startsWith('pgrst.db_schemas='))?.slice('pgrst.db_schemas='.length);
  settingsCaptured = true;
  await runScenario('Empty database', plan.ordered);
  await runScenario('Populated release upgrade', plan.baseline, true);
} finally {
  try {
    if (settingsCaptured) {
      if (originalSchemaSetting === undefined) await owner.query('alter role authenticator reset pgrst.db_schemas');
      else await owner.query(`alter role authenticator set pgrst.db_schemas to ${pg.escapeLiteral(originalSchemaSetting)}`);
    }
  } finally { await owner.end(); }
}
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  baselineCommit: plan.baselineCommit,
  baselineVersion: plan.baselineVersion,
  migrationCount: names.length,
  chainSha256: migrationSha256(JSON.stringify(plan.ordered.map(({ name, sql }) => ({ name, sha256: migrationSha256(sql) })))),
  pending: plan.pending.map(({ name, sql }) => ({ name, sha256: migrationSha256(sql) })),
  scenarios: ['empty-database', 'populated-release-upgrade'],
  platformFixture: 'migration-contracts-only',
  temporaryDatabasesRemoved: true,
  authenticatorSettingRestored: true,
}, null, 2)}\n`);
process.stdout.write(`Verified ${names.length} migrations on empty and populated upgrade fixtures from ${plan.baselineVersion} (${plan.baselineCommit}); ${plan.pending.length} pending applied chronologically. Temporary databases removed.\n`);
