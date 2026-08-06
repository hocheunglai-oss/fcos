import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { actionLabel, formatAddresses } from '@/lib/emailRouter';
import EmailPresetPicker from './EmailPresetPicker';
import EmailRecipientPicker, { RECIPIENT_KINDS, directorySelection, normaliseDirectoryEntries, presetRecipientSelections, selectionKey, splitRecipientSelections, valueList } from './EmailRecipientPicker';

const ACTION_COPY = {
  reply: { title: 'Reply', description: 'Reply to the original sender from the connected Email Router mailbox.' },
  forward: { title: 'Forward message', description: 'Forward a copy of this message to ordered people or groups from the routing directory.' },
  delete: { title: 'Delete message', description: 'Request deletion of this message. This may not be reversible.' },
  undo: { title: 'Undo mail action', description: 'Request a reversal of the selected action.' },
  retry: { title: 'Review uncertain send', description: 'Retry only after checking Sent Items and confirming the earlier submission was not sent.' },
};

export default function EmailActionDialog({ open, onOpenChange, action, message, directory, presets, directoryLoading = false, submitting, initialDestinationId = '', onSubmit }) {
  const [stage, setStage] = useState('form');
  const [selections, setSelections] = useState([]);
  const [presetId, setPresetId] = useState('none');
  const [body, setBody] = useState('');
  const copy = ACTION_COPY[action] || ACTION_COPY.forward;
  const destinations = useMemo(() => normaliseDirectoryEntries(directory), [directory]);
  const presetOptions = useMemo(() => valueList(presets), [presets]);
  const needsDestination = action === 'forward';
  const supportsPreset = action === 'forward';
  const needsBody = ['reply', 'forward'].includes(action);
  const dirty = Boolean(selections.length || presetId !== 'none' || body.trim());

  useEffect(() => {
    if (!open) return;
    setStage('form');
    const initial = destinations.find((item) => item.id === initialDestinationId);
    setSelections(initial ? [directorySelection(initial, 'to')] : []);
    setPresetId('none');
    setBody('');
  }, [action, destinations, initialDestinationId, message?.id, open]);

  const selectedPreset = presetOptions.find((item) => String(item.id || item.value) === presetId);
  const selectedLeaveLabels = useMemo(() => {
    if (selectedPreset) return [];
    const byKey = new Map(destinations.map((item) => [`${item.kind}:${item.id}`, item]));
    return [...new Set(selections.flatMap((selection) => {
      const item = byKey.get(selectionKey(selection));
      if (!item) return [];
      return item.kind === 'group' ? item.onLeaveLabels || [] : item.onLeave ? [item.label] : [];
    }))];
  }, [destinations, selectedPreset, selections]);
  const canContinue = !directoryLoading && (!needsDestination || selections.length > 0)
    && (presetId === 'none' || Boolean(selectedPreset?.routeSnapshotToken));
  const changeOpen = (nextOpen) => {
    if (submitting) return;
    if (!nextOpen && dirty && !window.confirm('Discard the unsaved mail action?')) return;
    onOpenChange(nextOpen);
  };
  const labelsFor = (kind) => selections
    .filter((selection) => selection.kind === kind)
    .map((selection) => selection.address || destinations.find((item) => `${item.kind}:${item.id}` === selectionKey(selection))?.label)
    .filter(Boolean);
  const selectPreset = (value) => {
    setPresetId(value);
    if (value === 'none') return;
    const preset = presetOptions.find((item) => String(item.id || item.value) === value);
    setSelections(presetRecipientSelections(preset));
  };
  const submit = () => {
    const recipients = presetId === 'none'
      ? splitRecipientSelections(selections)
      : { destinationSelections: [], manualRecipients: [] };
    onSubmit({
      action,
      ...recipients,
      presetId: presetId === 'none' ? null : selectedPreset?.id || selectedPreset?.value || presetId,
      routeSnapshotToken: presetId === 'none' ? null : selectedPreset?.routeSnapshotToken || null,
      body: body.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{stage === 'confirm' ? `Confirm ${actionLabel(action).toLowerCase()}` : copy.title}</DialogTitle><DialogDescription>{stage === 'confirm' ? 'Review every recipient before FCOS performs this action.' : copy.description}</DialogDescription></DialogHeader>
        {stage === 'form' ? (
          <div className="space-y-4">
            {supportsPreset && <div className="space-y-2"><Label>Routing preset</Label><EmailPresetPicker presets={presetOptions} selectedId={presetId} onSelect={selectPreset} disabled={submitting} />{presetId !== 'none' && <div className="space-y-1 text-xs text-muted-foreground"><p className="font-semibold text-foreground">{selectedPreset?.label || 'Preset'} · {selectedPreset?.effectiveVersion?.label || 'Standard'}</p><p>{selectedPreset?.effectiveVersion?.reason || 'Standard routing'}. Changing any recipient turns the preset label off.</p></div>}{(selectedPreset?.warnings || []).map((warning) => <div key={warning} className="flex gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>{warning}</p></div>)}</div>}
            {needsDestination && <div className="space-y-2"><Label>Recipients</Label><EmailRecipientPicker directory={destinations} selections={selections} onChange={(next) => { setPresetId('none'); setSelections(next); }} disabled={submitting} loading={directoryLoading} /></div>}
            {selectedLeaveLabels.length > 0 && <div className="flex gap-2 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Currently on leave: {selectedLeaveLabels.join(', ')}. You may continue after reviewing the recipients.</p></div>}
            {needsBody && <div className="space-y-2"><Label htmlFor="email-router-body">Message</Label><Textarea id="email-router-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add a message" rows={7} /></div>}
            {action === 'delete' && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Deletion can be permanent depending on mailbox policy.</p></div>}
            {action === 'retry' && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>FCOS will check Sent Items again first. Continue only if you have also confirmed that the earlier message was not sent. This action may deliver a message.</p></div>}
          </div>
        ) : (
          <div className="space-y-3 border border-border bg-muted/30 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium"><ArrowRight className="h-4 w-4 text-primary" />{actionLabel(action)}: {message?.subject || '(No subject)'}</div>
            {needsDestination && presetId !== 'none' && <p className="text-muted-foreground">Preset: {selectedPreset?.label || selectedPreset?.name || 'Selected routing preset'} · {selectedPreset?.effectiveVersion?.label || 'Standard'} ({selectedPreset?.effectiveVersion?.reason || 'Standard routing'})</p>}
            {needsDestination && RECIPIENT_KINDS.map((kind) => labelsFor(kind).length ? <div key={kind} className="grid grid-cols-[2.5rem_1fr] gap-2 text-muted-foreground"><span className="font-semibold uppercase text-foreground">{kind}:</span><ol className="space-y-1">{labelsFor(kind).map((label, index) => <li key={`${kind}:${label}:${index}`}>{index + 1}. {label}</li>)}</ol></div> : null)}
            {action === 'reply' && <p className="text-muted-foreground">Replying to: {formatAddresses(message?.from)}</p>}
            {needsBody && body && <p className="whitespace-pre-wrap border-t border-border pt-3 text-muted-foreground">{body}</p>}
          </div>
        )}
        <DialogFooter>{stage === 'confirm' ? <><Button variant="outline" onClick={() => setStage('form')} disabled={submitting}>Back</Button><Button onClick={submit} disabled={submitting}>{submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{submitting ? 'Submitting...' : `Confirm ${actionLabel(action)}`}</Button></> : <><Button variant="outline" onClick={() => changeOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => setStage('confirm')} disabled={!canContinue || submitting}>{action === 'undo' ? <Undo2 /> : <ArrowRight />}Continue</Button></>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
