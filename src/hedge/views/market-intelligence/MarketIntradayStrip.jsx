import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ClipboardPaste, Info, RefreshCw } from 'lucide-react';
import { loadMarketIntradayTimeline, previewMarketIntradaySnapshot, saveMarketIntradaySnapshot } from '@/hedge/api/marketData';
import { Button, Drawer, Field, InlineError, Panel, Select, StatusBadge } from '@/hedge/components/ui';

const PRODUCT_OPTIONS = [
  ['hsfo380', 'HSFO 380', 'USD/MT'],
  ['vlsfo', 'S0.5%', 'USD/MT'],
  ['lsmgo', 'SGO 10 ppm', 'USD/BBL'],
  ['brent', 'ICE Brent', 'USD/BBL'],
  ['ice_gasoil', 'ICE Gasoil', 'USD/MT'],
];
const PRODUCT_META = Object.fromEntries(PRODUCT_OPTIONS.map(([key, label, unit]) => [key, { label, unit }]));

function todayHkt() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function localReceiptTime() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatTimestamp(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong', timeZoneName: 'short' }).format(date);
}

function formatValue(value, unit, signed = false) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  const sign = signed && amount > 0 ? '+' : '';
  return `${sign}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} ${unit}`;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function editableRows(preview) {
  return (preview?.observations || []).map((row) => ({
    productKey: row.productKey || '',
    quoteState: row.quoteState || (preview.sourceType === 'asia_moc_reference' ? 'moc_reference' : 'current_indication'),
    contractMonth: String(row.contractMonth || row.contractMonthText || '').slice(0, 7),
    price: row.price ?? row.priceText ?? '',
    reportedChange: row.reportedChange ?? row.reportedChangeText ?? '',
    decimalPrecision: Number.isInteger(Number(row.decimalPrecision)) ? Number(row.decimalPrecision) : 2,
    unit: row.unit || PRODUCT_META[row.productKey]?.unit || '',
  }));
}

function CaptureDrawer({ open, mode, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [receivedAt, setReceivedAt] = useState(localReceiptTime);
  const [preview, setPreview] = useState(null);
  const [marketDate, setMarketDate] = useState(todayHkt);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const sourceType = mode === 'morning' ? 'morning_indication' : 'asia_moc_reference';

  useEffect(() => {
    if (!open) return;
    setFile(null); setText(''); setPreview(null); setRows([]); setMarketDate(todayHkt()); setReceivedAt(localReceiptTime()); setError(null);
  }, [open, mode]);

  const prepare = async () => {
    setBusy(true); setError(null);
    try {
      const payload = { sourceType, receivedAt: new Date(receivedAt).toISOString() };
      if (sourceType === 'morning_indication') {
        if (!file) throw new Error('Choose a morning PNG, JPEG or WebP image.');
        payload.imageBase64 = await readImage(file);
        payload.mimeType = file.type;
      } else {
        if (!text.trim()) throw new Error('Paste the MOC reference.');
        payload.text = text;
      }
      const result = await previewMarketIntradaySnapshot(payload);
      setPreview(result);
      setMarketDate(result.marketDate || todayHkt());
      setRows(editableRows(result));
    } catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  };

  const updateRow = (index, key, value) => setRows((current) => current.map((row, rowIndex) => {
    if (rowIndex !== index) return row;
    if (key === 'productKey') return { ...row, productKey: value, unit: PRODUCT_META[value]?.unit || row.unit };
    return { ...row, [key]: value };
  }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await saveMarketIntradaySnapshot({
        previewToken: preview.previewToken,
        sourceType,
        marketDate,
        receivedAt: new Date(receivedAt).toISOString(),
        observations: rows.map((row) => ({ ...row, contractMonth: `${row.contractMonth}-01`, decimalPrecision: Number(row.decimalPrecision) })),
        idempotencyKey: `market-intraday:${crypto.randomUUID()}`,
      });
      onSaved(result.timeline);
      onClose();
    } catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  };

  const addRow = () => setRows((current) => [...current, { productKey: 'hsfo380', quoteState: sourceType === 'morning_indication' ? 'current_indication' : 'moc_reference', contractMonth: marketDate.slice(0, 7), price: '', reportedChange: '', decimalPrecision: 2, unit: 'USD/MT' }]);
  const valid = Boolean(preview && marketDate && rows.length && rows.every((row) => row.productKey && /^\d{4}-\d{2}$/.test(row.contractMonth) && Number(row.price) > 0));

  return (
    <Drawer open={open} onClose={onClose} title={mode === 'morning' ? 'Review morning paper indication' : 'Review Asia MOC reference'} description="FCOS stores only the values you review below. Source images, pasted text, prompts and raw AI responses are not retained." width="large" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>{preview ? <Button variant="primary" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Confirm provisional snapshot'}</Button> : <Button variant="primary" onClick={prepare} disabled={busy}>{busy ? 'Extracting…' : 'Review values'}</Button>}</>}>
      {error ? <InlineError error={error} /> : null}
      <section className="app-form-section">
        <div className="app-form-grid app-form-grid--2">
          <Field label="Actual receipt time"><input className="app-input" type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></Field>
          {sourceType === 'morning_indication'
            ? <Field label="Morning image"><input ref={inputRef} className="app-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} /></Field>
            : <Field label="MOC reference"><textarea className="app-input market-intraday-source-text" rows={7} value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder="Paste the complete MOC reference" /></Field>}
        </div>
        <div className="app-callout app-callout--neutral"><Info size={15} /> 180 CST is ignored. Every extracted value remains provisional and requires confirmation.</div>
      </section>
      {preview ? <section className="app-form-section">
        <div className="app-form-section__title">Review every value</div>
        <div className="app-form-grid app-form-grid--2">
          <Field label="Market date"><input className="app-input" type="date" value={marketDate} onChange={(event) => setMarketDate(event.target.value)} /></Field>
          <Field label="Source classification"><input className="app-input" readOnly value={sourceType === 'morning_indication' ? 'Morning indication · provisional' : 'Asia MOC reference · provisional (16:30 Singapore)'} /></Field>
        </div>
        {(preview.warnings || []).map((warning) => <div key={warning} className="app-callout app-callout--warning">{warning}</div>)}
        {(preview.ignoredRows || []).map((row, index) => <div key={`${row.label}:${index}`} className="app-callout app-callout--neutral"><strong>{row.label}</strong> ignored · {row.reason}</div>)}
        <div className="market-intraday-review-rows">
          {rows.map((row, index) => <div key={`${index}:${row.productKey}:${row.quoteState}`} className="market-intraday-review-row">
            <Field label="Product"><Select value={row.productKey} onChange={(event) => updateRow(index, 'productKey', event.target.value)}>{PRODUCT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
            {sourceType === 'morning_indication' ? <Field label="Quote"><Select value={row.quoteState} onChange={(event) => updateRow(index, 'quoteState', event.target.value)}><option value="last_close">Last close</option><option value="current_indication">Current indication</option></Select></Field> : null}
            <Field label="Contract"><input className="app-input" type="month" value={row.contractMonth} onChange={(event) => updateRow(index, 'contractMonth', event.target.value)} /></Field>
            <Field label="Price"><input className="app-input" inputMode="decimal" value={row.price} onChange={(event) => updateRow(index, 'price', event.target.value)} /></Field>
            <Field label="Change vs prior close"><input className="app-input" inputMode="decimal" value={row.reportedChange ?? ''} onChange={(event) => updateRow(index, 'reportedChange', event.target.value)} /></Field>
            <Field label="Unit"><input className="app-input" readOnly value={row.unit} /></Field>
            <Button size="sm" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button>
          </div>)}
        </div>
        <Button size="sm" onClick={addRow}>Add row</Button>
      </section> : null}
    </Drawer>
  );
}

function SnapshotColumn({ snapshot, title }) {
  return <section className="market-intraday-column">
    <div className="market-intraday-column__header"><div><strong>{title}</strong><span>{snapshot ? `Received ${formatTimestamp(snapshot.receivedAt)}` : 'Not received'}</span></div><StatusBadge tone={snapshot ? 'warning' : 'neutral'}>{snapshot ? 'Provisional' : 'Missing'}</StatusBadge></div>
    {snapshot ? <div className="market-intraday-observation-list">{snapshot.observations.map((row) => <article key={row.id}>
      <div><strong>{row.productLabel}</strong><span>{row.contractMonth.slice(0, 7)} · {row.quoteState === 'last_close' ? 'Last close' : row.quoteState === 'moc_reference' ? 'MOC 16:30' : 'Current'}</span></div>
      <div><strong>{formatValue(row.price, row.unit)}</strong><span>{row.reportedChange == null ? 'No supplied change' : `${formatValue(row.reportedChange, row.unit, true)} vs prior published close`}</span></div>
      {row.reconciliation ? <StatusBadge tone={row.reconciliation.status === 'matched' ? 'positive' : row.reconciliation.status === 'revised_by_official' ? 'warning' : 'neutral'}>{row.reconciliation.status === 'matched' ? 'Matched official report' : row.reconciliation.status === 'revised_by_official' ? `Official revision ${formatValue(row.reconciliation.difference, row.unit, true)}` : 'Official mark unavailable'}</StatusBadge> : null}
    </article>)}</div> : <p className="market-intraday-empty">No reviewed {title.toLowerCase()} is stored for this date.</p>}
  </section>;
}

export function MarketIntradayStrip({ canManage = false, refreshKey = 0 }) {
  const [date, setDate] = useState(todayHkt);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [capture, setCapture] = useState(null);
  const load = useCallback(async (nextDate = date, force = false) => {
    setLoading(true); setError(null);
    try { setData(await loadMarketIntradayTimeline({ date: nextDate }, { force })); setDate(nextDate); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(date).catch(() => {}); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const morning = data?.snapshots?.find((row) => row.sourceType === 'morning_indication') || null;
  const moc = data?.snapshots?.find((row) => row.sourceType === 'asia_moc_reference') || null;
  const movementRows = useMemo(() => (data?.morningToMoc || []).filter((row) => row.available), [data]);
  return <>
    <Panel className="market-intraday-strip">
      <div className="app-panel-header market-intraday-strip__header"><div><h2>Intraday paper market</h2><p>Reviewed morning indications and Asia 16:30 MOC references. Official MOPS is unchanged.</p></div><div className="market-panel-actions">
        <Button size="sm" icon={ArrowLeft} disabled={!data?.previousDate || loading} onClick={() => load(data.previousDate)}>Previous</Button>
        <label className="market-intraday-date"><span>Market date</span><input className="app-input" type="date" value={date} onChange={(event) => load(event.target.value)} /></label>
        <Button size="sm" icon={ArrowRight} disabled={!data?.nextDate || loading} onClick={() => load(data.nextDate)}>Next</Button>
        <Button size="sm" icon={RefreshCw} disabled={loading} onClick={() => load(date, true)}>{loading ? 'Loading…' : 'Refresh'}</Button>
        {canManage ? <><Button size="sm" icon={Camera} onClick={() => setCapture('morning')}>Upload morning image</Button><Button size="sm" variant="primary" icon={ClipboardPaste} onClick={() => setCapture('moc')}>Paste MOC reference</Button></> : null}
      </div></div>
      {error ? <InlineError error={error} /> : null}
      <div className="market-intraday-columns"><SnapshotColumn snapshot={morning} title="Morning indication" /><SnapshotColumn snapshot={moc} title="Asia MOC reference" /></div>
      {(movementRows.length > 0 || (data?.structures || []).length > 0 || (data?.provisionalEstimates || []).some((row) => row.available)) ? <div className="market-intraday-derived">
        {movementRows.map((row) => <span key={`move:${row.productKey}:${row.contractMonth}`}><strong>{row.productLabel} morning → MOC</strong> {formatValue(row.movement, row.unit, true)}</span>)}
        {(data.structures || []).map((row) => <span key={`structure:${row.snapshotId}:${row.productKey}`}><strong>{row.productLabel} · {row.sourceType === 'asia_moc_reference' ? 'MOC' : 'Morning'}</strong> {row.bmM1 != null ? `BM−M1 ${formatValue(row.bmM1, row.unit, true)}` : ''}{row.bmM1 != null && row.m1M2 != null ? ' · ' : ''}{row.m1M2 != null ? `M1−M2 ${formatValue(row.m1M2, row.unit, true)}` : 'Structure unavailable'}</span>)}
        {(data.provisionalEstimates || []).filter((row) => row.available).map((row) => <span key={`estimate:${row.snapshotId}:${row.productKey}`}><strong>{row.productLabel} provisional month estimate</strong> {formatValue(row.value, row.unit)}</span>)}
      </div> : null}
      <div className="app-callout app-callout--neutral"><Info size={15} /> MOC is an assessment process, not an arithmetic formula. These reviewed references never replace official reports, MOPS settlement evidence, or automatic curve marks.</div>
    </Panel>
    <CaptureDrawer open={Boolean(capture)} mode={capture} onClose={() => setCapture(null)} onSaved={(timeline) => { setData(timeline); setDate(timeline.displayedDate); }} />
  </>;
}
