import { RotateCcw, X } from 'lucide-react';
import { draftTimestampLabel } from '@/lib/draftAutosave';

export default function DraftNotice({ restoredAt, label = 'Autosaved draft restored', onDiscard, className = '' }) {
  if (!restoredAt) return null;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <RotateCcw className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">{label}</span>
          {draftTimestampLabel(restoredAt) ? ` · ${draftTimestampLabel(restoredAt)} HKT` : ''}
        </span>
      </div>
      {onDiscard && (
        <button type="button" onClick={onDiscard} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline">
          <X className="h-3.5 w-3.5" /> Discard draft
        </button>
      )}
    </div>
  );
}
