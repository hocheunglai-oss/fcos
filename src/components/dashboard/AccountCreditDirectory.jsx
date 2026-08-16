import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Landmark, Loader2, RefreshCw, Search } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PAGE_SIZE = 25;

function money(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Unavailable';
  const label = currency || 'Salesforce corporate currency';
  return `${label} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function DirectoryTableRow({ account, onStatement }) {
  return (
      <tr className="border-t border-border">
        <td className="px-3 py-3">
          <div className="font-semibold">{account.name}</div>
          <div className="text-xs text-muted-foreground">{account.clKey ? `CL Key ${account.clKey}` : 'CL Key not set'}{account.inactive ? ' · Inactive with history' : ''}</div>
        </td>
        <td className="px-3 py-3">{account.groupName || 'No GROUP ancestor'}</td>
        <td className="px-3 py-3 text-right tabular-nums">{account.openStemCount.toLocaleString()}</td>
        <td className="px-3 py-3 text-right tabular-nums">{money(account.openExposure, account.currency)}</td>
        <td className="px-3 py-3 text-right"><Button type="button" size="sm" onClick={() => onStatement(account)}>Statement</Button></td>
      </tr>
  );
}

function DirectoryCard({ account, onStatement }) {
  return (
      <article className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="font-semibold">{account.name}</h3><p className="mt-1 text-xs text-muted-foreground">{account.clKey ? `CL Key ${account.clKey}` : 'CL Key not set'} · {account.groupName || 'No GROUP ancestor'}</p></div>
          {account.hasOpenCredit ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">Credit used</span> : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Open STEMs</dt><dd className="font-semibold">{account.openStemCount.toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">Current exposure</dt><dd className="font-semibold">{money(account.openExposure, account.currency)}</dd></div></dl>
        <Button type="button" size="sm" className="mt-4 w-full" onClick={() => onStatement(account)}>Open statement</Button>
      </article>
  );
}

export default function AccountCreditDirectory({ onStatement }) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [result, setResult] = useState(null);
  const [navigation, setNavigation] = useState({ cursor: null, history: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(null);

  const load = useCallback(async ({ cursor = null, history = [], force = false, search = appliedQuery } = {}) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await appClient.functions.invoke('dashboardAccountCreditDirectory', {
        query: search || null, cursor, limit: PAGE_SIZE, force,
      }, { cache: true, cacheTtlMs: 60_000, cacheTags: ['dashboard', 'account-credit'], signal: controller.signal, force });
      if (controller.signal.aborted) return;
      if (response.data?.error) throw new Error(response.data.error);
      setResult(response.data);
      setNavigation({ cursor, history });
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'Account Statements could not be loaded.');
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, [appliedQuery]);

  useEffect(() => { load(); return () => requestRef.current?.abort(); }, [load]);

  const submitSearch = (event) => {
    event?.preventDefault();
    const next = query.trim();
    if (next === appliedQuery) {
      load({ cursor: null, history: [], search: next });
      return;
    }
    setAppliedQuery(next);
    setNavigation({ cursor: null, history: [] });
  };

  return (
    <section className="mb-5 rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end sm:justify-between">
        <div><div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" /><h2 className="font-semibold">Account Statements</h2></div><p className="mt-1 text-xs text-muted-foreground">Buyer-leg STEMs only. Supplier, extra-cost, and broker relationships are excluded.</p></div>
        <form className="flex w-full gap-2 sm:max-w-md" onSubmit={submitSearch} role="search">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search Account name or CL Key" aria-label="Search Account Statements" /></div>
          <Button type="submit" size="sm" variant="outline" disabled={loading}>Search</Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Refresh Account Statements" onClick={() => load({ cursor: navigation.cursor, history: navigation.history, force: true })} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
        </form>
      </div>
      {error ? <div className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
      {loading && !result ? <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading buyer Accounts…</div> : null}
      {result ? <div className="relative p-4">{loading ? <div className="absolute right-4 top-2 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Updating</div> : null}<div className="space-y-3 md:hidden">{result.accounts?.map((account) => <DirectoryCard key={account.accountId} account={account} onStatement={onStatement} />)}</div><div className="hidden overflow-x-auto rounded-lg border border-border md:block"><table className="w-full min-w-[840px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Ultimate GROUP</th><th className="px-3 py-2 text-right">Open STEMs</th><th className="px-3 py-2 text-right">Current exposure</th><th className="px-3 py-2"><span className="sr-only">Action</span></th></tr></thead><tbody>{result.accounts?.map((account) => <DirectoryTableRow key={account.accountId} account={account} onStatement={onStatement} />)}</tbody></table></div>{!result.accounts?.length ? <div className="py-10 text-center text-sm text-muted-foreground">No buyer Accounts match this search.</div> : null}<div className="mt-4 flex items-center justify-between"><span className="text-xs text-muted-foreground">Page {navigation.history.length + 1} · live Salesforce buyer-leg membership</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!navigation.history.length || loading} onClick={() => load({ cursor: navigation.history.at(-1) || null, history: navigation.history.slice(0, -1) })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button type="button" size="sm" variant="outline" disabled={!result.nextCursor || loading} onClick={() => load({ cursor: result.nextCursor, history: [...navigation.history, navigation.cursor] })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div></div> : null}
    </section>
  );
}
