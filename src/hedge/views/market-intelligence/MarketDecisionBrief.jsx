import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  FileSearch,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { loadMarketIntelligenceBrief } from '@/hedge/api/marketData';
import { formatDate } from '@/hedge/lib/domain';
import { Button, InlineError, Panel, StatusBadge } from '@/hedge/components/ui';
import { MarketSignedText } from '@/components/markets/MarketSignedValue';
import { MarketPriceBoard } from '@/components/markets/MarketPriceBoard';
import { MarketBookContext } from '@/components/markets/MarketBookContext';
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

function selectWhatMatters(groups, limit = 3) {
  const remaining = groups.map((group) => ({ ...group, items: [...group.items] }));
  const selected = [];
  while (selected.length < limit && remaining.some((group) => group.items.length)) {
    for (const group of remaining) {
      const item = group.items.shift();
      if (item) selected.push({ ...group, item });
      if (selected.length === limit) break;
    }
  }
  return selected;
}

function WhatMatters({ items, sourceRefs, sourceDate, onNavigateMarketView }) {
  return <Panel className="market-what-matters">
    <div className="app-panel-header"><div><h2>What matters</h2><p>Key moves and source-backed developments for this report date.</p></div>{items.length ? <StatusBadge tone="neutral">{items.length} developments</StatusBadge> : null}</div>
    {items.length ? <ol className="market-what-matters__list">{items.map(({ item, category, view, viewLabel }, index) => {
      const DirectionIcon = directionIcon(item?.direction);
      return <li key={item?.id || `${category}:${item?.sourceReportId || ''}:${item?.sourcePage || ''}:${index}`}>
        <span className="market-what-matters__rank">{index + 1}</span>
        <DirectionIcon size={18} aria-hidden="true" />
        <div>
          <span className="market-what-matters__category">{category}</span>
          <strong><MarketSignedText>{item?.title || item?.label || textOf(item)}</MarketSignedText></strong>
          {item?.title || item?.label ? <p><MarketSignedText>{textOf(item)}</MarketSignedText></p> : null}
          <div className="market-brief-item__meta">
            {item?.metricBasis ? <span><MarketSignedText>{item.metricBasis}</MarketSignedText></span> : null}
            {item?.sourcePage ? <span>Report page {item.sourcePage}</span> : null}
            {lineageFor(item, sourceRefs, sourceDate).map((lineage) => <span key={lineage}>{lineage}</span>)}
          </div>
          {onNavigateMarketView ? <button type="button" onClick={() => onNavigateMarketView(view)}>Open {viewLabel}</button> : null}
        </div>
      </li>;
    })}</ol> : <div className="market-empty-inline market-empty-inline--compact"><FileSearch size={20} /><div><strong>No threshold development is available</strong><span>No value is inferred from missing report evidence.</span></div></div>}
  </Panel>;
}

function BriefDetail({ title, count, children }) {
  return <details className="market-brief-detail">
    <summary><span><strong>{title}</strong><small>Source-linked deterministic detail</small></span><StatusBadge tone="neutral">{count}</StatusBadge></summary>
    <div>{children}</div>
  </details>;
}

export function MarketDecisionBrief({ initialBrief = null, refreshKey = 0, pulse = null, pulseLoading = false, pulseError = null, intraday = null, requestedDate = null, dateMode = 'latest', onBriefResolved = null, onBriefError = null, bookContext = null, bookLoading = false, bookError = null, onRetryBook = null, canReadBook = false, onNavigateMarketView = null }) {
  const [brief, setBrief] = useState(initialBrief);
  const [busy, setBusy] = useState(!initialBrief);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const refreshKeyRef = useRef(refreshKey);
  const requestRef = useRef(0);

  const load = useCallback(async ({ force = false, date = null, signal } = {}) => {
    const requestId = ++requestRef.current;
    setBusy(true);
    setError(null);
    try {
      const nextBrief = await loadMarketIntelligenceBrief(date ? { date } : {}, { force, cache: !force, signal });
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setBrief(nextBrief);
      onBriefResolved?.(nextBrief, { mode: dateMode, requestedDate: date, force });
    } catch (nextError) {
      if (mountedRef.current && requestId === requestRef.current && nextError?.name !== 'AbortError') {
        setError(nextError);
        onBriefError?.(nextError);
      }
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setBusy(false);
    }
  }, [dateMode, onBriefError, onBriefResolved]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    load({ date: dateMode === 'historical' ? requestedDate : null, signal: controller.signal });
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      controller.abort();
    };
  }, [dateMode, load, requestedDate]);

  useEffect(() => {
    // This lightweight controller resolves the shared date even on another tab.
    if (refreshKeyRef.current === refreshKey) return;
    refreshKeyRef.current = refreshKey;
    load({ date: dateMode === 'historical' ? requestedDate : null, force: true });
  }, [dateMode, load, refreshKey, requestedDate]);

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
  const driverRisks = [...projectedDrivers, ...risks];
  const whatMatters = selectWhatMatters([
    { category: 'Published price move', view: 'curves', viewLabel: 'forward curves', items: materialChanges },
    { category: 'Physical market', view: 'delivered', viewLabel: 'delivered prices', items: dislocations },
    { category: 'Physical versus paper', view: 'curves', viewLabel: 'forward curves', items: physicalPaper },
    { category: 'Driver or risk', view: 'drivers', viewLabel: 'research & alerts', items: driverRisks },
  ]);
  return (
    <div className="market-intelligence-stack" data-testid="market-daily-decision-brief">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ date: dateMode === 'historical' ? requestedDate : null, force: true })}>Retry</Button>} /> : null}
      {brief?.fallbackApplied ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} />{dateMode === 'historical' ? 'Reports for the requested date are not available.' : 'Today’s report pair is not available.'} Showing the latest completed report: {formatDate(brief.displayedDate)}.</div> : null}
      {pulseLoading ? <Panel className="market-price-board-panel"><div className="market-empty-inline"><RefreshCw className="animate-spin" size={20} /><div><strong>Loading market price board</strong><span>Resolving the exact completed report-date snapshot.</span></div></div></Panel> : pulseError ? <InlineError error={pulseError} /> : pulse ? <MarketPriceBoard pulse={{ ...pulse, mode: dateMode }} /> : <Panel className="market-price-board-panel"><div className="market-empty-inline"><RefreshCw size={20} /><div><strong>Market price board unavailable</strong><span>No date-scoped snapshot is available for this report date.</span></div></div></Panel>}
      <WhatMatters items={whatMatters} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} onNavigateMarketView={onNavigateMarketView} />
      {canReadBook ? <MarketBookContext context={bookContext} loading={bookLoading} error={bookError} onRetry={onRetryBook} historical={dateMode === 'historical'} /> : null}
      {intraday}

      {array(brief?.sourceWarnings || brief?.warnings).length ? <details className="market-disclosure market-disclosure--warning"><summary><AlertTriangle size={14} /> Data notes ({array(brief?.sourceWarnings || brief?.warnings).length})</summary><div className="market-history-warnings">{array(brief?.sourceWarnings || brief?.warnings).map((warning, index) => <div key={warning?.id || `${warning?.code || 'warning'}:${index}`}><AlertTriangle size={14} /><MarketSignedText>{textOf(warning)}</MarketSignedText></div>)}</div></details> : null}

      <div className="market-brief-detail-grid">
        <BriefDetail title="Published price moves" count={materialChanges.length}><BriefList title="What changed" items={materialChanges} empty="No material move crossed its controlled threshold" icon={ArrowRight} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} /></BriefDetail>
        <BriefDetail title="Delivered-port evidence" count={dislocations.length}><BriefList title="Port dislocations" items={dislocations} empty="No exact-date port dislocation is available" icon={Waves} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} /></BriefDetail>
        <BriefDetail title="Physical and paper evidence" count={physicalPaper.length}><BriefList title="Physical versus paper" items={physicalPaper} empty="No same-snapshot confirmation or divergence is available" icon={FileSearch} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} /></BriefDetail>
        <BriefDetail title="Drivers and risks" count={driverRisks.length}><BriefList title="Drivers & risks" items={driverRisks} empty="No high-confidence driver or risk is available" icon={FileSearch} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} limit={3} /></BriefDetail>
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
