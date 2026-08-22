import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('operational and financial workspaces share the native queue surface without handler changes', async () => {
  const files = await Promise.all([
    'src/pages/PaymentCollections.jsx',
    'src/pages/CashflowForecast.jsx',
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/pages/BrokerWorkspace.jsx',
  ].map(read));
  files.forEach((source) => assert.match(source, /workspace-operations/));
  assert.match(files[0], /buyerInvoicePostingReminderOverrideSave/);
  assert.match(files[1], /cashflowForecast/);
  assert.match(files[2], /dispute/);
  assert.match(files[3], /unofficialCompensation/);
  assert.match(files[4], /BrokerRegister/);
});

test('shared controls use system-shaped materials while financial content remains opaque', async () => {
  const [button, tabs, card, table, sheet, shell] = await Promise.all([
    read('src/components/ui/button.jsx'),
    read('src/components/ui/tabs.jsx'),
    read('src/components/ui/card.jsx'),
    read('src/components/ui/table.jsx'),
    read('src/components/ui/sheet.jsx'),
    read('src/components/common/TableShell.jsx'),
  ]);
  assert.match(button, /radius-control/);
  assert.match(button, /active:scale/);
  assert.match(tabs, /app-navigation-material/);
  assert.doesNotMatch(card, /glass-surface/);
  assert.match(card, /material-panel/);
  assert.match(table, /material-table/);
  assert.match(sheet, /glass-floating/);
  assert.match(shell, /material-panel/);
  const viewBar = await read('src/components/common/WorkspaceViewBar.jsx');
  assert.match(viewBar, /overflow-x-auto/);
  assert.match(viewBar, /min-w-max/);
});
