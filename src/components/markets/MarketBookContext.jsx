import { useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

const DEFAULT_VISIBLE_ROWS = 5;

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function formatQuantity(value, unit, { absolute = false } = {}) {
  if (value == null || String(value).trim() === '') return 'Unavailable';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unavailable';
  const displayed = absolute ? Math.abs(numeric) : numeric;
  return `${displayed.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
}

function formatGeneratedAt(value) {
  if (!value) return 'Snapshot time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  }).format(date);
}

function coverageFor(row) {
  if (row?.hedgeRatio == null || String(row.hedgeRatio).trim() === '') return { label: 'No cargo', tone: 'neutral' };
  const ratio = Number(row?.hedgeRatio);
  return Number.isFinite(ratio) ? { label: `${Math.round(ratio)}%`, tone: 'neutral' } : { label: 'Unavailable', tone: 'neutral' };
}

function quantityDifference(row) {
  if (row?.netExposure == null || String(row.netExposure).trim() === '' || !Number.isFinite(Number(row.netExposure))) return 'Unavailable';
  const label = Number(row.netExposure) >= 0 ? 'uncovered' : 'excess hedge';
  return `${formatQuantity(row.netExposure, row.unit, { absolute: true })} ${label}`;
}

function warningText(warning) {
  if (typeof warning === 'string') return warning;
  return warning?.message || warning?.summary || warning?.code || 'Book coverage note';
}

export function MarketBookContext({ context = null, loading = false, error = null, onRetry = null, historical = false }) {
  const [expandedSnapshot, setExpandedSnapshot] = useState('');
  const contextRows = rows(context?.rows);
  const snapshotKey = String(context?.generatedAt || contextRows.map((row) => row?.key).filter(Boolean).join('|') || 'current-book');
  const expanded = expandedSnapshot === snapshotKey;
  const visibleRows = expanded ? contextRows : contextRows.slice(0, DEFAULT_VISIBLE_ROWS);

  if (historical) return <section className="market-book-context market-book-context--historical" aria-labelledby="market-book-context-title">
    <div className="market-book-context__header"><div><span>FCOS quantity context</span><h2 id="market-book-context-title">Your accessible book</h2></div><span className="market-book-context__state">Historical market view</span></div>
    <div className="market-book-context__historical-note"><BookOpen size={18} aria-hidden="true" /><div><strong>Current book quantities are hidden for this historical snapshot</strong><p>The market view is dated, while the accessible physical and hedge book is current operational data. Return to Latest to compare current quantities.</p></div></div>
  </section>;

  if (loading) return <section className="market-book-context" aria-labelledby="market-book-context-title" aria-busy="true">
    <div className="market-book-context__header"><div><span>FCOS quantity context</span><h2 id="market-book-context-title">Your accessible book</h2></div></div>
    <div className="market-book-context__empty"><RefreshCw className="animate-spin" size={18} aria-hidden="true" /><div><strong>Loading accessible positions</strong><span>Reading physical and hedge quantities you are allowed to view.</span></div></div>
  </section>;

  if (error) return <section className="market-book-context" aria-labelledby="market-book-context-title">
    <div className="market-book-context__header"><div><span>FCOS quantity context</span><h2 id="market-book-context-title">Your accessible book</h2></div></div>
    <div className="market-book-context__error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><strong>Book context is unavailable</strong><span>{error?.message || 'The accessible position snapshot could not be loaded.'}</span></div>{onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}</div>
  </section>;

  return <section className="market-book-context" aria-labelledby="market-book-context-title">
    <div className="market-book-context__header">
      <div><span>FCOS quantity context</span><h2 id="market-book-context-title">Your accessible book</h2><p>Quantity coverage only. Products remain in their native units and are never summed across units.</p></div>
      <div className="market-book-context__totals" aria-label="Accessible position counts"><span><strong>{context?.totals?.openPhysicalCount ?? 0}</strong> open physicals</span><span><strong>{context?.totals?.liveHedgeCount ?? 0}</strong> live hedges</span></div>
    </div>

    {contextRows.length ? <div className="market-book-context__table-frame">
      <table className="market-book-context__table">
        <thead><tr><th>Counterparty / product</th><th>Physical quantity</th><th>Hedge quantity</th><th>Coverage</th><th>Quantity difference</th></tr></thead>
        <tbody>{visibleRows.map((row, index) => {
          const coverage = coverageFor(row);
          return <tr key={row?.key || `${row?.counterparty || 'counterparty'}:${row?.product || 'product'}:${row?.unit || 'unit'}:${index}`}>
            <th scope="row"><strong>{row?.counterparty || 'Unassigned'}</strong><span>{row?.product || 'Product unavailable'} · {row?.unit || 'Unit unavailable'}</span></th>
            <td data-label="Physical quantity">{formatQuantity(row?.physicalQty, row?.unit)}</td>
            <td data-label="Hedge quantity">{formatQuantity(row?.hedgeQty, row?.unit)}</td>
            <td data-label="Coverage"><span className={`market-book-context__coverage market-book-context__coverage--${coverage.tone}`}>{coverage.label}</span></td>
            <td data-label="Quantity difference">{quantityDifference(row)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <div className="market-book-context__empty"><BookOpen size={18} aria-hidden="true" /><div><strong>No accessible open position quantities</strong><span>Open physicals and live hedges will appear here when available.</span></div></div>}

    <div className="market-book-context__footer">
      <span>Snapshot {formatGeneratedAt(context?.generatedAt)}</span>
      <div>{contextRows.length > DEFAULT_VISIBLE_ROWS ? <button type="button" onClick={() => setExpandedSnapshot(expanded ? '' : snapshotKey)} aria-expanded={expanded}>{expanded ? 'Show first 5' : `Show all ${contextRows.length}`}</button> : null}<Link to="/hedge-desk?tab=physical">Open physicals <ArrowRight size={13} aria-hidden="true" /></Link><Link to="/hedge-desk?tab=hedges">Open hedges <ArrowRight size={13} aria-hidden="true" /></Link></div>
    </div>

    {rows(context?.warnings).length ? <details className="market-book-context__warnings"><summary><AlertTriangle size={14} aria-hidden="true" /> Coverage notes ({rows(context.warnings).length})</summary><ul>{rows(context.warnings).map((warning, index) => <li key={warning?.code || warning?.id || index}>{warningText(warning)}</li>)}</ul></details> : null}
  </section>;
}
