import { randomUUID } from 'node:crypto';
import { xeroControlError } from './_xeroSharedControl.js';

const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const held = () => xeroControlError('XERO_DRAFT_STATUS_QUOTA_SCOPE_INVALID');
function identity(connection, actor) {
  const email = String(actor?.email || '').trim().toLowerCase();
  if (!uuid(connection?.tenantId) || !uuid(actor?.id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw held();
  return { p_tenant_id: connection.tenantId, p_actor_id: actor.id, p_actor_email: email };
}
function targets(targetIds) {
  if (!Array.isArray(targetIds) || !targetIds.length || targetIds.length > 54 || targetIds.some(id => !uuid(id) || id !== id.toLowerCase())
    || new Set(targetIds).size !== targetIds.length) throw held();
  return [...targetIds].sort();
}
async function rpc(client, name, parameters) {
  if (typeof client?.rpc !== 'function') throw held();
  let result;
  try { result = await client.rpc(name, parameters); } catch { throw xeroControlError('XERO_SHARED_CONTROL_UNAVAILABLE'); }
  if (!result || typeof result !== 'object') throw xeroControlError('XERO_SHARED_CONTROL_UNAVAILABLE');
  if (result.error) throw xeroControlError(String(result.error.message || '').match(/\bXERO_[A-Z_]+\b/)?.[0] || 'XERO_SHARED_CONTROL_UNAVAILABLE');
  return result.data;
}
// The authenticated handler supplies the actor. No HTTP flag, client forecast,
// process-local setting or response header can grant a lower reserve floor.
export async function readExistingDraftQuotaPolicy(connection, { client, actor, targetIds }) {
  const result = await rpc(client, 'xero_existing_draft_quota_policy_v1', { ...identity(connection, actor), p_target_ids: targets(targetIds) });
  if (![0, 200].includes(result?.reserveFloor) || result.reserveFloor === 0
    && (!uuid(result.grantId) || !Number.isFinite(Date.parse(result.grantExpiresAt)) || Date.parse(result.grantExpiresAt) <= Date.now())) throw held();
  return { reserveFloor: result.reserveFloor, grantId: result.grantId || null, grantExpiresAt: result.grantExpiresAt || null };
}
export async function reserveExistingDraftQuota(connection, { client, actor, targetIds, mode, runId = null, claimId = null,
  budgetId = randomUUID(), ttlSeconds = 600 }) {
  if (!uuid(budgetId) || !['preview', 'apply', 'recovery'].includes(mode) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds !== 600
    || mode === 'preview' && (runId !== null || claimId !== null)
    || mode === 'apply' && (!uuid(runId) || claimId !== null)
    || mode === 'recovery' && (!uuid(runId) || !uuid(claimId))) throw held();
  const ids = targets(targetIds);
  if (ids.length > 25 || mode === 'recovery' && ids.length !== 1) throw held();
  const budget = await rpc(client, 'xero_existing_draft_quota_reserve_v1', { ...identity(connection, actor), p_id: budgetId,
    p_target_ids: ids, p_mode: mode, p_run_id: runId, p_claim_id: claimId, p_ttl_seconds: ttlSeconds });
  if (budget?.id !== budgetId || ![0, 200].includes(budget.reserveFloor)) throw held();
  return budget;
}
export async function releaseExistingDraftQuota(connection, { client, actor, budgetId, reason = 'Draft-status work complete' }) {
  if (!uuid(budgetId) || typeof reason !== 'string' || !reason.length || reason.length > 512) throw held();
  return rpc(client, 'xero_existing_draft_quota_release_v1', { ...identity(connection, actor), p_id: budgetId, p_reason: reason });
}
export function existingDraftSpendableCalls(status, policy) {
  if (status?.allowanceKnown !== true || !Number.isSafeInteger(status.availableCalls) || status.availableCalls < 0
    || !Number.isSafeInteger(status.reservedCalls) || status.reservedCalls < 0 || ![0, 200].includes(policy?.reserveFloor)) return 0;
  return Math.max(0, status.availableCalls - status.reservedCalls - policy.reserveFloor);
}
