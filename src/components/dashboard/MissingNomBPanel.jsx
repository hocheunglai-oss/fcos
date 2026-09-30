import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MissingNomBPolicyDialog from './MissingNomBPolicyDialog';
import { nomBError, nomBNumber } from './MissingNomBEvidence';

const VIEWS = [{ id: 'missing', label: 'Missing', count: 'missing' }, { id: 'waived', label: 'Waived', count: 'waived' }, { id: 'unable_to_verify', label: 'Unable to verify', count: 'unableToVerify' }];
const countLabel = (value, complete = true) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `${complete === false ? '≥ ' : ''}${nomBNumber(value, 0)}`;
function MissingNomBRow({ row, canManage, onOpenStem, onPolicy }) {
  return <li className="min-w-0 rounded-lg border border-border p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{row.stemReference || row.stemId} · {row.vessel || 'Vessel unavailable'}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{row.buyer || 'Buyer unavailable'} · {row.port || 'Port unavailable'}</p></div><div className="text-xs"><p className="font-medium">{row.undated ? 'Undated · follow up' : row.deliveryDate || 'Date unavailable'}</p>{row.deliveryDateSource ? <p className="mt-1 text-muted-foreground">{row.deliveryDateSource === 'actual' ? 'Actual delivery' : 'Expected delivery'}</p> : null}</div></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><p className="min-w-0 break-words">Trader: {row.traders?.length ? row.traders.map((item) => item.name || item.email || item.id).join(', ') : 'Unresolved assignment'}</p><span className="rounded-md bg-muted px-2 py-1">{row.waiverType === 'automatic' ? 'Automatic waiver' : row.waiverType === 'manual' ? 'Management waiver' : row.status === 'missing' ? 'Missing Nom B' : 'Unable to verify'}</span></div>
    {row.reason ? <p className="mt-2 break-words text-xs text-muted-foreground">{row.reason}</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onOpenStem?.(row.stemId)}>Open STEM</Button><Button type="button" size="sm" variant="outline" onClick={() => onPolicy(row)}>{canManage ? 'Manage Nom B' : 'View policy'}</Button></div>
  </li>;
}
export default function MissingNomBPanel({ onOpenStem, defaultExpanded = false, title = 'My Missing Nom B', description = 'Independent of financial filters · delivery from 1 September 2026' }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [view, setView] = useState('missing');
  const [scope, setScope] = useState('mine');
  const [traderId, setTraderId] = useState('');
  const [includeUndated, setIncludeUndated] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('delivery_asc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [personalCounts, setPersonalCounts] = useState(null);
  const [capabilities, setCapabilities] = useState({ canManagePolicies: false, canViewTeam: false });
  const [traderOptions, setTraderOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [notice, setNotice] = useState('');
  const drafts = useRef(new Map());
  const sequence = useRef(0);
  const abort = useRef(null);
  const body = useMemo(() => ({ view, scope, search, sort, page, pageSize: 25, includeUndated, ...(scope === 'team' && traderId ? { traderId } : {}) }), [view, scope, search, sort, page, includeUndated, traderId]);
  const bodyKey = JSON.stringify(body);
  const loadedKey = useRef(null);
  const load = useCallback(async ({ force = false } = {}) => {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const attempt = ++sequence.current;
    setLoading(true); setError('');
    if (loadedKey.current !== bodyKey) setData(null);
    try {
      const options = { signal: controller.signal, cache: false, invalidateCache: false, force };
      const [current, mine] = await Promise.all([
        appClient.functions.invoke('dashboardNomBRead', body, options).then(nomBError),
        scope === 'team' ? appClient.functions.invoke('dashboardNomBRead', { view: 'missing', scope: 'mine', search: '', sort: 'delivery_asc', page: 1, pageSize: 25, includeUndated: false }, options).then(nomBError) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || sequence.current !== attempt) return;
      loadedKey.current = bodyKey; setData(current); setPersonalCounts((mine || current).counts); setCapabilities(current.capabilities || {}); setTraderOptions(current.traderOptions || []);
    } catch (failure) {
      if (!controller.signal.aborted && sequence.current === attempt && failure.name !== 'AbortError') setError(failure.message || 'Nom B requirements could not be verified.');
    } finally { if (!controller.signal.aborted && sequence.current === attempt) setLoading(false); }
  }, [body, bodyKey, includeUndated, scope, search, traderId]);
  useEffect(() => { void load(); return () => abort.current?.abort(); }, [load]);
  const changeQuery = (setter, value) => { setPage(1); setter(value); setNotice(''); };
  const openPolicy = (row) => { setSelectedRow(row); setDialogKey((value) => value + 1); };
  const retainDraft = useCallback((draft) => { if (selectedRow) drafts.current.set(selectedRow.stemId, draft); }, [selectedRow]);
  const saved = () => { drafts.current.delete(selectedRow.stemId); setSelectedRow(null); setNotice('Nom B policy saved. Refreshing requirements…'); void load({ force: true }); };
  const visibleData = loadedKey.current === bodyKey ? data : null;
  return <section aria-label="Missing Nom B requirements" className="mb-4 min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><div className="flex flex-wrap items-center gap-3"><span className="text-2xl font-semibold tabular-nums" aria-label={`My missing Nom B count: ${countLabel(personalCounts?.missing, personalCounts?.complete)}`}>{countLabel(personalCounts?.missing, personalCounts?.complete)}</span><Button type="button" size="sm" variant="outline" aria-expanded={expanded} aria-controls="missing-nom-b-list" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide STEMs' : 'View STEMs'}</Button><Button type="button" size="sm" variant="ghost" aria-label="Refresh Nom B requirements" disabled={loading} onClick={() => void load({ force: true })}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div></div>
    {personalCounts?.complete === false ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Count incomplete. Verified missing STEMs are shown as a minimum; review Unable to verify.</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}{data || personalCounts ? ' Last verified counts are shown; refresh to check the current status.' : ' Counts are unavailable until verification succeeds.'}</p> : null}
    {loading ? <p role="status" className="mt-2 text-xs text-muted-foreground">Checking Nom B requirements…</p> : null}{notice ? <p role="status" className="mt-2 text-xs">{notice}</p> : null}
    {expanded ? <div id="missing-nom-b-list" className="mt-4 space-y-3">
      <p className="text-xs text-muted-foreground">Actual delivery date is used first, then expected delivery date. Cancelled STEMs are excluded; completed STEMs are included. Undated STEMs have a separate follow-up list.</p>
      {capabilities.canViewTeam ? <div className="flex flex-wrap gap-3"><label className="text-xs font-medium">Requirements for<select aria-label="Requirements for" value={scope} onChange={(event) => { setTraderId(''); changeQuery(setScope, event.target.value); }} className="ml-2 min-h-10 rounded-md border border-input bg-background px-2"><option value="mine">My STEMs</option><option value="team">Team STEMs</option></select></label>{scope === 'team' ? <label className="text-xs font-medium">Trader<select aria-label="Trader" value={traderId} onChange={(event) => changeQuery(setTraderId, event.target.value)} className="ml-2 max-w-full min-h-10 rounded-md border border-input bg-background px-2"><option value="">All traders</option><option value="unassigned">Unresolved assignments</option>{traderOptions.map((trader) => <option key={trader.id} value={trader.id}>{trader.name || trader.email || trader.id}</option>)}</select></label> : null}</div> : null}
      <div className="flex flex-wrap items-center gap-3"><Tabs value={view} onValueChange={(value) => changeQuery(setView, value)} className="max-w-full min-w-0"><TabsList className="h-auto flex-wrap justify-start gap-1">{VIEWS.map((option) => <TabsTrigger key={option.id} value={option.id} className="text-xs">{option.label} ({countLabel(visibleData?.counts?.[option.count], visibleData?.counts?.complete)})</TabsTrigger>)}</TabsList></Tabs><label className="inline-flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={includeUndated} onChange={(event) => changeQuery(setIncludeUndated, event.target.checked)} />Undated follow-up ({countLabel(visibleData?.counts?.undated, visibleData?.counts?.complete)})</label></div>
      <p className="text-xs font-medium">{scope === 'team' ? 'Team' : 'My'} {VIEWS.find((option) => option.id === view)?.label.toLowerCase()} STEMs · {includeUndated ? 'undated only' : 'delivery from 1 September 2026'}</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); changeQuery(setSearch, searchInput.trim()); }}><label className="min-w-0 flex-1 basis-full text-xs font-medium sm:basis-0">Search STEM, vessel, buyer, port or trader<input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label><Button type="submit" variant="outline" size="sm">Search</Button><label className="text-xs font-medium">Sort<select aria-label="Sort" value={sort} onChange={(event) => changeQuery(setSort, event.target.value)} className="mt-1 block min-h-10 rounded-md border border-input bg-background px-2"><option value="delivery_asc">Delivery · oldest first</option><option value="delivery_desc">Delivery · newest first</option></select></label></form>
      {visibleData?.rows?.length === 0 && !loading ? <p className="rounded-lg bg-muted/40 p-4 text-sm">{search ? 'No STEMs match this search.' : includeUndated ? 'No undated STEMs in this status.' : 'No STEMs in this status.'}</p> : null}
      <ul aria-label="Nom B STEMs" className="space-y-3">{(visibleData?.rows || []).map((row) => <MissingNomBRow key={row.stemId} row={row} canManage={capabilities.canManagePolicies} onOpenStem={onOpenStem} onPolicy={openPolicy} />)}</ul>
      {visibleData?.pagination ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>Page {visibleData.pagination.page || page} of {Math.max(1, visibleData.pagination.totalPages || 1)} · {countLabel(visibleData.pagination.total)} STEMs</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={loading || page >= (visibleData.pagination.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div> : null}
      {visibleData?.lastCheckedAt ? <p className="text-xs text-muted-foreground">Last checked: {visibleData.lastCheckedAt}</p> : null}
    </div> : null}
    {selectedRow ? <MissingNomBPolicyDialog key={dialogKey} row={selectedRow} canManage={capabilities.canManagePolicies} initialDraft={drafts.current.get(selectedRow.stemId)} onDraftChange={retainDraft} onClose={() => setSelectedRow(null)} onSaved={saved} onRefresh={() => load({ force: true })} /> : null}
  </section>;
}
