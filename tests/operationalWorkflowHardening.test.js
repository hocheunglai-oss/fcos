import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260712120242_operational_workflow_hardening.sql', import.meta.url);
const functionUrl = new URL('../api/functions/[name].js', import.meta.url);
const appClientUrl = new URL('../src/api/appClient.js', import.meta.url);
const authContextUrl = new URL('../src/lib/AuthContext.jsx', import.meta.url);
const loginUrl = new URL('../src/pages/Login.jsx', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

test('operational migration adds atomic collection and exception workflow writes', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.save_buyer_invoice_collection/i);
  assert.match(sql, /for update;/i);
  assert.match(sql, /changed after it was opened/i);
  assert.match(sql, /create table if not exists public\.exception_review_items/i);
  assert.match(sql, /create table if not exists public\.exception_review_events/i);
  assert.match(sql, /create or replace function public\.save_exception_review_item/i);
  assert.match(sql, /delivery_status in \('sending', 'sent', 'failed', 'uncertain'\)/i);
  assert.match(sql, /revoke all on function public\.save_exception_review_item/i);
});

test('sensitive workflow actions use managed capabilities', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /requireCapability\(client, profile, 'disputes_approve'/);
  assert.match(source, /requireCapability\(client, profile, 'disputes_account'/);
  assert.match(source, /requireCapability\(client, profile, 'financial_report_settings_manage'/);
  assert.match(source, /requireCapability\(client, profile, 'cashflow_forecast_manage'/);
  assert.doesNotMatch(source, /DISPUTE_BETA_APPROVER_EMAILS/);
});

test('short-lived function cache expires and can be cleared at an auth boundary', async () => {
  const source = await readFile(appClientUrl, 'utf8');
  assert.match(source, /DEFAULT_FUNCTION_CACHE_TTL_MS = 30_000/);
  assert.match(source, /navigationCacheDecision\(/);
  assert.match(source, /ageMs: cached \? Date\.now\(\) - cached\.cachedAtMs : 0/);
  assert.match(source, /decision === 'expired'/);
  assert.match(source, /functionResponseCache\.delete\(cacheKey\)/);
  assert.match(source, /clearFunctionCache\(\);\s*\n\s*if \(isSupabaseConfigured\) await supabase\.auth\.signOut/);
});

test('browser authentication loads protected profile data through the server API', async () => {
  const [serverSource, clientSource, appClientSource, loginSource, packageSource] = await Promise.all([
    readFile(functionUrl, 'utf8'),
    readFile(authContextUrl, 'utf8'),
    readFile(appClientUrl, 'utf8'),
    readFile(loginUrl, 'utf8'),
    readFile(packageUrl, 'utf8'),
  ]);
  assert.match(serverSource, /async function authContext\(/);
  assert.match(serverSource, /authContext: \[\]/);
  assert.match(clientSource, /functions\.invoke\('authContext'/);
  assert.match(clientSource, /if \(!result\?\.user\) throw new Error\(loginFailureMessage/);
  assert.doesNotMatch(clientSource, /\.from\('user_profiles'\)/);
  assert.doesNotMatch(clientSource, /\.from\('user_module_permissions'\)/);
  assert.doesNotMatch(clientSource, /\.from\('user_type_module_permissions'\)/);
  assert.match(appClientSource, /responseIsJson/);
  assert.match(appClientSource, /The FCOS server API is unavailable/);
  assert.match(loginSource, /visibleError/);
  const scripts = JSON.parse(packageSource).scripts;
  assert.equal(scripts.dev, 'vite');
  assert.equal(scripts['dev:full'], 'vercel dev');
});

test('report archive compensates cross-system failures', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /googleDriveTrashFile\(driveFile\.id\)/);
  assert.match(source, /googleDriveRenameFile\(current\.drive_file_id, current\.file_name\)/);
  assert.match(source, /googleDriveRestoreFile\(current\.drive_file_id\)/);
});
