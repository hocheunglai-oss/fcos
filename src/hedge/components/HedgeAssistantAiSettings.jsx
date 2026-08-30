import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { appClient } from '@/api/appClient';
import AiModelSettingsCard from '@/components/settings/AiModelSettingsCard';
import { AppConfig } from '@/hedge/api/entities';

export default function HedgeAssistantAiSettings() {
  const [settings, setSettings] = useState(null);
  const [savedModelId, setSavedModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await appClient.functions.invoke('hedgeDeskAssistantSettings', {}, { cache: false, force: true });
      if (data?.error) throw new Error(data.error);
      setSettings(data);
      setSavedModelId(data?.modelId || '');
      return true;
    } catch (loadError) {
      setError(loadError.message || 'Trading Assistant AI settings could not be loaded.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const usageByModel = useMemo(() => Object.fromEntries((settings?.models || []).map((model) => {
    const usage = settings?.usage?.[model.id] || {};
    return [model.id, {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      lastUsedAt: usage.lastUsedAt,
    }];
  })), [settings]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const records = await AppConfig.filter({ key: 'assistant_model' }, '-updated_date', 1);
      const current = records?.[0] || null;
      const payload = { key: 'assistant_model', value: settings.modelId, label: 'assistant_model' };
      if (current) await AppConfig.update(current.id, payload, current.revision);
      else await AppConfig.create(payload);
      setSavedModelId(settings.modelId);
      if (await load()) setMessage('Trading Assistant model saved.');
    } catch (saveError) {
      setError(saveError.message || 'Trading Assistant model could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AiModelSettingsCard
      title="Hedge Desk Trading Assistant"
      description="Select the model used for compact book and market summaries. The assistant remains advisory and cannot change the hedge book."
      icon={Bot}
      modelLabel="Trading Assistant model"
      models={settings?.models || []}
      selectedModelId={settings?.modelId || ''}
      savedModelId={savedModelId}
      usageByModel={usageByModel}
      loading={loading}
      saving={saving}
      error={error}
      message={message}
      canManage={settings?.canManage === true}
      apiConfigured={settings?.apiConfigured !== false}
      storageAvailable={Boolean(settings)}
      onModelChange={(modelId) => setSettings((current) => ({ ...current, modelId }))}
      onSave={save}
      onRefresh={load}
      updatedAt={settings?.updatedAt}
      privacyNote="Only compact server-prepared book and market summaries are sent; customer identities, email addresses, Salesforce IDs, and secrets are excluded."
      permissionNote="Hedge Desk administration permission is required to change this model."
    />
  );
}
