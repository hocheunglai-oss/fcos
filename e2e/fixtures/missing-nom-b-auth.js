export function useAuth() {
  return {
    user: window.missingNomBFixture?.user || { id: 'fixture-trader', email: 'ada@example.invalid' },
    isAdministrator: false,
    canAccessModule: () => true,
    hasModuleAccess: () => true,
    hasCapability: () => true,
  };
}

export function AuthProvider({ children }) { return children; }
