import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  LockKeyhole,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Terminal,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  APPROVED_CONNECTION_BROWSER_PROFILE,
  CONNECTION_CHECKLIST_SEQUENCE,
  CONNECTION_CHECKLIST_STORAGE_KEY,
  CONNECTION_TARGETS,
  connectionCheckState,
  sanitizeConnectionChecks,
  updateConnectionCheck,
} from '@/lib/connectionChecklist';

const STEP_ICONS = [Terminal, UserCheck, ShieldCheck, Monitor];

const STATE_META = {
  pending: { label: 'Next step', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  stopped: { label: 'Fail closed', className: 'border-red-200 bg-red-50 text-red-700' },
  authentication_blocked: { label: 'Otto unlocked', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  return_to_cli: { label: 'Return to CLI', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  complete: { label: 'CLI complete', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

function readChecks() {
  if (typeof window === 'undefined') return sanitizeConnectionChecks({});
  try {
    return sanitizeConnectionChecks(JSON.parse(window.localStorage.getItem(CONNECTION_CHECKLIST_STORAGE_KEY) || '{}'));
  } catch {
    return sanitizeConnectionChecks({});
  }
}

function formatRecordedAt(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function StepMarker({ number, complete, active, blocked, stopped }) {
  const className = complete
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : stopped
      ? 'border-red-200 bg-red-50 text-red-700'
      : active
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : blocked
          ? 'border-slate-200 bg-slate-50 text-slate-400'
          : 'border-border bg-background text-muted-foreground';
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${className}`}>
      {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : number}
    </span>
  );
}

function ChecklistActions({ target, record, onAction }) {
  const state = connectionCheckState(record);
  const cliAvailable = record.cliAvailability === 'available';
  const identityVerified = record.identityStatus === 'verified';
  const browserBlocked = !state.browserAllowed || state.status !== 'authentication_blocked';

  return (
    <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-background/70">
      <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <StepMarker number={1} complete={cliAvailable} active={!record.cliAvailability} stopped={record.cliAvailability === 'unavailable'} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Verify CLI availability</div>
            <code className="mt-1 block break-all text-[11px] text-muted-foreground">{target.availabilityCommand}</code>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
          <Button type="button" size="sm" variant={record.cliAvailability === 'available' ? 'secondary' : 'outline'} onClick={() => onAction('cli_available')}>Available</Button>
          <Button type="button" size="sm" variant={record.cliAvailability === 'unavailable' ? 'destructive' : 'outline'} onClick={() => onAction('cli_unavailable')}>Unavailable</Button>
        </div>
      </li>

      <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <StepMarker number={2} complete={identityVerified} active={cliAvailable && !record.identityStatus} blocked={!cliAvailable} stopped={record.identityStatus === 'mismatch'} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Verify account, team, and project</div>
            <code className="mt-1 block break-all text-[11px] text-muted-foreground">{target.identityCommand}</code>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:max-w-[430px] sm:justify-end sm:pl-0">
          <Button type="button" size="sm" variant={record.identityStatus === 'verified' ? 'secondary' : 'outline'} disabled={!cliAvailable} onClick={() => onAction('identity_verified')}>Exact match</Button>
          <Button type="button" size="sm" variant={record.identityStatus === 'mismatch' ? 'destructive' : 'outline'} disabled={!cliAvailable} onClick={() => onAction('identity_mismatch')}>Mismatch · stop</Button>
          <Button type="button" size="sm" variant={record.identityStatus === 'authentication_blocked' ? 'secondary' : 'outline'} disabled={!cliAvailable} onClick={() => onAction('identity_authentication_blocked')}>Authentication blocked</Button>
        </div>
      </li>

      <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <StepMarker number={3} complete={record.cliOutcome === 'completed'} active={identityVerified && !record.cliOutcome} blocked={!identityVerified} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Use the verified CLI</div>
            <p className="mt-1 text-xs text-muted-foreground">Do not mutate through an unmatched or unauthenticated session.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
          <Button type="button" size="sm" variant={record.cliOutcome === 'completed' ? 'secondary' : 'outline'} disabled={!identityVerified} onClick={() => onAction('cli_completed')}>CLI completed</Button>
          <Button type="button" size="sm" variant={record.cliOutcome === 'authentication_blocked' ? 'secondary' : 'outline'} disabled={!identityVerified} onClick={() => onAction('cli_authentication_blocked')}>Authentication blocked</Button>
        </div>
      </li>

      <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <StepMarker number={4} complete={record.browserAuthenticationRecorded} active={!browserBlocked} blocked={browserBlocked} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              Chrome authentication fallback
              {browserBlocked && <LockKeyhole className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Profile must be exactly <span className="font-semibold text-foreground">{APPROVED_CONNECTION_BROWSER_PROFILE}</span>. After authentication, return to step 2 and reverify the CLI identity.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
          {record.browserAuthenticationRecorded ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onAction('return_to_cli')}>Return to CLI verification</Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={browserBlocked} onClick={() => onAction('browser_authentication_completed')}>Record Otto authentication</Button>
          )}
        </div>
      </li>
    </ol>
  );
}

export default function ConnectionChecklist() {
  const [checks, setChecks] = useState(readChecks);
  const [error, setError] = useState('');
  const completed = CONNECTION_TARGETS.filter(({ id }) => connectionCheckState(checks[id]).status === 'complete').length;

  const persist = (next) => {
    const safe = sanitizeConnectionChecks(next);
    setChecks(safe);
    try {
      window.localStorage.setItem(CONNECTION_CHECKLIST_STORAGE_KEY, JSON.stringify(safe));
    } catch {
      setError('The checklist changed for this session but could not be saved in this browser.');
    }
  };

  const applyAction = (targetId, action) => {
    setError('');
    try {
      persist({ ...checks, [targetId]: updateConnectionCheck(checks[targetId], action) });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The checklist step is not available yet.');
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground"><ShieldCheck className="h-4 w-4" /></div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Connection Checklist</h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
              A CLI-first runbook for FCOS infrastructure. Records stay in this browser and contain only fixed non-secret target identifiers, controlled status values, the approved profile name, and timestamps. CLI output, usernames beyond the approved identifiers, tokens, and secrets cannot be entered or stored here.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{completed}/{CONNECTION_TARGETS.length} CLI complete</Badge>
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => persist({})}>
            <RefreshCw className="h-3.5 w-3.5" /> Reset all
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {CONNECTION_CHECKLIST_SEQUENCE.map((step, index) => {
          const Icon = STEP_ICONS[index] || Circle;
          return (
            <div key={step.id} className="rounded-lg border border-border bg-background/70 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold"><span className="text-muted-foreground">{index + 1}</span><Icon className="h-3.5 w-3.5 text-blue-700" />{step.label}</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{step.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        <span className="font-semibold">Fallback rule:</span> prefer an approved connector or API when it can complete the operation. Chrome is for an interactive authentication gap only, and its profile must be exactly <span className="font-semibold">{APPROVED_CONNECTION_BROWSER_PROFILE}</span>.
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {CONNECTION_TARGETS.map((target) => {
          const record = checks[target.id];
          const state = connectionCheckState(record);
          const stateMeta = STATE_META[state.status] || STATE_META.pending;
          return (
            <article key={target.id} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{target.provider}</h3>
                    <Badge variant="outline" className="font-mono text-[10px]">{target.cli}</Badge>
                    <Badge variant="outline" className={stateMeta.className}>{stateMeta.label}</Badge>
                  </div>
                  <dl className="mt-2 flex flex-wrap gap-2">
                    {target.identifiers.map((identifier) => (
                      <div key={identifier.label} className="rounded-md border border-border bg-card px-2 py-1 text-[11px]">
                        <dt className="inline font-semibold text-muted-foreground">{identifier.label}: </dt>
                        <dd className="inline break-all font-mono text-foreground">{identifier.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">Updated {formatRecordedAt(record?.updatedAt)}</div>
              </div>

              <ChecklistActions target={target} record={record} onAction={(action) => applyAction(target.id, action)} />

              <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{target.nonBrowserRoute}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
