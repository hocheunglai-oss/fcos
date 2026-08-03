import { Eye, EyeOff, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const RECIPIENT_KINDS = ['to', 'cc', 'bcc'];

export function valueList(data) {
  return Array.isArray(data) ? data : data?.items || data?.destinations || data?.presets || [];
}

export function normaliseDirectoryEntries(directory) {
  return valueList(directory).map((item) => ({
    id: String(item.id || item.value),
    kind: item.kind === 'group' ? 'group' : 'destination',
    label: item.label || item.nickname || item.name || '',
    memberCount: Number(item.memberCount || 0),
  })).filter((item) => item.id && item.label);
}

export function directorySelection(item, kind) {
  return item.kind === 'group'
    ? { groupId: item.id, destinationId: null, kind }
    : { destinationId: item.id, groupId: null, kind };
}

export function selectionKey(selection) {
  return selection?.groupId ? `group:${selection.groupId}` : `destination:${selection?.destinationId}`;
}

export function toggleRecipientSelection(selections, destination, kind) {
  const key = `${destination.kind}:${destination.id}`;
  const existing = selections.find((selection) => selectionKey(selection) === key);
  if (existing?.kind === kind) return selections.filter((selection) => selectionKey(selection) !== key);
  if (existing) return selections;
  return [...selections, directorySelection(destination, kind)];
}

function RecipientPanel({ kind, destinations, selections, disabled, loading, onToggle }) {
  return <fieldset className="space-y-2 border-t border-border pt-3" disabled={disabled}>
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
  bccVisible = true,
  onBccVisibleChange,
}) {
  const destinations = normaliseDirectoryEntries(directory);
  const toggle = (destination, kind) => onChange(toggleRecipientSelection(selections, destination, kind));
  const bccCount = selections.filter((selection) => selection.kind === 'bcc').length;

  return <div className="space-y-3">
    <RecipientPanel kind="to" destinations={destinations} selections={selections} disabled={disabled} loading={loading} onToggle={toggle} />
    <RecipientPanel kind="cc" destinations={destinations} selections={selections} disabled={disabled} loading={loading} onToggle={toggle} />
    {onBccVisibleChange && <div className="flex justify-end border-t border-border pt-2">
      <Button type="button" variant="ghost" size="sm" onClick={() => onBccVisibleChange(!bccVisible)} disabled={disabled}>
        {bccVisible ? <EyeOff /> : <Eye />}{bccVisible ? 'Hide Bcc' : 'Show Bcc'}{!bccVisible && bccCount ? ` (${bccCount})` : ''}
      </Button>
    </div>}
    {bccVisible && <RecipientPanel kind="bcc" destinations={destinations} selections={selections} disabled={disabled} loading={loading} onToggle={toggle} />}
  </div>;
}
