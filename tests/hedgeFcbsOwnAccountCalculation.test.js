import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCounterpartySettlementGroups,
  tradingDaysInMonth,
} from '../src/hedge/lib/domain.js';
import {
  buildFcbsOwnAccountSettlement,
  FCBS_FULL_NAME,
} from '../src/hedge/lib/fcbsOwnAccountSettlement.js';

// These are deliberately synthetic values. They exercise the settlement math
// without importing a commercial source file or a production trade record.
const MONTH = '2026-08';
const NOW = new Date('2026-09-01T12:00:00Z');
const RATES = {
  fcbs_venue_mt: 0.5,
  fcbs_venue_bbl: 0.067114,
  fcbs_cp_recv_mt: 0.5,
  fcbs_cp_recv_bbl: 0.03,
};
const FCBS_RECIPIENT = {
  short_name: 'FCBS',
  full_name: FCBS_FULL_NAME,
  settlement_mode: 'external',
};
const FCBHK_INTERNAL = {
  short_name: 'FCBHK',
  full_name: 'FRATELLI COSULICH BUNKERS (HK) LTD',
  settlement_mode: 'internal_no_invoice',
};

function actualMonth(month, s05 = 736.001) {
  return tradingDaysInMonth(month).map((price_date, index) => ({
    id: `${month}-${index}`,
    price_date,
    s380: 500,
    s05,
    sgo: 100,
    is_estimate: false,
    updated_date: `${price_date}T12:00:00Z`,
  }));
}

function verified(month, is_current = true) {
  return { contract_month: month, is_current };
}

function ownSwap(overrides = {}) {
  return {
    id: 'own-170',
    trade_date: '2026-08-04',
    trade_type: 'STANDARD',
    product: 'S0.5',
    direction: 'BUY',
    swap_month: MONTH,
    quantity: 170,
    unit: 'MT',
    price: 733,
    venue: 'FCBS',
    counterparty: 'FCBHK',
    ...overrides,
  };
}

function build({ swaps = [ownSwap()], mops = actualMonth(MONTH), monthlyVerifications = [verified(MONTH)], counterparties = [FCBS_RECIPIENT], invoices = [], month = MONTH, now = NOW } = {}) {
  return buildFcbsOwnAccountSettlement({
    swaps,
    mops,
    rates: RATES,
    month,
    monthlyVerifications,
    counterparties,
    invoices,
    now,
  });
}

test('FCBS own-account August 2026 BUY 170 MT uses final actual MOPS and only the venue fee', () => {
  const settlement = build();

  assert.equal(settlement.counterparty, 'FCBS');
  assert.deepEqual(settlement.counterpartyRecord, FCBS_RECIPIENT);
  assert.equal(settlement.rows.length, 1);
  assert.equal(settlement.rows[0].mtm, 510.17); // (736.001 - 733) * 170
  assert.equal(settlement.rows[0].attributedFeeAmount, 85);
  assert.equal(settlement.rows[0].fees.fcbsVenueFee, 85);
  assert.equal(settlement.rows[0].fees.cpHandlingFee, 0);
  assert.equal(settlement.rows[0].net, 425.17);
  assert.equal(settlement.mtm, 510.17);
  assert.equal(settlement.fees, 85);
  assert.equal(settlement.net, 425.17);
  assert.equal(settlement.documentReady, true);
});

test('FCBS own-account handles gains, losses, and a zero monthly net without producing a document', () => {
  const cases = [
    { name: 'gain', price: 733, expectedMtm: 510.17, expectedNet: 425.17, ready: true },
    { name: 'loss', price: 739, expectedMtm: -509.83, expectedNet: -594.83, ready: true },
    // (736.001 - 735.501) * 170 = 85.00, exactly offset by the venue fee.
    { name: 'zero', price: 735.501, expectedMtm: 85, expectedNet: 0, ready: false },
  ];

  for (const scenario of cases) {
    const settlement = build({ swaps: [ownSwap({ id: scenario.name, price: scenario.price })] });
    assert.equal(settlement.mtm, scenario.expectedMtm, scenario.name);
    assert.equal(settlement.net, scenario.expectedNet, scenario.name);
    assert.equal(settlement.documentReady, scenario.ready, scenario.name);
    if (!scenario.ready) assert.match(settlement.blockingReasons.join(' '), /monthly net is zero/i);
  }
});

test('FCBS own-account consolidates every eligible hedge in the settlement month', () => {
  const settlement = build({
    swaps: [
      ownSwap({ id: 'gain-100', quantity: 100, price: 733 }),
      ownSwap({ id: 'loss-100', quantity: 100, price: 739 }),
      ownSwap({ id: 'september', swap_month: '2026-09', quantity: 100, price: 733 }),
      { ...ownSwap({ id: 'not-own', counterparty: 'COSGE', quantity: 100, price: 733 }) },
    ],
  });

  assert.deepEqual(settlement.records.map((swap) => swap.id), ['gain-100', 'loss-100']);
  assert.equal(settlement.mtm, 0.2);
  assert.equal(settlement.fees, 100);
  assert.equal(settlement.net, -99.8);
});

test('FCBS own-account fails closed for missing finality, estimated data, and stale verification', () => {
  const incomplete = build({ mops: [], monthlyVerifications: [] });
  const estimatedRows = actualMonth(MONTH);
  estimatedRows[0] = { ...estimatedRows[0], is_estimate: true };
  const estimated = build({ mops: estimatedRows });
  const stale = build({ monthlyVerifications: [verified(MONTH, false)] });

  for (const settlement of [incomplete, estimated, stale]) {
    assert.equal(settlement.rows[0].ready, false);
    assert.equal(settlement.documentReady, false);
    assert.match(settlement.blockingReasons.join(' '), /final, complete and currently verified MOPS/i);
  }
  assert.equal(incomplete.valuationAvailable, false);
  assert.equal(estimated.valuationAvailable, true);
  assert.equal(stale.valuationAvailable, true);
});

test('an FCBS spread is settled once in its final contract month after both months are final', () => {
  const september = '2026-09';
  const spread = ownSwap({
    id: 'aug-sep-spread',
    trade_type: 'SPREAD',
    leg1_month: MONTH,
    leg1_price: 733,
    leg2_month: september,
    leg2_price: 734,
    swap_month: undefined,
  });
  const data = [...actualMonth(MONTH), ...actualMonth(september, 737)];

  assert.equal(build({ swaps: [spread], mops: data, month: MONTH, monthlyVerifications: [verified(MONTH), verified(september)], now: new Date('2026-10-01T12:00:00Z') }), null);

  const blocked = build({ swaps: [spread], mops: data, month: september, monthlyVerifications: [verified(MONTH)], now: new Date('2026-10-01T12:00:00Z') });
  assert.equal(blocked.records.length, 1);
  assert.equal(blocked.rows[0].ready, false);

  const final = build({ swaps: [spread], mops: data, month: september, monthlyVerifications: [verified(MONTH), verified(september)], now: new Date('2026-10-01T12:00:00Z') });
  assert.equal(final.records.length, 1);
  assert.equal(final.rows[0].ready, true);
  assert.equal(final.documentReady, true);
});

test('only one exact, external FCBS recipient can receive an own-account settlement', () => {
  const badRecipients = [
    [],
    [{ ...FCBS_RECIPIENT, full_name: 'FRATELLI COSULICH BUNKERS (S) PTE. LTD.' }],
    [{ ...FCBS_RECIPIENT, settlement_mode: 'internal_no_invoice' }],
    [FCBS_RECIPIENT, { ...FCBS_RECIPIENT, id: 'duplicate' }],
  ];

  for (const counterparties of badRecipients) {
    const settlement = build({ counterparties });
    assert.equal(settlement.counterpartyRecord, null);
    assert.equal(settlement.documentReady, false);
    assert.match(settlement.blockingReasons.join(' '), /exact external FCBS counterparty/i);
  }
});

test('an existing draft may be resumed, while issued or conflicting active monthly documents block creation', () => {
  const draft = build({ invoices: [{ id: 'draft', settlement_basis: 'fcbs_own_account_venue', settlement_month: MONTH, status: 'Draft' }] });
  assert.equal(draft.existingInvoice.id, 'draft');
  assert.equal(draft.documentReady, true);

  const issued = build({ invoices: [{ id: 'issued', settlement_basis: 'fcbs_own_account_venue', settlement_month: MONTH, status: 'Sent' }] });
  assert.equal(issued.existingInvoice.id, 'issued');
  assert.equal(issued.documentReady, false);
  assert.match(issued.blockingReasons.join(' '), /already been issued/i);

  const conflicting = build({ invoices: [
    { id: 'first', settlement_basis: 'fcbs_own_account_venue', settlement_month: MONTH, status: 'Draft' },
    { id: 'second', settlement_basis: 'fcbs_own_account_venue', settlement_month: MONTH, status: 'Sent' },
  ] });
  assert.equal(conflicting.existingInvoice, null);
  assert.equal(conflicting.documentReady, false);
  assert.match(conflicting.blockingReasons.join(' '), /multiple active/i);
});

test('counterparty reconciliation corrects the FCBHK own-account sign without changing external FCBS handling', () => {
  const mops = actualMonth(MONTH);
  const [internal, externalFcbs] = buildCounterpartySettlementGroups([
    ownSwap(),
    ownSwap({ id: 'external-fcbs', counterparty: 'FCBS' }),
  ], mops, RATES, 7.45, null, [FCBHK_INTERNAL, FCBS_RECIPIENT])
    .sort((left, right) => left.counterparty.localeCompare(right.counterparty));

  assert.equal(internal.counterparty, 'FCBHK');
  assert.equal(internal.internal, true);
  assert.equal(internal.rows[0].displayMtm, 510.17);
  assert.equal(internal.fees, 85);
  assert.equal(internal.net, 425.17);
  assert.equal(internal.rows[0].fees.cpHandlingFee, 0);

  assert.equal(externalFcbs.counterparty, 'FCBS');
  assert.equal(externalFcbs.internal, false);
  assert.equal(externalFcbs.rows[0].displayMtm, -510.17);
  assert.equal(externalFcbs.fees, 85);
  assert.equal(externalFcbs.net, -425.17);
  assert.equal(externalFcbs.rows[0].fees.cpHandlingFee, 85);
});
