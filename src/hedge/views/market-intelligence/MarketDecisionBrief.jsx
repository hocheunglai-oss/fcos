import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSearch,
  RefreshCw,
  ShieldAlert,
  Waves,
} from 'lucide-react';
import { loadMarketIntelligenceBrief } from '@/hedge/api/marketData';
import { formatDate } from '@/hedge/lib/domain';
import { Button, InlineError, Metric, Panel, StatusBadge } from '@/hedge/components/ui';
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

function toneFor(value) {
  const normalized = String(value || '').toLowerCase();
  if (['complete', 'confirmed', 'positive', 'available', 'backwardation'].includes(normalized)) return 'positive';
  if (['missing', 'conflict', 'negative', 'unavailable', 'error'].includes(normalized)) return 'negative';
  if (['partial', 'stale', 'warning', 'mixed', 'divergence', 'contango'].includes(normalized)) return 'warning';
  return 'neutral';
}

function directionIcon(direction) {
  const normalized = String(direction || '').toLowerCase();
  if (['up', 'higher', 'bullish', 'tightening', 'positive'].includes(normalized)) return ArrowUpRight;
  if (['down', 'lower', 'bearish', 'easing', 'negative'].includes(normalized)) return ArrowDownRight;
  return ArrowRight;
}

function regimeLabel(row) {
  if (!row) return 'Unavailable';
  if (row.regime || row.label || row.headlineSlope) return row.regime || row.label || row.headlineSlope;
  const summary = typeof row.summary === 'string' ? row.summary : row.summary?.regime;
  const named = /backwardation|contango|mixed|flat/i.exec(summary || '')?.[0];
  if (named) return named[0].toUpperCase() + named.slice(1).toLowerCase();
  if (Number.isFinite(Number(row.bmM1)) && Number.isFinite(Number(row.m1M2))) {
    if (Number(row.bmM1) > 0 && Number(row.m1M2) > 0) return 'Backwardation';
    if (Number(row.bmM1) < 0 && Number(row.m1M2) < 0) return 'Contango';
    return 'Mixed';
  }
  return summary ? 'Available' : 'Unavailable';
}

function lifecycleOf(driver) {
  const value = String(driver?.lifecycle || driver?.state || driver?.persistence || '').toLowerCase();
  if (value === 'emerging') return 'Emerging';
  if (value === 'persistent') return 'Persistent';
  if (value === 'fading') return 'Fading';
  return 'Current';
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

function BriefList({ title, items, empty, icon: Icon = FileSearch, sourceRefs = [], sourceDate = null }) {
  return (
    <Panel className="market-brief-list">
      <div className="app-panel-header"><div><h2>{title}</h2></div></div>
      {items.length ? <div className="market-brief-items">{items.map((item, index) => {
        const DirectionIcon = directionIcon(item?.direction);
        const key = item?.id || `${title}:${item?.sourceReportId || ''}:${item?.sourcePage || ''}:${index}`;
        return (
          <article key={key} className="market-brief-item">
            <DirectionIcon size={17} aria-hidden="true" />
            <div>
              <strong>{item?.title || item?.label || textOf(item)}</strong>
              {item?.title || item?.label ? <p>{textOf(item)}</p> : null}
              <div className="market-brief-item__meta">
                {item?.product || item?.productKey ? <span>{PRODUCT_LABELS[item.product || item.productKey] || item.product || item.productKey}</span> : null}
                {item?.port || item?.portKey ? <span>{item.port || item.portKey}</span> : null}
                {item?.horizon ? <span>{item.horizon}</span> : null}
                {item?.confidenceLabel ? <span>{item.confidenceLabel}</span> : null}
                {item?.metricBasis ? <span>{item.metricBasis}</span> : null}
                {item?.sourcePage ? <span>Report page {item.sourcePage}</span> : null}
                {lineageFor(item, sourceRefs, sourceDate).map((lineage) => <span key={lineage}>{lineage}</span>)}
              </div>
            </div>
          </article>
        );
      })}</div> : <div className="market-empty-inline"><Icon size={20} /><div><strong>{empty}</strong><span>No value is inferred from missing report evidence.</span></div></div>}
    </Panel>
  );
}

function DriverColumn({ label, drivers, tone, sourceRefs, sourceDate }) {
  return (
    <div className={`market-driver-column market-driver-column--${tone}`}>
      <div className="market-driver-column__title"><span>{label}</span><strong>{drivers.length}</strong></div>
      {drivers.length ? drivers.map((driver, index) => {
        const Icon = directionIcon(driver?.direction);
        return <div key={driver?.id || `${label}:${index}`} className="market-driver-row"><Icon size={15} /><div><strong>{driver?.tag || driver?.title || driver?.driverTags?.[0] || 'Market driver'}</strong><span>{textOf(driver)}</span><small>{[driver?.port || driver?.portKey, PRODUCT_LABELS[driver?.product || driver?.productKey] || driver?.product || driver?.productKey, driver?.horizon, driver?.confidenceLabel, ...lineageFor(driver, sourceRefs, sourceDate)].filter(Boolean).join(' · ')}</small></div></div>;
      }) : <p>No source-supported driver in this state.</p>}
    </div>
  );
}

export function MarketDecisionBrief({ initialBrief = null, refreshKey = 0 }) {
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
  const regimes = useMemo(() => {
    if (Array.isArray(brief?.curveRegimes)) return brief.curveRegimes;
    return Object.entries(brief?.curveRegimes || brief?.regimes || {}).map(([product, value]) => ({ product, ...(typeof value === 'object' ? value : { regime: value }) }));
  }, [brief]);
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
  const emerging = projectedDrivers.filter((driver) => lifecycleOf(driver) === 'Emerging');
  const persistent = projectedDrivers.filter((driver) => lifecycleOf(driver) === 'Persistent');
  const fading = projectedDrivers.filter((driver) => lifecycleOf(driver) === 'Fading');
  const current = projectedDrivers.filter((driver) => lifecycleOf(driver) === 'Current');
  const risks = array(brief?.risks || brief?.risksToWatch);
  const requiredReports = Number(completeness.requiredReports ?? completeness.required ?? 2);
  const completeReports = Number(completeness.completeReports ?? (completeness.complete === true ? requiredReports : array(completeness.reportTypes).length));
  const completenessLabel = completeness.label || (completeReports >= requiredReports ? 'Complete' : completeReports ? 'Partial' : 'Unavailable');

  return (
    <div className="market-intelligence-stack" data-testid="market-daily-decision-brief">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
      <div className="market-brief-topbar">
        <div><strong>Daily Decision Brief</strong><span>Deterministic prices and signals, with concise source-linked commentary. No buy or sell recommendation.</span></div>
        <div className="market-brief-topbar__actions">
          <Button size="sm" icon={ChevronLeft} onClick={() => load({ date: brief?.previousAvailableDate, historyMode: 'push' })} disabled={busy || !brief?.previousAvailableDate}>Previous</Button>
          <div className="market-brief-date">
            <span>Displaying report date</span>
            <strong>{brief?.displayedDate ? formatDate(brief.displayedDate) : 'Unavailable'}</strong>
            <StatusBadge tone={brief?.displayedDate && brief.displayedDate === brief?.latestAvailableDate ? 'positive' : 'neutral'}>{brief?.displayedDate && brief.displayedDate === brief?.latestAvailableDate ? 'Latest available' : 'Historical'}</StatusBadge>
          </div>
          <Button size="sm" icon={ChevronRight} onClick={() => load({ date: brief?.nextAvailableDate, historyMode: 'push' })} disabled={busy || !brief?.nextAvailableDate}>Next</Button>
          {brief?.displayedDate && brief.displayedDate !== brief?.latestAvailableDate ? <Button size="sm" onClick={() => load({ date: brief.latestAvailableDate, historyMode: 'push' })} disabled={busy}>Latest</Button> : null}
          <Button size="sm" icon={RefreshCw} onClick={() => load({ date: brief?.displayedDate || null, force: true })} disabled={busy}>{busy ? 'Updating…' : 'Refresh brief'}</Button>
        </div>
      </div>
      {brief?.fallbackApplied ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} />Reports for the requested date are not available. Showing the latest completed report: {formatDate(brief.displayedDate)}.</div> : null}
      <div className="app-metric-grid app-metric-grid--4">
        <Metric label="Report completeness" value={completenessLabel} detail={`${completeReports}/${requiredReports} required reports`} tone={completeReports >= requiredReports ? 'green' : 'orange'} icon={completeReports >= requiredReports ? CheckCircle2 : AlertTriangle} />
        <Metric label="As of" value={brief?.asOfDate ? formatDate(brief.asOfDate) : 'Unavailable'} detail={brief?.asOfAt ? new Date(brief.asOfAt).toLocaleString('en-GB', { timeZone: 'Asia/Hong_Kong', hour12: false }) : brief?.asOfTime || brief?.assessmentSession || 'Assessment time not available'} tone="blue" icon={Clock3} />
        <Metric label="Curve coverage" value={`${Number(curveCoverage.numericCount || 0)}/${Number(curveCoverage.requiredCount || 8)} numeric marks`} detail={`${Number(curveCoverage.publishedNaCount || 0)} published N/A · ${Number(curveCoverage.missingCount || 0)} genuinely missing`} tone={Number(curveCoverage.missingCount || 0) ? 'orange' : 'green'} icon={Waves} />
        <Metric label="Source risks" value={String(array(brief?.sourceWarnings || brief?.warnings).length)} detail="Missing, stale, conflict or parsing controls" tone={array(brief?.sourceWarnings || brief?.warnings).length ? 'orange' : 'green'} icon={ShieldAlert} />
      </div>

      {array(brief?.sourceWarnings || brief?.warnings).length ? <div className="market-history-warnings">{array(brief?.sourceWarnings || brief?.warnings).map((warning, index) => <div key={warning?.id || `${warning?.code || 'warning'}:${index}`}><AlertTriangle size={14} /><span>{textOf(warning)}</span></div>)}</div> : null}

      <Panel>
        <div className="app-panel-header"><div><h2>Curve regime</h2><p>Front-minus-back is positive in backwardation. A gap remains a gap when an exact tenor is missing.</p></div><StatusBadge tone={toneFor(completenessLabel)}>{completenessLabel}</StatusBadge></div>
        <div className="market-regime-grid">{['hsfo380', 'vlsfo', 'lsmgo'].map((product) => {
          const row = regimes.find((entry) => { const entryProduct = entry.product || entry.productKey; return ['hsfo380', 'hsfo', 's380'].includes(product) ? ['hsfo380', 'hsfo', 's380'].includes(entryProduct) : product === 'vlsfo' ? ['vlsfo', 's05'].includes(entryProduct) : ['lsmgo', 'sgo'].includes(entryProduct); });
          const regime = regimeLabel(row);
          const summary = typeof row?.summary === 'string' ? row.summary : row?.summary?.text;
          return <div key={product} className="market-regime-card"><span>{PRODUCT_LABELS[product]}</span><strong>{regime}</strong><small>{summary || [row?.bmM1 != null ? `BM–M1 ${row.bmM1}` : null, row?.m1M2 != null ? `M1–M2 ${row.m1M2}` : null].filter(Boolean).join(' · ') || 'Exact curve marks are incomplete.'}</small><StatusBadge tone={toneFor(regime)}>{row?.basis || 'Report derived'}</StatusBadge></div>;
        })}</div>
      </Panel>

      <div className="market-brief-columns">
        <BriefList title="Material daily changes" items={materialChanges} empty="No material move crossed its controlled threshold" icon={ArrowRight} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />
        <BriefList title="Port dislocations" items={dislocations} empty="No exact-date port dislocation is available" icon={Waves} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />
      </div>
      <BriefList title="Physical versus paper" items={physicalPaper} empty="No same-snapshot confirmation or divergence is available" icon={FileSearch} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />

      <Panel>
        <div className="app-panel-header"><div><h2>Bunker-market drivers</h2><p>Only source-supported availability, inventory, demand, lead-time, congestion, weather, refinery, flow, freight, sanctions, regulation and geopolitical drivers are retained.</p></div></div>
        <div className="market-driver-grid">
          <DriverColumn label="Emerging" drivers={emerging} tone="emerging" sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />
          <DriverColumn label="Persistent" drivers={persistent} tone="persistent" sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />
          <DriverColumn label="Fading" drivers={fading} tone="fading" sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />
          {current.length ? <DriverColumn label="Current" drivers={current} tone="persistent" sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} /> : null}
        </div>
      </Panel>
      <BriefList title="Key risks to watch" items={risks} empty="No high-confidence risk item is available" icon={ShieldAlert} sourceRefs={sourceRefs} sourceDate={brief?.asOfDate} />
      {sourceRefs.length ? <Panel><div className="app-panel-header"><div><h2>Source lineage</h2><p>Report references support the derived brief without storing licensed report text.</p></div></div><div className="market-source-lineage">{sourceRefs.map((sourceRef, index) => { const ref = normalizeRef(sourceRef); const pages = refPages(ref); return <span key={ref.id || ref.reportId || `${ref.reportType}:${ref.reportDate}:${index}`}>{[ref.reportType || ref.documentType || 'Market report', (ref.reportDate || brief?.asOfDate) ? formatDate(ref.reportDate || brief?.asOfDate) : null, pages.length ? `${pages.length > 1 ? 'pages' : 'page'} ${pages.join(', ')}` : null].filter(Boolean).join(' · ')}</span>; })}</div></Panel> : null}
      <div className="app-callout app-callout--neutral"><FileSearch size={15} /> Commentary is a concise, non-verbatim aid with report and page lineage. It cannot change a price, fill a missing tenor, or create a trading recommendation.</div>
    </div>
  );
}
