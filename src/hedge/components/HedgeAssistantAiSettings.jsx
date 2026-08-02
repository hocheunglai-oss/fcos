import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Loader2, Save } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { appClient } from '@/api/appClient';
import { AppConfig } from '@/hedge/api/entities';

export default function HedgeAssistantAiSettings() {
  const [settings, setSettings] = useState(null);
  const [savedModelId, setSavedModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const { data } = await appClient.functions.invoke('hedgeDeskAssistantSettings', {}, { cache: false });
      if (data?.error) throw new Error(data.error);
      setSettings(data);
      setSavedModelId(data?.modelId || '');
      return true;
    } catch (error) {
      setMessage(error.message || 'Trading Assistant AI settings could not be loaded.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalUsage = useMemo(
    () => Object.values(settings?.usage || {}).reduce((sum, row) => sum + Number(row.estimatedCostUsd || 0), 0),
    [settings],
  );

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const records = await AppConfig.filter({ key: 'assistant_model' }, '-updated_date', 1);
      const current = records?.[0] || null;
      const payload = { key: 'assistant_model', value: settings.modelId, label: 'assistant_model' };
      if (current) await AppConfig.update(current.id, payload, current.revision);
      else await AppConfig.create(payload);
      setSavedModelId(settings.modelId);
      if (await load()) setMessage('Trading Assistant model saved.');
    } catch (error) {
      setMessage(error.message || 'Trading Assistant model could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Bot className="h-4 w-4" /></div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Hedge Desk Trading Assistant</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Choose the model used for compact book and market summaries. Customer identities, email addresses, Salesforce IDs, and secrets are excluded.</p>
        </div>
      </div>

      {message && <Alert className="mb-4"><AlertDescription>{message}</AlertDescription></Alert>}
      {loading ? (
        <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Trading Assistant settings...</div>
      ) : settings ? (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr] md:items-end">
            <div className="space-y-1.5">
              <Label>Assistant model</Label>
              <Select value={settings.modelId} disabled={!settings.canManage || saving} onValueChange={(modelId) => setSettings((current) => ({ ...current, modelId }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(settings.models || []).map((model) => <SelectItem key={model.id} value={model.id}>{model.label} · {model.costTier}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-border bg-background/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">All recorded usage</span>
                <Badge variant="outline">${totalUsage.toFixed(6)}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Estimated USD cost based on recorded assistant token usage.</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Assistant model</th>
                  <th className="px-3 py-2.5 font-semibold">Requests</th>
                  <th className="px-3 py-2.5 font-semibold">Input tokens</th>
                  <th className="px-3 py-2.5 font-semibold">Cached input</th>
                  <th className="px-3 py-2.5 font-semibold">Output tokens</th>
                  <th className="px-3 py-2.5 font-semibold">Estimated USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(settings.models || []).map((model) => {
                  const usage = settings.usage?.[model.id] || {};
                  const selected = model.id === settings.modelId;
                  return (
                    <tr key={model.id} className={selected ? 'bg-primary/5' : 'bg-background'}>
                      <td className="px-3 py-3">
                        <span className="font-semibold text-foreground">{model.label}</span>
                        {selected && <Badge variant="outline" className="ml-2 border-primary/30 bg-primary/10 text-primary">Selected</Badge>}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{Number(usage.requests || 0).toLocaleString('en-US')}</td>
                      <td className="px-3 py-3 tabular-nums">{Number(usage.inputTokens || 0).toLocaleString('en-US')}</td>
                      <td className="px-3 py-3 tabular-nums">{Number(usage.cachedInputTokens || 0).toLocaleString('en-US')}</td>
                      <td className="px-3 py-3 tabular-nums">{Number(usage.outputTokens || 0).toLocaleString('en-US')}</td>
                      <td className="px-3 py-3 font-semibold tabular-nums text-foreground">${Number(usage.estimatedCostUsd || 0).toFixed(6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!settings.models?.length && <div className="flex items-start gap-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5" />No Trading Assistant models are currently available.</div>}
          {settings.canManage ? <Button onClick={save} disabled={saving || !settings.modelId || settings.modelId === savedModelId}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving...' : 'Save Trading Assistant model'}</Button> : <p className="text-xs text-muted-foreground">Hedge Desk administration permission is required to change this model.</p>}
        </div>
      ) : null}
    </section>
  );
}
