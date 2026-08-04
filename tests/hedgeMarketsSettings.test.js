import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dashboard Search and Trading Assistant models share the AI Models settings tab', () => {
  const settings = read('src/pages/Settings.jsx');
  const hedgeSettings = read('src/hedge/components/HedgeSettingsPanel.jsx');
  assert.match(settings, /id: 'ai', label: 'AI Models'/);
  assert.match(settings, /Dashboard AI Search/);
  assert.match(settings, /<HedgeAssistantAiSettings \/>/);
  assert.match(read('src/hedge/components/HedgeAssistantAiSettings.jsx'), /Estimated USD/);
  assert.doesNotMatch(hedgeSettings, /title="Trading Assistant"/);
});

test('settlement communication uses rich text and draggable template variables', () => {
  const source = read('src/hedge/components/HedgeSettingsPanel.jsx');
  assert.match(source, /ReactQuill/);
  assert.match(source, /draggable=\{isAdministrator\}/);
  assert.match(source, /application\/x-template-variable/);
  for (const variable of ['invoiceNumber', 'invoiceType', 'settlementMonth', 'counterparty', 'attn', 'netAmount', 'direction', 'issueDate', 'dueDate']) {
    assert.match(source, new RegExp(`\\{${variable}\\}`));
  }
  assert.doesNotMatch(source, /<Textarea[^>]+hedge-email-body/);
});

test('Markets is a default-access Trading page with a market-only server boundary', () => {
  const layout = read('src/components/Layout.jsx');
  const workspaces = read('src/lib/workspaceStandards.js');
  const app = read('src/App.jsx');
  const handler = read('api/functions/[name].js');
  const service = read('api/_hedgeDeskService.js');
  const migration = read('supabase/migrations/20260802090000_markets_default_access.sql');

  assert.match(layout, /workspaceNavigation\('buyers_administrator'[\s\S]*workspaceNavigation\('markets'[\s\S]*workspaceNavigation\('hedge_desk'/);
  assert.match(workspaces, /buyers_administrator:[\s\S]*title: 'Account Managers'[\s\S]*markets:[\s\S]*title: 'Markets'[\s\S]*hedge_desk:/);
  assert.match(app, /path="\/markets"[\s\S]*moduleId="markets"/);
  assert.match(handler, /hedgeMarkets: \['markets'\]/);
  assert.equal((handler.match(/markets: true/g) || []).length, 5);
  assert.match(service, /Markets may access only market-price records/);
  assert.match(service, /\.in\('key', \['general', 'fwd_spreads'\]\)/);
  assert.doesNotMatch(service.match(/export async function handleHedgeMarkets[\s\S]*?\n\}/)?.[0] || '', /hedge_physical_trades|hedge_invoices|hedge_counterparties/);
  assert.match(migration, /select id, 'markets', true\s+from public\.user_types/);
});

test('Hedge styles cannot leak into the FCOS application shell', () => {
  const styles = read('src/hedge/styles.css');
  const unscopedSelector = styles.split('\n').find((line) => /^\.(?:app|hedge)-/.test(line.trim()) && !line.trim().startsWith('.hedge-desk-root'));
  assert.equal(unscopedSelector, undefined);
  assert.match(styles, /--app-bg: hsl\(var\(--background\)\)/);
  assert.match(styles, /--app-teal: hsl\(var\(--primary\)\)/);
});

test('counterparty management excludes obsolete banking instructions', () => {
  const view = read('src/hedge/views/CounterpartiesView.jsx');
  const service = read('api/_hedgeDeskService.js');
  const methodology = read('src/hedge/lib/methodology.js');
  assert.doesNotMatch(view, /bank_name|bank_swift|account_number|Bank instructions|<th>Banking<\/th>/);
  assert.doesNotMatch(service.match(/Counterparty: \{[\s\S]*?\n  \},/)?.[0] || '', /bank_name|bank_swift|account_number|intermediary/);
  assert.match(methodology, /Counterparty banking instructions are not maintained or printed/);
});
