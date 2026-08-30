import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { emailRouter } from '@/lib/emailRouter';
import { emailRouterClientMetrics, summarizeEmailRouterMetrics } from '@/lib/emailRouterEnhancements';
import { EMAIL_ROUTER_SYNC_STATE_KEY } from './EmailRouterBackgroundSync';

function readSyncState() {
  try { return JSON.parse(window.localStorage.getItem(EMAIL_ROUTER_SYNC_STATE_KEY) || '{}'); } catch { return {}; }
}
function ageLabel(value, now = Date.now()) {
  const elapsed = now - new Date(value || 0).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Not yet recorded';
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

function freshnessTone(state, now) {
  if (state?.status === 'failed') return { label: 'Degraded', className: 'border-red-200 bg-red-50 text-red-900', Icon: WifiOff };
  const age = now - new Date(state?.lastSyncedAt || 0).getTime();
  if (!Number.isFinite(age) || age > 90_000) return { label: 'Delayed', className: 'border-amber-200 bg-amber-50 text-amber-950', Icon: AlertTriangle };
  if (state?.status === 'synchronizing') return { label: 'Synchronizing', className: 'border-blue-200 bg-blue-50 text-blue-900', Icon: Loader2 };
  return { label: 'Current', className: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2 };
}

export function EmailRouterFreshness({ onOpenOperations }) {
  const [state, setState] = useState(() => readSyncState());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = (event) => setState(event.detail || readSyncState());
    const interval = window.setInterval(() => setNow(Date.now()), 10_000);
    window.addEventListener('fcos:email-router-sync-state', update);
    return () => { window.clearInterval(interval); window.removeEventListener('fcos:email-router-sync-state', update); };
  }, []);
  const tone = freshnessTone(state, now);
  return <button type="button" onClick={onOpenOperations} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold ${tone.className}`} title="Open Email Router operational status"><tone.Icon className={`h-3.5 w-3.5 ${tone.label === 'Synchronizing' ? 'animate-spin' : ''}`} />{tone.label} · {ageLabel(state.lastSyncedAt, now)}</button>;
}

function Stat({ label, value, detail, warning = false }) {
  return <div className={`rounded-lg border p-3 ${warning ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'}`}><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>{detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}</div>;
}

export default function EmailRouterOperationsDialog({ open, onOpenChange }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState(() => readSyncState());
  const metrics = useMemo(() => summarizeEmailRouterMetrics(emailRouterClientMetrics()), [open, health]);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await emailRouter.health({}, { force: true, cache: false });
      if (response.data?.error) throw new Error(response.data.error);
      setHealth(response.data);
      setSyncState(readSyncState());
    } catch (loadError) {
      setError(loadError?.message || 'Email Router operational status is unavailable.');
    } finally { setLoading(false); }
  };
  useEffect(() => { if (open) load(); }, [open]);
  const catchUp = () => {
    window.dispatchEvent(new CustomEvent('fcos:email-router-sync-request'));
    setSyncState({ ...readSyncState(), status: 'synchronizing' });
  };
  const actions = health?.actions?.counts || {};
  const accepted = Number(actions.confirmed || 0);
  const problematic = Number(actions.failed || 0) + Number(actions.uncertain || 0);
  const successRate = accepted + problematic ? `${Math.round((accepted / (accepted + problematic)) * 100)}%` : '—';
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Email Router operations</DialogTitle><DialogDescription>Redacted synchronization, delivery, image, attachment, and performance signals. No email content or recipient list is retained here.</DialogDescription></DialogHeader><div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><div className="text-sm font-semibold">Mailbox freshness</div><div className="mt-1 text-xs text-muted-foreground">Last synchronized {ageLabel(health?.mailbox?.lastSyncedAt || syncState.lastSyncedAt)}.</div></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={catchUp}><RefreshCw className="mr-1.5 h-4 w-4" />Catch up now</Button><Button type="button" size="icon" variant="ghost" aria-label="Refresh operational status" onClick={load} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></div></div>
    {error ? <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div> : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Graph subscriptions" value={`${health?.subscriptions?.ready ?? '—'} / ${health?.subscriptions?.total ?? '—'}`} detail={health?.subscriptions?.expiringWithin24Hours ? `${health.subscriptions.expiringWithin24Hours} expire within 24 hours` : 'Active notification channels'} warning={Boolean(health?.subscriptions?.total && health.subscriptions.ready !== health.subscriptions.total)} /><Stat label="Open alerts" value={health?.alerts?.total ?? '—'} detail={`${health?.alerts?.counts?.critical || 0} critical · ${health?.alerts?.counts?.warning || 0} warning`} warning={Boolean(health?.alerts?.total)} /><Stat label="24-hour route success" value={successRate} detail={`${accepted} confirmed · ${problematic} failed/uncertain`} warning={problematic > 0} /><Stat label="Delta folders" value={health?.folders?.filter((row) => !row.failed).length ?? '—'} detail={`${health?.folders?.filter((row) => row.failed).length || 0} failed`} warning={health?.folders?.some((row) => row.failed)} /></div>
    <section><h3 className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />This browser session</h3>{metrics.length ? <div className="mt-2 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[620px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Operation</th><th className="px-3 py-2 text-right">Count</th><th className="px-3 py-2 text-right">Average</th><th className="px-3 py-2 text-right">P95</th><th className="px-3 py-2 text-right">Issues</th></tr></thead><tbody>{metrics.map((row) => <tr key={row.operation} className="border-t border-border"><td className="px-3 py-2 font-medium">{row.operation.replaceAll('_', ' ')}</td><td className="px-3 py-2 text-right">{row.count}</td><td className="px-3 py-2 text-right">{row.averageMs == null ? '—' : `${row.averageMs} ms`}</td><td className="px-3 py-2 text-right">{row.p95Ms == null ? '—' : `${row.p95Ms} ms`}</td><td className="px-3 py-2 text-right">{row.failures}</td></tr>)}</tbody></table></div> : <div className="mt-2 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Session metrics appear as messages, images, attachments, and routes are used.</div>}</section>
    <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Operational signals contain only statuses, counts, timings, and controlled failure categories.</div>
  </div></DialogContent></Dialog>;
}
