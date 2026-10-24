import { useEffect, useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function RelatedStemSearch({ contextKey }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const controller = useRef(null);
  useEffect(() => {
    controller.current?.abort();
    setQuery(''); setResults([]); setError(''); setSearched(false); setBusy(false);
    return () => controller.current?.abort();
  }, [contextKey]);
  const search = async () => {
    controller.current?.abort();
    const next = new AbortController(); controller.current = next; setBusy(true); setError('');
    try {
      const result = await appClient.functions.invoke('workspaceSearch', { query: query.trim(), limit: 5 }, { signal: next.signal, cache: true, cacheTtlMs: 30000 });
      if (next.signal.aborted) return;
      setResults(result.data?.results || []);
      setError(result.data?.error || (result.data?.unavailableSources?.length ? `Unavailable: ${result.data.unavailableSources.join(', ')}` : ''));
      setSearched(true);
    } catch { if (!next.signal.aborted) setError('Related record search is temporarily unavailable.'); }
    finally { if (!next.signal.aborted) setBusy(false); }
  };
  return <details className="rounded-lg border bg-muted/20 p-3 text-sm">
    <summary className="cursor-pointer font-medium">Find related STEM or invoice</summary>
    <p className="mt-2 text-xs text-muted-foreground">Search an exact business reference from this message. Results are suggestions; opening one does not attach or file the email.</p>
    <div className="mt-2 flex gap-2"><Input aria-label="Related STEM or invoice reference" maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && query.trim().length >= 2) { event.preventDefault(); search(); } }} /><Button variant="outline" disabled={busy || query.trim().length < 2} onClick={search}>{busy ? 'Searching…' : 'Find'}</Button></div>
    {error && <p role="alert" className="mt-2 text-xs text-amber-800">{error}</p>}
    <ul className="mt-2 space-y-1">{results.map((entry) => <li key={`${entry.kind}:${entry.id}`}><a target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline" href={`/stems/${encodeURIComponent(entry.stemId)}`}>{entry.label}</a> · {entry.kind}{entry.detail ? ` · ${entry.detail}` : ''}</li>)}</ul>
    {searched && !results.length && !error && <p className="mt-2 text-xs text-muted-foreground">No accessible matching records.</p>}
  </details>;
}
