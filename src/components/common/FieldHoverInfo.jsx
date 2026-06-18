export default function FieldHoverInfo({ info }) {
  if (!info) return null;

  return (
    <div className="fixed right-6 bottom-6 z-[100] w-80 rounded-xl border border-border bg-card shadow-2xl p-4 pointer-events-none">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Field information</p>
      <h4 className="text-sm font-bold text-foreground mb-3 break-words">{info.label || info.fieldName}</h4>
      <div className="space-y-2 text-xs">
        {info.fieldName && (
          <div>
            <span className="block text-muted-foreground">Field API name</span>
            <span className="font-mono text-foreground break-all">{info.fieldName}</span>
          </div>
        )}
        {info.type && (
          <div>
            <span className="block text-muted-foreground">Field type</span>
            <span className="text-foreground">{info.type}</span>
          </div>
        )}
        {info.recordId && (
          <div>
            <span className="block text-muted-foreground">Sample record ID</span>
            <span className="font-mono text-foreground break-all">{info.recordId}</span>
          </div>
        )}
        {info.sampleValue !== undefined && (
          <div>
            <span className="block text-muted-foreground">Sample value</span>
            <span className="text-foreground break-words">{info.sampleValue || '—'}</span>
          </div>
        )}
      </div>
    </div>
  );
}