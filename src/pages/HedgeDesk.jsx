import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Building2, ChartNoAxesCombined, FileSpreadsheet, Gauge, Handshake, RefreshCw, Settings2 } from 'lucide-react';
import { ActionsProvider } from '@/hedge/data/ActionsContext';
import { useDeskData } from '@/hedge/hooks/useDeskData';
import { useAppSettings } from '@/hedge/hooks/useAppSettings';
import { OverviewView } from '@/hedge/views/OverviewView';
import { PhysicalView } from '@/hedge/views/PhysicalView';
import { HedgesView } from '@/hedge/views/HedgesView';
import { SettlementView } from '@/hedge/views/SettlementView';
import { CounterpartiesView } from '@/hedge/views/CounterpartiesView';
import { AssistantPanel } from '@/hedge/components/AssistantPanel';
import HedgeSettingsPanel from '@/hedge/components/HedgeSettingsPanel';
import { Button, EmptyState, InlineError, StatusBadge } from '@/hedge/components/ui';
import { useAuth } from '@/lib/AuthContext';
import '@/hedge/styles.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'physical', label: 'Physical Trades', icon: Handshake },
  { id: 'hedges', label: 'Paper Hedges', icon: ChartNoAxesCombined },
  { id: 'settlement', label: 'Settlement', icon: FileSpreadsheet },
  { id: 'counterparties', label: 'Counterparties', icon: Building2 },
];

export default function HedgeDesk() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasCapability } = useAuth();
  const data = useDeskData();
  const settings = useAppSettings();
  const canAdmin = hasCapability('hedge_admin');
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState(() => requestedTab === 'administration' && canAdmin ? 'administration' : TABS.some((item) => item.id === requestedTab) ? requestedTab : 'overview');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [quickCreateSignals] = useState({ physical: 0, hedges: 0 });
  const capabilities = data.capabilities || {};
  const readOnly = !Object.values(capabilities).some(Boolean);
  const visibleTabs = canAdmin ? [...TABS, { id: 'administration', label: 'Administration', icon: Settings2 }] : TABS;

  useEffect(() => {
    const nextTab = requestedTab === 'administration' && canAdmin
      ? 'administration'
      : TABS.some((item) => item.id === requestedTab)
        ? requestedTab
        : 'overview';
    setTab(nextTab);
  }, [canAdmin, requestedTab]);

  const changeTab = (nextTab) => {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'overview') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  const content = useMemo(() => {
    if (tab === 'physical') return <PhysicalView data={data} settings={settings} quickCreateSignal={quickCreateSignals.physical} readOnly={!capabilities.hedge_book_manage} />;
    if (tab === 'hedges') return <HedgesView data={data} settings={settings} quickCreateSignal={quickCreateSignals.hedges} readOnly={!capabilities.hedge_book_manage} />;
    if (tab === 'settlement') return <SettlementView data={data} settings={settings} readOnly={!capabilities.hedge_settlement_manage} canClose={capabilities.hedge_close_approve === true} canManageBrokerSettlements={capabilities.hedge_settlement_manage === true || capabilities.hedge_close_approve === true} />;
    if (tab === 'counterparties') return <CounterpartiesView data={data} settings={settings} readOnly={!capabilities.hedge_book_manage} />;
    if (tab === 'administration' && canAdmin) return <div className="rounded-lg border border-border bg-card p-4 lg:p-5"><HedgeSettingsPanel /></div>;
    return <OverviewView data={data} settings={settings} readOnly={readOnly} onNavigate={(path) => { if (path === '/markets') navigate('/markets'); else if (path === '/audit') navigate('/settings?section=audit'); else changeTab(path === '/hedges' ? 'hedges' : path === '/settlement' ? 'settlement' : 'overview'); }} />;
  }, [canAdmin, capabilities, data, navigate, quickCreateSignals, readOnly, settings, tab]);

  if ((data.loading || settings.loading) && !data.physicals.length && !data.swaps.length) {
    return <div className="hedge-desk-root workspace-trading"><EmptyState title="Loading Hedge Desk" description="Preparing the native trading book and shared configuration." icon={RefreshCw} /></div>;
  }

  return (
    <ActionsProvider reload={data.reload}>
      <div className="hedge-desk-root workspace-trading">
        <div className="hedge-desk-commandbar app-navigation-material workspace-primary-navigation">
          <div>
            <strong>Hedge Desk</strong>
            <StatusBadge tone={readOnly ? 'neutral' : 'positive'}>{readOnly ? 'View only' : 'Live book'}</StatusBadge>
          </div>
          <div className="hedge-desk-commandbar__actions">
            <Button icon={RefreshCw} onClick={() => data.reload({ silent: true })} disabled={data.refreshing}>{data.refreshing ? 'Refreshing...' : 'Refresh'}</Button>
            <Button icon={Bot} variant="primary" onClick={() => setAssistantOpen(true)}>Trading Assistant</Button>
          </div>
        </div>
        <nav className="hedge-desk-tabs app-navigation-caption-material" aria-label="Hedge Desk views">
          {visibleTabs.map((item) => (
            <button type="button" key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => changeTab(item.id)}>
              <item.icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        {(data.error || settings.error) && <InlineError error={data.error || settings.error} action={<Button onClick={() => { data.reload(); settings.reload(); }}>Retry</Button>} />}
        <main className="hedge-desk-content">{content}</main>
        <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} data={data} settings={settings} />
      </div>
    </ActionsProvider>
  );
}
