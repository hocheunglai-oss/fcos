import { isCoverageSwap } from '../src/hedge/lib/domain.js';

const PRODUCTS = new Set(['S380', 'S0.5', 'SGO']);
const BASES = new Set(['WMA', 'BAL_TODAY', 'BAL_TOMORROW']);
const number = (value) => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const rounded = (value) => Math.round(value * 1e6) / 1e6;
const monthOf = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? value : null;
function dateOf(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text ? text : null;
}
function quantity(row, ratio, physical = false) {
  const unit = String(row.unit || '').toUpperCase();
  const min = number(physical ? row.qty_min : row.quantity);
  const max = physical && row.qty_max != null && row.qty_max !== '' ? number(row.qty_max) : min;
  if (!PRODUCTS.has(row.product) || !['MT', 'BBL'].includes(unit) || min == null || max == null || min <= 0 || max < min) return null;
  const midpoint = (min + max) / 2;
  return row.product === 'SGO' && unit === 'MT' ? midpoint * ratio : row.product !== 'SGO' && unit === 'BBL' ? midpoint / ratio : midpoint;
}

// This is a signed quantity schedule, not a valuation. Different months and
// pricing windows never offset each other, and missing dates are not allocated.
export function buildMonthlyCoverage(physicals = [], swaps = [], ratio = 7.45) {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid gasoil conversion');
  const delivery = new Map(); const pricing = new Map(); let unknown = 0;
  const identity = (row) => ({ counterparty: row.counterparty || 'Unassigned', product: row.product || 'Unknown', unit: PRODUCTS.has(row.product) ? row.product === 'SGO' ? 'BBL' : 'MT' : String(row.unit || 'Unknown').toUpperCase() });
  const pricingRow = (row, month, basis, start) => {
    const meta = identity(row); const key = JSON.stringify([meta.counterparty, meta.product, meta.unit, month, basis, start]);
    if (!pricing.has(key)) pricing.set(key, { key, ...meta, month, basis, balanceStartDate: start, physicalBuyFloatingQty: 0, physicalSellFloatingQty: 0, fixedBuyQty: 0, fixedSellQty: 0, buyHedgeQty: 0, sellHedgeQty: 0, unknownCount: 0 });
    return pricing.get(key);
  };
  const addLeg = (row, { month: rawMonth, basis: rawBasis, start: rawStart, field, qty, validType = true, fixed = false }) => {
    const month = monthOf(rawMonth);
    const basis = fixed ? 'Fixed' : BASES.has(rawBasis || 'WMA') ? rawBasis || 'WMA' : 'Unknown';
    const start = fixed || basis === 'WMA' ? null : dateOf(rawStart);
    const windowValid = fixed || basis === 'WMA' || Boolean(start && start.slice(0, 7) === month);
    const target = pricingRow(row, month, basis, start);
    if (qty != null && validType && field) target[field] += qty;
    if (qty == null || !month || !windowValid || basis === 'Unknown' || !validType) { target.unknownCount += 1; unknown += 1; }
  };
  physicals.filter((row) => !row.is_closed).forEach((row) => {
    const qty = quantity(row, ratio, true); const from = dateOf(row.delivery_date_from); const to = row.delivery_date_to == null || row.delivery_date_to === '' ? from : dateOf(row.delivery_date_to);
    const month = from && to && to >= from && from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;
    const meta = identity(row); const key = JSON.stringify([meta.counterparty, meta.product, meta.unit, month]);
    if (!delivery.has(key)) delivery.set(key, { key, ...meta, month, physicalQty: 0, tradeCount: 0, unallocated: !month });
    const target = delivery.get(key); target.tradeCount += 1;
    target.physicalQty = qty == null || target.physicalQty == null ? null : target.physicalQty + qty;
    for (const side of ['buy', 'sell']) {
      const type = row[`${side}_price_type`]; const fixed = type === 'Fixed';
      addLeg(row, { month: row[`${side}_pricing_month`], basis: row[`${side}_pricing_basis`], start: row[`${side}_bal_date`],
        field: fixed ? side === 'buy' ? 'fixedBuyQty' : 'fixedSellQty' : side === 'buy' ? 'physicalBuyFloatingQty' : 'physicalSellFloatingQty',
        qty, fixed, validType: fixed || type === 'MOPS WMA' });
    }
  });
  swaps.filter(isCoverageSwap).forEach((row) => {
    const qty = quantity(row, ratio);
    const legs = row.trade_type === 'SPREAD'
      ? [{ month: row.leg1_month, basis: row.leg1_basis, start: row.leg1_bal_date, direction: 'BUY' }, { month: row.leg2_month, basis: row.leg2_basis, start: row.leg2_bal_date, direction: 'SELL' }]
      : [{ month: row.swap_month, basis: row.pricing_basis, start: row.bal_start_date, direction: row.direction }];
    for (const leg of legs) addLeg(row, { ...leg, qty, field: leg.direction === 'BUY' ? 'buyHedgeQty' : 'sellHedgeQty', validType: ['BUY', 'SELL'].includes(leg.direction) });
  });
  const sort = (a, b) => (a.month || '9999').localeCompare(b.month || '9999') || a.counterparty.localeCompare(b.counterparty) || a.product.localeCompare(b.product) || String(a.basis || '').localeCompare(String(b.basis || ''));
  const pricingRows = [...pricing.values()].map((row) => {
    for (const field of ['physicalBuyFloatingQty', 'physicalSellFloatingQty', 'fixedBuyQty', 'fixedSellQty', 'buyHedgeQty', 'sellHedgeQty']) row[field] = rounded(row[field]);
    const physicalNet = row.unknownCount ? null : rounded(row.physicalSellFloatingQty - row.physicalBuyFloatingQty);
    const hedgeNet = row.unknownCount ? null : rounded(row.buyHedgeQty - row.sellHedgeQty);
    const residualNet = physicalNet == null ? null : rounded(physicalNet + hedgeNet);
    const excess = residualNet != null && residualNet !== 0 && (physicalNet === 0 || Math.sign(physicalNet) !== Math.sign(residualNet));
    return { ...row, physicalNet, hedgeNet, residualNet, uncoveredQty: residualNet == null ? null : excess ? 0 : Math.abs(residualNet), excessHedgeQty: residualNet == null ? null : excess ? Math.abs(residualNet) : 0 };
  }).sort(sort);
  const deliveryRows = [...delivery.values()].map((row) => ({ ...row, physicalQty: row.physicalQty == null ? null : rounded(row.physicalQty) })).sort(sort);
  return { deliveryRows, pricingRows,
    warnings: [unknown ? `${unknown} pricing legs have incomplete terms or quantities; their residuals are unavailable.` : null, deliveryRows.some((row) => row.unallocated) ? 'Cross-month or undated delivery windows remain unallocated; no daily quantity split is assumed.' : null].filter(Boolean),
    methodology: 'Open physical midpoint quantities and live counterparty hedges. Floating sales minus floating purchases plus BUY hedges minus SELL hedges gives the signed residual within each exact month and pricing window. Fixed-price legs are shown separately. Spread hedges allocate BUY leg 1 and SELL leg 2. Native product units remain separate. This is quantity context, not P&L, price risk or hedge effectiveness.' };
}
