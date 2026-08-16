import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [component, api] = await Promise.all([
  readFile(new URL('../src/components/dashboard/DashboardStemTable.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
]);

test('summary table renders supplier and product children as aligned physical rows', () => {
  assert.match(component, /Product \/ extra cost · quantity/);
  assert.match(component, /rows\.flatMap\(\(row, index\)/);
  assert.match(component, /rowSpan=\{physicalRows\.length\}/);
  assert.match(component, /data-stem-group=\{stemKey\}/);
  assert.match(component, /data-source-type=\{item\?\.sourceType/);
  assert.match(component, /SupplierProductSupplier item=\{item\}/);
  assert.match(component, /SupplierProductItem item=\{item\}/);
});

test('mobile summary uses the same aligned supplier/product child contract', () => {
  assert.match(component, /const childRows = supplierProductRows\(row\)/);
  assert.match(component, /childRows\.map\(\(item, childIndex\)/);
  assert.match(component, /No product or extra-cost rows/);
  assert.match(component, /onAccountClick\(\{ accountId: account\.id, name: label, role: 'supplier' \}\)/);
});

test('P&L table remains on its existing aggregate projection', () => {
  assert.match(component, /const pnlRows = useMemo\(\(\) => rows\.map\(pnlRow\)/);
  assert.match(component, /if \(view === 'pnl'\) return <TableShell title="Filtered STEMs P&L"/);
  assert.match(component, /<PnlTable records=\{pnlRows\}/);
});

test('STEM API loads charge names, builds paired rows, and uses the versioned cache', () => {
  assert.match(api, /extraProductLookup/);
  assert.match(api, /dashboardSupplierProductRows\(\{/);
  assert.match(api, /supplierProductRows,/);
  assert.match(api, /namespace: handler === 'stems' \? 'decision-dashboard-v2-stems'/);
});
