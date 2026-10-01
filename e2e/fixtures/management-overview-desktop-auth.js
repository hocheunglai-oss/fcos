const visibleModules = new Set(['incoming_payments']);

export function useAuth() {
  return {
    user: { id: 'fixture-read-only-user', email: 'reader@example.invalid', read_only_ci: true },
    hasModuleAccess: (moduleId) => visibleModules.has(moduleId),
  };
}
