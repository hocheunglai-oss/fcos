import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
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

function initialForm(preview, row) {
  return {
    shortName: preview?.defaults?.shortName || row?.shortName || '',
    category: preview?.defaults?.category || row?.category || 'Other',
    clauseText: preview?.defaults?.clauseText || row?.latestApprovedVersion?.clauseText || row?.clauseText || '',
    revisionReason: '',
  };
}

export default function ClauseInlineEditDialog({
  row,
  open,
  canPublishGlobally = false,
  localPublicationBlocked = false,
  categoryOptions = [],
  currentTermId = null,
  projectionLabel = 'Clause',
  onClose,
  onPendingChange,
  onDraftSaved,
  onPublished,
}) {
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState(() => initialForm(null, row));
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const pendingKey = row ? `${row.clauseId}:${row.clauseVersionId}` : null;

  useEffect(() => {
    if (!open || !row?.clauseId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setReview(null);
    setConfirmation('');
    void appClient.functions.invoke('specialTermClauseEditPreview', { clauseId: row.clauseId }, { cache: false }).then((response) => {
      if (cancelled) return;
      if (response.data?.error) {
        setError(response.data.error);
        setPreview(null);
      } else {
        setPreview(response.data);
        setForm(initialForm(response.data, row));
      }
      setLoading(false);
    }).catch((requestError) => {
      if (cancelled) return;
      setError(requestError?.message || 'The clause impact could not be loaded.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, row]);

  const rowUsesOlderVersion = useMemo(() => Boolean(
    preview?.latestApprovedVersion?.id
      && row?.clauseVersionId
      && preview.latestApprovedVersion.id !== row.clauseVersionId,
  ), [preview, row]);
  const valid = form.shortName.trim().length >= 3
    && form.category
    && form.clauseText.trim().length >= 3
    && form.revisionReason.trim().length >= 3;
  const blockers = review?.blockers || preview?.blockers || [];
  const affectedTermCount = Number(review?.termCount ?? preview?.termCount ?? 0);
  const editingDraftBase = preview?.draftVersion?.status === 'Draft';
  const canApproveInitialDraft = canPublishGlobally
    && editingDraftBase
    && !preview?.latestApprovedVersion;

  const finish = (callback, payload) => {
    setSubmitting(false);
    onPendingChange?.(pendingKey, false);
    callback?.(payload);
  };

  const saveDraft = async () => {
    if (!preview || !valid || submitting) return;
    setSubmitting(true);
    setError('');
    onPendingChange?.(pendingKey, true);
    const draft = preview.draftVersion;
    try {
      const response = await appClient.functions.invoke('specialTermClauseDraftSave', {
        clauseId: row.clauseId,
        versionId: draft?.id || null,
        shortName: form.shortName,
        category: form.category,
        clauseText: form.clauseText,
        revisionReason: form.revisionReason,
        expectedLastModifiedAt: draft?.lastModifiedAt || preview.clauseLastModifiedAt,
        expectedClauseLastModifiedAt: preview.clauseLastModifiedAt,
        draftSource: 'Manual',
        operationId: operationId(),
      }, { cache: false });
      if (response.data?.error) {
        setError(response.data.error);
        setSubmitting(false);
        onPendingChange?.(pendingKey, false);
        return;
      }
      finish(onDraftSaved, response.data);
    } catch (requestError) {
      setError(requestError?.message || 'The proposed Draft could not be saved.');
      setSubmitting(false);
      onPendingChange?.(pendingKey, false);
    }
  };

  const reviewGlobalPublication = async () => {
    if (!preview || !valid || submitting || localPublicationBlocked) return;
    setSubmitting(true);
    setError('');
    onPendingChange?.(pendingKey, true);
    try {
      const response = await appClient.functions.invoke('specialTermClauseEditPreview', {
        clauseId: row.clauseId,
        review: true,
        ...form,
      }, { cache: false });
      if (response.data?.error) {
        setError(response.data.error);
        setSubmitting(false);
        onPendingChange?.(pendingKey, false);
        return;
      }
      setReview(response.data);
      setConfirmation('');
      setSubmitting(false);
      onPendingChange?.(pendingKey, false);
    } catch (requestError) {
      setError(requestError?.message || 'The global impact could not be reviewed.');
      setSubmitting(false);
      onPendingChange?.(pendingKey, false);
    }
  };

  const publishGlobally = async () => {
    if (!review?.previewToken || blockers.length || confirmation !== review.confirmationLabel || submitting) return;
    setSubmitting(true);
    setError('');
    onPendingChange?.(pendingKey, true);
    try {
      const response = await appClient.functions.invoke('specialTermClauseGlobalPublish', {
        clauseId: row.clauseId,
        currentTermId,
        ...form,
        confirmationLabel: confirmation,
        previewToken: review.previewToken,
        operationId: operationId(),
      }, { cache: false });
      if (response.data?.error) {
        setError(response.data.error);
        setSubmitting(false);
        onPendingChange?.(pendingKey, false);
        return;
      }
      finish(onPublished, response.data);
    } catch (requestError) {
      setError(requestError?.message || 'The clause could not be published globally.');
      setSubmitting(false);
      onPendingChange?.(pendingKey, false);
    }
  };

  const approveInitialDraft = async () => {
    if (!canApproveInitialDraft || !preview || !valid || submitting) return;
    setSubmitting(true);
    setError('');
    onPendingChange?.(pendingKey, true);
    try {
      const response = await appClient.functions.invoke('specialTermClauseApprove', {
        clauseId: row.clauseId,
        versionId: preview.draftVersion.id,
        shortName: form.shortName,
        category: form.category,
        clauseText: form.clauseText,
        revisionReason: form.revisionReason,
        approvalReason: form.revisionReason,
        applyDraftEdits: true,
        expectedClauseLastModifiedAt: preview.clauseLastModifiedAt,
        expectedVersionLastModifiedAt: preview.draftVersion.lastModifiedAt,
        operationId: operationId(),
      }, { cache: false });
      if (response.data?.error || !response.data?.clause) {
        setError(response.data?.error || 'Salesforce did not return the approved v1 clause. Refresh before retrying.');
        setSubmitting(false);
        onPendingChange?.(pendingKey, false);
        return;
      }
      finish(onPublished, { ...response.data, initialApproval: true, termCount: 0, occurrenceCount: 0 });
    } catch (requestError) {
      setError(requestError?.message || 'The edited v1 Draft could not be approved.');
      setSubmitting(false);
      onPendingChange?.(pendingKey, false);
    }
  };

  const close = () => {
    if (submitting) return;
    setPreview(null);
    setReview(null);
    setError('');
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit this Special Term clause</DialogTitle>
          <DialogDescription>Create a new version for this {projectionLabel} row. Other Special Terms stay pinned to their current wording unless you explicitly choose the global action.</DialogDescription>
        </DialogHeader>

        {loading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the authoritative clause and its live impact…</div> : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {!loading && preview ? <div className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Saving selects a proposed clause version only in this term’s whole-term draft. It does not update live wording or any other Special Term.</AlertDescription>
          </Alert>
          {localPublicationBlocked && canPublishGlobally && !canApproveInitialDraft ? <Alert variant="destructive"><AlertDescription>Save or discard the unsaved whole-term or Special Term metadata changes before reviewing a global publication.</AlertDescription></Alert> : null}
          {canApproveInitialDraft ? <Alert className="border-emerald-300 bg-emerald-50 text-emerald-950"><CheckCircle2 className="h-4 w-4" /><AlertDescription>This Draft-only v1 has no approved base. You may approve the wording entered above directly into the Clause Bank. No live Special Term is changed by this initial approval.</AlertDescription></Alert> : null}
          {rowUsesOlderVersion ? <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertDescription>This row displays v{row.revisionNumber}, but the Clause Bank is already at v{preview.latestApprovedVersion?.revisionNumber}. Editing starts from the latest approved wording and publication moves every live version to the new version.</AlertDescription></Alert> : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Short name</Label><Input value={form.shortName} maxLength={80} disabled={Boolean(preview.latestApprovedVersion)} onChange={(event) => { setForm((current) => ({ ...current, shortName: event.target.value })); setReview(null); }} /><p className="text-xs text-muted-foreground">Established shared names change only through Clause Library governance.</p></div>
            <div className="space-y-1.5"><Label>Category</Label><Select value={form.category} disabled={Boolean(preview.latestApprovedVersion)} onValueChange={(category) => { setForm((current) => ({ ...current, category })); setReview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categoryOptions.map((option) => <SelectItem key={option.value || option} value={option.value || option}>{option.label || option}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Established shared categories change only through Clause Library governance.</p></div>
          </div>
          <div className="space-y-1.5"><Label>Clause wording</Label><Textarea value={form.clauseText} rows={9} maxLength={32768} onChange={(event) => { setForm((current) => ({ ...current, clauseText: event.target.value })); setReview(null); }} /></div>
          <div className="space-y-1.5"><Label>Mandatory revision reason</Label><Textarea value={form.revisionReason} rows={3} maxLength={1000} onChange={(event) => { setForm((current) => ({ ...current, revisionReason: event.target.value })); setReview(null); }} /></div>

          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">Clicked row</strong><Badge variant="secondary">v{row.revisionNumber}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{row.clauseText}</p></section>
            <section className="rounded-lg border border-primary/30 bg-primary/5 p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">Editing base</strong><Badge>v{preview.draftVersion?.revisionNumber || preview.latestApprovedVersion?.revisionNumber}{preview.draftVersion ? ' Draft' : ' Approved'}</Badge>{canPublishGlobally && editingDraftBase ? <Badge variant="outline">Ready for approval review</Badge> : null}</div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{preview.defaults?.clauseText}</p>{canPublishGlobally ? <p className="mt-2 text-xs text-muted-foreground">Approval uses the wording, short name, and category currently entered above. The authoritative impact must pass before publication.</p> : null}</section>
          </div>

          {canPublishGlobally && !canApproveInitialDraft ? <section className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Authoritative global impact</p><p className="text-xs text-muted-foreground">{review?.termCount ?? preview.termCount} live term(s) · {review?.occurrenceCount ?? preview.occurrenceCount} occurrence(s)</p></div>{Number(review?.termCount ?? preview.termCount) === 0 ? <Badge variant="outline">No live terms change</Badge> : null}</div>
            <div className="flex flex-wrap gap-2">{Object.entries(review?.projectionCounts || preview.projectionCounts || {}).map(([projection, count]) => <Badge key={projection} variant="secondary">{projection}: {count}</Badge>)}{Object.entries(review?.sourceVersionCounts || preview.sourceVersionCounts || {}).map(([version, count]) => <Badge key={version} variant="outline">Source v{version}: {count}</Badge>)}</div>
            <div className="max-h-44 space-y-1 overflow-y-auto">{(review?.terms || preview.terms || []).map((term) => <div key={term.termId} className="rounded border border-border px-2.5 py-2 text-xs"><strong>{term.termName}</strong><span className="ml-2 text-muted-foreground">{term.occurrences.map((occurrence) => `${occurrence.projection} #${occurrence.sequence} (v${occurrence.sourceRevisionNumber})`).join(', ')}</span></div>)}</div>
            {blockers.length ? <Alert variant="destructive"><AlertDescription><strong>Global publication is blocked.</strong><ul className="mt-2 list-disc space-y-1 pl-5">{blockers.map((blocker, index) => <li key={`${blocker.code}:${blocker.termId || index}`}>{blocker.termName ? `${blocker.termName}: ` : ''}{blocker.message}</li>)}</ul></AlertDescription></Alert> : null}
            {review?.previewToken && !blockers.length ? <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3"><Label>Type {review.confirmationLabel} exactly to publish</Label><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /><p className="text-xs text-amber-950">This approved action creates and activates complete revisions for every affected Special Term. It cannot partially succeed.</p></div> : null}
          </section> : null}
        </div> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={saveDraft} disabled={!preview || !valid || submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{preview?.draftVersion ? 'Use updated Draft in this term' : 'Use new Draft in this term'}</Button>
          {canApproveInitialDraft ? <Button type="button" onClick={approveInitialDraft} disabled={!preview || !valid || submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Approve edited v1 Draft directly</Button> : null}
          {canPublishGlobally && !canApproveInitialDraft && !review?.previewToken ? <Button type="button" variant="outline" onClick={reviewGlobalPublication} disabled={!preview || !valid || submitting || localPublicationBlocked}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Update shared wording everywhere</Button> : null}
          {canPublishGlobally && review?.previewToken ? <><Button type="button" variant="outline" onClick={() => { setReview(null); setConfirmation(''); }} disabled={submitting}>Back to edit</Button><Button type="button" onClick={publishGlobally} disabled={submitting || blockers.length > 0 || confirmation !== review.confirmationLabel}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Approve editing base{affectedTermCount ? ` and update ${affectedTermCount} term${affectedTermCount === 1 ? '' : 's'}` : ''}</Button></> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
