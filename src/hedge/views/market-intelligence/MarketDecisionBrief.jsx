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

export function MarketDecisionBrief({ initialBrief = null, refreshKey = 0, pulse = null, pulseLoading = false, pulseError = null, intraday = null, requestedDate = null, dateMode = 'latest', onBriefResolved = null, onBriefError = null }) {
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
  return (
    <div className="market-intelligence-stack" data-testid="market-daily-decision-brief">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ date: dateMode === 'historical' ? requestedDate : null, force: true })}>Retry</Button>} /> : null}
      {brief?.fallbackApplied ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} />Reports for the requested date are not available. Showing the latest completed report: {formatDate(brief.displayedDate)}.</div> : null}
      {pulseLoading ? <Panel className="market-price-board-panel"><div className="market-empty-inline"><RefreshCw className="animate-spin" size={20} /><div><strong>Loading market price board</strong><span>Resolving the exact completed report-date snapshot.</span></div></div></Panel> : pulseError ? <InlineError error={pulseError} /> : pulse ? <MarketPriceBoard pulse={{ ...pulse, mode: dateMode }} /> : <Panel className="market-price-board-panel"><div className="market-empty-inline"><RefreshCw size={20} /><div><strong>Market price board unavailable</strong><span>No date-scoped snapshot is available for this report date.</span></div></div></Panel>}
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
