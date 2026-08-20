import { useMemo, useRef, useState } from 'react';
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { importMarketReport, previewMarketReport } from '@/hedge/api/marketData';
import { formatDate, formatMoney } from '@/hedge/lib/domain';
import {
  Button,
  Drawer,
  Field,
  InlineError,
  Metric,
  PageHeader,
  Panel,
  SegmentedControl,
  Select,
  StatusBadge,
} from '@/hedge/components/ui';
import { MarketsView } from './MarketsView';

const TABS = [
  { value: 'delivered', label: 'Delivered Bunkers' },
  { value: 'cargo', label: 'Cargo & Forward' },
  { value: 'signals', label: 'Trading Signals' },
];

const PRODUCTS = [
  { value: 'vlsfo', label: 'VLSFO 0.5%', color: '#2563eb' },
  { value: 'hsfo380', label: 'HSFO 380', color: '#d97706' },
  { value: 'lsmgo', label: 'LSMGO 0.1%', color: '#0f766e' },
];

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

function DeliveredTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="app-chart-tooltip">
      <strong>{formatDate(label)}</strong>
      {payload.filter((item) => item.value != null).map((item) => (
        <span key={item.dataKey} style={{ color: item.color }}>{item.name}: {formatMoney(item.value, { digits: 2 })} USD/MT</span>
      ))}
    </div>
  );
}

function DeliveredBunkers({ intelligence }) {
  const [product, setProduct] = useState('vlsfo');
  const delivered = intelligence?.delivered || [];
  const productRows = delivered.filter((row) => row.productKey === product);
  const chartData = useMemo(() => {
    const dates = [...new Set(productRows.flatMap((row) => row.history.map((item) => item.priceDate)))].sort();
    return dates.map((date) => Object.fromEntries([
      ['date', date],
      ...productRows.map((row) => [row.portKey, row.history.find((item) => item.priceDate === date)?.price ?? null]),
    ]));
  }, [productRows]);
  const ports = [...new Map(delivered.map((row) => [row.portKey, row.portLabel])).entries()];

  if (!intelligence?.available) {
    return <Panel><div className="market-empty-inline"><RefreshCw size={20} /><div><strong>Delivered-price storage is not deployed yet</strong><span>The MOPS market remains available. Apply the reviewed service-only migration to enable delivered data.</span></div></div></Panel>;
  }

  return (
    <div className="market-intelligence-stack">
      <div className="app-metric-grid app-metric-grid--4">
        {PRODUCTS.map((item) => {
          const values = delivered.filter((row) => row.productKey === item.value && row.latest?.price != null);
          const latestDate = values.map((row) => row.latest.priceDate).sort().at(-1);
          return <Metric key={item.value} label={`${item.label} coverage`} value={`${values.length} ports`} detail={latestDate ? `Latest ${formatDate(latestDate)}` : 'No observation loaded'} tone={item.value === 'vlsfo' ? 'blue' : item.value === 'hsfo380' ? 'orange' : 'teal'} icon={Ship} />;
        })}
        <Metric label="Market basis" value="Delivered" detail="Never used for MOPS settlement" tone="green" icon={Scale} />
      </div>

      <Panel className="market-matrix-panel">
        <div className="app-panel-header">
          <div><h2>Major-port delivered prices</h2><p>USD/MT. Posted and assessed values remain visibly distinct.</p></div>
          <StatusBadge tone="neutral">5 ports · 3 products</StatusBadge>
        </div>
        <div className="market-matrix-scroll">
          <table className="market-matrix">
            <thead><tr><th>Port</th>{PRODUCTS.map((item) => <th key={item.value}>{item.label}</th>)}</tr></thead>
            <tbody>{ports.map(([portKey, portLabel]) => (
              <tr key={portKey}>
                <th>{portLabel}</th>
                {PRODUCTS.map((item) => {
                  const row = delivered.find((entry) => entry.portKey === portKey && entry.productKey === item.value);
                  return (
                    <td key={item.value}>
                      <div className="market-price-cell">
                        <div className="market-price-cell__top">
                          <strong>{row?.latest?.price == null ? '—' : formatMoney(row.latest.price, { digits: 2 })}</strong>
                          {row?.aliasLabel ? <span className="market-alias-label">{row.aliasLabel}</span> : null}
                        </div>
                        <div className="market-price-cell__meta">
                          <StatusBadge tone={sourceTone(row?.sourceType)}>{sourceLabel(row?.sourceType || 'unavailable')}</StatusBadge>
                          {row?.latest?.dayChange != null ? <span className={row.latest.dayChange >= 0 ? 'is-up' : 'is-down'}>{row.latest.dayChange >= 0 ? '+' : ''}{row.latest.dayChange.toFixed(2)}</span> : null}
                        </div>
                        <small>{row?.sourceSymbol || 'No exact symbol'}{row?.latest?.stale ? ` · ${row.latest.staleDays}d old` : ''}</small>
                        {row?.deliveredPremium != null ? <small>Premium vs SG cargo {row.deliveredPremium >= 0 ? '+' : ''}{row.deliveredPremium.toFixed(2)}</small> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="app-callout app-callout--neutral"><Info size={15} /> Kaohsiung uses CPC posted terminology: VLSFO is labelled <strong>LS180</strong>; <strong>MF-380</strong> is mapped to HSFO 380.</div>
      </Panel>

      <Panel className="app-chart-panel market-delivered-chart">
        <div className="app-panel-header">
          <div><h2>Delivered-price trend</h2><p>Compare like-for-like products across ports; no currency or unit conversion is applied.</p></div>
          <SegmentedControl label="Product" value={product} onChange={setProduct} options={PRODUCTS} />
        </div>
        {chartData.length ? <div className="app-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 22, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#e8ecef" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fill: '#738091', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#738091', fontSize: 11 }} axisLine={false} tickLine={false} width={54} domain={['auto', 'auto']} />
              <Tooltip content={<DeliveredTooltip />} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {productRows.map((row, index) => <Line key={row.portKey} type="monotone" dataKey={row.portKey} name={row.portLabel} stroke={PORT_COLORS[index % PORT_COLORS.length]} strokeWidth={2} dot={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer>
        </div> : <div className="market-empty-inline"><LineChartIcon size={20} /><div><strong>No {PRODUCTS.find((item) => item.value === product)?.label} history yet</strong><span>Import a licensed report to populate the trend.</span></div></div>}
      </Panel>
    </div>
  );
}

function CargoForwardSummary({ intelligence }) {
  const rows = intelligence?.cargoForward || [];
  if (!rows.length) return null;
  return (
    <Panel className="market-forward-summary">
      <div className="app-panel-header"><div><h2>Cargo and forward reference</h2><p>Reference only. MOPS entries below remain the authoritative hedge-settlement inputs.</p></div></div>
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

function TradingSignals({ intelligence }) {
  const delivered = intelligence?.delivered || [];
  const [portKey, setPortKey] = useState('singapore');
  const [productKey, setProductKey] = useState('vlsfo');
  const [quote, setQuote] = useState('');
  const benchmark = delivered.find((row) => row.portKey === portKey && row.productKey === productKey);
  const quoteDifference = quote !== '' && benchmark?.latest?.price != null ? Number(quote) - benchmark.latest.price : null;
  const alerts = intelligence?.signals?.alerts || [];

  return (
    <div className="market-intelligence-stack">
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
          <span>VLSFO forward structure</span>
          <strong>{intelligence?.signals?.forwardStructure?.label || 'Unavailable'}</strong>
          <small>{intelligence?.signals?.forwardStructure ? `BM/M1 ${intelligence.signals.forwardStructure.bmM1 >= 0 ? '+' : ''}${intelligence.signals.forwardStructure.bmM1.toFixed(2)} · M1/M2 ${intelligence.signals.forwardStructure.m1M2 == null ? '—' : intelligence.signals.forwardStructure.m1M2.toFixed(2)}` : 'Import forward observations'}</small>
        </Panel>
        <Panel className="market-signal-card">
          <div className="market-signal-card__icon"><Scale size={18} /></div>
          <span>VLSFO - HSFO 380 M1</span>
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
    <Drawer open={open} onClose={onClose} title="Import market report" description="FCOS extracts only configured symbols and stores structured observations, not the PDF or report text." width="large" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>{preview ? <Button variant="primary" onClick={save} disabled={busy || !entitlementConfirmed}>{busy ? 'Importing...' : `Import ${preview.observationCount} values`}</Button> : <Button variant="primary" onClick={prepare} disabled={busy || !file}>{busy ? 'Reading...' : 'Review values'}</Button>}</>}>
      {error ? <InlineError error={error} /> : null}
      <section className="app-form-section">
        <div className="app-form-grid app-form-grid--2">
          <Field label="Report type"><Select value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPreview(null); }}><option value="bunkerwire">Bunkerwire</option><option value="european_marketscan">European Marketscan</option></Select></Field>
          <Field label="PDF report"><input ref={inputRef} className="app-input" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseFile(event.target.files?.[0]).catch(setError)} /></Field>
        </div>
        <div className="app-callout app-callout--neutral"><Info size={15} /> Import is deterministic. FCOS never asks AI to choose, adjust, or approve a market price.</div>
      </section>
      {preview ? <section className="app-form-section">
        <div className="app-form-section__title">Review · {formatDate(preview.reportDate)}</div>
        <div className="market-import-summary"><strong>{preview.observationCount} values detected</strong><span>{preview.missingSymbols.length ? `${preview.missingSymbols.length} configured symbols missing: ${preview.missingSymbols.join(', ')}` : 'All configured symbols detected.'}</span></div>
        <div className="market-import-rows">{preview.observations.map((row) => <div key={row.sourceSymbol}><strong>{row.sourceSymbol}</strong><span>{formatMoney(row.price, { digits: 3 })}</span><small>{row.dayChange == null ? 'No daily change' : `${row.dayChange >= 0 ? '+' : ''}${row.dayChange.toFixed(3)}`}</small></div>)}</div>
        <label className="app-check"><input type="checkbox" checked={entitlementConfirmed} onChange={(event) => setEntitlementConfirmed(event.target.checked)} /><span>I confirm FCOS is licensed to store these structured market observations for internal use.</span></label>
      </section> : null}
    </Drawer>
  );
}

export function MarketIntelligenceWorkspace({ data, settings, readOnly, priceEntity, verifyMonth, reload }) {
  const [tab, setTab] = useState('delivered');
  const [importOpen, setImportOpen] = useState(false);
  const intelligence = data.marketIntelligence || {};
  return (
    <div className="app-page market-intelligence-workspace">
      <PageHeader eyebrow="Trading market intelligence" title="Markets" description="Separate delivered bunker indications, cargo and forward references, and decision signals without changing MOPS settlement." actions={!readOnly ? <Button variant="primary" icon={FileUp} onClick={() => setImportOpen(true)}>Import report</Button> : null} />
      <div className="market-workspace-tabs" role="tablist" aria-label="Market views">{TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} className={tab === item.value ? 'is-active' : ''} onClick={() => setTab(item.value)}>{item.label}</button>)}</div>
      {tab === 'delivered' ? <DeliveredBunkers intelligence={intelligence} /> : null}
      {tab === 'cargo' ? <><CargoForwardSummary intelligence={intelligence} /><MarketsView embedded data={data} settings={settings} readOnly={readOnly} priceEntity={priceEntity} verifyMonth={verifyMonth} /></> : null}
      {tab === 'signals' ? <TradingSignals intelligence={intelligence} /> : null}
      {!readOnly ? <ReportImportDrawer open={importOpen} onClose={() => setImportOpen(false)} onImported={() => reload({ silent: true }).catch(() => {})} /> : null}
    </div>
  );
}
