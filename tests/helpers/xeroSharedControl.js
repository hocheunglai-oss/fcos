import { randomUUID } from 'node:crypto';
import { bindXeroSharedControl } from '../../api/_xeroSharedControl.js';
// Explicit fixture authority. Never imported from production code.
export function fixtureSharedControl(overrides = {}) {
  return { status: async () => ({ allowanceKnown: true, availableCalls: 1000 }),
    reserve: async () => ({ id: randomUUID() }), release: async () => ({}),
    admit: async () => ({ requestId: randomUUID() }), observe: async () => ({ recorded: true }), ...overrides };
}
export const fixtureXeroConnection = (connection, control = fixtureSharedControl()) => bindXeroSharedControl({ tokenVersion: 1, ...connection }, control);
