import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { hostname: 'localhost' },
};
window.self = window;
window.top = window;
globalThis.document = {};

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
after(() => vite.close());

const { variableChargeUiInternals: ui } = await vite.ssrLoadModule('/src/components/payments/VariableCharges.jsx');

test('non-Hong Kong edits initialize from stored USD and ignore historical native evidence', () => {
  const item = {
    productName: 'PORT CLEARANCE FEE',
    hongKongVariableCharges: false,
    fixedCost: 1_000,
    quantity: 4,
    supplierCurrency: {
      inputCurrency: 'HKD',
      inputAmount: 7_840,
      requiredInputCurrency: 'HKD',
      usdHkdRate: 7.84,
    },
  };

  const draft = ui.initialExtraDraft(item);

  assert.equal(draft.inputCurrency, 'USD');
  assert.equal(draft.requiredInputCurrency, '');
  assert.equal(draft.supplierCost, 1_000);
  assert.equal(draft.pricingType, 'fixed');
  assert.equal(draft.quantity, 4);
  assert.equal(ui.isHongKongPortClearanceItem(item), false);
  assert.equal(ui.itemLabel({ item }), 'PORT CLEARANCE FEE');
  assert.equal(ui.variableChargeUiQuantityLabel(item, 4, 'EA'), '4 EA');
});

test('non-Hong Kong agent additions stay editable in USD when agreed currency is blank or HKD', () => {
  for (const agencyFeeCurrency of ['', 'HKD']) {
    const draft = ui.initialAddDraft({
      hongKongVariableCharges: false,
      supplierAccounts: [{ id: 'agent-1', isAgent: true, agencyFeeCurrency }],
    }, 'agent-1', 7.84);

    assert.equal(draft.inputCurrency, 'USD');
    assert.equal(draft.requiredInputCurrency, '');
    assert.equal(ui.supplierChargeUiModel(draft).showCurrencySelector, false);
    assert.equal(ui.supplierChargeUiModel(draft).showHkdPreview, false);
  }
});

test('non-Hong Kong supplier preview renders USD only', () => {
  const item = {
    productName: 'LIGHT DUES',
    hongKongVariableCharges: false,
    fixedCost: 125,
    supplierCurrency: {
      usdHkdRate: 7.84,
      unitOrFixed: { usdAmount: 125, hkdAmount: 980, basis: 'recorded_native' },
    },
  };
  const markup = renderToStaticMarkup(React.createElement(ui.SupplierDualAmount, {
    label: 'Supplier Fixed Cost',
    row: { item },
    draft: ui.initialExtraDraft(item),
    companyRate: 7.84,
  }));

  assert.match(markup, /USD 125\.00/);
  assert.doesNotMatch(markup, /HKD/);

  const editor = renderToStaticMarkup(React.createElement(ui.PairedExtraCostFields, {
    row: { sourceId: 'cost-1', item },
    draft: ui.initialExtraDraft(item),
    disabled: false,
    onChange: () => {},
  }));
  assert.match(editor, /Supplier Fixed Cost.*USD/);
  assert.doesNotMatch(editor, /Input Currency|Agent Agreed Currency|HKD/);
});

test('Hong Kong agent currency and statutory Port Clearance behavior remain intact', () => {
  const item = {
    productName: 'PORT CLEARANCE FEE',
    hongKongVariableCharges: true,
    fixedCost: 1_000,
    supplierCurrency: {
      inputCurrency: 'HKD',
      inputAmount: 7_840,
      requiredInputCurrency: 'HKD',
      usdHkdRate: 7.84,
      unitOrFixed: { usdAmount: 1_000, hkdAmount: 7_840, basis: 'recorded_native' },
    },
  };
  const draft = ui.initialExtraDraft(item);
  const added = ui.initialAddDraft({
    hongKongVariableCharges: true,
    supplierAccounts: [{ id: 'agent-1', isAgent: true, agencyFeeCurrency: 'HKD' }],
  }, 'agent-1', 7.84);
  const markup = renderToStaticMarkup(React.createElement(ui.SupplierDualAmount, {
    label: 'Supplier Fixed Cost', row: { item }, draft, companyRate: 7.84,
  }));

  assert.equal(draft.inputCurrency, 'HKD');
  assert.equal(draft.requiredInputCurrency, 'HKD');
  assert.equal(draft.supplierCost, 7_840);
  assert.equal(added.inputCurrency, 'HKD');
  assert.equal(added.requiredInputCurrency, 'HKD');
  assert.equal(ui.isHongKongPortClearanceItem(item), true);
  assert.equal(ui.itemLabel({ item }), 'Port Clearance Fee / Extension');
  assert.equal(ui.variableChargeUiQuantityLabel(item, 4, 'EA'), '4 applications');
  assert.equal(ui.supplierChargeUiModel(item).showCurrencySelector, true);
  assert.match(markup, /USD 1,000\.00/);
  assert.match(markup, /HKD 7,840\.00/);

  const editor = renderToStaticMarkup(React.createElement(ui.PairedExtraCostFields, {
    row: { sourceId: 'cost-1', item }, draft, disabled: false, onChange: () => {},
  }));
  assert.match(editor, /Agent Agreed Currency/);
  assert.match(editor, /HKD/);
});
