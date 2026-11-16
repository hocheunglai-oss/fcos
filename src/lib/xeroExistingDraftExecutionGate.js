const OPTIONS = Object.freeze({ force: true, cache: false, invalidateCache: true });
const MUTATIONS = new Set(['xeroExistingDraftAuthorisationPreview', 'xeroExistingDraftAuthorisationApply', 'xeroExistingDraftAuthorisationRecover']);
const READS = new Set(['xeroExistingDraftAuthorisationApprovedScope', 'xeroExistingDraftAuthorisationRead']);

async function read(invoke, name, payload = {}) {
  const result = await invoke(name, payload, OPTIONS);
  if (result?.error || result?.data?.error || result?.data?.cancelled || !result?.data) {
    throw new Error(result?.data?.error || result?.error?.message || 'The operation is held.');
  }
  return result.data;
}

// This is a fresh UI interlock; every dedicated server action still enforces its
// authenticated ACL, deployment, external-action and exact financial controls.
export async function verifyExistingDraftExecutionGate(invoke, expectedUserId) {
  const auth = await read(invoke, 'authContext');
  if (!expectedUserId || auth.user?.id !== expectedUserId || auth.user.active !== true
    || auth.user.read_only_ci === true || auth.moduleAccess?.xero_portal !== true
    || auth.capabilities?.xero_portal_manage !== true || auth.deploymentCapabilities?.mutationsAllowed !== true) {
    throw new Error('Active Xero management access and an execution-enabled deployment are required.');
  }
  const portal = await read(invoke, 'xeroPortalStatus', { forceRefresh: false });
  if (portal.externalActions?.xero_financial_sync?.enabled !== true || portal.xero?.connected !== true
    || portal.xero.refreshError || ['invoices', 'contacts', 'paymentsRead', 'settingsRead'].some(key => portal.xero.scopeFlags?.[key] !== true)) {
    throw new Error('The Xero connection, required scopes or financial execution gate is unavailable.');
  }
  return { userId: auth.user.id };
}

export async function invokeExistingDraftAction(invoke, beforeMutation, name, payload = {}) {
  if (!MUTATIONS.has(name) && !READS.has(name)) throw new Error('Unsupported existing-draft action.');
  if (MUTATIONS.has(name)) {
    if (typeof beforeMutation !== 'function') throw new Error('Fresh execution permission must be checked.');
    await beforeMutation();
  }
  return read(invoke, name, payload);
}
