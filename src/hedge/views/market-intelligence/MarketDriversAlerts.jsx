import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  FileSearch,
  Info,
  LockKeyhole,
  RefreshCw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import {
  loadMarketIntelligenceAlertRules,
  loadMarketIntelligenceBrief,
  replayMarketIntelligenceArchive,
  saveMarketIntelligenceAlertRules,
} from '@/hedge/api/marketData';
import { Button, Field, InlineError, Panel, StatusBadge } from '@/hedge/components/ui';
import { formatDate } from '@/hedge/lib/domain';
import { projectBriefDriver } from './briefProjection';

const DEFAULT_RULES = {
  enabled: true,
  outrightFloorUsdMt: 10,
  spreadFloorUsdMt: 5,
  gasoilFloorUsdBbl: 1,
  curveDeadbandUsdMt: 2,
  curveDeadbandUsdBbl: 0.25,
  minimumSamples: 20,
  lookbackDays: 60,
  percentile: 0.95,
};

const DRIVER_TAGS = [
  'availability', 'inventories', 'demand', 'delivery lead time', 'barge congestion', 'weather',
  'refinery outages', 'flows / arbitrage', 'freight', 'sanctions', 'regulation', 'geopolitics',
];

function array(value) {
  return Array.isArray(value) ? value : [];
}

function textOf(value) {
  if (typeof value === 'string') return value;
  return value?.summary || value?.message || value?.text || value?.title || '';
}

function statusTone(value) {
  const normalized = String(value || '').toLowerCase();
  if (['resolved', 'complete', 'normal', 'low'].includes(normalized)) return 'positive';
  if (['critical', 'error', 'conflict', 'missing'].includes(normalized)) return 'negative';
  if (['warning', 'stale', 'high'].includes(normalized)) return 'warning';
  return 'neutral';
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

function lineageFor(driver, refs, defaultDate) {
  const topRefs = refs.map(normalizeRef);
  const embedded = array(driver?.sourceRefs || driver?.sources).map(normalizeRef);
  const ids = new Set(array(driver?.sourceRefIds).concat(driver?.sourceReportId || driver?.reportId || []).filter(Boolean));
  const hashes = new Set(array(driver?.sourceHashes).concat(driver?.sourceHash || []).filter(Boolean));
  const matched = topRefs.filter((ref) => ids.has(ref.id) || ids.has(ref.reportId) || hashes.has(ref.sourceHash));
  const enriched = embedded.length ? embedded.map((ref) => ({ ...(topRefs.find((top) => (ref.sourceHash && top.sourceHash === ref.sourceHash) || (ref.reportId && top.reportId === ref.reportId) || (ref.id && top.id === ref.id)) || {}), ...ref })) : matched;
  return enriched.map((ref) => {
    const pages = refPages(ref);
    return [ref.reportType || ref.documentType || 'Report', (ref.reportDate || defaultDate) ? formatDate(ref.reportDate || defaultDate) : null, pages.length ? `${pages.length > 1 ? 'pages' : 'page'} ${pages.join(', ')}` : null].filter(Boolean).join(' · ');
  });
}

function RuleToggle({ checked, onChange, children, disabled }) {
  return <label className="market-alert-toggle"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} disabled={disabled} /><span>{children}</span></label>;
}

export function MarketDriversAlerts({ readOnly }) {
  const [brief, setBrief] = useState(null);
  const [rulesResponse, setRulesResponse] = useState(null);
  const [draft, setDraft] = useState(DEFAULT_RULES);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState(null);
  const [archiveProgress, setArchiveProgress] = useState(null);

  const load = async ({ force = false } = {}) => {
    setBusy(true); setError(null);
    try {
      const [nextBrief, nextRules] = await Promise.all([
        loadMarketIntelligenceBrief({}, { force, cache: !force }),
        loadMarketIntelligenceAlertRules({ force, cache: !force }),
      ]);
      setBrief(nextBrief);
      setRulesResponse(nextRules);
      setDraft({ ...DEFAULT_RULES, ...(nextRules?.rules || nextRules || {}) });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  const drivers = useMemo(() => {
    const source = brief?.drivers || {};
    if (Array.isArray(source)) return source.map((item) => projectBriefDriver({ ...item, lifecycle: lifecycleOf(item) }));
    return [
      ...array(source.emerging || brief?.emergingDrivers).map((item) => projectBriefDriver({ ...item, lifecycle: 'Emerging' })),
      ...array(source.persistent || brief?.persistentDrivers).map((item) => projectBriefDriver({ ...item, lifecycle: 'Persistent' })),
      ...array(source.fading || brief?.fadingDrivers).map((item) => projectBriefDriver({ ...item, lifecycle: 'Fading' })),
    ];
  }, [brief]);
  const sourceRefs = array(brief?.sourceRefs);
  const alertEvents = array(rulesResponse?.events || brief?.alertEvents || brief?.alerts);
  const allowedTags = new Set(DRIVER_TAGS);
  const visibleDrivers = drivers.filter((item) => !item?.tag || allowedTags.has(String(item.tag).toLowerCase()));

  const setRule = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const result = await saveMarketIntelligenceAlertRules({
        rules: draft,
        expectedRevision: rulesResponse?.revision ?? 0,
        idempotencyKey: crypto.randomUUID(),
      });
      setRulesResponse((current) => ({ ...current, ...result, events: result?.events?.length ? result.events : current?.events || [] }));
      setDraft({ ...DEFAULT_RULES, ...(result?.rules || draft) });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSaving(false);
    }
  };

  const reconcileArchive = async () => {
    setArchiveBusy(true);
    setArchiveError(null);
    const canResume = archiveProgress && archiveProgress.complete !== true;
    let cursor = canResume ? Number(archiveProgress.nextCursor || 0) : 0;
    let archiveFingerprint = canResume ? archiveProgress.archiveFingerprint || null : null;
    try {
      for (;;) {
        const result = await replayMarketIntelligenceArchive({ cursor, archiveFingerprint });
        archiveFingerprint = result.archiveFingerprint;
        cursor = result.nextCursor;
        setArchiveProgress(result);
        if (result.complete) break;
      }
      await load({ force: true });
    } catch (nextError) {
      setArchiveError(nextError);
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <div className="market-intelligence-stack" data-testid="market-drivers-alerts">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
      <Panel>
        <div className="app-panel-header"><div><h2>Drivers with report lineage</h2><p>Concise non-verbatim summaries only. Numeric facts are retained only when they validate against the cited report page.</p></div><StatusBadge tone={busy ? 'neutral' : visibleDrivers.length ? 'positive' : 'warning'}>{busy ? 'Loading…' : `${visibleDrivers.length} supported drivers`}</StatusBadge></div>
        <div className="market-driver-tag-row">{DRIVER_TAGS.map((tag) => <span key={tag}>{tag}</span>)}</div>
        {visibleDrivers.length ? <div className="market-driver-evidence-grid">{visibleDrivers.map((driver, index) => <article key={driver.id || `${driver.lifecycle}:${driver.tag}:${index}`}><div><StatusBadge tone={driver.lifecycle === 'Emerging' ? 'warning' : driver.lifecycle === 'Persistent' || driver.lifecycle === 'Current' ? 'neutral' : 'positive'}>{driver.lifecycle}</StatusBadge>{driver.confidenceLabel ? <StatusBadge tone={Number(driver.confidence) >= 0.8 ? 'positive' : 'neutral'}>{driver.confidenceLabel}</StatusBadge> : null}</div><strong>{driver.tag || driver.title || driver.driverTags?.[0] || 'Bunker-market driver'}</strong><p>{textOf(driver)}</p><small>{[driver.port || driver.portKey, driver.product || driver.productKey, driver.horizon, driver.sourcePage ? `Report page ${driver.sourcePage}` : null, ...lineageFor(driver, sourceRefs, brief?.asOfDate)].filter(Boolean).join(' · ')}</small></article>)}</div> : <div className="market-empty-inline"><FileSearch size={20} /><div><strong>No supported commentary driver is available</strong><span>AI failure never delays or changes deterministic prices and signals.</span></div></div>}
      </Panel>

      <Panel>
        <div className="app-panel-header"><div><h2>In-app market alerts</h2><p>Deduplicated by report, series, rule version and severity. FCOS sends no market-alert email.</p></div><StatusBadge tone={alertEvents.some((item) => ['critical', 'error'].includes(String(item.severity).toLowerCase())) ? 'negative' : 'neutral'}>{alertEvents.length} recent</StatusBadge></div>
        {alertEvents.length ? <div className="market-alert-event-list">{alertEvents.map((event, index) => <article key={event.id || `${event.seriesKey || ''}:${event.ruleVersion || ''}:${index}`}><div className={`market-alert-event__icon market-alert-event__icon--${statusTone(event.severity || event.status)}`}><BellRing size={16} /></div><div><strong>{event.title || event.label || 'Market intelligence alert'}</strong><p>{textOf(event)}</p><small>{[event.severity, event.seriesLabel || event.seriesKey, event.reportDate, event.status].filter(Boolean).join(' · ')}</small></div></article>)}</div> : <div className="market-empty-inline"><CheckCircle2 size={20} /><div><strong>No active market alert</strong><span>Missing, stale, conflict and parsing controls remain enabled.</span></div></div>}
      </Panel>

      <Panel>
        <div className="app-panel-header"><div><h2>Company alert rules</h2><p>Numeric alerts use the larger of the configured floor or the previous 60-day 95th percentile, after at least 20 samples.</p></div>{readOnly ? <StatusBadge tone="neutral">View only</StatusBadge> : <StatusBadge tone="positive">Authorized</StatusBadge>}</div>
        <div className="market-alert-rule-grid">
          <Field label="Outright move floor (USD/MT)"><input className="app-input" type="number" min="0" step="0.01" value={draft.outrightFloorUsdMt} disabled={readOnly} onChange={(event) => setRule('outrightFloorUsdMt', Number(event.target.value))} /></Field>
          <Field label="Spread move floor (USD/MT)"><input className="app-input" type="number" min="0" step="0.01" value={draft.spreadFloorUsdMt} disabled={readOnly} onChange={(event) => setRule('spreadFloorUsdMt', Number(event.target.value))} /></Field>
          <Field label="Gasoil move floor (USD/bbl)"><input className="app-input" type="number" min="0" step="0.01" value={draft.gasoilFloorUsdBbl} disabled={readOnly} onChange={(event) => setRule('gasoilFloorUsdBbl', Number(event.target.value))} /></Field>
          <Field label="Curve deadband (USD/MT)"><input className="app-input" type="number" min="0" step="0.01" value={draft.curveDeadbandUsdMt} disabled={readOnly} onChange={(event) => setRule('curveDeadbandUsdMt', Number(event.target.value))} /></Field>
          <Field label="Gasoil deadband (USD/bbl)"><input className="app-input" type="number" min="0" step="0.01" value={draft.curveDeadbandUsdBbl} disabled={readOnly} onChange={(event) => setRule('curveDeadbandUsdBbl', Number(event.target.value))} /></Field>
          <Field label="Lookback days"><input className="app-input" type="number" min="1" step="1" value={draft.lookbackDays} disabled={readOnly} onChange={(event) => setRule('lookbackDays', Number(event.target.value))} /></Field>
          <Field label="Minimum samples"><input className="app-input" type="number" min="1" step="1" value={draft.minimumSamples} disabled={readOnly} onChange={(event) => setRule('minimumSamples', Number(event.target.value))} /></Field>
          <Field label="Adaptive percentile" hint="0.95 means the 95th percentile."><input className="app-input" type="number" min="0.5" max="1" step="0.01" value={draft.percentile} disabled={readOnly} onChange={(event) => setRule('percentile', Number(event.target.value))} /></Field>
        </div>
        <div className="market-alert-toggle-grid">
          <RuleToggle checked={draft.enabled} onChange={(value) => setRule('enabled', value)} disabled={readOnly}>Enable company-wide in-app market alerts</RuleToggle>
        </div>
        <div className="app-callout app-callout--neutral"><CheckCircle2 size={15} /> Missing, stale, conflict and parsing alerts remain deterministic fixed controls. Curve-regime flips always require two complete reports outside the configured deadband.</div>
        <div className="market-alert-rule-footer">
          <div>{readOnly ? <><LockKeyhole size={15} /> Only an authorized Markets manager may change company rules.</> : <><ShieldAlert size={15} /> Saving changes the company-wide in-app threshold policy.</>}</div>
          {!readOnly ? <Button variant="primary" icon={Save} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save alert rules'}</Button> : null}
        </div>
      </Panel>
      {!readOnly ? <Panel>
        <div className="app-panel-header"><div><h2>Licensed archive reconciliation</h2><p>Idempotently revalidates structured price evidence and deterministic briefs for the reviewed 1 January 2025 to 19 August 2026 archive. PDF bytes and report prose are never stored.</p></div><StatusBadge tone={archiveBusy ? 'warning' : archiveProgress?.complete ? 'positive' : 'neutral'}>{archiveBusy ? 'Reconciling…' : archiveProgress?.complete ? 'Complete' : 'Administrator'}</StatusBadge></div>
        {archiveError ? <InlineError error={archiveError} /> : null}
        {archiveProgress ? <div className="app-callout app-callout--neutral"><FileSearch size={15} /> {archiveProgress.nextCursor} of {archiveProgress.uniqueReportCount} unique reports reconciled · {archiveProgress.duplicateFileCount} byte duplicates retained as lineage · {archiveProgress.briefCompletedCount} deterministic dates in the latest batch.</div> : null}
        <div className="market-alert-rule-footer">
          <div><ShieldAlert size={15} /> The exact Google account, folders, 832-file Drive manifest (831 unique PDFs and one byte duplicate), and zero-conflict MOPS ledger are revalidated before every batch.</div>
          <Button variant="primary" icon={RefreshCw} onClick={reconcileArchive} disabled={archiveBusy}>{archiveBusy ? 'Reconciling archive…' : 'Reconcile licensed archive'}</Button>
        </div>
      </Panel> : null}
      <div className="app-callout app-callout--neutral"><Info size={15} /> Markets intelligence is evidence support only. It does not execute trades or produce a buy or sell recommendation.</div>
    </div>
  );
}
