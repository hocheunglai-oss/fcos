import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Clock3,
  GitCompareArrows,
  History,
  LoaderCircle,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import './MarketTraderWorkspace.css';

const MAX_PINS = 20;
const MAX_COMPARISONS = 10;
const MAX_SUBSCRIPTIONS = 20;
const EMPTY_PREFERENCES = Object.freeze({ pins: [], comparisons: [], subscriptions: [] });

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function operationId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function number(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function digitsFor(unit) {
  return String(unit || '').toUpperCase() === 'USD/BBL' ? 3 : 2;
}

function formatNumber(value, unit, { signed = false } = {}) {
  const parsed = number(value);
  if (parsed == null) return 'Unavailable';
  const digits = digitsFor(unit);
  const formatted = Math.abs(parsed).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = signed && parsed !== 0 ? (parsed > 0 ? '+' : '−') : (parsed < 0 ? '−' : '');
  return `${sign}${formatted}${unit ? ` ${unit}` : ''}`;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const raw = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function seriesMeta(series) {
  return [series?.portKey, series?.productKey, series?.contractMonth, series?.sourceSymbol]
    .filter(Boolean)
    .join(' · ');
}

function words(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceTypeLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'assessment') return 'Assessed price';
  if (normalized === 'posted') return 'Posted price';
  if (normalized === 'proxy') return 'Proxy price';
  if (normalized === 'estimate') return 'Estimated price';
  if (normalized === 'unavailable') return 'Price type unavailable';
  return value ? `Source classification: ${words(value)}` : 'Price type unavailable';
}

function sessionLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'asia_moc') return 'Asia MOC';
  if (normalized === 'london_moc') return 'London MOC';
  if (normalized === 'london_1630') return 'London 16:30';
  if (normalized === 'ice_settlement') return 'ICE settlement';
  if (normalized === 'london_settlement') return 'London settlement';
  if (normalized === 'daily_assessment') return 'Daily assessment';
  if (normalized === 'posted') return 'Posted session';
  return value ? words(value) : 'Session unavailable';
}

function evidenceLabel(series, { symbols } = {}) {
  const evidence = [
    sourceTypeLabel(series?.sourceType),
    sessionLabel(series?.session),
    series?.latest?.source,
    symbols || series?.sourceSymbol || series?.latest?.sourceSymbol,
    series?.latest?.sourcePage ? `p.${series.latest.sourcePage}` : null,
  ].filter(Boolean);
  return [...new Set(evidence)].join(' · ');
}

function marketTabForSeries(series) {
  return series?.contractMonth || series?.family === 'forward' ? 'curves' : 'delivered';
}

function marketHistoryHref({ tab, date } = {}) {
  const params = new URLSearchParams();
  params.set('tab', tab === 'curves' ? 'curves' : 'delivered');
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    params.set('marketBriefMode', 'historical');
    params.set('marketBriefDate', String(date));
  }
  return `/markets?${params.toString()}`;
}

function HistoryLink({ tab, date, label = 'View history' }) {
  return <a className="market-trader__history-link" href={marketHistoryHref({ tab, date })}><History aria-hidden="true" />{label}</a>;
}

function responseError(response) {
  const outer = response?.data;
  const body = outer?.data ?? outer;
  const error = outer?.error || body?.error;
  if (!error) return null;
  const issue = new Error(typeof error === 'string' ? error : error.message || 'The workspace request failed.');
  issue.code = outer?.code || body?.code || error?.code || null;
  issue.status = outer?.status || body?.status || error?.status || null;
  return issue;
}

function unwrapResponse(response) {
  const error = responseError(response);
  if (error) throw error;
  const body = response?.data?.data ?? response?.data;
  if (!body || typeof body !== 'object') throw new Error('The personal Markets workspace returned no data.');
  return body;
}

function isRevisionConflict(error) {
  const marker = `${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return marker.includes('409') || marker.includes('revision_conflict') || marker.includes('revision conflict') || marker.includes('stale revision');
}

function preferencesOf(workspace) {
  return {
    pins: rows(workspace?.preferences?.pins),
    comparisons: rows(workspace?.preferences?.comparisons),
    subscriptions: rows(workspace?.preferences?.subscriptions),
  };
}

function workspaceByRevision(current, next) {
  if (!current) return next;
  const currentRevision = number(current.revision);
  const nextRevision = number(next?.revision);
  if (currentRevision != null && (nextRevision == null || nextRevision < currentRevision)) return current;
  return next;
}

function toneFor(value) {
  const parsed = number(value);
  return parsed == null || parsed === 0 ? 'neutral' : parsed > 0 ? 'up' : 'down';
}

function recentTrendPoints(series) {
  const points = rows(series?.points);
  const latestDate = series?.latest?.date || points.at(-1)?.date;
  const latestTime = Date.parse(`${String(latestDate || '').slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(latestTime)) return points.slice(-30);
  const cutoff = latestTime - 29 * 24 * 60 * 60 * 1000;
  return points.filter((point) => {
    const pointTime = Date.parse(`${String(point?.date || '').slice(0, 10)}T00:00:00.000Z`);
    return Number.isFinite(pointTime) && pointTime >= cutoff && pointTime <= latestTime;
  });
}

function Sparkline({ points, low, high, label, className = '' }) {
  const usable = rows(points)
    .map((point) => ({ ...point, value: number(point?.value) }))
    .filter((point) => point.value != null);
  if (usable.length < 2) return <div className="market-trader__chart-empty">Trend unavailable</div>;
  const floor = number(low) ?? Math.min(...usable.map((point) => point.value));
  const ceiling = number(high) ?? Math.max(...usable.map((point) => point.value));
  const span = ceiling - floor || 1;
  const coordinates = usable.map((point, index) => {
    const x = usable.length === 1 ? 50 : (index / (usable.length - 1)) * 100;
    const y = 30 - ((point.value - floor) / span) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg className={`market-trader__sparkline ${className}`} viewBox="0 0 100 32" role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" y1="30" x2="100" y2="30" />
      <polyline points={coordinates} />
    </svg>
  );
}

function Feedback({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`market-trader__feedback market-trader__feedback--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function EmptyMessage({ icon: Icon, title, children }) {
  return <div className="market-trader__empty"><Icon aria-hidden="true" /><strong>{title}</strong><p>{children}</p></div>;
}

function SeriesPicker({ id, label, value, onChange, series, excludeKey, disabled }) {
  return (
    <label className="market-trader__field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Select a series</option>
        {rows(series).filter((item) => item.key !== excludeKey).map((item) => (
          <option key={item.key} value={item.key}>{item.label} · {seriesMeta(item) || item.unit || 'Market series'}</option>
        ))}
      </select>
    </label>
  );
}

function PinManager({ series, selected, busy, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => [...selected]);
  const [query, setQuery] = useState('');
  const [port, setPort] = useState('all');
  const [product, setProduct] = useState('all');
  const [month, setMonth] = useState('all');
  const options = useMemo(() => {
    const available = rows(series);
    const availableKeys = new Set(available.map((item) => item.key));
    const unavailable = rows(selected)
      .filter((key) => !availableKeys.has(key))
      .map((key) => ({ key, label: 'Unavailable series', unavailable: true }));
    return [...available, ...unavailable];
  }, [selected, series]);
  const filters = useMemo(() => ({
    ports: [...new Set(rows(series).map((item) => item.portKey).filter(Boolean))].sort(),
    products: [...new Set(rows(series).map((item) => item.productKey).filter(Boolean))].sort(),
    months: [...new Set(rows(series).map((item) => item.contractMonth).filter(Boolean))].sort(),
  }), [series]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter((item) => {
      if (port !== 'all' && item.portKey !== port) return false;
      if (product !== 'all' && item.productKey !== product) return false;
      if (month !== 'all' && item.contractMonth !== month) return false;
      if (!needle) return true;
      return [item.label, item.portKey, item.productKey, item.contractMonth, item.sourceSymbol]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [month, options, port, product, query]);
  const toggle = (key) => setDraft((current) => current.includes(key)
    ? current.filter((item) => item !== key)
    : current.length < MAX_PINS ? [...current, key] : current);
  return (
    <div className="market-trader__manager" role="group" aria-labelledby="market-trader-pin-manager-title">
      <div className="market-trader__manager-heading">
        <div><h4 id="market-trader-pin-manager-title">Manage pinned series</h4><p>{draft.length} of {MAX_PINS} selected</p></div>
        <button type="button" className="market-trader__icon-button" onClick={onCancel} aria-label="Close pinned series manager"><X /></button>
      </div>
      <div className="market-trader__picker-tools">
        <label className="market-trader__search"><Search aria-hidden="true" /><span className="sr-only">Search market series</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search port, product, month or symbol" /></label>
        <label><span>Port</span><select aria-label="Filter series by port" value={port} onChange={(event) => setPort(event.target.value)}><option value="all">All ports</option>{filters.ports.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Product</span><select aria-label="Filter series by product" value={product} onChange={(event) => setProduct(event.target.value)}><option value="all">All products</option>{filters.products.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Month</span><select aria-label="Filter series by contract month" value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">All months</option>{filters.months.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="market-trader__series-options">
        {visible.map((item) => {
          const checked = draft.includes(item.key);
          const blocked = !checked && draft.length >= MAX_PINS;
          return <label key={item.key} className={`${checked ? 'is-selected' : ''} ${item.unavailable ? 'is-unavailable' : ''}`}>
            <input type="checkbox" checked={checked} disabled={blocked || busy} onChange={() => toggle(item.key)} />
            <span><strong>{item.label}</strong><small>{item.unavailable ? 'Saved pin is no longer in the current market catalogue. Unselect it to remove.' : seriesMeta(item) || item.unit || 'Market series'}</small></span>
            {checked ? <Check aria-hidden="true" /> : null}
          </label>;
        })}
        {!visible.length ? <p className="market-trader__no-results">No series match these filters.</p> : null}
      </div>
      <div className="market-trader__manager-actions">
        <button type="button" className="market-trader__button market-trader__button--quiet" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="market-trader__button market-trader__button--primary" onClick={() => onSave(draft)} disabled={busy}>{busy ? <LoaderCircle className="is-spinning" /> : <Pin />}Save pins</button>
      </div>
    </div>
  );
}

function PinnedSeries({ series }) {
  const points = recentTrendPoints(series);
  const tone = toneFor(series?.change);
  return (
    <article className="market-trader__pin-card">
      <div className="market-trader__pin-copy">
        <div><h4>{series?.label || 'Unnamed series'}</h4><p>{seriesMeta(series) || 'Series details unavailable'}</p></div>
        <div className="market-trader__pin-value"><strong>{formatNumber(series?.latest?.value, series?.unit)}</strong><span>{formatDate(series?.latest?.date)}</span></div>
      </div>
      <Sparkline points={points} label={`${series?.label || 'Market'} 30-day trend`} className={`is-${tone}`} />
      <p className="market-trader__pin-evidence">{evidenceLabel(series)}</p>
      <div className="market-trader__pin-footer">
        <span className={`market-trader__change is-${tone}`}>{tone === 'up' ? <TrendingUp /> : tone === 'down' ? <TrendingDown /> : null}{formatNumber(series?.change, series?.unit, { signed: true })}</span>
        <span>{points.length ? `${points.length} publication date${points.length === 1 ? '' : 's'}` : 'No trend points'}</span>
        {series?.latest ? <HistoryLink tab={marketTabForSeries(series)} /> : null}
      </div>
    </article>
  );
}

function ComparisonCard({ comparison, series, busy, onRename, onRemove }) {
  const [label, setLabel] = useState(comparison?.label || 'Saved comparison');
  useEffect(() => setLabel(comparison?.label || 'Saved comparison'), [comparison?.label]);
  const changed = label.trim() && label.trim() !== comparison?.label;
  const leftSeries = series.find((item) => item.key === comparison?.leftKey);
  const rightSeries = series.find((item) => item.key === comparison?.rightKey);
  const leftLabel = leftSeries?.label || 'Unavailable series';
  const rightLabel = rightSeries?.label || 'Unavailable series';
  const comparisonSymbols = [leftSeries?.sourceSymbol, rightSeries?.sourceSymbol].filter(Boolean).join(' / ');
  const historyTab = marketTabForSeries(leftSeries) === 'curves' || marketTabForSeries(rightSeries) === 'curves' ? 'curves' : 'delivered';
  return (
    <article className="market-trader__comparison-card">
      <div className="market-trader__comparison-heading">
        <label><span className="sr-only">Comparison label</span><input aria-label={`Edit label for ${comparison?.label || 'saved comparison'}`} value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} /></label>
        <div>
          {changed ? <button type="button" className="market-trader__text-button" onClick={() => onRename(comparison.id, label.trim())} disabled={busy}>Save label</button> : null}
          <button type="button" className="market-trader__icon-button is-danger" onClick={() => onRemove(comparison.id)} disabled={busy} aria-label={`Remove ${comparison?.label || 'saved comparison'}`}><Trash2 /></button>
        </div>
      </div>
      <p className="market-trader__comparison-pair">{leftLabel} <GitCompareArrows aria-hidden="true" /> {rightLabel}</p>
      <p className="market-trader__comparison-evidence">{evidenceLabel(leftSeries || rightSeries, { symbols: comparisonSymbols || null })}</p>
      {!comparison?.available ? <Feedback kind="warning">{comparison?.reason || 'This comparison is currently unavailable.'}</Feedback> : <>
        <div className="market-trader__comparison-current"><span>Latest spread</span><strong>{formatNumber(comparison?.latest?.value, comparison?.unit, { signed: true })}</strong><small>{formatDate(comparison?.latest?.date)}</small></div>
        <Sparkline points={comparison?.points} low={comparison?.range?.low} high={comparison?.range?.high} label={`${comparison?.label || 'Saved comparison'} spread history`} className={`is-${toneFor(comparison?.latest?.value)}`} />
        <dl className="market-trader__range">
          <div><dt>Low</dt><dd>{formatNumber(comparison?.range?.low, comparison?.unit, { signed: true })}</dd></div>
          <div><dt>Average</dt><dd>{formatNumber(comparison?.range?.average, comparison?.unit, { signed: true })}</dd></div>
          <div><dt>High</dt><dd>{formatNumber(comparison?.range?.high, comparison?.unit, { signed: true })}</dd></div>
          <div><dt>Samples</dt><dd>{number(comparison?.range?.samples) ?? 'Unavailable'}</dd></div>
        </dl>
        <HistoryLink tab={historyTab} date={comparison?.latest?.date} />
      </>}
    </article>
  );
}

function ComparisonCreator({ series, busy, onCancel, onCreate }) {
  const [leftKey, setLeftKey] = useState('');
  const [rightKey, setRightKey] = useState('');
  const [label, setLabel] = useState('');
  const submit = (event) => {
    event.preventDefault();
    if (!leftKey || !rightKey || leftKey === rightKey) return;
    const left = series.find((item) => item.key === leftKey);
    const right = series.find((item) => item.key === rightKey);
    onCreate({ id: operationId('comparison'), label: label.trim() || `${left?.label || leftKey} vs ${right?.label || rightKey}`, leftKey, rightKey });
  };
  return (
    <form className="market-trader__editor" onSubmit={submit}>
      <div className="market-trader__editor-grid">
        <SeriesPicker id="market-trader-comparison-left" label="First series" value={leftKey} onChange={setLeftKey} series={series} excludeKey={rightKey} disabled={busy} />
        <SeriesPicker id="market-trader-comparison-right" label="Second series" value={rightKey} onChange={setRightKey} series={series} excludeKey={leftKey} disabled={busy} />
        <label className="market-trader__field" htmlFor="market-trader-comparison-label"><span>Label</span><input id="market-trader-comparison-label" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="Optional comparison name" disabled={busy} /></label>
      </div>
      <div className="market-trader__editor-actions"><button type="button" className="market-trader__button market-trader__button--quiet" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="market-trader__button market-trader__button--primary" disabled={busy || !leftKey || !rightKey}>{busy ? <LoaderCircle className="is-spinning" /> : <Plus />}Save comparison</button></div>
    </form>
  );
}

function ChangesFeed({ changes, previousVisitAt, series, comparisons }) {
  if (!previousVisitAt) return <EmptyMessage icon={Clock3} title="This is your first recorded visit">Future visits will show new assessments, source corrections and saved spread moves published since now.</EmptyMessage>;
  if (!rows(changes).length) return <EmptyMessage icon={Check} title="Nothing new since your last visit">No new assessment, source correction or saved spread move after {formatDateTime(previousVisitAt)}.</EmptyMessage>;
  return <div className="market-trader__feed">{rows(changes).map((change, index) => {
    const correction = change.kind === 'source_correction';
    const spreadMove = change.kind === 'spread_move';
    const sourceSeries = rows(series).find((item) => item.key === change.key);
    const comparisonId = change.comparisonId || (String(change.key || '').startsWith('comparison:') ? String(change.key).slice('comparison:'.length) : change.key);
    const comparison = spreadMove ? rows(comparisons).find((item) => item.id === comparisonId) : null;
    const leftSeries = comparison ? rows(series).find((item) => item.key === comparison.leftKey) : null;
    const rightSeries = comparison ? rows(series).find((item) => item.key === comparison.rightKey) : null;
    const historySeries = sourceSeries || leftSeries || rightSeries;
    const historyTab = marketTabForSeries(leftSeries) === 'curves' || marketTabForSeries(rightSeries) === 'curves'
      ? 'curves'
      : marketTabForSeries(historySeries);
    const evidenceSeries = sourceSeries || leftSeries || rightSeries;
    const evidence = [
      sourceTypeLabel(evidenceSeries?.sourceType),
      sessionLabel(evidenceSeries?.session),
      change.sourceSymbol || evidenceSeries?.sourceSymbol,
      change.sourcePage ? `page ${change.sourcePage}` : 'page unavailable',
    ].filter(Boolean).join(' · ');
    return <article key={`${change.key || change.sourceSymbol || 'change'}:${change.date || index}`}>
      <div className={`market-trader__feed-icon ${correction ? 'is-correction' : ''}`}>{correction ? <RefreshCw /> : spreadMove ? <GitCompareArrows /> : <TrendingUp />}</div>
      <div className="market-trader__feed-body">
        <div><span className="market-trader__eyebrow">{correction ? 'Source correction' : spreadMove ? 'Spread move' : 'New assessment'}</span><h4>{change.label || change.key || 'Market series'}</h4></div>
        <div className="market-trader__feed-value"><strong>{formatNumber(change.value, change.unit)}</strong><span className={`market-trader__change is-${toneFor(change.change)}`}>{formatNumber(change.change, change.unit, { signed: true })}</span></div>
        <p>{formatDate(change.date)}{correction ? ` · previously ${formatNumber(change.previousValue, change.unit)}` : ''}</p>
        <p className="market-trader__evidence"><span>Evidence</span>{evidence}</p>
        <HistoryLink tab={historyTab} date={change.date} label="View history for this date" />
      </div>
    </article>;
  })}</div>;
}

function SubscriptionEditor({ series, busy, onCancel, onSave, initial }) {
  const [seriesKey, setSeriesKey] = useState(initial?.seriesKey || '');
  const [threshold, setThreshold] = useState(initial?.threshold ?? '');
  const [direction, setDirection] = useState(initial?.direction || 'either');
  const selectedSeries = series.find((item) => item.key === seriesKey);
  const submit = (event) => {
    event.preventDefault();
    const parsed = number(threshold);
    if (!seriesKey || parsed == null || parsed <= 0) return;
    onSave({ id: initial?.id || operationId('subscription'), seriesKey, threshold: parsed, direction });
  };
  return (
    <form className="market-trader__editor" onSubmit={submit}>
      <div className="market-trader__editor-grid">
        <SeriesPicker id={`market-trader-alert-series-${initial?.id || 'new'}`} label="Series" value={seriesKey} onChange={setSeriesKey} series={series} disabled={busy} />
        <label className="market-trader__field"><span>Threshold {selectedSeries?.unit ? `(${selectedSeries.unit})` : ''}</span><input aria-label="Alert threshold" type="number" min="0.000001" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} disabled={busy} /></label>
        <label className="market-trader__field"><span>Direction</span><select aria-label="Alert direction" value={direction} onChange={(event) => setDirection(event.target.value)} disabled={busy}><option value="either">Either direction</option><option value="up">Up only</option><option value="down">Down only</option></select></label>
      </div>
      <p className="market-trader__helper">Thresholds use the selected series’ native unit. These alerts appear inside FCOS.</p>
      <div className="market-trader__editor-actions"><button type="button" className="market-trader__button market-trader__button--quiet" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="market-trader__button market-trader__button--primary" disabled={busy || !seriesKey || number(threshold) == null || number(threshold) <= 0}>{busy ? <LoaderCircle className="is-spinning" /> : <Bell />}Save alert</button></div>
    </form>
  );
}

function AlertEvent({ alert, busy, onAcknowledge, onSnooze }) {
  return <article className={`market-trader__alert-event ${alert?.acknowledged ? 'is-acknowledged' : ''}`}>
    <div className="market-trader__alert-icon"><Bell aria-hidden="true" /></div>
    <div className="market-trader__alert-copy"><h4>{alert?.label || alert?.seriesKey || 'Market alert'}</h4><p><strong>{formatNumber(alert?.change, alert?.unit, { signed: true })}</strong> · {formatDate(alert?.date)}</p><small>{alert?.sourceSymbol || 'Source symbol unavailable'}{alert?.sourcePage ? ` · p.${alert.sourcePage}` : ''}{alert?.snoozedUntil ? ` · snoozed until ${formatDateTime(alert.snoozedUntil)}` : ''}</small></div>
    <div className="market-trader__alert-actions">
      <button type="button" className="market-trader__button market-trader__button--quiet" onClick={() => onAcknowledge(alert)} disabled={busy || alert?.acknowledged}>{alert?.acknowledged ? <Check /> : null}{alert?.acknowledged ? 'Acknowledged' : 'Acknowledge'}</button>
      <label><span className="sr-only">Snooze {alert?.label || 'alert'}</span><select aria-label={`Snooze ${alert?.label || 'alert'}`} defaultValue="" onChange={(event) => { if (event.target.value) onSnooze(alert, Number(event.target.value)); event.target.value = ''; }} disabled={busy}><option value="">Snooze…</option><option value="1">1 hour</option><option value="8">8 hours</option><option value="24">24 hours</option></select><ChevronDown aria-hidden="true" /></label>
    </div>
  </article>;
}

export function MarketTraderWorkspace({ historical = false, refreshKey = 0 }) {
  const visitIdRef = useRef(operationId('market-visit'));
  const visitAttemptedRef = useRef(false);
  const requestRef = useRef(0);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(!historical);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState('');
  const [pinManagerOpen, setPinManagerOpen] = useState(false);
  const [comparisonCreatorOpen, setComparisonCreatorOpen] = useState(false);
  const [alertEditor, setAlertEditor] = useState(null);
  const applyWorkspace = useCallback((next) => setWorkspace((current) => workspaceByRevision(current, next)), []);

  const readWorkspace = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++requestRef.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await appClient.functions.invoke('marketTraderWorkspace', { visitId: visitIdRef.current }, { cache: false });
      const next = unwrapResponse(response);
      if (requestId !== requestRef.current) return next;
      applyWorkspace(next);
      return next;
    } catch (nextError) {
      if (requestId === requestRef.current) setError(nextError?.message || 'The personal Markets workspace could not be loaded.');
      throw nextError;
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [applyWorkspace]);

  useEffect(() => {
    if (historical) {
      requestRef.current += 1;
      setLoading(false);
      setError('');
      return undefined;
    }
    let active = true;
    readWorkspace().then(async (initial) => {
      if (!active || visitAttemptedRef.current) return;
      visitAttemptedRef.current = true;
      setBusy('visit');
      try {
        const response = await appClient.functions.invoke('marketTraderWorkspaceSave', {
          action: 'visit',
          visitId: visitIdRef.current,
          expectedRevision: initial.revision,
        }, { cache: false });
        const updated = unwrapResponse(response);
        if (active) applyWorkspace(updated);
      } catch (nextError) {
        if (!active) return;
        if (isRevisionConflict(nextError)) {
          setFeedback('Your Markets workspace changed in another session. The latest version has been reloaded.');
          readWorkspace({ quiet: true }).catch(() => {});
        } else {
          setError(nextError?.message || 'Your visit could not be recorded. Your market data is still available.');
        }
      } finally {
        setBusy((current) => current === 'visit' ? '' : current);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [applyWorkspace, historical, readWorkspace, refreshKey]);

  const mutate = useCallback(async (payload, successMessage) => {
    if (!workspace || busy) return null;
    setBusy(payload.action || 'save');
    setError('');
    setFeedback('');
    try {
      const response = await appClient.functions.invoke('marketTraderWorkspaceSave', {
        ...payload,
        expectedRevision: workspace.revision,
        visitId: visitIdRef.current,
      }, { cache: false });
      const next = unwrapResponse(response);
      applyWorkspace(next);
      setFeedback(successMessage);
      return next;
    } catch (nextError) {
      if (isRevisionConflict(nextError)) {
        setFeedback('Your Markets workspace changed in another session. The latest version has been reloaded; review it before saving again.');
        await readWorkspace({ quiet: true }).catch(() => {});
      } else {
        setError(nextError?.message || 'The change could not be saved.');
      }
      return null;
    } finally {
      setBusy('');
    }
  }, [applyWorkspace, busy, readWorkspace, workspace]);

  const savePreferences = useCallback((nextPreferences, message) => mutate({ action: 'preferences', preferences: nextPreferences }, message), [mutate]);
  const preferences = preferencesOf(workspace);
  const allSeries = rows(workspace?.series);
  const pinned = rows(workspace?.pinned);
  const comparisons = rows(workspace?.comparisons);
  const subscriptions = preferences.subscriptions;
  const subscriptionSeries = useMemo(() => new Map(allSeries.map((item) => [item.key, item])), [allSeries]);

  const updateComparison = async (id, patch, message) => {
    const next = preferences.comparisons.map((item) => item.id === id ? { ...item, ...patch } : item);
    return savePreferences({ ...preferences, comparisons: next }, message);
  };
  const saveSubscription = async (subscription) => {
    const exists = subscriptions.some((item) => item.id === subscription.id);
    const next = exists ? subscriptions.map((item) => item.id === subscription.id ? subscription : item) : [...subscriptions, subscription];
    const saved = await savePreferences({ ...preferences, subscriptions: next }, exists ? 'Alert subscription updated.' : 'Alert subscription added.');
    if (saved) setAlertEditor(null);
  };

  if (historical) {
    return <section className="market-trader market-trader--historical" aria-labelledby="market-trader-title"><div className="market-trader__historical-icon"><Clock3 /></div><div><h2 id="market-trader-title">My Markets is latest-only</h2><p>Pins, visit changes and personal alerts use the current published market record. Return to Latest to view or manage this workspace.</p></div></section>;
  }

  if (loading && !workspace) {
    return <section className="market-trader market-trader--loading" aria-labelledby="market-trader-title" aria-busy="true"><LoaderCircle className="is-spinning" /><div><h2 id="market-trader-title">Loading My Markets</h2><p>Preparing your pins, comparisons and in-app alerts.</p></div></section>;
  }

  if (!workspace) {
    return <section className="market-trader market-trader--load-error" aria-labelledby="market-trader-title"><AlertTriangle /><div><h2 id="market-trader-title">My Markets is unavailable</h2><p role="alert">{error || 'The personal workspace could not be loaded.'}</p><button type="button" className="market-trader__button market-trader__button--primary" onClick={() => readWorkspace().catch(() => {})}><RefreshCw />Retry</button></div></section>;
  }

  return (
    <section className="market-trader" aria-labelledby="market-trader-title" aria-busy={Boolean(busy)}>
      <header className="market-trader__header">
        <div><span className="market-trader__eyebrow">Personal workspace</span><h2 id="market-trader-title">My Markets</h2><p>Your saved market view, based on published source series. Personal alerts appear inside FCOS.</p></div>
        <div className="market-trader__header-meta"><span>Updated {formatDateTime(workspace.generatedAt)}</span><button type="button" className="market-trader__icon-button" onClick={() => readWorkspace({ quiet: true }).catch(() => {})} disabled={loading || Boolean(busy)} aria-label="Refresh My Markets"><RefreshCw className={loading ? 'is-spinning' : ''} /></button></div>
      </header>

      <div className="market-trader__messages" aria-live="polite">
        {feedback ? <Feedback kind="success">{feedback}</Feedback> : null}
        {error ? <Feedback kind="error">{error} Your existing Markets content remains available.</Feedback> : null}
        {rows(workspace.warnings).map((warning, index) => <Feedback kind="warning" key={`${warning}:${index}`}><AlertTriangle />{warning}</Feedback>)}
      </div>

      <div className="market-trader__section-heading"><div><h3><Pin />Pinned markets</h3><p>Quick prices and the 30-day price trend for the series you follow.</p></div><button type="button" className="market-trader__button market-trader__button--quiet" onClick={() => setPinManagerOpen((open) => !open)} disabled={Boolean(busy)}><Settings2 />{pinManagerOpen ? 'Close manager' : 'Manage pins'}</button></div>
      {pinManagerOpen ? <PinManager series={allSeries} selected={preferences.pins} busy={Boolean(busy)} onCancel={() => setPinManagerOpen(false)} onSave={async (pins) => { const saved = await savePreferences({ ...preferences, pins }, 'Pinned markets saved.'); if (saved) setPinManagerOpen(false); }} /> : null}
      {pinned.length ? <div className="market-trader__pins">{pinned.map((series) => <PinnedSeries key={series.key} series={series} />)}</div> : <EmptyMessage icon={Pin} title="No pinned markets">Choose up to {MAX_PINS} port, product and contract-month series for your compact view.</EmptyMessage>}

      <div className="market-trader__section-heading"><div><h3><GitCompareArrows />Saved comparisons</h3><p>Left minus right on matching publication dates, shown in their shared unit.</p></div><button type="button" className="market-trader__button market-trader__button--quiet" onClick={() => setComparisonCreatorOpen((open) => !open)} disabled={Boolean(busy) || comparisons.length >= MAX_COMPARISONS}><Plus />Add comparison</button></div>
      {comparisonCreatorOpen ? <ComparisonCreator series={allSeries} busy={Boolean(busy)} onCancel={() => setComparisonCreatorOpen(false)} onCreate={async (comparison) => { const saved = await savePreferences({ ...preferences, comparisons: [...preferences.comparisons, comparison] }, 'Comparison saved.'); if (saved) setComparisonCreatorOpen(false); }} /> : null}
      {comparisons.length ? <div className="market-trader__comparisons">{comparisons.map((comparison) => <ComparisonCard key={comparison.id} comparison={comparison} series={allSeries} busy={Boolean(busy)} onRename={(id, label) => updateComparison(id, { label }, 'Comparison label saved.')} onRemove={(id) => savePreferences({ ...preferences, comparisons: preferences.comparisons.filter((item) => item.id !== id) }, 'Comparison removed.')} />)}</div> : <EmptyMessage icon={GitCompareArrows} title="No saved comparisons">Save up to {MAX_COMPARISONS} pairs to follow their values on matching publication dates.</EmptyMessage>}

      <div className="market-trader__section-heading"><div><h3><Clock3 />Since your last visit</h3><p>{workspace.previousVisitAt ? `Changes after ${formatDateTime(workspace.previousVisitAt)}.` : 'Your first visit establishes the baseline for this feed.'}</p></div></div>
      <ChangesFeed changes={workspace.changes} previousVisitAt={workspace.previousVisitAt} series={allSeries} comparisons={comparisons} />

      <div className="market-trader__section-heading"><div><h3><Bell />Personal alerts</h3><p>Thresholds use each series’ native unit. Delivery is in-app only.</p></div><button type="button" className="market-trader__button market-trader__button--quiet" onClick={() => setAlertEditor(alertEditor ? null : { mode: 'new' })} disabled={Boolean(busy) || subscriptions.length >= MAX_SUBSCRIPTIONS}><Plus />Add alert</button></div>
      {alertEditor ? <SubscriptionEditor key={alertEditor.subscription?.id || 'new'} initial={alertEditor.subscription} series={allSeries} busy={Boolean(busy)} onCancel={() => setAlertEditor(null)} onSave={saveSubscription} /> : null}
      {subscriptions.length ? <div className="market-trader__subscriptions">{subscriptions.map((subscription) => {
        const series = subscriptionSeries.get(subscription.seriesKey);
        return <article key={subscription.id}><div><strong>{series?.label || subscription.seriesKey || 'Unavailable series'}</strong><span>{subscription.direction === 'up' ? 'Up' : subscription.direction === 'down' ? 'Down' : 'Either direction'} by {formatNumber(subscription.threshold, series?.unit)}</span></div><div><button type="button" className="market-trader__text-button" onClick={() => setAlertEditor({ mode: 'edit', subscription })} disabled={Boolean(busy)}>Edit</button><button type="button" className="market-trader__icon-button is-danger" onClick={() => savePreferences({ ...preferences, subscriptions: subscriptions.filter((item) => item.id !== subscription.id) }, 'Alert subscription removed.')} disabled={Boolean(busy)} aria-label={`Remove alert for ${series?.label || subscription.seriesKey}`}><Trash2 /></button></div></article>;
      })}</div> : <EmptyMessage icon={BellOff} title="No personal alerts">Add up to {MAX_SUBSCRIPTIONS} in-app thresholds for the market series you watch.</EmptyMessage>}

      {rows(workspace.alerts).length ? <div className="market-trader__alert-events" aria-label="Triggered personal alerts"><h4>Triggered alerts</h4>{rows(workspace.alerts).map((alert, index) => <AlertEvent key={alert.id || `${alert.eventKey}:${index}`} alert={alert} busy={Boolean(busy)} onAcknowledge={(item) => mutate({ action: 'acknowledge', subscriptionId: item.id, eventKey: item.eventKey }, 'Alert acknowledged.')} onSnooze={(item, hours) => mutate({ action: 'snooze', subscriptionId: item.id, eventKey: item.eventKey, hours }, `Alert snoozed for ${hours} hour${hours === 1 ? '' : 's'}.`)} />)}</div> : null}
    </section>
  );
}

export default MarketTraderWorkspace;
