import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlerUrl = new URL('../api/functions/[name].js', import.meta.url);

function functionSource(source, name, nextName = null) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? source.indexOf(`async function ${nextName}(`, start + 1) : -1;
  return source.slice(start, end > start ? end : start + 8_000);
}

test('Dashboard has no browser-accessible raw SOQL endpoint', async () => {
  const source = await readFile(handlerUrl, 'utf8');
  assert.doesNotMatch(source, /async function salesforceQuery\s*\(/);
  assert.doesNotMatch(source, /^\s*salesforceQuery:\s*\[/m);
  const filterOptions = functionSource(source, 'dashboardFilterOptions', 'salesforceDescribeChildren');
  assert.match(filterOptions, /optionType === 'ports'/);
  assert.match(filterOptions, /\['ports', 'companies'\]\.includes\(optionType\)/);
  assert.doesNotMatch(filterOptions, /body\.(?:soql|query)/);
  assert.doesNotMatch(source, /body\.where/);
  assert.doesNotMatch(await readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8'), /\bwhere\s*[,}]/);
  assert.doesNotMatch(await readFile(new URL('../src/pages/StemPnlReport.jsx', import.meta.url), 'utf8'), /\bwhere\s*[,}]/);
  assert.match(source, /buildDashboardDateScopeWhere\(dateWindows/);
});

test('Interoffice Salesforce metadata failures return no permissive condition', async () => {
  const source = await readFile(handlerUrl, 'utf8');
  const access = functionSource(source, 'interofficeStemAccessCondition', 'requireInterofficeStemAccess');
  assert.match(access, /INTEROFFICE_SCHEMA_UNAVAILABLE/);
  assert.match(access, /No Salesforce records were returned/);
  assert.match(access, /if \(!conditions\.length\) \{[\s\S]*?throw appError/);
  assert.match(access, /return combineWhereConditions\(conditions\)/);
});

test('internal financial report sends ignore browser recipients and message copy', async () => {
  const source = await readFile(handlerUrl, 'utf8');
  const incoming = functionSource(source, 'incomingPaymentEmailReport', 'incomingPaymentEmailSettingsGet');
  const outstanding = functionSource(source, 'outstandingBuyerInvoicesEmailReport', 'outstandingBuyerInvoicesEmailCron');
  for (const handler of [incoming, outstanding]) {
    assert.match(handler, /load(?:FinancialReportSettings|StoredBuyerInvoiceEmailSettings)/);
    assert.doesNotMatch(handler, /body\.(?:to|cc|bcc|recipients|subject|intro|html|text)/);
  }
});

test('unexpected server errors use a safe browser envelope and permanent admin bootstrap is absent', async () => {
  const source = await readFile(handlerUrl, 'utf8');
  const envelope = source.slice(source.indexOf('function publicApiErrorPayload'), source.indexOf('export default async function handler'));
  assert.match(envelope, /status < 500 \|\| error\?\.expose === true/);
  assert.match(envelope, /requestId/);
  assert.match(envelope, /FCOS could not complete this operation/);
  assert.match(envelope, /status === 409 && error\?\.details !== undefined/);
  assert.doesNotMatch(source, /adminBootstrap/);

  const timedHealth = source.slice(source.indexOf('function safeHealthFailure'), source.indexOf('async function fetchJsonWithTimeout'));
  assert.match(timedHealth, /Review the redacted server diagnostics/);
  assert.doesNotMatch(timedHealth, /error\.message/);

  const adminUserSave = functionSource(source, 'adminUserSave', 'adminUserDelete');
  assert.doesNotMatch(adminUserSave, /message:\s*error\.message/);

  const collaboration = await readFile(new URL('../api/_collaborationService.js', import.meta.url), 'utf8');
  const bulkUpdate = collaboration.slice(
    collaboration.indexOf('export async function collaborationBulkUpdate'),
    collaboration.indexOf('export async function collaborationCommentSave'),
  );
  assert.match(bulkUpdate, /status < 500/);
  assert.doesNotMatch(bulkUpdate, /message:\s*error\.message/);

  const portal = await readFile(new URL('../api/_portal.js', import.meta.url), 'utf8');
  assert.doesNotMatch(portal, /message:\s*error\.message/);
});

test('Account Insight uses the live exception detector and scoped auxiliary queries', async () => {
  const source = await readFile(new URL('../api/_dashboardAccountInsightService.js', import.meta.url), 'utf8');
  assert.match(source, /classifyExceptionReviewStem/);
  assert.match(source, /\.overlaps\('salesforce_account_ids', accountIds\)/);
  assert.match(source, /listUnofficialCompensation\(\{ force, interoffice, accountIds:/);
  assert.match(source, /listSpecialTerms\(\{[\s\S]*?scope:/);
  assert.doesNotMatch(source, /item\.reason \|\| item\.exception_reason \|\| item\.status/);
});
