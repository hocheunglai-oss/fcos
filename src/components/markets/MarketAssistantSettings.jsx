import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, RefreshCw } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function MarketAssistantSettings() {
  const [settings, setSettings] = useState(null);
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const { data } = await appClient.functions.invoke('marketAssistantSettingsGet', {}, { cache: false, force: true });
      if (data?.error) throw new Error(data.error);
      setSettings(data);
      setModelId(data.modelId);
    } catch (e) { setError(e.message || 'Market Assistant settings could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data } = await appClient.functions.invoke('marketAssistantSettingsSave', { modelId, expectedRevision: settings.revision }, { cache: false });
      if (data?.error) throw new Error(data.error);
      setSettings(data);
      setModelId(data.modelId);
      setMessage('Market Assistant model saved. It will apply to the next question for all users.');
    } catch (e) { setError(e.message || 'The model could not be saved.'); }
    finally { setSaving(false); }
  };

  return <section className="rounded-lg border border-border bg-card" aria-labelledby="market-assistant-settings-title">
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex gap-3"><Bot className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" /><div>
        <h2 id="market-assistant-settings-title" className="text-sm font-semibold">Market Assistant</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the OpenAI model used when users ask questions on the Market page. Answers use FCOS market prices, report evidence, and forward curves.</p>
      </div></div>
      <Button variant="outline" size="icon" onClick={load} disabled={loading || saving} aria-label="Refresh Market Assistant settings"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
    </div>
    <div className="space-y-4 p-4">
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {loading && !settings ? <div className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading model setting…</div> : <>
        <div className="max-w-md space-y-2">
          <Label htmlFor="market-assistant-model">Market Assistant model</Label>
          <Select value={modelId} onValueChange={setModelId} disabled={loading || saving || !settings?.canManage}>
            <SelectTrigger id="market-assistant-model"><SelectValue placeholder="Select a model" /></SelectTrigger>
            <SelectContent>{(settings?.models || []).map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{settings?.apiConfigured ? 'OpenAI connection configured. Available models depend on the connected OpenAI project.' : 'OpenAI connection pending. You can save your model choice now; chat becomes available when the server connection is configured.'}</p>
        {settings?.modelSupported === false && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">The saved model is no longer supported. Select and save a model above to restore chat.</p>}
        <p className="text-xs text-muted-foreground">The selected model applies to all Market users. The API key stays on the server.</p>
        <Button onClick={save} disabled={loading || saving || !settings?.canManage || !modelId || modelId === settings.modelId}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Market Assistant model
        </Button>
      </>}
    </div>
  </section>;
}
