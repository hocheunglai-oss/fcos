import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeDollarSign, Loader2, RefreshCw, Save } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { appClient } from '@/api/appClient';

export function validateAnnualFinancingRate(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Enter an annual financing rate.';
  if (!/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(text)) return 'Enter a percentage from 0 to 100 with no more than two decimal places.';
  const rate = Number(text);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'Enter a percentage from 0 to 100 with no more than two decimal places.';
  return '';
}

function displayRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) ? rate.toFixed(2) : '';
}

function displayDateTime(value) {
  if (!value) return 'No recorded change';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No recorded change';
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

function isRevisionConflict(data) {
  const marker = `${data?.code || ''} ${data?.error || ''} ${data?.message || ''}`.toLowerCase();
  return data?.conflict === true || marker.includes('finance_settings_revision_conflict') || marker.includes('revision conflict') || marker.includes('stale revision');
}

export default function FinanceSettings({ methodologyAction }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState(null);
  const [permissions, setPermissions] = useState({ canManageSettings: false });
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ force = true, signal } = {}) => {
    setLoading(true);
    setError('');
    try {
      const response = await appClient.functions.invoke('financeSettingsGet', {}, {
        force,
        cache: !force,
        cacheTtlMs: 60_000,
        cacheTags: ['finance-settings'],
        signal,
      });
      if (response.data?.cancelled || signal?.aborted) return;
      if (response.data?.error) {
        setError(response.data.error);
        return;
      }
      const next = response.data?.settings;
      const nextRate = Number(next?.annualInterestRatePct);
      if (!next || !Number.isFinite(nextRate)) {
        setError('The company financing rate is unavailable.');
        return;
      }
      setSettings(next);
      setPermissions(response.data?.permissions || { canManageSettings: false });
      setDraft(displayRate(nextRate));
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError?.message || 'Finance settings could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load({ force: true, signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  const validationError = useMemo(() => validateAnnualFinancingRate(draft), [draft]);
  const dirty = !validationError && settings && Number(draft) !== Number(settings.annualInterestRatePct);
  const canManage = permissions.canManageSettings === true;

  const save = async () => {
    const invalid = validateAnnualFinancingRate(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await appClient.functions.invoke('financeSettingsSave', {
        annualInterestRatePct: Number(draft),
        expectedRevision: settings?.revision,
      }, {
        force: true,
        cache: false,
        invalidateCache: false,
        invalidateNames: ['financeSettingsGet', 'dashboardSummary', 'dashboardStemList'],
        invalidateTags: ['finance-settings', 'dashboard'],
      });
      if (response.data?.error) {
        if (isRevisionConflict(response.data)) {
          setError('The company financing rate changed after this page loaded. Your draft is still here; refresh the setting, review the latest revision, and save again.');
        } else {
          setError(response.data.error);
        }
        return;
      }
      const next = response.data?.settings;
      if (!next || !Number.isFinite(Number(next.annualInterestRatePct))) {
        setError('The server did not return the saved financing rate. Refresh before making another change.');
        return;
      }
      setSettings(next);
      setPermissions(response.data?.permissions || permissions);
      setDraft(displayRate(next.annualInterestRatePct));
      window.dispatchEvent(new CustomEvent('fcos:finance-settings-updated', { detail: { revision: next.revision } }));
      toast({ title: 'Annual financing rate saved', description: `Dashboard EBIT now uses ${displayRate(next.annualInterestRatePct)}% annually.` });
    } catch (saveError) {
      setError(saveError?.message || 'The annual financing rate could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="workspace-administration-canvas mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={BadgeDollarSign}
        eyebrow="Administration"
        title="Finance"
        description="Control the company financing rate used to calculate Dashboard EBIT. Historical selections are recalculated with the current rate."
        actions={methodologyAction}
      />

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Dashboard financing</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">FCOS applies this company rate to positive daily funded balances using Actual/365. Rate changes are revision protected and recorded in the audit history.</p>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => load({ force: true })} disabled={loading || saving} title="Refresh Finance settings" aria-label="Refresh Finance settings">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {error ? <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div> : null}

        {loading && !settings ? <div role="status" className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Finance settings…</div> : (
          <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(260px,420px)_minmax(220px,1fr)_auto] lg:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="annual-financing-rate">Annual financing rate (%)</Label>
              <div className="relative">
                <Input
                  id="annual-financing-rate"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError('');
                  }}
                  disabled={!canManage || saving || !settings}
                  aria-invalid={Boolean(settings && validationError)}
                  aria-describedby="annual-financing-rate-help annual-financing-rate-error"
                  className="pr-9 tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span>
              </div>
              <p id="annual-financing-rate-help" className="text-xs text-muted-foreground">Enter 0–100 with up to two decimal places.</p>
              {settings && validationError ? <p id="annual-financing-rate-error" className="text-xs text-red-700 dark:text-red-400">{validationError}</p> : <span id="annual-financing-rate-error" />}
            </div>

            <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <dt>Day-count basis</dt><dd className="font-medium text-foreground">Actual/365</dd>
              <dt>Revision</dt><dd className="font-medium tabular-nums text-foreground">{settings?.revision ?? 'Unavailable'}</dd>
              <dt>Last changed</dt><dd className="font-medium text-foreground">{displayDateTime(settings?.updatedAt)}</dd>
              <dt>Changed by</dt><dd className="truncate font-medium text-foreground" title={settings?.updatedByEmail || ''}>{settings?.updatedByEmail || 'No recorded actor'}</dd>
            </dl>

            {canManage ? <Button type="button" onClick={save} disabled={!dirty || Boolean(validationError) || loading || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save rate'}
            </Button> : <p className="max-w-xs text-xs leading-5 text-muted-foreground">You can view this company rate. Finance settings managers, Administrators, and the General Manager can change it.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
