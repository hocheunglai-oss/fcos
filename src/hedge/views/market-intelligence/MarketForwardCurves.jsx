import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock3,
  LineChart as LineChartIcon,
  Plus,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  loadMarketIntelligenceCurve,
  saveMarketForwardFallback,
  saveMarketIntelligenceCurveCutover,
} from '@/hedge/api/marketData';
import { formatDate, formatMoney } from '@/hedge/lib/domain';
import { marketSymbolLabel } from '@/hedge/lib/marketLabels';
import { Button, Drawer, Field, InlineError, Panel, Select, StatusBadge } from '@/hedge/components/ui';
import { MarketSignedAxisTick, MarketSignedText, MarketSignedValue } from '@/components/markets/MarketSignedValue';

const PRODUCTS = [
  { value: 'hsfo380', label: 'HSFO 380', short: 'HSFO', color: '#d97706', unit: 'USD/MT' },
  { value: 'vlsfo', label: 'S0.5%', short: 'S0.5%', color: '#2563eb', unit: 'USD/MT' },
  { value: 'lsmgo', label: 'LSMGO', short: 'LSMGO', color: '#0f766e', unit: 'USD/BBL' },
];
const RANGES = ['1w', '1m', '3m', '6m', '1y'];
const EMPTY_FALLBACK = { product: 'hsfo380', contractMonth: '', unit: 'USD/MT', asOfDate: '', outrightPrice: '', sourceNote: '', reason: '' };
const CURVE_FILTERS_KEY = 'fcos:markets:curves:v1';

function storedCurveFilters() {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.sessionStorage.getItem(CURVE_FILTERS_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return value || '—';
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' }).format(new Date(`${value}-01T00:00:00+08:00`));
}

function productFor(value) {
  const normalized = String(value || '').toLowerCase();
  if (['s380', 'hsfo', 'hsfo380'].includes(normalized)) return 'hsfo380';
  if (['s05', 'vlsfo'].includes(normalized)) return 'vlsfo';
  if (['sgo', 'gasoil', 'lsmgo'].includes(normalized)) return 'lsmgo';
  return normalized;
}

function formatPrice(value, unit = 'USD/MT') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${formatMoney(Number(value), { digits: unit === 'USD/BBL' ? 3 : 2 })} ${unit}`;
}

function CurveMovement({ value, unit }) {
  return <MarketSignedValue value={value} unit={unit} unavailableLabel="No prior move" variant="pill" />;
}

function normalizeSnapshot(payload) {
  const source = array(payload?.snapshot || payload?.curveSnapshot || payload?.outrights);
  return source.map((row, index) => {
    const product = productFor(row.product || row.productKey);
    const rawSource = typeof row.source === 'string' ? row.source : row.source?.type || row.source?.label;
    const rawBasis = row.basis || row.sourceBasis || row.source_basis || row.settlementBasis;
    const rawStatus = row.status || row.qualityStatus || row.quality_status;
    const isFallback = [rawSource, rawBasis, rawStatus].some((value) => /fallback|manual/i.test(String(value || '')));
    const reportDate = row.reportDate || row.report_date || row.asOfDate || row.as_of_date || payload?.asOfDate;
    return {
      id: row.id || `${row.product || row.productKey}:${row.contractMonth || row.contract_month}:${index}`,
      product,
      contractMonth: String(row.contractMonth || row.contract_month || '').slice(0, 7),
      tenor: row.tenor,
      value: row.value ?? row.price ?? row.outright,
      unit: String(row.unit || (product === 'lsmgo' ? 'USD/BBL' : 'USD/MT')).toUpperCase(),
      basis: isFallback ? 'authorized_fallback' : rawBasis || 'verified_report',
      asOfDate: reportDate,
      isPriorReport: Boolean(reportDate && payload?.asOfDate && reportDate !== payload.asOfDate),
      source: isFallback ? 'Manual fallback' : rawSource || 'Verified report',
      sourceSymbol: row.sourceSymbol || row.source_symbol,
      status: row.value == null && row.price == null && row.outright == null ? 'unavailable' : isFallback ? 'authorized_fallback' : rawStatus || 'verified',
      dailyChange: row.dailyChange ?? row.dayChange ?? row.daily_change,
      expiresAt: row.expiresOn || row.expires_on || row.expiresAt || row.expires_at,
    };
  }).sort((left, right) => String(left.contractMonth || '').localeCompare(String(right.contractMonth || '')) || PRODUCTS.findIndex((item) => item.value === left.product) - PRODUCTS.findIndex((item) => item.value === right.product));
}

function normalizeStructure(payload) {
  const rows = array(payload?.history || payload?.structureHistory || payload?.structures);
  if (rows.some((row) => Array.isArray(row?.points))) {
    return rows.flatMap((series) => array(series.points).map((point) => ({
      date: point.date,
      key: series.key || series.seriesKey,
      label: series.label,
      value: point.value,
      unit: series.unit,
      product: productFor(series.product || series.productKey || point.product || point.productKey),
    })));
  }
  return rows.flatMap((row) => {
    if (row.seriesKey || row.key) return [{ date: row.date, key: row.seriesKey || row.key, label: row.label, value: row.value, unit: row.unit, product: productFor(row.product || row.productKey) }];
    if (row.bmM1 != null || row.m1M2 != null || row.headlineSlope != null) return [
      { date: row.date, key: `${row.productKey || row.product}:bm-m1`, label: 'BM–M1', value: row.bmM1, unit: row.unit, product: productFor(row.product || row.productKey) },
      { date: row.date, key: `${row.productKey || row.product}:m1-m2`, label: 'M1–M2', value: row.m1M2, unit: row.unit, product: productFor(row.product || row.productKey) },
    ].filter((point) => point.value != null);
    return Object.entries(row.values || {}).map(([key, value]) => ({ date: row.date, key, label: key, value, unit: row.unit, product: productFor(row.product || row.productKey) }));
  });
}

function normalizeContextHistory(payload) {
  const contextNames = { eastWest: 'East-West', gasoilEfs: 'Gasoil EFS', iceBrent: 'ICE Brent', iceLsgo: 'ICE LSGO' };
  const contextRows = Object.entries(payload?.contexts || {}).flatMap(([family, value]) => array(value).map((row) => ({ ...row, contextFamily: family, label: row.label || contextNames[family] || family })));
  const rows = [...array(payload?.contextHistory || payload?.contextSeries || payload?.crossMarketHistory), ...contextRows];
  if (rows.some((row) => Array.isArray(row?.points))) {
    return rows.flatMap((series) => array(series.points).map((point) => ({
      date: point.date,
      key: [series.contextFamily, series.settlementBasis, series.tenor, series.contractMonth, series.sourceSymbol, series.key || series.seriesKey].filter(Boolean).join(':'),
      label: [series.label || series.contextFamily || series.key, series.tenor ? String(series.tenor).toUpperCase() : null, series.contractMonth ? monthLabel(String(series.contractMonth).slice(0, 7)) : null].filter(Boolean).join(' · '),
      value: point.value,
      unit: String(series.unit || point.unit || 'USD/MT').toUpperCase(),
    })));
  }
  return rows.map((row) => ({
    date: row.date,
    key: [row.contextFamily, row.settlementBasis, row.tenor, row.contractMonth, row.sourceSymbol, row.seriesKey || row.key || row.type].filter(Boolean).join(':'),
    label: [row.label || row.contextFamily || row.seriesKey || row.key || row.type, row.tenor ? String(row.tenor).toUpperCase() : null, row.contractMonth ? monthLabel(String(row.contractMonth).slice(0, 7)) : null].filter(Boolean).join(' · '),
    value: row.value,
    unit: String(row.unit || 'USD/MT').toUpperCase(),
  }));
}

function inferProduct(point) {
  if (PRODUCTS.some((product) => product.value === point.product)) return point.product;
  const key = String(point.key || '').toLowerCase();
  if (/hsfo|s380|380/.test(key)) return 'hsfo380';
  if (/vlsfo|s05|0\.5/.test(key)) return 'vlsfo';
  if (/lsmgo|sgo|gasoil/.test(key)) return 'lsmgo';
  return String(point.unit || '').toUpperCase() === 'USD/BBL' ? 'lsmgo' : 'other';
}

function historyRows(points) {
  const byDate = new Map();
  for (const point of points) {
    if (!point.date) continue;
    if (!byDate.has(point.date)) byDate.set(point.date, { date: point.date });
    byDate.get(point.date)[point.key] = point.value == null ? null : Number(point.value);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function CurveTooltip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  return <div className="app-chart-tooltip"><strong>{/^\d{4}-\d{2}$/.test(String(label)) ? monthLabel(label) : formatDate(label)}</strong>{payload.filter((item) => item.value != null).map((item) => {
    const definition = series.find((entry) => entry.key === item.dataKey);
    return <span key={item.dataKey}><i aria-hidden="true" style={{ backgroundColor: item.color }} />{definition?.label || item.name}: {definition?.signed === false ? formatPrice(item.value, definition?.unit || 'USD/MT') : <MarketSignedValue value={item.value} unit={definition?.unit || 'USD/MT'} />}</span>;
  })}</div>;
}

function StructurePanel({ product, points, colors, mobileActive }) {
  const definition = PRODUCTS.find((item) => item.value === product);
  const unit = String(points.find((point) => point.unit)?.unit || definition?.unit || 'USD/MT').toUpperCase();
  const series = [...new Map(points.map((row) => [row.key, { key: row.key, label: row.label || row.key, unit, signed: true }])).values()];
  const data = historyRows(points);
  return (
    <section className={`market-product-panel${mobileActive ? ' is-mobile-active' : ''}`}>
      <div className="market-product-panel__title"><div><strong>{definition?.label || 'Other structure'}</strong><span>Independent {unit} scale</span></div><StatusBadge tone="neutral">{unit}</StatusBadge></div>
      {data.length ? <div className="market-product-panel__chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} syncId="forward-structure" syncMethod="value" margin={{ top: 8, right: 18, bottom: 2, left: 4 }}><CartesianGrid stroke="#e8ecef" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fill: '#738091', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={26} /><YAxis tick={<MarketSignedAxisTick digits={unit === 'USD/BBL' ? 1 : 0} />} axisLine={false} tickLine={false} width={58} domain={['auto', 'auto']} /><Tooltip content={<CurveTooltip series={series} />} /><Legend wrapperStyle={{ fontSize: 11 }} /><ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />{series.map((item, index) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} connectNulls={false} />)}</LineChart></ResponsiveContainer></div> : <div className="market-empty-inline"><LineChartIcon size={20} /><div><strong>No exact structure history</strong><span>Missing report dates remain gaps.</span></div></div>}
    </section>
  );
}

function ContextHistoryPanel({ unit, points, colors }) {
  const series = [...new Map(points.map((row) => [row.key, { key: row.key, label: row.label || row.key, unit, signed: /spread|east.?west|efs|cross.?grade|bm.?m1|m1.?m2/i.test(`${row.key} ${row.label}`) }])).values()];
  const data = historyRows(points);
  return (
    <section className="market-product-panel is-mobile-active">
      <div className="market-product-panel__title"><div><strong>{unit} context</strong><span>Cross-grade, East-West, EFS, Brent and ICE LSGO use unit-separated scales</span></div><StatusBadge tone="neutral">{unit}</StatusBadge></div>
      <div className="market-product-panel__chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} syncId="cross-market-context" syncMethod="value" margin={{ top: 8, right: 18, bottom: 2, left: 4 }}><CartesianGrid stroke="#e8ecef" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fill: '#738091', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={26} /><YAxis tick={{ fill: '#738091', fontSize: 10 }} axisLine={false} tickLine={false} width={58} domain={['auto', 'auto']} /><Tooltip content={<CurveTooltip series={series} />} /><Legend wrapperStyle={{ fontSize: 11 }} />{series.map((item, index) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} connectNulls={false} />)}</LineChart></ResponsiveContainer></div>
    </section>
  );
}

function ContextSignalValue({ signal, unit }) {
  const signed = /spread|east.?west|efs|cross.?grade|bm.?m1|m1.?m2/i.test(`${signal.key || ''} ${signal.type || ''} ${signal.label || ''}`);
  return signed ? <MarketSignedValue value={signal.value} unit={unit} /> : formatPrice(signal.value, unit);
}

function FallbackDrawer({ open, onClose, onSaved }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  const [form, setForm] = useState(() => ({ ...EMPTY_FALLBACK, asOfDate: today }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) setForm({ ...EMPTY_FALLBACK, asOfDate: today });
  }, [open, today]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await saveMarketForwardFallback({
        productKey: form.product,
        contractMonth: form.contractMonth,
        unit: form.unit,
        outrightValue: Number(form.outrightPrice),
        asOfDate: form.asOfDate,
        sourceNote: form.sourceNote,
        reason: form.reason,
        idempotencyKey: crypto.randomUUID(),
      });
      onSaved(result);
      onClose();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };
  const valid = form.contractMonth && form.asOfDate && form.outrightPrice !== '' && Number.isFinite(Number(form.outrightPrice)) && form.sourceNote.trim() && form.reason.trim();
  return (
    <Drawer open={open} onClose={onClose} title="Add exact outright fallback" description="Use only when the exact report tenor is unavailable. This mark cannot override verified report data." footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save fallback'}</Button></>}>
      {error ? <InlineError error={error} /> : null}
      <div className="app-callout app-callout--warning"><Clock3 size={15} /> The fallback expires on the next verified report, next Platts publication day, or contract roll—whichever comes first.</div>
      <div className="app-form-grid app-form-grid--2">
        <Field label="Product" required><Select value={form.product} onChange={(event) => { const product = PRODUCTS.find((item) => item.value === event.target.value); setForm((current) => ({ ...current, product: product.value, unit: product.unit })); }}>{PRODUCTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
        <Field label="Exact contract month" required><input className="app-input" type="month" value={form.contractMonth} onChange={(event) => set('contractMonth', event.target.value)} /></Field>
        <Field label="Unit" required hint="Locked to the product's Platts settlement unit."><input className="app-input" value={form.unit} readOnly aria-readonly="true" /></Field>
        <Field label="Outright price" required><input className="app-input" type="number" step="any" value={form.outrightPrice} onChange={(event) => set('outrightPrice', event.target.value)} /></Field>
        <Field label="As-of date" required><input className="app-input" type="date" max={today} value={form.asOfDate} onChange={(event) => set('asOfDate', event.target.value)} /></Field>
        <Field label="Source note" required hint="Identify the controlled source without pasting licensed commentary."><input className="app-input" value={form.sourceNote} onChange={(event) => set('sourceNote', event.target.value)} /></Field>
      </div>
      <Field label="Reason" required><textarea className="app-input app-textarea" value={form.reason} onChange={(event) => set('reason', event.target.value)} rows={3} /></Field>
    </Drawer>
  );
}

function SnapshotTable({ rows }) {
  const months = [...new Set(rows.map((row) => row.contractMonth).filter(Boolean))];
  return (
    <div className="market-matrix-scroll"><table className="market-curve-table"><thead><tr><th>Product</th>{months.map((month) => <th key={month}>{monthLabel(month)}</th>)}</tr></thead><tbody>{PRODUCTS.map((product) => <tr key={product.value}><th>{product.label}<small>{product.unit}</small></th>{months.map((month) => {
      const row = rows.find((entry) => entry.product === product.value && entry.contractMonth === month);
      const fallback = String(row?.status || row?.basis || '').toLowerCase().includes('fallback');
      return <td key={month} className={!row || row.value == null ? 'is-unavailable' : ''}><strong>{formatPrice(row?.value, row?.unit || product.unit)}</strong><div>{row?.tenor || 'Exact month'}</div><CurveMovement value={row?.dailyChange} unit={row?.unit || product.unit} /><StatusBadge tone={!row || row.value == null ? 'neutral' : fallback || row?.isPriorReport ? 'warning' : 'positive'}>{!row || row.value == null ? 'Unavailable' : fallback ? 'Authorized fallback' : row?.isPriorReport ? 'Prior report' : 'Verified report'}</StatusBadge>{row?.asOfDate ? <small>Source date {formatDate(row.asOfDate)}</small> : null}{row?.source || row?.sourceSymbol ? <small>{[row.source, marketSymbolLabel(row.sourceSymbol, { productKey: row.product, tenor: row.tenor, marketFamily: 'forward' })].filter(Boolean).join(' · ')}</small> : null}{fallback && row?.expiresAt ? <small>Expires {formatDate(row.expiresAt)}</small> : null}</td>;
    })}</tr>)}</tbody></table></div>
  );
}

export function MarketForwardCurves({ readOnly, canManageCutover = false, mode = 'content' }) {
  const initialFilters = useMemo(storedCurveFilters, []);
  const initialProducts = Array.isArray(initialFilters.products) ? initialFilters.products.filter((value) => PRODUCTS.some((item) => item.value === value)) : [];
  const [range, setRange] = useState(() => RANGES.includes(initialFilters.range) ? initialFilters.range : '1m');
  const [selectedProducts, setSelectedProducts] = useState(() => initialProducts.length ? initialProducts : PRODUCTS.map((item) => item.value));
  const [mobileProduct, setMobileProduct] = useState(() => initialProducts[0] || PRODUCTS[0].value);
  const [curve, setCurve] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [cutoverReason, setCutoverReason] = useState('');
  const [cutoverBusy, setCutoverBusy] = useState(false);

  const load = async ({ force = false } = {}) => {
    setBusy(true); setError(null);
    try {
      setCurve(await loadMarketIntelligenceCurve({ products: PRODUCTS.map((item) => item.value), range }, { force, cache: !force }));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, [range]);

  const snapshot = useMemo(() => normalizeSnapshot(curve), [curve]);
  const points = useMemo(() => normalizeStructure(curve), [curve]);
  const contextPoints = useMemo(() => normalizeContextHistory(curve), [curve]);
  const colors = ['#2563eb', '#7c3aed', '#d97706', '#0f766e', '#db2777', '#64748b', '#0891b2', '#9333ea'];
  const structurePanels = useMemo(() => PRODUCTS.filter((product) => selectedProducts.includes(product.value)).map((product) => ({ product: product.value, points: points.filter((point) => inferProduct(point) === product.value) })).filter((panel) => panel.points.length), [points, selectedProducts]);
  const contextPanels = useMemo(() => ['USD/MT', 'USD/BBL'].map((unit) => ({ unit, points: contextPoints.filter((point) => point.unit === unit) })).filter((panel) => panel.points.length), [contextPoints]);
  const signals = array(curve?.signals || curve?.contextSignals);
  const warnings = array(curve?.warnings);
  const snapshotDates = [...new Set(snapshot.map((row) => row.asOfDate).filter(Boolean))];
  const shadow = curve?.shadow || {};
  const cutoverScopes = array(shadow.scopes);
  const cutoverScopeIdentities = new Set(cutoverScopes.map((scope) => [productFor(scope.productKey || scope.product), String(scope.contractMonth || scope.contract_month || '').slice(0, 7), String(scope.unit || '').toUpperCase()].join(':')));
  const cutoverScopeProducts = new Set(cutoverScopes.map((scope) => productFor(scope.productKey || scope.product)));
  const hasCompleteCutoverScope = cutoverScopes.length === 8 && cutoverScopeIdentities.size === 8 && PRODUCTS.every((product) => cutoverScopeProducts.has(product.value));
  const cutoverStatusReady = shadow.status === 'ready_for_variance_review';
  const cutoverReady = cutoverStatusReady && shadow.varianceMetricsAvailable === true && hasCompleteCutoverScope;
  const cutoverApproved = shadow.cutoverApproved === true || curve?.valuationMode === 'platts_curve_active';
  const cutoverRevision = Number(shadow.cutoverRevision);
  const cutoverReasonValid = cutoverReason.trim().length >= 8;

  const toggleProduct = (value) => {
    const next = selectedProducts.includes(value) ? selectedProducts.filter((item) => item !== value) : PRODUCTS.map((item) => item.value).filter((item) => selectedProducts.includes(item) || item === value);
    if (next.length) setSelectedProducts(next);
  };

  useEffect(() => {
    if (!selectedProducts.includes(mobileProduct)) setMobileProduct(selectedProducts[0]);
  }, [mobileProduct, selectedProducts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.sessionStorage.setItem(CURVE_FILTERS_KEY, JSON.stringify({ range, products: selectedProducts })); } catch { /* Storage may be unavailable. */ }
  }, [range, selectedProducts]);

  const approveCutover = async () => {
    if (!canManageCutover || !cutoverReady || cutoverApproved || !Number.isInteger(cutoverRevision) || cutoverRevision < 1 || !cutoverReasonValid) return;
    setCutoverBusy(true); setError(null);
    try {
      const result = await saveMarketIntelligenceCurveCutover({
        approved: true,
        expectedRevision: cutoverRevision,
        reason: cutoverReason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setCurve((current) => ({
        ...current,
        valuationMode: result?.approved ? 'platts_curve_active' : current?.valuationMode,
        shadow: {
          ...current?.shadow,
          cutoverApproved: result?.approved === true,
          cutoverRevision: result?.revision ?? current?.shadow?.cutoverRevision,
          reviewedAt: result?.reviewedAt ?? current?.shadow?.reviewedAt,
        },
      }));
      setCutoverReason('');
    } catch (nextError) {
      setError(nextError);
    } finally {
      setCutoverBusy(false);
    }
  };

  const cutoverPanel = <Panel>
    <div className="app-panel-header"><div><h2>Platts curve cutover review</h2><p>Legacy hedge valuation remains active until the governed shadow review is complete and an authorized Administrator approves the cutover.</p></div><StatusBadge tone={cutoverApproved ? 'positive' : cutoverReady ? 'warning' : 'neutral'}>{cutoverApproved ? 'Platts curve active' : cutoverReady ? 'Ready for variance review' : cutoverStatusReady ? 'Complete variance evidence unavailable' : 'Shadow mode'}</StatusBadge></div>
    <div className="market-context-grid">
      <article><Clock3 size={17} /><span>Publication days</span><strong>{shadow.publicationDayCount != null && Number.isFinite(Number(shadow.publicationDayCount)) ? Number(shadow.publicationDayCount) : '—'} / {shadow.minimumPublicationDays != null && Number.isFinite(Number(shadow.minimumPublicationDays)) ? Number(shadow.minimumPublicationDays) : '—'}</strong></article>
      <article><Scale size={17} /><span>Reviewed comparisons</span><strong>{shadow.comparisonCount != null && Number.isFinite(Number(shadow.comparisonCount)) ? Number(shadow.comparisonCount) : '—'}</strong></article>
      <article><CheckCircle2 size={17} /><span>Valuation mode</span><strong>{cutoverApproved ? 'Platts curve' : 'Legacy · shadow comparison'}</strong></article>
    </div>
    {cutoverScopes.length ? <><div className="market-matrix-scroll"><table className="market-curve-table"><thead><tr><th>Reviewed scope</th><th>Mean signed variance</th><th>Mean absolute variance</th><th>Maximum absolute variance</th><th>Evidence</th></tr></thead><tbody>{cutoverScopes.map((scope, index) => { const product = PRODUCTS.find((item) => item.value === productFor(scope.productKey || scope.product)); const unit = String(scope.unit || product?.unit || 'USD/MT').toUpperCase(); const contractMonth = scope.contractMonth || scope.contract_month; const readiness = scope.readiness || scope.status; return <tr key={scope.id || `${scope.productKey || scope.product}:${contractMonth}:${unit}:${index}`}><th>{product?.label || scope.productKey || scope.product || 'Product'}<small>{[contractMonth ? monthLabel(String(contractMonth).slice(0, 7)) : null, unit].filter(Boolean).join(' · ')}</small></th><td><strong><MarketSignedValue value={scope.meanSignedVariance} unit={unit} /></strong></td><td><strong>{formatPrice(scope.meanAbsoluteVariance, unit)}</strong></td><td><strong>{formatPrice(scope.maximumAbsoluteVariance, unit)}</strong></td><td>{readiness ? <StatusBadge tone={String(readiness).toLowerCase().includes('ready') ? 'positive' : 'warning'}>{readiness}</StatusBadge> : null}<small>{scope.comparisonCount != null ? `${scope.comparisonCount} comparisons` : 'Comparison count unavailable'}</small><small>{scope.reviewedThrough ? `Reviewed through ${formatDate(scope.reviewedThrough)}` : 'Review date unavailable'}</small></td></tr>; })}</tbody></table></div>{!hasCompleteCutoverScope ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} /> Approval requires exactly eight unique scopes across HSFO 380, S0.5% and LSMGO. FCOS received {cutoverScopeIdentities.size} unique scopes, so approval is blocked.</div> : null}</> : <div className="market-empty-inline market-empty-inline--compact"><Scale size={20} /><div><strong>Variance evidence is unavailable</strong><span>Cutover approval remains blocked until all eight exact product, contract-month and unit scopes are returned.</span></div></div>}
    {!cutoverApproved ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} /> Fail closed: current and future hedge valuation remains on the legacy calculation until this exact shadow revision is approved.</div> : null}
    {canManageCutover && !cutoverApproved ? <div className="market-cutover-review">
      <Field label="Mandatory review reason" required hint="At least 8 characters. The saved reason is governed and audited."><textarea className="app-input app-textarea" rows={3} value={cutoverReason} onChange={(event) => setCutoverReason(event.target.value)} disabled={cutoverBusy} /></Field>
      <div className="market-alert-rule-footer"><div><ShieldAlert size={15} /> {cutoverReady ? Number.isInteger(cutoverRevision) && cutoverRevision >= 1 ? `Approving shadow revision ${cutoverRevision}.` : 'Revision is unavailable; approval is blocked.' : cutoverStatusReady ? 'Auditable variance metrics are unavailable; approval is blocked.' : 'The minimum shadow period or variance review is not complete.'}</div><Button variant="primary" onClick={approveCutover} disabled={cutoverBusy || !cutoverReady || !Number.isInteger(cutoverRevision) || cutoverRevision < 1 || !cutoverReasonValid}>{cutoverBusy ? 'Approving…' : 'Approve Platts curve cutover'}</Button></div>
    </div> : null}
  </Panel>;

  if (mode === 'admin') return <div className="market-intelligence-stack" data-testid="market-forward-admin-tools">
    {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
    <Panel><div className="app-panel-header"><div><h2>Exact forward fallback</h2><p>Add an expiring exact contract-month mark only when verified report evidence is unavailable.</p></div>{!readOnly ? <Button size="sm" icon={Plus} onClick={() => setFallbackOpen(true)}>Add fallback</Button> : <StatusBadge tone="neutral">View only</StatusBadge>}</div><SnapshotTable rows={snapshot} /></Panel>
    {cutoverPanel}
    <FallbackDrawer open={fallbackOpen} onClose={() => setFallbackOpen(false)} onSaved={(result) => { if (result?.curve) setCurve(result.curve); else load({ force: true }); }} />
  </div>;

  return (
    <div className="market-intelligence-stack" data-testid="market-forward-curves">
      {error ? <InlineError error={error} action={<Button onClick={() => load({ force: true })}>Retry</Button>} /> : null}
      <Panel>
        <div className="app-panel-header"><div><h2>Exact contract-month snapshot</h2><p>Future M1 and M2 use their own report outright. A missing tenor is never interpolated, forward-filled or copied from another month.</p></div><div className="market-panel-actions"><StatusBadge tone={curve?.complete ? 'positive' : 'warning'}>{busy ? 'Updating…' : curve?.complete ? 'Complete snapshot' : 'Controlled gaps'}</StatusBadge>{snapshotDates.length > 1 || snapshot.some((row) => row.isPriorReport) ? <StatusBadge tone="warning">Mixed source dates</StatusBadge> : null}</div></div>
        <SnapshotTable rows={snapshot} />
        <div className="app-callout app-callout--neutral"><CheckCircle2 size={15} /> Closed month uses the approved publication-day average. Current month uses actual days before the BM assessment plus BM for remaining publication days including its assessment date. SGO remains USD/BBL for settlement.</div>
      </Panel>

      <Panel className="market-curve-history-panel">
        <div className="app-panel-header"><div><h2>Historical curve structure</h2><p>BM–M1 and M1–M2 use exact same-snapshot marks. Positive front-minus-back is backwardation.</p></div><StatusBadge tone="neutral">Missing dates remain gaps</StatusBadge></div>
        <div className="market-chart-controls">
          <fieldset className="market-toggle-group"><legend>Range</legend><div>{RANGES.map((value) => <button key={value} type="button" className={range === value ? 'is-active' : ''} aria-pressed={range === value} onClick={() => setRange(value)}>{value.toUpperCase()}</button>)}</div></fieldset>
          <fieldset className="market-toggle-group"><legend>Products</legend><div>{PRODUCTS.map((product) => <button key={product.value} type="button" className={selectedProducts.includes(product.value) ? 'is-active' : ''} aria-pressed={selectedProducts.includes(product.value)} onClick={() => toggleProduct(product.value)}>{product.label}</button>)}</div></fieldset>
        </div>
        <div className="market-mobile-product-tabs" role="tablist" aria-label="Forward-curve product">{selectedProducts.map((value) => { const product = PRODUCTS.find((item) => item.value === value); return <button key={value} type="button" role="tab" aria-selected={mobileProduct === value} className={mobileProduct === value ? 'is-active' : ''} onClick={() => setMobileProduct(value)}>{product?.label || value}</button>; })}</div>
        {structurePanels.length ? <div className="market-product-panels">{structurePanels.map((panel) => <StructurePanel key={panel.product} product={panel.product} points={panel.points} colors={colors} mobileActive={mobileProduct === panel.product} />)}</div> : <div className="market-empty-inline"><LineChartIcon size={20} /><div><strong>No exact structure history for this selection</strong><span>FCOS leaves missing report dates visible rather than drawing across them.</span></div></div>}
      </Panel>

      <details className="market-disclosure"><summary><CalendarRange size={14} /> Cross-market context ({contextPanels.length} unit panels · {signals.length} signals)</summary><div className="market-disclosure__body">
        {contextPanels.length ? <div className="market-product-panels market-context-history">{contextPanels.map((panel) => <ContextHistoryPanel key={panel.unit} unit={panel.unit} points={panel.points} colors={colors} />)}</div> : null}
        {signals.length ? <div className="market-context-units">{['USD/MT', 'USD/BBL'].map((unit) => { const unitSignals = signals.filter((signal) => String(signal.unit || 'USD/MT').toUpperCase() === unit); return unitSignals.length ? <section key={unit}><div className="market-context-units__title">{unit}</div><div className="market-context-grid">{unitSignals.map((signal, index) => <article key={signal.id || `${signal.key || signal.type || signal.label}:${index}`}><Scale size={17} /><span>{signal.label || signal.type || signal.key}</span><strong><ContextSignalValue signal={signal} unit={unit} /></strong><small>{[signal.contractMonth ? monthLabel(signal.contractMonth) : signal.date ? formatDate(signal.date) : null, signal.tenor, signal.basis, signal.sourceSymbol ? marketSymbolLabel(signal.sourceSymbol, { primaryLabel: signal.label || signal.type || signal.key, productKey: signal.productKey, tenor: signal.tenor, settlementBasis: signal.settlementBasis }) : null].filter(Boolean).join(' · ')}</small></article>)}</div></section> : null; })}</div> : <div className="market-empty-inline market-empty-inline--compact"><CalendarRange size={20} /><div><strong>No cross-market context loaded</strong><span>Missing context is not derived from report commentary.</span></div></div>}
      </div></details>
      {warnings.length ? <details className="market-disclosure market-disclosure--warning"><summary><AlertTriangle size={14} /> Data notes ({warnings.length})</summary><div className="market-history-warnings">{warnings.map((warning, index) => <div key={warning?.id || `${warning?.code || 'warning'}:${index}`}><AlertTriangle size={14} /><MarketSignedText>{typeof warning === 'string' ? warning : warning?.message || warning?.summary || 'Market curve warning'}</MarketSignedText></div>)}</div></details> : null}
    </div>
  );
}
