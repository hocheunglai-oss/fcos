import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/market-pulse/MarketPulse.jsx', import.meta.url), 'utf8');

test('Market Pulse uses the shared compact price board without changing lazy loading or the draggable icon trigger', () => {
  assert.match(source, /import \{ MarketPriceBoard \} from '@\/components\/markets\/MarketPriceBoard'/);
  assert.match(source, /<MarketPriceBoard pulse=\{data\} compact \/>/);
  assert.match(source, /if \(open && !data && !loading && !error\) load\(\)/);
  assert.match(source, /app-market-pulse-trigger h-9 w-9 shrink-0 p-0/);
  assert.match(source, /w-\[min\(1100px,calc\(100vw-24px\)\)\]/);
  assert.match(source, /drag to reposition/);
});

test('Market Pulse keeps provisional and data-note disclosures collapsible with readable supporting text', () => {
  assert.match(source, /<details className="rounded-lg border border-amber-200/);
  assert.match(source, /Intraday paper · Provisional/);
  assert.match(source, /Data notes \(\{data\.warnings\.length\}\)/);
  assert.doesNotMatch(source, /text-\[(?:8|9|10|11)px\]/);
  assert.match(source, /String\(unit\)\.toUpperCase\(\) === 'USD\/BBL' \? 3 : 2/);
});
