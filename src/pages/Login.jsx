import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Boxes, Loader2, LockKeyhole, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

function safeLocalReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : null;
  } catch {
    return null;
  }
}

export default function Login() {
  const location = useLocation();
  const {
    isAuthenticated,
    login,
    loginWithFcuno,
    isSupabaseConfigured: supabaseReady,
    authMode,
    authError,
    fcunoOidcEnabled,
    legacyPasswordLoginEnabled,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logoutWarning, setLogoutWarning] = useState('');
  const [federatedReturnTo] = useState(() => safeLocalReturnTo(
    window.sessionStorage.getItem('fcos:fcuno-return-to'),
  ));
  const contextError = authError?.type === 'user_inactive'
    ? 'Your FCOS account is inactive.'
    : authError?.type === 'user_not_registered'
      ? 'This account is not registered in FCOS.'
      : authError?.type === 'local_auth_error'
        ? authError.message
        : '';
  const visibleError = error || contextError;

  useEffect(() => {
    document.title = 'Sign in · FCOS';
    const rawWarning = window.sessionStorage.getItem('fcos:portal-logout-warning');
    if (rawWarning) {
      setLogoutWarning('FCOS signed out, but one application did not confirm session closure. Close any remaining application tabs.');
      window.sessionStorage.removeItem('fcos:portal-logout-warning');
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) window.sessionStorage.removeItem('fcos:fcuno-return-to');
  }, [isAuthenticated]);

  if (isAuthenticated) {
    const from = location.state?.from;
    const stateReturnTo = from
      ? `${from.pathname || '/'}${from.search || ''}${from.hash || ''}`
      : null;
    const returnTo = safeLocalReturnTo(stateReturnTo) || federatedReturnTo || '/';
    return <Navigate to={returnTo} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithFcuno = async () => {
    setError('');
    setSubmitting(true);
    try {
      const from = location.state?.from;
      const returnTo = from
        ? `${from.pathname || '/'}${from.search || ''}${from.hash || ''}`
        : '/';
      await loginWithFcuno(returnTo);
    } catch (err) {
      setError(err.message || 'FCUNO sign-in could not be started.');
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-md border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-slate-950 text-white">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-950">FCOS</div>
              <div className="text-xs text-slate-500">Operations workspace</div>
            </div>
          </div>
          <h1 className="text-xl font-semibold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">{fcunoOidcEnabled ? 'Continue with your FCUNO identity.' : 'Use your existing FCOS account.'}</p>
        </div>

        {logoutWarning && (
          <div className="mb-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{logoutWarning}</span>
          </div>
        )}

        {!supabaseReady && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            Supabase is not configured yet. The app is currently running in local administrator mode.
          </div>
        )}

        {visibleError && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{visibleError}</div>}

        {authMode === 'local' ? (
          <Navigate to="/" replace />
        ) : (
          <>
            {fcunoOidcEnabled && (
              <button
                type="button"
                disabled={submitting}
                onClick={signInWithFcuno}
                className="flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><LockKeyhole className="h-4 w-4" /> Continue with FCUNO</>}
              </button>
            )}

            {fcunoOidcEnabled && legacyPasswordLoginEnabled && <div className="my-4 border-t border-slate-200" />}

            {(!fcunoOidcEnabled || legacyPasswordLoginEnabled) && <form onSubmit={submit}>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                autoComplete="email"
                required
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><LockKeyhole className="h-4 w-4" /> Sign in</>}
            </button>
            </form>}

            {fcunoOidcEnabled && !legacyPasswordLoginEnabled && (
              <p className="mt-3 text-xs text-muted-foreground">FCOS password sign-in is available only to explicitly configured pilot or break-glass accounts.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
