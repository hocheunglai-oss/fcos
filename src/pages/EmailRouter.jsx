import { MailSearch, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import EmailRouterWorkspace from '@/components/email-router/EmailRouterWorkspace';
import EmailRouterSettings from '@/components/email-router/EmailRouterSettings';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { EMAIL_ROUTER_METHODOLOGY } from '@/lib/pageMethodologies';

export default function EmailRouter() {
  const { isAdministrator } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const activeTab = requested === 'routing-setup' && isAdministrator ? 'routing-setup' : 'mailbox';

  const changeTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'mailbox') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {isAdministrator && (
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          <Button type="button" size="sm" variant={activeTab === 'mailbox' ? 'secondary' : 'ghost'} onClick={() => changeTab('mailbox')} className="gap-2">
            <MailSearch className="h-4 w-4" /> Mailbox
          </Button>
          <Button type="button" size="sm" variant={activeTab === 'routing-setup' ? 'secondary' : 'ghost'} onClick={() => changeTab('routing-setup')} className="gap-2">
            <Settings2 className="h-4 w-4" /> Routing Setup
          </Button>
        </div>
      )}
      {activeTab === 'routing-setup' ? (
        <div>
          <PageHeader
            icon={Settings2}
            eyebrow="Email Router"
            title="Routing Setup"
            description="Manage the routing directory, groups, presets, leave schedules, and timed overrides."
            actions={<PageMethodology {...EMAIL_ROUTER_METHODOLOGY} />}
          />
          <div className="mt-5 rounded-lg border border-border bg-card p-4 lg:p-5"><EmailRouterSettings /></div>
        </div>
      ) : <EmailRouterWorkspace />}
    </div>
  );
}
