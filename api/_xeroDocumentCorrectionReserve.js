import { assertXeroFinancialDailyReserve } from './_xeroFinancialSync.js';
import { documentCorrectionHash } from './_xeroDocumentCorrectionPersistence.js';

const POLICY = 'document_field_correction_v1';
const ENV_KEY = 'FCOS_XERO_DOCUMENT_CORRECTION_RESERVE_OVERRIDE';
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const GRANT_KEYS = ['authorityId', 'actorId', 'tenantId', 'policy', 'issuedAt', 'expiresAt', 'maxBatchSize'];
const PIN_KEYS = ['authorityId', 'grantHash', 'tenantId', 'previewId', 'itemIds', 'xeroInvoiceIds'];
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const uuid = (value) => typeof value === 'string' && UUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const canaryError = () => Object.assign(new Error('The reviewed correction canary authority or target pin could not be verified. Further provider requests are held.'), {
  code: 'XERO_DOCUMENT_CORRECTION_CANARY_INVALID', status: 409,
});

function timestamp(value, database = false) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || (!database && match[2] !== 'Z')) return null;
  const calendar = Date.parse(`${match[1]}Z`);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Number.isFinite(calendar) && new Date(calendar).toISOString().slice(0, 19) === match[1] ? parsed : null;
}

function checkedGrant(value, actor, tenantId, { allowExpired = false } = {}) {
  if (!exactKeys(value, GRANT_KEYS) || value.policy !== POLICY || value.maxBatchSize !== 2
    || !uuid(value.authorityId) || !uuid(value.actorId) || !uuid(value.tenantId)
    || value.actorId !== actor?.id || value.tenantId !== tenantId) return null;
  const issued = timestamp(value.issuedAt); const expires = timestamp(value.expiresAt); const now = Date.now();
  if (issued === null || expires === null || issued > now || (!allowExpired && expires <= now)
    || expires <= issued || expires - issued > 4 * 60 * 60 * 1000) return null;
  return Object.fromEntries(GRANT_KEYS.map((key) => [key, value[key]]));
}

// This is a deployment-scoped exception, never a caller-supplied permission.
// Unknown keys, mismatches and expired grants restore the ordinary reserve.
export function resolveCorrectionReserveAuthority(env, actor, tenantId) {
  const serialized = env?.[ENV_KEY];
  if (typeof serialized !== 'string' || !serialized || serialized.length > 4096) return null;
  try { return checkedGrant(JSON.parse(serialized), actor, tenantId); } catch { return null; }
}

function quotaError(rate, reserve, requiredCalls) {
  return Object.assign(new Error(requiredCalls > 0
    ? 'Insufficient Xero allowance to complete the protected correction and its exact readback.'
    : 'The available Xero allowance is exhausted. No further provider request can be sent.'), {
    code: 'XERO_FINANCIAL_DAILY_RESERVE', status: 429,
    details: { rateLimit: rate, reserve, requiredCalls },
  });
}

export function assertCorrectionAllowance(rate, env, authority, { beforeRequest = false, requiredCalls = 0 } = {}) {
  if (typeof beforeRequest !== 'boolean' || !Number.isSafeInteger(requiredCalls) || requiredCalls < 0) throw canaryError();
  const current = authority && resolveCorrectionReserveAuthority(env, { id: authority.actorId }, authority.tenantId);
  const active = current && documentCorrectionHash(current) === documentCorrectionHash(authority);
  // An operation that started under an exception cannot silently gain a new
  // authority when that grant expires or its deployment configuration changes.
  if (authority && !active) throw canaryError();
  if (!active) {
    assertXeroFinancialDailyReserve(rate, env);
    if (rate?.dayRemaining != null && requiredCalls > 0) {
      const limit = Math.max(1, Number(env?.XERO_DAILY_LIMIT || 1000));
      const reserve = Math.ceil(limit * Math.min(0.9, Math.max(0.2, Number(env?.XERO_DAILY_RESERVE_RATIO || 0.2))));
      // Preserve the existing normal-operation reserve + required-calls guard.
      if (Number(rate.dayRemaining) <= reserve + requiredCalls) throw quotaError(rate, reserve, requiredCalls);
    }
    return;
  }
  if (rate?.dayRemaining == null) {
    if (requiredCalls > 0) throw quotaError(rate, 0, requiredCalls);
    return; // Obtain the first authoritative header before requiring write capacity.
  }
  const remaining = Number(rate.dayRemaining);
  if (!Number.isFinite(remaining) || remaining < 0 || remaining < Math.max(requiredCalls, beforeRequest ? 1 : 0)) {
    throw quotaError(rate, 0, requiredCalls);
  }
  // A successful final GET may consume the last call. Persist its proof even
  // with zero remaining; actual provider 429 handling stays in the caller.
}

function exactSortedIds(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 2 && value.every(uuid)
    && new Set(value).size === value.length && value.every((id, index) => id === [...value].sort()[index]);
}

export async function verifyCorrectionCanary(client, { authority, preview, selected, actor, readbackOnly = false }) {
  // Historical authority proves which existing intent may be read back. It
  // cannot activate an allowance exception: resolution and quota checks above
  // still require a live deployment grant, including for provider GETs.
  const grantOptions = { allowExpired: readbackOnly === true };
  const grant = checkedGrant(authority, actor, preview?.tenant_id, grantOptions);
  const created = timestamp(preview?.created_at, true);
  if (typeof readbackOnly !== 'boolean' || !grant || !uuid(preview?.id) || preview.policy !== POLICY || preview.created_by !== actor?.id
    || created === null || created < timestamp(grant.issuedAt) || created >= timestamp(grant.expiresAt) || created > Date.now()
    || !exactKeys(preview.summary?.allowanceAuthority, GRANT_KEYS)
    || documentCorrectionHash(preview.summary?.allowanceAuthority) !== documentCorrectionHash(grant)
    || !Array.isArray(preview.items) || !Array.isArray(selected) || selected.length < 1 || selected.length > grant.maxBatchSize) throw canaryError();
  const itemIds = []; const xeroInvoiceIds = [];
  for (const item of selected) {
    const matches = preview.items.filter((saved) => saved?.id === item?.id);
    if (!uuid(item?.id) || !uuid(item?.xeroInvoiceId) || item.outcome !== 'eligible' || matches.length !== 1
      || documentCorrectionHash(item) !== documentCorrectionHash(matches[0])) throw canaryError();
    itemIds.push(item.id); xeroInvoiceIds.push(item.xeroInvoiceId);
  }
  itemIds.sort(); xeroInvoiceIds.sort();
  if (!exactSortedIds(itemIds) || !exactSortedIds(xeroInvoiceIds)) throw canaryError();
  // Two rows suffice to detect ambiguity; never silently choose the first pin.
  let result;
  try {
    result = await client.from('xero_financial_audit_events')
      .select('id,event_type,actor_id,actor_email,fingerprints,created_at')
      .eq('event_type', 'document_correction_allowance_canary')
      .eq('fingerprints->>authorityId', grant.authorityId).eq('actor_id', actor.id).limit(2);
  } catch { throw canaryError(); }
  const { data, error } = result || {};
  if (error || !Array.isArray(data) || data.length !== 1) throw canaryError();
  const pin = data[0]; const facts = pin?.fingerprints; const pinnedAt = timestamp(pin?.created_at, true);
  if (!plain(pin) || !/^[1-9]\d*$/.test(String(pin.id || '')) || pin.event_type !== 'document_correction_allowance_canary'
    || pin.actor_id !== actor.id || !exactKeys(facts, PIN_KEYS) || facts.authorityId !== grant.authorityId
    || facts.tenantId !== grant.tenantId || facts.previewId !== preview.id || facts.grantHash !== documentCorrectionHash(grant)
    || !exactSortedIds(facts.itemIds) || !exactSortedIds(facts.xeroInvoiceIds)
    || pinnedAt === null || pinnedAt < created || pinnedAt < timestamp(grant.issuedAt) || pinnedAt >= timestamp(grant.expiresAt)
    || pinnedAt > Date.now() || !checkedGrant(grant, actor, preview.tenant_id, grantOptions)) throw canaryError();
  // Validate the entire original pin even when Verify reads back one uncertain
  // member of a two-document batch. The pin cannot expand through a subset.
  const pinnedInvoices = [];
  for (const id of facts.itemIds) {
    const matches = preview.items.filter((saved) => saved?.id === id);
    if (matches.length !== 1 || matches[0].outcome !== 'eligible' || !uuid(matches[0].xeroInvoiceId)) throw canaryError();
    pinnedInvoices.push(matches[0].xeroInvoiceId);
  }
  pinnedInvoices.sort();
  if (!exactSortedIds(pinnedInvoices) || documentCorrectionHash(pinnedInvoices) !== documentCorrectionHash(facts.xeroInvoiceIds)
    || (readbackOnly ? itemIds.some((id) => !facts.itemIds.includes(id))
      : documentCorrectionHash(facts.itemIds) !== documentCorrectionHash(itemIds))) throw canaryError();
  return { grant: structuredClone(grant), pin: structuredClone(pin) };
}
