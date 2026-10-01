import { NOM_B_POLICY } from './businessPolicies.js';

export const NOM_B_MAX_BYTES = NOM_B_POLICY.maxDecodedBytes;
export const NOM_B_EXTENSIONS = NOM_B_POLICY.extensions;
export const NOM_B_FROM_LABEL = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${NOM_B_POLICY.deliveryFrom}T00:00:00Z`));
