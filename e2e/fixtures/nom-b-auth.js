export function useAuth() { return { user: window.nomBFixture.user, isAdministrator: false, canAccessModule: () => true, hasCapability: () => true }; }
export function AuthProvider({ children }) { return children; }
