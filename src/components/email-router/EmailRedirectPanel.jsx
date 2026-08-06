import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import EmailPresetPicker from './EmailPresetPicker';
import EmailRecipientPicker, { directorySelection, normaliseDirectoryEntries, presetRecipientSelections, selectionKey, splitRecipientSelections, valueList } from './EmailRecipientPicker';

const PRESELECT_CONFIDENCE = 0.6;

export function advisorRecipientSelections(advisor, directory) {
  if (Number(advisor?.confidence) <= PRESELECT_CONFIDENCE) return [];
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

function suggestionLabel(suggestion, index) {
  return `${String(suggestion.recipientKind || 'to').toUpperCase()} ${index + 1}: ${suggestion.label}`;
}

export default function EmailRedirectPanel({
  message,
  directory,
  presets,
  directoryLoading = false,
  directoryError = '',
  submitting = false,
  advisor,
  advisorLoading = false,
  advisorError = '',
  actionResult = null,
  onAdvisor,
  onSubmit,
  className = '',
}) {
  const [selections, setSelections] = useState([]);
  const [presetId, setPresetId] = useState('none');
  const [bccVisible, setBccVisible] = useState(false);
  const [recipientsTouched, setRecipientsTouched] = useState(false);
  const [advisorApplied, setAdvisorApplied] = useState(false);
  const presetOptions = useMemo(() => valueList(presets), [presets]);
  const recommendedSelections = useMemo(() => advisorRecipientSelections(advisor, directory), [advisor, directory]);
  const confidence = Math.round((Number(advisor?.confidence) || 0) * 100);
  const redirectLocked = actionResult?.action === 'redirect' && actionResult?.status !== 'failed';

  useEffect(() => {
    setSelections([]);
    setPresetId('none');
    setBccVisible(false);
    setRecipientsTouched(false);
    setAdvisorApplied(false);
  }, [message?.id]);

  useEffect(() => {
    if (!recommendedSelections.length || recipientsTouched || selections.length || presetId !== 'none') return;
    setSelections(recommendedSelections);
    setBccVisible(recommendedSelections.some((selection) => selection.kind === 'bcc'));
    setAdvisorApplied(true);
  }, [presetId, recipientsTouched, recommendedSelections, selections.length]);

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
  const canSend = Boolean(message) && !directoryLoading && !submitting && !redirectLocked && selections.length > 0
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
  const applyAdvisor = () => {
    if (!recommendedSelections.length) return;
    setPresetId('none');
    setSelections(recommendedSelections);
    setBccVisible(recommendedSelections.some((selection) => selection.kind === 'bcc'));
    setRecipientsTouched(true);
    setAdvisorApplied(true);
  };
  const submit = () => {
    if (!canSend) return;
    const recipients = presetId === 'none'
      ? splitRecipientSelections(selections)
      : { destinationSelections: [], manualRecipients: [] };
    onSubmit({
      action: 'redirect',
      ...recipients,
      presetId: presetId === 'none' ? null : selectedPreset?.id || selectedPreset?.value || presetId,
      routeSnapshotToken: presetId === 'none' ? null : selectedPreset?.routeSnapshotToken || null,
    });
  };

  return <aside className={`flex min-h-0 flex-col border-l border-border bg-background ${className}`} aria-label="Redirect message">
    <div className="border-b border-border px-4 py-4">
      <h2 className="text-sm font-semibold">Redirect message</h2>
      <p className="mt-1 text-xs text-muted-foreground">Choose the ordered recipients, then send with one explicit action.</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {!message ? <div className="flex min-h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground"><Send className="mb-3 h-6 w-6" /><p className="font-medium text-foreground">Select a message</p><p className="mt-1 max-w-64">The Redirect controls remain here while you review the mailbox.</p></div> : <div className="space-y-4">
        <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Selected message</p><p className="line-clamp-2 text-sm font-semibold">{message.subject || '(No subject)'}</p></div>
        {directoryError && <div className="flex gap-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{directoryError}</p></div>}
        <div className="space-y-2">
          <Label>Routing preset</Label>
          <EmailPresetPicker presets={presetOptions} selectedId={presetId} onSelect={selectPreset} disabled={submitting} />
          {presetId !== 'none' && <div className="space-y-1 text-xs text-muted-foreground"><p><span className="font-semibold text-foreground">{selectedPreset?.label || 'Preset'} · {selectedPreset?.effectiveVersion?.label || 'Standard'}</span></p><p>{selectedPreset?.effectiveVersion?.reason || 'Standard routing'}. Changing any recipient turns the preset label off and keeps your amended selection.</p></div>}
          {(selectedPreset?.warnings || []).map((warning) => <div key={warning} className="flex gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>{warning}</p></div>)}
        </div>
        {selectedLeaveLabels.length > 0 && <div className="flex gap-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>Currently on leave: {selectedLeaveLabels.join(', ')}. You may continue after reviewing the recipients.</p></div>}
        <div className="space-y-2">
          <Label>Recipients</Label>
          <EmailRecipientPicker
            directory={directory}
            selections={selections}
            onChange={(next) => { setPresetId('none'); setSelections(next); setRecipientsTouched(true); setAdvisorApplied(false); }}
            disabled={submitting}
            loading={directoryLoading}
            bccVisible={bccVisible}
            onBccVisibleChange={setBccVisible}
          />
        </div>
        <Button className="w-full" size="lg" onClick={submit} disabled={!canSend}>{submitting ? <Loader2 className="animate-spin" /> : redirectLocked ? <CheckCircle2 /> : <Send />}{submitting ? 'Preparing...' : redirectLocked ? 'Redirect queued' : 'Send Redirect'}</Button>
        <section className="border-t border-border pt-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />Email Router Advisor</h3><p className="mt-1 text-xs text-muted-foreground">Suggestions above 60% confidence are preselected for review. The advisor never sends email.</p></div><Button variant="outline" size="sm" onClick={onAdvisor} disabled={advisorLoading}>{advisorLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}{advisorLoading ? 'Reviewing' : advisor ? 'Review again' : 'Suggest'}</Button></div>
          {advisorError && <p className="mt-3 text-sm text-destructive">{advisorError}</p>}
          {advisor && <div className="mt-3 space-y-3 text-sm">
            <p className="text-muted-foreground"><span className="font-semibold text-foreground">{confidence}% confidence.</span> {advisor.rationale || 'No rationale provided.'}</p>
            {advisor.selections?.length > 0 && <div className="flex flex-wrap gap-1.5">{advisor.selections.map((suggestion, index) => <span key={`${suggestion.kind}:${suggestion.id}:${suggestion.recipientKind}`} className="border border-border bg-muted/40 px-2 py-1 text-xs">{suggestionLabel(suggestion, index)}</span>)}</div>}
            {recommendedSelections.length > 0 && !advisorApplied && <Button variant="secondary" size="sm" onClick={applyAdvisor}>Apply suggestions</Button>}
            {advisorApplied && <p className="text-xs font-medium text-emerald-700">Suggested recipients are preselected. Review their order before sending.</p>}
            {confidence <= 60 && <p className="text-xs text-amber-800">Confidence is not above 60%, so no recipients were preselected.</p>}
            {advisor.question && <p className="border-l-2 border-amber-400 pl-3 text-amber-900">{advisor.question}</p>}
          </div>}
        </section>
      </div>}
    </div>
  </aside>;
}
