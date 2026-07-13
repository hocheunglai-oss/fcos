import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FULL_ACCESS } from '@/lib/authModules';
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

function fullAccessLevels() {
  return { [REPORT_ARCHIVE_MODULE_ID]: 'full' };
}

async function loadSupabaseUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData?.session) return { user: null, access: {}, accessLevels: {}, error: { type: 'auth_required' } };

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
    error: null,
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [moduleAccess, setModuleAccess] = useState({});
  const [moduleAccessLevels, setModuleAccessLevels] = useState({});
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
        return;
      }
      const result = await loadSupabaseUser();
      setUser(result.user);
      setModuleAccess(result.access || {});
      setModuleAccessLevels(result.accessLevels || {});
      setIsAuthenticated(Boolean(result.user));
      setAuthError(result.error);
      setAuthChecked(true);
    } catch (error) {
      setUser(null);
      setModuleAccess({});
      setModuleAccessLevels({});
      setAuthError({ type: 'local_auth_error', message: error.message });
      setIsAuthenticated(false);
      setAuthChecked(true);
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
    await checkUserAuth({ showLoader: true });
  };

  const logout = async () => {
    appClient.functions.clearCache();
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(null);
    setModuleAccess({});
    setModuleAccessLevels({});
    setIsAuthenticated(false);
    setAuthChecked(true);
    if (!isSupabaseConfigured) applyLocalAdmin();
  };

  const navigateToLogin = () => checkUserAuth({ showLoader: true });
  const checkAppState = () => checkUserAuth({ showLoader: false });
  const hasModuleAccess = useCallback((moduleId) => {
    if (!moduleId) return true;
    if (user?.user_type === 'administrator') return true;
    return moduleAccess[moduleId] === true;
  }, [moduleAccess, user?.user_type]);
  const isAdministrator = user?.user_type === 'administrator';

  const value = useMemo(() => ({
    user,
    moduleAccess,
    moduleAccessLevels,
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
  }), [
    user,
    moduleAccess,
    moduleAccessLevels,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    authChecked,
    authMode,
    isAdministrator,
    hasModuleAccess,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
