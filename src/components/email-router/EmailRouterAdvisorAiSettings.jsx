import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StateBlock from '@/components/common/StateBlock';

function usd(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function integer(value) {
  return Number(value || 0).toLocaleString();
}

export default function EmailRouterAdvisorAiSettings() {
  const [configuration, setConfiguration] = useState(null);
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('emailRouterSettings', {}, { force: true });
    if (response.data?.error) {
      setConfiguration(null);
      setError(response.data.error);
    } else {
      setConfiguration(response.data);
      setModelId(response.data?.advisor?.modelId || '');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const modelSetting = useMemo(() => configuration?.settings?.find((item) => item.key === 'advisor.model'), [configuration]);
  const models = configuration?.advisor?.models || [];
  const dirty = Boolean(modelId && modelId !== configuration?.advisor?.modelId);

  const save = async () => {
    setSaving(true);
    setError('');
    const response = await appClient.functions.invoke('emailRouterSettingsSave', {
      operation: {
        type: 'setting_save',
        key: 'advisor.model',
        value: { modelId },
        expectedRevision: modelSetting?.revision,
      },
    });
    if (response.data?.error) setError(response.data.error);
    else {
      setConfiguration(response.data);
      setModelId(response.data?.advisor?.modelId || modelId);
    }
    setSaving(false);
  };

  return <section className="rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" />Email Router Advisor</h2><p className="mt-1 max-w-3xl text-xs text-muted-foreground">Select the read-only routing recommendation model and review OpenAI usage. The advisor cannot perform mail actions.</p></div>
      <Button variant="outline" size="icon" onClick={load} disabled={loading || saving} title="Refresh Email Router AI settings" aria-label="Refresh Email Router AI settings"><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
    </div>
    {error && <div className="mt-4 flex items-start gap-2 border-y border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    {loading && !configuration ? <StateBlock icon={Loader2} title="Loading Email Router AI settings" description="Reading the protected model configuration and usage totals." /> : configuration ? <div className="mt-5 space-y-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(240px,420px)_auto] sm:items-end">
        <div><label htmlFor="email-router-advisor-model" className="text-xs font-semibold">Interpretation model</label><Select value={modelId} onValueChange={setModelId}><SelectTrigger id="email-router-advisor-model" className="mt-1"><SelectValue placeholder="Select a model" /></SelectTrigger><SelectContent>{models.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent></Select></div>
        <Button onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? 'Saving' : 'Save model'}</Button>
      </div>
      <div className="overflow-x-auto border-y border-border">
        <table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Model</th><th className="px-3 py-2 font-semibold">Requests</th><th className="px-3 py-2 font-semibold">Input tokens</th><th className="px-3 py-2 font-semibold">Output tokens</th><th className="px-3 py-2 font-semibold">Estimated USD</th><th className="px-3 py-2 font-semibold">Last used</th></tr></thead><tbody className="divide-y divide-border">{models.map((model) => { const usage = configuration.advisor?.usage?.[model.id] || {}; return <tr key={model.id} className={model.id === configuration.advisor?.modelId ? 'bg-primary/5' : ''}><td className="px-3 py-3 font-medium">{model.label}</td><td className="px-3 py-3 tabular-nums">{integer(usage.requests)}</td><td className="px-3 py-3 tabular-nums">{integer(usage.inputTokens)}</td><td className="px-3 py-3 tabular-nums">{integer(usage.outputTokens)}</td><td className="px-3 py-3 tabular-nums">{usd(usage.estimatedCostUsd)}</td><td className="px-3 py-3 text-muted-foreground">{usage.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleString() : 'Not used'}</td></tr>; })}</tbody></table>
      </div>
      <p className="text-xs text-muted-foreground">Only the opened message’s minimum live text and opaque destination choices are sent. Email content and recommendations are not stored in FCOS.</p>
    </div> : null}
  </section>;
}
