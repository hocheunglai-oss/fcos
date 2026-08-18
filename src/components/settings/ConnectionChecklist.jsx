import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  HardDrive,
  KeyRound,
  Loader2,
  LockKeyhole,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Terminal,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  APPROVED_CONNECTION_BROWSER_PROFILE,
  CONNECTION_ATTESTATION_POLICY,
  CONNECTION_CHECKLIST_SEQUENCE,
  CONNECTION_DOCTOR_COMMAND,
  CONNECTION_LOCAL_STATE_DIRECTORY,
  CONNECTION_POLICY_VERSION,
  CONNECTION_PROFILE_NAME,
  CONNECTION_TARGETS,
  connectionAttestationState,
  sanitizeConnectionAttestation,
} from '@/lib/connectionChecklist';

const STEP_ICONS = [Terminal, UserCheck, ShieldCheck, Monitor];
const REFRESH_INTERVAL_MS = 60_000;
const SALESFORCE_CONNECTION_TARGET = CONNECTION_TARGETS.find(({ id }) => id === 'salesforce');
const SHARED_SALESFORCE_BROWSER_PROFILE = SALESFORCE_CONNECTION_TARGET?.publication?.browserProfile || 'vincexai';
const SALESFORCE_BROWSER_PROFILES = Object.fromEntries(
  (SALESFORCE_CONNECTION_TARGET?.environments || []).map(({ key, browserProfile }) => [key, browserProfile]),
);

const STATUS_META = {
  verified: { label: 'Verified', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  warning: { label: 'Attention', className: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle },
  failed: { label: 'Failed closed', className: 'border-red-200 bg-red-50 text-red-700', Icon: XCircle },
  expired: { label: 'Expired', className: 'border-red-200 bg-red-50 text-red-700', Icon: Clock3 },
  unavailable: { label: 'Not published', className: 'border-slate-200 bg-slate-50 text-slate-700', Icon: Circle },
};

const WARNING_LABELS = {
  cli_version_warning: 'CLI version should be reviewed',
  cli_version_incompatible: 'CLI version is outside policy',
  credential_rotation_due: 'Credential rotation is due',
  credential_expiring: 'Credential expires soon',
  credential_expired: 'Credential expired',
  credential_expiry_unknown: 'Credential expiry is unavailable',
  permission_probe_failed: 'Permission probe failed',
  target_pin_missing: 'Target pin is missing or invalid',
  salesforce_auth_not_isolated: 'Salesforce host authorization is protected but not repo-local',
};

function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function ageLabel(seconds) {
  if (!Number.isFinite(seconds)) return 'not available';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function policyVersionLabel(policy) {
  if (policy.exact) return `exactly ${policy.exact}`;
  if (policy.minimum && policy.maximumExclusive) return `${policy.minimum} to <${policy.maximumExclusive}`;
  return policy.minimum ? `≥${policy.minimum}` : 'policy controlled';
}

function providerVerified(report) {
  return report?.identityVerified
    && report.identityStatus === 'verified'
    && report.targetPin === 'verified'
    && report.permissionStatus === 'verified'
    && report.cliVersionStatus !== 'incompatible';
}

function ProviderCard({ target, report }) {
  const verified = providerVerified(report);
  const state = !report ? 'unavailable' : verified ? (report.warningCodes.length ? 'warning' : 'verified') : 'failed';
  const meta = STATUS_META[state];
  const StateIcon = meta.Icon;
  return (
    <article className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{target.provider}</h3>
            <Badge variant="outline" className="font-mono text-[10px]">{target.cli}</Badge>
            <Badge variant="outline" className={target.fullyIsolated ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-violet-200 bg-violet-50 text-violet-700'}>
              {target.fullyIsolated ? 'Isolated authorization' : 'Isolated target pin'}
            </Badge>
            <Badge variant="outline" className={`gap-1 ${meta.className}`}><StateIcon className="h-3 w-3" />{meta.label}</Badge>
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
        <div className="shrink-0 text-xs text-muted-foreground">Checked {formatDate(report?.lastVerifiedAt)}</div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="text-[11px] font-semibold text-foreground">CLI version</div>
          <div className="mt-1 font-mono text-xs">{report?.cliVersion || 'Unavailable'}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Policy: {policyVersionLabel(target.cliVersion)}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="text-[11px] font-semibold text-foreground">Identity and target</div>
          <div className="mt-1 text-xs capitalize">{report?.identityStatus?.replaceAll('_', ' ') || 'Unavailable'} · pin {report?.targetPin || 'unavailable'}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Probe {report?.latencyMs != null ? `${report.latencyMs} ms` : 'not available'}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"><KeyRound className="h-3.5 w-3.5" />Credential lifecycle</div>
          <div className="mt-1 text-xs capitalize">{report?.credentialLifecycle?.replaceAll('_', ' ') || 'Unknown'}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">{report?.credentialAgeDays != null ? `${report.credentialAgeDays} days since authorization record` : 'Authorization age unavailable'}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"><HardDrive className="h-3.5 w-3.5" />Credential storage</div>
          <div className="mt-1 text-xs capitalize">{target.credentialStorage.replaceAll('_', ' ')}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Rotation warning after {target.rotationWarningDays} days</div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-card p-2.5">
        <div className="text-[11px] font-semibold text-foreground">Required permission probes</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {target.requiredPermissions.map((permission) => {
            const passed = report?.permissions.includes(permission);
            return (
              <Badge key={permission} variant="outline" className={passed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}>
                {passed ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}{permission}
              </Badge>
            );
          })}
        </div>
      </div>

      {report?.warningCodes.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {report.warningCodes.map((code) => WARNING_LABELS[code] || code).join(' · ')}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="text-[11px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Persistence:</span> {target.persistence}</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Fail-closed route:</span> {target.nonBrowserRoute}</div>
      </div>
    </article>
  );
}

export default function ConnectionChecklist() {
  const [attestation, setAttestation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAttestation = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('systemHealth', {}, { cache: false, force });
    if (response.data?.error) {
      setError(response.data.error);
      setAttestation(null);
    } else {
      const safe = sanitizeConnectionAttestation(response.data?.connectionAttestation);
      const revision = Number(response.data?.connectionAttestation?.revision);
      setAttestation(safe ? { ...safe, revision: Number.isInteger(revision) && revision > 0 ? revision : null } : null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAttestation();
    const intervalId = window.setInterval(() => loadAttestation(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadAttestation]);

  const state = connectionAttestationState(attestation);
  const meta = STATUS_META[state.status] || STATUS_META.unavailable;
  const StateIcon = meta.Icon;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground"><ShieldCheck className="h-4 w-4" /></div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Connection Checklist</h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
              Live, machine-signed verification of CLI versions, exact provider targets, required permissions, and credential lifecycle. The attestation is service-only and contains no tokens, CLI output, secrets, or mirrored provider records.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className={`gap-1 ${meta.className}`}><StateIcon className="h-3 w-3" />{state.verifiedCount}/{CONNECTION_TARGETS.length} {meta.label}</Badge>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => loadAttestation({ force: true })} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 lg:grid-cols-3">
        <div className="flex items-start gap-2.5">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <div><div className="text-xs font-semibold text-blue-950">Policy {CONNECTION_POLICY_VERSION} · {CONNECTION_PROFILE_NAME}</div><p className="mt-1 text-[11px] text-blue-900">Ignored machine state stays in <code>{CONNECTION_LOCAL_STATE_DIRECTORY}/</code>.</p></div>
        </div>
        <div className="flex items-start gap-2.5">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <div><div className="text-xs font-semibold text-blue-950">Signed attestation</div><p className="mt-1 text-[11px] text-blue-900">Key <code>{CONNECTION_ATTESTATION_POLICY.keyId}</code> · revision {attestation?.revision || '—'}</p></div>
        </div>
        <div className="flex items-start gap-2.5">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <div><div className="text-xs font-semibold text-blue-950">Last verified {ageLabel(state.ageSeconds)}</div><p className="mt-1 text-[11px] text-blue-900">{formatDate(attestation?.verifiedAt)} · {attestation?.durationMs != null ? `${attestation.durationMs} ms total` : 'duration unavailable'}</p></div>
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

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span><span className="font-semibold">Fallback rule:</span> use Chrome only when CLI and approved API/connector authentication cannot complete. Use <span className="font-semibold">{APPROVED_CONNECTION_BROWSER_PROFILE}</span> for FCOS, Salesforce DEVEE, and Salesforce QAT; <span className="font-semibold">{SALESFORCE_BROWSER_PROFILES.production || 'Vincent'}</span> only for Salesforce Production authentication; or <span className="font-semibold">{SHARED_SALESFORCE_BROWSER_PROFILE}</span> only for the shared Salesforce GitHub repository. Then return to <code>{CONNECTION_DOCTOR_COMMAND}</code>.</span>
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!loading && !attestation && !error ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
          No signed verification has been published. Run <code className="font-semibold">{CONNECTION_DOCTOR_COMMAND}</code> on the approved FCOS workstation.
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {CONNECTION_TARGETS.map((target) => <ProviderCard key={target.id} target={target} report={attestation?.providers?.[target.id] || null} />)}
      </div>
    </section>
  );
}
