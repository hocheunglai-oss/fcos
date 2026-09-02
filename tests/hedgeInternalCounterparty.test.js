import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeHedgeInvoice } from '../api/_hedgeDocuments.js';
import {
  buildCounterpartySettlementGroups,
  hedgeSettlementPaymentDirection,
  isInternalHedgeCounterparty,
} from '../src/hedge/lib/domain.js';

test('FCBHK is recognized as the reserved internal counterparty', () => {
  assert.equal(isInternalHedgeCounterparty(' fcbhk '), true);
  assert.equal(isInternalHedgeCounterparty({ short_name: 'FCBHK', settlement_mode: 'external' }), true);
  assert.equal(isInternalHedgeCounterparty({ short_name: 'INTERNAL', settlement_mode: 'internal_no_invoice' }), true);
  assert.equal(isInternalHedgeCounterparty('FCBS'), false);
});

test('every settlement-document calculation fails closed for FCBHK', () => {
  assert.throws(
    () => hedgeSettlementPaymentDirection(100, 'FCBHK'),
    (error) => error.code === 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED',
  );
  assert.throws(
    () => normalizeHedgeInvoice({ invoiceNumber: 'BLOCKED', netAmount: 100, counterparty: 'FCBHK' }),
    (error) => error.code === 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED' && error.statusCode === 409,
  );
});

test('FCBHK remains in counterparty reconciliation with unchanged MTM and fees', () => {
  const base = {
    id: 'swap-1',
    trade_date: '2026-08-03',
    trade_type: 'STANDARD',
    product: 'S380',
    direction: 'BUY',
    swap_month: '2026-08',
    quantity: 100,
    unit: 'MT',
    price: 600,
    venue: 'ICE',
    broker: 'Ginga',
  };
  const mops = [{ price_date: '2026-08-03', s380: 550, s05: 650, sgo: 100, is_estimate: false }];
  const external = buildCounterpartySettlementGroups([{ ...base, counterparty: 'COSGE' }], mops)[0];
  const internal = buildCounterpartySettlementGroups(
    [{ ...base, counterparty: 'FCBHK' }],
    mops,
    undefined,
    7.45,
    null,
    [{ short_name: 'FCBHK', settlement_mode: 'internal_no_invoice', is_system_managed: true }],
  )[0];
  assert.equal(internal.internal, true);
  assert.equal(internal.mtm, external.mtm);
  assert.equal(internal.fees, external.fees);
  assert.equal(internal.net, external.net);
});

test('FCBHK database migration seeds and protects the internal workflow', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260902072223_add_internal_fcbhk_counterparty.sql', import.meta.url), 'utf8');
  const service = await readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8');
  const documents = await readFile(new URL('../api/_hedgeDocuments.js', import.meta.url), 'utf8');
  for (const token of [
    'internal_no_invoice',
    'is_system_managed',
    'save_hedge_swap_with_links',
    'HEDGE_INTERNAL_PHYSICAL_REQUIRED',
    'HEDGE_INTERNAL_STEM_REQUIRED',
    'HEDGE_INTERNAL_PRODUCT_MISMATCH',
    'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED',
  ]) assert.match(migration, new RegExp(token));
  assert.match(service, /saveSwapWithLinks/);
  assert.match(service, /assertExternalSettlementDocument/);
  assert.match(documents, /Internal hedge — no external settlement document/);
});
