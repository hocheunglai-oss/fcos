import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const VERSION_HISTORY_ENDPOINT = '/api/app-version-history';

export default function VersionAuditHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(VERSION_HISTORY_ENDPOINT, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Version history request failed (${response.status}).`);
      const payload = await response.json();
      if (!controller.signal.aborted) setHistory(Array.isArray(payload?.history) ? payload.history : []);
    } catch (loadError) {
      if (!controller.signal.aborted) setError(loadError?.message || 'Version history could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); return () => requestRef.current?.abort(); }, [load]);

  if (loading) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading version history</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><div>{error}</div><Button type="button" variant="outline" size="sm" className="mt-3" onClick={load}>Try again</Button></div>;
  return (
    <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
      {history.map((entry) => (
        <section key={entry.version} className="rounded-lg border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Version {entry.version}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.title}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
              {entry.releasedAt}
            </div>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {entry.changes.map((change) => (
              <li key={change} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{change}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!history.length ? <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No published version history is available.</div> : null}
    </div>
  );
}
