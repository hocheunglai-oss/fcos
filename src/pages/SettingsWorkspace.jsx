import { useEffect, useMemo } from 'react';
import {
  Activity,
  Bot,
  HeartPulse,
  History,
  LogOut,
  Mail,
  Megaphone,
  Settings2,
  UsersRound,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import SettingsPage from '@/pages/Settings';
import AdminControl from '@/pages/AdminControl';
import UniversalAuditTrail from '@/pages/UniversalAuditTrail';
import FcosUpdatesPanel from '@/components/admin/FcosUpdatesPanel';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SETTINGS_METHODOLOGIES } from '@/lib/pageMethodologies';
import { APP_VERSION } from '@/lib/appVersionMeta';

const SECTION_GROUPS = [
  {
    id: 'personal',
    label: 'Personal',
    sections: [
      { id: 'my', label: 'My Settings', description: 'Workspace, tables, navigation and documents', icon: Settings2, access: 'all' },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    sections: [
      { id: 'people', label: 'People & Access', description: 'Users, permissions and reporting lines', icon: UsersRound, access: 'administrator' },
      { id: 'email-delivery', label: 'Email Delivery', description: 'Graph mailboxes and email purposes', icon: Mail, access: 'administrator' },
      { id: 'ai', label: 'AI Models', description: 'Models, tokens and estimated cost', icon: Bot, access: 'ai' },
      { id: 'updates', label: 'FCOS Updates', description: 'Draft, review and send product updates', icon: Megaphone, access: 'administrator' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    sections: [
      { id: 'health', label: 'System Health', description: 'Services, KPIs and provider connections', icon: HeartPulse, access: 'all' },
      { id: 'audit', label: 'Audit Trail', description: 'Redacted operational history', icon: History, access: 'administrator' },
    ],
  },
];

function normalizeLegacySection(section, panel) {
  if (section === 'users') return 'people';
  if (section === 'system') {
    if (panel === 'email') return 'email-delivery';
    if (panel === 'ai') return 'ai';
    if (panel === 'health') return 'health';
    return 'my';
  }
  return section || 'my';
}

function FcosUpdatesSection({ methodologyAction }) {
  return (
    <div className="workspace-administration-canvas mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={Megaphone}
        eyebrow="Administration"
        title="FCOS Updates"
        description="Prepare and control internal release communications independently from user access settings."
        actions={methodologyAction}
      />
      <div className="mt-5">
        <FcosUpdatesPanel />
      </div>
    </div>
  );
}

export default function SettingsWorkspace() {
  const { isAdministrator, hasCapability, hasModuleAccess } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedRaw = searchParams.get('section');
  const panel = searchParams.get('panel');
  const requested = normalizeLegacySection(requestedRaw, panel);

  const availableGroups = useMemo(() => SECTION_GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter((section) => {
      if (section.access === 'all') return true;
      if (section.access === 'administrator') return isAdministrator;
      if (section.access === 'ai') return isAdministrator || hasCapability('hedge_admin');
      return false;
    }),
  })).filter((group) => group.sections.length), [hasCapability, isAdministrator]);
  const available = availableGroups.flatMap((group) => group.sections);
  const active = available.some((section) => section.id === requested) ? requested : 'my';
  const activeMethodology = SETTINGS_METHODOLOGIES[active] || SETTINGS_METHODOLOGIES.my;
  const methodologyAction = <PageMethodology key={active} {...activeMethodology} />;

  useEffect(() => {
    if (requestedRaw === 'system' && panel === 'email-router') {
      navigate('/email-router?tab=routing-setup', { replace: true });
      return;
    }
    if (requestedRaw === 'system' && panel === 'hedge-desk') {
      navigate('/hedge-desk?tab=administration', { replace: true });
      return;
    }
    if (requestedRaw === 'system' && panel === 'exchange') {
      navigate('/brokers?tab=configuration', { replace: true });
      return;
    }
    if (requestedRaw !== active || panel) {
      const next = new URLSearchParams();
      next.set('section', active);
      setSearchParams(next, { replace: true });
    }
  }, [active, navigate, panel, requestedRaw, setSearchParams]);

  const changeSection = (section) => {
    const next = new URLSearchParams();
    next.set('section', section);
    setSearchParams(next, { replace: true });
  };

  const openVersionAudit = () => window.dispatchEvent(new CustomEvent('fcos:version-audit-open'));
  const requestSignOut = () => window.dispatchEvent(new CustomEvent('fcos:sign-out-requested'));

  return (
    <div className="workspace-administration min-h-full lg:grid lg:grid-cols-[212px_minmax(0,1fr)]">
      <aside className="app-navigation-material settings-navigation flex flex-col border-b border-border p-3 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:p-4">
        <div className="mb-4 hidden items-center gap-2 px-2 lg:flex">
          <Activity className="h-4 w-4 text-blue-700" />
          <span className="text-sm font-semibold">Settings</span>
        </div>

        <div className="lg:hidden">
          <Select value={active} onValueChange={changeSection}>
            <SelectTrigger aria-label="Settings section"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableGroups.map((group) => group.sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>{group.label} · {section.label}</SelectItem>
              )))}
            </SelectContent>
          </Select>
        </div>

        <nav className="hidden space-y-5 lg:block lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-label="Settings sections">
          {availableGroups.map((group) => (
            <div key={group.id}>
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</div>
              <div className="space-y-1">
                {group.sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <Button key={section.id} type="button" variant={active === section.id ? 'secondary' : 'ghost'} className="h-9 w-full justify-start gap-2.5 px-3 text-left" onClick={() => changeSection(section.id)} title={section.description}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate text-sm font-medium">{section.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-5 hidden border-t border-border pt-4 lg:block">
          <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Related workflow settings</div>
          <div className="mt-1 space-y-1 text-xs">
            {hasModuleAccess('email_router') && isAdministrator && <Link className="block rounded px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" to="/email-router?tab=routing-setup">Email Router setup</Link>}
            {hasModuleAccess('brokers') && hasCapability('broker_settings_manage') && <Link className="block rounded px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" to="/brokers?tab=configuration">Broker configuration</Link>}
            {hasModuleAccess('hedge_desk') && hasCapability('hedge_admin') && <Link className="block rounded px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" to="/hedge-desk?tab=administration">Hedge Desk administration</Link>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 lg:mt-auto lg:block lg:space-y-1">
          <Button type="button" variant="ghost" className="h-9 w-full justify-start gap-2 px-3 text-xs font-medium" onClick={openVersionAudit} title="Open Version Audit Trail">
            <History className="h-4 w-4 shrink-0" />
            <span className="truncate">Version {APP_VERSION}</span>
          </Button>
          <Button type="button" variant="ghost" className="h-9 w-full justify-start gap-2 px-3 text-xs font-medium text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/50 dark:hover:text-red-200" onClick={requestSignOut}>
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Sign out</span>
          </Button>
        </div>
      </aside>

      <main className="settings-content min-w-0">
        {active === 'my' && <SettingsPage section="my" methodologyAction={methodologyAction} />}
        {active === 'people' && <AdminControl methodologyAction={methodologyAction} />}
        {active === 'email-delivery' && <SettingsPage section="email-delivery" methodologyAction={methodologyAction} />}
        {active === 'ai' && <SettingsPage section="ai" methodologyAction={methodologyAction} />}
        {active === 'updates' && <FcosUpdatesSection methodologyAction={methodologyAction} />}
        {active === 'health' && <SettingsPage section="health" methodologyAction={methodologyAction} />}
        {active === 'audit' && <UniversalAuditTrail methodologyAction={methodologyAction} />}
      </main>
    </div>
  );
}
