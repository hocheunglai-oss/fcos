import { useState } from 'react';
import { Loader2, Pin } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';

const FALLBACK_OPTIONS = [
  { key: 'typical', label: 'Typical', percentileLabel: 'P50' },
  { key: 'cautious', label: 'Cautious', percentileLabel: 'P75' },
  { key: 'severe', label: 'Severe', percentileLabel: 'P90' },
];

function optionFor(options, key) {
  return options.find((option) => option.key === key) || FALLBACK_OPTIONS.find((option) => option.key === key);
}

export default function CreditForecastConservativenessControl({ settings, onChange, onSaved, disabled = false }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const options = settings?.options?.length ? settings.options : FALLBACK_OPTIONS;
  const companyLevel = settings?.companyConservativeness || 'cautious';
  const effectiveLevel = settings?.effectiveConservativeness || companyLevel;
  const companyOption = optionFor(options, companyLevel);
  const effectiveOption = optionFor(options, effectiveLevel);
  const temporary = effectiveLevel !== companyLevel;

  const saveCompanyDefault = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await appClient.functions.invoke('dashboardCreditForecastSettingsSave', {
        conservativeness: effectiveLevel,
        expectedUpdatedAt: settings?.updatedAt || null,
      }, { cache: false });
      if (response.data?.error) throw new Error(response.data.error);
      onSaved?.(response.data?.forecastSettings || {});
    } catch (saveError) {
      setError(saveError.message || 'The company forecast setting could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="rounded-lg border border-border bg-muted/30 p-2.5" data-testid="credit-forecast-conservativeness">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payment forecast</span>
      <div className="flex flex-wrap rounded-md border border-border bg-background p-1" role="group" aria-label="Credit forecast conservativeness">
        {options.map((option) => <button
          key={option.key}
          type="button"
          aria-pressed={effectiveLevel === option.key}
          disabled={disabled || saving}
          className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${effectiveLevel === option.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          onClick={() => { setError(''); onChange?.(option.key); }}
        >{option.label} · {option.percentileLabel}</button>)}
      </div>
      {settings?.canManage && temporary ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={saving || disabled} onClick={saveCompanyDefault}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}Set as company default</Button> : null}
    </div>
    <div className="mt-1.5 text-[11px] text-muted-foreground">
      Company default: <span className="font-semibold text-foreground">{companyOption?.label} · {companyOption?.percentileLabel}</span>
      {temporary ? <> · Viewing <span className="font-semibold text-amber-700">{effectiveOption?.label} · {effectiveOption?.percentileLabel} temporarily</span></> : null}
      {!settings?.canManage ? ' · Your selection previews this chart only.' : null}
    </div>
    {error ? <div className="mt-1.5 text-xs font-medium text-red-700" role="alert">{error}</div> : null}
  </div>;
}
