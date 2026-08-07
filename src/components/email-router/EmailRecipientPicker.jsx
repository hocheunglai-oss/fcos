import { useState } from 'react';
import { Eye, EyeOff, Loader2, Plus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const RECIPIENT_KINDS = ['to', 'cc', 'bcc'];

export function valueList(data) {
  return Array.isArray(data) ? data : data?.items || data?.destinations || data?.presets || [];
}

export function normaliseDirectoryEntries(directory) {
  return valueList(directory).map((item) => {
    const id = item.id || item.value;
    return {
      id: id == null ? '' : String(id),
      kind: item.kind === 'group' ? 'group' : 'destination',
      label: item.label || item.nickname || item.name || '',
      memberCount: Number(item.memberCount || 0),
      onLeave: item.onLeave === true,
      onLeaveLabels: Array.isArray(item.onLeaveLabels) ? item.onLeaveLabels : [],
    };
  }).filter((item) => item.id && item.label);
}

export function directorySelection(item, kind) {
  return item.kind === 'group'
    ? { groupId: item.id, destinationId: null, kind }
    : { destinationId: item.id, groupId: null, kind };
}

export function presetRecipientSelections(preset) {
  const kindOrder = new Map([['to', 0], ['cc', 1], ['bcc', 2]]);
  return valueList(preset?.destinations)
    .map((selection) => ({
      destinationId: selection.destinationId || null,
      groupId: selection.groupId || null,
      kind: String(selection.kind || selection.recipientKind || '').toLowerCase(),
      position: Number(selection.position || 0),
    }))
    .filter((selection) => RECIPIENT_KINDS.includes(selection.kind) && Boolean(selection.destinationId) !== Boolean(selection.groupId))
    .sort((left, right) => (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99) || left.position - right.position)
    .map(({ position: _position, ...selection }) => selection);
}

export function selectionKey(selection) {
  if (selection?.groupId) return `group:${selection.groupId}`;
  if (selection?.destinationId) return `destination:${selection.destinationId}`;
  return selection?.address ? `manual:${String(selection.address).trim().toLowerCase()}` : '';
}

export function splitRecipientSelections(selections) {
  const values = Array.isArray(selections) ? selections : [];
  const positions = { to: 0, cc: 0, bcc: 0 };
  const ordered = values.map((selection) => {
    const kind = RECIPIENT_KINDS.includes(selection.kind) ? selection.kind : 'to';
    positions[kind] += 1;
    return { ...selection, kind, position: positions[kind] };
  });
  return {
    destinationSelections: ordered.filter((selection) => selection.destinationId || selection.groupId),
    manualRecipients: ordered
      .filter((selection) => selection.address)
      .map((selection) => ({ address: String(selection.address).trim().toLowerCase(), kind: selection.kind, position: selection.position })),
  };
}

export function toggleRecipientSelection(selections, destination, kind) {
  const key = `${destination.kind}:${destination.id}`;
  const existing = selections.find((selection) => selectionKey(selection) === key);
  if (existing?.kind === kind) return selections.filter((selection) => selectionKey(selection) !== key);
  if (existing) return selections;
  return [...selections, directorySelection(destination, kind)];
}

function RecipientPanel({ kind, destinations, selections, disabled, loading, allowManual, onToggle, onAddManual, onRemoveManual }) {
  const [manualAddress, setManualAddress] = useState('');
  const [manualError, setManualError] = useState('');
  const manualSelections = selections.filter((selection) => selection.kind === kind && selection.address);
  const addManual = () => {
    const address = manualAddress.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setManualError('Enter a valid email address.');
      return;
    }
    if (selections.some((selection) => selectionKey(selection) === `manual:${address}`)) {
      setManualError('This address is already selected.');
      return;
    }
    onAddManual({ address, kind });
    setManualAddress('');
    setManualError('');
  };

  return <fieldset className="space-y-2 border-t border-border pt-3" disabled={disabled}>
    <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">{kind}</legend>
    {allowManual && <div className="flex gap-2">
      <Input
        type="email"
        value={manualAddress}
        onChange={(event) => { setManualAddress(event.target.value); setManualError(''); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManual(); } }}
        placeholder={`Manual ${kind.toUpperCase()} email`}
        aria-label={`Manual ${kind.toUpperCase()} email address`}
        disabled={disabled}
      />
      <Button type="button" variant="outline" size="icon" onClick={addManual} disabled={disabled || !manualAddress.trim()} title={`Add manual ${kind.toUpperCase()} recipient`} aria-label={`Add manual ${kind.toUpperCase()} recipient`}><Plus /></Button>
    </div>}
    {manualError && <p className="text-xs font-medium text-destructive">{manualError}</p>}
    {manualSelections.length > 0 && <div className="flex flex-wrap gap-2">{manualSelections.map((selection) => {
      const key = selectionKey(selection);
      const number = selections.filter((item) => item.kind === kind).findIndex((item) => selectionKey(item) === key) + 1;
      return <span key={key} className="inline-flex min-w-0 items-center gap-1.5 border border-border bg-muted/40 px-2 py-1 text-xs">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{number}</span>
        <span className="max-w-52 truncate" title={selection.address}>{selection.address}</span>
        <button type="button" onClick={() => onRemoveManual(selection)} className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={`Remove ${selection.address}`} title={`Remove ${selection.address}`}><X className="h-3.5 w-3.5" /></button>
      </span>;
    })}</div>}
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
          variant={selectedHere ? 'default' : 'outline'}
          size="sm"
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

export default function EmailRecipientPicker({
  directory,
  selections,
  onChange,
  disabled = false,
  loading = false,
  allowManual = true,
  bccVisible = true,
  onBccVisibleChange,
}) {
  const destinations = normaliseDirectoryEntries(directory);
  const toggle = (destination, kind) => onChange(toggleRecipientSelection(selections, destination, kind));
  const addManual = (selection) => onChange([...selections, selection]);
  const removeManual = (selection) => onChange(selections.filter((item) => selectionKey(item) !== selectionKey(selection)));
  const bccCount = selections.filter((selection) => selection.kind === 'bcc').length;

  return <div className="space-y-3">
    <RecipientPanel kind="to" destinations={destinations} selections={selections} disabled={disabled} loading={loading} allowManual={allowManual} onToggle={toggle} onAddManual={addManual} onRemoveManual={removeManual} />
    <RecipientPanel kind="cc" destinations={destinations} selections={selections} disabled={disabled} loading={loading} allowManual={allowManual} onToggle={toggle} onAddManual={addManual} onRemoveManual={removeManual} />
    {onBccVisibleChange && <div className="flex justify-end border-t border-border pt-2">
      <Button type="button" variant="ghost" size="sm" onClick={() => onBccVisibleChange(!bccVisible)} disabled={disabled}>
        {bccVisible ? <EyeOff /> : <Eye />}{bccVisible ? 'Hide Bcc' : 'Show Bcc'}{!bccVisible && bccCount ? ` (${bccCount})` : ''}
      </Button>
    </div>}
    {bccVisible && <RecipientPanel kind="bcc" destinations={destinations} selections={selections} disabled={disabled} loading={loading} allowManual={allowManual} onToggle={toggle} onAddManual={addManual} onRemoveManual={removeManual} />}
  </div>;
}
