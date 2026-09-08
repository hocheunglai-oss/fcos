import { QueryClient } from '@tanstack/react-query';
import { onClientSessionReset } from './clientSessionState.js';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});
onClientSessionReset(() => queryClientInstance.clear());
