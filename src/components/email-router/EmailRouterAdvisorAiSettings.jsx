import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { appClient } from '@/api/appClient';
import AiModelSettingsCard from '@/components/settings/AiModelSettingsCard';

export default function EmailRouterAdvisorAiSettings() {
  const [configuration, setConfiguration] = useState(null);
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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
  const usageByModel = useMemo(() => Object.fromEntries(models.map((model) => {
    const usage = configuration?.advisor?.usage?.[model.id] || {};
    return [model.id, {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      lastUsedAt: usage.lastUsedAt,
    }];
  })), [configuration, models]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
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
      setMessage('Email Router Advisor model saved.');
    }
    setSaving(false);
  };

  return (
    <AiModelSettingsCard
      title="Email Router Advisor"
      description="Select the model used to recommend Forward or Redirect, ordered recipients, and post-action filing. Recommendations never send or move email without a user action."
      icon={Sparkles}
      modelLabel="Routing Advisor model"
      models={models}
      selectedModelId={modelId}
      savedModelId={configuration?.advisor?.modelId || ''}
      usageByModel={usageByModel}
      loading={loading}
      saving={saving}
      error={error}
      message={message}
      canManage
      apiConfigured={configuration?.advisor?.apiConfigured !== false}
      storageAvailable={Boolean(configuration)}
      onModelChange={setModelId}
      onSave={save}
      onRefresh={load}
      updatedAt={modelSetting?.updatedAt}
      privacyNote="Only the opened message's minimum live text and opaque routing choices are sent. Confirmed learning stores protected fingerprints and directory references, never message or recipient content."
    />
  );
}
