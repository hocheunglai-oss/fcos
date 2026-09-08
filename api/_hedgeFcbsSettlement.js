import { createHash } from 'node:crypto';
import { decorateMopsMonthVerifications } from './_hedgeMops.js';
import { hedgeSettlementPaymentDirection, isInternalHedgeCounterparty } from '../src/hedge/lib/domain.js';
import { buildFcbsOwnAccountSettlement, FCBS_OWN_ACCOUNT_BASIS, FCBS_FULL_NAME, fcbsSettlementMonth, isFcbsOwnAccountHedge } from '../src/hedge/lib/fcbsOwnAccountSettlement.js';

const authorizedPayloads = new WeakSet();
const inactiveStatuses = new Set(['Cancelled', 'Voided', 'Deleted']);
const normalize = (value) => String(value || '').trim().toUpperCase();
const ids = (values = []) => {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw failure('Select the complete monthly hedge list.', 'HEDGE_FCBS_SCOPE_INVALID', 400);
  }
  return [...new Set(values)].sort();
};
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const basisOf = (value) => value?.settlementBasis ?? value?.settlement_basis ?? 'counterparty';
function failure(message, code = 'HEDGE_FCBS_REVIEW_REQUIRED', statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
function checked(result, label) {
  if (result.error) throw failure(`${label} could not be verified. Refresh and try again.`, result.error.message?.match(/HEDGE_[A-Z_]+|REVISION_CONFLICT/)?.[0] || 'HEDGE_FCBS_EVIDENCE_UNAVAILABLE', 409);
  return result.data;
}
export const isAuthorizedFcbsPayload = (payload) => authorizedPayloads.has(payload);
export const isFcbsSettlementInvoice = (invoice) => basisOf(invoice) === FCBS_OWN_ACCOUNT_BASIS;

export async function loadFcbsSettlementEvidence(client, month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw failure('Choose a valid settlement month.');
  const evidence = checked(await client.rpc('hedge_fcbs_settlement_evidence', { p_month: month }), 'FCBS settlement evidence');
  if (!evidence?.source || !/^[a-f0-9]{64}$/.test(evidence.source_fingerprint || '')) throw failure('FCBS settlement evidence is incomplete.');
  return evidence;
}

export function fcbsReviewFromEvidence(evidence, request, { now = new Date(), allowIssued = false } = {}) {
  const month = request.settlementMonth ?? request.settlement_month;
  const { source, invoices = [] } = evidence;
  const settings = Object.fromEntries((source.settings || []).map((row) => [row.key, row.value]));
  const rates = settings.rates;
  if (!rates || ['fcbs_venue_mt', 'fcbs_venue_bbl'].some((key) => rates[key] == null || !Number.isFinite(Number(rates[key])) || Number(rates[key]) < 0)) {
    throw failure('Configure and review the FCBS venue fee rates first.', 'HEDGE_FCBS_RATES_REQUIRED');
  }
  const ratio = Number(settings.general?.sgo_bbl_per_mt);
  if (!Number.isFinite(ratio) || ratio <= 0) throw failure('The controlled SGO conversion factor is unavailable.');
  const group = buildFcbsOwnAccountSettlement({ swaps: source.swaps, mops: source.mops, rates, month,
    sgoRatio: ratio, monthlyVerifications: decorateMopsMonthVerifications(source.verifications, source.mops),
    counterparties: source.counterparties, invoices: allowIssued ? [] : invoices, now });
  if (!group?.documentReady) throw failure(group?.blockingReasons?.join(' ') || 'No eligible FCBS own-account hedges exist for this month.', 'HEDGE_FCBS_NOT_READY');
  if (invoices.some((invoice) => !inactiveStatuses.has(invoice.status) && invoice.settlement_basis !== FCBS_OWN_ACCOUNT_BASIS)) {
    throw failure('A selected hedge is already linked to another active settlement. Review the existing document.', 'HEDGE_FCBS_HEDGE_ALREADY_SETTLED');
  }
  const selectedIds = request.swapIds ?? request.swap_ids;
  const swapIds = ids(group.records.map((row) => row.id));
  if (!Array.isArray(selectedIds) || selectedIds.length !== swapIds.length || JSON.stringify(ids(selectedIds)) !== JSON.stringify(swapIds)) {
    throw failure('The monthly hedge selection changed. Refresh and review the complete month.', 'HEDGE_FCBS_SCOPE_CHANGED');
  }
  const invoiceNumber = String(request.invoiceNumber ?? request.invoice_number ?? '').trim();
  const invoiceDate = String(request.invoiceDate ?? request.issue_date ?? '');
  const parsedDate = new Date(`${invoiceDate}T00:00:00Z`);
  if (!invoiceNumber || invoiceNumber.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
      || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== invoiceDate) throw failure('Enter a valid invoice number and date.');
  const counterparty = group.counterpartyRecord;
  const paymentDirection = hedgeSettlementPaymentDirection(group.net, counterparty);
  const payload = {
    settlementBasis: FCBS_OWN_ACCOUNT_BASIS, sourceFingerprint: evidence.source_fingerprint,
    invoiceNumber, invoiceDate, settlementMonth: month, swapIds,
    lineItems: group.rows.map(({ swap, mtm, attributedFeeImpact, net }) => ({
      swapId: swap.id, tradeDate: swap.trade_date, contractMonth: fcbsSettlementMonth(swap),
      product: swap.product, direction: swap.direction, quantity: Number(swap.quantity), unit: swap.unit,
      price: Number(swap.trade_type === 'SPREAD' ? swap.leg1_price : swap.price), venue: 'FCBS',
      mtmValue: mtm, handlingFee: attributedFeeImpact, netValue: net,
    })),
    totalMtm: group.mtm, totalHandling: -group.fees, netAmount: group.net,
    isReceivable: paymentDirection.isReceivable, paymentDirection, counterparty,
  };
  authorizedPayloads.add(payload);
  return payload;
}

async function readInvoice(client, id) {
  const invoice = checked(await client.from('hedge_invoices').select('*').eq('id', id).maybeSingle(), 'Invoice');
  if (!invoice) throw failure('Invoice was not found.', 'HEDGE_INVOICE_NOT_FOUND', 404);
  return invoice;
}

// This guard is used by preview, storage and email, including compatibility callers.
export async function assertHedgeDocumentScope(client, invoice, { requireFresh = false } = {}) {
  const counterparty = invoice.counterparty;
  if (isInternalHedgeCounterparty(counterparty)) throw failure('Internal hedge — no external settlement document.', 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED');
  const own = isFcbsSettlementInvoice(invoice);
  if (!own && basisOf(invoice) !== 'counterparty') throw failure('Unknown settlement basis.');
  let swapIds = invoice.swapIds ?? invoice.swap_ids ?? [];
  if (invoice.id) {
    const links = checked(await client.from('hedge_invoice_swaps').select('swap_id').eq('invoice_id', invoice.id), 'Invoice hedge links');
    swapIds = (links || []).map((row) => row.swap_id);
  }
  const swaps = swapIds.length ? checked(await client.from('hedge_swap_hedges').select('id,counterparty,venue,swap_month,trade_type,leg1_month,leg2_month').in('id', ids(swapIds)), 'Invoice hedge identity') || [] : [];
  if (swaps.length !== ids(swapIds).length) throw failure('A linked hedge is missing.', 'HEDGE_FCBS_SCOPE_INVALID');
  if (!own) {
    if (swaps.some((swap) => isInternalHedgeCounterparty(swap.counterparty))) throw failure('Internal hedge — no external settlement document.', 'HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED');
    return;
  }
  const recipient = typeof counterparty === 'object' ? counterparty.short_name : counterparty;
  if (normalize(recipient) !== 'FCBS' || !swaps.length || swaps.some((swap) => !isFcbsOwnAccountHedge(swap)
    || fcbsSettlementMonth(swap) !== (invoice.settlement_month ?? invoice.settlementMonth))) throw failure('Only FCBHK own-account FCBS hedges for this settlement month are permitted.', 'HEDGE_FCBS_SCOPE_INVALID');
  const recipients = checked(await client.from('hedge_counterparties').select('id,short_name,full_name,settlement_mode').ilike('short_name', 'FCBS').limit(2), 'FCBS recipient') || [];
  if (recipients.length !== 1 || normalize(recipients[0].full_name) !== FCBS_FULL_NAME || recipients[0].settlement_mode !== 'external') throw failure('The exact external FCBS recipient is unavailable.', 'HEDGE_FCBS_RECIPIENT_INVALID');
  if (invoice.id && (!invoice.pdf_payload || invoice.pdf_payload.sourceFingerprint !== invoice.source_fingerprint
    || Number(invoice.pdf_payload.netAmount) !== Number(invoice.subtotal))) throw failure('The saved settlement evidence is inconsistent.', 'HEDGE_FCBS_DOCUMENT_INVALID');
  if (requireFresh && invoice.id && invoice.status === 'Draft') {
    const evidence = await loadFcbsSettlementEvidence(client, invoice.settlement_month);
    if (evidence.source_fingerprint !== invoice.source_fingerprint) throw failure('Settlement evidence changed. Review and update the draft before issuing it.', 'HEDGE_FCBS_SOURCE_CHANGED');
  }
}

export async function prepareHedgeInvoiceReview(client, body, options = {}) {
  if (body.invoiceId) {
    const invoice = await readInvoice(client, body.invoiceId);
    await assertHedgeDocumentScope(client, invoice, { requireFresh: true });
    const payload = { ...(invoice.pdf_payload || {}), invoiceNumber: invoice.invoice_number, invoiceDate: invoice.issue_date,
      settlementMonth: invoice.settlement_month, netAmount: invoice.subtotal };
    if (isFcbsSettlementInvoice(invoice)) authorizedPayloads.add(payload);
    return payload;
  }
  const input = body.invoice || body;
  if (isFcbsSettlementInvoice(input)) {
    const evidence = await loadFcbsSettlementEvidence(client, input.settlementMonth ?? input.settlement_month);
    return fcbsReviewFromEvidence(evidence, input, options);
  }
  await assertHedgeDocumentScope(client, input);
  return input;
}

export async function saveFcbsSettlement(client, profile, body, current = null) {
  const request = body.payload || {};
  if (current && !isFcbsSettlementInvoice(current)) throw failure('An existing customer settlement cannot be reassigned to the own-account basis.');
  if (current && Object.keys(request).length === 1 && Object.hasOwn(request, 'status')) {
    if (!['Sent', 'Settled'].includes(request.status)) throw failure('An issued settlement cannot return to Draft.', 'HEDGE_FCBS_STATUS_INVALID');
    return checked(await client.rpc('set_hedge_fcbs_settlement_status', {
      p_invoice_id: current.id, p_expected_revision: body.expectedRevision ?? null, p_status: request.status,
      p_actor_user_id: profile.id, p_actor_email: profile.email,
    }), 'Settlement status (save a current PDF before marking a draft Sent)');
  }
  if (request.status !== 'Draft' || request.settlement_basis !== FCBS_OWN_ACCOUNT_BASIS || normalize(request.counterparty) !== 'FCBS') throw failure('Use the reviewed FCBS settlement preview to save this document.');
  const key = String(request.idempotency_key || '');
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key)) throw failure('A stable review idempotency key is required.');
  const requestHash = hash({ id: current?.id || null, revision: body.expectedRevision ?? null, fingerprint: request.source_fingerprint,
    number: request.invoice_number, date: request.issue_date, month: request.settlement_month, swapIds: ids(request.swap_ids) });
  const prior = checked(await client.from('hedge_fcbs_settlement_operations').select('invoice_id,request_hash,actor_user_id').eq('idempotency_key', key).maybeSingle(), 'Earlier settlement save');
  if (prior) {
    if (prior.request_hash !== requestHash || prior.actor_user_id !== profile.id) throw failure('This review key belongs to a different save.', 'HEDGE_FCBS_IDEMPOTENCY_CONFLICT');
    return { invoice_id: prior.invoice_id, replayed: true };
  }
  const evidence = await loadFcbsSettlementEvidence(client, request.settlement_month);
  if (request.source_fingerprint !== evidence.source_fingerprint) throw failure('The hedge, fees or MOPS changed. Refresh and review a new preview.', 'HEDGE_FCBS_SOURCE_CHANGED');
  const payload = fcbsReviewFromEvidence(evidence, request);
  // The client never supplies authoritative values, lines, fees or recipient data.
  const canonicalInvoice = { invoice_number: payload.invoiceNumber, issue_date: payload.invoiceDate, settlement_month: payload.settlementMonth,
    invoice_type: payload.paymentDirection.invoiceType, subtotal: payload.netAmount, status: 'Draft', pdf_payload: payload };
  return checked(await client.rpc('save_hedge_fcbs_settlement', {
    p_invoice_id: current?.id || null, p_expected_revision: body.expectedRevision ?? null,
    p_idempotency_key: key, p_request_hash: requestHash, p_source_fingerprint: evidence.source_fingerprint,
    p_invoice: canonicalInvoice, p_actor_user_id: profile.id, p_actor_email: profile.email,
  }), 'FCBS settlement save');
}
