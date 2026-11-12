const TABLE = 'xero_native_document_draft_operations';
const UNRESOLVED = ['intent', 'sent', 'unknown'];
const RECOVERY_LIMIT = 25;

function unwrap(result) {
  if (result?.error || !Object.hasOwn(result || {}, 'data')) {
    throw Object.assign(new Error('The original native document journal could not be verified.'), {
      code: 'XERO_NATIVE_DOCUMENT_JOURNAL', status: result?.error?.code === '40001' ? 409 : 503,
    });
  }
  return result.data;
}

export function nativeDocumentLedgerFor(client, actorId) {
  async function transition({ operationId, tenantId, requestHash }, name, {
    xeroId = null, mapping = null, observed = null,
  } = {}) {
    return unwrap(await client.rpc('transition_xero_native_document_draft_v1', {
      p_operation_id: operationId, p_tenant_id: tenantId, p_actor_id: actorId, p_request_hash: requestHash,
      p_transition: name, p_xero_id: xeroId, p_mapping: mapping, p_observed: observed,
    }));
  }
  return {
    async listUnresolved(tenantId) {
      const result = await client.from(TABLE).select('operation_id,tenant_id,actor_id,source_object,source_id,document_number,review_fingerprint,request_hash,request_evidence,status', { count: 'exact' })
        .eq('tenant_id', tenantId).eq('actor_id', actorId).in('status', UNRESOLVED)
        .order('created_at', { ascending: false }).order('operation_id').limit(RECOVERY_LIMIT);
      const rows = unwrap(result);
      if (!Array.isArray(rows) || !Number.isSafeInteger(result.count) || result.count < 0
          || rows.length !== Math.min(result.count, RECOVERY_LIMIT)
          || rows.some(row => row?.tenant_id !== tenantId || row.actor_id !== actorId || !UNRESOLVED.includes(row.status))
          || new Set(rows.map(row => row.operation_id)).size !== rows.length) unwrap(null);
      return { rows, hasMore: result.count > rows.length };
    },
    async get({ operationId, tenantId }) {
      const row = unwrap(await client.from(TABLE).select('*').eq('tenant_id', tenantId)
        .eq('operation_id', operationId).eq('actor_id', actorId).maybeSingle());
      if (row && (row.operation_id !== operationId || row.tenant_id !== tenantId || row.actor_id !== actorId)) unwrap(null);
      return row ?? null;
    },
    async claim({ operationId, tenantId, requestHash, review }) {
      return unwrap(await client.rpc('claim_xero_native_document_draft_v1', {
        p_operation_id: operationId, p_tenant_id: tenantId, p_actor_id: actorId, p_request_hash: requestHash, p_review: review,
      }));
    },
    markSent: key => transition(key, 'mark_sent'),
    observeId: (key, xeroId) => transition(key, 'observe_id', { xeroId }),
    confirm: (key, proof) => transition(key, 'confirmed', proof),
    markUnknown: key => transition(key, 'unknown'),
    cancel: key => transition(key, 'cancelled_before_send'),
  };
}
