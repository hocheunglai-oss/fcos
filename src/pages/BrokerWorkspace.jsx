import { BadgeDollarSign, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import BrokerRegister from '@/pages/BrokerRegister';
import BrokerCommissionConfiguration from '@/components/brokers/BrokerCommissionConfiguration';
import { Button } from '@/components/ui/button';
import PageMethodology from '@/components/common/PageMethodology';
import { BROKER_METHODOLOGIES } from '@/lib/pageMethodologies';

export default function BrokerWorkspace() {
  const { hasModuleAccess, hasCapability } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewCommissions = hasModuleAccess('brokers');
  const canManageConfiguration = hasModuleAccess('brokers') && hasCapability('broker_settings_manage');
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab === 'configuration' && canManageConfiguration
      ? 'configuration'
      : 'commissions';
  const activeMethodology = BROKER_METHODOLOGIES[activeTab] || BROKER_METHODOLOGIES.commissions;

  const changeTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="workspace-operations min-h-full">
      <div className="app-navigation-material workspace-primary-navigation sticky top-0 z-30 flex min-w-0 items-center gap-2 overflow-hidden border-b border-border px-4 py-2.5 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Broker Commission views">
          {canViewCommissions && <Button role="tab" aria-selected={activeTab === 'commissions'} size="sm" variant={activeTab === 'commissions' ? 'default' : 'ghost'} className="shrink-0 gap-2" onClick={() => changeTab('commissions')}><BadgeDollarSign className="h-4 w-4" /> Commissions</Button>}
          {canManageConfiguration && <Button role="tab" aria-selected={activeTab === 'configuration'} size="sm" variant={activeTab === 'configuration' ? 'default' : 'ghost'} className="shrink-0 gap-2" onClick={() => changeTab('configuration')}><Settings2 className="h-4 w-4" /> Configuration</Button>}
        </div>
        <div className="shrink-0"><PageMethodology {...activeMethodology} size="sm" /></div>
      </div>
      {activeTab === 'configuration' ? <BrokerCommissionConfiguration /> : <BrokerRegister />}
    </div>
  );
}
