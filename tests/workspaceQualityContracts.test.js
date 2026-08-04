import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as methodologies from '../src/lib/pageMethodologies.js';
import { WORKSPACE_STANDARDS } from '../src/lib/workspaceStandards.js';

function file(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function methodologyLeaves(value, prefix = '') {
  if (value?.sections) return [{ key: prefix, value }];
  return Object.entries(value || {}).flatMap(([key, nested]) => methodologyLeaves(nested, prefix ? `${prefix}.${key}` : key));
}

test('every methodology is operational guidance rather than a control description', () => {
  const entries = Object.entries(methodologies).flatMap(([key, value]) => methodologyLeaves(value, key));
  assert.ok(entries.length >= 20);
  for (const { key, value } of entries) {
    assert.ok(String(value.title || '').trim().length >= 3, `${key} needs a title`);
    assert.ok(String(value.description || '').trim().length >= 20, `${key} needs a useful description`);
    assert.ok(value.sections.length >= 2, `${key} needs at least two methodology sections`);
    for (const section of value.sections) {
      assert.ok(String(section.title || '').trim().length >= 3, `${key} has an unnamed section`);
      assert.ok(String(section.body || '').trim().length >= 40, `${key}.${section.title} needs an operational rule`);
    }
  }
});

test('high-risk Salesforce workspaces display shared freshness state and force-refresh data', async () => {
  const paths = [
    'src/pages/DashboardSettings.jsx',
    'src/pages/AccountManagers.jsx',
    'src/pages/BuyerInvoices.jsx',
    'src/pages/IncomingPayments.jsx',
    'src/pages/PaymentCollections.jsx',
    'src/pages/CashflowForecast.jsx',
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/pages/SpecialTerms.jsx',
    'src/pages/ReviewQueue.jsx',
    'src/pages/StemPnlReport.jsx',
  ];
  for (const path of paths) {
    const source = await file(path);
    assert.match(source, /DataStatus/, `${path} should display shared data status`);
    assert.match(source, /force/, `${path} should expose an authoritative refresh path`);
  }

  const status = await file('src/components/common/DataStatus.jsx');
  for (const label of ['Live', 'Cached', 'Pending Salesforce posting', 'Refreshing', 'Unavailable', 'Not checked']) {
    assert.match(status, new RegExp(label), `DataStatus should support ${label}`);
  }
  assert.match(status, /salesforceCalls/);
  assert.match(status, /diagnostic reference/);
});

test('workspace standards define source authority, views, and action freshness', async () => {
  assert.ok(Object.keys(WORKSPACE_STANDARDS).length >= 16);
  for (const [id, standard] of Object.entries(WORKSPACE_STANDARDS)) {
    assert.ok(standard.title.length >= 3, `${id} needs a title`);
    assert.match(standard.route, /^\//, `${id} needs an application route`);
    assert.ok(standard.section, `${id} needs a navigation section`);
    assert.ok(standard.authority.length >= 4, `${id} needs a source authority`);
    assert.ok(standard.views.length >= 1, `${id} needs at least one operational view`);
    assert.ok(standard.freshness.length >= 8, `${id} needs a freshness rule`);
    assert.equal(typeof standard.consequentialActionsRefresh, 'boolean');
  }

  const [layout, viewBar, header] = await Promise.all([
    file('src/components/Layout.jsx'),
    file('src/components/common/WorkspaceViewBar.jsx'),
    file('src/components/common/PageHeader.jsx'),
  ]);
  assert.match(layout, /workspaceNavigation/);
  assert.match(viewBar, /role="tablist"/);
  assert.match(viewBar, /aria-selected/);
  assert.match(header, /rounded-lg/);
  assert.doesNotMatch(header, /rounded-2xl/);
});

test('high-risk edit workflows use a shared validation summary', async () => {
  const paths = [
    'src/pages/BuyerInvoices.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/pages/SpecialTerms.jsx',
  ];
  for (const path of paths) {
    const source = await file(path);
    assert.match(source, /WorkflowValidationSummary/, `${path} should summarize all pre-save issues`);
    assert.match(source, /ValidationIssues|validationIssues/, `${path} should derive validation before writing`);
  }
});

test('strict release gate includes migrations, Graph-only checks, build, and browser smoke tests', async () => {
  const [packageJson, releaseGate, browserSmoke] = await Promise.all([
    file('package.json'),
    file('scripts/verify-release.mjs'),
    file('e2e/workspace-smoke.spec.js'),
  ]);
  assert.match(packageJson, /verify:release/);
  for (const requirement of ['Unit and integration tests', 'Lint', 'Type checking', 'Migration integrity', 'Graph-only production source', 'Production build', 'Read-only browser smoke tests']) {
    assert.match(releaseGate, new RegExp(requirement));
  }
  assert.match(browserSmoke, /authenticated read-only workspace matrix/);
  assert.match(browserSmoke, /Something went wrong/);
});

test('STEM detail remains a shared control in the STEM column workspaces', async () => {
  const paths = [
    'src/pages/BuyerInvoices.jsx',
    'src/pages/IncomingPayments.jsx',
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/CashflowForecast.jsx',
    'src/pages/ReviewQueue.jsx',
    'src/pages/StemPnlReport.jsx',
    'src/components/dashboard/PnlTable.jsx',
    'src/components/brokers/BrokerRegisterTable.jsx',
  ];
  for (const path of paths) {
    const source = await file(path);
    assert.match(source, /StemDetailLink/, `${path} should use the shared STEM detail link`);
  }
  const sharedLink = await file('src/components/common/StemDetailLink.jsx');
  assert.match(sharedLink, /type="button"/);
  assert.doesNotMatch(sharedLink, /target="_blank"/);
});

test('unexpected API failures refresh the universal notification centre', async () => {
  const appClient = await file('src/api/appClient.js');
  assert.match(appClient, /res\.status >= 500/);
  assert.match(appClient, /fcos:work-notifications-changed/);
  assert.match(appClient, /requestId/);
  assert.match(appClient, /cacheStatus/);
  assert.match(appClient, /salesforceCalls/);
});
