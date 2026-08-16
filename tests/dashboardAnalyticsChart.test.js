import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(new URL('../src/components/dashboard/DashboardAnalytics.jsx', import.meta.url), 'utf8');

test('gross-profit legend inherits the same blue series color as positive bars', () => {
  assert.match(component, /name=\{`\$\{currency\} gross profit`\} fill=\{COLORS\[index % COLORS\.length\]\}/);
  assert.match(component, /COLORS = \['#2563eb'/);
});

test('chart labels state monthly margin and same-calendar-month YoY semantics', () => {
  assert.match(component, /name=\{`\$\{currency\} monthly gross margin`\}/);
  assert.match(component, /name=\{`\$\{currency\} YoY vs same month`\}/);
  assert.match(component, /that month’s gross profit divided by that month’s turnover/);
});
