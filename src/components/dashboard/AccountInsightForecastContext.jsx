import { createContext, useContext } from 'react';

export const AccountInsightForecastContext = createContext(null);

export function useAccountInsightForecastChange() {
  return useContext(AccountInsightForecastContext);
}
