import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { FULL_ACCESS, isAdministratorUserType } from '@/lib/authModules';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { appClient } from '@/api/appClient';

const AuthContext = createContext();

const LOCAL_ADMIN_USER = {
  id: 'local-admin',
  full_name: 'Vincent',
  email: 'vincent@cosulich.com.hk',
  role: 'admin',
  user_type: 'administrator',
  active: true,
};

const REPORT_ARCHIVE_MODULE_ID = 'report_archive';
const LOCAL_APPLICATIONS = [
  {
    id: 'fcos',
    name: 'FCOS',
    description: 'Trading, operations, finance, and management workflows.',
    iconKey: 'fcos',
    kind: 'internal',
    launchPath: '/',
    openMode: 'same_tab',
    roleId: 'member',
    roleLabel: 'Member',
    accessSource: 'module_access',
    status: 'active',
    available: true,
    blockingReason: null,
  },
  {
    id: 'emailrouter',
    name: 'EmailRouter',
    description: 'Human-controlled Microsoft 365 mailbox triage and routing.',
    iconKey: 'mail',
    kind: 'external',
    launchPath: null,
    openMode: 'new_tab',
    roleId: 'owner',
    roleLabel: 'Owner',
    accessSource: 'administrator_default',
    status: 'active',
    available: false,
    blockingReason: 'Secure launch is unavailable in local administrator mode.',
  },
];

function loginFailureMessage(error) {
  if (error?.type === 'user_inactive') return 'Your FCOS account is inactive.';
  if (error?.type === 'user_not_registered') return 'This account is not registered in FCOS.';
  if (error?.type === 'auth_required') return 'Your FCOS session could not be verified. Please sign in again.';
  return error?.message || 'FCOS could not verify your account.';
}

function fullAccessLevels() {
  return { [REPORT_ARCHIVE_MODULE_ID]: 'full' };
}

async function loadSupabaseUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData?.session) return {
    user: null,
    access: {},
    accessLevels: {},
    applications: [],
    error: { type: 'auth_required' },
  };

  const { data } = await appClient.functions.invoke('authContext', {}, { force: true });
  if (data?.error) {
    const message = String(data.error || 'Unable to verify your account.');
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes('inactive')) {
      return { user: null, access: {}, accessLevels: {}, error: { type: 'user_inactive' } };
    }
    if (normalizedMessage.includes('not registered')) {
      return { user: null, access: {}, accessLevels: {}, error: { type: 'user_not_registered' } };
    }
    if (normalizedMessage.includes('sign-in required') || normalizedMessage.includes('expired session')) {
      return { user: null, access: {}, accessLevels: {}, error: { type: 'auth_required' } };
    }
    throw new Error(message);
  }
  if (!data?.user) throw new Error('Unable to verify your account.');
  return {
    user: data.user,
    access: data.moduleAccess || {},
    accessLevels: data.moduleAccessLevels || {},
    applications: data.applications || [],
    error: null,
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [moduleAccess, setModuleAccess] = useState({});
  const [moduleAccessLevels, setModuleAccessLevels] = useState({});
  const [applications, setApplications] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const authMode = isSupabaseConfigured ? 'supabase' : 'local';

  const applyLocalAdmin = useCallback(() => {
    setUser(LOCAL_ADMIN_USER);
    setModuleAccess(FULL_ACCESS);
    setModuleAccessLevels(fullAccessLevels());
    setApplications(LOCAL_APPLICATIONS);
    setIsAuthenticated(true);
    setAuthError(null);
    setAuthChecked(true);
    setIsLoadingAuth(false);
  }, []);

  const checkUserAuth = useCallback(async ({ showLoader = true } = {}) => {
    if (showLoader) setIsLoadingAuth(true);
    setAuthError(null);
    try {
      if (!isSupabaseConfigured) {
        applyLocalAdmin();
        return { user: LOCAL_ADMIN_USER, error: null };
      }
      const result = await loadSupabaseUser();
      setUser(result.user);
      setModuleAccess(result.access || {});
      setModuleAccessLevels(result.accessLevels || {});
      setApplications(result.applications || []);
      setIsAuthenticated(Boolean(result.user));
      setAuthError(result.error);
      setAuthChecked(true);
      return result;
    } catch (error) {
      const nextError = { type: 'local_auth_error', message: error.message };
      setUser(null);
      setModuleAccess({});
      setModuleAccessLevels({});
      setApplications([]);
      setAuthError(nextError);
      setIsAuthenticated(false);
      setAuthChecked(true);
      return { user: null, error: nextError };
    } finally {
      if (showLoader) setIsLoadingAuth(false);
    }
  }, [applyLocalAdmin]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      appClient.functions.clearCache();
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setModuleAccess({});
        setModuleAccessLevels({});
        setApplications([]);
        setIsAuthenticated(false);
        setAuthError({ type: 'auth_required' });
        setAuthChecked(true);
        setIsLoadingAuth(false);
        return;
      }
      window.setTimeout(() => checkUserAuth({ showLoader: false }), 0);
    });
    return () => data?.subscription?.unsubscribe();
  }, [checkUserAuth]);

  const login = async (email, password) => {
    if (!isSupabaseConfigured) {
      applyLocalAdmin();
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const result = await checkUserAuth({ showLoader: true });
    if (!result?.user) throw new Error(loginFailureMessage(result?.error));
  };

  const refreshApplications = async () => {
    if (!isSupabaseConfigured) {
      setApplications(LOCAL_APPLICATIONS);
      return LOCAL_APPLICATIONS;
    }
    const { data } = await appClient.functions.invoke('portalApplicationsList', {}, { force: true });
    if (data?.error) throw new Error(data.error);
    const next = data?.applications || [];
    setApplications(next);
    return next;
  };

  const launchApplication = async (application) => {
    if (!application) throw new Error('Application is required.');
    if (application.kind === 'internal') return { launchPath: application.launchPath || '/' };
    if (!application.available) throw new Error(application.blockingReason || 'Application unavailable.');

    const launchWindow = window.open('about:blank', '_blank');
    if (launchWindow) {
      launchWindow.opener = null;
      launchWindow.document.title = `Opening ${application.name}`;
      launchWindow.document.body.textContent = `Opening ${application.name}...`;
    }
    try {
      const { data } = await appClient.functions.invoke('portalApplicationLaunch', {
        applicationId: application.id,
      }, { force: true });
      if (data?.error) throw new Error(data.error);
      if (!data?.launchUrl) throw new Error('The application did not return a launch address.');
      if (launchWindow) {
        launchWindow.location.replace(data.launchUrl);
        return { opened: true };
      }
      return { launchUrl: data.launchUrl, popupBlocked: true };
    } catch (error) {
      launchWindow?.close();
      await refreshApplications().catch(() => {});
      throw error;
    }
  };

  const logout = async () => {
    appClient.functions.clearCache();
    let portalFailures = [];
    if (isSupabaseConfigured && isAuthenticated) {
      try {
        const { data } = await appClient.functions.invoke('portalSignOut', {}, { force: true });
        portalFailures = data?.failures || (data?.error ? [{ applicationId: 'portal', message: data.error }] : []);
      } catch (error) {
        portalFailures = [{
          applicationId: 'portal',
          message: error.message || 'Application sessions could not be revoked.',
        }];
      }
      if (portalFailures.length) {
        window.sessionStorage.setItem('fcos:portal-logout-warning', JSON.stringify(portalFailures));
      } else {
        window.sessionStorage.removeItem('fcos:portal-logout-warning');
      }
    }
    if (isSupabaseConfigured) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {
        window.sessionStorage.setItem('fcos:portal-logout-warning', JSON.stringify([
          ...portalFailures,
          { applicationId: 'fcos', message: 'The server-side FCOS session could not be revoked.' },
        ]));
      });
    }
    setUser(null);
    setModuleAccess({});
    setModuleAccessLevels({});
    setApplications([]);
    setIsAuthenticated(false);
    setAuthChecked(true);
    if (!isSupabaseConfigured) applyLocalAdmin();
    return { failures: portalFailures };
  };

  const navigateToLogin = () => checkUserAuth({ showLoader: true });
  const checkAppState = () => checkUserAuth({ showLoader: false });
  const hasModuleAccess = useCallback((moduleId) => {
    if (!moduleId) return true;
    if (isAdministratorUserType(user?.user_type)) return true;
    return moduleAccess[moduleId] === true;
  }, [moduleAccess, user?.user_type]);
  const isAdministrator = isAdministratorUserType(user?.user_type);

  const value = {
    user,
    moduleAccess,
    moduleAccessLevels,
    applications,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings: { id: 'fcos', public_settings: {} },
    authChecked,
    authMode,
    isSupabaseConfigured,
    isAdministrator,
    login,
    logout,
    navigateToLogin,
    checkUserAuth,
    checkAppState,
    hasModuleAccess,
    refreshApplications,
    launchApplication,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
