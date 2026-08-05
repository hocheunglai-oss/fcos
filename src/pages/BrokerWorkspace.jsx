import { Archive, BadgeDollarSign, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import BrokerRegister from '@/pages/BrokerRegister';
import ReportArchive from '@/pages/ReportArchive';
import BrokerCommissionConfiguration from '@/components/brokers/BrokerCommissionConfiguration';
import { Button } from '@/components/ui/button';
import PageMethodology from '@/components/common/PageMethodology';
import { BROKER_METHODOLOGIES } from '@/lib/pageMethodologies';

export default function BrokerWorkspace() {
  const { hasModuleAccess, hasCapability } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewCommissions = hasModuleAccess('brokers');
  const canViewArchive = hasModuleAccess('report_archive');
  const canManageConfiguration = hasModuleAccess('brokers') && hasCapability('broker_settings_manage');
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab === 'archive' && canViewArchive
    ? 'archive'
    : requestedTab === 'configuration' && canManageConfiguration
      ? 'configuration'
      : canViewCommissions ? 'commissions' : 'archive';
  const activeMethodology = BROKER_METHODOLOGIES[activeTab] || BROKER_METHODOLOGIES.commissions;

  const changeTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    if (tab === 'archive' && !next.has('reportType')) next.set('reportType', 'broker_commission');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="min-h-full bg-slate-50">
      <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex items-center gap-1">
          {canViewCommissions && <Button size="sm" variant={activeTab === 'commissions' ? 'default' : 'ghost'} className="gap-2" onClick={() => changeTab('commissions')}><BadgeDollarSign className="h-4 w-4" /> Commissions</Button>}
          {canViewArchive && <Button size="sm" variant={activeTab === 'archive' ? 'default' : 'ghost'} className="gap-2" onClick={() => changeTab('archive')}><Archive className="h-4 w-4" /> Report Archive</Button>}
          {canManageConfiguration && <Button size="sm" variant={activeTab === 'configuration' ? 'default' : 'ghost'} className="gap-2" onClick={() => changeTab('configuration')}><Settings2 className="h-4 w-4" /> Configuration</Button>}
        </div>
        <PageMethodology {...activeMethodology} size="sm" />
      </div>
      {activeTab === 'commissions' ? <BrokerRegister /> : activeTab === 'configuration' ? <BrokerCommissionConfiguration /> : <ReportArchive defaultReportType="broker_commission" />}
    </div>
  );
}
