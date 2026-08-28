import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { loadMarketIntelligenceBrief } from '@/hedge/api/marketData';
import { formatDate } from '@/hedge/lib/domain';
import { Button, InlineError, Panel, StatusBadge } from '@/hedge/components/ui';
import { MarketSignedText, MarketSignedValue } from '@/components/markets/MarketSignedValue';
import {
  projectBriefDriver,
  projectMaterialChange,
  projectPhysicalPaperSignal,
  projectPortDislocation,
} from './briefProjection';

const PRODUCT_LABELS = {
  hsfo380: 'HSFO 380',
  hsfo: 'HSFO 380',
  s380: 'HSFO 380',
  vlsfo: 'S0.5%',
  s05: 'S0.5%',
  lsmgo: 'LSMGO',
  sgo: 'LSMGO',
};

function array(value) {
  return Array.isArray(value) ? value : [];
}

function textOf(item) {
  if (typeof item === 'string') return item;
  return item?.summary || item?.message || item?.text || item?.label || '';
}

function directionIcon(direction) {
  const normalized = String(direction || '').toLowerCase();
  if (['up', 'higher', 'bullish', 'tightening', 'positive'].includes(normalized)) return ArrowUpRight;
  if (['down', 'lower', 'bearish', 'easing', 'negative'].includes(normalized)) return ArrowDownRight;
  return ArrowRight;
}

function normalizeRef(value) {
  return typeof value === 'string' ? { sourceHash: value } : value || {};
}

function refPages(ref) {
  const pages = array(ref.pages);
  return pages.length ? pages : [ref.page ?? ref.sourcePage].filter((page) => page != null);
}

function lineageFor(item, sourceRefs, defaultDate) {
  const topRefs = sourceRefs.map(normalizeRef);
  const embedded = array(item?.sourceRefs || item?.sources).map(normalizeRef);
  const ids = new Set(array(item?.sourceRefIds).concat(item?.sourceReportId || item?.reportId || []).filter(Boolean));
  const hashes = new Set(array(item?.sourceHashes).concat(item?.sourceHash || []).filter(Boolean));
  const matched = topRefs.filter((ref) => ids.has(ref.id) || ids.has(ref.reportId) || hashes.has(ref.sourceHash) || (item?.sourceReportDate && ref.reportDate === item.sourceReportDate));
  const refs = embedded.length ? embedded.map((ref) => ({ ...(topRefs.find((top) => (ref.sourceHash && top.sourceHash === ref.sourceHash) || (ref.reportId && top.reportId === ref.reportId) || (ref.id && top.id === ref.id)) || {}), ...ref })) : matched;
  return refs.map((ref) => {
    const pages = refPages(ref);
    return [ref.reportType || ref.documentType || 'Report', (ref.reportDate || defaultDate) ? formatDate(ref.reportDate || defaultDate) : null, pages.length ? `${pages.length > 1 ? 'pages' : 'page'} ${pages.join(', ')}` : null].filter(Boolean).join(' · ');
  });
}

function BriefList({ title, items, empty, icon: Icon = FileSearch, sourceRefs = [], sourceDate = null, limit = null }) {
  const [expanded, setExpanded] = useState(false);
  const visible = !limit || expanded ? items : items.slice(0, limit);
  return (
    <Panel className="market-brief-list">
      <div className="app-panel-header"><div><h2>{title}</h2></div>{items.length ? <StatusBadge tone="neutral">{items.length}</StatusBadge> : null}</div>
      {items.length ? <div className="market-brief-items">{visible.map((item, index) => {
        const DirectionIcon = directionIcon(item?.direction);
        const key = item?.id || `${title}:${item?.sourceReportId || ''}:${item?.sourcePage || ''}:${index}`;
        return (
          <article key={key} className="market-brief-item">
            <DirectionIcon size={17} aria-hidden="true" />
            <div>
              <strong><MarketSignedText>{item?.title || item?.label || textOf(item)}</MarketSignedText></strong>
              {item?.title || item?.label ? <p><MarketSignedText>{textOf(item)}</MarketSignedText></p> : null}
              <div className="market-brief-item__meta">
                {item?.product || item?.productKey ? <span>{PRODUCT_LABELS[item.product || item.productKey] || item.product || item.productKey}</span> : null}
                {item?.port || item?.portKey ? <span>{item.port || item.portKey}</span> : null}
                {item?.horizon ? <span>{item.horizon}</span> : null}
                {item?.confidenceLabel ? <span>{item.confidenceLabel}</span> : null}
                {item?.metricBasis ? <span><MarketSignedText>{item.metricBasis}</MarketSignedText></span> : null}
                {item?.sourcePage ? <span>Report page {item.sourcePage}</span> : null}
                {lineageFor(item, sourceRefs, sourceDate).map((lineage) => <span key={lineage}>{lineage}</span>)}
              </div>
            </div>
          </article>
        );
      })}</div> : <div className="market-empty-inline market-empty-inline--compact"><Icon size={20} /><div><strong>{empty}</strong><span>No value is inferred from missing report evidence.</span></div></div>}
      {limit && items.length > limit ? <Button size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show highlights' : `Show all ${items.length}`}</Button> : null}
    </Panel>
  );
}

function formatMarketValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: unit === 'USD/BBL' ? 3 : 2 })} ${unit}`;
}

function Movement({ comparison }) {
  return <MarketSignedValue
    value={comparison?.available ? comparison.change : null}
    unit={comparison?.unit}
    suffix={comparison?.available ? `vs ${formatDate(comparison.previousDate)}` : ''}
    unavailableLabel="No prior comparison"
    variant="pill"
  />;
}

function spreadFor(product, key) {
  return array(product?.curve?.spreads).find((row) => row.key === key) || null;
}

function MarketPriceBoard({ pulse }) {
  const products = array(pulse?.products);
  return <Panel className="market-price-board-panel">
    <div className="app-panel-header"><div><h2>Market at a glance</h2><p>Official prices, published-day movement, current-month estimate, and exact prompt structure.</p></div><StatusBadge tone={pulse?.complete ? 'positive' : 'warning'}>{pulse?.complete ? 'Current official data' : 'Controlled gaps'}</StatusBadge></div>
    <div className="market-price-board" role="table" aria-label="Compact market price board">
      <div className="market-price-board__header" role="row"><span>Product</span><span>Latest MOPS</span><span>Published move</span><span>Est. month average</span><span>BM−M1</span><span>M1−M2</span><span>Curve</span></div>
      {products.map((product) => {
        const bmM1 = spreadFor(product, 'bmM1');
        const m1M2 = spreadFor(product, 'm1M2');
        const status = product.curve?.status || 'unavailable';
        return <article key={product.productKey} className={`market-price-board__row market-price-board__row--${product.productKey}`} role="row">
          <div className="market-price-board__product"><strong>{product.productName}</strong><span>({product.sourceCode}) · {formatDate(product.latestMops?.publicationDate)}</span></div>
          <strong>{formatMarketValue(product.latestMops?.value, product.unit)}</strong>
          <Movement comparison={product.latestMops?.comparison} />
          <div><strong>{formatMarketValue(product.monthlyEstimate?.value, product.unit)}</strong><span className="market-price-board__subtle">Calculated estimate</span></div>
          <div className="market-price-board__spread"><strong><MarketSignedValue value={bmM1?.value} unit={bmM1?.unit || product.unit} /></strong>{bmM1?.comparison ? <Movement comparison={bmM1.comparison} /> : <span className="market-price-board__subtle">Not published</span>}</div>
          <div className="market-price-board__spread"><strong><MarketSignedValue value={m1M2?.value} unit={m1M2?.unit || product.unit} /></strong>{m1M2?.comparison ? <Movement comparison={m1M2.comparison} /> : null}</div>
          <span className={`market-curve-state market-curve-state--${status}`}>{status}</span>
        </article>;
      })}
    </div>
  </Panel>;
}

export function MarketDecisionBrief({ initialBrief = null, refreshKey = 0, pulse = null, intraday = null, onRefreshPulse = null }) {
  const [brief, setBrief] = useState(initialBrief);
  const [busy, setBusy] = useState(!initialBrief);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const refreshKeyRef = useRef(refreshKey);

  const load = async ({ force = false, date = null, historyMode = 'replace' } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const nextBrief = await loadMarketIntelligenceBrief(date ? { date } : {}, { force, cache: !force });
      if (!mountedRef.current) return;
      setBrief(nextBrief);
      if (nextBrief?.displayedDate && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('marketBriefDate', nextBrief.displayedDate);
        window.history[historyMode === 'push' ? 'pushState' : 'replaceState']({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (nextError) {
      if (mountedRef.current) setError(nextError);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    const initialDate = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('marketBriefDate');
    load({ date: initialDate });
    const onPopState = () => {
      const date = new URLSearchParams(window.location.search).get('marketBriefDate');
      load({ date, force: false, historyMode: 'replace' });
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []); // The initial request is intentionally independent of background snapshot refreshes.

  useEffect(() => {
    if (refreshKeyRef.current === refreshKey) return;
    refreshKeyRef.current = refreshKey;
    const currentDate = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('marketBriefDate');
    load({ date: currentDate, force: true });
  }, [refreshKey]);

  const completeness = brief?.reportCompleteness || brief?.completeness || {};
  const curveCoverage = brief?.curveCoverage || {};
  const materialChanges = array(brief?.materialChanges || brief?.moves).map(projectMaterialChange);
  const dislocations = array(brief?.portDislocations || brief?.dislocations).map(projectPortDislocation);
  const physicalPaper = array(brief?.physicalPaperSignals || brief?.physicalVsPaper || brief?.physicalPaper).map(projectPhysicalPaperSignal);
  const sourceRefs = array(brief?.sourceRefs);
  const drivers = brief?.drivers || {};
  const flatDrivers = Array.isArray(drivers) ? drivers : [
    ...array(drivers.emerging || brief?.emergingDrivers).map((item) => ({ ...item, lifecycle: item.lifecycle || 'Emerging' })),
    ...array(drivers.persistent || brief?.persistentDrivers).map((item) => ({ ...item, lifecycle: item.lifecycle || 'Persistent' })),
    ...array(drivers.fading || brief?.fadingDrivers).map((item) => ({ ...item, lifecycle: item.lifecycle || 'Fading' })),
  ];
  const projectedDrivers = flatDrivers.map(projectBriefDriver);
  const risks = array(brief?.risks || brief?.risksToWatch);
  const requiredReports = Number(completeness.requiredReports ?? completeness.required ?? 2);
  const completeReports = Number(completeness.completeReports ?? (completeness.complete === true ? requiredReports : array(completeness.reportTypes).length));
  return (
    <div className="market-intelligence-stack" data-testid="market-daily-decision-brief">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
      <div className="market-overview-context">
        <div className="market-overview-context__title"><strong>Overview</strong><span>Official prices and deterministic report evidence. No buy or sell recommendation.</span></div>
        <div className="market-brief-topbar__actions">
          <Button size="sm" icon={ChevronLeft} onClick={() => load({ date: brief?.previousAvailableDate, historyMode: 'push' })} disabled={busy || !brief?.previousAvailableDate}>Previous</Button>
          <div className="market-brief-date">
            <span>Displaying report date</span>
            <strong>{brief?.displayedDate ? formatDate(brief.displayedDate) : 'Unavailable'}</strong>
            <StatusBadge tone={brief?.displayedDate && brief.displayedDate === brief?.latestAvailableDate ? 'positive' : 'neutral'}>{brief?.displayedDate && brief.displayedDate === brief?.latestAvailableDate ? 'Latest available' : 'Historical'}</StatusBadge>
          </div>
          <Button size="sm" icon={ChevronRight} onClick={() => load({ date: brief?.nextAvailableDate, historyMode: 'push' })} disabled={busy || !brief?.nextAvailableDate}>Next</Button>
          {brief?.displayedDate && brief.displayedDate !== brief?.latestAvailableDate ? <Button size="sm" onClick={() => load({ date: brief.latestAvailableDate, historyMode: 'push' })} disabled={busy}>Latest</Button> : null}
          <Button size="sm" icon={RefreshCw} onClick={() => { load({ date: brief?.displayedDate || null, force: true }); onRefreshPulse?.(); }} disabled={busy}>{busy ? 'Updating…' : 'Refresh'}</Button>
        </div>
        <div className="market-overview-context__quality">
          <span>MOPS {formatDate(pulse?.latestMopsPublicationDate)}</span>
          <StatusBadge tone={completeReports >= requiredReports ? 'positive' : 'warning'}>{completeReports}/{requiredReports} reports</StatusBadge>
          <StatusBadge tone={Number(curveCoverage.missingCount || 0) ? 'warning' : 'positive'}>{Number(curveCoverage.numericCount || 0)}/{Number(curveCoverage.requiredCount || 8)} curve marks</StatusBadge>
          {Number(curveCoverage.publishedNaCount || 0) ? <StatusBadge tone="neutral">{Number(curveCoverage.publishedNaCount)} published N/A</StatusBadge> : null}
          <StatusBadge tone={array(brief?.sourceWarnings || brief?.warnings).length ? 'warning' : 'positive'}>{array(brief?.sourceWarnings || brief?.warnings).length} data notes</StatusBadge>
        </div>
      </div>
      {brief?.fallbackApplied ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} />Reports for the requested date are not available. Showing the latest completed report: {formatDate(brief.displayedDate)}.</div> : null}
      <MarketPriceBoard pulse={pulse} />
      {intraday}

      {array(brief?.sourceWarnings || brief?.warnings).length ? <details className="market-disclosure market-disclosure--warning"><summary><AlertTriangle size={14} /> Data notes ({array(brief?.sourceWarnings || brief?.warnings).length})</summary><div className="market-history-warnings">{array(brief?.sourceWarnings || brief?.warnings).map((warning, index) => <div key={warning?.id || `${warning?.code || 'warning'}:${index}`}><AlertTriangle size={14} /><MarketSignedText>{textOf(warning)}</MarketSignedText></div>)}</div></details> : null}

      <div className="market-brief-columns">
        <BriefList title="What changed" items={materialChanges} empty="No material move crossed its controlled threshold" icon={ArrowRight} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} />
        <BriefList title="Port dislocations" items={dislocations} empty="No exact-date port dislocation is available" icon={Waves} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} />
      </div>
      <div className="market-brief-columns">
        <BriefList title="Physical versus paper" items={physicalPaper} empty="No same-snapshot confirmation or divergence is available" icon={FileSearch} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} />
        <BriefList title="Drivers & risks" items={[...projectedDrivers, ...risks]} empty="No high-confidence driver or risk is available" icon={FileSearch} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} />
      </div>
      <details className="market-disclosure">
        <summary><FileSearch size={14} /> Evidence & methodology</summary>
        <div className="market-disclosure__body">
          {sourceRefs.length ? <div className="market-source-lineage">{sourceRefs.map((sourceRef, index) => { const ref = normalizeRef(sourceRef); const pages = refPages(ref); return <span key={ref.id || ref.reportId || `${ref.reportType}:${ref.reportDate}:${index}`}>{[ref.reportType || ref.documentType || 'Market report', (ref.reportDate || brief?.asOfDate) ? formatDate(ref.reportDate || brief?.asOfDate) : null, pages.length ? `${pages.length > 1 ? 'pages' : 'page'} ${pages.join(', ')}` : null].filter(Boolean).join(' · ')}</span>; })}</div> : null}
          <p>Front-minus-back is positive in backwardation. Missing marks remain gaps. Commentary is concise, non-verbatim, source-linked, and cannot change a price or create a trading recommendation.</p>
        </div>
      </details>
    </div>
  );
}
