import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileClock, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
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
import { richTextToCopyText } from '@/lib/specialTermsText';

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ruleLookup(id, label, secondary = '') {
  return id ? { id, label: label || id, secondary } : null;
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
          <SpecialTermLookupField disabled={!editable} label="Account" kind="account" value={ruleLookup(rule.accountId, rule.accountName, rule.accountClKey)} onChange={(account) => update(index, { accountId: account?.id || null, accountName: account?.label || '', accountClKey: account?.secondary || '' })} placeholder="Search Account name or CL Key" />
          <SpecialTermLookupField disabled={!editable} label="Port" kind="port" value={ruleLookup(rule.portId, rule.portName, rule.portCountry)} onChange={(port) => update(index, { portId: port?.id || null, portName: port?.label || '', portCountry: port?.secondary || '' })} placeholder="Search port name" />
          <SpecialTermLookupField disabled={!editable} label="Product" kind="product" value={ruleLookup(rule.productId, rule.productName)} onChange={(product) => update(index, { productId: product?.id || null, productName: product?.label || '' })} placeholder="Search active product" />
          <div className="flex items-end justify-between gap-2"><p className="pb-2 text-xs text-muted-foreground">{rule.priority == null ? 'Priority is recalculated by Salesforce on activation.' : `Current priority: ${rule.priority}`}</p>{editable ? <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)} title="Remove rule from revision"><Trash2 className="h-4 w-4" /></Button> : null}</div>
        </div>
      ))}
    </div>
  );
}

export default function WholeTermRevisionPanel({ detail, canDraft, canApprove, categoryOptions, audienceOptions = [], countryOptions = [], onChanged, onError }) {
  const initialRevision = useMemo(() => revisionFromDetail(detail), [detail]);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [mobilePane, setMobilePane] = useState('clauses');
  const [exportingDocument, setExportingDocument] = useState(false);
  const [savedDraftPreviewKey, setSavedDraftPreviewKey] = useState(null);

  useEffect(() => {
    setRevision(initialRevision);
    setSavedDraftPreviewKey(initialRevision?.id
      ? documentPreviewKey(specialTermDocumentModel({ term: detail?.term, detail, revision: initialRevision, mode: 'draft' }))
      : null);
  }, [detail, initialRevision]);

  const legacy = !revision || revision.status === 'Legacy';
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

  const startRevisionDraft = () => {
    const projections = Object.fromEntries(SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => {
      const source = revision?.projections?.[key] || detail?.projections?.[key] || {};
      const sourceRows = source.rows?.length ? source.rows : source.activeAssignments || source.assignments || [];
      return [key, {
        ...source,
        status: 'Active',
        assignments: source.proposedAssignments?.length ? source.proposedAssignments : sourceRows,
        draftAssignments: source.proposedAssignments?.length ? source.proposedAssignments : sourceRows,
        activeAssignments: source.proposedAssignments?.length ? source.proposedAssignments : sourceRows,
      }];
    }));
    setRevision({
      id: null,
      status: 'Draft',
      termLastModifiedAt: detail?.term?.lastModifiedAt || null,
      projections,
      rules: detail?.rules || revision?.rules || [],
      provenance: { sourceLabel: 'Preserved live Salesforce legacy projections' },
    });
    setSavedDraftPreviewKey(null);
  };

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
    await onChanged?.(success);
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

  if (legacy) {
    return (
      <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><FileClock className="h-4 w-4 text-amber-700" /><strong className="text-sm">Legacy term — whole-term review required</strong><Badge variant="outline">Legacy</Badge></div><p className="mt-1 text-xs text-muted-foreground">All three live projections remain unchanged until one proposed revision, including its rules, is reviewed and approved as a whole.</p></div>
          {canDraft ? <Button type="button" onClick={startRevisionDraft}><FileClock className="mr-2 h-4 w-4" />Start whole-term draft</Button> : null}
        </div>
        <div className="grid gap-2 md:grid-cols-3">{SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => { const source = detail?.projections?.[key] || {}; return <div key={key} className="rounded-md border border-border bg-background p-3"><p className="text-xs font-semibold">{source.label || key}</p><pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{richTextToCopyText(source.text) || 'No live wording'}</pre></div>; })}</div>
        {canDraft ? <div className="space-y-3">{SPECIAL_TERM_REVISION_PROJECTIONS.map((projection) => <MigrationReviewPanel key={projection} detail={detail} projection={projection} categoryOptions={categoryOptions} canApprove={canDraft} draftOnly onChanged={onChanged} onError={onError} />)}</div> : null}
        {!canDraft ? <Alert><AlertDescription>You may view the preserved legacy wording and clause lineage. Any active FCOS user may propose a revision.</AlertDescription></Alert> : null}
      </section>
    );
  }

  const editable = canDraft && ['Draft', 'In Review', 'Changes Requested'].includes(status);
  const previewModel = specialTermDocumentModel({ term: detail.term, detail, revision, mode: 'draft' });
  const unsaved = !revision?.id || !savedDraftPreviewKey || savedDraftPreviewKey !== documentPreviewKey(previewModel);
  const clauses = <div className="space-y-4">{SPECIAL_TERM_REVISION_PROJECTIONS.map((projection) => <ClauseProjectionSection key={projection} detail={{ ...detail, projections: revision.projections }} projection={projection} canManage={editable} canApprove={false} categoryOptions={categoryOptions} onAssignmentsChange={updateAssignments} onChanged={onChanged} onError={onError} wholeTermRevision />)}<RevisionRuleEditor rules={revision.rules || []} editable={editable} audienceOptions={audienceOptions} countryOptions={countryOptions} onChange={updateRules} />{editable ? <div className="space-y-1.5"><Label>Revision reason</Label><Textarea value={revisionReason} maxLength={1000} onChange={(event) => setRevisionReason(event.target.value)} placeholder="Why this whole-term wording and rule revision is proposed" rows={3} /></div> : null}</div>;
  const preview = <SpecialTermDocumentPreview term={detail.term} detail={detail} revision={revision} unsaved={unsaved} onExport={exportDocument} />;
  return (
    <section className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><strong className="text-sm">Whole-term revision</strong><Badge variant={status === 'Approved' || status === 'Active' ? 'default' : 'outline'}>{status}</Badge>{revision.number ? <Badge variant="secondary">Revision {revision.number}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">Terms Text, both special remarks, and matching rules are saved, approved, activated, and rolled back together.</p></div>
        <div className="flex flex-wrap gap-2">
          {editable ? <Button type="button" variant="outline" onClick={() => invoke('specialTermRevisionSave', { ...revisionPayload(revision), revisionReason }, 'Whole-term revision draft saved.')} disabled={busy || exportingDocument || revisionReason.trim().length < 3}><Save className="mr-2 h-4 w-4" />Save draft</Button> : null}
          {canDraft && ['Approved', 'Active'].includes(status) ? <Button type="button" variant="outline" onClick={startRevisionDraft} disabled={busy}><FileClock className="mr-2 h-4 w-4" />Start new revision</Button> : null}
          {canApprove && revision.id && ['In Review', 'Ready for Approval'].includes(status) ? <Button type="button" onClick={() => setConfirm({ type: 'approve', reason: '' })} disabled={busy}><CheckCircle2 className="mr-2 h-4 w-4" />Approve and activate</Button> : null}
          {canApprove && ['Approved', 'Active'].includes(status) ? <Button type="button" variant="outline" onClick={() => setConfirm({ type: 'rollback', reason: '' })} disabled={busy}><RotateCcw className="mr-2 h-4 w-4" />Rollback whole term</Button> : null}
        </div>
      </div>
      {revision.provenance ? <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Legacy provenance:</span> {revision.provenance.sourceLabel || 'Salesforce legacy wording'}{revision.provenance.migratedAt ? ` · prepared ${revision.provenance.migratedAt}` : ''}{revision.provenance.mappingDecision ? ` · ${revision.provenance.mappingDecision}` : ''}</div> : null}
      <div className="flex gap-1 lg:hidden"><Button type="button" size="sm" variant={mobilePane === 'clauses' ? 'default' : 'outline'} onClick={() => setMobilePane('clauses')}>Clauses</Button><Button type="button" size="sm" variant={mobilePane === 'preview' ? 'default' : 'outline'} onClick={() => setMobilePane('preview')}>Preview</Button></div>
      <div className="lg:grid lg:grid-cols-[55fr_45fr] lg:gap-4"><div className={mobilePane === 'clauses' ? 'block' : 'hidden lg:block'}>{clauses}</div><div className={mobilePane === 'preview' ? 'block' : 'hidden lg:block'}>{preview}</div></div>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{confirm?.type === 'approve' ? 'Approve and activate this whole term?' : 'Rollback this whole term?'}</DialogTitle><DialogDescription>{confirm?.type === 'approve' ? 'This atomically activates all three projections and the reviewed rules. No partial activation is permitted.' : 'This atomically restores the preserved legacy projections and prior rule state.'}</DialogDescription></DialogHeader>{confirm ? <div className="space-y-1.5"><Label>Mandatory reason</Label><Textarea value={confirm.reason} maxLength={1000} onChange={(event) => setConfirm((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button type="button" variant={confirm?.type === 'rollback' ? 'destructive' : 'default'} disabled={busy || confirm?.reason.trim().length < 3} onClick={() => invoke(confirm.type === 'approve' ? 'specialTermRevisionApprove' : 'specialTermRevisionRollback', { revisionId: revision.id, expectedLastModifiedAt: revision.expectedLastModifiedAt || revision.lastModifiedAt, auditReason: confirm.reason }, confirm.type === 'approve' ? 'Whole-term revision approved and activated.' : 'Whole-term revision rolled back to preserved legacy wording.')}>{busy ? 'Working…' : confirm?.type === 'approve' ? 'Approve and activate' : 'Rollback'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </section>
  );
}
