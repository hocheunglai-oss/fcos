import { Sparkles } from 'lucide-react';
import AiModelSettingsCard from '@/components/settings/AiModelSettingsCard';
import MarketAssistantSettings from '@/components/markets/MarketAssistantSettings';
import EmailRouterAdvisorAiSettings from '@/components/email-router/EmailRouterAdvisorAiSettings';

export default function SettingsAiModels({ dashboard }) {
  return (
    <div className="space-y-5">
      {dashboard && (
        <AiModelSettingsCard
          title="Dashboard AI Search"
          description="Choose automatic routing or a manual model. Salesforce records are never sent to the model."
          icon={Sparkles}
          modelLabel="Dashboard AI selection"
          canManage
          privacyNote="Only the user’s search sentence is sent. FCOS validates the structured result and builds Salesforce filters server-side."
          {...dashboard}
        />
      )}
      <MarketAssistantSettings />
      {dashboard && <EmailRouterAdvisorAiSettings />}
    </div>
  );
}
