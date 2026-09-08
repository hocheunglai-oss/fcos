import { createContext, useContext } from 'react';

export const AccountInsightStatementScopeContext = createContext(null);

export function useAccountInsightStatementScopeChange() {
  return useContext(AccountInsightStatementScopeContext);
}
