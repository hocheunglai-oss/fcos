import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Landmark, Loader2, RefreshCw, Search } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PAGE_SIZE = 25;

function money(value, currency) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${currency || 'USD'} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Unavailable';
}

function rankingRows(analytics) {
  return [
    ...(analytics?.directoryRankings?.buyers || analytics?.rankings?.accountsByNetPnl || []).map((row) => ({ ...row, role: 'buyer' })),
    ...(analytics?.directoryRankings?.suppliers || analytics?.rankings?.suppliersByNetPnl || []).map((row) => ({ ...row, role: 'supplier' })),
  ].map((row) => ({ accountId: row.accountId, name: row.name, role: row.role, currency: row.currency || 'USD', grossProfit: row.grossProfit ?? row.netPnl, source: 'ranking' }));
}

function mergeRows(directoryRows, analytics) {
  const rows = new Map();
  for (const row of directoryRows || []) rows.set(`buyer:${row.accountId}`, { ...row, role: 'buyer', source: 'statement' });
  for (const row of rankingRows(analytics)) {
    const key = `${row.role}:${row.accountId || row.name}`;
    rows.set(key, { ...(rows.get(key) || {}), ...row, source: rows.has(key) ? 'statement_ranking' : 'ranking' });
  }
  return [...rows.values()];
}

function AccountRow({ account, onOpen }) {
  return <tr className="border-t border-border"><td className="px-3 py-3"><div className="font-semibold">{account.name}</div><div className="text-xs text-muted-foreground">{account.clKey ? `CL Key ${account.clKey}` : 'CL Key not set'} · <span className="capitalize">{account.role}</span></div></td><td className="px-3 py-3">{account.groupName || (account.role === 'supplier' ? 'Supplier ranking' : 'No GROUP ancestor')}</td><td className="px-3 py-3 text-right tabular-nums">{account.openStemCount == null ? '—' : account.openStemCount.toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums">{account.openExposure == null ? '—' : money(account.openExposure, account.currency)}</td><td className={`px-3 py-3 text-right tabular-nums font-semibold ${Number(account.grossProfit) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{account.grossProfit == null ? '—' : money(account.grossProfit, account.currency)}</td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onOpen(account, 'overview')} disabled={!account.accountId}>Insight</Button>{account.role === 'buyer' && account.source !== 'ranking' ? <Button type="button" size="sm" onClick={() => onOpen(account, 'credit')}>Statement</Button> : null}</div></td></tr>;
}

function AccountCard({ account, onOpen }) {
  return <article className="rounded-lg border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{account.name}</h3><p className="mt-1 text-xs capitalize text-muted-foreground">{account.role} · {account.groupName || 'No GROUP ancestor'}</p></div>{account.hasOpenCredit ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">Credit used</span> : null}</div><dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Open STEMs</dt><dd className="font-semibold">{account.openStemCount ?? '—'}</dd></div><div><dt className="text-xs text-muted-foreground">Exposure</dt><dd className="font-semibold">{account.openExposure == null ? '—' : money(account.openExposure, account.currency)}</dd></div><div><dt className="text-xs text-muted-foreground">Gross profit</dt><dd className="font-semibold">{account.grossProfit == null ? '—' : money(account.grossProfit, account.currency)}</dd></div></dl><div className="mt-4 flex gap-2"><Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => onOpen(account, 'overview')} disabled={!account.accountId}>Insight</Button>{account.role === 'buyer' && account.source !== 'ranking' ? <Button type="button" size="sm" className="flex-1" onClick={() => onOpen(account, 'credit')}>Statement</Button> : null}</div></article>;
}

export default function AccountCreditDirectory({ onOpen, filters = {}, analytics, analyticsLoading, analyticsError, onLoadAnalytics }) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [view, setView] = useState('all');
  const [result, setResult] = useState(null);
  const [navigation, setNavigation] = useState({ cursor: null, history: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(null);
  const directoryFilters = useMemo(() => ({ accountIds: Array.isArray(filters.accountIds) ? filters.accountIds : [], portIds: Array.isArray(filters.portIds) ? filters.portIds : [], countryCodes: Array.isArray(filters.countryCodes) ? filters.countryCodes : [] }), [filters.accountIds, filters.countryCodes, filters.portIds]);

  const load = useCallback(async ({ cursor = null, history = [], force = false, search = appliedQuery } = {}) => {
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller; setLoading(true); setError(null);
    try { const response = await appClient.functions.invoke('dashboardAccountCreditDirectory', { query: search || null, cursor, limit: PAGE_SIZE, filters: directoryFilters, force }, { cache: true, cacheTtlMs: 60_000, cacheTags: ['dashboard', 'account-credit'], signal: controller.signal, force }); if (controller.signal.aborted) return; if (response.data?.error) throw new Error(response.data.error); setResult(response.data); setNavigation({ cursor, history }); }
    catch (loadError) { if (loadError.name !== 'AbortError') setError(loadError.message || 'Accounts could not be loaded.'); }
    finally { if (requestRef.current === controller) setLoading(false); }
  }, [appliedQuery, directoryFilters]);

  useEffect(() => { load(); return () => requestRef.current?.abort(); }, [load]);
  useEffect(() => { onLoadAnalytics?.(); }, [onLoadAnalytics]);
  const rows = useMemo(() => {
    const queryText = appliedQuery.toLowerCase();
    return mergeRows(result?.accounts, analytics).filter((row) => {
      const matches = !queryText || `${row.name} ${row.clKey || ''} ${row.groupName || ''}`.toLowerCase().includes(queryText);
      if (!matches) return false;
      if (view === 'statements') return row.role === 'buyer' && row.source !== 'ranking';
      if (view === 'buyer') return row.role === 'buyer' && row.grossProfit != null;
      if (view === 'supplier') return row.role === 'supplier';
      return true;
    });
  }, [analytics, appliedQuery, result?.accounts, view]);
  const submitSearch = (event) => { event?.preventDefault(); const next = query.trim(); if (next === appliedQuery) load({ cursor: null, history: [], search: next }); else { setAppliedQuery(next); setNavigation({ cursor: null, history: [] }); } };

  return <section className="rounded-xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-end xl:justify-between"><div><div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" /><h2 className="font-semibold">Accounts</h2></div><p className="mt-1 text-xs text-muted-foreground">One searchable table for buyer credit statements and period buyer/supplier rankings. Financial values stay within the selected Dashboard scope.</p></div><form className="flex w-full gap-2 xl:max-w-md" onSubmit={submitSearch} role="search"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search Account, GROUP or CL Key" aria-label="Search Accounts" /></div><Button type="submit" size="sm" variant="outline" disabled={loading}>Search</Button><Button type="button" size="icon" variant="ghost" aria-label="Refresh Accounts" onClick={() => { load({ cursor: navigation.cursor, history: navigation.history, force: true }); onLoadAnalytics?.({ force: true }); }} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading || analyticsLoading ? 'animate-spin' : ''}`} /></Button></form></div>
    <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">{[['all', 'All'], ['statements', 'Buyer statements'], ['buyer', 'Buyer gross profit'], ['supplier', 'Supplier gross profit']].map(([value, label]) => <button key={value} type="button" onClick={() => setView(value)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${view === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>{label}</button>)}</div>
    {error || analyticsError ? <div className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error || analyticsError}</div> : null}
    {loading && !result ? <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Accounts…</div> : null}
    {result ? <div className="relative p-4">{loading || analyticsLoading ? <div className="absolute right-4 top-2 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Updating</div> : null}<div className="space-y-3 md:hidden">{rows.map((account) => <AccountCard key={`${account.role}:${account.accountId || account.name}`} account={account} onOpen={onOpen} />)}</div><div className="hidden overflow-x-auto rounded-lg border border-border md:block"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">GROUP / context</th><th className="px-3 py-2 text-right">Open STEMs</th><th className="px-3 py-2 text-right">Current exposure</th><th className="px-3 py-2 text-right">Period gross profit</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((account) => <AccountRow key={`${account.role}:${account.accountId || account.name}`} account={account} onOpen={onOpen} />)}</tbody></table></div>{!rows.length ? <div className="py-10 text-center text-sm text-muted-foreground">No Accounts match this search and view.</div> : null}<div className="mt-4 flex items-center justify-between"><span className="text-xs text-muted-foreground">Page {navigation.history.length + 1} · Account IDs remain authoritative</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!navigation.history.length || loading} onClick={() => load({ cursor: navigation.history.at(-1) || null, history: navigation.history.slice(0, -1) })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button type="button" size="sm" variant="outline" disabled={!result.nextCursor || loading} onClick={() => load({ cursor: result.nextCursor, history: [...navigation.history, navigation.cursor] })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div></div> : null}
  </section>;
}
