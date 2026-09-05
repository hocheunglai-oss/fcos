import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Account Insight keeps the mounted overlay and exposes the four consolidated sections', async () => {
  const modal = await source('src/components/dashboard/AccountInsightModal.jsx');
  assert.match(modal, /<Dialog open=\{open\}/);
  for (const label of ['Overview', 'Trading', 'Credit &amp; Payments', 'STEMs']) assert.match(modal, new RegExp(`TabsTrigger value=.*${label}`));
  assert.match(modal, /Payment performance, risk, and GROUP details/);
  assert.match(modal, /setActiveTab\('payments'\)/);
  assert.match(modal, /setActiveTab\('risk'\)/);
});

test('Account Insight sends one direction and GROUP scope to the unified insight endpoint', async () => {
  const modal = await source('src/components/dashboard/AccountInsightModal.jsx');
  assert.match(modal, /side: role/);
  assert.match(modal, /includedGroupAccountIds/);
  assert.match(modal, /\['both', 'buyer', 'supplier'\]/);
  assert.match(modal, /disabled=\{!available\}/);
  assert.match(modal, /GroupAccountScopeSelector/);
  assert.match(modal, /currentExposure/);
  assert.match(modal, /selectAccountInsightPresentation/);
  assert.match(modal, /BothLegSummary/);
  assert.doesNotMatch(modal, /receivable\) \/ number\(identity\.creditLimit\)/);
  assert.match(modal, /requestAbort\.current\?\.abort\(\)/);
  assert.match(modal, /signal: controller\.signal/);
  assert.match(modal, /appendAccountInsightStemPage/);
  assert.match(modal, /retainedScopeStale/);
});

test('GROUP scope selector is searchable and statement variants can suppress duplicate controls', async () => {
  const [selector, buyer, supplier, combined] = await Promise.all([
    source('src/components/dashboard/GroupAccountScopeSelector.jsx'),
    source('src/components/dashboard/AccountCreditStatement.jsx'),
    source('src/components/dashboard/SupplierCreditStatement.jsx'),
    source('src/components/dashboard/CombinedAccountStatement.jsx'),
  ]);
  assert.match(selector, /Search GROUP Accounts/);
  assert.match(selector, /selection applies to Account Insight, Credit & Payments, STEMs, and every report/);
  for (const statement of [buyer, supplier, combined]) assert.match(statement, /hideGroupScopeSelector/);
});

test('report builder uses server options, report presets, and one preview/download PDF blob', async () => {
  const [modal, builder] = await Promise.all([
    source('src/components/dashboard/AccountInsightModal.jsx'),
    source('src/components/dashboard/AccountInsightReportBuilder.jsx'),
  ]);
  for (const handler of ['dashboardAccountInsightReportOptions', 'dashboardAccountInsightReportPresetsList', 'dashboardAccountInsightReportPresetsSave', 'dashboardAccountInsightReportPresetsArchive']) assert.match(builder, new RegExp(handler));
  assert.match(builder, /onBuild\(config\)/);
  assert.match(builder, /sharedScope/);
  assert.match(builder, /detailRowCount/);
  assert.match(builder, /presetConfiguration\(config\)/);
  assert.match(builder, /savedPreset = response\.data\?\.preset/);
  assert.match(builder, /scope: preset\.scope/);
  assert.match(builder, /allowedChoices/);
  assert.match(builder, /ReorderList/);
  assert.match(builder, /expectedRevision: existingPreset\.revision/);
  assert.match(builder, /setName\(savedPreset\.name \|\| name\.trim\(\)\)/);
  assert.match(builder, /savePreset\('company', editingPreset\?\.scope === 'company' \? editingPreset : null\)/);
  assert.doesNotMatch(builder, /configuration: config/);
  assert.match(modal, /reportConfig/);
  assert.match(modal, /<iframe src=\{reportPreview.url\}/);
  assert.match(modal, /anchor\.href = reportPreview\.url/);
  assert.doesNotMatch(modal, /download\('pdf'\)/);
});

test('forecast selection updates the shared modal report scope without remounting credit panels', async () => {
  const [modal, buyer, supplier, combined] = await Promise.all([
    source('src/components/dashboard/AccountInsightModal.jsx'),
    source('src/components/dashboard/AccountCreditStatement.jsx'),
    source('src/components/dashboard/SupplierCreditStatement.jsx'),
    source('src/components/dashboard/CombinedAccountStatement.jsx'),
  ]);
  assert.match(modal, /AccountInsightForecastContext\.Provider value=\{setForecastConservativeness\}/);
  assert.match(modal, /forecastConservativeness/);
  assert.match(modal, /statementScope/);
  assert.match(modal, /AccountInsightStatementScopeContext\.Provider value=\{setStatementScope\}/);
  assert.match(buyer, /notifyForecastChange\?\.\(value\)/);
  assert.match(buyer, /sharedStatementScopeChange\?\.\(scope\)/);
  assert.match(supplier, /sharedStatementScopeChange\?\.\(scope\)/);
  assert.match(combined, /sharedForecastChange/);
});

test('monthly trading chart keeps distinct terracotta GP, sage MT, and plum margin axes', async () => {
  const modal = await source('src/components/dashboard/AccountInsightModal.jsx');
  for (const value of ['#a94f2d', '#4f6b4f', '#7a4b5c', 'yAxisId="profit"', 'yAxisId="volume"', 'yAxisId="margin"']) assert.match(modal, new RegExp(value));
});

test('GROUP entity metadata keeps children disclosures reachable and supplier revenue is labelled accurately in Both', async () => {
  const modal = await source('src/components/dashboard/AccountInsightModal.jsx');
  assert.match(modal, /account\?\.entityType === 'group' \|\| sourceData\?\.entityType === 'group'/);
  assert.match(modal, /const data = sourceData/);
  assert.match(modal, /label === 'Supplier' \? 'allocated revenue' : 'turnover'/);
  assert.match(modal, /\{isGroupEntity \? <TabsContent value="children"/);
  assert.match(modal, /GROUP child contribution/);
});

test('Both keeps leg summaries distinct and labels all lower detail views with their selected leg', async () => {
  const modal = await source('src/components/dashboard/AccountInsightModal.jsx');
  for (const label of ['STEMs', 'Volume', 'Gross Margin', 'Selected-leg detail', 'detailRoleLabel', 'STEM evidence']) assert.match(modal, new RegExp(label));
  assert.match(modal, /changeInsightDirection/);
  assert.match(modal, /onStatementSideChange=\{changeInsightDirection\}/);
  assert.match(modal, /Search loaded STEMs/);
  assert.match(modal, /Loaded evidence only/);
});

test('GROUP selection stays compact until opened and exposes duplicate account CL Keys', async () => {
  const selector = await source('src/components/dashboard/GroupAccountScopeSelector.jsx');
  assert.match(selector, /Choose Accounts · \{selected\.size\} of \{available\.length\} selected/);
  assert.match(selector, /duplicateName && account\.clKey/);
});

test('report builder is a topmost Radix dialog, restores focus, and displays the exact shared scope', async () => {
  const builder = await source('src/components/dashboard/AccountInsightReportBuilder.jsx');
  assert.match(builder, /<Dialog open=\{open\} onOpenChange/);
  assert.match(builder, /<DialogContent className="account-insight-report-builder[^\n]+z-\[70\]/);
  assert.match(builder, /onCloseAutoFocus=\{\(event\) => \{ if \(returnFocusRef\?\.current\)/);
  assert.match(builder, /returnFocusRef\.current\.focus\(\)/);
  assert.match(builder, /aria-label="Report scope"/);
  for (const label of ['Account', 'GROUP selection', 'Trading period', 'Current statement as of']) assert.match(builder, new RegExp(label));
  assert.doesNotMatch(builder, /window\.addEventListener\('keydown'/);
  assert.doesNotMatch(builder, /panelRef/);
});

test('Account Insight has one consolidated freshness signal and does not truncate modal titles', async () => {
  const modal = await source('src/components/dashboard/AccountInsightModal.jsx');
  assert.match(modal, /<DataStatus meta=\{meta\} label="Salesforce" \/>/);
  assert.doesNotMatch(modal, /SalesforceSyncBadge/);
  assert.match(modal, /DialogTitle className="max-w-full whitespace-normal break-words text-xl leading-tight"/);
  assert.match(modal, /ref=\{reportTriggerRef\}/);
  assert.match(modal, /scopeDisplay=\{reportScopeDisplay\}/);
  assert.match(modal, /returnFocusRef=\{reportTriggerRef\}/);
  assert.match(modal, /reportScopeDisplay/);
  assert.match(modal, /DialogContent className="z-\[70\] grid h-\[92vh\]/);
  assert.match(modal, /onCloseAutoFocus=\{\(event\) => \{ if \(reportTriggerRef\.current\)/);
  assert.match(modal, /<details className="rounded-\[var\(--radius-panel\)\][^>]+>\s*<summary[^>]*>Relationship/);
  assert.match(modal, /<summary[^>]*>Operational risk/);
  assert.doesNotMatch(modal, /Credit \/ insurance limit/);
});

test('report builder keeps optional ordering and detail-column controls behind labelled disclosures', async () => {
  const builder = await source('src/components/dashboard/AccountInsightReportBuilder.jsx');
  assert.match(builder, /<summary[^>]*>Section order<\/summary>/);
  assert.match(builder, /<summary[^>]*>Detail columns<\/summary>/);
  assert.match(builder, /<ToggleList label="Detail columns"/);
  assert.match(builder, /<ReorderList label="Column order"/);
});
