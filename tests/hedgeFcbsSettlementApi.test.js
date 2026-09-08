import assert from 'node:assert/strict';
import test from 'node:test';
import { mopsMonthInputFingerprint } from '../api/_hedgeMops.js';
import {
  assertHedgeDocumentScope,
  fcbsReviewFromEvidence,
  prepareHedgeInvoiceReview,
  saveFcbsSettlement,
} from '../api/_hedgeFcbsSettlement.js';
import { generateHedgeInvoicePdf, normalizeHedgeInvoice } from '../api/_hedgeDocuments.js';
import { tradingDaysInMonth } from '../src/hedge/lib/domain.js';
import { FCBS_FULL_NAME, FCBS_OWN_ACCOUNT_BASIS } from '../src/hedge/lib/fcbsOwnAccountSettlement.js';

// Deliberately generated fixture data only: no market-source or customer records.
const MONTH = '2026-08';
const FINGERPRINT = 'a'.repeat(64);
const NEXT_FINGERPRINT = 'b'.repeat(64);
const NOW = new Date('2026-09-01T12:00:00Z');
const PROFILE = { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.invalid' };
const KEY = '11111111-1111-4111-8111-111111111112';
const FCBS = { id: '22222222-2222-4222-8222-222222222222', short_name: 'FCBS', full_name: FCBS_FULL_NAME, settlement_mode: 'external' };

function actualMonth(month, s05 = 736.001) {
  return tradingDaysInMonth(month).map((price_date, index) => ({
    id: `mops-${month}-${index}`,
    revision: 1,
    price_date,
    s380: 500,
    s05,
    sgo: 100,
    is_estimate: false,
  }));
}

function ownSwap(overrides = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
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

function evidence({ fingerprint = FINGERPRINT, swaps = [ownSwap()], mops = actualMonth(MONTH), stale = false, verifications = null, invoices = [] } = {}) {
  return {
    source_fingerprint: fingerprint,
    source: {
      swaps,
      mops,
      verifications: verifications || [{
        contract_month: MONTH,
        input_fingerprint: stale ? 'stale-fingerprint' : mopsMonthInputFingerprint(MONTH, mops),
      }],
      settings: [
        { key: 'rates', value: { fcbs_venue_mt: 0.5, fcbs_venue_bbl: 0.067114, fcbs_cp_recv_mt: 0.5, fcbs_cp_recv_bbl: 0.03 } },
        { key: 'general', value: { sgo_bbl_per_mt: 7.45 } },
      ],
      counterparties: [FCBS],
    },
    invoices,
  };
}

function request(overrides = {}) {
  return {
    settlementMonth: MONTH,
    swapIds: [ownSwap().id],
    invoiceNumber: 'FCBHK-FCBS-202608-001',
    invoiceDate: '2026-09-01',
    ...overrides,
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

function response(data = null, error = null) {
  return { data, error };
}

// A compact thenable Supabase query mock. Tables are read-only fixtures; rpc
// calls are captured for assertions rather than sent anywhere.
function mockClient({ settlementEvidence = evidence(), tables = {}, operation = null, saveResult = { invoice_id: '44444444-4444-4444-8444-444444444444', replayed: false } } = {}) {
  const calls = [];
  const query = (table) => {
    const result = table === 'hedge_fcbs_settlement_operations'
      ? response(operation)
      : response(tables[table] ?? null);
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      ilike: () => chain,
      limit: () => chain,
      maybeSingle: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  return {
    calls,
    from: query,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'hedge_fcbs_settlement_evidence') return response(settlementEvidence);
      if (name === 'save_hedge_fcbs_settlement') return response(saveResult);
      if (name === 'set_hedge_fcbs_settlement_status') return response(saveResult);
      return response(null, { message: `Unexpected RPC ${name}` });
    },
  };
}

function fcbsSaveRequest(payload, overrides = {}) {
  return {
    status: 'Draft',
    settlement_basis: FCBS_OWN_ACCOUNT_BASIS,
    counterparty: 'FCBS',
    idempotency_key: KEY,
    source_fingerprint: FINGERPRINT,
    invoice_number: payload.invoiceNumber,
    issue_date: payload.invoiceDate,
    settlement_month: payload.settlementMonth,
    swap_ids: payload.swapIds,
    // These client-controlled fields must never affect the stored invoice.
    subtotal: 999999,
    counterparty_record: { short_name: 'FORGED' },
    pdf_payload: { netAmount: 999999 },
    ...overrides,
  };
}

function storedInvoice(payload, overrides = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    revision: 2,
    settlement_basis: FCBS_OWN_ACCOUNT_BASIS,
    settlement_month: MONTH,
    source_fingerprint: FINGERPRINT,
    counterparty: 'FCBS',
    invoice_number: payload.invoiceNumber,
    issue_date: payload.invoiceDate,
    subtotal: payload.netAmount,
    status: 'Draft',
    pdf_payload: payload,
    ...overrides,
  };
}

test('server evidence canonically produces the accepted FCBS August settlement and ignores forged values', () => {
  const selected = ownSwap();
  const extraSeptember = ownSwap({ id: '55555555-5555-4555-8555-555555555555', swap_month: '2026-09' });
  const external = ownSwap({ id: '66666666-6666-4666-8666-666666666666', counterparty: 'CUSTOMER' });
  const reviewed = fcbsReviewFromEvidence(
    evidence({ swaps: [selected, extraSeptember, external] }),
    request({ totalMtm: 999999, totalHandling: 999999, netAmount: 999999, counterparty: 'FORGED', swapIds: [selected.id] }),
    { now: NOW },
  );

  assert.deepEqual(reviewed.swapIds, [selected.id]);
  assert.equal(reviewed.counterparty.short_name, 'FCBS');
  assert.equal(reviewed.counterparty.full_name, FCBS_FULL_NAME);
  assert.equal(reviewed.totalMtm, 510.17);
  assert.equal(reviewed.totalHandling, -85);
  assert.equal(reviewed.netAmount, 425.17);
  assert.equal(reviewed.lineItems[0].handlingFee, -85);
  assert.equal(reviewed.lineItems[0].netValue, 425.17);
});

test('review rejects a changed monthly selection and every incomplete or stale finality state', () => {
  assert.throws(
    () => fcbsReviewFromEvidence(evidence(), request({ swapIds: [] }), { now: NOW }),
    (error) => error.code === 'HEDGE_FCBS_SCOPE_CHANGED',
  );
  assert.throws(
    () => fcbsReviewFromEvidence(evidence({ stale: true }), request(), { now: NOW }),
    (error) => error.code === 'HEDGE_FCBS_NOT_READY',
  );
  assert.throws(
    () => fcbsReviewFromEvidence(evidence({ verifications: [] }), request(), { now: NOW }),
    (error) => error.code === 'HEDGE_FCBS_NOT_READY',
  );
});

test('prepareHedgeInvoiceReview loads evidence and returns only server-canonical FCBS figures and recipient', async () => {
  const client = mockClient();
  const reviewed = await prepareHedgeInvoiceReview(client, request({ settlementBasis: FCBS_OWN_ACCOUNT_BASIS, totalMtm: -10, netAmount: 1, counterparty: 'CUSTOMER' }), { now: NOW });

  assert.equal(client.calls[0].name, 'hedge_fcbs_settlement_evidence');
  assert.equal(reviewed.totalMtm, 510.17);
  assert.equal(reviewed.netAmount, 425.17);
  assert.equal(reviewed.counterparty.full_name, FCBS_FULL_NAME);
});

test('malformed dates and hedge lists fail with actionable validation rather than a runtime error', async () => {
  for (const invoiceDate of ['2026-99-99', '2026-02-30', 'not-a-date']) {
    assert.throws(() => fcbsReviewFromEvidence(evidence(), request({ invoiceDate }), { now: NOW }),
      (error) => error.code === 'HEDGE_FCBS_REVIEW_REQUIRED' && /valid invoice number and date/.test(error.message));
  }
  for (const swapIds of [{ id: ownSwap().id }, [null], [123]]) {
    await rejectsCode(assertHedgeDocumentScope(mockClient(), { counterparty: 'FCBS', swapIds }), 'HEDGE_FCBS_SCOPE_INVALID');
  }
});

test('status-only saves use the revision-protected status RPC without financial edits', async () => {
  const client = mockClient();
  const canonical = fcbsReviewFromEvidence(evidence(), request(), { now: NOW });
  await saveFcbsSettlement(client, PROFILE, { payload: { status: 'Settled' }, expectedRevision: 3 }, storedInvoice(canonical, { status: 'Sent' }));
  assert.deepEqual(client.calls.map((call) => call.name), ['set_hedge_fcbs_settlement_status']);
  assert.equal(client.calls[0].args.p_expected_revision, 3);
  assert.equal(client.calls[0].args.p_status, 'Settled');
  assert.equal(client.calls[0].args.p_actor_user_id, PROFILE.id);
  await rejectsCode(saveFcbsSettlement(client, PROFILE, { payload: { status: 'Draft' } }, storedInvoice(canonical)), 'HEDGE_FCBS_STATUS_INVALID');
});

test('saveFcbsSettlement persists only the reviewed payload and safely replays only for the same actor and request', async () => {
  const canonical = fcbsReviewFromEvidence(evidence(), request(), { now: NOW });
  const firstClient = mockClient();
  const first = await saveFcbsSettlement(firstClient, PROFILE, { payload: fcbsSaveRequest(canonical) });
  assert.equal(first.replayed, false);
  const saveCall = firstClient.calls.find((call) => call.name === 'save_hedge_fcbs_settlement');
  assert.ok(saveCall);
  assert.equal(saveCall.args.p_invoice.subtotal, 425.17);
  assert.equal(saveCall.args.p_invoice.pdf_payload.netAmount, 425.17);
  assert.equal(saveCall.args.p_invoice.pdf_payload.counterparty.full_name, FCBS_FULL_NAME);
  assert.equal(saveCall.args.p_invoice.pdf_payload.totalMtm, 510.17);

  const replayClient = mockClient({ operation: {
    invoice_id: first.invoice_id,
    request_hash: saveCall.args.p_request_hash,
    actor_user_id: PROFILE.id,
  } });
  const replay = await saveFcbsSettlement(replayClient, PROFILE, { payload: fcbsSaveRequest(canonical) });
  assert.deepEqual(replay, { invoice_id: first.invoice_id, replayed: true });
  assert.equal(replayClient.calls.length, 0);

  const otherActor = mockClient({ operation: {
    invoice_id: first.invoice_id,
    request_hash: saveCall.args.p_request_hash,
    actor_user_id: '77777777-7777-4777-8777-777777777777',
  } });
  await rejectsCode(saveFcbsSettlement(otherActor, PROFILE, { payload: fcbsSaveRequest(canonical) }), 'HEDGE_FCBS_IDEMPOTENCY_CONFLICT');
});

test('saveFcbsSettlement fails closed for source changes, an unknown basis, and an original customer document', async () => {
  const canonical = fcbsReviewFromEvidence(evidence(), request(), { now: NOW });
  await rejectsCode(
    saveFcbsSettlement(mockClient({ settlementEvidence: evidence({ fingerprint: NEXT_FINGERPRINT }) }), PROFILE, { payload: fcbsSaveRequest(canonical) }),
    'HEDGE_FCBS_SOURCE_CHANGED',
  );
  await rejectsCode(
    saveFcbsSettlement(mockClient(), PROFILE, { payload: fcbsSaveRequest(canonical, { settlement_basis: 'unknown' }) }),
    'HEDGE_FCBS_REVIEW_REQUIRED',
  );
  await rejectsCode(
    saveFcbsSettlement(mockClient(), PROFILE, { payload: fcbsSaveRequest(canonical) }, { id: 'legacy', settlement_basis: 'counterparty' }),
    'HEDGE_FCBS_REVIEW_REQUIRED',
  );
});

test('document scope blocks mixed venue, self/internal, raw legacy internal links, and unknown basis', async () => {
  const canonical = fcbsReviewFromEvidence(evidence(), request(), { now: NOW });
  const invoice = storedInvoice(canonical);
  const baseTables = {
    hedge_counterparties: [FCBS],
    hedge_invoice_swaps: [{ swap_id: ownSwap().id }],
    hedge_swap_hedges: [ownSwap()],
  };
  await assertHedgeDocumentScope(mockClient({ tables: baseTables }), invoice);

  await rejectsCode(
    assertHedgeDocumentScope(mockClient({ tables: { ...baseTables, hedge_swap_hedges: [ownSwap({ venue: 'ICE' })] } }), invoice),
    'HEDGE_FCBS_SCOPE_INVALID',
  );
  await rejectsCode(
    assertHedgeDocumentScope(mockClient({ tables: baseTables }), { ...invoice, counterparty: 'FCBHK' }),
    'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED',
  );
  await rejectsCode(
    assertHedgeDocumentScope(mockClient({ tables: { ...baseTables, hedge_swap_hedges: [ownSwap()] } }), {
      id: 'legacy', settlement_basis: 'counterparty', counterparty: 'CUSTOMER', swap_ids: [ownSwap().id],
    }),
    'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED',
  );
  await rejectsCode(
    assertHedgeDocumentScope(mockClient({ tables: baseTables }), { ...invoice, settlement_basis: 'made-up' }),
    'HEDGE_FCBS_REVIEW_REQUIRED',
  );
});

test('reading a stored draft requires fresh source evidence, while an issued settlement remains readable', async () => {
  const canonical = fcbsReviewFromEvidence(evidence(), request(), { now: NOW });
  const invoice = storedInvoice(canonical);
  const tables = {
    hedge_invoices: invoice,
    hedge_counterparties: [FCBS],
    hedge_invoice_swaps: [{ swap_id: ownSwap().id }],
    hedge_swap_hedges: [ownSwap()],
  };
  const fresh = await prepareHedgeInvoiceReview(mockClient({ tables }), { invoiceId: invoice.id });
  assert.equal(fresh.netAmount, 425.17);

  await rejectsCode(
    prepareHedgeInvoiceReview(mockClient({ tables, settlementEvidence: evidence({ fingerprint: NEXT_FINGERPRINT }) }), { invoiceId: invoice.id }),
    'HEDGE_FCBS_SOURCE_CHANGED',
  );
  const issued = await prepareHedgeInvoiceReview(mockClient({ tables: { ...tables, hedge_invoices: { ...invoice, status: 'Sent' } }, settlementEvidence: evidence({ fingerprint: NEXT_FINGERPRINT }) }), { invoiceId: invoice.id });
  assert.equal(issued.invoiceNumber, canonical.invoiceNumber);
});

test('a forged own-account payload cannot be normalized, while a prepared payload produces deterministic PDFs', () => {
  assert.throws(
    () => normalizeHedgeInvoice({ settlementBasis: FCBS_OWN_ACCOUNT_BASIS, netAmount: 999999, counterparty: FCBS }),
    (error) => error.code === 'HEDGE_FCBS_REVIEW_REQUIRED',
  );

  const canonical = fcbsReviewFromEvidence(evidence(), request(), { now: NOW });
  const first = generateHedgeInvoicePdf(canonical);
  const second = generateHedgeInvoicePdf(canonical);
  assert.deepEqual(first.buffer, second.buffer);
  assert.equal(first.invoice.netAmount, 425.17);
});
