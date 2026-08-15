import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Merge, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import ClauseProjectionSection from '@/components/special-terms/ClauseProjectionSection';
import MigrationReviewPanel from '@/components/special-terms/MigrationReviewPanel';
import SpecialTermLookupField from '@/components/special-terms/SpecialTermLookupField';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SPECIAL_TERM_REVISION_PROJECTIONS, revisionFromDetail, revisionPayload } from '@/lib/specialTermRevision';
import SpecialTermDocumentPreview from '@/components/special-terms/SpecialTermDocumentPreview';
import { documentPreviewKey, specialTermDocumentModel } from '@/lib/specialTermDocumentPreview';

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ruleLookup(id, label, secondary = '', unavailableLabel = 'Unavailable record') {
  return id ? { id, label: label || unavailableLabel, secondary } : null;
}

function localRevisionFromDetail(detail, revision) {
  const keepSavedDraft = Boolean(revision?.id && ['Draft', 'In Review', 'Ready for Approval', 'Changes Requested'].includes(revision.status));
  const projections = Object.fromEntries(SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => {
    const source = revision?.projections?.[key] || detail?.projections?.[key] || {};
    const sourceRows = source.rows?.length ? source.rows : source.activeAssignments || source.assignments || [];
    const assignments = source.proposedAssignments?.length ? source.proposedAssignments : sourceRows;
    return [key, {
      ...source,
      status: 'Active',
      assignments,
      draftAssignments: assignments,
      activeAssignments: assignments,
    }];
  }));
  return {
    id: keepSavedDraft ? revision.id : null,
    sourceRevisionId: keepSavedDraft ? revision.sourceRevisionId || null : revision?.id || null,
    sourceRevisionLastModifiedAt: keepSavedDraft ? revision.sourceRevisionLastModifiedAt || null : revision?.lastModifiedAt || null,
    status: keepSavedDraft ? revision.status : 'Draft',
    lastModifiedAt: revision?.lastModifiedAt || null,
    termLastModifiedAt: detail?.term?.lastModifiedAt || revision?.termLastModifiedAt || null,
    projections,
    rules: revision?.id ? revision.rules || [] : detail?.rules || revision?.rules || [],
    provenance: revision?.provenance || { sourceLabel: 'Preserved live Salesforce wording' },
  };
}

function RevisionRuleEditor({ rules, editable, audienceOptions, countryOptions, onChange }) {
  const update = (index, patch) => onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  const remove = (index) => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  const add = () => onChange([...rules, { id: `draft:${operationId()}`, sourceRuleId: null, audience: 'Buyer', accountId: null, portId: null, productId: null, country: '' }]);
  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Matching rules</p><p className="text-xs text-muted-foreground">These conditions are part of this revision and replace the live rule set only on approval.</p></div>{editable ? <Button type="button" variant="outline" size="sm" onClick={add}><Plus className="mr-1.5 h-3.5 w-3.5" />Add rule</Button> : null}</div>
      {!rules.length ? <p className="text-xs text-muted-foreground">No matching rules are proposed.</p> : null}
      {rules.map((rule, index) => (
        <div key={rule.id || rule.sourceRuleId || index} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
          <div className="space-y-1.5"><Label>Audience</Label><Select disabled={!editable} value={rule.audience || ''} onValueChange={(audience) => update(index, { audience })}><SelectTrigger><SelectValue placeholder="Buyer or Supplier" /></SelectTrigger><SelectContent>{audienceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Country</Label><Select disabled={!editable} value={rule.country || '__any__'} onValueChange={(country) => update(index, { country: country === '__any__' ? '' : country })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__any__">Any country</SelectItem>{countryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <SpecialTermLookupField disabled={!editable} label="Account" kind="account" value={ruleLookup(rule.accountId, rule.accountName, rule.accountClKey, 'Unavailable account')} onChange={(account) => update(index, { accountId: account?.id || null, accountName: account?.label || '', accountClKey: account?.secondary || '' })} placeholder="Search Account name or CL Key" />
          <SpecialTermLookupField disabled={!editable} label="Port" kind="port" value={ruleLookup(rule.portId, rule.portName, rule.portCountry, 'Unavailable port')} onChange={(port) => update(index, { portId: port?.id || null, portName: port?.label || '', portCountry: port?.secondary || '' })} placeholder="Search port name" />
          <SpecialTermLookupField disabled={!editable} label="Product" kind="product" value={ruleLookup(rule.productId, rule.productName, '', 'Unavailable product')} onChange={(product) => update(index, { productId: product?.id || null, productName: product?.label || '' })} placeholder="Search active product" />
          <div className="flex items-end justify-between gap-2"><p className="pb-2 text-xs text-muted-foreground">{rule.priority == null ? 'Priority is recalculated by Salesforce on activation.' : `Current priority: ${rule.priority}`}</p>{editable ? <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)} title="Remove rule from revision"><Trash2 className="h-4 w-4" /></Button> : null}</div>
        </div>
      ))}
    </div>
  );
}

export default function WholeTermRevisionPanel({ detail, canDraft, canApprove, categoryOptions, audienceOptions = [], countryOptions = [], hasUnsavedParentChanges = false, onChanged, onCommitted, onInlinePublished, onStatusMessage, onError }) {
  const initialRevision = useMemo(() => revisionFromDetail(detail), [detail]);
  const [revision, setRevision] = useState(() => localRevisionFromDetail(detail, initialRevision));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [revisionReason, setRevisionReason] = useState(initialRevision?.revisionReason || '');
  const [activeProjection, setActiveProjection] = useState('termsText');
  const [exportingDocument, setExportingDocument] = useState(false);
  const [savedDraftPreviewKey, setSavedDraftPreviewKey] = useState(null);
  const [relink, setRelink] = useState(null);
  const [legacyPreviews, setLegacyPreviews] = useState(null);
  const [legacyPreparing, setLegacyPreparing] = useState(false);

  useEffect(() => {
    setRevision(localRevisionFromDetail(detail, initialRevision));
    setRevisionReason(initialRevision?.revisionReason || '');
    setSavedDraftPreviewKey(initialRevision?.id
      ? documentPreviewKey(specialTermDocumentModel({ term: detail?.term, detail, revision: initialRevision, mode: 'draft' }))
      : null);
  }, [detail, initialRevision]);

  useEffect(() => {
    const legacyKeys = SPECIAL_TERM_REVISION_PROJECTIONS.filter((key) => {
      const projection = detail?.projections?.[key] || {};
      return projection.status !== 'Active' && !(projection.proposedAssignments || []).length;
    });
    if (!detail?.term?.id || !legacyKeys.length) {
      setLegacyPreviews(null);
      return undefined;
    }
    let cancelled = false;
    setLegacyPreparing(true);
    appClient.functions.invoke('specialTermMigrationPreviewAll', { termId: detail.term.id }, { cache: false }).then((response) => {
      if (response.data?.error) throw new Error(response.data.error);
      return legacyKeys.map((projection) => [projection, response.data?.projections?.[projection]]).filter(([, preview]) => preview);
    }).then((entries) => {
      if (cancelled) return;
      const previews = Object.fromEntries(entries);
      setLegacyPreviews(previews);
      setRevision((current) => {
        if (!current) return current;
        const projections = { ...current.projections };
        for (const [projection, preview] of entries) {
          const assignments = (preview.segments || []).map((segment, index) => ({
            id: `legacy:${projection}:${index}`,
            clauseId: segment.selectedClauseId || segment.exactMatchClauseId || `legacy:${projection}:${index}`,
            clauseVersionId: segment.selectedClauseVersionId || segment.exactMatchVersionId || null,
            shortName: segment.suggestedShortName,
            category: segment.suggestedCategory,
            clauseText: segment.clauseText,
            revisionNumber: segment.selectedClauseVersionId || segment.exactMatchVersionId ? 1 : 0,
            clauseStatus: segment.exactMatchStatus || 'Draft',
            versionStatus: segment.selectedClauseVersionId || segment.exactMatchVersionId ? segment.exactMatchStatus || 'Approved' : 'Draft',
            legacyCandidate: true,
          }));
          projections[projection] = { ...(projections[projection] || {}), status: 'Active', style: preview.style, assignments, draftAssignments: assignments, activeAssignments: assignments };
        }
        return { ...current, projections };
      });
      setLegacyPreparing(false);
    }).catch((error) => {
      if (cancelled) return;
      setLegacyPreparing(false);
      onError?.(error.message || 'The preserved legacy wording could not be prepared.');
    });
    return () => { cancelled = true; };
  }, [detail, onError]);

  const status = revision?.status || detail?.term?.revisionStatus || 'Legacy';
  const updateAssignments = (projectionKey, assignments) => {
    setRevision((current) => current ? {
      ...current,
      projections: {
        ...current.projections,
        [projectionKey]: {
          ...(current.projections?.[projectionKey] || {}),
          assignments,
          draftAssignments: assignments,
          activeAssignments: assignments,
        },
      },
    } : current);
  };
  const updateRules = (rules) => setRevision((current) => current ? { ...current, rules } : current);

  const invoke = async (name, payload, success) => {
    setBusy(true);
    onError?.('');
    const response = await appClient.functions.invoke(name, { termId: detail.term.id, ...payload, operationId: operationId() }, { cache: false });
    setBusy(false);
    if (response.data?.error) {
      onError?.(response.data.error);
      return;
    }
    setConfirm(null);
    setRelink(null);
    if (response.data?.detail) {
      const committed = response.data.detail;
      const nextRevision = localRevisionFromDetail(committed, revisionFromDetail(committed));
      setRevision(nextRevision);
      setSavedDraftPreviewKey(nextRevision?.id
        ? documentPreviewKey(specialTermDocumentModel({ term: committed.term, detail: committed, revision: nextRevision, mode: 'draft' }))
        : null);
      setRevisionReason('');
      onCommitted?.(committed, success);
    } else {
      await onChanged?.(success);
    }
  };

  const commit = async (mode) => {
    if (legacyPreparing || busy) return;
    if (legacyPreviews && Object.values(legacyPreviews).some((preview) => preview.manualReviewRequired)) {
      onError?.('This legacy wording has ambiguous clause boundaries. Review the flagged projection before submitting the whole term.');
      return;
    }
    let commitRevision = revision;
    if (legacyPreviews) {
      setBusy(true);
      const response = await appClient.functions.invoke('specialTermMigrationSaveAll', {
        termId: detail.term.id,
        expectedLastModifiedAt: detail.term.lastModifiedAt,
        auditReason: revisionReason,
        projections: SPECIAL_TERM_REVISION_PROJECTIONS.map((projection) => {
          const preview = legacyPreviews[projection] || { style: projection === 'termsText' ? 'Numbered' : 'Hyphen', segments: [] };
          return {
            projection,
            style: preview.style,
            segments: (preview.segments || []).map((segment) => ({
              shortName: segment.suggestedShortName,
              category: segment.suggestedCategory,
              clauseText: segment.clauseText,
              sourceClauseText: segment.sourceClauseText || segment.clauseText,
              legacySourceKey: segment.legacySourceKey,
              draftSource: segment.draftSource || 'Legacy Migration',
              selectedClauseId: segment.selectedClauseId || segment.exactMatchClauseId || null,
              selectedClauseVersionId: segment.selectedClauseVersionId || segment.exactMatchVersionId || null,
            })),
          };
        }),
        operationId: operationId(),
      }, { cache: false });
      if (response.data?.error) {
        setBusy(false);
        onError?.(response.data.error);
        return;
      }
      const preparedDetail = response.data?.detail;
      if (!preparedDetail) {
        setBusy(false);
        onError?.('Salesforce did not return the complete prepared Special Term. Nothing was submitted.');
        return;
      }
      commitRevision = localRevisionFromDetail(preparedDetail, revisionFromDetail(preparedDetail));
      setRevision(commitRevision);
      setLegacyPreviews(null);
      setBusy(false);
    }
    return invoke('specialTermRevisionCommit', {
      ...revisionPayload(commitRevision),
      mode,
      revisionReason,
    }, mode === 'approve_publish' ? 'Special Term approved and published.' : 'Special Term submitted for approval.');
  };

  const exportDocument = async (format, mode) => {
    if (exportingDocument || (mode === 'draft' && !revision?.id)) return;
    setExportingDocument(true);
    onError?.('');
    try {
      const result = await appClient.functions.download('specialTermsDocumentExport', {
        termId: detail.term.id,
        format,
        source: mode,
        revisionId: mode === 'draft' ? revision.id : null,
        expectedLastModifiedAt: detail.term.lastModifiedAt || revision?.termLastModifiedAt || null,
        expectedRevisionLastModifiedAt: mode === 'draft'
          ? revision.expectedLastModifiedAt || revision.lastModifiedAt || null
          : null,
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      onError?.(error.message || 'The Special Term document could not be exported.');
    }
    setExportingDocument(false);
  };

  const editable = canDraft && ['Draft', 'In Review', 'Changes Requested'].includes(status);
  const previewModel = specialTermDocumentModel({ term: detail.term, detail, revision, mode: 'draft' });
  const unsaved = !revision?.id || !savedDraftPreviewKey || savedDraftPreviewKey !== documentPreviewKey(previewModel);
  const selectedProjection = SPECIAL_TERM_REVISION_PROJECTIONS.includes(activeProjection) ? activeProjection : null;
  const clauses = selectedProjection ? <ClauseProjectionSection detail={{ ...detail, projections: revision.projections }} projection={selectedProjection} canManage={editable} canApprove={false} canEditClause={canDraft} canPublishClause={canApprove} localPublicationBlocked={unsaved || hasUnsavedParentChanges} currentTermId={detail?.term?.id} categoryOptions={categoryOptions} onAssignmentsChange={updateAssignments} onChanged={onChanged} onClausePublished={onInlinePublished} onStatusMessage={onStatusMessage} onError={onError} wholeTermRevision /> : null;
  const preview = <SpecialTermDocumentPreview term={detail.term} detail={detail} revision={revision} unsaved={unsaved} onExport={exportDocument} />;
  return (
    <section className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
      {(detail?.consolidationPrompts || []).map((prompt) => <div key={prompt.id} className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-sm font-semibold">Relink required: {prompt.sourceShortName} → {prompt.replacementShortName} v{prompt.replacementRevisionNumber}</p><p className="mt-1 text-xs">{prompt.occurrences.map((row) => `${row.projectionValue} #${row.sequence}`).join(', ')}. Live wording remains unchanged until this whole-term revision is approved.</p></div></div>{canDraft && prompt.status === 'Relinking' ? <Button type="button" size="sm" onClick={() => setRelink({ prompt, reason: '' })} disabled={busy}><Merge className="mr-1.5 h-3.5 w-3.5" />Relink now</Button> : null}</div>)}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><strong className="text-sm">Complete Special Term update</strong><Badge variant={status === 'Approved' || status === 'Active' ? 'default' : 'outline'}>{status}</Badge>{revision.number ? <Badge variant="secondary">Revision {revision.number}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">Edit any section, enter one change reason, then complete the update with one action.</p></div>
      </div>
      {detail?.term?.revisionStatus === 'Legacy' ? <Alert className="border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertDescription>The preserved Salesforce wording remains live. This editor prepares one complete replacement; nothing changes until approval succeeds.</AlertDescription></Alert> : null}
      {legacyPreparing ? <Alert><AlertDescription>Preparing all legacy clauses and exact Clause Library matches…</AlertDescription></Alert> : null}
      {legacyPreviews && Object.entries(legacyPreviews).some(([, preview]) => preview.manualReviewRequired) ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>Manual clause-boundary review is required for {Object.entries(legacyPreviews).filter(([, preview]) => preview.manualReviewRequired).map(([key]) => key === 'termsText' ? 'Terms Text' : key === 'confirmationRemark' ? 'Confirmation' : 'Nomination').join(', ')}. The complete update remains blocked until those boundaries are resolved.</AlertDescription></Alert> : null}
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-2" role="tablist" aria-label="Special Term sections">
        {[
          ['termsText', 'Terms Text'],
          ['confirmationRemark', 'Confirmation'],
          ['nominationRemark', 'Nomination'],
          ['rules', 'Matching Rules'],
          ['preview', 'Preview'],
        ].map(([key, label]) => <Button key={key} type="button" size="sm" variant={activeProjection === key ? 'default' : 'ghost'} onClick={() => setActiveProjection(key)} role="tab" aria-selected={activeProjection === key}>{label}</Button>)}
      </div>
      {clauses}
      {SPECIAL_TERM_REVISION_PROJECTIONS.includes(activeProjection) && legacyPreviews?.[activeProjection]?.manualReviewRequired ? <MigrationReviewPanel detail={detail} projection={activeProjection} categoryOptions={categoryOptions} canApprove={canDraft} draftOnly onChanged={onChanged} onError={onError} /> : null}
      {activeProjection === 'rules' ? <RevisionRuleEditor rules={revision.rules || []} editable={editable} audienceOptions={audienceOptions} countryOptions={countryOptions} onChange={updateRules} /> : null}
      {activeProjection === 'preview' ? preview : null}
      {editable ? <div className="sticky bottom-3 z-10 space-y-3 rounded-lg border border-primary/30 bg-background/95 p-3 shadow-lg backdrop-blur"><div className="space-y-1.5"><Label>Change reason</Label><Textarea value={revisionReason} maxLength={1000} onChange={(event) => setRevisionReason(event.target.value)} placeholder="Why this complete Special Term update is needed" rows={2} /></div><div className="flex justify-end"><Button type="button" onClick={() => commit(canApprove ? 'approve_publish' : 'submit')} disabled={busy || legacyPreparing || exportingDocument || revisionReason.trim().length < 3}>{busy ? 'Working…' : canApprove ? <><CheckCircle2 className="mr-2 h-4 w-4" />Approve &amp; publish</> : <><ShieldCheck className="mr-2 h-4 w-4" />Submit for approval</>}</Button></div></div> : null}
      <details className="rounded-md border border-border bg-background p-3"><summary className="cursor-pointer text-xs font-semibold">Advanced history and provenance</summary>{revision.provenance ? <div className="mt-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Source:</span> {revision.provenance.sourceLabel || 'Salesforce wording'}{revision.provenance.migratedAt ? ` · prepared ${revision.provenance.migratedAt}` : ''}{revision.provenance.mappingDecision ? ` · ${revision.provenance.mappingDecision}` : ''}</div> : null}{detail?.revisionHistory?.length ? <ol className="mt-3 space-y-2 border-l border-border pl-4 text-xs text-muted-foreground">{detail.revisionHistory.map((event) => <li key={event.id}><strong className="text-foreground">Revision {event.revisionNumber} · {event.status}</strong>{event.proposedByEmail ? ` · proposed by ${event.proposedByEmail}` : ''}{event.approvedByEmail ? ` · approved by ${event.approvedByEmail}` : ''}{event.approvedAt ? ` · ${event.approvedAt}` : ''}{event.revisionReason ? <span className="block">{event.revisionReason}</span> : null}</li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">No prior revision history.</p>}{canApprove && revision.sourceRevisionId ? <Button type="button" className="mt-3" size="sm" variant="outline" onClick={() => setConfirm({ type: 'rollback', reason: '' })} disabled={busy}><RotateCcw className="mr-2 h-4 w-4" />Rollback active revision</Button> : null}</details>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Rollback this whole term?</DialogTitle><DialogDescription>This atomically restores the preserved legacy projections and prior rule state.</DialogDescription></DialogHeader>{confirm ? <div className="space-y-1.5"><Label>Mandatory reason</Label><Textarea value={confirm.reason} maxLength={1000} onChange={(event) => setConfirm((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button type="button" variant="destructive" disabled={busy || confirm?.reason.trim().length < 3} onClick={() => invoke('specialTermRevisionRollback', { revisionId: revision.sourceRevisionId || revision.id, expectedLastModifiedAt: revision.sourceRevisionLastModifiedAt || revision.expectedLastModifiedAt || revision.lastModifiedAt, auditReason: confirm.reason }, 'Whole-term revision rolled back to preserved legacy wording.')}>{busy ? 'Working…' : 'Rollback'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(relink)} onOpenChange={(open) => !open && !busy && setRelink(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Relink {relink?.prompt?.sourceShortName}</DialogTitle><DialogDescription>This replaces only matching clause references in the saved whole-term draft, or prepares a complete revision from the live term when no draft exists.</DialogDescription></DialogHeader>{relink ? <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2"><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current source wording</p><p className="mt-2 whitespace-pre-wrap text-sm">{relink.prompt.occurrences[0]?.sourceText}</p></section><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reviewed replacement wording</p><p className="mt-2 whitespace-pre-wrap text-sm">{relink.prompt.replacementText}</p></section></div><div className="space-y-1.5"><Label>Relink reason</Label><Textarea value={relink.reason} maxLength={1000} rows={3} onChange={(event) => setRelink((current) => ({ ...current, reason: event.target.value }))} /></div></div> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setRelink(null)} disabled={busy}>Cancel</Button><Button type="button" disabled={busy || relink?.reason.trim().length < 3} onClick={() => invoke('specialTermClauseConsolidationRelink', { consolidationId: relink.prompt.id, expectedLastModifiedAt: relink.prompt.lastModifiedAt, reason: relink.reason, terms: [{ termId: detail.term.id, expectedLastModifiedAt: detail.term.lastModifiedAt, expectedRevisionLastModifiedAt: detail.revision?.lastModifiedAt || null }] }, 'Clause relink draft prepared for whole-term approval.')}>{busy ? 'Preparing…' : 'Prepare relink draft'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </section>
  );
}
