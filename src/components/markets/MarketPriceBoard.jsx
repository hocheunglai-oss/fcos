import { useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MarketSignedValue } from '@/components/markets/MarketSignedValue';
import { cn } from '@/lib/utils';
import './MarketPriceBoard.css';

const PRODUCT_ORDER = ['hsfo380', 'vlsfo', 'lsmgo'];
const PRODUCT_ALIASES = {
  hsfo380: 'hsfo380', hsfo: 'hsfo380', s380: 'hsfo380',
  vlsfo: 'vlsfo', s05: 'vlsfo', 's0.5%': 'vlsfo',
  lsmgo: 'lsmgo', sgo: 'lsmgo',
};
const PRODUCT_DISPLAY_NAMES = {
  hsfo380: 'HSFO 380',
  vlsfo: 'S0.5%',
  lsmgo: 'LSMGO',
};

const REGIME_CLASSES = {
  backwardation: 'market-price-board__regime--backwardation',
  contango: 'market-price-board__regime--contango',
  flat: 'market-price-board__regime--neutral',
  mixed: 'market-price-board__regime--neutral',
  unavailable: 'market-price-board__regime--neutral',
};

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function values(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function productKey(product) {
  return PRODUCT_ALIASES[String(product?.productKey || '').toLowerCase()] || String(product?.productKey || '').toLowerCase();
}

function productLabel(product) {
  return PRODUCT_DISPLAY_NAMES[productKey(product)] || product?.productName || 'Market product';
}

function orderedProducts(products) {
  return [...rows(products)].sort((left, right) => {
    const leftIndex = PRODUCT_ORDER.indexOf(productKey(left));
    const rightIndex = PRODUCT_ORDER.indexOf(productKey(right));
    return (leftIndex < 0 ? PRODUCT_ORDER.length : leftIndex) - (rightIndex < 0 ? PRODUCT_ORDER.length : rightIndex);
  });
}

function digitsFor(unit) {
  return String(unit || '').toUpperCase() === 'USD/BBL' ? 3 : 2;
}

function formatValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  return `${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digitsFor(unit), maximumFractionDigits: digitsFor(unit),
  })}${unit ? ` ${unit}` : ''}`;
}

function formatDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}/.test(value)) return 'Current-month';
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function spreadFor(product, key) {
  return rows(product?.curve?.spreads).find((spread) => spread.key === key) || null;
}

function estimateEvidence(estimate) {
  const evidence = estimate?.evidence || estimate?.coverage || {};
  const actual = Number(evidence.actual ?? evidence.actualDays ?? evidence.actualCount ?? estimate?.actualDays ?? estimate?.actualCount);
  const estimated = Number(evidence.estimated ?? evidence.estimatedDays ?? evidence.estimatedCount ?? estimate?.estimatedDays ?? estimate?.estimatedCount);
  const carried = Number(evidence.carried ?? evidence.carriedDays ?? evidence.carriedCount ?? estimate?.carriedDays ?? estimate?.carriedCount);
  const representedDays = Number(evidence.representedPublicationDays ?? evidence.countedDays ?? estimate?.representedPublicationDays ?? estimate?.countedDays);
  const parts = [];
  if (Number.isFinite(actual)) parts.push(`${actual} actual`);
  if (Number.isFinite(estimated)) parts.push(`${estimated} estimated`);
  if (Number.isFinite(carried)) parts.push(`${carried} carried`);
  if (Number.isFinite(representedDays)) parts.push(`${representedDays} represented publication day${representedDays === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'Evidence count unavailable';
}

function monthEstimateLabel(pulse, estimate) {
  if (pulse?.mode === 'historical') return `Reconstructed month estimate · as of ${formatDate(pulse.asOfDate)}`;
  if (estimate?.mode === 'reconstructed') return `Reconstructed month estimate · as of ${formatDate(pulse?.asOfDate)}`;
  return `${formatMonth(pulse?.currentMonth)} estimate`;
}

function detailsFor({ label, product, metric, pulse, value, unit, extra = [] }) {
  const estimate = metric === product?.monthlyEstimate;
  const sourceCodes = metric?.sourceCodes || product?.sourceCodes || [metric?.sourceCode || product?.sourceCode].filter(Boolean);
  const detailRows = [
    ['Value', formatValue(value, unit)],
    ['Unit', unit || 'Unavailable'],
    ['As-of date', pulse?.asOfDate ? formatDate(pulse.asOfDate) : 'Latest snapshot'],
    ['Publication date', metric?.publicationDate ? formatDate(metric.publicationDate) : 'Unavailable'],
    ['Prior publication', metric?.comparison?.previousDate ? formatDate(metric.comparison.previousDate) : 'Unavailable'],
    ['Basis', metric?.basis || product?.basis || (estimate ? 'Current-month MOPS estimate' : 'Unavailable')],
    ['Source sample count', metric?.sourceSampleCount ?? metric?.sampleCount ?? metric?.recordCount ?? metric?.evidence?.sourceSampleCount ?? metric?.evidence?.sampleCount ?? 'Unavailable'],
    ['Represented publication days', metric?.representedPublicationDays ?? metric?.countedDays ?? metric?.evidence?.representedPublicationDays ?? metric?.evidence?.countedDays ?? 'Unavailable'],
    ['Source code', values(sourceCodes).filter(Boolean).join(', ') || 'Unavailable'],
    ...(metric?.sourcePage ? [['Report page', metric.sourcePage]] : []),
    ...(estimate ? [['Evidence', estimateEvidence(metric)]] : []),
    ...extra,
  ].filter(([, detail]) => detail != null && detail !== '');
  return { label, rows: detailRows, note: (pulse?.mode === 'historical' || metric?.mode === 'reconstructed') && estimate
    ? 'Reconstruction uses currently stored records dated on or before the selected date; later corrections may differ from the originally available record.'
    : null };
}

function MetricButton({ label, children, detail, onSelect, className }) {
  return <button type="button" className={cn('market-price-board__metric', className)} onClick={(event) => onSelect(detail, event.currentTarget)} aria-label={`Show details for ${label}`}>
    <span className="market-price-board__metric-content">{children}</span><Info aria-hidden="true" className="market-price-board__metric-icon" />
  </button>;
}

function LatestMops({ product, pulse, onSelect }) {
  const mops = product.latestMops || {};
  return <MetricButton label={`${productLabel(product)} latest MOPS`} onSelect={onSelect} detail={detailsFor({ label: `${productLabel(product)} latest MOPS`, product, metric: mops, pulse, value: mops.value, unit: product.unit })}>
    <strong className="market-price-board__price">{formatValue(mops.value, product.unit)}</strong>
    <span>{mops.publicationDate ? `Published ${formatDate(mops.publicationDate)}` : 'No publication date'}</span>
  </MetricButton>;
}

function PublishedMove({ product, pulse, onSelect }) {
  const comparison = product.latestMops?.comparison || {};
  const unit = comparison.unit || product.unit;
  return <MetricButton label={`${productLabel(product)} published move`} onSelect={onSelect} detail={detailsFor({ label: `${productLabel(product)} published move`, product, metric: comparison, pulse, value: comparison.change, unit, extra: [['Comparison', comparison.available ? `Against ${formatDate(comparison.previousDate)}` : 'No complete prior comparison']] })}>
    <MarketSignedValue value={comparison.available ? comparison.change : null} unit={unit} digits={digitsFor(unit)} suffix={comparison.available ? `vs ${formatDate(comparison.previousDate)}` : ''} unavailableLabel="No prior comparison" />
  </MetricButton>;
}

function SingaporeDelivered({ product, pulse, onSelect }) {
  const delivered = product.singaporeDelivered || {};
  const premium = delivered.premium || {};
  const unit = delivered.unit || product.unit;
  return <MetricButton label={`${productLabel(product)} Singapore delivered price`} onSelect={onSelect} detail={detailsFor({ label: `${productLabel(product)} Singapore delivered price`, product, metric: delivered, pulse, value: delivered.value, unit, extra: [['Day change', delivered.dayChange == null ? null : formatValue(delivered.dayChange, unit)], ['Premium', premium.value == null ? null : `${formatValue(premium.value, premium.unit || unit)}${premium.date ? ` · ${formatDate(premium.date)}` : ''}`]] })}>
    <strong className="market-price-board__price">{formatValue(delivered.value, unit)}</strong>
    <span>{delivered.publicationDate ? `Published ${formatDate(delivered.publicationDate)}` : 'No Singapore delivered quote'}</span>
    {delivered.dayChange != null ? <MarketSignedValue value={delivered.dayChange} unit={unit} digits={digitsFor(unit)} suffix="day change" /> : null}
    {premium.value != null ? <span>Premium {formatValue(premium.value, premium.unit || unit)}{premium.date ? ` · ${formatDate(premium.date)}` : ''}</span> : null}
  </MetricButton>;
}

function MonthlyEstimate({ product, pulse, onSelect }) {
  const estimate = product.monthlyEstimate || {};
  return <MetricButton label={`${productLabel(product)} month estimate`} onSelect={onSelect} detail={detailsFor({ label: `${productLabel(product)} month estimate`, product, metric: estimate, pulse, value: estimate.value, unit: estimate.unit || product.unit })}>
    <strong className="market-price-board__price">{formatValue(estimate.value, estimate.unit || product.unit)}</strong>
    <span>{monthEstimateLabel(pulse, estimate)}</span>
    <span>{estimateEvidence(estimate)}</span>
  </MetricButton>;
}

function CurveMetric({ product, pulse, spreadKey, label, onSelect }) {
  const spread = spreadFor(product, spreadKey) || {};
  const unit = spread.unit || product.unit;
  return <MetricButton label={`${productLabel(product)} ${label}`} onSelect={onSelect} detail={detailsFor({ label: `${productLabel(product)} ${label}`, product, metric: spread, pulse, value: spread.value, unit, extra: [['Day change', spread.comparison?.available ? formatValue(spread.comparison.change, unit) : null]] })}>
    <strong><MarketSignedValue value={spread.value} unit={unit} digits={digitsFor(unit)} unavailableLabel="Not published" /></strong>
    {spread.comparison ? <MarketSignedValue value={spread.comparison.available ? spread.comparison.change : null} unit={unit} digits={digitsFor(unit)} suffix={spread.comparison.available ? `vs ${formatDate(spread.comparison.previousDate)}` : ''} unavailableLabel="No prior comparison" /> : <span>Not published</span>}
  </MetricButton>;
}

function Regime({ product, pulse, onSelect }) {
  const regime = product.curve?.status || 'unavailable';
  return <MetricButton label={`${productLabel(product)} curve regime`} onSelect={onSelect} detail={detailsFor({ label: `${productLabel(product)} curve regime`, product, metric: product.curve, pulse, value: null, unit: product.unit, extra: [['Regime', regime], ['Curve report', product.curve?.reportDate ? formatDate(product.curve.reportDate) : pulse?.curveReportDate ? formatDate(pulse.curveReportDate) : null]] })} className="market-price-board__regime-button">
    <span className={cn('market-price-board__regime', REGIME_CLASSES[regime] || REGIME_CLASSES.unavailable)}>{regime}</span>
  </MetricButton>;
}

function ProductIdentity({ product }) {
  return <div className="market-price-board__product"><strong>{productLabel(product)}</strong><span>{product.sourceCode ? `(${product.sourceCode})` : 'Source code unavailable'}</span></div>;
}

function BoardRow({ product, pulse, compact, onSelect }) {
  return <article className={`market-price-board__row market-price-board__row--${productKey(product)}`} role="row">
    <ProductIdentity product={product} />
    <LatestMops product={product} pulse={pulse} onSelect={onSelect} />
    <PublishedMove product={product} pulse={pulse} onSelect={onSelect} />
    {!compact ? <SingaporeDelivered product={product} pulse={pulse} onSelect={onSelect} /> : null}
    <MonthlyEstimate product={product} pulse={pulse} onSelect={onSelect} />
    <CurveMetric product={product} pulse={pulse} spreadKey="bmM1" label="BM−M1" onSelect={onSelect} />
    <CurveMetric product={product} pulse={pulse} spreadKey="m1M2" label="M1−M2" onSelect={onSelect} />
    <Regime product={product} pulse={pulse} onSelect={onSelect} />
  </article>;
}

function MobileCard({ product, pulse, compact, onSelect }) {
  return <article className={`market-price-board__card market-price-board__card--${productKey(product)}`}>
    <ProductIdentity product={product} />
    <div className="market-price-board__card-grid">
      <div><span>Latest MOPS</span><LatestMops product={product} pulse={pulse} onSelect={onSelect} /></div>
      <div><span>Published move</span><PublishedMove product={product} pulse={pulse} onSelect={onSelect} /></div>
      {!compact ? <div><span>Singapore delivered</span><SingaporeDelivered product={product} pulse={pulse} onSelect={onSelect} /></div> : null}
      <div><span>Month estimate</span><MonthlyEstimate product={product} pulse={pulse} onSelect={onSelect} /></div>
      <div><span>BM−M1</span><CurveMetric product={product} pulse={pulse} spreadKey="bmM1" label="BM−M1" onSelect={onSelect} /></div>
      <div><span>M1−M2</span><CurveMetric product={product} pulse={pulse} spreadKey="m1M2" label="M1−M2" onSelect={onSelect} /></div>
      <div><span>Curve</span><Regime product={product} pulse={pulse} onSelect={onSelect} /></div>
    </div>
  </article>;
}

export function MarketPriceBoard({ pulse, compact = false }) {
  const [detail, setDetail] = useState(null);
  const detailTriggerRef = useRef(null);
  const products = useMemo(() => orderedProducts(pulse?.products), [pulse?.products]);
  const reconstructedEstimate = pulse?.mode === 'historical' || products.some((product) => product.monthlyEstimate?.mode === 'reconstructed');
  const monthLabel = pulse?.mode === 'historical' ? `Historical snapshot · as of ${formatDate(pulse.asOfDate)}` : `${formatMonth(pulse?.currentMonth)} market snapshot`;
  const selectDetail = (nextDetail, trigger) => {
    detailTriggerRef.current = trigger;
    setDetail(nextDetail);
  };
  const restoreMetricFocus = (event) => {
    if (!detailTriggerRef.current) return;
    event.preventDefault();
    detailTriggerRef.current.focus();
  };

  return <section className={cn('market-price-board-panel', compact && 'market-price-board-panel--compact')} aria-label={compact ? 'Market Pulse price board' : 'Market price board'}>
    {!compact ? <div className="market-price-board__heading"><div><h2>Market price board</h2><p>{monthLabel}. Select a metric for source, basis, unit, date, and sample details.</p></div><span className="market-price-board__mode">{pulse?.mode === 'historical' ? 'Historical' : 'Latest'}</span></div> : null}
    <div className="market-price-board__desktop" role="table" aria-label={compact ? 'Compact Market Pulse price board' : 'Market price board'}>
      <div className="market-price-board__header" role="row"><span>Product</span><span>Latest MOPS</span><span>Published move</span>{!compact ? <span>Singapore delivered</span> : null}<span>{reconstructedEstimate ? 'Reconstructed month estimate' : 'Month estimate'}</span><span>BM−M1</span><span>M1−M2</span><span>Curve</span></div>
      {products.map((product) => <BoardRow key={product.productKey || product.productName} product={product} pulse={pulse} compact={compact} onSelect={selectDetail} />)}
    </div>
    <div className="market-price-board__mobile">{products.map((product) => <MobileCard key={product.productKey || product.productName} product={product} pulse={pulse} compact={compact} onSelect={selectDetail} />)}</div>
    <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
      <DialogContent className="max-h-[84vh] max-w-xl overflow-y-auto" onCloseAutoFocus={restoreMetricFocus}>
        <DialogHeader><DialogTitle>{detail?.label || 'Market metric details'}</DialogTitle><DialogDescription>Read-only evidence for the displayed market metric.</DialogDescription></DialogHeader>
        <dl className="market-price-board__details">{detail?.rows?.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
        {detail?.note ? <p className="market-price-board__detail-note">{detail.note}</p> : null}
      </DialogContent>
    </Dialog>
  </section>;
}
