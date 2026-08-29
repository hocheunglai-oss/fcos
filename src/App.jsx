import { Toaster } from "@/components/ui/toaster"
import { lazy, Suspense, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query'
import { SpeedInsights } from '@vercel/speed-insights/react';
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ModuleGate from '@/components/ModuleGate';
import ModuleGateAny from '@/components/ModuleGateAny';
import Layout from '@/components/Layout';

const DashboardSettings = lazy(() => import('@/pages/DashboardSettings'));
const AccountInsight = lazy(() => import('@/pages/AccountInsight'));
const StemPnlReport = lazy(() => import('@/pages/StemPnlReport'));
const BrokerWorkspace = lazy(() => import('@/pages/BrokerWorkspace'));
const ReviewQueue = lazy(() => import('@/pages/ReviewQueue'));
const PaymentCollections = lazy(() => import('@/pages/PaymentCollections'));
const UnofficialCompensation = lazy(() => import('@/pages/UnofficialCompensation'));
const CashflowForecast = lazy(() => import('@/pages/CashflowForecast'));
const DisputeWorkflow = lazy(() => import('@/pages/DisputeWorkflow'));
const Login = lazy(() => import('@/pages/Login'));
const SettingsWorkspace = lazy(() => import('@/pages/SettingsWorkspace'));
const AccountManagers = lazy(() => import('@/pages/AccountManagers'));
const ProjectsTasks = lazy(() => import('@/pages/ProjectsTasks'));
const FcosImprovements = lazy(() => import('@/pages/FcosImprovements'));
const GrowthCoaching = lazy(() => import('@/pages/GrowthCoaching'));
const MyCommitments = lazy(() => import('@/pages/MyCommitments'));
const HedgeDesk = lazy(() => import('@/pages/HedgeDesk'));
const Markets = lazy(() => import('@/pages/Markets'));
const SpecialTerms = lazy(() => import('@/pages/SpecialTerms'));
const SpecialTermEditor = lazy(() => import('@/pages/SpecialTermEditor'));
const EmailRouter = lazy(() => import('@/pages/EmailRouter'));
const MasterContracts = lazy(() => import('@/pages/MasterContracts'));
const XeroPortal = lazy(() => import('@/pages/XeroPortal'));

function RouteLoader() {
  return <div className="fixed inset-0 flex items-center justify-center" role="status" aria-live="polite"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary" aria-hidden="true" /><span className="sr-only">Loading workspace</span></div>;
}

function AuthErrorScreen({ authError }) {
  if (authError?.type === 'user_not_registered') return <UserNotRegisteredError />;
  if (authError?.type === 'user_inactive') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">User Disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your account is disabled. Contact an administrator to restore access.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Authentication Error</h1>
        <p className="mt-2 text-sm text-muted-foreground">{authError?.message || 'Unable to verify your account.'}</p>
      </div>
    </div>
  );
}

const AuthenticatedApp = () => {
  const location = useLocation();
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();
  const loginRedirectState = location.pathname === '/' ? undefined : { from: location };


  if (isLoadingPublicSettings || (isLoadingAuth && !isAuthenticated)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary" aria-hidden="true" />
        <span className="sr-only">Loading FCOS</span>
      </div>
    );
  }

  return (
    <Suspense fallback={<RouteLoader />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      {authError?.type === 'auth_required' && (
        <Route path="*" element={<Navigate to="/login" replace state={loginRedirectState} />} />
      )}
      {authError && authError.type !== 'auth_required' && (
        <Route path="*" element={<AuthErrorScreen authError={authError} />} />
      )}
      {!authError && !isAuthenticated && (
        <Route path="*" element={<Navigate to="/login" replace state={loginRedirectState} />} />
      )}
      {!authError && isAuthenticated && (
        <>
          <Route path="/apps" element={<Navigate to="/" replace />} />
          <Route path="/v2/*" element={<RedirectLegacyWorkspace />} />
          <Route element={<Layout />}>
            <Route path="/my-commitments" element={<MyCommitments />} />
            <Route path="/growth-coaching" element={<GrowthCoaching />} />
            <Route path="/projects-tasks" element={<ProjectsTasks />} />
            <Route path="/fcos-improvements" element={<FcosImprovements />} />
            <Route path="/email-router" element={<ModuleGate moduleId="email_router"><EmailRouter /></ModuleGate>} />
            <Route path="/" element={<ModuleGate moduleId="dashboard"><DashboardSettings /></ModuleGate>} />
            <Route path="/accounts/:accountId" element={<ModuleGate moduleId="dashboard"><AccountInsight /></ModuleGate>} />
            <Route path="/settings" element={<SettingsWorkspace />} />
            <Route path="/pnl" element={<ModuleGate moduleId="pnl"><StemPnlReport /></ModuleGate>} />
            <Route path="/review" element={<ModuleGate moduleId="review"><ReviewQueue /></ModuleGate>} />
            <Route path="/disputes" element={<ModuleGate moduleId="disputes"><DisputeWorkflow /></ModuleGate>} />
            <Route path="/disputes-beta" element={<Navigate to="/disputes" replace />} />
            <Route path="/payment-collections" element={<ModuleGateAny moduleIds={['buyer_invoices', 'incoming_payments']}><PaymentCollections /></ModuleGateAny>} />
            <Route path="/unofficial-compensation" element={<ModuleGate moduleId="unofficial_compensation"><UnofficialCompensation /></ModuleGate>} />
            <Route path="/buyer-invoices" element={<RedirectWithTab path="/payment-collections" tab="collections" />} />
            <Route path="/incoming-payments" element={<RedirectWithTab path="/payment-collections" tab="incoming" />} />
            <Route path="/cashflow-forecast" element={<ModuleGate moduleId="cashflow_forecast"><CashflowForecast /></ModuleGate>} />
            <Route path="/brokers" element={<ModuleGateAny moduleIds={['brokers', 'report_archive']}><BrokerWorkspace /></ModuleGateAny>} />
            <Route path="/report-archive" element={<RedirectWithTab path="/brokers" tab="archive" />} />
            <Route path="/account-managers" element={<ModuleGate moduleId="buyers_administrator"><AccountManagers /></ModuleGate>} />
            <Route path="/master-contracts" element={<ModuleGate moduleId="master_contracts"><MasterContracts /></ModuleGate>} />
            <Route path="/markets" element={<ModuleGate moduleId="markets"><Markets /></ModuleGate>} />
            <Route path="/special-terms" element={<ModuleGate moduleId="special_terms"><SpecialTerms /></ModuleGate>} />
            <Route path="/special-terms/:termId" element={<ModuleGate moduleId="special_terms"><SpecialTermEditor /></ModuleGate>} />
            <Route path="/hedge-desk" element={<ModuleGate moduleId="hedge_desk"><HedgeDesk /></ModuleGate>} />
            <Route path="/xero-portal" element={<ModuleGate moduleId="xero_portal"><XeroPortal /></ModuleGate>} />
            <Route path="/buyers-administrator" element={<Navigate to="/account-managers" replace />} />
            <Route path="/audit-trail" element={<RedirectWithSection section="audit" />} />
            <Route path="/admin" element={<RedirectWithSection section="people" />} />
            <Route path="*" element={<PageNotFound />} />
          </Route>
        </>
      )}
    </Routes>
    </Suspense>
  );
};

function RedirectLegacyWorkspace() {
  const location = useLocation();
  const canonicalPath = location.pathname.replace(/^\/v2(?=\/|$)/, '') || '/';
  return <Navigate to={`${canonicalPath}${location.search}${location.hash}`} replace />;
}

function RedirectWithTab({ path, tab }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', tab);
  return <Navigate to={`${path}?${params.toString()}${location.hash}`} replace />;
}

function RedirectWithSection({ section }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('section', section);
  return <Navigate to={`/settings?${params.toString()}${location.hash}`} replace />;
}

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
          <Toaster />
          <SpeedInsights />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
