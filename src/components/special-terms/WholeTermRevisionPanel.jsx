import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Merge, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
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
import { SPECIAL_TERM_REVISION_PROJECTIONS, revisionDraftSignature, revisionFromDetail, revisionPayload, revisionRuleIssues } from '@/lib/specialTermRevision';
import { editableRevisionReason, SPECIAL_TERM_PENDING_REASON } from '../../../shared/specialTermDraftPolicy';
import SpecialTermDocumentPreview from '@/components/special-terms/SpecialTermDocumentPreview';
import SpecialTermPdfPreviewDialog from '@/components/special-terms/SpecialTermPdfPreviewDialog';
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
    const sourceRows = revision?.id ? source.rows || source.assignments || [] : source.activeAssignments || source.assignments || [];
    const assignments = revision?.id ? sourceRows : source.proposedAssignments?.length ? source.proposedAssignments : sourceRows;
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
    number: revision?.revisionNumber || null,
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

function RevisionRuleEditor({ rules, editable, audienceOptions, countryOptions, issues = [], onChange }) {
  const update = (index, patch) => onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  const remove = (index) => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  const add = () => onChange([...rules, { id: `draft:${operationId()}`, sourceRuleId: null, audience: 'Buyer', accountId: null, portId: null, productId: null, country: '' }]);
  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Matching rules</p><p className="text-xs text-muted-foreground">These conditions are part of this revision and replace the live rule set only on approval.</p></div>{editable ? <Button type="button" variant="outline" size="sm" onClick={add} disabled={rules.length >= 100}><Plus className="mr-1.5 h-3.5 w-3.5" />Add rule</Button> : null}</div>
      {!rules.length ? <p className="text-xs text-muted-foreground">No matching rules are proposed.</p> : null}
      {rules.map((rule, index) => (
        <div key={rule.id || rule.sourceRuleId || index} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2" aria-describedby={issues.some((issue) => issue.index === index) ? `rule-${index}-errors` : undefined}>
          <div className="space-y-1.5"><Label>Audience {!(rule.sourceRuleId || (!Object.hasOwn(rule, 'sourceRuleId') && rule.id && !String(rule.id).startsWith('draft:'))) ? <span className="text-destructive">*</span> : null}</Label><Select disabled={!editable} value={rule.audience || ''} onValueChange={(audience) => update(index, { audience })}><SelectTrigger aria-label={`Rule ${index + 1} audience`} aria-invalid={issues.some((issue) => issue.index === index && issue.field === 'audience')}><SelectValue placeholder="Buyer or Supplier" /></SelectTrigger><SelectContent>{audienceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Country</Label><Select disabled={!editable} value={rule.country || '__any__'} onValueChange={(country) => update(index, { country: country === '__any__' ? '' : country })}><SelectTrigger aria-label={`Rule ${index + 1} country`} aria-invalid={issues.some((issue) => issue.index === index && issue.field === 'country')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__any__">Any country</SelectItem>{countryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <p className="text-xs text-muted-foreground md:col-span-2">Choose at least one condition <span className="text-destructive">*</span>: Account, Port, Product, or Country.</p>
          <SpecialTermLookupField disabled={!editable} label="Account" kind="account" value={ruleLookup(rule.accountId, rule.accountName, rule.accountClKey, 'Unavailable account')} onChange={(account) => update(index, { accountId: account?.id || null, accountName: account?.label || '', accountClKey: account?.secondary || '' })} placeholder="Search Account name or CL Key" />
          <SpecialTermLookupField disabled={!editable} label="Port" kind="port" value={ruleLookup(rule.portId, rule.portName, rule.portCountry, 'Unavailable port')} onChange={(port) => update(index, { portId: port?.id || null, portName: port?.label || '', portCountry: port?.secondary || '' })} placeholder="Search port name" />
          <SpecialTermLookupField disabled={!editable} label="Product" kind="product" value={ruleLookup(rule.productId, rule.productName, '', 'Unavailable product')} onChange={(product) => update(index, { productId: product?.id || null, productName: product?.label || '' })} placeholder="Search active product" />
          <div className="flex items-end justify-between gap-2"><p className="pb-2 text-xs text-muted-foreground">{rule.priority == null ? 'Priority is recalculated by Salesforce on activation.' : `Current priority: ${rule.priority}`}</p>{editable ? <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)} title="Remove rule from revision"><Trash2 className="h-4 w-4" /></Button> : null}</div>
          {issues.some((issue) => issue.index === index) ? <ul id={`rule-${index}-errors`} className="space-y-1 text-xs text-destructive md:col-span-2" role="alert">{issues.filter((issue) => issue.index === index).map((issue) => <li key={issue.field}>{issue.message}</li>)}</ul> : null}
        </div>
      ))}
    </div>
  );
}

export default function WholeTermRevisionPanel({ detail, canDraft, canApprove, externalBusy = false, categoryOptions, audienceOptions = [], countryOptions = [], hasUnsavedParentChanges = false, onChanged, onCommitted, onInlinePublished, onStatusMessage, onError, onDirtyChange }) {
  const initialRevision = useMemo(() => revisionFromDetail(detail), [detail]);
  const initialReason = editableRevisionReason(initialRevision);
  const [revision, setRevision] = useState(() => localRevisionFromDetail(detail, initialRevision));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [revisionReason, setRevisionReason] = useState(initialReason.trim().toUpperCase() === 'N/A' ? '' : initialReason);
  const [reasonNotApplicable, setReasonNotApplicable] = useState(initialReason.trim().toUpperCase() === 'N/A');
  const [activeProjection, setActiveProjection] = useState('termsText');
  const [pdfRequest, setPdfRequest] = useState(null);
  const [savedDraftPreviewKey, setSavedDraftPreviewKey] = useState(null);
  const [relink, setRelink] = useState(null);
  const [legacyPreviews, setLegacyPreviews] = useState(null);
  const [legacyPreparing, setLegacyPreparing] = useState(false);
  const [baselineSignature, setBaselineSignature] = useState(() => revisionDraftSignature(localRevisionFromDetail(detail, initialRevision), initialReason));
  const [reasonError, setReasonError] = useState(false);
  const busyRef = useRef(false);
  const [boundaryReviewOpen, setBoundaryReviewOpen] = useState(false);
  const [reviewedBoundaries, setReviewedBoundaries] = useState(false);

  useEffect(() => {
    const nextReason = editableRevisionReason(initialRevision);
    setRevision(localRevisionFromDetail(detail, initialRevision));
    setBaselineSignature(revisionDraftSignature(localRevisionFromDetail(detail, initialRevision), nextReason));
    setReasonError(false);
    setReviewedBoundaries(false);
    setRevisionReason(nextReason.trim().toUpperCase() === 'N/A' ? '' : nextReason);
    setReasonNotApplicable(nextReason.trim().toUpperCase() === 'N/A');
    setSavedDraftPreviewKey(initialRevision?.id
      ? documentPreviewKey(specialTermDocumentModel({ term: detail?.term, detail, revision: initialRevision, mode: 'draft' }))
      : null);
  }, [detail, initialRevision]);

  useEffect(() => {
    const legacyKeys = SPECIAL_TERM_REVISION_PROJECTIONS.filter((key) => {
      const projection = detail?.projections?.[key] || {};
      return projection.status !== 'Active' && !(projection.proposedAssignments || []).length;
    });
    if (!detail?.term?.id || initialRevision?.id || !legacyKeys.length) {
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
        const hydrated = { ...current, projections };
        setBaselineSignature((baseline) => baseline === revisionDraftSignature(current, editableRevisionReason(initialRevision)) ? revisionDraftSignature(hydrated, editableRevisionReason(initialRevision)) : baseline);
        return hydrated;
      });
      setLegacyPreparing(false);
    }).catch((error) => {
      if (cancelled) return;
      setLegacyPreparing(false);
      onError?.(error.message || 'The preserved legacy wording could not be prepared.');
    });
    return () => { cancelled = true; };
  }, [detail, initialRevision, onError]);

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

  const effectiveReason = reasonNotApplicable ? 'N/A' : revisionReason;
  const dirty = reviewedBoundaries || revisionDraftSignature(revision, effectiveReason) !== baselineSignature;
  const ruleIssues = revisionRuleIssues(revision.rules || [], { audienceOptions, countryOptions });
  useEffect(() => { onDirtyChange?.({ dirty: dirty || boundaryReviewOpen, busy: busy || externalBusy }); }, [dirty, busy, boundaryReviewOpen, externalBusy, onDirtyChange]);

  const invoke = async (name, payload, success, alreadyBusy = false) => {
    if (busyRef.current && !alreadyBusy) return;
    busyRef.current = true;
    setBusy(true);
    onError?.('');
    try {
      const response = await appClient.functions.invoke(name, { termId: detail.term.id, ...payload, operationId: operationId() }, { cache: false });
      if (response.data?.error) throw new Error(response.data.error);
      setConfirm(null);
      setRelink(null);
      if (response.data?.detail) {
        const committed = response.data.detail;
        onCommitted?.(committed, success);
      } else {
        await onChanged?.(success);
      }
      return true;
    } catch (error) {
      onError?.(error.message || 'The update could not be saved. Your edits are still here.');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const commit = async (mode) => {
    if (legacyPreparing || busyRef.current || externalBusy || boundaryReviewOpen) return;
    if (ruleIssues.length) { setActiveProjection('rules'); onError?.('Complete the highlighted matching rules before saving.'); return; }
    if (mode !== 'save_draft' && effectiveReason.trim().length < 3) { setReasonError(true); document.getElementById('special-term-change-reason')?.focus(); return; }
    if (legacyPreviews && Object.values(legacyPreviews).some((preview) => preview.manualReviewRequired)) {
      onError?.('This legacy wording has ambiguous clause boundaries. Review the flagged projection before submitting the whole term.');
      return;
    }
    let commitRevision = revision;
    busyRef.current = true;
    setBusy(true);
    try {
      if (legacyPreviews) {
        const response = await appClient.functions.invoke('specialTermMigrationSaveAll', {
          termId: detail.term.id,
          expectedLastModifiedAt: detail.term.lastModifiedAt,
          auditReason: effectiveReason.trim().length >= 3 ? effectiveReason : SPECIAL_TERM_PENDING_REASON,
          projections: SPECIAL_TERM_REVISION_PROJECTIONS.map((projection) => {
            const preview = legacyPreviews[projection] || { style: projection === 'termsText' ? 'Numbered' : 'Hyphen', segments: [] };
            return {
              projection,
              preservePrepared: !legacyPreviews[projection],
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
          throw new Error(response.data.error);
        }
        const preparedDetail = response.data?.detail;
        if (!preparedDetail) {
          throw new Error('Salesforce did not return the complete prepared Special Term. Nothing was submitted.');
        }
        const prepared = localRevisionFromDetail(preparedDetail, revisionFromDetail(preparedDetail));
        // Preparation assigns Salesforce IDs. Preserve edits, row order, removals,
        // and matching rules made while reviewing the original legacy preview.
        commitRevision = { ...prepared, rules: revision.rules, projections: Object.fromEntries(SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => {
          const original = revision.projections[key];
          const assignments = (original.assignments || []).map((row) => {
            const match = String(row.id || '').match(new RegExp(`^legacy:${key}:(\\d+)$`));
            const source = match ? legacyPreviews[key]?.segments?.[Number(match[1])] : null;
            const originalVersionId = source?.selectedClauseVersionId || source?.exactMatchVersionId || null;
            return source && row.clauseVersionId === originalVersionId ? prepared.projections[key].assignments[Number(match[1])] : row;
          });
          if (assignments.some((row) => !row?.clauseVersionId)) throw new Error('A prepared clause is unavailable. Refresh and review the draft before saving.');
          return [key, { ...original, assignments, draftAssignments: assignments, activeAssignments: assignments }];
        })) };
        setRevision(commitRevision);
        setLegacyPreviews(null);
      }
      return await invoke('specialTermRevisionCommit', {
        ...revisionPayload(commitRevision),
        mode,
        revisionReason: reasonNotApplicable ? 'N/A' : revisionReason,
      }, mode === 'save_draft' ? 'Draft saved. Live Special Terms remain unchanged.' : mode === 'approve_publish' ? 'Special Term approved and published.' : 'Special Term submitted for approval.', true);
    } catch (error) { onError?.(error.message || 'The draft could not be prepared. Your edits are still here.'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const applyBoundaryReview = ({ projection, style, segments, reason }) => {
    setReviewedBoundaries(true);
    const reviewedSegments = segments.map((segment) => ({ ...segment, exactMatchClauseId: null, exactMatchVersionId: null, suggestedShortName: segment.shortName, suggestedCategory: segment.category }));
    const assignments = reviewedSegments.map((segment, index) => ({
      id: `legacy:${projection}:${index}`,
      clauseId: segment.selectedClauseId || `legacy:${projection}:${index}`,
      clauseVersionId: segment.selectedClauseVersionId || null,
      shortName: segment.shortName, category: segment.category, clauseText: segment.clauseText,
      clauseStatus: segment.selectedClauseVersionId ? 'Active' : 'Draft',
      versionStatus: segment.selectedClauseVersionId ? 'Approved' : 'Draft', legacyCandidate: true,
    }));
    setLegacyPreviews((current) => ({ ...current, [projection]: { ...current?.[projection], style, segments: reviewedSegments, manualReviewRequired: false } }));
    setRevision((current) => ({ ...current, projections: { ...current.projections, [projection]: { ...current.projections[projection], style, assignments, draftAssignments: assignments, activeAssignments: assignments } } }));
    if (!effectiveReason.trim() && reason.trim()) setRevisionReason(reason);
    onError?.('');
    onStatusMessage?.('Clause boundaries reviewed. Save Draft or complete the whole-term approval when ready.');
  };

  const previewPdf = (mode) => {
    if (mode === 'draft' && (!revision?.id || unsaved)) return;
    setPdfRequest({
      termId: detail.term.id,
      termName: detail.term.name,
      source: mode,
      revisionId: mode === 'draft' ? revision.id : null,
      expectedLastModifiedAt: revision?.termLastModifiedAt || detail.term.lastModifiedAt || null,
      expectedRevisionLastModifiedAt: mode === 'draft'
        ? revision.expectedLastModifiedAt || revision.lastModifiedAt || null
        : null,
    });
  };

  const editable = canDraft && !busy && !legacyPreparing && !externalBusy && ['Draft', 'In Review', 'Ready for Approval', 'Changes Requested'].includes(status);
  const previewModel = specialTermDocumentModel({ term: detail.term, detail, revision, mode: 'draft' });
  const livePreviewModel = specialTermDocumentModel({ term: detail.term, detail, revision, mode: 'live' });
  const hasTermsDocument = Boolean(previewModel.termsText.trim() || livePreviewModel.termsText.trim());
  const unsaved = !revision?.id || !savedDraftPreviewKey || savedDraftPreviewKey !== documentPreviewKey(previewModel);
  const selectedProjection = SPECIAL_TERM_REVISION_PROJECTIONS.includes(activeProjection) ? activeProjection : null;
  const clauses = selectedProjection ? <ClauseProjectionSection detail={{ ...detail, projections: revision.projections }} projection={selectedProjection} canManage={editable} canApprove={false} canEditClause={canDraft} canPublishClause={canApprove} localPublicationBlocked={dirty || unsaved || hasUnsavedParentChanges} currentTermId={detail?.term?.id} categoryOptions={categoryOptions} onAssignmentsChange={updateAssignments} onChanged={onChanged} onClausePublished={onInlinePublished} onStatusMessage={onStatusMessage} onError={onError} wholeTermRevision /> : null;
  const preview = hasTermsDocument ? <SpecialTermDocumentPreview term={detail.term} detail={detail} revision={revision} unsaved={unsaved} onPreviewPdf={previewPdf} /> : null;
  useEffect(() => {
    if (!hasTermsDocument && activeProjection === 'preview') setActiveProjection('termsText');
  }, [activeProjection, hasTermsDocument]);
  return (
    <section className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
      <SpecialTermPdfPreviewDialog request={pdfRequest} onClose={() => setPdfRequest(null)} />
      {(detail?.consolidationPrompts || []).map((prompt) => <div key={prompt.id} className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-sm font-semibold">Relink required: {prompt.sourceShortName} → {prompt.replacementShortName} v{prompt.replacementRevisionNumber}</p><p className="mt-1 text-xs">{prompt.occurrences.map((row) => `${row.projectionValue} #${row.sequence}`).join(', ')}. Live wording remains unchanged until this whole-term revision is approved.</p></div></div>{canDraft && prompt.status === 'Relinking' ? <Button type="button" size="sm" onClick={() => setRelink({ prompt, reason: '' })} disabled={busy || dirty}><Merge className="mr-1.5 h-3.5 w-3.5" />Relink now</Button> : null}</div>)}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><strong className="text-sm">Complete Special Term update</strong><Badge variant={status === 'Approved' || status === 'Active' ? 'default' : 'outline'}>{status}</Badge>{revision.number ? <Badge variant="secondary">Revision {revision.number}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">Save work as a draft, or complete all sections and matching rules with one approval.</p></div>
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
          ...(hasTermsDocument ? [['preview', 'Preview']] : []),
        ].map(([key, label]) => <Button key={key} type="button" size="sm" variant={activeProjection === key ? 'default' : 'ghost'} onClick={() => setActiveProjection(key)} role="tab" aria-selected={activeProjection === key}>{label}</Button>)}
      </div>
      {clauses}
      {SPECIAL_TERM_REVISION_PROJECTIONS.includes(activeProjection) && legacyPreviews?.[activeProjection]?.manualReviewRequired ? <MigrationReviewPanel detail={detail} projection={activeProjection} categoryOptions={categoryOptions} canApprove={canDraft} draftOnly onReviewPrepared={applyBoundaryReview} onReviewOpenChange={setBoundaryReviewOpen} onChanged={onChanged} onError={onError} /> : null}
      {activeProjection === 'rules' ? <RevisionRuleEditor rules={revision.rules || []} editable={editable} audienceOptions={audienceOptions} countryOptions={countryOptions} issues={ruleIssues} onChange={updateRules} /> : null}
      {activeProjection === 'preview' ? preview : null}
      {canDraft ? <div className="sticky bottom-3 z-10 space-y-3 rounded-lg border border-primary/30 bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span role="status" className={dirty ? 'font-medium text-amber-700' : 'text-muted-foreground'}>{busy ? 'Saving…' : dirty ? 'Unsaved changes' : revision.id ? status === 'In Review' ? 'Saved · awaiting approval' : 'All changes saved' : 'Live version · no unsaved changes'}</span>
          <span className="text-muted-foreground">{SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => `${revision.projections[key]?.assignments?.length || 0} ${key === 'termsText' ? 'terms' : key === 'confirmationRemark' ? 'confirmation' : 'nomination'}`).join(' · ')} · {(revision.rules || []).length} rules</span>
        </div>
        <div className="space-y-1.5"><div className="flex items-center justify-between gap-2"><Label htmlFor="special-term-change-reason">Change reason <span className="text-destructive">*</span> <span className="font-normal text-muted-foreground">for {canApprove ? 'approval' : 'submission'}; optional for a draft</span></Label><Button type="button" size="sm" variant={reasonNotApplicable ? 'default' : 'outline'} aria-pressed={reasonNotApplicable} disabled={busy || externalBusy} onClick={() => { setReasonNotApplicable((current) => !current); setReasonError(false); }}>N/A</Button></div>
          <Textarea id="special-term-change-reason" value={reasonNotApplicable ? 'N/A' : revisionReason} disabled={reasonNotApplicable} readOnly={busy || externalBusy} aria-invalid={reasonError && effectiveReason.trim().length < 3} aria-describedby="special-term-reason-help" maxLength={1000} onChange={(event) => setRevisionReason(event.target.value)} placeholder="Describe the change, or select N/A" rows={2} />
          <p id="special-term-reason-help" className={`text-xs ${reasonError && effectiveReason.trim().length < 3 ? 'text-destructive' : 'text-muted-foreground'}`}>Enter at least 3 characters or select N/A before {canApprove ? 'publishing' : 'submitting'}.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {ruleIssues.length ? <Button type="button" variant="link" className="h-auto p-0 text-destructive" onClick={() => setActiveProjection('rules')}>Review {ruleIssues.length} matching-rule {ruleIssues.length === 1 ? 'issue' : 'issues'}</Button> : <p className="text-xs text-muted-foreground">{canApprove ? 'Publishes the complete term in one action.' : 'One review covers the complete term.'}</p>}
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => commit('save_draft')} disabled={busy || externalBusy || boundaryReviewOpen || legacyPreparing || Boolean(pdfRequest) || (!dirty && Boolean(revision.id))}><Save className="mr-2 h-4 w-4" />Save Draft</Button><Button type="button" onClick={() => commit(canApprove ? 'approve_publish' : 'submit')} disabled={busy || externalBusy || boundaryReviewOpen || legacyPreparing || Boolean(pdfRequest) || (!canApprove && status === 'In Review' && !dirty)}>{busy ? 'Working…' : canApprove ? <><CheckCircle2 className="mr-2 h-4 w-4" />Approve &amp; publish</> : <><ShieldCheck className="mr-2 h-4 w-4" />Submit for approval</>}</Button></div>
        </div>
      </div> : null}
      <details className="rounded-md border border-border bg-background p-3"><summary className="cursor-pointer text-xs font-semibold">Advanced history and provenance</summary>{revision.provenance ? <div className="mt-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Source:</span> {revision.provenance.sourceLabel || 'Salesforce wording'}{revision.provenance.migratedAt ? ` · prepared ${revision.provenance.migratedAt}` : ''}{revision.provenance.mappingDecision ? ` · ${revision.provenance.mappingDecision}` : ''}</div> : null}{detail?.revisionHistory?.length ? <ol className="mt-3 space-y-2 border-l border-border pl-4 text-xs text-muted-foreground">{detail.revisionHistory.map((event) => <li key={event.id}><strong className="text-foreground">Revision {event.revisionNumber} · {event.status}</strong>{event.proposedByEmail ? ` · proposed by ${event.proposedByEmail}` : ''}{event.approvedByEmail ? ` · approved by ${event.approvedByEmail}` : ''}{event.approvedAt ? ` · ${event.approvedAt}` : ''}{event.revisionReason ? <span className="block">{event.revisionReason}</span> : null}</li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">No prior revision history.</p>}{canApprove && revision.sourceRevisionId ? <Button type="button" className="mt-3" size="sm" variant="outline" onClick={() => setConfirm({ type: 'rollback', reason: '' })} disabled={busy || dirty}><RotateCcw className="mr-2 h-4 w-4" />Rollback active revision</Button> : null}</details>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Rollback this whole term?</DialogTitle><DialogDescription>This atomically restores the preserved legacy projections and prior rule state.</DialogDescription></DialogHeader>{confirm ? <div className="space-y-1.5"><Label>Mandatory reason</Label><Textarea value={confirm.reason} maxLength={1000} onChange={(event) => setConfirm((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button type="button" variant="destructive" disabled={busy || confirm?.reason.trim().length < 3} onClick={() => invoke('specialTermRevisionRollback', { revisionId: revision.sourceRevisionId || revision.id, expectedLastModifiedAt: revision.sourceRevisionLastModifiedAt || revision.expectedLastModifiedAt || revision.lastModifiedAt, auditReason: confirm.reason }, 'Whole-term revision rolled back to preserved legacy wording.')}>{busy ? 'Working…' : 'Rollback'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(relink)} onOpenChange={(open) => !open && !busy && setRelink(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Relink {relink?.prompt?.sourceShortName}</DialogTitle><DialogDescription>This replaces only matching clause references in the saved whole-term draft, or prepares a complete revision from the live term when no draft exists.</DialogDescription></DialogHeader>{relink ? <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2"><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current source wording</p><p className="mt-2 whitespace-pre-wrap text-sm">{relink.prompt.occurrences[0]?.sourceText}</p></section><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reviewed replacement wording</p><p className="mt-2 whitespace-pre-wrap text-sm">{relink.prompt.replacementText}</p></section></div><div className="space-y-1.5"><Label>Relink reason</Label><Textarea value={relink.reason} maxLength={1000} rows={3} onChange={(event) => setRelink((current) => ({ ...current, reason: event.target.value }))} /></div></div> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setRelink(null)} disabled={busy}>Cancel</Button><Button type="button" disabled={busy || relink?.reason.trim().length < 3} onClick={() => invoke('specialTermClauseConsolidationRelink', { consolidationId: relink.prompt.id, expectedLastModifiedAt: relink.prompt.lastModifiedAt, reason: relink.reason, terms: [{ termId: detail.term.id, expectedLastModifiedAt: detail.term.lastModifiedAt, expectedRevisionLastModifiedAt: detail.revision?.lastModifiedAt || null }] }, 'Clause relink draft prepared for whole-term approval.')}>{busy ? 'Preparing…' : 'Prepare relink draft'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </section>
  );
}
