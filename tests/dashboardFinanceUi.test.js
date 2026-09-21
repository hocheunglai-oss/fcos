import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dashboard Gross Profit card offers an opt-in currency-safe EBIT view', async () => {
  const source = await read('src/components/dashboard/DashboardKpis.jsx');

  assert.match(source, /ebitEnabled = false/);
  assert.match(source, /onCheckedChange=\{\(checked\) => onChange\?\.\(checked === true\)\}/);
  assert.match(source, /Show EBIT in place of Gross Profit/);
  assert.match(source, /Gross profit net finance costs: interest and bank charges/);
  assert.match(source, /summary\?\.finance/);
  assert.match(source, /annualInterestRatePct/);
  assert.match(source, /dayCountBasis/);
  assert.match(source, /Calculated through/);
  assert.match(source, /Partial EBIT/);
  assert.match(source, /Verified GP/);
  assert.match(source, /Full selection gross profit/);
  assert.match(source, /Gross profit before finance/);
  assert.match(source, /interest or bank-charge evidence missing/);
  assert.match(source, /STEMs excluded/);
  assert.match(source, /dashboardEbitPresentation/);
  assert.match(source, /financeLoading/);
  assert.match(source, /financeError/);
});

test('Finance settings load the server rate, validate edits, and revision-protect saves', async () => {
  const source = await read('src/components/settings/FinanceSettings.jsx');

  assert.match(source, /financeSettingsGet/);
  assert.match(source, /financeSettingsSave/);
  assert.match(source, /expectedRevision: settings\?\.revision/);
  assert.match(source, /annualInterestRatePct: Number\(draft\.annualInterestRatePct\)/);
  assert.match(source, /bankChargesUsd: \{ UBS: Number\(draft\.UBS\), DBS: Number\(draft\.DBS\) \}/);
  assert.match(source, /validateBankCharge/);
  assert.match(source, /charge > 1_000_000/);
  assert.match(source, /UBS remittance charge/);
  assert.match(source, /DBS remittance charge/);
  assert.match(source, /Enter 0–100 with up to two decimal places/);
  assert.match(source, /Your draft is still here; refresh the setting/);
  assert.match(source, /invalidateTags: \['finance-settings', 'dashboard'\]/);
  assert.match(source, /fcos:finance-settings-updated/);
  assert.match(source, /permissions\.canManageSettings === true/);
  assert.doesNotMatch(source, /annualInterestRatePct\s*\?\?\s*5/);
  assert.doesNotMatch(source, /useState\(['"]5(?:\.00)?['"]\)/);
});

test('Finance is a lazy Dashboard-visible Settings section', async () => {
  const workspace = await read('src/pages/SettingsWorkspace.jsx');

  assert.match(workspace, /lazy\(\(\) => import\('@\/components\/settings\/FinanceSettings'\)\)/);
  assert.match(workspace, /id: 'finance'[\s\S]*access: 'finance'/);
  assert.match(workspace, /hasModuleAccess\('dashboard'\) \|\| hasCapability\('financial_report_settings_manage'\)/);
  assert.match(workspace, /<Suspense[\s\S]*<FinanceSettings methodologyAction=\{methodologyAction\}/);
});
