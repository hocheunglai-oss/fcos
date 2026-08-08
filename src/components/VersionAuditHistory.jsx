import { APP_VERSION_HISTORY } from '@/lib/appVersion';

export default function VersionAuditHistory() {
  return (
    <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
      {APP_VERSION_HISTORY.map((entry) => (
        <section key={entry.version} className="rounded-lg border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Version {entry.version}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.title}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
              {entry.releasedAt}
            </div>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {entry.changes.map((change) => (
              <li key={change} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{change}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
