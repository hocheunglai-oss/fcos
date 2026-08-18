import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { appClient } from '@/api/appClient';

const money = (value, currency) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? `${currency || 'USD'} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';

export default function CombinedAccountStatement({ accountId, entityType = 'account', dashboardScope, active, onStemClick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(null);
  useEffect(() => {
    if (!active || !accountId) return undefined;
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller; setLoading(true); setError('');
    appClient.functions.invoke('dashboardAccountCreditStatement', { side: 'both', accountId, entityId: accountId, entityType, scope: dashboardScope?.mode, filters: dashboardScope?.filters || {} }, { cache: true, cacheTtlMs: 60_000, signal: controller.signal }).then((response) => { if (controller.signal.aborted) return; if (response.data?.error) throw new Error(response.data.error); setData(response.data); }).catch((loadError) => { if (!controller.signal.aborted) setError(loadError.message || 'Combined statement could not be loaded.'); }).finally(() => { if (requestRef.current === controller) setLoading(false); });
    return () => controller.abort();
  }, [accountId, active, dashboardScope, entityType]);
  const statement = data?.combined || data?.statement?.combined;
  const currencies = statement?.currencies || [];
  const warning = statement?.warning || null;
  if (loading && !data) return <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading combined statement…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>;
  if (!currencies.length) return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No combined statement exposure is available.</div>;
  return <div className="space-y-4"><div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><AlertTriangle className="mr-2 inline h-4 w-4" />Netting may conceal gross receivable and payable risk.{warning ? <p className="mt-1">{warning}</p> : null}</div>{currencies.map((currency) => <section key={currency.currency} className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">{currency.currency}</h3><p className="mt-1 text-xs text-muted-foreground">Buyer and supplier steps remain separate; secondary line is buyer receivable minus supplier payable.</p></div><div className="grid grid-cols-3 gap-3 text-right text-xs"><span>Buyer <b className="block text-sky-700">{money(currency.buyerOpening, currency.currency)}</b></span><span>Supplier <b className="block text-amber-700">{money(currency.supplierOpening, currency.currency)}</b></span><span>Net <b className="block">{money(currency.netOpening, currency.currency)}</b></span></div></div>{currency.points?.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={currency.points}><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(value, name) => [money(value, currency.currency), name]} /><Line type="stepAfter" dataKey="buyer" name="Buyer receivable" stroke="#0284c7" strokeWidth={3} dot={false} /><Line type="stepAfter" dataKey="supplier" name="Supplier payable" stroke="#d97706" strokeWidth={3} dot={false} /><Line type="stepAfter" dataKey="net" name="Receivable − payable (informational)" stroke="#475569" strokeWidth={2} strokeDasharray="5 4" dot={false} /></LineChart></ResponsiveContainer></div> : <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">A combined forecast is hidden because complete single-currency evidence is unavailable for both directions.</div>}{currency.points?.some((point) => point.stemId) ? <div className="mt-2 flex flex-wrap gap-2">{currency.points.filter((point) => point.stemId).map((point) => <button type="button" key={`${point.date}:${point.stemId}`} onClick={() => onStemClick?.(point.stemId)} className="text-xs font-semibold text-primary underline">{point.stemName || point.stemId}</button>)}</div> : null}</section>)}</div>;
}
