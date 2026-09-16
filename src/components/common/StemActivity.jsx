import { useEffect, useState } from 'react';
import { appClient } from '@/api/appClient';

export default function StemActivity({ stemId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    appClient.functions.invoke('stemWorkspaceActivity', { stemId }, { signal: controller.signal, cache: true, cacheTtlMs: 30000 })
      .then((result) => { if (controller.signal.aborted) return; if (result.data?.error) setError(result.data.error); else setData(result.data); })
      .catch(() => { if (!controller.signal.aborted) setError('Activity is temporarily unavailable.'); });
    return () => controller.abort();
  }, [stemId]);
  return <section className="rounded-xl border bg-card p-5">
    <h2 className="font-semibold">STEM activity</h2>
    <p className="mt-1 text-xs text-muted-foreground">Recorded collection, charge-review and dispute events from workspaces you can access.</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {!data && !error && <p className="mt-3 text-sm">Loading activity…</p>}
    {!!data?.unavailableSources?.length && <p className="mt-2 text-sm text-amber-800">Unavailable: {data.unavailableSources.join(', ')}. Other activity is shown.</p>}
    {!!data?.limitedSources?.length && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 100 events per source. Open the related workspace for older history.</p>}
    {data && !data.events?.length && <p className="mt-3 text-sm text-muted-foreground">No activity returned by the available sources.</p>}
    <ol className="mt-4 max-h-96 space-y-3 overflow-auto">{data?.events?.map((event) => <li key={event.id} className="border-l-2 pl-3 text-sm">
      <p className="font-medium">{event.source} · {event.action?.replaceAll('_', ' ')}</p>
      <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))} HKT · {event.actor || 'System'}</p>
      {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
    </li>)}</ol>
  </section>;
}
