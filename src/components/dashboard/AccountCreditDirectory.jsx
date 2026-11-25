import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Landmark, Loader2, RefreshCw } from 'lucide-react';
import DataStatus from '@/components/common/DataStatus';
import { useDashboardResource } from '@/hooks/useDashboardResource';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 25;
const FIRST_PAGE = { cursor: null, history: [] };
const DIRECTIONS = [['both', 'Both'], ['buyer', 'Buyer'], ['supplier', 'Supplier']];
const ISO_CURRENCY = /^[A-Z]{3}$/;
const COMPACT_BUTTON_CLASS = 'h-8 text-xs';
const money = (value, currency) => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  const currencyCode = String(currency || '').toUpperCase();
  if (!ISO_CURRENCY.test(currencyCode)) return '—';
  return `${currencyCode} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const moneyLines = (rows = [], key) => rows.length ? rows.map((row) => <div key={row.currency} className="whitespace-nowrap">{money(row[key], row.currency)}</div>) : '—';
const exposureLines = (rows = [], key) => rows.length ? rows.map((row) => <div key={row.currency} className="whitespace-nowrap">{money(row[key], row.currency)}{Number.isFinite(Number(row.openStemCount)) ? <span className="block text-[11px] font-normal text-muted-foreground">{Number(row.openStemCount)} open STEM{Number(row.openStemCount) === 1 ? '' : 's'}</span> : null}</div>) : '—';
const netLines = (exposure) => exposure?.complete ? moneyLines(exposure.byCurrency, 'amount') : '—';
const openStemCount = (exposure) => exposure?.byCurrency?.reduce((total, row) => total + (Number.isFinite(Number(row.openStemCount)) ? Number(row.openStemCount) : 0), 0);
const gpLines = (rows = []) => rows.length ? rows.map((row) => <div key={row.currency} className={`whitespace-nowrap ${Number(row.grossProfit ?? row.netPnl) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{money(row.grossProfit ?? row.netPnl, row.currency)}</div>) : '—';

function mergedRows(rows, exposures) {
  const byEntity = new Map((exposures || []).map((row) => [row.entityKey, row]));
  return (rows || []).map((row) => ({ ...row, exposure: byEntity.get(row.entityKey) || null }));
}

function Actions({ account, onOpen }) {
  const roles = account.roles || [];
  const insightRole = account.entityType === 'group' ? 'group' : roles.includes('buyer') ? 'buyer' : roles[0] || 'buyer';
  const statementRole = roles.includes('buyer') && roles.includes('supplier') ? 'both' : roles[0] || 'buyer';
  const identity = { ...account, accountId: account.entityId };
  return <div className="flex flex-wrap justify-end gap-1.5"><Button type="button" size="sm" variant="outline" className={COMPACT_BUTTON_CLASS} disabled={!onOpen} onClick={(event) => onOpen?.({ ...identity, role: insightRole }, 'overview', event.currentTarget)}>Insight</Button><Button type="button" size="sm" className={COMPACT_BUTTON_CLASS} disabled={!onOpen} onClick={(event) => onOpen?.({ ...identity, role: statementRole }, 'credit', event.currentTarget)}>Statement</Button></div>;
}

function RoleBadges({ roles = [] }) {
  if (!roles.length) return <span className="text-xs text-muted-foreground">No active role</span>;
  return <span className="flex flex-wrap gap-1">{roles.map((role) => <span key={role} className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{role}</span>)}</span>;
}

function AccountIdentity({ account }) {
  const isGroup = account.entityType === 'group';
  return <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><div className="break-words font-semibold">{account.name}</div>{isGroup ? <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">GROUP</span> : <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Account</span>}</div><div className="mt-1 flex flex-wrap items-center gap-1.5"><RoleBadges roles={account.roles || []} />{account.clKey ? <span className="text-[11px] text-muted-foreground">{account.clKey}</span> : null}</div><div className="mt-1 text-[11px] text-muted-foreground">Lifetime STEMs: Buyer {account.buyerStemCount ?? 0} · Supplier {account.supplierStemCount ?? 0}</div><div className="text-[11px] text-muted-foreground">Open STEMs: Buyer {openStemCount(account.exposure?.buyer) ?? '—'} · Supplier {openStemCount(account.exposure?.supplier) ?? '—'}</div></div>;
}

function AccountRow({ account, onOpen, direction }) {
  return <tr className={`border-t border-border align-top ${account.entityType === 'group' ? 'bg-amber-50/30' : ''}`}><td className="px-3 py-3"><AccountIdentity account={account} /></td>{direction !== 'supplier' ? <td className="px-3 py-3 text-right tabular-nums">{exposureLines(account.exposure?.buyer?.byCurrency, 'exposure')}</td> : null}{direction !== 'buyer' ? <td className="px-3 py-3 text-right tabular-nums">{exposureLines(account.exposure?.supplier?.byCurrency, 'exposure')}</td> : null}{direction === 'both' ? <td className="px-3 py-3 text-right tabular-nums">{netLines(account.exposure?.net)}</td> : null}{direction !== 'supplier' ? <td className="px-3 py-3 text-right tabular-nums">{gpLines(account.buyerGrossProfitByCurrency)}</td> : null}{direction !== 'buyer' ? <td className="px-3 py-3 text-right tabular-nums">{gpLines(account.supplierGrossProfitByCurrency)}</td> : null}<td className="px-3 py-3"><Actions account={account} onOpen={onOpen} /></td></tr>;
}

function AccountCard({ account, onOpen, direction }) {
  return <article className={`rounded-lg border p-4 ${account.entityType === 'group' ? 'border-amber-300 bg-amber-50/50' : 'border-border bg-card'}`}><AccountIdentity account={account} /><dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{direction !== 'supplier' ? <div><dt className="text-xs font-medium text-muted-foreground">Buyer receivable</dt><dd className="mt-1 font-semibold tabular-nums">{exposureLines(account.exposure?.buyer?.byCurrency, 'exposure')}</dd></div> : null}{direction !== 'buyer' ? <div><dt className="text-xs font-medium text-muted-foreground">Supplier payable</dt><dd className="mt-1 font-semibold tabular-nums">{exposureLines(account.exposure?.supplier?.byCurrency, 'exposure')}</dd></div> : null}{direction === 'both' ? <div><dt className="text-xs font-medium text-muted-foreground">Receivable − payable</dt><dd className="mt-1 font-semibold tabular-nums">{netLines(account.exposure?.net)}</dd></div> : null}{direction !== 'supplier' ? <div><dt className="text-xs font-medium text-muted-foreground">Buyer period GP</dt><dd className="mt-1 tabular-nums">{gpLines(account.buyerGrossProfitByCurrency)}</dd></div> : null}{direction !== 'buyer' ? <div><dt className="text-xs font-medium text-muted-foreground">Supplier period GP</dt><dd className="mt-1 tabular-nums">{gpLines(account.supplierGrossProfitByCurrency)}</dd></div> : null}</dl><div className="mt-4"><Actions account={account} onOpen={onOpen} /></div></article>;
}

export default function AccountCreditDirectory({ onOpen, counterparty = null, dateWindows = [], disputeOnly = false, filters = {} }) {
  const [direction, setDirection] = useState('both');
  const [navigation, setNavigation] = useState(null);
  const directoryFilters = useMemo(() => ({
    portIds: Array.isArray(filters.portIds) ? filters.portIds : [],
    countryCodes: Array.isArray(filters.countryCodes) ? filters.countryCodes : [],
    excludedCountryCodes: Array.isArray(filters.excludedCountryCodes) ? filters.excludedCountryCodes : [],
    koreaDeskMode: filters.koreaDeskMode || 'all',
  }), [filters.countryCodes, filters.excludedCountryCodes, filters.portIds, filters.koreaDeskMode]);
  const filterKey = JSON.stringify([direction, counterparty, dateWindows, disputeOnly, directoryFilters]);
  const { cursor, history } = navigation?.filterKey === filterKey ? navigation : FIRST_PAGE;
  const { snapshot, loading, error, load: requestAccounts } = useDashboardResource(JSON.stringify([filterKey, cursor]));
  const result = snapshot?.data;
  const {
    snapshot: exposureSnapshot, loading: exposurePending, error: exposureError, load: requestExposure,
  } = useDashboardResource(snapshot);
  const accounts = result?.accounts;
  const exposureLoading = Boolean(accounts?.length && exposurePending);

  const load = useCallback(({ force = false } = {}) => requestAccounts('dashboardAccountCreditDirectory', {
    direction, counterparty, dateWindows, disputeOnly, filters: directoryFilters, cursor, limit: PAGE_SIZE, force,
  }, { force, cacheTtlMs: 60_000, cacheTags: ['dashboard', 'account-directory'] }),
  [counterparty, cursor, dateWindows, direction, directoryFilters, disputeOnly, requestAccounts]);
  useEffect(() => { setNavigation(null); }, [filterKey]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const entities = (accounts || []).map((row) => ({ entityType: row.entityType, entityId: row.entityId })).filter((row) => row.entityId);
    if (entities.length) void requestExposure('dashboardAccountExposureBatch', {
      entities, filters: directoryFilters,
    }, { cacheTags: ['dashboard', 'account-exposure'] });
  }, [accounts, directoryFilters, requestExposure]);
  const rows = useMemo(() => mergedRows(accounts, exposureSnapshot?.data.exposures || []), [accounts, exposureSnapshot]);
  const actionable = Boolean(result && !loading && !error);
  const openCurrent = actionable ? onOpen : undefined;
  return <section className="rounded-xl border border-border bg-card">
    <div className="flex items-start justify-between gap-2 border-b border-border p-4">
      <div><div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" /><h2 className="font-semibold">Accounts</h2></div><p className="mt-1 text-xs text-muted-foreground">One merged identity per Account or GROUP. Receivable minus payable is informational, never a cross-currency total.</p></div>
      <Button type="button" size="icon" variant="ghost" className="shrink-0" aria-label="Refresh Accounts" onClick={() => load({ force: true })} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading || exposureLoading ? 'animate-spin' : ''}`} /></Button>
    </div>
    <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
      {DIRECTIONS.map(([value, label]) => <button key={value} type="button" aria-pressed={direction === value} onClick={() => { if (value !== direction) { setNavigation(null); setDirection(value); } }} className={`rounded-full border px-3 py-1 text-xs font-semibold ${direction === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>{label}</button>)}
    </div>
    {error ? <div role="alert" className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
    {loading && !result ? <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Accounts…</div> : null}
    {result ? <div className="relative p-4">
      <DataStatus meta={snapshot.meta} state={error ? 'stale_error' : loading ? 'refreshing' : undefined} label="Accounts" className="mb-2" />
      {loading || exposureLoading ? <div className="absolute right-4 top-2 flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite"><Loader2 className="h-3 w-3 animate-spin" />Updating exposure</div> : null}
      {exposureError ? <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{exposureError}</div> : null}
      <div className="space-y-3 md:hidden">{rows.map((account) => <AccountCard key={account.entityKey} account={account} onOpen={openCurrent} direction={direction} />)}</div>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th scope="col" className="px-3 py-2">Account / GROUP</th>{direction !== 'supplier' ? <th scope="col" className="px-3 py-2 text-right">Buyer receivable</th> : null}{direction !== 'buyer' ? <th scope="col" className="px-3 py-2 text-right">Supplier payable</th> : null}{direction === 'both' ? <th scope="col" className="px-3 py-2 text-right">Receivable − payable</th> : null}{direction !== 'supplier' ? <th scope="col" className="px-3 py-2 text-right">Buyer period GP</th> : null}{direction !== 'buyer' ? <th scope="col" className="px-3 py-2 text-right">Supplier period GP</th> : null}<th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((account) => <AccountRow key={account.entityKey} account={account} onOpen={openCurrent} direction={direction} />)}</tbody></table></div>
      {!rows.length ? <div className="py-10 text-center text-sm text-muted-foreground">No Accounts match the selected direction and Dashboard filters.</div> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Page {history.length + 1}</span><div className="flex items-center gap-1.5"><Button type="button" size="sm" variant="outline" className={COMPACT_BUTTON_CLASS} disabled={!history.length || !actionable} onClick={() => setNavigation({ filterKey, cursor: history.at(-1) ?? null, history: history.slice(0, -1) })}><ChevronLeft className="mr-1 h-3.5 w-3.5" />Previous</Button><Button type="button" size="sm" variant="outline" className={COMPACT_BUTTON_CLASS} disabled={!result.nextCursor || !actionable} onClick={() => setNavigation({ filterKey, cursor: result.nextCursor, history: [...history, cursor] })}>Next<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></div></div>
    </div> : null}
  </section>;
}
