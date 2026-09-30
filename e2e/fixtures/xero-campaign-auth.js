export function useAuth() { return { user: { id: 'operator-1', email: 'operator@example.invalid' } }; }
export function AuthProvider({ children }) { return children; }
