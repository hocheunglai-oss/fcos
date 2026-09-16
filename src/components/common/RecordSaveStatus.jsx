import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { draftTimestampLabel } from '@/lib/draftAutosave';

function display(value) {
  if (value == null || value === '') return 'Blank';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export default function RecordSaveStatus({ draft, saving = false, error = '', saved = false, authority = 'source system', onRecover, onDiscard }) {
  if (!draft && !saving && !error && !saved) return null;
  const message = saving ? `Saving to ${authority}…` : error ? 'Save failed. Your edits remain available.'
    : draft?.storageError ? 'Draft storage is unavailable. Keep this page open until your changes are saved.'
      : draft?.recovery ? 'The source changed while you had a draft. Review the conflicting fields below.'
        : draft?.dirty ? `Draft saved on this device${draft.savedAt ? ` · ${draftTimestampLabel(draft.savedAt)} HKT` : ''}. Not yet submitted.`
          : saved ? `Saved to ${authority}.` : '';
  if (!message) return null;
  return <section className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm" aria-label="Save status">
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : error || draft?.recovery || draft?.storageError ? <AlertTriangle className="h-4 w-4 text-amber-700" /> : <CheckCircle2 className="h-4 w-4 text-emerald-700" />}
      <span>{message}</span>
    </div>
    {draft?.recovery && <>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Changed field</th><th>Your draft</th><th>Current source</th></tr></thead><tbody>{draft.recovery.conflicts.map((item) => <tr key={item.field}><th className="p-2 font-medium">{item.field.replaceAll('.', ' / ')}</th><td className="max-w-sm break-words p-2">{display(item.draft)}</td><td className="max-w-sm break-words p-2">{display(item.current)}</td></tr>)}</tbody></table></div>
      <p className="mt-2 text-xs text-muted-foreground">Recover the non-conflicting edits, then re-enter any conflicting changes you still need. Current permissions and approval checks apply.</p>
      <div className="mt-2 flex gap-2"><Button type="button" size="sm" variant="outline" onClick={onRecover}>Recover non-conflicting edits</Button><Button type="button" size="sm" variant="ghost" onClick={onDiscard}>Discard draft</Button></div>
    </>}
  </section>;
}
