import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Merge, RotateCcw } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function selectedTerms(selected, consolidation) {
  const selectedIds = new Set(selected[consolidation.id] || []);
  return (consolidation.affectedTerms || []).filter((term) => selectedIds.has(term.termId));
}

export default function ClauseConsolidationQueue({ consolidations = [], canManage, canApprove, onChanged, onError, onOpenTerm }) {
  const [selected, setSelected] = useState({});
  const [dialog, setDialog] = useState(null);
  const [pending, setPending] = useState(() => new Set());

  useEffect(() => {
    const liveIds = new Set(consolidations.map((row) => row.id));
    setSelected((current) => Object.fromEntries(Object.entries(current).filter(([id]) => liveIds.has(id))));
  }, [consolidations]);

  if (!consolidations.length) return null;

  const toggleTerm = (consolidationId, termId, checked) => setSelected((current) => {
    const values = new Set(current[consolidationId] || []);
    if (checked) values.add(termId); else values.delete(termId);
    return { ...current, [consolidationId]: [...values].slice(0, 20) };
  });

  const submit = async () => {
    if (!dialog || pending.has(dialog.consolidation.id)) return;
    const consolidation = dialog.consolidation;
    const functionName = dialog.type === 'relink' ? 'specialTermClauseConsolidationRelink'
      : dialog.type === 'complete' ? 'specialTermClauseConsolidationComplete'
        : 'specialTermClauseConsolidationCancel';
    const terms = selectedTerms(selected, consolidation);
    const payload = {
      consolidationId: consolidation.id,
      expectedLastModifiedAt: consolidation.lastModifiedAt,
      reason: dialog.reason,
      operationId: operationId(),
      ...(dialog.type === 'relink' ? { terms: terms.map((term) => ({ termId: term.termId, expectedLastModifiedAt: term.termLastModifiedAt, expectedRevisionLastModifiedAt: term.revisionLastModifiedAt })) } : {}),
    };
    setPending((current) => new Set(current).add(consolidation.id));
    setDialog(null);
    onError?.('');
    const response = await appClient.functions.invoke(functionName, payload, { cache: false });
    setPending((current) => {
      const next = new Set(current);
      next.delete(consolidation.id);
      return next;
    });
    if (response.data?.error) {
      onError?.(response.data.error);
      return;
    }
    if (dialog.type === 'relink') {
      const failures = (response.data?.results || []).filter((row) => row.status === 'failed');
      setSelected((current) => ({ ...current, [consolidation.id]: failures.map((row) => row.termId) }));
      toast({ title: failures.length ? 'Relink drafts partly prepared' : 'Relink drafts prepared', description: failures.length ? `${failures.length} term${failures.length === 1 ? '' : 's'} still require individual conflict review.` : 'The whole-term revisions are waiting for approval.' });
    } else toast({ title: dialog.type === 'complete' ? 'Source clause retired' : 'Consolidation cancelled', description: 'Salesforce retained the complete clause and assignment history.' });
    await onChanged?.();
  };

  return (
    <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/40 p-4">
      <div className="flex items-start gap-2"><Merge className="mt-0.5 h-4 w-4 text-amber-800" /><div><h3 className="text-sm font-semibold">Clause consolidation queue</h3><p className="text-xs text-muted-foreground">Live wording remains unchanged until each complete Special Term revision is approved.</p></div></div>
      <div className="space-y-3">{consolidations.map((consolidation) => {
        const chosen = selectedTerms(selected, consolidation);
        const working = pending.has(consolidation.id);
        return <article key={consolidation.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{consolidation.sourceShortName}</strong><span className="text-muted-foreground">→</span><strong className="text-sm">{consolidation.replacementShortName} v{consolidation.replacementRevisionNumber}</strong><Badge variant={consolidation.status === 'Paused' ? 'destructive' : consolidation.status === 'Ready to Retire' ? 'default' : 'outline'}>{consolidation.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{consolidation.remainingTermCount} Special Term{consolidation.remainingTermCount === 1 ? '' : 's'} requiring resolution · {consolidation.mappings.length} reviewed source version mapping{consolidation.mappings.length === 1 ? '' : 's'}</p></div><div className="flex flex-wrap gap-2">{canManage && consolidation.status === 'Relinking' && consolidation.affectedTerms.length ? <Button size="sm" disabled={working || !chosen.length} onClick={() => setDialog({ type: 'relink', consolidation, reason: '' })}>{working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-1.5 h-3.5 w-3.5" />}Relink selected</Button> : null}{canApprove && consolidation.status === 'Ready to Retire' ? <Button size="sm" disabled={working} onClick={() => setDialog({ type: 'complete', consolidation, reason: '' })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Complete retirement</Button> : null}{canApprove && !['Completed', 'Cancelled'].includes(consolidation.status) ? <Button size="sm" variant="outline" disabled={working} onClick={() => setDialog({ type: 'cancel', consolidation, reason: '' })}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Cancel</Button> : null}</div></div>
          {consolidation.targetChanged ? <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5" />The replacement version changed. New relinks are paused. Cancel this mapping, then start a new consolidation so a GM or Administrator can review and pin the new version.</div> : null}
          {consolidation.affectedTerms.length ? <div className="grid gap-2 md:grid-cols-2">{consolidation.affectedTerms.map((term) => {
            const selectable = consolidation.status === 'Relinking' && term.revisionState !== 'Awaiting Approval';
            return <div key={term.termId} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"><Checkbox aria-label={`Select ${term.termName}`} checked={(selected[consolidation.id] || []).includes(term.termId)} disabled={working || !selectable} onCheckedChange={(checked) => toggleTerm(consolidation.id, term.termId, checked === true)} /><span className="min-w-0 flex-1"><button type="button" className="block truncate font-medium text-primary hover:underline" onClick={() => onOpenTerm?.({ id: term.termId, name: term.termName })}>{term.termName}</button><span className="block text-xs text-muted-foreground">{term.revisionState} · {term.occurrences.map((row) => `${row.projection} #${row.sequence}`).join(', ')}{term.ownerEmail ? ` · ${term.ownerEmail}` : ''}</span></span></div>;
          })}</div> : <p className="text-xs text-muted-foreground">No live or pending source-clause references remain.</p>}
        </article>;
      })}</div>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{dialog?.type === 'relink' ? 'Prepare governed relink drafts?' : dialog?.type === 'complete' ? 'Retire the source clause?' : 'Cancel this consolidation?'}</DialogTitle><DialogDescription>{dialog?.type === 'relink' ? 'Each selected term is saved as an all-or-none whole-term revision. Live wording does not change until approval.' : dialog?.type === 'complete' ? 'Salesforce will revalidate that no live or pending source references remain, then retain the source as Retired.' : 'Already approved relinks remain effective; the source clause stays approved.'}</DialogDescription></DialogHeader>{dialog ? <div className="space-y-1.5"><Label>Mandatory reason</Label><Textarea value={dialog.reason} maxLength={1000} rows={4} onChange={(event) => setDialog((current) => ({ ...current, reason: event.target.value }))} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button variant={dialog?.type === 'cancel' ? 'destructive' : 'default'} disabled={dialog?.reason.trim().length < 3 || (dialog?.type === 'relink' && !selectedTerms(selected, dialog.consolidation).length)} onClick={submit}>{dialog?.type === 'relink' ? 'Prepare drafts' : dialog?.type === 'complete' ? 'Retire source clause' : 'Cancel consolidation'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </section>
  );
}
