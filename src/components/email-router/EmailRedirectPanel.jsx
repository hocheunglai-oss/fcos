import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Forward, Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import EmailPresetPicker from './EmailPresetPicker';
import EmailRecipientPicker, { directorySelection, normaliseDirectoryEntries, presetRecipientSelections, selectionKey, splitRecipientSelections, valueList } from './EmailRecipientPicker';

const PRESELECT_CONFIDENCE = 0.6;

export function advisorRecipientSelections(advisor, directory) {
  if (advisor?.preselectRecipients !== true || Number(advisor?.recipientConfidence) <= PRESELECT_CONFIDENCE) return [];
  const destinations = normaliseDirectoryEntries(directory);
  const byKey = new Map(destinations.map((item) => [`${item.kind}:${item.id}`, item]));
  const seen = new Set();
  const result = [];
  for (const suggestion of advisor?.selections || []) {
    const recipientKind = String(suggestion.recipientKind || '').toLowerCase();
    if (!['to', 'cc', 'bcc'].includes(recipientKind)) continue;
    const candidateKind = suggestion.kind === 'group' ? 'group' : 'destination';
    const destination = byKey.get(`${candidateKind}:${suggestion.id}`);
    if (!destination) continue;
    const selection = directorySelection(destination, recipientKind);
    const key = selectionKey(selection);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(selection);
  }
  return result;
}

export function advisorTransparencySignals(advisor, message) {
  if (!advisor) return [];
  const sender = String(message?.from?.email || '').split('@').at(-1)?.toLowerCase() || null;
  return [
    sender ? `Sender domain: ${sender}` : null,
    advisor.routingCategory ? `Routing category: ${String(advisor.routingCategory).replaceAll('_', ' ')}` : null,
    `${Number(advisor.evidenceCount || 0)} previously confirmed matching routes`,
    advisor.historyWarning ? 'Historical outcomes contain a warning' : 'Historical outcomes passed consistency review',
  ].filter(Boolean);
}

function suggestionLabel(suggestion, index) {
  return `${String(suggestion.recipientKind || 'to').toUpperCase()} ${index + 1}: ${suggestion.label}`;
}

function folderLabel(value, folders) {
  if (value === 'keep_current') return 'Leave in current folder';
  if (value === 'archive') return 'Archive';
  return folders.find((folder) => folder.id === value)?.path || 'Approved folder';
}

export default function EmailRedirectPanel({
  message,
  batchMessages = [],
  directory,
  presets,
  folders = [],
  actionMode = 'redirect',
  onActionModeChange = () => {},
  directoryLoading = false,
  directoryError = '',
  submitting = false,
  advisor,
  advisorLoading = false,
  advisorError = '',
  actionResult = null,
  onAdvisor,
  onSubmit,
  panelRef,
  className = '',
}) {
  const [selections, setSelections] = useState([]);
  const [presetId, setPresetId] = useState('none');
  const [bccVisible, setBccVisible] = useState(false);
  const [recipientsTouched, setRecipientsTouched] = useState(false);
  const [actionTouched, setActionTouched] = useState(false);
  const [folderTouched, setFolderTouched] = useState(false);
  const [advisorApplied, setAdvisorApplied] = useState(false);
  const [postAction, setPostAction] = useState(actionMode === 'redirect' ? 'archive' : 'keep_current');
  const [body, setBody] = useState('');
  const presetOptions = useMemo(() => valueList(presets), [presets]);
  const approvedFolders = useMemo(() => (folders || []).filter((folder) => folder.active !== false && folder.approved !== false && !folder.system), [folders]);
  const batchSize = Math.max(1, batchMessages.length);
  const effectiveAdvisor = batchSize === 1 ? advisor : null;
  const recommendedSelections = useMemo(() => advisorRecipientSelections(effectiveAdvisor, directory), [effectiveAdvisor, directory]);
  const batchBlocked = batchSize > 10;
  const routeLocked = batchSize === 1 && actionResult?.messageId === message?.id && actionResult?.status !== 'failed'
    && ['redirect', 'forward'].includes(actionResult?.action);

  useEffect(() => {
    setSelections([]);
    setPresetId('none');
    setBccVisible(false);
    setRecipientsTouched(false);
    setActionTouched(false);
    setFolderTouched(false);
    setAdvisorApplied(false);
    setBody('');
    setPostAction('archive');
    onActionModeChange('redirect');
  }, [message?.id]);

  useEffect(() => {
    if (folderTouched || (effectiveAdvisor?.preselectFolder && Number(effectiveAdvisor.folderConfidence) > PRESELECT_CONFIDENCE)) return;
    setPostAction(actionMode === 'redirect' ? 'archive' : 'keep_current');
  }, [actionMode, effectiveAdvisor?.folderConfidence, effectiveAdvisor?.preselectFolder, folderTouched]);

  useEffect(() => {
    if (!effectiveAdvisor) return;
    let applied = false;
    if (effectiveAdvisor.preselectAction && Number(effectiveAdvisor.actionConfidence) > PRESELECT_CONFIDENCE && !actionTouched) {
      onActionModeChange(effectiveAdvisor.suggestedAction);
      applied = true;
    }
    if (effectiveAdvisor.preselectFolder && Number(effectiveAdvisor.folderConfidence) > PRESELECT_CONFIDENCE && !folderTouched) {
      setPostAction(effectiveAdvisor.suggestedFolder);
      applied = true;
    }
    if (recommendedSelections.length && !recipientsTouched && !selections.length && presetId === 'none') {
      setSelections(recommendedSelections);
      setBccVisible(recommendedSelections.some((selection) => selection.kind === 'bcc'));
      applied = true;
    }
    if (applied) setAdvisorApplied(true);
  }, [effectiveAdvisor, actionTouched, folderTouched, onActionModeChange, presetId, recipientsTouched, recommendedSelections, selections.length]);

  const selectedPreset = presetOptions.find((item) => String(item.id || item.value) === presetId);
  const selectedLeaveLabels = useMemo(() => {
    if (selectedPreset) return [];
    const entries = normaliseDirectoryEntries(directory);
    const byKey = new Map(entries.map((item) => [`${item.kind}:${item.id}`, item]));
    return [...new Set(selections.flatMap((selection) => {
      const item = byKey.get(selectionKey(selection));
      if (!item) return [];
      if (item.kind === 'group') return item.onLeaveLabels || [];
      return item.onLeave ? [item.label] : [];
    }))];
  }, [directory, selectedPreset, selections]);
  const canSend = Boolean(message) && !batchBlocked && !directoryLoading && !submitting && !routeLocked && selections.length > 0
    && (presetId === 'none' || Boolean(selectedPreset?.routeSnapshotToken));
  const selectPreset = (value) => {
    setPresetId(value);
    setRecipientsTouched(true);
    setAdvisorApplied(false);
    if (value === 'none') return;
    const preset = presetOptions.find((item) => String(item.id || item.value) === value);
    const next = presetRecipientSelections(preset);
    setSelections(next);
    setBccVisible(next.some((selection) => selection.kind === 'bcc'));
  };
  const chooseAction = (value) => {
    if (routeLocked) return;
    setActionTouched(true);
    setAdvisorApplied(false);
    onActionModeChange(value);
    if (!folderTouched) setPostAction(value === 'redirect' ? 'archive' : 'keep_current');
  };
  const applyAdvisor = () => {
    if (!effectiveAdvisor) return;
    if (effectiveAdvisor.preselectAction && Number(effectiveAdvisor.actionConfidence) > PRESELECT_CONFIDENCE) onActionModeChange(effectiveAdvisor.suggestedAction);
    if (effectiveAdvisor.preselectFolder && Number(effectiveAdvisor.folderConfidence) > PRESELECT_CONFIDENCE) setPostAction(effectiveAdvisor.suggestedFolder);
    if (recommendedSelections.length) {
      setPresetId('none');
      setSelections(recommendedSelections);
      setBccVisible(recommendedSelections.some((selection) => selection.kind === 'bcc'));
    }
    setRecipientsTouched(true);
    setActionTouched(true);
    setFolderTouched(true);
    setAdvisorApplied(true);
  };
  const submit = () => {
    if (!canSend) return;
    const recipients = presetId === 'none'
      ? splitRecipientSelections(selections)
      : { destinationSelections: [], manualRecipients: [] };
    onSubmit({
      action: actionMode,
      ...recipients,
      presetId: presetId === 'none' ? null : selectedPreset?.id || selectedPreset?.value || presetId,
      routeSnapshotToken: presetId === 'none' ? null : selectedPreset?.routeSnapshotToken || null,
      body: actionMode === 'forward' ? body.trim() : '',
      postActionMode: postAction === 'keep_current' ? 'keep_current' : 'move',
      postActionFolderKey: postAction === 'archive' ? 'archive' : null,
      postActionFolderId: !['keep_current', 'archive'].includes(postAction) ? postAction : null,
      advisorRecommendationId: effectiveAdvisor?.recommendationId || null,
    });
  };

  const transparencySignals = advisorTransparencySignals(effectiveAdvisor, message);
  return <aside ref={panelRef} tabIndex={-1} className={`flex min-h-0 flex-col border-l border-border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${className}`} aria-label="Route message">
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {!message ? <div className="flex min-h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground"><Send className="mb-3 h-6 w-6" /><p className="font-medium text-foreground">Select a message</p><p className="mt-1 max-w-64">Forward and Redirect controls remain here while you review the mailbox.</p></div> : <div className="space-y-3">
        <div className="space-y-0.5"><p className="text-[11px] font-medium text-muted-foreground">{batchSize > 1 ? `${batchSize} selected messages` : 'Selected message'}</p><p className="line-clamp-2 text-sm font-semibold">{message.subject || '(No subject)'}</p>{batchSize > 1 ? <div className="mt-2 max-h-24 space-y-1 overflow-auto border-l-2 border-primary/30 pl-2 text-[11px] text-muted-foreground">{batchMessages.map((item) => <div key={item.id} className="truncate">{item.subject || '(No subject)'}</div>)}</div> : null}{batchBlocked ? <p className="mt-2 text-xs font-semibold text-red-700">Batch routing is limited to 10 messages. Remove {batchSize - 10} selection{batchSize - 10 === 1 ? '' : 's'}.</p> : batchSize > 1 ? <p className="mt-2 text-[11px] text-amber-800">Each message is submitted with its own idempotency key and Microsoft 365 confirmation. Definite failures remain selected; uncertain outcomes are never resent automatically.</p> : null}</div>
        <div className="grid grid-cols-2 gap-1 border border-border bg-muted/30 p-1" aria-label="Routing action">
          <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[11px]" variant={actionMode === 'redirect' ? 'default' : 'ghost'} onClick={() => chooseAction('redirect')} disabled={routeLocked}><Send />Redirect</Button>
          <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[11px]" variant={actionMode === 'forward' ? 'default' : 'ghost'} onClick={() => chooseAction('forward')} disabled={routeLocked}><Forward />Forward</Button>
        </div>
        {directoryError && <div className="flex gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{directoryError}</p></div>}
        <div className="space-y-1.5">
          <Label className="text-xs">Routing preset</Label>
          <EmailPresetPicker presets={presetOptions} selectedId={presetId} onSelect={selectPreset} disabled={submitting} compact />
          {presetId !== 'none' && <div className="space-y-1 text-xs text-muted-foreground"><p><span className="font-semibold text-foreground">{selectedPreset?.label || 'Preset'} · {selectedPreset?.effectiveVersion?.label || 'Standard'}</span></p><p>{selectedPreset?.effectiveVersion?.reason || 'Standard routing'}. Changing a recipient turns the preset label off.</p></div>}
          {(selectedPreset?.warnings || []).map((warning) => <div key={warning} className="flex gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>{warning}</p></div>)}
        </div>
        {selectedLeaveLabels.length > 0 && <div className="flex gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>Currently on leave: {selectedLeaveLabels.join(', ')}. You may continue after reviewing the recipients.</p></div>}
        <div className="space-y-1.5">
          <Label className="text-xs">Recipients</Label>
          <EmailRecipientPicker
            directory={directory}
            selections={selections}
            onChange={(next) => { setPresetId('none'); setSelections(next); setRecipientsTouched(true); setAdvisorApplied(false); }}
            disabled={submitting}
            loading={directoryLoading}
            bccVisible={bccVisible}
            onBccVisibleChange={setBccVisible}
            compact
          />
        </div>
        {actionMode === 'forward' && <div className="space-y-1.5"><Label className="text-xs" htmlFor="email-router-forward-message">Forwarding message <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="email-router-forward-message" rows={3} className="text-xs" value={body} onChange={(event) => setBody(event.target.value.slice(0, 20_000))} placeholder="Add an introductory message" /></div>}
        <div className="space-y-1.5">
          <Label className="text-xs">After sending</Label>
          <Select value={postAction} onValueChange={(value) => { setPostAction(value); setFolderTouched(true); setAdvisorApplied(false); }} disabled={submitting || routeLocked}>
            <SelectTrigger className="h-8 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="keep_current">Leave in current folder</SelectItem>
              <SelectItem value="archive">Archive</SelectItem>
              {approvedFolders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.path}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="h-8 w-full gap-1 px-3 text-xs" size="sm" onClick={submit} disabled={!canSend}>{submitting ? <Loader2 className="animate-spin" /> : routeLocked ? <CheckCircle2 /> : actionMode === 'forward' ? <Forward /> : <Send />}{submitting ? `Preparing ${batchSize > 1 ? batchSize : ''}...` : routeLocked ? 'Routing queued' : actionMode === 'forward' ? `Send Forward${batchSize > 1 ? ` · ${batchSize}` : ''}` : `Send Redirect${batchSize > 1 ? ` · ${batchSize}` : ''}`}</Button>
        <section className="border-t border-border pt-3">
          <div className="flex items-start justify-between gap-2"><div><h3 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />Email Router Advisor</h3><p className="mt-0.5 text-xs text-muted-foreground">{batchSize > 1 ? 'Advisor suggestions are disabled for batch routing because each message requires its own evidence.' : 'A choice is preselected only after three matching confirmed outcomes and confidence above 60%.'}</p></div><Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]" onClick={onAdvisor} disabled={advisorLoading || batchSize > 1}>{advisorLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}{advisorLoading ? 'Reviewing' : effectiveAdvisor ? 'Review again' : 'Suggest'}</Button></div>
          {advisorError && <p className="mt-3 text-sm text-destructive">{advisorError}</p>}
          {effectiveAdvisor && <div className="mt-3 space-y-3 text-sm">
            <p className="text-muted-foreground"><span className="font-semibold text-foreground">{String(effectiveAdvisor.routingCategory || 'other').replaceAll('_', ' ')}</span> · {effectiveAdvisor.evidenceCount || 0} matching confirmed outcomes. {effectiveAdvisor.rationale || 'No rationale provided.'}</p>
            <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-950"><div className="font-semibold">Why this was suggested</div><ul className="mt-1 space-y-0.5">{transparencySignals.map((signal) => <li key={signal}>• {signal}</li>)}</ul></div>
            <div className="flex flex-wrap gap-1.5">
              <span className="border border-border bg-muted/40 px-2 py-1 text-xs">{effectiveAdvisor.suggestedAction === 'forward' ? 'Forward' : 'Redirect'} · {Math.round(Number(effectiveAdvisor.actionConfidence || 0) * 100)}%</span>
              <span className="border border-border bg-muted/40 px-2 py-1 text-xs">{folderLabel(effectiveAdvisor.suggestedFolder, approvedFolders)} · {Math.round(Number(effectiveAdvisor.folderConfidence || 0) * 100)}%</span>
              {(effectiveAdvisor.selections || []).map((suggestion, index) => <span key={`${suggestion.kind}:${suggestion.id}:${suggestion.recipientKind}`} className="border border-border bg-muted/40 px-2 py-1 text-xs">{suggestionLabel(suggestion, index)}</span>)}
            </div>
            {(effectiveAdvisor.preselectAction || effectiveAdvisor.preselectFolder || recommendedSelections.length > 0) && !advisorApplied && <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" onClick={applyAdvisor}>Apply confident suggestions</Button>}
            {advisorApplied && <p className="text-xs font-medium text-emerald-700">Confident suggestions are preselected. Review every field before sending.</p>}
            {!effectiveAdvisor.preselectAction && !effectiveAdvisor.preselectFolder && !effectiveAdvisor.preselectRecipients && <p className="text-xs text-amber-800">The evidence or confidence threshold was not met, so defaults remain unchanged.</p>}
            {effectiveAdvisor.historyWarning && <p className="text-xs text-amber-800">{effectiveAdvisor.historyWarning}</p>}
            {effectiveAdvisor.question && <p className="border-l-2 border-amber-400 pl-3 text-amber-900">{effectiveAdvisor.question}</p>}
          </div>}
        </section>
      </div>}
    </div>
  </aside>;
}
