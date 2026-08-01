import { Activity, History, Settings2, UsersRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import SettingsPage from '@/pages/Settings';
import AdminControl from '@/pages/AdminControl';
import UniversalAuditTrail from '@/pages/UniversalAuditTrail';
import { Button } from '@/components/ui/button';
import PageMethodology from '@/components/common/PageMethodology';
import { SETTINGS_METHODOLOGIES } from '@/lib/pageMethodologies';

const SECTIONS = [
  { id: 'system', label: 'System Settings', description: 'Email, rates, documents, AI and health', icon: Settings2, moduleId: 'settings' },
  { id: 'users', label: 'Users & Access', description: 'People, permissions and reporting lines', icon: UsersRound, moduleId: 'admin' },
  { id: 'audit', label: 'Audit Trail', description: 'Redacted operational history', icon: History, moduleId: 'admin' },
];

export default function SettingsWorkspace() {
  const { hasModuleAccess } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const available = SECTIONS.filter((section) => hasModuleAccess(section.moduleId));
  const requested = searchParams.get('section');
  const active = available.some((section) => section.id === requested) ? requested : available[0]?.id || 'system';
  const activeMethodology = SETTINGS_METHODOLOGIES[active] || SETTINGS_METHODOLOGIES.system;
  const methodologyAction = <PageMethodology key={active} {...activeMethodology} />;

  const changeSection = (section) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', section);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="min-h-full bg-slate-50 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 bg-white p-3 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:p-4">
        <div className="mb-3 hidden items-center gap-2 px-2 lg:flex">
          <Activity className="h-4 w-4 text-blue-700" />
          <span className="text-sm font-semibold">Settings</span>
        </div>
        <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
          {available.map((section) => {
            const Icon = section.icon;
            return (
              <Button key={section.id} type="button" variant={active === section.id ? 'secondary' : 'ghost'} className="h-auto shrink-0 justify-start gap-3 px-3 py-2 text-left lg:w-full" onClick={() => changeSection(section.id)}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{section.label}</span>
                  <span className="hidden truncate text-[11px] font-normal text-muted-foreground lg:block">{section.description}</span>
                </span>
              </Button>
            );
          })}
        </div>
      </aside>
      <div className="min-w-0">
        {active === 'system' && <SettingsPage methodologyAction={methodologyAction} />}
        {active === 'users' && <AdminControl methodologyAction={methodologyAction} />}
        {active === 'audit' && <UniversalAuditTrail methodologyAction={methodologyAction} />}
      </div>
    </div>
  );
}
