import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';

let deskData;
let appSettings;
const noop = () => {};
const loadedView = () => React.createElement('div', { 'data-loaded-book': true }, 'No position exposure · No audit activity · Cash USD 0.00');
const modules = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-router-dom': { useNavigate: () => noop, useSearchParams: () => [new URLSearchParams(), noop] },
  'lucide-react': Object.fromEntries(['Bot', 'Building2', 'ChartNoAxesCombined', 'FileSpreadsheet', 'Gauge', 'Handshake', 'RefreshCw', 'Settings2'].map((name) => [name, () => null])),
  '@/hedge/data/ActionsContext': { ActionsProvider: ({ children }) => children },
  '@/hedge/hooks/useDeskData': { useDeskData: () => deskData },
  '@/hedge/hooks/useAppSettings': { useAppSettings: () => appSettings },
  '@/hedge/views/OverviewView': { OverviewView: loadedView },
  '@/hedge/views/PhysicalView': { PhysicalView: loadedView },
  '@/hedge/views/HedgesView': { HedgesView: loadedView },
  '@/hedge/views/SettlementView': { SettlementView: loadedView },
  '@/hedge/views/CounterpartiesView': { CounterpartiesView: loadedView },
  '@/hedge/components/AssistantPanel': { AssistantPanel: () => React.createElement('div', null, 'Loaded-book assistant') },
  '@/hedge/components/HedgeSettingsPanel': { default: loadedView },
  '@/lib/AuthContext': { useAuth: () => ({ hasCapability: () => true }) },
  '@/hedge/components/ui': {
    Button: ({ children, disabled }) => React.createElement('button', { disabled }, children),
    EmptyState: ({ title, description }) => React.createElement('section', null, React.createElement('h2', null, title), description),
    InlineError: ({ error, action }) => React.createElement('div', { role: 'alert' }, error.message, action),
    StatusBadge: ({ children }) => React.createElement('span', null, children),
  },
};
globalThis.__hedgePageModules = modules;
test.after(() => { delete globalThis.__hedgePageModules; });

const source = await readFile(new URL('../src/pages/HedgeDesk.jsx', import.meta.url), 'utf8');
const isolated = source
  .replace(/^import \{([^}]+)\} from '([^']+)';$/gm, (_line, names, path) => `const {${names}} = globalThis.__hedgePageModules[${JSON.stringify(path)}];`)
  .replace(/^import (\w+) from '([^']+)';$/gm, (_line, name, path) => `const ${name} = globalThis.__hedgePageModules[${JSON.stringify(path)}].default;`)
  .replace(/^import '[^']+\.css';$/gm, '');
const compiled = await transform(isolated, { loader: 'jsx', jsx: 'automatic', format: 'esm' });
const code = compiled.code.replace(/import \{([^}]+)\} from "react\/jsx-runtime";/, (_line, names) => `const {${names.replace(/\bas\b/g, ':')}} = globalThis.__hedgePageModules['react/jsx-runtime'];`);
const { default: HedgeDesk } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function render(data = {}, settings = {}) {
  deskData = { physicals: [], swaps: [], capabilities: {}, loading: false, refreshing: false, error: null, lastUpdated: null, reload: async () => {}, ...data };
  appSettings = { loading: false, error: null, reload: async () => {}, ...settings };
  return renderToStaticMarkup(React.createElement(HedgeDesk));
}

test('initial Hedge Desk failure shows the actual error without invented empty positions, audit or zero cash', () => {
  const markup = render({ error: new Error('This verification environment permits read-only operations.') });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /This verification environment permits read-only operations/);
  assert.match(markup, /Hedge Desk unavailable/);
  assert.doesNotMatch(markup, /No position exposure|No audit activity|Cash USD 0\.00|data-loaded-book|Loaded-book assistant/);
});

test('successful empty snapshots may show true empty states and cached refresh failures remain explicitly stale', () => {
  const lastUpdated = new Date('2026-10-01T04:00:00Z');
  const empty = render({ lastUpdated });
  assert.match(empty, /No position exposure/);
  assert.doesNotMatch(empty, /last successfully loaded book/);
  const stale = render({ lastUpdated, error: new Error('Refresh read failed') });
  assert.match(stale, /Refresh read failed/);
  assert.match(stale, /last successfully loaded book/);
  assert.match(stale, /Refresh did not complete/);
  assert.match(stale, /data-loaded-book/);
});

test('failed or loading settings never feed default values into a loaded book', () => {
  const data = { lastUpdated: new Date('2026-10-01T04:00:00Z') };
  const failed = render(data, { error: new Error('Shared settings read failed') });
  assert.match(failed, /Shared settings read failed/);
  assert.match(failed, /Hedge Desk unavailable/);
  assert.doesNotMatch(failed, /data-loaded-book|Cash USD 0\.00/);
  const loading = render(data, { loading: true });
  assert.match(loading, /Loading Hedge Desk settings/);
  assert.doesNotMatch(loading, /data-loaded-book|Cash USD 0\.00/);
});

test('a read-only deployment shows view-only book controls and excludes editable administration', () => {
  const markup = render({ lastUpdated: new Date('2026-10-01T04:00:00Z'), deploymentReadOnly: true });
  assert.match(markup, /View only/);
  assert.doesNotMatch(markup, /Administration|Live book/);
});
