import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, Save, Settings2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { RATE_PROVIDER_OPTIONS } from '@/lib/exchangeRateSettings';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StateBlock from '@/components/common/StateBlock';

export default function BrokerCommissionConfiguration() {
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState('blended');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('brokerCommissionSettingsGet', {}, { force });
    if (response.data?.error) setError(response.data.error);
    else {
      setSettings(response.data.settings);
      setProvider(response.data.settings?.provider || 'blended');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    const response = await appClient.functions.invoke('brokerCommissionSettingsSave', {
      provider,
      expectedRevision: settings?.revision || 0,
    });
    if (response.data?.error) setError(response.data.error);
    else {
      setSettings(response.data.settings);
      setProvider(response.data.settings.provider);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  if (loading && !settings) return <StateBlock icon={Loader2} title="Loading Broker Commission configuration" description="Reading the company exchange-rate setting." />;
  const dirty = Boolean(settings && provider !== settings.provider);

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted p-2 text-muted-foreground"><Settings2 className="h-4 w-4" /></div>
            <div>
              <h2 className="text-sm font-semibold">Exchange Rate</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">One company setting controls USD/CNY conversion in Broker Commissions, reports, and exports.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="icon" onClick={() => load({ force: true })} disabled={loading || saving} aria-label="Refresh configuration" title="Refresh configuration">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            {dirty && (
              <Button type="button" onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saved ? 'Saved' : 'Save Configuration'}
              </Button>
            )}
          </div>
        </div>

        {error && <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="space-y-1.5">
            <Label>USD/CNY mid-rate provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RATE_PROVIDER_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
            <p><span className="font-semibold text-foreground">Source:</span> Frankfurter API</p>
            <p><span className="font-semibold text-foreground">Bank buy rate:</span> mid-rate less 0.2%</p>
            <p><span className="font-semibold text-foreground">Date rule:</span> latest available rate on or before quarter end</p>
            <p><span className="font-semibold text-foreground">Scope:</span> company-wide and server enforced</p>
          </div>
        </div>
      </section>
    </div>
  );
}
