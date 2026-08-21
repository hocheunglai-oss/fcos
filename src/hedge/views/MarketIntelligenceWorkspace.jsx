import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FileUp,
  Gauge,
  Info,
  LineChart as LineChartIcon,
  RefreshCw,
  Scale,
  Ship,
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
import { importMarketReport, loadMarketHistory, previewMarketReport } from '@/hedge/api/marketData';
import { formatDate, formatMoney } from '@/hedge/lib/domain';
import {
  Button,
  Drawer,
  Field,
  InlineError,
  Metric,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
} from '@/hedge/components/ui';
import { MarketDecisionBrief } from './market-intelligence/MarketDecisionBrief';
import { MarketDriversAlerts } from './market-intelligence/MarketDriversAlerts';
import { MarketForwardCurves } from './market-intelligence/MarketForwardCurves';
import { MarketsView } from './MarketsView';
import './market-intelligence/marketIntelligence.css';

const TABS = [
  { value: 'brief', label: 'Daily Decision Brief' },
  { value: 'delivered', label: 'Delivered & MOPS' },
  { value: 'curves', label: 'Forward Curves' },
  { value: 'drivers', label: 'Drivers & Alerts' },
];

const TAB_VALUES = new Set(TABS.map((item) => item.value));

function initialMarketTab() {
  if (typeof window === 'undefined') return 'brief';
  const requested = new URLSearchParams(window.location.search).get('tab');
  return TAB_VALUES.has(requested) ? requested : 'brief';
}

const PRODUCTS = [
  { value: 'hsfo380', label: 'HSFO 380', color: '#d97706' },
  { value: 'vlsfo', label: 'S0.5%', color: '#2563eb' },
  { value: 'lsmgo', label: 'LSMGO 0.1%', color: '#0f766e' },
];

const PRODUCT_ORDER = new Map(PRODUCTS.map((product, index) => [product.value, index]));

const PORT_COLORS = ['#2563eb', '#0f766e', '#d97706', '#7c3aed', '#db2777'];

function sourceTone(value) {
  if (value === 'assessment') return 'positive';
  if (value === 'posted') return 'warning';
  if (value === 'unavailable') return 'neutral';
  return 'warning';
}

function sourceLabel(value) {
  return ({ assessment: 'Assessment', posted: 'Posted', proxy: 'Proxy', estimate: 'Estimate', unavailable: 'Unavailable' })[value] || value;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('The PDF could not be read.'));
    reader.readAsDataURL(file);
  });
}

function signedMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value) >= 0 ? '+' : ''}${formatMoney(Number(value), { digits: 2 })}`;
}

function SpreadSparkline({ points = [], color = '#2563eb' }) {
  const values = points.map((row) => Number(row.spread)).filter(Number.isFinite);
  if (values.length < 2) return <div className="market-sparkline market-sparkline--empty">Insufficient matched dates</div>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const coordinates = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - low) / range) * 24}`).join(' ');
  return (
    <svg className="market-sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Three-month premium or discount sparkline">
      <line x1="0" x2="100" y1={28 - ((0 - low) / range) * 24} y2={28 - ((0 - low) / range) * 24} className="market-sparkline__zero" />
      <polyline points={coordinates} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HorizonStat({ label, value }) {
  return (
    <div className="market-horizon-stat">
      <strong>{label}</strong>
      {value?.matchedSamples ? <>
        <span>Avg {signedMoney(value.average)}</span>
        <small>{signedMoney(value.low)} to {signedMoney(value.high)}</small>
        <small>Move {signedMoney(value.movement)} · n={value.matchedSamples}</small>
      </> : <span>No match</span>}
    </div>
  );
}

function MarketToggleGroup({ label, options, selected, onChange, single = false }) {
  const toggle = (value) => {
    if (single) { onChange(value); return; }
    const selectedValues = new Set(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
    const next = options.map((option) => option.value).filter((optionValue) => selectedValues.has(optionValue));
    if (next.length) onChange(next);
  };
  return (
    <fieldset className="market-toggle-group">
      <legend>{label}</legend>
      <div>{options.map((option) => {
        const active = single ? selected === option.value : selected.includes(option.value);
        return <button key={option.value} type="button" aria-pressed={active} className={active ? 'is-active' : ''} onClick={() => toggle(option.value)}>{option.label}</button>;
      })}</div>
    </fieldset>
  );
}

function DeliveredTooltip({ active, payload, label, mode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="app-chart-tooltip">
      <strong>{formatDate(label)}</strong>
      {payload.filter((item) => item.value != null).map((item) => (
        <span key={item.dataKey} style={{ color: item.color }}>{item.name}: {mode === 'spread' ? signedMoney(item.value) : formatMoney(item.value, { digits: 2 })} USD/MT</span>
      ))}
    </div>
  );
}

function historyChartRows(panel, mode) {
  const byDate = new Map();
  const rowFor = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date });
    return byDate.get(date);
  };
  for (const series of panel.series || []) {
    for (const point of series.points || []) rowFor(point.date)[series.portKey] = mode === 'spread' ? point.spread : point.delivered;
  }
  if (mode === 'price') {
    for (const point of panel.benchmark?.points || []) rowFor(point.date).mops = point.usdMt;
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function DeliveredTrendPanel({ panel, mode, visible, mobileActive }) {
  const data = useMemo(() => historyChartRows(panel, mode), [mode, panel]);
  return (
    <section className={`market-product-panel${mobileActive ? ' is-mobile-active' : ''}`} aria-hidden={!visible}>
      <div className="market-product-panel__title">
        <div><strong>{panel.productLabel}</strong><span>{mode === 'spread' ? 'Delivered premium / discount vs exact-date MOPS' : panel.benchmark?.label || 'Delivered price'}</span></div>
        <StatusBadge tone={mode === 'spread' ? 'warning' : 'neutral'}>{mode === 'spread' ? 'USD/MT spread' : 'USD/MT price'}</StatusBadge>
      </div>
      {data.length ? <div className="market-product-panel__chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="delivered-mops" syncMethod="value" margin={{ top: 8, right: 16, left: 0, bottom: 2 }}>
            <CartesianGrid stroke="#e8ecef" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fill: '#738091', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tick={{ fill: '#738091', fontSize: 10 }} axisLine={false} tickLine={false} width={58} domain={['auto', 'auto']} />
            <Tooltip content={<DeliveredTooltip mode={mode} />} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 5 }} />
            {mode === 'spread' ? <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" /> : null}
            {(panel.series || []).filter((series) => series.available).map((series, index) => (
              <Line key={series.portKey} type="monotone" dataKey={series.portKey} name={series.portLabel} stroke={PORT_COLORS[index % PORT_COLORS.length]} strokeWidth={2} dot={false} connectNulls={false} />
            ))}
            {mode === 'price' && panel.benchmark?.points?.length ? <Line type="monotone" dataKey="mops" name={panel.benchmark.label} stroke="#111827" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} /> : null}
          </LineChart>
        </ResponsiveContainer>
      </div> : <div className="market-empty-inline"><LineChartIcon size={20} /><div><strong>No matched history</strong><span>Missing dates remain gaps; FCOS never forward-fills a price.</span></div></div>}
    </section>
  );
}

function DeliveredBunkers({ intelligence }) {
  const delivered = intelligence?.delivered || [];
  const ports = useMemo(() => [...new Map(delivered.map((row) => [row.portKey, row.portLabel])).entries()], [delivered]);
  const [selectedProducts, setSelectedProducts] = useState(() => PRODUCTS.map((item) => item.value));
  const [selectedPorts, setSelectedPorts] = useState(() => ports.some(([key]) => key === 'singapore') ? ['singapore'] : ports.slice(0, 1).map(([key]) => key));
  const [mode, setMode] = useState('price');
  const [range, setRange] = useState('3m');
  const [includeMops, setIncludeMops] = useState(true);
  const [mobileProduct, setMobileProduct] = useState(PRODUCTS[0].value);
  const [history, setHistory] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    if (!selectedProducts.includes(mobileProduct)) setMobileProduct(selectedProducts[0]);
  }, [mobileProduct, selectedProducts]);

  useEffect(() => {
    if (!intelligence?.available || !selectedProducts.length || !selectedPorts.length) return undefined;
    const controller = new AbortController();
    setHistoryBusy(true);
    setHistoryError(null);
    loadMarketHistory({ range, mode, products: selectedProducts, ports: selectedPorts, includeMops, limit: 400 }, { signal: controller.signal })
      .then((result) => { if (!result?.cancelled) setHistory(result); })
      .catch((error) => { if (error?.name !== 'AbortError') setHistoryError(error); })
      .finally(() => { if (!controller.signal.aborted) setHistoryBusy(false); });
    return () => controller.abort();
  }, [includeMops, intelligence?.available, mode, range, selectedPorts, selectedProducts]);

  if (!intelligence?.available) {
    return <Panel><div className="market-empty-inline"><RefreshCw size={20} /><div><strong>Delivered-price storage is not deployed yet</strong><span>The MOPS market remains available. Apply the reviewed service-only migration to enable delivered data.</span></div></div></Panel>;
  }

  return (
    <div className="market-intelligence-stack">
      <div className="app-callout app-callout--neutral"><Info size={15} /> Delivered Bunkers remain distinct physical assessments or posted prices; exact-date MOPS comparisons do not erase their product, location, quantity or delivery-window basis.</div>
      <div className="app-metric-grid app-metric-grid--4">
        {PRODUCTS.map((item) => {
          const values = delivered.filter((row) => row.productKey === item.value && row.latest?.price != null);
          const latestDate = values.map((row) => row.latest.priceDate).sort().at(-1);
          return <Metric key={item.value} label={`${item.label} coverage`} value={`${values.length} ports`} detail={latestDate ? `Latest ${formatDate(latestDate)}` : 'No observation loaded'} tone={item.value === 'vlsfo' ? 'blue' : item.value === 'hsfo380' ? 'orange' : 'teal'} icon={Ship} />;
        })}
        <Metric label="Spread basis" value="Exact date" detail="No interpolation or cargo proxy" tone="green" icon={Scale} />
      </div>

      {(intelligence?.conflicts || []).length ? <div className="app-callout app-callout--warning"><AlertTriangle size={16} /> Conflicting report observations are quarantined. Affected dates are excluded from premium / discount analytics until reviewed.</div> : null}

      <Panel className="market-matrix-panel">
        <div className="app-panel-header">
          <div><h2>Major-port delivered prices and MOPS spread</h2><p>Latest USD/MT values with one three-month sparkline and exact-date 1W, 1M and 3M statistics.</p></div>
          <StatusBadge tone="neutral">{ports.length} ports · 3 products</StatusBadge>
        </div>
        <div className="market-matrix-scroll">
          <table className="market-matrix market-matrix--analytics">
            <thead><tr><th>Port</th>{PRODUCTS.map((item) => <th key={item.value}>{item.label}</th>)}</tr></thead>
            <tbody>{ports.map(([portKey, portLabel]) => (
              <tr key={portKey}>
                <th>{portLabel}</th>
                {PRODUCTS.map((item) => {
                  const row = delivered.find((entry) => entry.portKey === portKey && entry.productKey === item.value);
                  if (!row || row.sourceType === 'unavailable') return <td key={item.value} className="market-price-cell--unavailable"><strong>Not published</strong><small>No exact licensed series</small></td>;
                  const latestSpread = row.latestSpread;
                  return (
                    <td key={item.value}>
                      <div className="market-price-cell">
                        <div className="market-price-cell__top">
                          <strong>{row.latest?.price == null ? '—' : formatMoney(row.latest.price, { digits: 2 })}</strong>
                          {row.aliasLabel ? <span className="market-alias-label">{row.aliasLabel}</span> : null}
                        </div>
                        <div className="market-price-cell__spread">
                          <span>{latestSpread?.spread == null ? 'No exact-date MOPS' : `${latestSpread.spread >= 0 ? 'Premium' : 'Discount'} ${signedMoney(latestSpread.spread)}`}</span>
                          <small>{latestSpread?.date ? formatDate(latestSpread.date) : row.benchmark?.label || 'Benchmark unavailable'}</small>
                        </div>
                        <SpreadSparkline points={row.spreadHistory || []} color={item.color} />
                        <div className="market-horizon-grid">
                          <HorizonStat label="1W" value={row.horizonStats?.['1w']} />
                          <HorizonStat label="1M" value={row.horizonStats?.['1m']} />
                          <HorizonStat label="3M" value={row.horizonStats?.['3m']} />
                        </div>
                        <div className="market-price-cell__meta">
                          <StatusBadge tone={sourceTone(row.sourceType)}>{sourceLabel(row.sourceType)}</StatusBadge>
                          <small>{row.sourceSymbol}{row.latest?.stale ? ` · ${row.latest.staleDays}d old` : ''}</small>
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="app-callout app-callout--neutral"><Info size={15} /> Kaohsiung is CPC posted pricing: VLSFO is <strong>LS180</strong> and HSFO 380 is <strong>MF-380</strong>. South Korea (West) publishes VLSFO only.</div>
      </Panel>

      <Panel className="app-chart-panel market-delivered-chart market-analytics-chart">
        <div className="app-panel-header">
          <div><h2>Delivered price and premium / discount trends</h2><p>Product panels share the same date and tooltip position while retaining independent scales.</p></div>
          {historyBusy ? <StatusBadge tone="neutral">Updating…</StatusBadge> : <StatusBadge tone={history?.coverage?.complete ? 'positive' : 'warning'}>{history?.coverage?.matchedSpreads || 0} matched spreads</StatusBadge>}
        </div>
        <div className="market-chart-controls">
          <MarketToggleGroup label="View" single options={[{ value: 'price', label: 'Delivered price' }, { value: 'spread', label: 'Premium vs MOPS' }]} selected={mode} onChange={setMode} />
          <MarketToggleGroup label="Range" single options={['1w', '1m', '3m', '6m', '1y'].map((value) => ({ value, label: value.toUpperCase() }))} selected={range} onChange={setRange} />
          <MarketToggleGroup label="Products" options={PRODUCTS} selected={selectedProducts} onChange={setSelectedProducts} />
          <MarketToggleGroup label="Ports" options={ports.map(([value, label]) => ({ value, label }))} selected={selectedPorts} onChange={setSelectedPorts} />
          <fieldset className="market-toggle-group"><legend>Benchmark</legend><div><button type="button" aria-pressed={includeMops} className={includeMops ? 'is-active' : ''} onClick={() => setIncludeMops((value) => !value)}>MOPS</button></div></fieldset>
        </div>
        {mode === 'spread' ? <div className="app-callout app-callout--neutral"><Info size={15} /> MOPS is represented by the zero line in spread mode. Switch to Delivered price to draw the benchmark line.</div> : null}
        {historyError ? <InlineError error={historyError} /> : null}
        {(history?.warnings || []).length ? <div className="market-history-warnings">{history.warnings.map((warning) => <div key={`${warning.code}:${warning.date}:${warning.productKey || ''}`}><AlertTriangle size={14} /><span>{warning.message}</span></div>)}</div> : null}
        <div className="market-mobile-product-tabs" role="tablist" aria-label="Chart product">{selectedProducts.map((value) => {
          const option = PRODUCTS.find((item) => item.value === value);
          return <button key={value} type="button" role="tab" aria-selected={mobileProduct === value} className={mobileProduct === value ? 'is-active' : ''} onClick={() => setMobileProduct(value)}>{option?.label || value}</button>;
        })}</div>
        <div className="market-product-panels">{[...(history?.panels || [])].sort((left, right) => (PRODUCT_ORDER.get(left.productKey) ?? Number.MAX_SAFE_INTEGER) - (PRODUCT_ORDER.get(right.productKey) ?? Number.MAX_SAFE_INTEGER)).map((panel) => <DeliveredTrendPanel key={panel.productKey} panel={panel} mode={mode} visible={selectedProducts.includes(panel.productKey)} mobileActive={mobileProduct === panel.productKey} />)}</div>
        {history && !history.coverage?.complete ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} /> The selected horizon was paginated. Narrow the selection before using the chart for a complete comparison.</div> : null}
      </Panel>
    </div>
  );
}

export function CargoForwardSummary({ intelligence }) {
  const rows = intelligence?.cargoForward || [];
  if (!rows.length) return null;
  return (
    <Panel className="market-forward-summary" data-compatibility-view="Cargo & Forward">
      <div className="app-panel-header"><div><h2>Cargo &amp; Forward reference</h2><p>Reference only. Exact contract-month reports remain the authoritative open-month hedge inputs.</p></div></div>
      <div className="market-forward-cards">{rows.map((row) => (
        <div key={row.id} className="market-forward-card">
          <span>{row.productLabel}</span>
          <strong>{row.latest?.price == null ? '—' : formatMoney(row.latest.price, { digits: 3 })}</strong>
          <small>{row.aliasLabel ? `${row.aliasLabel} · ` : ''}{row.sourceSymbol || 'No symbol'} · {row.unit}</small>
        </div>
      ))}</div>
    </Panel>
  );
}

export function TradingSignals({ intelligence }) {
  const delivered = intelligence?.delivered || [];
  const [portKey, setPortKey] = useState('singapore');
  const [productKey, setProductKey] = useState('vlsfo');
  const [quote, setQuote] = useState('');
  const benchmark = delivered.find((row) => row.portKey === portKey && row.productKey === productKey);
  const quoteDifference = quote !== '' && benchmark?.latest?.price != null ? Number(quote) - benchmark.latest.price : null;
  const alerts = intelligence?.signals?.alerts || [];

  return (
    <div className="market-intelligence-stack">
      <div className="app-callout app-callout--neutral"><Info size={15} /> Trading Signals below are deterministic evidence checks. They do not issue a recommendation or execute a trade.</div>
      <div className="market-signal-grid">
        {(intelligence?.signals?.relativeValue || []).map((signal) => (
          <Panel key={signal.productKey} className="market-signal-card">
            <div className="market-signal-card__icon"><Scale size={18} /></div>
            <span>{PRODUCTS.find((item) => item.value === signal.productKey)?.label || signal.productKey}</span>
            {signal.available ? <><strong>{formatMoney(signal.spread, { digits: 2 })} spread</strong><small>{signal.cheapest.portLabel} {formatMoney(signal.cheapest.price, { digits: 2 })} → {signal.mostExpensive.portLabel} {formatMoney(signal.mostExpensive.price, { digits: 2 })}</small></> : <><strong>Unavailable</strong><small>No comparable port data</small></>}
          </Panel>
        ))}
        <Panel className="market-signal-card">
          <div className="market-signal-card__icon"><Gauge size={18} /></div>
          <span>S0.5% forward structure</span>
          <strong>{intelligence?.signals?.forwardStructure?.label || 'Unavailable'}</strong>
          <small>{intelligence?.signals?.forwardStructure ? `BM/M1 ${intelligence.signals.forwardStructure.bmM1 >= 0 ? '+' : ''}${intelligence.signals.forwardStructure.bmM1.toFixed(2)} · M1/M2 ${intelligence.signals.forwardStructure.m1M2 == null ? '—' : intelligence.signals.forwardStructure.m1M2.toFixed(2)}` : 'Import forward observations'}</small>
        </Panel>
        <Panel className="market-signal-card">
          <div className="market-signal-card__icon"><Scale size={18} /></div>
          <span>S0.5% - HSFO 380 M1</span>
          <strong>{intelligence?.signals?.vlsfoHsfoM1 == null ? 'Unavailable' : `${formatMoney(intelligence.signals.vlsfoHsfoM1, { digits: 2 })} USD/MT`}</strong>
          <small>Product-switch economics before operational and compliance costs.</small>
        </Panel>
        <Panel className="market-signal-card">
          <div className="market-signal-card__icon"><ArrowUpRight size={18} /></div>
          <span>East-West M1</span>
          <strong>{intelligence?.signals?.eastWestM1 == null ? 'Unavailable' : `${formatMoney(intelligence.signals.eastWestM1, { digits: 2 })} USD/MT`}</strong>
          <small>Singapore 380 CST versus Rotterdam 3.5% reference.</small>
        </Panel>
        <Panel className="market-signal-card">
          <div className="market-signal-card__icon"><Gauge size={18} /></div>
          <span>Singapore gasoil M1</span>
          <strong>{intelligence?.signals?.gasoilM1 == null ? 'Unavailable' : `${formatMoney(intelligence.signals.gasoilM1, { digits: 2 })} USD/BBL`}</strong>
          <small>10 ppm gasoil reference at London MOC.</small>
        </Panel>
      </div>

      <div className="market-signal-columns">
        <Panel>
          <div className="app-panel-header"><div><h2>Supplier quote check</h2><p>Compare a quote with the exact selected delivered reference. Deviation and credit costs are not included.</p></div></div>
          <div className="app-form-grid app-form-grid--3">
            <Field label="Port"><Select value={portKey} onChange={(event) => setPortKey(event.target.value)}>{[...new Map(delivered.map((row) => [row.portKey, row.portLabel]))].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
            <Field label="Product"><Select value={productKey} onChange={(event) => setProductKey(event.target.value)}>{PRODUCTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
            <Field label="Supplier quote (USD/MT)"><input className="app-input" type="number" step="any" value={quote} onChange={(event) => setQuote(event.target.value)} /></Field>
          </div>
          <div className="market-quote-result">
            <div><span>Delivered reference</span><strong>{benchmark?.latest?.price == null ? 'Unavailable' : formatMoney(benchmark.latest.price, { digits: 2 })}</strong><small>{benchmark?.sourceSymbol || 'No exact series'} · {sourceLabel(benchmark?.sourceType || 'unavailable')}</small></div>
            <div className={quoteDifference == null ? '' : quoteDifference <= 0 ? 'is-positive' : 'is-warning'}><span>Quote vs reference</span><strong>{quoteDifference == null ? 'Enter a quote' : `${quoteDifference >= 0 ? '+' : ''}${formatMoney(quoteDifference, { digits: 2 })}`}</strong><small>{quoteDifference == null ? 'No comparison yet' : quoteDifference <= 0 ? 'Below selected reference' : 'Above selected reference'}</small></div>
          </div>
        </Panel>

        <Panel>
          <div className="app-panel-header"><div><h2>Basis and methodology alerts</h2><p>Flags missing, stale, or mixed-basis observations before trading use.</p></div></div>
          <div className="market-alert-list">{alerts.length ? alerts.map((alert) => <div key={alert}><AlertTriangle size={16} /><span>{alert}</span></div>) : <div><Info size={16} /><span>No current methodology alert.</span></div>}</div>
        </Panel>
      </div>

      <Panel>
        <div className="app-panel-header"><div><h2>Trading-use framework</h2><p>Use prices as evidence, not as an automatic decision engine.</p></div></div>
        <div className="market-use-grid">
          <div><ArrowDownRight size={18} /><strong>Alternative-port opportunity</strong><span>Compare gross port gaps, then apply deviation, timing, quantity and credit costs before acting.</span></div>
          <div><ArrowUpRight size={18} /><strong>Execution quality</strong><span>Compare a completed supplier price with the same port/product/date reference and retain the basis.</span></div>
          <div><Gauge size={18} /><strong>Supply tightness</strong><span>Read delivered moves together with VLSFO cargo premiums and forward structure; do not infer tightness from one signal.</span></div>
          <div><Scale size={18} /><strong>Basis risk</strong><span>Posted prices, assessments, cargo values and MOPS have different delivery and methodology bases.</span></div>
        </div>
      </Panel>

      <Panel>
        <div className="app-panel-header"><div><h2>Compliance and alternative fuels watch</h2><p>The storage model accepts separately licensed compliance series without mixing them into conventional bunker or MOPS calculations.</p></div></div>
        <div className="app-callout app-callout--neutral"><Info size={15} /> No compliance series is configured yet. Add a licensed biofuel, SAF or emissions series only after its product specification, unit and assessment basis are approved.</div>
      </Panel>
    </div>
  );
}

function ReportImportDrawer({ open, onClose, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('bunkerwire');
  const [fileBase64, setFileBase64] = useState('');
  const [preview, setPreview] = useState(null);
  const [entitlementConfirmed, setEntitlementConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const importBlockers = useMemo(() => (preview?.observations || []).filter((row) => {
    const forward = row?.basisMetadata?.marketFamily === 'forward' || ['bm', 'm1', 'm2'].includes(String(row?.tenor || '').toLowerCase());
    const monthSource = String(row?.basisMetadata?.contractMonthSource || '');
    return row?.basisMetadata?.publicationEligible !== false && forward && (!row.contractMonth || monthSource.includes('missing') || monthSource.includes('mismatch'));
  }), [preview]);

  const chooseFile = async (nextFile) => {
    setError(null);
    setPreview(null);
    setFile(nextFile || null);
    setFileBase64(nextFile ? await readFileAsBase64(nextFile) : '');
  };
  const prepare = async () => {
    if (!file || !fileBase64) return;
    setBusy(true); setError(null);
    try { setPreview(await previewMarketReport({ fileBase64, fileName: file.name, documentType })); }
    catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview || !fileBase64) return;
    setBusy(true); setError(null);
    try {
      await importMarketReport({
        fileBase64,
        fileName: file.name,
        documentType,
        entitlementConfirmed,
        idempotencyKey: `${crypto.randomUUID()}:${preview.sourceHash.slice(0, 24)}`,
      });
      onImported();
      onClose();
    } catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Import market report" description="FCOS extracts only configured symbols and stores structured observations, not the PDF or report text." width="large" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>{preview ? <Button variant="primary" onClick={save} disabled={busy || !entitlementConfirmed || importBlockers.length > 0}>{busy ? 'Importing...' : `Import ${preview.observationCount} values`}</Button> : <Button variant="primary" onClick={prepare} disabled={busy || !file}>{busy ? 'Reading...' : 'Review values'}</Button>}</>}>
      {error ? <InlineError error={error} /> : null}
      <section className="app-form-section">
        <div className="app-form-grid app-form-grid--2">
          <Field label="Report type"><Select value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPreview(null); }}><option value="bunkerwire">Bunkerwire</option><option value="european_marketscan">European Marketscan</option></Select></Field>
          <Field label="PDF report"><input ref={inputRef} className="app-input" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseFile(event.target.files?.[0]).catch(setError)} /></Field>
        </div>
        <div className="app-callout app-callout--neutral"><Info size={15} /> Import is deterministic. FCOS never asks AI to choose, adjust, or approve a market price.</div>
        <div className="app-callout app-callout--neutral"><Info size={15} /><span>Normal ingestion is hourly from the licensed Drive folders: <a href="https://drive.google.com/drive/folders/19ACtDV2U9_JrV_AmRJuHL7A29-Yxini7" target="_blank" rel="noreferrer">Bunkerwire</a> · <a href="https://drive.google.com/drive/folders/14uXNTTleIO2K78gTEVDEAl8IfJZH4Aj1" target="_blank" rel="noreferrer">European Marketscan</a>. Upload the complete PDF to its matching folder; use this form only for immediate ingestion.</span></div>
      </section>
      {preview ? <section className="app-form-section">
        <div className="app-form-section__title">Review · {formatDate(preview.reportDate)}</div>
        <div className="market-import-summary"><strong>{preview.observationCount} numeric values detected</strong><span>{preview.publishedNaSymbols?.length ? `${preview.publishedNaSymbols.length} explicitly published N/A: ${preview.publishedNaSymbols.join(', ')}` : 'No configured symbol is explicitly published N/A.'}</span><span>{preview.missingSymbols.length ? `${preview.missingSymbols.length} configured symbols not detected: ${preview.missingSymbols.join(', ')}` : 'No configured symbol is genuinely missing.'}</span></div>
        {importBlockers.length ? <div className="app-callout app-callout--warning"><AlertTriangle size={15} /> Import is blocked because {importBlockers.map((row) => row.sourceSymbol).join(', ')} has no unambiguous printed/validated contract month.</div> : null}
        <div className="market-import-rows">{preview.observations.map((row) => <div key={row.sourceSymbol}><strong>{row.sourceSymbol}</strong><span>{formatMoney(row.price, { digits: String(row.unit).toUpperCase() === 'USD/BBL' ? 3 : 2 })} {row.unit || 'Unit unavailable'}</span>{row?.basisMetadata?.publicationEligible === false ? <StatusBadge tone="warning">Non-publication reprint · evidence only</StatusBadge> : null}<small>{[row.tenor ? String(row.tenor).toUpperCase() : null, row.printedContractMonth || row.contractMonth, row.assessmentSession, row.sourcePage ? `page ${row.sourcePage}` : null].filter(Boolean).join(' · ') || 'Spot assessment'}</small><small>{row.dayChange == null ? 'No daily change' : `${row.dayChange >= 0 ? '+' : ''}${row.dayChange.toFixed(3)}`}</small></div>)}</div>
        {(preview.availabilityEvidence || []).length ? <div className="market-import-rows">{preview.availabilityEvidence.map((row) => <div key={`availability:${row.sourceSymbol}`}><strong>{row.sourceSymbol}</strong><StatusBadge tone={row.status === 'published_na' ? 'warning' : 'neutral'}>{row.status === 'published_na' ? 'Published N/A' : 'Not detected'}</StatusBadge><small>{[row.tenor ? String(row.tenor).toUpperCase() : null, row.printedContractMonth || row.contractMonth, row.assessmentSession, row.sourcePage ? `page ${row.sourcePage}` : null].filter(Boolean).join(' · ') || 'Configured report symbol'}</small><small>No zero, estimate, or carried-forward value will be created.</small></div>)}</div> : null}
        <label className="app-check"><input type="checkbox" checked={entitlementConfirmed} onChange={(event) => setEntitlementConfirmed(event.target.checked)} /><span>I confirm FCOS is licensed to store these structured market observations for internal use.</span></label>
      </section> : null}
    </Drawer>
  );
}

export function MarketIntelligenceWorkspace({ data, settings, canManageMarketData = false, canManageAlertRules = false, canManageCurveCutover = false, priceEntity, verifyMonth, reload }) {
  const [tab, setTab] = useState(initialMarketTab);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([initialMarketTab()]));
  const [importOpen, setImportOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [briefRefreshKey, setBriefRefreshKey] = useState(0);
  const intelligence = data.marketIntelligence || {};
  const selectTab = (value) => {
    setVisitedTabs((current) => current.has(value) ? current : new Set([...current, value]));
    setTab(value);
  };
  return (
    <div className="app-page market-intelligence-workspace">
      <PageHeader eyebrow="Trading market intelligence" title="Markets" description="Read the daily bunker decision brief, compare delivered prices with controlled MOPS, and inspect exact contract-month curves with source lineage." actions={canManageMarketData ? <Button variant="primary" icon={FileUp} onClick={() => setImportOpen(true)}>Import report</Button> : null} />
      <div className="market-workspace-tabs" role="tablist" aria-label="Market views">{TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} className={tab === item.value ? 'is-active' : ''} onClick={() => selectTab(item.value)}>{item.label}</button>)}</div>
      {visitedTabs.has('brief') ? <div role="tabpanel" hidden={tab !== 'brief'} aria-label="Daily Decision Brief"><MarketDecisionBrief initialBrief={intelligence.brief || null} refreshKey={briefRefreshKey} /></div> : null}
      {visitedTabs.has('delivered') ? <div role="tabpanel" hidden={tab !== 'delivered'} aria-label="Delivered and MOPS"><DeliveredBunkers intelligence={intelligence} /><Panel className="market-settlement-control"><div className="app-panel-header"><div><h2>Settlement MOPS control</h2><p>Add, correct and verify the publication ledger used by monthly settlement and paper-hedge expiry. This advanced surface contains no legacy forward-adjustment input.</p></div><Button size="sm" onClick={() => setSettlementOpen((value) => !value)}>{settlementOpen ? 'Hide settlement control' : 'Open settlement control'}</Button></div>{settlementOpen ? <MarketsView embedded showLegacyForward={false} data={data} settings={settings} readOnly={!canManageMarketData} priceEntity={priceEntity} verifyMonth={verifyMonth} /> : null}</Panel></div> : null}
      {visitedTabs.has('curves') ? <div role="tabpanel" hidden={tab !== 'curves'} aria-label="Forward Curves"><MarketForwardCurves readOnly={!canManageMarketData} canManageCutover={canManageCurveCutover} /></div> : null}
      {visitedTabs.has('drivers') ? <div role="tabpanel" hidden={tab !== 'drivers'} aria-label="Drivers and Alerts"><MarketDriversAlerts readOnly={!canManageAlertRules} /></div> : null}
      {canManageMarketData ? <ReportImportDrawer open={importOpen} onClose={() => setImportOpen(false)} onImported={() => { setBriefRefreshKey((value) => value + 1); reload({ silent: true }).catch(() => {}); }} /> : null}
    </div>
  );
}
