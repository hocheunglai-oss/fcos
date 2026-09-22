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

export function validateBankCharge(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Enter a supplier remittance charge.';
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return 'Enter USD 0–1,000,000 with no more than two decimal places.';
  const charge = Number(text);
  if (!Number.isFinite(charge) || charge < 0 || charge > 1_000_000) return 'Enter USD 0–1,000,000 with no more than two decimal places.';
  return '';
}

function displayRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) ? rate.toFixed(2) : '';
}

const displayCharge = displayRate;

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
  const [draft, setDraft] = useState({ annualInterestRatePct: '', UBS: '', DBS: '' });
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
      const ubsCharge = Number(next?.bankChargesUsd?.UBS);
      const dbsCharge = Number(next?.bankChargesUsd?.DBS);
      if (!next || !Number.isFinite(nextRate) || !Number.isFinite(ubsCharge) || !Number.isFinite(dbsCharge)) {
        setError('The company finance settings are unavailable.');
        return;
      }
      setSettings(next);
      setPermissions(response.data?.permissions || { canManageSettings: false });
      setDraft({ annualInterestRatePct: displayRate(nextRate), UBS: displayCharge(ubsCharge), DBS: displayCharge(dbsCharge) });
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

  const validationErrors = useMemo(() => ({
    annualInterestRatePct: validateAnnualFinancingRate(draft.annualInterestRatePct),
    UBS: validateBankCharge(draft.UBS),
    DBS: validateBankCharge(draft.DBS),
  }), [draft]);
  const validationError = Object.values(validationErrors).find(Boolean) || '';
  const dirty = !validationError && settings && (
    Number(draft.annualInterestRatePct) !== Number(settings.annualInterestRatePct)
    || Number(draft.UBS) !== Number(settings.bankChargesUsd?.UBS)
    || Number(draft.DBS) !== Number(settings.bankChargesUsd?.DBS)
  );
  const canManage = permissions.canManageSettings === true;

  const save = async () => {
    const invalid = Object.values(validationErrors).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await appClient.functions.invoke('financeSettingsSave', {
        annualInterestRatePct: Number(draft.annualInterestRatePct),
        bankChargesUsd: { UBS: Number(draft.UBS), DBS: Number(draft.DBS) },
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
          setError('The company finance settings changed after this page loaded. Your draft is still here; refresh the setting, review the latest revision, and save again.');
        } else {
          setError(response.data.error);
        }
        return;
      }
      const next = response.data?.settings;
      if (!next || !Number.isFinite(Number(next.annualInterestRatePct)) || !Number.isFinite(Number(next.bankChargesUsd?.UBS)) || !Number.isFinite(Number(next.bankChargesUsd?.DBS))) {
        setError('The server did not return the saved finance settings. Refresh before making another change.');
        return;
      }
      setSettings(next);
      setPermissions(response.data?.permissions || permissions);
      setDraft({ annualInterestRatePct: displayRate(next.annualInterestRatePct), UBS: displayCharge(next.bankChargesUsd.UBS), DBS: displayCharge(next.bankChargesUsd.DBS) });
      window.dispatchEvent(new CustomEvent('fcos:finance-settings-updated', { detail: { revision: next.revision } }));
      toast({ title: 'Finance settings saved', description: `Dashboard EBIT now uses ${displayRate(next.annualInterestRatePct)}% annually, UBS USD ${displayCharge(next.bankChargesUsd.UBS)}, and DBS USD ${displayCharge(next.bankChargesUsd.DBS)} per supplier remittance.` });
    } catch (saveError) {
      setError(saveError?.message || 'The finance settings could not be saved.');
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
        description="Control the interest rate and supplier remittance charges used to calculate Dashboard EBIT. Historical selections use the current revision."
        actions={methodologyAction}
      />

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Dashboard financing</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">FCOS applies interest to positive daily funded balances using Actual/365 and one bank charge per actual supplier remittance. All values save together under one revision.</p>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => load({ force: true })} disabled={loading || saving} title="Refresh Finance settings" aria-label="Refresh Finance settings">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {error ? <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div> : null}

        {loading && !settings ? <div role="status" className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Finance settings…</div> : (
          <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(430px,1.2fr)_minmax(220px,1fr)_auto] lg:items-end">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['annualInterestRatePct', 'Annual financing rate (%)', '%', 'Enter 0–100 with up to two decimal places.'],
                ['UBS', 'UBS remittance charge', 'USD', 'Per actual supplier remittance.'],
                ['DBS', 'DBS remittance charge', 'USD', 'Per actual supplier remittance.'],
              ].map(([field, label, suffix, help]) => {
                const id = field === 'annualInterestRatePct' ? 'annual-financing-rate' : `${field.toLowerCase()}-bank-charge`;
                return <div key={field} className="space-y-1.5">
                  <Label htmlFor={id}>{label}</Label>
                  <div className="relative">
                    <Input id={id} type="text" inputMode="decimal" autoComplete="off" value={draft[field]} onChange={(event) => { setDraft((current) => ({ ...current, [field]: event.target.value })); setError(''); }} disabled={!canManage || saving || !settings} aria-invalid={Boolean(settings && validationErrors[field])} aria-describedby={`${id}-help ${id}-error`} className={suffix === '%' ? 'pr-9 tabular-nums' : 'pl-12 tabular-nums'} />
                    <span className={`pointer-events-none absolute inset-y-0 flex items-center text-xs text-muted-foreground ${suffix === '%' ? 'right-3' : 'left-3'}`}>{suffix}</span>
                  </div>
                  <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>
                  {settings && validationErrors[field] ? <p id={`${id}-error`} className="text-xs text-red-700 dark:text-red-400">{validationErrors[field]}</p> : <span id={`${id}-error`} />}
                </div>;
              })}
            </div>

            <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <dt>Day-count basis</dt><dd className="font-medium text-foreground">Actual/365</dd>
              <dt>Revision</dt><dd className="font-medium tabular-nums text-foreground">{settings?.revision ?? 'Unavailable'}</dd>
              <dt>Last changed</dt><dd className="font-medium text-foreground">{displayDateTime(settings?.updatedAt)}</dd>
              <dt>Changed by</dt><dd className="truncate font-medium text-foreground" title={settings?.updatedByEmail || ''}>{settings?.updatedByEmail || 'No recorded actor'}</dd>
            </dl>

            {canManage ? <Button type="button" onClick={save} disabled={!dirty || Boolean(validationError) || loading || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save finance settings'}
            </Button> : <p className="max-w-xs text-xs leading-5 text-muted-foreground">You can view these company settings. Finance settings managers, Administrators, and the General Manager can change them.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
