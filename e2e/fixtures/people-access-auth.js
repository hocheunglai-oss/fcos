export function useAuth() { return { user: { id: 'admin' }, isSupabaseConfigured: true, authMode: 'supabase', isAdministrator: true, hasModuleAccess: () => true, hasCapability: () => true }; }
export function AuthProvider({ children }) { return children; }
