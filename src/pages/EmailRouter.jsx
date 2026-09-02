import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import EmailRouterWorkspace from '@/components/email-router/EmailRouterWorkspace';
import { useAuth } from '@/lib/AuthContext';

export default function EmailRouter() {
  const { isAdministrator } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const setupRequested = searchParams.get('tab') === 'routing-setup' && isAdministrator;
  const [settingsOpen, setSettingsOpen] = useState(setupRequested);

  useEffect(() => {
    if (setupRequested) setSettingsOpen(true);
  }, [setupRequested]);

  const changeSettingsOpen = (open) => {
    setSettingsOpen(open);
    const next = new URLSearchParams(searchParams);
    if (open) next.set('tab', 'routing-setup');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="workspace-tools p-4 lg:p-6">
      <EmailRouterWorkspace settingsOpen={settingsOpen} onSettingsOpenChange={changeSettingsOpen} />
    </div>
  );
}
