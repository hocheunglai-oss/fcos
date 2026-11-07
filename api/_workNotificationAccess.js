import { loadEffectiveGroupAccess } from './_accessGroups.js';
import { isReadOnlyCiProfile } from './_readOnlyCiAccess.js';

// Both endpoint paths derive alert visibility from current server permissions.
export async function workNotificationAccessContext(context) {
  if (isReadOnlyCiProfile(context.profile)) return context;
  const access = await loadEffectiveGroupAccess(context.client, context.profile);
  const markets = access.permissions?.markets === true;
  return { ...context, capabilities: { ...(context.capabilities || {}), markets } };
}
