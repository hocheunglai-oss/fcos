import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('paper hedges require a legal settlement counterparty independently of broker', () => {
  const view = read('src/hedge/views/HedgesView.jsx');
  const service = read('api/_hedgeDeskService.js');

  assert.match(view, /internalAllocation \? "Internal allocation" : "Legal settlement counterparty"/);
  assert.match(view, /A broker is not the counterparty/);
  assert.match(view, /data\.counterparties/);
  assert.match(service, /HEDGE_COUNTERPARTY_REQUIRED/);
  assert.match(service, /sanitized\.counterparty = String\(sanitized\.counterparty/);
});

test('Counterparties exposes paper-hedge assignments and unassigned exceptions', () => {
  const view = read('src/hedge/views/CounterpartiesView.jsx');
  const page = read('src/pages/HedgeDesk.jsx');

  assert.match(view, /paperHedgeCount/);
  assert.match(view, /paper hedge\{unassignedCount === 1/);
  assert.match(view, /Review paper hedges/);
  assert.match(page, /onManageHedges=\{\(\) => changeTab\('hedges'\)\}/);
});
