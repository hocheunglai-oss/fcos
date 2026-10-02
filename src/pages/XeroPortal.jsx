import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSearch, Loader2, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { appClient } from '@/api/appClient';
import { amountText, differenceEntries, formatDate, formatDateTime, kindLabel, normaliseObjectValues, safeExternalUrl, statusLabel, statusTone, XERO_INTEGRITY_KINDS, XERO_INTEGRITY_STATUSES } from '@/lib/xeroIntegrityUi';
import './XeroPortal.css';

const DEFAULT_FILTERS = { from: '2026-01-01', to: '', search: '', status: 'all', kind: 'all' };
const METRICS = [['checked', 'Checked'], ['matched', 'Matched'], ['missing', 'Missing in Xero'], ['mismatched', 'Mismatched'], ['blocked', 'Blocked'], ['uncertain', 'Uncertain'], ['unverified', 'Unverified']];

export default function XeroPortal() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const debouncedSearch = useDebouncedValue(filters.search, 275);
  const requestFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [debouncedSearch, filters.from, filters.kind, filters.status, filters.to]);

  const loadReport = useCallback(async ({ force = false } = {}) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setReport(null);
    if (force) setRefreshing(true);
    setError('');
    try {
      const result = await appClient.functions.invoke('xeroIntegrityReport', {
        from: requestFilters.from || '2026-01-01', to: requestFilters.to || null, search: requestFilters.search.trim(), status: requestFilters.status, kind: requestFilters.kind,
        page, pageSize: 25, historyPage, historyPageSize: 20,
      }, { force, cache: !force, cacheTtlMs: 15000 });
      if (requestId !== requestSequence.current) return;
      const requestError = result?.data?.error || result?.error?.message;
      if (requestError) throw new Error(requestError);
      if (!result?.data || result.data.schemaVersion !== 1) throw new Error('The integrity report returned an unsupported result. Please refresh saved evidence.');
      setReport(result.data);
    } catch (requestError) {
      if (requestId === requestSequence.current) setError(requestError?.message || 'The saved integrity report could not be loaded.');
    } finally {
      if (requestId === requestSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [historyPage, page, requestFilters]);

  useEffect(() => { void loadReport(); }, [loadReport]);
  useEffect(() => () => { requestSequence.current += 1; }, []);

  function updateFilters(next) {
    requestSequence.current += 1;
    setReport(null);
    setError('');
    setLoading(true);
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
    setHistoryPage(1);
  }

  const statusClass = (status) => `xi-status xi-status--${statusTone(status)}`;
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const history = Array.isArray(report?.history) ? report.history : [];
  const pagination = report?.pagination || {};
  const historyPagination = report?.historyPagination || {};

  return <main className="space-y-5 px-4 py-5 lg:px-6" aria-busy={loading || refreshing}>
    <section className="xi-header">
      <div><div className="flex items-center gap-2 text-sm font-medium text-primary"><ShieldCheck className="h-4 w-4" /> Read-only evidence</div><h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Salesforce–Xero integrity</h1><p className="xi-description">This portal reports saved comparison evidence. Reviews, approvals, corrections and sync are handled through the Codex FCOS project.</p></div>
      <Button type="button" variant="outline" onClick={() => void loadReport({ force: true })} disabled={loading || refreshing} aria-label="Refresh evidence">{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh evidence</Button>
    </section>

    <section className="xi-card" aria-label="Evidence filters"><div className="xi-filter-grid">
      <label className="xi-field"><span>From date</span><Input type="date" value={filters.from} onChange={(event) => updateFilters({ from: event.target.value })} /></label>
      <label className="xi-field"><span>To date</span><Input type="date" value={filters.to} onChange={(event) => updateFilters({ to: event.target.value })} /></label>
      <label className="xi-field xi-field--search"><span>Search records</span><span className="relative"><Search className="xi-search-icon" /><Input value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="STEM, document, account or reason" /></span></label>
      <label className="xi-field"><span>Status</span><Select value={filters.status} onValueChange={(status) => updateFilters({ status })}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>{XERO_INTEGRITY_STATUSES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
      <label className="xi-field"><span>Record type</span><Select value={filters.kind} onValueChange={(kind) => updateFilters({ kind })}><SelectTrigger aria-label="Record type"><SelectValue /></SelectTrigger><SelectContent>{XERO_INTEGRITY_KINDS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
    </div><p className="xi-filter-note">Document evidence uses the buyer invoice delivery date; payment evidence uses its payment date. Contacts are included across all dates.</p></section>

    {error && <div className="xi-error" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" /><div><strong>Saved evidence is unavailable.</strong><p>{error}</p></div><Button type="button" size="sm" variant="outline" onClick={() => void loadReport({ force: true })}>Retry</Button></div>}

    {loading && !report ? <StateBlock icon={Loader2} title="Loading saved integrity evidence" description="No provider action is being started." /> : !report ? <StateBlock icon={AlertTriangle} title="Saved evidence is unavailable" description="Retry to load the current saved evidence scope." /> : <>
      <section aria-labelledby="integrity-overview-heading"><div className="xi-section-heading"><div><h2 id="integrity-overview-heading">Integrity overview</h2><p>Counts cover saved comparison evidence in the selected scope, not the full Salesforce or Xero population.</p></div><p className="xi-checked">Generated {formatDateTime(report.generatedAt)}</p></div><div className="xi-metric-grid">{METRICS.map(([key, label]) => <MetricCard key={key} label={label} value={report.metrics?.[key]} />)}</div></section>

      <section className="xi-grid" aria-label="Coverage and currency comparison"><article className="xi-card"><div className="xi-card-heading"><h2>Coverage</h2><p>Completeness is shown per recorded evidence source.</p></div><div className="xi-coverage-list">{(report.coverage || []).map((item) => <CoverageRow key={item.key || item.label} item={item} />)}{!(report.coverage || []).length && <p className="xi-empty-copy">No coverage record is available.</p>}</div></article><article className="xi-card"><div className="xi-card-heading"><h2>Currency comparison</h2><p>Amounts remain separate by currency.</p></div><CurrencyTable totals={report.currencyTotals} /></article></section>

      {(report.notices || []).length > 0 && <section className="xi-notices" aria-label="Evidence notices">{report.notices.map((notice, index) => <p key={`${notice}-${index}`}><AlertTriangle className="h-4 w-4" />{notice}</p>)}</section>}

      <section className="xi-card" aria-labelledby="evidence-heading"><div className="xi-section-heading"><div><h2 id="evidence-heading">Discrepancies and evidence</h2><p>Salesforce and Xero values are shown as last checked. Expand Compare values for field-level evidence.</p></div><p className="xi-checked">{formatCount(pagination.total)} record{pagination.total === 1 ? '' : 's'} in this result</p></div><div className="xi-table-wrap"><Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>STEM / account</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead>Amount</TableHead><TableHead>Last verified</TableHead><TableHead className="text-right">Links</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <EvidenceRow key={row.id} row={row} statusClass={statusClass} />)}</TableBody></Table></div>{!rows.length && <StateBlock icon={FileSearch} title="No saved evidence matches these filters" description="Change a filter or refresh the saved report." />}<Pagination label="Evidence" page={pagination.page || page} hasNext={pagination.hasNext === true} onPrevious={() => setPage((current) => Math.max(1, current - 1))} onNext={() => setPage((current) => current + 1)} /></section>

      <section className="xi-card" aria-labelledby="history-heading"><div className="xi-section-heading"><div><h2 id="history-heading">Correction history</h2><p>Recorded outcomes from work performed through the Codex FCOS project.</p></div></div><div className="xi-table-wrap"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Record</TableHead><TableHead>Batch</TableHead><TableHead>Outcome</TableHead><TableHead>Readback</TableHead><TableHead>Details</TableHead></TableRow></TableHeader><TableBody>{history.map((entry) => <HistoryRow key={entry.id} entry={entry} statusClass={statusClass} />)}</TableBody></Table></div>{!history.length && <p className="xi-empty-copy">No correction history is available for this scope.</p>}<Pagination label="History" page={historyPagination.page || historyPage} hasNext={historyPagination.hasNext === true} onPrevious={() => setHistoryPage((current) => Math.max(1, current - 1))} onNext={() => setHistoryPage((current) => current + 1)} /></section>

      <section className="xi-card" aria-labelledby="health-heading"><div className="xi-section-heading"><div><h2 id="health-heading">Sync health</h2><p>Freshness and operational evidence. This page does not initiate a sync.</p></div>{report.health?.stale ? <Badge className={statusClass('uncertain')}>Stale evidence</Badge> : <Badge className={statusClass('unverified')}>Latest evidence loaded</Badge>}</div><Health health={report.health} /><RecentRuns runs={report.health?.recentRuns} /></section>
    </>}
  </main>;
}

function MetricCard({ label, value }) { return <article className="xi-metric"><p>{label}</p><strong>{formatCount(value)}</strong>{value === null && <span>Not available from saved evidence</span>}</article>; }

function CoverageRow({ item }) { const available = item?.available === true; const complete = item?.complete === true; return <div className="xi-coverage-row"><div><p className="font-medium text-foreground">{item?.label || item?.key || 'Evidence source'}</p><p>{item?.notice || (available ? `${formatCount(item.total)} recorded item${item.total === 1 ? '' : 's'}` : 'Not available')}</p></div><div className="text-right"><Badge className={complete ? 'xi-status xi-status--emerald' : 'xi-status xi-status--amber'}>{complete ? 'Saved rows loaded' : available ? 'Partial capture' : 'Unavailable'}</Badge><p>{formatDateTime(item?.checkedAt)}</p></div></div>; }

function CurrencyTable({ totals }) { if (!Array.isArray(totals) || !totals.length) return <p className="xi-empty-copy">No comparable currency totals are available.</p>; return <div className="xi-table-wrap"><Table><TableHeader><TableRow><TableHead>Currency</TableHead><TableHead className="text-right">Salesforce</TableHead><TableHead className="text-right">Xero</TableHead><TableHead className="text-right">Difference</TableHead><TableHead className="text-right">Records</TableHead></TableRow></TableHeader><TableBody>{totals.map((total) => <TableRow key={total.currency}><TableCell className="font-medium">{total.currency || 'Unspecified'}</TableCell><TableCell className="text-right tabular-nums">{amountText(total.sourceAmount, total.currency)}</TableCell><TableCell className="text-right tabular-nums">{amountText(total.xeroAmount, total.currency)}</TableCell><TableCell className="text-right tabular-nums">{amountText(total.difference, total.currency)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(total.recordCount)}</TableCell></TableRow>)}</TableBody></Table></div>; }

function EvidenceRow({ row, statusClass }) { const sourceUrl = safeExternalUrl(row.sourceUrl, 'salesforce'); const xeroUrl = safeExternalUrl(row.xeroUrl, 'xero'); const details = differenceEntries(row.differences); return <TableRow className="align-top"><TableCell><div className="font-medium">{row.documentNumber || 'Unnamed record'}</div><div className="xi-row-meta">{kindLabel(row.kind)} · {formatDate(row.date)}</div></TableCell><TableCell><div className="font-medium">{row.stemReference || 'No STEM'}</div><div className="xi-row-meta">{row.accountName || 'No account'}</div></TableCell><TableCell><Badge className={statusClass(row.status)}>{statusLabel(row.status)}</Badge></TableCell><TableCell className="max-w-64"><p className="xi-wrap">{row.reason || 'No reason recorded'}</p>{(details.length || normaliseObjectValues(row.sourceValues).length || normaliseObjectValues(row.xeroValues).length) > 0 && <details className="xi-details"><summary>Compare values</summary><ValueComparison sourceValues={row.sourceValues} xeroValues={row.xeroValues} differences={details} /></details>}</TableCell><TableCell className="tabular-nums">{amountText(row.amount, row.currency)}</TableCell><TableCell className="xi-row-meta">{formatDateTime(row.checkedAt)}</TableCell><TableCell><div className="flex justify-end gap-1">{sourceUrl && <ExternalLinkButton href={sourceUrl} label="Open Salesforce" />}{xeroUrl && <ExternalLinkButton href={xeroUrl} label="Open Xero" />}</div></TableCell></TableRow>; }

function HistoryRow({ entry, statusClass }) { const readback = entry.readbackVerified === true; return <TableRow className="align-top"><TableCell className="xi-row-meta">{formatDateTime(entry.occurredAt)}</TableCell><TableCell><div className="font-medium">{entry.documentNumber || 'Unnamed record'}</div><div className="xi-row-meta">{kindLabel(entry.kind)}</div></TableCell><TableCell className="font-mono text-xs">{entry.batchId || 'Not recorded'}</TableCell><TableCell><Badge className={statusClass(entry.status)}>{statusLabel(entry.status)}</Badge></TableCell><TableCell>{readback ? <span className="xi-confirmed"><CheckCircle2 className="h-4 w-4" /> Confirmed</span> : <span className="xi-pending"><AlertTriangle className="h-4 w-4" /> Pending or unknown</span>}</TableCell><TableCell className="max-w-72">{(normaliseObjectValues(entry.before).length || normaliseObjectValues(entry.after).length) > 0 && <details className="xi-details"><summary>Before and after</summary><div className="xi-history-values"><ValueList title="Before" values={entry.before} /><ValueList title="After" values={entry.after} /></div></details>}{entry.notice && <p className="xi-row-meta mt-2">{entry.notice}</p>}</TableCell></TableRow>; }

function ValueComparison({ sourceValues, xeroValues, differences }) { return <div className="xi-value-comparison"><div className="xi-history-values"><ValueList title="Salesforce" values={sourceValues} /><ValueList title="Xero" values={xeroValues} /></div>{differences.length > 0 && <dl className="xi-difference-list">{differences.map((difference, index) => <div key={`${difference.field}-${index}`}><dt>{difference.field}</dt><dd><span>{difference.source}</span><span>{difference.xero}</span></dd></div>)}</dl>}</div>; }

function ValueList({ title, values }) { const entries = normaliseObjectValues(values); if (!entries.length) return <div><p className="xi-value-title">{title}</p><p className="xi-row-meta">Not available</p></div>; return <div><p className="xi-value-title">{title}</p><dl className="xi-value-list">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div>; }

function Health({ health = {} }) { const quota = health.quota || {}; return <div className="xi-health-grid"><div><span>Last checked</span><strong>{formatDateTime(health.lastCheckedAt)}</strong></div><div><span>Last successful sync</span><strong>{formatDateTime(health.lastSuccessfulSyncAt)}</strong><p>Unavailable until a global sync receipt is recorded.</p></div><div><span>Last verified correction</span><strong>{formatDateTime(health.lastConfirmedCorrectionAt)}</strong><p>Scope: verified document-correction readbacks only.</p></div><div><span>Available quota</span><strong>{quota.available === false ? 'Not available' : formatCount(quota.availableCalls)}</strong><p>{quota.observedAt ? `Observed ${formatDateTime(quota.observedAt)}` : quota.notice || ''}</p></div><div><span>Operational note</span><strong>{health.notice || 'No additional note'}</strong></div>{(health.errors || []).map((item, index) => <div key={`${item.code}-${index}`} className="xi-health-error"><XCircle className="h-4 w-4" /><div><strong>{item.code || 'Recorded error'}</strong><p>{item.message || 'No detail recorded.'}</p></div></div>)}</div>; }

function ExternalLinkButton({ href, label }) { return <a href={href} target="_blank" rel="noreferrer" className="xi-link-button" aria-label={label}><ExternalLink className="h-3.5 w-3.5" /></a>; }
function Pagination({ label, page, hasNext, onPrevious, onNext }) { return <div className="xi-pagination"><span>{label} page {page}</span><div><Button type="button" variant="outline" size="sm" onClick={onPrevious} disabled={page <= 1}>Previous</Button><Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>Next</Button></div></div>; }
function formatCount(value) { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-GB') : 'Not available'; }

function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debouncedValue;
}

function RecentRuns({ runs }) {
  if (!Array.isArray(runs) || !runs.length) return <p className="xi-empty-copy">No recent saved run metadata is available.</p>;
  const modes = { preview: 'Comparison snapshot', document_apply: 'Document run', payment_apply: 'Payment run' };
  const states = { ready_for_review: 'Awaiting review', authorised: 'Approved', processing: 'In progress', completed: 'Completed', partial: 'Partial', failed: 'Failed', building: 'Preparing', cancelled: 'Cancelled' };
  return <div className="mt-5"><h3 className="font-semibold">Recent saved runs</h3><p className="xi-row-meta mb-3">Run status is operational metadata. Completion alone does not establish verified sync or settlement.</p><div className="xi-table-wrap"><Table><TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Recorded</TableHead><TableHead>Counts / error</TableHead></TableRow></TableHeader><TableBody>{runs.map((run) => <TableRow key={run.id}><TableCell className="font-mono text-xs">{run.id}</TableCell><TableCell>{modes[run.mode] || 'Saved run'}</TableCell><TableCell>{states[run.status] || 'Unknown'}</TableCell><TableCell>{formatDateTime(run.completedAt || run.createdAt)}</TableCell><TableCell>{Object.entries(run.counts || {}).map(([key, value]) => <span className="block" key={key}>{key.charAt(0).toUpperCase() + key.slice(1)}: {formatCount(value)}</span>)}{run.errorCode && <span className="block">{run.errorCode}</span>}</TableCell></TableRow>)}</TableBody></Table></div></div>;
}
