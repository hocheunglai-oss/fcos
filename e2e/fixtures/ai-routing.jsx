import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AiModelSettingsCard from '@/components/settings/AiModelSettingsCard';
import { AI_MODEL_SELECTIONS, automaticRoutingFor } from '../../api/_aiModelRouting.js';
import '@/index.css';

function Fixture() {
  const [selection, setSelection] = useState('auto');
  const [saved, setSaved] = useState('auto');
  return <main className="h-dvh overflow-auto p-4 sm:p-8"><h1 className="mb-4 text-xl font-semibold">AI routing verification</h1><p className="mb-4">Synthetic Settings fixture · no provider calls</p><AiModelSettingsCard title="Dashboard AI Search" description="Choose Automatic by task or keep a manual override." models={AI_MODEL_SELECTIONS} selectedModelId={selection} savedModelId={saved} automaticRouting={automaticRoutingFor('dashboard_search')} usageByModel={{'gpt-5.6-sol':{requests:12,inputTokens:10000,outputTokens:2000,estimatedCostUsd:0.08}}} canManage onModelChange={setSelection} onSave={()=>setSaved(selection)} onRefresh={()=>setSelection(saved)} /><p className="mt-4">Saved selection: {saved}</p></main>;
}
const root = createRoot(document.getElementById('root'));
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
