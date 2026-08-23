import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Minus,
  Pencil,
  Palette,
  Plus,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import StateBlock from '@/components/common/StateBlock';
import { appClient } from '@/api/appClient';
import { DOCUMENT_SOURCE_GROUPS, readDocumentSettings, saveDocumentSettings } from '@/lib/documentSettings';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';
import { useAuth } from '@/lib/AuthContext';
import HedgeAssistantAiSettings from '@/hedge/components/HedgeAssistantAiSettings';
import EmailRouterAdvisorAiSettings from '@/components/email-router/EmailRouterAdvisorAiSettings';
import AiModelSettingsCard from '@/components/settings/AiModelSettingsCard';
import { applyAppearancePreferences, readAppearancePreferences } from '@/lib/appearancePreferences';

const ConnectionChecklist = lazy(() => import('@/components/settings/ConnectionChecklist'));

const SETTINGS_DRAFT_KEY = 'settings:page';
const SIDEBAR_FIXED_STORAGE_KEY = 'workspace-sidebar-fixed';
const HEALTH_SAMPLES_KEY = 'fcos:system-health-samples';
const HEALTH_SAMPLE_INTERVAL_MS = 60_000;
const MAX_HEALTH_SAMPLES = 5;

function settingsSnapshot() {
  const documents = readDocumentSettings();
  const appearance = readAppearancePreferences();
  return {
    sidebarMode: localStorage.getItem(SIDEBAR_FIXED_STORAGE_KEY) === 'true' ? 'fixed' : 'auto_hide',
    tableDensity: localStorage.getItem('table-density') === 'comfort' ? 'comfort' : 'compact',
    documentShowOnlyRelevant: documents.showOnlyRelevant,
    documentSourceGroups: documents.relevantSourceGroups,
    appearanceMode: appearance.appearanceMode,
    glassIntensity: appearance.glassIntensity,
    revision: 0,
    initialized: false,
  };
}

function comparableWorkspaceSettings(value = {}) {
  const selectedGroups = new Set(Array.isArray(value.documentSourceGroups) ? value.documentSourceGroups : []);
  return {
    sidebarMode: value.sidebarMode === 'fixed' ? 'fixed' : 'auto_hide',
    tableDensity: value.tableDensity === 'comfort' ? 'comfort' : 'compact',
    documentShowOnlyRelevant: value.documentShowOnlyRelevant !== false,
    documentSourceGroups: DOCUMENT_SOURCE_GROUPS.filter((group) => selectedGroups.has(group)),
    appearanceMode: ['system', 'light', 'dark'].includes(value.appearanceMode) ? value.appearanceMode : 'light',
    glassIntensity: ['clear', 'balanced', 'tinted'].includes(value.glassIntensity) ? value.glassIntensity : 'balanced',
  };
}

function sameWorkspaceSettings(a, b) {
  return sameDraftValue(comparableWorkspaceSettings(a), comparableWorkspaceSettings(b));
}

function SettingsPanel({ title, description, icon: Icon, meta, children }) {
  return (
    <section className="material-panel rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {meta && <div className="shrink-0 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

const STATUS_META = {
  disabled: {
    label: 'Disabled',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: ShieldCheck,
  },
  online: {
    label: 'Online',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  configured: {
    label: 'Configured',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    icon: ShieldCheck,
  },
  warning: {
    label: 'Warning',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    className: 'border-red-300 bg-red-100 text-red-800',
    icon: AlertTriangle,
  },
  unavailable: {
    label: 'Unavailable',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: XCircle,
  },
  monitoring_unavailable: {
    label: 'Monitoring unavailable',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    icon: Clock,
  },
  not_configured: {
    label: 'Not configured',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    icon: Clock,
  },
  error: {
    label: 'Error',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: XCircle,
  },
};

function MailboxVerificationBadge({ mailbox }) {
  if (!mailbox) return <StatusBadge status="not_configured" />;
  if (!mailbox.active) return <StatusBadge status="disabled" />;
  if (mailbox.verificationState === 'verified') return <StatusBadge status="online" />;
  if (mailbox.verificationState === 'failed') return <StatusBadge status="warning" />;
  return <StatusBadge status="configured" />;
}

function formatHealthDate(value) {
  if (!value) return '—';
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.not_configured;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1.5 whitespace-nowrap ${meta.className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function healthLabel(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function healthValue(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(healthValue).join(', ');
  if (typeof value === 'object') return 'Unavailable';
  return String(value);
}

function flattenHealthDetails(value, prefix = '', rows = []) {
  if (value === undefined || value === null || value === '') return rows;
  if (Array.isArray(value)) {
    rows.push([prefix, healthValue(value)]);
    return rows;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, nestedValue]) => {
      flattenHealthDetails(nestedValue, prefix ? `${prefix} ${key}` : key, rows);
    });
    return rows;
  }
  rows.push([prefix, healthValue(value)]);
  return rows;
}

function KeyValueList({ items }) {
  const rows = flattenHealthDetails(items);
  if (!rows.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {rows.map(([key, value]) => (
        <span key={key} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{healthLabel(key)}:</span> {value}
        </span>
      ))}
    </div>
  );
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function healthSnapshot(health) {
  const salesforce = health?.kpis?.salesforce || {};
  const supabase = health?.kpis?.supabase || {};
  const vercel = health?.kpis?.vercel || {};
  return {
    'salesforce.used': finiteNumber(salesforce.used),
    'salesforce.remaining': finiteNumber(salesforce.remaining),
    'salesforce.max': finiteNumber(salesforce.max),
    'salesforce.usedPct': finiteNumber(salesforce.usedPct),
    'salesforce.probeLatencyMs': finiteNumber(salesforce.probeLatencyMs),
    'supabase.databaseConnections': finiteNumber(supabase.databaseConnections),
    'supabase.maxConnections': finiteNumber(supabase.maxConnections),
    'supabase.connectionUtilizationPercent': finiteNumber(supabase.connectionUtilizationPercent),
    'supabase.pgbouncerUp': finiteNumber(supabase.pgbouncerUp),
    'supabase.waitingConnections': finiteNumber(supabase.waitingConnections),
    'supabase.maxWaitSeconds': finiteNumber(supabase.maxWaitSeconds),
    'supabase.memoryUsedPercent': finiteNumber(supabase.memoryUsedPercent),
    'supabase.diskUsedPercent': finiteNumber(supabase.diskUsedPercent),
    'supabase.databaseCacheHitPercent': finiteNumber(supabase.databaseCacheHitPercent),
    'supabase.deadlocksTotal': finiteNumber(supabase.deadlocksTotal),
    'supabase.probeLatencyMs': finiteNumber(supabase.probeLatencyMs),
    'vercel.functionCheckDurationMs': finiteNumber(vercel.functionCheckDurationMs),
  };
}

function readHealthSamples() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(HEALTH_SAMPLES_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((sample) => Number.isFinite(sample?.at) && sample.metrics && typeof sample.metrics === 'object')
      .slice(-MAX_HEALTH_SAMPLES);
  } catch {
    return [];
  }
}

function saveHealthSample(health) {
  const sample = { at: Date.now(), metrics: healthSnapshot(health) };
  const previous = readHealthSamples();
  const latest = previous[previous.length - 1];
  const next = latest && sample.at - latest.at < HEALTH_SAMPLE_INTERVAL_MS - 5_000
    ? [...previous.slice(0, -1), sample]
    : [...previous, sample].slice(-MAX_HEALTH_SAMPLES);
  try {
    window.sessionStorage.setItem(HEALTH_SAMPLES_KEY, JSON.stringify(next));
  } catch {
    // Browser storage is optional for a health screen.
  }
  return next;
}

function formatNumber(value, { suffix = '', maximumFractionDigits = 1 } = {}) {
  const number = finiteNumber(value);
  if (number == null) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(number)}${suffix}`;
}

function metricDirection(samples, metricKey) {
  const values = samples
    .map((sample) => finiteNumber(sample?.metrics?.[metricKey]))
    .filter((value) => value != null);
  if (values.length < 2) return null;
  const difference = values[values.length - 1] - values[values.length - 2];
  if (Math.abs(difference) < 0.001) return 'steady';
  return difference > 0 ? 'up' : 'down';
}

function TrendIndicator({ direction }) {
  if (!direction) return <span className="text-[10px] text-muted-foreground">New</span>;
  if (direction === 'up') return <ArrowUp className="h-3.5 w-3.5 text-amber-700" aria-label="Increasing" />;
  if (direction === 'down') return <ArrowDown className="h-3.5 w-3.5 text-sky-700" aria-label="Decreasing" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="Steady" />;
}

function KpiMetric({ label, value, metricKey, samples, suffix, maximumFractionDigits, status }) {
  const displayValue = value === undefined || value === null || value === ''
    ? '—'
    : typeof value === 'number'
      ? formatNumber(value, { suffix, maximumFractionDigits })
      : String(value);
  const numeric = finiteNumber(value);
  return (
    <div className="min-w-0 border-b border-border px-3 py-2.5 last:border-b-0 sm:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title={label}>{label}</dt>
      <dd className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="truncate" title={displayValue}>{displayValue}</span>
        {numeric != null && <TrendIndicator direction={metricDirection(samples, metricKey)} />}
        {status && <StatusBadge status={status} />}
      </dd>
    </div>
  );
}

function KpiGroup({ title, children }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-background/40">
        {children}
      </dl>
    </section>
  );
}

function HealthOverviewPanel() {
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [samples, setSamples] = useState(readHealthSamples);

  const rows = useMemo(() => health?.rows || [], [health?.rows]);
  const salesforceKpis = health?.kpis?.salesforce || {};
  const supabaseKpis = health?.kpis?.supabase || {};
  const vercelKpis = health?.kpis?.vercel || {};
  const providerLinks = health?.providerLinks || {};

  const summary = useMemo(() => rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { total: 0 }), [rows]);

  const loadHealth = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const res = await appClient.functions.invoke('systemHealth', {}, { cache: false, force });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setHealth(res.data);
      setSamples(saveHealthSample(res.data));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHealth();
    const intervalId = window.setInterval(() => loadHealth(), HEALTH_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadHealth]);

  const healthSummaryItems = [
    ['Total', summary.total, 'border-slate-200 bg-slate-50 text-slate-700'],
    ['Online', summary.online || 0, STATUS_META.online.className],
    ['Warning', summary.warning || 0, STATUS_META.warning.className],
    ['Critical', summary.critical || 0, STATUS_META.critical.className],
    ['Unavailable', summary.unavailable || 0, STATUS_META.unavailable.className],
    ['Monitoring', summary.monitoring_unavailable || 0, STATUS_META.monitoring_unavailable.className],
    ['Error', summary.error || 0, STATUS_META.error.className],
    ['Disabled', summary.disabled || 0, STATUS_META.disabled.className],
    ['Configured', summary.configured || 0, STATUS_META.configured.className],
    ['Not Configured', summary.not_configured || 0, STATUS_META.not_configured.className],
  ];

  const links = [
    ['Supabase Reports', providerLinks.supabaseReports],
    ['Vercel Observability', providerLinks.vercelObservability],
    ['Runtime Cache', providerLinks.vercelRuntimeCache],
    ['Speed Insights', providerLinks.vercelSpeedInsights],
  ].filter(([, href]) => typeof href === 'string' && href.trim());

  return (
    <SettingsPanel
      icon={Activity}
      title="System Health"
      description="Live server status plus exact, non-secret CLI authorization targets and isolation policy."
      meta={health?.generatedAt ? `Last checked ${formatHealthDate(health.generatedAt)}` : null}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {healthSummaryItems.map(([label, value, className]) => (
            <div key={label} className={`rounded-lg border px-3 py-2 ${className}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide">{label}</div>
              <div className="text-lg font-bold">{value}</div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => loadHealth({ force: true })} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh Health
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <StateBlock icon={Loader2} title="Checking system health" description="Testing configured APIs and external services." />
      ) : (
        <>
          <div className="mb-5 border-y border-border py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Operational KPIs</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Arrows compare the latest result with the preceding retained one-minute sample.</p>
              </div>
              {supabaseKpis.monitoringAvailable === false && (
                <StatusBadge status="monitoring_unavailable" />
              )}
            </div>

            <div className="mt-4 grid gap-5 xl:grid-cols-3">
              <KpiGroup title="Salesforce daily API">
                <KpiMetric label="Used" value={salesforceKpis.used} metricKey="salesforce.used" samples={samples} maximumFractionDigits={0} />
                <KpiMetric label="Remaining" value={salesforceKpis.remaining} metricKey="salesforce.remaining" samples={samples} maximumFractionDigits={0} />
                <KpiMetric label="Daily limit" value={salesforceKpis.max} metricKey="salesforce.max" samples={samples} maximumFractionDigits={0} />
                <KpiMetric label="Utilisation" value={salesforceKpis.usedPct} metricKey="salesforce.usedPct" samples={samples} suffix="%" />
                <KpiMetric label="Probe time" value={salesforceKpis.probeLatencyMs} metricKey="salesforce.probeLatencyMs" samples={samples} suffix=" ms" maximumFractionDigits={0} />
              </KpiGroup>

              <KpiGroup title="Supabase database">
                <KpiMetric label="Connections" value={supabaseKpis.databaseConnections} metricKey="supabase.databaseConnections" samples={samples} maximumFractionDigits={0} />
                <KpiMetric label="Connection max" value={supabaseKpis.maxConnections} metricKey="supabase.maxConnections" samples={samples} maximumFractionDigits={0} />
                <KpiMetric label="Connection use" value={supabaseKpis.connectionUtilizationPercent} metricKey="supabase.connectionUtilizationPercent" samples={samples} suffix="%" />
                <KpiMetric label="PgBouncer" value={supabaseKpis.pgbouncerUp == null ? null : supabaseKpis.pgbouncerUp === 1 ? 'Online' : 'Unavailable'} metricKey="supabase.pgbouncerUp" samples={samples} status={supabaseKpis.pgbouncerUp == null ? 'monitoring_unavailable' : supabaseKpis.pgbouncerUp === 1 ? 'online' : 'unavailable'} />
                <KpiMetric label="Waiting" value={supabaseKpis.waitingConnections} metricKey="supabase.waitingConnections" samples={samples} maximumFractionDigits={0} />
                <KpiMetric label="Maximum wait" value={supabaseKpis.maxWaitSeconds} metricKey="supabase.maxWaitSeconds" samples={samples} suffix=" s" maximumFractionDigits={2} />
                <KpiMetric label="Memory used" value={supabaseKpis.memoryUsedPercent} metricKey="supabase.memoryUsedPercent" samples={samples} suffix="%" />
                <KpiMetric label="Disk used" value={supabaseKpis.diskUsedPercent} metricKey="supabase.diskUsedPercent" samples={samples} suffix="%" />
                <KpiMetric label="Cache hit" value={supabaseKpis.databaseCacheHitPercent} metricKey="supabase.databaseCacheHitPercent" samples={samples} suffix="%" />
                <KpiMetric label="Deadlocks" value={supabaseKpis.deadlocksTotal} metricKey="supabase.deadlocksTotal" samples={samples} maximumFractionDigits={0} />
              </KpiGroup>

              <KpiGroup title="Vercel runtime">
                <KpiMetric label="Environment" value={vercelKpis.environment} samples={samples} />
                <KpiMetric label="Region" value={vercelKpis.region} samples={samples} />
                <KpiMetric label="Node" value={vercelKpis.nodeVersion} samples={samples} />
                <KpiMetric label="Function check" value={vercelKpis.functionCheckDurationMs} metricKey="vercel.functionCheckDurationMs" samples={samples} suffix=" ms" maximumFractionDigits={0} />
              </KpiGroup>
            </div>

            {supabaseKpis.monitoringError && (
              <p className="mt-3 text-xs text-muted-foreground">Supabase monitoring detail is unavailable: {supabaseKpis.monitoringError}</p>
            )}

            {links.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {links.map(([label, href]) => (
                  <Button key={label} asChild type="button" variant="outline" size="sm" className="gap-1.5">
                    <a href={href} target="_blank" rel="noreferrer">
                      {label}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="max-h-[62vh] overflow-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Service</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Scope</th>
                    <th className="px-3 py-2 font-semibold">Auth</th>
                    <th className="px-3 py-2 font-semibold">Token Expiry</th>
                    <th className="px-3 py-2 text-right font-semibold">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {rows.map((row) => {
                    const expiry = row.details?.accessTokenExpiresAt || row.tokenExpiry;
                    return (
                      <tr key={row.id} className="align-top hover:bg-muted/40">
                        <td className="max-w-md px-3 py-3">
                          <div className="flex items-start gap-2">
                            <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="font-semibold text-foreground">{row.name}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{row.category} · {row.provider}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{row.purpose}</div>
                              {row.endpoint && <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{row.endpoint}</div>}
                              {row.error && <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{row.error}</div>}
                              {row.missingEnv?.length ? (
                                <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                  Missing: {row.missingEnv.join(', ')}
                                </div>
                              ) : null}
                              <KeyValueList items={row.details} />
                              {row.notes?.length ? (
                                <div className="mt-2 space-y-1">
                                  {row.notes.map((note) => (
                                    <div key={note} className="text-[11px] text-muted-foreground">{note}</div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-3 py-3 text-xs capitalize text-muted-foreground">{row.scope || 'server'}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{row.authType || '—'}</td>
                        <td className="max-w-xs px-3 py-3 text-xs text-muted-foreground">{formatHealthDate(expiry)}</td>
                        <td className="px-3 py-3 text-right text-xs text-muted-foreground">
                          {row.latencyMs != null ? `${row.latencyMs} ms` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </SettingsPanel>
  );
}

function SystemHealthPanel() {
  const [activeView, setActiveView] = useState('overview');
  return (
    <Tabs value={activeView} onValueChange={setActiveView} className="space-y-4">
      <div className="overflow-x-auto pb-1">
        <TabsList aria-label="System Health views" className="w-max">
          <TabsTrigger value="overview">Health Overview</TabsTrigger>
          <TabsTrigger value="connections">Connection Checklist</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview" className="mt-0">
        <HealthOverviewPanel />
      </TabsContent>
      <TabsContent value="connections" className="mt-0">
        <Suspense fallback={<StateBlock icon={Loader2} title="Loading connection checklist" description="Preparing the CLI-first connection runbook." />}>
          <ConnectionChecklist />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}

export default function SettingsPage({ section = 'my', methodologyAction = null }) {
  const { isAdministrator, hasCapability } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [documentSettings, setDocumentSettings] = useState(readDocumentSettings);
  const [baseSettings, setBaseSettings] = useState(settingsSnapshot);
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const [sidebarMode, setSidebarMode] = useState(() => settingsSnapshot().sidebarMode);
  const [tableDensity, setTableDensity] = useState(() => settingsSnapshot().tableDensity);
  const [appearanceMode, setAppearanceMode] = useState(() => settingsSnapshot().appearanceMode);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsSnapshot().glassIntensity);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [workspaceError, setWorkspaceError] = useState('');
  const [aiSettings, setAiSettings] = useState(null);
  const [aiModels, setAiModels] = useState([]);
  const [aiUsage, setAiUsage] = useState(null);
  const [baseAiModelId, setBaseAiModelId] = useState(null);
  const [aiSettingsLoading, setAiSettingsLoading] = useState(true);
  const [aiSettingsError, setAiSettingsError] = useState(null);
  const [emailSenders, setEmailSenders] = useState(null);
  const [emailSendersLoading, setEmailSendersLoading] = useState(true);
  const [emailSendersError, setEmailSendersError] = useState('');
  const [emailSenderBusy, setEmailSenderBusy] = useState(false);
  const [mailboxEditorOpen, setMailboxEditorOpen] = useState(false);
  const [mailboxForm, setMailboxForm] = useState({ mailboxId: null, emailAddress: '', label: '', active: true, expectedRevision: null, reason: '' });
  const [routeDrafts, setRouteDrafts] = useState({});
  const [routeAuditReason, setRouteAuditReason] = useState('');

  useEffect(() => {
    const base = settingsSnapshot();
    const draft = readDraft(SETTINGS_DRAFT_KEY);
    const next = draft?.data && !sameWorkspaceSettings(draft.data, base)
      ? { ...base, ...draft.data }
      : base;
    setSidebarMode(next.sidebarMode || base.sidebarMode);
    setTableDensity(next.tableDensity || base.tableDensity);
    setAppearanceMode(next.appearanceMode || base.appearanceMode);
    setGlassIntensity(next.glassIntensity || base.glassIntensity);
    setDocumentSettings({
      showOnlyRelevant: next.documentShowOnlyRelevant ?? base.documentShowOnlyRelevant,
      relevantSourceGroups: next.documentSourceGroups || base.documentSourceGroups,
    });
    setBaseSettings(base);
    setDraftRestoredAt(draft?.data && !sameWorkspaceSettings(next, base) ? draft.updatedAt : null);

    let cancelled = false;
    const loadWorkspacePreferences = async () => {
      const response = await appClient.functions.invoke('workspacePreferencesGet', {}, { force: true });
      if (cancelled) return;
      if (response.data?.error) {
        setWorkspaceError(response.data.error);
        return;
      }
      const preferences = response.data?.preferences;
      if (!preferences) return;
      const serverSettings = {
        sidebarMode: preferences.sidebarMode,
        tableDensity: preferences.tableDensity,
        documentShowOnlyRelevant: preferences.documentShowOnlyRelevant,
        documentSourceGroups: preferences.documentSourceGroups,
        appearanceMode: preferences.appearanceMode,
        glassIntensity: preferences.glassIntensity,
        revision: preferences.revision,
        initialized: preferences.initialized,
      };
      setSidebarMode(serverSettings.sidebarMode);
      setTableDensity(serverSettings.tableDensity);
      setAppearanceMode(serverSettings.appearanceMode);
      setGlassIntensity(serverSettings.glassIntensity);
      setDocumentSettings({
        showOnlyRelevant: serverSettings.documentShowOnlyRelevant,
        relevantSourceGroups: serverSettings.documentSourceGroups,
      });
      setWorkspaceRevision(serverSettings.revision);
      setBaseSettings(serverSettings);
      clearDraft(SETTINGS_DRAFT_KEY);
      setDraftRestoredAt(null);
      saveDocumentSettings({
        showOnlyRelevant: serverSettings.documentShowOnlyRelevant,
        relevantSourceGroups: serverSettings.documentSourceGroups,
      });
      localStorage.setItem(SIDEBAR_FIXED_STORAGE_KEY, String(serverSettings.sidebarMode === 'fixed'));
      localStorage.setItem('table-density', serverSettings.tableDensity);
      applyAppearancePreferences(serverSettings);
      window.dispatchEvent(new CustomEvent('fcos:workspace-preferences-updated', { detail: serverSettings }));
    };
    loadWorkspacePreferences();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const applyWorkspacePreferences = (event) => {
      const preferences = event.detail;
      if (!preferences?.initialized) return;
      setSidebarMode(preferences.sidebarMode);
      setTableDensity(preferences.tableDensity);
      setAppearanceMode(preferences.appearanceMode);
      setGlassIntensity(preferences.glassIntensity);
      setDocumentSettings({
        showOnlyRelevant: preferences.documentShowOnlyRelevant,
        relevantSourceGroups: preferences.documentSourceGroups,
      });
      setWorkspaceRevision(preferences.revision);
      setBaseSettings({
        sidebarMode: preferences.sidebarMode,
        tableDensity: preferences.tableDensity,
        documentShowOnlyRelevant: preferences.documentShowOnlyRelevant,
        documentSourceGroups: preferences.documentSourceGroups,
        appearanceMode: preferences.appearanceMode,
        glassIntensity: preferences.glassIntensity,
        revision: preferences.revision,
        initialized: true,
      });
      setWorkspaceError('');
    };
    window.addEventListener('fcos:workspace-preferences-updated', applyWorkspacePreferences);
    return () => window.removeEventListener('fcos:workspace-preferences-updated', applyWorkspacePreferences);
  }, []);

  useEffect(() => {
    applyAppearancePreferences({ appearanceMode, glassIntensity });
  }, [appearanceMode, glassIntensity]);

  const loadAiSettings = useCallback(async () => {
    setAiSettingsLoading(true);
    setAiSettingsError(null);
    const response = await appClient.functions.invoke('dashboardAiSettingsGet', {}, { force: true });
    if (response.data?.error) {
      setAiSettingsError(response.data.error);
    } else {
      setAiSettings(response.data.settings || null);
      setAiModels(response.data.models || []);
      setAiUsage(response.data.usage || null);
      setBaseAiModelId(response.data.settings?.modelId || null);
    }
    setAiSettingsLoading(false);
  }, []);

  useEffect(() => {
    if (section === 'ai' && isAdministrator) loadAiSettings();
  }, [isAdministrator, loadAiSettings, section]);

  const loadEmailSenders = useCallback(async () => {
    setEmailSendersLoading(true);
    setEmailSendersError('');
    const response = await appClient.functions.invoke('emailSenderStatus', {}, { cache: false });
    if (response.data?.error) {
      setEmailSenders(null);
      setEmailSendersError(response.data.error);
    } else {
      setEmailSenders(response.data || null);
      setRouteDrafts(Object.fromEntries((response.data?.purposes || []).map((purpose) => [purpose.key, {
        mailboxId: purpose.mailbox?.id || '',
        expectedRevision: purpose.revision,
      }])));
      setRouteAuditReason('');
    }
    setEmailSendersLoading(false);
  }, []);

  useEffect(() => {
    if (section === 'email-delivery' && isAdministrator) loadEmailSenders();
  }, [isAdministrator, loadEmailSenders, section]);

  const openMailboxEditor = (mailbox = null) => {
    setMailboxForm({
      mailboxId: mailbox?.id || null,
      emailAddress: mailbox?.emailAddress || '',
      label: mailbox?.label || '',
      active: mailbox?.active !== false,
      expectedRevision: mailbox?.revision ?? null,
      reason: '',
    });
    setMailboxEditorOpen(true);
  };

  const saveMailbox = async () => {
    setEmailSenderBusy(true);
    setEmailSendersError('');
    const response = await appClient.functions.invoke('emailSenderMailboxSave', mailboxForm);
    if (response.data?.error) {
      setEmailSendersError(response.data.error);
    } else {
      setEmailSenders(response.data.registry);
      setMailboxEditorOpen(false);
      await loadEmailSenders();
    }
    setEmailSenderBusy(false);
  };

  const dirtySenderRoutes = useMemo(() => (emailSenders?.purposes || []).filter((purpose) => (
    String(routeDrafts[purpose.key]?.mailboxId || '') !== String(purpose.mailbox?.id || '')
  )), [emailSenders, routeDrafts]);

  const saveSenderRoutes = async () => {
    if (!dirtySenderRoutes.length) return;
    setEmailSenderBusy(true);
    setEmailSendersError('');
    const response = await appClient.functions.invoke('emailSenderRouteSave', {
      changes: dirtySenderRoutes.map((purpose) => ({
        purposeKey: purpose.key,
        mailboxId: routeDrafts[purpose.key]?.mailboxId || null,
        expectedRevision: routeDrafts[purpose.key]?.expectedRevision,
      })),
      reason: routeAuditReason,
    });
    if (response.data?.error) setEmailSendersError(response.data.error);
    else await loadEmailSenders();
    setEmailSenderBusy(false);
  };

  const settingsDraftValue = useMemo(() => ({
    sidebarMode,
    tableDensity,
    documentShowOnlyRelevant: documentSettings.showOnlyRelevant,
    documentSourceGroups: documentSettings.relevantSourceGroups,
    appearanceMode,
    glassIntensity,
    revision: workspaceRevision,
    initialized: true,
  }), [appearanceMode, documentSettings, glassIntensity, sidebarMode, tableDensity, workspaceRevision]);
  const settingsDirty = Boolean(baseSettings && !sameWorkspaceSettings(settingsDraftValue, baseSettings));
  useDraftAutosave(SETTINGS_DRAFT_KEY, settingsDraftValue, {
    enabled: true,
    dirty: settingsDirty,
    message: 'Autosaved Settings draft. Save or discard it before leaving.',
  });

  const savePersonalSettings = async () => {
    setSaving(true);
    setWorkspaceError('');
    try {
      const response = await appClient.functions.invoke('workspacePreferencesSave', {
        sidebarMode,
        tableDensity,
        documentShowOnlyRelevant: documentSettings.showOnlyRelevant,
        documentSourceGroups: documentSettings.relevantSourceGroups,
        appearanceMode,
        glassIntensity,
        expectedRevision: workspaceRevision,
      });
      if (response.data?.error) throw new Error(response.data.error);
      const preferences = response.data.preferences;
      const savedValue = { ...settingsDraftValue, revision: preferences.revision, initialized: true };
      setWorkspaceRevision(preferences.revision);
      setBaseSettings(savedValue);
      saveDocumentSettings(documentSettings);
      localStorage.setItem(SIDEBAR_FIXED_STORAGE_KEY, String(sidebarMode === 'fixed'));
      localStorage.setItem('table-density', tableDensity);
      applyAppearancePreferences({ appearanceMode, glassIntensity });
      window.dispatchEvent(new CustomEvent('fcos:workspace-preferences-updated', { detail: savedValue }));
      clearDraft(SETTINGS_DRAFT_KEY);
      setDraftRestoredAt(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (saveError) {
      setWorkspaceError(saveError.message || 'Personal settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveDashboardAiSettings = async () => {
    if (!aiSettings?.modelId || aiSettings.modelId === baseAiModelId) return;
    setSaving(true);
    setAiSettingsError(null);
    const response = await appClient.functions.invoke('dashboardAiSettingsSave', {
      modelId: aiSettings.modelId,
      expectedRevision: aiSettings.revision,
    });
    if (response.data?.error) {
      setAiSettingsError(response.data.error);
    } else {
      setAiSettings(response.data.settings);
      setAiModels(response.data.models || aiModels);
      setAiUsage(response.data.usage || aiUsage);
      setBaseAiModelId(response.data.settings?.modelId || aiSettings.modelId);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  const discardSettingsDraft = () => {
    clearDraft(SETTINGS_DRAFT_KEY);
    if (baseSettings) {
      setSidebarMode(baseSettings.sidebarMode);
      setTableDensity(baseSettings.tableDensity);
      setAppearanceMode(baseSettings.appearanceMode);
      setGlassIntensity(baseSettings.glassIntensity);
      setDocumentSettings({
        showOnlyRelevant: baseSettings.documentShowOnlyRelevant,
        relevantSourceGroups: baseSettings.documentSourceGroups,
      });
    }
    setDraftRestoredAt(null);
  };

  const toggleDocumentSourceGroup = (group) => {
    setDocumentSettings((prev) => {
      const current = new Set(prev.relevantSourceGroups || []);
      if (current.has(group)) current.delete(group);
      else current.add(group);
      return { ...prev, relevantSourceGroups: [...current] };
    });
  };

  const activeTab = {
    my: 'documents',
    'email-delivery': 'email',
    ai: 'ai',
    health: 'health',
  }[section] || 'documents';
  const dashboardUsageByModel = useMemo(() => Object.fromEntries(aiModels.map((model) => {
    const usage = aiUsage?.models?.find((item) => item.modelId === model.id) || {};
    return [model.id, {
      requests: usage.allTimeCalls,
      inputTokens: usage.allTimeInputTokens,
      cachedInputTokens: usage.allTimeCachedInputTokens,
      outputTokens: usage.allTimeOutputTokens,
      estimatedCostUsd: usage.allTimeCostUsd,
      periodCostUsd: usage.monthCostUsd,
      lastUsedAt: usage.lastUsedAt,
    }];
  })), [aiModels, aiUsage]);
  const pageMeta = {
    my: {
      eyebrow: 'Personal',
      title: 'My Settings',
      description: 'Keep your FCOS workspace consistent across browsers and devices.',
    },
    'email-delivery': {
      eyebrow: 'Administration',
      title: 'Email Delivery',
      description: 'Manage approved Microsoft Graph mailboxes and their FCOS email-purpose assignments.',
    },
    ai: {
      eyebrow: 'Administration',
      title: 'AI Models',
      description: 'Manage authorized AI models and review usage and estimated cost by FCOS purpose.',
    },
    health: {
      eyebrow: 'Operations',
      title: 'System Health',
      description: 'Review current service status, workload indicators, and provider connections.',
    },
  }[section];

  return (
    <div className="workspace-administration-canvas mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        icon={Settings}
        eyebrow={pageMeta.eyebrow}
        title={pageMeta.title}
        description={pageMeta.description}
        actions={(
          <>
            {methodologyAction}
            {section === 'my' && settingsDirty && (
              <Button onClick={savePersonalSettings} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
                {saved ? 'Saved' : 'Save My Settings'}
              </Button>
            )}
          </>
        )}
      />

      {section === 'my' && <DraftNotice restoredAt={draftRestoredAt} label="My Settings draft restored" onDiscard={discardSettingsDraft} className="mb-6" />}

      {workspaceError && section === 'my' && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{workspaceError}</span>
        </div>
      )}

      <Tabs value={activeTab} className="space-y-4">

        <TabsContent value="email" className="mt-0">
          <SettingsPanel
            icon={Mail}
            title="Microsoft Graph Email Senders"
            description="Assign an approved Microsoft 365 mailbox to each FCOS email purpose. Microsoft 365 controls the visible sender identity."
            meta={emailSendersLoading ? 'Loading sender configuration' : null}
          >
            {emailSendersError && (
              <div className="mb-4 flex items-start gap-2 border-y border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>{emailSendersError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={loadEmailSenders} className="mt-2 gap-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              </div>
            )}
            {emailSendersLoading && !emailSenders ? (
              <StateBlock
                icon={Loader2}
                title="Loading Graph sender routes"
                description="Reading protected mailbox assignments and delivery status."
              />
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-2.5">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Microsoft Graph · Vercel OIDC</span>
                    {' · '}{emailSenders?.deliveryGateEnabled ? 'Delivery enabled' : 'Delivery disabled'}
                    {' · '}{emailSenders?.applicationConfigured ? 'Application configured' : 'Application not configured'}
                  </div>
                  {isAdministrator && (
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="icon" onClick={loadEmailSenders} disabled={emailSenderBusy || emailSendersLoading} title="Refresh Email Delivery" aria-label="Refresh Email Delivery">
                        <RefreshCw className={`h-4 w-4 ${emailSendersLoading ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button type="button" size="sm" onClick={() => openMailboxEditor()} disabled={emailSenderBusy}>
                        <Plus className="h-4 w-4" />
                        Add mailbox
                      </Button>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">Approved mailboxes</h3>
                  <div className="mt-2 overflow-x-auto border-y border-border">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Mailbox</th>
                          <th className="px-3 py-2 font-semibold">Microsoft 365 address</th>
                          <th className="px-3 py-2 font-semibold">Verification</th>
                          <th className="px-3 py-2 font-semibold">Last successful delivery</th>
                          <th className="px-3 py-2 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(emailSenders?.mailboxes || []).map((mailbox) => (
                          <tr key={mailbox.id}>
                            <td className="px-3 py-3 font-medium text-foreground">{mailbox.label}</td>
                            <td className="px-3 py-3 text-foreground">{mailbox.emailAddress}</td>
                            <td className="px-3 py-3"><MailboxVerificationBadge mailbox={mailbox} /></td>
                            <td className="px-3 py-3 text-muted-foreground">{formatHealthDate(mailbox.lastSuccessAt)}</td>
                            <td className="px-3 py-3 text-right">
                              {isAdministrator && (
                                <Button type="button" variant="ghost" size="icon" onClick={() => openMailboxEditor(mailbox)} title={`Edit ${mailbox.label}`} aria-label={`Edit ${mailbox.label}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!emailSenders?.mailboxes?.length && (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No Microsoft Graph mailbox has been registered.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Purpose assignments</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Change any number of routes, then save the complete set once.</p>
                    </div>
                    {dirtySenderRoutes.length > 0 && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{dirtySenderRoutes.length} unsaved</Badge>}
                  </div>
                  <div className="mt-2 overflow-x-auto border-y border-border">
                    <table className="w-full min-w-[820px] text-left text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Email purpose</th>
                          <th className="w-[330px] px-3 py-2 font-semibold">Assigned Microsoft 365 mailbox</th>
                          <th className="px-3 py-2 font-semibold">State</th>
                          <th className="px-3 py-2 font-semibold">Last changed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                    {(emailSenders?.purposes || []).map((purpose) => {
                      const draft = routeDrafts[purpose.key] || {};
                      const dirty = String(draft.mailboxId || '') !== String(purpose.mailbox?.id || '');
                      return (
                        <tr key={purpose.key} className={dirty ? 'bg-amber-50/50' : 'bg-background'}>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{purpose.label}</span>
                              {dirty && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Changed</Badge>}
                            </div>
                            <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-muted-foreground">{purpose.description}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <Select
                              value={draft.mailboxId || '__none__'}
                              onValueChange={(mailboxId) => setRouteDrafts((current) => ({ ...current, [purpose.key]: { ...draft, mailboxId: mailboxId === '__none__' ? '' : mailboxId } }))}
                              disabled={!isAdministrator || emailSenderBusy}
                            >
                              <SelectTrigger><SelectValue placeholder="Not assigned" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Not assigned</SelectItem>
                                {(emailSenders?.mailboxes || []).filter((mailbox) => mailbox.active).map((mailbox) => (
                                  <SelectItem key={mailbox.id} value={mailbox.id}>{mailbox.label} · {mailbox.emailAddress}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2.5"><MailboxVerificationBadge mailbox={draft.mailboxId ? (emailSenders?.mailboxes || []).find((mailbox) => mailbox.id === draft.mailboxId) : null} /></td>
                          <td className="px-3 py-2.5 text-muted-foreground">{formatHealthDate(purpose.updatedAt)}</td>
                        </tr>
                      );
                    })}
                      </tbody>
                    </table>
                  </div>
                  {isAdministrator && dirtySenderRoutes.length > 0 && (
                    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 lg:flex-row lg:items-end">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor="sender-route-audit-reason" className="text-xs">Audit reason for all {dirtySenderRoutes.length} change{dirtySenderRoutes.length === 1 ? '' : 's'}</Label>
                        <Input
                          id="sender-route-audit-reason"
                          value={routeAuditReason}
                          onChange={(event) => setRouteAuditReason(event.target.value)}
                          placeholder="Why are these sender assignments changing?"
                          maxLength={255}
                          disabled={emailSenderBusy}
                        />
                      </div>
                      <Button type="button" onClick={saveSenderRoutes} disabled={routeAuditReason.trim().length < 8 || emailSenderBusy} className="gap-2">
                        {emailSenderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Save {dirtySenderRoutes.length} assignment{dirtySenderRoutes.length === 1 ? '' : 's'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="mt-4 flex items-start gap-3 text-xs leading-5 text-muted-foreground">
              <Server className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>Microsoft application configuration remains protected in Vercel. Mailbox addresses and purpose assignments contain no credentials and are stored server-side in Supabase.</p>
                <p className="mt-1">Every message uses its assigned Microsoft 365 mailbox through Microsoft Graph. Failed or uncertain deliveries remain reserved for controlled review.</p>
              </div>
            </div>
          </SettingsPanel>

          <Dialog open={mailboxEditorOpen} onOpenChange={setMailboxEditorOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{mailboxForm.mailboxId ? 'Edit Microsoft 365 mailbox' : 'Add Microsoft 365 mailbox'}</DialogTitle>
                <DialogDescription>The mailbox must already be included in the Exchange Application RBAC scope for FCOS.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Mailbox label</Label>
                  <Input value={mailboxForm.label} onChange={(event) => setMailboxForm((current) => ({ ...current, label: event.target.value }))} maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label>Microsoft 365 email address</Label>
                  <Input type="email" value={mailboxForm.emailAddress} onChange={(event) => setMailboxForm((current) => ({ ...current, emailAddress: event.target.value }))} />
                </div>
                {mailboxForm.mailboxId && (
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select value={mailboxForm.active ? 'active' : 'disabled'} onValueChange={(value) => setMailboxForm((current) => ({ ...current, active: value === 'active' }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Audit reason</Label>
                  <Input value={mailboxForm.reason} onChange={(event) => setMailboxForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason for this mailbox change" maxLength={255} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMailboxEditorOpen(false)} disabled={emailSenderBusy}>Cancel</Button>
                <Button type="button" onClick={saveMailbox} disabled={emailSenderBusy || !mailboxForm.label.trim() || !mailboxForm.emailAddress.trim() || mailboxForm.reason.trim().length < 8}>
                  {emailSenderBusy ? 'Saving…' : 'Save mailbox'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="documents" className="mt-0">
          <div className="space-y-5">
            <SettingsPanel
              icon={Settings}
              title="Workspace"
              description="Choose how FCOS looks and behaves for your account across browsers and devices."
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appearance</Label>
                  <Select value={appearanceMode} onValueChange={setAppearanceMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Follow system</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">Light is the company default. You can still follow the system or choose Dark for your account.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Glass intensity</Label>
                  <Select value={glassIntensity} onValueChange={setGlassIntensity}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clear">Clear</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="tinted">Tinted</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">Controls navigation and transient surfaces only; financial content stays opaque.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sidebar behavior</Label>
                  <Select value={sidebarMode} onValueChange={setSidebarMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Icon only</SelectItem>
                      <SelectItem value="auto_hide">Icon and caption</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Icon and caption expands the complete dock while the pointer is anywhere over the sidebar, then magnifies the active row.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Table density</Label>
                  <Select value={tableDensity} onValueChange={setTableDensity}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compact">Compact</SelectItem>
                      <SelectItem value="comfort">Comfort</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.dispatchEvent(new CustomEvent('fcos:navigation-customize'))}
                >
                  <Palette className="h-4 w-4" />
                  Customize sidebar order and visibility
                </Button>
              </div>
            </SettingsPanel>

            <SettingsPanel
              icon={FileText}
              title="STEM Documents"
              description="Choose which discovered Salesforce document sources are relevant for Stem Detail and dispute document browsing."
            >
            <label className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={documentSettings.showOnlyRelevant}
                onChange={(event) => setDocumentSettings((prev) => ({ ...prev, showOnlyRelevant: event.target.checked }))}
              />
              Show only relevant document sources by default
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              {DOCUMENT_SOURCE_GROUPS.map((group) => {
                const checked = documentSettings.relevantSourceGroups?.includes(group);
                return (
                  <label key={group} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{group}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDocumentSourceGroup(group)}
                    />
                  </label>
                );
              })}
            </div>
            </SettingsPanel>
          </div>
        </TabsContent>

        <TabsContent value="ai" className="mt-0">
          <div className="space-y-5">
          {isAdministrator && (
            <AiModelSettingsCard
              title="Dashboard AI Search"
              description="Select the model that converts natural-language Dashboard requests into a validated FCOS search plan. Salesforce records are never sent to the model."
              icon={Sparkles}
              modelLabel="Interpretation model"
              models={aiModels}
              selectedModelId={aiSettings?.modelId || ''}
              savedModelId={baseAiModelId || ''}
              usageByModel={dashboardUsageByModel}
              periodLabel={aiUsage?.monthLabel || 'Current month'}
              loading={aiSettingsLoading}
              saving={saving}
              error={aiSettingsError || (aiUsage && !aiUsage.available ? 'Usage tracking is unavailable. Model selection remains available.' : '')}
              message={saved ? 'Dashboard AI model saved.' : ''}
              canManage={isAdministrator}
              apiConfigured={aiSettings?.apiConfigured === true}
              storageAvailable={aiSettings?.storageAvailable !== false}
              onModelChange={(modelId) => setAiSettings((current) => ({ ...current, modelId }))}
              onSave={saveDashboardAiSettings}
              onRefresh={loadAiSettings}
              updatedAt={aiSettings?.updatedAt}
              privacyNote="Only the user’s search sentence is sent. FCOS validates the structured result and builds Salesforce filters server-side."
            />
          )}
          {hasCapability('hedge_admin') && <HedgeAssistantAiSettings />}
          {isAdministrator && <EmailRouterAdvisorAiSettings />}
          </div>
        </TabsContent>

        <TabsContent value="health" className="mt-0">
          <SystemHealthPanel />
        </TabsContent>

      </Tabs>
    </div>
  );
}
