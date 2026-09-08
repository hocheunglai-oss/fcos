import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  Info,
  LockKeyhole,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  analyzeMarketReportLibrary,
  loadMarketIntelligenceAlertRules,
  loadMarketIntelligenceBrief,
  loadMarketReportCatalogue,
  replayMarketIntelligenceArchive,
  saveMarketIntelligenceAlertRules,
} from '@/hedge/api/marketData';
import { Button, Field, InlineError, Panel, Select, StatusBadge } from '@/hedge/components/ui';
import { formatDate } from '@/hedge/lib/domain';
import { projectBriefDriver } from './briefProjection';
import { MarketSignedText } from '@/components/markets/MarketSignedValue';

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

function reportTypeLabel(value) {
  return value === 'bunkerwire' ? 'Bunkerwire' : value === 'european_marketscan' ? 'European Marketscan' : value;
}

function factLabel(fact) {
  if (!fact) return 'Evidence unavailable';
  const section = fact.sectionName && fact.sectionName !== fact.productName ? ` · ${fact.sectionName}` : '';
  if (fact.kind === 'series') return `${fact.productName} (${fact.sourceSymbol})${section} · deterministic period statistics`;
  return `${fact.productName} (${fact.sourceSymbol})${section} · ${formatDate(fact.date)}${fact.price == null ? ` · ${fact.state === 'published_na' ? 'Published N/A' : 'Unavailable'}` : ` · ${fact.price} ${fact.unit || 'unit unavailable'}`}`;
}

function LibraryStat({ label, value }) {
  return <span><small>{label}</small><strong>{value ?? '—'}</strong></span>;
}

function MarketReportLibraryAnalysis() {
  const [catalogueResponse, setCatalogueResponse] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [query, setQuery] = useState('');
  const [modelId, setModelId] = useState('');
  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState('');
  const [prompt, setPrompt] = useState('Compare the selected products over this period and explain the most material changes, ranges, and differences.');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(true);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadCatalogue = async ({ force = false } = {}) => {
    setBusy(true); setError(null);
    try {
      const next = await loadMarketReportCatalogue({}, { force, cache: !force });
      setCatalogueResponse(next);
      setModelId((current) => current || next?.defaults?.modelId || '');
      setStartDate((current) => current || next?.defaults?.startDate || '2025-01-01');
      setEndDate((current) => current || next?.defaults?.endDate || '');
    } catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  };
  useEffect(() => { loadCatalogue(); }, []);

  const catalogue = array(catalogueResponse?.catalogue);
  const selected = selectedKeys.map((key) => catalogue.find((row) => row.key === key)).filter(Boolean);
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = catalogue.filter((row) => !selectedKeys.includes(row.key) && (!normalized
      || row.sourceSymbol.toLowerCase().includes(normalized)
      || row.productName.toLowerCase().includes(normalized)));
    return filtered.slice(0, 80);
  }, [catalogue, query, selectedKeys]);
  const maxSelected = Number(catalogueResponse?.defaults?.maxSelectedSeries || 8);
  const toggle = (key) => setSelectedKeys((current) => current.includes(key)
    ? current.filter((value) => value !== key)
    : current.length < maxSelected ? [...current, key] : current);
  const analyze = async () => {
    setAnalysisBusy(true); setError(null); setResult(null);
    try {
      setResult(await analyzeMarketReportLibrary({ seriesKeys: selectedKeys, startDate, endDate, prompt, modelId }));
    } catch (nextError) { setError(nextError); }
    finally { setAnalysisBusy(false); }
  };
  const evidenceById = new Map(array(result?.evidence).map((fact) => [fact.id, fact]));

  return <Panel className="market-library-panel">
    <div className="app-panel-header">
      <div><h2>Licensed report price library</h2><p>Query structured product names, codes and reported prices from Bunkerwire and European Marketscan. Choose the AI model for each analysis.</p></div>
      <StatusBadge tone={catalogueResponse?.available ? 'positive' : busy ? 'neutral' : 'warning'}>{busy ? 'Loading…' : `${catalogueResponse?.coverage?.productCodeCount || 0} product codes`}</StatusBadge>
    </div>
    {error ? <InlineError error={error} action={!catalogueResponse ? <Button onClick={() => loadCatalogue({ force: true })}>Retry</Button> : null} /> : null}
    {catalogueResponse ? <>
      <div className="market-library-coverage">
        <LibraryStat label="Reports stored" value={catalogueResponse.coverage?.importedReportCount || 0} />
        <LibraryStat label="Price observations" value={(catalogueResponse.coverage?.structuredObservationCount || 0).toLocaleString()} />
        <LibraryStat label="First report" value={catalogueResponse.coverage?.earliestReportDate ? formatDate(catalogueResponse.coverage.earliestReportDate) : '—'} />
        <LibraryStat label="Latest report" value={catalogueResponse.coverage?.latestReportDate ? formatDate(catalogueResponse.coverage.latestReportDate) : '—'} />
      </div>
      {catalogueResponse.coverage?.pendingBackfillReportCount ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} /> {catalogueResponse.coverage.pendingBackfillReportCount} imported reports are awaiting structured-library backfill. Hourly reconciliation and the governed archive replay will complete them.</div> : null}
      <div className="market-library-builder">
        <div className="market-library-picker">
          <Field label={`Products (${selectedKeys.length}/${maxSelected})`} hint="Search by the product name or report code. The exact report and native unit remain separate.">
            <div className="market-library-search"><Search size={16} /><input className="app-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or code" /></div>
          </Field>
          {selected.length ? <div className="market-library-selected">{selected.map((row) => <button type="button" key={row.key} onClick={() => toggle(row.key)} aria-label={`Remove ${row.productName} ${row.sourceSymbol}`}><span><strong>{row.productName}</strong><small>{[row.sectionName, row.sourceSymbol, reportTypeLabel(row.documentType), row.unit || 'Unit unavailable'].filter(Boolean).join(' · ')}</small></span><X size={14} /></button>)}</div> : <div className="market-empty-inline market-empty-inline--compact"><FileSearch size={18} /><div><strong>No product selected</strong><span>Choose up to {maxSelected} exact report series.</span></div></div>}
          <div className="market-library-results" role="listbox" aria-label="Report product search results">{searchResults.map((row) => <button type="button" role="option" aria-selected="false" key={row.key} disabled={selectedKeys.length >= maxSelected} onClick={() => toggle(row.key)}><span><strong>{row.productName}</strong><small>{[row.sectionName, reportTypeLabel(row.documentType), row.unit || 'Unit unavailable', `${row.numericObservationCount} values`].filter(Boolean).join(' · ')}</small></span><code>{row.sourceSymbol}</code></button>)}</div>
        </div>
        <div className="market-library-question">
          <div className="app-form-grid app-form-grid--2">
            <Field label="From"><input className="app-input" type="date" min="2025-01-01" max={endDate || undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
            <Field label="To"><input className="app-input" type="date" min={startDate || '2025-01-01'} max={catalogueResponse.defaults?.endDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
          </div>
          <Field label="AI model"><Select value={modelId} onChange={(event) => setModelId(event.target.value)}>{array(catalogueResponse.models).map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? ' · Recommended' : ''} · {model.costTier}</option>)}</Select></Field>
          <Field label="Analysis question" hint="The model receives only the selected structured facts and deterministic statistics."><textarea className="app-input market-library-prompt" rows="5" maxLength="1200" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></Field>
          <Button variant="primary" icon={BrainCircuit} onClick={analyze} disabled={analysisBusy || !selectedKeys.length || !startDate || !endDate || prompt.trim().length < 3}>{analysisBusy ? 'Analyzing structured evidence…' : 'Analyze selected prices'}</Button>
          <div className="app-callout app-callout--neutral"><LockKeyhole size={15} /> PDF text, prompts and model responses are not stored. Deterministic prices stay authoritative.</div>
        </div>
      </div>
    </> : null}
    {result ? <div className="market-library-analysis">
      <div className="market-library-analysis__header"><div><strong>{result.model?.label || result.modelId}</strong><span>{formatDate(result.range?.startDate)} to {formatDate(result.range?.endDate)} · {result.coverage?.totalPoints || 0} structured points</span></div>{result.coverage?.sampledForModel ? <StatusBadge tone="warning">AI context sampled · statistics complete</StatusBadge> : <StatusBadge tone="positive">Complete AI context</StatusBadge>}</div>
      <p className="market-library-analysis__summary"><MarketSignedText>{result.analysis?.summary}</MarketSignedText></p>
      <div className="market-library-findings">{array(result.analysis?.findings).map((finding, index) => <article key={`${finding.title}:${index}`}><strong><MarketSignedText>{finding.title}</MarketSignedText></strong><p><MarketSignedText>{finding.explanation}</MarketSignedText></p><details><summary>Evidence ({finding.evidenceIds?.length || 0})</summary><ul>{array(finding.evidenceIds).map((id) => <li key={id}>{factLabel(evidenceById.get(id))}</li>)}</ul></details></article>)}</div>
      {array(result.analysis?.caveats).length ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} /><div><strong>Analysis limits</strong><ul>{result.analysis.caveats.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul></div></div> : null}
      <details className="market-disclosure"><summary><Info size={14} /> Deterministic statistics and coverage</summary><div className="market-library-series-stats">{array(result.deterministicSeries).map((series) => <article key={series.key}><strong>{series.productName} <code>{series.sourceSymbol}</code></strong><small>{[series.sectionName, reportTypeLabel(series.documentType), series.unit || 'Unit unavailable'].filter(Boolean).join(' · ')}</small><div><LibraryStat label="Latest" value={series.stats?.latestPrice ?? '—'} /><LibraryStat label="Average" value={series.stats?.average ?? '—'} /><LibraryStat label="Low" value={series.stats?.low ?? '—'} /><LibraryStat label="High" value={series.stats?.high ?? '—'} /><LibraryStat label="Numeric dates" value={series.stats?.numericDateCount || 0} /><LibraryStat label="N/A dates" value={series.stats?.publishedNaDateCount || 0} /></div></article>)}</div></details>
    </div> : null}
  </Panel>;
}

export function MarketDriversAlerts({ active = true, readOnly, mode = 'content', asOfDate = null, refreshKey = 0 }) {
  const [brief, setBrief] = useState(null);
  const [rulesResponse, setRulesResponse] = useState(null);
  const [draft, setDraft] = useState(DEFAULT_RULES);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState(null);
  const [archiveProgress, setArchiveProgress] = useState(null);
  const requestRef = useRef(0);

  const load = async ({ force = false, signal } = {}) => {
    const requestId = ++requestRef.current;
    setBusy(true); setError(null);
    try {
      const [nextBrief, nextRules] = await Promise.all([
        loadMarketIntelligenceBrief(asOfDate ? { date: asOfDate } : {}, { force, cache: !force, signal }),
        loadMarketIntelligenceAlertRules({ force, cache: !force, signal }),
      ]);
      if (requestId !== requestRef.current) return;
      setBrief(nextBrief);
      setRulesResponse(nextRules);
      setDraft({ ...DEFAULT_RULES, ...(nextRules?.rules || nextRules || {}) });
    } catch (nextError) {
      if (requestId === requestRef.current && nextError?.name !== 'AbortError') setError(nextError);
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setBrief(null);
    load({ signal: controller.signal, force: refreshKey > 0 });
    return () => { requestRef.current += 1; controller.abort(); };
  }, [active, asOfDate, refreshKey]);

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

  if (mode === 'admin') return <div className="market-intelligence-stack" data-testid="market-alert-admin-tools">
    {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
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
      <div className="market-alert-toggle-grid"><RuleToggle checked={draft.enabled} onChange={(value) => setRule('enabled', value)} disabled={readOnly}>Enable company-wide in-app market alerts</RuleToggle></div>
      <div className="app-callout app-callout--neutral"><CheckCircle2 size={15} /> Missing, stale, conflict and parsing alerts remain deterministic fixed controls. Curve-regime flips always require two complete reports outside the configured deadband.</div>
      <div className="market-alert-rule-footer"><div>{readOnly ? <><LockKeyhole size={15} /> Only an authorized Markets manager may change company rules.</> : <><ShieldAlert size={15} /> Saving changes the company-wide in-app threshold policy.</>}</div>{!readOnly ? <Button variant="primary" icon={Save} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save alert rules'}</Button> : null}</div>
    </Panel>
    {!readOnly ? <Panel>
      <div className="app-panel-header"><div><h2>Licensed archive reconciliation</h2><p>Idempotently revalidates structured price evidence and deterministic briefs. PDF bytes and report prose are never stored.</p></div><StatusBadge tone={archiveBusy ? 'warning' : archiveProgress?.complete ? 'positive' : 'neutral'}>{archiveBusy ? 'Reconciling…' : archiveProgress?.complete ? 'Complete' : 'Administrator'}</StatusBadge></div>
      {archiveError ? <InlineError error={archiveError} /> : null}
      {archiveProgress ? <div className="app-callout app-callout--neutral"><FileSearch size={15} /> {archiveProgress.nextCursor} of {archiveProgress.uniqueReportCount} unique reports reconciled · {archiveProgress.duplicateFileCount} byte duplicates retained as lineage · {archiveProgress.briefCompletedCount} deterministic dates in the latest batch.</div> : null}
      <div className="market-alert-rule-footer"><div><ShieldAlert size={15} /> The pinned Drive manifest, report hashes, and zero-conflict ledger are revalidated before every batch.</div><Button variant="primary" icon={RefreshCw} onClick={reconcileArchive} disabled={archiveBusy}>{archiveBusy ? 'Reconciling archive…' : 'Reconcile licensed archive'}</Button></div>
    </Panel> : null}
  </div>;

  return (
    <div className="market-intelligence-stack" data-testid="market-drivers-alerts">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
      <MarketReportLibraryAnalysis />
      <Panel>
        <div className="app-panel-header"><div><h2>Drivers with report lineage</h2><p>Concise non-verbatim summaries only. Numeric facts are retained only when they validate against the cited report page.</p></div><StatusBadge tone={busy ? 'neutral' : visibleDrivers.length ? 'positive' : 'warning'}>{busy ? 'Loading…' : `${visibleDrivers.length} supported drivers`}</StatusBadge></div>
        <div className="market-driver-tag-row">{DRIVER_TAGS.map((tag) => <span key={tag}>{tag}</span>)}</div>
        {visibleDrivers.length ? <div className="market-driver-evidence-grid">{visibleDrivers.map((driver, index) => <article key={driver.id || `${driver.lifecycle}:${driver.tag}:${index}`}><div><StatusBadge tone={driver.lifecycle === 'Emerging' ? 'warning' : driver.lifecycle === 'Persistent' || driver.lifecycle === 'Current' ? 'neutral' : 'positive'}>{driver.lifecycle}</StatusBadge>{driver.confidenceLabel ? <StatusBadge tone={Number(driver.confidence) >= 0.8 ? 'positive' : 'neutral'}>{driver.confidenceLabel}</StatusBadge> : null}</div><strong>{driver.tag || driver.title || driver.driverTags?.[0] || 'Bunker-market driver'}</strong><p><MarketSignedText>{textOf(driver)}</MarketSignedText></p><small>{[driver.port || driver.portKey, driver.product || driver.productKey, driver.horizon, driver.sourcePage ? `Report page ${driver.sourcePage}` : null, ...lineageFor(driver, sourceRefs, brief?.asOfDate)].filter(Boolean).join(' · ')}</small></article>)}</div> : <div className="market-empty-inline"><FileSearch size={20} /><div><strong>No supported commentary driver is available</strong><span>AI failure never delays or changes deterministic prices and signals.</span></div></div>}
      </Panel>

      <Panel>
        <div className="app-panel-header"><div><h2>In-app market alerts</h2><p>Deduplicated by report, series, rule version and severity. FCOS sends no market-alert email.</p></div><StatusBadge tone={alertEvents.some((item) => ['critical', 'error'].includes(String(item.severity).toLowerCase())) ? 'negative' : 'neutral'}>{alertEvents.length} recent</StatusBadge></div>
        {alertEvents.length ? <div className="market-alert-event-list">{alertEvents.map((event, index) => <article key={event.id || `${event.seriesKey || ''}:${event.ruleVersion || ''}:${index}`}><div className={`market-alert-event__icon market-alert-event__icon--${statusTone(event.severity || event.status)}`}><BellRing size={16} /></div><div><strong><MarketSignedText>{event.title || event.label || 'Market intelligence alert'}</MarketSignedText></strong><p><MarketSignedText>{textOf(event)}</MarketSignedText></p><small>{[event.severity, event.seriesLabel || event.seriesKey, event.reportDate, event.status].filter(Boolean).join(' · ')}</small></div></article>)}</div> : <div className="market-empty-inline"><CheckCircle2 size={20} /><div><strong>No active market alert</strong><span>Missing, stale, conflict and parsing controls remain enabled.</span></div></div>}
      </Panel>

      <div className="app-callout app-callout--neutral"><Info size={15} /> Markets intelligence is evidence support only. It does not execute trades or produce a buy or sell recommendation.</div>
    </div>
  );
}
