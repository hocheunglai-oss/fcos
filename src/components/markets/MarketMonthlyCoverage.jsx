import { useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronDown, FilterX } from 'lucide-react';
import './MarketMonthlyCoverage.css';

const DEFAULT_VISIBLE_ROWS = 5;
const ALL_FILTER = '__all__';
const UNALLOCATED_FILTER = '__unallocated__';

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback) {
  return value == null || String(value).trim() === '' ? fallback : String(value);
}

function formatQuantity(value, unit) {
  if (value == null || String(value).trim() === '') return 'Unavailable';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unavailable';
  return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
}

function formatSignedQuantity(value, unit) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const sign = numeric > 0 ? '+' : numeric < 0 ? '−' : '';
  return `${sign}${Math.abs(numeric).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
}

function signedLabel(value, unit, suffix = '') {
  const formatted = formatSignedQuantity(value, unit);
  if (formatted == null) return { aria: 'Unavailable', formatted: 'Unavailable', tone: 'neutral' };
  const numeric = Number(value);
  const direction = numeric > 0 ? 'Positive' : numeric < 0 ? 'Negative' : 'Zero';
  return {
    aria: `${direction} ${Math.abs(numeric).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}${suffix ? `; ${suffix}` : ''}`,
    formatted,
    tone: numeric > 0 ? 'positive' : numeric < 0 ? 'negative' : 'neutral',
  };
}

function monthLabel(value) {
  if (!value) return 'Unallocated month';
  const match = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (!match) return String(value);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function dateLabel(value) {
  if (!value) return 'Start date unavailable';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function pricingBasisDetail(row) {
  const basis = String(row?.basis || '').trim().toUpperCase();
  if (basis === 'WMA') return 'Whole-month average';
  if (basis === 'FIXED') return 'Fixed price';
  if (basis === 'BAL_TODAY' || basis === 'BAL_TOMORROW' || row?.balanceStartDate) {
    return `Balance starts ${dateLabel(row?.balanceStartDate)}`;
  }
  return null;
}

function uniqueOptions(items, field) {
  return [...new Set(items.map((row) => text(row?.[field], '')).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function monthOptions(items) {
  const values = [...new Set(items.map((row) => row?.month || UNALLOCATED_FILTER))];
  return values.sort((left, right) => {
    if (left === UNALLOCATED_FILTER) return 1;
    if (right === UNALLOCATED_FILTER) return -1;
    return left.localeCompare(right);
  });
}

function residualMeta(row) {
  const value = row?.residualNet;
  if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value))) {
    return { aria: 'Residual unavailable', quantity: 'Unavailable', status: 'Unavailable', tone: 'neutral' };
  }
  const numeric = Number(value);
  const uncovered = Number(row?.uncoveredQty);
  const excess = Number(row?.excessHedgeQty);
  const status = Number.isFinite(excess) && excess > 0 ? 'excess hedge'
    : Number.isFinite(uncovered) && uncovered > 0 ? 'uncovered'
      : numeric === 0 ? 'balanced quantity' : 'coverage status unavailable';
  const signed = signedLabel(numeric, row?.unit, status);
  const tone = status === 'excess hedge' ? 'negative' : status === 'uncovered' ? 'positive' : 'neutral';
  return { aria: signed.aria, quantity: signed.formatted, status, tone };
}

function Filters({ items, product, counterparty, month, onProduct, onCounterparty, onMonth, onClear }) {
  const products = useMemo(() => uniqueOptions(items, 'product'), [items]);
  const counterparties = useMemo(() => uniqueOptions(items, 'counterparty'), [items]);
  const months = useMemo(() => monthOptions(items), [items]);
  const filtered = product !== ALL_FILTER || counterparty !== ALL_FILTER || month !== ALL_FILTER;

  return <div className="market-monthly-coverage__filters" aria-label="Monthly coverage filters">
    <label><span>Product</span><select value={product} onChange={(event) => onProduct(event.target.value)}><option value={ALL_FILTER}>All products</option>{products.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label><span>Counterparty</span><select value={counterparty} onChange={(event) => onCounterparty(event.target.value)}><option value={ALL_FILTER}>All counterparties</option>{counterparties.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label><span>Month</span><select value={month} onChange={(event) => onMonth(event.target.value)}><option value={ALL_FILTER}>All months</option>{months.map((value) => <option key={value} value={value}>{value === UNALLOCATED_FILTER ? 'Unallocated' : monthLabel(value)}</option>)}</select></label>
    {filtered ? <button type="button" onClick={onClear}><FilterX size={13} aria-hidden="true" /> Clear filters</button> : null}
  </div>;
}

function SignedQuantity({ value, unit }) {
  const signed = signedLabel(value, unit);
  return <span className={`market-monthly-coverage__signed market-monthly-coverage__signed--${signed.tone}`} aria-label={signed.aria}>{signed.formatted}</span>;
}

function DeliveryTable({ items }) {
  return <div className="market-monthly-coverage__table-frame">
    <table className="market-monthly-coverage__table market-monthly-coverage__table--delivery">
      <thead><tr><th>Delivery month</th><th>Counterparty / product</th><th>Physical quantity</th><th>Trades</th></tr></thead>
      <tbody>{items.map((row, index) => <tr key={row?.key || `${row?.counterparty || 'counterparty'}:${row?.product || 'product'}:${row?.unit || 'unit'}:${row?.month || 'unallocated'}:${index}`}>
        <td data-label="Delivery month"><strong>{monthLabel(row?.month)}</strong>{row?.unallocated || !row?.month ? <span className="market-monthly-coverage__allocation">Needs allocation</span> : null}</td>
        <th scope="row"><strong>{text(row?.counterparty, 'Unassigned')}</strong><span>{text(row?.product, 'Product unavailable')} · {text(row?.unit, 'Unit unavailable')}</span></th>
        <td data-label="Physical quantity">{formatQuantity(row?.physicalQty, row?.unit)}</td>
        <td data-label="Trades">{row?.tradeCount == null ? 'Unavailable' : Number(row.tradeCount).toLocaleString('en-US')}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function PricingTable({ items }) {
  return <div className="market-monthly-coverage__table-frame">
    <table className="market-monthly-coverage__table market-monthly-coverage__table--pricing">
      <thead><tr><th>Pricing month / basis</th><th>Counterparty / product</th><th>Buy floating</th><th>Sell floating</th><th>Buy hedges</th><th>Sell hedges</th><th>Residual</th></tr></thead>
      <tbody>{items.map((row, index) => {
        const residual = residualMeta(row);
        const unallocated = !row?.month || !row?.basis;
        const basisDetail = pricingBasisDetail(row);
        return <tr key={row?.key || `${row?.counterparty || 'counterparty'}:${row?.product || 'product'}:${row?.unit || 'unit'}:${row?.month || 'unallocated'}:${row?.basis || 'basis'}:${index}`}>
          <td data-label="Pricing month / basis"><strong>{monthLabel(row?.month)}</strong><span>{text(row?.basis, 'Unallocated basis')}</span>{basisDetail ? <small>{basisDetail}</small> : null}{unallocated ? <span className="market-monthly-coverage__allocation">Needs allocation</span> : null}</td>
          <th scope="row"><strong>{text(row?.counterparty, 'Unassigned')}</strong><span>{text(row?.product, 'Product unavailable')} · {text(row?.unit, 'Unit unavailable')}</span><details className="market-monthly-coverage__fixed"><summary>Fixed physical quantities <ChevronDown size={12} aria-hidden="true" /></summary><dl><div><dt>Buy fixed</dt><dd>{formatQuantity(row?.fixedBuyQty, row?.unit)}</dd></div><div><dt>Sell fixed</dt><dd>{formatQuantity(row?.fixedSellQty, row?.unit)}</dd></div></dl></details>{Number(row?.unknownCount) > 0 ? <span className="market-monthly-coverage__unknown">{Number(row.unknownCount).toLocaleString('en-US')} allocation {Number(row.unknownCount) === 1 ? 'input' : 'inputs'} unavailable</span> : null}</th>
          <td data-label="Buy floating">{formatQuantity(row?.physicalBuyFloatingQty, row?.unit)}</td>
          <td data-label="Sell floating">{formatQuantity(row?.physicalSellFloatingQty, row?.unit)}</td>
          <td data-label="Buy hedges">{formatQuantity(row?.buyHedgeQty, row?.unit)}</td>
          <td data-label="Sell hedges">{formatQuantity(row?.sellHedgeQty, row?.unit)}</td>
          <td data-label="Residual"><span className={`market-monthly-coverage__residual market-monthly-coverage__residual--${residual.tone}`} aria-label={residual.aria}><strong>{residual.quantity}</strong><span>{residual.status}</span></span><span className="market-monthly-coverage__net-detail">Physical <SignedQuantity value={row?.physicalNet} unit={row?.unit} /> · Hedge <SignedQuantity value={row?.hedgeNet} unit={row?.unit} /></span></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function warningText(warning) {
  if (typeof warning === 'string') return warning;
  return warning?.message || warning?.summary || warning?.code || 'Monthly coverage note';
}

export function MarketMonthlyCoverage({ view, coverage = null }) {
  const [product, setProduct] = useState(ALL_FILTER);
  const [counterparty, setCounterparty] = useState(ALL_FILTER);
  const [month, setMonth] = useState(ALL_FILTER);
  const [expanded, setExpanded] = useState(false);
  const sourceRows = rows(view === 'pricing' ? coverage?.pricingRows : coverage?.deliveryRows);
  const filteredRows = sourceRows.filter((row) => (product === ALL_FILTER || row?.product === product)
    && (counterparty === ALL_FILTER || row?.counterparty === counterparty)
    && (month === ALL_FILTER || (month === UNALLOCATED_FILTER ? !row?.month : row?.month === month)));
  const visibleRows = expanded ? filteredRows : filteredRows.slice(0, DEFAULT_VISIBLE_ROWS);
  const isPricing = view === 'pricing';
  const panelTitle = isPricing ? 'Pricing month coverage' : 'Delivery month quantities';

  const clearFilters = () => {
    setProduct(ALL_FILTER);
    setCounterparty(ALL_FILTER);
    setMonth(ALL_FILTER);
    setExpanded(false);
  };

  return <div id={`market-book-panel-${view}`} className="market-monthly-coverage" role="tabpanel" aria-labelledby={`market-book-view-${view}`}>
    <div className="market-monthly-coverage__intro">
      <div><strong>{panelTitle}</strong><p>{isPricing ? 'Floating physicals and hedges are matched only within the same month, pricing basis, product, counterparty and native unit. Different months and bases are never netted; unknown dates or bases remain unallocated.' : 'Physical quantities are grouped by known delivery month. Delivery windows spanning more than one month remain unallocated instead of being distributed by assumption.'}</p></div>
      <span>{filteredRows.length} of {sourceRows.length} {sourceRows.length === 1 ? 'row' : 'rows'}</span>
    </div>

    <Filters items={sourceRows} product={product} counterparty={counterparty} month={month} onProduct={setProduct} onCounterparty={setCounterparty} onMonth={setMonth} onClear={clearFilters} />

    {isPricing ? <div className="market-monthly-coverage__notice" role="note"><AlertTriangle size={15} aria-hidden="true" /><p><strong>Signed quantity coverage only.</strong> Uncovered and excess hedge quantities reflect the direction of the physical position. A zero residual does not mean there is no price risk, and it is not P&amp;L or hedge-effectiveness evidence.</p></div> : null}

    {visibleRows.length ? (isPricing ? <PricingTable items={visibleRows} /> : <DeliveryTable items={visibleRows} />) : <div className="market-monthly-coverage__empty"><BookOpen size={18} aria-hidden="true" /><div><strong>{sourceRows.length ? 'No monthly coverage matches these filters' : `No ${isPricing ? 'pricing' : 'delivery'} month coverage is available`}</strong><span>{sourceRows.length ? 'Clear or change a filter to see other accessible rows.' : 'No quantity is inferred from unavailable allocation inputs.'}</span></div></div>}

    {filteredRows.length > DEFAULT_VISIBLE_ROWS ? <div className="market-monthly-coverage__expand"><button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? `Show first ${DEFAULT_VISIBLE_ROWS}` : `Show all ${filteredRows.length}`}</button></div> : null}

    {coverage?.methodology || rows(coverage?.warnings).length ? <details className="market-monthly-coverage__methodology"><summary>Monthly coverage methodology and notes</summary><div>{coverage?.methodology ? <p>{coverage.methodology}</p> : null}{rows(coverage?.warnings).length ? <ul>{rows(coverage.warnings).map((warning, index) => <li key={warning?.code || warning?.id || index}>{warningText(warning)}</li>)}</ul> : null}</div></details> : null}
  </div>;
}
