import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizedHiddenColumnIds, orderedColumns } from '../src/lib/tablePreferences.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('column preferences retain valid order, append new columns, and keep one column visible', () => {
  const columns = [
    { id: 'account' },
    { id: 'amount' },
    { id: 'action', hideable: false },
  ];

  assert.deepEqual(orderedColumns(columns, ['amount', 'missing']), [columns[1], columns[0], columns[2]]);
  assert.deepEqual(normalizedHiddenColumnIds(columns, ['amount', 'missing']), ['amount']);
  assert.deepEqual(normalizedHiddenColumnIds(columns, ['account', 'amount', 'action']), ['account', 'amount']);
  assert.deepEqual(normalizedHiddenColumnIds(columns.slice(0, 2), ['account', 'amount']), ['amount']);
});

test('shared data tables provide keyboard scrolling, sticky headers, and user column controls', async () => {
  const [table, shell, reorderable] = await Promise.all([
    read('../src/components/ui/table.jsx'),
    read('../src/components/common/TableShell.jsx'),
    read('../src/components/common/ReorderableDataTable.jsx'),
  ]);

  assert.match(table, /role="region"/);
  assert.match(table, /tabIndex=\{0\}/);
  assert.match(table, /scrollLabel \|\| props\['aria-label'\]/);
  assert.match(table, /sticky top-0 z-10/);
  assert.match(table, /min-w-max/);
  assert.match(shell, /material-panel min-w-0/);
  assert.match(shell, /sm:w-auto sm:justify-end/);
  assert.match(reorderable, /fcos:column_visibility:v1/);
  assert.match(reorderable, /Visible columns/);
  assert.match(reorderable, /Reset columns/);
  assert.match(reorderable, /visibleColumns\.length === 1/);
});

test('workspace hardening preserves mobile width and splits stable vendor families', async () => {
  const [styles, vite, app] = await Promise.all([
    read('../src/index.css'),
    read('../vite.config.js'),
    read('../src/App.jsx'),
  ]);

  assert.match(styles, /@media \(max-width: 639px\)[\s\S]*app-workspace-sidebar[\s\S]*width: 60px !important/);
  assert.match(styles, /material-table[\s\S]*overscroll-behavior-inline: contain/);
  assert.match(styles, /scrollbar-gutter: stable/);
  for (const chunk of ['react-platform', 'data-platform', 'ui-primitives', 'workspace-icons', 'date-utils']) {
    assert.match(vite, new RegExp(`return '${chunk}'`));
  }
  assert.match(app, /role="status" aria-live="polite"/);
  assert.match(app, /Loading workspace/);
  assert.match(app, /Loading FCOS/);
});
