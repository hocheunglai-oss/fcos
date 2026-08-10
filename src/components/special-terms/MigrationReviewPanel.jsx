import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, SplitSquareVertical } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MigrationReviewPanel({ detail, projection = 'termsText', categoryOptions = [], canApprove, onChanged, onError }) {
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const term = detail?.term;
  const projectionDetail = detail?.projections?.[projection] || (projection === 'termsText' ? { key: 'termsText', label: 'Terms Text', status: term?.clauseStructureStatus, style: 'Numbered', originalText: term?.originalTermsText, proposedAssignments: detail?.proposedAssignments || [] } : null);
  const proposed = projectionDetail?.proposedAssignments || [];
  const migrationReady = proposed.length > 0 && proposed.every((row) => ['Approved', 'Superseded'].includes(row.versionStatus) && row.clauseStatus === 'Active');

  if (!term || !projectionDetail || !canApprove) return null;

  const loadPreview = async () => {
    setBusy(true);
    onError?.('');
    const response = await appClient.functions.invoke('specialTermMigrationPreview', { termId: term.id, projection }, { cache: false });
    if (response.data?.error) onError?.(response.data.error);
    else setPreview({ ...response.data, segments: (response.data?.segments || []).map((segment) => ({ ...segment, shortName: segment.suggestedShortName, category: segment.suggestedCategory })) });
    setBusy(false);
  };

  const saveReview = async () => {
    setBusy(true);
    onError?.('');
    const response = await appClient.functions.invoke('specialTermMigrationSave', { termId: term.id, projection, style: preview.style, expectedLastModifiedAt: preview.expectedLastModifiedAt, auditReason: reason, segments: preview.segments.map((segment) => ({ shortName: segment.shortName, category: segment.category, clauseText: segment.clauseText, selectedClauseId: segment.selectedClauseId || null, selectedClauseVersionId: segment.selectedClauseVersionId || null })), operationId: operationId() }, { cache: false });
    if (response.data?.error) onError?.(response.data.error);
    else {
      setPreview(null);
      setReason('');
      await onChanged?.(preview.segments.length ? `${projectionDetail.label} review saved. Draft clauses now await approval.` : `Empty ${projectionDetail.label} confirmed and structured with zero clauses.`);
    }
    setBusy(false);
  };

  const runConfirmedAction = async () => {
    const config = confirmAction?.type === 'activate'
      ? { functionName: 'specialTermMigrationActivate', success: `${projectionDetail.label} clause migration activated.` }
      : { functionName: 'specialTermMigrationRollback', success: `${projectionDetail.label} restored to its preserved original wording.` };
    setBusy(true);
    onError?.('');
    const response = await appClient.functions.invoke(config.functionName, { termId: term.id, projection, expectedLastModifiedAt: term.lastModifiedAt, auditReason: confirmAction.reason, operationId: operationId() }, { cache: false });
    if (response.data?.error) onError?.(response.data.error);
    else {
      setConfirmAction(null);
      await onChanged?.(config.success);
    }
    setBusy(false);
  };

  return (
    <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-700" /><strong className="text-sm">{projectionDetail.label} migration</strong><Badge variant="outline">{projectionDetail.status}</Badge>{projection !== 'termsText' ? <Badge variant="secondary">{projectionDetail.style}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">The original {projectionDetail.label} remains live until every proposed clause version is approved and activation succeeds atomically.</p></div>
        {projectionDetail.status === 'Legacy' ? <Button type="button" variant="outline" onClick={loadPreview} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SplitSquareVertical className="mr-2 h-4 w-4" />}Prepare bullet review</Button> : null}
        {projectionDetail.status === 'In Review' ? <Button type="button" onClick={() => setConfirmAction({ type: 'activate', reason: '' })} disabled={busy || !migrationReady}><CheckCircle2 className="mr-2 h-4 w-4" />Activate clauses</Button> : null}
        {projectionDetail.status === 'Active' && projectionDetail.originalText ? <Button type="button" variant="outline" onClick={() => setConfirmAction({ type: 'rollback', reason: '' })} disabled={busy}><RotateCcw className="mr-2 h-4 w-4" />Rollback migration</Button> : null}
      </div>
      {projectionDetail.status === 'In Review' ? <div className="space-y-2">{proposed.map((row, index) => <div key={row.id} className="flex items-start gap-3 rounded-md border border-border bg-background p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{projectionDetail.style === 'Hyphen' ? '–' : index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{row.shortName}</strong><Badge variant={row.versionStatus === 'Approved' ? 'default' : 'secondary'}>{row.versionStatus} v{row.revisionNumber}</Badge></div><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{row.clauseText}</p></div></div>)}{!migrationReady ? <p className="text-xs text-amber-900">Approve every Draft clause in the Clause Bank before activation.</p> : null}</div> : null}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && !busy && setPreview(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Review {preview?.projectionLabel} clauses for {preview?.termName}</DialogTitle><DialogDescription>Confirm boundaries, output style, and short names. Wording remains exactly as read from Salesforce unless you explicitly change it here.</DialogDescription></DialogHeader>
          {preview?.manualReviewRequired ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{preview.reason}</AlertDescription></Alert> : null}
          {projection !== 'termsText' ? <div className="max-w-xs space-y-1.5"><Label>Bullet style</Label><Select value={preview?.style || 'Hyphen'} onValueChange={(style) => setPreview((current) => ({ ...current, style }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Hyphen">Hyphen (-)</SelectItem><SelectItem value="Numbered">Numbered (1, 2, 3)</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">The marker is generated automatically and is not part of clause wording.</p></div> : null}
          <div className="space-y-3">{preview?.segments.map((segment, index) => (
            <section key={`${index}:${segment.exactMatchClauseId || 'new'}`} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[2.5rem_1fr]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{index + 1}</div>
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5"><Label>Short name</Label><Input value={segment.shortName} disabled={Boolean(segment.selectedClauseId)} onChange={(event) => setPreview((current) => ({ ...current, segments: current.segments.map((row, rowIndex) => rowIndex === index ? { ...row, shortName: event.target.value } : row) }))} /></div>
                  <div className="space-y-1.5"><Label>Category</Label><Select value={segment.category} disabled={Boolean(segment.selectedClauseId)} onValueChange={(category) => setPreview((current) => ({ ...current, segments: current.segments.map((row, rowIndex) => rowIndex === index ? { ...row, category } : row) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categoryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2"><Label>Clause wording</Label>{segment.selectedClauseId ? <Badge variant="outline">Bank clause selected</Badge> : <Badge variant="secondary">Separate Draft candidate</Badge>}</div>
                  <Textarea value={segment.clauseText} rows={6} onChange={(event) => setPreview((current) => ({ ...current, segments: current.segments.map((row, rowIndex) => rowIndex === index ? { ...row, clauseText: event.target.value, selectedClauseId: null, selectedClauseVersionId: null } : row) }))} />
                </div>
                {segment.selectedClauseId ? <Button type="button" size="sm" variant="outline" onClick={() => setPreview((current) => ({ ...current, segments: current.segments.map((row, rowIndex) => rowIndex === index ? { ...row, selectedClauseId: null, selectedClauseVersionId: null } : row) }))}>Keep as a separate clause</Button> : null}
                {segment.nearMatches?.length ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/40 p-3"><p className="text-xs font-medium text-amber-900">Near bank wording — compare side by side; never merge material differences.</p>{segment.nearMatches.map((candidate) => <div key={candidate.versionId} className="space-y-3 rounded-md border border-border bg-background p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs">{candidate.shortName}</strong><Badge variant="outline">v{candidate.revisionNumber}</Badge>{candidate.materialDifference ? <Badge variant="destructive">Materially different</Badge> : <Badge variant="secondary">Review equivalence</Badge>}</div><div className="grid gap-3 md:grid-cols-2"><section className="rounded-md border border-border p-2"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Original clause</p><p className="mt-2 whitespace-pre-wrap text-xs">{segment.clauseText}</p></section><section className="rounded-md border border-amber-200 bg-amber-50/30 p-2"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Bank candidate</p><p className="mt-2 whitespace-pre-wrap text-xs">{candidate.clauseText}</p></section></div><div className="flex justify-end"><Button type="button" size="sm" variant="outline" disabled={candidate.materialDifference || candidate.status === 'Retired'} onClick={() => setPreview((current) => ({ ...current, segments: current.segments.map((row, rowIndex) => rowIndex === index ? { ...row, selectedClauseId: candidate.clauseId, selectedClauseVersionId: candidate.versionId, shortName: candidate.shortName, category: candidate.category } : row) }))}>Use bank clause</Button></div></div>)}</div> : null}
                <div className="flex justify-end gap-1"><Button type="button" variant="outline" size="sm" onClick={() => setPreview((current) => ({ ...current, segments: [...current.segments.slice(0, index + 1), { index: index + 2, clauseText: '', shortName: '', category: 'Other', exactMatchClauseId: null, selectedClauseId: null, selectedClauseVersionId: null, nearMatches: [] }, ...current.segments.slice(index + 1)] }))}>Add clause after</Button><Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setPreview((current) => ({ ...current, segments: current.segments.filter((_, rowIndex) => rowIndex !== index) }))}>Remove</Button></div>
              </div>
            </section>
          ))}</div>
          <div className="space-y-1.5"><Label>Review reason</Label><Textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Why these clause boundaries and candidate mappings are appropriate" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button><Button onClick={saveReview} disabled={busy || reason.trim().length < 3 || (!preview?.segments.length && Boolean(preview?.sourceText?.trim())) || preview?.segments.some((segment) => segment.clauseText.trim().length < 3 || segment.shortName.trim().length < 3)}>{busy ? 'Saving…' : preview?.segments.length ? 'Save review to Salesforce' : 'Confirm empty structure'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && !busy && setConfirmAction(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{confirmAction?.type === 'activate' ? `Activate ${projectionDetail.label} clauses?` : `Rollback ${projectionDetail.label} migration?`}</DialogTitle><DialogDescription>{confirmAction?.type === 'activate' ? `Salesforce will atomically replace the live ${projectionDetail.label} with the approved ${projectionDetail.style === 'Hyphen' ? 'hyphen' : 'numbered'} compilation.` : `Salesforce will atomically remove only the ${projectionDetail.label} assignments and restore its preserved original wording.`}</DialogDescription></DialogHeader>{confirmAction ? <div className="space-y-1.5"><Label>Mandatory reason</Label><Textarea value={confirmAction.reason} maxLength={1000} onChange={(event) => setConfirmAction((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => setConfirmAction(null)} disabled={busy}>Cancel</Button><Button variant={confirmAction?.type === 'rollback' ? 'destructive' : 'default'} onClick={runConfirmedAction} disabled={busy || confirmAction?.reason.trim().length < 3}>{busy ? 'Working…' : confirmAction?.type === 'activate' ? 'Activate' : 'Rollback'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </section>
  );
}
