import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SpecialTermLookupField({ label, kind, value, onChange, placeholder, disabled = false }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (value) setQuery(''); }, [value]);
  useEffect(() => {
    if (disabled || value || query.trim().length < 2) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      const response = await appClient.functions.invoke('specialTermsOptions', { kind, query: query.trim() }, { cache: false });
      if (cancelled) return;
      if (response.data?.error) {
        setError(response.data.error);
        setOptions([]);
      } else setOptions(response.data?.options || []);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [disabled, kind, query, value]);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value ? (
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span className="min-w-0"><strong className="block truncate font-medium">{value.label}</strong>{value.secondary ? <small className="block truncate text-muted-foreground">{value.secondary}</small> : null}</span>
          {!disabled ? <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onChange(null)} title={`Clear ${label}`}><X className="h-4 w-4" /></Button> : null}
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input disabled={disabled} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="pl-9" />
          {(loading || error || options.length > 0) ? (
            <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
              {loading ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching...</div> : null}
              {error ? <div className="px-3 py-2 text-xs text-destructive">{error}</div> : null}
              {!loading ? options.map((option) => <button key={option.id} type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onChange(option)}><strong className="block font-medium">{option.label}</strong>{option.secondary ? <small className="text-muted-foreground">{option.secondary}</small> : null}</button>) : null}
              {!loading && !error && query.trim().length >= 2 && options.length === 0 ? <div className="px-3 py-2 text-xs text-muted-foreground">No matching records.</div> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
