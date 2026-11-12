const TABLE = 'xero_financial_credit_allocations';
const UNRESOLVED = ['processing', 'unknown', 'exception'];
const RECOVERY_LIMIT = 25;

function unwrap(result) {
  if (!result || result.error || !Object.hasOwn(result, 'data')) {
    throw Object.assign(new Error('The durable Xero credit allocation journal could not be verified.'), {
      status: result?.error?.code === '40001' ? 409 : 503,
      code: result?.error?.code === '40001' ? 'XERO_CREDIT_ALLOCATION_CONFLICT' : 'XERO_CREDIT_ALLOCATION_STORAGE',
    });
  }
  return result.data;
}

export function creditAllocationLedgerFor(client, actorId) {
  async function transition(input, status) {
    return unwrap(await client.rpc('transition_xero_credit_allocation_v1', {
      p_operation_id: input.operationId, p_tenant_id: input.tenantId, p_request_hash: input.requestHash, p_actor_id: actorId,
      p_transition: status, p_xero_allocation_id: input.xeroAllocationId ?? null, p_response_evidence: input.responseEvidence ?? null,
    }));
  }
  return {
    async listUnresolved(tenantId) {
      const result = await client.from(TABLE).select('*', { count: 'exact' }).eq('tenant_id', tenantId)
        .eq('reviewed_by', actorId).in('status', UNRESOLVED)
        .order('reviewed_at', { ascending: false }).order('operation_id').limit(RECOVERY_LIMIT);
      const rows = unwrap(result);
      if (!Array.isArray(rows) || !Number.isSafeInteger(result.count) || result.count < 0
          || rows.length !== Math.min(result.count, RECOVERY_LIMIT)
          || rows.some(row => row?.tenant_id !== tenantId || row.reviewed_by !== actorId || !UNRESOLVED.includes(row.status))
          || new Set(rows.map(row => row.operation_id)).size !== rows.length) {
        throw Object.assign(new Error('The unresolved credit allocation journal could not be verified.'), {
          status: 503, code: 'XERO_CREDIT_ALLOCATION_STORAGE',
        });
      }
      return { rows, hasMore: result.count > rows.length };
    },
    async get({ tenantId, operationId }) {
      const row = unwrap(await client.from(TABLE).select('*').eq('tenant_id', tenantId).eq('operation_id', operationId).maybeSingle());
      if (row && (row.tenant_id !== tenantId || row.operation_id !== operationId)) {
        throw Object.assign(new Error('The original credit allocation identity changed.'), { status: 409, code: 'XERO_CREDIT_ALLOCATION_CONFLICT' });
      }
      return row ?? null;
    },
    async claim(input) {
      if (input.actorId !== actorId) throw new Error('The credit allocation actor changed.');
      return unwrap(await client.rpc('claim_xero_credit_allocation_v1', {
        p_operation_id: input.operationId, p_tenant_id: input.tenantId, p_credit_mapping_id: input.creditMappingId,
        p_invoice_mapping_id: input.invoiceMappingId, p_request_hash: input.requestHash, p_request_evidence: input.requestEvidence,
        p_currency: input.currency, p_native_amount: input.nativeAmount, p_accounting_usd: input.accountingUsd, p_actor_id: actorId,
      }));
    },
    async markSent(input) {
      const result = await transition(input, 'mark_sent');
      return { marked: result?.changed === true, operation: result?.operation };
    },
    finish: (input) => transition(input, input.status),
    cancel: (input) => transition(input, 'cancelled_before_send'),
  };
}
