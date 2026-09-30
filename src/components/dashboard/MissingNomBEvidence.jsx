import { useEffect, useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';

export function nomBText(value) { return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); }
export function nomBNumber(value, digits = 2) { return value == null || value === '' || !Number.isFinite(Number(value)) ? 'Unavailable' : Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function rateLabel(value) {
  const ratio = typeof value === 'string' ? value.match(/^(-?\d+)\/(\d+)$/) : null;
  if (!ratio) return nomBNumber(value, 6);
  const numerator = Number(ratio[1]); const denominator = Number(ratio[2]);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? `${nomBNumber(numerator / denominator, 6)} (exact: ${value})` : 'Unavailable';
}
export function nomBError(result) {
  if (result?.data?.error || result?.data?.success === false) {
    const error = new Error(result.data.error || result.data.message || 'The request could not be completed.');
    error.code = result.data.code;
    throw error;
  }
  if (!result?.data || result.data.cancelled || result.meta?.cancelled) throw Object.assign(new Error('Request cancelled.'), { name: 'AbortError' });
  return result.data;
}
export function NomBReceivable({ row }) {
  const receivable = row.receivable || {};
  return <div className="rounded-lg bg-muted/40 p-3 text-xs">
    <h4 className="font-semibold">Receivable evidence</h4>
    <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Original receivable</dt><dd>{receivable.currency || 'Currency unavailable'} {nomBNumber(receivable.amount)}</dd></div>
      <div><dt className="text-muted-foreground">USD equivalent</dt><dd>USD {nomBNumber(receivable.usdEquivalent)}</dd></div>
      <div><dt className="text-muted-foreground">Accounting exchange rate</dt><dd>{rateLabel(receivable.rate)}</dd></div>
      <div><dt className="text-muted-foreground">Rate date</dt><dd>{receivable.rateDate || 'Unavailable'}</dd></div>
      <div><dt className="text-muted-foreground">Rate source</dt><dd>{receivable.rateSource || 'Unavailable'}</dd></div>
      <div><dt className="text-muted-foreground">Invoice evidence</dt><dd>{receivable.invoiceIds?.length ? receivable.invoiceIds.join(', ') : 'Unavailable'}</dd></div>
    </dl>
    {receivable.reason ? <p className="mt-2 text-muted-foreground">{receivable.reason}</p> : null}
    <p className="mt-2 text-muted-foreground">Classification is supplied by the server. Automatic waiver applies only below USD 100 with issued-invoice and valid accounting-rate evidence.</p>
  </div>;
}
export default function MissingNomBAudit({ stemId }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const attempt = ++sequence.current;
    setLoading(true); setError(''); setResult(null);
    appClient.functions.invoke('dashboardNomBAuditRead', { stemId, page, pageSize: 10 }, { signal: controller.signal, cache: false, invalidateCache: false })
      .then(nomBError).then((data) => { if (!controller.signal.aborted && sequence.current === attempt) setResult(data); })
      .catch((failure) => { if (!controller.signal.aborted && sequence.current === attempt && failure.name !== 'AbortError') setError(failure.message || 'Audit history is unavailable.'); })
      .finally(() => { if (!controller.signal.aborted && sequence.current === attempt) setLoading(false); });
    return () => controller.abort();
  }, [stemId, page, refresh]);
  return <section aria-label="Nom B audit history" className="mt-3 text-xs">
    <h4 className="font-semibold">Audit history</h4>
    {loading ? <p role="status" className="mt-2">Loading audit history…</p> : null}
    {error ? <div role="alert" className="mt-2 text-destructive">{error} <Button type="button" variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>Retry history</Button></div> : null}
    {result?.rows?.length === 0 ? <p className="mt-2 text-muted-foreground">No policy changes have been recorded.</p> : null}
    <ol className="mt-2 space-y-3">{(result?.rows || []).map((event) => <li key={event.id} className="rounded-lg border border-border p-3">
      <p className="font-medium">{nomBText(event.eventType) || 'Policy change'}</p>
      <p className="mt-1 text-muted-foreground">{event.actorName || 'System'} · {event.createdAt || 'Date unavailable'}</p>
      {event.mode ? <p className="mt-1">Policy: {event.previousMode ? `${nomBText(event.previousMode)} → ` : ''}{nomBText(event.mode)}</p> : null}
      {event.status ? <p className="mt-1">Status: {event.previousStatus ? `${nomBText(event.previousStatus)} → ` : ''}{nomBText(event.status)}</p> : null}
      {event.reasonCode ? <p className="mt-1">Reason: {nomBText(event.reasonCode)}</p> : null}
      {event.reasonText ? <p className="mt-1 whitespace-pre-wrap break-words">{event.reasonText}</p> : null}
      {event.evidence && Object.keys(event.evidence).length ? <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">Recorded evidence</summary><dl className="mt-2 space-y-1">{Object.entries(event.evidence).map(([key, value]) => <div key={key}><dt className="inline font-medium">{nomBText(key)}: </dt><dd className="inline break-words">{value == null ? 'Unavailable' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></details> : null}
    </li>)}</ol>
    {result?.pagination?.totalPages > 1 ? <div className="mt-3 flex items-center justify-between gap-2"><Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous history</Button><span>Page {page} of {result.pagination.totalPages}</span><Button type="button" size="sm" variant="outline" disabled={loading || page >= result.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next history</Button></div> : null}
  </section>;
}
