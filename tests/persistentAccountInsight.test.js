import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Account Insight is a URL-backed Dashboard overlay that preserves directory state on close', async () => {
  const [dashboard, directory, legacyRoute] = await Promise.all([
    source('src/pages/DashboardSettings.jsx'),
    source('src/components/dashboard/AccountCreditDirectory.jsx'),
    source('src/pages/AccountInsight.jsx'),
  ]);
  assert.match(dashboard, /insightAccountId/);
  assert.match(dashboard, /<AccountInsightModal/);
  assert.match(dashboard, /dashboardInsightOverlay/);
  assert.match(dashboard, /navigate\(-1\)/);
  assert.match(dashboard, /requestAnimationFrame/);
  assert.match(dashboard, /scrollTo\(\{ top: scrollTop/);
  assert.match(dashboard, /trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(dashboard, /navigate\(`\/accounts\//);
  assert.match(directory, /event\.currentTarget/);
  assert.equal((directory.match(/dashboardAccountCreditDirectory/g) || []).length, 1);
  assert.equal((directory.match(/dashboardAccountExposureBatch/g) || []).length, 1);
  assert.match(legacyRoute, /<Navigate replace/);
  assert.match(legacyRoute, /insightAccountId/);
});

test('every credit forecast owns one consistent directional control and removed labels stay removed', async () => {
  const [toggle, modal, directory, buyer, supplier, combined] = await Promise.all([
    source('src/components/dashboard/CreditStatementSideToggle.jsx'),
    source('src/components/dashboard/AccountInsightModal.jsx'),
    source('src/components/dashboard/AccountCreditDirectory.jsx'),
    source('src/components/dashboard/AccountCreditStatement.jsx'),
    source('src/components/dashboard/SupplierCreditStatement.jsx'),
    source('src/components/dashboard/CombinedAccountStatement.jsx'),
  ]);
  for (const label of ['both', 'buyer', 'supplier']) assert.match(toggle, new RegExp(`value: '${label}'`));
  assert.match(toggle, /disabled=\{!enabled\}/);
  for (const statement of [buyer, supplier, combined]) {
    assert.match(statement, /CreditStatementSideToggle/);
    assert.match(statement, /availableStatementSides/);
    assert.match(statement, /onStatementSideChange/);
  }
  assert.doesNotMatch(directory, /Netting may conceal gross receivable and payable risk/);
  assert.doesNotMatch(modal, /Buyer receivable and supplier payable are reported separately by currency/);
  assert.equal((combined.match(/Netting may conceal gross receivable and payable risk/g) || []).length, 1);
  assert.doesNotMatch(modal, /aria-label="Credit statement view"/);
});
