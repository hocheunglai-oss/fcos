import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import PageMethodology from '@/components/common/PageMethodology';
import { APP_PORTAL_METHODOLOGY } from '@/lib/pageMethodologies';

const APPLICATION_ICONS = {
  fcos: LayoutDashboard,
  mail: Mail,
};

function ApplicationCard({ application, launching, onLaunch }) {
  const Icon = APPLICATION_ICONS[application.iconKey] || Boxes;
  const unavailable = !application.available;

  return (
    <article className="flex min-h-[250px] flex-col border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-md ${
          application.id === 'emailrouter'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-blue-50 text-blue-700'
        }`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
          unavailable ? 'text-amber-700' : 'text-emerald-700'
        }`}>
          <span className={`h-2 w-2 rounded-full ${unavailable ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          {unavailable ? 'Unavailable' : 'Available'}
        </div>
      </div>

      <div className="mt-5 min-w-0">
        <h2 className="text-lg font-semibold text-slate-950">{application.name}</h2>
        <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{application.description}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-medium">
          {application.roleLabel || 'Member'}
        </span>
        {application.openMode === 'new_tab' && (
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="h-3.5 w-3.5" />
            Opens in new tab
          </span>
        )}
      </div>

      {application.blockingReason && (
        <div className="mt-4 flex gap-2 text-xs leading-5 text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{application.blockingReason}</span>
        </div>
      )}

      <div className="mt-auto pt-5">
        <Button
          type="button"
          className="w-full justify-between"
          disabled={unavailable || launching}
          onClick={() => onLaunch(application)}
        >
          <span>{launching ? `Opening ${application.name}` : `Open ${application.name}`}</span>
          {launching
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : application.openMode === 'new_tab'
              ? <ExternalLink className="h-4 w-4" />
              : <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
    </article>
  );
}

export default function AppPortal() {
  const navigate = useNavigate();
  const {
    user,
    applications,
    launchApplication,
    logout,
    refreshApplications,
  } = useAuth();
  const [launchingId, setLaunchingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [fallbackLaunch, setFallbackLaunch] = useState(null);

  useEffect(() => {
    document.title = 'Applications · FCOS';
  }, []);

  const openApplication = async (application) => {
    setError('');
    setFallbackLaunch(null);
    if (application.kind === 'internal') {
      navigate(application.launchPath || '/');
      return;
    }
    setLaunchingId(application.id);
    try {
      const result = await launchApplication(application);
      if (result?.popupBlocked && result.launchUrl) {
        setFallbackLaunch({ name: application.name, url: result.launchUrl });
      }
    } catch (launchError) {
      setError(launchError.message || `${application.name} could not be opened.`);
    } finally {
      setLaunchingId(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await refreshApplications();
    } catch (refreshError) {
      setError(refreshError.message || 'Applications could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setError('');
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError.message || 'Sign out could not be completed.');
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-950 text-white">
              <Boxes className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">FCOS</div>
              <div className="truncate text-xs text-slate-500">Application portal</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PageMethodology {...APP_PORTAL_METHODOLOGY} size="sm" />
            <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={refreshing} title="Refresh applications">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh applications</span>
            </Button>
            <Button type="button" variant="outline" onClick={signOut} disabled={signingOut}>
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
              <ShieldCheck className="h-4 w-4" />
              Signed in as {user?.full_name || user?.email}
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">Applications</h1>
            <p className="mt-1 text-sm text-slate-600">Open the workspaces assigned to your account.</p>
          </div>
          <div className="text-xs text-slate-500">
            {applications.length} application{applications.length === 1 ? '' : 's'} assigned
          </div>
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-3 border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {fallbackLaunch && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <span>Your browser blocked the new tab.</span>
            <Button asChild size="sm">
              <a href={fallbackLaunch.url} target="_blank" rel="noreferrer">
                Open {fallbackLaunch.name}
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        )}

        {applications.length ? (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Assigned applications">
            {applications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                launching={launchingId === application.id}
                onLaunch={openApplication}
              />
            ))}
          </section>
        ) : (
          <section className="mt-6 border border-slate-200 bg-white p-8 text-center">
            <Boxes className="mx-auto h-6 w-6 text-slate-400" />
            <h2 className="mt-3 text-sm font-semibold text-slate-950">No applications assigned</h2>
            <p className="mt-1 text-sm text-slate-600">Contact an FCOS administrator to request access.</p>
          </section>
        )}
      </main>
    </div>
  );
}
