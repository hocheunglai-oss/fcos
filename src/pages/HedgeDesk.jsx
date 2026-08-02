import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, BookOpen, Building2, ChartNoAxesCombined, FileSpreadsheet, Gauge, Handshake, RefreshCw } from 'lucide-react';
import { ActionsProvider } from '@/hedge/data/ActionsContext';
import { useDeskData } from '@/hedge/hooks/useDeskData';
import { useAppSettings } from '@/hedge/hooks/useAppSettings';
import { OverviewView } from '@/hedge/views/OverviewView';
import { PhysicalView } from '@/hedge/views/PhysicalView';
import { HedgesView } from '@/hedge/views/HedgesView';
import { SettlementView } from '@/hedge/views/SettlementView';
import { CounterpartiesView } from '@/hedge/views/CounterpartiesView';
import { AssistantPanel } from '@/hedge/components/AssistantPanel';
import { Button, EmptyState, InlineError, Panel, SectionHeading, StatusBadge } from '@/hedge/components/ui';
import { PAGE_METHODOLOGIES } from '@/hedge/lib/methodology';
import '@/hedge/styles.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'physical', label: 'Physical Trades', icon: Handshake },
  { id: 'hedges', label: 'Paper Hedges', icon: ChartNoAxesCombined },
  { id: 'settlement', label: 'Settlement', icon: FileSpreadsheet },
  { id: 'counterparties', label: 'Counterparties', icon: Building2 },
  { id: 'methodology', label: 'Methodology', icon: BookOpen },
];

function MethodologyView() {
  const entries = Object.entries(PAGE_METHODOLOGIES).filter(([name]) => !['Settings', 'Audit history'].includes(name));
  return (
    <div className="app-page">
      <header className="app-page-header">
        <div className="app-page-header__copy">
          <div className="app-eyebrow">Controls and calculations</div>
          <div className="app-page-header__title-row"><h1>Hedge Desk methodology</h1></div>
          <p>The common calculation, valuation, settlement, and data-control rules used throughout the native FCOS Hedge Desk.</p>
        </div>
      </header>
      <div className="app-methodology-grid">
        {entries.map(([name, methodology]) => (
          <Panel key={name}>
            <SectionHeading title={name} description={methodology.summary} />
            <ol className="app-methodology-list">{methodology.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export default function HedgeDesk() {
  const navigate = useNavigate();
  const data = useDeskData();
  const settings = useAppSettings();
  const [tab, setTab] = useState('overview');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [quickCreateSignals] = useState({ physical: 0, hedges: 0 });
  const capabilities = data.capabilities || {};
  const readOnly = !Object.values(capabilities).some(Boolean);

  const content = useMemo(() => {
    if (tab === 'physical') return <PhysicalView data={data} settings={settings} quickCreateSignal={quickCreateSignals.physical} readOnly={!capabilities.hedge_book_manage} />;
    if (tab === 'hedges') return <HedgesView data={data} settings={settings} quickCreateSignal={quickCreateSignals.hedges} readOnly={!capabilities.hedge_book_manage} />;
    if (tab === 'settlement') return <SettlementView data={data} settings={settings} readOnly={!capabilities.hedge_settlement_manage} canClose={capabilities.hedge_close_approve === true} />;
    if (tab === 'counterparties') return <CounterpartiesView data={data} settings={settings} readOnly={!capabilities.hedge_book_manage} />;
    if (tab === 'methodology') return <MethodologyView />;
    return <OverviewView data={data} settings={settings} readOnly={readOnly} onNavigate={(path) => { if (path === '/markets') navigate('/markets'); else setTab(path === '/hedges' ? 'hedges' : path === '/settlement' ? 'settlement' : path === '/audit' ? 'methodology' : 'overview'); }} />;
  }, [capabilities, data, navigate, quickCreateSignals, readOnly, settings, tab]);

  if ((data.loading || settings.loading) && !data.physicals.length && !data.swaps.length) {
    return <div className="hedge-desk-root"><EmptyState title="Loading Hedge Desk" description="Preparing the native trading book and shared configuration." icon={RefreshCw} /></div>;
  }

  return (
    <ActionsProvider reload={data.reload}>
      <div className="hedge-desk-root">
        <div className="hedge-desk-commandbar">
          <div>
            <strong>Hedge Desk</strong>
            <StatusBadge tone={readOnly ? 'neutral' : 'positive'}>{readOnly ? 'View only' : 'Live book'}</StatusBadge>
          </div>
          <div className="hedge-desk-commandbar__actions">
            <Button icon={RefreshCw} onClick={() => data.reload({ silent: true })} disabled={data.refreshing}>{data.refreshing ? 'Refreshing...' : 'Refresh'}</Button>
            <Button icon={Bot} variant="primary" onClick={() => setAssistantOpen(true)}>Trading Assistant</Button>
          </div>
        </div>
        <nav className="hedge-desk-tabs" aria-label="Hedge Desk views">
          {TABS.map((item) => (
            <button type="button" key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
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
