import { FCOS_CONNECTION_POLICY } from './fcosConnections.js';

// Non-secret, explicitly approved automation identity. Email delivery aliases
// never establish identity: issuer AND immutable FCUNO subject must match.
export const FCOS_READ_ONLY_CI = Object.freeze({
  issuer: FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer,
  provider: FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.oidcProvider,
  subject: '861f20db-65a4-45ab-bf5a-1d02b92c7243',
  email: 'it@cosulich.com.hk',
  modules: Object.freeze(['dashboard', 'markets']),
});
