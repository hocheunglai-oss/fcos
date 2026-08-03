import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Undo2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { actionLabel, formatAddresses } from '@/lib/emailRouter';

const ACTION_COPY = {
  redirect: { title: 'Redirect message', description: 'Route this message to ordered people or groups from the routing directory. The original message is preserved.' },
  reply: { title: 'Reply', description: 'Reply to the original sender from the connected Email Router mailbox.' },
  forward: { title: 'Forward message', description: 'Forward a copy of this message to ordered people or groups from the routing directory.' },
  archive: { title: 'Archive message', description: 'Move this message out of the active mailbox.' },
  delete: { title: 'Delete message', description: 'Request deletion of this message. This may not be reversible.' },
  undo: { title: 'Undo mail action', description: 'Request a reversal of the selected action.' },
  retry: { title: 'Review uncertain send', description: 'Retry only after checking Sent Items and confirming the earlier submission was not sent.' },
};

const RECIPIENT_KINDS = ['to', 'cc', 'bcc'];

function valueList(data) {
  return Array.isArray(data) ? data : data?.items || data?.destinations || data?.presets || [];
}

function directorySelection(item, kind) {
  return item.kind === 'group'
    ? { groupId: item.id, destinationId: null, kind }
    : { destinationId: item.id, groupId: null, kind };
}

function selectionKey(selection) {
  return selection?.groupId ? `group:${selection.groupId}` : `destination:${selection?.destinationId}`;
}

function RecipientPanel({ kind, destinations, selections, disabled, loading, onToggle }) {
  return <fieldset className="space-y-2 border-y border-border py-3" disabled={disabled}>
    <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">{kind}</legend>
    <div className="flex min-h-9 flex-wrap gap-2">
      {loading ? <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading routing directory...</p> : destinations.length ? destinations.map((destination) => {
        const destinationKey = `${destination.kind}:${destination.id}`;
        const assigned = selections.find((selection) => selectionKey(selection) === destinationKey);
        const selectedHere = assigned?.kind === kind;
        const assignedElsewhere = Boolean(assigned && !selectedHere);
        const number = selectedHere ? selections.filter((selection) => selection.kind === kind).findIndex((selection) => selectionKey(selection) === destinationKey) + 1 : null;
        return <Button
          key={`${kind}:${destination.id}`}
          type="button"
          size="sm"
          variant={selectedHere ? 'default' : 'outline'}
          aria-pressed={selectedHere}
          disabled={disabled || assignedElsewhere}
          title={assignedElsewhere ? `${destination.label} is already selected as ${assigned.kind.toUpperCase()}` : undefined}
          onClick={() => onToggle(destination, kind)}
          className="min-w-12 font-semibold"
        >
          {number && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1 text-[10px] font-bold text-primary">{number}</span>}
          {destination.kind === 'group' && <Users className="h-3.5 w-3.5" />}
          {destination.label}
          {destination.kind === 'group' && destination.memberCount ? <span className="text-[10px] opacity-70">({destination.memberCount})</span> : null}
          {assignedElsewhere && <span className="text-[10px] text-muted-foreground">{assigned.kind.toUpperCase()}</span>}
        </Button>;
      }) : <p className="py-2 text-xs text-muted-foreground">No included routing destinations are available.</p>}
    </div>
  </fieldset>;
}

export default function EmailActionDialog({ open, onOpenChange, action, message, directory, presets, directoryLoading = false, submitting, initialDestinationId = '', onSubmit }) {
  const [stage, setStage] = useState('form');
  const [selections, setSelections] = useState([]);
  const [presetId, setPresetId] = useState('none');
  const [body, setBody] = useState('');
  const copy = ACTION_COPY[action] || ACTION_COPY.redirect;
  const destinations = useMemo(() => valueList(directory).map((item) => ({
    id: String(item.id || item.value),
    kind: item.kind === 'group' ? 'group' : 'destination',
    label: item.label || item.nickname || item.name || '',
    memberCount: Number(item.memberCount || 0),
  })).filter((item) => item.id && item.label), [directory]);
  const presetOptions = useMemo(() => valueList(presets), [presets]);
  const needsDestination = ['redirect', 'forward'].includes(action);
  const supportsPreset = ['redirect', 'forward'].includes(action);
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
  const canContinue = !directoryLoading && (!needsDestination || selections.length > 0 || presetId !== 'none');
  const changeOpen = (nextOpen) => {
    if (submitting) return;
    if (!nextOpen && dirty && !window.confirm('Discard the unsaved mail action?')) return;
    onOpenChange(nextOpen);
  };
  const toggleDestination = (destination, kind) => {
    setPresetId('none');
    setSelections((current) => {
      const key = `${destination.kind}:${destination.id}`;
      const existing = current.find((selection) => selectionKey(selection) === key);
      if (existing?.kind === kind) return current.filter((selection) => selectionKey(selection) !== key);
      if (existing) return current;
      return [...current, directorySelection(destination, kind)];
    });
  };
  const labelsFor = (kind) => selections
    .filter((selection) => selection.kind === kind)
    .map((selection) => destinations.find((item) => `${item.kind}:${item.id}` === selectionKey(selection))?.label)
    .filter(Boolean);
  const submit = () => {
    onSubmit({
      action,
      destinationSelections: selections,
      presetId: presetId === 'none' ? null : selectedPreset?.id || selectedPreset?.value || presetId,
      body: body.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{stage === 'confirm' ? `Confirm ${actionLabel(action).toLowerCase()}` : copy.title}</DialogTitle><DialogDescription>{stage === 'confirm' ? 'Review every recipient before FCOS performs this action.' : copy.description}</DialogDescription></DialogHeader>
        {stage === 'form' ? (
          <div className="space-y-4">
            {needsDestination && <div className="space-y-2"><Label>Recipients</Label>{RECIPIENT_KINDS.map((kind) => <RecipientPanel key={kind} kind={kind} destinations={destinations} selections={selections} disabled={presetId !== 'none'} loading={directoryLoading} onToggle={toggleDestination} />)}</div>}
            {supportsPreset && <div className="space-y-2"><Label htmlFor="email-router-preset">Routing preset</Label><Select value={presetId} onValueChange={(value) => { setPresetId(value); if (value !== 'none') setSelections([]); }}><SelectTrigger id="email-router-preset"><SelectValue placeholder="No preset" /></SelectTrigger><SelectContent><SelectItem value="none">No preset</SelectItem>{presetOptions.map((item) => { const value = String(item.id || item.value); return <SelectItem key={value} value={value}>{item.label || item.name || value}</SelectItem>; })}</SelectContent></Select></div>}
            {needsBody && <div className="space-y-2"><Label htmlFor="email-router-body">Message</Label><Textarea id="email-router-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add a message" rows={7} /></div>}
            {['archive', 'delete'].includes(action) && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{action === 'delete' ? 'Deletion can be permanent depending on mailbox policy.' : 'Archived messages remain available from the Archive tab.'}</p></div>}
            {action === 'retry' && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>FCOS will check Sent Items again first. Continue only if you have also confirmed that the earlier message was not sent. This action may deliver a message.</p></div>}
          </div>
        ) : (
          <div className="space-y-3 border border-border bg-muted/30 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium"><ArrowRight className="h-4 w-4 text-primary" />{actionLabel(action)}: {message?.subject || '(No subject)'}</div>
            {needsDestination && presetId !== 'none' && <p className="text-muted-foreground">Preset: {selectedPreset?.label || selectedPreset?.name || 'Selected routing preset'}</p>}
            {needsDestination && presetId === 'none' && RECIPIENT_KINDS.map((kind) => labelsFor(kind).length ? <div key={kind} className="grid grid-cols-[2.5rem_1fr] gap-2 text-muted-foreground"><span className="font-semibold uppercase text-foreground">{kind}:</span><ol className="space-y-1">{labelsFor(kind).map((label, index) => <li key={`${kind}:${label}:${index}`}>{index + 1}. {label}</li>)}</ol></div> : null)}
            {action === 'reply' && <p className="text-muted-foreground">Replying to: {formatAddresses(message?.from)}</p>}
            {needsBody && body && <p className="whitespace-pre-wrap border-t border-border pt-3 text-muted-foreground">{body}</p>}
          </div>
        )}
        <DialogFooter>{stage === 'confirm' ? <><Button variant="outline" onClick={() => setStage('form')} disabled={submitting}>Back</Button><Button onClick={submit} disabled={submitting}>{submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{submitting ? 'Submitting...' : `Confirm ${actionLabel(action)}`}</Button></> : <><Button variant="outline" onClick={() => changeOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => setStage('confirm')} disabled={!canContinue || submitting}>{action === 'undo' ? <Undo2 /> : <ArrowRight />}Continue</Button></>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
