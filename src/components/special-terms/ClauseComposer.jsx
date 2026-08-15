import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import ClauseInlineEditDialog from '@/components/special-terms/ClauseInlineEditDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const EMPTY_ROWS = Object.freeze([]);

function AddClauseButton({ onClick, disabled, compact = false }) {
  return (
    <div className={compact ? 'flex justify-center py-1' : 'pt-2'}>
      <Button type="button" variant="outline" size={compact ? 'icon' : 'default'} className={compact ? 'h-8 w-8 rounded-full' : 'w-full border-dashed'} onClick={onClick} disabled={disabled} aria-label="Add clause">
        <Plus className={compact ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />
        {compact ? null : 'Add clause'}
      </Button>
    </div>
  );
}

function ClauseComposer({
  assignments = EMPTY_ROWS,
  onChange,
  disabled = false,
  style = 'Numbered',
  canEditClause = false,
  canPublishClause = false,
  localPublicationBlocked = false,
  categoryOptions = EMPTY_ROWS,
  currentTermId = null,
  projectionLabel = 'Clause',
  onClausePublished,
  onStatusMessage,
}) {
  const [picker, setPicker] = useState(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [upgradeTarget, setUpgradeTarget] = useState(null);
  const [selectedUpgradeIds, setSelectedUpgradeIds] = useState([]);
  const [editingRow, setEditingRow] = useState(null);
  const [editPendingKey, setEditPendingKey] = useState(null);
  const editButtons = useRef(new Map());
  const editViewport = useRef(null);
  const usedClauseIds = useMemo(() => new Set(assignments.map((row) => row.clauseId)), [assignments]);
  const availableUpgradeIds = useMemo(() => new Set(assignments.filter((row) => row.upgradeAvailable).map((row) => row.clauseId)), [assignments]);

  useEffect(() => {
    setSelectedUpgradeIds((current) => current.filter((clauseId) => availableUpgradeIds.has(clauseId)));
  }, [availableUpgradeIds]);

  useEffect(() => {
    if (!picker) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setPickerError('');
      const response = await appClient.functions.invoke('specialTermClauseBank', { query: query.trim(), status: 'Active', limit: 100 }, { cache: false });
      if (cancelled) return;
      if (response.data?.error) {
        setPickerError(response.data.error);
        setOptions([]);
      } else {
        setOptions((response.data?.clauses || []).filter((clause) => clause.latestApprovedVersion && !usedClauseIds.has(clause.id)));
      }
      setLoading(false);
    }, query.trim() ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [picker, query, usedClauseIds]);

  const insert = (clause) => {
    const row = {
      id: null,
      clauseId: clause.id,
      shortName: clause.shortName,
      category: clause.category,
      clauseStatus: clause.status,
      clauseVersionId: clause.latestApprovedVersion.id,
      revisionNumber: clause.latestApprovedVersion.revisionNumber,
      clauseText: clause.latestApprovedVersion.clauseText,
      versionStatus: 'Approved',
      state: 'Active',
      upgradeAvailable: false,
      latestApprovedVersion: clause.latestApprovedVersion,
      consolidation: clause.consolidation || null,
    };
    const next = [...assignments];
    next.splice(picker.index, 0, row);
    onChange(next);
    setPicker(null);
    setQuery('');
  };

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= assignments.length) return;
    const next = [...assignments];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index) => onChange(assignments.filter((_, rowIndex) => rowIndex !== index));

  const openInlineEditor = (row) => {
    editViewport.current = { top: window.scrollY, left: window.scrollX, key: `${row.clauseId}:${row.clauseVersionId}` };
    setEditingRow(row);
  };

  const closeInlineEditor = () => {
    const viewport = editViewport.current;
    setEditingRow(null);
    window.requestAnimationFrame(() => {
      if (viewport) window.scrollTo({ top: viewport.top, left: viewport.left, behavior: 'auto' });
      editButtons.current.get(viewport?.key)?.focus({ preventScroll: true });
    });
  };

  const clauseDraftSaved = () => {
    onStatusMessage?.('A proposed clause Draft was saved in the Clause Bank. Live Special Terms remain unchanged.');
    closeInlineEditor();
  };

  const clausePublished = (result) => {
    onClausePublished?.(result);
    onStatusMessage?.(`Clause v${result.revisionNumber} was approved and published to ${result.termCount} live Special Term${Number(result.termCount) === 1 ? '' : 's'}.`);
    closeInlineEditor();
  };

  const applyUpgrade = () => {
    if (!upgradeTarget?.latestApprovedVersion) return;
    onChange(assignments.map((row) => row.clauseId === upgradeTarget.clauseId ? {
      ...row,
      clauseVersionId: upgradeTarget.latestApprovedVersion.id,
      revisionNumber: upgradeTarget.latestApprovedVersion.revisionNumber,
      clauseText: upgradeTarget.latestApprovedVersion.clauseText,
      versionStatus: 'Approved',
      upgradeAvailable: false,
    } : row));
    setUpgradeTarget(null);
  };

  const applySelectedUpgrades = () => {
    const selected = new Set(selectedUpgradeIds);
    onChange(assignments.map((row) => selected.has(row.clauseId) && row.latestApprovedVersion ? {
      ...row,
      clauseVersionId: row.latestApprovedVersion.id,
      revisionNumber: row.latestApprovedVersion.revisionNumber,
      clauseText: row.latestApprovedVersion.clauseText,
      versionStatus: 'Approved',
      upgradeAvailable: false,
    } : row));
    setSelectedUpgradeIds([]);
  };

  return (
    <div className="space-y-1">
      {availableUpgradeIds.size ? <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-amber-950">Select only the approved revisions you want to apply; unselected rows remain unchanged.</p><Button type="button" size="sm" onClick={applySelectedUpgrades} disabled={disabled || !selectedUpgradeIds.length}>Upgrade selected ({selectedUpgradeIds.length})</Button></div> : null}
      {assignments.map((row, index) => (
        <div key={`${row.clauseId}:${row.clauseVersionId}:${index}`}>
          <AddClauseButton compact onClick={() => setPicker({ index })} disabled={disabled} />
          <section className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[2.5rem_1fr_auto]">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-label={`Clause ${index + 1}`}>{style === 'Hyphen' ? '–' : index + 1}</div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{row.shortName}</strong>
                <Badge variant="outline">{row.category || 'Other'}</Badge>
                <Badge variant="secondary">v{row.revisionNumber}</Badge>
                {row.clauseStatus === 'Retired' ? <Badge variant="destructive">Retired</Badge> : null}
                {row.consolidation ? <Badge className="border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-100">Relink required</Badge> : null}
                {row.upgradeAvailable ? <><Button type="button" variant="outline" size="sm" className="h-7 border-amber-300 bg-amber-50 text-amber-900" onClick={() => setUpgradeTarget(row)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Upgrade v{row.revisionNumber} → v{row.latestApprovedVersion?.revisionNumber}</Button><label className="inline-flex items-center gap-1.5 text-xs text-amber-950"><Checkbox checked={selectedUpgradeIds.includes(row.clauseId)} onCheckedChange={(checked) => setSelectedUpgradeIds((current) => checked === true ? [...new Set([...current, row.clauseId])] : current.filter((clauseId) => clauseId !== row.clauseId))} disabled={disabled} />Select</label></> : null}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{row.clauseText}</p>
              {row.consolidation ? <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />This clause is being consolidated into {row.consolidation.replacementShortName}. You may still use it, but the saved whole-term draft will join the relink queue.</p> : null}
            </div>
            <div className="flex items-start justify-end gap-1 sm:flex-col">
              {canEditClause ? <Button ref={(node) => { const key = `${row.clauseId}:${row.clauseVersionId}`; if (node) editButtons.current.set(key, node); else editButtons.current.delete(key); }} type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => openInlineEditor(row)} disabled={editPendingKey === `${row.clauseId}:${row.clauseVersionId}`} title="Edit shared Clause Bank wording" aria-label={`Edit ${row.shortName}`}>{editPendingKey === `${row.clauseId}:${row.clauseVersionId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}</Button> : null}
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(index, -1)} disabled={disabled || index === 0} title="Move clause up"><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(index, 1)} disabled={disabled || index === assignments.length - 1} title="Move clause down"><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(index)} disabled={disabled} title="Remove clause from this Special Term"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </section>
        </div>
      ))}
      <AddClauseButton onClick={() => setPicker({ index: assignments.length })} disabled={disabled} />

      <Dialog open={Boolean(picker)} onOpenChange={(open) => { if (!open) { setPicker(null); setQuery(''); } }}>
        <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Add an approved clause</DialogTitle><DialogDescription>Search by short name, category, or wording. Only the latest approved version can be added.</DialogDescription></DialogHeader>
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the clause bank" className="pl-9" autoFocus /></div>
          {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading approved clauses…</div> : null}
          {pickerError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{pickerError}</p> : null}
          {!loading ? <div className="space-y-2">{options.map((clause) => (
            <button key={clause.id} type="button" onClick={() => insert(clause)} className="block w-full rounded-lg border border-border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40">
              <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{clause.shortName}</strong><Badge variant="outline">{clause.category}</Badge><Badge variant="secondary">v{clause.latestApprovedVersion.revisionNumber}</Badge><span className="text-xs text-muted-foreground">Used in {clause.usageCount} assignment(s)</span></div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{clause.latestApprovedVersion.clauseText}</p>
              {clause.consolidation ? <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-950"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Relinking to {clause.consolidation.replacementShortName}. New use is allowed but will require a governed relink.</p> : null}
            </button>
          ))}{!options.length && !pickerError ? <p className="py-10 text-center text-sm text-muted-foreground">No unused approved clauses match this search. Create a Draft in the Clause Bank when new wording is needed.</p> : null}</div> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(upgradeTarget)} onOpenChange={(open) => !open && setUpgradeTarget(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Upgrade {upgradeTarget?.shortName}</DialogTitle><DialogDescription>The existing Special Term stays unchanged until you apply this revision and save the composition.</DialogDescription></DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-border p-3"><Badge variant="secondary">Current v{upgradeTarget?.revisionNumber}</Badge><p className="mt-3 whitespace-pre-wrap text-sm">{upgradeTarget?.clauseText}</p></section>
            <section className="rounded-lg border border-amber-300 bg-amber-50/50 p-3"><Badge className="bg-amber-600">Approved v{upgradeTarget?.latestApprovedVersion?.revisionNumber}</Badge><p className="mt-3 whitespace-pre-wrap text-sm">{upgradeTarget?.latestApprovedVersion?.clauseText}</p></section>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUpgradeTarget(null)}>Keep current version</Button><Button onClick={applyUpgrade}>Use approved revision</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ClauseInlineEditDialog
        row={editingRow}
        open={Boolean(editingRow)}
        canPublishGlobally={canPublishClause}
        localPublicationBlocked={localPublicationBlocked}
        categoryOptions={categoryOptions}
        currentTermId={currentTermId}
        projectionLabel={projectionLabel}
        onClose={closeInlineEditor}
        onPendingChange={(key, pending) => setEditPendingKey(pending ? key : null)}
        onDraftSaved={clauseDraftSaved}
        onPublished={clausePublished}
      />
    </div>
  );
}

export default memo(ClauseComposer);
