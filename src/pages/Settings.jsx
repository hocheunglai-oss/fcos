import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  ChartNoAxesCombined,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MailSearch,
  Minus,
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
import { RATE_PROVIDER_OPTIONS, readExchangeRateSettings, saveExchangeRateSettings } from '@/lib/exchangeRateSettings';
import { DOCUMENT_SOURCE_GROUPS, readDocumentSettings, saveDocumentSettings } from '@/lib/documentSettings';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';
import { useAuth } from '@/lib/AuthContext';
import { useSearchParams } from 'react-router-dom';
import HedgeSettingsPanel from '@/hedge/components/HedgeSettingsPanel';
import HedgeAssistantAiSettings from '@/hedge/components/HedgeAssistantAiSettings';
import EmailRouterSettings from '@/components/email-router/EmailRouterSettings';
import EmailRouterAdvisorAiSettings from '@/components/email-router/EmailRouterAdvisorAiSettings';

const SETTINGS_DRAFT_KEY = 'settings:page';
const SETTINGS_TAB_KEY = 'settings:active-tab';
const HEALTH_SAMPLES_KEY = 'fcos:system-health-samples';
const HEALTH_SAMPLE_INTERVAL_MS = 60_000;
const MAX_HEALTH_SAMPLES = 5;

const SETTINGS_TABS = [
  { id: 'email', label: 'Email Senders', icon: Mail },
  { id: 'email-router', label: 'Email Router', icon: MailSearch },
  { id: 'exchange', label: 'Exchange Rate', icon: CircleDollarSign },
  { id: 'documents', label: 'STEM Documents', icon: FileText },
  { id: 'ai', label: 'AI Models', icon: Sparkles },
  { id: 'hedge-desk', label: 'Hedge Desk', icon: ChartNoAxesCombined },
  { id: 'health', label: 'System Health', icon: Activity },
];

function validSettingsTab(value) {
  return SETTINGS_TABS.some((tab) => tab.id === value) ? value : 'email';
}

function settingsSnapshot() {
  return {
    exchangeRateSettings: readExchangeRateSettings(),
    documentSettings: readDocumentSettings(),
  };
}

function SettingsPanel({ title, description, icon: Icon, meta, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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

function formatAiUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.01) {
    return `$${amount.toLocaleString('en-US', {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    })}`;
  }
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatAiRate(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

function formatAiCalls(value) {
  const calls = Number(value);
  return `${Number.isFinite(calls) ? calls.toLocaleString('en-US') : '0'} interpretation${calls === 1 ? '' : 's'}`;
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

function SystemHealthPanel() {
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
      description="Live status of server-side APIs, Microsoft Graph mailbox routes, external tools, and token expiry notes."
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

          <div className="overflow-hidden rounded-xl border border-border">
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

export default function SettingsPage({ methodologyAction = null }) {
  const { isAdministrator } = useAuth();
  const [searchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exchangeRateSettings, setExchangeRateSettings] = useState(readExchangeRateSettings);
  const [documentSettings, setDocumentSettings] = useState(readDocumentSettings);
  const [baseSettings, setBaseSettings] = useState(settingsSnapshot);
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const [activeTab, setActiveTab] = useState(() => validSettingsTab(searchParams.get('panel') || localStorage.getItem(SETTINGS_TAB_KEY)));
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

  useEffect(() => {
    const base = settingsSnapshot();
    const draft = readDraft(SETTINGS_DRAFT_KEY);
    const next = draft?.data && !sameDraftValue(draft.data, base)
      ? { ...base, ...draft.data }
      : base;
    setExchangeRateSettings(next.exchangeRateSettings || base.exchangeRateSettings);
    setDocumentSettings(next.documentSettings || base.documentSettings);
    setBaseSettings(base);
    setDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
  }, []);

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
    loadAiSettings();
  }, [loadAiSettings]);

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
        reason: '',
        expectedRevision: purpose.revision,
      }])));
    }
    setEmailSendersLoading(false);
  }, []);

  useEffect(() => {
    loadEmailSenders();
  }, [loadEmailSenders]);

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

  const saveSenderRoute = async (purpose) => {
    const draft = routeDrafts[purpose.key];
    setEmailSenderBusy(true);
    setEmailSendersError('');
    const response = await appClient.functions.invoke('emailSenderRouteSave', {
      purposeKey: purpose.key,
      mailboxId: draft?.mailboxId || null,
      reason: draft?.reason || '',
      expectedRevision: draft?.expectedRevision,
    });
    if (response.data?.error) setEmailSendersError(response.data.error);
    else await loadEmailSenders();
    setEmailSenderBusy(false);
  };

  const settingsDraftValue = useMemo(() => ({
    exchangeRateSettings,
    documentSettings,
  }), [documentSettings, exchangeRateSettings]);
  const settingsDirty = Boolean(baseSettings && !sameDraftValue(settingsDraftValue, baseSettings));
  useDraftAutosave(SETTINGS_DRAFT_KEY, settingsDraftValue, {
    enabled: true,
    dirty: settingsDirty,
    message: 'Autosaved Settings draft. Save or discard it before leaving.',
  });

  const changeTab = (tab) => {
    const next = validSettingsTab(tab);
    setActiveTab(next);
    localStorage.setItem(SETTINGS_TAB_KEY, next);
  };

  const saveAll = async () => {
    setSaving(true);
    setAiSettingsError(null);
    try {
      if (aiSettings?.modelId && aiSettings.modelId !== baseAiModelId) {
        if (!isAdministrator) throw new Error('Only Administrators can change the Dashboard AI model.');
        const response = await appClient.functions.invoke('dashboardAiSettingsSave', {
          modelId: aiSettings.modelId,
          expectedRevision: aiSettings.revision,
        });
        if (response.data?.error) throw new Error(response.data.error);
        setAiSettings(response.data.settings);
        setAiModels(response.data.models || aiModels);
        setAiUsage(response.data.usage || aiUsage);
        setBaseAiModelId(response.data.settings?.modelId || aiSettings.modelId);
      }
      saveExchangeRateSettings(exchangeRateSettings);
      saveDocumentSettings(documentSettings);
      const savedValue = {
        exchangeRateSettings,
        documentSettings,
      };
      setBaseSettings(savedValue);
      clearDraft(SETTINGS_DRAFT_KEY);
      setDraftRestoredAt(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (saveError) {
      setAiSettingsError(saveError.message || 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const discardSettingsDraft = () => {
    clearDraft(SETTINGS_DRAFT_KEY);
    if (baseSettings) {
      setExchangeRateSettings(baseSettings.exchangeRateSettings || readExchangeRateSettings());
      setDocumentSettings(baseSettings.documentSettings || readDocumentSettings());
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

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <PageHeader
        icon={Settings}
        eyebrow="Admin"
        title="Settings"
        description="Configure email senders, exchange rates, STEM documents, AI, Hedge Desk, and service health."
        actions={(
          <>
            {methodologyAction}
            <Button onClick={saveAll} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
              {saved ? 'Saved!' : 'Save All Settings'}
            </Button>
          </>
        )}
      />

      <DraftNotice restoredAt={draftRestoredAt} label="Settings draft restored" onDiscard={discardSettingsDraft} className="mb-6" />

      {aiSettingsError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{aiSettingsError}</span>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
        <div className="rounded-2xl border border-border bg-card/70 p-2">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-9 gap-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

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
                <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Microsoft Graph · Vercel OIDC</span>
                    {' · '}{emailSenders?.deliveryGateEnabled ? 'Delivery enabled' : 'Delivery disabled'}
                    {' · '}{emailSenders?.applicationConfigured ? 'Application configured' : 'Application not configured'}
                  </div>
                  {isAdministrator && (
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => openMailboxEditor()} disabled={emailSenderBusy}>
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
                              {isAdministrator && <Button type="button" variant="ghost" size="sm" onClick={() => openMailboxEditor(mailbox)}>Edit</Button>}
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
                  <h3 className="text-sm font-semibold text-foreground">Purpose assignments</h3>
                  <div className="mt-2 divide-y divide-border border-y border-border">
                    {(emailSenders?.purposes || []).map((purpose) => {
                      const draft = routeDrafts[purpose.key] || {};
                      const dirty = String(draft.mailboxId || '') !== String(purpose.mailbox?.id || '');
                      return (
                        <div key={purpose.key} className="grid gap-3 py-3 lg:grid-cols-[minmax(220px,1fr)_minmax(240px,0.8fr)_minmax(240px,0.8fr)_auto] lg:items-end">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{purpose.label}</span>
                              <MailboxVerificationBadge mailbox={purpose.mailbox} />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{purpose.description}</p>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Assigned mailbox</Label>
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
                          </div>
                          {isAdministrator && (
                            <div className="space-y-1.5">
                              <Label className="text-xs">Audit reason</Label>
                              <Input
                                value={draft.reason || ''}
                                onChange={(event) => setRouteDrafts((current) => ({ ...current, [purpose.key]: { ...draft, reason: event.target.value } }))}
                                placeholder="Why is this sender changing?"
                                maxLength={255}
                                disabled={!dirty || emailSenderBusy}
                              />
                            </div>
                          )}
                          {isAdministrator && (
                            <Button type="button" size="sm" onClick={() => saveSenderRoute(purpose)} disabled={!dirty || (draft.reason || '').trim().length < 8 || emailSenderBusy}>
                              Save route
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
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

        <TabsContent value="exchange" className="mt-0">
          <SettingsPanel
            icon={CircleDollarSign}
            title="Exchange Rate API"
            description="Used by Broker's Commission to convert USD payable and receivable summaries into CNY."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">USD/CNY Mid-Rate Source</Label>
                <Select
                  value={exchangeRateSettings.provider}
                  onValueChange={(provider) => setExchangeRateSettings((prev) => ({ ...prev, provider }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RATE_PROVIDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
                <div><span className="font-semibold text-foreground">Source:</span> Frankfurter API</div>
                <div><span className="font-semibold text-foreground">Rate treatment:</span> API rate is mid-rate</div>
                <div><span className="font-semibold text-foreground">Bank buy rate:</span> mid-rate less 0.2%</div>
                <div><span className="font-semibold text-foreground">Date rule:</span> latest available rate on or before quarter end</div>
                <div><span className="font-semibold text-foreground">Auth:</span> no API key</div>
              </div>
            </div>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="email-router" className="mt-0">
          <EmailRouterSettings />
        </TabsContent>

        <TabsContent value="documents" className="mt-0">
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
        </TabsContent>

        <TabsContent value="ai" className="mt-0">
          <div className="space-y-5">
          <SettingsPanel
            icon={Sparkles}
            title="Dashboard AI Search"
            description="Choose the model that interprets natural-language Dashboard searches. Salesforce records are never sent to the model."
            meta={aiSettings?.updatedAt ? `Updated ${formatHealthDate(aiSettings.updatedAt)}` : null}
          >
            {aiSettingsLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading AI settings…
              </div>
            ) : aiSettings ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interpretation Model</Label>
                    <Select
                      value={aiSettings.modelId}
                      onValueChange={(modelId) => setAiSettings((current) => ({ ...current, modelId }))}
                      disabled={!isAdministrator || !aiSettings.storageAvailable}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {aiModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label}{model.recommended ? ' · Recommended' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {aiModels.find((model) => model.id === aiSettings.modelId)?.description || aiSettings.model?.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-background/50 p-3">
                      <p className="text-[11px] font-semibold uppercase text-muted-foreground">OpenAI API</p>
                      <div className="mt-2">
                        <StatusBadge status={aiSettings.apiConfigured ? 'configured' : 'not_configured'} />
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background/50 p-3">
                      <p className="text-[11px] font-semibold uppercase text-muted-foreground">Global Setting</p>
                      <div className="mt-2">
                        <StatusBadge status={aiSettings.storageAvailable ? 'configured' : 'unavailable'} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Model pricing and API usage</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Estimated USD cost from OpenAI-reported tokens for uncached interpretation requests completed by OpenAI.
                      </p>
                    </div>
                    <a
                      href={aiModels.find((model) => model.pricing?.sourceUrl)?.pricing?.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      OpenAI pricing
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  {aiUsage && !aiUsage.available && (
                    <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Usage tracking is unavailable. Model rates remain visible, but spend totals cannot be confirmed.
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[860px] text-left text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold">Interpretation model</th>
                          <th className="px-3 py-2.5 font-semibold">Standard USD per 1M tokens</th>
                          <th className="px-3 py-2.5 font-semibold">{aiUsage?.monthLabel || 'Current month'}</th>
                          <th className="px-3 py-2.5 font-semibold">All tracked usage</th>
                          <th className="px-3 py-2.5 font-semibold">Last used</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {aiModels.map((model) => {
                          const usage = aiUsage?.models?.find((item) => item.modelId === model.id);
                          const selected = model.id === aiSettings.modelId;
                          return (
                            <tr key={model.id} className={selected ? 'bg-primary/5' : 'bg-background'}>
                              <td className="px-3 py-3 align-top">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-foreground">{model.label}</span>
                                  {selected && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Selected</Badge>}
                                </div>
                                <p className="mt-1 text-[11px] text-muted-foreground">{model.costTier} cost</p>
                              </td>
                              <td className="px-3 py-3 align-top text-muted-foreground">
                                <div><span className="font-medium text-foreground">Input</span> {formatAiRate(model.pricing?.inputPerMillion)}</div>
                                <div><span className="font-medium text-foreground">Cached</span> {formatAiRate(model.pricing?.cachedInputPerMillion)}</div>
                                {model.pricing?.cacheWritePerMillion !== null && model.pricing?.cacheWritePerMillion !== undefined && (
                                  <div><span className="font-medium text-foreground">Cache write</span> {formatAiRate(model.pricing.cacheWritePerMillion)}</div>
                                )}
                                <div><span className="font-medium text-foreground">Output</span> {formatAiRate(model.pricing?.outputPerMillion)}</div>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <div className="font-semibold tabular-nums text-foreground">{formatAiUsd(usage?.monthCostUsd)}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">{formatAiCalls(usage?.monthCalls)}</div>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <div className="font-semibold tabular-nums text-foreground">{formatAiUsd(usage?.allTimeCostUsd)}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">{formatAiCalls(usage?.allTimeCalls)}</div>
                              </td>
                              <td className="px-3 py-3 align-top text-muted-foreground">
                                {usage?.lastUsedAt ? formatHealthDate(usage.lastUsedAt) : 'Not used'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                    Estimates use standard short-context pricing as of {aiModels.find((model) => model.pricing?.asOf)?.pricing?.asOf || 'the displayed pricing date'}.
                    Tracking starts with this release and is not retroactive. FCOS interpretation cache hits make no OpenAI API call and add $0. OpenAI billing remains authoritative.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <p><span className="font-semibold text-foreground">Privacy:</span> only the user’s search sentence is sent for interpretation.</p>
                  <p className="mt-1"><span className="font-semibold text-foreground">Enforcement:</span> FCOS validates the structured interpretation and builds Salesforce filters server-side.</p>
                  {aiSettings.updatedByEmail && (
                    <p className="mt-1"><span className="font-semibold text-foreground">Last changed by:</span> {aiSettings.updatedByEmail}</p>
                  )}
                </div>

                {!isAdministrator && (
                  <p className="text-xs text-muted-foreground">Only Administrators can change this global setting.</p>
                )}
                {!aiSettings.storageAvailable && (
                  <p className="text-xs text-destructive">Apply the Dashboard AI settings database migration before changing the model.</p>
                )}
              </div>
            ) : (
              <StateBlock
                icon={AlertTriangle}
                title="AI settings unavailable"
                description="The global Dashboard AI setting could not be loaded."
                action={<Button variant="outline" size="sm" onClick={loadAiSettings}>Retry</Button>}
              />
            )}
          </SettingsPanel>
          <HedgeAssistantAiSettings />
          <EmailRouterAdvisorAiSettings />
          </div>
        </TabsContent>

        <TabsContent value="health" className="mt-0">
          <SystemHealthPanel />
        </TabsContent>

        <TabsContent value="hedge-desk" className="mt-0">
          <SettingsPanel
            icon={ChartNoAxesCombined}
            title="Hedge Desk"
            description="Shared valuation, settlement, Salesforce, communication, and Trading Assistant configuration for the native FCOS module."
          >
            <HedgeSettingsPanel />
          </SettingsPanel>
        </TabsContent>
      </Tabs>

      <div className="mt-4 flex justify-end rounded-xl border border-border bg-card/70 p-3">
        <Button onClick={saveAll} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>
    </div>
  );
}
