import { useCallback, useEffect, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { verifyExistingDraftExecutionGate } from '@/lib/xeroExistingDraftExecutionGate';
import XeroExistingDraftAuthorisation from './XeroExistingDraftAuthorisation';

export default function XeroExistingDraftAuthorisationPanel() {
  const { user, isAuthenticated, hasModuleAccess, hasCapability, deploymentMutationAllowed } = useAuth();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const permitted = isAuthenticated && user?.active === true && user?.read_only_ci !== true
    && hasModuleAccess('xero_portal') && hasCapability('xero_portal_manage') && deploymentMutationAllowed;
  const check = useCallback(async () => {
    setChecking(true);
    try {
      if (!permitted) throw new Error('Xero management access is unavailable.');
      const result = await verifyExistingDraftExecutionGate((...args) => appClient.functions.invoke(...args), user?.id);
      setVerified(true); setError(''); return result;
    } catch (failure) { setVerified(false); setError(failure.message); throw failure; }
    finally { setChecking(false); }
  }, [permitted, user?.id]);
  useEffect(() => { if (!permitted) setVerified(false); }, [permitted]);
  if (!permitted) return null;
  const show = async () => { if (checking || busy) return; try { await check(); setOpen(true); } catch { /* The held reason is displayed below. */ } };
  return <section className="hidden lg:block xi-card" aria-label="Existing draft status authorisation">
    <div className="xi-section-heading"><div><h2>Approved draft status authorisation</h2><p>Finance can run the fixed approved 54-record scope. Existing amounts and lines stay unchanged; PDFs remain unverified.</p></div>
      {open ? <Button variant="outline" disabled={checking || busy} onClick={() => { setOpen(false); setVerified(false); }}>Close status panel</Button>
        : <Button variant="outline" disabled={checking || busy} onClick={show}>{checking ? 'Checking access…' : 'Open approved drafts'}</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {open && <XeroExistingDraftAuthorisation disabled={!verified || checking || !permitted} beforeMutation={check} onBusyChange={setBusy} />}
  </section>;
}
