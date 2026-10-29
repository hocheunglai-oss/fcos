import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { amountFor } from '@/lib/xeroCampaignQuota';
import { creditRetryForecast, creditRetryQuotaMessage, creditRetrySelection } from '@/lib/xeroCampaignCreditRetry';

const approvalDate = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';

export function FieldDiff({ row }) {
  if (!row) return null;
  const parts = Array.isArray(row.changes) ? row.changes : [row];
  return <div className="rounded-md border border-border bg-muted/20 p-2 text-xs"><div className="font-medium">{row.caseTitle || row.caseId || row.title || 'Reviewed record'}</div>{parts.map((change, index) => <div key={`${change.field || index}:${index}`} className="mt-1 grid grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2"><span>{change.fieldLabel || change.field || 'Link / action'}</span><span className="break-words text-muted-foreground">Current: {String(change.before ?? '—')}</span><span className="break-words">Proposed: {String(change.after ?? '—')}</span></div>)}</div>;
}
export default function XeroCampaignCreditRetry({ batches, candidates, campaignId, ownerId, allowance, disabled, onRetry }) {
  const [batchId, setBatchId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const batch = batches.find((row) => row.id === batchId) || batches[0];
  useEffect(() => { setSelected(new Set()); }, [batch?.id, batch?.revision, batch?.evidence_fingerprint]);
  const caseIds = creditRetrySelection(batch, selected, ownerId, campaignId);
  const forecast = creditRetryForecast(batch, caseIds.length);
  const hold = creditRetryQuotaMessage(allowance, forecast);
  const evidence = useMemo(() => new Map(candidates.map((row) => [`${row.batchId}:${row.id}`, row.evidenceFingerprint])), [candidates]);
  const rows = (batch?.caseEvidence || []).filter((row) => evidence.get(`${batch.id}:${row.id}`) === row.evidenceFingerprint);
  const toggle = (id) => setSelected((previous) => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else if (next.size < Math.min(25, batch?.maxCases ?? 0)) next.add(id); return next;
  });
  return <section aria-label="Retry held verified credits" className="mt-3 rounded-lg border border-border p-3 text-xs">
    <h3 className="font-semibold">Retry held verified credits</h3>
    <p className="mt-1 text-muted-foreground">Choose up to {Math.min(25, batch?.maxCases ?? 25)} unchanged held credits from this planned batch · {batch?.totalHeldCount ?? batch?.caseIds.length} held in the original approval. Fresh source, target and settlement checks verify links under that approval.</p>
    <label className="mt-2 block">Original approved batch <select aria-label="Original credit retry approval" className="ml-2 rounded border border-input bg-background p-1" value={batch?.id || ''} disabled={disabled} onChange={(event) => { setBatchId(event.target.value); setSelected(new Set()); }}>{batches.map((row) => <option key={row.id} value={row.id}>Approved links · {approvalDate(row.approved_at)} · {row.totalHeldCount ?? row.caseIds.length} held</option>)}</select></label>
    <p className="mt-2">Approved by {batch?.approvedByName || 'Current Finance operator'} · {approvalDate(batch?.approved_at)}</p>
    <details className="mt-1"><summary>Original approval audit details</summary><p className="break-all">Batch: {batch?.id} · Revision {batch?.revision}<br />Operator identity: {batch?.approved_by}<br />Original approval fingerprint: {batch?.evidence_fingerprint}</p></details>
    <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{rows.map((row) => <div key={row.id} className="rounded border border-border p-2"><label className="flex items-start gap-2"><Checkbox aria-label={`Retry ${row.title || row.id}`} checked={selected.has(row.id)} disabled={disabled || (selected.size >= Math.min(25, batch?.maxCases ?? 0) && !selected.has(row.id))} onCheckedChange={() => toggle(row.id)} /><span><strong>{row.title || row.documentNumber || row.id}</strong> · {row.accountName} · {amountFor(row.total, row.currency)}<br />{row.reason || row.reasons?.[0]}</span></label><details className="mt-1"><summary>Source and target evidence</summary><p className="break-all">{row.sourceObject}: {row.sourceId} → Xero {row.targetId}<br />Evidence fingerprint: {row.evidenceFingerprint}</p>{row.reasons?.map((reason, index) => <p key={index}>{reason}</p>)}</details></div>)}</div>
    <div className="mt-2 flex items-center justify-between gap-2"><span>{caseIds.length} selected · {forecast ? `${forecast.callsNeeded} forecast calls · ${allowance?.reserve ?? 200} reserved` : 'Select exact credits for a forecast'}{(caseIds.length > 0 || !rows.length) && hold && <span className="block text-amber-800">{hold}</span>}</span><Button size="sm" disabled={disabled || !caseIds.length || caseIds.length !== selected.size || Boolean(hold)} onClick={() => onRetry(batch, caseIds, forecast)}>Retry verified links</Button></div>
  </section>;
}
